import { useState, useEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WalletProvider, useWallet } from './contexts/WalletContext.tsx'
import { useContractRead } from './hooks/useContractRead.ts'
import { useSendTransaction } from './hooks/useSendTransaction.ts'
import { HelpButton, HelpModal } from './components/HelpModal.tsx'
import { Settings } from './components/Settings.tsx'
import { Borrow } from './components/Borrow.tsx'
import { Debts } from './components/Debts.tsx'
import { Sdk } from '@aboutcircles/sdk'
import { encodeFunctionData, formatUnits } from 'viem'
import { MODULE_ADDRESS, SAFE_ABI, USDC_ADDRESS, ERC20_ABI, CIRCLES_SDK_CONFIG } from './config/constants.ts'
import { executeSafeTransaction } from './lib/safe-tx.ts'
import type { Address } from './lib/miniapp-sdk.ts'

const queryClient = new QueryClient()

function EnableModule() {
  const { address, safeAddress, isStandalone } = useWallet()
  const { send, hash, isPending, isSuccess } = useSendTransaction()
  const [safeTxHash, setSafeTxHash] = useState<string | undefined>(undefined)
  const [safeTxPending, setSafeTxPending] = useState(false)
  const [safeTxError, setSafeTxError] = useState<string | null>(null)

  const handleEnableModule = async () => {
    if (!safeAddress) return

    if (isStandalone && address) {
      // Standalone: route through Safe execTransaction
      setSafeTxPending(true)
      setSafeTxError(null)
      setSafeTxHash(undefined)
      try {
        const data = encodeFunctionData({
          abi: SAFE_ABI,
          functionName: 'enableModule',
          args: [MODULE_ADDRESS as `0x${string}`],
        })
        const hash = await executeSafeTransaction(safeAddress, safeAddress, data, address)
        setSafeTxHash(hash)
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
        address: safeAddress,
        abi: SAFE_ABI,
        functionName: 'enableModule',
        args: [MODULE_ADDRESS as `0x${string}`],
      })
    }
  }

  const pending = isStandalone ? safeTxPending : isPending
  const txHash = isStandalone ? safeTxHash : hash
  const success = isStandalone ? !!safeTxHash : isSuccess

  return (
    <div className="flex flex-col gap-4">
      <button
        onClick={handleEnableModule}
        disabled={pending}
        className="bg-[#ff6b35] text-white px-4 py-3 rounded-lg hover:bg-[#ff5722] transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
      >
        {pending ? 'Enabling Module...' : 'Enable Module'}
      </button>
      {safeTxError && (
        <div className="text-sm text-red-600 flex items-center justify-between">
          <span>{safeTxError}</span>
          <button onClick={() => setSafeTxError(null)} className="ml-2 text-red-400 hover:text-red-600">&times;</button>
        </div>
      )}
      {txHash && (
        <div className="text-sm text-gray-600">
          Transaction: {txHash.slice(0, 10)}...{txHash.slice(-8)}
          {success && ' ✓'}
        </div>
      )}
    </div>
  )
}

function SafeErrorFallback() {
  const { safeError, setSafeAddress } = useWallet()
  const [manualAddress, setManualAddress] = useState('')

  const handleSubmit = () => {
    const trimmed = manualAddress.trim()
    if (trimmed.match(/^0x[a-fA-F0-9]{40}$/)) {
      setSafeAddress(trimmed as Address)
    }
  }

  return (
    <div className="bg-white p-6 rounded-lg shadow-md max-w-md">
      <div className="flex items-start gap-3 mb-4">
        <svg className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
        </svg>
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-800 mb-1">{safeError}</p>
          <p className="text-xs text-gray-500 mb-3">Enter your Safe address manually:</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={manualAddress}
              onChange={(e) => setManualAddress(e.target.value)}
              placeholder="0x..."
              className="flex-1 px-3 py-2 text-xs font-mono border-2 border-gray-200 rounded-lg focus:border-[#ff6b35] outline-none"
            />
            <button
              onClick={handleSubmit}
              disabled={!manualAddress.match(/^0x[a-fA-F0-9]{40}$/)}
              className="px-3 py-2 text-xs font-semibold bg-[#ff6b35] text-white rounded-lg hover:bg-[#ff5722] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Use
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function LenderPanel() {
  const { isConnected, safeAddress, safeLoading, safeError } = useWallet()

  const { data: moduleEnabledRaw } = useContractRead({
    address: safeAddress,
    abi: SAFE_ABI,
    functionName: 'isModuleEnabled',
    args: [MODULE_ADDRESS as `0x${string}`],
    query: {
      enabled: !!safeAddress && isConnected,
    },
  })

  const moduleEnabled = !!moduleEnabledRaw

  if (!isConnected) return null

  if (safeLoading) {
    return (
      <div className="bg-white p-6 rounded-lg shadow-md max-w-md">
        <div className="flex items-center gap-3">
          <div className="animate-spin w-5 h-5 border-2 border-gray-300 border-t-[#ff6b35] rounded-full" />
          <span className="text-sm text-gray-600">Looking up your Safe wallet...</span>
        </div>
      </div>
    )
  }

  if (safeError) {
    return <SafeErrorFallback />
  }

  if (!safeAddress) return null

  return (
    <div className="space-y-6 max-w-md">
      <div className="bg-white p-6 rounded-lg shadow-md">
        <div className="flex items-start gap-3 mb-4">
          <div className="bg-[#ff6b35] bg-opacity-10 p-3 rounded-lg">
            <svg className="w-6 h-6 text-[#ff6b35]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-bold mb-1">Become a Lender or Relayer</h2>
            <p className="text-sm text-gray-600">
              Enable the Raila module to lend to your trusted circle or act as a loan relayer
            </p>
          </div>
        </div>

        {!moduleEnabled ? (
          <EnableModule />
        ) : (
          <div className="flex items-center gap-2 text-green-600 font-semibold">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Module Enabled
          </div>
        )}
      </div>

      {moduleEnabled && <Settings moduleEnabled={true} />}
    </div>
  )
}

function BorrowerPanel() {
  const { isConnected } = useWallet()

  if (!isConnected) return null

  return (
    <div className="space-y-6">
      <Debts />
      <Borrow />
    </div>
  )
}

function Dashboard() {
  const { isConnected } = useWallet()

  if (!isConnected) return null

  return (
    <div className="flex flex-col lg:flex-row gap-8 max-w-6xl mx-auto">
      <LenderPanel />
      <div className="flex-1 max-w-2xl">
        <BorrowerPanel />
      </div>
    </div>
  )
}

function CirclesInfo({ address }: { address: string }) {
  const [avatarInfo, setAvatarInfo] = useState<any>(null)
  const [profile, setProfile] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchAvatarInfo() {
      try {
        setLoading(true)
        setError(null)

        const sdk = new Sdk(CIRCLES_SDK_CONFIG)

        const avatarData = await sdk.data.getAvatar(address as `0x${string}`)

        if (avatarData) {
          setAvatarInfo(avatarData)

          if (avatarData.cidV0) {
            const profileData = await sdk.profiles.get(avatarData.cidV0)
            setProfile(profileData)
          }
        } else {
          setAvatarInfo(null)
          setProfile(null)
        }
      } catch (err) {
        console.error('Failed to fetch avatar info:', err)
        setError(err instanceof Error ? err.message : 'Failed to fetch avatar')
        setAvatarInfo(null)
        setProfile(null)
      } finally {
        setLoading(false)
      }
    }

    fetchAvatarInfo()
  }, [address])

  if (loading) {
    return <div className="text-gray-600 text-sm">Loading Circles info...</div>
  }

  if (error) {
    return <div className="text-red-600 text-sm">Error: {error}</div>
  }

  if (!avatarInfo) {
    return <div className="text-yellow-600 text-sm">Not a Circles avatar</div>
  }

  return (
    <div className="flex items-center gap-2">
      {profile?.previewImageUrl && (
        <img
          src={profile.previewImageUrl}
          alt={profile.name || 'Avatar'}
          className="w-8 h-8 rounded-full object-cover"
        />
      )}
      <div className="flex flex-col">
        {profile?.name && <div className="text-sm font-semibold">{profile.name}</div>}
        <div className="text-xs text-green-600">Circles Avatar</div>
      </div>
    </div>
  )
}

function WalletStatus() {
  const { address, isConnected, isStandalone, safeAddress, connect, disconnect } = useWallet()
  const [copied, setCopied] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)

  // Clear connect error when wallet state changes
  useEffect(() => {
    if (isConnected) setConnectError(null)
  }, [isConnected])

  const { data: usdcBalance } = useContractRead({
    address: USDC_ADDRESS as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: {
      enabled: !!address && isConnected,
    },
  })

  const handleCopy = async () => {
    if (!address) return
    try {
      await navigator.clipboard.writeText(address)
    } catch {
      // Fallback for HTTP contexts where Clipboard API is unavailable
      const ta = document.createElement('textarea')
      ta.value = address
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleConnect = async () => {
    try {
      setConnectError(null)
      await connect()
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : 'Connection failed')
    }
  }

  if (!isConnected) {
    if (isStandalone) {
      return (
        <div className="p-3 bg-white rounded-lg shadow-md w-full sm:w-auto sm:min-w-[280px]">
          <button
            onClick={handleConnect}
            className="bg-[#ff6b35] text-white px-4 py-2 rounded-lg hover:bg-[#ff5722] transition-colors font-semibold text-sm w-full"
          >
            Connect Wallet
          </button>
          {connectError && (
            <p className="text-xs text-red-500 mt-2">{connectError}</p>
          )}
        </div>
      )
    }
    return (
      <div className="p-3 bg-white rounded-lg shadow-md w-full sm:w-auto sm:min-w-[280px]">
        <p className="text-sm text-gray-500">Waiting for wallet from host...</p>
      </div>
    )
  }

  const formattedBalance = usdcBalance ? formatUnits(usdcBalance as bigint, 6) : '0'

  return (
    <div className="p-3 bg-white rounded-lg shadow-md relative w-full sm:w-auto sm:min-w-[280px]">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2">
          {address && <CirclesInfo address={address} />}
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-1">
            <a
              href={`https://gnosisscan.io/address/${address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-xs text-gray-600 hover:text-gray-800"
            >
              {address?.slice(0, 6)}...{address?.slice(-4)}
            </a>
            <button
              onClick={handleCopy}
              className="text-gray-500 hover:text-gray-700 p-1"
              title="Copy address"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </button>
            {isStandalone && (
              <button
                onClick={() => { setConnectError(null); disconnect() }}
                className="text-gray-400 hover:text-red-500 p-1"
                title="Disconnect"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            )}
          </div>
          {/* Show Safe address when in standalone mode and Safe is different from EOA */}
          {isStandalone && safeAddress && safeAddress !== address && (
            <a
              href={`https://app.safe.global/home?safe=gno:${safeAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-xs text-blue-500 hover:text-blue-700"
              title="Safe wallet"
            >
              Safe: {safeAddress.slice(0, 6)}...{safeAddress.slice(-4)}
            </a>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1">
        <img src="https://cryptologos.cc/logos/usd-coin-usdc-logo.svg" alt="USDC" className="w-3 h-3" />
        <span className="text-xs font-semibold">{parseFloat(formattedBalance).toFixed(2)} USDC.e</span>
      </div>

      {copied && (
        <div className="absolute bottom-1 right-3 text-xs text-green-600 bg-white px-2 py-1 rounded shadow-sm">
          Copied!
        </div>
      )}
    </div>
  )
}

function App() {
  const [showHelp, setShowHelp] = useState(() => {
    const seen = localStorage.getItem('raila-onboarding-seen')
    return !seen
  })

  const handleOnboardingComplete = () => {
    localStorage.setItem('raila-onboarding-seen', 'true')
    setShowHelp(false)
  }

  return (
    <WalletProvider>
      <QueryClientProvider client={queryClient}>
        <div>
          <HelpModal
            isOpen={showHelp}
            onClose={handleOnboardingComplete}
          />

          <div>
            <div className="flex justify-between items-center px-4 py-3 max-w-6xl mx-auto">
              <h1 className="text-2xl font-bold">Raila Circles</h1>
              <div className="flex items-center gap-3">
                <HelpButton onClick={() => setShowHelp(true)} />
                <WalletStatus />
              </div>
            </div>

            <div className="px-4">
              <Dashboard />
            </div>
          </div>
        </div>
      </QueryClientProvider>
    </WalletProvider>
  )
}

export default App
