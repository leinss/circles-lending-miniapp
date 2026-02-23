## Raila Lending Module (Solidity)

Safe module enabling P2P uncollateralized lending on Gnosis Chain using the Circles trust graph.

### Deployed

- **Contract:** `0xB877459e28ae22B6CE214a3af7b3dcEC96fB8ca4`
- **Chain:** Gnosis Chain (100)
- **Token:** USDC.e (`0x2a22f9c3b484c3629090FeED35F17Ff8F88f76F0`)
- **Circles Hub:** `0xc12C1E50ABB450d6205Ea2C3Fa861b3B834d13e8`

### Deploy new instance

```bash
# Install dependencies
forge install safe-global/safe-smart-account --no-commit
forge install foundry-rs/forge-std --no-commit

# Remap (already in foundry.toml libs)
# Then deploy:
source .env

forge script scripts/DeployRaila.s.sol:DeployRaila \
  --rpc-url https://rpc.gnosischain.com \
  --private-key $PRIVATE_KEY \
  --broadcast \
  --verify \
  --etherscan-api-key $ETHERSCAN_KEY \
  --chain-id 100
```

### Test

```bash
forge test -vvv
```
