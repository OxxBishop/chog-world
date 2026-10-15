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
 * and chats with a regular, and goes back home when you leave. The bartender keeps the counter.
 *
 * The regulars and the bartender are C's rigged cast (public/models/npcs/), each regular the real Chog
 * of its id, so its traits and brain persona line up. They load once the camera nears the Hub, or when
 * the bar opens, never with the first load.
 */

const REGULARS = [124, 52, 56];
const GUEST_PAIRS = [[124, 52], [56, 124], [52, 56]];
const regularModel = (id) => `models/npcs/chog-${id}.glb`;
// Behind the counter, facing the room, on a step so its face shows over the counter (room space, metres).
const BARTENDER = { glb: 'models/npcs/bartender.glb', at: new THREE.Vector3(1.3, 0.55, -5.95) };
// The bar's cast starts loading once the camera is this close to the bar.
const PRELOAD_NEAR = 260;
const PLACE = 'the bar in the Chog Hub';
// Two spots at the counter, between its stools, in clear view of the bar's camera (room space, metres).
// A tall phone screen sees less of the room across, so there the pair stands closer together.
const LAYOUTS = {
  wide: { scale: 1, a: new THREE.Vector3(0, 0, -2.3), b: new THREE.Vector3(2.6, 0, -2.3) },
  tall: { scale: 1, a: new THREE.Vector3(0.2, 0, -2.3), b: new THREE.Vector3(2.3, 0, -2.3) },
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

export function createBarChat({ world, getMine, sendHome: home }) {
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
  // Your Chog walking in from the door (A10): the scene waits for it.
  let arriving = null;
  // Coming in through the doors (src/entry.js): the scene holds your Chog's place until it walks in.
  let holding = null;
  // What the camera follows while your Chog walks in (src/entry.js).
  let follow = null;
  const layoutNow = () => LAYOUTS[world.camera.aspect < 1 ? 'tall' : 'wide'];

  let preloaded = false;
  let bartender = null;
  let barkeep = null;
  // Compile something for the light inside the bar, so it doesn't stall the way in.
  const warmHere = (obj) => {
    const g = bar.room.group;
    const was = g.visible;
    g.visible = true;
    const ready = world.prewarm?.(obj);
    g.visible = was;
    return ready ?? Promise.resolve();
  };

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

  // A regular: its info and its Chog (its own model), made once and kept for the next visit.
  function regular(id) {
    if (!regulars.has(id)) {
      regulars.set(id, (async () => {
        const info = await chogInfo(id);
        const chog = await makeChog({ ...info, traits: { ...info.traits, Aura: null }, model: regularModel(id) });
        await warmHere(chog.root);
        return { id, name: info.name, chog };
      })().catch((err) => {
        console.warn('Bar regular:', err?.message ?? err);
        regulars.delete(id);
        return null;
      }));
    }
    return regulars.get(id);
  }

  // The bartender, behind the counter: a wave when you come in, then idling, and a word now and then.
  function keepBar() {
    bartender ??= makeChog({ model: BARTENDER.glb }).then(async (chog) => {
      chog.root.position.copy(BARTENDER.at);
      await warmHere(chog.root);
      return chog;
    });
    return bartender;
  }
  function barkeeping(chog) {
    let left = 2.6;
    chog.play('wave');
    return (dt) => {
      left -= dt;
      if (left > 0) return;
      const move = chog.state === 'idle' ? (Math.random() < 0.5 ? 'talk' : 'wave') : 'idle';
      chog.play(move);
      left = move === 'idle' ? 7 + Math.random() * 8 : 2.6;
    };
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

  // Who's at the counter for the nth scene. Your Chog stands on the side it faces in its art (its card
  // always faces you), so it looks at the regular it's talking to.
  async function castFor(n, mine) {
    if (mine) {
      const me = { id: mine.id, name: mine.info.name, chog: mine.chog, mine: true, session: mine };
      const facesRight = mine.info.traits.Side !== 'Left';
      const others = REGULARS.filter((id) => id !== mine.id);
      const other = await regular(others[n % others.length]);
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
    if (home) return home(s);
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
    const fadingIn = [];
    for (const s of ['a', 'b']) {
      const o = cast[s];
      // Still walking in from the door: it takes its place when it gets there.
      if (o.mine && arriving) continue;
      if (same(seated[s], o)) continue;
      seated[s] = o;
      bar.room.group.add(o.chog.root);
      o.chog.play('idle');
      if (!o.mine) {
        o.chog.setFade(0);
        fadingIn.push(o);
      }
    }
    place(layoutNow());
    await fade(fadingIn, 0, 1, 600);
    return token === run;
  }

  // Stand the pair in their spots for this screen, turned to each other but opened a little toward the
  // room's view, the way actors stand on a stage, so neither shows the camera its back (a standee's card
  // always faces you anyway).
  function place(l) {
    layout = l;
    const eye = bar.room.group.worldToLocal(bar.view.pos.clone());
    for (const s of ['a', 'b']) {
      const root = seated[s]?.chog.root;
      if (!root) continue;
      root.position.copy(l[s]);
      root.scale.setScalar(l.scale);
      const d = _p.subVectors(l[s === 'a' ? 'b' : 'a'], l[s]);
      const toPartner = Math.atan2(d.x, d.z);
      const toView = Math.atan2(eye.x - l[s].x, eye.z - l[s].z);
      root.rotation.y = toPartner + Math.atan2(Math.sin(toView - toPartner), Math.cos(toView - toPartner)) * 0.4;
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
      who.chog.lookAt?.(other.chog.root);
      other.chog.lookAt?.(who.chog.root);
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
      if (!seatedOk) return;
      // Your Chog takes its place once it has walked in (or straight away if it already has).
      if (cast.a.mine || cast.b.mine) {
        if (arriving) await arriving;
        if (token !== run || !(await seat(cast, token))) return;
      }
      if (!(await wait(900, token))) return;
      await play(lines, cast, token);
      if (!(await wait(7000, token))) return;
    }
  }

  function start(mine) {
    stop();
    active = true;
    castKey = mine ? mine.id : 'guests';
    keepBar()
      .then((chog) => {
        if (!active) return;
        bar.room.group.add(chog.root);
        barkeep = { chog, tick: barkeeping(chog) };
      })
      .catch((err) => console.warn('Bartender:', err?.message ?? err));
    // On the way in through the doors, your Chog isn't here yet: it walks in at the end (walkIn).
    if (mine && world.entering?.() && !arriving) {
      arriving = new Promise((resolve) => {
        holding = resolve;
        // In case it never comes (the cutscene cut short), it takes its place anyway.
        setTimeout(resolve, 15000);
      });
    }
    loop(mine, ++run).catch((err) => console.warn('Bar chat:', err?.message ?? err));
  }

  function stop() {
    run++;
    active = false;
    castKey = null;
    quiet();
    follow?.proxy.removeFromParent();
    follow = null;
    barkeep = null;
    bartender?.then((chog) => !active && chog.root.removeFromParent()).catch(() => {});
    for (const s of ['a', 'b']) {
      if (!seated[s]) continue;
      seated[s].chog.setFade(1);
      leaveSeat(seated[s]);
      seated[s] = null;
    }
  }

  // The middle of the pair at the counter, in the room's space.
  const middle = () => {
    const l = layoutNow();
    return l.a.clone().add(l.b).multiplyScalar(0.5);
  };

  return {
    // Fetch the first pair ahead of time (it covers a guest's first scene and a signed-in Chog's first
    // partner either way), so walking into the bar doesn't wait on their art.
    preload() {
      preloaded = true;
      keepBar().catch(() => {});
      regular(GUEST_PAIRS[0][0]);
      regular(GUEST_PAIRS[0][1]);
    },
    update(dt) {
      if (!bar) return;
      // Near the Hub: fetch the bar's cast, so it's there when you walk in.
      if (!preloaded && world.camera.position.distanceTo(bar.room.group.getWorldPosition(_p)) < PRELOAD_NEAR) this.preload();
      const inBar = world.currentRoom() === bar;
      if (!inBar) {
        if (active) stop();
        if (holding) {
          holding();
          holding = null;
          arriving = null;
        }
        return;
      }
      const mine = getMine();
      if (!active || castKey !== (mine ? mine.id : 'guests')) start(mine);
      // The screen turned (a phone, say): move the pair to fit.
      if (layout && layout !== layoutNow()) place(layoutNow());
      // The camera's mark: your Chog as it walks in, drifting to the middle of the pair as it arrives.
      if (follow) {
        const k = 1 - Math.min(1, follow.root.position.distanceTo(follow.to) / follow.total);
        follow.proxy.position.lerpVectors(follow.root.position, middle(), THREE.MathUtils.smoothstep(k, 0.2, 1));
      }
      // Your own Chog is kept moving by the session; the regulars and the bartender are moved here.
      for (const s of ['a', 'b']) if (seated[s] && !seated[s].mine) seated[s].chog.update(dt, world.camera);
      if (barkeep) {
        barkeep.tick(dt);
        barkeep.chog.update(dt, world.camera);
      }
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
    // Where your Chog stands in the bar: the side it faces in its art (room space).
    spotFor(s) {
      return layoutNow()[s.info.traits.Side !== 'Left' ? 'a' : 'b'].clone();
    },
    // Your Chog is walking in (A10): hold the scene until it's at its spot.
    expect(walk) {
      // Already chatting with it in place (it was here first): start over with it walking in.
      if (active && ['a', 'b'].some((s) => seated[s]?.mine)) {
        run++;
        quiet();
        for (const s of ['a', 'b']) if (seated[s]?.mine) seated[s] = null;
        active = false;
      }
      // The scene that has been holding its place waits for this walk now.
      holding?.(walk);
      holding = null;
      arriving = walk;
      walk.then(() => arriving === walk && (arriving = null));
    },
    // What the camera follows as your Chog walks in to `to` (room space): your Chog, easing over to the
    // middle of the pair as it gets there, so the view ends with both of them in it.
    follow(root, to) {
      follow?.proxy.removeFromParent();
      const proxy = new THREE.Object3D();
      bar.room.group.add(proxy);
      proxy.position.copy(root.position);
      follow = { proxy, root, to: to.clone(), total: Math.max(0.01, root.position.distanceTo(to)) };
      return proxy;
    },
    // Where a guest's view settles on coming in: the middle of whoever is at the counter (world).
    focusPoint() {
      if (!seated.a && !seated.b) return null;
      return bar.room.group.localToWorld(middle().setY(1.3));
    },
    // Your Chog is walking out ahead of you: the chat stops, the regular stays.
    release() {
      run++;
      quiet();
      for (const s of ['a', 'b']) if (seated[s]?.mine) seated[s] = null;
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
