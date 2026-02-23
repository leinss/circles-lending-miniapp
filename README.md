# Circles Lending Mini App

Peer-to-peer uncollateralized lending using the Circles trust graph. Borrow, lend, or relay loans through trusted connections.

Works in two modes:

- **Embedded** — runs as a [CirclesMiniapps](https://circles.gnosis.io/miniapps) mini app inside an iframe host; wallet connectivity via postMessage bridge
- **Standalone** — opened directly in a browser; connects via injected wallet (MetaMask etc.)

## Original Repository

Ported from [greenlucid/raila-circles](https://github.com/greenlucid/raila-circles), adapted to run as a CirclesMiniapps mini app (Wagmi replaced with postMessage bridge, standalone injected-provider fallback added).

### What changed from the original

- **Wagmi removed** — replaced with a thin abstraction layer (`miniapp-sdk.ts`, `WalletContext.tsx`, `useContractRead.ts`, `useSendTransaction.ts`) that uses viem for encoding and the miniapp-sdk postMessage protocol for transaction submission
- **Dual-mode wallet** — `miniapp-sdk.ts` detects `window.parent === window` to choose between iframe postMessage bridge and injected provider (`window.ethereum`), so the app works both embedded and standalone
- **Batched transactions** — approve + repay are now sent as a single `sendTransactions()` call (one confirmation instead of two)
- **Circles SDK RPC** — overridden to use `staging.circlesubi.network`
- **Build output** — `base: './'` in vite config for relative asset paths (deployable to any path)
- **Onboarding** — simplified to lending-specific instructions (removed Rabby/WalletConnect setup steps)

## Structure

```
contracts/          Foundry project — RailaModule Solidity contracts
  src/              RailaModule.sol — the Safe module
  scripts/          Deployment script
  test/             Foundry tests
web/                Vite + React 19 frontend
  src/
    lib/            miniapp-sdk.ts (postMessage bridge + injected provider fallback)
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

## Standalone Mode

When the app is opened directly in a browser (not inside the CirclesMiniapps iframe), it automatically switches to **standalone mode**:

- Detects standalone via `window.parent === window`
- Connects through `window.ethereum` (MetaMask, Rabby, etc.)
- Looks up Safes owned by the connected EOA via the Safe Transaction Service API
- If the EOA owns multiple Safes, a dropdown lets the user switch between them
- Transactions route through Safe's `execTransaction` using a `v=1` owner-signature (single wallet popup per action — no separate signing step)

This lets developers test without the CirclesMiniapps host and allows users to access the app as a regular dApp.

## Deployment

The frontend is deployed to **GitHub Pages** via a GitHub Actions workflow (`.github/workflows/deploy.yml`). Every push to `main` triggers an automatic deploy. Manual deploys can be triggered via `workflow_dispatch` in the GitHub Actions UI.

1. `npm ci && npm run build` in `web/`
2. Upload `web/dist/` as a Pages artifact
3. Deploy to GitHub Pages

**URLs:**
- `https://leinss.xyz/circles-lending-miniapp/`

### Register in CirclesMiniapps

Add to `CirclesMiniapps/static/miniapps.json`:

```json
{
  "slug": "lending",
  "name": "Circles Lending",
  "logo": "",
  "url": "https://leinss.xyz/circles-lending-miniapp/",
  "description": "Peer-to-peer uncollateralized lending using the Circles trust graph.",
  "tags": ["lending", "defi"]
}
```

## Architecture

The miniapp runs in an iframe hosted by CirclesMiniapps at `circles.gnosis.io/miniapps/lending`. The host provides:

1. **Wallet address** via `wallet_connected` postMessage events
2. **Transaction submission** via `send_transactions` — the host shows an approval popup, executes the UserOp through the Safe, and returns tx hashes
3. **Message signing** via `sign_message`

The app uses viem's `publicClient` for all read operations (multicall, readContract) and viem's `encodeFunctionData` to prepare calldata for writes. No gas estimation or nonce management needed — the host handles that.

In standalone mode, these same functions route through `window.ethereum` instead (see [Standalone Mode](#standalone-mode)).
