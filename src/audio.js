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
  };
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
  let nightK = null, inK = 0;
  return {
    get muted() {
      return muted;
    },
    get state() {
      return { ctx: ctx?.state ?? 'locked', nightK, day: day?.state, night: night?.state, singer: singer?.state };
    },
    // Something with its own sound (a cutscene) wants the music down: 0 silent to 1 full.
    duck(k) {
      ducked = k;
    },
    update(dt, { camera, night: n = 0, indoors = false, stage = null }) {
      if (!ctx || ctx.state !== 'running') return;
      const now = ctx.currentTime;
      // Day into night over the dusk, not at a switch.
      nightK = nightK === null ? n : nightK + (n - nightK) * Math.min(1, dt * 0.5);
      const k = THREE.MathUtils.smoothstep(nightK, 0.25, 0.75);
      day.on = k < 0.999;
      night.on = k > 0.001;
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
        singer.on = d < 140;
        if (panner.positionX) {
          panner.positionX.setTargetAtTime(stage.x, now, 0.05);
          panner.positionY.setTargetAtTime(stage.y + 1.5, now, 0.05);
          panner.positionZ.setTargetAtTime(stage.z, now, 0.05);
        } else panner.setPosition(stage.x, stage.y + 1.5, stage.z);
        near = 1 - THREE.MathUtils.smoothstep(d, 10, 45);
      } else singer.on = false;
      music.gain.setTargetAtTime(LEVEL.theme * (1 - near * 0.75) * ducked, now, 0.3);
      // Indoors, the outside is muffled and quieter.
      inK += ((indoors ? 1 : 0) - inK) * Math.min(1, dt * 3);
      muffle.frequency.setTargetAtTime(20000 * Math.pow(900 / 20000, inK), now, 0.1);
      outside.gain.setTargetAtTime(1 - inK * 0.45, now, 0.1);
      for (const t of [day, night, singer]) t.tick();
    },
  };
}
