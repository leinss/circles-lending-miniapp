import { createPublicClient, http } from 'viem'
import { gnosis } from 'viem/chains'
import { MODULE_ADDRESS, CIRCLES_SDK_CONFIG } from '../config/constants.ts'
import { Sdk } from '@aboutcircles/sdk'

const publicClient = createPublicClient({
  chain: gnosis,
  transport: http(),
})

const MODULE_ABI = [{
  name: 'loans',
  type: 'function',
  stateMutability: 'view',
  inputs: [
    { name: 'lender', type: 'address' },
    { name: 'borrower', type: 'address' },
  ],
  outputs: [
    { name: 'amount', type: 'uint256' },
    { name: 'interestRatePerSecond', type: 'uint256' },
    { name: 'timestamp', type: 'uint256' },
  ],
}] as const

export interface RepayPath {
  path: string[] // [Borrower, Relayer1, ..., Source] - addresses to pass to repay()
  totalOwed: bigint
  maxInterestRate: number // Highest IR along the path (APR %)
}

interface LoanEdge {
  lender: string
  borrower: string
  amount: bigint
  interestRate: bigint
}

/**
 * Find all valid repay paths for a borrower by traversing their debt chain
 */
export async function findRepayPaths(borrowerAddress: string): Promise<RepayPath[]> {
  // Get all addresses in trust network (will expand as we explore)
  const sdk = new Sdk(CIRCLES_SDK_CONFIG)
  const relations = await sdk.data.getTrustRelations(borrowerAddress as `0x${string}`)
  const allAddresses = new Set<string>([borrowerAddress])

  relations.forEach((rel) => {
    const addr = rel.subjectAvatar === borrowerAddress ? rel.objectAvatar : rel.subjectAvatar
    allAddresses.add(addr)
  })

  // Build loan graph by exploring from borrower outward (BFS style)
  // Limit depth to prevent infinite exploration
  const MAX_DEPTH = 5
  const loanEdges: LoanEdge[] = []
  const exploredBorrowers = new Set<string>()
  const toExplore: Array<{ address: string; depth: number }> = [{ address: borrowerAddress, depth: 0 }]

  while (toExplore.length > 0) {
    const { address: currentBorrower, depth } = toExplore.shift()!

    // Skip if already explored
    if (exploredBorrowers.has(currentBorrower)) {
      continue
    }
    exploredBorrowers.add(currentBorrower)

    // Stop if we've gone too deep
    if (depth >= MAX_DEPTH) break

    // Expand address set with this borrower's trust network
    if (currentBorrower !== borrowerAddress) {
      try {
        const borrowerRelations = await sdk.data.getTrustRelations(currentBorrower as `0x${string}`)
        borrowerRelations.forEach((rel) => {
          const addr = rel.subjectAvatar === currentBorrower ? rel.objectAvatar : rel.subjectAvatar
          allAddresses.add(addr)
        })
      } catch {
        // trust relation lookup failed, continue with known addresses
      }
    }

    // Check loans[addr][currentBorrower] for ALL addresses we've seen
    const loanContracts = Array.from(allAddresses).map(lender => ({
      address: MODULE_ADDRESS as `0x${string}`,
      abi: MODULE_ABI,
      functionName: 'loans',
      args: [lender as `0x${string}`, currentBorrower as `0x${string}`],
      lender,
      borrower: currentBorrower,
    }))

    const results = await publicClient.multicall({
      contracts: loanContracts.map(c => ({
        address: c.address,
        abi: c.abi,
        functionName: c.functionName,
        args: c.args,
      }))
    })

    let foundLoans = 0
    for (let i = 0; i < results.length; i++) {
      const result = results[i]
      if (result.status === 'success') {
        const [amount, interestRate] = result.result as unknown as readonly [bigint, bigint, bigint]
        if (amount > 0n) {
          const { lender, borrower } = loanContracts[i]
          loanEdges.push({ lender, borrower, amount, interestRate })
          foundLoans++

          // Add this lender to our address set for future queries
          allAddresses.add(lender)

          // Queue this lender to explore their debts
          toExplore.push({ address: lender, depth: depth + 1 })
        }
      }
    }

    // Exit early if queue is getting too large (safety valve)
    if (toExplore.length > 50) {
      break
    }
  }

  // Build repay paths using DFS from borrower
  const repayPaths: RepayPath[] = []
  const visited = new Set<string>()

  function dfs(currentBorrower: string, path: string[], firstLoanAmount: bigint, maxIR: bigint) {
    // Find all lenders for current borrower
    const lenders = loanEdges.filter(edge => edge.borrower === currentBorrower)

    if (lenders.length === 0) {
      // Dead end or source reached
      if (path.length > 1) {
        // Valid path (at least one hop)
        const SECONDS_PER_YEAR = 365 * 24 * 60 * 60
        const maxInterestRate = Number(maxIR) / 1e18 * SECONDS_PER_YEAR * 100

        repayPaths.push({
          path: [...path],
          totalOwed: firstLoanAmount, // Only the first loan amount matters
          maxInterestRate,
        })
      }
      return
    }

    // Explore each lender (sorted by interest rate, highest first)
    const sortedLenders = lenders.sort((a, b) => Number(b.interestRate - a.interestRate))

    for (const { lender, amount, interestRate } of sortedLenders) {
      const pathKey = [...path, lender].join('-')
      if (visited.has(pathKey)) continue
      visited.add(pathKey)

      const newMaxIR = interestRate > maxIR ? interestRate : maxIR

      // Use first loan amount if this is the first hop, otherwise keep it
      const loanAmount = firstLoanAmount === 0n ? amount : firstLoanAmount

      // Continue the path
      dfs(lender, [...path, lender], loanAmount, newMaxIR)
    }
  }

  // Start DFS from borrower
  dfs(borrowerAddress, [borrowerAddress], 0n, 0n)

  // Sort paths by max interest rate (highest first) - prioritize paying expensive loans
  repayPaths.sort((a, b) => b.maxInterestRate - a.maxInterestRate)

  return repayPaths
}
