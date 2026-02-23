/**
 * Safe wallet lookup + transaction execution for standalone mode.
 *
 * In standalone mode the user connects an EOA (MetaMask), but lender operations
 * need to go through their Safe. This module:
 *   1. Looks up Safes owned by the EOA via the Safe Transaction Service API
 *   2. Executes transactions through the Safe using execTransaction
 *      (sign with personal_sign → v+4 adjustment → eth_sendTransaction)
 */

import { encodeFunctionData, type Address } from 'viem'

// ---------------------------------------------------------------------------
// ABI fragments for Safe contract interaction
// ---------------------------------------------------------------------------

export const SAFE_EXEC_ABI = [
  {
    name: 'nonce',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'getTransactionHash',
    type: 'function',
    stateMutability: 'view',
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
      { name: '_nonce', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bytes32' }],
  },
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
  const res = await fetch(`${SAFE_TX_SERVICE}/owners/${ownerAddress}/safes/`)
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
 * Flow for a 1-of-1 Safe (single EOA owner):
 *   1. Read Safe nonce
 *   2. Compute Safe transaction hash via getTransactionHash(...)
 *   3. personal_sign the hash with the EOA
 *   4. Adjust signature v += 4 (tells Safe the hash was eth_sign-prefixed)
 *   5. Send execTransaction from EOA to Safe
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

  // 1. Read nonce
  const nonceHex = (await eth.request({
    method: 'eth_call',
    params: [
      {
        to: safeAddress,
        data: encodeFunctionData({ abi: SAFE_EXEC_ABI, functionName: 'nonce' }),
      },
      'latest',
    ],
  })) as string
  const nonce = BigInt(nonceHex)

  // 2. Compute Safe tx hash
  const getTxHashData = encodeFunctionData({
    abi: SAFE_EXEC_ABI,
    functionName: 'getTransactionHash',
    args: [
      to,          // to
      0n,          // value
      data,        // data
      0,           // operation (CALL)
      0n,          // safeTxGas
      0n,          // baseGas
      0n,          // gasPrice
      ZERO_ADDRESS, // gasToken
      ZERO_ADDRESS, // refundReceiver
      nonce,       // _nonce
    ],
  })

  const txHashResult = (await eth.request({
    method: 'eth_call',
    params: [{ to: safeAddress, data: getTxHashData }, 'latest'],
  })) as string

  // 3. Sign with personal_sign
  const signature = (await eth.request({
    method: 'personal_sign',
    params: [txHashResult, signerAddress],
  })) as string

  // 4. Adjust v += 4 (personal_sign prefix marker for Safe)
  const sigBytes = signature.slice(2) // remove 0x
  const r = sigBytes.slice(0, 64)
  const s = sigBytes.slice(64, 128)
  const v = parseInt(sigBytes.slice(128, 130), 16)
  const adjustedSig = `0x${r}${s}${(v + 4).toString(16).padStart(2, '0')}`

  // 5. Send execTransaction
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
      adjustedSig as `0x${string}`,
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
