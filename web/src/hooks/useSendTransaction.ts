import { useState, useCallback } from 'react'
import { encodeFunctionData, type Abi, type Address } from 'viem'
import { sendTransactions, type Transaction } from '../lib/miniapp-sdk.ts'

interface SendParams {
  address: Address
  abi: Abi
  functionName: string
  args?: readonly unknown[]
}

interface UseSendTransactionReturn {
  /** Encode and send a single contract call through the host wallet */
  send: (params: SendParams) => Promise<void>
  /** Send pre-encoded transactions (for batching approve+repay etc.) */
  sendRaw: (txs: Transaction[]) => Promise<void>
  /** First tx hash from the most recent successful send */
  hash: string | undefined
  isPending: boolean
  isSuccess: boolean
  error: Error | null
  reset: () => void
}

/**
 * Drop-in replacement for Wagmi's useWriteContract + useWaitForTransactionReceipt.
 *
 * Uses viem encodeFunctionData to build calldata, then sends via the miniapp-sdk
 * postMessage bridge. The host returns tx hashes after the UserOp is mined,
 * so there's no separate "wait for receipt" step.
 */
export function useSendTransaction(): UseSendTransactionReturn {
  const [hash, setHash] = useState<string | undefined>(undefined)
  const [isPending, setIsPending] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const reset = useCallback(() => {
    setHash(undefined)
    setIsPending(false)
    setIsSuccess(false)
    setError(null)
  }, [])

  const sendRaw = useCallback(async (txs: Transaction[]) => {
    setIsPending(true)
    setIsSuccess(false)
    setError(null)
    setHash(undefined)

    try {
      const hashes = await sendTransactions(txs)
      setHash(hashes[0])
      setIsSuccess(true)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Transaction failed'))
    } finally {
      setIsPending(false)
    }
  }, [])

  const send = useCallback(async (params: SendParams) => {
    const data = encodeFunctionData({
      abi: params.abi,
      functionName: params.functionName,
      args: params.args as unknown[],
    })

    await sendRaw([{ to: params.address, data }])
  }, [sendRaw])

  return { send, sendRaw, hash, isPending, isSuccess, error, reset }
}
