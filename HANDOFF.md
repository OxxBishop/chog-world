# Handoff log

Newest entries go at the top. Each entry: date, agent, what changed, how to see it, what is left or broken.
Read `TASKS.md` first.

## Project in one paragraph

Chog World is a Chogathon 2026 entry: a shared 3D island world where your Chog NFT comes alive, learns
you, and goes grey and wanders off as an NPC when you sell it (`docs/` and the concept doc have the full
idea). Three.js + Vite, deployed on Vercel at https://chog-world.vercel.app. On-chain parts run on
**Monad testnet** (chain 10143) against a testnet copy of Chog Genesis, so sign-in, ownership and the sale
are real but free.

## Facts every agent needs

- **Testnet Chog contract:** `0x85a9ba85e5a3e87bab529c402140a87a72622b91`. ABI in `tools/chain/build/ChogTestnet.json`; how it works is in `tools/chain/README.md`.
  - Token ids 1 to 1969 match mainnet Chog Genesis.
  - `claim(id)`, `claimRandom()` (3 per wallet), `tokensOf(address)`, standard `Transfer` events.
- **Trait data:** `public/data/chogs.json` (every token's traits and art) and `public/meta/<id>.json` (tokenURI files). Regenerate them with `tools/traits/`.
- **Performance:** the user's laptop has an Intel HD 520. Test with `?q=low` and read `?debug` for fps, draw calls and toggles. Judges will have faster machines, but it must stay usable on that laptop.
- **3D Chogs:** the user makes them in Tripo and auto-rigs them there. C preps each one and drops it into `public/models/`. Don't hand-model or repaint Chogs in code; the user rejected that look.
- **Rules:**
  - Bot Crossing is a reference for cosy feel only. Never copy its assets, signs or name.
  - CC0 assets only (KayKit, Kenney).
  - Commits authored as OxxBishop, no trailers.
  - Public copy: no em dashes.

## Log

### 2026-10-13 · B · B2 load time (done, needs a timing check on the HD 520)
- The world now opens without the clouds. Their pass joins the post chain held off; once the world is showing they download, build their shaders in the background and fade in over 2.5 s. If they fail twice, the world carries on without them.
- The sky's light used to be computed on the GPU at every load (the biggest cost). It now ships as `public/assets/volclouds/atmosphere/*.exr`, precomputed by `@takram/three-atmosphere` 0.19.1 for its default atmosphere, which is the one we use.
- New `src/loader.js`: the loading bar (real progress over downloads, build, shaders, first frames) and `prewarm()`, which runs one frame with nothing drawn and compiles every shader it would need in the background. After it, the first real frame and the clouds' first frame compile nothing (checked with `renderer.info.programs`).
- Downloads (models, kits, sign font) now run at once. `vercel.json` (new, root) caches `/assets/` in the browser for a day, then serves it stale while it refreshes.
- Shared files: `src/main.js` (the load part of `init()` only), `index.html` (one bar element in `#loading`), `src/style.css` (an "Agent B: the loading bar" block at the end).
- How to check: open the site and read the console line `Load times (s): {...}`; `total` is the time to the first frame, and `Load: clouds at ...` follows when they arrive.
- Measured in headless Chrome on a software GPU, production build: first frame about 14 s, down from about 70 s. Most of what is left there is the software GPU drawing frames. At 3x slower CPU (standing in for the laptop): downloads and parsing 3.7 s, island build 5.5 s.
- **Ask (dome.js, unowned):** the 15 domes each rebuild an identical lattice, joints and arch, which is about 60% of the island build (1.2 s here, 3.7 s at 3x CPU). Sharing that geometry across domes would bring the laptop comfortably under 10 s. B would like to take `src/dome.js` for that one change. Say yes here and B will do it.
- Known, not mine: entering a room for the first time still builds 2 or 3 shaders, because `interior.js` adds emissive maps on its first update indoors. The fade into the room hides it.

### 2026-10-13 · B · B1 plaza benches (done)
- Working on branch `claude/vigilant-cannon-uqurem` (the branch this session pushes to), not `main`. Merge it into `main` to pick these up.
- `src/plaza.js`: the fountain ring is now four pairs of benches on the diagonals with a lamp between the two benches of each pair, so the walks into the fountain from the lobby arch, the bridge and both sides stay clear. The two lone benches out on the plaza that faced the hub are gone.
- Each walk from the plaza out to a bridge now has benches in facing pairs either side of it, square to the walk, between its lamp posts. They sit on the grass at ground height and skip any spot that would touch another walk.
- See it: Chog Hub view, or `?view=ground`, and look down the walk toward the first neighbourhood's bridge.
- For A5: the open paving left and right of the fountain (toward the bar yard and the casino) is still free for the singer's stage and the gathered Chogs.
### 2026-10-14 · A
- **A1 to A4 done, A6 in, A5 slots in.** Commits 9d4285f, 0a15edc, 7a977ab, 2a8c1ba, 6a78fbf.
- **Sign in** (`src/chain.js`, `src/session.js`, panel in `index.html`, styles in the "Signing in" block of `src/style.css`):
  - finds wallets (EIP-6963, else `window.ethereum`), connects, switches to Monad Testnet and adds it if missing (chain 10143)
  - signs the free message (format unchanged for C's brain: "Sign in to Chog World", "Wallet: 0x...", "Issued: <ISO>")
  - reads `tokensOf`, shows a picker with the official art, checks `ownerOf`, and wakes the Chog in its home (dome by id, `homeFor` in `src/chogdata.js`)
  - viem loads only on connect (190 KB chunk)
- **Session object** for `brain.js`: `{ address, wallet, provider, message, signature }`, or `{ demo: true }` for the demo Chog (#43). `window.chogWorld.session` in dev.
- **Sale listener:** `getLogs` for `Transfer(from = user)` every 3 s, plus an `ownerOf` check every 30 s.
- **Guest:** Claim a Chog (`claimRandom`, faucet link) and Try a demo Chog with Simulate sale.
- **Sale cutscene** (`src/cutscenes.js`, `playGreyOut`): turn to camera, drain from the feet up, walk off fading, `world.enterSpace({ from, duration })`, fade to "Your Chog has moved on.", back to the overview signed out.
  - **B:** `enterSpace` is a stub in `src/main.js` (the session's `world` object). Plug `src/space.js` in there.
- **Chogs** (`src/chog.js`, `src/traitmap.js`): every trait value has a model slot under `public/models/chogs/`.
  - **C:** add each file's path to `READY` in `traitmap.js` when it lands. Expected rig and clip names are in its header.
  - Until then a Chog is a standee: a card of its official art (no code-modelled Chogs).
- **NPC slots** (`src/npcs.js`): singer and crowd in the plaza, sniffer on the tree island, runner with a toy block on the beacon island. Hidden until models are in `READY`; `?npcs` previews them.
- **Outside my files:** `src/island.js` returns `plaza: plaza.group` (one line, for the NPC stage). `package.json` has viem (a512297).
- **Test:** `?q=low`, Sign in. Without a wallet use Try a demo Chog, then Simulate sale.
- **Next:** A8, chat with your Chog (brain.js).

### 2026-10-14 · C · Chog brain (C5)
- **New endpoints:**
  - `api/chat`: talk to your Chog.
  - `api/chogchat`: two Chogs meet.
  - Both run on Claude Haiku 5.5 with structured replies.
- **Client:** `src/brain.js` (`talk`, `chogsChat`). A: use it for A8 and A9. Pass your session (`{ address, message, signature }`) or `{ demo: true }`.
- **Personality:** from each Chog's traits, plus a stable quirk, favourite spot and pastime.
- **Memory:**
  - The Chog's own life is kept per token.
  - The keeper's details are kept per token and keeper, and wiped when the Chog shows up with a new keeper.
- **Security:** the sign-in signature, its age and live testnet ownership are checked on every call. There are rate limits and a global hourly cap.
- **Local dev:** `npm run dev` now serves `/api/*` through `vite.config.js`. Use `BRAIN_MOCK=1` in `.env` for canned replies without a key.
- **Tests:** `node tools/brain/test.mjs` passes 17 of 17 in mock mode.
- **Not live yet:** needs `ANTHROPIC_API_KEY` and Upstash Redis in Vercel. Setup steps are in `tools/brain/README.md`.

### 2026-10-13 · C
- Added `TASKS.md` and this file. Agent A was already partway through A1 and A5 when the board started.
- Testnet contract deployed and tested on-chain: claim, transfer with its `Transfer` event, `claimRandom`, and the 3-per-wallet limit.
- First Tripo model (a singing Chog) came without a rig: the export had no skeleton, and the stage disc and mic stand are fused into the mesh. The user is re-exporting it with the rig, without the stage, and holding just the mic. When it arrives it goes to `public/models/` for A5.
