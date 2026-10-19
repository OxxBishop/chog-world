import * as THREE from 'three';

/*
 * The singer's stage (B24, the user's picks): an LED dance floor inside the stage's rim, and confetti
 * when the song ends. src/npcs.js builds it with the set and calls update(dt, { singing, songTime,
 * part, env, renderer }) each frame; the group sits in the plaza's square, the singer at its origin
 * facing `facing`, the stage's top at y 0.258, radius about 1.85 (life size: the square is 1.7 x).
 *
 * The floor keeps time with the song: eight bars in 19.2 s, so a beat is 0.6 s. Its tiles run a new
 * pattern every two bars (ripples out from the singer, a turning sweep, a checkerboard that swaps on the
 * beat, sparkles), strobe through the cheer, and breathe slowly while the singer rests. It's a glossy
 * dark glass floor with the light in it, so the singer's shadow still falls on it.
 *
 * The confetti: two cannons at the front of the stage and a shower from above, at the cheer. Each
 * piece's whole flight is worked out in its vertex shader from the time since the burst: up and out,
 * fluttering down, and flat on the stage or the paving where it lands, never through it.
 */

const BEAT = 0.6;
const STAGE_TOP = 0.258;
const FLOOR_R = 1.76;
const STAGE_R = 1.85;
const TILE = 0.2;

const LED = /* glsl */ `
uniform float uT, uSong, uPat, uMix, uCheer, uIdle, uK;
varying vec2 vLed;
float hash2(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
// Chog World's colours round a wheel: violet, pink, gold, cyan.
vec3 chogHue(float h) {
  h = fract(h) * 4.0;
  vec3 a = vec3(0.55, 0.3, 1.0), b = vec3(1.0, 0.35, 0.8), c = vec3(1.0, 0.75, 0.3), d = vec3(0.3, 0.85, 1.0);
  return h < 1.0 ? mix(a, b, h) : h < 2.0 ? mix(b, c, h - 1.0) : h < 3.0 ? mix(c, d, h - 2.0) : mix(d, a, h - 3.0);
}
vec3 pattern(float k, vec2 cell, vec2 c, float beat, float ph) {
  float r = length(c);
  float a = atan(c.y, c.x);
  float hit = exp(-ph * 5.0);
  if (k < 0.5) {
    // Ripples out from the singer, one a beat.
    float w0 = (r - ph * 2.4) * 3.2, w1 = (r - (ph + 1.0) * 2.4) * 3.2;
    float wave = exp(-w0 * w0) + exp(-w1 * w1) * 0.4;
    return chogHue(r * 0.35 - uSong * 0.1) * (0.12 + 1.1 * wave);
  } else if (k < 1.5) {
    // A sweep turning round, a bar a turn, the tiles it passes trailing off.
    float arm = fract((a / 6.2831853) - uSong / 2.4);
    float trail = pow(1.0 - arm, 6.0) + pow(1.0 - fract(arm + 0.5), 6.0);
    return chogHue(a / 6.2831853 + uSong * 0.05) * (0.1 + trail * (0.8 + 0.5 * hit));
  } else if (k < 2.5) {
    // A checkerboard that swaps on the beat.
    float odd = mod(cell.x + cell.y + beat, 2.0);
    return mix(vec3(0.55, 0.3, 1.0), vec3(1.0, 0.35, 0.8), odd) * (0.18 + odd * (0.6 + 0.5 * hit));
  }
  // Sparkles: a few tiles each beat, in turn.
  float s = hash2(cell + floor(beat) * 7.13);
  float on = step(0.8, s) * (0.4 + 0.9 * hit);
  return chogHue(s * 3.0) * (0.08 + on);
}
vec3 led() {
  vec2 cell = floor(vLed / ${TILE.toFixed(2)});
  vec2 c = (cell + 0.5) * ${TILE.toFixed(2)};
  // Each tile a lit panel: bright through the middle, dark grout round it.
  vec2 f = fract(vLed / ${TILE.toFixed(2)}) - 0.5;
  float panel = smoothstep(0.5, 0.42, max(abs(f.x), abs(f.y)));
  panel *= 0.75 + 0.25 * (1.0 - dot(f, f) * 2.0);
  float beat = floor(uSong / ${BEAT.toFixed(2)});
  float ph = fract(uSong / ${BEAT.toFixed(2)});
  vec3 col = mix(pattern(uPat, cell, c, beat, ph), pattern(mod(uPat + 1.0, 4.0), cell, c, beat, ph), uMix);
  // The cheer: the whole floor strobes through the colours, a white burst rolling out.
  float r = length(c);
  float bw = (r - fract(uT * 0.75) * 3.0) * 4.0;
  vec3 cheer = chogHue(uT * 1.5 + r * 0.3) * (0.5 + 0.5 * step(0.5, fract(uT * 4.0))) + vec3(1.0, 0.95, 0.9) * exp(-bw * bw) * 1.2;
  col = mix(col, cheer, uCheer);
  // Resting: a slow glow that breathes.
  vec3 rest = chogHue(r * 0.2 + uT * 0.03) * (0.1 + 0.08 * sin(uT * 1.4 - r * 2.0));
  col = mix(col, rest, uIdle);
  // Off past the floor's edge.
  float edge = smoothstep(${FLOOR_R.toFixed(2)}, ${(FLOOR_R - 0.06).toFixed(2)}, r);
  return col * panel * edge * uK;
}
`;

function ledFloor(quality) {
  const uniforms = { uT: { value: 0 }, uSong: { value: 0 }, uPat: { value: 0 }, uMix: { value: 0 }, uCheer: { value: 0 }, uIdle: { value: 1 }, uK: { value: 1 } };
  // Dark glass, satin rather than glossy, so the sky's reflection doesn't wash the colours out by day.
  const mat = new THREE.MeshStandardMaterial({ color: '#120d1c', roughness: 0.5, metalness: 0.0, envMapIntensity: 0.35 });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vLed;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLed = position.xy;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${LED}`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += led();')
      // The grout darker than the glass.
      .replace('#include <color_fragment>', `#include <color_fragment>
        { vec2 f = fract(vLed / ${TILE.toFixed(2)}) - 0.5; diffuseColor.rgb *= 0.55 + 0.45 * smoothstep(0.5, 0.44, max(abs(f.x), abs(f.y))); }`);
  };
  mat.customProgramCacheKey = () => 'stage-led-1';
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(FLOOR_R, quality === 'low' ? 48 : 96), mat);
  mesh.receiveShadow = true;
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = STAGE_TOP + 0.004;
  return { mesh, uniforms };
}

// ---------- confetti ----------
const CONFETTI_VERT = /* glsl */ `
attribute vec3 aFrom;   // where it's fired from
attribute vec3 aVel;    // how fast, which way
attribute vec4 aSeed;   // delay, spin, sway phase, size
attribute vec3 aCol;
uniform float uT;
varying vec3 vCol;
varying float vLight;
varying float vGlint;
mat3 rotAxis(vec3 ax, float a) {
  float s = sin(a), c = cos(a), o = 1.0 - c;
  return mat3(o * ax.x * ax.x + c, o * ax.x * ax.y + ax.z * s, o * ax.z * ax.x - ax.y * s,
              o * ax.x * ax.y - ax.z * s, o * ax.y * ax.y + c, o * ax.y * ax.z + ax.x * s,
              o * ax.z * ax.x + ax.y * s, o * ax.y * ax.z - ax.x * s, o * ax.z * ax.z + c);
}
void main() {
  float t = max(uT - aSeed.x, 0.0);
  // Fired out against the air, slowing fast, then fluttering down at its own slow pace.
  float k = 2.4;
  float e = exp(-k * t);
  vec3 p = aFrom + aVel * (1.0 - e) / k;
  p.y -= 0.55 * (t - (1.0 - e) / k);
  float settle = smoothstep(0.3, 1.4, t);
  float ground = length(p.xz) < ${STAGE_R.toFixed(2)} ? ${(STAGE_TOP + 0.008).toFixed(3)} : 0.008;
  float near = smoothstep(ground + 0.35, ground + 0.02, p.y);
  float sway = settle * (1.0 - near);
  p.x += sin(t * (2.0 + aSeed.z) + aSeed.z * 6.0) * 0.12 * sway;
  p.z += cos(t * (1.6 + aSeed.z) + aSeed.z * 9.0) * 0.12 * sway;
  float landed = step(p.y, ground);
  p.y = max(p.y, ground);
  // Tumbling as it falls, lying flat once it's down.
  vec3 ax = normalize(vec3(sin(aSeed.y * 7.0), 0.6, cos(aSeed.y * 11.0)));
  mat3 R = rotAxis(ax, t * (6.0 + aSeed.y * 8.0));
  float lie = max(near, landed);
  vec3 q = position * vec3(0.036, 0.06, 1.0) * aSeed.w;
  vec3 tumbled = R * q;
  vec3 lying = vec3(q.x, 0.001, q.y);
  // Gone a little after it lands: it shrinks into the paving's light, flat.
  float life = 1.0 - smoothstep(6.5, 8.5, t);
  vec3 local = mix(tumbled, lying, lie) * life * step(0.001, uT - aSeed.x);
  vec3 n = mix(R * vec3(0.0, 0.0, 1.0), vec3(0.0, 1.0, 0.0), lie);
  n *= inversesqrt(max(dot(n, n), 1e-6));
  vec4 mv = modelViewMatrix * vec4(p + local, 1.0);
  // Foil: the light catches it as it turns.
  vec3 nv = normalize(normalMatrix * n);
  vGlint = pow(min(abs(nv.z), 1.0), 12.0) * (1.0 - lie);
  vLight = 0.55 + 0.45 * abs(n.y);
  vCol = aCol;
  gl_Position = projectionMatrix * mv;
}`;
const CONFETTI_FRAG = /* glsl */ `
uniform float uDay;
varying vec3 vCol;
varying float vLight;
varying float vGlint;
void main() {
  vec3 c = vCol * vLight * (0.35 + 0.65 * uDay) + vec3(1.0, 0.95, 0.85) * vGlint * 0.8;
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

function confetti(quality, facing) {
  const n = quality === 'low' ? 220 : 440;
  const quad = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.attributes.position);
  const from = new Float32Array(n * 3), vel = new Float32Array(n * 3), seed = new Float32Array(n * 4), col = new Float32Array(n * 3);
  let s = 1234;
  const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  const COLS = ['#8b5cf6', '#ff5fcf', '#ffcc4d', '#5fe1ff', '#ffffff', '#b794ff', '#ff8a5c'].map((c) => new THREE.Color(c));
  const fwd = new THREE.Vector3(Math.sin(facing), 0, Math.cos(facing));
  const side = new THREE.Vector3(fwd.z, 0, -fwd.x);
  for (let i = 0; i < n; i++) {
    const kind = i % 3; // two cannons and the shower
    let p, v;
    if (kind < 2) {
      const sx = kind ? 1 : -1;
      // From the front corners of the stage, up and in over the crowd.
      p = fwd.clone().multiplyScalar(1.45).addScaledVector(side, sx * 1.05).setY(STAGE_TOP + 0.3);
      v = fwd.clone().multiplyScalar(1.2 + rnd() * 2.2).addScaledVector(side, -sx * (0.6 + rnd() * 1.6)).setY(6.5 + rnd() * 3.5);
      v.addScaledVector(new THREE.Vector3(rnd() - 0.5, 0, rnd() - 0.5), 1.6);
    } else {
      // Down over the stage and the front of the crowd, from up high.
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 3.4;
      p = new THREE.Vector3(Math.cos(a) * r, 3.6 + rnd() * 1.6, Math.sin(a) * r).addScaledVector(fwd, 1.2);
      v = new THREE.Vector3((rnd() - 0.5) * 0.8, rnd() * 0.6, (rnd() - 0.5) * 0.8);
    }
    from.set([p.x, p.y, p.z], i * 3);
    vel.set([v.x, v.y, v.z], i * 3);
    seed.set([kind < 2 ? rnd() * 0.35 : 0.25 + rnd() * 1.2, rnd(), rnd(), 0.8 + rnd() * 0.6], i * 4);
    const c = COLS[(rnd() * COLS.length) | 0];
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('aFrom', new THREE.InstancedBufferAttribute(from, 3));
  geo.setAttribute('aVel', new THREE.InstancedBufferAttribute(vel, 3));
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
  geo.setAttribute('aCol', new THREE.InstancedBufferAttribute(col, 3));
  geo.instanceCount = n;
  const uniforms = { uT: { value: 0 }, uDay: { value: 1 } };
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: CONFETTI_VERT, fragmentShader: CONFETTI_FRAG, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.visible = false;
  return { mesh, uniforms };
}

export function createStageFx({ facing = 0, quality = 'high' } = {}) {
  const group = new THREE.Group();
  group.name = 'stage-fx';
  const floor = ledFloor(quality);
  // The tiles square to the way the singer faces.
  floor.mesh.rotation.z = facing;
  const bits = confetti(quality, facing);
  group.add(floor.mesh, bits.mesh);
  let t = 0;
  let cheer = 0, idle = 1;
  let burst = -1;
  let lastPart = null;
  const u = floor.uniforms;
  return {
    group,
    update(dt, { songTime = 0, part = 'idle', env = null } = {}) {
      t += dt;
      const night = env?.night ?? 0;
      u.uT.value = t;
      u.uSong.value = songTime;
      // A pattern each two bars, crossfading over a beat into the next.
      const twoBars = BEAT * 8;
      const k = songTime / twoBars;
      u.uPat.value = Math.floor(k) % 4;
      u.uMix.value = THREE.MathUtils.smoothstep(k - Math.floor(k), 1 - BEAT / twoBars, 1);
      cheer += ((part === 'cheer' ? 1 : 0) - cheer) * (1 - Math.exp(-dt * 10));
      idle += ((part === 'idle' ? 1 : 0) - idle) * (1 - Math.exp(-dt * 2.5));
      u.uCheer.value = cheer;
      u.uIdle.value = idle;
      // Brighter at night, when there's no sun on it to compete with.
      u.uK.value = 1.6 + night * 0.9;
      // The cheer fires the confetti.
      if (part === 'cheer' && lastPart !== 'cheer') burst = 0;
      lastPart = part;
      if (burst >= 0) {
        burst += dt;
        bits.uniforms.uT.value = burst;
        bits.mesh.visible = burst < 9;
        if (burst >= 9) burst = -1;
      }
      bits.uniforms.uDay.value = 1 - night * 0.6;
    },
    // Everything shown for a moment, for the load to draw once (B12).
    warmAll(on) {
      bits.mesh.visible = on;
      bits.uniforms.uT.value = on ? 1 : 0;
    },
  };
}
