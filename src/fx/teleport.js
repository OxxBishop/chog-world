import * as THREE from 'three';
import { CHOG_HEIGHT } from '../chog.js';

/*
 * The portal trip (B24): the swirl gate, the user's pick (10-16). A vortex opens on the pad and pulls
 * your Chog in, spinning; at the other end it throws it out onto the pad. The two it was picked from
 * stay behind a switch for now: ?portal=star (a shooting star) and ?portal=bubble (a soap bubble).
 *
 * travel.js calls departs({ chog, pad, scene, camera }) with your Chog on pad.centre, hides it, cuts to
 * the other pad, shows it there (pad.facing) and calls arrives(...). Travel writes the Chog's position
 * every frame, so for the trip its root's matrix is held here instead (matrixAutoUpdate off), and handed
 * back where travel has it. The Chog is only ever moved, turned and scaled evenly: it never goes flat.
 *
 * Everything the trips draw is in one group, drawn once in the load (warm(), B12) and moved to the pad
 * each trip uses; all of it is built from a handful of small shaders.
 */

const KINDS = ['gate', 'star', 'bubble'];
const KIND = (() => {
  try {
    const k = new URLSearchParams(location.search).get('portal');
    return KINDS.includes(k) ? k : 'gate';
  } catch {
    return 'gate';
  }
})();
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
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const backOut = (x, s = 1.7) => 1 + (s + 1) * (x - 1) ** 3 + s * (x - 1) ** 2;
const bump = (x) => Math.sin(Math.PI * clamp01(x));
const UP = new THREE.Vector3(0, 1, 0);

// The palette: Chog World's violet, with pink and a little cyan to lift it.
const VIOLET = new THREE.Color(0.55, 0.3, 1.0);
const PINK = new THREE.Color(1.0, 0.42, 0.86);
const CYAN = new THREE.Color(0.45, 0.88, 1.0);
const LILAC = new THREE.Color(0.92, 0.84, 1.0);
const GOLD = new THREE.Color(1.0, 0.82, 0.48);

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
uniform float uT, uOpen, uSpin, uFlare, uPull;
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
  col *= 1.0 + uFlare * 1.6;
  float alpha = inside * (0.82 + 0.18 * bands) + rim * 0.4;
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
    uniforms: { uT: { value: 0 }, uOpen: { value: 0 }, uSpin: { value: 1.2 }, uFlare: { value: 0 }, uPull: { value: 0 } },
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

// ---------- the shooting star ----------
// Three ribbons of light wound round the Chog: one strip each, laid on a helix in the vertex shader;
// what shows is a bright head and a fading tail running along it.
const RIBBON_VERT = /* glsl */ `
attribute vec2 aS; // along 0-1, across -1/1
attribute vec4 aRib; // angle offset, delay, colour index, turn direction
uniform float uHeight, uR0, uR1, uTurns, uSpin, uWidth, uY0;
varying float vS; varying float vX; varying float vDelay; varying float vCol;
void main() {
  float s = aS.x;
  float ang = aRib.x + aRib.w * (s * uTurns * 6.2831853 + uSpin);
  float r = mix(uR0, uR1, s);
  vec3 p = vec3(cos(ang) * r, uY0 + s * uHeight, sin(ang) * r);
  p.y += aS.y * uWidth;
  vS = s; vX = aS.y; vDelay = aRib.y; vCol = aRib.z;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const RIBBON_FRAG = /* glsl */ `
uniform float uHead, uTail, uI;
uniform vec3 uC0, uC1, uC2;
varying float vS; varying float vX; varying float vDelay; varying float vCol;
void main() {
  float d = (uHead - vDelay) - vS;
  float on = step(0.0, d) * (1.0 - smoothstep(uTail * 0.6, uTail, d));
  float head = exp(-d * d * 900.0);
  float across = exp(-vX * vX * 3.2);
  vec3 c = vCol < 0.5 ? uC0 : vCol < 1.5 ? uC1 : uC2;
  float k = (on * (0.35 + 0.65 * (1.0 - d / max(uTail, 0.001))) + head * 2.5 * step(0.0, d + 0.02)) * across * uI;
  gl_FragColor = vec4(c * k * 2.6 + vec3(1.0) * head * across * uI * 0.6, 1.0);
}`;

function makeRibbons() {
  const SEG = 160;
  const aS = [];
  const index = [];
  for (let i = 0; i <= SEG; i++) aS.push(i / SEG, -1, i / SEG, 1);
  for (let i = 0; i < SEG; i++) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('aS', new THREE.Float32BufferAttribute(aS, 2));
  // aS doubles as position (three wants one; the vertex shader places them).
  geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array((SEG + 1) * 2 * 3), 3));
  geo.setIndex(index);
  geo.setAttribute('aRib', new THREE.InstancedBufferAttribute(new Float32Array([0, 0, 0, 1, 2.094, 0.06, 1, 1, 4.189, 0.12, 2, 1]), 4));
  geo.instanceCount = 3;
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uHeight: { value: 5 }, uR0: { value: 1.6 }, uR1: { value: 0.9 }, uTurns: { value: 1.6 }, uSpin: { value: 0 }, uWidth: { value: 0.15 }, uY0: { value: 0.1 },
      uHead: { value: 0 }, uTail: { value: 0.5 }, uI: { value: 0 },
      uC0: { value: PINK.clone() }, uC1: { value: CYAN.clone() }, uC2: { value: VIOLET.clone().lerp(LILAC, 0.3) },
    },
    vertexShader: RIBBON_VERT,
    fragmentShader: RIBBON_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 7;
  return { mesh, mat };
}

// The star itself: a hot core with four long spikes and a soft halo, facing the camera.
function makeStar() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uI: { value: 0 }, uT: { value: 0 }, uCol: { value: LILAC.clone() } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        // A billboard: its corners laid out in view space round its centre.
        vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vec2 scale = vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz));
        mv.xy += position.xy * scale;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uI, uT; uniform vec3 uCol; varying vec2 vUv;
      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float r = length(p);
        float core = exp(-r * r * 60.0) * 3.0;
        float halo = exp(-r * r * 7.0) * 0.55;
        float tw = 0.85 + 0.15 * sin(uT * 19.0);
        float sx = exp(-abs(p.y) * 40.0) * (1.0 - smoothstep(0.0, 1.0, abs(p.x)));
        float sy = exp(-abs(p.x) * 40.0) * (1.0 - smoothstep(0.0, 1.0, abs(p.y)));
        vec2 d = vec2(p.x + p.y, p.x - p.y) * 0.7071;
        float sd = (exp(-abs(d.y) * 60.0) * (1.0 - smoothstep(0.0, 0.6, abs(d.x))) + exp(-abs(d.x) * 60.0) * (1.0 - smoothstep(0.0, 0.6, abs(d.y)))) * 0.4;
        float a = (core + halo + (sx + sy) * 1.3 * tw + sd) * uI;
        gl_FragColor = vec4(mix(uCol, vec3(1.0), clamp(core, 0.0, 1.0)) * a, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  m.frustumCulled = false;
  m.renderOrder = 9;
  return { mesh: m, mat };
}

// ---------- the bubble ----------
const BUBBLE_VERT = /* glsl */ `
uniform float uT, uWobble;
uniform vec3 uSquash; // how much it's pressed down (y) and spread (xz)
varying vec3 vN; varying vec3 vV; varying vec3 vO;
void main() {
  vec3 n = normal;
  // Wobbling: a few slow waves over the skin.
  float w = sin(n.y * 3.0 + uT * 3.1) * 0.5 + sin(n.x * 4.0 - uT * 2.3) * 0.3 + sin(n.z * 5.0 + uT * 4.1) * 0.2;
  vec3 p = position * (1.0 + w * uWobble);
  p *= uSquash;
  vO = position;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vN = normalize(normalMatrix * (n / uSquash));
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;
const BUBBLE_FRAG = /* glsl */ `
uniform float uT, uI, uPop;
uniform vec3 uPopAt;
varying vec3 vN; varying vec3 vV; varying vec3 vO;
${NOISE}
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(vV);
  if (!gl_FrontFacing) n = -n;
  float ndv = abs(dot(n, v));
  float fres = pow(max(1.0 - ndv, 0.0), 2.2);
  // The film: its thickness swirls and slides down, so its colours do too.
  vec3 o = normalize(vO);
  float th = fbm3(o * 1.6 + vec3(0.0, uT * 0.35, uT * 0.12)) * 1.2 + o.y * 0.35 + fres * 0.5;
  vec3 film = 0.5 + 0.5 * cos(6.2831853 * (th * 1.7 + vec3(0.0, 0.33, 0.67)));
  film = mix(film, vec3(0.75, 0.6, 1.0), 0.25);
  // The sky caught on it as a small bright window near the rim, a fainter one opposite, and a glint;
  // kept small, so they never sit over the Chog inside like a cloud.
  vec3 r = reflect(-v, n);
  float rimK = smoothstep(0.25, 0.7, 1.0 - ndv);
  float win = (smoothstep(0.972, 0.99, dot(r, normalize(vec3(-0.55, 0.62, 0.56)))) * 0.85 + smoothstep(0.985, 0.995, dot(r, normalize(vec3(0.6, 0.35, 0.72)))) * 0.35) * rimK;
  float glint = pow(max(dot(r, normalize(vec3(-0.35, 0.8, 0.5))), 0.0), 600.0) * 2.5;
  vec3 col = film * (0.08 + 1.25 * fres) + vec3(1.0) * (win + glint);
  float alpha = 0.06 + 0.6 * fres + win * 0.4;
  // Popping: the film tears open from one point and the edge flashes as it goes.
  float d = acos(clamp(dot(o, normalize(uPopAt)), -1.0, 1.0)) / 3.14159;
  float torn = step(d, uPop * 1.1);
  float ex = (d - uPop * 1.1) * 28.0;
  float edge = exp(-ex * ex) * step(0.001, uPop);
  col += vec3(1.0, 0.9, 1.0) * edge * 2.5;
  if (torn > 0.5 && edge < 0.05) discard;
  gl_FragColor = vec4(col * uI, clamp(alpha + edge, 0.0, 1.0) * uI);
}`;

function makeBubble() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 }, uI: { value: 0 }, uWobble: { value: 0.02 }, uSquash: { value: new THREE.Vector3(1, 1, 1) }, uPop: { value: 0 }, uPopAt: { value: new THREE.Vector3(0.3, 1, 0.2) } },
    vertexShader: BUBBLE_VERT,
    fragmentShader: BUBBLE_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    ...PREMULT,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 40), mat);
  m.frustumCulled = false;
  m.renderOrder = 7;
  return { mesh: m, mat };
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
  const ribbons = makeRibbons();
  const star = makeStar();
  const bubble = makeBubble();
  group.add(ground, gate.group, ribbons.mesh, star.mesh, bubble.mesh, sparks.points);
  const parts = { ground, gate: gate.group, ribbons: ribbons.mesh, star: star.mesh, bubble: bubble.mesh };
  fx = { group, sparks, ground, gate, ribbons, star, bubble, parts, users: 0, t: 0, ticking: false };
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
    fx.star.mat.uniforms.uT.value = fx.t;
    fx.bubble.mat.uniforms.uT.value = fx.t;
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
function setup({ chog, pad, scene, camera }) {
  const at = pad.centre.clone();
  run(scene, at);
  const hold = holdChog(chog);
  const toward = at.clone().sub(camera.position).setY(0);
  if (toward.lengthSq() < 1e-6) toward.set(Math.sin(pad.facing), 0, Math.cos(pad.facing));
  toward.normalize();
  const side = new THREE.Vector3(toward.z, 0, -toward.x);
  return { at, hold, toward, side, H: hold.height, chog, pad };
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

async function gateDeparts(args) {
  const ctx = setup(args);
  const { pad } = ctx;
  const dir = ctx.toward;
  const G = gateAt(ctx, dir);
  const Gl = local(ctx, G);
  const yaw0 = ctx.hold.yaw;
  const into = Math.atan2(dir.x, dir.z);
  const yaw1 = turnTo(yaw0, into);
  fx.ground.visible = true;
  fx.ground.scale.setScalar(PAD_W);
  pad.beam = 0;
  let fed = 0;
  const feet = new THREE.Vector3();
  await timeline(2.35, (t, dt) => {
    const open = t < 1.9 ? backOut(seg(t, 0, 0.6), 1.4) : 1 - easeIn(seg(t, 1.9, 2.3));
    const flare = bump(seg(t, 1.72, 2.12));
    const pull = smooth(seg(t, 0.6, 1.8));
    showGate(dir, Gl, Math.max(0, open), flare, pull);
    fx.ground.material.uniforms.uGlow.value = 0.6 * Math.max(0, open) + flare * 0.8;
    pad.charge = 1 - seg(t, 1.8, 2.3);
    // Turned to face it, lifted, then pulled in spinning, smaller and smaller, into its eye.
    const turn = smooth(seg(t, 0.15, 0.7));
    const k = seg(t, 0.95, 1.85);
    const lift = smooth(seg(t, 0.7, 1.0)) * 0.35;
    const path = easeIn(k);
    const size = 1 - easeIn(seg(t, 1.05, 1.85));
    const spin = easeIn(k) * Math.PI * 2 * 2.5;
    // The Chog's middle travels from over the pad to the gate's eye.
    const mid = ctx.at.clone().add(new THREE.Vector3(0, ctx.H * 0.5 + lift, 0)).lerp(G, path);
    feet.copy(mid).addScaledVector(UP, -ctx.H * 0.5 * size);
    ctx.hold.set(feet, yaw0 + (yaw1 - yaw0) * turn + spin, size);
    // Light streaming into it all the while; a burst as it shuts.
    fed += dt * (t < 1.85 ? 90 + pull * 140 : 0);
    while (fed >= 1) {
      gateSparks(ctx, Gl, dir, 1, true);
      fed -= 1;
    }
    if (t >= 1.9 && t - dt < 1.9) gateSparks(ctx, Gl, dir, 60, false);
    if (t >= 2.3) fx.gate.group.visible = false;
  });
  fx.ground.visible = false;
  // Travel hides it now; give it back, its own size again.
  finish(ctx, yaw0);
  args.chog.root.visible = false;
}

async function gateArrives(args) {
  const ctx = setup(args);
  const { pad } = ctx;
  // Out ahead of where it will stand (the camera is behind it), facing back at the camera.
  const fwd = new THREE.Vector3(Math.sin(pad.facing), 0, Math.cos(pad.facing));
  const G = gateAt(ctx, fwd);
  const Gl = local(ctx, G);
  const back = fwd.clone().negate();
  const yaw = pad.facing;
  pad.beam = 0;
  ctx.hold.set(ctx.at, yaw, 1e-4);
  fx.ground.visible = true;
  fx.ground.scale.setScalar(PAD_W);
  const feet = new THREE.Vector3();
  let landed = null;
  const landedP = new Promise((r) => (landed = r));
  let burst = false;
  let fed = 0;
  timeline(2.2, (t, dt) => {
    const open = t < 1.45 ? backOut(seg(t, 0, 0.45), 1.4) : 1 - easeIn(seg(t, 1.45, 1.95));
    const flare = bump(seg(t, 0.4, 0.75)) * 0.8;
    showGate(back, Gl, Math.max(0, open), flare, 0.3);
    fx.ground.material.uniforms.uGlow.value = 0.6 * Math.max(0, open) + flare;
    pad.charge = 1 - seg(t, 1.2, 1.9);
    // Flung out of the eye, spinning down to a stop, growing to its size; a hop as it lands.
    const k = seg(t, 0.5, 1.25);
    const path = easeOut(k);
    const size = k <= 0 ? 1e-4 : Math.min(1, backOut(seg(t, 0.5, 1.15), 1.2));
    const spin = (1 - easeOut(k)) * Math.PI * 2 * -2;
    const hop = bump(seg(t, 1.25, 1.5)) * 0.18;
    const mid = G.clone().lerp(ctx.at.clone().add(new THREE.Vector3(0, ctx.H * 0.5, 0)), path);
    feet.copy(mid).addScaledVector(UP, -ctx.H * 0.5 * size);
    if (k >= 1) feet.copy(ctx.at).addScaledVector(UP, hop);
    if (k > 0) ctx.hold.set(feet, yaw + spin, size);
    if (k > 0 && !burst) {
      burst = true;
      gateSparks(ctx, Gl, back, 70, false);
    }
    fed += dt * (t > 0.1 && t < 0.6 ? 120 : 0);
    while (fed >= 1) {
      gateSparks(ctx, Gl, back, 1, true);
      fed -= 1;
    }
    if (t >= 1.5 && landed) {
      landed();
      landed = null;
    }
    if (t >= 2.2) {
      fx.gate.group.visible = false;
      fx.ground.visible = false;
    }
  }).then(() => done());
  await landedP;
  // The Chog is travel's again; the gate shuts on its own.
  fx.users++;
  finish(ctx, yaw);
}

// The shooting star.
function starTrail(p, n, spread = 0.25) {
  for (let i = 0; i < n; i++) {
    const col = [PINK, CYAN, LILAC, GOLD][(Math.random() * 4) | 0];
    fx.sparks.emit(
      p.clone().add(new THREE.Vector3((Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread)),
      new THREE.Vector3((Math.random() - 0.5) * 0.6, -0.2 - Math.random() * 0.6, (Math.random() - 0.5) * 0.6),
      0.7 + Math.random() * 0.8,
      { size: 0.05 + Math.random() * 0.09, col, grav: 0.6, drag: 1.2 },
    );
  }
}
function ribbons(on, head, { tail = 0.45, r0 = 1.7, r1 = 1.0, spin = 0, height = 5.2, y0 = 0.1 } = {}) {
  const u = fx.ribbons.mat.uniforms;
  fx.ribbons.mesh.visible = on > 0.002;
  u.uI.value = on;
  u.uHead.value = head;
  u.uTail.value = tail;
  u.uR0.value = r0;
  u.uR1.value = r1;
  u.uSpin.value = spin;
  u.uHeight.value = height;
  u.uY0.value = y0;
}
function showStar(p, size, i) {
  fx.star.mesh.visible = i > 0.002;
  fx.star.mesh.position.copy(p);
  fx.star.mesh.scale.setScalar(size);
  fx.star.mat.uniforms.uI.value = i;
}

async function starDeparts(args) {
  const ctx = setup(args);
  const { pad } = ctx;
  const yaw = ctx.hold.yaw;
  pad.beam = 0;
  fx.ground.visible = true;
  fx.ground.scale.setScalar(PAD_W);
  const headY = ctx.H * 1.02;
  const feet = new THREE.Vector3();
  const starP = new THREE.Vector3();
  let fed = 0;
  let prev = null;
  await timeline(2.25, (t, dt) => {
    // Ribbons wind up from the pad, then tighten round it as it turns to light.
    const wind = seg(t, 0, 1.1);
    const tight = smooth(seg(t, 0.8, 1.5));
    ribbons(Math.min(1, t * 4) * (1 - seg(t, 1.45, 1.75)), wind * 1.25 + tight * 0.4, { r0: 1.75 - tight * 0.9, r1: 1.05 - tight * 0.5, spin: t * 2.2 + tight * 3, height: ctx.H * 1.25, tail: 0.5 });
    fx.ground.material.uniforms.uGlow.value = 0.5 + bump(seg(t, 0.4, 1.7)) * 0.6;
    pad.charge = 1 - seg(t, 1.5, 2.0);
    // Up off the pad a little, and cut away from the feet up, its edge glowing.
    const lift = smooth(seg(t, 0.5, 1.4)) * 0.45;
    feet.copy(ctx.at).addScaledVector(UP, lift);
    ctx.hold.set(feet, yaw, 1);
    const cut = smooth(seg(t, 0.75, 1.5));
    args.chog.setBeam?.(cut * 1.1, 1);
    // A star gathers at its head, then shoots up and off.
    const gather = smooth(seg(t, 1.0, 1.5));
    const fly = easeIn(seg(t, 1.55, 2.2));
    starP.set(0, headY * (0.55 + 0.45 * gather) + lift + fly * 46, 0).addScaledVector(ctx.side, fly * 9);
    showStar(starP, 0.7 + gather * 1.6 - fly * 0.6, gather * (1 - seg(t, 2.05, 2.25)) * (1 + bump(seg(t, 1.4, 1.7)) * 0.8));
    // Its trail: sparkles left behind as it goes.
    if (gather > 0.05) {
      fed += dt * (fly > 0 ? 260 : 40);
      const from = prev ?? starP;
      while (fed >= 1) {
        starTrail(from.clone().lerp(starP, Math.random()), 1, fly > 0 ? 0.4 : 0.9);
        fed -= 1;
      }
    }
    prev = starP.clone();
  });
  ribbons(0, 0);
  showStar(starP, 1, 0);
  fx.ground.visible = false;
  finish(ctx, yaw);
  args.chog.setBeam?.(1.1, 1);
  args.chog.root.visible = false;
}

async function starArrives(args) {
  const ctx = setup(args);
  const { pad } = ctx;
  const yaw = pad.facing;
  pad.beam = 0;
  const headY = ctx.H * 1.02;
  const hover = 0.45;
  args.chog.setBeam?.(1.1, 1);
  ctx.hold.set(ctx.at.clone().addScaledVector(UP, hover), yaw, 1);
  fx.ground.visible = true;
  fx.ground.scale.setScalar(PAD_W);
  const starP = new THREE.Vector3();
  const sky = new THREE.Vector3(0, 46, 0).addScaledVector(ctx.side, -12);
  const hit = new THREE.Vector3(0, headY + hover, 0);
  const feet = new THREE.Vector3();
  let fed = 0;
  let prev = null;
  let hitDone = false;
  let landed = null;
  const landedP = new Promise((r) => (landed = r));
  timeline(2.2, (t, dt) => {
    // Down out of the sky, slowing as it comes in.
    const fall = easeOut(seg(t, 0, 0.55));
    starP.copy(sky).lerp(hit, fall);
    showStar(starP, 1.1 + bump(seg(t, 0.45, 0.8)) * 1.4, (1 - seg(t, 0.8, 1.15)) * (1 + bump(seg(t, 0.45, 0.75))));
    if (t < 0.6) {
      fed += dt * 220;
      const from = prev ?? starP;
      while (fed >= 1) {
        starTrail(from.clone().lerp(starP, Math.random()), 1, 0.4);
        fed -= 1;
      }
    }
    prev = starP.clone();
    // It lands: a ring of light across the pad, a burst, and the ribbons unwinding down round the Chog.
    if (t >= 0.55 && !hitDone) {
      hitDone = true;
      for (let i = 0; i < 60; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = 1.5 + Math.random() * 3;
        fx.sparks.emit(hit, new THREE.Vector3(Math.cos(a) * s, (Math.random() - 0.3) * 2.5, Math.sin(a) * s), 0.8 + Math.random() * 0.6, { size: 0.06 + Math.random() * 0.08, col: [PINK, CYAN, LILAC, GOLD][i % 4], grav: 2.5, drag: 1.6 });
      }
    }
    const ring = seg(t, 0.55, 1.4);
    fx.ground.material.uniforms.uRing.value = ring > 0 ? 1 - ring : 0;
    fx.ground.material.uniforms.uRingR.value = 0.12 + easeOut(ring) * 0.75;
    fx.ground.material.uniforms.uGlow.value = 0.4 + bump(seg(t, 0.5, 1.6)) * 0.6;
    const un = seg(t, 0.55, 1.55);
    ribbons((1 - seg(t, 1.5, 1.9)) * Math.min(1, un * 6), 1.25 - un * 1.25 + 0.45, { r0: 0.95 + un * 0.8, r1: 0.6 + un * 0.5, spin: -t * 2.6, height: ctx.H * 1.25, tail: 0.5 });
    pad.charge = 1 - seg(t, 1.3, 1.9);
    // Built back from the head down, still floating, then down onto the pad.
    const build = smooth(seg(t, 0.6, 1.35));
    args.chog.setBeam?.(1.1 - build * 1.15, 1);
    const settle = easeInOut(seg(t, 1.2, 1.6));
    feet.copy(ctx.at).addScaledVector(UP, hover * (1 - settle));
    ctx.hold.set(feet, yaw, 1);
    if (t >= 1.6 && landed) {
      landed();
      landed = null;
    }
    if (t >= 2.2) {
      ribbons(0, 0);
      showStar(starP, 1, 0);
      fx.ground.visible = false;
      fx.ground.material.uniforms.uRing.value = 0;
    }
  }).then(() => done());
  await landedP;
  fx.users++;
  finish(ctx, yaw);
}

// The bubble.
const BUBBLE_R = 2.45;
function showBubble(p, r, i, { wobble = 0.02, squash = 0, pop = 0, popAt = null } = {}) {
  const b = fx.bubble;
  b.mesh.visible = i > 0.002 && r > 0.01;
  b.mesh.position.copy(p);
  b.mesh.scale.setScalar(Math.max(0.001, r));
  b.mat.uniforms.uI.value = i;
  b.mat.uniforms.uWobble.value = wobble;
  b.mat.uniforms.uSquash.value.set(1 + squash * 0.5, 1 - squash, 1 + squash * 0.5);
  b.mat.uniforms.uPop.value = pop;
  if (popAt) b.mat.uniforms.uPopAt.value.copy(popAt);
}
function popBurst(centre, r) {
  for (let i = 0; i < 90; i++) {
    const d = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    const p = centre.clone().addScaledVector(d, r * (0.92 + Math.random() * 0.1));
    fx.sparks.emit(p, d.multiplyScalar(1.2 + Math.random() * 2.2), 0.5 + Math.random() * 0.6, { size: 0.04 + Math.random() * 0.06, col: [PINK, CYAN, LILAC, LILAC][i % 4], grav: 3.5, drag: 2.2 });
  }
}

async function bubbleDeparts(args) {
  const ctx = setup(args);
  const { pad } = ctx;
  const yaw = ctx.hold.yaw;
  pad.beam = 0;
  fx.ground.visible = true;
  fx.ground.scale.setScalar(PAD_W);
  fx.ground.material.uniforms.uCol.value.copy(VIOLET).lerp(CYAN, 0.35);
  const feet = new THREE.Vector3();
  const centre = new THREE.Vector3();
  const drift = ctx.side.clone().multiplyScalar(0.5);
  const popAt = new THREE.Vector3(-0.4, 0.8, 0.45).normalize();
  let popped = false;
  await timeline(2.5, (t) => {
    // It grows round the Chog from the pad.
    const grow = backOut(seg(t, 0, 0.7), 1.6);
    const rise = easeInOut(seg(t, 0.75, 2.05));
    const bob = Math.sin(seg(t, 0.75, 2.3) * Math.PI * 2) * 0.12;
    // Its bottom clear of the pad: growing, it lifts the Chog with it.
    centre.set(0, Math.max(ctx.H * 0.5, BUBBLE_R * grow + 0.03), 0).addScaledVector(UP, rise * 1.1 + bob * rise).addScaledVector(drift, rise);
    const pop = seg(t, 2.05, 2.2);
    showBubble(centre, BUBBLE_R * grow, pop < 1 ? 1 : 0, { wobble: 0.025 + bump(seg(t, 0.4, 1.1)) * 0.03, squash: -bump(seg(t, 0.55, 0.95)) * 0.05, pop, popAt });
    fx.ground.material.uniforms.uGlow.value = 0.55 * (1 - rise) * Math.min(1, t * 3);
    pad.charge = 1 - seg(t, 1.2, 2.0);
    // The Chog floats up inside it, turning a little; gone in a puff as it pops.
    const gone = seg(t, 2.05, 2.17);
    const size = 1 - smooth(gone);
    feet.copy(ctx.at).add(centre).addScaledVector(UP, -ctx.H * 0.5 * size);
    ctx.hold.set(feet, yaw + rise * 0.7, Math.max(size, 1e-4));
    if (t >= 2.05 && !popped) {
      popped = true;
      popBurst(centre, BUBBLE_R);
      for (let i = 0; i < 40; i++) {
        const d = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize();
        fx.sparks.emit(centre, d.multiplyScalar(0.8 + Math.random() * 1.6), 0.6 + Math.random() * 0.5, { size: 0.08 + Math.random() * 0.08, col: [GOLD, LILAC, PINK][i % 3], drag: 2.5 });
      }
    }
  });
  showBubble(centre, 0, 0);
  fx.ground.visible = false;
  fx.ground.material.uniforms.uCol.value.copy(VIOLET);
  finish(ctx, yaw);
  args.chog.root.visible = false;
}

async function bubbleArrives(args) {
  const ctx = setup(args);
  const { pad } = ctx;
  const yaw = pad.facing;
  pad.beam = 0;
  fx.ground.visible = true;
  fx.ground.scale.setScalar(PAD_W);
  fx.ground.material.uniforms.uCol.value.copy(VIOLET).lerp(CYAN, 0.35);
  const feet = new THREE.Vector3();
  const centre = new THREE.Vector3();
  const rest = BUBBLE_R * 0.97;
  const drift = ctx.side.clone().multiplyScalar(-1.2);
  const popAt = new THREE.Vector3(0.3, 0.9, -0.3).normalize();
  let popped = false;
  let landed = null;
  const landedP = new Promise((r) => (landed = r));
  // In the bubble as it comes down, its feet the same height above the bubble's bottom all the way.
  const inside = rest - ctx.H * 0.5 - 0.05;
  timeline(2.6, (t) => {
    const down = easeOut(seg(t, 0, 1.25));
    const sway = Math.sin(t * 2.6) * 0.18 * (1 - down);
    centre.set(0, rest, 0).addScaledVector(UP, (1 - down) * 5.5).addScaledVector(drift, 1 - down).addScaledVector(ctx.side, sway);
    // Down on the pad: it gives a little, wobbles, then pops.
    const squash = bump(seg(t, 1.15, 1.55)) * 0.08 - bump(seg(t, 1.5, 1.8)) * 0.03;
    centre.y -= squash * rest;
    const pop = seg(t, 1.85, 2.0);
    showBubble(centre, BUBBLE_R, pop < 1 ? Math.min(1, t * 4) : 0, { wobble: 0.025 + bump(seg(t, 1.15, 1.9)) * 0.035, squash, pop, popAt });
    fx.ground.material.uniforms.uGlow.value = 0.6 * down * (1 - seg(t, 1.9, 2.4));
    pad.charge = 1 - seg(t, 1.6, 2.3);
    // Free once it pops: a short drop onto the pad, and a soft landing.
    const drop = seg(t, 1.85, 2.15);
    if (drop <= 0) feet.set(centre.x, centre.y - (rest - inside), centre.z).add(ctx.at);
    else feet.copy(ctx.at).addScaledVector(UP, inside * (1 - drop * drop) + bump(seg(t, 2.15, 2.32)) * 0.06);
    ctx.hold.set(feet, yaw + (1 - down) * -0.6, 1);
    if (t >= 1.85 && !popped) {
      popped = true;
      popBurst(centre, BUBBLE_R);
    }
    if (t >= 2.32 && landed) {
      landed();
      landed = null;
    }
    if (t >= 2.6) {
      showBubble(centre, 0, 0);
      fx.ground.visible = false;
      fx.ground.material.uniforms.uCol.value.copy(VIOLET);
    }
  }).then(() => done());
  await landedP;
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

const TRIPS = { gate: [gateDeparts, gateArrives], star: [starDeparts, starArrives], bubble: [bubbleDeparts, bubbleArrives] };
const trip = KIND ? (REDUCED ? [calmDeparts, calmArrives] : TRIPS[KIND]) : null;

export const departs = trip?.[0];
export const arrives = trip?.[1];
export const warmTrips = KIND ? warm : undefined;
/** Which trip this is. */
export const kind = KIND;
