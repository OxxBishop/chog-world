/*
 * The casino's rules, and what a Chog's traits give it there (B23).
 *
 * The house keeps its edge whatever the Chog. The slots return 94% of what is bet and the roulette
 * 97.3%; a Chog's always-on edges lift that a little, to 98.5% at most, never to an even game. The big
 * moments come from power-ups a Chog gets a few of each day (free spins, wild spins, re-rolls, nudges,
 * a second spin of the wheel, a lost bet back, a near miss saved), so traits change a day's luck, not
 * the odds. Every Chog has edges in both games:
 *
 *   Tier        the day's free chips (Rare and up, free spins too)
 *   Eyes        a skill at the slots: wild spins, re-rolls, nudges, a hot streak
 *   Body        how the slots pay: a symbol that pays a bit more, free spins, a lost bet back
 *   Head        luck at the roulette: a lucky number that can pay 50 to 1, a shield on zero, a second spin
 *   Mouth       a small extra at the roulette
 *   Accessory   a lucky charm, for either game
 *   Aura        the colour of your wins, and a little more for three Chogs
 *   Base, Skin, Background, Naked   a rare one's bonus
 *   Token id    everyone's lucky number at the roulette
 *
 * perksFor(traits, id) adds them up into what the games read, and a list to show, one line per edge.
 * slotsReturn(perks) and rouletteReturn(perks) give the long-run return, worked out exactly.
 */

const has = (re, v) => re.test(String(v ?? ''));

// ---------- the slots ----------
// Twelve stops a reel, the rarer symbols paying more. Returns about 94% of what is bet, and something
// comes back on 4 spins in 10. The jackpot (three Chogs) is 1 in 1728.
export const SYMBOLS = ['chog', 'coin', 'die', 'chip', 'star', 'heart'];
export const STRIP = ['heart', 'die', 'star', 'chip', 'heart', 'coin', 'star', 'die', 'heart', 'chog', 'star', 'chip'];
export const THREE_OF = { chog: 150, coin: 50, die: 20, chip: 12, star: 8, heart: 6 };
export const NAMES = { chog: 'Chogs', coin: 'Coins', die: 'Dice', chip: 'Chips', star: 'Stars', heart: 'Hearts' };
const ONE = { chog: 'Chog', coin: 'coin', die: 'die', chip: 'chip', star: 'star', heart: 'heart' };

/**
 * What a line pays, as a multiple of the bet, with a Chog's perks p (or none). wild, on a wild spin:
 * { symbol, mid }, the symbol that stands in for any other (on the middle reel only, if mid). A wild
 * never makes the jackpot: three Chogs have to be three real Chogs.
 * { k, three, wild }: three names the symbol a three of a kind was made of; wild, whether a wild made it.
 */
export function payout(line, p = null, wild = null) {
  const pays = p?.slots.three ?? THREE_OF;
  const [a, b, c] = line;
  if (a === b && b === c) return { k: pays[a], three: a, wild: false };
  let best = { k: 0, three: null, wild: false };
  if (wild) {
    const w = wild.symbol;
    for (const s of SYMBOLS) {
      if (s === 'chog') continue;
      const ok = wild.mid ? a === s && c === s && b === w : line.every((x) => x === s || x === w);
      if (ok && pays[s] > best.k) best = { k: pays[s], three: s, wild: true };
    }
  }
  const chogs = line.filter((s) => s === 'chog').length;
  const k = chogs === 2 ? (p?.slots.twoChogs ?? 6) : chogs === 1 ? 1 : a === b ? 1 : 0;
  return k > best.k ? { k, three: null, wild: false } : best;
}

// Every line of three stops, weighted equally: what a spin returns on average, and how often it wins.
function slotOdds(p, wild = null) {
  let back = 0, wins = 0, winBack = 0;
  const n = STRIP.length;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let l = 0; l < n; l++) {
    const { k } = payout([STRIP[i], STRIP[j], STRIP[l]], p, wild);
    back += k;
    if (k > 1) {
      wins++;
      winBack += k;
    }
  }
  const all = n * n * n;
  return { back: back / all, win: wins / all, winBack: winBack / all };
}

/**
 * The slots' long-run return for these perks (1 = an even game), with the hot streak counted: a win
 * after j wins in a row pays streak x j more (up to 4).
 */
export function slotsReturn(p) {
  const o = slotOdds(p);
  const q = o.win;
  const run = q + q * q + q ** 3 + q ** 4;
  return o.back + o.winBack * (p?.slots.streak ?? 0) * run;
}
/** What one wild spin returns, for these perks. */
export const wildSpinReturn = (p) => slotOdds(p, p.slots.wild).back;

// ---------- the roulette ----------
// The European wheel's red numbers.
export const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

/**
 * The roulette's long-run return for these perks, for the best bet there is (1 = an even game). Only
 * the shield is always on: zero gives back half of the bets it covers. Every other roulette edge is a
 * few times a day.
 */
export function rouletteReturn(p) {
  return p.roulette.shield ? 36.5 / 37 : 36 / 37;
}

// ---------- the perks ----------
function blank() {
  return {
    daily: 500,
    cashback: 0, // lost bets back a day, either game, up to 100 chips each
    slots: {
      free: 0, // free spins a day
      wild: null, // { n, symbol, mid }: wild spins a day, the symbol that's wild on them, and if only on the middle reel
      rerolls: 1, // after a losing spin, spin one reel again
      nudges: 0, // after a losing spin, move one reel one stop
      streak: 0, // each win in a row pays this much more, up to four times
      three: { ...THREE_OF },
      twoChogs: 6,
    },
    roulette: {
      lucky: null, // everyone's lucky number
      luckySave: 1, // a day: when the lucky number comes up, every bet lost on that spin comes back
      luckyBig: 0, // a day: a straight bet on the lucky number that wins pays 50 to 1
      anyBig: 0, // a day: any straight bet that wins pays 50 to 1
      shield: null, // 'outside' or 'all': zero gives back half of those bets
      second: 0, // a day: after a losing spin, the lost bets ride again for free
      near: 0, // a day: a straight bet that misses by one pocket comes back
      colour: { red: 0, black: 0 }, // a day: a losing bet on that colour comes back
      even: 0, // a day: a losing even-money bet (red, black, odd, even, low, high) comes back
      dozen: 0, // a day: a losing dozen bet comes back
    },
    aura: null,
    list: [],
  };
}

// What an edge does, read off the totals it changes: the casino's badges count down the day's charges
// it gives and light up when one fires.
const TAG_OF = {
  daily: 'daily', cashback: 'cashback', 'slots.free': 'free', 'slots.wild.n': 'wild', 'slots.rerolls': 'rerolls',
  'slots.nudges': 'nudges', 'slots.streak': 'streak', 'slots.twoChogs': 'pays:two',
  'roulette.luckyBig': 'luckyBig', 'roulette.anyBig': 'anyBig', 'roulette.shield': 'shield', 'roulette.second': 'second',
  'roulette.near': 'near', 'roulette.colour.red': 'red', 'roulette.colour.black': 'black', 'roulette.even': 'even',
  'roulette.dozen': 'dozen', aura: 'aura',
};
function flat(o, pre = '', out = {}) {
  for (const [k, v] of Object.entries(o)) {
    if (k === 'list') continue;
    if (v && typeof v === 'object') flat(v, `${pre}${k}.`, out);
    else out[`${pre}${k}`] = v;
  }
  return out;
}
// One edge: what it does to the totals, and its line on the panel.
function edge(p, trait, name, text, game, apply) {
  const before = flat(p);
  apply(p);
  const tags = [];
  for (const [k, v] of Object.entries(flat(p))) {
    if (before[k] === v) continue;
    const tag = k.startsWith('slots.three.') ? `pays:${k.slice(12)}` : TAG_OF[k];
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
  p.list.push({ trait, name, text, game, tags });
}
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const S = 'slots', R = 'roulette', BOTH = 'both';

// The always-on slot edges: one symbol's three of a kind pays a bit more (never less).
const boost = (s, k) => (q) => (q.slots.three[s] = Math.max(q.slots.three[s], k));
// A wild spin returns about 1.4 to 1.6 times the bet: the Chog (one stop a reel) is wild on every
// reel, a star or a heart (three stops a reel) on the middle reel only.
const wilds = (n, symbol) => (q) => {
  const s = q.slots.wild?.symbol ?? symbol;
  q.slots.wild = { n: (q.slots.wild?.n ?? 0) + n, symbol: s, mid: s !== 'chog' };
};
const wildText = (n, s) => `${plural(n, 'wild spin')} a day: the ${ONE[s]}${s === 'chog' ? '' : ' on the middle reel'} stands in for any symbol`;
const streak = (k) => (q) => (q.slots.streak = Math.max(q.slots.streak, k));
const streakText = (k) => `each win in a row pays ${Math.round(k * 100)}% more, up to +${Math.round(k * 400)}%`;

const tierChips = { Common: 500, Uncommon: 600, Rare: 800, Epic: 1000, Legendary: 1500 };
const tierSpins = { Rare: 1, Epic: 2, Legendary: 3 };

function eyes(p, v) {
  if (!v) return;
  if (has(/purple laser/i, v)) return edge(p, v, 'Laser wild', wildText(2, 'chog'), S, wilds(2, 'chog'));
  if (has(/fire laser/i, v)) return edge(p, v, 'Hot streak', streakText(0.1), S, streak(0.1));
  if (has(/green laser/i, v)) return edge(p, v, 'Green light', '3 more re-rolls a day', S, (q) => (q.slots.rerolls += 3));
  if (has(/laser/i, v)) return edge(p, v, 'Lock-on', '3 nudges a day: move a reel one stop', S, (q) => (q.slots.nudges += 3));
  if (has(/heart/i, v)) return edge(p, v, 'Love struck', wildText(1, 'heart'), S, wilds(1, 'heart'));
  if (has(/btc glass/i, v)) return edge(p, v, 'Coin vision', 'three coins pay 75, not 50', S, boost('coin', 75));
  if (has(/visor|vr|3d glass|anime glass|retro glass|viper/i, v)) return edge(p, v, 'Clear sight', '2 nudges a day: move a reel one stop', S, (q) => (q.slots.nudges += 2));
  if (has(/thug/i, v)) return edge(p, v, 'Street smart', '2 lost bets back a day', BOTH, (q) => (q.cashback += 2));
  if (has(/cry|tear/i, v)) return edge(p, v, 'Tears of joy', '1 free spin a day', S, (q) => (q.slots.free += 1));
  if (has(/dead|xd/i, v)) return edge(p, v, 'Nine lives', '2 free spins a day', S, (q) => (q.slots.free += 2));
  if (has(/clown/i, v)) return edge(p, v, 'Wild card', wildText(2, 'star'), S, wilds(2, 'star'));
  if (has(/frog/i, v)) return edge(p, v, 'Leap', '2 nudges a day: move a reel one stop', S, (q) => (q.slots.nudges += 2));
  if (has(/angry|mog|vertical/i, v)) return edge(p, v, 'Fired up', streakText(0.1), S, streak(0.1));
  if (has(/tired/i, v)) return edge(p, v, 'Power nap', '1 free spin a day', S, (q) => (q.slots.free += 1));
  if (has(/retard/i, v)) return edge(p, v, 'Beginner\'s luck', wildText(1, 'star'), S, wilds(1, 'star'));
  if (has(/side eye|smirk/i, v)) return edge(p, v, 'Sly look', '2 more re-rolls a day', S, (q) => (q.slots.rerolls += 2));
  return edge(p, v, 'Keen eye', '1 more re-roll a day', S, (q) => (q.slots.rerolls += 1));
}

function body(p, v) {
  if (!v) return;
  if (has(/kings robe|jesus/i, v)) return edge(p, v, 'Royal', 'three Chogs pay 180, not 150', S, boost('chog', 180));
  if (has(/golden armor/i, v)) return edge(p, v, 'Golden', 'three coins pay 80, not 50', S, boost('coin', 80));
  if (has(/wizard/i, v)) return edge(p, v, 'Spellbound', wildText(2, 'star'), S, wilds(2, 'star'));
  if (has(/tuxedo|gangster|mafia|ceo/i, v)) return edge(p, v, 'Sharp dresser', 'two Chogs pay 7, not 6', S, (q) => (q.slots.twoChogs = Math.max(q.slots.twoChogs, 7)));
  if (has(/inmate|prisoner|squid game|stripes/i, v)) return edge(p, v, 'Get out of jail', '2 lost bets back a day', BOTH, (q) => (q.cashback += 2));
  if (has(/shark|dragon|banana|duck|toad|mummy/i, v)) return edge(p, v, 'Costume party', '2 free spins a day', S, (q) => (q.slots.free += 2));
  if (has(/astro|sci fi/i, v)) return edge(p, v, 'Zero gravity', '2 nudges a day: move a reel one stop', S, (q) => (q.slots.nudges += 2));
  if (has(/hawaiian|yukata|farmer|chinese/i, v)) return edge(p, v, 'Holiday', 'three hearts pay 7, not 6', S, boost('heart', 7));
  if (has(/homeless|holed/i, v)) return edge(p, v, 'Rags to riches', '200 more free chips a day', BOTH, (q) => (q.daily += 200));
  if (has(/jersey|trackset|hoodie|fire shirt/i, v)) return edge(p, v, 'On a run', streakText(0.1), S, streak(0.1));
  if (has(/vest|jacket/i, v)) return edge(p, v, 'Deep pockets', 'three chips pay 15, not 12', S, boost('chip', 15));
  return edge(p, v, 'Lucky shirt', '1 free spin a day', S, (q) => (q.slots.free += 1));
}

// The lucky number a cap gives, from what's on it.
function capNumber(v, id) {
  if (has(/dollar/i, v)) return 7;
  if (has(/btc|buttcoin/i, v)) return 21;
  if (has(/10k tps/i, v)) return 10;
  if (has(/eth/i, v)) return 2;
  if (has(/star/i, v)) return 5;
  if (has(/thunder/i, v)) return 33;
  if (has(/mon/i, v)) return 14;
  return (id % 36) + 1;
}

function head(p, v, id) {
  if (!v) return;
  const big = (n, times = 1) => (q) => {
    q.roulette.lucky = n;
    q.roulette.luckyBig += times;
  };
  const bigText = (n, times = 1) => `lucky number ${n}: a straight bet on it pays 50 to 1, not 35, ${times === 1 ? 'once' : 'twice'} a day`;
  if (has(/^crown$/i, v)) return edge(p, v, 'Royal', 'when zero comes up, half of every bet comes back', R, (q) => (q.roulette.shield = 'all'));
  if (has(/diamond/i, v)) return edge(p, v, 'Diamond', bigText(id % 37, 2), R, big(id % 37, 2));
  if (has(/wreath|thorn|holy seal/i, v)) return edge(p, v, 'Blessed', 'when zero comes up, half of every bet comes back, and 1 second spin a day', R, (q) => {
    q.roulette.shield = 'all';
    q.roulette.second += 1;
  });
  if (has(/wizard/i, v)) return edge(p, v, 'Second sight', '1 second spin a day: after a loss, the bets ride again for free', R, (q) => (q.roulette.second += 1));
  if (has(/3rd eye/i, v)) return edge(p, v, 'Third eye', `${bigText(id % 37)}, and 2 second spins a day`, R, (q) => {
    big(id % 37)(q);
    q.roulette.second += 2;
  });
  if (has(/void horn/i, v)) return edge(p, v, 'Void', 'the first 2 losing bets on black each day come back', R, (q) => (q.roulette.colour.black += 2));
  if (has(/horn/i, v)) return edge(p, v, 'Red devil', 'the first 2 losing bets on red each day come back', R, (q) => (q.roulette.colour.red += 2));
  if (has(/spartan|headband|durag|head wrap/i, v)) return edge(p, v, 'Shield', 'when zero comes up, half of your outside bets come back', R, (q) => (q.roulette.shield ??= 'outside'));
  if (has(/bucket|russian|beanie|bob hair/i, v)) return edge(p, v, 'Good neighbours', 'a straight bet that misses by one pocket comes back, twice a day', R, (q) => (q.roulette.near += 2));
  if (has(/robber|mafia|bandana/i, v)) return edge(p, v, 'Heist', '2 lost bets back a day', BOTH, (q) => (q.cashback += 2));
  if (has(/plumber/i, v)) return edge(p, v, 'Pipe dream', '1 second spin a day: after a loss, the bets ride again for free', R, (q) => (q.roulette.second += 1));
  if (has(/clown|rainbow wig/i, v)) return edge(p, v, 'Juggler', 'a straight bet that misses by one pocket comes back, 3 times a day', R, (q) => (q.roulette.near += 3));
  if (has(/shroom|taped banana|8 ball/i, v)) return edge(p, v, 'Odd one', bigText(id % 37, 2), R, big(id % 37, 2));
  // The caps: a lucky number from what's on them.
  const n = capNumber(v, id);
  return edge(p, v, 'Lucky number', bigText(n), R, big(n));
}

function mouth(p, v) {
  if (!v) return;
  if (has(/gold tooth/i, v)) return edge(p, v, 'Gold tooth', 'your first straight win each day pays 50 to 1, not 35', R, (q) => (q.roulette.anyBig += 1));
  if (has(/btc coin|mon coin/i, v)) return edge(p, v, 'Coin in the mouth', '2 lost bets back a day', BOTH, (q) => (q.cashback += 2));
  if (has(/bubblegum|lip bite|grit/i, v)) return edge(p, v, has(/bubblegum/i, v) ? 'Bubble' : 'Nerve', '1 second spin a day: after a loss, the bets ride again for free', R, (q) => (q.roulette.second += 1));
  if (has(/rainbow/i, v)) return edge(p, v, 'Rainbow', 'when zero comes up, half of every bet comes back', R, (q) => (q.roulette.shield = 'all'));
  if (has(/drool/i, v)) return edge(p, v, 'Sweet spot', 'a straight bet that misses by one pocket comes back, twice a day', R, (q) => (q.roulette.near += 2));
  if (has(/clown/i, v)) return edge(p, v, 'Big grin', 'a straight bet that misses by one pocket comes back, 3 times a day', R, (q) => (q.roulette.near += 3));
  if (has(/^wo$/i, v)) return edge(p, v, 'Whistle', 'the first 2 losing even-money bets each day come back', R, (q) => (q.roulette.even += 2));
  if (has(/sad|worried/i, v)) return edge(p, v, 'Sympathy', 'your first lost bet each day comes back', BOTH, (q) => (q.cashback += 1));
  if (has(/flat/i, v)) return edge(p, v, 'Poker face', 'when zero comes up, half of your outside bets come back', R, (q) => (q.roulette.shield ??= 'outside'));
  // Smiles.
  return edge(p, v, 'Charm', 'the first losing even-money bet each day comes back', R, (q) => (q.roulette.even += 1));
}

function accessory(p, v) {
  if (!v) return;
  const charms = {
    Coin: ['Lucky coin', '2 free spins a day', S, (q) => (q.slots.free += 2)],
    Heart: ['Heart charm', wildText(1, 'heart'), S, wilds(1, 'heart')],
    'Green Candle': ['Green candle', streakText(0.15), S, streak(0.15)],
    'Red Candle': ['Red candle', 'the first 2 losing bets on red each day come back', R, (q) => (q.roulette.colour.red += 2)],
    Fwog: ['Fwog', '2 nudges a day: move a reel one stop', S, (q) => (q.slots.nudges += 2)],
    PEPE: ['Pepe', wildText(1, 'chog'), S, wilds(1, 'chog')],
    Cigar: ['High roller', 'your first straight win each day pays 50 to 1, not 35', R, (q) => (q.roulette.anyBig += 1)],
    Knife: ['Sharp', '2 more re-rolls a day', S, (q) => (q.slots.rerolls += 2)],
    SB: ['Side bet', 'the first 2 losing dozen bets each day come back', R, (q) => (q.roulette.dozen += 2)],
  };
  const c = charms[v];
  if (c) edge(p, v, ...c);
}

// The aura's colour lights your wins, and gives three Chogs a little more.
const AURAS = { fire: '#ff7a3a', burn: '#ff5a2a', fier: '#ff8a3a', aqua: '#4fe3ff', rose: '#ff7fb0', purple: '#b07cff', violet: '#9a6bff', mint: '#7ff0c9', wind: '#cfe8ff', clean: '#ffffff', royal: '#6f8cff', smoke: '#b8b0c8', cool: '#7fd0ff', yellow: '#ffd84a', green: '#6fe36f', pink: '#ffa3d4', electric: '#7ff6ff', white: '#ffffff' };
function aura(p, v) {
  if (!v) return;
  const key = Object.keys(AURAS).find((k) => String(v).toLowerCase().includes(k));
  edge(p, v, 'Aura', 'your wins light up in its colour, and three Chogs pay 10% more', BOTH, (q) => {
    q.aura = AURAS[key] ?? '#ffd27a';
    q.slots.three.chog = Math.round(q.slots.three.chog * 1.1);
  });
}

function rare(p, t, id) {
  if (t.Base === 'Skull' || t.Form === 'Skull') edge(p, 'Skull', 'Lucky 13', 'lucky number 13: a straight bet on it pays 50 to 1, not 35, once a day', R, (q) => {
    q.roulette.lucky = 13;
    q.roulette.luckyBig = Math.max(q.roulette.luckyBig, 1);
  });
  if (t.Base === 'Radioactive') edge(p, 'Radioactive', 'Glow', '3 free spins a day', S, (q) => (q.slots.free += 3));
  if (t.Base === '1:1') edge(p, '1:1', 'One of one', `${wildText(2, 'chog')}, and 1 second spin of the wheel`, BOTH, (q) => {
    wilds(2, 'chog')(q);
    q.roulette.second += 1;
  });
  if (['Metal', 'Jade', 'Multi Colored', 'Purple', 'Gold', 'Blue', 'White', 'Green', 'Beige', 'Grey'].includes(t.Skin)) edge(p, `${t.Skin} skin`, 'Rare skin', '200 more free chips a day', BOTH, (q) => (q.daily += 200));
  else if (t.Skin === 'Red') edge(p, 'Red skin', 'Red', 'your first losing bet on red each day comes back', R, (q) => (q.roulette.colour.red += 1));
  else if (t.Skin === 'Black') edge(p, 'Black skin', 'Black', 'your first losing bet on black each day comes back', R, (q) => (q.roulette.colour.black += 1));
  if (['Gold', 'Supreme Purple', 'Noble Blue', 'Blood Red', 'Royal Blue', 'Red Sky', 'Deep Purple', 'Magenta', 'Bright Yellow', 'Afternoon Orange', 'Aqua Blue', 'Rose Pink', 'Radioactive'].includes(t.Background)) edge(p, `${t.Background} sky`, 'Rare sky', '300 more free chips a day', BOTH, (q) => (q.daily += 300));
  if (t.Naked === 'Yes') edge(p, 'Naked', 'Nothing to hide', '1 free spin a day', S, (q) => (q.slots.free += 1));
}

/**
 * Every edge a Chog's traits give it (traits as in public/data/chogs.json; id its token id). A guest
 * plays as a Common, lucky number 7.
 */
export function perksFor(traits = {}, id = 7) {
  const p = blank();
  const tier = tierChips[traits.Tier] ? traits.Tier : 'Common';
  const spins = tierSpins[tier] ?? 0;
  edge(p, tier, tier, `${tierChips[tier]} free chips a day${spins ? `, and ${plural(spins, 'free spin')}` : ''}`, BOTH, (q) => {
    q.daily = tierChips[tier];
    q.slots.free += spins;
  });
  eyes(p, traits.Eyes);
  body(p, traits.Body);
  head(p, traits.Head, id);
  mouth(p, traits.Mouth);
  accessory(p, traits.Accessory);
  aura(p, traits.Aura);
  rare(p, traits, id);
  // Everyone has a lucky number at the roulette, and it saves a losing spin once a day.
  const r = p.roulette;
  r.lucky ??= id % 37;
  p.list.push({ trait: `#${id}`, name: `Lucky ${r.lucky}`, text: `once a day, when ${r.lucky} comes up, every bet you lost on that spin comes back`, game: R, tags: ['luckySave'] });
  return p;
}

/** A day's power-ups, fresh: what the panel counts down. */
export function chargesFor(p) {
  const r = p.roulette;
  return {
    free: p.slots.free, wild: p.slots.wild?.n ?? 0, rerolls: p.slots.rerolls, nudges: p.slots.nudges,
    cashback: p.cashback,
    second: r.second, near: r.near, luckySave: r.luckySave, luckyBig: r.luckyBig, anyBig: r.anyBig,
    red: r.colour.red, black: r.colour.black, even: r.even, dozen: r.dozen,
  };
}
