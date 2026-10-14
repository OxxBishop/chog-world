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

### 2026-10-14 · C · B7 to B11 merged into main; timed on the HD 520
- Merged `claude/vigilant-cannon-uqurem` (B7 space, dome frame sharing, B9 load time, B10 room entries, B11 intro and arrival). One conflict in `src/main.js` (A's stub against B's real `enterSpace`/`intro`): kept B's, with A's `warmUp` as `prewarm` (the same function). Builds clean, no console errors.
- **HD 520, production build, fresh browser profile:**
  - Repeat visit: first frame 13.3 s (download 0.6, build 1.8, shaders 4.0, frames 5.9). Clouds in 1 s later.
  - First visit after shader changes: 57 s, of which 47 s is the Intel driver compiling D3D shaders on the first draw.
- **The user's "clouds took 3 minutes" is fixed by B9.** On the live build the clouds decoded the 4 MB sky tables in script; here they arrive 1 to 10 s after the first frame.
- **Checked in the browser:** the loading screen (glitch title, block bar, "Connect wallet to begin" over the space view), guest entry, and the bar entry and exit through the doors. All work.
- **B, the problem left:** on the HD 520 the first bar entry runs at 1 to 5 fps (HUD) while the room's shaders build, and about 10 fps inside. A cutscene that stutters reads as broken. Please compile every interior at load (behind the loading screen), and check the light count indoors. Also: jagged shadow stair-steps on the hall doors as you pass them.

### 2026-10-14 · C · Back to `main` (the `dev` branch is gone)
- The user changed their mind: push straight to `main` as before. Each push goes live on chog-world.vercel.app within a minute, so only push what you have seen running.
- `dev` has been deleted. If you switched to it, run `git checkout main && git pull --rebase`.
- B: merge `main` into your branch again (`git pull --rebase=merges origin main`). Your branch keeps its own preview link on every push.

### 2026-10-14 · A → B · APIs for B10/A10 and B11/A11, built and tested on A's side (B: reply here, the user relays)
**A10, walking in (B10 calls these on `session`, the object `initSession` returns):**
- `const walk = session.walkIn(room, door, { delay })`. Call it **at the cut into the room, in the same frame**, so the room never shows your Chog already placed.
  - `room` is an `island.rooms` entry. `door` is a world-space `THREE.Vector3` on the floor just inside the doorway (omit it for the room's front door).
  - `delay` (seconds) is how long the reveal runs before the Chog steps in.
  - The Chog fades in at the door, walks to its spot and turns to the camera. In the bar it stands where it chats; the regular partner is already in place during the reveal.
- `await walk` resolves when it's standing and facing you. It resolves at once for guests or with no Chog.
- `walk.skip()` puts it there now (tap or Esc).
- `await session.walkOut(room, door)`: it turns, walks to the door and fades out. Then play the reverse move. It goes home on its own when the room is left.
- Rooms entered any other way (Places menu, `?view=`) behave as now.

**A11, the intro (B11 gives A an `intro` object; A drives it):** pass it in as `initSession({ ..., intro })`, or later with `session.setIntro(intro)`.
- `intro.state(name, data)`. A calls it with:
  - `'wallets'` `{ wallets: [{ name, icon }], pick(i) }`: only if the browser has more than one wallet.
  - `'nowallet'` `{}`: no wallet in this browser. Keep the guest and demo buttons.
  - `'connect'` `{ wallet }`: waiting on the wallet's connect and network prompts.
  - `'sign'` `{}`: waiting on the free signature.
  - `'searching'` `{ address }`: the running pixel Chog, until `tokensOf` answers.
  - `'pick'` `{ chogs: [{ id, name, image }], pick(id) }`: only if the wallet holds more than one.
  - `'welcome'` `{ id, name, image }`: the glitch "Welcome, <name>".
  - `'none'` `{ address, claimsLeft, faucetUrl, claim(), demo() }`: no Chog in the wallet.
  - `'claiming'` `{}`: waiting on the claim transaction, then `'searching'` again.
  - `'error'` `{ message, retry() }`: a cancel or a failure. Show it with a way back.
- `await intro.flyHome(room)`: the arrival flight, resolving when the camera is in the home pod. A then plays the spawn: sparkle, the Chog steps out, turns to the camera and says hello in a bubble (the brain's answer to "Hi, I'm here!", or a canned line within 4 s).
- `intro.done()`: A calls it once the hello has landed, so the screen can tidy up.
- **B's buttons call A:** `session.connect()` (Connect wallet) and `session.demo()` (Try a demo Chog: #43 gets the same welcome, flight and hello). "Explore as a guest" is all B's: close the screen. Guests sign in later with the Sign in button, which opens A's panel as before (the Chog wakes on its bed there).
- **Tested on A's side** with stand-ins for B's camera and screen and for the testnet RPC: walk into the bar (the regular waits, the chat starts once your Chog is in place), the lobby, `skip()`, `walkOut`; a demo arrival; a wallet with two Chogs (`pick`); an empty wallet (`none`, then the demo); a brain hello and a canned hello. Your Chog appears at `POD` in its home (`src/cutscenes.js`) and steps out to `SPOT`, so end the flight looking at that end of the room.

### 2026-10-14 · A (A5: the singer)
- **The singer is in** (`src/npcs.js`). C's `models/npcs/singer.glb` loads for the singer slot, at plaza (27, 30) on the paving. It faces out over the plaza, between the fountain and the downtown walk, and doesn't turn. The stage and mic stand are part of the model.
- It plays a set on a loop: eight bars of `Sing` (19.2 s), `Cheer` (2.66 s), `Idle` (4 s), crossfading. Its shaders are compiled before it appears (`warmUp` in `src/main.js`, shared with the session).
- **Outdoor characters are 1.7x** (`OUTDOOR` in `src/npcs.js`), the same as the plaza's benches and lamps (`BENCH_SCALE`), so they sit right beside them. The rooms stay life size.
- **Each character shows once it has a model:** a slot's own `glb`, or the trait models (`READY`). The crowd, sniffer and runner stay hidden until then. `?npcs` still previews every slot with standees.
- **For C, next models:** a slot can take its own file the way the singer does (`NPC_SLOTS.<slot>.glb`, clips named as in `CLIPS`). The crowd ring is 5.5 m before the 1.7x scale (about 9.4 m after); check it clears the lamp at plaza (33, 25) when the crowd lands.
- **See it:** the Downtown view, or `?view=downtown`, and look to the right of the fountain toward the casino.

### 2026-10-14 · B · B11 loading screen and arrival flight (done; A, see A11 below)
- **The first screen** (new `src/intro.js`, markup in `index.html` so it shows from the first paint, styles in my block at the end of `src/style.css`): pixel type (Press Start 2P and Pixelify Sans, OFL, self-hosted in `public/fonts/`), scanlines with a rolling band, RGB split and glitch slices on the title, a chunky block bar on the real load progress. "Welcome to Chog World" while it loads; then the screen dims over the world seen from space and asks "Connect wallet to begin", with "Explore as a guest" under it.
- **The running Chog:** a Chog's official art, pixelated in the browser into a little round token, hopping round a track with a shadow and dust. While searching it flicks to another Chog's face every lap; once found it is yours.
- **The arrival** (new `src/arrival.js`): from space, down through the clouds over your Chog's island, along its dome, in through the glass at the middle of a lattice triangle over the door (no strut crosses the lens), and down to the walk in front of the pod, looking at its door. About 6 s, then the camera is handed back to the rig, inside the dome.
- **Home pods now have a real door** (`src/dome.js`): the pod's door panel is cut out, two panels hang on hinges, and a short warm hall runs back to the home room's own door (the same `hingedLeaf` and `vestibule` as the Hub, exported from `src/hub.js`). So your Chog can step out of it.
- **Until A11 lands** the screen works on its own: Connect closes it and opens the current sign-in panel (over space), and a guest is flown back down to the overview. A link to a view, a shot or space (`?view=`, `?demo=`, `?space`) skips it, and so does `?nointro`.
- **A, for A11:** the world object your session gets has `world.intro`:
  - `intro.state(name, data)`, with name one of:
    - `'connect'`, `{ wallets: [{ name, icon, pick() }], guest(), text }`: one pixel button per wallet (or a single Connect wallet button calling `data.connect()`), the guest link, an optional note.
    - `'step'`, `{ title, text }`: a step that waits on the wallet ("Approve in your wallet").
    - `'searching'`, `{ text }`: the running Chog, until `tokensOf` answers.
    - `'found'`, `{ name, image }`: "Welcome, <name>" with a glitch burst, and the runner showing that Chog's face.
    - `'none'`, `{ claim(), guest(), text }` and `'error'`, `{ text, retry(), guest() }`.
  - `intro.flyHome(room)` (room: the home, as `world.homes[i]`): tears the screen away and flies. It resolves with `{ door, rest }` once the camera is settled. `door.position` is the middle of the pod door's sill, `door.inside` a spot just behind it in the hall (where your Chog can appear, with the wake sparkle), `door.outward` the way out, and `door.open(k)` (0 shut, 1 open) swings its panels. Open it, walk your Chog out a couple of metres, turn it to the camera, say hello. The camera is free again by then.
  - `intro.close()` just tears it away (resolves when gone); `intro.open` says whether it is up.
  - Hand the screen over from the start: define `session.startIntro(intro)` and `src/main.js` calls it once the world has loaded, instead of its default connect screen. Signing in again later (the HUD's Sign in): call `intro.state('connect', ...)` and `world.enterSpace()`; the screen comes back.
- **`src/main.js` (shared):** creates the intro and the arrival, `arrival.update(dt)` in `frame()`, `load.finish({ keep })` leaves the screen up, then space behind it and the default connect screen. Dev hooks: `chogWorld.intro`, `chogWorld.arrival`.
- **`src/loader.js`:** the bar fills by a CSS variable (`--p`) so the pixel bar can draw itself; `finish({ keep: true })` leaves the screen up.
- **Seen in the browser:** the load (desktop and phone), every state, guest back to the world, Connect to the sign-in panel, and the arrival into two domes at noon and golden hour. The 3D work compiles no new shaders.
- **Cost:** the 15 pods' doorways and halls add a little to the island's build (about 0.2 s here); worth a look in B9.

### 2026-10-14 · B · B10 room entry cutscenes (done; A, see A10 below)
- **The lobby and the bar are now walked into for real, no fade and no cut.** The Hub's pods had solid walls behind their doors and the bar had no doorway at all, so each now has one: a doorway carved through the KayKit shell (`carve` in `src/kaykit.js`, exact clipping), wooden double doors on hinges, and a short hall behind them back to the room's own door (`vestibule` in `src/hub.js`). The lobby's hall steps down three steps with its red runner carried on inside; the bar's front gets a dark wood door frame and a stone step. The halls glow warm from their lamps, more after dark.
- **New `src/entry.js`.** Picking Lobby or Bar on the Hub: the camera flies to the door, the doors swing open, it glides through, down the hall, and the room's own door swings open as it arrives. A sweep along the front of the room pans left to right across it and settles on the room's framed view. Back runs it the other way: out through both doors (they close behind), up and round to the Hub's view. A tap or Esc skips to the end.
  - Times: in, about 6 s from the Hub's view (more from far off, capped); out, about 5 s.
  - Homes, and entering from space, still fade (the B11 arrival takes over the home case).
  - No shader is built for it: everything is compiled with the world at load.
- **`src/interior.js` (small edit, not my file):** a room's door leaf now hangs on its own hinge, kept out of the merge so it can swing (`room.doorway.hinge`), and the room records its doorway (`room.doorway`).
- **`src/barchat.js` (one-line edit, A's file):** a bubble shows only once the camera is inside the bar (`bar.pod.inside(camera)`), since on the way in the regulars are already talking behind the walls.
- **`src/main.js` (shared):** `entry` created after the island, `entry.update(dt)` after `space.update()`, `entry.apply(env, renderer)` after `island.update`, the lens follows `entry.fov()` while it plays, `enterRoom` and Back use it, and `currentRoom()` reports the room being entered for the whole way in (so the bar's regulars are there, done appearing, as the camera arrives). Dev hooks: `chogWorld.enterRoom(id)`, `chogWorld.back()`, `chogWorld.entry`.
- **A, for A10 (your Chog walking in):** after the sweep, `entry.js` calls `session.walkIn(room, door)` if you define it.
  - `door = { position, inward, width, height, room }`: the middle of the room's doorway on the floor (world), and the direction into the room.
  - Return a Promise that resolves once your Chog is at its spot. Set `promise.chog` to the Chog's root Object3D and the camera follows it in (it turns to the door first, then tracks it, for up to 6 s). `promise.skip?.()` is called if the user skips: put the Chog at its spot at once.
  - The room's door is open when walkIn is called and closes once your promise resolves.
  - On leaving, `session.walkOut(room, door)` is called (no need to return anything); the camera then flies out on its own.
  - Guests: define `session.focusIn(room)` returning a world point (the regulars' middle, say) and the view pans to it at the end; without it the sweep is the ending.
- **A, small:** entering a room still builds 4 shaders the first time (a Lambert with two maps, two custom ShaderMaterials and a sprite: your Chog standees and bubbles, I think). `world.prewarm(group)` (in `initSession`'s world) compiles them ahead.
- **See it:** pick the Chog Hub, then Lobby or Bar; Back to come out. `?hour=19.5` for dusk.

### 2026-10-14 · C · The user's notes: room entries, the loading screen, and how the video gets made
- **Room entries (bar, casino, lobby) are poorly done:** "it just fades in black and skips to the interior". The user wants a proper in-world move: through the door, a mini cutscene of the interior, then a pan to the Chog walking in. Now **B10** (camera, doors, reveal) and **A10** (`session.walkIn`). It is the user's first priority after B7.
- **Loading screen:** the user wants a glitchy, pixelated screen: "welcome to the chog world, connect wallet to begin", a cool loader (a Chog circling in place until a Chog is found in the wallet), "welcome", then a mini cutscene of the island with your Chog spawning in a pod in its dome and saying hello to the camera. Now **B11** (screen and flight, B owns it) and **A11** (sign-in states, spawn, hello). Keep "Explore as a guest": judges may have no testnet Chog.
- **Models:** C sent the user a traits pack (`Downloads/chog-traits`) so they can generate a clean picture of each trait and turn it into a model in Tripo. Base first, then heads and accessories as separate rigid pieces, and outfits as retextures of the one rigged base. Models land in `public/models/` as they come.
- **The video (C4, C7):** shots are captured from the live app, frame by frame, then cut with ffmpeg. Capture runs anywhere: B's cloud session needs no laptop but renders slowly on a software GPU; the laptop renders fast when it's on.

### 2026-10-14 · B · B9 load time, round 2 (done; C, please re-time it on the HD 520)
- **What changed, measured** (production build from localhost, headless Chrome with the CPU slowed 3x, three runs each):

  | | Before B9 | After |
  |---|---|---|
  | Download step | 3.8 to 5.5 s | 0.85 s |
  | Build step | 5.5 s (3.2 s with the shared dome frame) | 2.85 s |
  | Requests before the first frame | 327 | 30 |
  | Bytes before the first frame | about 11.5 MB | 3.7 MB |
  | Texture decodes | 185 (of 17 images) | 16 |
  | Shader programs at the first frame | 88 | 60 |
  | Main thread frozen as the clouds arrive (EXR decode) | 850 ms | 105 ms |

- **Model packs** (`scripts/pack-models.mjs`, `npm run pack-models`): the nature, KayKit and furniture models load from `src/packs/{nature,kaykit,furniture}.glb`, one file per kit, geometry compressed (meshopt) and each texture stored once. The three textures over 1024 are halved. Bark and mushroom simplification moved there from the browser. `src/assets.js` turns the packed geometry back into plain floats in the model's own space, so nothing downstream sees a difference. Before and after screenshots of every view match.
  - **Anyone adding a name to `MODELS`, `HUB_KIT`, `LANDMARK_KIT` or `FURNITURE_KIT`:** run `npm run pack-models` and commit `src/packs/`. Until then, that model loads from its loose file, with a console warning. The loose files in `public/assets/` stay, as the packs' source and the fallback.
  - The packs' file names carry a content hash, and the page preloads them (`preloadPacks` in `vite.config.js`, build only), so they download alongside the script.
- **Shaders:** the rooms were compiled before the sky had baked its light into the scene, which gave nearly every material a second, unlit variant (22 programs). Now the dry run goes first (`src/main.js`, two lines). The far dome glass shares the near glass's program.
- **Fonts:** Fredoka and Figtree are served from `public/fonts/` (OFL, licences there), with `@font-face` in my block at the end of `src/style.css`. They're preloaded in `index.html` in place of the Google Fonts stylesheet, which used to hold up the scripts until it arrived.
- **Clouds:** the sky's light tables were EXR files decoded in script on the main thread, just as the world first appears. They now ship packed (`scripts/pack-clouds.mjs`, `npm run pack-clouds`; only needed if `@takram/three-atmosphere` changes them), and the browser inflates them natively. Each cloud texture is uploaded one per frame, before the first cloud draw.
- **Dome frame:** struts and joints are baked straight into one buffer (half the frame's build time).
- **`vercel.json`:** `/fonts/` and `/art/` are cached for a week (C asked for `/art/`).
- **New dev dependencies** (the pack scripts only, nothing in the bundle): `@gltf-transform/core`, `extensions` and `functions`, `sharp`.
- **C, to time it:** same way as before. Fresh profile, `?debug` off, read `Load times (s)` in the console. I estimate around 10 s on a first visit, but I can't run the HD 520 here. Please also try the cold driver cache case: fewer programs should cut its 46 s `frames` step by about a third.
- **Left, not in my files** (the build step's biggest costs at 3x, and the remaining shader variants):
  - `terrain.js` about 1 s; `interior.js` builds all 15 home rooms at load, about 0.3 s, and could build each on first entry; `trees.js` bake 0.37 s; `layout.js` `roadDistance` 0.3 s; `underside.js` 0.25 s.
  - One-off Standard programs: the `underside.js` glow (flatShading), the `interior.js` lamp shade (DoubleSide), the furniture's emissiveMap, a transparent material with a map and an emissiveMap in the rooms. Each is a whole extra program to compile.
  - Since the merge of today's `main`, entering a home compiles 2 or 3 programs on first entry, and the bar one more (A's new Chog and bar code).

### 2026-10-14 · C · The singer, rigged and animated (for A5)
- **File:** `public/models/npcs/singer.glb` (1.9 MB). The user's Tripo singer, rigged by C (`tools/models/rig_singer.py`, Blender 5.2).
- **What's in it:** one skinned mesh with its own stage (radius 1.88 m, top at 0.25 m) and mic stand, both pinned to the `Root` bone. Origin is the stage's bottom centre, facing +z. The Chog is 2.2 m tall, standing on the stage top.
- **Bones:** Root, Hips, Spine, Chest, Neck, Head, UpperArm/ForeArm/Hand L and R, Thigh/Shin/Foot L and R. `Head`, `Spine` and `HandR` match `ATTACH`.
- **Clips (names match `CLIPS`):** `Idle` (4 s), `Sing` (2.4 s, a 100 BPM bar: body sway, knee dip on the beat, head nods) and `Cheer` (1.33 s, bigger bounce). All three loop. The left hand stays on the stand's mic throughout.
- **A, to wire it (A5):**
  - Set `NPC_SLOTS.singer.glb = 'models/npcs/singer.glb'` and load that file for the slot instead of the trait-built Chog.
  - Drop the code `stage()` for it, and place the model at plaza y 0, not 0.4.
  - **Don't spin it:** the stage and stand are part of the model. Face it toward the main approach, and let the crowd do the turning.
- **Why no Wave and no big arm moves:** Tripo fused the mic hand to the chin and the forearms to the belly, so a big arm swing stretches skin (checked in renders). The clips keep the arms in their sculpted pose and perform with the hips, knees, chest and head.

### 2026-10-14 · C · A6, A7, A9 reviewed; Chog art now ships with the site
- Reviewed A6 (sale cutscene), A7 (login and logoff) and A9 (bar chats). No bugs found. Bar chats checked in the dev server with `BRAIN_MOCK=1`: #87 and #130 take the counter and trade lines.
- **Why the art change:** on this network all three IPFS gateways (Filebase, ipfs.io, dweb.link) were failing, so the bar stayed empty (A9 waits for art, correctly) and every card showed only a name. A judge on a strict network would see the same.
- **Self-hosted art:** `public/art/<id>.webp`, 384 px, about 23 KB each against 277 KB from IPFS, made by `tools/traits/build_art.py` (cached originals in `../chog-data/img`, so a rerun only fetches what is missing).
- **A, one line in your `src/chogdata.js`:** `chogInfo().images` now starts with `${BASE}art/<id>.webp`, then the IPFS copies as before. The standee and the card fallbacks already walk that list, so nothing else changed.
- **Not finished:** 34 of 1969 are built so far; the gateways keep dropping on this network. Until the rest are in, those Chogs fall back to IPFS as before. Anyone on a good connection can finish it: `python tools/traits/build_art.py`, then commit `public/art/`.
- **B (B9):** please add `/art/(.*)` to the cache rule in `vercel.json`; each file never changes.
- **A, small polish for later:** in the bar on a wide screen, the left Chog stands behind a chair back, mid-room rather than at the counter (`LAYOUTS.wide.a`).

### 2026-10-14 · A (A9)
- **A9 done:** Chogs chatting at the bar (`src/barchat.js`, driven from `src/session.js`).
  - Two Chogs stand together in the bar and talk a line at a time, in speech bubbles. Each line's mood plays on the Chog (badge plus a move; new `talk` act on the standee, `Talk` clip slot in `CLIPS`).
  - Scenes come from `chogsChat({ a, b, place: 'the bar in the Chog Hub' })`, cached per pair in the page.
  - Guests: the regulars #87 and #892 (they face right in their art) chat with #130 and #1517 (they face left), so each pair looks at each other. The pair rotates after each scene.
  - Signed in: your Chog comes along to the bar (it's moved into the bar room) and chats with a regular, on the side it faces. It goes home when you leave the bar, sign out or sell.
  - Brain down (503 or offline): one request, then four spare scenes rotate. Busy (429): spares, and it asks again next scene.
  - The first pair's art is fetched 12 s after load, so the bar opens with them already there (first line in about 2 s).
- Where they stand: two layouts picked by a raycast search for clear view of the bar camera (`LAYOUTS` in `src/barchat.js`). `wide` for landscape; `tall` for portrait phones, further back so both fit. It switches if the screen turns.
- **Chog art is sturdier (all Chogs, not just the bar):** `chogInfo` returns `images` with backup IPFS gateways (ipfs.io, dweb.link). `makeChog` tries them in turn. A card shows the Chog's name until the art arrives, or for good if it never does, so no card is ever blank. The wake waits up to 8 s for the art. Picker and chip thumbnails fall back too (`artFallbacks`).
- Speech bubbles (both the chat and the bar) stay inside the screen edges: `placeBubble` in `src/chat.js`.
- **Test:** `BRAIN_MOCK=1 npm run dev`, `?q=low`, open the Chog Hub and go into the Bar. Then Try a demo Chog, and go to the Bar again.
- Test hooks: `chogWorld.session.bar.cast`, `.speaking`, `.layouts`.
- **Next for A:** A5 is blocked on the models. When C adds paths to `READY` in `src/traitmap.js`, the NPCs and every Chog switch from standees to models with no other change.

### 2026-10-14 · B · Load time follow-up: domes share their frame (done)
- `src/dome.js` (unowned; the user said to go ahead): the lattice, joints, entrance arches, glass, plinth and sign strip are the same shape in every dome, so `domeFrame()` builds them once and all 15 domes share the geometry, each with its own materials. Before and after screenshots match.
- Island build: 2.3 s to 1.2 s in headless Chrome; 5.5 s to 3.4 s at 3x slower CPU. With downloads and parsing (3.6 s at 3x) and shaders (0.6 s), the CPU side of the first frame is now about 7.6 s at 3x, plus network and the real GPU's first frames.
- Still worth a check on the HD 520: the console line `Load times (s): {...}`.

### 2026-10-14 · B · B7 the world seen from space (done)
- New `src/space.js`. The sky, clouds and sea fade to a violet void with a nebula and stars; the islands float as a diorama, softly lit at any hour (lilac moonlight at night), on a slow orbit that fits any screen.
- **A:** `world.enterSpace({ from, duration })` is live (the stub is gone). From a room it dips out to just beyond the dome, pulls out, and resolves once settled. Tested end to end with Try a demo Chog, then Simulate sale.
- **A, for the sign-in backdrop:** in `session.js` `open()` call `world.enterSpace({ duration: 2.5 })`, and in `close()` call `world.leaveSpace({ duration: 2 })` (flies back). Signing in needs nothing: `enterRoom` and `leaveToOverview` in `main.js` now leave space under their own fade. Tested with the panel over space, then Try a demo Chog.
- Grey Chogs: space shows the live world, so any grey Chogs you put out wandering appear in it. At this distance one is a few pixels.
- No shader rebuilds on the way in or out (checked: program count unchanged through a whole sale). The clouds stop drawing while in space (`clouds.setAway`), so it is cheap on the HD 520.
- See it: `?space`, or `?space&hour=22`.
- Shared file: `src/main.js` (create `space`, two calls in `frame()`, `enterSpace`/`leaveSpace` in the world object, `space.leave()` in `leaveToOverview` and `enterRoom`, `?space`).

### 2026-10-14 · C · B1 to B5 reviewed and merged into main; B2 timed on the HD 520
- Merged `claude/vigilant-cannon-uqurem` into `main` (clean, builds). Reviewed the code and checked the plaza, lobby and opening flight in the browser. No changes needed.
- **B, yes to `src/dome.js`.** It and `src/flight.js` are now in your ownership row. Your branch stays the way you work: keep merging `main` into it and C merges it back (rule 7 in `TASKS.md`).
- **B2 on the real HD 520** (Chrome, ANGLE on D3D11, production build served locally, fresh browser profile each run, 1366 x 768):

  | Build | First frame | Steps (s) |
  |---|---|---|
  | `main` before B2 | 51.5 s | |
  | B2, first visit | 19 to 25 s | download 8 to 13, build 3.7 to 4.4, shaders 4.2, frames 2.2 to 3.5 |
  | B2, repeat visit | 13 s | download 3.4, build 3.5, shaders 3.8, frames 2.3 |
  | B2, first visit with the graphics driver's own shader cache cold too | 68 s | frames 46 |

- Reading it:
  - The download step is mostly the CPU parsing and decoding about 150 glTF files and 131 textures, not the network: from localhost the files all land between 3.6 s and 5.3 s, and the step still runs to 8 to 13 s.
  - The 68 s case is the Intel driver compiling D3D shaders on the first real draw, which `compileAsync` does not reach on ANGLE. It happens once per machine, so a judge on a fresh laptop could see it. Fewer distinct materials and shaders is the only lever there.
  - After the first frame there is one hitch of 0.6 to 1.1 s as the clouds come in, then it is smooth.
- **New task B9 (order 4, after B7):** load time round 2. Ideas in order of payoff: the shared dome lattice; fewer, lighter model files (merge the nature and furniture kits into a few GLBs, shrink the textures); self-host the two Google fonts (their stylesheet blocks the scripts until it arrives, which hurts on a slow connection).
- To time it the same way: `?debug` off, fresh profile, read `Load times (s)` in the console.

### 2026-10-14 · B · B5 opening flight (done)
- `?demo=opening`: the opening shot, 32 s at 17:30 with the interface hidden. In from the south over the clouds, low over the first neighbourhood's domes, across the bridge, up the walk to the fountain and the gold dome, then a rising pull back to the whole archipelago. It waits for the clouds to fade in, flies once, and holds the last frame.
- For recording (C4, C7): `window.chogDemo.duration`, `chogDemo.at(s)` (pose any second and stop), `chogDemo.play(s)` (fly on from s). Works in production too.
- New file `src/flight.js` (B). **C:** please add it to B's row in the ownership table. Shots live in `SHOTS` as data: keyframe times, camera positions, look points, an hour. Adding a shot for C4 is a few lines; ask me or add it there. The pace follows the distance flown, so speed stays smooth between keys of any length.
- Shared files: `src/main.js` (`startDemo()` and one line in `frame()`), `src/style.css` ("Agent B: demo flights" block).

### 2026-10-14 · B · B4 cloud grain (done)
- Cause: the deck is ray-marched a sixteenth of the pixels per frame with a blue-noise jitter, and each pixel keeps the one sample it last got. Even fully settled that leaves a fine salt-and-pepper grain, most visible in the overview. The drifting puffs were already smooth.
- Fix in `src/volclouds.js`: the composite reads the deck through a small tent filter (four bilinear taps over 3 x 3 texels). Grain gone, heap shapes kept, no halo at island rims. Cost is three extra texture reads per pixel.
- See it: the overview with the camera still, at any `?q=`.
- Not changed: the dome glass sparkles from afar. That is the glass and lattice in `dome.js`, not the clouds.

### 2026-10-14 · B · B3 lobby facade (done)
- `src/hub.js`: the lobby pod has sand plaster walls, wood frames and side panels, and a gold dome (the dome's faces come away whole into the gold material). The tubes to the wings match the walls.
- Entrance: the pod's door is raised 3 m, so there are now stone steps up to it with a red runner down them and out to the arch, wooden double doors with brass handles, a warm transom, and a wall lantern either side. Lanterns and transom brighten at night.
- `src/plaza.js`: two more planters, either side of the steps (`island.js` fills them with flowers like the others).
- `src/kaykit.js`: `repaint()` takes an optional `isRoof(normal, height, cell)` to choose which faces leave for the roof material. The default is unchanged, so the bar and casino look the same.
- See it: Chog Hub view, or `?hour=19` for the lanterns.

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
