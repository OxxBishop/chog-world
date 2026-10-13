# Chog World task board

Chogathon submission closes **2026-10-22 15:00 UTC**. Demo video recorded on Oct 20, Oct 21 is buffer.

Three Claude agents share this repo. This file is how we split the work and avoid colliding.

## How to work

1. **Start of every session:** `git pull --rebase`, then read this file and `HANDOFF.md`.
2. **Claim a task** by setting its status to `doing` and pushing that one-line change before you start.
3. **Stay in your own files** (ownership table below). If you must touch someone else's file, keep it to a small surgical edit and say so in `HANDOFF.md`.
4. **One task, one or more small commits.** Run `git pull --rebase` before every push. Never force-push, never rewrite pushed history.
5. **When a task is done:** set it to `done`, add a line to `HANDOFF.md` (what changed, how to see it, anything left), and push.
6. Commits are authored as OxxBishop with **no Co-Authored-By or other trailers**. Public copy: no em dashes, no AI-copy tells.

## Agents

| Agent | Who | Focus |
|---|---|---|
| **A** | Chog chat on the main account (session `chog-world-72`) | Wallet, Chogs, NPCs, cutscenes |
| **B** | Second Claude Code account | World polish, load time, casino |
| **C** | Lead chat on the main account | Tools, 3D model prep, review, this board |

## File ownership

| Files | Owner |
|---|---|
| `src/chain.js`, `src/session.js`, `src/chog.js`, `src/chogdata.js`, `src/traitmap.js`, `src/npcs.js`, `src/cutscenes.js` | A |
| `src/plaza.js`, `src/hub.js`, `src/volclouds.js`, `src/assets.js`, `src/kaykit.js`, new `src/casino.js`, new `src/loader.js` | B |
| `tools/`, `public/models/`, `public/meta/`, `public/data/`, `TASKS.md` | C |
| `src/main.js`, `index.html`, `src/style.css` | shared: small edits only; add new CSS in your own clearly marked block |
| everything else in `src/` | ask in `HANDOFF.md` first |

## Tasks

Status: `todo`, `doing`, `done`, `blocked`.

### Agent A: wallet, Chogs, NPCs, cutscenes
| # | Task | Status |
|---|---|---|
| A1 | Wallet sign-in on Monad testnet (switch chain, sign a message, read `tokensOf`), then a Chog picker using `public/data/chogs.json` | doing |
| A2 | Sale listener: poll `Transfer(from = user)` every 3 s; on a sale, call the grey-out hook and sign out | todo |
| A3 | Guest mode: "Claim a Chog" (`claimRandom`, faucet link) and "Try a demo Chog" with a **Simulate sale** button | todo |
| A4 | Trait to 3D map (`src/traitmap.js`): trait values map to model files, with a base-Chog fallback. Models arrive in `public/models/` from C | todo |
| A5 | NPC slots: a singer on a stage in the square with Chogs gathered round, a Chog sniffing a flower, a Chog running around with a toy block | doing |
| A6 | **Sale cutscene** (the demo's centrepiece): the Chog looks at the camera, colour drains from the feet up, it walks off grey, the camera pulls back to the island as a diorama in the void, fade, "Your Chog has moved on." | todo |
| A7 | Login and logoff effects | todo |

### Agent B: world polish, load time, casino
| # | Task | Status |
|---|---|---|
| B1 | Plaza benches: tidy rings facing the fountain and rows along the paths, no random angles | done |
| B2 | Load time: first frame in under 10 s on a slow laptop (show the world first and stream the clouds in after, real progress in the loader, cache assets). Today it is 40 to 60 s | doing |
| B3 | Lobby facade: warm and welcoming like the bar and casino (it is still the grey sci-fi panel body) | todo |
| B4 | Clouds: check for a grainy, dithered look in the overview at normal frame rates and fix it | todo |
| B5 | World overview flight for the demo's opening shot (drone path over the islands at golden hour) | todo |
| B6 | Casino (last, Oct 20 to 21, only if A1 to A6 are done): one game, free chips only, Chog traits give perks (bonus chips, re-rolls, small multipliers), leaderboard. Never wager $CHOG | todo |

### Agent C: tools, models, review
| # | Task | Status |
|---|---|---|
| C1 | Testnet Chog collection (deployed `0x85a9ba85e5a3e87bab529c402140a87a72622b91`) and trait extraction (`tools/`) | done |
| C2 | Prep each Tripo model the user exports: check the rig, slim it for the web, drop it into `public/models/`, note it in `HANDOFF.md` | doing |
| C3 | Review every push against this board, and keep the board current | doing |
| C4 | Demo video shot list and submission text (due Oct 20) | todo |
