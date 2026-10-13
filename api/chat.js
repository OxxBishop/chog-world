/*
 * POST /api/chat — talk to your Chog.
 * Body: { id, session: { address, message, signature } | { demo: true, demoKey }, text, place?, hour? }
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
  remember: z.array(z.string()).describe('0 to 2 short new facts about the keeper worth keeping: name, likes, habits, how they talk. Empty if nothing new.'),
  world: z.array(z.string()).describe('0 or 1 short note about something that happened in the Chog\'s own life in this chat (a plan, a promise, a place). Usually empty.'),
});

const clean = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const ago = (t) => {
  const d = (Date.now() - t) / 86400000;
  return d < 1 ? 'today' : d < 2 ? 'yesterday' : `${Math.round(d)} days ago`;
};

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
    const context = [
      mem.newKeeper ? 'You just woke up with a NEW keeper you have never met. Be curious about them.' : '',
      demo ? 'This keeper is a visitor trying you out for a day.' : '',
      mem.notes.length ? `What you know about your keeper:\n${mem.notes.map((n) => `- ${n.note}`).join('\n')}` : 'You know nothing about your keeper yet. Find out who they are, gently.',
      mem.world.length ? `Your own life lately:\n${mem.world.slice(-12).map((n) => `- (${ago(n.t)}) ${n.note}`).join('\n')}` : '',
      place ? `Where you are right now: ${place}.` : '',
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
    const learned = (out.remember || []).map((s) => clean(s, 160)).filter(Boolean).slice(0, 2);
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
