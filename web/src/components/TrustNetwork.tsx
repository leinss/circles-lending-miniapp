import { useState, useEffect } from 'react'
import { Sdk } from '@aboutcircles/sdk'
import { useWallet } from '../contexts/WalletContext.tsx'
import { useContractRead } from '../hooks/useContractRead.ts'
import { MODULE_ADDRESS, SAFE_ABI, CIRCLES_SDK_CONFIG } from '../config/constants.ts'

interface TrustConnection {
  address: string
  name?: string
  image?: string
}

export function TrustNetwork() {
  const { address } = useWallet()
  const [connections, setConnections] = useState<TrustConnection[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!address) return

    const loadNetwork = async () => {
      try {
        const sdk = new Sdk(CIRCLES_SDK_CONFIG)

        // Get all trust relations
        const relations = await sdk.data.getTrustRelations(address)

        // Filter for mutual trust only
        const mutualTrust = relations.filter((rel: any) => rel.relation === 'mutuallyTrusts')

        // Get the other address in each relation
        const uniqueAddresses = mutualTrust.map((rel: any) =>
          rel.subjectAvatar === address ? rel.objectAvatar : rel.subjectAvatar
        )

        // Fetch profiles for each
        const connectionData = await Promise.all(
          uniqueAddresses.map(async (addr) => {
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
              return {
                address: addr,
              }
            } catch {
              return {
                address: addr,
              }
            }
          })
        )

        setConnections(connectionData)
      } catch (err) {
        console.error('Failed to load trust network:', err)
      } finally {
        setLoading(false)
      }
    }

    loadNetwork()
  }, [address])

  if (!address) return null
  if (loading) {
    return (
      <div className="bg-white p-6 rounded-lg shadow-md">
        <h2 className="text-xl font-bold mb-4">Trust Network</h2>
        <p className="text-gray-500">Loading your network...</p>
      </div>
    )
  }

  if (connections.length === 0) {
    return (
      <div className="bg-white p-6 rounded-lg shadow-md">
        <h2 className="text-xl font-bold mb-4">Trust Network</h2>
        <p className="text-gray-500">No mutual trust connections found</p>
      </div>
    )
  }

  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      <h2 className="text-xl font-bold mb-4">Trust Network</h2>
      <p className="text-sm text-gray-600 mb-6">
        {connections.length} mutual trust connection{connections.length !== 1 ? 's' : ''}
      </p>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {connections.map((conn) => (
          <ConnectionCard key={conn.address} connection={conn} />
        ))}
      </div>
    </div>
  )
}

function ConnectionCard({ connection }: { connection: TrustConnection }) {
  const { data: hasModule } = useContractRead({
    address: connection.address as `0x${string}`,
    abi: SAFE_ABI,
    functionName: 'isModuleEnabled',
    args: [MODULE_ADDRESS as `0x${string}`],
  })

  const enabled = !!hasModule

  return (
    <div
      className={`p-4 border rounded-lg transition-all ${
        enabled ? 'opacity-100' : 'opacity-30 grayscale'
      }`}
    >
      {connection.image ? (
        <img
          src={connection.image}
          alt={connection.name || 'Avatar'}
          className="w-16 h-16 rounded-full mx-auto mb-2"
        />
      ) : (
        <div className="w-16 h-16 rounded-full bg-gray-200 mx-auto mb-2" />
      )}

      {connection.name && (
        <p className="text-sm font-medium text-center mb-1">{connection.name}</p>
      )}

      {connection.address && (
        <p className="text-xs text-gray-500 text-center font-mono">
          {connection.address.slice(0, 6)}...{connection.address.slice(-4)}
        </p>
      )}

      <div className="mt-2 text-center">
        {enabled ? (
          <span className="text-xs text-green-600 font-semibold">Module</span>
        ) : (
          <span className="text-xs text-gray-400">No module</span>
        )}
      </div>
    </div>
  )
}
