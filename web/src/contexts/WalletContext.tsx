import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import {
  onWalletChange, offWalletChange,
  isStandalone, connectInjected, disconnectInjected,
  type Address,
} from '../lib/miniapp-sdk.ts'

interface WalletState {
  address: Address | undefined
  isConnected: boolean
  /** True when running outside the CirclesMiniapps iframe host */
  isStandalone: boolean
  /** Connect via injected provider (standalone only) */
  connect: () => Promise<void>
  /** Disconnect (standalone only) */
  disconnect: () => void
}

const WalletContext = createContext<WalletState>({
  address: undefined,
  isConnected: false,
  isStandalone: false,
  connect: async () => {},
  disconnect: () => {},
})

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<Address | undefined>(undefined)

  useEffect(() => {
    const handler = (addr: Address | null) => {
      setAddress(addr ?? undefined)
    }
    onWalletChange(handler)
    return () => offWalletChange(handler)
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
