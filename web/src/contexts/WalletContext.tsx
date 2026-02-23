import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import {
  onWalletChange, offWalletChange,
  isStandalone, connectInjected, disconnectInjected,
  type Address,
} from '../lib/miniapp-sdk.ts'
import { lookupSafes } from '../lib/safe-tx.ts'

interface WalletState {
  address: Address | undefined
  isConnected: boolean
  /** True when running outside the CirclesMiniapps iframe host */
  isStandalone: boolean
  /** The Safe address used for lender operations */
  safeAddress: Address | undefined
  /** True while looking up Safes for the connected EOA */
  safeLoading: boolean
  /** Error message if Safe lookup failed or no Safe found */
  safeError: string | null
  /** Manually set a Safe address (fallback when lookup fails) */
  setSafeAddress: (addr: Address) => void
  /** Connect via injected provider (standalone only) */
  connect: () => Promise<void>
  /** Disconnect (standalone only) */
  disconnect: () => void
}

const WalletContext = createContext<WalletState>({
  address: undefined,
  isConnected: false,
  isStandalone: false,
  safeAddress: undefined,
  safeLoading: false,
  safeError: null,
  setSafeAddress: () => {},
  connect: async () => {},
  disconnect: () => {},
})

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<Address | undefined>(undefined)
  const [safeAddress, setSafeAddressState] = useState<Address | undefined>(undefined)
  const [safeLoading, setSafeLoading] = useState(false)
  const [safeError, setSafeError] = useState<string | null>(null)

  useEffect(() => {
    const handler = (addr: Address | null) => {
      setAddress(addr ?? undefined)
    }
    onWalletChange(handler)
    return () => offWalletChange(handler)
  }, [])

  // Look up Safe when EOA connects in standalone mode
  // In iframe mode, the host already provides the Safe address
  useEffect(() => {
    if (!address) {
      setSafeAddressState(undefined)
      setSafeError(null)
      return
    }

    if (!isStandalone) {
      // Host provides Safe address directly
      setSafeAddressState(address)
      return
    }

    let cancelled = false
    setSafeLoading(true)
    setSafeError(null)

    lookupSafes(address)
      .then((safes) => {
        if (cancelled) return
        if (safes.length === 0) {
          setSafeError(`No Safe wallet found for ${address.slice(0, 6)}...${address.slice(-4)}`)
          setSafeAddressState(undefined)
        } else {
          setSafeAddressState(safes[0] as Address)
        }
      })
      .catch((err) => {
        if (cancelled) return
        setSafeError(err instanceof Error ? err.message : 'Failed to look up Safe')
      })
      .finally(() => {
        if (!cancelled) setSafeLoading(false)
      })

    return () => { cancelled = true }
  }, [address])

  const setSafeAddress = useCallback((addr: Address) => {
    setSafeAddressState(addr)
    setSafeError(null)
  }, [])

  const connect = useCallback(async () => {
    await connectInjected()
  }, [])

  const disconnect = useCallback(() => {
    disconnectInjected()
  }, [])

  return (
    <WalletContext.Provider value={{
      address,
      isConnected: !!address,
      isStandalone,
      safeAddress,
      safeLoading,
      safeError,
      setSafeAddress,
      connect,
      disconnect,
    }}>
      {children}
    </WalletContext.Provider>
  )
}

export function useWallet(): WalletState {
  return useContext(WalletContext)
}
