/**
 * Typed SDK for mini apps running inside the CirclesMiniapps iframe host.
 * Also supports standalone mode using an injected wallet (MetaMask etc.).
 *
 * In iframe mode: wallet state and transactions go through postMessage bridge.
 * In standalone mode: uses window.ethereum (injected provider) directly.
 */

export type Address = `0x${string}`

export interface Transaction {
  to: string
  data?: string
  value?: string
}

export interface SignResult {
  signature: string
  verified: boolean
}

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
      on: (event: string, handler: (...args: unknown[]) => void) => void
      removeListener: (event: string, handler: (...args: unknown[]) => void) => void
    }
  }
}

type WalletListener = (address: Address | null) => void
type DataListener = (data: string) => void
type PendingRequest<T> = {
  resolve: (value: T) => void
  reject: (error: Error) => void
}

/** True when NOT loaded inside an iframe (direct browser access) */
export const isStandalone = window.parent === window

let _address: Address | null = null
const _listeners: WalletListener[] = []
const _dataListeners: DataListener[] = []
let _requestCounter = 0
const _pending: Record<string, PendingRequest<unknown>> = {}

// --- Iframe mode: postMessage bridge ---

window.addEventListener('message', (event: MessageEvent) => {
  const d = event.data
  if (!d || !d.type) return

  switch (d.type) {
    case 'app_data':
      _dataListeners.forEach((fn) => fn(d.data))
      break

    case 'wallet_connected':
      _address = d.address as Address
      _listeners.forEach((fn) => fn(_address))
      break

    case 'wallet_disconnected':
      _address = null
      _listeners.forEach((fn) => fn(null))
      break

    case 'tx_success':
      (_pending[d.requestId] as PendingRequest<string[]>)?.resolve(d.hashes)
      delete _pending[d.requestId]
      break

    case 'tx_rejected':
      _pending[d.requestId]?.reject(new Error(d.error ?? d.reason ?? 'Rejected'))
      delete _pending[d.requestId]
      break

    case 'sign_success':
      (_pending[d.requestId] as PendingRequest<SignResult>)?.resolve({
        signature: d.signature,
        verified: d.verified,
      })
      delete _pending[d.requestId]
      break

    case 'sign_rejected':
      _pending[d.requestId]?.reject(new Error(d.error ?? d.reason ?? 'Rejected'))
      delete _pending[d.requestId]
      break
  }
})

if (!isStandalone) {
  window.parent.postMessage({ type: 'request_address' }, '*')
}

// --- Standalone mode: injected provider ---

const GNOSIS_CHAIN_ID_HEX = '0x64'

/** Ensure the injected wallet is on Gnosis Chain, auto-switching if needed. */
async function ensureGnosisChain(): Promise<void> {
  if (!window.ethereum) return
  const chainId = (await window.ethereum.request({ method: 'eth_chainId' })) as string
  if (chainId.toLowerCase() === GNOSIS_CHAIN_ID_HEX) return

  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: GNOSIS_CHAIN_ID_HEX }],
    })
  } catch (switchErr: any) {
    // 4902 = chain not added yet
    if (switchErr?.code === 4902) {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: GNOSIS_CHAIN_ID_HEX,
          chainName: 'Gnosis',
          nativeCurrency: { name: 'xDAI', symbol: 'XDAI', decimals: 18 },
          rpcUrls: ['https://rpc.gnosischain.com'],
          blockExplorerUrls: ['https://gnosisscan.io'],
        }],
      })
    } else {
      throw new Error('Please switch to Gnosis Chain to use this app.')
    }
  }
}

/** Connect via injected wallet (MetaMask etc.). Standalone only. */
export async function connectInjected(): Promise<Address> {
  if (!window.ethereum) throw new Error('No wallet extension found. Install MetaMask.')
  await ensureGnosisChain()
  const accounts = (await window.ethereum.request({ method: 'eth_requestAccounts' })) as string[]
  const addr = accounts[0] as Address
  _address = addr
  _listeners.forEach((fn) => fn(_address))
  return addr
}

/** Disconnect in standalone mode. */
export function disconnectInjected(): void {
  _address = null
  _listeners.forEach((fn) => fn(null))
}

// Listen for account/chain changes from injected provider
if (isStandalone && window.ethereum) {
  window.ethereum.on('accountsChanged', (accounts: unknown) => {
    const accs = accounts as string[]
    if (accs.length > 0) {
      _address = accs[0] as Address
      _listeners.forEach((fn) => fn(_address))
    } else {
      _address = null
      _listeners.forEach((fn) => fn(null))
    }
  })

  // Disconnect if user switches away from Gnosis Chain
  window.ethereum.on('chainChanged', (chainId: unknown) => {
    if ((chainId as string).toLowerCase() !== GNOSIS_CHAIN_ID_HEX && _address) {
      console.warn('Switched away from Gnosis Chain — disconnecting')
      _address = null
      _listeners.forEach((fn) => fn(null))
    }
  })

  // Auto-reconnect if previously authorized AND on Gnosis Chain
  Promise.all([
    window.ethereum.request({ method: 'eth_accounts' }),
    window.ethereum.request({ method: 'eth_chainId' }),
  ]).then(([accounts, chainId]) => {
    const accs = accounts as string[]
    if (accs.length > 0 && (chainId as string).toLowerCase() === GNOSIS_CHAIN_ID_HEX) {
      _address = accs[0] as Address
      _listeners.forEach((fn) => fn(_address))
    }
  })
}

// --- Standalone transaction/signing helpers ---

/** Poll for a transaction receipt until mined (or timeout). */
async function waitForReceipt(txHash: string, timeoutMs = 60_000): Promise<void> {
  if (!window.ethereum) return
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const receipt = await window.ethereum.request({
      method: 'eth_getTransactionReceipt',
      params: [txHash],
    })
    if (receipt) return
    await new Promise((r) => setTimeout(r, 2_000))
  }
  throw new Error(`Transaction ${txHash.slice(0, 10)}... not mined within ${timeoutMs / 1000}s`)
}

async function _sendViaInjected(transactions: Transaction[]): Promise<string[]> {
  if (!window.ethereum || !_address) throw new Error('Wallet not connected')
  const hashes: string[] = []
  for (let i = 0; i < transactions.length; i++) {
    // Wait for previous tx to be mined before sending the next one
    if (i > 0) await waitForReceipt(hashes[i - 1])
    const hash = (await window.ethereum.request({
      method: 'eth_sendTransaction',
      params: [{ from: _address, to: transactions[i].to, data: transactions[i].data || '0x', value: transactions[i].value || '0x0' }],
    })) as string
    hashes.push(hash)
  }
  return hashes
}

async function _signViaInjected(message: string): Promise<SignResult> {
  if (!window.ethereum || !_address) throw new Error('Wallet not connected')
  const signature = (await window.ethereum.request({
    method: 'personal_sign',
    params: [message, _address],
  })) as string
  return { signature, verified: true }
}

// --- Public API (mode-agnostic) ---

export function onAppData(fn: DataListener): void {
  _dataListeners.push(fn)
}

export function onWalletChange(fn: WalletListener): void {
  _listeners.push(fn)
  fn(_address) // fire with current state
}

export function offWalletChange(fn: WalletListener): void {
  const idx = _listeners.indexOf(fn)
  if (idx !== -1) _listeners.splice(idx, 1)
}

/**
 * Send one or more transactions.
 * Iframe mode: delegates to host via postMessage (batched as single UserOp).
 * Standalone mode: sends each tx via injected provider (one popup per tx).
 */
export function sendTransactions(transactions: Transaction[]): Promise<string[]> {
  if (isStandalone) return _sendViaInjected(transactions)

  return new Promise((resolve, reject) => {
    const requestId = 'req_' + ++_requestCounter
    _pending[requestId] = { resolve, reject } as PendingRequest<unknown>
    window.parent.postMessage({ type: 'send_transactions', requestId, transactions }, '*')
  })
}

/**
 * Sign an arbitrary message.
 * Iframe mode: delegates to host. Standalone mode: uses personal_sign.
 */
export function signMessage(message: string): Promise<SignResult> {
  if (isStandalone) return _signViaInjected(message)

  return new Promise((resolve, reject) => {
    const requestId = 'req_' + ++_requestCounter
    _pending[requestId] = { resolve, reject } as PendingRequest<unknown>
    window.parent.postMessage({ type: 'sign_message', requestId, message }, '*')
  })
}
