# Chog World task board

Chogathon submission closes **2026-10-22 15:00 UTC**. Demo video recorded on Oct 20, Oct 21 is buffer.

Three Claude agents share this repo. This file is how we split the work and avoid colliding.

## How to work

1. **Start of every session:** `git pull --rebase`, then read `CLAUDE.md`, this file and `HANDOFF.md`. Work through your list **in order, one task at a time**.
2. **Claim a task** by setting its status to `doing` and pushing that one-line change before you start.
3. **Stay in your own files** (ownership table below). If you must touch someone else's file, keep it to a small surgical edit and say so in `HANDOFF.md`.
4. **One task, one or more small commits.** Run `git pull --rebase` before every push. Never force-push, never rewrite pushed history.
5. **When a task is done:** set it to `done`, add a line to `HANDOFF.md` (what changed, how to see it, anything left), and push.
6. Commits are authored as OxxBishop with **no Co-Authored-By or other trailers**. Public copy: no em dashes, no AI-copy tells.

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
| `src/plaza.js`, `src/hub.js`, `src/volclouds.js`, `src/assets.js`, `src/kaykit.js`, new `src/space.js`, new `src/casino.js`, new `src/loader.js` | B |
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
| 8 | A5 | NPC slots: a singer on a stage in the square with Chogs gathered round, a Chog sniffing a flower, a Chog running around with a toy block | Oct 18 | C2 models | doing |
| 9 | A9 | Chog-to-Chog chats in the bar, using C's brain. This is the clip the demo leads with | Oct 18 | C5 | doing |

### Agent B: world polish, load time, the world from space, casino
| Order | # | Task | Target | Needs | Status |
|---|---|---|---|---|---|
| 1 | B2 | Load time: first frame in under 10 s on a slow laptop (show the world first and stream the clouds in after, real progress in the loader, cache assets). Today it is 40 to 60 s | Oct 14 | | done |
| 2 | B1 | Plaza benches: tidy rings facing the fountain and rows along the paths, no random angles | Oct 14 | | done |
| 3 | B7 | **World seen from space** (`src/space.js`): the whole archipelago as a little diorama floating in a starry void, with the grey Chogs still visible wandering. Used when the user is carried out (sale, logoff) and as the backdrop behind sign-in. Export `enterSpace({from, duration})` and `leaveSpace()` so A's cutscenes just call it. A needs this by Oct 17 | Oct 16 | | todo |
| 4 | B3 | Lobby facade: warm and welcoming like the bar and casino (it is still the grey sci-fi panel body) | Oct 16 | | done |
| 5 | B4 | Clouds: check for a grainy, dithered look in the overview at normal frame rates and fix it | Oct 17 | | done |
| 6 | B5 | World overview flight for the demo's opening shot (drone path over the islands at golden hour) | Oct 18 | | done |
| 7 | B8 | Casino (only if everything above, and A1 to A7, are done): one game, free chips only, Chog traits give perks (bonus chips, re-rolls, small multipliers), leaderboard. Never wager $CHOG | Oct 19 | | todo |
| 8 | B6 | Casino spin effect, the casino's own cutscene | Oct 19 | B8 | todo |

### Agent C: tools, models, brain, sound, video
| Order | # | Task | Target | Needs | Status |
|---|---|---|---|---|---|
| — | C1 | Testnet Chog collection (deployed `0x85a9ba85e5a3e87bab529c402140a87a72622b91`) and trait extraction (`tools/`) | | | done |
| 1 | C5 | **Chog brain**: a Vercel function (`api/chat`) on Claude Haiku 5.5. It gives each Chog a personality from its traits and remembers by token (places, friends) and by owner (mannerisms, chats), with owner memories wiped on transfer. Plus `src/brain.js` for A. **Code done and tested (mock mode); live once the key and Upstash Redis are set in Vercel** | Oct 15 | the user's API key | doing |
| ongoing | C2 | Prep each Tripo model the user exports: check the rig, slim it for the web, drop it into `public/models/`, note it in `HANDOFF.md` | as they come | | doing |
| ongoing | C3 | Review every push against this board, and keep the board current | daily | | doing |
| 2 | C6 | Sound: the singer's song in the square, ambient island sound, UI and cutscene stings (all royalty-free), in `src/audio.js` | Oct 17 | | todo |
| 3 | C4 | Demo video shot list, with matching `?demo=` camera paths in the app so each shot replays exactly | Oct 18 | B5 | todo |
| 4 | C7 | **Demo video edit**: record each shot from the app, then cut a 3-minute video with titles, music and the sale cutscene as the climax (ffmpeg) | Oct 20 | C4, A6 | todo |
| 5 | C8 | Submission text: pitch, how it works, tech stack, future vision, links | Oct 21 | | todo |
