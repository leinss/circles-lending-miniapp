export const MODULE_ADDRESS = '0xB877459e28ae22B6CE214a3af7b3dcEC96fB8ca4'

export const USDC_ADDRESS = '0x2a22f9c3b484c3629090FeED35F17Ff8F88f76F0' // USDC.e on Gnosis

export const ERC20_ABI = [{
  name: 'balanceOf',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'account', type: 'address' }],
  outputs: [{ name: '', type: 'uint256' }],
}, {
  name: 'allowance',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],
  outputs: [{ name: '', type: 'uint256' }],
}, {
  name: 'approve',
  type: 'function',
  stateMutability: 'nonpayable',
  inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
  outputs: [{ name: '', type: 'bool' }],
}] as const

export const SAFE_ABI = [{
  name: 'isModuleEnabled',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'module', type: 'address' }],
  outputs: [{ name: '', type: 'bool' }],
}, {
  name: 'enableModule',
  type: 'function',
  stateMutability: 'nonpayable',
  inputs: [{ name: 'module', type: 'address' }],
  outputs: [],
}] as const
