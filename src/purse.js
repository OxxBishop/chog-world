import * as THREE from 'three';
import { islandPerksFor } from './islandperks.js';
import { hudRow } from './hudrow.js';

/*
 * Testnet $CHOG (the user's pick, 10-23): an in-game balance, earned round the islands and spent on things
 * you can see. Never on-chain: no token moves, nothing is signed; it's kept on the device, one purse per
 * wallet (and one for guests).
 *
 * Earn: each star found (and all twelve), beating Patrol (the first win of the day pays most), and a hello
 * from your Chog the first time you're out each day. Rarer Chogs earn a little more (1x to 1.5x by tier,
 * 2x for a 1:1), under a daily cap, so every holder gets plenty.
 * Spend: a wish at the plaza's fountain (a coin in the water and a small surprise), a song request for
 * the singer (her song from the top), and the casino's testnet chips (src/casino.js cashes 10 in for 100).
 *
 * createPurse({ scene, camera, travel, session, audio }) -> { earn(kind, amount, why), spend(amount), update(dt), balance }
 */

const KEY = 'chogworld.purse.v1';
const CAP = 150;
const RATE = { Common: 1, Uncommon: 1.1, Rare: 1.25, Epic: 1.4, Legendary: 1.5 };
const FOUNTAIN = new THREE.Vector3(0, 0, 40);
const STAGE = new THREE.Vector3(27, 0, 30);
const WISH = 5, SONG = 10;
const today = () => new Date().toISOString().slice(0, 10);
const read = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
};
const write = (v) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {}
};
const sfx = (name) => dispatchEvent(new CustomEvent('chog-sfx', { detail: name }));
const COIN_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.2"/><path d="M14.8 9.2a3.6 3.6 0 1 0 0 5.6" fill="none"/></svg>';

let dotTex = null;
function dot() {
  if (dotTex) return dotTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.35, 'rgba(255,255,255,0.6)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  dotTex = new THREE.CanvasTexture(c);
  return dotTex;
}

export function createPurse({ scene, camera, travel, session, audio }) {
  const all = read();
  const who = () => {
    const s = session()?.active;
    if (s?.address) return { key: s.address.toLowerCase(), name: s.info?.name, traits: s.info?.traits ?? {} };
    if (s?.demo) return { key: 'demo', name: s.info?.name, traits: s.info?.traits ?? {} };
    // (A guest visits as a Chog from the collection: its traits, its rate and perks.)
    return { key: 'guest', name: travel.guest?.name, traits: travel.guest?.traits ?? {} };
  };
  const purse = () => {
    const w = who();
    const p = (all[w.key] ??= { bal: 0, day: '', got: 0, hello: '', races: 0 });
    if (p.day !== today()) Object.assign(p, { day: today(), got: 0, races: 0 });
    return p;
  };
  const rate = () => {
    const t = who().traits;
    return t?.Base === '1:1' ? 2 : RATE[t?.Tier] ?? 1;
  };

  // ---------- on screen: the balance, and what comes in ----------
  const pill = document.createElement('div');
  pill.className = 'pl-purse';
  pill.title = 'Testnet $CHOG: earned and spent round the islands, never on-chain';
  pill.innerHTML = `${COIN_SVG}<span></span><small>$CHOG</small>`;
  hudRow().append(pill);
  const plus = document.createElement('div');
  plus.className = 'pl-plus';
  document.body.append(plus);
  const toast = document.createElement('div');
  toast.className = 'pl-toast pl-coin';
  document.body.append(toast);
  let toastT = 0;
  const note = (html, secs = 3.2) => {
    toast.innerHTML = html;
    toast.classList.add('on');
    toastT = secs;
  };
  let shownKey = null, shownBal = null;
  const show = () => {
    const p = purse();
    if (p.bal === shownBal && who().key === shownKey && !document.querySelector('[data-purse]:empty')) return;
    shownBal = p.bal;
    shownKey = who().key;
    pill.querySelector('span').textContent = p.bal.toLocaleString('en');
    // On your Chog's chip too, signed in (src/session.js leaves a place for it).
    for (const el of document.querySelectorAll('[data-purse]')) el.textContent = `${p.bal.toLocaleString('en')} testnet $CHOG`;
  };

  /** Earn: kind for the day's tally, base before the Chog's rate; returns what came in. */
  function earn(kind, base, why = '') {
    const p = purse();
    if (kind === 'race') {
      p.races += 1;
      base = p.races === 1 ? base : Math.min(base, 5);
    }
    // Its traits' perks round the islands (src/islandperks.js): a bigger hello, more for quests and stars.
    const perk = islandPerksFor(who().traits);
    base += kind === 'hello' ? perk.hello : kind === 'quest' ? perk.quest : kind === 'star' ? perk.star : 0;
    const room = Math.max(0, CAP - p.got);
    const amount = Math.min(room, Math.round(base * rate()));
    if (amount <= 0) {
      note('Daily <b>$CHOG</b> cap reached. More tomorrow.');
      return 0;
    }
    p.bal += amount;
    p.got += amount;
    write(all);
    show();
    sfx('coin');
    plus.textContent = `+${amount}`;
    plus.classList.remove('up');
    void plus.offsetWidth;
    plus.classList.add('up');
    pill.classList.remove('bump');
    void pill.offsetWidth;
    pill.classList.add('bump');
    if (!all.told) {
      all.told = true;
      write(all);
      // (The guide says what testnet $CHOG is now: src/guide.js.)
    }
    return amount;
  }
  function spend(amount) {
    const p = purse();
    if (p.bal < amount) return false;
    p.bal -= amount;
    write(all);
    show();
    return true;
  }

  // ---------- spending: the fountain and the stage ----------
  const card = document.createElement('div');
  card.className = 'pl-card pl-spend';
  card.hidden = true;
  card.innerHTML = '<b class="pl-title"></b><p class="pl-text"></p><div class="pl-acts"><button type="button" class="pl-btn"></button></div>';
  card.addEventListener('pointerdown', (e) => e.stopPropagation());
  document.body.append(card);
  const cardTitle = card.querySelector('.pl-title'), cardText = card.querySelector('.pl-text'), cardBtn = card.querySelector('.pl-btn');
  let offer = null;
  cardBtn.addEventListener('click', () => offer?.go());

  const fx = [];
  // A puff of motes: from, count, colour, how they move (vel(i) -> Vector3), size, life in s, gravity.
  function motes(from, n, color, vel, { size = 0.45, life = 1.4, fall = 0, spread = 0 } = {}) {
    const pos = new Float32Array(n * 3);
    const v = [];
    for (let i = 0; i < n; i++) {
      pos.set([from.x + (Math.random() - 0.5) * spread, from.y, from.z + (Math.random() - 0.5) * spread], i * 3);
      v.push(vel(i));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ map: dot(), size, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color, fog: false });
    const p = new THREE.Points(g, m);
    p.frustumCulled = false;
    scene.add(p);
    fx.push({ p, v, t: 0, life, fall });
  }
  const coinGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.04, 20);
  const coinMat = new THREE.MeshStandardMaterial({ color: '#ffd77a', emissive: new THREE.Color('#ffb733'), emissiveIntensity: 0.6, metalness: 0.8, roughness: 0.25 });
  let coin = null;
  const LINES = ['The fountain heard you.', 'Something lucky is on its way.', 'Your wish is safe with the fountain.', 'A little luck, tucked away for later.', 'The water sparkles back at you.'];

  // A lucky charm (an Accessory) makes the day's first wish free.
  const freeWish = () => islandPerksFor(who().traits).wish && purse().wish !== today();
  function wish() {
    if (coin) return;
    if (freeWish()) {
      purse().wish = today();
      write(all);
    } else if (!spend(WISH)) return;
    const s = travel.state;
    const from = s.pos.clone().add(new THREE.Vector3(0, 2.4, 0));
    const a = Math.random() * Math.PI * 2, r = 1.5 + Math.random() * 2.5;
    const to = new THREE.Vector3(FOUNTAIN.x + Math.cos(a) * r, s.pos.y + 0.35, FOUNTAIN.z + Math.sin(a) * r);
    const mesh = new THREE.Mesh(coinGeo, coinMat);
    scene.add(mesh);
    coin = { mesh, from, to, t: 0 };
    sfx('chip');
  }
  function landed(at) {
    sfx('drop');
    // The splash, then the surprise: petals round you, or golden motes rising off the water.
    motes(at, 22, '#cfeeff', () => new THREE.Vector3((Math.random() - 0.5) * 2.4, 2 + Math.random() * 2.5, (Math.random() - 0.5) * 2.4), { size: 0.35, life: 0.9, fall: 7 });
    setTimeout(() => {
      sfx('star');
      if (Math.random() < 0.5) {
        const me = travel.state.pos.clone().add(new THREE.Vector3(0, 6, 0));
        motes(me, 70, '#ffb3d1', () => new THREE.Vector3((Math.random() - 0.5) * 1.2, -1.2 - Math.random() * 0.8, (Math.random() - 0.5) * 1.2), { size: 0.38, life: 4.2, spread: 7 });
      } else {
        const c = FOUNTAIN.clone().setY(at.y + 0.3);
        motes(c, 46, '#ffe08a', () => new THREE.Vector3((Math.random() - 0.5) * 0.8, 1 + Math.random() * 1.4, (Math.random() - 0.5) * 0.8), { size: 0.4, life: 5, spread: 6 });
      }
      note(LINES[Math.floor(Math.random() * LINES.length)], 3.4);
    }, 450);
  }
  let encoreT = 0;
  function song() {
    if (encoreT > 0 || !spend(SONG)) return;
    encoreT = 30;
    audio?.encore?.();
    const at = STAGE.clone().setY(travel.state.pos.y + 1.2);
    motes(at, 60, '#ffd27a', () => new THREE.Vector3((Math.random() - 0.5) * 3, 3 + Math.random() * 3, (Math.random() - 0.5) * 3), { size: 0.5, life: 2.2, fall: 3.5 });
    note('She takes a bow: <b>your request</b>, from the top.', 3.6);
  }

  function setOffer(o) {
    if (o === offer && (!o || o.text === cardText.textContent)) return;
    offer = o;
    card.hidden = !o;
    if (!o) return;
    cardTitle.textContent = o.title;
    cardText.textContent = o.text;
    cardBtn.textContent = o.button;
    cardBtn.parentNode.hidden = !o.can;
  }

  const tmp = new THREE.Vector3();
  return {
    earn,
    // For the casino's cash in (src/casino.js): false if the balance is short.
    spend,
    get balance() {
      return purse().bal;
    },
    // For the guide (src/guide.js): today's earnings against the cap, the Chog's rate, and the hello.
    get today() {
      return { got: purse().got, cap: CAP, rate: rate(), hello: purse().hello === today(), wins: purse().races, perks: islandPerksFor(who().traits) };
    },
    update(dt, { busy = false } = {}) {
      const out = travel.active && travel.chog;
      if (out !== pill.classList.contains('on')) pill.classList.toggle('on', !!out);
      show();
      const p = purse();
      // A hello from your Chog, the first time you're out each day.
      if (out && p.hello !== today()) {
        p.hello = today();
        write(all);
        const name = who().name ?? travel.chog?.name ?? 'Your Chog';
        setTimeout(() => {
          if (earn('hello', 15) > 0) note(`<b>${name}</b> says gm. A daily hello.`, 3.4);
        }, 3500);
      }
      encoreT = Math.max(0, encoreT - dt);
      // What's on offer where you stand: the fountain's wish, the singer's song.
      let o = null;
      // (Never over a cast quest's card: King Pom's throne is near the fountain.)
      if (out && !busy && !travel.state.busy && !document.querySelector('.pl-quest:not([hidden])')) {
        const at = travel.state.pos;
        const bal = p.bal;
        if (Math.hypot(at.x - FOUNTAIN.x, at.z - FOUNTAIN.z) < 9.8 && !coin)
          o = freeWish()
            ? { title: 'Make a wish', text: 'Your lucky charm makes today\'s first wish free.', button: 'Wish', can: true, go: wish }
            : { title: 'Make a wish', text: bal >= WISH ? `Toss a coin in the fountain for ${WISH} testnet $CHOG.` : `A wish costs ${WISH} testnet $CHOG. Find stars or race Patrol to earn some.`, button: 'Wish', can: bal >= WISH, go: wish };
        else if (Math.hypot(at.x - STAGE.x, at.z - STAGE.z) < 12 && encoreT <= 0)
          o = { title: 'Request a song', text: bal >= SONG ? `Tip the singer ${SONG} testnet $CHOG for your request.` : `A request costs ${SONG} testnet $CHOG. Find stars or race Patrol to earn some.`, button: 'Request', can: bal >= SONG, go: song };
      }
      setOffer(o);
      if (coin) {
        coin.t += dt / 0.9;
        const k = Math.min(1, coin.t);
        coin.mesh.position.lerpVectors(coin.from, coin.to, k);
        coin.mesh.position.y += Math.sin(k * Math.PI) * 2.2;
        coin.mesh.rotation.x += dt * 14;
        if (k >= 1) {
          scene.remove(coin.mesh);
          landed(tmp.copy(coin.to));
          coin = null;
        }
      }
      for (let i = fx.length - 1; i >= 0; i--) {
        const f = fx[i];
        f.t += dt;
        const pos = f.p.geometry.attributes.position;
        for (let j = 0; j < f.v.length; j++) {
          f.v[j].y -= f.fall * dt;
          // (Petals sway as they fall.)
          const sway = f.fall === 0 && f.v[j].y < 0 ? Math.sin(f.t * 2 + j) * 0.6 * dt : 0;
          pos.setXYZ(j, pos.getX(j) + f.v[j].x * dt + sway, pos.getY(j) + f.v[j].y * dt, pos.getZ(j) + f.v[j].z * dt);
        }
        pos.needsUpdate = true;
        f.p.material.opacity = Math.min(1, (f.life - f.t) / 0.6);
        if (f.t >= f.life) {
          scene.remove(f.p);
          f.p.geometry.dispose();
          f.p.material.dispose();
          fx.splice(i, 1);
        }
      }
      if (toastT > 0 && (toastT -= dt) <= 0) toast.classList.remove('on');
    },
  };
}
