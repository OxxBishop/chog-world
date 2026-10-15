import * as THREE from 'three';

/*
 * The space round the Chog World planet (B25), all in its violet:
 *
 *   sky            nebulae painted once into a cube map at load (in tiles, B12): a great violet band
 *                  across the sky in wisps and filaments, a rose nebula, a small teal one, dark dust
 *                  lanes through them, the glow of a thousand stars too far to see one by one
 *   stars          thousands of pinpricks, white, blue, pink and lilac, gathered along the band
 *   dwarf stars    a few near ones, bigger and brighter, with soft halos and four-point glints: a red
 *                  dwarf, a white one, an orange one, a violet one
 *   constellations a few star pictures (the Crown, the Die, the Lucky Coin, the Ladle) traced in faint
 *                  lavender lines that come and go
 *   debris         a belt of tumbling rocks and amethyst shards orbiting the planet, and lilac dust
 *                  in it; all of it moved in the vertex shader, nothing per frame on the CPU
 *
 * createCosmos({ renderer, quality, sun, radius, belt }) returns { sky, debris, bake(), baked,
 * update(dt) }: sky follows the camera (it's at infinity), debris sits round the planet.
 */

const SKY_R = 500;

// ---------- the nebula map ----------
const NEB_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

// One cube face: the direction for each pixel, then the nebulae there.
const NEB_FRAG = /* glsl */ `
uniform int uFace;
varying vec2 vUv;
float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p, int oct) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    s += a * noise(p);
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return s;
}
vec3 faceDir(int f, vec2 uv) {
  vec2 c = uv * 2.0 - 1.0;
  if (f == 0) return vec3(1.0, -c.y, -c.x);
  if (f == 1) return vec3(-1.0, -c.y, c.x);
  if (f == 2) return vec3(c.x, 1.0, c.y);
  if (f == 3) return vec3(c.x, -1.0, -c.y);
  if (f == 4) return vec3(c.x, -c.y, 1.0);
  return vec3(-c.x, -c.y, -1.0);
}
// A soft blob of nebula round direction c, size s.
float cloud(vec3 d, vec3 c, float s) {
  return exp(-pow(acos(clamp(dot(d, normalize(c)), -1.0, 1.0)) / s, 2.0));
}
void main() {
  vec3 d = normalize(faceDir(uFace, vUv));
  // The night: deep indigo, a touch lighter overhead.
  vec3 col = mix(vec3(0.006, 0.004, 0.02), vec3(0.022, 0.012, 0.055), smoothstep(-0.7, 0.9, d.y));
  // The band: the galaxy's plane, a wide violet sweep, wisps along it.
  float bandX = d.y * 0.85 + d.x * 0.4 - 0.15;
  float bx = bandX / 0.42;
  float band = exp(-bx * bx);
  vec3 w = vec3(fbm(d * 1.8 + 3.0, 4), fbm(d * 1.8 + 11.0, 4), fbm(d * 1.8 + 23.0, 4));
  float n = fbm(d * 2.2 + w * 1.4, 6);
  float wisps = smoothstep(0.48, 0.88, n) * band;
  // Filaments: thin bright threads through it.
  float fil = pow(max(1.0 - abs(fbm(d * 4.5 + w * 2.0, 5) * 2.0 - 1.0), 0.0), 7.0) * band;
  // The far stars' glow along the band, mottled.
  float milk = band * (0.4 + 0.6 * fbm(d * 9.0, 4));
  col += vec3(0.16, 0.08, 0.34) * milk * 0.12;
  col += vec3(0.42, 0.14, 0.72) * wisps * 0.17;
  col += vec3(0.85, 0.42, 1.0) * fil * 0.09;
  // The rose nebula, up and to the left of the planet: pink and magenta, a bright heart.
  float rose = cloud(d, vec3(-0.55, 0.45, -0.7), 0.38) * smoothstep(0.35, 0.8, fbm(d * 3.2 + w, 6));
  float roseCore = cloud(d, vec3(-0.55, 0.45, -0.7), 0.12) * fbm(d * 7.0 + 5.0, 4);
  col += vec3(0.95, 0.25, 0.62) * rose * 0.2 + vec3(1.0, 0.7, 0.9) * roseCore * 0.12;
  // A small teal wisp the other way, the one cool note.
  float teal = cloud(d, vec3(0.75, 0.35, -0.55), 0.26) * smoothstep(0.45, 0.85, fbm(d * 3.6 + w * 1.2 + 7.0, 6));
  col += vec3(0.12, 0.62, 0.72) * teal * 0.16;
  // A faint blue-violet veil low on the other side.
  float veil = cloud(d, vec3(0.2, -0.5, 0.8), 0.6) * smoothstep(0.4, 0.8, fbm(d * 2.0 + 40.0, 5));
  col += vec3(0.22, 0.2, 0.7) * veil * 0.1;
  // Dark dust lanes through the bright parts.
  float dust = smoothstep(0.46, 0.7, fbm(d * 3.0 + w * 2.5 + 90.0, 6));
  col *= 1.0 - dust * 0.85 * clamp(band + rose, 0.0, 1.0);
  gl_FragColor = vec4(col, 1.0);
}`;

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;
const SKY_FRAG = /* glsl */ `
uniform samplerCube uMap;
uniform float uReady;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  // Until the nebulae are painted, the plain night; then they fade in.
  vec3 night = mix(vec3(0.006, 0.004, 0.02), vec3(0.022, 0.012, 0.055), smoothstep(-0.7, 0.9, d.y));
  gl_FragColor = vec4(mix(night, textureCube(uMap, d).rgb, uReady), 1.0);
  #include <colorspace_fragment>
}`;

// ---------- stars ----------
const STAR_VERT = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
attribute float aPhase;
uniform float uTime;
uniform float uScale;
varying vec3 vColor;
varying float vAlpha;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  // On the far plane, behind everything.
  gl_Position.z = gl_Position.w;
  vAlpha = 0.7 + 0.3 * sin(uTime * (0.8 + aPhase) + aPhase * 40.0);
  vColor = aColor;
  gl_PointSize = aSize * uScale;
}`;
const STAR_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float a = 1.0 - smoothstep(0.0, 1.0, r);
  gl_FragColor = vec4(vColor, a * a * vAlpha);
  #include <colorspace_fragment>
}`;

// The bright ones (dwarf stars, the constellations' stars): a core, a halo and a four-point glint.
const BRIGHT_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = length(p);
  float core = exp(-r * r * 60.0);
  float halo = exp(-r * r * 7.0) * 0.35;
  float spikes = (exp(-abs(p.x) * 38.0) * exp(-abs(p.y) * 2.6) + exp(-abs(p.y) * 38.0) * exp(-abs(p.x) * 2.6)) * 0.55;
  float a = (core + halo + spikes) * vAlpha * smoothstep(1.0, 0.7, r);
  gl_FragColor = vec4(mix(vColor, vec3(1.0), core * 0.6) * a * 2.2, a);
  #include <colorspace_fragment>
}`;

const LINE_VERT = /* glsl */ `
attribute float aK;
uniform float uTime;
uniform float uHush;
varying float vA;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position.z = gl_Position.w;
  // Each picture breathes in and out on its own beat.
  vA = (0.55 + 0.45 * sin(uTime * 0.25 + aK * 2.3)) * (1.0 - 0.85 * uHush);
}`;
const LINE_FRAG = /* glsl */ `
varying float vA;
void main() {
  gl_FragColor = vec4(vec3(0.78, 0.66, 1.0) * 0.8 * vA, 0.8 * vA);
  #include <colorspace_fragment>
}`;

// ---------- the easter egg: the stars that smile ----------
// Ordinary stars, scattered, until now and then they drift together into a smiling Chog's face and
// trace it in faint lines, hold it a while, and wander apart again. uK runs 0 (scattered) to 1 (the
// face); each star sets off a little after the last.
const EGG_VERT = /* glsl */ `
attribute vec3 aScatter;
attribute vec3 aFace;
attribute float aDelay;
attribute float aSize;
attribute vec3 aColor;
uniform float uK;
uniform float uTime;
uniform float uScale;
varying vec3 vColor;
varying float vAlpha;
float kOf(float delay) { return smoothstep(0.0, 1.0, clamp(uK * 1.35 - delay * 0.35, 0.0, 1.0)); }
void main() {
  float k = kOf(aDelay);
  // Along the sky between the two, with a little sideways swing so they seem to swim into place.
  vec3 d = normalize(mix(aScatter, aFace, k) + cross(aScatter, aFace) * sin(k * 3.1416) * 0.6);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(d * ${(SKY_R * 0.975).toFixed(1)}, 1.0);
  gl_Position.z = gl_Position.w;
  vAlpha = (0.75 + 0.25 * sin(uTime * 1.7 + aDelay * 30.0)) * (0.8 + 0.4 * k);
  vColor = aColor;
  gl_PointSize = aSize * uScale * (1.0 + 0.25 * k);
}`;
const EGG_LINE_VERT = /* glsl */ `
attribute vec3 aFace;
uniform float uK;
varying float vA;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(normalize(aFace) * ${(SKY_R * 0.97).toFixed(1)}, 1.0);
  gl_Position.z = gl_Position.w;
  // Only once the face has come together.
  vA = smoothstep(0.82, 1.0, uK);
}`;

// The Chog, front on, as it really looks: the spiky fur all round its head (the mane), the round
// face set low in it, happy closed eyes with a lash at the corners, pink blush, a little nose, an
// open smile, and the gold mark on its forehead. In units of the face's height (x right, y up, the
// middle of the mane at 0).
const FACE = (() => {
  const P = (r, deg) => [r * Math.cos((deg * Math.PI) / 180), r * Math.sin((deg * Math.PI) / 180)];
  // The mane: nine spikes over the top and down the sides, each swept a little, longest on top.
  const mane = [P(0.62, -40)];
  const n = 9, from = -30, to = 210;
  for (let i = 0; i < n; i++) {
    const a = from + ((to - from) * i) / (n - 1);
    const top = Math.max(0, Math.sin((a * Math.PI) / 180));
    if (i) mane.push(P(0.8, a - (to - from) / (n - 1) / 2));
    mane.push(P(0.98 + 0.12 * top, a + 5));
  }
  mane.push(P(0.62, 220));
  // The face: a soft rounded square, flatter across the brow, set low in the mane.
  const cx = 0.02, cy = -0.24, fa = 0.5, fb = 0.46;
  const face = [];
  for (let k = 0; k < 16; k++) {
    const t = (k / 16) * Math.PI * 2;
    const c = Math.cos(t), sn = Math.sin(t);
    const e = 2 / 2.6;
    face.push([cx + fa * Math.sign(c) * Math.abs(c) ** e, cy + fb * Math.sign(sn) * Math.abs(sn) ** e * (sn > 0 ? 0.92 : 1)]);
  }
  const F = (x, y) => [cx + x, cy + y];
  return {
    outline: mane,
    face,
    eyes: [[F(-0.31, 0.05), F(-0.21, 0.14), F(-0.1, 0.07)], [F(0.1, 0.07), F(0.21, 0.14), F(0.31, 0.05)]],
    lashes: [F(-0.35, 0.1), F(0.35, 0.1)],
    smile: [F(-0.12, -0.11), F(-0.08, -0.2), F(0, -0.24), F(0.08, -0.2), F(0.12, -0.11)],
    nose: [F(0, -0.02)],
    cheeks: [F(-0.34, -0.1), F(0.34, -0.1)],
    mark: [F(0, 0.3)],
  };
})();
// How tall the face is on the sky, in degrees.
const FACE_DEG = 7.6;

// ---------- debris ----------
// Each rock: an orbit (radius, start angle, speed, height off the belt), a tumble (axis, rate) and
// a size; the belt's plane is uBeltN. The camera-facing tint and a hard rim make them read.
const ROCK_VERT = /* glsl */ `
attribute vec4 aOrbit;
attribute vec4 aSpin;
attribute vec3 aTint;
uniform float uTime;
uniform vec3 uBeltN;
uniform vec3 uBeltU;
varying vec3 vWorld;
varying vec3 vTint;
mat3 rot(vec3 a, float t) {
  float c = cos(t), s = sin(t), k = 1.0 - c;
  return mat3(c + a.x * a.x * k, a.y * a.x * k + a.z * s, a.z * a.x * k - a.y * s,
              a.x * a.y * k - a.z * s, c + a.y * a.y * k, a.z * a.y * k + a.x * s,
              a.x * a.z * k + a.y * s, a.y * a.z * k - a.x * s, c + a.z * a.z * k);
}
void main() {
  vec3 V = cross(uBeltN, uBeltU);
  float ang = aOrbit.y + uTime * aOrbit.z;
  vec3 centre = (uBeltU * cos(ang) + V * sin(ang)) * aOrbit.x + uBeltN * aOrbit.w;
  vec3 p = rot(normalize(aSpin.xyz), uTime * aSpin.w + aOrbit.y * 7.0) * position;
  vec4 w = modelMatrix * vec4(centre + p, 1.0);
  vWorld = w.xyz;
  vTint = aTint;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const ROCK_FRAG = /* glsl */ `
uniform vec3 uSun;
uniform float uGlow;
varying vec3 vWorld;
varying vec3 vTint;
void main() {
  // Faceted: the face's own normal, from the slopes of the position. A speck of a rock a pixel or two
  // across has no slope to go by: it faces the camera. (Normalising nothing is NaN on Apple's GPUs,
  // and one NaN pixel, spread by the bloom, blacks out the whole frame.)
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 c = cross(dFdx(vWorld), dFdy(vWorld));
  float c2 = dot(c, c);
  vec3 N = c2 > 1e-20 ? c * inversesqrt(c2) : V;
  if (dot(N, V) < 0.0) N = -N;
  vec3 L = normalize(uSun);
  float lit = max(dot(N, L), 0.0);
  float rim = pow(clamp(1.0 - dot(N, V), 0.0, 1.0), 3.0);
  vec3 col = vTint * (0.06 + 1.25 * lit) + vec3(0.55, 0.38, 1.0) * rim * 0.35 + vec3(0.03, 0.02, 0.08);
  // The shards glow from inside.
  col += vTint * uGlow * (0.5 + 0.5 * rim);
  vec3 H = normalize(L + V);
  col += vec3(1.0) * pow(max(dot(N, H), 0.0), 60.0) * 0.6 * step(0.0, dot(N, L)) * (0.3 + uGlow);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

const DUST_VERT = /* glsl */ `
attribute vec4 aOrbit;
uniform float uTime;
uniform vec3 uBeltN;
uniform vec3 uBeltU;
uniform float uScale;
varying float vA;
void main() {
  vec3 V = cross(uBeltN, uBeltU);
  float ang = aOrbit.y + uTime * aOrbit.z;
  vec3 p = (uBeltU * cos(ang) + V * sin(ang)) * aOrbit.x + uBeltN * aOrbit.w;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uScale * 2.4 / -mv.z, 1.0, 4.0);
  vA = 0.5 + 0.5 * sin(uTime * 2.0 + aOrbit.y * 50.0);
}`;
const DUST_FRAG = /* glsl */ `
varying float vA;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float a = (1.0 - smoothstep(0.2, 1.0, r)) * (0.35 + 0.65 * vA);
  gl_FragColor = vec4(vec3(0.85, 0.72, 1.0) * a * 0.9, a);
  #include <colorspace_fragment>
}`;

// A lumpy rock: an icosahedron pushed in and out, the same every time.
function rockGeometry(seed) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const pos = g.attributes.position;
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  const bumps = Array.from({ length: 5 }, () => [new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize(), 0.15 + rnd() * 0.3]);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    let k = 0.82;
    for (const [b, a] of bumps) k += a * Math.max(0, v.dot(b)) ** 3;
    v.multiplyScalar(k);
    v.y *= 0.78;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  // (Not indexed: every face is its own flat facet.)
  return g;
}

// The constellations: each a few stars (offsets in degrees across the sky round a centre direction)
// and the lines between them.
const PICTURES = [
  // The Crown, up over the planet.
  { at: [-0.05, 0.5, -0.86], stars: [[-6, 0], [-4, 3.5], [-2, 0.5], [0, 4.5], [2, 0.5], [4, 3.5], [6, 0]], lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 0]] },
  // The Die, up on the right.
  { at: [0.48, 0.3, -0.83], stars: [[-3, -3], [3, -3], [3, 3], [-3, 3], [0, 0], [-1.6, 1.6], [1.6, -1.6]], lines: [[0, 1], [1, 2], [2, 3], [3, 0]] },
  // The Lucky Coin, on the left.
  { at: [-0.8, 0.22, -0.56], stars: [[0, 4], [2.8, 2.8], [4, 0], [2.8, -2.8], [0, -4], [-2.8, -2.8], [-4, 0], [-2.8, 2.8], [0, 0]], lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 0]] },
  // The Ladle, high on the right.
  { at: [0.6, 0.62, -0.5], stars: [[-7, 2], [-4.5, 1.2], [-2, 1.5], [0, 0], [3, -1], [3.6, -4], [0.8, -4.6]], lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 3]] },
];
const DWARFS = [
  { at: [-0.45, 0.3, -0.84], colour: '#ff6f9a', size: 44 }, // red
  { at: [0.52, 0.24, -0.82], colour: '#cfe8ff', size: 52 }, // white
  { at: [-0.78, 0.14, -0.6], colour: '#ffb070', size: 34 }, // orange
  { at: [0.16, 0.64, -0.75], colour: '#d6a6ff', size: 30 }, // violet
  { at: [0.72, 0.46, -0.5], colour: '#9ff0ff', size: 26 },
];

// A direction offset by (x, y) degrees on the sky round centre c.
function skyAt(c, x, y, out = new THREE.Vector3()) {
  const n = new THREE.Vector3(...c).normalize();
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), n).normalize();
  if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
  const up = new THREE.Vector3().crossVectors(n, right);
  const r = THREE.MathUtils.degToRad;
  return out.copy(n).addScaledVector(right, -Math.tan(r(x))).addScaledVector(up, Math.tan(r(y))).normalize();
}

export function createCosmos({ renderer, quality = 'high', sun, radius, belt = { inner: 1.55, outer: 2.05, normal: null } }) {
  const low = quality === 'low';
  // ---- the nebula map, painted a face tile at a time ----
  const size = low ? 512 : 1024;
  const cube = new THREE.WebGLCubeRenderTarget(size, { type: THREE.UnsignedByteType, generateMipmaps: false, minFilter: THREE.LinearFilter });
  const nebMat = new THREE.ShaderMaterial({ uniforms: { uFace: { value: 0 } }, vertexShader: NEB_VERT, fragmentShader: NEB_FRAG, depthTest: false, depthWrite: false });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), nebMat);
  quad.frustumCulled = false;
  const bakeScene = new THREE.Scene();
  bakeScene.add(quad);
  const bakeCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const tiles = [];
  for (let f = 0; f < 6; f++) for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) tiles.push({ f, x, y });
  let next = 0;

  const sky = new THREE.Group();
  const skyMat = new THREE.ShaderMaterial({ uniforms: { uMap: { value: cube.texture }, uReady: { value: 0 } }, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false });
  const backdrop = new THREE.Mesh(new THREE.SphereGeometry(SKY_R, 48, 24), skyMat);
  backdrop.renderOrder = -1;

  // ---- the stars ----
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const N = low ? 3000 : 6500;
  const pos = [], sz = [], colr = [], ph = [];
  const tints = [[1, 1, 1], [0.8, 0.86, 1], [1, 0.8, 0.95], [0.86, 0.76, 1], [0.92, 0.82, 1], [1, 0.92, 0.82]];
  const v = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    v.set(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1);
    if (v.lengthSq() > 1 || v.lengthSq() < 1e-4) {
      i--;
      continue;
    }
    v.normalize();
    // Half of them gathered toward the band.
    if (i % 2 === 0) {
      const off = (v.y * 0.85 + v.x * 0.4 - 0.15) * 0.8;
      v.y -= off / 0.85;
      v.normalize();
    }
    pos.push(v.x * SKY_R, v.y * SKY_R, v.z * SKY_R);
    const b = rnd();
    const k = b > 0.985 ? 3.0 : b > 0.9 ? 1.7 : 0.8 + rnd() * 0.5;
    sz.push(b > 0.985 ? 4.2 : b > 0.9 ? 2.8 : 1.4 + rnd() * 1.1);
    const t = tints[Math.floor(rnd() * tints.length)];
    colr.push(t[0] * k, t[1] * k, t[2] * k);
    ph.push(rnd());
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  sg.setAttribute('aSize', new THREE.Float32BufferAttribute(sz, 1));
  sg.setAttribute('aColor', new THREE.Float32BufferAttribute(colr, 3));
  sg.setAttribute('aPhase', new THREE.Float32BufferAttribute(ph, 1));
  const starUniforms = { uTime: { value: 0 }, uScale: { value: 1 } };
  const stars = new THREE.Points(sg, new THREE.ShaderMaterial({ uniforms: starUniforms, vertexShader: STAR_VERT, fragmentShader: STAR_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  stars.renderOrder = -1;

  // ---- the dwarf stars and the constellations' stars ----
  const bp = [], bs = [], bc = [], bph = [];
  const addBright = (dir, colour, size) => {
    bp.push(dir.x * SKY_R * 0.98, dir.y * SKY_R * 0.98, dir.z * SKY_R * 0.98);
    bs.push(size);
    const c = new THREE.Color(colour);
    bc.push(c.r, c.g, c.b);
    bph.push(rnd());
  };
  for (const d of DWARFS) addBright(new THREE.Vector3(...d.at).normalize(), d.colour, d.size);
  const lp = [], lk = [];
  PICTURES.forEach((pic, k) => {
    const dirs = pic.stars.map(([x, y]) => skyAt(pic.at, x, y));
    dirs.forEach((d, i) => addBright(d, i % 3 ? '#e6dcff' : '#ffffff', 14 + (i % 2) * 5));
    for (const [a, b] of pic.lines) {
      // Each line stops short of its stars, so the stars stand clear.
      const A = dirs[a].clone().lerp(dirs[b], 0.12).normalize().multiplyScalar(SKY_R * 0.97);
      const B = dirs[a].clone().lerp(dirs[b], 0.88).normalize().multiplyScalar(SKY_R * 0.97);
      lp.push(A.x, A.y, A.z, B.x, B.y, B.z);
      lk.push(k, k);
    }
  });
  const bg = new THREE.BufferGeometry();
  bg.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3));
  bg.setAttribute('aSize', new THREE.Float32BufferAttribute(bs, 1));
  bg.setAttribute('aColor', new THREE.Float32BufferAttribute(bc, 3));
  bg.setAttribute('aPhase', new THREE.Float32BufferAttribute(bph, 1));
  const bright = new THREE.Points(bg, new THREE.ShaderMaterial({ uniforms: starUniforms, vertexShader: STAR_VERT, fragmentShader: BRIGHT_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  bright.renderOrder = -1;
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
  lg.setAttribute('aK', new THREE.Float32BufferAttribute(lk, 1));
  const hush = { value: 0 };
  const lines = new THREE.LineSegments(lg, new THREE.ShaderMaterial({ uniforms: { ...starUniforms, uHush: hush }, vertexShader: LINE_VERT, fragmentShader: LINE_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  lines.renderOrder = -1;
  // The smiling stars, scattered over the sky round where the face will come.
  const FACE_AT = [-0.46, 0.43, -0.78];
  const ep = [], es = [], ef = [], ed = [], ez = [], ec = [];
  const facePts = [];
  const addEgg = ([x, y], colour, size) => {
    const face = skyAt(FACE_AT, x * FACE_DEG, y * FACE_DEG);
    const scatter = skyAt(FACE_AT, (rnd() - 0.5) * 64, (rnd() - 0.5) * 40);
    ep.push(0, 0, 0);
    es.push(scatter.x, scatter.y, scatter.z);
    ef.push(face.x, face.y, face.z);
    ed.push(rnd());
    ez.push(size);
    const c = new THREE.Color(colour);
    ec.push(c.r, c.g, c.b);
    facePts.push(face);
    return face;
  };
  const outline = FACE.outline.map((p, i) => addEgg(p, i % 2 ? '#d9b8ff' : '#f2e8ff', i % 2 ? 10 : 8));
  const faceLine = FACE.face.map((p) => addEgg(p, '#fff4ea', 8));
  const eyes = FACE.eyes.map((arc) => arc.map((p) => addEgg(p, '#ffffff', 10)));
  FACE.lashes.forEach((p) => addEgg(p, '#ffffff', 7));
  const smile = FACE.smile.map((p) => addEgg(p, '#ffffff', 9));
  FACE.nose.forEach((p) => addEgg(p, '#ff6fb0', 12));
  FACE.cheeks.forEach((p) => addEgg(p, '#ff7ab8', 30));
  FACE.mark.forEach((p) => addEgg(p, '#ffd36a', 14));
  const eg = new THREE.BufferGeometry();
  eg.setAttribute('position', new THREE.Float32BufferAttribute(ep, 3));
  eg.setAttribute('aScatter', new THREE.Float32BufferAttribute(es, 3));
  eg.setAttribute('aFace', new THREE.Float32BufferAttribute(ef, 3));
  eg.setAttribute('aDelay', new THREE.Float32BufferAttribute(ed, 1));
  eg.setAttribute('aSize', new THREE.Float32BufferAttribute(ez, 1));
  eg.setAttribute('aColor', new THREE.Float32BufferAttribute(ec, 3));
  // The other pictures' lines step back while the face is up.
  const eggUniforms = { uK: hush, uTime: starUniforms.uTime, uScale: starUniforms.uScale };
  const eggStars = new THREE.Points(eg, new THREE.ShaderMaterial({ uniforms: eggUniforms, vertexShader: EGG_VERT, fragmentShader: BRIGHT_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  const segs = [];
  const chain = (pts, closed = false) => {
    for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) segs.push(pts[i], pts[(i + 1) % pts.length]);
  };
  chain(outline);
  chain(faceLine, true);
  eyes.forEach((arc) => chain(arc));
  // The eyes' lashes, from their outer corners.
  segs.push(eyes[0][0], FACE.lashes.length && skyAt(FACE_AT, FACE.lashes[0][0] * FACE_DEG, FACE.lashes[0][1] * FACE_DEG));
  segs.push(eyes[1][2], skyAt(FACE_AT, FACE.lashes[1][0] * FACE_DEG, FACE.lashes[1][1] * FACE_DEG));
  chain(smile, true);
  const sl = [];
  for (const p of segs) sl.push(p.x, p.y, p.z);
  const elg = new THREE.BufferGeometry();
  elg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(sl.length), 3));
  elg.setAttribute('aFace', new THREE.Float32BufferAttribute(sl, 3));
  const eggLines = new THREE.LineSegments(elg, new THREE.ShaderMaterial({ uniforms: eggUniforms, vertexShader: EGG_LINE_VERT, fragmentShader: LINE_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  for (const m of [eggStars, eggLines]) m.renderOrder = -1;
  // When it smiles: first a while after space opens, then every minute or two (?chogstars: soon).
  const soon = new URLSearchParams(location.search).has('chogstars');
  const egg = { state: 'idle', t: 0, wait: soon ? 3 : 25 + rnd() * 25 };
  // Where it comes together: turned to a clear part of the view as it starts. On a wide screen left
  // of the title, on a tall one across the top.
  const faceAt = new THREE.Vector3(...FACE_AT).normalize();
  const aim = (camera) => {
    if (!camera) return;
    const tall = camera.aspect < 1;
    const to = new THREE.Vector3(tall ? 0 : -0.7, tall ? 0.7 : 0.5, 0.5).unproject(camera).sub(camera.position).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(faceAt, to);
    eggStars.quaternion.copy(q);
    eggLines.quaternion.copy(q);
  };

  for (const m of [backdrop, stars, bright, lines, eggStars, eggLines]) m.frustumCulled = false;
  sky.add(backdrop, stars, bright, lines, eggStars, eggLines);

  // ---- the debris ----
  const debris = new THREE.Group();
  const beltN = (belt.normal ?? new THREE.Vector3(0, 1, 0).applyAxisAngle(new THREE.Vector3(1, 0, 0), 0.42).applyAxisAngle(new THREE.Vector3(0, 0, 1), 0.12)).clone().normalize();
  const beltU = new THREE.Vector3(1, 0, 0).projectOnPlane(beltN).normalize();
  const debrisUniforms = { uTime: { value: 0 }, uBeltN: { value: beltN }, uBeltU: { value: beltU }, uSun: { value: sun } };
  const field = (geo, n, { glow, tint }) => {
    const ig = new THREE.InstancedBufferGeometry();
    ig.setAttribute('position', geo.attributes.position);
    const orbit = new Float32Array(n * 4), spin = new Float32Array(n * 4), tints = new Float32Array(n * 3);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const r = radius * THREE.MathUtils.lerp(belt.inner, belt.outer, Math.pow(rnd(), 0.8));
      orbit.set([r, rnd() * Math.PI * 2, 0.012 * Math.pow(radius / r, 1.5) * (0.85 + rnd() * 0.3), (rnd() - 0.5) * radius * 0.08 * (1 + (r / radius - belt.inner))], i * 4);
      spin.set([rnd() - 0.5, rnd() - 0.5, rnd() - 0.5, 0.15 + rnd() * 0.6], i * 4);
      c.set(tint[Math.floor(rnd() * tint.length)]).multiplyScalar(0.75 + rnd() * 0.4);
      tints.set([c.r, c.g, c.b], i * 3);
    }
    ig.setAttribute('aOrbit', new THREE.InstancedBufferAttribute(orbit, 4));
    ig.setAttribute('aSpin', new THREE.InstancedBufferAttribute(spin, 4));
    ig.setAttribute('aTint', new THREE.InstancedBufferAttribute(tints, 3));
    ig.instanceCount = n;
    // Sizes: mostly small, a few big chunks, a field for each.
    const m = new THREE.Mesh(ig, new THREE.ShaderMaterial({ uniforms: { ...debrisUniforms, uGlow: { value: glow } }, vertexShader: ROCK_VERT, fragmentShader: ROCK_FRAG }));
    m.frustumCulled = false;
    return m;
  };
  const scaled = (geo, k) => geo.clone().scale(k, k, k);
  const rockTints = ['#7a6a8e', '#8d7a9a', '#6a5a80', '#9a8aa6', '#5e5070'];
  const shardTints = ['#a070ff', '#c58aff', '#ff7ad0', '#8a5cff'];
  const n = low ? 0.5 : 1;
  const rocks = [
    field(scaled(rockGeometry(3), radius * 0.006), Math.round(260 * n), { glow: 0, tint: rockTints }),
    field(scaled(rockGeometry(9), radius * 0.016), Math.round(60 * n), { glow: 0, tint: rockTints }),
    field(scaled(rockGeometry(17), radius * 0.034), Math.round(10 * n), { glow: 0, tint: rockTints }),
    field(new THREE.OctahedronGeometry(1, 0).scale(radius * 0.006, radius * 0.016, radius * 0.006), Math.round(70 * n), { glow: 0.35, tint: shardTints }),
  ];
  // The dust: lilac motes through the belt.
  const dn = low ? 1500 : 3500;
  const dorbit = new Float32Array(dn * 4);
  for (let i = 0; i < dn; i++) {
    const r = radius * THREE.MathUtils.lerp(belt.inner - 0.05, belt.outer + 0.1, rnd());
    dorbit.set([r, rnd() * Math.PI * 2, 0.012 * Math.pow(radius / r, 1.5), (rnd() - 0.5) * radius * 0.12], i * 4);
  }
  const dg = new THREE.BufferGeometry();
  dg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(dn * 3), 3));
  dg.setAttribute('aOrbit', new THREE.Float32BufferAttribute(dorbit, 4));
  const dustMat = new THREE.ShaderMaterial({ uniforms: { ...debrisUniforms, uScale: { value: 400 } }, vertexShader: DUST_VERT, fragmentShader: DUST_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const dust = new THREE.Points(dg, dustMat);
  dust.frustumCulled = false;
  dust.renderOrder = 4;
  debris.add(...rocks, dust);

  let t = 0;
  return {
    sky,
    debris,
    get baked() {
      return next >= tiles.length;
    },
    /** Paints the next n tiles of the nebula map. Returns true once it's done. */
    bake(count = 2) {
      if (next >= tiles.length) return true;
      const target0 = renderer.getRenderTarget(), face0 = renderer.getActiveCubeFace();
      const auto = renderer.autoClear;
      renderer.autoClear = false;
      for (let k = 0; k < count && next < tiles.length; k++, next++) {
        const { f, x, y } = tiles[next];
        nebMat.uniforms.uFace.value = f;
        cube.scissor.set((x * size) / 2, (y * size) / 2, size / 2, size / 2);
        cube.scissorTest = true;
        renderer.setRenderTarget(cube, f);
        renderer.render(bakeScene, bakeCam);
        cube.scissorTest = false;
      }
      renderer.setRenderTarget(target0, face0);
      renderer.autoClear = auto;
      if (next >= tiles.length) {
        nebMat.dispose();
        quad.geometry.dispose();
        return true;
      }
      return false;
    },
    /** The stars smile now (the easter egg), unless they already are. */
    smile(camera) {
      if (egg.state !== 'idle') return;
      Object.assign(egg, { state: 'in', t: 0 });
      aim(camera);
    },
    update(dt, camera) {
      t += dt;
      if (next >= tiles.length) skyMat.uniforms.uReady.value = Math.min(1, skyMat.uniforms.uReady.value + dt / 1.2);
      // The smiling stars: 4 s coming together, 6 s holding, 5 s drifting apart, then a long wait.
      egg.t += dt;
      if (egg.state === 'idle' && egg.t >= egg.wait) {
        Object.assign(egg, { state: 'in', t: 0 });
        aim(camera);
      }
      else if (egg.state === 'in' && egg.t >= 4.5) Object.assign(egg, { state: 'hold', t: 0 });
      else if (egg.state === 'hold' && egg.t >= 6) Object.assign(egg, { state: 'out', t: 0 });
      else if (egg.state === 'out' && egg.t >= 5.5) Object.assign(egg, { state: 'idle', t: 0, wait: 60 + rnd() * 60 });
      eggUniforms.uK.value = egg.state === 'in' ? THREE.MathUtils.smootherstep(egg.t / 4.5, 0, 1) : egg.state === 'hold' ? 1 : egg.state === 'out' ? 1 - THREE.MathUtils.smootherstep(egg.t / 5.5, 0, 1) : 0;
      starUniforms.uTime.value = t;
      starUniforms.uScale.value = renderer.getPixelRatio();
      debrisUniforms.uTime.value = t;
      dustMat.uniforms.uScale.value = renderer.domElement.height / 2 / Math.tan(THREE.MathUtils.degToRad((camera?.fov ?? 50) / 2));
    },
  };
}
