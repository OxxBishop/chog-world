import * as THREE from 'three';
import { chogsChat } from './brain.js';
import { chogInfo } from './chogdata.js';
import { makeChog, CHOG_HEIGHT } from './chog.js';
import { SPOT } from './cutscenes.js';
import { placeBubble } from './chat.js';

/*
 * Chogs chatting at the bar. Two Chogs stand at the counter and talk, a line at a time, in speech
 * bubbles, each line with its mood played out on the Chog. The scenes come from the Chog brain
 * (chogsChat), so each pair has its own conversation, from their traits and what they remember.
 *
 * Guests see the bar's regulars chatting among themselves. Signed in, your Chog comes along to the bar
 * and chats with a regular, and goes back home when you leave.
 *
 * The regulars are picked so each pair faces each other: the Side trait says which way a Chog looks in
 * its art, so the one on the left looks right and the one on the right looks left.
 */

const FACES_RIGHT = [87, 892];
const FACES_LEFT = [130, 1517];
const GUEST_PAIRS = [[87, 130], [892, 1517], [87, 1517], [892, 130]];
const PLACE = 'the bar in the Chog Hub';
// Two spots on the floor, side by side as the bar's camera sees them, in clear view of it and clear of
// the furniture (room space, metres). A tall phone screen sees less of the room across, so there the
// pair stands further back to fit.
const LAYOUTS = {
  wide: { scale: 1, a: new THREE.Vector3(0.07, 0, -0.7), b: new THREE.Vector3(1.72, 0, -2.08) },
  tall: { scale: 1, a: new THREE.Vector3(-1.65, 0, -0.89), b: new THREE.Vector3(0, 0, -2.27) },
};

// If the brain can't be reached (not set up yet, or busy), the regulars still have a few things to say.
const SPARE = [
  [
    { who: 'a', text: 'Is it me, or are the clouds extra fluffy tonight?', mood: 'curious' },
    { who: 'b', text: 'They\'re always fluffy. You just never look up from your drink.', mood: 'calm' },
    { who: 'a', text: 'Rude. Accurate, but rude.', mood: 'surprised' },
    { who: 'b', text: 'Next round\'s on me. It\'s free anyway.', mood: 'happy' },
  ],
  [
    { who: 'a', text: 'My keeper named a plant after me.', mood: 'excited' },
    { who: 'b', text: 'Is the plant doing okay?', mood: 'curious' },
    { who: 'a', text: 'Thriving. Like me.', mood: 'happy' },
    { who: 'b', text: 'Big if true.', mood: 'calm' },
  ],
  [
    { who: 'a', text: 'Someone threw a coin in the plaza fountain again.', mood: 'surprised' },
    { who: 'b', text: 'Was it you?', mood: 'curious' },
    { who: 'a', text: 'It was a button. I panicked.', mood: 'sad' },
    { who: 'b', text: 'Wishes still count. Probably.', mood: 'happy' },
  ],
  [
    { who: 'a', text: 'Long day?', mood: 'calm' },
    { who: 'b', text: 'I napped through most of it.', mood: 'sleepy' },
    { who: 'a', text: 'Same. Very productive.', mood: 'happy' },
    { who: 'b', text: 'We should start a nap club.', mood: 'excited' },
  ],
];

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const _p = new THREE.Vector3();

export function createBarChat({ world, getMine }) {
  const bar = world.bar;
  const regulars = new Map();
  const scenes = new Map();
  const seated = { a: null, b: null };
  let active = false;
  let castKey = null;
  let run = 0;
  let brainDown = false;
  let spare = 0;
  let speaking = null;
  let layout = null;
  const layoutNow = () => LAYOUTS[world.camera.aspect < 1 ? 'tall' : 'wide'];

  const bubble = document.createElement('div');
  bubble.className = 'chog-bubble bar-bubble';
  bubble.hidden = true;
  document.body.append(bubble);

  const wait = (ms, token) => new Promise((r) => setTimeout(r, ms)).then(() => token === run);
  const fade = (list, from, to, ms) =>
    new Promise((resolve) => {
      if (!list.length) return resolve();
      const t0 = performance.now();
      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / ms);
        for (const o of list) o.chog.setFade(from + (to - from) * k);
        if (k < 1) requestAnimationFrame(step);
        else resolve();
      };
      step();
    });

  // A regular: its info and its Chog, made once and kept for the next visit.
  function regular(id) {
    if (!regulars.has(id)) {
      regulars.set(id, (async () => {
        const info = await chogInfo(id);
        const chog = await makeChog(info);
        // Only ever shown with its art in, never as a blank card. If the art won't load, try later.
        if (!(await chog.ready)) {
          regulars.delete(id);
          return null;
        }
        await world.prewarm?.(chog.root);
        return { id, name: info.name, chog };
      })().catch(() => {
        regulars.delete(id);
        return null;
      }));
    }
    return regulars.get(id);
  }

  async function sceneFor(a, b) {
    const key = `${a}:${b}`;
    if (scenes.has(key)) return scenes.get(key);
    if (!brainDown) {
      try {
        const { lines } = await chogsChat({ a, b, place: PLACE });
        if (lines?.length) {
          scenes.set(key, lines);
          return lines;
        }
      } catch (err) {
        // Not set up, or no connection: don't keep asking. Busy: try again next time.
        if (err?.status === 503 || err?.status === 0) brainDown = true;
      }
    }
    return SPARE[spare++ % SPARE.length];
  }

  // Who's at the counter for the nth scene.
  async function castFor(n, mine) {
    if (mine) {
      const me = { id: mine.id, name: mine.info.name, chog: mine.chog, mine: true, session: mine };
      const facesRight = mine.info.traits.Side !== 'Left';
      const other = await regular((facesRight ? FACES_LEFT : FACES_RIGHT)[n % 2]);
      if (!other) return null;
      return facesRight ? { a: me, b: other } : { a: other, b: me };
    }
    const [x, y] = GUEST_PAIRS[n % GUEST_PAIRS.length];
    const [a, b] = await Promise.all([regular(x), regular(y)]);
    return a && b ? { a, b } : null;
  }

  function sendHome(o) {
    const s = o.session;
    // Signed out meanwhile: the Chog is already gone.
    if (getMine() !== s || s.chog !== o.chog) return;
    s.room.room.group.add(o.chog.root);
    o.chog.root.position.copy(SPOT);
    o.chog.root.rotation.y = 0.5;
    o.chog.root.scale.setScalar(1);
    o.chog.setFade(1);
    o.chog.play('idle');
  }

  function leaveSeat(o) {
    if (o.mine) sendHome(o);
    else {
      o.chog.root.removeFromParent();
      o.chog.play('idle');
    }
  }

  async function seat(cast, token) {
    const same = (x, y) => x && y && x.chog === y.chog;
    const moving = [];
    for (const s of ['a', 'b']) if (seated[s] && !same(seated[s], cast[s])) moving.push(seated[s]);
    await fade(moving.filter((o) => !o.mine), 1, 0, 450);
    if (token !== run) return false;
    for (const o of moving) if (!same(o, cast.a) && !same(o, cast.b)) leaveSeat(o);
    const arriving = [];
    for (const s of ['a', 'b']) {
      const o = cast[s];
      if (same(seated[s], o)) continue;
      seated[s] = o;
      bar.room.group.add(o.chog.root);
      o.chog.play('idle');
      if (!o.mine) {
        o.chog.setFade(0);
        arriving.push(o);
      }
    }
    place(layoutNow());
    await fade(arriving, 0, 1, 600);
    return token === run;
  }

  // Stand the pair in their spots for this screen, turned to each other (a rigged Chog shows it; a
  // standee's card always faces you).
  function place(l) {
    layout = l;
    for (const s of ['a', 'b']) {
      const root = seated[s]?.chog.root;
      if (!root) continue;
      root.position.copy(l[s]);
      root.scale.setScalar(l.scale);
      const d = _p.subVectors(l[s === 'a' ? 'b' : 'a'], l[s]);
      root.rotation.y = Math.atan2(d.x, d.z);
    }
  }

  function say(o, text) {
    speaking = o;
    bubble.innerHTML = `<span class="who">${esc(o.name)}</span>${esc(text)}`;
    bubble.hidden = false;
    bubble.style.opacity = '0';
  }
  const quiet = () => {
    speaking = null;
    bubble.hidden = true;
  };

  async function play(lines, cast, token) {
    for (const line of lines) {
      const who = line.who === 'b' ? cast.b : cast.a;
      const other = who === cast.a ? cast.b : cast.a;
      other.chog.play('idle');
      who.chog.play('talk');
      who.chog.setMood(line.mood, 2.2);
      say(who, line.text);
      if (!(await wait(Math.min(9000, 2600 + line.text.length * 50), token))) return;
      who.chog.play('idle');
      quiet();
      if (!(await wait(500, token))) return;
    }
  }

  async function loop(mine, token) {
    for (let n = 0; token === run; n++) {
      const cast = await castFor(n, mine);
      if (token !== run) return;
      if (!cast) {
        if (!(await wait(8000, token))) return;
        continue;
      }
      const [lines, seatedOk] = await Promise.all([sceneFor(cast.a.id, cast.b.id), seat(cast, token)]);
      if (!seatedOk || !(await wait(900, token))) return;
      await play(lines, cast, token);
      if (!(await wait(7000, token))) return;
    }
  }

  function start(mine) {
    stop();
    active = true;
    castKey = mine ? mine.id : 'guests';
    loop(mine, ++run).catch((err) => console.warn('Bar chat:', err?.message ?? err));
  }

  function stop() {
    run++;
    active = false;
    castKey = null;
    quiet();
    for (const s of ['a', 'b']) {
      if (!seated[s]) continue;
      seated[s].chog.setFade(1);
      leaveSeat(seated[s]);
      seated[s] = null;
    }
  }

  return {
    // Fetch the first pair ahead of time (it covers a guest's first scene and a signed-in Chog's first
    // partner either way), so walking into the bar doesn't wait on their art.
    preload() {
      regular(GUEST_PAIRS[0][0]);
      regular(GUEST_PAIRS[0][1]);
    },
    update(dt) {
      if (!bar) return;
      const inBar = world.currentRoom() === bar;
      if (!inBar) {
        if (active) stop();
        return;
      }
      const mine = getMine();
      if (!active || castKey !== (mine ? mine.id : 'guests')) start(mine);
      // The screen turned (a phone, say): move the pair to fit.
      if (layout && layout !== layoutNow()) place(layoutNow());
      // Your own Chog is kept moving by the session; the regulars are moved here.
      for (const s of ['a', 'b']) if (seated[s] && !seated[s].mine) seated[s].chog.update(dt, world.camera);
      if (!speaking || bubble.hidden) return;
      // Only once the camera is in the bar: on the way in (src/entry.js) its walls still hide them.
      if (!bar.pod.inside(world.camera.position, 0.3)) {
        bubble.style.opacity = '0';
        return;
      }
      speaking.chog.root.localToWorld(_p.set(0, CHOG_HEIGHT + 0.7, 0));
      _p.project(world.camera);
      if (_p.z > 1 || Math.abs(_p.x) > 1.2 || Math.abs(_p.y) > 1.2) {
        bubble.style.opacity = '0';
        return;
      }
      bubble.style.opacity = '1';
      placeBubble(bubble, ((_p.x + 1) / 2) * window.innerWidth, ((1 - _p.y) / 2) * window.innerHeight);
    },
    get active() {
      return active;
    },
    // For tests: who's at the bar, and where they stand.
    layouts: LAYOUTS,
    get cast() {
      return { a: seated.a?.id ?? null, b: seated.b?.id ?? null };
    },
    get speaking() {
      return speaking ? { id: speaking.id, text: bubble.textContent } : null;
    },
  };
}
