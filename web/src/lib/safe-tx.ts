/**
 * Safe wallet lookup + transaction execution for standalone mode.
 *
 * In standalone mode the user connects an EOA (MetaMask), but lender operations
 * need to go through their Safe. This module:
 *   1. Looks up Safes owned by the EOA via the Safe Transaction Service API
 *   2. Executes transactions through the Safe using execTransaction
 *      with a v=1 "msg.sender is owner" signature (single wallet popup)
 */

import { encodeFunctionData, getAddress, type Address } from 'viem'

// ---------------------------------------------------------------------------
// ABI fragments for Safe contract interaction
// ---------------------------------------------------------------------------

export const SAFE_EXEC_ABI = [
  {
    name: 'execTransaction',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'data', type: 'bytes' },
      { name: 'operation', type: 'uint8' },
      { name: 'safeTxGas', type: 'uint256' },
      { name: 'baseGas', type: 'uint256' },
      { name: 'gasPrice', type: 'uint256' },
      { name: 'gasToken', type: 'address' },
      { name: 'refundReceiver', type: 'address' },
      { name: 'signatures', type: 'bytes' },
    ],
    outputs: [{ name: 'success', type: 'bool' }],
  },
  {
    name: 'getThreshold',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address
const SAFE_TX_SERVICE = 'https://safe-transaction-gnosis-chain.safe.global/api/v1'

// ---------------------------------------------------------------------------
// Safe lookup via Transaction Service API
// ---------------------------------------------------------------------------

export async function lookupSafes(ownerAddress: string): Promise<Address[]> {
  // Safe TX Service requires EIP-55 checksummed addresses
  const checksummed = getAddress(ownerAddress)
  const res = await fetch(`${SAFE_TX_SERVICE}/owners/${checksummed}/safes/`)
  if (!res.ok) throw new Error(`Safe TX Service error: ${res.status}`)
  const body = await res.json() as { safes: string[] }
  return (body.safes ?? []) as Address[]
}

// ---------------------------------------------------------------------------
// Execute a transaction through a 1/1 Safe
// ---------------------------------------------------------------------------

/**
 * Execute an arbitrary call through a Safe owned by the signer.
 *
 * Uses the v=1 "msg.sender is owner" signature: since the EOA submitting
 * the transaction is the Safe owner, no cryptographic signing is needed.
 * The Safe contract checks msg.sender == owner decoded from the r-value.
 * This reduces wallet popups from 2 (personal_sign + sendTransaction) to 1.
 *
 * Returns the outer transaction hash.
 */
export async function executeSafeTransaction(
  safeAddress: Address,
  to: Address,
  data: `0x${string}`,
  signerAddress: Address,
): Promise<string> {
  const eth = window.ethereum
  if (!eth) throw new Error('No wallet extension found')

  // 1. Build v=1 owner signature: r=signerAddress (padded to 32 bytes), s=0, v=1
  // Safe's checkNSignatures treats v=1 as "msg.sender is owner" — skips ECDSA entirely
  const ownerPadded = signerAddress.slice(2).toLowerCase().padStart(64, '0')
  const signature = `0x${ownerPadded}${'0'.repeat(64)}01` as `0x${string}`

  // 2. Send execTransaction (only wallet popup)
  const execData = encodeFunctionData({
    abi: SAFE_EXEC_ABI,
    functionName: 'execTransaction',
    args: [
      to,
      0n,
      data,
      0,           // operation (CALL)
      0n,          // safeTxGas
      0n,          // baseGas
      0n,          // gasPrice
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      signature,
    ],
  })

  const txHash = (await eth.request({
    method: 'eth_sendTransaction',
    params: [{
      from: signerAddress,
      to: safeAddress,
      data: execData,
    }],
  })) as string

  return txHash
}
