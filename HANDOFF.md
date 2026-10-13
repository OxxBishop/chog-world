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

### 2026-10-13 · C
- Added `TASKS.md` and this file. Agent A was already partway through A1 and A5 when the board started.
- Testnet contract deployed and tested on-chain: claim, transfer with its `Transfer` event, `claimRandom`, and the 3-per-wallet limit.
- First Tripo model (a singing Chog) came without a rig: the export had no skeleton, and the stage disc and mic stand are fused into the mesh. The user is re-exporting it with the rig, without the stage, and holding just the mic. When it arrives it goes to `public/models/` for A5.
