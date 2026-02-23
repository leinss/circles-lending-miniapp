import { useState } from 'react'
import { formatUnits, parseUnits, encodeFunctionData } from 'viem'
import { useWallet } from '../contexts/WalletContext.tsx'
import { useSendTransaction } from '../hooks/useSendTransaction.ts'
import { useLendingPaths } from '../hooks/useLendingPaths.ts'
import type { LiquidityTier, EnrichedLendingPath } from '../hooks/useLendingPaths.ts'
import { MODULE_ADDRESS } from '../config/constants.ts'

const MODULE_ABI = [{
  name: 'borrow',
  type: 'function',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'amount', type: 'uint256' },
    { name: 'path', type: 'address[]' },
    { name: 'irs', type: 'uint256[]' },
  ],
  outputs: [],
}] as const

export function Borrow() {
  const { address } = useWallet()
  const [viewMode, setViewMode] = useState<'orderbook' | 'detailed'>('orderbook')

  const { data: tiers, isLoading, error, currentDepth } = useLendingPaths(address)

  if (!address) return null

  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">Borrow Liquidity</h2>

        {/* View toggle */}
        {tiers.length > 0 && (
          <div className="flex items-center gap-2 bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setViewMode('orderbook')}
              className={`px-3 py-1 text-xs font-semibold rounded transition-colors ${
                viewMode === 'orderbook'
                  ? 'bg-white text-[#ff6b35] shadow'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              Orderbook
            </button>
            <button
              onClick={() => setViewMode('detailed')}
              className={`px-3 py-1 text-xs font-semibold rounded transition-colors ${
                viewMode === 'detailed'
                  ? 'bg-white text-[#ff6b35] shadow'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              Detailed
            </button>
          </div>
        )}
      </div>

      {error && (
        <p className="text-red-600">Error: {error.message}</p>
      )}

      {!error && (
        <>
          {!isLoading && tiers.length === 0 && (
            <p className="text-gray-500">
              No lending paths found. Try expanding your trust network or ask trusted contacts to enable the Raila module.
            </p>
          )}

          {/* Show initial skeleton when first loading */}
          {isLoading && tiers.length === 0 && (
            <div className="border-2 border-gray-200 rounded-lg p-4 animate-pulse">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gray-200 rounded-full"></div>
                  <div>
                    <div className="h-4 bg-gray-200 rounded w-32 mb-1"></div>
                    <div className="h-3 bg-gray-200 rounded w-20"></div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="h-4 bg-gray-200 rounded w-24 mb-1"></div>
                  <div className="h-3 bg-gray-200 rounded w-16"></div>
                </div>
              </div>
              <div className="pt-3 border-t">
                <div className="h-3 bg-gray-200 rounded w-24 mb-2"></div>
                <div className="flex gap-2">
                  <div className="flex-1 h-10 bg-gray-200 rounded"></div>
                  <div className="w-24 h-10 bg-gray-200 rounded"></div>
                </div>
              </div>
            </div>
          )}

          {/* Show tiers as they're discovered */}
          {tiers.length > 0 && (
            <>
              {viewMode === 'orderbook' ? (
                <OrderbookView tiers={tiers} />
              ) : (
                <>
                  <p className="text-sm text-gray-600 mb-4">
                    Liquidity available at {tiers.length} rate tier{tiers.length !== 1 ? 's' : ''}
                  </p>

                  <div className="space-y-3">
                    {tiers.map((tier, idx) => (
                      <TierCard key={idx} tier={tier} />
                    ))}
                  </div>
                </>
              )}
            </>
          )}

          {/* Loading indicator at the bottom (when we already have tiers) */}
          {isLoading && tiers.length > 0 && (
            <div className="mt-4 flex items-center justify-center gap-2 text-sm text-gray-600">
              <div className="animate-spin h-3 w-3 border-2 border-[#ff6b35] border-t-transparent rounded-full"></div>
              <span>
                {currentDepth !== null
                  ? `Checking distance ${currentDepth + 1}...`
                  : 'Starting pathfinding...'}
              </span>
            </div>
          )}

          {!isLoading && tiers.length > 0 && (
            <p className="text-xs text-gray-500 mt-4 text-center">
              No more liquidity found
            </p>
          )}
        </>
      )}
    </div>
  )
}

const SECONDS_PER_YEAR = 365 * 24 * 60 * 60

function formatIR(ir: bigint): string {
  const aprPercent = Number(ir) / 1e18 * SECONDS_PER_YEAR * 100
  return aprPercent.toFixed(2)
}

function OrderbookView({ tiers }: { tiers: LiquidityTier[] }) {
  const [borrowAmount, setBorrowAmount] = useState('')

  const { sendRaw, hash, isPending, isSuccess } = useSendTransaction()

  // Calculate max liquidity for bar sizing
  const maxLiquidity = tiers.length > 0
    ? Math.max(...tiers.map(t => Number(formatUnits(t.totalAvailable, 6))))
    : 0

  // Calculate weighted average APR and max APR for the borrow amount
  const borrowAmountBigInt = borrowAmount ? parseUnits(borrowAmount, 6) : 0n
  let remainingAmount = borrowAmountBigInt
  let weightedSum = 0
  let maxAPR = 0
  const selectedTiers: Array<{ tier: LiquidityTier; amount: bigint }> = []

  for (const tier of tiers) {
    if (remainingAmount === 0n) break

    const tierAmount = tier.totalAvailable > remainingAmount ? remainingAmount : tier.totalAvailable
    selectedTiers.push({ tier, amount: tierAmount })

    weightedSum += Number(tierAmount) * tier.interestRateAPR
    maxAPR = tier.interestRateAPR
    remainingAmount -= tierAmount
  }

  const avgAPR = borrowAmountBigInt > 0n
    ? weightedSum / Number(borrowAmountBigInt)
    : 0

  const handleBorrow = () => {
    if (!borrowAmount || selectedTiers.length === 0) return

    try {
      const amountInTokens = parseUnits(borrowAmount, 6)

      // Use first path from first tier that has enough liquidity
      const firstTier = selectedTiers[0].tier
      const selectedPath = firstTier.paths.find(path => path.sourceUSDC >= amountInTokens)

      if (!selectedPath) {
        alert('Not enough liquidity in a single path for this amount')
        return
      }

      const data = encodeFunctionData({
        abi: MODULE_ABI,
        functionName: 'borrow',
        args: [
          amountInTokens,
          selectedPath.path as `0x${string}`[],
          selectedPath.irs,
        ],
      })

      sendRaw([{ to: MODULE_ADDRESS, data }])
    } catch (err) {
      console.error('Failed to borrow:', err)
      alert('Invalid borrow amount')
    }
  }

  return (
    <div className="flex gap-4">
      {/* Orderbook depth chart - 60% */}
      <div className="flex-[3]">
        <div className="space-y-1">
          {tiers.map((tier, idx) => {
            const amount = parseFloat(formatUnits(tier.totalAvailable, 6))
            const percentage = (amount / maxLiquidity) * 100

            return (
              <div
                key={idx}
                className="relative flex items-center justify-between py-2 px-3 rounded hover:bg-gray-50 transition-colors group"
              >
                {/* Background bar */}
                <div
                  className="absolute inset-y-0 left-0 bg-gradient-to-r from-orange-100 to-orange-50 rounded transition-all"
                  style={{ width: `${percentage}%` }}
                />

                {/* Content */}
                <div className="relative z-10 flex items-center justify-between w-full">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-mono font-semibold text-gray-700">
                      {amount.toFixed(2)}
                    </span>
                    <span className="text-xs text-gray-500">
                      {tier.lenderCount} source{tier.lenderCount !== 1 ? 's' : ''}
                    </span>
                  </div>

                  <span className="text-sm font-bold text-[#ff6b35]">
                    {tier.interestRateAPR.toFixed(2)}%
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Borrow input panel - 40% */}
      <div className="flex-[2] border-2 border-gray-200 rounded-lg p-4 relative">
        <div className="absolute inset-0 bg-gray-50 bg-opacity-90 rounded-lg flex items-center justify-center z-10">
          <div className="text-center px-4">
            <div className="bg-yellow-100 border-2 border-yellow-300 rounded-lg p-4 shadow-lg">
              <p className="text-sm font-bold text-yellow-800 mb-1">WIP</p>
              <p className="text-xs text-yellow-700">
                Please use <span className="font-semibold">Detailed</span> view to choose a specific path!
              </p>
            </div>
          </div>
        </div>

        <label className="block text-xs text-gray-600 mb-2 font-semibold">Amount to borrow</label>

        <div className="flex items-center border-2 rounded-lg focus-within:border-[#ff6b35] transition-colors mb-3 opacity-50">
          <input
            type="text"
            value={borrowAmount}
            onChange={(e) => setBorrowAmount(e.target.value)}
            className="flex-1 px-3 py-2 text-sm border-0 outline-none"
            placeholder="0.00"
            disabled
          />
          <span className="px-3 text-xs text-gray-500 border-l-2 bg-gray-50 font-semibold">USDC.e</span>
        </div>

        {borrowAmountBigInt > 0n && (
          <div className="mb-4 p-3 bg-gray-50 rounded border border-gray-200 opacity-50">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-600">Avg APR</span>
              <span className="text-sm font-bold text-gray-700">{avgAPR.toFixed(2)}%</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-600">Max APR</span>
              <span className="text-sm font-bold text-[#ff6b35]">{maxAPR.toFixed(2)}%</span>
            </div>
          </div>
        )}

        <button
          onClick={handleBorrow}
          disabled
          className="w-full bg-[#ff6b35] text-white px-6 py-2 rounded-lg text-sm font-bold hover:bg-[#ff5722] transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
        >
          {isPending ? 'Borrowing...' : 'Borrow'}
        </button>

        {remainingAmount > 0n && borrowAmountBigInt > 0n && (
          <p className="text-xs text-red-600 mt-2 opacity-50">
            Not enough liquidity (short {formatUnits(remainingAmount, 6)} USDC.e)
          </p>
        )}

        {hash && (
          <div className="text-xs text-gray-600 mt-2 font-mono opacity-50">
            Transaction: {hash.slice(0, 10)}...{hash.slice(-8)}
            {isSuccess && ' ✓'}
          </div>
        )}
      </div>
    </div>
  )
}

function TierCard({ tier }: { tier: LiquidityTier }) {
  const totalAvailableFormatted = parseFloat(formatUnits(tier.totalAvailable, 6)).toFixed(2)

  // Sort paths by liquidity (highest first) for display
  const sortedPaths = [...tier.paths].sort((a, b) => Number(b.sourceUSDC - a.sourceUSDC))

  return (
    <div className="border-2 border-gray-200 rounded-lg p-4 hover:border-[#ff6b35] transition-colors">
      {/* Individual path cards */}
      <div className="space-y-3 mb-3 max-w-2xl">
        {sortedPaths.map((path, idx) => (
          <PathCard key={idx} path={path} />
        ))}
      </div>

      {/* Aggregated tier summary */}
      <div className="pt-3 border-t">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-500">Total at {tier.interestRateAPR.toFixed(2)}% APR</p>
            <p className="text-sm font-semibold text-gray-700">
              {tier.lenderCount} source{tier.lenderCount !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="text-right">
            <p className="text-lg font-bold text-green-600">
              {totalAvailableFormatted} USDC.e
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function PathCard({ path }: { path: EnrichedLendingPath }) {
  const [borrowAmount, setBorrowAmount] = useState('')
  const [isExpanded, setIsExpanded] = useState(false)

  const { send, hash, isPending, isSuccess } = useSendTransaction()

  const handleBorrow = () => {
    if (!borrowAmount) return

    try {
      const amountInTokens = parseUnits(borrowAmount, 6)

      send({
        address: MODULE_ADDRESS as `0x${string}`,
        abi: MODULE_ABI,
        functionName: 'borrow',
        args: [
          amountInTokens,
          path.path as `0x${string}`[],
          path.irs,
        ],
      })
    } catch (err) {
      console.error('Failed to borrow:', err)
      alert('Invalid borrow amount')
    }
  }

  const handleBorrowMax = () => {
    setBorrowAmount(formatUnits(path.sourceUSDC, 6))
  }

  const maxBorrow = parseFloat(formatUnits(path.sourceUSDC, 6)).toFixed(2)
  const finalIR = path.irs[path.irs.length - 1]

  // Build path visualization showing each hop with interest rates
  const pathHops = path.path.map((addr, i) => {
    const profile = path.profiles[i]
    const nextIR = path.irs[i]

    return { address: addr, profile, ir: nextIR }
  })

  return (
    <div className="border-2 border-gray-200 rounded-lg p-4 hover:border-[#ff6b35] transition-colors">
      {/* Header: Source and Final Rate */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          {path.sourceImage ? (
            <img
              src={path.sourceImage}
              alt={path.sourceName || 'Source'}
              className="w-10 h-10 rounded-full object-cover"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center">
              <span className="text-gray-600 text-xs font-mono">
                {path.path[0].slice(2, 4)}
              </span>
            </div>
          )}

          <div>
            <p className="font-semibold text-sm">
              {path.sourceName || `${path.path[0].slice(0, 6)}...${path.path[0].slice(-4)}`}
            </p>
            <p className="text-xs text-gray-500">
              {path.path.length === 1 ? 'Direct lender' : `${path.path.length}-hop path`}
            </p>
          </div>
        </div>

        <div className="text-right">
          <p className="text-sm font-semibold text-green-600">
            {maxBorrow} USDC.e
          </p>
          <p className="text-xs text-gray-500">
            @ {formatIR(finalIR)}% APR
          </p>
        </div>
      </div>

      {/* Path visualization (collapsible) */}
      {path.path.length > 1 && (
        <div className="mb-3">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-xs text-[#ff6b35] hover:text-[#ff5722] font-semibold flex items-center gap-1"
          >
            {isExpanded ? '▼' : '▶'} {isExpanded ? 'Hide' : 'Show'} path details
          </button>

          {isExpanded && (
            <div className="mt-3 p-3 bg-gray-50 rounded border border-gray-200">
              <div className="flex items-center gap-2 text-xs flex-wrap">
                {pathHops.map((hop, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="flex items-center gap-1 bg-white px-2 py-1 rounded border border-gray-300">
                      {hop.profile?.image && (
                        <img
                          src={hop.profile.image}
                          alt={hop.profile.name || hop.address}
                          className="w-4 h-4 rounded-full object-cover"
                        />
                      )}
                      <span className="font-mono">
                        {hop.profile?.name || `${hop.address.slice(0, 4)}...${hop.address.slice(-2)}`}
                      </span>
                    </div>

                    {i < pathHops.length - 1 ? (
                      <div className="flex items-center gap-1 text-gray-600">
                        <span>→</span>
                        <span className="font-semibold text-[#ff6b35]">{formatIR(hop.ir)}%</span>
                        <span>→</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 text-gray-600">
                        <span>→</span>
                        <span className="font-semibold text-[#ff6b35]">{formatIR(hop.ir)}%</span>
                        <span>→</span>
                        <span className="font-mono bg-blue-100 px-2 py-1 rounded border border-blue-300">
                          You
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Show margins for multi-hop */}
              {path.path.length > 1 && (
                <div className="mt-2 pt-2 border-t border-gray-300 space-y-1">
                  {path.path.slice(1).map((addr, i) => {
                    const profile = path.profiles[i + 1]
                    const payIR = path.irs[i]
                    const earnIR = path.irs[i + 1]
                    const margin = earnIR - payIR

                    return (
                      <div key={i} className="text-xs text-gray-600 flex items-center gap-1">
                        <span className="font-mono">
                          {profile?.name || `${addr.slice(0, 4)}...${addr.slice(-2)}`}
                        </span>
                        <span>makes</span>
                        <span className="font-semibold text-green-600">
                          {formatIR(margin)}%
                        </span>
                        <span>margin</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Borrow Form */}
      <div className="pt-3 border-t">
        <label className="block text-xs text-gray-600 mb-2">Amount to borrow</label>
        <div className="flex gap-2">
          <div className="flex-1">
            <div className="flex items-center border rounded">
              <input
                type="text"
                value={borrowAmount}
                onChange={(e) => setBorrowAmount(e.target.value)}
                className="flex-1 px-3 py-2 text-sm border-0 outline-none"
                placeholder="0.00"
              />
              <span className="px-2 text-xs text-gray-500 border-l bg-gray-50">USDC.e</span>
            </div>
            <div className="flex justify-between items-center mt-1">
              <p className="text-xs text-gray-400">Available: {maxBorrow} USDC.e</p>
              <button
                onClick={handleBorrowMax}
                className="text-xs text-blue-600 hover:text-blue-700 font-semibold"
              >
                Max
              </button>
            </div>
          </div>
          <button
            onClick={handleBorrow}
            disabled={isPending || !borrowAmount}
            className="bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed self-start"
          >
            {isPending ? 'Borrowing...' : 'Borrow'}
          </button>
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
