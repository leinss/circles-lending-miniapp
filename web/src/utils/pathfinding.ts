import { Sdk } from '@aboutcircles/sdk'
import { circlesConfig } from '@aboutcircles/sdk-core'
import { createPublicClient, http } from 'viem'
import { gnosis } from 'viem/chains'
import { MODULE_ADDRESS, SAFE_ABI, USDC_ADDRESS, ERC20_ABI } from '../config/constants.ts'

// Max hops in the lending path (configurable)
export const MAX_PATH_DEPTH = 5

export interface UserSettings {
  address: string
  lendingCap: bigint
  minLendIR: bigint
  borrowCap: bigint
  maxBorrowIR: bigint
  minIRMargin: bigint
  usdcBalance: bigint
  hasModuleEnabled: boolean
}

export interface LendingPath {
  path: string[] // Array of addresses forming the lending path from source to borrower
  irs: bigint[] // Interest rates for each hop in the path
  sourceUSDC: bigint // How much USDC the source has
  sourceName?: string
  sourceImage?: string
}

const publicClient = createPublicClient({
  chain: gnosis,
  transport: http(),
})

const MODULE_ABI = [{
  name: 'limits',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'user', type: 'address' }],
  outputs: [
    { name: 'lendingCap', type: 'uint256' },
    { name: 'minLendIR', type: 'uint256' },
    { name: 'borrowCap', type: 'uint256' },
    { name: 'maxBorrowIR', type: 'uint256' },
    { name: 'minIRMargin', type: 'uint256' },
  ],
}] as const

/**
 * Get all addresses that trust the given address
 */
export async function getTrusters(address: string): Promise<string[]> {
  const sdk = new Sdk({ ...circlesConfig[100], circlesRpcUrl: 'https://staging.circlesubi.network/' })
  const relations = await sdk.data.getTrustRelations(address as `0x${string}`)

  // Filter for those who trust the address (trustedBy or mutuallyTrusts)
  const trusters = relations
    .filter((rel: any) =>
      rel.relation === 'trustedBy' || rel.relation === 'mutuallyTrusts'
    )
    .map((rel: any) =>
      rel.subjectAvatar === address ? rel.objectAvatar : rel.subjectAvatar
    )

  return trusters
}

/**
 * Fetch settings and balances for multiple addresses efficiently
 */
export async function fetchUserSettings(addresses: string[]): Promise<Map<string, UserSettings>> {
  if (addresses.length === 0) return new Map()

  // Batch check: module enabled, limits, USDC balance
  const contracts = addresses.flatMap(addr => [
    {
      address: addr as `0x${string}`,
      abi: SAFE_ABI,
      functionName: 'isModuleEnabled',
      args: [MODULE_ADDRESS as `0x${string}`],
    },
    {
      address: MODULE_ADDRESS as `0x${string}`,
      abi: MODULE_ABI,
      functionName: 'limits',
      args: [addr as `0x${string}`],
    },
    {
      address: USDC_ADDRESS as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [addr as `0x${string}`],
    },
  ])

  const results = await publicClient.multicall({ contracts })

  const settingsMap = new Map<string, UserSettings>()

  for (let i = 0; i < addresses.length; i++) {
    const addr = addresses[i]
    const moduleEnabledResult = results[i * 3]
    const limitsResult = results[i * 3 + 1]
    const usdcBalanceResult = results[i * 3 + 2]

    const hasModuleEnabled = moduleEnabledResult.status === 'success' && moduleEnabledResult.result === true

    if (!hasModuleEnabled) {
      // Skip addresses without module enabled
      continue
    }

    if (limitsResult.status === 'success' && usdcBalanceResult.status === 'success') {
      const limits = limitsResult.result as unknown as readonly [bigint, bigint, bigint, bigint, bigint]
      const usdcBalance = usdcBalanceResult.result as unknown as bigint

      settingsMap.set(addr, {
        address: addr,
        lendingCap: limits[0],
        minLendIR: limits[1],
        borrowCap: limits[2],
        maxBorrowIR: limits[3],
        minIRMargin: limits[4],
        usdcBalance,
        hasModuleEnabled: true,
      })
    }
  }

  return settingsMap
}

/**
 * Find all valid lending paths to the borrower using BFS layer by layer
 * Calls onPathFound immediately whenever a valid path is discovered
 */
export async function findLendingPathsStreaming(
  borrowerAddress: string,
  maxDepth: number = MAX_PATH_DEPTH,
  onPathFound: (path: LendingPath) => Promise<void>,
  onDepthChange?: (depth: number) => void
): Promise<void> {
  const settingsMap = new Map<string, UserSettings>()
  const exploredNodes = new Set<string>([borrowerAddress])

  type PathInfo = { path: string[]; irs: bigint[] }
  const pathsToNode = new Map<string, PathInfo[]>()
  pathsToNode.set(borrowerAddress, [{ path: [], irs: [] }])

  let currentLayer = [borrowerAddress]

  for (let depth = 0; depth < maxDepth; depth++) {
    console.log(`\n=== Depth ${depth}, exploring ${currentLayer.length} nodes ===`)
    onDepthChange?.(depth)

    const nextLayer = new Set<string>()

    const trustPromises = currentLayer.map(async (node) => {
      const trusters = await getTrusters(node)
      console.log(`${node.slice(0, 8)} has ${trusters.length} trusters`)
      return { node, trusters }
    })

    const trustResults = await Promise.all(trustPromises)

    const addressesToCheck = new Set<string>()
    trustResults.forEach(({ trusters }) => {
      trusters.forEach(addr => addressesToCheck.add(addr))
    })

    if (addressesToCheck.size === 0) break

    console.log(`Batch fetching settings for ${addressesToCheck.size} addresses`)

    const newSettings = await fetchUserSettings(Array.from(addressesToCheck))
    newSettings.forEach((settings, addr) => settingsMap.set(addr, settings))

    console.log(`Found ${newSettings.size} with module enabled`)

    for (const { node, trusters } of trustResults) {
      const nodePaths = pathsToNode.get(node) || []

      for (const truster of trusters) {
        const settings = settingsMap.get(truster)
        if (!settings || settings.lendingCap === 0n) continue

        let earnIR: bigint
        if (depth === 0) {
          earnIR = settings.minLendIR
        } else {
          const receiverSettings = settingsMap.get(node)
          if (!receiverSettings) continue
          earnIR = receiverSettings.maxBorrowIR
          if (earnIR < settings.minLendIR) continue
        }

        for (const { path, irs } of nodePaths) {
          if (path.length > 0) {
            const nodeSettings = settingsMap.get(node)
            if (!nodeSettings) continue

            const payIR = earnIR
            const lendIR = irs[0]
            const margin = lendIR - payIR

            if (margin < nodeSettings.minIRMargin) {
              console.log(`${node.slice(0, 6)} margin ${margin} < min ${nodeSettings.minIRMargin}, skip`)
              continue
            }
          }

          const newPath = [truster, ...path]
          const newIRs = [earnIR, ...irs]

          // Stream this path immediately if valid
          if (settings.usdcBalance > 0n) {
            const validPath: LendingPath = {
              path: newPath,
              irs: newIRs,
              sourceUSDC: settings.usdcBalance,
            }
            console.log(`Found path: ${newPath.map(a => a.slice(0, 6)).join(' → ')}`)
            await onPathFound(validPath)
          }

          if (settings.borrowCap > 0n && depth < maxDepth - 1) {
            if (!exploredNodes.has(truster)) {
              nextLayer.add(truster)
            }

            if (!pathsToNode.has(truster)) {
              pathsToNode.set(truster, [])
            }
            pathsToNode.get(truster)!.push({ path: newPath, irs: newIRs })
          }
        }
      }
    }

    if (nextLayer.size === 0) break
    nextLayer.forEach(n => exploredNodes.add(n))
    currentLayer = Array.from(nextLayer)
  }

  console.log(`\nPathfinding complete`)
}

/**
 * Find all valid lending paths to the borrower using BFS layer by layer
 * Returns all paths at once (non-streaming version)
 */
export async function findLendingPaths(
  borrowerAddress: string,
  maxDepth: number = MAX_PATH_DEPTH
): Promise<LendingPath[]> {
  const validPaths: LendingPath[] = []
  const settingsMap = new Map<string, UserSettings>()
  const exploredNodes = new Set<string>([borrowerAddress])

  // Track paths per node: Map<address, Array<{path, irs}>>
  type PathInfo = { path: string[]; irs: bigint[] }
  const pathsToNode = new Map<string, PathInfo[]>()
  pathsToNode.set(borrowerAddress, [{ path: [], irs: [] }])

  let currentLayer = [borrowerAddress]

  for (let depth = 0; depth < maxDepth; depth++) {
    console.log(`\n=== Depth ${depth}, exploring ${currentLayer.length} nodes ===`)

    const nextLayer = new Set<string>()

    // Get trusters for all nodes in parallel
    const trustPromises = currentLayer.map(async (node) => {
      const trusters = await getTrusters(node)
      console.log(`${node.slice(0, 8)} has ${trusters.length} trusters`)
      return { node, trusters }
    })

    const trustResults = await Promise.all(trustPromises)

    // Collect unique addresses to fetch settings for
    const addressesToCheck = new Set<string>()
    trustResults.forEach(({ trusters }) => {
      trusters.forEach(addr => addressesToCheck.add(addr))
    })

    if (addressesToCheck.size === 0) break

    console.log(`Batch fetching settings for ${addressesToCheck.size} addresses`)

    // ONE multicall for all addresses
    const newSettings = await fetchUserSettings(Array.from(addressesToCheck))
    newSettings.forEach((settings, addr) => settingsMap.set(addr, settings))

    console.log(`Found ${newSettings.size} with module enabled`)

    // Process each node's trusters
    for (const { node, trusters } of trustResults) {
      const nodePaths = pathsToNode.get(node) || []

      for (const truster of trusters) {
        const settings = settingsMap.get(truster)
        if (!settings || settings.lendingCap === 0n) continue

        // Determine earnIR
        let earnIR: bigint
        if (depth === 0) {
          // Direct to borrower - use lender's minimum
          earnIR = settings.minLendIR
        } else {
          // Lending to a relayer - they have a maxBorrowIR
          const receiverSettings = settingsMap.get(node)
          if (!receiverSettings) continue
          earnIR = receiverSettings.maxBorrowIR
          if (earnIR < settings.minLendIR) continue
        }

        // Build paths through this truster
        for (const { path, irs } of nodePaths) {
          // Check if the CURRENT node (not truster) can make their margin
          // node is the relayer borrowing from truster and lending onwards
          if (path.length > 0) {
            // node is relaying: borrows at earnIR, lends at irs[0]
            const nodeSettings = settingsMap.get(node)
            if (!nodeSettings) continue

            const payIR = earnIR  // node pays this to truster
            const lendIR = irs[0] // node earns this from next hop
            const margin = lendIR - payIR

            if (margin < nodeSettings.minIRMargin) {
              console.log(`${node.slice(0, 6)} margin ${margin} < min ${nodeSettings.minIRMargin}, skip`)
              continue
            }
          }

          const newPath = [truster, ...path]
          const newIRs = [earnIR, ...irs]

          // Valid complete path if has USDC
          if (settings.usdcBalance > 0n) {
            validPaths.push({
              path: newPath,
              irs: newIRs,
              sourceUSDC: settings.usdcBalance,
            })
            console.log(`Found path: ${newPath.map(a => a.slice(0, 6)).join(' → ')}`)
          }

          // Queue for next layer if willing to relay
          if (settings.borrowCap > 0n && depth < maxDepth - 1) {
            if (!exploredNodes.has(truster)) {
              nextLayer.add(truster)
            }

            if (!pathsToNode.has(truster)) {
              pathsToNode.set(truster, [])
            }
            pathsToNode.get(truster)!.push({ path: newPath, irs: newIRs })
          }
        }
      }
    }

    if (nextLayer.size === 0) break
    nextLayer.forEach(n => exploredNodes.add(n))
    currentLayer = Array.from(nextLayer)
  }

  console.log(`\nFound ${validPaths.length} total paths`)
  return validPaths
}

/**
 * Validate a path against contract constraints
 * This mimics the checks in RailaModule.borrow()
 */
export function validatePath(
  path: LendingPath,
  settingsMap: Map<string, UserSettings>,
  borrowerAddress: string
): { valid: boolean; error?: string } {
  const { path: addresses, irs } = path

  for (let i = 0; i < addresses.length; i++) {
    const sender = addresses[i]
    const receiver = i < addresses.length - 1 ? addresses[i + 1] : borrowerAddress

    const senderSettings = settingsMap.get(sender)
    if (!senderSettings) {
      return { valid: false, error: `Sender ${sender} has no settings` }
    }

    // Check sender's lending constraints
    if (irs[i] < senderSettings.minLendIR) {
      return { valid: false, error: `IR ${irs[i]} below sender minLendIR ${senderSettings.minLendIR}` }
    }

    // If receiver is a relayer (not final borrower)
    if (i < addresses.length - 1) {
      const receiverSettings = settingsMap.get(receiver)
      if (!receiverSettings) {
        return { valid: false, error: `Receiver ${receiver} has no settings` }
      }

      if (receiverSettings.borrowCap === 0n) {
        return { valid: false, error: `Receiver ${receiver} not willing to relay (borrowCap = 0)` }
      }

      if (irs[i] > receiverSettings.maxBorrowIR) {
        return { valid: false, error: `IR ${irs[i]} exceeds receiver maxBorrowIR ${receiverSettings.maxBorrowIR}` }
      }

      // Check margin
      const margin = irs[i + 1] - irs[i]
      if (margin < receiverSettings.minIRMargin) {
        return { valid: false, error: `Margin ${margin} below receiver minIRMargin ${receiverSettings.minIRMargin}` }
      }

      if (irs[i + 1] < irs[i]) {
        return { valid: false, error: `IR decreasing along path` }
      }
    }
  }

  return { valid: true }
}
