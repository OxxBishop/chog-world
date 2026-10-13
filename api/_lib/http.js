/* Small helpers shared by the brain's endpoints. */
import * as store from './store.js';

export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

export async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const text = Buffer.concat(chunks).toString('utf8');
  if (text.length > 20000) throw Object.assign(new Error('too large'), { status: 413 });
  return JSON.parse(text || '{}');
}

export function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
}

/** Fixed-window limits; resolves to null when allowed, or a message when over. */
export async function limit(rules) {
  for (const { key, max, window, message } of rules) {
    const n = await store.hit(`rl:${key}:${Math.floor(Date.now() / 1000 / window)}`, window);
    if (n > max) return message;
  }
  return null;
}

export const timeOfDay = (hour) => {
  const h = Number.isFinite(hour) ? ((hour % 24) + 24) % 24 : null;
  if (h === null) return null;
  return h < 5 ? 'deep night, the aurora is out' : h < 8 ? 'dawn' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 20 ? 'sunset' : 'night';
};
