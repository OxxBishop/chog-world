import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { MeshoptDecoder } from 'meshoptimizer';
import { DOMES, DOME_R } from './layout.js';
import { islandAt, rimPoint, heightAt } from './terrain.js';
import { info } from './assets.js';

/*
 * The island's wildlife (B35, the user's pick, 10-19): alien flyers so the islands don't feel empty.
 *
 *   little monsters   a striped bee and a horned flyer flit about the flowers near you, darting off if
 *                     your Chog comes close (Quaternius' Ultimate Monsters, as made)
 *   puff birds        round sleepy birds, magenta and teal, with a one-eyed Glub among them, settle on the
 *                     treetops near you, hop from tree to tree and take off when you walk up
 *   sky mantas        flights of two or three glide high over the islands; now and then a big one swings
 *                     in low past the island's edge, close (Quaternius' Animated Fish, recoloured lilac
 *                     with lit wingtips)
 *   the sky whale     far out over the clouds, rarely, drifting past
 *
 * All CC0 (public/creatures/LICENSE.txt). The models load after the island is up, so they never slow the
 * start. Each creature is a skinned clone with its own mixer; the little ones and the puff birds keep near
 * where you are and move on with you. Hidden in rooms and in space. ?birds=now brings the swoop and the
 * whale round in seconds (for a look, or a shot).
 *
 * createBirds({ scene, island, quality, prewarm }) -> { update(dt, camera, env, { focus, me, outdoors }) }
 */

const BASE = import.meta.env.BASE_URL;
const NOW = typeof location !== 'undefined' && /[?&]birds=now\b/.test(location.search);
const COUNTS = { low: { flit: 2, perch: 3, flights: 1 }, medium: { flit: 4, perch: 5, flights: 2 }, high: { flit: 5, perch: 6, flights: 2 } };
const UP = new THREE.Vector3(0, 1, 0);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// The puff birds' two colours: their atlas turned round the colour wheel in the shader (a canvas filter
// would be simpler, but Safari doesn't do those).
function hueMaterial(src, deg, sat, bright, lift) {
  const m = src.clone();
  m.emissive = new THREE.Color(lift);
  const u = { uHue: { value: (deg * Math.PI) / 180 }, uSat: { value: sat }, uBright: { value: bright } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uHue, uSat, uBright;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
{
  // CSS's hue-rotate, then saturate and brighten.
  float c = cos(uHue), s = sin(uHue);
  mat3 hr = mat3(0.213 + c * 0.787 - s * 0.213, 0.213 - c * 0.213 + s * 0.143, 0.213 - c * 0.213 - s * 0.787,
                 0.715 - c * 0.715 - s * 0.715, 0.715 + c * 0.285 + s * 0.140, 0.715 - c * 0.715 + s * 0.715,
                 0.072 - c * 0.072 + s * 0.928, 0.072 - c * 0.072 - s * 0.283, 0.072 + c * 0.928 + s * 0.072);
  vec3 col = hr * diffuseColor.rgb;
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  diffuseColor.rgb = max(mix(vec3(l), col, uSat) * uBright, 0.0);
}`,
      );
  };
  m.customProgramCacheKey = () => 'creature-hue';
  return m;
}

// The mantas' and the whale's skin: lilac, lit cyan toward the wingtips (by how far out from the middle
// a point is in the model's own pose), brighter after dark.
function glowMaterial(color, span, axis, from) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.05, emissive: new THREE.Color('#5d3fcf'), emissiveIntensity: 0.12 });
  const u = { uSpan: { value: span }, uFrom: { value: from }, uGlow: { value: 1.4 } };
  m.userData.u = u;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vOut;').replace('#include <begin_vertex>', `#include <begin_vertex>\nvOut = abs(position.${axis});`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vOut;\nuniform float uSpan, uFrom, uGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(0.5, 0.9, 1.0) * smoothstep(uFrom, 1.0, vOut / uSpan) * uGlow;');
  };
  m.customProgramCacheKey = () => `creature-glow-${axis}`;
  return m;
}

export function createBirds({ scene, island, quality = 'high', prewarm = null }) {
  const counts = COUNTS[quality] ?? COUNTS.high;
  const group = new THREE.Group();
  group.name = 'birds';
  scene.add(group);
  const T = {};
  let ready = false;
  const glows = [];

  // ---------- where they go ----------
  // Flowers out in the open (not in the domes' gardens), and the treetops, binned 16 m to a cell.
  const CELL = 16;
  const key = (x, z) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
  const bin = (list) => {
    const m = new Map();
    list.forEach((p, i) => {
      const k = key(p.x, p.z);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(i);
    });
    return { list, m };
  };
  const inDome = (x, z) => DOMES.some((d) => Math.hypot(x - d.x, z - d.z) < DOME_R + 1.5);
  const flowers = (island.flowers ?? []).filter((p) => !inDome(p.x, p.z));
  const trees = [];
  for (const t of island.forest?.trees ?? []) {
    const box = info(t.name)?.box;
    if (!box) continue;
    const s = t.m.getMaxScaleOnAxis();
    trees.push({ x: t.x, z: t.z, y: t.m.elements[13], h: box.max.y * s, r: Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * s * 0.5 });
  }
  const F = bin(flowers), TR = bin(trees);
  const near = (B, p, r) => {
    const out = [];
    const n = Math.ceil(r / CELL);
    const cx = Math.floor(p.x / CELL), cz = Math.floor(p.z / CELL);
    for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) for (const k of B.m.get(`${cx + i},${cz + j}`) ?? []) {
      const q = B.list[k];
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d < r) out.push(q);
    }
    return out;
  };
  // A seat on a treetop: out on the crown, high on it.
  const seatOn = (t) => {
    const a = Math.random() * Math.PI * 2, k = rand(0.35, 0.6);
    return new THREE.Vector3(t.x + Math.cos(a) * t.r * k, t.y + t.h * rand(0.8, 0.92), t.z + Math.sin(a) * t.r * k);
  };

  // ---------- the creatures ----------
  const all = [];
  const make = (kind, { mat = null, size = 1, clip = 'Flying_Idle', fly = 'Fast_Flying' } = {}) => {
    const t = T[kind];
    const obj = cloneSkinned(t.scene);
    obj.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = false;
      o.receiveShadow = false;
      if (mat) o.material = mat;
    });
    const holder = new THREE.Group();
    holder.name = kind;
    holder.add(obj);
    holder.scale.setScalar(size);
    holder.visible = false;
    group.add(holder);
    const mixer = new THREE.AnimationMixer(obj);
    const act = (name) => {
      const c = t.clips.find((x) => x.name === name) ?? t.clips[0];
      const a = mixer.clipAction(c);
      a.play();
      a.time = Math.random() * c.duration;
      return a;
    };
    const idle = act(clip);
    const flyA = fly && t.clips.some((x) => x.name === fly) ? act(fly) : null;
    if (flyA) flyA.weight = 0;
    const c = { kind, obj: holder, mixer, idle, flyA, size, pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: Math.random() * 6, roll: 0, pitch: 0, t: Math.random() * 10, mode: 'off', flying: 0 };
    all.push(c);
    return c;
  };
  // Point a creature along a heading, banked and pitched.
  const pose = (c) => {
    c.obj.position.copy(c.pos);
    c.obj.rotation.set(c.pitch, c.yaw, c.roll, 'YXZ');
  };
  const blendFly = (c, k, dt) => {
    c.flying += (k - c.flying) * Math.min(1, dt * 6);
    if (c.flyA) {
      c.flyA.weight = c.flying;
      c.idle.weight = 1 - c.flying;
    }
  };

  // Little monsters at the flowers.
  const flit = [];
  // Puff birds (and a Glub) in the trees.
  const perch = [];
  // Mantas: flights overhead and the odd swoop; the whale.
  const flights = [];
  let swoop = null, whale = null;
  let swoopIn = NOW ? 3 : rand(30, 50), flightIn = NOW ? 1 : rand(6, 12), whaleIn = NOW ? 6 : rand(50, 80);

  async function load() {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const names = ['armabee', 'goleling', 'puff', 'glub', 'manta', 'whale'];
    const got = await Promise.all(names.map((n) => loader.loadAsync(`${BASE}creatures/${n}.glb`)));
    names.forEach((n, i) => (T[n] = { scene: got[i].scene, clips: got[i].animations }));
    // Materials: the monsters as made; the puff birds in two colours; the mantas and the whale lit.
    let puffSrc = null;
    T.puff.scene.traverse((o) => o.isMesh && (puffSrc = o.material));
    const magenta = hueMaterial(puffSrc, 38, 1.25, 1.25, '#3a1d66');
    const teal = hueMaterial(puffSrc, -62, 1.2, 1.3, '#0f4a44');
    const span = (kind) => {
      let s = 1;
      T[kind].scene.traverse((o) => {
        if (!o.isMesh) return;
        o.geometry.computeBoundingBox();
        const b = o.geometry.boundingBox;
        s = Math.max(Math.abs(b.max.x), Math.abs(b.min.x));
      });
      return s;
    };
    const mantaMat = glowMaterial('#b7a2ff', span('manta'), 'x', 0.62);
    const whaleMat = glowMaterial('#a99cf0', span('whale'), 'x', 0.8);
    glows.push(mantaMat, whaleMat);
    // (Sized to your Chog out walking, 3.7 m tall: about a third of its height.)
    for (let i = 0; i < counts.flit; i++) flit.push(make(i % 2 ? 'goleling' : 'armabee', { size: rand(1.15, 1.35) }));
    for (let i = 0; i < counts.perch; i++) {
      const kind = i % 3 === 2 ? 'glub' : 'puff';
      perch.push(make(kind, { mat: kind === 'puff' ? (i % 2 ? teal : magenta) : null, size: kind === 'glub' ? 1.5 : 1.35 }));
    }
    for (let i = 0; i < counts.flights * 3; i++) flights.push(make('manta', { mat: mantaMat, size: 5, clip: 'Swim', fly: null }));
    swoop = make('manta', { mat: mantaMat, size: 8.5, clip: 'Swim', fly: null });
    whale = make('whale', { mat: whaleMat, size: 26, clip: 'Swim', fly: null });
    for (const c of [...flights, swoop, whale]) {
      c.obj.traverse((o) => o.isMesh && (o.frustumCulled = false));
      c.idle.timeScale = c === whale ? 0.45 : 0.6;
    }
    // Their shaders built before any shows (hidden, they'd build on first sight: a stall).
    for (const c of all) c.obj.visible = true;
    group.visible = true;
    await prewarm?.(group);
    group.visible = false;
    for (const c of all) c.obj.visible = false;
    ready = true;
  }
  // After the island and everything it needs: a quiet moment first.
  setTimeout(() => load().catch((e) => console.warn('birds: could not load', e)), NOW ? 200 : 2500);

  // ---------- each kind's ways ----------
  const _v = new THREE.Vector3(), _w = new THREE.Vector3();
  // Turn toward a heading and bank into the turn.
  const steer = (c, dir, dt, bank = 0.5) => {
    if (dir.lengthSq() < 1e-6) return;
    const want = Math.atan2(dir.x, dir.z);
    const turn = wrap(want - c.yaw);
    c.yaw += turn * Math.min(1, dt * 5);
    c.roll += (THREE.MathUtils.clamp(-turn * bank * 3, -0.6, 0.6) - c.roll) * Math.min(1, dt * 4);
    const flat = Math.hypot(dir.x, dir.z);
    c.pitch += (THREE.MathUtils.clamp(-Math.atan2(dir.y, flat), -0.5, 0.5) * 0.6 - c.pitch) * Math.min(1, dt * 4);
  };

  // Somewhere for a flitter to hang about: one of the flowers nearest you, or with none near, a clear bit
  // of air a few metres off in front of the camera (open ground: no building, tree or rock there).
  const solids = island.solids ?? [], obstacles = island.obstacles ?? [];
  const clearAt = (x, z) => {
    const hit = islandAt(x, z);
    if (!hit || hit.k > 0.9 || inDome(x, z)) return false;
    if (solids.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + 2.5)) return false;
    return !obstacles.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + 1.4);
  };
  const _fwd = new THREE.Vector3();
  function homeNear(focus, camera, away = null) {
    const fl = near(F, focus, 13)
      .filter((p) => !away || p.distanceTo(away) > 3.5)
      .sort((a, b) => a.distanceTo(focus) - b.distanceTo(focus))
      .slice(0, 6);
    if (fl.length && Math.random() < 0.6) return { at: pick(fl).clone(), lift: rand(0.9, 1.6) };
    camera.getWorldDirection(_fwd).setY(0).normalize();
    const base = Math.atan2(_fwd.x, _fwd.z);
    for (let i = 0; i < 10; i++) {
      // Off to one side or the other: straight ahead your Chog itself is in the way.
      const a = base + (Math.random() < 0.5 ? -1 : 1) * rand(0.45, 1.05), r = rand(4.5, 8.5);
      const x = focus.x + Math.sin(a) * r, z = focus.z + Math.cos(a) * r;
      if ((!away || Math.hypot(x - away.x, z - away.z) > 3.5) && clearAt(x, z)) return { at: new THREE.Vector3(x, heightAt(x, z), z), lift: rand(1.8, 3.4) };
    }
    return fl.length ? { at: pick(fl).clone(), lift: rand(0.9, 1.6) } : null;
  }
  // A flitter: hovers by a flower, wandering a little, now and then darts to another; darts off from you.
  function flitStep(c, dt, focus, me, camera) {
    c.t += dt;
    if (c.mode === 'off' || c.home.distanceTo(focus) > 30) {
      const h = homeNear(focus, camera);
      if (!h) return hide(c);
      c.home = h.at;
      // In from a way off, not popping up by the flowers.
      const a = rand(0, Math.PI * 2), r = rand(16, 22);
      c.pos.copy(c.home).add(_v.set(Math.cos(a) * r, rand(7, 11), Math.sin(a) * r));
      c.mode = 'hover';
      c.next = rand(2, 5);
      c.lift = h.lift;
      c.obj.visible = true;
    }
    c.next -= dt;
    const scared = me && me.distanceTo(c.pos) < 3;
    if (c.next <= 0 || scared) {
      const h = homeNear(focus, camera, me);
      if (h) (c.home = h.at), (c.lift = h.lift);
      c.next = rand(2.5, 6);
    }
    // Where it hangs: over the flower, drifting in loops.
    _v.set(Math.sin(c.t * 1.3) * 0.5 + Math.sin(c.t * 2.9) * 0.15, c.lift + Math.sin(c.t * 2.1) * 0.2, Math.cos(c.t * 1.1) * 0.5).add(c.home);
    _w.subVectors(_v, c.pos);
    const far = _w.length();
    c.vel.lerp(_w.multiplyScalar(2.2), Math.min(1, dt * 3));
    c.pos.addScaledVector(c.vel, dt);
    steer(c, c.vel, dt, 0.3);
    blendFly(c, far > 1.2 ? 1 : 0, dt);
    pose(c);
  }

  // A perched bird: sits on a treetop, hops to another now and then, takes off from you.
  function perchStep(c, dt, focus, me) {
    c.t += dt;
    if (c.mode === 'off' || (c.mode === 'sit' && c.seat.distanceTo(focus) > 34)) {
      // One of the trees nearest you that no other bird has.
      const options = freeTrees(near(TR, focus, 26), c).sort((a, b) => Math.hypot(a.x - focus.x, a.z - focus.z) - Math.hypot(b.x - focus.x, b.z - focus.z)).slice(0, 8);
      if (!options.length) return hide(c);
      const to = seatOn(pick(options));
      // Coming from far (it was left behind, or it's new): flown in from 40 m or so off, high, rather than
      // all the way across the island (that took half a minute).
      if (c.mode === 'off' || c.pos.distanceTo(to) > 60) {
        const a = rand(0, Math.PI * 2), r = rand(36, 46);
        c.pos.copy(to).add(_v.set(Math.cos(a) * r, rand(12, 18), Math.sin(a) * r));
      }
      hop(c, to);
      c.obj.visible = true;
    }
    if (c.mode === 'sit') {
      c.next -= dt;
      const scared = me && Math.hypot(me.x - c.pos.x, me.z - c.pos.z) < 4.5 && Math.abs(me.y - c.pos.y) < 7;
      if (c.next <= 0 || scared) {
        const options = freeTrees(near(TR, c.seat, scared ? 34 : 24), c).filter((t) => Math.hypot(t.x - c.seat.x, t.z - c.seat.z) > (scared ? 12 : 5));
        if (options.length) hop(c, seatOn(pick(options)));
        else c.next = rand(4, 8);
      }
      // Sat, fluffing, looking about.
      c.pos.copy(c.seat);
      c.yaw += wrap(c.look + Math.sin(c.t * 0.7) * 0.5 - c.yaw) * Math.min(1, dt * 2);
      c.roll *= 0.9;
      c.pitch *= 0.9;
      c.idle.timeScale = 0.5;
      blendFly(c, 0, dt);
    } else {
      // Hopping over in an arc.
      c.f += dt / c.dur;
      const k = Math.min(1, c.f);
      const e = k * k * (3 - 2 * k);
      _v.lerpVectors(c.from, c.seat, e);
      _v.y += Math.sin(Math.PI * k) * c.arc;
      _w.subVectors(_v, c.pos);
      c.pos.copy(_v);
      if (dt > 0) steer(c, _w, dt, 0.4);
      c.idle.timeScale = 1;
      blendFly(c, k < 0.85 ? 1 : 0, dt);
      if (k >= 1) {
        c.mode = 'sit';
        c.next = rand(6, 16);
        c.look = Math.atan2(c.seat.x - c.tree.x, c.seat.z - c.tree.z) + rand(-0.6, 0.6);
      }
    }
    pose(c);
  }
  // Trees no other bird sits on or is on its way to.
  const freeTrees = (list, c) => list.filter((t) => !perch.some((o) => o !== c && o.mode !== 'off' && o.seat && Math.hypot(o.seat.x - t.x, o.seat.z - t.z) < Math.max(2, t.r)));
  function hop(c, to) {
    c.from = c.pos.clone();
    c.seat = to;
    c.tree = { x: to.x, z: to.z };
    // (The crown it sits on: the nearest tree to the seat.)
    const t = near(TR, to, 8).sort((a, b) => Math.hypot(a.x - to.x, a.z - to.z) - Math.hypot(b.x - to.x, b.z - to.z))[0];
    if (t) c.tree = t;
    const d = c.from.distanceTo(to);
    c.dur = THREE.MathUtils.clamp(d / 7, 1.2, 7);
    c.arc = 1.5 + d * 0.18;
    c.f = 0;
    c.mode = 'hop';
  }
  function hide(c) {
    c.mode = 'off';
    c.obj.visible = false;
  }

  // Something flying a curve: a quadratic from a through b (its middle) to c, over `dur` seconds.
  const curve = (a, b, c2) => ({ a, m: b.clone().multiplyScalar(2).sub(a.clone().add(c2).multiplyScalar(0.5)), c: c2 });
  const at = (q, k, out) => {
    const u = 1 - k;
    return out.set(0, 0, 0).addScaledVector(q.a, u * u).addScaledVector(q.m, 2 * u * k).addScaledVector(q.c, k * k);
  };
  function glide(c, dt) {
    c.f += dt / c.dur;
    if (c.f >= 1) return hide(c);
    at(c.q, c.f, c.pos);
    at(c.q, Math.min(1, c.f + 0.004), _w).sub(c.pos);
    if (c.mode === 'start') {
      c.yaw = Math.atan2(_w.x, _w.z);
      c.mode = 'glide';
    }
    steer(c, _w, dt, 0.6);
    // The swoop rolls toward you as it comes past, so you see its back, not a sliver.
    if (c.bank) c.roll = c.bank * Math.sin(Math.PI * c.f);
    pose(c);
  }
  // A flight of mantas across the islands, high, on a long gentle curve near you.
  function startFlight(focus) {
    const free = flights.filter((c) => c.mode === 'off');
    if (free.length < 2) return;
    const n = Math.min(free.length, 1 + Math.floor(Math.random() * 3));
    const dir = rand(0, Math.PI * 2);
    const d = new THREE.Vector3(Math.cos(dir), 0, Math.sin(dir));
    const side = new THREE.Vector3(-d.z, 0, d.x);
    const off = rand(-60, 60), alt = focus.y + rand(26, 40);
    const mid = focus.clone().addScaledVector(side, off).setY(alt);
    const a = mid.clone().addScaledVector(d, -190).addScaledVector(side, rand(-30, 30));
    const b = mid.clone().addScaledVector(d, 190).addScaledVector(side, rand(-30, 30));
    const speed = rand(6, 8);
    for (let i = 0; i < n; i++) {
      const c = free[i];
      const o = side.clone().multiplyScalar((i % 2 ? 1 : -1) * Math.ceil(i / 2) * 8).addScaledVector(d, -i * 7).add(new THREE.Vector3(0, rand(-2, 2), 0));
      c.q = curve(a.clone().add(o), mid.clone().add(o), b.clone().add(o));
      c.dur = 380 / speed;
      c.f = 0;
      c.mode = 'start';
      c.obj.visible = true;
      c.idle.timeScale = rand(0.5, 0.7);
    }
  }
  // The big one, low past the island's edge close by (or, well inland, low over the trees).
  function startSwoop(focus, camera) {
    const hit = islandAt(focus.x, focus.z);
    if (!hit) return false;
    const isl = hit.isl;
    const ang = Math.atan2(focus.z - isl.z, focus.x - isl.x);
    const rim = rimPoint(isl, ang, 1.0);
    const out = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
    const along = new THREE.Vector3(-out.z, 0, out.x);
    // Across the camera's view, so it's seen: the way it goes along the edge is the way the camera's right is.
    camera.getWorldDirection(_v);
    if (_v.setY(0).normalize().dot(out) < -0.3) return false;
    const sign = new THREE.Vector3().crossVectors(_v, UP).dot(along) > 0 ? 1 : -1;
    let a, m, b;
    if (rim.distanceTo(focus) < 80) {
      m = rim.clone().addScaledVector(out, 7).add(new THREE.Vector3(0, rand(1, 4), 0));
      a = m.clone().addScaledVector(along, -110 * sign).addScaledVector(out, 18).add(new THREE.Vector3(0, -8, 0));
      b = m.clone().addScaledVector(along, 110 * sign).addScaledVector(out, 22).add(new THREE.Vector3(0, 6, 0));
    } else {
      m = focus.clone().add(new THREE.Vector3(0, 21, 0)).addScaledVector(_v, 14);
      const r = new THREE.Vector3().crossVectors(_v, UP).normalize();
      a = m.clone().addScaledVector(r, -120).add(new THREE.Vector3(0, 8, 0));
      b = m.clone().addScaledVector(r, 120).add(new THREE.Vector3(0, 10, 0));
    }
    swoop.q = curve(a, m, b);
    // It rolls its back toward you as it comes past (the wing on your side down; roll right is positive).
    const f = b.clone().sub(a).setY(0).normalize();
    const right = new THREE.Vector3(-f.z, 0, f.x);
    swoop.bank = (right.dot(_v.subVectors(focus, m).setY(0)) > 0 ? 1 : -1) * 0.5;
    swoop.dur = 230 / 11;
    swoop.f = 0;
    swoop.mode = 'start';
    swoop.obj.visible = true;
    return true;
  }
  // The whale: far out over the clouds, drifting along a wide arc round you.
  function startWhale(focus) {
    const r = rand(210, 280), a0 = rand(0, Math.PI * 2), sweep = rand(0.7, 1.0) * (Math.random() < 0.5 ? 1 : -1);
    const P = (a) => focus.clone().add(new THREE.Vector3(Math.cos(a) * r, rand(-24, 4), Math.sin(a) * r));
    whale.q = curve(P(a0), P(a0 + sweep / 2), P(a0 + sweep));
    whale.dur = (r * Math.abs(sweep)) / 5;
    whale.f = 0;
    whale.mode = 'start';
    whale.obj.visible = true;
  }

  const _cam = new THREE.Vector3();
  return {
    group,
    get ready() {
      return ready;
    },
    /** Each frame. focus: where the action is (your Chog out walking, else what the camera looks at); me:
     * your Chog's position (or null); outdoors: false in a room or in space (they all hide). */
    update(dt, camera, env, { focus, me = null, outdoors = true } = {}) {
      group.visible = ready && outdoors;
      if (!group.visible || !focus) return;
      const night = env?.night ?? 0;
      for (const m of glows) m.userData.u.uGlow.value = 1.4 + night * 1.6;
      for (const c of flit) flitStep(c, dt, focus, me, camera);
      for (const c of perch) perchStep(c, dt, focus, me);
      if ((flightIn -= dt) <= 0) {
        startFlight(focus);
        flightIn = rand(18, 34);
      }
      for (const c of flights) if (c.mode !== 'off') glide(c, dt);
      if ((swoopIn -= dt) <= 0) swoopIn = startSwoop(focus, camera) ? (NOW ? 25 : rand(55, 95)) : 6;
      if (swoop.mode !== 'off') glide(swoop, dt);
      if ((whaleIn -= dt) <= 0 && whale.mode === 'off') {
        startWhale(focus);
        whaleIn = NOW ? 40 : rand(120, 200);
      }
      if (whale.mode !== 'off') glide(whale, dt);
      // Their wings: the near ones every frame, the far ones every other.
      camera.getWorldPosition(_cam);
      for (const c of all) {
        if (!c.obj.visible) continue;
        const d = _cam.distanceTo(c.pos);
        c.skip = d > 90 && !c.skip;
        if (!c.skip) c.mixer.update(d > 90 ? dt * 2 : dt);
      }
    },
  };
}
