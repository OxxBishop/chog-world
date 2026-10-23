import * as THREE from 'three';

/*
 * The island's sound (A for C's C6, 10-21; the music made in Gemini from video/flow-prompts.md):
 *   the island theme by day and the night theme after dark, crossfading as the sky turns;
 *   the singer's song from the plaza stage, placed in the world (louder and to the side you hear it
 *   from as you walk up, and the theme dips under it);
 *   indoors everything outside is muffled.
 * Tracks stream (an audio element each, never decoded whole), and loop by crossfading their last few
 * seconds into their start, so an ending never plays. Nothing sounds until the first tap, click or key
 * (browsers hold audio until then); the speaker button (and M) mutes, remembered on this device.
 *
 * createAudio({ button }) -> { update(dt, { camera, night, indoors, stage }), duck(k), muted }
 *   stage: the singer's stage in world space, or null while it isn't built.
 *
 * Effects (B, 10-22): anything can ask for one with
 *   dispatchEvent(new CustomEvent('chog-sfx', { detail: 'chip' }))
 * The casino's: chip (a chip down), chips (chips gathered up), spin (the ball round the wheel, about
 * 6 s), drop (the ball into its pocket), win, nowin. Each plays public/audio/sfx/<name>.mp3 when there
 * is one (ElevenLabs takes can go straight in there), else its own synthesized take below.
 */
const BASE = import.meta.env?.BASE_URL ?? '/';
const XFADE = 6; // seconds of overlap at each loop
const LEVEL = { theme: 0.32, singer: 0.9 };

const read = (k) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k, v) => {
  try {
    localStorage.setItem(k, v);
  } catch {}
};

// A looping track: two elements taking turns, each fading into the next's start.
function loopTrack(ctx, url, out) {
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(out);
  const voices = [0, 1].map(() => {
    const el = new Audio();
    el.crossOrigin = 'anonymous';
    el.preload = 'none';
    el.src = url;
    const g = ctx.createGain();
    g.gain.value = 0;
    ctx.createMediaElementSource(el).connect(g).connect(gain);
    return { el, g };
  });
  let cur = 0, on = false;
  const start = (v, at = 0) => {
    v.el.currentTime = at;
    v.el.play().catch(() => {});
  };
  return {
    gain,
    // Playing at all (a silent track rests, so it costs nothing).
    set on(want) {
      if (want === on) return;
      on = want;
      const v = voices[cur];
      if (want) {
        v.g.gain.setTargetAtTime(1, ctx.currentTime, 0.05);
        if (v.el.paused) start(v, v.el.currentTime || 0);
      } else for (const w of voices) w.el.pause();
    },
    get on() {
      return on;
    },
    // Hand over to the other voice when this one nears its end.
    tick() {
      if (!on) return;
      const v = voices[cur];
      const d = v.el.duration;
      if (!d || !isFinite(d) || v.el.currentTime < d - XFADE) return;
      const next = voices[1 - cur];
      const now = ctx.currentTime;
      next.g.gain.cancelScheduledValues(now);
      next.g.gain.setValueAtTime(0, now);
      next.g.gain.linearRampToValueAtTime(1, now + XFADE);
      v.g.gain.cancelScheduledValues(now);
      v.g.gain.setValueAtTime(v.g.gain.value, now);
      v.g.gain.linearRampToValueAtTime(0, now + XFADE);
      start(next, 0);
      const old = v;
      setTimeout(() => old.el.pause(), XFADE * 1000 + 200);
      cur = 1 - cur;
    },
    // From the top, crossfading over from wherever it is (the singer's encore, src/purse.js).
    restart() {
      if (!on) return;
      const v = voices[cur], next = voices[1 - cur];
      const now = ctx.currentTime;
      next.g.gain.cancelScheduledValues(now);
      next.g.gain.setValueAtTime(0, now);
      next.g.gain.linearRampToValueAtTime(1, now + 1.2);
      v.g.gain.cancelScheduledValues(now);
      v.g.gain.setValueAtTime(v.g.gain.value, now);
      v.g.gain.linearRampToValueAtTime(0, now + 1.2);
      start(next, 0);
      setTimeout(() => v.el.pause(), 1400);
      cur = 1 - cur;
    },
    // For a test: where each voice is.
    get state() {
      return voices.map((v) => (v.el.paused ? 'paused' : `playing ${v.el.currentTime.toFixed(1)}s`) + (v.el.error ? ` error ${v.el.error.code}` : ''));
    },
    // Unlocking on iOS: an element must first be played inside the gesture.
    prime() {
      // (Played and paused at once: only the first moments load until it is wanted.)
      for (const v of voices) {
        v.el.preload = 'metadata';
        v.el.play().then(() => voices.indexOf(v) === cur && on ? null : v.el.pause()).catch(() => {});
      }
    },
  };
}

// ---------- effects: synthesized takes (a file in audio/sfx/ wins over these) ----------
// The recorded takes there, known when the site is built (so no request goes out for one that isn't).
const RECORDED = new Set(Object.keys(import.meta.glob('../public/audio/sfx/*.mp3')).map((f) => f.split('/').pop().replace('.mp3', '')));
const SFX = ['chip', 'chips', 'spin', 'drop', 'win', 'nowin', 'beep', 'go', 'gate', 'finish', 'star', 'stars', 'coin'];
// White noise, made once a context.
const noiseOf = (() => {
  const made = new WeakMap();
  return (ctx) => {
    if (!made.has(ctx)) {
      const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      made.set(ctx, b);
    }
    return made.get(ctx);
  };
})();
// A clay chip on felt or on another chip: a short bright knock with a ring in it.
function knock(ctx, out, t, { pitch = 1, level = 0.5 } = {}) {
  const n = ctx.createBufferSource();
  n.buffer = noiseOf(ctx);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 3400 * pitch;
  bp.Q.value = 5;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(level, t + 0.0015);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
  n.connect(bp).connect(g).connect(out);
  n.start(t, Math.random() * 1.5, 0.06);
  // The ring: two inharmonic partials, quick to die.
  for (const [f, a] of [[2650, 0.22], [4180, 0.12]]) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f * pitch;
    const og = ctx.createGain();
    og.gain.setValueAtTime(0, t);
    og.gain.linearRampToValueAtTime(level * a, t + 0.002);
    og.gain.exponentialRampToValueAtTime(0.0008, t + 0.07);
    o.connect(og).connect(out);
    o.start(t);
    o.stop(t + 0.09);
  }
}
// A soft bell note (two sines, an octave and a fifth's shimmer), for the win's little tune.
function bell(ctx, out, t, f, level, dur = 0.9) {
  for (const [m, a] of [[1, 1], [2, 0.28], [3.01, 0.08]]) {
    const o = ctx.createOscillator();
    o.type = m === 1 ? 'triangle' : 'sine';
    o.frequency.value = f * m;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level * a, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur * (m === 1 ? 1 : 0.6));
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
}
const SYNTH = {
  chip(ctx, out, t) {
    // Two knocks: it lands, then settles on the stack.
    const p = 0.94 + Math.random() * 0.12;
    knock(ctx, out, t, { pitch: p, level: 0.42 });
    knock(ctx, out, t + 0.032 + Math.random() * 0.01, { pitch: p * 1.06, level: 0.2 });
  },
  chips(ctx, out, t) {
    // A handful raked in: a quick patter of knocks, thinning out.
    let at = t;
    for (let i = 0; i < 11; i++) {
      knock(ctx, out, at, { pitch: 0.88 + Math.random() * 0.26, level: 0.34 * (1 - i / 14) });
      at += 0.022 + Math.random() * 0.045;
    }
  },
  spin(ctx, out, t) {
    // The ball round the track: a rolling hiss that circles (louder as it passes near), slowing and
    // falling in pitch; then it rattles across the frets, the clicks spacing out.
    const T = 4.6;
    const n = ctx.createBufferSource();
    n.buffer = noiseOf(ctx);
    n.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 2.2;
    bp.frequency.setValueAtTime(1500, t);
    bp.frequency.exponentialRampToValueAtTime(520, t + T);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.25);
    g.gain.setValueAtTime(0.16, t + T - 1.2);
    g.gain.linearRampToValueAtTime(0, t + T);
    // Laps: a tremolo whose rate falls as the ball slows.
    const lap = ctx.createOscillator();
    lap.frequency.setValueAtTime(3.2, t);
    lap.frequency.linearRampToValueAtTime(1.1, t + T);
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(0.07, t);
    depth.gain.linearRampToValueAtTime(0, t + T);
    lap.connect(depth).connect(g.gain);
    n.connect(bp).connect(g).connect(out);
    n.start(t);
    n.stop(t + T + 0.1);
    lap.start(t);
    lap.stop(t + T + 0.1);
    // Over the frets.
    let at = t + T - 0.9, gap = 0.05;
    while (at < t + T + 1.0) {
      knock(ctx, out, at, { pitch: 0.7 + Math.random() * 0.15, level: 0.16 });
      at += gap;
      gap *= 1.16;
    }
  },
  drop(ctx, out, t) {
    // Into the pocket: a hop, a smaller one, and still.
    knock(ctx, out, t, { pitch: 0.78, level: 0.4 });
    knock(ctx, out, t + 0.11, { pitch: 0.82, level: 0.22 });
    knock(ctx, out, t + 0.19, { pitch: 0.8, level: 0.1 });
  },
  win(ctx, out, t) {
    // A bright little rise, E major, and a shimmer over it.
    [659.3, 830.6, 987.8, 1318.5].forEach((f, i) => bell(ctx, out, t + i * 0.085, f, 0.14, 1.1));
    bell(ctx, out, t + 0.36, 1975.5, 0.05, 1.4);
  },
  nowin(ctx, out, t) {
    // Two soft notes down: no fuss.
    bell(ctx, out, t, 440, 0.08, 0.5);
    bell(ctx, out, t + 0.16, 329.6, 0.07, 0.7);
  },
  // The race (src/race.js): 3, 2, 1 and away; a gate passed; over the line.
  beep(ctx, out, t) {
    bell(ctx, out, t, 659.3, 0.11, 0.35);
  },
  go(ctx, out, t) {
    bell(ctx, out, t, 1318.5, 0.13, 0.7);
    bell(ctx, out, t, 987.8, 0.07, 0.6);
  },
  gate(ctx, out, t) {
    bell(ctx, out, t, 1046.5, 0.06, 0.35);
    bell(ctx, out, t + 0.07, 1568, 0.05, 0.45);
  },
  finish(ctx, out, t) {
    [523.3, 659.3, 784, 1046.5].forEach((f, i) => bell(ctx, out, t + i * 0.09, f, 0.09, 1.1));
    bell(ctx, out, t + 0.36, 2093, 0.035, 1.4);
  },
  // The star hunt (src/stars.js): one found, and the last of the twelve.
  star(ctx, out, t) {
    [1318.5, 1760, 2637].forEach((f, i) => bell(ctx, out, t + i * 0.06, f, 0.06 - i * 0.012, 0.9));
  },
  stars(ctx, out, t) {
    [659.3, 830.6, 987.8, 1318.5, 1661.2, 1975.5].forEach((f, i) => bell(ctx, out, t + i * 0.12, f, 0.08, 1.6));
  },
  // Testnet $CHOG coming in (src/purse.js).
  coin(ctx, out, t) {
    bell(ctx, out, t, 1975.5, 0.05, 0.25);
    bell(ctx, out, t + 0.08, 2637, 0.045, 0.4);
  },
};

export function createAudio({ button = null } = {}) {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return { update() {}, duck() {}, muted: true };
  let ctx = null, master = null, music = null, outside = null, muffle = null;
  let day = null, night = null, singer = null, panner = null;
  let muted = read('chog-sound') === 'off';
  let ducked = 1;
  const show = () => {
    if (!button) return;
    button.classList.toggle('off', muted);
    button.setAttribute('aria-label', muted ? 'Sound on' : 'Sound off');
    button.title = muted ? 'Sound on' : 'Sound off';
  };
  show();

  // Built on the first gesture, inside it, so every browser lets it play.
  const unlock = () => {
    if (ctx) {
      if (ctx.state === 'suspended' && !document.hidden) ctx.resume();
      return;
    }
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(ctx.destination);
    // Outdoors sound goes through a lowpass that closes indoors.
    muffle = ctx.createBiquadFilter();
    muffle.type = 'lowpass';
    muffle.frequency.value = 20000;
    muffle.connect(master);
    outside = ctx.createGain();
    outside.connect(muffle);
    music = ctx.createGain();
    music.gain.value = LEVEL.theme;
    music.connect(outside);
    day = loopTrack(ctx, `${BASE}audio/island.mp3`, music);
    night = loopTrack(ctx, `${BASE}audio/night.mp3`, music);
    // The singer: a panner at the stage, heard from about 45 m off, full by the front row.
    panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 7;
    panner.rolloffFactor = 1.6;
    panner.maxDistance = 200;
    panner.connect(outside);
    const sg = ctx.createGain();
    sg.gain.value = LEVEL.singer;
    sg.connect(panner);
    singer = loopTrack(ctx, `${BASE}audio/singer.mp3`, sg);
    for (const t of [day, night, singer]) t.prime();
    // Effects: straight to the master (heard indoors or out, never muffled).
    sfxBus = ctx.createGain();
    sfxBus.gain.value = 0.9;
    sfxBus.connect(master);
    for (const name of SFX) {
      if (!RECORDED.has(name)) continue;
      fetch(`${BASE}audio/sfx/${name}.mp3`)
        .then((r) => (r.ok && (r.headers.get('content-type') ?? '').includes('audio') ? r.arrayBuffer() : null))
        .then((b) => b && ctx.decodeAudioData(b))
        .then((buf) => buf && (takes[name] = buf))
        .catch(() => {});
    }
  };
  let sfxBus = null;
  const takes = {};
  const sfx = (name) => {
    if (!ctx || ctx.state !== 'running' || muted || !sfxBus) return;
    const t = ctx.currentTime + 0.01;
    if (takes[name]) {
      const src = ctx.createBufferSource();
      src.buffer = takes[name];
      src.connect(sfxBus);
      src.start(t);
    } else SYNTH[name]?.(ctx, sfxBus, t);
  };
  addEventListener('chog-sfx', (e) => sfx(e.detail));
  for (const ev of ['pointerdown', 'keydown', 'touchend']) addEventListener(ev, unlock, { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend();
    else ctx.resume();
  });

  const setMuted = (m) => {
    muted = m;
    write('chog-sound', m ? 'off' : 'on');
    show();
    if (master) master.gain.setTargetAtTime(m ? 0 : 1, ctx.currentTime, 0.08);
  };
  button?.addEventListener('click', () => setMuted(!muted));
  addEventListener('keydown', (e) => {
    // (No key: M opens the map.)
  });

  const fwd = new THREE.Vector3(), up = new THREE.Vector3();
  let nightK = null, inK = 0, heard = 0;
  return {
    get muted() {
      return muted;
    },
    get state() {
      return { ctx: ctx?.state ?? 'locked', nightK, day: day?.state, night: night?.state, singer: singer?.state };
    },
    // An effect by name (see SFX); the same as dispatching a 'chog-sfx' event.
    sfx,
    // The singer's song from the top (a request, src/purse.js).
    encore() {
      singer?.restart();
    },
    // Something with its own sound (a cutscene) wants the music down: 0 silent to 1 full.
    duck(k) {
      ducked = k;
    },
    update(dt, { camera, night: n = 0, indoors = false, stage = null, quiet = false }) {
      if (!ctx || ctx.state !== 'running') return;
      const now = ctx.currentTime;
      // Day into night over the dusk, not at a switch.
      nightK = nightK === null ? n : nightK + (n - nightK) * Math.min(1, dt * 0.5);
      const k = THREE.MathUtils.smoothstep(nightK, 0.25, 0.75);
      // Nothing plays until you land (quiet: the connect screen, the flights down).
      if (quiet) heard = 0;
      else heard = Math.min(1, heard + dt / 3);
      day.on = !quiet && k < 0.999;
      night.on = !quiet && k > 0.001;
      day.gain.gain.setTargetAtTime(Math.cos((k * Math.PI) / 2), now, 0.1);
      night.gain.gain.setTargetAtTime(Math.sin((k * Math.PI) / 2), now, 0.1);
      // The listener is the camera.
      const L = ctx.listener;
      camera.getWorldDirection(fwd);
      up.set(0, 1, 0).applyQuaternion(camera.quaternion);
      const p = camera.position;
      if (L.positionX) {
        L.positionX.setTargetAtTime(p.x, now, 0.05);
        L.positionY.setTargetAtTime(p.y, now, 0.05);
        L.positionZ.setTargetAtTime(p.z, now, 0.05);
        L.forwardX.setTargetAtTime(fwd.x, now, 0.05);
        L.forwardY.setTargetAtTime(fwd.y, now, 0.05);
        L.forwardZ.setTargetAtTime(fwd.z, now, 0.05);
        L.upX.setTargetAtTime(up.x, now, 0.05);
        L.upY.setTargetAtTime(up.y, now, 0.05);
        L.upZ.setTargetAtTime(up.z, now, 0.05);
      } else {
        L.setPosition(p.x, p.y, p.z);
        L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
      }
      // The singer sings when you could hear her; the theme dips as she gets loud.
      let near = 0;
      if (stage) {
        const d = p.distanceTo(stage);
        singer.on = !quiet && d < 140;
        if (panner.positionX) {
          panner.positionX.setTargetAtTime(stage.x, now, 0.05);
          panner.positionY.setTargetAtTime(stage.y + 1.5, now, 0.05);
          panner.positionZ.setTargetAtTime(stage.z, now, 0.05);
        } else panner.setPosition(stage.x, stage.y + 1.5, stage.z);
        near = 1 - THREE.MathUtils.smoothstep(d, 10, 45);
      } else singer.on = false;
      music.gain.setTargetAtTime(LEVEL.theme * (1 - near * 0.75) * ducked * heard, now, 0.3);
      // Indoors, the outside is muffled and quieter.
      inK += ((indoors ? 1 : 0) - inK) * Math.min(1, dt * 3);
      muffle.frequency.setTargetAtTime(20000 * Math.pow(900 / 20000, inK), now, 0.1);
      outside.gain.setTargetAtTime(1 - inK * 0.45, now, 0.1);
      for (const t of [day, night, singer]) t.tick();
    },
  };
}
