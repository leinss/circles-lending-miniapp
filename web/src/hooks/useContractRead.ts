import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { createPublicClient, http, type Abi, type Address } from 'viem'
import { gnosis } from 'viem/chains'

const publicClient = createPublicClient({
  chain: gnosis,
  transport: http(),
})

interface UseContractReadOptions<TAbi extends Abi, TFunctionName extends string> {
  address: Address | undefined
  abi: TAbi
  functionName: TFunctionName
  args?: readonly unknown[]
  query?: {
    enabled?: boolean
  }
}

/**
 * Drop-in replacement for Wagmi's useReadContract.
 * Uses viem publicClient + react-query for caching/refetch.
 */
export function useContractRead<TAbi extends Abi, TFunctionName extends string>(
  options: UseContractReadOptions<TAbi, TFunctionName>
): UseQueryResult<unknown> & { refetch: () => Promise<unknown> } {
  const { address, abi, functionName, args, query } = options

  const enabled = (query?.enabled ?? true) && !!address

  const result = useQuery({
    queryKey: ['contractRead', address, functionName, args ? JSON.stringify(args, (_k, v) =>
      typeof v === 'bigint' ? v.toString() : v
    ) : null],
    queryFn: async () => {
      if (!address) throw new Error('No address')
      return publicClient.readContract({
        address,
        abi: abi as Abi,
        functionName,
        args: args as unknown[],
      })
    },
    enabled,
    staleTime: 5000,
    refetchOnWindowFocus: false,
  })

  return result as UseQueryResult<unknown> & { refetch: () => Promise<unknown> }
}
