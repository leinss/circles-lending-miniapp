/**
 * Typed SDK for mini apps running inside the CirclesMiniapps iframe host.
 *
 * Ported from CirclesMiniapps/examples/miniapp-sdk.js
 *
 * Works identically whether loaded inside the host iframe or opened standalone
 * (standalone simply never receives wallet_connected, so the UI stays disconnected).
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

type WalletListener = (address: Address | null) => void
type DataListener = (data: string) => void
type PendingRequest<T> = {
  resolve: (value: T) => void
  reject: (error: Error) => void
}

let _address: Address | null = null
const _listeners: WalletListener[] = []
const _dataListeners: DataListener[] = []
let _requestCounter = 0
const _pending: Record<string, PendingRequest<unknown>> = {}

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

// Ask the host for the current wallet state on load
if (window.parent !== window) {
  window.parent.postMessage({ type: 'request_address' }, '*')
}

/**
 * Register a callback that fires when the host sends app-specific data via ?data= param.
 */
export function onAppData(fn: DataListener): void {
  _dataListeners.push(fn)
}

/**
 * Register a callback that fires whenever wallet connection changes.
 * Called immediately with current state, then again on every change.
 */
export function onWalletChange(fn: WalletListener): void {
  _listeners.push(fn)
  fn(_address) // fire with current state
}

/**
 * Unregister a wallet change listener.
 */
export function offWalletChange(fn: WalletListener): void {
  const idx = _listeners.indexOf(fn)
  if (idx !== -1) _listeners.splice(idx, 1)
}

/**
 * Request the host to send one or more transactions.
 * Returns array of tx hashes after the UserOp is mined.
 */
export function sendTransactions(transactions: Transaction[]): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const requestId = 'req_' + ++_requestCounter
    _pending[requestId] = { resolve, reject } as PendingRequest<unknown>
    window.parent.postMessage({ type: 'send_transactions', requestId, transactions }, '*')
  })
}

/**
 * Request the host to sign an arbitrary message.
 */
export function signMessage(message: string): Promise<SignResult> {
  return new Promise((resolve, reject) => {
    const requestId = 'req_' + ++_requestCounter
    _pending[requestId] = { resolve, reject } as PendingRequest<unknown>
    window.parent.postMessage({ type: 'sign_message', requestId, message }, '*')
  })
}
