import { useState, useEffect, useRef } from 'react'
import { findLendingPathsStreaming, MAX_PATH_DEPTH } from '../utils/pathfinding.ts'
import type { LendingPath } from '../utils/pathfinding.ts'
import { Sdk } from '@aboutcircles/sdk'
import { CIRCLES_SDK_CONFIG } from '../config/constants.ts'

export interface EnrichedLendingPath extends LendingPath {
  sourceName?: string
  sourceImage?: string
  profiles: {
    address: string
    name?: string
    image?: string
  }[]
}

export interface LiquidityTier {
  interestRate: bigint // The IR you'd pay (per second)
  interestRateAPR: number // APR %
  totalAvailable: bigint // Total USDC.e available at this rate
  lenderCount: number // How many unique sources
  paths: EnrichedLendingPath[] // Underlying paths with profile data (for executing borrow & display)
}

/**
 * Hook to aggregate lending paths by interest rate (order book style), streaming as discovered
 */
export function useLendingPaths(borrowerAddress: string | undefined, enabled: boolean = true) {
  const [tiers, setTiers] = useState<LiquidityTier[]>([])
  const [currentDepth, setCurrentDepth] = useState<number | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const seenPaths = useRef(new Set<string>())

  useEffect(() => {
    if (!borrowerAddress || !enabled) return

    const SECONDS_PER_YEAR = 365 * 24 * 60 * 60
    const sdk = new Sdk(CIRCLES_SDK_CONFIG)
    const profileCache = new Map<string, { name?: string; image?: string }>()

    async function enrichPath(path: LendingPath): Promise<EnrichedLendingPath> {
      const profilePromises = path.path.map(async (addr) => {
        if (profileCache.has(addr)) {
          return { address: addr, ...profileCache.get(addr)! }
        }

        try {
          const avatarData = await sdk.data.getAvatar(addr as `0x${string}`)
          if (avatarData?.cidV0) {
            const profile = await sdk.profiles.get(avatarData.cidV0)
            const result = {
              address: addr,
              name: profile?.name,
              image: profile?.previewImageUrl,
            }
            profileCache.set(addr, { name: result.name, image: result.image })
            return result
          }
        } catch (err) {
          console.error(`Failed to fetch profile for ${addr}:`, err)
        }

        const result = { address: addr, name: undefined, image: undefined }
        profileCache.set(addr, { name: undefined, image: undefined })
        return result
      })

      const profiles = await Promise.all(profilePromises)
      const sourceProfile = profiles[0]

      return {
        ...path,
        sourceName: sourceProfile?.name,
        sourceImage: sourceProfile?.image,
        profiles,
      }
    }

    async function loadPaths() {
      setIsLoading(true)
      setError(null)
      setTiers([])
      setCurrentDepth(null)
      seenPaths.current.clear()

      // Map from IR (as string) to aggregated data
      const tierMap = new Map<string, LiquidityTier>()

      try {
        await findLendingPathsStreaming(
          borrowerAddress!,
          MAX_PATH_DEPTH,
          async (path) => {
            // Dedupe by path addresses
            const pathKey = path.path.join('-')
            if (seenPaths.current.has(pathKey)) {
              return
            }
            seenPaths.current.add(pathKey)

            // Get the final IR (what you pay as borrower)
            const finalIR = path.irs[path.irs.length - 1]
            const irKey = finalIR.toString()

            // Add unenriched first for instant display
            const unenriched: EnrichedLendingPath = {
              ...path,
              profiles: path.path.map(addr => ({ address: addr, name: undefined, image: undefined }))
            }

            if (tierMap.has(irKey)) {
              // Add to existing tier
              const tier = tierMap.get(irKey)!
              tier.totalAvailable += path.sourceUSDC
              tier.lenderCount += 1
              tier.paths.push(unenriched)
            } else {
              // Create new tier
              const aprPercent = Number(finalIR) / 1e18 * SECONDS_PER_YEAR * 100
              tierMap.set(irKey, {
                interestRate: finalIR,
                interestRateAPR: aprPercent,
                totalAvailable: path.sourceUSDC,
                lenderCount: 1,
                paths: [unenriched],
              })
            }

            // Convert map to sorted array (lowest rate first)
            const sortedTiers = Array.from(tierMap.values()).sort((a, b) =>
              Number(a.interestRate - b.interestRate)
            )

            setTiers(sortedTiers)

            // Enrich in background
            enrichPath(path).then(enriched => {
              const tier = tierMap.get(irKey)
              if (tier) {
                const pathIndex = tier.paths.findIndex(p => p.path.join('-') === pathKey)
                if (pathIndex !== -1) {
                  tier.paths[pathIndex] = enriched
                  // Re-sort and update
                  const updatedTiers = Array.from(tierMap.values()).sort((a, b) =>
                    Number(a.interestRate - b.interestRate)
                  )
                  setTiers(updatedTiers)
                }
              }
            })
          },
          (depth) => {
            setCurrentDepth(depth)
          }
        )
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to find paths'))
      } finally {
        setIsLoading(false)
        setCurrentDepth(null)
      }
    }

    loadPaths()
  }, [borrowerAddress, enabled])

  return { data: tiers, isLoading, error, currentDepth }
}
