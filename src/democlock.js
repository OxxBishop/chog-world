/*
 * The demo's clock (B13). With ?demo in the address, time in the page can be taken over so a shot can
 * be stepped frame by frame, and every frame is exactly one step of the shot's time apart at any frame
 * rate. Once held, performance.now(), timers, animation frames and the page's CSS animations all run
 * on the shot's clock, which only moves when step() is called. Math.random is seeded, so the world's
 * chance moments come out the same from take to take.
 *
 * Imported first by src/main.js, so it is in place before anything else reads the time.
 */

import { DefaultLoadingManager } from 'three';

const on = new URLSearchParams(location.search).has('demo');

const real = {
  now: performance.now.bind(performance),
  setTimeout: window.setTimeout.bind(window),
  clearTimeout: window.clearTimeout.bind(window),
  setInterval: window.setInterval.bind(window),
  clearInterval: window.clearInterval.bind(window),
  raf: window.requestAnimationFrame.bind(window),
  caf: window.cancelAnimationFrame.bind(window),
};

// Mulberry32: small, fast, and the same numbers in every browser.
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let held = false;
let now = 0;
// Ids well clear of the browser's own, so clearing either kind works.
let nextId = 1e9;
const timers = new Map(); // id -> { due, fn, args, every }
let frames = new Map(); // id -> fn
const paused = new WeakSet();
// Downloads and image loads in flight: a step waits for them, so a slow network doesn't change a take.
// One that has gone on for longer than STUCK ms is taken as never finishing.
const pending = new Map();
let pendingKey = 0;
const STUCK = 15000;
function begin() {
  const k = ++pendingKey;
  pending.set(k, real.now());
  return () => pending.delete(k);
}
const busy = () => [...pending.values()].some((t0) => real.now() - t0 < STUCK);

function install() {
  performance.now = () => (held ? now : real.now());
  window.setTimeout = (fn, ms = 0, ...args) => {
    if (!held) return real.setTimeout(fn, ms, ...args);
    const id = nextId++;
    timers.set(id, { due: now + Math.max(0, +ms || 0), fn, args });
    return id;
  };
  window.setInterval = (fn, ms = 0, ...args) => {
    if (!held) return real.setInterval(fn, ms, ...args);
    const id = nextId++;
    const every = Math.max(1, +ms || 0);
    timers.set(id, { due: now + every, fn, args, every });
    return id;
  };
  const clear = (id) => {
    if (timers.has(id)) timers.delete(id);
    else {
      real.clearTimeout(id);
      real.clearInterval(id);
    }
  };
  window.clearTimeout = clear;
  window.clearInterval = clear;
  window.requestAnimationFrame = (fn) => {
    if (!held) return real.raf(fn);
    const id = nextId++;
    frames.set(id, fn);
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    if (frames.has(id)) frames.delete(id);
    else real.caf(id);
  };
  const fetch0 = window.fetch.bind(window);
  window.fetch = (...a) => {
    const end = begin();
    return fetch0(...a).finally(end);
  };
  // three's loaders (models, textures) report each file from the start of its download to its end.
  const items = new Map();
  const { itemStart, itemEnd, itemError } = DefaultLoadingManager;
  DefaultLoadingManager.itemStart = (url) => {
    items.set(url, [...(items.get(url) ?? []), begin()]);
    itemStart(url);
  };
  const itemDone = (url) => {
    items.get(url)?.shift()?.();
  };
  DefaultLoadingManager.itemEnd = (url) => {
    itemDone(url);
    itemEnd(url);
  };
  DefaultLoadingManager.itemError = (url) => {
    itemDone(url);
    itemError(url);
  };
  const src = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  Object.defineProperty(HTMLImageElement.prototype, 'src', {
    ...src,
    set(v) {
      if (!this.__loadEnd) {
        const end = begin();
        const done = () => {
          end();
          this.__loadEnd = null;
          this.removeEventListener('load', done);
          this.removeEventListener('error', done);
        };
        this.__loadEnd = done;
        this.addEventListener('load', done);
        this.addEventListener('error', done);
      }
      src.set.call(this, v);
    },
  });
}

const yieldReal = () => new Promise((r) => real.setTimeout(r, 0));

// CSS animations and transitions: paused, then moved on by hand with the clock. One that started
// during a step starts from its beginning.
function moveAnimations(ms) {
  for (const a of document.getAnimations()) {
    if (!paused.has(a)) {
      paused.add(a);
      a.pause();
      continue;
    }
    const end = a.effect?.getComputedTiming().endTime ?? Infinity;
    const t = (a.currentTime ?? 0) + ms * (a.playbackRate || 1);
    if (t >= end) a.finish();
    else a.currentTime = t;
  }
}

export const demoClock = {
  on,
  get held() {
    return held;
  },
  get now() {
    return held ? now : real.now();
  },
  // The page's own clock: real time, whatever the shot's clock is doing.
  realNow: () => real.now(),
  // Same seed, same numbers.
  seed(n) {
    if (on) Math.random = seeded(n);
  },
  // Takes time over from here: it stands still until step().
  hold() {
    if (held || !on) return;
    now = real.now();
    held = true;
    for (const a of document.getAnimations()) {
      paused.add(a);
      a.pause();
    }
  },
  // Waits (in real time) for downloads and image loads to finish and stay finished for a moment, at
  // most limit ms.
  async idle(limit = 20000) {
    if (!busy()) return yieldReal();
    const t0 = real.now();
    let quiet = null;
    while (real.now() - t0 < limit) {
      if (busy()) quiet = null;
      else if ((quiet ??= real.now()) && real.now() - quiet > 120) break;
      await new Promise((r) => real.setTimeout(r, 20));
    }
    await yieldReal();
  },
  /**
   * Moves the held clock on by ms: the timers that fall due go off in order (each at its own time,
   * with what it set going waiting in between), then the animation frames waiting run, then the CSS
   * animations move on.
   */
  async step(ms) {
    const end = now + ms;
    for (;;) {
      let next = null;
      for (const [id, t] of timers) if (t.due <= end && (!next || t.due < next[1].due)) next = [id, t];
      if (!next) break;
      const [id, t] = next;
      now = Math.max(now, t.due);
      if (t.every) t.due += t.every;
      else timers.delete(id);
      try {
        t.fn(...t.args);
      } catch (err) {
        console.error(err);
      }
      await yieldReal();
    }
    now = end;
    const run = frames;
    frames = new Map();
    for (const fn of run.values()) {
      try {
        fn(now);
      } catch (err) {
        console.error(err);
      }
    }
    moveAnimations(ms);
    await yieldReal();
  },
};

if (on) {
  install();
  demoClock.seed(20261022);
}
