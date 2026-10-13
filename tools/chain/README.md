# Chog World on testnet

Chog World runs against a testnet copy of Chog Genesis on **Monad testnet** (chain 10143), so sign-in,
ownership and the sell-to-grey moment are real, but nothing costs money.

## Deployed

- Contract: `0x85a9ba85e5a3e87bab529c402140a87a72622b91` on Monad testnet (chain 10143)
- Explorer: https://testnet.monadexplorer.com/address/0x85a9ba85e5a3e87bab529c402140a87a72622b91
- Verified end to end on 2026-10-13: claim #42, transfer out (Transfer event seen), claimRandom x2, 4th claim refused.

## The contract (`ChogTestnet.sol`)

- Token ids match mainnet Chog Genesis (1 to 1969). Testnet token 42 shows mainnet Chog 42: same traits, same art.
- `claim(id)` takes a specific Chog, `claimRandom()` takes a random free one. Three per wallet.
- `tokensOf(address)` lists a wallet's Chogs in one free read (for the sign-in screen).
- Standard ERC-721 `Transfer` events. When a Chog leaves a wallet, the app greys it out.
- `tokenURI(id)` is `https://chog-world.vercel.app/meta/<id>.json`. The files come from `tools/traits/build_kit.py`
  (they land in `../chog-data/meta/`; copy them to `public/meta/`).

## Steps

```
cd tools/chain
npm install
node compile.mjs          # build/ChogTestnet.json
node deploy.mjs key       # makes a throwaway deployer key in ~/.chog_testnet_key, prints its address
# fund that address with testnet MON from the Monad faucet
node deploy.mjs           # deploys, writes build/deployment.json
node smoke.mjs 42         # claim #42, send it away, confirm the Transfer event
```

## In the app

- **Sign in:** connect a wallet, switch it to Monad testnet (chain id 10143, RPC `https://testnet-rpc.monad.xyz`),
  have the user sign a message (no gas), then read `tokensOf(address)`.
- **Traits:** look the id up in `chogs.json` (from `tools/traits`). No IPFS calls at runtime.
- **Live:** before waking a Chog, check `ownerOf(id) == user`.
- **Sale:** watch `Transfer(from = user)` on the contract (poll `getLogs` every few seconds). When it fires,
  play the grey-out cutscene and sign the user out.
- **Guest mode:** if the wallet has no Chog, offer "Claim a Chog" (`claimRandom`, needs a little testnet MON)
  or a demo Chog with a "Simulate sale" button.
