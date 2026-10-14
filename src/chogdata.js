/*
 * The Chog Genesis index: each token's official art and traits, from public/data/chogs.json. Testnet
 * token ids match mainnet, so testnet #42 is the same Chog as mainnet #42. Loaded on first use, so it
 * costs nothing until someone signs in.
 */

const BASE = import.meta.env.BASE_URL;
// Backup IPFS gateways for the art, tried in turn when the first is slow or down.
const BACKUP_GATEWAYS = ['https://ipfs.io/ipfs/', 'https://dweb.link/ipfs/'];
let index = null;

export async function loadChogs() {
  index ??= fetch(`${BASE}data/chogs.json`).then((r) => {
    if (!r.ok) throw new Error(`Chog index: ${r.status}`);
    return r.json();
  });
  return index;
}

/** Everything the app shows about one Chog: name, art (with backup copies), traits. */
export async function chogInfo(id) {
  const data = await loadChogs();
  const c = data.chogs[String(id)];
  if (!c) return { id, name: `Chog #${id}`, image: null, images: [], traits: {} };
  const images = [data.gateway, ...BACKUP_GATEWAYS.filter((g) => g !== data.gateway)].map((g) => `${g}${data.cid}/${c.n}.webp`);
  return { id, name: `Chog #${id}`, image: images[0], images, traits: c.t };
}

/** Make the <img data-alt="url url"> tags inside el fall back to the next copy if one fails. */
export function artFallbacks(el) {
  el.querySelectorAll('img[data-alt]').forEach((img) =>
    img.addEventListener('error', () => {
      const [next, ...rest] = img.dataset.alt.split(' ').filter(Boolean);
      if (!next) return void (img.style.display = 'none');
      img.dataset.alt = rest.join(' ');
      img.src = next;
    }),
  );
}

// The Chog for guests: cheerful, in a purple Mon Cap.
export const DEMO_CHOG = 43;

// Which dome a Chog calls home: every Chog has one, shared out round the domes.
export const homeFor = (id, domeCount) => (Math.max(1, id) - 1) % domeCount;
