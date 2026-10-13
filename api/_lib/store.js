/*
 * Chog memories live in Redis (Upstash, added through Vercel's Storage tab, which sets
 * KV_REST_API_URL / KV_REST_API_TOKEN or UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN).
 * Talks to Upstash over its REST API with plain fetch. Without those variables (local dev) it falls
 * back to an in-memory store that forgets on restart, and says so once.
 */

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

export const persistent = Boolean(URL_ && TOKEN);
if (!persistent) console.warn('Chog brain: no Redis configured, memories are in-memory only.');

async function redis(...cmd) {
  const r = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(`Redis ${cmd[0]}: ${j.error || r.status}`);
  return j.result;
}

// In-memory fallback with the same small surface.
const mem = new Map();
const expiry = new Map();
const alive = (k) => {
  const e = expiry.get(k);
  if (e && e < Date.now()) {
    mem.delete(k);
    expiry.delete(k);
  }
  return mem.has(k);
};

export async function get(key) {
  if (persistent) {
    const v = await redis('GET', key);
    return v == null ? null : JSON.parse(v);
  }
  return alive(key) ? mem.get(key) : null;
}

export async function set(key, value, ttlSeconds) {
  if (persistent) {
    const args = ['SET', key, JSON.stringify(value)];
    if (ttlSeconds) args.push('EX', String(ttlSeconds));
    return redis(...args);
  }
  mem.set(key, value);
  if (ttlSeconds) expiry.set(key, Date.now() + ttlSeconds * 1000);
  else expiry.delete(key);
}

export async function del(...keys) {
  if (!keys.length) return;
  if (persistent) return redis('DEL', ...keys);
  for (const k of keys) {
    mem.delete(k);
    expiry.delete(k);
  }
}

/** Count a hit in a fixed window; resolves to the count so far in that window. */
export async function hit(key, windowSeconds) {
  if (persistent) {
    const n = await redis('INCR', key);
    if (n === 1) await redis('EXPIRE', key, String(windowSeconds));
    return n;
  }
  const n = (alive(key) ? mem.get(key) : 0) + 1;
  mem.set(key, n);
  if (n === 1) expiry.set(key, Date.now() + windowSeconds * 1000);
  return n;
}

/** Append items to a JSON list kept under one key, keeping only the newest `cap`. */
export async function push(key, items, cap, ttlSeconds) {
  if (!items.length) return;
  const list = (await get(key)) || [];
  list.push(...items);
  await set(key, list.slice(-cap), ttlSeconds);
}
