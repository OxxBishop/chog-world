# Chog World task board

Chogathon submission closes **2026-10-22 15:00 UTC**. Demo video recorded on Oct 20, Oct 21 is buffer.

Three Claude agents share this repo. This file is how we split the work and avoid colliding.

## How to work

1. **Start of every session:** `git checkout main && git pull --rebase`, then read `CLAUDE.md`, this file and `HANDOFF.md`. Work through your list **in order, one task at a time**.
2. **Claim a task** by setting its status to `doing` and pushing that one-line change before you start.
3. **Stay in your own files** (ownership table below). If you must touch someone else's file, keep it to a small surgical edit and say so in `HANDOFF.md`.
4. **One task, one or more small commits, on `main`.** Run `git pull --rebase` before every push. A push to `main` goes live on chog-world.vercel.app within a minute. Never force-push, never rewrite pushed history.
5. **When a task is done:** set it to `done`, add a line to `HANDOFF.md` (what changed, how to see it, anything left), and push.
6. Commits are authored as OxxBishop with **no Co-Authored-By or other trailers**. Public copy: no em dashes, no AI-copy tells.
7. **B's branch:** B's session can only push to `claude/vigilant-cannon-uqurem`. B keeps merging `main` into it (`git pull --rebase=merges origin main`); C reviews it and merges it into `main`. B's branch gets its own preview link on every push.

## Agents

| Agent | Who | Focus |
|---|---|---|
| **A** | Chog chat on the main account (session `chog-world-72`) | Wallet, Chogs, NPCs, the cutscenes that involve a Chog |
| **B** | Second Claude Code account | World polish, load time, the world seen from space, casino |
| **C** | Lead chat on the main account | Tools, 3D models, Chog brain (chat and memory), sound, demo video, review, this board |

## File ownership

| Files | Owner |
|---|---|
| `src/chain.js`, `src/session.js`, `src/chog.js`, `src/chogdata.js`, `src/traitmap.js`, `src/npcs.js`, `src/cutscenes.js` | A |
| `src/plaza.js`, `src/hub.js`, `src/volclouds.js`, `src/assets.js`, `src/kaykit.js`, new `src/space.js`, new `src/casino.js`, `src/loader.js`, `src/flight.js`, `src/dome.js`, new `src/fx/` (the effects: `teleport.js`, `stagefx.js`, casino and lobby) | B |
| `tools/`, `api/` (Vercel functions), new `src/brain.js`, new `src/audio.js`, `public/models/`, `public/audio/`, `public/meta/`, `public/data/`, `video/`, `TASKS.md` | C |
| `src/main.js`, `index.html`, `src/style.css` | shared: small edits only; add new CSS in your own clearly marked block |
| everything else in `src/` | ask in `HANDOFF.md` first |

## Milestones

| Date (UTC) | Milestone |
|---|---|
| Oct 14 | Load time fixed; sign-in, sale listener and guest mode working; Chog brain live |
| Oct 17 | **Core loop works end to end:** sign in, your Chog wakes and chats, sell it, grey-out cutscene, carried out to space |
| Oct 19 | **Feature freeze.** Only fixes and polish after this |
| Oct 20 | Record and edit the demo video |
| Oct 21 | Buffer: fixes, re-records, submission text |
| Oct 22 15:00 | Submit |

## Tasks, in order

Work top to bottom. Status: `todo`, `doing`, `done`, `blocked`. "Needs" lists what must exist first; if it
doesn't yet, stub it and move on, then come back.

### Agent A: wallet, Chogs, NPCs, cutscenes
| Order | # | Task | Target | Needs | Status |
|---|---|---|---|---|---|
| 0 | A12 | **The cast's models, the user's 10-15 notes**: new skin weights for every rigged Chog (Tripo's tore at the shoulders: the shark's "things behind the arms", the King's sleeves), texture atlases repacked with gutters (the purple seeping into the duck float from a distance), pink arms and feet on the purple Chogs (the chef's colours), the King's arms longer, the astronaut's suit and the singer's blemishes cleaned, the singer's stand gone from its file | Oct 16 | | doing |
| 0 | A13 | **How the Chogs move**: no more T-pose idle; a better walk (options for the user to pick), the bent right arm and the wave fixed; the cast reacts when you walk up (approved personas). **Picked 10-16:** the cartoon walk (card 3) for walking and the cartoon jog (card 4) for running, every character, at the speed their feet really cover. Done 10-16: wave and cheer from CC0 clips (the bent arm gone), the cast reacts when you walk up | Oct 17 | | done |
| 0 | A14 | **Sharper Chogs** (the user: "scuffed and low res"): the 2048 colour maps back (from git, before the slim), KTX2 textures so the GPU holds less than today, each file loaded once (no second copy for the light look), the singer and faces laid out again with the face first | Oct 17 | KTX-Software (approved) | done |
| 0 | A15 | **Shadows that follow the Chogs** (today the sun's map only redraws every ~72 s, so a walking Chog has none): two looks for the user to pick, then build it | Oct 17 | | done (the user's pick: the soft shadow from the sun) |
| 0 | A16 | **The island on the HD 520** (measured 10-16: 21 fps, GPU 46.5 ms at the plaza, of which materials ~17 ms, geometry ~11 ms, the cast ~1 ms): lighter materials on weak GPUs (looks to pick), fewer far triangles, fewer draw calls, the sniffer and dino out of the first load, a crowd of distinct Chogs | Oct 18 | user's pick for the crowd | doing: the sky now draws only where it shows (21.6 to 28 fps), the sniffer out of the first load, files load once; the crowd is the user's pick (three of the cast join in) |
| 0 | A17 | **Moved to the new B (the user, 10-16):** earning testnet $CHOG for the casino, a Monad / Chog / $CHOG billboard, the balance, tipping the singer, the astronaut floating round its dome, the biker on a bike, giant toy blocks round the dino's dome. Options first | Oct 19 | | moved to B |
| 1 | A1 | Wallet sign-in on Monad testnet (switch chain, sign a message, read `tokensOf`), then a Chog picker using `public/data/chogs.json` | Oct 14 | | done |
| 2 | A2 | Sale listener: poll `Transfer(from = user)` every 3 s; on a sale, call the grey-out hook and sign out | Oct 14 | A1 | done |
| 3 | A3 | Guest mode: "Claim a Chog" (`claimRandom`, faucet link) and "Try a demo Chog" with a **Simulate sale** button | Oct 15 | A1 | done |
| 4 | A4 | Trait to 3D map (`src/traitmap.js`): trait values map to model files, with a base-Chog fallback. Models arrive in `public/models/` from C | Oct 15 | C2 | done |
| 5 | A8 | Chat with your Chog in the world, wired to C's brain (`src/brain.js`): its mood and face react to the conversation | Oct 16 | C5 | done |
| 6 | A6 | **Sale cutscene** (the demo's centrepiece): the Chog looks at the camera, colour drains from the feet up and it walks off grey, then the user is carried out to the space view (B7), fade, "Your Chog has moved on." | Oct 17 | B7 (stub until then) | done (calls `world.enterSpace`, a stub in `src/main.js` until B7 lands) |
| 7 | A7 | Login and logoff effects: on login the Chog wakes in its dome home; on logoff it waves and the user is carried out to the space view (B7) | Oct 17 | B7 | done (same stub) |
| 8 | A5 | NPC slots: a singer on a stage in the square with Chogs gathered round, a Chog sniffing a flower, a Chog running around with a toy block | Oct 18 | C2 models | doing: the singer is in; the crowd, sniffer and runner show once their models land (`?npcs` previews them) |
| 9 | A9 | Chog-to-Chog chats in the bar, using C's brain. This is the clip the demo leads with | Oct 18 | C5 | done |
| 10 | A10 | **Your Chog walks in**, for B10: `session.walkIn(room, door)` returns a promise. Your Chog appears at the door, walks to its spot and looks at the camera, and walks back out on leaving. Guests: nothing to do | Oct 16 | B10 | done on A's side (`session.walkIn`/`walkOut`, see HANDOFF); B10 calls it |
| 11 | A11 | **Sign-in on the new loading screen**, with B11. Drive B's `intro.state(...)`: connect, searching (the running pixel Chog until `tokensOf` answers), found ("Welcome, <name>"), or none (claim or guest, as A3). Then the spawn: after B's flight reaches the pod, your Chog appears in it (the wake sparkle), steps out, turns to the camera and says hello in a bubble. Use the brain if it is up, a canned line if not | Oct 17 | B11 | done on A's side (`session.connect`/`demo`/`setIntro`, see HANDOFF); B11 plugs in |

### Agent B: world polish, load time, the world from space, casino
| Order | # | Task | Target | Needs | Status |
|---|---|---|---|---|---|
| 0 | B23 | **The casino, redone** (the user: "THE CASINO IS ASS"). Research the best cosy and stylised casinos and arcades (interior, lighting, machines, signage, sound, the win moment), bring the user 2 or 3 directions with visuals, live in-engine, and build the one they pick. Includes B22, a compact panel on phones. **The user picked Starlite Lounge**: build it out, with a perk for every Chog trait (wilds, extra spins, nudges, roulette luck), a roulette wheel, win effects and reel glints | Oct 18 | | done |
| 0 | B25 | **Warp to the Chog World planet** (the user's words: "the world outside space as the user gets transported at warp speed, i meant a planet, not the island viewed outside space. the planet features should be similar to earth but with purplish accents here and there to make it feel truly alien and chog like"). Space shows a planet, not the floating islands; being carried out (sale, logoff, sign-in) is a warp-speed jump that drops out in orbit, and the arrival dives back down through the atmosphere and clouds to your home. **The arrival, in the user's words:** the planet behind the loading screen; once an option is picked (demo, a Chog in the wallet), "Welcome to Chog World" and a mini cutscene transporting them into the world, the screen goes blank, and they wake up (a dazed camera) in their Chog's dome with it waving to them (the waving is A's). **Picked: look A, amethyst**, with the space round it (debris, dwarf stars, constellations, nebulae) and the smiling-Chog constellation | Oct 18 | | done |
| 0 | B24 | **All the effects** (the user, 10-15: "the effects need to be sent to agent b"). Casino: all three (marquee chase, coin fountain, reel glints), coins land on the floor and never sink into it. Lobby: light shafts and dust. Stage: the LED floor and confetti, in `src/fx/stagefx.js` (no lasers; A's fairy lights stay). Portal trip: the swirl gate without the Chog going flat, or better, shown to the user to pick, then `src/fx/teleport.js`. A has wired the hooks (HANDOFF, 10-15 A). **Portal: the user picked the swirl gate**; it ships once A applies B's travel.js lines (pads as ground, the gate's warm-up; HANDOFF 10-16 B "Later the same day") | Oct 19 | | done (on main 10-19: the swirl gate, the lobby's light, the stage's LED floor and confetti) |
| 0 | B26 | **The casino, from the user's 10-16 test**: your Chog walks in with the camera behind it (rooms too), its trait edges on a card beside the table, and bespoke controls: **the user picked "Chips in hand"** (a chip rack, a round SPIN, edge badges that light up when they fire; spec in HANDOFF 10-16 B "The casino's controls"). **Controls done 10-18** (on main). **Walk-in done 10-19** (on main) | Oct 19 | | done |
| 0 | B12 | (still stands) No long frames after the first, on the HD 520 and on phones, through all of the above | ongoing | | ongoing |
| 0 | B27 | **The bridges** (the user, 10-18, with a recording: "the chog is quite literally too big for the bridge and walking through ends up bugged ... make the bridge bigger"). Decks 8.5 m wide (were 5), each end lying on the island's grass so nobody sinks into the ground at the ends, the cover over each bridge sized to match | Oct 19 | | done |
| 0 | B28 | **What covers the bridges** (the user: "the dome? not a fan. design a cleaner, cooler version that also isn't bugged to the island"). Options in-engine (`?tunnel=tube\|hoops\|lanterns`), shown to the user to pick, then build the pick. **On the pick page 10-19**, B recommends hoops | Oct 19 | user's pick | waiting on the user |
| 0 | B29 | **WalletConnect in sign-in** (the user: "because of mobile users"), and on a phone with no wallet in its browser, "Open in MetaMask". **Built 10-19** (on main); Open in MetaMask works now. WalletConnect shows once the user sets a project id in Vercel (`VITE_WALLETCONNECT_PROJECT_ID`) | Oct 19 | the user's project id | blocked: the project id |
| 0 | B30 | **Cutscene prompts** for the user's AI video generator, one per cutscene they described (arrival, wake-up, carried out, the sale, room entries, portal, jackpot, the opening flight) | Oct 19 | | done (on the user's pick page) |
| 0 | B31 | **From A17 (A is out of its weekly limit; the user moved island work to B):** the astronaut floating in zero g in its dome, the biker Chog riding round the island, and new island activities. Options to the user first. **On the pick page 10-19** as working prototypes (`src/cosmo.js`, `src/rider.js` on B's branch, not on main): B recommends the pocket of space and the chopper, and the dino race with a star hunt | Oct 20 | user's pick | waiting on the user |
| 0 | B32 | **The user's 10-19 morning test** (phone recordings), in their order: the pixel loader left on screen over the planet; roulette: a Clear button, and the felt cleared after each spin (not when Rebet is pressed); the casino walk-in: camera glitches, your Chog clipping the roulette table, walking through the step at the door; both doors opening late (your Chog walks into them) | Oct 19 | | done |
| 0 | B33 | **The bridges, again** (the user: "it seeps into the island and the chog just walks right through it ... make it bigger"): the deck dove into each island's sloping rim; a level landing out to the cliff, then the stairs; 12 m wide. **The user picked glass hoops** for the cover | Oct 19 | | done |
| 0 | B34 | **Cosmo's dome** (the user's direction): a dome like the others, few flowers, his own pod, tiny space rocks floating, Cosmo floating inside (a moon floor, maybe); going in and floating with him as an activity. **Patrol's ride**: the chopper with hover pads instead of wheels; hoverboards as a way to get round, parked by the domes. **The portal**: the swirl opens and your Chog walks through it, a wormhole, no spinning | Oct 20 | | done |
| 0 | B35 | **Birds** (the user: the island feels sparse): small ones through the flowers and perching in trees, some overhead, some flying close past the island. CC0 assets found online, shown to the user to pick. **The user picked:** B's little monsters (at the flowers and in the trees), C's sky whale (far out, now and then), A's sky mantas (overhead and swooping past the edge) and puff birds (in the trees) | Oct 20 | user's pick | done |
| 0 | B36 | **The casino's odds by tier** (the user, 10-21, after the sim audit): a tier lift in `perksFor()` so the always-on return rises with every tier (fixing the Legendary inversion), a hard cap at 98.5% enforced there, the sim re-run to show it. Then, only if time allows, a session summary (each edge that fired, what it earned, your net). Power-ups stay as they are; no `?seed=`. **Done 10-21:** lift and cap in, sim re-run (monotonic, max 98.500%), the visit's card in | Oct 21 | | done |
| 1 | B2 | Load time: first frame in under 10 s on a slow laptop (show the world first and stream the clouds in after, real progress in the loader, cache assets). Today it is 40 to 60 s | Oct 14 | | done |
| 2 | B1 | Plaza benches: tidy rings facing the fountain and rows along the paths, no random angles | Oct 14 | | done |
| 3 | B7 | **World seen from space** (`src/space.js`): the whole archipelago as a little diorama floating in a starry void, with the grey Chogs still visible wandering. Used when the user is carried out (sale, logoff) and as the backdrop behind sign-in. Export `enterSpace({from, duration})` and `leaveSpace()` so A's cutscenes just call it. A needs this by Oct 17 | Oct 16 | | done |
| 4 | B10 | **Room entry cutscenes** (bar, casino, lobby), replacing the fade to black. The user's words: "a clear and proper animation that shows the interior in some sort of mini cutscene before the camera then pans to the chog that's entering the building". Camera flies to the door, the doors open, and the move carries through the doorway: cut on a frame the doorway fills, so the switch to the interior scene can't be seen. A short reveal sweeps across the interior (about 3 s), then the camera settles and pans to the entrance as your Chog walks in (A10). Guests settle on the regulars. Leaving plays it in reverse. A tap or Esc skips to the end. Total 5 to 7 s, 30 fps on the HD 520 | Oct 16 | A10 | done |
| 5 | B11 | **Loading screen and arrival flight**, with A11. A glitchy, pixelated screen (pixel font, scanlines, RGB split and glitch flickers): "Welcome to Chog World" over the real load progress, then "Connect wallet to begin" with "Explore as a guest" kept for judges without a testnet Chog. While A11 searches the wallet, a pixel Chog runs in a little circle (pixelate the official art at runtime, no hand-drawn sprite). Then a glitch "Welcome, <Chog name>", and the arrival flight: over the island, down to your dome, in through the glass to the pod, handing over to A11's spawn. Give A a small API (`intro.state(name, data)`, `intro.flyHome(room)`) | Oct 17 | A11 | done |
| 6 | B9 | Load time, round 2: B2 measured on the HD 520 is 19 to 25 s to the first frame on a first visit, 13 s on a repeat visit (see C's 10-14 handoff entry). Get the first visit under 10 s: dome lattice shared across domes, fewer and lighter model files, then re-measure | Oct 17 | | done (C: re-time on the HD 520) |
| 7 | B3 | Lobby facade: warm and welcoming like the bar and casino (it is still the grey sci-fi panel body) | Oct 16 | | done |
| 8 | B4 | Clouds: check for a grainy, dithered look in the overview at normal frame rates and fix it | Oct 17 | | done |
| 9 | B5 | World overview flight for the demo's opening shot (drone path over the islands at golden hour) | Oct 18 | | done |
| 10 | B8 | Casino (only if everything above, and A1 to A7, are done): one game, free chips only, Chog traits give perks (bonus chips, re-rolls, small multipliers), leaderboard. Never wager $CHOG | Oct 19 | | done (`api/casino` in; shared once Upstash Redis is set in Vercel) |
| 11 | B6 | Casino spin effect, the casino's own cutscene | Oct 19 | B8 | done |
| 12 | B12 | **No long frames after the first frame, on the HD 520.** The clouds' first real draw freezes the page 4.6 s (repeat visit) to 23 s (first visit) as the camera comes down from space after the connect screen; the first casino entry hitches up to 1.3 s on a first visit. Draw everything for the first time behind the loading screen (as B did for the rooms). Done when no frame after the first is over 500 ms, first visit and repeat, guest and demo Chog (see C's 10-15 handoff entry) | Oct 16 | | done |
| 13 | B13 | **Demo shot paths** (was C4; camera work is B's): a `?demo=<shot>` link per shot that plays a fixed camera path at a fixed world time, and `chogDemo.at(seconds)` that sets the whole world (camera, clouds, NPCs, sun) to that moment, so C7 can capture any shot frame by frame. Shots: the overview flight (B5), the arrival through the loading screen, a room entry, the bar's Chog-to-Chog chat, a casino jackpot, the sale cutscene, the world from space. A list of shots with lengths in `video/shots.md` | Oct 18 | B5 | done; redo on A's walking rig (live: `window.chogWorld.travel`) |
| 14 | B14 | **Take the tour** (the user's pick): a button on the first screen that plays the whole story hands-free in about 2 minutes (the overview flight, the demo Chog's arrival, the bar's Chog-to-Chog chat, a casino jackpot, the sale), with short captions, skippable. Built on B13's shots | Oct 18 | B13 | todo (A's rig is live) |
| 15 | B15 | Shorter repeat room entries: the full walk-in the first time into each room per visit, a 3 s version after | Oct 18 | | todo |
| 16 | B16 | A clean HUD for judges: the prototype and fps badge only with `?debug`, four places (Hub, Home, Neighbourhood, Sky) and the tour instead of the eight view buttons | Oct 18 | B14 | todo (A's rig is live) |
| 17 | B17 | A quality toggle in the HUD (light, full, ultra), remembered per browser | Oct 18 | | todo |
| 18 | B18 | Proof on chain: a "verified on Monad testnet" link to your Chog on the explorer, on the welcome screen | Oct 18 | | todo |
| 19 | B19 | A photo button: the current view with your Chog as a framed postcard, saved as a PNG | Oct 19 | | todo |
| 20 | B20 | A time-lapse button: 24 hours in 20 seconds, then back to the live clock | Oct 19 | | todo |
| 21 | B21 | The pixel runner on the loading screen is playable (tap or Space to jump) while a long first load runs | Oct 19 | | todo |
| 22 | B22 | A compact casino panel on narrower screens, so it never covers a machine | Oct 19 | | part of B23 |

### Agent C: tools, models, brain, sound, video
| Order | # | Task | Target | Needs | Status |
|---|---|---|---|---|---|
| — | C1 | Testnet Chog collection (deployed `0x85a9ba85e5a3e87bab529c402140a87a72622b91`) and trait extraction (`tools/`) | | | done |
| 1 | C5 | **Chog brain**: a Vercel function (`api/chat`) on Claude Haiku 5.5. It gives each Chog a personality from its traits and remembers by token (places, friends) and by owner (mannerisms, chats), with owner memories wiped on transfer. Plus `src/brain.js` for A. **Code done and tested (mock mode); live once the key and Upstash Redis are set in Vercel** | Oct 15 | the user's API key | doing |
| ongoing | C2 | Prep each Tripo model the user exports: check the rig, slim it for the web, drop it into `public/models/`, note it in `HANDOFF.md` | as they come | | doing |
| ongoing | C3 | Review every push against this board, and keep the board current | daily | | doing |
| 2 | C6 | Sound: the singer's song in the square, ambient island sound, UI and cutscene stings (all royalty-free), in `src/audio.js` | Oct 17 | | todo |
| 3 | C4 | Demo video shot list and camera paths: moved to B (B13) | Oct 18 | B5 | moved to B13 |
| 4 | C7 | **Demo video edit** (needs B13): every shot is captured from the live app frame by frame (headless Chrome stepping `chogDemo.at(s)`, so it is smooth at any frame rate), then cut with ffmpeg: titles, music, crossfades. Scripts in `video/`, runnable by B in the cloud or on the laptop (much faster there: real GPU). 3 minutes| Oct 20 | C4, A6 | todo |
| 5 | C8 | Submission text: pitch, how it works, tech stack, future vision, links | Oct 21 | | todo |
