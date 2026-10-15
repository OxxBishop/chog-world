import * as THREE from 'three';
import { createPlanet, RADIUS } from './planet.js';
import { createWarp } from './warp.js';
import { createCosmos } from './cosmos.js';

/*
 * The world seen from space (B25): Chog World, the planet the islands are part of, turning slowly in
 * a starry violet void, a little lilac moon going round it (src/planet.js). It's what the connect
 * screen opens on, and where you are carried when you leave the world (a sale, signing out).
 *
 * The way there and back is warp speed (src/warp.js):
 *   out    the view tilts up to the sky and launches, streaks rush past, a flash, the violet tunnel;
 *          a beat later it drops out of warp into orbit, the planet filling the view
 *   in     from orbit the view lunges at the planet, streaks and a pink glow of entry, the screen
 *          white; then the world (leave()), or the white held for the caller to take over (dive(),
 *          the arrival: src/arrival.js wakes you up in your Chog's dome)
 * Under prefers-reduced-motion both are a plain fade.
 *
 * Out here the world is not drawn at all: the camera sees only render layer 1, which only the void,
 * the stars, the planet and the warp are on (they're on layer 0 too, so the load draws them with the
 * rest and their shaders are built before anything shows, B12).
 */

const SPACE = 1;

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (x, a, b) => THREE.MathUtils.smoothstep(x, a, b);
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const easeOut = (x) => 1 - Math.pow(1 - clamp01(x), 3);
// 0 to 1 over [a, b], then back to 0 over [b, c].
const bump = (x, a, b, c) => (x < b ? smooth(x, a, b) : 1 - smooth(x, b, c));
const still = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * rig: the camera rig, whose pose is where the world comes back to. dip(fn): a quick fade to dark
 * and back, running fn while it is dark. quality: 'low' paints the planet smaller and thins the warp.
 */
export function createSpace({ scene, camera, renderer, sky, clouds, rig, dip, quality = 'high' }) {
  const group = new THREE.Group();
  group.visible = false;
  // The planet's look (src/planet.js), the user's pick; ?planet= shows the others.
  const planet = createPlanet({ renderer, quality, style: new URLSearchParams(location.search).get('planet') ?? 'amethyst' });
  // The space round it (src/cosmos.js): the nebulae, the stars, the debris belt (outside the rings,
  // in their plane, where there are rings).
  const ringed = planet.ring;
  const cosmos = createCosmos({ renderer, quality, sun: planet.sun, radius: RADIUS, belt: ringed ? { inner: ringed.outer + 0.1, outer: ringed.outer + 0.5, normal: ringed.normal } : undefined });
  // The sky round the camera, wherever it goes; the planet and its debris where they are.
  const sphere = cosmos.sky;
  planet.group.add(cosmos.debris);
  const warp = createWarp({ quality });
  group.add(sphere, planet.group);
  scene.add(group);
  // The warp draws over everything, in the world too.
  scene.add(warp.group);
  for (const root of [group, warp.group]) root.traverse((o) => o.layers.enable(SPACE));

  // 'off', 'out' (warping out), 'there' (in orbit), 'in' (diving at the planet), 'held' (white, for the caller)
  let state = 'off';
  let run = null;
  let time = 0;
  let lastNow = performance.now();
  let fov = null;
  // In space (1) or in the world (0): which the camera sees.
  let k = 0;
  const C = new THREE.Vector3();
  const pos = new THREE.Vector3(), look = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();

  // The orbit: back far enough for the planet to fill the lower part of the view, its rim glowing,
  // the stars above; swaying a little, never still. On a tall screen a little further out.
  function orbit(t, outPos, outLook) {
    const tall = camera.aspect < 1;
    // With wide rings, further out, so they fit round it.
    const D = RADIUS * (tall ? 2.75 : 2.3) * (planet.style === 'bloom' ? 1.25 : 1);
    const a = 0.32 + Math.sin(t * 0.045) * 0.06;
    const e = 0.1 + Math.sin(t * 0.031 + 1.0) * 0.02;
    outPos.set(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)).multiplyScalar(D).add(C);
    outLook.copy(C).addScaledVector(up, RADIUS * (tall ? 0.62 : 0.78));
    return outPos;
  }
  function ensureFar() {
    const need = RADIUS * 6;
    if (camera.far < need) {
      camera.far = need;
      camera.updateProjectionMatrix();
    }
  }
  const into = (on) => {
    k = on ? 1 : 0;
    if (on) rig.room = null;
  };

  // Resolves once the planet and the sky are painted (a frame or two of tiles each, in the load).
  let painted;
  const ready = new Promise((r) => (painted = r));
  const api = {
    // The planet and the sky round it, and the warp: drawn once behind the loader so their shaders
    // are built (B12).
    group,
    ready,
    warp,
    planet,
    get active() {
      return state !== 'off';
    },
    /** The lens the warp wants (degrees), or null when it has no say. */
    fov: () => fov,

    /**
     * Warps out to the planet, from wherever the view is (from: the room it's in, if any). duration 0
     * goes straight there. Resolves once in orbit, and stays until leave().
     */
    enter({ from = null, duration = 4 } = {}) {
      ensureFar();
      // From inside a room: a quick dip out to just beyond its dome, looking back at it, and the launch
      // from there (so it never lifts off through a ceiling).
      if (from && duration > 0 && !still()) {
        return new Promise((resolve) =>
          dip(() => {
            rig.room = null;
            const home = from.room.group.getWorldPosition(new THREE.Vector3());
            const out = new THREE.Vector3(home.x, 0, home.z).normalize();
            if (out.lengthSq() < 1e-6) out.set(0, 0, 1);
            camera.position.copy(home).addScaledVector(out, 48).setY(home.y + 30);
            camera.lookAt(home.x, home.y + 4, home.z);
            camera.updateMatrixWorld();
            api.enter({ duration }).then(resolve);
          }),
        );
      }
      if (duration <= 0 || still()) {
        const go = () => {
          into(true);
          state = 'there';
          run = null;
        };
        if (duration <= 0) {
          go();
          return Promise.resolve();
        }
        return new Promise((resolve) => dip(() => (go(), resolve())));
      }
      state = 'out';
      // Where the view starts: the camera this frame, looking where the rig looks.
      const p0 = camera.position.clone();
      const f0 = camera.getWorldDirection(new THREE.Vector3());
      // Up toward the sky, still a little forward.
      const f1 = f0.clone().setY(0).normalize().multiplyScalar(0.5).add(new THREE.Vector3(0, 1, 0)).normalize();
      return new Promise((resolve) => {
        run = { kind: 'out', t: 0, p0, f0, f1, fov0: camera.fov, done: resolve, swapped: false, from: new THREE.Vector3(), lookFrom: new THREE.Vector3() };
      });
    },

    /**
     * Back to the world: at once (under a fade the caller runs, duration 0), or diving at the planet
     * and coming out of the white into the world where the rig has the view. Resolves once it's back.
     */
    leave({ duration = 0 } = {}) {
      if (state === 'off') return Promise.resolve();
      if (duration <= 0 || state === 'held') {
        run?.done?.();
        run = null;
        state = 'off';
        into(false);
        fov = null;
        warp.set({});
        api.apply();
        return Promise.resolve();
      }
      if (still()) return new Promise((resolve) => dip(() => (api.leave(), resolve())));
      return api.dive().then(
        () =>
          new Promise((resolve) => {
            // Out of the white into the world.
            state = 'off';
            into(false);
            run = { kind: 'reveal', t: 0, done: resolve };
          }),
      );
    },

    /**
     * From orbit, a dive at the planet that ends with the screen white and held (resolves then): the
     * caller takes it from there (puts the view where it wants it, under its own cover) and calls
     * leave() to let go of space.
     */
    dive() {
      if (state === 'off') return Promise.resolve();
      if (still()) {
        state = 'held';
        warp.set({ flash: 1 });
        return Promise.resolve();
      }
      state = 'in';
      return new Promise((resolve) => {
        run = { kind: 'in', t: 0, p0: camera.position.clone(), l0: look.clone(), l: new THREE.Vector3(), fov0: camera.fov, done: resolve };
      });
    },

    // Poses the camera. Call each frame after the rig has had its turn. Runs on real time, like the
    // cutscenes that wait on it, so a duration is the same seconds on any machine.
    update() {
      const now = performance.now();
      const dt = Math.min(0.1, (now - lastNow) / 1000);
      lastNow = now;
      // The planet's maps are painted in the first frames, a few tiles at a time.
      if (!planet.baked) planet.bake(4);
      else if (!cosmos.baked) cosmos.bake(3);
      else painted();
      // A slow machine may still be painting after the load: the planet shows once it's done.
      planet.group.visible = planet.baked;
      // The planet's clock starts as it comes into view, so it opens as the loading screen's still of it.
      const shown = state !== 'off';
      if (shown) time += dt;
      planet.update(shown ? dt : 0);
      cosmos.update(dt, camera);
      const r = run;
      if (r?.kind === 'reveal') {
        // The white clears off the world.
        r.t += dt;
        const x = r.t / 0.9;
        warp.set({ flash: 1 - easeOut(x), speed: 0 }, dt);
        fov = null;
        if (x >= 1) {
          run = null;
          warp.set({});
          r.done();
        }
        return;
      }
      if (state === 'off') return;
      if (state === 'there' || state === 'held') {
        orbit(time, pos, look);
        camera.position.copy(pos);
        camera.lookAt(look);
        camera.updateMatrixWorld();
        if (state === 'there') warp.set({}, dt);
        return;
      }
      r.t += dt;
      const t = r.t;
      if (r.kind === 'out') {
        // 0 to 0.7 s: the view tilts up to the sky. 0.7 to 1.3: it launches, the streaks and the
        // tunnel come up, a flash, and (behind it) space. 1.3 to 2.6: the tunnel. 2.6 to 3.0: out of
        // warp, into orbit. Then a slow settle, done at 4.2.
        const SWAP = 1.3, DROP = 2.6, END = 4.2;
        if (t < SWAP) {
          const tilt = easeInOut(clamp01(t / 0.8));
          const dir = tmp.copy(r.f0).lerp(r.f1, tilt).normalize();
          const go = Math.max(0, t - 0.6);
          camera.position.copy(r.p0).addScaledVector(dir, 12 * go * go + 260 * Math.pow(go, 4)).addScaledVector(r.f0, -1.5 * smooth(t, 0, 0.6));
          camera.lookAt(tmp2.copy(camera.position).add(dir));
          fov = r.fov0 - 4 * bump(t, 0, 0.55, 0.8) + 34 * smooth(t, 0.7, SWAP);
          warp.set({ speed: 30 + 420 * smooth(t, 0.55, SWAP), tunnel: smooth(t, 0.95, SWAP), flash: smooth(t, 1.12, SWAP) }, dt);
        } else {
          if (!r.swapped) {
            r.swapped = true;
            into(true);
            orbit(time, pos, look);
            // Far out along the way in, rushing at the orbit.
            r.from.copy(pos).sub(C).normalize().multiplyScalar(RADIUS * 4.5).add(pos);
          }
          orbit(time, pos, look);
          const e = t < DROP ? 0.75 * clamp01((t - SWAP) / (DROP - SWAP)) : 0.75 + 0.25 * easeOut((t - DROP) / (END - DROP));
          camera.position.lerpVectors(r.from, pos, e);
          camera.lookAt(look);
          const spring = t < DROP ? 0 : Math.exp(-(t - DROP) * 6) * Math.sin((t - DROP) * 16);
          fov = t < DROP ? r.fov0 + 30 : THREE.MathUtils.lerp(r.fov0 + 30, r.fov0, easeOut((t - DROP) / 0.45)) - spring * 6;
          warp.set({ speed: t < DROP ? 450 : 450 * (1 - easeOut((t - DROP) / 0.35)), tunnel: 1 - smooth(t, DROP, DROP + 0.25), flash: Math.max(1 - smooth(t, SWAP, SWAP + 0.35), 0.38 * bump(t, DROP - 0.04, DROP + 0.04, DROP + 0.4)), tint: '#8a4dff' }, dt);
          if (t >= END) {
            fov = null;
            state = 'there';
            run = null;
            warp.set({}, dt);
            r.done();
          }
        }
      } else if (r.kind === 'in') {
        // 0 to 0.7 s: a breath, the view easing back and turning onto the planet. 0.7 to 2.2: the
        // lunge, the streaks, the glow of entry. 2.2 to 2.6: white.
        const END = 2.6;
        // Down at a spot on the planet's sunlit face, between the view and the light: the camera never
        // goes through the ground, it comes to just above it as the white comes up.
        const n = tmp.copy(r.p0).sub(C).normalize().addScaledVector(planet.sun, 0.7).normalize();
        const spot = tmp2.copy(C).addScaledVector(n, RADIUS);
        const ease = easeInOut(clamp01(t / 0.9));
        const l = r.l.lerpVectors(r.l0, spot, ease);
        const go = Math.max(0, t - 0.6);
        const reach = Math.min(0.965, 0.05 * go + 0.92 * Math.pow(clamp01(go / 2.0), 2.4)) - 0.025 * bump(t, 0, 0.5, 0.9);
        camera.position.lerpVectors(r.p0, spot, reach);
        camera.lookAt(l);
        fov = r.fov0 - 3 * bump(t, 0, 0.5, 0.8) + 26 * smooth(t, 0.7, 2.2);
        warp.set({ speed: 20 + 380 * smooth(t, 0.7, 2.0), tunnel: 0.85 * smooth(t, 1.35, 2.2), flash: smooth(t, 2.15, END), tint: '#ff4fb0' }, dt);
        if (t >= END) {
          state = 'held';
          fov = r.fov0;
          run = null;
          warp.set({ flash: 1 }, dt);
          r.done();
        }
      }
      camera.updateMatrixWorld();
    },

    // The world's side of it: call each frame after the sky has set the day's light.
    apply() {
      group.visible = k > 0;
      sky.mesh.visible = k < 1;
      clouds?.setAway(k);
      // Out here the camera sees only what's in space.
      camera.layers.set(k > 0 ? SPACE : 0);
      if (k <= 0) return;
      sphere.position.copy(camera.position);
      sky.fog.near += 1e5;
      sky.fog.far += 1e5;
    },
  };
  return api;
}
