/*
 * The app's side of the Chog brain (api/chat, api/chogchat).
 *
 *   talk({ id, session, text, place?, hour? }) -> { reply, mood, learned, newKeeper }
 *   chogsChat({ a, b, place?, hour? })         -> { lines: [{ who: 'a' | 'b', text, mood }] }
 *
 * session is the signed-in session from chain.js signIn ({ address, message, signature }) or
 * { demo: true } for a guest; the demo key that keeps a guest's chat together is added here.
 * Moods: happy, excited, calm, curious, surprised, sleepy, sad.
 * Errors throw BrainError with a message that is safe to show in the UI.
 */

export class BrainError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function demoKey() {
  try {
    let k = localStorage.getItem('chog-demo-key');
    if (!k) {
      k = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem('chog-demo-key', k);
    }
    return k;
  } catch {
    // Private windows can refuse storage: keep one for this page load.
    return (demoKey.fallback ??= Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join(''));
  }
}

const localHour = () => {
  const d = new Date();
  return d.getHours() + d.getMinutes() / 60;
};

async function post(path, body) {
  let r;
  try {
    r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new BrainError('Can\'t reach your Chog right now. Check your connection.', 0);
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new BrainError(j.error || 'Your Chog didn\'t answer. Try again.', r.status);
  return j;
}

export async function talk({ id, session, text, place, hour = localHour() }) {
  const s = session?.demo ? { demo: true, demoKey: demoKey() } : { address: session?.address, message: session?.message, signature: session?.signature };
  return post('/api/chat', { id, session: s, text, place, hour });
}

export async function chogsChat({ a, b, place, hour = localHour() }) {
  return post('/api/chogchat', { a, b, place, hour });
}
