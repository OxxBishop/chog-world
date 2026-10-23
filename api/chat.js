/*
 * POST /api/chat — talk to your Chog.
 * Body: { id, session: { address, message, signature } | { demo: true, demoKey }, text, place?, hour?, progress? }
 * Reply: { reply, mood, learned: [notes it just picked up], newKeeper }
 */
import { z } from 'zod';
import { whoIsTalking, AuthError } from './_lib/auth.js';
import { personaOf, traitsOf, WORLD, RULES } from './_lib/persona.js';
import { recall, remember } from './_lib/memory.js';
import { ask, apiError, hasKey, MOODS } from './_lib/llm.js';
import { send, readBody, clientIp, limit, timeOfDay } from './_lib/http.js';

const Reply = z.object({
  reply: z.string().describe('What the Chog says, in character, 1 to 3 sentences.'),
  mood: z.enum(MOODS).describe('How the Chog feels saying it; drives its face and animation.'),
  remember: z.array(z.string()).describe('Usually empty. Only a NEW, lasting fact about your keeper as a person that you would still want to know weeks from now: their name or nickname, where they live, their job or studies, pets, people in their life, favourite things, strong likes or dislikes, a catchphrase. Never what they asked or said in this message, never a question, a greeting, a mood of the moment, or anything about you, the cast or Chog World. Never something you already know. A short phrase about them, e.g. "name is Rachel" or "loves spicy noodles". At most one.'),
  world: z.array(z.string()).describe('0 or 1 short note about something that happened in the Chog\'s own life in this chat (a plan, a promise, a place). Usually empty.'),
});

const clean = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
// What the keeper did in this chat (asked, greeted, wondered) is not a fact about them.
const keepable = (n) => !/\b(asked|asks|asking|wants? to know|wanted to know|wondering|wonders|greeted|said (hi|hello|gm)|says (hi|hello|gm)|is chatting|is talking|curious about|question)\b/i.test(n);
const CHANGED = /\b(now|anymore|no longer|not|don't|doesn't|stopped|changed|moved|new)\b/i;
const STOP = new Set(['the', 'and', 'their', 'they', 'keeper', 'keepers', 'has', 'have', 'is', 'are', 'was', 'with', 'for', 'name', 'called']);
const words = (s) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
// Much the same as a note it already has: most of the shorter one's words are in the other.
function same(a, b) {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return a.toLowerCase() === b.toLowerCase();
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size) >= 0.6;
}
const ago = (t) => {
  const d = (Date.now() - t) / 86400000;
  return d < 1 ? 'today' : d < 2 ? 'yesterday' : `${Math.round(d)} days ago`;
};

// What the game says the keeper has done (src/main.js, chatProgress): numbers and the cast's quest titles only.
const QUESTS = new Set(["Toasty's firewood", "Petal's watering can", 'A flower for the King']);
const n = (v, max) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(max, Math.round(Number(v)))) : null);
function dayOf(p) {
  if (!p || typeof p !== 'object') return '';
  const out = [];
  const stars = n(p.stars, 12);
  if (stars !== null) out.push(stars === 12 ? 'found all 12 stars (the sky Chog is lit)' : `found ${stars} of the 12 stars`);
  const bal = n(p.chog, 1e7), got = n(p.got, 1000);
  if (bal !== null) out.push(`${bal} testnet $CHOG in the purse${got !== null ? ` (${got} of 150 earned today)` : ''}`);
  const q = p.quest && QUESTS.has(p.quest.title) ? p.quest : null;
  if (q) out.push(`on the quest "${q.title}" (${n(q.got, 9) ?? 0} of ${n(q.need, 9) ?? 1} found)`);
  const done = Array.isArray(p.done) ? p.done.filter((t) => QUESTS.has(t)) : [];
  if (done.length) out.push(`finished today: ${done.join(', ')}`);
  if (p.raced === true) out.push('beat Patrol in the race today');
  return out.length ? `${out.join('; ')}.` : '';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  try {
    if (!hasKey()) return send(res, 503, { error: 'The Chog brain is not set up yet.' });
    const body = await readBody(req);
    const id = Number(body.id);
    if (!Number.isInteger(id) || id < 1 || id > 1969 || !traitsOf(id)) return send(res, 400, { error: 'Unknown Chog.' });
    const text = clean(body.text, 500);
    if (!text) return send(res, 400, { error: 'Say something.' });

    const { keeper, demo } = await whoIsTalking({ id, session: body.session });
    const over = await limit([
      { key: `ip:${clientIp(req)}`, max: 40, window: 60, message: 'Slow down a little, Chogs need a breather.' },
      { key: `kp:${keeper}`, max: 15, window: 60, message: 'Slow down a little, your Chog needs a breather.' },
      { key: `kpd:${keeper}`, max: demo ? 60 : 400, window: 86400, message: 'Your Chog is tired for today. Come back tomorrow.' },
      { key: 'all:h', max: 3000, window: 3600, message: 'Chog World is very busy right now. Try again soon.' },
    ]);
    if (over) return send(res, 429, { error: over });

    const mem = await recall(id, keeper, { demo });
    const when = timeOfDay(Number(body.hour));
    const place = clean(body.place, 80);
    const day = dayOf(body.progress);
    const context = [
      mem.newKeeper ? 'You just woke up with a NEW keeper you have never met. Be curious about them.' : '',
      demo ? 'This keeper is a visitor trying you out for a day.' : '',
      mem.notes.length ? `What you know about your keeper (oldest first; where two disagree, the later one is true now):\n${mem.notes.map((n) => `- ${n.note}`).join('\n')}` : 'You know nothing about your keeper yet. Find out who they are, gently.',
      mem.world.length ? `Your own life lately:\n${mem.world.slice(-12).map((n) => `- (${ago(n.t)}) ${n.note}`).join('\n')}` : '',
      place ? `Where you are right now: ${place}.` : '',
      day ? `Your keeper's day in Chog World so far: ${day}` : '',
      when ? `Time of day: ${when}.` : '',
    ].filter(Boolean).join('\n\n');

    // The recent chat, then the new line.
    const messages = [];
    for (const turn of mem.log) {
      const role = turn.who === 'keeper' ? 'user' : 'assistant';
      const last = messages.at(-1);
      if (last && last.role === role) last.content += `\n${turn.text}`;
      else messages.push({ role, content: turn.text });
    }
    if (messages[0]?.role === 'assistant') messages.shift();
    if (messages.at(-1)?.role === 'user') messages.at(-1).content += `\n${text}`;
    else messages.push({ role: 'user', content: text });

    const { out } = await ask({
      system: [
        { text: `${WORLD}\n\n${RULES}\n\n${personaOf(id)}`, cache: true },
        { text: context },
      ],
      messages,
      schema: Reply,
    });

    const reply = clean(out.reply, 600);
    // Kept only if it's new and about them (the user, 10-23: "will remember that" after every message).
    // (A change of mind gets through: "hates spicy noodles now" after "loves spicy noodles".)
    const learned = (out.remember || []).map((s) => clean(s, 160)).filter((n) => n && keepable(n) && (CHANGED.test(n) || !mem.notes.some((m) => same(n, m.note)))).slice(0, 1);
    const world = (out.world || []).map((s) => clean(s, 160)).filter(Boolean).slice(0, 1);
    await remember(id, keeper, {
      notes: learned,
      world,
      turns: [{ who: 'keeper', text }, { who: 'chog', text: reply }],
    }, { demo });
    return send(res, 200, { reply, mood: out.mood, learned, newKeeper: mem.newKeeper });
  } catch (err) {
    if (err instanceof AuthError) return send(res, err.status, { error: err.message });
    if (err instanceof SyntaxError) return send(res, 400, { error: 'Bad request.' });
    const e = apiError(err);
    if (e.refused) return send(res, 200, { reply: 'Hmm, let\'s talk about something else!', mood: 'curious', learned: [], newKeeper: false });
    console.error('chat:', err?.message || err);
    return send(res, e.status, { error: e.message });
  }
}
