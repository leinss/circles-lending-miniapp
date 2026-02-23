import { useQuery } from '@tanstack/react-query'
import { findRepayPaths } from '../utils/repayPathfinding.ts'
import type { RepayPath } from '../utils/repayPathfinding.ts'
import { Sdk } from '@aboutcircles/sdk'
import { CIRCLES_SDK_CONFIG } from '../config/constants.ts'

export interface EnrichedRepayPath extends RepayPath {
  profiles: {
    address: string
    name?: string
    image?: string
  }[]
}

/**
 * Hook to find repay paths with profile metadata
 */
export function useRepayPaths(borrowerAddress: string | undefined, enabled: boolean = true) {
  return useQuery({
    queryKey: ['repayPaths', borrowerAddress],
    queryFn: async () => {
      if (!borrowerAddress) return []

      const paths = await findRepayPaths(borrowerAddress)

      if (paths.length === 0) return []

      // Enrich with profiles
      const sdk = new Sdk(CIRCLES_SDK_CONFIG)
      const allAddresses = new Set<string>()

      paths.forEach(path => {
        path.path.forEach(addr => allAddresses.add(addr))
      })

      const profilePromises = Array.from(allAddresses).map(async (addr) => {
        try {
          const avatarData = await sdk.data.getAvatar(addr as `0x${string}`)
          if (avatarData?.cidV0) {
            const profile = await sdk.profiles.get(avatarData.cidV0)
            return {
              address: addr,
              name: profile?.name,
              image: profile?.previewImageUrl,
            }
          }
        } catch (err) {
          console.error(`Failed to fetch profile for ${addr}:`, err)
        }
        return { address: addr, name: undefined, image: undefined }
      })

      const profiles = await Promise.all(profilePromises)
      const profileMap = new Map(profiles.map(p => [p.address, p]))

      const enrichedPaths: EnrichedRepayPath[] = paths.map(path => {
        const pathProfiles = path.path.map(addr => profileMap.get(addr)!).filter(Boolean)

        return {
          ...path,
          profiles: pathProfiles,
        }
      })

      return enrichedPaths
    },
    enabled: !!borrowerAddress && enabled,
    staleTime: 10000, // 10 seconds
    refetchOnWindowFocus: false,
  })
}
