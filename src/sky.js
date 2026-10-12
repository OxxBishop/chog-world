import * as THREE from 'three';
import { clamp } from './util.js';

// Sky colour keys through a day: [hour, zenith, horizon]. Purple at every hour.
const KEYS = [
  [0, '#0a0520', '#22114a'],
  [4.5, '#0d0727', '#2a1554'],
  [5.6, '#271761', '#7d47ad'],
  [6.6, '#6553cf', '#ff9fc6'],
  [8.3, '#7a64f0', '#d6c2ff'],
  [12, '#6b56ea', '#d0bcff'],
  [16.4, '#765ee8', '#dcbcf0'],
  [18.2, '#5636aa', '#ff8fb5'],
  [19.2, '#29166c', '#77389b'],
  [20.4, '#110930', '#2b1555'],
  [24, '#0a0520', '#22114a'],
];
const keyColors = KEYS.map(([h, top, hor]) => [h, new THREE.Color(top), new THREE.Color(hor)]);

const vert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const frag = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uBottom;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uSunColor;
uniform float uNight;
uniform float uTime;
uniform vec3 uCamPos;
uniform sampler2D uNoise;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform float uCloudH;
varying vec3 vDir;

float tn(vec2 p) { return texture2D(uNoise, p).r; }
float tg(vec2 p) { return texture2D(uNoise, p).g; }
float tb(vec2 p) { return texture2D(uNoise, p).b; }

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; }
  return s;
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = h > 0.0
    ? mix(uHorizon, uTop, pow(smoothstep(0.0, 0.65, h), 0.8))
    : mix(uHorizon, uBottom, smoothstep(0.0, -0.25, h));

  // Sun: hard toon disc plus a soft glow.
  float sd = dot(d, uSunDir);
  col += uSunColor * (smoothstep(0.9985, 0.9991, sd) * 1.4 + pow(max(sd, 0.0), 40.0) * 0.3) * (1.0 - uNight);

  // Moon.
  float md = dot(d, uMoonDir);
  col = mix(col, vec3(0.95, 0.9, 1.0), smoothstep(0.9991, 0.9994, md) * uNight);
  col += vec3(0.45, 0.35, 0.9) * pow(max(md, 0.0), 60.0) * 0.25 * uNight;

  vec2 hd = normalize(d.xz + 1e-5);

  // Stars.
  if (h > 0.0) {
    float s = hash3(floor(d * 220.0));
    float tw = 0.6 + 0.4 * sin(uTime * 2.0 + s * 50.0);
    col += vec3(0.9, 0.85, 1.0) * step(0.9965, s) * smoothstep(0.02, 0.25, h) * tw * uNight;
  }

  // A soft glow along the horizon at night, so sea and sky meet without a hard edge.
  col += vec3(0.32, 0.14, 0.58) * exp(-abs(h) * 9.0) * uNight * 0.3;

  // Aurora: curtains of light hanging in a slab high above the world, ray-marched so they have
  // real depth: they overlap, converge on the horizon and shift as you fly.
  if (h > 0.0 && uNight > 0.01) {
    vec3 ro = uCamPos;
    float H0 = 1600.0, H1 = 4600.0;
    float t0 = (H0 - ro.y) / h;
    float t1 = min((H1 - ro.y) / h, 45000.0);
    if (t0 < t1) {
      const int STEPS = 24;
      float dt = (t1 - t0) / float(STEPS);
      // Interleaved gradient noise: an even dither that reads as smooth instead of grainy.
      float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      // Curtains blur out as the samples spread apart near the horizon.
      float w = 0.035 + (dt / 16000.0) * 3.0;
      float energy = 0.035 / max(w, 0.035);
      vec3 acc = vec3(0.0);
      for (int i = 0; i < STEPS; i++) {
        float t = t0 + (float(i) + jit) * dt;
        vec3 p = ro + d * t;
        float hg = (p.y - H0) / (H1 - H0);
        vec2 q = p.xz / 16000.0 + vec2(uTime * 0.0018, uTime * 0.0006);
        // Wavy bands across the sky, broken into separate curtains.
        // Folds ripple along each curtain and the whole shape slowly re-forms.
        float b = q.y * 4.0 + (tn(q * 0.4 + vec2(uTime * 0.004, -uTime * 0.002)) - 0.5) * 4.5
          + sin(q.x * 9.0 + uTime * 0.35) * 0.18 + sin(q.x * 23.0 - uTime * 0.6) * 0.05;
        float line = 1.0 - smoothstep(0.0, w, abs(fract(b) - 0.5));
        float seg = smoothstep(0.25, 0.5, tg(vec2(q.x * 0.6, b * 0.2) + 0.2)) * (0.7 + 0.3 * sin(uTime * 0.8 + b * 3.0 + q.x * 5.0));
        // Rays: brightness changes along a curtain but holds up its height.
        // Rays sweep along the curtain and flicker.
        float rays = 0.25 + 0.75 * tb(vec2(q.x * 9.0 + uTime * 0.04, b * 0.35 + uTime * 0.01));
        // Bright lower hem, fading upward.
        float prof = smoothstep(0.0, 0.05, hg) * exp(-hg * 3.2);
        vec3 c = mix(vec3(0.42, 0.18, 1.0), vec3(0.98, 0.34, 0.92), smoothstep(0.05, 0.6, hg));
        acc += c * line * seg * rays * prof;
      }
      acc *= dt / 1100.0 * energy;
      vec3 aur = 1.0 - exp(-acc * 2.0);
      col += aur * uNight * uNight * smoothstep(0.0, 0.12, h) * 1.25;
    }
  }

  // Clouds: a soft layer high above the world, seen in perspective, lit by the sun or the moon.
  if (h > 0.0) {
    float t = (uCloudH - uCamPos.y) / max(h, 0.001);
    vec2 cp = uCamPos.xz + d.xz * t;
    vec2 q = cp / 5200.0 + vec2(uTime * 0.0009, uTime * 0.0003);
    vec2 warp = vec2(tg(q * 0.8 + 0.5), tn(q * 0.8 + 0.9)) - 0.5;
    float n = tn(q + warp * 0.25) * 0.7 + tb(q * 3.1 + warp) * 0.3;
    float cover = smoothstep(0.52, 0.72, n);
    float core = smoothstep(0.6, 0.86, n);
    cover *= smoothstep(60000.0, 12000.0, t) * smoothstep(0.0, 0.08, h);
    vec3 lightDir = uNight > 0.5 ? uMoonDir : uSunDir;
    float silver = pow(max(dot(d, lightDir), 0.0), 6.0) * (1.0 - core);
    vec3 cc = mix(uCloudLit, uCloudShade, core * 0.8) + uCloudLit * silver * 0.5;
    col = mix(col, cc, cover * mix(0.95, 0.8, uNight));
  }

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

// Tileable value-noise fBm in three channels, used by the clouds and the aurora.
function noiseTexture() {
  const S = 256;
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const lattice = (period) => Float32Array.from({ length: period * period }, rnd);
  const sample = (g, period, x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const at = (a, b) => g[((b % period) + period) % period * period + (((a % period) + period) % period)];
    const top = at(xi, yi) * (1 - u) + at(xi + 1, yi) * u;
    const bot = at(xi, yi + 1) * (1 - u) + at(xi + 1, yi + 1) * u;
    return top * (1 - v) + bot * v;
  };
  const fbmTile = (periods) => {
    const grids = periods.map((p) => [p, lattice(p)]);
    const out = new Float32Array(S * S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        let sum = 0, amp = 0.5, norm = 0;
        for (const [p, g] of grids) {
          sum += amp * sample(g, p, (x / S) * p, (y / S) * p);
          norm += amp;
          amp *= 0.5;
        }
        out[y * S + x] = sum / norm;
      }
    }
    return out;
  };
  const r = fbmTile([4, 8, 16, 32, 64]);
  const g = fbmTile([6, 12, 24, 48, 96]);
  const b = fbmTile([16, 32, 64, 128]);
  const data = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    data[i * 4] = r[i] * 255;
    data[i * 4 + 1] = g[i] * 255;
    data[i * 4 + 2] = b[i] * 255;
    data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

const NIGHT_GLOW = new THREE.Color(0.32 * 0.3, 0.14 * 0.3, 0.58 * 0.3);
const WHITE = new THREE.Color(1, 1, 1);
const NIGHT_CLOUD_LIT = new THREE.Color('#3a2a6a');
const NIGHT_CLOUD_SHADE = new THREE.Color('#140c2c');

export class Sky {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.uniforms = {
      uTop: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uBottom: { value: new THREE.Color('#1a0f33') },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
      uSunColor: { value: new THREE.Color('#fff2e0') },
      uNight: { value: 0 },
      uTime: { value: 0 },
      uCamPos: { value: new THREE.Vector3() },
      uNoise: { value: noiseTexture() },
      uCloudLit: { value: new THREE.Color() },
      uCloudShade: { value: new THREE.Color() },
      uCloudH: { value: 900 },
    };
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(500, 48, 24),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: vert,
        fragmentShader: frag,
        side: THREE.BackSide,
        depthWrite: false,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    scene.add(this.mesh);

    // The sky also lights the world: re-baked into an environment map when the hour moves.
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envScene.add(new THREE.Mesh(this.mesh.geometry, this.mesh.material));
    this.envTarget = null;
    this.envHour = -99;

    // One directional light that is the sun by day and the moon by night.
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x3a2d4d, 1);
    this.light = new THREE.DirectionalLight(0xffffff, 2);
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(2048, 2048);
    const sc = this.light.shadow.camera;
    sc.near = 1;
    sc.far = 400;
    this.light.shadow.bias = -0.0003;
    this.light.shadow.normalBias = 0.04;
    this.light.shadow.radius = 3;
    this.focus = new THREE.Vector3();
    this.focusR = 60;
    scene.add(this.hemi, this.light, this.light.target);

    // Fog blends the far water into the horizon colour.
    this.fog = new THREE.Fog(0xffffff, 160, 700);
    scene.fog = this.fog;

    this.env = { night: 0, sunElev: 1, top: this.uniforms.uTop.value, horizon: this.uniforms.uHorizon.value };
  }

  update(hour, camera, time) {
    const u = this.uniforms;
    let i = 0;
    while (i < keyColors.length - 2 && hour >= keyColors[i + 1][0]) i++;
    const [h0, t0, z0] = keyColors[i];
    const [h1, t1, z1] = keyColors[i + 1];
    const k = clamp((hour - h0) / (h1 - h0), 0, 1);
    u.uTop.value.lerpColors(t0, t1, k);
    u.uHorizon.value.lerpColors(z0, z1, k);

    const a = ((hour - 6) / 12) * Math.PI;
    const sunElev = Math.sin(a);
    u.uSunDir.value.set(Math.cos(a), Math.sin(a) * 0.9, -0.45).normalize();
    u.uMoonDir.value.set(-Math.cos(a), -Math.sin(a) * 0.9 + 0.15, -0.55).normalize();
    const night = 1 - THREE.MathUtils.smoothstep(sunElev, -0.2, 0.06);
    u.uNight.value = night;
    u.uTime.value = time;
    const low = 1 - THREE.MathUtils.smoothstep(sunElev, 0.05, 0.45);
    u.uSunColor.value.set('#fff2e0').lerp(new THREE.Color('#ff9ac0'), low);

    this.mesh.position.copy(camera.position);
    u.uCamPos.value.copy(camera.position);
    // Cloud colours: white with lilac shadows by day, pink at sunset, deep purple at night.
    u.uCloudLit.value.copy(WHITE).lerp(u.uHorizon.value, 0.25 + low * 0.3).lerp(NIGHT_CLOUD_LIT, night);
    u.uCloudShade.value.copy(u.uTop.value).lerp(WHITE, 0.45).lerp(NIGHT_CLOUD_SHADE, night);

    // Light follows whichever body is up; the shadow box follows what the camera looks at.
    const useSun = sunElev > -0.04;
    const dir = useSun ? u.uSunDir.value : u.uMoonDir.value;
    this.light.target.position.copy(this.focus);
    this.light.position.copy(this.focus).addScaledVector(dir, 200);
    const sc = this.light.shadow.camera;
    if (sc.right !== this.focusR) {
      sc.left = sc.bottom = -this.focusR;
      sc.right = sc.top = this.focusR;
      sc.updateProjectionMatrix();
    }
    const sunColor = new THREE.Color('#ffe3bd').lerp(new THREE.Color('#ff9ac0'), low);
    this.light.color.copy(useSun ? sunColor : new THREE.Color('#b9a4ff'));
    this.light.intensity = useSun ? 3.2 * THREE.MathUtils.smoothstep(sunElev, -0.04, 0.25) : 0.9 * night;
    this.hemi.color.copy(u.uTop.value).lerp(new THREE.Color('#ffffff'), 0.5);
    this.hemi.groundColor.set(night > 0.5 ? '#4b3a86' : '#a99ccf');
    this.hemi.intensity = THREE.MathUtils.lerp(1.1, 0.42, night);
    this.scene.environmentIntensity = THREE.MathUtils.lerp(0.9, 0.55, night);

    if (Math.abs(hour - this.envHour) > 0.05) {
      this.envHour = hour;
      const next = this.pmrem.fromScene(this.envScene, 0, 1, 1000);
      this.scene.environment = next.texture;
      this.envTarget?.dispose();
      this.envTarget = next;
    }
    u.uBottom.value.copy(u.uHorizon.value);
    if (this.fog) this.fog.color.copy(u.uHorizon.value).add(NIGHT_GLOW.clone().multiplyScalar(night));

    this.env.night = night;
    this.env.sunElev = sunElev;
    return this.env;
  }
}
