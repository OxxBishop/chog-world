import * as THREE from 'three';
import { demoClock as clock } from './democlock.js';
import { createFlight } from './flight.js';
import { makeChog } from './chog.js';
import { chogInfo } from './chogdata.js';
import { surfaceAt } from './travel.js';
import { BOARD } from './hoverboard.js';

/*
 * The demo video's shots (B13). ?demo=<shot> plays one with the interface hidden; video/shots.md
 * lists them with their lengths.
 *
 * A shot opens on a set-up (setup, in real time: the world put where the shot starts, and everything
 * it shows loaded), then runs for `length` seconds at a fixed hour: a camera flight through keys (as
 * in src/flight.js), or the world's own cutscenes set off at their times (events), or both.
 *
 * For recording, add &capture: the shot holds still at its first frame and window.chogDemo.at(s) sets
 * the whole world (camera, clouds, the Chogs about town, the sun, the page's own animations) to second s
 * and draws it, so a take can be stepped frame by frame and comes out the same every time (see
 * src/democlock.js). &at=s opens a take at second s. Coordinates are world metres: downtown is at the
 * origin, the Hub's doors face +z.
 */

const smooth = (x) => x * x * (3 - 2 * x);
const clamp01 = (x) => Math.min(1, Math.max(0, x));

// The loading screen's steps, as the arrival shot replays them.
const LOAD_STEPS = [
  [0, 'Waking the island'],
  [0.36, 'Raising the islands'],
  [0.58, 'Lighting the sky'],
  [0.84, 'Gathering the clouds'],
  [0.95, 'Almost there'],
];
const loadLabel = (f) => LOAD_STEPS.filter(([at]) => f >= at).pop()[1];

export const SHOTS = {
  // B5's opening: in from the south over the sea of clouds at golden hour, low over the first
  // neighbourhood's domes, across its bridge and up the walk to the fountain and the gold dome, then
  // a rising pull back to the whole archipelago. The view keeps facing north the whole way.
  // The singer on her stage at dusk, the camera drifting round the front row (A, 10-22, the demo).
  singer: {
    hour: 19.2,
    keys: [
      { t: 0, pos: [37, 33.2, 42], look: [27, 32.2, 30] },
      { t: 10, pos: [20, 32.6, 41], look: [27, 32.2, 30] },
    ],
  },
  // Looking up from the plaza at the sky and what swims in it.
  sky: {
    hour: 17.8,
    keys: [
      { t: 0, pos: [-20, 33.5, 60], look: [-70, 95, -90] },
      { t: 12, pos: [-8, 33.5, 64], look: [50, 105, -110] },
    ],
  },
  overview: {
    hour: 17.5,
    keys: [
      { t: 0, pos: [170, 115, 600], look: [-11, 5, 230] },
      { t: 6, pos: [45, 72, 380], look: [-11, 8, 227] },
      { t: 10.5, pos: [26, 50, 288], look: [-11, 14, 195] },
      { t: 14.5, pos: [4, 42, 178], look: [-4, 26, 80] },
      { t: 18.5, pos: [-3, 44, 105], look: [0, 36, 20] },
      { t: 22, pos: [0, 45, 62], look: [0, 40, 0] },
      { t: 24, pos: [2, 50, 60], look: [0, 40, 0] },
      { t: 32, pos: [70, 240, 430], look: [0, 5, 0] },
    ],
  },

  // The way in: the loading screen fills, the connect screen comes up over the world seen from space,
  // the demo Chog is picked, its welcome, the screen tears away and the camera flies down into its
  // dome, where it steps out of its pod and says hello.
  arrival: {
    hour: 16.5,
    length: 21,
    async setup(w) {
      // The wallet code is fetched ahead, so the connect screen comes up on time.
      await import('./chain.js');
      w.space.enter({ duration: 0 });
      w.intro.loading(0, loadLabel(0));
    },
    update(w, t) {
      if (t <= 2.6) {
        const f = smooth(clamp01(t / 2.6));
        w.intro.loading(f, loadLabel(f));
      }
    },
    events: [
      [2.9, (w) => {
        w.intro.ready();
        w.session.startIntro(w.intro);
      }],
      // The demo Chog's button, pressed.
      [4.6, () => document.querySelector('#loading .wallet.alt')?.classList.add('pressed')],
      [4.8, () => document.querySelector('#loading .wallet.alt')?.click()],
    ],
  },

  // A room entry: the casino at night, from the Hub, through its door, the machines' lights rippling on
  // as the camera comes in.
  entry: {
    hour: 20.5,
    length: 9,
    setup(w) {
      w.rig.jump('downtown');
    },
    events: [[1, (w) => w.enterRoom('casino')]],
  },

  // Into the bar, where two regulars are chatting at the counter, a line at a time, each with its
  // mood played out.
  bar: {
    hour: 21,
    length: 30,
    setup(w) {
      w.rig.jump('downtown');
      w.session.bar.preload();
    },
    events: [[0.8, (w) => w.enterRoom('bar')]],
  },

  // The casino's jackpot: three Chogs on the slot machine, JACKPOT in lights, chips raining from the
  // ceiling, and the casino's own cutscene round the room.
  jackpot: {
    hour: 20,
    length: 12,
    async setup(w) {
      w.rig.jump('casino');
      await w.wait(500);
      w.casino.play();
      await w.wait(2500);
    },
    events: [[1, (w) => w.casino._spin([9, 9, 9])]],
  },

  // The sale: the demo Chog at home is sold, turns to you, goes grey from the feet up and walks out of
  // its home, and the view is carried out to space.
  sale: {
    hour: 15,
    length: 21,
    async setup(w) {
      let arrived = false;
      w.session.demo().then(() => (arrived = true));
      await w.until(() => arrived, 120000);
      // In through the pod's door, where it waits at home.
      w.enterRoom(w.session.active.room.id);
      await w.until(() => !w.entry.active && w.inRoom(w.session.active.room.id));
      await w.wait(1500);
    },
    events: [[1.5, (w) => w.session.simulateSale()]],
  },

  // The world from space: the view pulls back from the Hub, out past the clouds, to the archipelago
  // turning slowly in the dark.
  space: {
    hour: [12.5, 13.5],
    length: 18,
    setup(w) {
      w.rig.jump('downtown');
    },
    events: [[0.8, (w) => w.space.enter({ duration: 7 })]],
  },
};

// ---------- The trailer (B, 10-22): the user's calm, Legend of Zelda style edit ----------
// One subject a shot, held, the camera still or drifting a few metres; golden hour into night.

// A straight, steady drift from a to b over len seconds (keys spaced along the line, so only its ends ease).
const drift = (len, a, b, lookA, lookB = lookA) => {
  const keys = [];
  for (let i = 0; i <= 4; i++) {
    const k = i / 4;
    const mix = (p, q) => p.map((v, j) => v + (q[j] - v) * k);
    keys.push({ t: len * k, pos: mix(a, b), look: mix(lookA, lookB) });
  }
  return keys;
};
// The lens for a shot (vertical field of view, degrees).
const lens = (w, fov) => {
  if (w.camera.fov !== fov) {
    w.camera.fov = fov;
    w.camera.updateProjectionMatrix();
  }
};
// A Chog of the cast by token id, wherever it is in the world.
const castChog = (w, id) => {
  let found = null;
  w.scene.traverse((o) => {
    if (!found && o.userData?.chogId === id && o.visible !== false) found = o;
  });
  return found;
};
const _p = new THREE.Vector3(), _q = new THREE.Vector3();

Object.assign(SHOTS, {
  // The first neighbourhood from above at golden hour: its glass domes round the giant tree.
  't-domes': {
    hour: 17.2,
    keys: drift(7, [-21.5, 30.2, 175.5], [-15, 28.8, 180.5], [-11.2, 8, 235], [-10.6, 8, 235]),
    update: (w) => lens(w, 45),
  },
  // A dome's garden through its glass: flowers, a pink tree, the house beyond.
  't-garden': {
    hour: 17.25,
    keys: drift(6, [46.6, 8.1, 238.6], [44.7, 7.8, 240.4], [36, 3.5, 228], [35.5, 3.6, 228.5]),
    update: (w) => lens(w, 42),
  },
  // Snooze napping at the foot of the giant tree, the camera easing in.
  't-snooze': {
    hour: 17.3,
    keys: drift(7, [-3.2, 8.45, 208.6], [-4.4, 8.3, 211.7], [-8.4, 9.1, 222], [-8.2, 8.9, 221.6]),
    update: (w) => lens(w, 40),
  },
  // A Chog gliding past on a hoverboard along the neighbourhood's walk, the camera turning to follow.
  't-board': {
    hour: 17.45,
    length: 7,
    async setup(w) {
      const info = await chogInfo(1151);
      const rider = await makeChog({ ...info, traits: { ...info.traits, Aura: null }, model: 'models/npcs/chog-1151.glb' });
      w.scene.add(rider.root);
      rider.play('idle');
      const boards = w.travel.hoverboards;
      // The last board (far off, on the beacon island): it won't be missed.
      const b = boards.boards.length - 1;
      boards.take(b);
      this._ride = { rider, b, last: 0 };
    },
    update(w, t) {
      const r = this._ride;
      if (!r) return;
      lens(w, 44);
      // Along the walk round the giant tree: past the camera and away round its curve.
      const cx = -11.2, cz = 227.7, R = 28, PHI = 1.16, sweep = 0.78;
      const th = PHI - sweep / 2 + (sweep * t) / 7;
      const x = cx + Math.cos(th) * R, z = cz + Math.sin(th) * R;
      const g = surfaceAt(x, z);
      // Facing along the walk, the way it goes.
      const yaw = Math.atan2(-Math.sin(th), Math.cos(th));
      const lift = BOARD.hover + BOARD.thick + Math.sin(t * 2.2) * 0.04;
      _p.set(x, g, z);
      const dt = Math.max(0, t - r.last);
      w.travel.hoverboards.carry(r.b, _p, yaw, -0.05, lift, 0);
      w.travel.hoverboards.update(dt, { night: 0.15 });
      r.rider.root.position.set(x, g + lift, z);
      r.rider.root.rotation.y = yaw;
      r.rider.update(dt, w.camera);
      r.last = t;
      // The camera low on the grass beside the walk, looking along its curve between a dome and the
      // lawn's mound; it turns a little with the rider.
      const camA = 0.92, Rc = 31;
      const camX = cx + Math.cos(camA) * Rc, camZ = cz + Math.sin(camA) * Rc;
      r.camY ??= surfaceAt(camX, camZ) + 1.6;
      w.camera.position.set(camX, r.camY, camZ);
      _q.set(cx + Math.cos(1.5) * 27, 4, cz + Math.sin(1.5) * 27);
      _p.set(x, g + 1.5, z);
      w.camera.lookAt(_q.lerp(_p, 0.5));
    },
  },
  // Cosmo afloat in his dome among the space rocks, the camera inside by the glass, keeping him in view.
  't-cosmo': {
    hour: 18.4,
    length: 7,
    update(w, t) {
      lens(w, 42);
      const cosmo = castChog(w, 68);
      const c = w.island.cosmo.centre;
      if (cosmo) {
        cosmo.getWorldPosition(_p);
        _p.y += 0.6;
      } else _p.set(c.x, c.y + 4, c.z);
      // Where he is, eased (he swims slowly; the camera never jerks after him).
      this._at = this._at ? this._at.lerp(_p, 0.05) : _p.clone();
      // Seven metres off him, a little below, on a side that turns slowly; kept inside the glass.
      const a = 2.3 + t * 0.035;
      _q.set(this._at.x + Math.cos(a) * 7.5, this._at.y - 1.2, this._at.z + Math.sin(a) * 7.5);
      const dx = _q.x - c.x, dz = _q.z - c.z, d = Math.hypot(dx, dz);
      if (d > 14.5) _q.set(c.x + (dx / d) * 14.5, _q.y, c.z + (dz / d) * 14.5);
      _q.y = Math.min(c.y + 11, Math.max(c.y + 1.4, _q.y));
      this._cam = this._cam ? this._cam.lerp(_q, 0.05) : _q.clone();
      w.camera.position.copy(this._cam);
      w.camera.lookAt(this._at);
    },
  },
  // Dusk off the first neighbourhood's edge, facing the sunset: the sky whale far out over the clouds, a
  // flight of mantas gliding out past the camera toward it.
  't-sky': {
    hour: 18.6,
    length: 8,
    setup() {
      const a = (205 * Math.PI) / 180;
      const C = new THREE.Vector3(-11.2 + Math.cos(a) * 75, 15, 227.7 + Math.sin(a) * 75);
      const D = new THREE.Vector3(-0.89, 0, -0.41).normalize();
      const S = new THREE.Vector3(-D.z, 0, D.x);
      const P = (f, s, up) => C.clone().addScaledVector(D, f).addScaledVector(S, s).add(new THREE.Vector3(0, up, 0));
      this._sky = { C, P, staged: false };
    },
    update(w) {
      const k = this._sky;
      if (!k) return;
      lens(w, 46);
      if (!k.staged && w.birds?.ready) {
        k.staged = true;
        k.whale = w.birds.stage('whale', k.P(150, -34, 14), k.P(144, 2, 20), k.P(150, 38, 17), 10)[0];
        w.birds.stage('flight', k.P(-12, -40, 22), k.P(60, -6, 26), k.P(150, 28, 30), 12, 3);
      }
      w.camera.position.copy(k.C);
      // The horizon low in the frame; the view leans a little after the whale.
      _p.copy(k.whale?.pos ?? k.P(145, 0, 18));
      _q.copy(k.P(150, 0, 30)).lerp(_p.setY(_p.y + 10), 0.35);
      w.camera.lookAt(_q);
    },
  },
  // The singer on her stage at night, the camera drifting along the crowd's edge.
  // ---------- v5 (the user, 10-23: the overview, the Hub, the lobby, the casino and the traits, and the new
  // things: a star, the race, King Pom's throne, Toasty's fire) ----------
  // The archipelago from high up at golden hour, drifting.
  't-overview': { hour: 17.4, keys: drift(6, [160, 235, 480], [134, 228, 468], [44, 0, 18], [40, 0, 16]), update: (w) => lens(w, 45) },
  // King Pom holding court on his throne by the fountain.
  't-throne': { hour: 17.3, keys: drift(6, [-1.6, 33.9, 46.0], [-2.6, 33.7, 44.6], [-11, 33.1, 50], [-11.2, 33.1, 50.2]), update: (w) => lens(w, 42) },
  // A star by the Beacon after dark, turning in its column of light.
  't-star': { hour: 21.2, keys: drift(6, [216.8, 4.4, -88.6], [215.6, 4.3, -90.4], [211.2, 3.2, -93.9]), update: (w) => lens(w, 40) },
  // Toasty's campfire at night.
  't-campfire': { hour: 21.6, keys: drift(6, [216.5, 6.2, -102.5], [214.4, 5.8, -104.8], [207.8, 2.4, -112.5]), update: (w) => lens(w, 44) },
  // Chog Hub at night: the lobby's arch, the bar, the casino, the ticker round the dome.
  't-hub': { hour: 20.5, keys: drift(6, [20, 44.2, 70], [16.6, 43.6, 66.6], [9, 40.9, 31.7], [8.4, 40.6, 31.2]), update: (w) => lens(w, 46) },
  // Inside: the lobby, and the Starlite Lounge.
  't-lobby': {
    hour: 20.5,
    setup(w) {
      w.rig.jump('lobby');
    },
    keys: drift(6, [6.8, 37.0, 8.8], [5.6, 36.8, 7.4], [-1.6, 33.4, -4], [-2.4, 33.4, -4.4]),
    update: (w) => lens(w, 54),
  },
  't-casino': {
    hour: 20.5,
    setup(w) {
      w.rig.jump('casino');
      // The room alone, without its game picker (the next shot plays a game).
      document.body.classList.add('demo-clean');
    },
    keys: drift(6, [31.4, 33.7, 5.0], [32.8, 33.6, 4.2], [40, 32.6, -3], [40.8, 32.6, -3.4]),
    update: (w) => lens(w, 54),
  },
  // The demo Chog at the slots: its edges along the top (an edge's card opens), and a spin that lands three
  // chips, paid at its Deep pockets rate.
  't-edges': {
    hour: 20.5,
    length: 9,
    async setup(w) {
      let arrived = false;
      w.session.demo().then(() => (arrived = true));
      await w.until(() => arrived, 120000);
      w.rig.jump('casino');
      await w.wait(600);
      w.casino.play('slots');
      await w.wait(2500);
    },
    events: [
      [1.4, () => document.querySelector('.cz-badge[data-i="2"]')?.click()],
      [4.6, () => document.querySelector('.cz-badge[data-i="2"]')?.click()],
      [5.0, (w) => w.casino._spin([3, 3, 3])],
    ],
  },
  // The race: your Chog on a hoverboard and Patrol on his chopper, neck and neck through the gates, the
  // camera riding alongside.
  't-race': {
    hour: 17.0,
    length: 8,
    async setup(w) {
      const info = await chogInfo(1151);
      const rider = await makeChog({ ...info, traits: { ...info.traits, Aura: null }, model: 'models/npcs/chog-1151.glb' });
      w.scene.add(rider.root);
      rider.play('idle');
      const boards = w.travel.hoverboards;
      const b = boards.boards.length - 2;
      boards.take(b);
      const patrol = await w.npcs.patrol();
      w.race.showcase(true, 2);
      // Both a little before the second gate, his nose just ahead.
      const HX = -11.2, HZ = 227.7, A = Math.atan2(HZ, HX) + Math.PI + 0.62;
      patrol.race(w.race.track, ((A - (Math.atan2(HZ, HX) + Math.PI)) / (Math.PI * 2)) * w.race.track.getLength() + 1.2, 9.6);
      this._race = { rider, b, patrol, HX, HZ, a: A, last: 0, cam: null };
    },
    update(w, t) {
      const r = this._race;
      if (!r) return;
      lens(w, 46);
      const dt = Math.max(0, t - r.last);
      r.last = t;
      const Rin = 24.9, v = 9.6;
      r.a += (dt * v) / Rin;
      r.patrol.speed = (v * 27.8) / Rin * (1 + Math.sin(t * 0.7) * 0.02);
      const x = r.HX + Math.cos(r.a) * Rin, z = r.HZ + Math.sin(r.a) * Rin;
      const g = surfaceAt(x, z);
      const yaw = Math.atan2(-Math.sin(r.a), Math.cos(r.a));
      const lift = BOARD.hover + BOARD.thick + Math.sin(t * 2.6) * 0.04;
      _p.set(x, g, z);
      w.travel.hoverboards.carry(r.b, _p, yaw, -0.06, lift, 0.12);
      w.travel.hoverboards.update(dt, { night: 0.1 });
      r.rider.root.position.set(x, g + lift, z);
      r.rider.root.rotation.y = yaw;
      r.rider.update(dt, w.camera);
      // Riding alongside, on the outside of the loop and a little behind, looking across the pair.
      const out = new THREE.Vector3(Math.cos(r.a), 0, Math.sin(r.a));
      const fwd = new THREE.Vector3(-Math.sin(r.a), 0, Math.cos(r.a));
      const want = _q.set(x, g + 3.4, z).addScaledVector(out, 9.5).addScaledVector(fwd, -5.5);
      r.cam = r.cam ? r.cam.lerp(want, Math.min(1, dt * 4)) : want.clone();
      w.camera.position.copy(r.cam);
      w.camera.lookAt(_p.set(x, g + 1.6, z).addScaledVector(out, 1.4).addScaledVector(fwd, 1.5));
    },
  },
  't-singer': {
    hour: 19.6,
    keys: drift(7, [21.2, 31.6, 35], [22.5, 31.65, 36.2], [27, 32, 30], [27.1, 32, 30.1]),
    update: (w) => lens(w, 40),
  },
});

// B5's name for it.
SHOTS.opening = SHOTS.overview;

// The world's own clock in a shot (the wind, the water, the clouds' drift) starts from here, so every
// take matches.
const WORLD_T0 = 5000;
// A held take moves the world on in steps no longer than this (ms).
const STEP = 1000 / 30;
// The clouds fill in their detail over several frames: a take's first frame comes after this many
// frames drawn, and a seek draws this many steps before the frame it lands on.
const SETTLE = 16;
const hash = (s) => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);

/**
 * Runs shot `name` in the world w (src/main.js hands over what a shot drives). capture: hold the
 * clock from the set-up on, for at(s). from: open the take at that second.
 */
export function createDemo(w, name, { capture = false, from = null } = {}) {
  const shot = SHOTS[name];
  const flight = shot.keys ? createFlight(shot) : null;
  const length = shot.length ?? flight.duration;
  const events = [...(shot.events ?? [])].sort((a, b) => a[0] - b[0]);
  const hourAt = (t) => (Array.isArray(shot.hour) ? shot.hour[0] + (shot.hour[1] - shot.hour[0]) * clamp01(t / length) : shot.hour);
  const realWait = (ms) => new Promise((r) => setTimeout(r, ms));
  let started = false;
  let t0 = 0;
  let t = 0;
  let fired = 0;
  let draws = true;
  let readyNow;
  const ready = new Promise((r) => (readyNow = r));

  // A held clock moved on by ms, a frame per step; only the last `drawn` steps are drawn.
  async function advance(ms, drawn = 0) {
    const n = Math.max(1, Math.ceil(ms / STEP - 1e-6));
    const end = clock.now + ms;
    for (let i = 0; i < n; i++) {
      draws = n - i <= drawn;
      await clock.step((end - clock.now) / (n - i));
      await clock.idle();
      w.frame();
    }
    draws = true;
  }
  // Frames drawn with the clock running but the shot's moment held (t0 moves with the clock).
  async function settle() {
    for (let i = 0; i < SETTLE; i++) {
      await clock.step(STEP);
      t0 += STEP;
      await clock.idle();
      w.frame();
    }
  }
  // The set-up's waits: on the shot's clock when it is held (quick, and the same every take).
  w.wait = (ms) => (clock.held ? advance(ms) : realWait(ms));
  w.until = async (fn, limit = 60000) => {
    for (let waited = 0; !fn() && waited < limit; waited += 100) await w.wait(100);
  };
  // Fades on the page still to run their course (the loading screen's, say).
  const fading = () =>
    document.getAnimations().filter((a) => {
      const end = a.effect?.getComputedTiming().endTime ?? Infinity;
      return end < Infinity && a.playState !== 'finished' && (a.currentTime ?? 0) < end;
    });
  // Until every download, model and warm-up the world asked for is in, and the page's fades are done,
  // and that has held for a moment.
  async function settled() {
    for (let quiet = 0, rounds = 0; quiet < 3 && rounds < 60; rounds++) {
      await clock.idle();
      const busy = w.busy() || fading().length > 0;
      await w.wait(busy ? 250 : 100);
      quiet = busy ? 0 : quiet + 1;
    }
  }

  async function start() {
    document.body.classList.add('demo');
    w.time.live = false;
    w.time.hour = hourAt(0);
    w.rig.idleSpin = false;
    if (capture) {
      await settled();
      clock.hold();
      w.loop(false);
    }
    await shot.setup?.(w);
    await settled();
    clock.seed(hash(name));
    t0 = performance.now();
    started = true;
    if (capture) await settle();
    readyNow();
    if (from !== null) await window.chogDemo.at(from);
  }

  const api = {
    name,
    length,
    get t() {
      return t;
    },
    // The world's clock this frame, or null before the shot starts (the world keeps its own).
    get worldT() {
      return started ? WORLD_T0 + t : null;
    },
    // False while a held clock moves the world on without drawing every step.
    get draws() {
      return draws;
    },
    // Each frame, after the rig: the shot's time, its hour, its cutscenes, and its camera.
    update() {
      if (!started) return;
      t = Math.min(length, (performance.now() - t0) / 1000);
      w.time.hour = hourAt(t);
      while (fired < events.length && events[fired][0] <= t) events[fired++][1](w);
      shot.update?.(w, t);
      flight?.pose(w.camera, t);
    },
  };

  window.chogDemo = {
    shot: name,
    duration: length,
    // Resolves once the shot is set up and showing its first frame.
    ready,
    get t() {
      return t;
    },
    /**
     * Sets the whole world to second s of the shot and draws it. Resolves once that frame is on the
     * canvas. Takes run forward: an earlier second reloads the page at it (a fresh take).
     */
    async at(s) {
      await ready;
      s = Math.min(length, Math.max(0, s));
      if (!clock.held) {
        clock.hold();
        w.loop(false);
        t0 = performance.now() - t * 1000;
      }
      const target = t0 + s * 1000;
      if (target < clock.now - 0.5) {
        const p = new URLSearchParams(location.search);
        p.set('capture', '');
        p.set('at', String(s));
        location.search = p.toString();
        return new Promise(() => {});
      }
      // A long seek moves the world on undrawn but for its last steps, so the frame it lands on has
      // settled and is the very one a frame-by-frame take gets there.
      await advance(target - clock.now, SETTLE);
      return t;
    },
  };

  start().catch((err) => console.error('Demo shot:', err));
  return api;
}
