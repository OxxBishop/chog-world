/*
 * Progress kept per player (the user, 10-23: a new wallet found the last one's quests done and its race
 * time): a record each for every wallet, the demo and guests, keyed as the testnet $CHOG purse keys them
 * (src/purse.js; src/main.js hands the key over with setPlayer). A record from before the change goes to
 * the first wallet (or the demo) to play, so nobody loses what they had; guests start afresh.
 *
 * playerStore(storageKey) -> { get() (this player's record, to read and change), save() }, one per key
 * however many places ask for it (the race and the guide share the race's).
 */
let current = () => 'guest';
export function setPlayer(fn) {
  current = fn;
}
export const playerKey = () => current() || 'guest';

const stores = new Map();
export function playerStore(storageKey) {
  if (stores.has(storageKey)) return stores.get(storageKey);
  let all = {};
  try {
    all = JSON.parse(localStorage.getItem(storageKey) || '{}') || {};
  } catch {}
  // The old shape: one record for the whole browser.
  if (!all.players) all = { players: {}, legacy: Object.keys(all).length ? all : null };
  const save = () => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(all));
    } catch {}
  };
  const store = {
    get() {
      const k = playerKey();
      if (!all.players[k]) {
        all.players[k] = k !== 'guest' && all.legacy ? all.legacy : {};
        if (k !== 'guest') all.legacy = null;
        save();
      }
      return all.players[k];
    },
    save,
  };
  stores.set(storageKey, store);
  return store;
}
