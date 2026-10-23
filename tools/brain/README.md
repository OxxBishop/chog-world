# The Chog brain

Each Chog talks, has a personality from its traits, and remembers. Runs as two Vercel functions on
Claude Haiku 5.5.

## Endpoints

### `POST /api/chat`: talk to your Chog
```json
{ "id": 594, "session": { "address": "0x…", "message": "chog-world.vercel.app wants you to sign in…", "signature": "0x…" },
  "text": "hi!", "place": "the plaza", "hour": 18.5 }
```
- **Guests:** use `"session": { "demo": true, "demoKey": "<12+ chars>" }`. They can only talk to the demo Chog (#43), and their memories expire after a day.
- **Reply:** `{ "reply": "…", "mood": "happy", "learned": ["likes surfing"], "newKeeper": false }`
- **Moods:** `happy`, `excited`, `calm`, `curious`, `surprised`, `sleepy`, `sad`.

### `POST /api/chogchat`: two Chogs meet
```json
{ "a": 7, "b": 9, "place": "the bar", "hour": 21 }
```
- **Reply:** `{ "lines": [{ "who": "a", "text": "…", "mood": "happy" }, …] }`, 4 to 6 lines.
- **Cache:** scenes are cached per pair and place for 10 minutes.

From the app, use `src/brain.js`: `talk({ id, session, text, place })` and `chogsChat({ a, b, place })`.

## What it remembers

- **The Chog's own life** (per token): places, meetings at the bar, plans. Stays with the token for ever.
- **Its keeper** (per token and keeper): name, likes, habits, how they talk, plus the recent chat. When the Chog turns up with a new keeper, the old keeper's memories are **deleted**. The new owner gets the same Chog, never the same buddy, and nothing private carries over.

## Safety and cost

- **Sign-in:** the app's sign-in signature is verified on every call. The message is a standard Sign-In with Ethereum (EIP-4361) message: it must be recent, name the signer, Monad testnet and this site (chog-world.vercel.app, its previews, or a host in `SIGNIN_HOSTS`), and the wallet must own the Chog on Monad testnet at that moment.
- **Rate limits:**
  - 15 messages a minute per keeper
  - 400 a day per keeper (60 for guests)
  - 40 a minute per IP
  - 3,000 an hour overall
  - Chog-to-Chog chats: 8 a minute per IP, 600 an hour overall
- **Cost:** Claude Haiku 5.5 at $0.10 / $0.50 per million tokens comes to about $0.0002 a message, so 1,000 messages cost about 20 cents. **Set a monthly spend limit** in the Anthropic console.

## Setup (Vercel)

1. **`ANTHROPIC_API_KEY`:** Vercel project → Settings → Environment Variables. Production and Preview.
2. **Memory storage:** Vercel project → Storage → add **Upstash Redis** (free tier). It sets `KV_REST_API_URL` and `KV_REST_API_TOKEN` automatically. Without it, memories live in function memory and are lost on every cold start.
3. **Redeploy.**

## Local dev

- `npm run dev` serves `/api/*` too (a Vite middleware in `vite.config.js`).
- Put `ANTHROPIC_API_KEY=…` in `.env` (gitignored), or `BRAIN_MOCK=1` for canned replies without a key.

## Tests

`node tools/brain/test.mjs` runs 17 checks in mock mode:
- sign-in proof, live testnet ownership, refusals
- memories, and the wipe on a new keeper
- demo limits, scene cache, rate limits

They sign with the testnet deployer key (`~/.chog_testnet_key`), which holds testnet Chogs.
With a key: `BRAIN_LIVE=1 ANTHROPIC_API_KEY=… node tools/brain/test.mjs` also has a real conversation.
