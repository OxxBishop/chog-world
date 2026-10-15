import { demoClock as clock } from './democlock.js';
import { createFlight } from './flight.js';

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
