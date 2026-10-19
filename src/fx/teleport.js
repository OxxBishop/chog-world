import * as THREE from 'three';
import { CHOG_HEIGHT } from '../chog.js';

/*
 * The portal trip (B24): a wormhole, the user's pick (10-19, after the swirl gate's spin read as too
 * comical). A swirl opens standing on its edge just past the pad; your Chog turns to it and walks
 * straight in at its own walk, no spinning, no shrinking, and is gone as it passes through the swirl's
 * face, which ripples where it went in. At the other end the camera faces the pad, the swirl opens past
 * it, and your Chog walks out of it toward you onto the pad.
 *
 * travel.js calls departs({ chog, pad, scene, camera }) with your Chog on pad.centre, hides it, cuts to
 * the other pad, shows it there and calls arrives(...); arrivedYaw(pad) is which way it faces after.
 * Travel writes the Chog's position every frame, so for the trip its root's matrix is held here instead
 * (matrixAutoUpdate off), and handed back where travel has it. Its walk plays at the clip's own rate
 * (travel keeps that rate while it stands), so it moves at the speed its feet cover.
 *
 * Everything the trips draw is in one group, drawn once in the load (warm(), B12) and moved to the pad
 * each trip uses; all of it is built from a handful of small shaders.
 */

const REDUCED = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- time ----------
// One loop on the browser's frames for whatever is running (dt from the clock, held to 50 ms).
const jobs = new Set();
let looping = false;
let last = 0;
function loop() {
  const now = performance.now();
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  for (const j of [...jobs]) j(dt);
  if (jobs.size) requestAnimationFrame(loop);
  else looping = false;
}
// fn(dt) each frame for as long as it returns true.
function every(fn) {
  const job = (dt) => fn(dt) || jobs.delete(job);
  jobs.add(job);
  if (!looping) {
    looping = true;
    last = performance.now();
    requestAnimationFrame(loop);
  }
}
// fn(t, dt) each frame, t in seconds from 0 to `seconds`; resolves at the end.
function timeline(seconds, fn) {
  return new Promise((resolve) => {
    let t = 0;
    fn(0, 0);
    every((dt) => {
      t = Math.min(seconds, t + dt);
      fn(t, dt);
      if (t < seconds) return true;
      resolve();
      return false;
    });
  });
}

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const seg = (t, a, b) => clamp01((t - a) / (b - a));
const smooth = (x) => x * x * (3 - 2 * x);
const easeIn = (x) => x * x * x;
const easeOut = (x) => 1 - (1 - x) ** 3;
const backOut = (x, s = 1.7) => 1 + (s + 1) * (x - 1) ** 3 + s * (x - 1) ** 2;
const bump = (x) => Math.sin(Math.PI * clamp01(x));
const UP = new THREE.Vector3(0, 1, 0);

// The palette: Chog World's violet, with pink and a little cyan to lift it.
const VIOLET = new THREE.Color(0.55, 0.3, 1.0);
const PINK = new THREE.Color(1.0, 0.42, 0.86);
const CYAN = new THREE.Color(0.45, 0.88, 1.0);
const LILAC = new THREE.Color(0.92, 0.84, 1.0);

// ---------- the Chog, held ----------
function holdChog(chog) {
  const root = chog.root;
  const s0 = root.scale.x;
  const pos = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  root.matrixAutoUpdate = false;
  return {
    height: CHOG_HEIGHT * s0,
    scale: s0,
    yaw: root.rotation.y,
    // Feet at p, turned to yaw, k its size (1 its own).
    set(p, yaw, k = 1) {
      pos.copy(p);
      q.setFromAxisAngle(UP, yaw);
      s.setScalar(s0 * Math.max(k, 1e-4));
      root.matrix.compose(pos, q, s);
      root.matrixWorldNeedsUpdate = true;
    },
    // Back to travel: where it is, facing where it faces, its own size.
    release() {
      root.scale.setScalar(s0);
      root.matrixAutoUpdate = true;
      root.updateMatrix();
    },
  };
}

// ---------- shared pieces ----------
const NOISE = /* glsl */ `
float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise3(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm3(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * noise3(p); p *= 2.03; a *= 0.5; } return s; }
`;

// Light added on top (premultiplied: rgb is the light, alpha how much it hides what's behind).
const PREMULT = { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendEquation: THREE.AddEquation };

// Sparkles: little four-point stars, each its own colour and size, moved on the CPU (a few hundred).
const SPARKS = 320;
function makeSparks() {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(SPARKS * 3);
  const col = new Float32Array(SPARKS * 3);
  const size = new Float32Array(SPARKS);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('size', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setDrawRange(0, 1);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 600 } },
    vertexShader: /* glsl */ `
      attribute vec3 color; attribute float size; uniform float uScale; varying vec3 vC;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vC = color;
        gl_PointSize = clamp(size * uScale / max(-mv.z, 0.1), 1.5, 64.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vC;
      void main() {
        vec2 p = gl_PointCoord * 2.0 - 1.0;
        float r = length(p);
        float core = exp(-r * r * 18.0);
        float halo = exp(-r * r * 4.0) * 0.35;
        float spikes = (exp(-abs(p.x) * 14.0) + exp(-abs(p.y) * 14.0)) * (1.0 - smoothstep(0.2, 1.0, r)) * 0.6;
        float a = core + halo + spikes;
        if (a < 0.004) discard;
        gl_FragColor = vec4(vC * a, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 8;
  // Points are sized in the target's pixels: worked out as it's drawn.
  points.onBeforeRender = (renderer, scene, camera) => {
    const rt = renderer.getRenderTarget();
    const h = rt ? rt.height : renderer.domElement.height;
    mat.uniforms.uScale.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  };
  const list = [];
  const _c = new THREE.Color();
  return {
    points,
    /** p and v in the effects' space; life in seconds; o: { size, grav, drag, col, step(s, dt) }. */
    emit(p, v, life, o = {}) {
      if (list.length >= SPARKS) list.shift();
      list.push({ p: p.clone(), v: v.clone(), age: o.delay ? -o.delay : 0, life, size: o.size ?? 0.09, grav: o.grav ?? 0, drag: o.drag ?? 0.8, col: (o.col ?? LILAC).clone(), step: o.step ?? null, tw: Math.random() * 6.28, data: o.data ?? null });
    },
    get count() {
      return list.length;
    },
    clear() {
      list.length = 0;
    },
    update(dt) {
      for (let i = list.length - 1; i >= 0; i--) {
        const s = list[i];
        s.age += dt;
        if (s.age >= s.life) list.splice(i, 1);
      }
      let n = 0;
      for (const s of list) {
        if (s.age < 0) continue;
        if (s.step) s.step(s, dt);
        else {
          s.v.y -= s.grav * dt;
          s.v.multiplyScalar(Math.max(0, 1 - s.drag * dt));
          s.p.addScaledVector(s.v, dt);
        }
        const k = s.age / s.life;
        const a = Math.min(1, s.age / 0.06) * (1 - k * k) * (0.7 + 0.3 * Math.sin(s.age * 22 + s.tw));
        _c.copy(s.col).multiplyScalar(a * 1.8);
        pos[n * 3] = s.p.x;
        pos[n * 3 + 1] = s.p.y;
        pos[n * 3 + 2] = s.p.z;
        col[n * 3] = _c.r;
        col[n * 3 + 1] = _c.g;
        col[n * 3 + 2] = _c.b;
        size[n] = s.size * (0.6 + 0.4 * (1 - k));
        n++;
      }
      if (!n) col.fill(0, 0, 3);
      geo.setDrawRange(0, Math.max(1, n));
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
      geo.attributes.size.needsUpdate = true;
    },
  };
}

// A glow on the ground (or a ring of light spreading out over it): a flat disc, in the effects' space.
function makeGround() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uGlow: { value: 0 }, uRing: { value: 0 }, uRingR: { value: 0.3 }, uCol: { value: VIOLET.clone() }, uRingCol: { value: LILAC.clone() } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uGlow, uRing, uRingR; uniform vec3 uCol, uRingCol; varying vec2 vUv;
      void main() {
        float r = length(vUv * 2.0 - 1.0);
        float glow = exp(-r * r * 5.0) * uGlow;
        float rx = (r - uRingR) * 22.0;
        float ring = exp(-rx * rx) * uRing * (1.0 - smoothstep(0.85, 1.0, r));
        vec3 c = uCol * glow * 1.4 + uRingCol * ring * 2.4;
        gl_FragColor = vec4(c, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat);
  m.frustumCulled = false;
  m.renderOrder = 5;
  m.position.y = 0.03;
  return m;
}

// ---------- the swirl gate ----------
const VORTEX_FRAG = /* glsl */ `
uniform float uT, uOpen, uSpin, uFlare, uPull, uRipple;
varying vec2 vUv;
${NOISE}
void main() {
  vec2 p = (vUv * 2.0 - 1.0) * 1.15;
  float r = length(p);
  float rr = r / max(uOpen, 0.001);
  if (rr > 1.25) discard;
  float a = atan(p.y, p.x);
  float lr = log(max(rr, 0.015));
  // Arms that wind in to the middle (a log spiral), turning, broken up by noise.
  float th = a + 2.4 * lr + uT * uSpin;
  vec3 q = vec3(cos(th) * 1.6, sin(th) * 1.6, lr * 1.8 - uT * (0.9 + uPull));
  float arms = fbm3(q + vec3(0.0, 0.0, 3.1));
  float sw = 0.5 + 0.5 * sin(th * 3.0 + arms * 4.0);
  float bands = smoothstep(0.42, 0.95, arms * 0.7 + sw * 0.45);
  float inside = smoothstep(1.0, 0.9, rr);
  float rx = (rr - 0.95) * 13.0;
  float rim = exp(-rx * rx);
  // Wisps flung off past the rim.
  float wisp = smoothstep(1.25, 0.95, rr) * smoothstep(0.92, 1.02, rr) * smoothstep(0.55, 0.9, fbm3(vec3(cos(a + uT * 0.6) * 2.5, sin(a + uT * 0.6) * 2.5, uT * 0.4)));
  // Deep in the middle, a hole that glows white-hot at its heart.
  float depth = smoothstep(0.0, 0.75, rr);
  float eye = exp(-rr * rr * 26.0);
  vec3 deep = vec3(0.06, 0.02, 0.16);
  vec3 col = mix(deep, mix(vec3(0.5, 0.22, 1.0), vec3(1.0, 0.45, 0.9), sw), bands * (0.35 + 0.65 * depth)) * (0.5 + 1.6 * bands);
  col += vec3(0.75, 0.9, 1.0) * bands * smoothstep(0.55, 0.95, rr) * 0.6;
  col += vec3(0.95, 0.85, 1.0) * rim * 2.6;
  col += vec3(1.0, 0.92, 1.0) * eye * (0.8 + 3.0 * uFlare);
  col += vec3(0.85, 0.6, 1.0) * wisp * 0.8;
  // Where a Chog goes through: rings running out over the face from the middle.
  float rw = (rr - uRipple * 1.1) * 9.0;
  col += vec3(0.95, 0.88, 1.0) * exp(-rw * rw) * (1.0 - uRipple) * step(0.001, uRipple) * 1.8 * inside;
  col *= 1.0 + uFlare * 1.6;
  // All but opaque inside, so what has gone through is out of sight behind it.
  float alpha = inside * (0.95 + 0.05 * bands) + rim * 0.4;
  gl_FragColor = vec4(col * (inside + rim + wisp), clamp(alpha, 0.0, 1.0)) * smoothstep(0.0, 0.08, uOpen);
}`;

const RIM_FRAG = /* glsl */ `
uniform float uI; uniform float uT; varying vec2 vUv;
void main() {
  // Round the tube (v) the core is brightest; along it (u) a few beads of light run round.
  float across = pow(max(sin(vUv.y * 3.14159), 0.0), 6.0);
  float beads = 0.75 + 0.25 * sin(vUv.x * 6.2831853 * 9.0 - uT * 7.0);
  vec3 c = mix(vec3(0.8, 0.55, 1.0), vec3(1.0, 0.95, 1.0), across) * (0.6 + 1.8 * across) * beads;
  gl_FragColor = vec4(c * uI, 1.0);
}`;

function makeGate() {
  const g = new THREE.Group();
  const vortexMat = new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 }, uOpen: { value: 0 }, uSpin: { value: 1.2 }, uFlare: { value: 0 }, uPull: { value: 0 }, uRipple: { value: 0 } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: VORTEX_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    ...PREMULT,
  });
  const vortex = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), vortexMat);
  vortex.renderOrder = 6;
  const rimMat = new THREE.ShaderMaterial({
    uniforms: { uI: { value: 0 }, uT: { value: 0 } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: RIM_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.87, 0.022, 10, 128), rimMat);
  rim.renderOrder = 7;
  g.add(vortex, rim);
  for (const o of [vortex, rim]) o.frustumCulled = false;
  return { group: g, vortexMat, rimMat, rim };
}

// ---------- the effects, all in one group ----------
let fx = null;
function build() {
  if (fx) return fx;
  const group = new THREE.Group();
  group.name = 'teleport-fx';
  const sparks = makeSparks();
  const ground = makeGround();
  const gate = makeGate();
  group.add(ground, gate.group, sparks.points);
  const parts = { ground, gate: gate.group };
  fx = { group, sparks, ground, gate, parts, users: 0, t: 0, ticking: false };
  hideAll();
  return fx;
}
function hideAll() {
  for (const o of Object.values(fx.parts)) o.visible = false;
}
// While a trip's effects are up: the clock for their shaders and the sparkles, until all are done.
function run(scene, at) {
  build();
  if (!fx.group.parent) scene.add(fx.group);
  fx.group.position.copy(at);
  fx.group.visible = true;
  fx.users++;
  if (fx.ticking) return;
  fx.ticking = true;
  every((dt) => {
    fx.t += dt;
    fx.sparks.update(dt);
    fx.gate.vortexMat.uniforms.uT.value = fx.t;
    fx.gate.rimMat.uniforms.uT.value = fx.t;
    if (fx.users > 0 || fx.sparks.count) return true;
    hideAll();
    fx.group.visible = false;
    fx.ticking = false;
    return false;
  });
}
const done = () => (fx.users = Math.max(0, fx.users - 1));

/**
 * Everything the trips draw, for the load to draw once (B12; its draw shows the hidden parts too). The
 * group lives in the scene from then on, hidden between trips.
 */
function warm(scene) {
  build();
  if (!fx.group.parent) scene.add(fx.group);
  return fx.group;
}

// ---------- the trips ----------
// What a trip knows: the pad (its top's middle), the Chog held, and which ways are which from the camera.
// Each trip's number: a trip started while the last one's gate is still shutting takes the gate and the
// Chog over, and the old one's timeline leaves both alone from then on.
let tripId = 0;
function setup({ chog, pad, scene, camera }) {
  const id = ++tripId;
  const at = pad.centre.clone();
  run(scene, at);
  const hold = holdChog(chog);
  const toward = at.clone().sub(camera.position).setY(0);
  if (toward.lengthSq() < 1e-6) toward.set(Math.sin(pad.facing), 0, Math.cos(pad.facing));
  toward.normalize();
  const side = new THREE.Vector3(toward.z, 0, -toward.x);
  return { at, hold, toward, side, H: hold.height, chog, pad, live: () => id === tripId };
}
function finish(ctx, yaw) {
  ctx.hold.set(ctx.at, yaw, 1);
  ctx.hold.release();
  ctx.chog.root.position.copy(ctx.at);
  ctx.chog.root.rotation.y = yaw;
  ctx.chog.setBeam?.(0, 0);
  done();
}
const local = (ctx, v) => v.clone().sub(ctx.at);
const turnTo = (from, to) => from + ((((to - from) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI;

// The glow on the pad: as wide as its top (A's pad, 1.6 m across at life size, 1.7 x outdoors).
const PAD_W = 5.4;

// The swirl gate: it opens just beyond your Chog (as the camera sees it), pulls it in spinning, and shuts.
const GATE_R = 3.1;
function gateAt(ctx, dir) {
  // Its foot just over the pad's far edge, standing taller than the Chog, so its swirl frames it.
  return ctx.at.clone().addScaledVector(dir, 3.0).add(new THREE.Vector3(0, GATE_R * 0.87 + 0.12, 0));
}
function showGate(dir, centreLocal, open, flare, pull) {
  const g = fx.gate;
  g.group.visible = open > 0.002;
  g.group.position.copy(centreLocal);
  g.group.rotation.set(0, Math.atan2(dir.x, dir.z), 0);
  g.group.scale.setScalar(GATE_R);
  g.vortexMat.uniforms.uOpen.value = open;
  g.vortexMat.uniforms.uFlare.value = flare;
  g.vortexMat.uniforms.uPull.value = pull;
  g.vortexMat.uniforms.uSpin.value = 1.2 + pull * 3.5;
  g.rim.scale.setScalar(Math.max(0.001, open));
  g.rimMat.uniforms.uI.value = clamp01(open * 1.2) * (1 + flare * 1.5);
}
// Sparkles that spiral into (in > 0) or out of the gate's eye.
function gateSparks(ctx, centre, dir, n, inward = true) {
  const s = fx.sparks;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const r0 = GATE_R * (inward ? 1.0 + Math.random() * 0.9 : 0.15);
    const life = 0.9 + Math.random() * 0.6;
    const spin = 2.0 + Math.random() * 1.2;
    const right = new THREE.Vector3(dir.z, 0, -dir.x);
    const data = { a, r: r0, z: (Math.random() - 0.5) * 1.2 };
    const col = [PINK, CYAN, LILAC, VIOLET][i % 4];
    s.emit(centre, new THREE.Vector3(), life, {
      size: 0.06 + Math.random() * 0.08,
      col,
      delay: Math.random() * 0.25,
      step(sp, dt) {
        const k = sp.age / sp.life;
        data.a += dt * spin * (inward ? 1 + k * 3 : 2 - k);
        data.r = inward ? r0 * (1 - easeIn(k)) : r0 + GATE_R * 1.3 * easeOut(k);
        const z = data.z * (inward ? 1 - k : k);
        sp.p.copy(centre).addScaledVector(right, Math.cos(data.a) * data.r).addScaledVector(UP, Math.sin(data.a) * data.r).addScaledVector(dir, -z);
      },
    });
  }
}

// Its walk, in metres a second at its size: the clip at its own rate.
const walkSpeed = (ctx) => THREE.MathUtils.clamp((ctx.chog.speedOf?.('walk') || 1) * ctx.hold.scale, 1.6, 3.6);
// The gate's face is this far past the pad's middle.
const FACE = 3.0;

async function gateDeparts(args) {
  const ctx = setup(args);
  const { pad, chog } = ctx;
  // Past the pad as the camera sees it: your Chog walks away from the camera into it.
  const dir = ctx.toward;
  const G = gateAt(ctx, dir);
  const Gl = local(ctx, G);
  const yaw0 = ctx.hold.yaw;
  const yaw1 = turnTo(yaw0, Math.atan2(dir.x, dir.z));
  const v = walkSpeed(ctx);
  const walkFrom = 0.7;
  const through = FACE + 1.3;
  // Easing into its stride costs a quarter second over walking flat out.
  const walkEnd = walkFrom + through / v + 0.25;
  const T = walkEnd + 0.6;
  fx.ground.visible = true;
  fx.ground.scale.setScalar(PAD_W);
  pad.beam = 0;
  let fed = 0;
  let walking = false, gone = false, touched = -1;
  const feet = new THREE.Vector3();
  await timeline(T, (t, dt) => {
    if (!ctx.live()) return;
    const open = t < walkEnd + 0.05 ? backOut(seg(t, 0, 0.6), 1.3) : 1 - easeIn(seg(t, walkEnd + 0.05, walkEnd + 0.5));
    const flare = bump(seg(t, walkEnd - 0.2, walkEnd + 0.3)) * 0.7;
    showGate(dir, Gl, Math.max(0, open), flare, 0.25);
    fx.ground.material.uniforms.uGlow.value = 0.6 * Math.max(0, open) + flare * 0.6;
    pad.charge = 1 - seg(t, walkEnd, T);
    // Turned to it, then walking: easing into its stride over the first half second.
    const turn = smooth(seg(t, 0.1, 0.65));
    const w = Math.max(0, t - walkFrom);
    const d = Math.min(through, v * (w < 0.5 ? (w * w) / 1.0 : w - 0.25));
    if (t >= walkFrom && !walking) {
      walking = true;
      chog.play('walk');
    }
    feet.copy(ctx.at).addScaledVector(dir, d);
    if (!gone) ctx.hold.set(feet, yaw0 + (yaw1 - yaw0) * turn, 1);
    // Its nose meets the face: the ripple. All of it through: gone.
    if (touched < 0 && d > FACE - 0.6) touched = t;
    fx.gate.vortexMat.uniforms.uRipple.value = touched < 0 ? 0 : seg(t, touched, touched + 1.1);
    if (!gone && d >= through - 0.01) {
      gone = true;
      chog.root.visible = false;
    }
    // A little light drifting into it all the while; a puff as it shuts.
    fed += dt * (t < walkEnd ? 40 : 0);
    while (fed >= 1) {
      gateSparks(ctx, Gl, dir, 1, true);
      fed -= 1;
    }
    if (t >= walkEnd + 0.05 && t - dt < walkEnd + 0.05) gateSparks(ctx, Gl, dir, 40, false);
    if (t >= T - 0.05) fx.gate.group.visible = false;
  });
  fx.ground.visible = false;
  fx.gate.vortexMat.uniforms.uRipple.value = 0;
  chog.play('idle');
  // Travel hides it now and takes it to the other pad.
  finish(ctx, yaw1);
  chog.root.visible = false;
}

async function gateArrives(args) {
  const ctx = setup(args);
  const { pad, chog } = ctx;
  // Travel's camera is behind the pad looking out across the place (pad.facing): the gate opens past the
  // pad facing it, and your Chog walks out of it toward the camera.
  const fwd = new THREE.Vector3(Math.sin(pad.facing), 0, Math.cos(pad.facing));
  const G = gateAt(ctx, fwd);
  const Gl = local(ctx, G);
  const back = fwd.clone().negate();
  const yaw = arrivedYaw(pad);
  const v = walkSpeed(ctx);
  const from = FACE + 1.3;
  const walkFrom = 0.45;
  // At its walk, then easing to a stop over the last quarter (see d below).
  const walkEnd = walkFrom + (from * 1.1429) / v;
  const T = walkEnd + 0.7;
  pad.beam = 0;
  // Behind the gate, out of sight until it's open.
  chog.root.visible = false;
  ctx.hold.set(ctx.at.clone().addScaledVector(fwd, from), yaw, 1);
  fx.ground.visible = true;
  fx.ground.scale.setScalar(PAD_W);
  const feet = new THREE.Vector3();
  let landed = null;
  const landedP = new Promise((r) => (landed = r));
  let walking = false, stopped = false, out = -1;
  let fed = 0;
  timeline(T, (t, dt) => {
    if (!ctx.live()) return;
    const open = t < walkEnd + 0.1 ? backOut(seg(t, 0, 0.45), 1.3) : 1 - easeIn(seg(t, walkEnd + 0.1, walkEnd + 0.6));
    const flare = bump(seg(t, 0.35, 0.7)) * 0.7;
    showGate(back, Gl, Math.max(0, open), flare, 0.25);
    fx.ground.material.uniforms.uGlow.value = 0.6 * Math.max(0, open) + flare * 0.6;
    pad.charge = 1 - seg(t, walkEnd, T);
    if (t >= 0.3) chog.root.visible = true;
    // Walking out of it to the pad's middle, easing to a stop there.
    if (t >= walkFrom && !walking) {
      walking = true;
      chog.play('walk');
    }
    const k = seg(t, walkFrom, walkEnd);
    const p = k < 0.75 ? 1.1429 * k : 1 - 2.2857 * (1 - k) * (1 - k);
    const d = from * (1 - p);
    feet.copy(ctx.at).addScaledVector(fwd, Math.max(0, d));
    // Once it has stopped it's travel's again (handed back below): only the gate goes on.
    if (!stopped) ctx.hold.set(feet, yaw, 1);
    if (k >= 1 && !stopped) {
      stopped = true;
      chog.play('idle');
    }
    if (out < 0 && d < FACE + 0.6) out = t;
    fx.gate.vortexMat.uniforms.uRipple.value = out < 0 ? 0 : seg(t, out, out + 1.1);
    fed += dt * (t > 0.1 && t < walkEnd ? 30 : 0);
    while (fed >= 1) {
      gateSparks(ctx, Gl, back, 1, false);
      fed -= 1;
    }
    if (stopped && landed) {
      landed();
      landed = null;
    }
    if (t >= T - 0.05) {
      fx.gate.group.visible = false;
      fx.ground.visible = false;
      fx.gate.vortexMat.uniforms.uRipple.value = 0;
    }
  }).then(() => done());
  await landedP;
  // The Chog is travel's again; the gate shuts on its own.
  fx.users++;
  finish(ctx, yaw);
}

// Reduced motion: no flying about; the Chog fades out of the light and into it.
async function calmDeparts({ chog, pad }) {
  await timeline(0.7, (t) => {
    pad.beam = bump(t / 0.7) * 0.6;
    chog.setBeam?.(smooth(t / 0.7) * 1.1, 1);
  });
}
async function calmArrives({ chog, pad }) {
  chog.setBeam?.(1.1, 1);
  await timeline(0.7, (t) => {
    pad.beam = (1 - t / 0.7) * 0.6;
    chog.setBeam?.(1.1 - smooth(t / 0.7) * 1.15, 1);
  });
  chog.setBeam?.(0, 0);
}

const trip = REDUCED ? [calmDeparts, calmArrives] : [gateDeparts, gateArrives];

// Which way your Chog faces once it's there: toward the camera, which the wormhole has it walk out to
// (the calm trip leaves it as travel set it).
function arrivedYaw(pad) {
  return pad.facing + Math.PI;
}

export const departs = trip[0];
export const arrives = trip[1];
export const warmTrips = warm;
export const facingAfter = REDUCED ? null : arrivedYaw;
