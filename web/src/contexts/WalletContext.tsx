import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { onWalletChange, offWalletChange, type Address } from '../lib/miniapp-sdk.ts'

interface WalletState {
  address: Address | undefined
  isConnected: boolean
}

const WalletContext = createContext<WalletState>({
  address: undefined,
  isConnected: false,
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

  return (
    <WalletContext.Provider value={{ address, isConnected: !!address }}>
      {children}
    </WalletContext.Provider>
  )
}

export function useWallet(): WalletState {
  return useContext(WalletContext)
}
