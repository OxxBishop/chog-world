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

### 2026-10-14 · A (A6, A7)
- **A6 done:** the sale cutscene (`playGreyOut` in `src/cutscenes.js`). The Chog turns to face you, goes grey from the feet up, walks off fading, then `world.enterSpace({ from: room, duration: 5 })`, then "Your Chog has moved on." It always ends back at the overview, signed out.
- **A7 done:** login and logoff.
  - Wake: the Chog wakes on its bed, hops down, waves, with a burst of twinkles in its aura colour. Its shaders and its home room are compiled before the view goes in (`world.prewarm` in `src/main.js`), so the wake doesn't stall.
  - Sign out: takes you home first if you're elsewhere, the Chog waves ("See you soon"), then `world.enterSpace({ from: room, duration: 4 })`, then the overview.
- **For B7:** both cutscenes await `world.enterSpace(...)` from the session world object in `src/main.js` (now `async () => {}`). When `src/space.js` lands, swap the stub for the real `enterSpace`. The session calls `world.leaveToOverview()` straight after, so `leaveSpace()` can go in there.
- Captions (`#story`) now sit on a soft glass panel so they read over bright rooms.
- **Test:** `npm run dev`, `?q=low`, Try a demo Chog, then Sign out, or Simulate sale.
- **Next:** A9 (bar chats with `chogsChat`), then A5 when models land.

### 2026-10-14 · A (A8)
- **A8 done:** chat with your Chog (`src/chat.js`, wired in `src/session.js`).
  - Open it from Talk on the chip, or by tapping the Chog.
  - Calls `talk({ id, session, text, place })`, where place is "at home in its dome", "in the Lobby" and so on.
  - The reply shows in the panel and in a speech bubble over the Chog. `chog.setMood(mood)` plays a move and a badge.
  - The mood map is `MOODS` in `src/traitmap.js`. Each mood has a face morph target name for the rigged models (Happy, Excited, ...).
- Notes when the brain says `newKeeper` or `learned`. Errors show in the chat, and a 503 reads "resting".
- Markup: `#chat` and `#chog-bubble` in `index.html`. Styles in the "Chat with your Chog (A8)" block of `src/style.css`. One line in `src/main.js` `onTap` checks for a tap on the Chog first.
- **Test:** `BRAIN_MOCK=1 npm run dev`, then `?q=low`, Try a demo Chog, Talk.
- **Next in order:** A6/A7 with B7's `enterSpace` (stubbed in `src/main.js`), then A5 when models land, then A9.

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
