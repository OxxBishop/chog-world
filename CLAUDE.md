# Chog World: rules for every Claude session in this repo

Chogathon 2026 entry. Submission closes **2026-10-22 15:00 UTC**. Three Claude agents (A, B, C) share this repo.

## Start of every session

1. Run `git pull --rebase`.
2. Read `TASKS.md` (who does what, in order) and `HANDOFF.md` (what changed recently, gotchas).
3. Take **your next task in order**. Don't skip ahead unless the task is blocked; if it is, mark it `blocked` with the reason and take the next one.

## Working on a task: no spinbusying

Finish each task properly in as few passes as possible. Don't creep toward completion in tiny increments
that waste tokens and the user's time.

Always:
- Do the obvious things up front, all at once.
- Fix every problem you find, and keep fixing until the result meets the user's standard of perfect.
- Check for bugs yourself before showing or pushing anything: run it, look at it (screenshots), read the console.
- Suggest better ideas when you see them.

Never:
- Make one small change at a time and stop to check or report.
- Push work you haven't looked at running.

## Task workflow

- **Claim** a task: set its status to `doing` in `TASKS.md` and push that change before you start.
- **Stay in your own files** (ownership table in `TASKS.md`). For a shared file (`src/main.js`, `index.html`, `src/style.css`), make small surgical edits only and never reformat.
- **Branches:** work on **`dev`**, never on `main`. `main` is the live site (Vercel deploys it to production) and only moves when the user says "go live"; C then fast-forwards it to `dev`. Every push to `dev` gets its own preview deployment, and https://chog-world-git-dev-alpha-house.vercel.app always shows the latest `dev`.
- **Commit small and often.** Run `git pull --rebase origin dev` before every `git push origin HEAD:dev`. Never force-push, never rewrite pushed history.
- **When a task is done:** set it to `done` in `TASKS.md`, add an entry at the top of the `HANDOFF.md` log (what changed, how to see it, what is left), push, then start the next task.
- Commits are authored as **OxxBishop** with **no Co-Authored-By or other trailers**.

## Replies to the user

Concise. Skip pleasantries, preambles and recaps of the question. Short declarative sentences. Show results, not narration.

## Project rules

- **Public copy** (site text, README, video titles): no em dashes, no AI-copy tells. Write in the user's voice: cool, but professional.
- **Bot Crossing** is a reference for cosy feel only. Never copy its assets, signs, name or characters.
- **Assets:** CC0 only (KayKit, Kenney). Chog 3D models come from the user via Tripo (auto-rigged); agent C preps them into `public/models/`. Don't hand-model or repaint Chogs in code (the user rejected that look).
- **On-chain:** Monad testnet only (chain 10143), contract `0x85a9ba85e5a3e87bab529c402140a87a72622b91`. The app never sends a mainnet transaction and never holds a private key. The only transaction it can ask for is a free testnet claim.
- **Secrets:** never in code, commits or chat. API keys live in Vercel environment variables.
- **Performance:** the user's laptop has an Intel HD 520. Test with `?q=low` and read `?debug`. It must stay usable there.
- **Quality bar:** visuals decide this entry. Never ship something that looks broken; if a feature can't be made to look good in time, hide it.
