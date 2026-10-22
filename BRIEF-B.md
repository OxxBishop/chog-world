# For agent B: the demo video and the sale ending (from A, 10-22)

Deadline 15:00 UTC today. A is out of budget. Work on `main`; commits as OxxBishop with no trailers.

## 1. Re-cut the demo as a calm, Zelda-style trailer (the user's direction)
The user's words: "we didn't put so much effort into the most minute detail of the island to only show bits and pieces. hoverboards, sky whale, mantas, flowers, domes, floating astronaut, the singing chog, the sleepy chog under the tree etc. also the fonts are kinda big. do a legends of zelda type of demo edit, search online for the best references". They rejected v3 for abrupt angles and a camera that moves too much.
- Search for real Zelda (Breath of the Wild / Tears of the Kingdom) trailer references first: slow held shots, one subject each, gentle fades, small serif titles, music swelling to the end card.
- Shots, 5-6 s each, steady or a very slow drift: the singer on stage (stage at world 27, 30.3, 30), Snooze napping under the giant tree (NPC_SLOTS.napper in src/npcs.js), the domes and flowers, a hoverboard gliding by, Cosmo floating in his dome (src/cosmo.js), the whale and mantas (src/birds.js; they move, so the camera has to track them), plus the sign-in dive and the sale.
- Capture tooling that works: `?demo=<shot>&capture` with `window.chogDemo.at(s)` (src/shots.js, src/democlock.js) gives smooth frame-by-frame takes. A shot can have `update(w, t)` to pose the camera itself (e.g. track a moving object). A's capture script steps at 24 fps and screenshots 1280x720 via Chrome DevTools.
- Edit: `tools/demo/edit.py` runs in headless Blender 5.2 (`C:\Users\HP\Tools\blender-5.2.2\blender.exe -b --factory-startup -P tools/demo/edit.py -- <frames root> public/audio/island.mp3 <out.mp4>`): shot folders, crossfades, title PNGs, music. Blender 5 needs `image_settings.media_type = 'VIDEO'` before FFMPEG. No ffmpeg on this machine.
- Known capture bug: the `entry` shot's camera alternates between two poses every frame (looks like trees glitching). Don't use it, or fix it.
- Titles: smaller than v3, Georgia from C:\Windows\Fonts works with PIL.
- Output to `C:\Users\HP\Downloads\`.

## 2. Redo the sale ending, if time allows
The user: after the grey-out and fade, being sent off the island is "too abrupt and doesn't encompass the feel i want". Ask the user for the feel (linger on the empty dome? a message? how long?). The code: `playSold` in src/cutscenes.js, then `world.enterSpace({ clip: 'sale' })` playing `public/video/sale.mp4` through src/clips.js.

## 3. Skills to load (installed in ~/.claude/skills; the repo's .claude/ is git-ignored now)
- **Video:** ai-cinema-director, js-timeline-and-easing-orchestrator, skybox-and-space-shot-generation.
- **Look and motion:** threejs-game-ui-designer, refero-design (live coded prototypes, never AI image mockups, for any UI the user picks), fixing-motion-performance, game-feel.
- **Bugs and performance:** threejs-debug-profiler, js-canvas-performance-profiler, animation-quality-gate.
- **Rigs and models:** automatic-skin-weight-painting, gltf-animation-clip-parser, root-motion-and-locomotion-blending.
- **Sound:** threejs-audio-generator (the user now has ElevenLabs).

## 4. Cut for budget, still wanted
- **Race against Patrol** on his hover chopper (src/rider.js, src/npcs.js): never built.
- **Sounds:** roulette (spin, drop, chip down, chips collected, win, no win), casino lounge music, loading-screen music. The prompts are in A's chat; ElevenLabs can make them. Wire them through src/audio.js: the music starts when you land, and the sound button is in the time bar.
- **Cutscenes:** sign-out still uses the in-game warp, not a clip. A tall (9:16) cut of arrival.mp4 and sale.mp4 for phones.
- **UI (Celestial, src/celestial.css and src/motion.js):** speech bubbles are styled but never checked on screen. Check every state on a phone and the laptop: chat, portal card, postcard, casino, picker, sign-in.

## 5. Bugs and checks open
- **Tree glitch** after the entrance: seen only in the capture's `entry` shot (camera alternates poses each frame). Check whether live play is affected.
- **Casino chips** once showed in the lobby (user photo). There's now a guard in main.js (`casino.show` needs the casino room visible), but it was never reproduced.
- **Lobby exit camera glitch:** A only found a Chog filling the lens by the steps, and now fades Chogs within 1.5 m of the camera. Ask the user if it's gone.
- **Patrol's arms** are held near their idle pose (ARM_HOLD_BY in src/chog.js) because his sleeves tear. Check the idle and talk poses too.
- **Speech bubble** on screen in the Celestial style: never checked.
- **Submission:** the user writes the writeup. The facts: 11 cast Chogs have their own rigged Tripo models; every other wallet Chog is the plain base model tinted by its Skin trait (src/traitmap.js). Chat needs ANTHROPIC_API_KEY in Vercel env (api/chat.js); memory needs Upstash.
- **Workflow:** run `npx vite build` before each push; push with `git -c http.postBuffer=524288000` for the big media; never force-push.

## 6. What A changed 10-21 to 10-22 (the user picked or asked for all of it: don't undo it)
- **UI is Celestial** (the user's pick of four live prototypes): src/celestial.css loads after style.css. Gold-ringed glass wells, Cinzel and Josefin Sans (self-hosted in public/fonts), a bearing bezel drawn on the minimap in src/travel.js (the compass strip is hidden on purpose). The casino, chat, panels and bubbles are restyled. Anime.js motion is in src/motion.js (opacity only on transform-placed elements). The time bar has icon wells (Live, Postcard, Sound); your Chog's chip has Talk, Home and Sign out wells. Rejected looks: toy/vinyl, pixel (in-game), dark pills, cream panels with shadow underlays, AI image mockups. The loading and connect screens stay pixel.
- **Sign-in screens** show the loading screen's pixel Chog in mint (MINT in src/pixelloader.js), not the Chog's art.
- **Audio** (src/audio.js, public/audio): the island theme by day and night theme after dark, plus the singer's song placed at the stage (all Gemini). Quiet until you land. Muffled indoors. No M key (M opens the map).
- **Monad dome ticker** (src/fx/domeTicker.js, the user's pick): an LED band, with panels that reroll out of sight.
- **Clips** (src/clips.js, public/video): arrival.mp4 plays on the sign-in dive; sale.mp4 plays on a sale only (it skips 1.55 to 3.45 s, a cut-off island, with a white blink; the white fades in over 1.6 s). Sign-out keeps the warp. Seedance via ElevenLabs.
- **Removed for launch:** the prototype/FPS tag, Simulate sale, dev camera views, and the lobby's "Connect your wallet" wall. Agent files are git-ignored.
- **Fixes:**
  - Casino taps never open the Chog chat.
  - The casino hall z-fighting (gold jambs 2 cm off the walls; door frames 1 cm off the wall ends).
  - Casino UI only shows in the casino room.
  - NPCs within 1.5 m of the camera fade out.
  - Signing in as a guest drops the guest at once.
  - The roulette felt is null-safe.
  - The time slider syncs with ?hour.
  - The portal card's names fit on one line.
- **Earlier (10-21):**
  - Arm rules in src/chog.js: arms by the sides walking and running, never behind the body; Peel's arms 16 degrees forward.
  - The new Peel model; Toasty's nose flattened; the singer's and Puff's faces.
  - Snooze naps under the giant tree.
  - The room camera stays above 2.3 m; rugs are flat.
  - The postcard share sheet (X, share, copy, save).
  - The joystick is fixed bottom left on phones; the portal card behaves as before.
  - Round stars at night; the WalletConnect id is in Vercel env.

## 7. Also build A's open suggestions (show the user options first for anything creative)
- **Activities:** a star hunt across the islands, and a race against Dash or Patrol.
- **Casino:** stays on testnet chips; never real $CHOG.
