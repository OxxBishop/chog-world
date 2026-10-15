import * as THREE from 'three';

/*
 * Warp speed (B25): what the camera flies through between the world and the planet. Streaks of light
 * rushing past (one instanced mesh of thin quads, laid out round the line of sight in the camera's
 * own space, stretched by the speed), a violet tunnel round them, and a flash: a lilac-white sheet
 * over everything for a beat.
 *
 * All of it lives in front of the camera and draws over the world, so what is behind it can change
 * while the tunnel hides it. set({ speed, tunnel, flash, tint }) each frame (0 to 1 each, but speed);
 * the group is visible only while one of them is up. Its three materials are compiled at load with
 * the rest of the world seen from space (src/space.js).
 */

const STREAKS_HIGH = 1400, STREAKS_LOW = 520;
// The streaks fill a tube round the line of sight, from R0 to R1 out, from NEAR to FAR ahead.
const R0 = 1.2, R1 = 14, NEAR = 2, FAR = 160;

const STREAK_VERT = /* glsl */ `
attribute vec3 aSeed; // angle, radius 0-1, depth 0-1
attribute vec3 aTint;
uniform float uTime;
uniform float uSpeed;
uniform float uLen;
varying vec2 vUv;
varying vec3 vTint;
varying float vFade;
void main() {
  float a = aSeed.x * 6.2831853;
  float r = mix(${R0.toFixed(1)}, ${R1.toFixed(1)}, aSeed.y * aSeed.y);
  // Rushing toward the camera, wrapping round at the far end.
  float depth = mod(aSeed.z * ${FAR.toFixed(1)} - uTime, ${FAR.toFixed(1)});
  float z = -(${NEAR.toFixed(1)} + depth);
  vec2 dir = vec2(cos(a), sin(a));
  // Each streak a thin quad along the line of sight, as long as the speed makes it.
  float len = uLen * (0.6 + aSeed.y);
  vec3 p = vec3(dir * r, z + position.y * len);
  p.xy += vec2(-dir.y, dir.x) * position.x * (0.06 + 0.07 * aSeed.y);
  vUv = vec2(position.x + 0.5, position.y + 0.5);
  vTint = aTint;
  // In from the dark far off, out before it reaches the lens.
  vFade = smoothstep(${FAR.toFixed(1)}, ${(FAR * 0.55).toFixed(1)}, depth) * smoothstep(0.0, 6.0, depth);
  gl_Position = projectionMatrix * vec4(p, 1.0);
}`;

const STREAK_FRAG = /* glsl */ `
uniform float uOpacity;
varying vec2 vUv;
varying vec3 vTint;
varying float vFade;
void main() {
  // A soft line: bright core across, tapering to both ends along.
  float ax = (vUv.x - 0.5) * 4.2;
  float across = exp(-ax * ax);
  float along = smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.7, vUv.y);
  float a = across * along * vFade * uOpacity;
  gl_FragColor = vec4(vTint * a * 3.6, a);
}`;

const TUNNEL_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * vec4(position, 1.0);
}`;

// The tunnel: a long tube round the line of sight, its wall swirling violet noise that rushes past.
const TUNNEL_FRAG = /* glsl */ `
uniform float uTime;
uniform float uOpacity;
uniform vec3 uTint;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  // u round the tube (seamless), v along it.
  float ang = vUv.x * 6.2831853;
  vec2 q = vec2(cos(ang), sin(ang)) * 3.0;
  float v = vUv.y * 9.0 + uTime * 1.6;
  float n = noise(vec2(q.x + v * 0.7, q.y + v)) * 0.6 + noise(vec2(q.x * 2.3 - v * 1.3, q.y * 2.3 + v * 1.9)) * 0.4;
  float bands = smoothstep(0.45, 1.0, n);
  // Darker far down the tube, so it reads as depth.
  float far = smoothstep(1.0, 0.0, vUv.y);
  vec3 col = mix(vec3(0.05, 0.02, 0.14), uTint, bands) * (0.35 + 0.65 * far);
  col += vec3(1.0, 0.8, 1.0) * pow(bands, 6.0) * 0.6;
  gl_FragColor = vec4(col * 1.4, uOpacity * (0.55 + 0.45 * far));
}`;

const FLASH_FRAG = /* glsl */ `
uniform float uOpacity;
uniform vec3 uTint;
varying vec2 vUv;
void main() {
  // Hottest in the middle, where the jump opens.
  float d = distance(vUv, vec2(0.5));
  vec3 col = mix(vec3(1.0), uTint, smoothstep(0.0, 0.7, d));
  gl_FragColor = vec4(col * 1.8, uOpacity);
}`;

export function createWarp({ quality = 'high' } = {}) {
  const n = quality === 'low' ? STREAKS_LOW : STREAKS_HIGH;
  const group = new THREE.Group();
  group.visible = false;
  group.renderOrder = 10;

  // The streaks.
  const quad = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.attributes.position);
  const seeds = new Float32Array(n * 3), tints = new Float32Array(n * 3);
  let s = 11;
  const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  const TINTS = [[1, 1, 1], [0.78, 0.66, 1], [0.6, 0.9, 1], [1, 0.7, 0.92], [0.9, 0.85, 1]];
  for (let i = 0; i < n; i++) {
    seeds.set([rnd(), rnd(), rnd()], i * 3);
    tints.set(TINTS[Math.floor(rnd() * TINTS.length)], i * 3);
  }
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 3));
  geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tints, 3));
  geo.instanceCount = n;
  const streakMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uSpeed: { value: 0 }, uLen: { value: 1 }, uOpacity: { value: 0 } },
    vertexShader: STREAK_VERT, fragmentShader: STREAK_FRAG,
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  });
  const streaks = new THREE.Mesh(geo, streakMat);
  streaks.frustumCulled = false;
  streaks.renderOrder = 11;

  // The tunnel: an open tube along the line of sight, seen from inside.
  const tubeGeo = new THREE.CylinderGeometry(R1 * 1.35, R1 * 0.5, FAR, 48, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -FAR / 2 - NEAR);
  const tunnelMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 }, uTint: { value: new THREE.Color(0.55, 0.3, 1.0) } },
    vertexShader: TUNNEL_VERT, fragmentShader: TUNNEL_FRAG,
    side: THREE.BackSide, transparent: true, depthWrite: false, depthTest: false,
  });
  const tunnel = new THREE.Mesh(tubeGeo, tunnelMat);
  tunnel.frustumCulled = false;
  tunnel.renderOrder = 10;

  // The flash: a sheet right in front of the lens.
  const flashMat = new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0 }, uTint: { value: new THREE.Color(0.82, 0.7, 1.0) } },
    vertexShader: TUNNEL_VERT.replace('gl_Position = projectionMatrix * vec4(position, 1.0);', 'gl_Position = vec4(position.xy * 2.0, 0.0, 1.0);'),
    fragmentShader: FLASH_FRAG,
    transparent: true, depthWrite: false, depthTest: false,
  });
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), flashMat);
  flash.frustumCulled = false;
  flash.renderOrder = 12;

  group.add(tunnel, streaks, flash);
  let travel = 0, clock = 0;
  const api = {
    group,
    /**
     * What shows: speed (metres a second the streaks rush past; their length grows with it), tunnel,
     * flash and streaks (0 to 1), tint (the tunnel's colour). dt moves them on.
     */
    set({ speed = 0, tunnel: tk = 0, flash: fk = 0, streaks: sk = 1, tint = null } = {}, dt = 0) {
      clock += dt;
      travel += speed * dt;
      streakMat.uniforms.uTime.value = travel;
      streakMat.uniforms.uLen.value = 0.4 + speed * 0.045;
      streakMat.uniforms.uOpacity.value = THREE.MathUtils.clamp(speed / 60, 0, 1) * sk;
      tunnelMat.uniforms.uTime.value = clock;
      tunnelMat.uniforms.uOpacity.value = tk;
      if (tint) tunnelMat.uniforms.uTint.value.set(tint);
      flashMat.uniforms.uOpacity.value = fk;
      streaks.visible = streakMat.uniforms.uOpacity.value > 0.001;
      tunnel.visible = tk > 0.001;
      flash.visible = fk > 0.001;
      group.visible = streaks.visible || tunnel.visible || flash.visible;
    },
    // Drawn once at load so their shaders are built (B12): everything up, for a moment.
    warmAll(on) {
      for (const m of [streaks, tunnel, flash]) m.visible = on;
      group.visible = on;
      streakMat.uniforms.uOpacity.value = on ? 1 : 0;
      tunnelMat.uniforms.uOpacity.value = on ? 1 : 0;
      flashMat.uniforms.uOpacity.value = on ? 0.01 : 0;
    },
  };
  return api;
}
