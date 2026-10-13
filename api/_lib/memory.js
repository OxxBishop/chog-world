/*
 * What a Chog remembers, split the way the concept needs:
 *   world   (per token): places, friends, things that happened. Stays with the Chog for ever.
 *   keeper  (per token + keeper): who its keeper is, their mannerisms, the recent chat. Wiped the
 *           moment the Chog is found with a different keeper, so a new owner never gets the old
 *           owner's buddy (and nothing private carries over).
 */
import * as store from './store.js';

const WORLD_CAP = 30;
const NOTES_CAP = 40;
const LOG_CAP = 16; // turns (user + chog lines)
const DEMO_TTL = 24 * 3600;

const k = {
  world: (id) => `chog:${id}:world`,
  keeper: (id) => `chog:${id}:keeper`,
  notes: (id, who) => `chog:${id}:k:${who}:notes`,
  log: (id, who) => `chog:${id}:k:${who}:log`,
};

/**
 * Load everything the Chog knows for this conversation. When the keeper changed since last time,
 * the old keeper's memories are deleted first, and the Chog notes the change in its world memory.
 */
export async function recall(id, keeper, { demo = false } = {}) {
  let newKeeper = false;
  if (!demo) {
    const last = await store.get(k.keeper(id));
    if (last !== keeper) {
      if (last) await store.del(k.notes(id, last), k.log(id, last));
      await store.set(k.keeper(id), keeper);
      if (last) await store.push(k.world(id), [{ t: Date.now(), note: 'Woke up with a new keeper. The old one is gone, and so are the memories of them.' }], WORLD_CAP);
      newKeeper = Boolean(last);
    }
  }
  const [world, notes, log] = await Promise.all([
    store.get(k.world(id)),
    store.get(k.notes(id, keeper)),
    store.get(k.log(id, keeper)),
  ]);
  return { world: world || [], notes: notes || [], log: log || [], newKeeper };
}

export async function remember(id, keeper, { notes = [], world = [], turns = [] }, { demo = false } = {}) {
  const ttl = demo ? DEMO_TTL : undefined;
  const now = Date.now();
  await Promise.all([
    store.push(k.notes(id, keeper), notes.map((note) => ({ t: now, note })), NOTES_CAP, ttl),
    store.push(k.log(id, keeper), turns, LOG_CAP, ttl),
    demo ? null : store.push(k.world(id), world.map((note) => ({ t: now, note })), WORLD_CAP),
  ]);
}

/** World memory only: used by Chog-to-Chog meetings, where no keeper is present. */
export async function worldOf(id) {
  return (await store.get(k.world(id))) || [];
}
export async function addWorld(id, notes) {
  await store.push(k.world(id), notes.map((note) => ({ t: Date.now(), note })), WORLD_CAP);
}

/** What a Chog knows about its current keeper (for gossip at the bar). Empty if it has none. */
export async function keeperNotesOf(id) {
  const keeper = await store.get(k.keeper(id));
  if (!keeper) return [];
  return (await store.get(k.notes(id, keeper))) || [];
}
