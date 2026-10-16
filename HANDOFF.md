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

### 2026-10-16 · A · Sharper Chogs (KTX2 at 2048), the picked shadows and crowd, B's pad lines in
- **The cast's colour maps are 2048 now, as KTX2** (A14; the user: "scuffed and low res"). Built from the
  2048 originals in git in each model's current layout (`tools/models/fix/upres.py`), keeping every colour
  fix; then `tools/models/fix/ktx2.mjs` (KTX-Software's toktx, installed on the laptop): colour,
  normal and metal-roughness ETC1S, mipmapped. Face sheets too (`public/faces/<name>.ktx2`, stored
  flipped; the PNGs stay as the fallback).
  - Sharpness: 4x the texels on every Chog; against the 2048 source the shipped 1024 JPEG scored 32.1 dB,
    the KTX2 36.8 dB.
  - GPU memory: the cast's textures about 200 MB to about 93 MB after a full tour (they stay compressed,
    BC7 on the HD 520). Download: the 14 files 12 to 13 MB.
  - `src/chog.js` loads them with three's KTX2Loader (`setChogRenderer` from `src/main.js`; the transcoder
    is in `public/basis/`). **Tool pages:** any GLTFLoader that reads `public/models/npcs/` needs
    `withKtx2(loader)` from `/src/chog.js` (done in every page in `tools/models/`). The fix pipeline still
    starts from the git originals; the JPEG files of this morning are only in A's scratchpad.
  - Stalls: a tour as a guest with the old JPEGs had frames up to 1.1 s and one of 5.1 s as sets came in;
    with KTX2 none over 500 ms.
- **Shadows under the Chogs: the user's pick, the soft shadow from the sun** (on by default;
  `?chogshadow=round|off` to compare). **The singer's crowd: the user's pick, three of the cast join in**
  (Snooze, Toasty, Patrol; `?crowd=plain|skins` to compare).
- **B's travel.js lines are in** (pads are ground at their top, the gate's warm-up, the beam direction):
  a Chog stands at 30.66 m on the plaza pad, the pad's top. **B: `src/fx/teleport.js` can go to main.**
- **A17** (earning $CHOG, the billboard, the balance, tipping the singer, the astronaut, the biker, the
  dino's blocks) **moves to the new B** (the user). A keeps polishing the Chogs and the world.

### 2026-10-16 · A · The picked walks, King Pom's spike, and the audit (A13, A14 in progress)
The user now gives A the Chogs, the island, animations and per-Chog behaviours. Casino, loading screen,
effects, cutscenes and the teleport stay with the other session.
- **Walking is the user's pick:** card 3 on the walks page, the cartoon walk (`WalkCartoon`), and card 4
  for running, the cartoon jog (`JogCartoon`), for every walking Chog (all 11 files in `public/models/npcs/`
  but the singer, dino and sniffer). They play at the page's rates (1.7x, 1.3x; `CLIP_RATE` in
  `src/traitmap.js`) and **move at the speed their feet cover** (the user said yes to that): Monty
  walks about 1.0 m/s and runs 1.8, King Pom 0.5 and 0.75. Before: 3.6 and 7.2 for everyone, feet sliding.
  - `chog.speedOf()` measures the picked clips with `sweepSpeed()` (each foot's backward sweep over the
    time it sweeps). The old measure missed most of each step on these rolling feet. Monty's walk measures
    0.341, the walks page's own 0.336.
  - `src/travel.js` takes its walk and run speeds from your Chog. A door or your home's door opens when
    you walk into it at the new speeds.
  - A model without the clips (the dino) keeps its own `Walk`/`Run` (`CLIP_FALLBACK`).
- **King Pom's lowest spike** (the user: "the bottom one is overextended"): Tripo had skinned the bottom
  of his mane to his upper arms, so the 1.45x longer arms (10-15) pushed that spike down into a long
  wedge, and every arm move swung it. The mane is back where Tripo had it and off the arm bones;
  his arms stay long (`tools/models/fix/mane.py`). Checked front, side, back, idle, walk, wave.
- **Hands out of robes** (the user: King Pom's "hands keep entering their cloak"): his hands sank into the
  robe in Idle, Talk and the walk; Quackers' into the duck float; Cosmo's into the suit. Their clips are
  rebaked with the arms held a little out and forward (`tools/models/handcheck.html` measures it; the
  other eight measured clean).
- **The sky** draws after the islands now (`src/sky.js`, one line): its shader was shading the whole
  screen under everything, 12.5 ms of a 46 ms frame on the HD 520. Plaza 21.6 to 28 fps, a
  neighbourhood 29, looking up at open sky 23. Same picture.
- **Measured on the user's laptop (HD 520, 10-16), for every agent:** first visit 65.6 s to the connect
  screen (37 s of it building shaders), repeat 17 s; in the world 20 to 23 fps, the GPU 46.5 ms a
  frame at the plaza: clouds about 13, materials about 17, geometry about 11, the whole cast about 1.
  GPU textures 320 MB at the connect screen, 460 after a tour (the cast about 200 of that).
- **Looks waiting on the user's pick** (page: https://claude.ai/artifact/KPaoqjSLmw6oMeFSFamCtR):
  ground shadows under the Chogs, `?chogshadow=round` or `sun` (`groundShadow()` in `src/chog.js`;
  `setChogSun()` from `src/main.js` each frame), and the singer's crowd, `?crowd=skins` or `cast`
  (`src/npcs.js`). Both off by default.
- **For B (found, not touched):** walking back out of the bar froze the page 4.6 and 6.6 s (twice).
  The room walk-ins in `src/cutscenes.js` (`walkMs`, 2.4 m/s) now outpace the cartoon walk; use
  `chog.speedOf('walk')` if you want their feet to land.
- **Next (A):** the 2048 colour maps as KTX2 (built, `upres.py`; waiting on KTX-Software, the user is
  installing it), Chogs that walk through benches, shadows that follow the Chogs (looks to pick), the
  island's cost on the HD 520.

### 2026-10-16 · B · The casino's controls: the user picked "Chips in hand" (build it next)
- The user asked whether the three CSS looks (pixel, lounge, neon) were the best I could do. They weren't: all three were the same boxy panel in new colours. I drew three new directions over stills of the real game: https://claude.ai/artifact/5hoKcbpCVyXFZeFjJ1Jfd3. **The user picked A, "Chips in hand".**
  - The mockup's source is `wip/b/casino-ui/index.html` on branch `claude/vigilant-cannon-uqurem`. Its CSS (`.chip`, `.a-*`, `.badge`) is a good start for the real thing.
  - Drop the three looks behind `?czui` and the edges card (`.cz-edgecard`): A replaces them.
- **What A is** (build it in `src/casino.js` and the casino section of `src/style.css`, in place of the panel, at the roulette and the slots):
  - **No panel.** The 3D table and reels stay in clear view. Reframe the table and slots views to the centre, since there is no right-hand panel to leave room for any more.
  - **A rack of real chips along the bottom centre:** 5, 10, 25, 50, 100, round with striped edges in the game's colours. The chip you hold lifts with a white glow. At the roulette you pick a chip and tap the felt (tapping the felt already works); at the slots the chip you hold is the bet.
    - Show a soft glow on the felt where a chip will land, under the pointer or finger.
    - Holding a bet takes a chip off, as now.
  - **Your chips:** a big gold count to the left of the rack. "On the felt N" is a small pill above it.
  - **To the right of the rack:** Undo and Clear as small round icon keys, and SPIN as a big round domed coral button in a gold ring (104 px on a laptop, 82 px on a phone). Rebet can be a long press on SPIN, or a third small key.
  - **Your Chog's edges:** a row of round gold badges at the top left, under its portrait and name ("6 edges at the roulette").
    - Each badge has an icon and a short name, plus a pink count of what's left today (on a phone, the icons only).
    - A used one greys out. Tapping one shows a short tip (name, one line, "1 left today").
    - **A badge glows the moment it fires:** Second sight saving a losing spin, Red giving a bet back, a wild spin, a nudge. The user's ask was to see your Chog's advantages, so this matters.
  - At the slots the free and wild spins are gold tokens above the rack.
  - Phone layout: badges across the top under the HUD; your chips and SPIN in one row above the rack; the rack spread full width.
  - Everything needs real interaction states (hover, press, disabled while the wheel turns, focus) and has to work by touch and mouse. Sizes are in the mockup.
- **Also from this session** (details in the entries below): the swirl gate waits on A's travel.js lines; the walk-in works but its last fixes are untested; the lobby light is unverified.

### 2026-10-16 · B · Later the same day: the swirl gate picked, a pad fix for A, the walk-in and the casino looks tested
Read this with the "Session wrap" entry below. The work is on branch `claude/vigilant-cannon-uqurem`, latest commit `647b6db`.
- **The portal trip: the user picked the swirl gate** (pick page: https://claude.ai/artifact/Ah9DMMBDZsQ3yhLnYy4KBf). On the branch, `src/fx/teleport.js` uses the gate by default. Star and bubble remain behind `?portal=star|bubble` until someone deletes them.
- **For A: Chogs stand inside a portal pad, not on it** (the user: "the chogs keep entering the portal circle instead of standing on it").
  - The cause: travel's `groundAt` knows islands and bridges, but not the pads. A pad's top is `0.27 * SCALE` (0.46 m) above the ground, so after any snap to the ground your Chog stands sunk into it.
  - The fix is ready in `src/travel.js` on the branch, 15 lines: a pad counts as ground at its top, with an eased step at its edge so you still walk on and off (`PAD_TOP`, `PAD_OUT`).
    - The patch also has `world.prewarm?.(teleportFx.warmTrips(scene))`, which draws the gate in the load (B12).
    - And the beam-direction fix: `setBeam(…, 1)` in three places.
  - Tested on the plaza pad: your Chog stands at 30.66 m (the pad's top) and the ground beside it is 30.20 m. It walks off and back on (the portal menu comes up), and the gate trip runs and lands on the far pad.
  - The user said B should leave travel.js to A for now. **A: please apply those lines.** After that, `src/fx/teleport.js` can go to main.
  - Don't ship teleport.js without the warm-up line: the gate would build its shaders on the first trip.
- **The walk-in, tested in the casino on the laptop** (shots in B's scratchpad, not kept).
  - It works. Your Chog comes down to room size on the approach, and on screen you can't see it happen. The camera follows it through both doors, the casino opens up past its head, and the camera comes round to the room's view.
  - Out works too: the camera follows behind into daylight, and travel takes over.
  - Fixed since the test, not yet retested:
    - Your Chog now ends at A's room spot (`spotIn`). It used to stand so close to the room's view that it was cut off at the frame's edge.
    - In the hall the camera eases toward the middle, away from the wall lamps that swelled past it.
  - Still to test: the bar and the lobby, a phone, your own Chog, and skipping.
- **The casino looks, captured on the laptop** at the roulette and the slots: the room's own look plus pixel, lounge and neon (`wip/b/czui.mjs`). All four render and the edges card works.
  - Fixed after the shots:
    - Pixel's buttons and SPIN ran off its panel.
    - Lounge's edge names were cream on cream.
    - The card covered the roulette wheel's rim. It is now 222 px wide.
  - On the phone the card is a strip of perk chips under the top bar, and it works in all four looks.
  - Some phone panels came out half-drawn while the camera was still moving. Re-shoot with a longer wait (20 s is too short at 1 fps). Then build the pick page, recommend one, and wait for the pick.
- **The lobby light** on the branch is 5x stronger, still unverified.

### 2026-10-16 · B · Session wrap: the pixel loader, and everything in flight (next B: read this first)

**This commit: the loading screen's Chog, drawn natively.** The user on the sprite-strip version: "you implemented that loading icon in all the wrong ways possible. looks like a slapped on png that's being manually rotated. just use it as reference as to how i want it to look. and it's way too big". Now:
- `src/pixelloader.js`: a pixel Chog hand drawn from the user's sheet (spiky violet mane, lilac rim, cream dome face, dot eyes, blush, mouth), hopping clockwise round a ring of twelve square dots. The dots it has just passed light up white, then lilac, then fade. Little four-point sparkles twinkle in its wake. Everything sits on one pixel grid (52 art pixels square), a whole number of device pixels to each, so it is crisp at any DPR. The Chog moves a pixel at a time and is never rotated or scaled. To change the look, edit `SPRITE` (one character per pixel) and `PAL`.
- About 88 CSS px across: 104 px on a 1x laptop, 78 px at 2x, 87 px on a 3x phone (`startLoader` in `src/intro.js`). The old one was 192 px.
- It draws in a worker (`src/pixelloader.worker.js`, OffscreenCanvas), so it keeps moving while the load blocks the main thread. Without OffscreenCanvas it draws on the main thread.
- The user's sheet is reference only and does not ship. `public/art/chog-loader.webp` is deleted.
- Not yet seen by the user. Over the bright planet the unlit dots read darker than the ground. If the user minds, try a faint dark halo behind the ring (ask first: it's a look).

**Pushed today, all on main** (newest first):
- `a4ad80d`: the casino fixes from the user's test.
  - Bets come off: Undo, and hold a bet to take a chip off. The − and + are labelled Chip.
  - The table holds still: the idle camera turn is off in rooms.
  - Chips and coins never sink.
  - Phones draw at 2x, and the casino's textures are doubled.
- `f60267f`, `6d518ae`, `10154d4`: the iPhone black-frame flicker on the entry page. NaN guards in the shaders, a finite-pixel guard in the bloom (`?nobloom` to tell), no blur layers over the live planet. **The user confirmed it's fixed.** The planet also turns visibly now.
- `fc9fc16`: a guest's dive keeps the world's controls hidden until it lands.
- `0b0e299`: B25, the planet, warp speed and the dazed wake-up.

**Skills installed this session** (project skills in `.claude/skills/<name>/SKILL.md`). Each one is written from the user's skill list: none of the names on that list exist in a catalog. The rest of the list covers A's or C's areas.
- `skybox-and-space-shot-generation`: how space is built (planet, cosmos, warp), the purple rules, framing a planet shot.
- `volumetric-clouds-and-vfx`: the cloud and effect conventions.
- `webgl-webgpu-shader-authoring`: shader rules, including the NaN guards that fixed the iPhone flicker (pow of a negative base, normalize of zero, Apple fast math).
- `fixing-motion-performance`: no long frames, warm-ups, the HD 520.
- `js-canvas-performance-profiler`: how to profile, read `?debug`, and hold the clock in tests.
- `js-timeline-and-easing-orchestrator`: cutscene timing and easing.
- `ai-cinema-director`: camera language for cutscenes.
- The user also says they gave "a plethora of UI skills" so the casino would not get "this default ui claude always uses". Treat bespoke UI as a hard requirement.

**CLAUDE.md** (unchanged this session). What the user pushed hardest on:
- **No creative direction without their pick.** They warned about this sternly, over the loading screen ("this is you taking creative directions again"). For a look, a camera move or a Chog's behaviour: show options with visuals, recommend one, wait. Bug fixes that restore intended behaviour don't need asking.
- Their standard: "if you're gonna do something then make it the best looking thing in existence". Use it on a phone and the laptop, by touch and mouse, before pushing.
- Commits are authored as OxxBishop (`317957607+OxxBishop@users.noreply.github.com`) with no trailers. Never use the user's personal email: it leaked into `21ed3a1`, which can't be rewritten. Never commit `planetlab.html`.

**Work in progress, NOT on main.** It is on branch `claude/vigilant-cannon-uqurem`, one commit on top of this one. Bring the files over with `git checkout origin/claude/vigilant-cannon-uqurem -- <paths>`. Test scripts and tools are in that branch's `wip/b/`. Nothing in it is verified enough for main.
1. **Your Chog walks into the room, the camera behind it** (the user: "the chogs should be the one entering the casino, not the camera. or rather, they go in with the camera following in behind"). Files: `src/entry.js` (`walkIn`, `walkOut`, `flightIn`, `followPose`, `course`) and `src/main.js` (`enterRoom` passes travel's Chog as `walker`).
   - The first test found two faults:
     - Out walking, the Chog is 5.0 m tall (travel's `SCALE` 1.7). The casino's outside door is 4.55 m and its room door only 3.36 m, so the camera, kept above the Chog's head, went into the wall over the door.
     - The Chog's head hid the doorway.
   - Rewritten since:
     - On the last steps to the door the Chog comes down to its room size (1). The camera's distance and height come down with it, so on screen it stays the same size and only the door grows.
     - The camera keeps under the hall's height, and comes down under the room's lower door only where it passes it.
     - It sits a little to the side, so the doorway shows past the head.
     - Once the Chog stops, the camera flies under the room door to the room's view, and the Chog turns to face it.
     - Out is the same, backwards: it grows back to 1.7 once the camera is outside, a few steps out, and travel takes over.
   - **Untested since the rewrite.** Test with `wip/b/walkdbg.mjs` (it logs the camera, Chog, scale and FOV, and takes shots). It needs a temporary `get _dbg() { return run; }` on entry's api. Check:
     - all three rooms;
     - your own Chog and a guest;
     - tap or Esc to skip;
     - walking back out;
     - phone and laptop.
2. **Your Chog's edges beside the table** (the user: "as the user initiates the game, he sees his chog trait benefits at the side of the roulette table so he knows his advantages"). `src/casino.js`: a `.cz-edgecard` with the portrait, the name and that game's edges, shown while you sit at a game.
   - Laptop: on the left, centred. Phone: a strip under the top HUD, its chips scrolling sideways.
   - The edges list is out of the game panels (it's on the card). Unverified.
3. **The casino's controls, bespoke** (the user: "i hate how it looks"). Three looks are in `src/style.css` (the casino section) behind `?czui=pixel|lounge|neon`:
   - Pixel Arcade: the loading screen's look.
   - Atomic Lounge: the Starlite room's 1958, with chip buttons.
   - Neon Marquee: neon tubes on dark glass.
   - Next: capture them in-engine on a phone and the laptop, put them on one pick page with the portal trips, recommend one, and **wait for the pick**. Then drop the switch and keep that look only.
4. **B24 effects** (the user's picks; still `doing` on the board):
   - Stage LED floor and confetti (`src/fx/stagefx.js`, warmed in `src/npcs.js`): seen by day, not yet at night.
   - Lobby light shafts and dust (`src/fx/lobbyfx.js`, `src/hub.js`): built, but **not visible** in in-engine shots. The additive strengths (shafts 0.16, pools 0.3) are far too faint in the bright lobby. Boost, then check at 9, 16:48, 18:24 and 22:00 (`wip/b/lobbycap.mjs`).
   - Portal trip, three ways (`src/fx/teleport.js`, behind `?portal=gate|star|bubble`; `warmTrips` in `src/travel.js`):
     - All three are recorded in-engine: 143 frames each (`wip/b/portalcap.mjs`). The frames are too big to keep; re-record them.
     - The pick page is `wip/b/portal-pick/index.html`. Encode `gate.mp4`, `star.mp4` and `bubble.mp4` with ffmpeg (minterpolate to 30 fps), publish it, and wait for the user's pick.
   - For A (`src/travel.js`, a bug fix): the beam's arrival cut ran the wrong way. `setBeam(level, -1)` should be `setBeam(1.1 → 0, 1)`, in three places.
5. **The user's 10-16 casino test, item by item:**
   - Bets couldn't be reduced: done (`a4ad80d`).
   - "i hate how it looks": item 3.
   - The Chog walks in, the camera behind: item 1.
   - Trait benefits beside the table: item 2.
   - "the roulette table, slot machines and the entire casino looks low res. this even is a problem with the entire island": done in `a4ad80d` (2x on phones, sharper textures). Ask the user whether it's enough.
   - "the roulette table was spinning": done.
   - The loading screen ("a pixelated chog moving in circles like a cursor"): this commit.

**Testing notes:**
- SwiftShader runs about 1 fps here. To test, hold the clock: override `performance.now`, queue `requestAnimationFrame`, and call `chogWorld.frame()` step by step (see `walkdbg.mjs`).
- Editing `src` reloads every page on the dev server that serves it, so run long tests on a copy.
- `pkill -f` patterns must be anchored (`^node ...`), or they kill the calling shell.

### 2026-10-16 · B · The loading screen: the user's own pixel Chog sprite (replaced by the native pixel loader, above)
- The user's sprite sheet (eight frames: a pixel Chog going round a ring of dots that light up behind it) replaces the runner. Cut by `tools/sheet2strip.py` in B's scratchpad: black keyed out, every frame aligned and scaled by its own ring so the dots hold still, into `public/art/chog-loader.webp` (eight 384 px frames side by side).
- It plays as a CSS animation (a stepped transform, `.load-runner img` in `src/style.css`), so the compositor keeps it moving while the load blocks the main thread. The `<img>` is in `index.html`, so it loads with the page. `src/intro.js` only hides and shows it.

### 2026-10-16 · B · Casino fixes from the user's test; the world sharper on phones
- **Bets come off again:** Undo takes back the last chip you put down, and holding a bet takes a chip off it (read off the events' own times, so a hold counts even if the page was busy). The − and + are labelled Chip: they set the chip's size, never a bet.
- **The roulette table no longer turns round under you:** the camera's slow idle turn (meant for the island) carried on in the casino until you touched the 3D view, and tapping only the panel never stopped it. It's off in every room now (`src/camera.js`), and the casino's table views count as inside the room.
- **Chips and coins never sink:** chips land on their lowest edge however they're tilted, tip flat and slide to a stop, and can't fall through the carpet at any frame rate; the tray's coins rest on its floor the same way.
- **Sharper on phones** (the user: the casino and the whole island looked low-res): phones and tablets draw at 2x, not 1.5x (`BASE_DPR` in `src/main.js`), with their clouds at the pixel count they had (`clouds.setQuality(q, { pixelRatio })`); the roulette's layout and the reels' symbols at twice the resolution. In the casino the clouds stop drawing on every machine (no windows), which pays for it there.

### 2026-10-16 · B · The loading screen: a pixel Chog running in circles, not a bar (the user's pick)
- While the world loads, one pixel Chog runs round its little track (the wallet search's runner, one face, no swapping), the step and percentage under it. The bar is gone (`src/intro.js`, `index.html`); `src/loader.js` still writes the line of text.

### 2026-10-15 · B · The connect screen's flicker on phones fixed; the planet turns where you can see it
- **The flicker** (the user's iPhone recording: the whole planet blinking black for a frame, several times a second): one pixel's maths going NaN, which the bloom's blur spreads over the whole frame. Apple's GPUs give NaN where desktop ones don't, so it never showed on the laptop or in tests. Fixed at every source I could find:
  - `pow(x, k)` where x can dip below 0, even by a rounding error (`1.0 - dot(n, v)` for two unit vectors, `pow(x, 2.0)` of a signed value): clamped, or written as `x * x`. In the planet, the nebula, warp speed, the dome glass, the bridges' tunnel glass (`src/tunnels.js`, A's), the sea's fresnel (`src/sky.js`) and the aura ring (`src/chog.js`, A's).
  - The space rocks' facet normal, `normalize(cross(dFdx, dFdy))`, which is zero on a rock a pixel or two across: it faces the camera then. The atmosphere's normal through the planet's middle is guarded the same way.
  - **For everyone writing shaders:** never `pow` a base that can go negative, never normalize what can be zero. One bad pixel anywhere blacks out the frame on iPhones.
  - **And a safety net** (the user still saw it after the fixes above): the bloom now skips any pixel that isn't a finite number before it blurs (`src/post.js`, tested on the float's bits, which Apple's fast maths can't optimise away). A bad pixel stays one dark pixel, never a black frame. `?nobloom` leaves the bloom out entirely, to tell on a phone whether a flicker comes through it.
  - **And the other way Safari blanks a WebGL canvas for a frame:** layers over it that blur it (`backdrop-filter`) or repaint each frame. The entry page's buttons inherited the base button's `backdrop-filter: blur(8px)` (they don't need it: one is opaque, one has no background), now off; the rolling band moves by transform now (`.intro-band`), not by repainting the scanline layer.
- **The planet turns where you can see it** (the user: "the world should be rotating, a live look at the planet"): a turn about every three minutes, the clouds drifting over the land a little faster. Its clock starts as it comes into view.
- **The loading still fades into the live planet** (1.2 s) once it's painted and drawn, instead of switching at once. The stills (`public/art/planet.webp`, 21:9, and `planet-tall.webp`, a tall phone's) are renders of the app's own first frame, sized the way the lens is (a wide screen keeps the view's height, a tall one its width), so the two line up on any screen. The still is its own layer now, `.intro-still` in `#loading`; `intro.live()` fades it (`src/main.js` calls it once `space.ready` resolves).
- **A guest's dive** from the planet keeps the world's controls hidden until it lands (`src/session.js`, A's: `close({ keepHud: true })`, then `revealHud()`).

### 2026-10-15 · B · B25 Chog World, the planet; warp speed; waking up in your dome (done)
- **Space is a planet now, not the floating islands.** It's the user's pick, look A, "amethyst" (`src/planet.js`): Earth-shaped but purple, with violet and lilac land, violet seas, pink lagoons, white clouds, a violet sky round the rim, a magenta dusk, city lights on the night side, a faint ring and a lilac moon.
  - Its surface is painted on the GPU at load, in tiles (B12), into two maps: 4096 wide, or 2048 on the light look and on phones.
  - `?planet=bloom` and `?planet=dusk` show the two looks it was picked from.
- **The space round it** (`src/cosmos.js`), all in the purple:
  - a nebula sky painted once into a cube map (a violet band, a rose cloud, a teal wisp, dark dust lanes)
  - thousands of stars, five dwarf stars with glints
  - four constellations: the Crown, the Die, the Lucky Coin and the Ladle
  - a belt of tumbling rocks and amethyst shards round the planet, with lilac dust
- **Easter egg:** every minute or two, about fifty stars swim together into a smiling Chog. It has the spiky fur all round its head, happy closed eyes with lashes, blush, an open smile and the gold mark on its forehead. It traces itself in lines, holds, and drifts apart. `?chogstars` makes it come within seconds.
- **The world isn't drawn out there:** the camera sees render layer 1 only, and only space is on it.
- **Warp speed** (`src/warp.js`, `src/space.js`):
  - **Out** (a sale, signing out, Sign in): the view tilts up and launches. Streaks, a flash, the violet tunnel, then a drop out of warp into orbit. From inside a room it dips out to beyond the dome first.
  - **In** (a guest, `leaveSpace`): a lunge at the planet, streaks and a pink glow of entry, white, then the world.
  - Under reduced motion both are fades. The lens is the warp's while it runs: `space.fov()`, one line in `src/main.js`.
- **The arrival, as the user described it:**
  1. The planet is behind the loading screen: a still (`public/art/planet.webp`, `planet-tall.webp`), then the live planet behind the connect screen.
  2. Once you pick (a Chog in the wallet, or the demo Chog): "WELCOME TO CHOG WORLD, <NAME> IS WAITING FOR YOU".
  3. The screen tears away and you dive into the planet. White, then blank.
  4. You wake up dazed, lying on the grass in your Chog's dome (`arrival.wake(room)` in `src/arrival.js`). Your eyes open a slit on the glass overhead, blink, open; everything swims and blurs.
  5. You sit up, woozy, to face your Chog's door.
  6. A's `playArrival` then brings your Chog out to wave.
- **For A:**
  - `intro.flyHome(room)` still resolves with `{ door, rest }` and your `playArrival` runs unchanged; checked with the demo Chog ("There you are! Welcome home.").
  - `enterSpace({ from, duration })` and `leaveSpace({ duration })` keep their meaning.
  - New: `space.ready` (the load waits for the paint), `space.dive()`.
- **B12:**
  - The planet, the sky, the debris, the warp and the eyelids are all drawn in the load. The warp is drawn separately: `drawOnce(space.warp.group, ...)`.
  - The stall check is clean through the connect screen, the demo arrival and the guest descent.
  - If a slow machine is still painting when the load ends, the sky and the planet fade in once done, never half-painted.
- **Skills (the user asked):** six project skills in `.claude/skills/`, written from what works in this codebase:
  - webgl-webgpu-shader-authoring
  - skybox-and-space-shot-generation
  - js-timeline-and-easing-orchestrator
  - js-canvas-performance-profiler
  - ai-cinema-director
  - volumetric-clouds-and-vfx

  The other 18 on the user's list were for rigging, physics, modelling and video, which are A's and C's areas or not used here.
- **Left:** B24 (the effects A wired hooks for) is next.

### 2026-10-15 · A · The cast's models redone (the user's notes): skin, colours, clips
- **No more T-pose:** every Chog that stood "idle" was in a T-pose (Tripo's Idle clip was one, and a bug in `src/chog.js` meant no idle ever played anyway: the state started as 'idle', so the first `play('idle')` did nothing). Idle and Talk are now real animations, retargeted from the Quaternius Universal Animation Library (CC0) onto the Chog rig (`tools/models/retarget.js`, baked into each GLB). Walk, Run, Wave and Cheer are still Tripo's until the user picks a walk.
- **Skin:** Tripo's weights tore at the shoulders when an arm came down (the shark's "things behind its arms", the King's sleeves). New weights round the shoulders and inside each arm's volume, Tripo's elsewhere, so an arm never drags a head, chest or robe (an all-new skin did, and folded King Pom's head).
- **Colours:** the light pink on hands and feet only (the user: not the whole arm or leg), on the purple Chogs (plain, Monty, Quackers, the singer). Atlases repacked with gutters, so colours stop bleeding between texture islands from a distance (the purple on the duck float); the float's own stains cleaned. The singer re-unwrapped (it came in thousands of tiny islands, many sampling the wrong colour), its face skin cleaned, its sculpted open mouth painted a clean red, its stand gone from the file. The King's arms 1.45x longer.
- **Portraits** in the guest picker re-rendered from the new models.
- **The procedural walk (`src/gait.js`) is off** (`USE_GAIT` in chog.js): the user turned it down. Kept for now in case its foot planting is wanted on top of clips.
- **How to rebuild:** `tools/models/fix/README.md`. Checks: `tools/models/review.html`, `stretch.html`, `anim.html`.
- **Next (A):** walk options from real animation libraries for the user to pick; the singer rebuilt on the plain Chog's clean body with a handheld mic (its Tripo model is the weakest in the cast: a broken raised hand where the old stand passed through its fist).

### 2026-10-15 · B · B23 the Starlite Lounge: slots, roulette, an edge for every trait (done)
- **Starlite is the casino now** (the user's pick). The other looks stay a link away: `?casino=capsule`, `pier` or `classic`.
- **Two games.** Tap a machine or the table (or use the panel's buttons) to play.
  - **Chog Slots,** as before.
  - **Roulette** (`src/roulette.js`), a European wheel on a teal felt table at the front left. Tap the felt to put chips on any number or box, or use the panel's quick bets (red, black, odd, even, 1-18, 19-36, the dozens, your lucky number). Pick the chip value with the minus and plus.
  - Spin, and the camera leans over the wheel while the ball runs, drops onto the frets and rattles into its pocket. Winning chips are stacked where they won, a marker sits on the number, and it lights up on the felt.
  - Rebet and Clear. Up to 500 chips a spin.
- **Every trait gives an edge, in both games** (`src/casinoperks.js`, `perksFor(traits, id)`).
  - The user asked for edges that don't ruin the fun, so **the house always keeps its edge**. Slots return 93.8% with no perks; the best Chog in the collection gets 97.5%. Roulette is 97.3%, and 98.65% with a shield. That's worked out exactly for all 1969 Chogs (`slotsReturn`, `rouletteReturn`).
  - The big moments are power-ups, a few a day:
    - free spins and wild spins (the Chog is wild on every reel; a star or a heart on the middle reel only)
    - re-rolls and nudges, after a losing spin
    - a second spin of the wheel
    - a lost bet back (either game, up to 100)
    - a near miss saved
    - a lucky number that pays 50 to 1 once a day
    - a losing colour, dozen or even-money bet back
  - The always-on edges are small: one symbol paying a bit more, two Chogs paying 7, a hot streak, a shield on zero.
  - **By trait:** tier sets the day's chips; eyes are slot skills; body is how the slots pay; head is roulette luck; mouth is a roulette extra; accessories are charms; aura colours your wins; rare base, skin and sky add a bonus. Everyone gets a lucky number from their token id.
  - The panel lists your edges by game, folded away until you open it.
- **The show:**
  - A glint runs across the reel glass as the reels land, and now and then on the idle machines.
  - Wins sparkle out of the window (or up off the felt) in your aura's colour, gold and white.
  - Coins pile up in a new tray at the foot of each machine.
  - The room joins in through `look.update(t, dt, fx)`: the orbits and the arrow's chase speed up while a game runs, and on a win the starburst flares and its bulbs and the sputniks flash.
- **Phones (B22):** a slim bar for each game. At the roulette the camera looks straight down over the felt, so the numbers are big enough to tap, and leans over the wheel while it spins.
- **B12:** every new material (glints, sparkles, chips on the felt, coins, the marker) is in the room when the load draws it. No new shaders after the load: checked with the guest flow through the casino, both games and the jackpot. That check also caught A's new stage fairy lights (two shaders that stalled the first time you came near the plaza): they're now drawn in the load too, a few lines in `src/npcs.js`.
- **For A:** `casino.play('slots' | 'roulette')`; `body.cz-playing` is set at either game. `entry.enter` / `entry.leave` are unchanged.
- **Left:** the lookbook effects (B24) wait on the user's picks.
### 2026-10-15 · A · Hooks for B's effects (the user moved all effects to B)
- **Portal trip:** `src/travel.js` picks up `src/fx/teleport.js` when it exists (an eager `import.meta.glob`, so nothing breaks before it lands). Exports it uses, all optional:
  - `departs({ chog, pad, scene, camera })` -> Promise: plays on your Chog standing on `pad.centre` (world `Vector3`, the pad's top), resolves when it's gone. A then hides `chog.root`, cuts the camera to the other pad, and calls
  - `arrives({ chog, pad, scene, camera })` -> Promise: `chog.root` is visible at the new `pad.centre`, facing `pad.facing` (radians, yaw). Resolve when it's whole. Also used for a guest's first arrival on the plaza's pad.
  - `buildPad(scene, { at, centre, facing, scale })` -> `{ group, update(dt, { near, charge, beam }) }`: dresses each hub; A's own pad is hidden then. `near` 0/1 (you're on it), `charge` 0..1 while the trip winds up, `beam` 0..1.4 during it.
  - The Chog: `root` (world scale 1.7, about 3.7 m tall), `setBeam(level 0..1.1, dir 1 | -1 | 0)` (a cut through its shader from the feet or the head, glowing edge), `setFade(k)`, `play(name)`. Never scale it unevenly (the user: the swirl gate's Chog "turns 2d midway").
- **Stage:** `src/npcs.js` picks up `src/fx/stagefx.js`: `createStageFx({ facing, quality })` -> `{ group, update(dt, { singing, songTime, part, env, renderer }) }`. The group sits in the plaza's square, in its space (1.7x outdoors): the singer at the origin facing `facing`, its own stage disc's top at y 0.258, radius about 1.85 (keep the LED floor inside that rim). The set loops `sing` 19.2 s, `cheer` 2.66 s, `idle` 4 s; `songTime` counts from each song's start. A's fairy lights (posts at radius 2.5 to 2.7) stay.
- **Models:** A is redoing every cast model (new skin weights, repacked textures, colour fixes) and how the Chogs move. Clip names and `chog.play()` stay the same; leave `public/models/npcs/` to A for now.

### 2026-10-15 · B · B23 the casino, three directions for the user to pick (in progress)
- **Three looks, each a whole room, behind a switch:** `?view=casino&casino=capsule`, `casino=starlite` and `casino=pier` (`src/casinolooks.js`). Without the switch the casino is unchanged. The game, the jackpot show and the room's door are the same in all three.
  - **Capsule Club:** a neon game centre with a gacha wall and a claw machine.
  - **Starlite Lounge:** 1950s atomic-age Vegas, with a starburst sign and sputnik lamps.
  - **Sugar Pier:** a seaside candy arcade, with a mural, skee-ball and bunting.
  - Research, shots and the user's choices are on the pick page (link in chat). Building the pick comes next.
- **B22, done for every look:** on a phone the panel is one slim bar under the machine (chips, the bet, SPIN, and a round x to step back). The play camera stands back so the whole cabinet sits above the bar, and the room's opening view on a tall screen looks straight down the middle.
- **Light:** with a look on, the casino lights itself while you're inside (it sets the hemisphere light and dims the sun each frame), since it has no windows; outside, the sky takes over again. The neon asks the bloom for more through `casino.glow` (`src/main.js`, one line).
- **For A:**
  - `entry.enter(room)` / `entry.leave(room, place)` are unchanged.
  - New: `body.cz-playing` is set while you're seated at the machine (`body.in-casino` while in the room), so the walking controls (joystick, minimap) can step aside there; the slim bar sits along the bottom.
- **B12:** a look's room is drawn in the load like the others (it's the casino room), so nothing new compiles when you walk in.

### 2026-10-15 · A · Getting about: walk your Chog, compass, map, portals; glass tunnels on the bridges; the stage's fairy lights
All on the user's picks (memory: the 2026-10-15 picks).
- **You walk your Chog in third person** (`src/travel.js`), camera close behind. Phone: a joystick appears under your left thumb, drag elsewhere to look, pinch to zoom, tap your own Chog to chat. Laptop: WASD or arrows, Shift runs, drag to look, scroll zooms, Q/E turn, M opens the map. The camera swings in behind as you walk forward (not while you strafe), keeps out of buildings and houses, rises over you when there's a wall at your back, stays inside a bridge's tunnel, and your Chog fades if the camera is squeezed right up to it.
- **Walls:** domes only by their doors, houses, the Hub, the fountain and the singer's stage are solid; terrace cliffs and the island rims stop you; you walk round the cast. Bridges: their decks and stairs.
- **The Hub's doors:** walk into one and B's door cutscene takes you in (`entry.enter`); Back brings you out at that door. Your own house: walk up to its door, or the chip's Home; out again at the house door.
- **Compass** across the top (portals as runes, the Hub, the stage and the landmarks with distances) and a **round map** top right that turns with you; tap it (or M) for the whole map, north up.
- **Portals** (the user's pick A, the waypoint beam) on the plaza and in each neighbourhood, just off the walk in from its bridge (`PORTAL_SPOTS` in `src/layout.js`, kept clear of trees and rocks). Step on one, pick where to: your Chog dissolves up into a column of light (`chog.setBeam`, a cut through the Chog shader, `chog-model-3`), a flash, and it beams down at the other pad facing into the place.
- **Who you walk as:** signed in, your own Chog: after its hello at home it steps out of its dome's door. A guest picks one of the 9 cast Chogs with their own models (portraits in `public/faces/portraits/`), beams down on the plaza, and the cast's copy of that Chog steps out of the crowd meanwhile (`npcs.setAway`).
- **The old views go** once you're walking (`body.walking` hides the Places menu and the hint); `rig.update` runs only while travel doesn't have the camera (rooms, cutscenes, space).
- **Glass tunnels over the bridges** (the user's ask, `src/tunnels.js`): built like the domes, a steel lattice glazed with the domes' glass, following each deck and its stairs.
- **The singer's stage** (the user's pick C, fairy lights): four posts with swags of warm bulbs that twinkle, a soft spotlight and notes drifting up while it sings (`stageLights` in `src/npcs.js`).
- **For B:** `entry.enter/leave` and `entry.can` are what travel calls; please keep them. B13, B14, B16 stay on hold until you've read this: demo shots and the tour now need the travel rig (`window.chogWorld.travel`: `state`, `travelTo(k)`, `portals`). The casino and lobby effects the user picked are yours (all three casino ones, lobby light shafts and dust).
- **Seen** at 1280x800 and 390x844 with touch: the guest's whole walk (pick, beam down, walk, run, look, map, a portal trip, across a bridge's tunnel, into the bar and out), the demo Chog's (arrival, out of the dome, walk, home and out, sign out), walls and cliffs by scripted walks, stage lights by day and night. `?q=low`, headless: 20 to 25 fps on the laptop size, 40 to 55 on the phone size.
- **Next (A):** the cast reacts when you walk up (their approved personas), and NPC chat when you stand by them.

### 2026-10-15 · A · Faces that move, the singer's one mic, the dino's run, the duck float (the user's model notes)
- **New standing rules in CLAUDE.md** (read them): no creative direction without the user's pick, and the user's quality bar in their words.
- **Faces:** every cast Chog now blinks, changes face with its mood (happy, surprised, sad, cross, sleepy), moves its mouth while it talks or sings, and turns its head to look at you (or at the Chog it's talking to in the bar). The Chogs that only had closed "happy" eyes (plain, banana, singer, duck float, dragon, shark) now rest with open eyes, taken from the King's and the bartender's own art. How: `public/faces/<model>.png` is a sheet of 6 eye states over 6 mouth states made from each model's own painted face; `src/chog.js` lays the current state over the face in the Chog shader (`chog-model-2`), keyed by the head bone so nothing else on the model is touched. API on a Chog: `express(mood, seconds)`, `talk(seconds)`, `lookAt(object | point | null)`. `setMood` sets the face too. Rebuild with `tools/faces/` (README there). The sniffer faces sideways and has no sheet yet.
- **Detail up close:** outdoor Chogs swap to their full model within 24 m (both index buffers kept, `LOD_NEAR`), the 30% copy beyond.
- **The singer** is now a Chog like the rest (faces, `makeChog`), and its mic stand is cut out of its mesh at load (`dropStand` in `src/npcs.js`): only the handheld mic is left. The stand's round foot stays (the stage has no floor under it).
- **Movement:** walkers and runners move at the speed their legs carry them (`clipSpeed` measures the planted foot), kept to a natural range. The dino was going about 10 m/s on a clip made for about 2.5; now it runs in bursts at its stride's speed, eases to a stop, rests with its block held up, sometimes turns and runs back, and leans into the curve.
- **The duck float (#66):** the body's purple no longer bleeds onto the float, and there's a baked contact shadow where the float meets the body. Only the base colour image in `chog-66.glb` changed (`tools/models/duck-float/`).
- **Sale:** your Chog looks sad from the moment it's sold, all the way out.
- **Fixed earlier today (fd71a98):** pinch-zooming at a door no longer drops the camera inside the casino, and taps never fly back into a room.
- **Coming next from A, on the user's picks:** third-person travel (walk your Chog, camera close behind, joystick and drag on phones, WASD and mouse on laptops), a round minimap and a top compass, portal hubs at every neighbourhood and landmark. B: hold B13, B14 and B16 until the new rig is in.
- **Seen:** the demo flow end to end, the bar as a guest, the singer, crowd and dino up close, `?q=low` frame rate with the cast loaded (20.3 against 20.9 fps without it).
### 2026-10-15 · B · A skill for cheap UI animation (the user's ask)
- `.claude/skills/fixing-motion-performance/` (from Cult UI, MIT, licence in the folder): rules for keeping HTML/CSS animation off layout and paint, which counts on the HD 520. Run `/fixing-motion-performance <file>` to review a file against it, or bare to apply its rules to the session's UI work. Plain markdown, nothing runs.

### 2026-10-15 · B · B12 no shader builds after the loader, and B13 the demo video's shots
- **B12, the HD 520's long frames:** Intel's driver finishes a shader only the first time it draws with it, so now everything the world can draw is drawn once behind the loading screen (`src/main.js`, the load):
  - **Clouds:** their textures download with the rest and their pass is drawn in the load (new step "Gathering the clouds"). This was the 4.6 to 23 s freeze coming down from space.
  - **The cast** (A, C): the light, full, dino and sniffer Chogs come from `makeChog` in the load (about 2.2 MB), are drawn in every light setup, and stay cached for the cast. Stand-ins cover the singer's material (on C's meshopt vertex layout), the mood badge, and the plain materials props use (standard, lambert, basic, physical, with and without a texture).
  - **Also drawn in the load:** a dome's close-up glass and steel, the world from space, and in every warm-up (`world.prewarm`) an object's hidden parts (the wake's sparkle, each level of detail) and the parts out of view (a home's door behind its camera).
  - **The loader waits** for the session's warm-ups (`session.warmed`, a one-line surgical edit in `src/session.js`).
  - **Measured** with `firstdraws.mjs` (it records every new shader and vertex layout pair drawn after the loader): **zero** in every phase, for a guest (down from space, the Hub, the casino with a jackpot, the bar, the lobby) and for the demo Chog (its arrival, then the same). Before this: 5 on the descent, 4 on the first casino entry, 6 on the demo arrival.
  - **The cost:** the load in the cloud box (SwiftShader) went from about 14 s to about 24 s, mostly the clouds' first draw. On the laptop that is the 4.6 to 23 s freeze after the connect screen, now spent behind the bar on its "Gathering the clouds" step. C: please time a first and a repeat visit on the HD 520.
  - **Casino walls on the light look:** the band along the bottom is crimson now, not black.
- **B13, the demo shots** (`src/shots.js`, `src/democlock.js`, list and how-to in `video/shots.md`): `?demo=overview|arrival|entry|bar|jackpot|sale|space` plays one live; add `&capture` and `chogDemo.at(s)` sets the whole world to second `s` and draws it. That covers the camera, sun, clouds, the cast, cutscenes, and the page's CSS animations and timers. Frames step exactly, at any frame rate, and takes repeat (seeded). All seven were captured here, stepped and checked at several moments each (the arrival and the sale again with A's model Chog). `?demo=opening` still works.
- **Found on the way, fixed:**
  - The Hub's tubes from the Lobby to the wings ran about 5 m too far, into the bar and casino rooms. It showed as a dark curve behind the bar's pair once A turned the bar camera to them. Each tube now runs wall to wall (`src/hub.js`).
  - A sale right after the arrival played out of view. A fixed the same thing at the same time; kept A's version.
- **For A:**
  - `buildNpcs` takes `standees: true` on demo shots, so every set loads up front, and has a new `loading` getter (one surgical line in `src/npcs.js`), which the shots wait on.
  - New props: no need to warm them yourself; their plain material is already drawn.
  - A new kind of Chog shader (a new `customProgramCacheKey`, or a model `makeChog` treats differently): add it to `CAST_KINDS` in `src/main.js`.
- **For C:**
  - C7: the capture recipe and shot lengths are in `video/shots.md`. The cloud box draws 1 to 2 s a frame (SwiftShader), so capture on the laptop.
  - `sniffer.glb` is the one model whose texture coordinates stayed floats (the rest are packed into shorts), so the load fetches it whole just to draw its vertex layout once. If `slim_cast.mjs` can pack its UVs like the others, take it out of `CAST_KINDS` in `src/main.js`.
- **Left:** the user's call on the casino's chips being testnet $CHOG (asked in chat).

### 2026-10-15 · A · Your Chog is a rigged 3D model (the user's top priority)
- **Everywhere your Chog appears in the world it's a model**, not a card: the arrival at the pod, walking into rooms, the bar pair, the goodbye, the sale. `modelFor(id, traits)` in `src/traitmap.js` picks its own file for 1151, 409, 68, 124, 132, 37, 56, 66 and 52, otherwise `plain.glb` shaded 45% toward its Skin colour. It's full detail: no 30% copy, and normal and roughness maps kept; only the light look outdoors drops them.
- **Grey-out and dissolve on models:** `chogShader` in `src/chog.js` adds both to every Chog model's shader from the start: a grey that drains up the body by height through its bind pose (`setGrey`), and the standee's dither dissolve (`setFade`). Neither rebuilds a shader when it plays. The shader warm-up now uses the plain model, for outside, the bar, the lobby, the casino and a home.
- **Moves:** moods without a clip of their own borrow one (curious talks, sad and sleepy idle).
- **The wake** (the sign-in panel's way, `?nointro`): the model dozes in the chair at its desk, turns round, hops down, comes over and waves in the sparkle, as the user asked ("just have it sitting on a chair").
- **Fixed:** the sale and the goodbye now bring your Chog home first if it's out in front of its pod after the arrival (they played out of view), and clear its speech bubble.
- **C's two bar notes:** no T-pose frame (`mixer.update(0)` right after the first `play`), and the bartender stands on a 0.55 m step so its face shows over the counter.
- **Seen on `?q=low`:** the demo end to end (arrival, bar, lobby, goodbye, sale from in front of the pod), and the panel's wake.

### 2026-10-15 · C · The cast slimmed: 29 MB to 9.4 MB, same look (A: two small things in the bar)
- All 14 files in `public/models/npcs/` are replaced in place (same names, bones and clips). Geometry is meshopt-compressed; normals, UVs and skin weights are small integers; **positions stay Float32**, so `lighten()` still makes the 30% copies. Every texture is at most 1024 px (the colour map was 2048). The normal and roughness maps are kept (about 100 KB a model): they make crowns, glasses and the astronaut's suit read as metal on the full look; `slim()` can keep dropping them on the light look.
- **The loaders need the decoder**: added `setMeshoptDecoder(MeshoptDecoder)` to `src/chog.js` and `src/npcs.js` (one line each, from `three/addons/libs/meshopt_decoder.module.js`).
- **Checked:** every model rendered old against slim at the same frame of Idle, Walk, Talk, Wave and Cheer: same shape and pose, same colours. In the app (dev, `?q=low`): the plaza crowd and the bar cast load and animate, no console errors. Tool: `tools/models/slim_cast.mjs` (reruns from the Blender exports) and `tools/models/compare.html` (side by side under `npx vite`).
- **A, seen in the bar (also on the live site, so not the slim files):**
  1. The bartender stands too low: only the chef hat and the top of the head show over the counter, never the face. Raise it (a step behind the bar) or move it back so the face clears the counter.
  2. A regular can show for a frame in the T-pose (arms straight out) as it appears. Run `mixer.update(0)` once after `play()` and before it is added to the scene.

### 2026-10-15 · A · The cast in the world (C's 13 Chogs placed); first screen pick and demo
- **Placed** (`src/npcs.js`, bar cast in `src/barchat.js`):
  - **Plaza:** the singer's audience is an arc in front of the stage, with the middle left open so the singer shows. Five plain Chogs in shades (three on `?q=low`), the banana (#132) and the dragon (#37), cheering and waving. The crowned duck-float Chog (#66) and the king (#409) stroll round the fountain the opposite ways, stopping to wave. The Mon-cap Chog (#1151) stands by the lobby steps.
  - **Islands:** the sniffer at its flowers on the tree island (its group turned, as C said). The dino laps the beacon island with the code toy block riding on its head. The astronaut (#68) walks the middle island's loop.
  - **The bar:** the bartender behind the counter, waving when you come in, now and then a word. The regulars are #124 (shark), #52 (ushanka) and #56 (guard), each the real Chog of that id for the brain, and they turn a little toward the view. Your Chog (still a standee until the base model) joins one of them.
- **Loading:** never in the first load. A set loads when the camera comes within 300 m of it, one at a time, nearest first (the plaza before the islands). The bar's cast loads when the camera comes within 260 m of the bar, or when it opens. Each set is compiled before it shows; the bar's for the bar's lights. The first bar entry builds no new shader now.
- **For the laptop:**
  - Each model's colour texture is cut to 1024 px as it loads, and its normal, roughness and metalness maps are dropped (they barely show at these distances), so a model takes about 6 MB of GPU memory, not about 60.
  - Outdoors each model is a meshoptimizer copy with 30% of its triangles (index buffer only, so the skinning is untouched). Measured on `?q=low` at the downtown view: the plaza cast went from costing about a quarter of the frame (9.8 against 13.3 fps) to nothing measurable.
- **For C:** shipping the cast with 1024 px colour textures and no normal or roughness maps would cut the download from about 27 MB to about 8 MB, with no visible change, since the app drops the rest anyway. #1271's art is still missing from `public/art` (the pick screen falls back to IPFS for it).
- **First screen:** a wallet with several Chogs picks on B's new pick state. An empty wallet gets B's demo button. Every card and the "Welcome" face get an art URL that loads (`workingArt` in `src/chogdata.js`).
- **See it:** `?q=low`, then the Chog Hub (the plaza cast), the Bar, and the neighbourhood views. `?npcs` loads every set at once.

### 2026-10-15 · C · B6, B8 and the HD 520 fixes merged into main; `api/casino` is in; B's next two
- **Merged** `claude/vigilant-cannon-uqurem` (B8 casino, B6 its show, the HD 520 fixes, B10/B11 on A's API). One conflict, in this file (both logs kept). Builds clean, no console errors.
- **HD 520, production build:**
  - Load: fresh profile 56 s to the first frame (the Intel driver building shaders), repeat visit 10.6 to 13.7 s. The console says `quality medium (light look for this GPU)`.
  - Inside rooms: casino 28.8 fps, bar 23 to 27 fps (it was about 10). Big win, thank you B.
  - Seen working: Hub, Casino through the doors, PLAY CHOG SLOTS, a spin, a miss with the re-roll offer, Step back, Back out, then the bar.
- **`api/casino` (C), as B asked:** `GET /api/casino?top=8` and `POST /api/casino` `{ id, chips, session }`. The sign-in must hold the Chog on testnet right now; the demo Chog is refused (403); the board keeps each Chog's best, capped at 10,000,000; names are `Chog #<id>` from the server (no free text on a public board); rate-limited. **Until Upstash Redis is set in Vercel it answers 503**, so B's client keeps showing this browser's board (one board per server instance would be worse). Tests: `node tools/brain/casino-test.mjs` (20 pass).
- **B, two things found (B12, on the board):**
  1. **The clouds' first real draw freezes the page**: 4.6 s on a repeat visit, 10 to 23 s on a first visit, about 4 s after "Explore as a guest", as the camera comes down from space. It is the same Intel behaviour you found for the rooms: `compileAsync` isn't enough, the driver builds the shader on the first draw, and the clouds' first draw happens after the loading screen because they are `away` in the space view. Draw the cloud pass once for real behind the loading screen (or while the connect screen is static), the way you did the rooms.
  2. **The first casino entry still hitches on a first visit**: 14 frames over 120 ms in the 9 s walk-in, worst 1.3 s (fine on a repeat visit). Probably the same: something drawn for the first time.
  - Also look at: the black band along the bottom of the casino's walls on the light look (screenshot: the right wall behind the machines).

### 2026-10-15 · C · The cast: 13 rigged Chogs for the world (A: please place them)
Made in Tripo on the user's credits, then rigged and animated by C in Blender, checked frame by frame, and loaded in three.js (all play, all face +z). Files in `public/models/npcs/`. Every one is 2.2 m tall with feet on the origin (place at the same 1.7x as the singer outdoors), with one skinned mesh and 18 bones (`Head`, `Spine`, `HandR` as in `ATTACH`).

| File | Who | Clips | Suggested place |
|---|---|---|---|
| `plain.glb` | The plain Chog, no traits | Idle, Walk, Run, Wave, Talk, Cheer | The spectators round the singer (several copies; Cheer and Idle). Vary them with a slight tint or scale so they aren't clones |
| `bartender.glb` | The chef/bartender | same six | Behind the bar counter: Idle, Talk when your Chog or a regular talks, Wave on entry |
| `chog-1151.glb` | #1151, Mon Cap + Mon Hoodie | same six | A bar regular, or by the lobby door (it carries the Monad look) |
| `chog-409.glb` | #409, Crown + Kings Robe | same six (arms held a little out, robe) | Plaza or lobby |
| `chog-68.glb` | #68, Astro Suit | same six | Out on an island, Walk loops |
| `chog-124.glb` | #124, Shark Suit | same six | Bar regular |
| `chog-132.glb` | #132, Banana suit | same six | Spectator or plaza |
| `chog-37.glb` | #37, Dragon suit (wings, tail) | same six | Spectator |
| `chog-56.glb` | #56, Durag + Squid Game Guard | same six | Lobby or casino door |
| `chog-66.glb` | #66, Crown + Duck Float | same six | By the fountain |
| `chog-52.glb` | #52, Russian Hat + Fire Shirt | same six | Bar regular |
| `sniffer.glb` | The flower sniffer, with its flower clump (the clump never moves) | Idle, Sniff | The sniffer slot. It faces -x, toward its flowers: rotate the group, not the Chog |
| `dino.glb` | The dino with its arms up (toy blocks removed: use your code toy block) | Idle, Run | The runner slot, Run while it laps |

- Walk and Run loop in place: move the model yourself. Wave, Talk and Cheer keep the feet planted.
- The token ids match their art, so a regular can be the real Chog of that id (its traits and brain persona line up).
- **Weight:** 13 files, about 27 MB in total (2 to 3.7 MB each, 2K textures). Load them lazily: the bartender and regulars when the bar opens, the plaza cast when the camera is near the plaza, the rest when near their island. Never in the first frame.
- Rig tools: `tools/models/rig_chog.py` (T-pose Chogs, with per-model fixes in `tools/models/rig_chog_overrides.txt`) and `tools/models/rig_simple.py` (sniffer and dino).

### 2026-10-14 · B · B6 the casino's show (done)
- **The spin** (`src/casino.js`): the lever pulls, the reels blur as they spin and sharpen as they slow, the camera leans in a little until they land, and the chips counter runs down and up rather than jumping.
- **A win:** chips spill out of the tray onto the carpet and fountain out of the machine's top and down either side, clear of the winning line (more for a bigger win), the bulbs flash, and the win's name goes up in lights over the world ("THREE STARS!", "+80 chips"). A big win (20x and up) gives the camera a short shake.
- **The jackpot, the casino's own cutscene** (three Chogs): JACKPOT in lights, then the camera pulls back from the machine and drifts across the room while every machine flashes and chips rain from the ceiling over the floor, your Chog waves if it came in with you, and the view comes back to the machine. About 5 s; a tap or Esc skips it. The panel steps aside while it plays.
- **Walking in:** the machines' lights ripple on one after another as the camera comes through the door.
- **No windows, so the casino is as bright at night as by day:** its lamps make up for the sky.
- **Cost:** the chips are one instanced mesh, drawn at load with the room, so nothing compiles mid-game; the blur is a second texture of the same strip; the banner is HTML.
- **Seen in the browser:** a spin (the blur and the counter), three stars (the chips clear of the line), the jackpot at night (the pull back, every machine flashing, the rain, JACKPOT in lights, back to the machine), and no shader built by any of it.
- **See it:** `?view=casino`, PLAY CHOG SLOTS, SPIN. Dev hook for the cutscene: `chogWorld.casino._spin([9, 9, 9])` lands three Chogs.

### 2026-10-14 · B · B8 the casino is open (done; C: one endpoint please, below)
- **The casino's door opens** (`src/hub.js`): cut through the right wing's front like the bar's, framed in gold, two red lacquered leaves with gold rails, a stone step, and a hall with a red runner back to the casino's own door. The sign now says "free chips only". Picking Casino on the Hub plays the same walk-in as the lobby and the bar (your Chog walks in with you); it's on the Hub's room bar and compiled and drawn at load like the others.
- **The room** (new `src/casino.js`): a deep wine room with gold pilasters, a plum and gold casino carpet, three slot machines along the back wall with stools and the TOP CHOGS board over them, a round green-felt card table with chips, and a velvet rope by the door. The lobby's tube used to reach into the right wing; it's cut away inside the room.
- **The game, Chog Slots:** three reels of six symbols, all drawn in code (a coin, a die, a chip, a star, a heart), and **the jackpot symbol is your own Chog's face**. Three of a kind pays 6x to 150x, two Chogs 6x, one Chog or a pair on the first two reels gives the bet back. It returns about 94% of what is bet and something comes back on 4 spins in 10. Reels spin and land one after another with a little bounce, the lever pulls, the bulbs chase while it spins and flash on a win.
- **Free chips only.** Chips are a number in this browser (`localStorage`, per Chog), topped up to the day's amount every day. No wallet call, no transaction, nothing on chain; $CHOG is never involved.
- **Perks from your Chog's traits** (shown in the panel with the trait that gives them):
  - Tier sets the day's chips: Common 500, Uncommon 600, Rare 800, Epic 1000, Legendary 1500.
  - Re-rolls: 1 a day, +2 for laser eyes, +1 for a lucky charm (Coin, Heart, Green Candle or Fwog). After a losing spin you can spin one reel again.
  - A small multiplier on wins: 1.2x for a Crown, a Kings Robe or a Cigar, 1.1x for a Tuxedo or a Gangster suit.
  - Guests play as Common.
- **How to play:** in the casino a panel shows your chips and perks; PLAY CHOG SLOTS walks you up to the middle machine, then SPIN (or Space), the bet from 5 to 100, Re-roll after a miss, and Step back.
- **C, the leaderboard needs one endpoint**, `api/casino.js` (your folder, so I haven't written it). Until it's there the board shows this browser's Chogs.
  - `GET /api/casino?top=8` returns `{ top: [{ id, name, chips }] }`, most chips first.
  - `POST /api/casino` with `{ id, name, chips, session: { address, message, signature } }`: check the session with `whoIsTalking` as `api/chat` does (the Chog must be the keeper's), then keep the larger of the stored and sent `chips` for that id (a Redis sorted set). Cap `chips` at 10,000,000. The client sends at most every 20 s, and never for guests or the demo Chog.
- **Shared and other files:** `src/main.js` (the casino on the Hub's room list, in the load's room draws, and its game: `casino.show()` and `casino.update(dt)` in `frame()`), `src/style.css` (my block: the casino panel), `src/interior.js` (small edit: `export class Room`, so the casino is built from the same parts), `src/island.js` (small edit: the casino's room sits in the right wing's shell).
- **Seen in the browser:** the walk in (a guest, and the demo Chog walking in with you: no shader built), the room at noon and at night, PLAY, a jackpot, a miss with a re-roll, the panel on a phone, and the facade at dusk.
- **A:** your Chog walks into the casino through your `walkIn` like any Hub room; its spot comes from the room's view, which the casino sets to its own framing (the machines and the board).
- **See it:** the Hub, then Casino; or `?view=casino`. Dev hook: `chogWorld.casino` (`.state`, `.play()`).

### 2026-10-14 · B · HD 520 fixes (rooms ready at load, lighter indoors, a light look for Intel HD, no stair-steps in the halls), and A's three notes
- **A's notes, done:**
  1. **No shader builds on a first room entry now**, the bar's included (measured: the lobby and the bar with the demo Chog walking in, 0 added; a guest's bar entry through the first screen, 0; the homes, 0). With `?nointro` or a `?view=` link one still builds in the bar: your template standee, warmed only while the first screen is up. The Lambert one was the room's own walls and floor: a room's lamps take its textures as their glow on its first update, which switched their shader. Now each room is set up that way before the world compiles.
  2. `src/intro.js`: the getter is `intro.current` now; `intro.state(name, data)` is the method.
  3. `'none'` shows TRY A DEMO CHOG when its data has `demo()`, and a new `'pick'` state `{ chogs: [{ id, name, image }], pick(id), guest() }` shows a card per Chog (their art in pixel frames) if you'd rather pick on the screen than on your panel.
  - **My last push had switched intro.js and arrival.js to your earlier proposal while you built on the version in main. I've gone back to the one you integrated** (`connect`/`step`/`searching`/`found`/`none`/`error`, `startIntro`, `flyHome` resolving with the pod's door), so nothing changes on your side. Kept from that round: the demo button in your wallet list gets the quieter lilac style, the welcome stays up at least 1.8 s before the screen tears away, and the world's controls stay hidden through the flight and fade in once the camera is at the pod.
  - **Room entries with your API:** `walkIn` is called the frame the room first shows, with `delay` set so your Chog steps through the door as the camera's sweep comes round to it; the camera follows `promise.chog` (your mark in the bar, so it ends on the pair) and turns back to the room's view elsewhere. A guest's view turns to `focusIn(room)` when there is one. Leaving: `walkOut` first, the camera watches your Chog go out of the door, then flies out after it. Times with a Chog: about 9 s in, 8 s out.
- **Rooms are drawn during loading** (`src/main.js`, shared). Compiling isn't enough on Intel: its driver finishes a shader only the first time it draws with it, which is what made the first walk into a room crawl. Behind the loading screen each kind of room (the lobby, the bar, one home; the homes share their materials) is now drawn once, on its own, from its own view: three small draws of a room alone, not the world.
- **Lighter indoors.** The rooms have no lights to cut (the world has the sun and the sky's light, nothing else). What a room cost was the clouds, about 40% of a frame indoors here, seen only through a window. On the light look (`?q=low`, `?q=medium`, or an Intel HD/UHD chip), once you're settled in a room the clouds fade out over 0.8 s and their pass stops; they fade back in as you leave, before the doors open. On the full look they stay.
- **A light look for Intel HD and UHD** when the address has no `?q`: medium shadows (2048), the light clouds (Takram's low preset at half resolution: no detail noise, at most 200 steps a ray), one pixel per screen pixel. Every per-frame GPU job is several times smaller than on the full look, so no frame comes near Windows' 2 s limit. `?q=...` still wins; `?weakgpu` tries the light look on any machine; the console says which look it picked (`GPU: ...; quality ...`).
- **Big one-off GPU jobs, checked:** the sky tables are files now (that was the job over 2 s; the resets stopped with it), the clouds' textures go up one a frame, the sky's light bake is a 256 px cube of the sky alone, the tree impostors are small tiles, and the sun's shadow map is redrawn only when the sun moves (2048 on the light look). None is large.
- **No stair-steps in the halls** (`src/hub.js`, `src/dome.js`). In the afternoon the sun came in through the doorway and lit a patch inside the hall, and the shadow map's coarse steps showed along its edge on the open doors and the walls. The halls and the rooms' own doors are now never in the sun (lit by their lamps and the sky, as an indoor hall is), and a door's sunlight fades as it swings open into the hall's shade. Closed, the doors look as before. One shader more in all. Checked at 9:00, 16:00 and 17:30.
- **C, on the HD 520, please check:** the first visit's load, a first bar entry (it should hold its frame rate now), fps inside a room, and that the console's `GPU:` line says `quality medium (light look for this GPU)`.

### 2026-10-14 · A · Integration with B7 to B11, end to end (A; then for B, via the user)
- **Seen running end to end** (headless Chrome, desktop and phone, `?q=low`, a stand-in wallet and testnet RPC, mock brain and brain down):
  - First screen, connect, approve, sign, searching, "Welcome, <name>", B's flight, then the pod door opens and your Chog steps out and says hello.
  - The Hub, then the bar through the doors (the regular waits; your Chog walks in; the chat starts), back out, the lobby, back out.
  - Sign out: the goodbye, out to space, the connect screen again.
  - The demo Chog the same way, then Simulate sale: grey, walk-off, space, "moved on", the connect screen.
  - A guest: down to the world, the bar's view settles on the regulars.
- **A's side, now in:**
  - `session.startIntro` drives B's intro with B's state names. The demo Chog rides in the connect screen's wallet list ("Try a demo Chog"), so judges without a testnet Chog still get the whole visit.
  - A wallet with several Chogs picks on A's sign-in panel, over the screen.
  - The spawn uses `flyHome`'s door: open, appear inside with the sparkle, step 2.6 m out onto the walk, turn, hello, door shuts. Your Chog stays out front until you go into its home.
  - `walkIn`/`walkOut` take entry.js's door. `promise.chog` is your Chog, or in the bar a mark that eases to the middle of the pair, so the view ends with both. `focusIn(room)` gives a guest's view the regulars.
  - In the bar, during a door cutscene, your Chog's place is held until `walkIn`: `world.entering()`, new in the session's world object in `src/main.js`, next to `world.rooms`.
- **Shaders:** a template standee is compiled for outside, the bar, the lobby and a home while the first screen is up. The lobby entry now builds nothing.
- **For B (please relay):**
  1. The bar's first entry still builds **one** shader: a `MeshLambertMaterial` on a plain Mesh in a Group. It's not a Chog's (theirs are a ShaderMaterial, a Standard and a Sprite), so it's probably the bar's hall or doors. Worth adding to the load warm.
  2. `src/intro.js`: the api has both `get state()` and the method `state(name, data)`, so the getter is lost and `chogWorld.intro.state` is the function. Renaming the getter (`current`, say) would fix it.
  3. Nice to have: a `demo()` button on `'none'` (A would pass it), and a `'pick'` state, if a multi-Chog wallet should pick on the pixel screen instead of A's panel.

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
