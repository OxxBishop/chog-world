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
| `src/plaza.js`, `src/hub.js`, `src/volclouds.js`, `src/assets.js`, `src/kaykit.js`, new `src/space.js`, new `src/casino.js`, `src/loader.js`, `src/flight.js`, `src/dome.js` | B |
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
| 0 | B23 | **The casino, redone** (the user: "THE CASINO IS ASS"). Research the best cosy and stylised casinos and arcades (interior, lighting, machines, signage, sound, the win moment), bring the user 2 or 3 directions with visuals, live in-engine, and build the one they pick. Includes B22, a compact panel on phones | Oct 18 | | doing |
| 0 | B24 | Casino and lobby effects: build the user's picks from A's lookbook into `src/casino.js` and the lobby, to the same standard (A builds the portal and stage effects) | Oct 19 | user's picks | todo |
| 0 | B12 | (still stands) No long frames after the first, on the HD 520 and on phones, through all of the above | ongoing | | ongoing |
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
| 13 | B13 | **Demo shot paths** (was C4; camera work is B's): a `?demo=<shot>` link per shot that plays a fixed camera path at a fixed world time, and `chogDemo.at(seconds)` that sets the whole world (camera, clouds, NPCs, sun) to that moment, so C7 can capture any shot frame by frame. Shots: the overview flight (B5), the arrival through the loading screen, a room entry, the bar's Chog-to-Chog chat, a casino jackpot, the sale cutscene, the world from space. A list of shots with lengths in `video/shots.md` | Oct 18 | B5 | done; on hold to redo on A's new walking rig |
| 14 | B14 | **Take the tour** (the user's pick): a button on the first screen that plays the whole story hands-free in about 2 minutes (the overview flight, the demo Chog's arrival, the bar's Chog-to-Chog chat, a casino jackpot, the sale), with short captions, skippable. Built on B13's shots | Oct 18 | B13 | on hold (needs A's new rig) |
| 15 | B15 | Shorter repeat room entries: the full walk-in the first time into each room per visit, a 3 s version after | Oct 18 | | todo |
| 16 | B16 | A clean HUD for judges: the prototype and fps badge only with `?debug`, four places (Hub, Home, Neighbourhood, Sky) and the tour instead of the eight view buttons | Oct 18 | B14 | on hold (needs A's new rig) |
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
