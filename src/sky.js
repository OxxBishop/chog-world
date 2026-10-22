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

// Angular radius of the sun and moon discs, in radians. Drawn larger than life so they read.
const SUN_RADIUS = 0.034;
const MOON_RADIUS = 0.026;
// The moon trails the sun by this many hours along the same arc: it rises mid-afternoon, rides
// high through the evening and sets before dawn, a little past full.
const MOON_LAG = 10;

// Direction of the sun (or the moon, with its lag) at an hour: rises in the east, arcs over the south.
function arcDir(hour, out, tilt = -0.45) {
  const a = ((hour - 6) / 12) * Math.PI;
  return out.set(Math.cos(a), Math.sin(a) * 0.9, tilt).normalize();
}

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

  // The sea line: the sun and moon sink behind it as they set.
  float aboveSea = smoothstep(-0.003, 0.002, h);

  // Sun: a bright disc, darker toward its rim, in a glow that takes on the sky's colour. Low in the
  // sky it turns gold, then deep orange as it touches the sea.
  float sd = dot(d, uSunDir);
  float sunUp = clamp(uSunDir.y, 0.0, 1.0);
  vec3 sunTint = mix(vec3(1.0, 0.45, 0.2), vec3(1.0, 0.97, 0.9), smoothstep(0.0, 0.4, sunUp));
  float sunR = acos(clamp(sd, -1.0, 1.0)) / SUN_RADIUS;
  float disc = (1.0 - smoothstep(0.9, 1.0, sunR)) * (0.75 + 0.25 * sqrt(max(0.0, 1.0 - sunR * sunR)));
  float sunFade = smoothstep(-0.12, 0.02, uSunDir.y);
  vec3 halo = mix(uHorizon, sunTint, 0.6);
  // Dimmer when low, so its colour survives the tone mapping instead of burning to white.
  col = mix(col, sunTint * mix(1.5, 7.0, smoothstep(0.02, 0.35, sunUp)), disc * aboveSea * sunFade);
  col += halo * (pow(max(sd, 0.0), 900.0) * 1.6 + pow(max(sd, 0.0), 60.0) * 0.45 + pow(max(sd, 0.0), 8.0) * 0.12 * (1.0 - sunUp)) * sunFade;

  // Moon: a lit sphere, its bright side turned toward the sun, so it shows its phase. Pale by day.
  float md = dot(d, uMoonDir);
  vec3 mr = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
  vec3 mu = cross(mr, uMoonDir);
  vec2 mp = vec2(dot(d, mr), dot(d, mu)) / sin(MOON_RADIUS);
  float mr2 = dot(mp, mp);
  if (md > 0.0 && mr2 < 1.2) {
    float edge = 1.0 - smoothstep(0.92, 1.0, sqrt(mr2));
    vec3 n = mr * mp.x + mu * mp.y - uMoonDir * sqrt(max(0.0, 1.0 - mr2));
    float lit = smoothstep(-0.06, 0.12, dot(n, uSunDir));
    // Dark seas across the face.
    float maria = smoothstep(0.42, 0.62, tn(mp * 0.11 + 0.3) * 0.7 + tg(mp * 0.23 + 0.7) * 0.3);
    vec3 face = vec3(0.96, 0.93, 1.0) * mix(1.0, 0.72, maria) * (lit * 1.6 + 0.035);
    float moonVis = edge * aboveSea * mix(0.32, 1.0, uNight);
    col = mix(col, face + col * (1.0 - lit) * 0.4 * (1.0 - uNight), moonVis);
  }
  // Soft halo, brightest when more of the face is lit.
  float moonLit = 0.5 - 0.5 * dot(uMoonDir, uSunDir);
  col += vec3(0.55, 0.48, 0.95) * (pow(max(md, 0.0), 1800.0) * 0.35 + pow(max(md, 0.0), 120.0) * 0.12) * moonLit * uNight * smoothstep(-0.05, 0.03, uMoonDir.y);

  vec2 hd = normalize(d.xz + 1e-5);

  // Stars: a round soft point somewhere in each lit cell of a grid round the sky (a whole cell lit, they
  // drew as little rectangles: the user, 10-21), a few of them bigger and bluer or warmer.
  if (h > 0.0 && uNight > 0.01) {
    vec3 g = d * 220.0;
    vec3 cell = floor(g);
    float s = hash3(cell);
    if (s > 0.995) {
      vec3 at = vec3(hash3(cell + 1.7), hash3(cell + 3.1), hash3(cell + 5.3)) - 0.5;
      float r = length(fract(g) - 0.5 - at * 0.5);
      float big = fract(s * 913.7);
      float size = mix(0.07, 0.16, big * big);
      float core = smoothstep(size, size * 0.25, r);
      float glow = exp(-r * r / (size * size * 6.0)) * 0.35;
      float tw = 0.65 + 0.35 * sin(uTime * (1.4 + big * 2.0) + s * 50.0);
      vec3 tint = mix(vec3(0.82, 0.86, 1.0), vec3(1.0, 0.9, 0.82), fract(s * 377.3));
      col += tint * (core + glow) * (0.7 + big * 0.8) * smoothstep(0.02, 0.25, h) * tw * uNight;
    }
  }

  // A soft glow along the horizon at night, so sea and sky meet without a hard edge.
  col += vec3(0.32, 0.14, 0.58) * exp(-abs(h) * 9.0) * uNight * 0.3;

  // The sea, far below the clouds at sea level: rolling waves that catch the sky and the sun or
  // moon, fading into the haze toward the horizon. It shows through the gaps in the cloud deck.
  if (h < 0.0) {
    float t = (uCamPos.y + 1800.0) / max(-h, 1e-4);
    vec2 sp = uCamPos.xz + d.xz * t;
    // Two wave trains rolling different ways, quick enough to see from up here.
    vec2 q = sp / 700.0 + vec2(uTime * 0.012, uTime * 0.007);
    vec2 q2 = q * 3.7 + vec2(-uTime * 0.03, uTime * 0.018);
    float e = 0.004;
    vec2 slope = vec2(tn(q) - tn(q + vec2(e, 0.0)), tn(q) - tn(q + vec2(0.0, e))) * 30.0
      + vec2(tg(q2) - tg(q2 + vec2(e, 0.0)), tg(q2) - tg(q2 + vec2(0.0, e))) * 18.0;
    vec3 n = normalize(vec3(slope.x, 1.0, slope.y));
    vec3 r = reflect(d, n);
    vec3 sky = mix(uHorizon, uTop, pow(smoothstep(0.0, 0.65, max(r.y, 0.0)), 0.8));
    float fres = 0.02 + 0.98 * pow(clamp(1.0 - dot(-d, n), 0.0, 1.0), 5.0);
    vec3 deep = mix(vec3(0.012, 0.06, 0.2), vec3(0.003, 0.006, 0.025), uNight);
    vec3 sea = mix(deep, sky, fres);
    // Glints twinkle as the waves turn.
    float twinkle = 0.45 + 0.55 * sin(uTime * 2.6 + tb(q2 * 5.0) * 40.0);
    sea += uSunColor * pow(max(dot(r, uSunDir), 0.0), 300.0) * 3.4 * twinkle * (1.0 - uNight);
    sea += vec3(0.6, 0.55, 0.9) * pow(max(dot(r, uMoonDir), 0.0), 400.0) * 1.7 * twinkle * uNight;
    col = mix(sea, col, 1.0 - exp(-t / 12000.0));
  }

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
        defines: { SUN_RADIUS: SUN_RADIUS.toFixed(4), MOON_RADIUS: MOON_RADIUS.toFixed(4) },
        side: THREE.BackSide,
        depthWrite: false,
      }),
    );
    this.mesh.frustumCulled = false;
    // Drawn after everything solid, at the far plane (xyww): the GPU skips every pixel the islands
    // already cover, so the sky's shader runs only where sky shows. First, it shaded the whole screen,
    // 12.5 ms a frame on the HD 520 (A, 10-16).
    this.mesh.renderOrder = 1000;
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
    // One fixed shadow box over the whole archipelago, re-rendered only when the hour moves.
    this.light.shadow.mapSize.set(4096, 4096);
    const sc = this.light.shadow.camera;
    sc.near = 1;
    sc.far = 1200;
    this.light.shadow.bias = -0.0003;
    this.light.shadow.normalBias = 0.04;
    this.light.shadow.radius = 3;
    this.focus = new THREE.Vector3(0, 2, 0);
    this.focusR = 275;
    scene.add(this.hemi, this.light, this.light.target);

    // Fog blends the far water into the horizon colour.
    this.fog = new THREE.Fog(0xffffff, 160, 700);
    scene.fog = this.fog;

    this.env = { night: 0, sunElev: 1, top: this.uniforms.uTop.value, horizon: this.uniforms.uHorizon.value };
    this.moonLight = new THREE.Vector3(0, 1, 0);
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

    const sunElev = Math.sin(((hour - 6) / 12) * Math.PI);
    arcDir(hour, u.uSunDir.value);
    arcDir(hour - MOON_LAG, u.uMoonDir.value, -0.55);
    // Moonlight on the world comes from the moon, but never from below the horizon: once it has
    // set, the night light holds a low angle and dims.
    this.moonLight.copy(u.uMoonDir.value);
    if (this.moonLight.y < 0.3) this.moonLight.setY(0.3).normalize();
    const moonUp = THREE.MathUtils.smoothstep(u.uMoonDir.value.y, -0.08, 0.12);
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

    // Light follows whichever body is up.
    const useSun = sunElev > -0.04;
    const dir = useSun ? u.uSunDir.value : this.moonLight;
    this.light.target.position.copy(this.focus);
    this.light.position.copy(this.focus).addScaledVector(dir, 600);
    const sc = this.light.shadow.camera;
    if (sc.right !== this.focusR) {
      sc.left = sc.bottom = -this.focusR;
      sc.right = sc.top = this.focusR;
      sc.updateProjectionMatrix();
    }
    const sunColor = new THREE.Color('#ffe3bd').lerp(new THREE.Color('#ff9ac0'), low);
    this.light.color.copy(useSun ? sunColor : new THREE.Color('#b9a4ff'));
    this.light.intensity = useSun ? 3.2 * THREE.MathUtils.smoothstep(sunElev, -0.04, 0.25) : 0.9 * night * (0.45 + 0.55 * moonUp);
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
