/*
 * POST /api/chogchat — two Chogs meet and chat (at the bar, the fountain...). No keeper present, so
 * no sign-in: it only reads each Chog's world memories and what it knows about its keeper, and adds a
 * note about the meeting to both Chogs' world memory. Cached per pair and place for 10 minutes so a
 * crowd of viewers doesn't re-run (and re-pay for) the same scene.
 * Body: { a, b, place?, hour? }   Reply: { lines: [{ who: 'a' | 'b', text, mood }] }
 */
import { z } from 'zod';
import { personaOf, traitsOf, WORLD } from './_lib/persona.js';
import { worldOf, addWorld, keeperNotesOf } from './_lib/memory.js';
import { ask, apiError, hasKey, MOODS } from './_lib/llm.js';
import { send, readBody, clientIp, limit, timeOfDay } from './_lib/http.js';
import * as store from './_lib/store.js';

const Scene = z.object({
  lines: z.array(z.object({
    who: z.enum(['a', 'b']),
    text: z.string().describe('One line, at most 20 words, in that Chog\'s own voice.'),
    mood: z.enum(MOODS),
  })).describe('4 to 6 alternating lines, starting with a.'),
  noteA: z.string().describe('One short note, from Chog A\'s point of view, about this meeting, for its memory.'),
  noteB: z.string().describe('One short note, from Chog B\'s point of view, about this meeting, for its memory.'),
});

const clean = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const known = (notes) => (notes.length ? notes.slice(-6).map((n) => n.note).join('; ') : 'nothing yet (no keeper, or a new one)');

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  try {
    if (!hasKey()) return send(res, 503, { error: 'The Chog brain is not set up yet.' });
    const body = await readBody(req);
    const a = Number(body.a), b = Number(body.b);
    if (![a, b].every((n) => Number.isInteger(n) && n >= 1 && n <= 1969 && traitsOf(n)) || a === b) return send(res, 400, { error: 'Pick two different Chogs.' });
    const place = clean(body.place, 80) || 'the bar in the Chog Hub';
    const cacheKey = `scene:${Math.min(a, b)}:${Math.max(a, b)}:${place}`;
    const cached = await store.get(cacheKey);
    if (cached) return send(res, 200, { lines: cached.lines.map((l) => ({ ...l, who: (l.who === 'a') === (cached.a === a) ? 'a' : 'b' })), cached: true });

    const over = await limit([
      { key: `cc:${clientIp(req)}`, max: 8, window: 60, message: 'The Chogs need a moment between chats.' },
      { key: 'cc:all:h', max: 600, window: 3600, message: 'The bar is packed. Try again soon.' },
    ]);
    if (over) return send(res, 429, { error: over });

    const [wa, wb, ka, kb] = await Promise.all([worldOf(a), worldOf(b), keeperNotesOf(a), keeperNotesOf(b)]);
    const when = timeOfDay(Number(body.hour));
    const prompt = [
      `Write a short scene: two Chogs bump into each other at ${place}${when ? ` (${when})` : ''}. They chat like old friends or new acquaintances, depending on their memories. They love gossiping about their keepers (affectionately) and about life in Chog World.`,
      `CHOG A\n${personaOf(a, { perks: false })}\nWhat A knows about its keeper: ${known(ka)}\nA's recent life: ${wa.slice(-6).map((n) => n.note).join('; ') || 'nothing notable'}`,
      `CHOG B\n${personaOf(b, { perks: false })}\nWhat B knows about its keeper: ${known(kb)}\nB's recent life: ${wb.slice(-6).map((n) => n.note).join('; ') || 'nothing notable'}`,
      'Rules: 4 to 6 lines, alternating, starting with A. Each line at most 20 words, in that Chog\'s own voice and quirks. Funny, warm, specific. Never mention being an AI. No financial advice. Never reveal anything private (wallets, keys); keeper gossip stays playful and vague (likes, habits, catchphrases).',
    ].join('\n\n');

    const { out } = await ask({ system: [{ text: WORLD, cache: true }], messages: [{ role: 'user', content: prompt }], schema: Scene, maxTokens: 1500 });
    const lines = (out.lines || []).slice(0, 6).map((l) => ({ who: l.who === 'b' ? 'b' : 'a', text: clean(l.text, 160), mood: l.mood })).filter((l) => l.text);
    if (!lines.length) return send(res, 502, { error: 'The Chogs just stared at each other.' });
    await Promise.all([
      addWorld(a, [clean(`At ${place}: ${out.noteA}`, 200)]),
      addWorld(b, [clean(`At ${place}: ${out.noteB}`, 200)]),
      store.set(cacheKey, { a, lines }, 600),
    ]);
    return send(res, 200, { lines });
  } catch (err) {
    if (err instanceof SyntaxError) return send(res, 400, { error: 'Bad request.' });
    const e = apiError(err);
    if (e.refused) return send(res, 200, { lines: [] });
    console.error('chogchat:', err?.message || err);
    return send(res, e.status, { error: e.message });
  }
}
