import * as THREE from 'three';

/*
 * The lobby's light (B24, the user's pick): shafts of sun through its windows, a pool of light where
 * each lands on the floor, and dust drifting through the room that lights up as it crosses a shaft.
 *
 * The sun comes in from the front left, through the two front windows and the left one; how high it
 * stands follows the time of day, so the shafts are long and gold early and late, short and pale at
 * noon, and a faint cool moonlight after dark. The shafts are the four sides of each window's light
 * swept to the floor, drawn additively with soft edges and slow drifting striations; the dust is a
 * cloud of points whose shader knows where the shafts are.
 *
 * Built into the lobby's room group after it's finished (src/hub.js), so the load draws it with the
 * room (B12). update(env) each frame the room shows.
 */

// The windows, in the room's space: the two on the front wall (z = +11) and the one on the left
// (x = -10); each as a corner and its two edges (along it, and up).
const WINDOWS = [
  { o: [-8.3, 2.2, 11], a: [3.6, 0, 0], b: [0, 4.2, 0] },
  { o: [4.7, 2.2, 11], a: [3.6, 0, 0], b: [0, 4.2, 0] },
  { o: [-10, 2.2, -4.5], a: [0, 0, 5], b: [0, 4.2, 0] },
].map((w) => ({ o: new THREE.Vector3(...w.o), a: new THREE.Vector3(...w.a), b: new THREE.Vector3(...w.b) }));
const FLOOR_Y = 0.02;

const SHAFT_VERT = /* glsl */ `
attribute vec2 aUv;    // across the face (0-1), along the light (0 window, 1 floor)
attribute vec3 aN;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
void main() {
  vUv = aUv;
  vP = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * aN);
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;
const SHAFT_FRAG = /* glsl */ `
uniform float uT, uI;
uniform vec3 uCol;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
float h1(float x) { return fract(sin(x * 91.7) * 43758.5453); }
float n1(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(h1(i), h1(i + 1.0), f); }
void main() {
  // Soft at the sides, brightest at the window, thinning out toward the floor.
  float side = smoothstep(0.0, 0.22, vUv.x) * smoothstep(1.0, 0.78, vUv.x);
  float along = (1.0 - smoothstep(0.0, 1.0, vUv.y) * 0.65) * smoothstep(0.0, 0.05, vUv.y) * smoothstep(1.0, 0.9, vUv.y);
  // Striations drifting across, as the air moves.
  float st = 0.65 + 0.35 * n1(vUv.x * 9.0 + uT * 0.25) * n1(vUv.x * 23.0 - uT * 0.4 + 3.0);
  // Seen edge on, a face looks through more of the shaft.
  float facing = abs(dot(normalize(vN), normalize(vV)));
  float depth = 0.35 + 0.65 * (1.0 - facing);
  float k = side * along * st * depth * uI;
  gl_FragColor = vec4(uCol * k * 0.16, 1.0);
}`;
const POOL_FRAG = /* glsl */ `
uniform float uI;
uniform vec3 uCol;
varying vec2 vUv;
void main() {
  // The window's light on the floor: soft edges, the frame's shadow a cross through it.
  vec2 e = smoothstep(0.0, 0.08, vUv) * smoothstep(1.0, 0.92, vUv);
  float bars = 1.0 - 0.55 * (1.0 - smoothstep(0.0, 0.02, abs(vUv.x - 0.5))) - 0.55 * (1.0 - smoothstep(0.0, 0.02, abs(vUv.y - 0.5)));
  gl_FragColor = vec4(uCol * e.x * e.y * bars * uI * 0.3, 1.0);
}`;
const POOL_VERT = /* glsl */ `attribute vec2 aUv; varying vec2 vUv; void main() { vUv = aUv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const DUST_VERT = /* glsl */ `
attribute vec4 aSeed;
uniform float uT, uScale;
uniform vec3 uL;   // the way the light travels
uniform vec3 uO[3], uA[3], uB[3];
varying float vLit;
varying float vTw;
// Whether p is in the light of window i: back along the light to the window's plane, inside its frame.
float inShaft(vec3 p, int i) {
  vec3 n = normalize(cross(uA[i], uB[i]));
  float d = dot(uL, n);
  if (abs(d) < 1e-3) return 0.0;
  float t = dot(uO[i] - p, n) / d;
  if (t > 0.0) return 0.0;
  vec3 q = p + uL * t - uO[i];
  float u = dot(q, uA[i]) / dot(uA[i], uA[i]), v = dot(q, uB[i]) / dot(uB[i], uB[i]);
  return smoothstep(0.0, 0.12, u) * smoothstep(1.0, 0.88, u) * smoothstep(0.0, 0.12, v) * smoothstep(1.0, 0.88, v);
}
void main() {
  // Drifting slowly in loops, each its own way, wrapped round the room.
  vec3 p = position + vec3(sin(uT * 0.11 + aSeed.x * 6.28) * 0.6, sin(uT * 0.07 + aSeed.y * 6.28) * 0.35 + uT * 0.02 * (aSeed.z - 0.4), cos(uT * 0.09 + aSeed.z * 6.28) * 0.6);
  p.y = 0.3 + mod(p.y - 0.3, 8.2);
  float lit = max(inShaft(p, 0), max(inShaft(p, 1), inShaft(p, 2)));
  vLit = lit;
  vTw = 0.6 + 0.4 * sin(uT * (1.5 + aSeed.w * 2.0) + aSeed.x * 20.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = clamp((0.022 + 0.02 * aSeed.w) * uScale / max(-mv.z, 0.1), 1.0, 7.0);
  gl_Position = projectionMatrix * mv;
}`;
const DUST_FRAG = /* glsl */ `
uniform float uI;
uniform vec3 uCol;
varying float vLit;
varying float vTw;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float a = exp(-dot(p, p) * 3.5);
  if (a < 0.02) discard;
  // Barely there in the room's own light; bright motes in the sun.
  float k = (0.05 + vLit * 1.1 * uI) * vTw * a;
  gl_FragColor = vec4(mix(vec3(1.0, 0.92, 0.82), uCol, vLit) * k, 1.0);
}`;

export function createLobbyFx(room, { quality = 'high' } = {}) {
  const group = new THREE.Group();
  group.name = 'lobby-light';
  const sun = { col: new THREE.Color(), i: 0 };
  const shaftU = { uT: { value: 0 }, uI: { value: 0 }, uCol: { value: sun.col } };
  const shaftMat = new THREE.ShaderMaterial({ uniforms: shaftU, vertexShader: SHAFT_VERT, fragmentShader: SHAFT_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  const shafts = new THREE.Mesh(new THREE.BufferGeometry(), shaftMat);
  shafts.frustumCulled = false;
  shafts.renderOrder = 3;
  const poolU = { uI: { value: 0 }, uCol: { value: sun.col } };
  const poolMat = new THREE.ShaderMaterial({ uniforms: poolU, vertexShader: POOL_VERT, fragmentShader: POOL_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2 });
  const pools = new THREE.Mesh(new THREE.BufferGeometry(), poolMat);
  pools.frustumCulled = false;
  pools.renderOrder = 2;

  // The dust: through the whole room.
  const N = quality === 'low' ? 260 : 700;
  const pos = new Float32Array(N * 3), seed = new Float32Array(N * 4);
  let s = 77;
  const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < N; i++) {
    pos.set([(rnd() - 0.5) * (room.w - 1), 0.3 + rnd() * 8.2, (rnd() - 0.5) * (room.d - 1)], i * 3);
    seed.set([rnd(), rnd(), rnd(), rnd()], i * 4);
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  dustGeo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  const dustU = {
    uT: { value: 0 }, uScale: { value: 500 }, uI: { value: 0 }, uCol: { value: sun.col },
    uL: { value: new THREE.Vector3(0.5, -0.6, -0.6).normalize() },
    uO: { value: WINDOWS.map((w) => w.o) }, uA: { value: WINDOWS.map((w) => w.a) }, uB: { value: WINDOWS.map((w) => w.b) },
  };
  const dust = new THREE.Points(dustGeo, new THREE.ShaderMaterial({ uniforms: dustU, vertexShader: DUST_VERT, fragmentShader: DUST_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  dust.frustumCulled = false;
  dust.renderOrder = 4;
  dust.onBeforeRender = (renderer, scene, camera) => {
    const rt = renderer.getRenderTarget();
    dustU.uScale.value = (rt ? rt.height : renderer.domElement.height) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  };
  group.add(pools, shafts, dust);
  room.group.add(group);

  // The shafts and pools for the light travelling along L: each window's four sides swept to the floor.
  const L = new THREE.Vector3();
  let builtFor = null;
  function build() {
    const P = [], UV = [], NRM = [], PP = [], PUV = [];
    const toFloor = (p) => p.clone().addScaledVector(L, (p.y - FLOOR_Y) / -L.y);
    const quad = (a, b, c, d, out, uv, nrm, n) => {
      // a-b along the window edge, c-d the same on the floor; two triangles.
      for (const [p, u] of [[a, [0, 0]], [b, [1, 0]], [c, [1, 1]], [a, [0, 0]], [c, [1, 1]], [d, [0, 1]]]) {
        out.push(p.x, p.y, p.z);
        uv.push(...u);
        if (nrm) nrm.push(n.x, n.y, n.z);
      }
    };
    for (const w of WINDOWS) {
      // Only the windows the sun shines in through (it travels into the room through them).
      const into = w.o.z > 10 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(1, 0, 0);
      if (L.dot(into) <= 0.05) continue;
      const c0 = w.o.clone(), c1 = w.o.clone().add(w.a), c2 = c1.clone().add(w.b), c3 = w.o.clone().add(w.b);
      const f = [c0, c1, c2, c3].map(toFloor);
      const edges = [[c0, c1, f[1], f[0]], [c3, c2, f[2], f[3]], [c0, c3, f[3], f[0]], [c1, c2, f[2], f[1]]];
      for (const [a, b, c, d] of edges) {
        const nn = new THREE.Vector3().crossVectors(b.clone().sub(a), L).normalize();
        quad(a, b, c, d, P, UV, NRM, nn);
      }
      // The pool: the window's light on the floor (its bottom edge lands nearest).
      for (const [p, u] of [[f[0], [0, 0]], [f[1], [1, 0]], [f[2], [1, 1]], [f[0], [0, 0]], [f[2], [1, 1]], [f[3], [0, 1]]]) {
        PP.push(p.x, p.y, p.z);
        PUV.push(...u);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('aUv', new THREE.Float32BufferAttribute(UV, 2));
    g.setAttribute('aN', new THREE.Float32BufferAttribute(NRM, 3));
    shafts.geometry.dispose();
    shafts.geometry = g;
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.Float32BufferAttribute(PP, 3));
    pg.setAttribute('aUv', new THREE.Float32BufferAttribute(PUV, 2));
    pools.geometry.dispose();
    pools.geometry = pg;
    builtFor = L.clone();
  }

  const GOLD = new THREE.Color('#ffd89a'), NOON = new THREE.Color('#fff4de'), DUSK = new THREE.Color('#ff9f7a'), MOON = new THREE.Color('#9fa8ff');
  let t = 0;
  function aim(env) {
    const e = env?.sunElev ?? 1;
    const night = env?.night ?? 0;
    // How high the light stands: low and gold early and late, high at noon; the moon at night.
    const up = night > 0.5 ? 0.62 : THREE.MathUtils.lerp(0.42, 0.95, THREE.MathUtils.smoothstep(e, 0.05, 0.9));
    L.set(0.56, 0, -0.64).normalize().multiplyScalar(Math.cos(up)).setY(-Math.sin(up));
    const low = 1 - THREE.MathUtils.smoothstep(e, 0.05, 0.5);
    sun.col.copy(NOON).lerp(GOLD, low * 0.8).lerp(DUSK, Math.max(0, low - 0.6) * 1.5).lerp(MOON, night);
    sun.i = THREE.MathUtils.lerp(1, 0.35, night) * (night > 0.5 ? 1 : THREE.MathUtils.smoothstep(e, -0.05, 0.12) + night);
    if (!builtFor || builtFor.distanceTo(L) > 0.01) build();
  }
  aim({ sunElev: 0.6, night: 0 });

  return {
    group,
    update(dt, env) {
      t += dt;
      aim(env);
      shaftU.uT.value = t;
      shaftU.uI.value = sun.i;
      poolU.uI.value = sun.i;
      dustU.uT.value = t;
      dustU.uI.value = sun.i;
      dustU.uL.value.copy(L);
    },
  };
}
