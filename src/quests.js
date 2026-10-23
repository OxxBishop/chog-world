import { playerStore, playerKey } from './playerstore.js';
import * as THREE from 'three';
import { hudRow } from './hudrow.js';

/*
 * Small asks from the cast (the user's pick, 10-23), each worth some testnet $CHOG (src/purse.js) once a
 * day: walk up to them and a card tells you what they need; the things glow where they lie; bring them
 * back. One at a time.
 *   Toasty    firewood: three sticks from round the beacon island, for his campfire
 *   Petal     her watering can, left somewhere on the tree island
 *   King Pom  a flower from Quackers' arch, for his throne
 *
 * createQuests({ scene, camera, travel, purse }) -> { update(dt, { busy }) }
 */

const KEY = 'chogworld.quests.v1';
const today = () => new Date().toISOString().slice(0, 10);
const QUESTS = [
  {
    id: 'firewood',
    giver: 'Toasty',
    at: [205.5, -106.8],
    r: 6.2,
    title: "Toasty's firewood",
    short: 'Firewood',
    ask: 'My fire is getting low. Could you bring me three sticks from round the island?',
    more: (n) => `${n === 1 ? 'One more stick' : `${n} more sticks`}, please. They glow a little.`,
    ready: 'Oh, lovely sticks. Hand them over?',
    thanks: 'Toasty: "Warm again. Thank you, friend."',
    item: 'stick',
    items: [[237.5, -104.2], [197.9, -63.5], [175.8, -120.7]],
    reward: 20,
  },
  {
    id: 'can',
    giver: 'Petal',
    at: [-35.2, 203.6],
    r: 5.6,
    title: "Petal's watering can",
    short: 'Watering can',
    ask: 'I put my watering can down somewhere on this island and now I cannot find it. Help?',
    more: () => 'Still no can? It is somewhere past the giant tree.',
    ready: 'My can! Hand it over?',
    thanks: 'Petal: "The flowers thank you. So do I."',
    item: 'can',
    items: [[26.7, 224.7]],
    reward: 15,
  },
  {
    id: 'flower',
    giver: 'King Pom',
    at: [-11, 50],
    r: 7.2,
    title: 'A flower for the King',
    short: 'Flower',
    ask: 'A throne needs a flower. Fetch me one from that show-off Quackers and his arch.',
    more: () => 'The arch is just across the plaza. Off you go.',
    ready: 'Ah, a fine bloom. Present it.',
    thanks: 'King Pom: "Very good. You may carry on."',
    item: 'flower',
    items: [[-21.6, 37.2]],
    reward: 10,
  },
];
const sfx = (name) => dispatchEvent(new CustomEvent('chog-sfx', { detail: name }));

let glowTex = null;
function glow() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255, 252, 235, 0.95)');
  r.addColorStop(0.35, 'rgba(255, 236, 180, 0.4)');
  r.addColorStop(1, 'rgba(255, 220, 150, 0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

// The things, at a Chog's own scale (set out 1.7x like everything outdoors).
function thing(kind) {
  const g = new THREE.Group();
  if (kind === 'stick') {
    const wood = new THREE.MeshStandardMaterial({ color: '#8a5a32', roughness: 0.85 });
    for (const [a, y] of [[0.5, 0], [-0.6, 0.09]]) {
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.0, 7).rotateZ(Math.PI / 2), wood);
      s.rotation.y = a;
      s.position.y = y;
      s.castShadow = true;
      g.add(s);
    }
  } else if (kind === 'can') {
    const teal = new THREE.MeshStandardMaterial({ color: '#3fb7b0', roughness: 0.4, metalness: 0.3 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.42, 16), teal);
    body.position.y = 0.21;
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.55, 8), teal);
    spout.position.set(0.36, 0.34, 0);
    spout.rotation.z = -0.9;
    const rose = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.05, 0.06, 10), teal);
    rose.position.set(0.56, 0.5, 0);
    rose.rotation.z = -0.9;
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.03, 6, 16, Math.PI), teal);
    handle.position.set(-0.05, 0.42, 0);
    for (const m of [body, spout, rose, handle]) (m.castShadow = true), g.add(m);
  } else {
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.7, 6), new THREE.MeshStandardMaterial({ color: '#4f9e4a' }));
    stem.position.y = 0.35;
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.18, 1), new THREE.MeshStandardMaterial({ color: '#ff7fb0', roughness: 0.5, emissive: new THREE.Color('#ff4f8f'), emissiveIntensity: 0.25 }));
    head.position.y = 0.76;
    const mid = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshStandardMaterial({ color: '#ffd25e' }));
    mid.position.set(0, 0.8, 0.13);
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6).scale(1, 0.35, 0.55), new THREE.MeshStandardMaterial({ color: '#5fb85a' }));
    leaf.position.set(0.1, 0.32, 0);
    leaf.rotation.z = -0.5;
    for (const m of [stem, head, mid, leaf]) g.add(m);
  }
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.7, fog: false }));
  halo.position.y = 0.35;
  halo.scale.setScalar(1.8);
  g.add(halo);
  return g;
}

export function createQuests({ scene, camera, travel, purse }) {
  // This player's day of quests (src/playerstore.js), swapped in as the player changes.
  const store = playerStore(KEY);
  let st = store.get();
  let who = playerKey();
  const write = () => store.save();
  const fresh = () => {
    if (who !== playerKey()) {
      who = playerKey();
      st = store.get();
      showItems();
    }
    if (st.day !== today()) Object.assign(st, { day: today(), done: {}, active: null, got: [] });
    st.done ??= {};
    st.got ??= [];
    return st;
  };
  fresh();
  // The things, made the first time a quest needs them.
  const made = new Map();
  const itemsOf = (q) => {
    if (!made.has(q.id))
      made.set(
        q.id,
        q.items.map(([x, z], i) => {
          const g = travel.groundAt?.(x, z, 999);
          const o = thing(q.item);
          o.scale.setScalar(1.7);
          o.position.set(x, (g ? g.y : 0) + 0.25, z);
          o.userData.k = i * 1.3;
          o.visible = false;
          scene.add(o);
          return o;
        }),
      );
    return made.get(q.id);
  };

  // ---------- on screen ----------
  const card = document.createElement('div');
  card.className = 'pl-card pl-quest';
  card.hidden = true;
  card.innerHTML = '<b class="pl-title"></b><p class="pl-text"></p><div class="pl-acts"><button type="button" class="pl-btn"></button></div>';
  card.addEventListener('pointerdown', (e) => e.stopPropagation());
  document.body.append(card);
  const cTitle = card.querySelector('.pl-title'), cText = card.querySelector('.pl-text'), cBtn = card.querySelector('.pl-btn');
  let action = null;
  cBtn.addEventListener('click', () => action?.());
  const pill = document.createElement('div');
  pill.className = 'pl-qpill';
  hudRow().append(pill);
  const toast = document.createElement('div');
  toast.className = 'pl-toast pl-qtoast';
  document.body.append(toast);
  let toastT = 0;
  const note = (html, secs = 3) => {
    toast.innerHTML = html;
    toast.classList.add('on');
    toastT = secs;
  };
  let shown = '';
  const showCard = (title, text, button = null, act = null) => {
    const key = `${title}|${text}|${button}`;
    action = act;
    if (key === shown) return;
    shown = key;
    if (!title) {
      card.hidden = true;
      return;
    }
    cTitle.textContent = title;
    cText.textContent = text;
    cBtn.textContent = button ?? '';
    cBtn.parentNode.hidden = !button;
    card.hidden = false;
  };

  function begin(q) {
    fresh();
    st.active = q.id;
    st.got = [];
    write(st);
    for (const o of itemsOf(q)) o.visible = true;
    sfx('gate');
  }
  function finish(q) {
    st.done[q.id] = true;
    st.active = null;
    st.got = [];
    write(st);
    for (const o of itemsOf(q)) o.visible = false;
    purse?.earn('quest', q.reward);
    sfx('finish');
    note(q.thanks, 3.6);
  }
  // The things of the quest under way (one left going from before a reload, or this player's), back where
  // they were; any other quest's hidden.
  function showItems() {
    for (const [id, objs] of made) if (id !== st.active) objs.forEach((o) => (o.visible = false));
    const q = QUESTS.find((x) => x.id === st.active);
    if (q) itemsOf(q).forEach((o, i) => (o.visible = !st.got?.includes(i)));
  }
  showItems();

  let pinned = null;
  return {
    // What the guide shows (src/guide.js): each ask, where, and how it stands today.
    status() {
      fresh();
      return QUESTS.map((q) => ({ id: q.id, title: q.title, giver: q.giver, reward: q.reward, need: q.items.length, got: st.active === q.id ? st.got.length : 0, state: st.done[q.id] ? 'done' : st.active === q.id ? 'active' : 'open' }));
    },
    update(dt, { busy = false } = {}) {
      fresh();
      const out = travel.active && travel.chog && !busy && !travel.state.busy;
      const q = QUESTS.find((x) => x.id === st.active) ?? null;
      // The tracker.
      const label = q ? `${q.short} ${st.got.length}/${q.items.length}` : '';
      if (pill.textContent !== label) pill.textContent = label;
      pill.classList.toggle('on', !!(q && travel.active && travel.chog));
      if (toastT > 0 && (toastT -= dt) <= 0) toast.classList.remove('on');
      // On the map (the user, 10-23): who has an ask for you; once you've taken one, only where its things
      // lie, then its giver again to hand them over.
      const pins = !travel.active
        ? []
        : q
          ? st.got.length >= q.items.length
            ? [{ x: q.at[0], z: q.at[1], kind: 'back' }]
            : q.items.map(([x, z], i) => (st.got.includes(i) ? null : { x, z, kind: 'item' })).filter(Boolean)
          : QUESTS.filter((x) => !st.done[x.id]).map((x) => ({ x: x.at[0], z: x.at[1], kind: 'quest' }));
      const pinKey = pins.map((p) => `${p.kind}${p.x},${p.z}`).join('|');
      if (pinKey !== pinned) {
        pinned = pinKey;
        travel.setPins?.('quests', pins);
      }
      // Its things: turning, bobbing, picked up as you reach them.
      if (q) {
        const things = itemsOf(q);
        things.forEach((o, i) => {
          if (!o.visible) return;
          o.userData.k += dt;
          o.rotation.y = o.userData.k * 1.1;
          o.children.at(-1).material.opacity = 0.55 + Math.sin(o.userData.k * 3) * 0.15;
          if (!out) return;
          const p = travel.state.pos;
          if (Math.hypot(p.x - o.position.x, p.z - o.position.z) < 2.3 && Math.abs(p.y - o.position.y) < 3) {
            o.visible = false;
            st.got.push(i);
            write(st);
            sfx('star');
            const left = q.items.length - st.got.length;
            note(left ? `<b>${st.got.length} of ${q.items.length}</b>. ${q.more(left)}` : `Got it. Back to <b>${q.giver}</b>.`, 2.6);
          }
        });
      }
      if (!out) return showCard(null);
      // Near one of the cast with something to ask, or to hand over.
      const p = travel.state.pos;
      const near = QUESTS.find((x) => Math.hypot(p.x - x.at[0], p.z - x.at[1]) < x.r);
      if (!near || st.done[near.id]) return showCard(null);
      if (!q) return showCard(near.title, near.ask, "I'll help", () => begin(near));
      // One at a time (the user, 10-23): another of the cast waits till you've finished.
      if (q.id !== near.id) return showCard(near.title, `One thing at a time: finish ${q.title.replace(/^A /, 'the ')} first, then come back to ${near.giver}.`);
      const left = q.items.length - st.got.length;
      if (left > 0) return showCard(q.title, q.more(left));
      return showCard(q.title, `${q.ready} ${q.reward} testnet $CHOG.`, 'Hand over', () => finish(q));
    },
  };
}
