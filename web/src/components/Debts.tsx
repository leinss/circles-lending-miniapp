import { useState, useEffect } from 'react'
import { formatUnits, parseUnits, encodeFunctionData } from 'viem'
import { useWallet } from '../contexts/WalletContext.tsx'
import { useContractRead } from '../hooks/useContractRead.ts'
import { useSendTransaction } from '../hooks/useSendTransaction.ts'
import { MODULE_ADDRESS, USDC_ADDRESS, ERC20_ABI } from '../config/constants.ts'
import { useRepayPaths } from '../hooks/useRepayPaths.ts'
import type { EnrichedRepayPath } from '../hooks/useRepayPaths.ts'

const MODULE_ABI = [{
  name: 'balances',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'user', type: 'address' }],
  outputs: [
    { name: 'lent', type: 'uint256' },
    { name: 'owedPerSecond', type: 'uint256' },
    { name: 'borrowed', type: 'uint256' },
    { name: 'owesPerSecond', type: 'uint256' },
    { name: 'timestamp', type: 'uint256' },
  ],
}, {
  name: 'repay',
  type: 'function',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'amount', type: 'uint256' },
    { name: 'path', type: 'address[]' },
  ],
  outputs: [],
}] as const

export function Debts() {
  const { address } = useWallet()

  const { data: balances } = useContractRead({
    address: MODULE_ADDRESS as `0x${string}`,
    abi: MODULE_ABI,
    functionName: 'balances',
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
    },
  })

  const { data: repayPaths, isLoading } = useRepayPaths(address)

  if (!address) return null

  const balancesTuple = balances as readonly [bigint, bigint, bigint, bigint, bigint] | undefined
  const borrowed = balancesTuple ? balancesTuple[2] : 0n
  const lent = balancesTuple ? balancesTuple[0] : 0n

  // Skip if no debts
  if (borrowed === 0n && lent === 0n) return null

  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      <h2 className="text-xl font-bold mb-4">Your Loans</h2>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="border rounded-lg p-4">
          <p className="text-xs text-gray-500 mb-1">You owe</p>
          <p className="text-2xl font-bold text-red-600">
            {parseFloat(formatUnits(borrowed, 6)).toFixed(2)} USDC.e
          </p>
        </div>
        <div className="border rounded-lg p-4">
          <p className="text-xs text-gray-500 mb-1">You're owed</p>
          <p className="text-2xl font-bold text-green-600">
            {parseFloat(formatUnits(lent, 6)).toFixed(2)} USDC.e
          </p>
        </div>
      </div>

      {borrowed > 0n && (
        <>
          <h3 className="text-lg font-semibold mb-3">Repay Your Loans</h3>

          {isLoading ? (
            <div className="space-y-3">
              {/* Loading skeleton */}
              <div className="border-2 border-gray-200 rounded-lg p-4 animate-pulse">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-8 h-8 bg-gray-200 rounded-full"></div>
                  <div className="flex-1">
                    <div className="h-4 bg-gray-200 rounded w-32 mb-1"></div>
                    <div className="h-3 bg-gray-200 rounded w-24"></div>
                  </div>
                </div>
                <div className="pt-3 border-t">
                  <div className="h-3 bg-gray-200 rounded w-20 mb-2"></div>
                  <div className="flex gap-2">
                    <div className="flex-1 h-10 bg-gray-200 rounded"></div>
                    <div className="w-24 h-10 bg-gray-200 rounded"></div>
                  </div>
                </div>
              </div>
              <p className="text-sm text-gray-500 text-center">Finding repay paths...</p>
            </div>
          ) : repayPaths && repayPaths.length > 0 ? (
            <div className="space-y-3">
              {repayPaths.map((path, idx) => (
                <RepayPathCard key={idx} path={path} borrowerAddress={address} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500">No repay paths found</p>
          )}
        </>
      )}
    </div>
  )
}

function RepayPathCard({ path, borrowerAddress }: { path: EnrichedRepayPath; borrowerAddress: string }) {
  const [repayAmount, setRepayAmount] = useState('')
  const [isExpanded, setIsExpanded] = useState(false)

  // Check USDC allowance
  const { data: allowance, refetch: refetchAllowance } = useContractRead({
    address: USDC_ADDRESS as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [borrowerAddress as `0x${string}`, MODULE_ADDRESS as `0x${string}`],
  })

  const { sendRaw, hash, isPending, isSuccess } = useSendTransaction()

  useEffect(() => {
    if (isSuccess) {
      refetchAllowance()
    }
  }, [isSuccess, refetchAllowance])

  const handleApproveAndRepay = () => {
    if (!repayAmount) return

    try {
      const amountInTokens = parseUnits(repayAmount, 6)

      const approveData = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [MODULE_ADDRESS as `0x${string}`, amountInTokens],
      })

      const repayData = encodeFunctionData({
        abi: MODULE_ABI,
        functionName: 'repay',
        args: [
          amountInTokens,
          path.path as `0x${string}`[],
        ],
      })

      // Batch approve + repay into a single sendTransactions call
      // One approval popup, atomic execution
      sendRaw([
        { to: USDC_ADDRESS, data: approveData },
        { to: MODULE_ADDRESS, data: repayData },
      ])
    } catch (err) {
      console.error('Failed to repay:', err)
      alert('Invalid repay amount')
    }
  }

  const handleRepay = () => {
    if (!repayAmount) return

    try {
      const amountInTokens = parseUnits(repayAmount, 6)

      const repayData = encodeFunctionData({
        abi: MODULE_ABI,
        functionName: 'repay',
        args: [
          amountInTokens,
          path.path as `0x${string}`[],
        ],
      })

      sendRaw([{ to: MODULE_ADDRESS, data: repayData }])
    } catch (err) {
      console.error('Failed to repay:', err)
      alert('Invalid repay amount')
    }
  }

  const handleRepayMax = () => {
    // Add 1% buffer to cover accruing interest
    const maxWithBuffer = (path.totalOwed * 101n) / 100n
    setRepayAmount(formatUnits(maxWithBuffer, 6))
  }

  const maxRepay = parseFloat(formatUnits(path.totalOwed, 6)).toFixed(2)
  const repayAmountBigInt = repayAmount ? parseUnits(repayAmount, 6) : 0n
  const needsApproval = !allowance || (allowance as bigint) < repayAmountBigInt

  // Build path visualization
  const pathHops = path.profiles

  // First lender (who you owe directly)
  const firstLender = pathHops[1] // [You, FirstLender, ...]

  return (
    <div className="border-2 border-gray-200 rounded-lg p-4 hover:border-[#ff6b35] transition-colors">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          {firstLender?.image && (
            <img
              src={firstLender.image}
              alt={firstLender.name || 'Lender'}
              className="w-8 h-8 rounded-full object-cover"
            />
          )}
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-red-600">
                ~{maxRepay} USDC.e
              </span>
              <span className="text-xs text-gray-500">
                to {firstLender?.name || `${path.path[1]?.slice(0, 6)}...${path.path[1]?.slice(-4)}`}
              </span>
            </div>
            <span className="text-xs text-gray-500">
              @ {path.maxInterestRate.toFixed(2)}% APR max
            </span>
          </div>
        </div>

        {path.path.length > 2 && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-xs text-[#ff6b35] hover:text-[#ff5722] font-semibold"
          >
            {isExpanded ? '▼ Hide' : '▶ Show'} path
          </button>
        )}
      </div>

      {/* Path visualization */}
      {isExpanded && (
        <div className="mb-3 p-3 bg-gray-50 rounded border border-gray-200">
          <p className="text-xs text-gray-600 mb-2">Repayment path:</p>
          <div className="flex items-center gap-2 text-xs flex-wrap">
            {pathHops.map((hop, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="flex items-center gap-1 bg-white px-2 py-1 rounded border border-gray-300">
                  {hop.image && (
                    <img
                      src={hop.image}
                      alt={hop.name || hop.address}
                      className="w-4 h-4 rounded-full object-cover"
                    />
                  )}
                  <span className="font-mono">
                    {hop.name || `${hop.address.slice(0, 4)}...${hop.address.slice(-2)}`}
                  </span>
                </div>
                {i < pathHops.length - 1 && <span className="text-gray-600">→</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Repay form */}
      <div className="pt-3 border-t">
        <label className="block text-xs text-gray-600 mb-2">Repay amount</label>
        <div className="flex gap-2">
          <div className="flex-1">
            <div className="flex items-center border rounded">
              <input
                type="text"
                value={repayAmount}
                onChange={(e) => setRepayAmount(e.target.value)}
                className="flex-1 px-3 py-2 text-sm border-0 outline-none"
                placeholder="0.00"
              />
              <span className="px-2 text-xs text-gray-500 border-l bg-gray-50">USDC.e</span>
            </div>
            <div className="flex justify-between items-center mt-1">
              <p className="text-xs text-gray-400">Owed: ~{maxRepay} USDC.e</p>
              <button
                onClick={handleRepayMax}
                className="text-xs text-blue-600 hover:text-blue-700 font-semibold"
              >
                Max (+1%)
              </button>
            </div>
          </div>
          {needsApproval ? (
            <button
              onClick={handleApproveAndRepay}
              disabled={isPending || !repayAmount}
              className="bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed self-start"
            >
              {isPending ? 'Processing...' : 'Approve & Repay'}
            </button>
          ) : (
            <button
              onClick={handleRepay}
              disabled={isPending || !repayAmount}
              className="bg-red-600 text-white px-6 py-2 rounded-lg text-sm font-semibold hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed self-start"
            >
              {isPending ? 'Repaying...' : 'Repay'}
            </button>
          )}
        </div>
        {hash && (
          <div className="text-xs text-gray-600 mt-2">
            Transaction: {hash.slice(0, 10)}...{hash.slice(-8)}
            {isSuccess && ' ✓'}
          </div>
        )}
      </div>
    </div>
  )
}
