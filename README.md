# Circles Lending Mini App (Raila)

Peer-to-peer uncollateralized lending using the Circles trust graph. Borrow, lend, or relay loans through trusted connections.

Runs as a [CirclesMiniapps](https://circles.gnosis.io/miniapps) mini app inside an iframe host — wallet connectivity is provided via postMessage bridge, not an injected provider.

## Original Repository

Forked and ported from [leinss/raila-circles](https://github.com/leinss/raila-circles) — the original standalone React app using Wagmi for wallet connectivity.

### What changed from the original

- **Wagmi removed** — replaced with a thin abstraction layer (`miniapp-sdk.ts`, `WalletContext.tsx`, `useContractRead.ts`, `useSendTransaction.ts`) that uses viem for encoding and the miniapp-sdk postMessage protocol for transaction submission
- **Batched transactions** — approve + repay are now sent as a single `sendTransactions()` call (one confirmation instead of two)
- **Circles SDK RPC** — overridden to use `staging.circlesubi.network`
- **Build output** — `base: './'` in vite config for relative asset paths (deployable to any path)
- **Onboarding** — simplified to Raila-specific instructions (removed Rabby/WalletConnect setup steps)

## Structure

```
contracts/          Foundry project — RailaModule Solidity contracts
  src/              RailaModule.sol — the Safe module
  scripts/          Deployment script
  test/             Foundry tests
web/                Vite + React 19 frontend
  src/
    lib/            miniapp-sdk.ts (postMessage bridge to host)
    contexts/       WalletContext (replaces Wagmi provider)
    hooks/          useContractRead, useSendTransaction, useLendingPaths, useRepayPaths
    components/     UI components (Borrow, Debts, Settings, TrustNetwork)
    utils/          BFS pathfinding (lending) and DFS pathfinding (repay)
    config/         Contract addresses and ABIs
```

## Deployed Contract

- **RailaModule:** `0xB877459e28ae22B6CE214a3af7b3dcEC96fB8ca4` on Gnosis Chain (100)
- **Token:** USDC.e (`0x2a22f9c3b484c3629090FeED35F17Ff8F88f76F0`)
- **Circles Hub:** `0xc12C1E50ABB450d6205Ea2C3Fa861b3B834d13e8`

## Development

### Frontend

```bash
cd web
npm install
npm run dev       # dev server at localhost:5173
npm run build     # production build to dist/
```

### Contracts

```bash
cd contracts

# Install Foundry dependencies
forge install safe-global/safe-smart-account --no-commit
forge install foundry-rs/forge-std --no-commit

# Run tests
forge test -vvv

# Deploy new instance
source .env  # needs PRIVATE_KEY and ETHERSCAN_KEY
forge script scripts/DeployRaila.s.sol:DeployRaila \
  --rpc-url https://rpc.gnosischain.com \
  --private-key $PRIVATE_KEY \
  --broadcast \
  --verify \
  --etherscan-api-key $ETHERSCAN_KEY \
  --chain-id 100
```

## Deployment

Built frontend is deployed to GitHub Pages and registered in the CirclesMiniapps host via `miniapps.json`.

### GitHub Pages setup

```bash
# Build produces web/dist/ with relative paths (base: './')
cd web && npm run build

# Deploy dist/ to gh-pages branch
```

### Register in CirclesMiniapps

Add to `CirclesMiniapps/static/miniapps.json`:

```json
{
  "slug": "raila",
  "name": "Raila Lending",
  "logo": "",
  "url": "https://leinss.github.io/circles-lending-miniapp/",
  "description": "Peer-to-peer uncollateralized lending using the Circles trust graph.",
  "tags": ["lending", "defi"]
}
```

## Architecture

The miniapp runs in an iframe hosted by CirclesMiniapps at `circles.gnosis.io/miniapps/raila`. The host provides:

1. **Wallet address** via `wallet_connected` postMessage events
2. **Transaction submission** via `send_transactions` — the host shows an approval popup, executes the UserOp through the Safe, and returns tx hashes
3. **Message signing** via `sign_message`

The app uses viem's `publicClient` for all read operations (multicall, readContract) and viem's `encodeFunctionData` to prepare calldata for writes. No gas estimation or nonce management needed — the host handles that.
