import { useState, useEffect } from 'react'
import { encodeFunctionData, formatUnits, parseUnits } from 'viem'
import { useWallet } from '../contexts/WalletContext.tsx'
import { useContractRead } from '../hooks/useContractRead.ts'
import { useSendTransaction } from '../hooks/useSendTransaction.ts'
import { MODULE_ADDRESS } from '../config/constants.ts'
import { executeSafeTransaction } from '../lib/safe-tx.ts'

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
}, {
  name: 'setSettings',
  type: 'function',
  stateMutability: 'nonpayable',
  inputs: [{
    name: '_limits',
    type: 'tuple',
    components: [
      { name: 'lendingCap', type: 'uint256' },
      { name: 'minLendIR', type: 'uint256' },
      { name: 'borrowCap', type: 'uint256' },
      { name: 'maxBorrowIR', type: 'uint256' },
      { name: 'minIRMargin', type: 'uint256' },
    ],
  }],
  outputs: [],
}] as const

export function Settings({ moduleEnabled }: { moduleEnabled?: boolean }) {
  const { address, safeAddress, isStandalone } = useWallet()

  // Read limits for the Safe address (module stores limits per-Safe)
  const { data: limits, refetch } = useContractRead({
    address: MODULE_ADDRESS as `0x${string}`,
    abi: MODULE_ABI,
    functionName: 'limits',
    args: safeAddress ? [safeAddress] : undefined,
    query: {
      enabled: !!safeAddress,
    },
  })

  const [lendingCap, setLendingCap] = useState('')
  const [minLendIR, setMinLendIR] = useState('')
  const [borrowCap, setBorrowCap] = useState('')
  const [maxBorrowIR, setMaxBorrowIR] = useState('')
  const [minIRMargin, setMinIRMargin] = useState('')

  // Standalone Safe tx state
  const [safeTxHash, setSafeTxHash] = useState<string | undefined>(undefined)
  const [safeTxPending, setSafeTxPending] = useState(false)
  const [safeTxSuccess, setSafeTxSuccess] = useState(false)
  const [safeTxError, setSafeTxError] = useState<string | null>(null)

  const limitsTuple = limits as readonly [bigint, bigint, bigint, bigint, bigint] | undefined
  const isConfigured = limitsTuple && (limitsTuple[0] > 0n || limitsTuple[1] > 0n || limitsTuple[2] > 0n)

  useEffect(() => {
    if (limitsTuple && isConfigured) {
      const SECONDS_PER_YEAR = 365 * 24 * 60 * 60
      setLendingCap(formatUnits(limitsTuple[0], 6))
      setMinLendIR((Number(limitsTuple[1]) / 1e18 * SECONDS_PER_YEAR * 100).toFixed(2))
      setBorrowCap(formatUnits(limitsTuple[2], 6))
      setMaxBorrowIR((Number(limitsTuple[3]) / 1e18 * SECONDS_PER_YEAR * 100).toFixed(2))
      setMinIRMargin((Number(limitsTuple[4]) / 1e18 * SECONDS_PER_YEAR * 100).toFixed(2))
    }
  }, [limitsTuple, isConfigured])

  const { send, hash, isPending, isSuccess } = useSendTransaction()

  useEffect(() => {
    if (isSuccess || safeTxSuccess) {
      refetch()
    }
  }, [isSuccess, safeTxSuccess, refetch])

  const handleSave = async () => {
    if (!safeAddress || !address) return

    try {
      const SECONDS_PER_YEAR = 365 * 24 * 60 * 60
      const settings = {
        lendingCap: parseUnits(lendingCap || '0', 6),
        minLendIR: BigInt(Math.floor(parseFloat(minLendIR || '0') / 100 / SECONDS_PER_YEAR * 1e18)),
        borrowCap: parseUnits(borrowCap || '0', 6),
        maxBorrowIR: BigInt(Math.floor(parseFloat(maxBorrowIR || '0') / 100 / SECONDS_PER_YEAR * 1e18)),
        minIRMargin: BigInt(Math.floor(parseFloat(minIRMargin || '0') / 100 / SECONDS_PER_YEAR * 1e18)),
      }

      if (isStandalone) {
        // Standalone: route setSettings through Safe execTransaction
        setSafeTxPending(true)
        setSafeTxSuccess(false)
        setSafeTxError(null)
        setSafeTxHash(undefined)
        try {
          const data = encodeFunctionData({
            abi: MODULE_ABI,
            functionName: 'setSettings',
            args: [settings],
          })
          const txHash = await executeSafeTransaction(
            safeAddress,
            MODULE_ADDRESS as `0x${string}`,
            data,
            address,
          )
          setSafeTxHash(txHash)
          setSafeTxSuccess(true)
        } catch (err: any) {
          const isRejection = err?.code === 4001 || err?.message?.includes('User denied') || err?.message?.includes('rejected')
          setSafeTxError(isRejection ? 'Transaction rejected by user' : (err instanceof Error ? err.message : 'Transaction failed'))
          setTimeout(() => setSafeTxError(null), 8000)
        } finally {
          setSafeTxPending(false)
        }
      } else {
        // Iframe: send via postMessage (host routes through Safe UserOp)
        send({
          address: MODULE_ADDRESS as `0x${string}`,
          abi: MODULE_ABI,
          functionName: 'setSettings',
          args: [settings],
        })
      }
    } catch (err) {
      console.error('Failed to save settings:', err)
    }
  }

  const pending = isStandalone ? safeTxPending : isPending
  const txHash = isStandalone ? safeTxHash : hash
  const success = isStandalone ? safeTxSuccess : isSuccess

  if (!safeAddress || !moduleEnabled) return null

  const SECONDS_PER_YEAR = 365 * 24 * 60 * 60
  const currentLendingCap = limitsTuple ? formatUnits(limitsTuple[0], 6) : '0'
  const currentMinLendIR = limitsTuple ? (Number(limitsTuple[1]) / 1e18 * SECONDS_PER_YEAR * 100).toFixed(2) : '0'
  const currentBorrowCap = limitsTuple ? formatUnits(limitsTuple[2], 6) : '0'
  const currentMaxBorrowIR = limitsTuple ? (Number(limitsTuple[3]) / 1e18 * SECONDS_PER_YEAR * 100).toFixed(2) : '0'
  const currentMinIRMargin = limitsTuple ? (Number(limitsTuple[4]) / 1e18 * SECONDS_PER_YEAR * 100).toFixed(2) : '0'

  return (
    <>
      {isConfigured ? (
        <div className="bg-gradient-to-br from-white to-gray-50 p-5 rounded-xl shadow-lg border border-gray-100 mb-6">
          <h2 className="text-base font-bold mb-3 text-gray-800">Current Settings</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white rounded-lg p-3 border border-gray-200 shadow-sm">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-2">Max Lending</span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-xl font-bold text-[#ff6b35]">{parseFloat(currentLendingCap).toFixed(2)}</span>
                <span className="text-xs text-gray-600">USDC.e</span>
              </div>
              <div className="mt-1.5 flex items-center gap-1">
                <span className="text-xs text-gray-500">Min rate:</span>
                <span className="text-xs font-semibold text-green-600">{currentMinLendIR}%</span>
              </div>
            </div>

            {parseFloat(currentBorrowCap) > 0 ? (
              <div className="bg-white rounded-lg p-3 border border-gray-200 shadow-sm">
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-2">Relaying</span>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-xl font-bold text-blue-600">{parseFloat(currentBorrowCap).toFixed(2)}</span>
                  <span className="text-xs text-gray-600">USDC.e</span>
                </div>
                <div className="mt-1.5 space-y-0.5">
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-gray-500">Max rate:</span>
                    <span className="text-xs font-semibold text-orange-600">{currentMaxBorrowIR}%</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-gray-500">Margin:</span>
                    <span className="text-xs font-semibold text-green-600">{currentMinIRMargin}%</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-gray-100 rounded-lg p-3 border border-gray-200 flex items-center justify-center">
                <span className="text-xs text-gray-400">No relaying</span>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-gradient-to-br from-orange-50 to-orange-100 p-6 rounded-xl shadow-lg border border-orange-200 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#ff6b35] flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-800">Ready to start lending?</p>
              <p className="text-xs text-gray-600 mt-0.5">Configure your settings below</p>
            </div>
          </div>
        </div>
      )}

      <div className="bg-gradient-to-br from-white to-gray-50 p-5 rounded-xl shadow-lg border border-gray-100 overflow-hidden">
        <h2 className="text-base font-bold mb-4 text-gray-800">{isConfigured ? 'Edit' : 'Setup'} Lending Settings</h2>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-gray-700">Max Lending Amount</label>
            <div className="flex gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center border-2 border-gray-200 rounded-lg focus-within:border-[#ff6b35] transition-colors bg-white">
                  <input
                    type="text"
                    value={lendingCap}
                    onChange={(e) => setLendingCap(e.target.value)}
                    className="flex-1 min-w-0 px-3 py-2 text-sm font-medium border-0 outline-none bg-transparent"
                    placeholder="100"
                  />
                  <span className="px-2 text-xs font-semibold text-gray-500 border-l-2 border-gray-200 whitespace-nowrap">USDC.e</span>
                </div>
              </div>
              <div className="w-24">
                <div className="flex items-center border-2 border-gray-200 rounded-lg focus-within:border-green-500 transition-colors bg-white">
                  <input
                    type="text"
                    value={minLendIR}
                    onChange={(e) => setMinLendIR(e.target.value)}
                    className="flex-1 px-2 py-2 text-sm font-medium border-0 outline-none bg-transparent text-center"
                    placeholder="5.00"
                  />
                  <span className="px-2 text-xs font-semibold text-gray-500 border-l-2 border-gray-200">%</span>
                </div>
                <p className="text-xs text-gray-500 mt-1 text-center">Min IR</p>
              </div>
            </div>
          </div>

          <div className="border-t-2 border-gray-200 pt-4">
            <div className="mb-3">
              <h3 className="text-xs font-semibold text-gray-700">Relaying</h3>
              <p className="text-xs text-gray-500 mt-0.5">Autoborrow to autolend (optional)</p>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-semibold text-gray-700">Max Borrow Amount</label>
              <div className="flex gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center border-2 border-gray-200 rounded-lg focus-within:border-blue-500 transition-colors bg-white">
                    <input
                      type="text"
                      value={borrowCap}
                      onChange={(e) => setBorrowCap(e.target.value)}
                      className="flex-1 min-w-0 px-3 py-2 text-sm font-medium border-0 outline-none bg-transparent"
                      placeholder="0"
                    />
                    <span className="px-2 text-xs font-semibold text-gray-500 border-l-2 border-gray-200 whitespace-nowrap">USDC.e</span>
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center border-2 border-gray-200 rounded-lg focus-within:border-orange-500 transition-colors bg-white">
                    <input
                      type="text"
                      value={maxBorrowIR}
                      onChange={(e) => setMaxBorrowIR(e.target.value)}
                      className="flex-1 min-w-0 px-3 py-2 text-sm font-medium border-0 outline-none bg-transparent text-center"
                      placeholder="10"
                    />
                    <span className="px-2 text-xs font-semibold text-gray-500 border-l-2 border-gray-200">%</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1 text-center">Max IR</p>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center border-2 border-gray-200 rounded-lg focus-within:border-green-500 transition-colors bg-white">
                    <input
                      type="text"
                      value={minIRMargin}
                      onChange={(e) => setMinIRMargin(e.target.value)}
                      className="flex-1 min-w-0 px-3 py-2 text-sm font-medium border-0 outline-none bg-transparent text-center"
                      placeholder="1"
                    />
                    <span className="px-2 text-xs font-semibold text-gray-500 border-l-2 border-gray-200">%</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1 text-center">Margin</p>
                </div>
              </div>
            </div>
          </div>

          <button
            onClick={handleSave}
            disabled={pending}
            className="w-full bg-gradient-to-r from-[#ff6b35] to-[#ff5722] text-white px-4 py-2.5 rounded-lg text-sm font-bold hover:shadow-lg transform hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none shadow-md"
          >
            {pending ? 'Saving...' : (isConfigured ? 'Update Settings' : 'Save Settings')}
          </button>

          {safeTxError && (
            <div className="text-xs text-center text-red-600 mt-2 flex items-center justify-center gap-1">
              <span>{safeTxError}</span>
              <button onClick={() => setSafeTxError(null)} className="text-red-400 hover:text-red-600">&times;</button>
            </div>
          )}

          {txHash && (
            <div className="text-xs text-center text-gray-600 font-mono mt-2">
              Transaction: {txHash.slice(0, 10)}...{txHash.slice(-8)}
              {success && ' ✓'}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
