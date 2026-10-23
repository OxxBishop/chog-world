/*
 * What a Chog's traits give it round the islands (the user's pick, 10-23), beside its edges at the tables
 * (src/casinoperks.js) and its tier's testnet $CHOG rate (src/purse.js). One small perk for each of the
 * main traits it has:
 *   Eyes       star sense: stars near you show on the map (60 m, or 90 m through lasers, visors and glasses)
 *   Body       helping hand: 5 more testnet $CHOG for each cast quest
 *   Head       quick start: Patrol waits a moment at the start of the race (a crown, a little longer)
 *   Mouth      big hello: the daily hello is worth 5 more
 *   Aura       star glow: each star is worth 2 more
 *   Accessory  lucky charm: a free wish at the fountain each day
 *
 * islandPerksFor(traits) -> { sense, quest, head, hello, star, wish, list: [{ trait, name, text }] }
 */
const set = (v) => !!v && v !== 'None';

export function islandPerksFor(t = {}) {
  const p = { sense: 0, quest: 0, head: 0, hello: 0, star: 0, wish: false, list: [] };
  const add = (trait, name, text) => p.list.push({ trait, name, text });
  if (set(t.Eyes)) {
    p.sense = /laser|visor|vr|glass|viper/i.test(t.Eyes) ? 90 : 60;
    add(t.Eyes, 'Star sense', `stars within ${p.sense} m show on your map`);
  }
  if (set(t.Body)) {
    p.quest = 5;
    add(t.Body, 'Helping hand', '5 more testnet $CHOG for each cast quest');
  }
  if (set(t.Head)) {
    p.head = /crown/i.test(t.Head) ? 1.2 : 0.7;
    add(t.Head, 'Quick start', `Patrol waits ${p.head} s at the start of the race`);
  }
  if (set(t.Mouth)) {
    p.hello = 5;
    add(t.Mouth, 'Big hello', 'the daily hello is worth 5 more');
  }
  if (set(t.Aura)) {
    p.star = 2;
    add(`${String(t.Aura).replace(/\s*aura$/i, '')} aura`, 'Star glow', 'each star is worth 2 more');
  }
  if (set(t.Accessory)) {
    p.wish = true;
    add(t.Accessory, 'Lucky charm', 'a free wish at the fountain each day');
  }
  return p;
}
