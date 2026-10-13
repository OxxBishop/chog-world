/*
 * The Chog Genesis index: each token's official art and traits, from public/data/chogs.json. Testnet
 * token ids match mainnet, so testnet #42 is the same Chog as mainnet #42. Loaded on first use, so it
 * costs nothing until someone signs in.
 */

const BASE = import.meta.env.BASE_URL;
let index = null;

export async function loadChogs() {
  index ??= fetch(`${BASE}data/chogs.json`).then((r) => {
    if (!r.ok) throw new Error(`Chog index: ${r.status}`);
    return r.json();
  });
  return index;
}

/** Everything the app shows about one Chog: name, art, traits. */
export async function chogInfo(id) {
  const data = await loadChogs();
  const c = data.chogs[String(id)];
  if (!c) return { id, name: `Chog #${id}`, image: null, traits: {} };
  return { id, name: `Chog #${id}`, image: `${data.gateway}${data.cid}/${c.n}.webp`, traits: c.t };
}

// The Chog for guests: cheerful, in a purple Mon Cap.
export const DEMO_CHOG = 43;

// Which dome a Chog calls home: every Chog has one, shared out round the domes.
export const homeFor = (id, domeCount) => (Math.max(1, id) - 1) % domeCount;
