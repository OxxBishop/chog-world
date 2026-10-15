/*
 * The casino's TOP CHOGS board. Free chips only: nothing here touches a wallet or $CHOG.
 * GET  /api/casino?top=8  -> { top: [{ id, name, chips }] }, most chips first.
 * POST /api/casino with { id, chips, session: { address, message, signature } }
 *   -> { chips }: the Chog's best so far. The sign-in must hold the Chog on Monad testnet right now;
 *   the demo Chog and guests stay on their own browser's board. The board keeps each Chog's best.
 */
import { whoIsTalking, AuthError } from './_lib/auth.js';
import { traitsOf } from './_lib/persona.js';
import { send, readBody, clientIp, limit } from './_lib/http.js';
import * as store from './_lib/store.js';

const BOARD = 'casino:best';
export const MAX_CHIPS = 10_000_000;
// Without Redis each server instance would keep its own board, so the client is told the shared
// board is down and shows its own browser's instead (CASINO_MEMORY=1 allows it for local tests).
const up = () => store.persistent || process.env.CASINO_MEMORY === '1';

export default async function handler(req, res) {
  try {
    if (!up()) return send(res, 503, { error: 'The shared board is not set up yet.' });
    if (req.method === 'GET') {
      const q = req.query ?? Object.fromEntries(new URL(req.url ?? '/', 'http://x').searchParams);
      const n = Math.min(20, Math.max(1, Math.floor(Number(q.top)) || 8));
      const rows = await store.top(BOARD, n);
      return send(res, 200, { top: rows.map(({ member, score }) => ({ id: Number(member), name: `Chog #${member}`, chips: score })) });
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'GET or POST only' });

    const body = await readBody(req);
    const id = Number(body.id);
    if (!Number.isInteger(id) || id < 1 || id > 1969 || !traitsOf(id)) return send(res, 400, { error: 'Unknown Chog.' });
    const chips = Number(body.chips);
    if (body.chips === null || body.chips === '' || !Number.isFinite(chips) || chips < 0) return send(res, 400, { error: 'Bad chips.' });

    const { keeper, demo } = await whoIsTalking({ id, session: body.session });
    if (demo) return send(res, 403, { error: "The demo Chog plays on this browser's board." });
    const over = await limit([
      { key: `cip:${clientIp(req)}`, max: 30, window: 60, message: 'Slow down a little.' },
      { key: `ckp:${keeper}`, max: 10, window: 60, message: 'Slow down a little.' },
    ]);
    if (over) return send(res, 429, { error: over });

    const best = await store.best(BOARD, String(id), Math.min(MAX_CHIPS, Math.floor(chips)));
    return send(res, 200, { chips: best });
  } catch (err) {
    if (err instanceof AuthError) return send(res, err.status, { error: err.message });
    if (err instanceof SyntaxError) return send(res, 400, { error: 'Bad request.' });
    console.error('casino:', err?.message || err);
    return send(res, 500, { error: 'The board is resting. Try again soon.' });
  }
}
