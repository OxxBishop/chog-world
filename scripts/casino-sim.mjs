// The casino's numbers, simulated: node scripts/casino-sim.mjs [seed]
//
// Plays the games the way src/casino.js does (spin, land, take back, spin the wheel, settle it), with the
// rules and trait edges from src/casinoperks.js and src/roulette.js, on a seeded random draw so every
// number it prints comes out the same each run. Free testnet chips only; nothing here touches a chain.
//
// Prints:
//   A. the long-run return of each game (always-on edges only: the traits' and the tier's lift, under the
//      98.5% cap), worked out exactly and checked by simulation, for no traits, typical and rare Chogs, a
//      Legendary, and the best stack the traits allow;
//   B. a 20-round session with the day's power-ups (free and wild spins, re-rolls, nudges, lost bets
//      back, second spins, lucky numbers), for the same Chogs;
//   C. every Chog in the collection by tier: return, what a day's power-ups are worth, and how many
//      spins it takes before the house is ahead again; and whether the return rises with every tier;
//   D. head to head over 15 and 20 rounds: a random Chog of each tier against a random Common.
//
// The player is the same for every Chog: slots at 10 a spin (free spins first, then wild spins; after a
// loss a nudge if one wins, else a re-roll of the best reel, then a lost bet back), roulette at 25 a
// spin (red 10, second dozen 10, the lucky number 5; after a spin with no win, a second spin if there is
// one, else a lost bet back).

import fs from 'fs';
import { perksFor, chargesFor, payout, STRIP, slotsReturn, rouletteReturn, wildSpinReturn, CAP } from '../src/casinoperks.js';
import { settleSpin } from '../src/roulette.js';

const SEED = Number(process.argv[2] ?? 20261022);
const CASHBACK_MAX = 100; // as in src/casino.js
const N = STRIP.length;
const raw = JSON.parse(fs.readFileSync(new URL('../public/data/chogs.json', import.meta.url), 'utf8')).chogs;
const ids = Object.keys(raw).map(Number);
const TIERS = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];

function mulberry(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One slots session: R presses of SPIN at bet B. { net, staked, sq, R, B }: sq for the spread.
function slotsSession(p, R, B, rnd, powerups = true) {
  const ch = chargesFor(p);
  let net = 0, staked = 0, run = 0, sq = 0;
  const k = (stops, wild) => payout(stops.map((i) => STRIP[i]), p, wild).k;
  const land = (stops, stake, wild) => {
    const kk = k(stops, wild);
    let extra = 0;
    if (kk > 1) extra = p.slots.streak * Math.min(run++, 4);
    else run = 0;
    // The game pays whole chips and keeps the change for the next win, so in the long run it pays this.
    net += kk * stake * (1 + extra) * (kk > 1 ? 1 + p.slots.lift : 1);
    return kk;
  };
  for (let r = 0; r < R; r++) {
    const n0 = net;
    let paid = B, wild = null;
    if (powerups && ch.free > 0) ch.free--, (paid = 0);
    else if (powerups && ch.wild > 0) ch.wild--, (wild = p.slots.wild);
    net -= paid;
    staked += paid;
    const stops = [0, 0, 0].map(() => Math.floor(rnd() * N));
    let won = land(stops, B, wild);
    while (powerups && won === 0) {
      if (ch.nudges > 0) {
        let best = -1, bk = 0;
        for (let i = 0; i < 3; i++) {
          const s = stops.slice();
          s[i] = (s[i] + 1) % N;
          if (k(s, wild) > bk) (bk = k(s, wild)), (best = i);
        }
        if (best >= 0) {
          ch.nudges--;
          stops[best] = (stops[best] + 1) % N;
          won = land(stops, B, wild);
          continue;
        }
      }
      if (ch.rerolls > 0) {
        let best = 0, be = -1;
        for (let i = 0; i < 3; i++) {
          let e = 0;
          for (let j = 0; j < N; j++) {
            const s = stops.slice();
            s[i] = j;
            e += k(s, wild);
          }
          if (e > be) (be = e), (best = i);
        }
        ch.rerolls--;
        stops[best] = Math.floor(rnd() * N);
        won = land(stops, B, wild);
        continue;
      }
      if (ch.cashback > 0 && paid > 0) ch.cashback--, (net += Math.min(paid, CASHBACK_MAX));
      break;
    }
    sq += (net - n0) ** 2;
  }
  return { net, staked, sq, R, B };
}

const NONE = { shield: 0, second: 0, near: 0, luckySave: 0, luckyBig: 0, anyBig: 0, red: 0, black: 0, even: 0, dozen: 0, cashback: 0 };
const MIXED = (p) => [{ key: 'red', amount: 10 }, { key: 'd2', amount: 10 }, { key: `n${p.roulette.lucky}`, amount: 5 }];
const RED = () => [{ key: 'red', amount: 25 }];
const LUCKY = (p) => [{ key: `n${p.roulette.lucky}`, amount: 25 }];

// One roulette session: R spins of the same bets. { net, staked, sq, R, B }: sq for the spread.
function rouletteSession(p, R, betsOf, rnd, powerups = true) {
  const ch = powerups ? chargesFor(p) : { ...NONE };
  const bets = betsOf(p);
  const total = bets.reduce((a, b) => a + b.amount, 0);
  let net = 0, staked = 0, sq = 0;
  for (let r = 0; r < R; r++) {
    const n0 = net;
    net -= total;
    staked += total;
    let res = settleSpin(bets, Math.floor(rnd() * 37), p, ch);
    net += res.back + res.bonus;
    const lost = res.results.some((x) => x.back > x.amount) ? [] : res.results.filter((x) => x.back === 0);
    if (lost.length && ch.second > 0) {
      ch.second--;
      res = settleSpin(lost, Math.floor(rnd() * 37), p, ch);
      net += res.back + res.bonus;
    } else if (lost.length && ch.cashback > 0) {
      ch.cashback--;
      net += Math.min(lost.reduce((a, x) => a + x.amount, 0), CASHBACK_MAX);
    }
    sq += (net - n0) ** 2;
  }
  return { net, staked, sq, R, B: total };
}

const pct = (x, d = 2) => `${(x * 100).toFixed(d)}%`;
const signed = (x, d = 1) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d)}%`;
const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const median = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
const P = new Map(ids.map((id) => [id, perksFor(raw[id].t, id)]));

const commons = ids.filter((id) => raw[id].t.Tier === 'Common').sort((a, b) => slotsReturn(P.get(a)) - slotsReturn(P.get(b)));
const medianCommon = commons[Math.floor(commons.length / 2)];
const CAST = [
  ['No traits (a guest)', perksFor({}, 7)],
  [`Common, median (#${medianCommon})`, P.get(medianCommon)],
  ['Rarest traits (#1729, Rare)', P.get(1729)],
  ['Best real slots stack (#331)', P.get(331)],
  ['Epic (#923)', P.get(923)],
  ['Legendary 1:1 (#561)', P.get(561)],
  ['Best stack the traits allow*', perksFor({ Tier: 'Legendary', Eyes: 'BTC Glass', Body: 'Kings Robe', Accessory: 'Green Candle', Aura: 'Fire Aura', Head: 'Crown', Base: '1:1', Mouth: 'Gold Tooth', Skin: 'Gold', Background: 'Gold' }, 1)],
];

console.log(`Chog World casino sim, seed ${SEED}. Slots 10 a spin; roulette 25 a spin.\n`);

console.log(`A. LONG RUN, always-on edges only (the tier's lift included, capped at ${pct(CAP, 1)}). Return to player (RTP) exact, then simulated over 10,000,000 spins (± covers 95% of runs); house edge = 100% - RTP.`);
for (const [name, p] of CAST) {
  const rnd = mulberry(SEED);
  const s = slotsSession(p, 10_000_000, 10, rnd, false);
  const r = rouletteSession(p, 10_000_000, RED, rnd, false);
  // The simulated return, give or take two standard errors (95% of runs land inside).
  const sim = (o) => `${pct(1 + o.net / o.staked)} ±${pct(2 * Math.sqrt((o.sq / o.R - (o.net / o.R) ** 2) / o.R) / o.B)}`;
  console.log(`  ${name.padEnd(32)} slots ${pct(slotsReturn(p))} (sim ${sim(s)}), edge ${pct(1 - slotsReturn(p))}   roulette ${pct(rouletteReturn(p))} (sim ${sim(r)}), edge ${pct(1 - rouletteReturn(p))}`);
}
console.log('  * no real Chog has this stack (Coin vision, Royal, Green candle, an aura, a Legendary): the cap trims it.\n');

console.log("B. A 20-ROUND SESSION with the day's power-ups (50,000 sessions each). House edge on the chips you staked; negative = the player is ahead.");
for (const [name, p] of CAST) {
  const rnd = mulberry(SEED + 1);
  const S = 50000;
  const go = (f) => {
    let n = 0, s = 0, up = 0;
    for (let i = 0; i < S; i++) {
      const o = f();
      n += o.net;
      s += o.staked;
      if (o.net > 0) up++;
    }
    return { edge: -n / s, avg: n / S, up: up / S };
  };
  const sl = go(() => slotsSession(p, 20, 10, rnd));
  const red = go(() => rouletteSession(p, 20, RED, rnd)), luck = go(() => rouletteSession(p, 20, LUCKY, rnd)), mix = go(() => rouletteSession(p, 20, MIXED, rnd));
  const ch = Object.entries(chargesFor(p)).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(', ');
  console.log(`  ${name.padEnd(32)} slots ${signed(sl.edge)} (${sl.avg >= 0 ? '+' : ''}${sl.avg.toFixed(0)} chips, in profit ${pct(sl.up, 0)})   roulette: red ${signed(red.edge)}, lucky number ${signed(luck.edge)}, mixed ${signed(mix.edge)}`);
  console.log(`  ${''.padEnd(32)} ${p.daily} chips a day; power-ups: ${ch}${p.slots.wild ? `; a wild spin returns ${pct(wildSpinReturn(p), 0)}` : ''}`);
}

console.log(`\nC. EVERY CHOG BY TIER (${ids.length}). Power-ups/day = chips a day's power-ups add over the always-on return (600 sessions of 40 rounds per Chog).`);
console.log('  "House ahead after" = spins in a day before the house edge has won those chips back (median).');
const rnd = mulberry(SEED + 2);
const per = ids.map((id) => {
  const p = P.get(id);
  const sr = slotsReturn(p), rr = rouletteReturn(p);
  let sn = 0, ss = 0, rn = 0, rs = 0;
  for (let i = 0; i < 600; i++) {
    const a = slotsSession(p, 40, 10, rnd), b = rouletteSession(p, 40, MIXED, rnd);
    sn += a.net, ss += a.staked, rn += b.net, rs += b.staked;
  }
  const sVal = (sn - ss * (sr - 1)) / 600, rVal = (rn - rs * (rr - 1)) / 600;
  return { id, tier: raw[id].t.Tier, sr, rr, sVal, rVal, sAfter: sVal / (10 * (1 - sr)), rAfter: rVal / (25 * (1 - rr)), daily: p.daily };
});
console.log('  tier         n   slots RTP (min to max)      roulette RTP   chips/day   slots power-ups/day, house ahead after   roulette power-ups/day, house ahead after');
for (const T of TIERS) {
  const g = per.filter((x) => x.tier === T);
  const f = (k) => g.map((x) => x[k]);
  console.log(`  ${T.padEnd(10)} ${String(g.length).padStart(4)}   ${pct(avg(f('sr')))} (${pct(Math.min(...f('sr')))} to ${pct(Math.max(...f('sr')))})   ${pct(avg(f('rr')))}       ${avg(f('daily')).toFixed(0).padStart(5)}      +${avg(f('sVal')).toFixed(0)} chips, ${median(f('sAfter')).toFixed(0)} spins                    +${avg(f('rVal')).toFixed(0)} chips, ${median(f('rAfter')).toFixed(0)} spins`);
}

const tierStats = TIERS.map((T) => {
  const g = per.filter((x) => x.tier === T);
  return { T, s: g.map((x) => x.sr), r: g.map((x) => x.rr) };
});
const rising = (k, f) => tierStats.every((x, i) => i === 0 || f(x[k]) > f(tierStats[i - 1][k]));
const highest = Math.max(...per.map((x) => Math.max(x.sr, x.rr)));
console.log(`  Rises with every tier: slots average ${rising('s', avg) ? 'yes' : 'NO'}, slots lowest ${rising('s', (a) => Math.min(...a)) ? 'yes' : 'NO'}, roulette average ${rising('r', avg) ? 'yes' : 'NO'}, roulette lowest ${rising('r', (a) => Math.min(...a)) ? 'yes' : 'NO'}. Highest return of any Chog: ${pct(highest, 3)} (cap ${pct(CAP, 1)}).`);

console.log('\nD. HEAD TO HEAD (50,000 pairings each): a random Chog of the tier against a random Common, same bets, own luck.');
const by = {};
for (const id of ids) (by[raw[id].t.Tier] ??= []).push(id);
const r2 = mulberry(SEED + 3);
const pick = (a) => a[Math.floor(r2() * a.length)];
for (const game of ['slots', 'roulette']) for (const R of [15, 20]) {
  console.log(`  ${game}, ${R} rounds`);
  for (const T of ['Uncommon', 'Rare', 'Epic', 'Legendary']) {
    let ahead = 0, tie = 0;
    const play = (p) => (game === 'slots' ? slotsSession(p, R, 10, r2) : rouletteSession(p, R, MIXED, r2)).net;
    for (let i = 0; i < 50000; i++) {
      const a = play(P.get(pick(by[T]))), b = play(P.get(pick(by.Common)));
      if (a > b) ahead++;
      else if (a === b) tie++;
    }
    console.log(`    ${T.padEnd(10)} finishes ahead of a Common ${pct(ahead / 50000, 1)}, level ${pct(tie / 50000, 1)}, behind ${pct(1 - (ahead + tie) / 50000, 1)}`);
  }
}
