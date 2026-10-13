import * as THREE from 'three';
import { Effect, EffectAttribute } from 'postprocessing';
import { CloudsEffect, CLOUD_SHAPE_TEXTURE_SIZE, CLOUD_SHAPE_DETAIL_TEXTURE_SIZE } from '@takram/three-clouds';
import { AtmosphereParameters, PrecomputedTexturesGenerator } from '@takram/three-atmosphere';
import { Ellipsoid, Geodetic, radians, DataTextureLoader, parseUint8Array } from '@takram/three-geospatial';

/*
 * The sea of clouds: physically based volumetric clouds (Takram's three-clouds, MIT).
 *
 * The library works on a real globe, so the world is pinned to a spot high above the Earth:
 * world units are metres, the islands sit at ALTITUDE and a dense cloud deck fills the air
 * just below them. The sun (or, at night, a dimmed moon) lights the clouds from the same
 * direction as our sky.
 */

const ALTITUDE = 1800;
// The library works in physical light units; this brings its clouds up to our scene's brightness.
const EXPOSURE = 5;
// Our islands are a few hundred metres across, so ray steps are scaled down from the km-scale defaults.
const STEP = 0.2;
const ASSETS = `${import.meta.env.BASE_URL}assets/volclouds/`;

// Cloud quality per site quality setting. Half resolution is much faster and nearly identical,
// but softens island edges a touch at sunset, so high keeps full resolution.
const PRESETS = {
  low: { preset: 'low', resolutionScale: 0.5 },
  medium: { preset: 'high', resolutionScale: 0.5 },
  high: { preset: 'high', resolutionScale: 1 },
  ultra: { preset: 'ultra', resolutionScale: 1 },
};

// Puts the clouds over the scene. Anything solid above the deck can never have deck cloud in front
// of it (the camera stays above the deck), so it is left untouched; and next to those silhouettes
// the coarse cloud samples that partly saw the island are swapped for the fullest cloud nearby, so
// no jagged fringe shows along island rims and bridges.
//
// Then the drifting clouds: a handful of soft volumes that float around the islands, marched here
// at full resolution from the same cloud-shape texture as the deck, lit by the scene's sun or moon.
const PUFF_COUNT = 12;
const COMPOSITE = /* glsl */ `
uniform sampler2D cloudsTex;
uniform mediump sampler3D shapeTex;
uniform mediump sampler3D detailTex;
uniform mat4 invProj;
uniform mat4 camWorld;
uniform float deckTop;
uniform vec4 puffs[PUFF_COUNT];
uniform vec2 puffTurn[PUFF_COUNT];
uniform vec3 sunDir;
uniform vec3 sunCol;
uniform vec3 ambTop;
uniform vec3 ambBot;
uniform vec3 hazeCol;
uniform vec2 hazeRange;
uniform float drift;
uniform float puffSteps;

bool aboveDeck(const in vec2 uv, const in float d) {
  if (d >= 0.9999999) return false;
  vec4 v = invProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return (camWorld * vec4(v.xyz / v.w, 1.0)).y > deckTop;
}

vec3 deckClouds(const in vec3 inputColor, const in vec2 uv, const in float depth) {
  if (aboveDeck(uv, depth)) return inputColor;
  vec2 size = vec2(textureSize(cloudsTex, 0));
  vec4 c = texture(cloudsTex, uv);
  // The clouds are marched at a quarter of this resolution, so a bad sample spreads about 4 texels.
  vec2 o = 5.0 / size;
  // Only open sky (where the clouds are the backdrop) gets patched; rock below the deck keeps its own sample.
  bool edge = depth >= 0.9999999 && (aboveDeck(uv + vec2(o.x, 0.0), readDepth(uv + vec2(o.x, 0.0))) ||
    aboveDeck(uv - vec2(o.x, 0.0), readDepth(uv - vec2(o.x, 0.0))) ||
    aboveDeck(uv + vec2(0.0, o.y), readDepth(uv + vec2(0.0, o.y))) ||
    aboveDeck(uv - vec2(0.0, o.y), readDepth(uv - vec2(0.0, o.y))));
  if (edge) {
    // Average the fullest samples around, which smooths out any single odd one.
    ivec2 p = ivec2(uv * size);
    ivec2 hi = ivec2(size) - 1;
    float top = c.a;
    for (int y = -3; y <= 3; y++) {
      for (int x = -3; x <= 3; x++) top = max(top, texelFetch(cloudsTex, clamp(p + ivec2(x, y) * 2, ivec2(0), hi), 0).a);
    }
    vec4 sum = vec4(0.0);
    for (int y = -3; y <= 3; y++) {
      for (int x = -3; x <= 3; x++) {
        vec4 s = texelFetch(cloudsTex, clamp(p + ivec2(x, y) * 2, ivec2(0), hi), 0);
        sum += s.a >= top - 0.08 ? vec4(s.rgb, 1.0) : vec4(0.0);
      }
    }
    if (sum.a > 0.0) c = vec4(sum.rgb / sum.a, top);
  }
  return inputColor * (1.0 - c.a) + c.rgb;
}

// A puff is a cumulus: a cluster of soft rounded lumps (a big middle, smaller sides, a crown)
// on a flat base, each puff turned its own way, with the cloud-shape noise adding the billows.
vec3 puffRadii(const in vec4 p) { return vec3(1.2, 0.95, 1.2) * p.w; }

const vec4 LUMPS[7] = vec4[7](
  vec4(0.0, 0.05, 0.0, 0.62), vec4(0.58, -0.08, 0.12, 0.44), vec4(-0.55, -0.05, -0.15, 0.47),
  vec4(0.15, 0.42, 0.1, 0.42), vec4(-0.22, 0.36, -0.2, 0.36), vec4(0.28, 0.0, -0.5, 0.38),
  vec4(-0.12, -0.02, 0.52, 0.36)
);

float puffDensity(const in vec3 x, const in vec4 p, const in vec2 turn) {
  vec3 q = (x - p.xyz) / p.w;
  q.xz = vec2(turn.x * q.x - turn.y * q.z, turn.y * q.x + turn.x * q.z);
  float body = 0.0;
  for (int i = 0; i < 7; i++) body = max(body, 1.0 - smoothstep(LUMPS[i].w * 0.05, LUMPS[i].w * 1.2, length(q - LUMPS[i].xyz)));
  body *= smoothstep(-0.5, -0.1, q.y);
  if (body <= 0.0) return 0.0;
  // Noise in the puff's own space, so it keeps its shape as it travels and slowly re-forms.
  vec3 sp = (x - p.xyz) * 0.035 + vec3(p.w * 0.37, drift, p.w * 0.11);
  float n = texture(shapeTex, sp).r * 0.7 + texture(shapeTex, sp * 2.3 + 0.31).r * 0.3;
  // Billows: near the middle most of the noise survives, at the edge only its peaks do.
  float dens = clamp((n - (1.0 - body)) / max(body, 1e-3), 0.0, 1.0);
  // Fine wisps eat into the thin outer parts.
  float detail = texture(detailTex, (x - p.xyz) * 0.11 + vec3(0.0, drift * 2.0, p.w * 0.2)).r;
  return clamp(dens - (1.0 - detail) * 0.6 * (1.0 - dens), 0.0, 1.0) * body;
}

// Ray against a puff's bounding ellipsoid: entry and exit distances, or none.
bool puffSpan(const in vec3 ro, const in vec3 rd, const in vec4 p, out vec2 span) {
  vec3 r = puffRadii(p);
  vec3 o = (ro - p.xyz) / r, d = rd / r;
  float a = dot(d, d), b = dot(o, d), c = dot(o, o) - 1.0;
  float h = b * b - a * c;
  if (h <= 0.0) return false;
  h = sqrt(h);
  span = vec2(-b - h, -b + h) / a;
  return span.y > 0.0;
}

vec4 marchPuff(const in vec3 ro, const in vec3 rd, const in vec4 p, const in vec2 turn, const in vec2 span, const in float sceneT) {
  float t0 = max(span.x, 0.0), t1 = min(span.y, sceneT);
  if (t1 <= t0) return vec4(0.0);
  float ds = (t1 - t0) / puffSteps;
  float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float mu = dot(rd, sunDir);
  float phase = 0.55 + 0.9 * pow(max(mu, 0.0), 6.0) + 0.15 * (1.0 - mu);
  vec3 col = vec3(0.0);
  float T = 1.0;
  float lightStep = p.w * 0.22;
  for (int i = 0; i < 20; i++) {
    if (float(i) >= puffSteps) break;
    vec3 x = ro + rd * (t0 + (float(i) + jit) * ds);
    float dens = puffDensity(x, p, turn);
    if (dens < 0.01) continue;
    // Light reaching this point: how much cloud lies between it and the sun or moon.
    float od = 0.0;
    for (int k = 1; k <= 3; k++) od += puffDensity(x + sunDir * lightStep * float(k), p, turn);
    float powder = 1.0 - exp(-dens * 4.0);
    float light = exp(-od * lightStep * 0.1) * mix(1.0, powder, 0.3);
    float h = clamp((x.y - p.y) / puffRadii(p).y * 0.5 + 0.5, 0.0, 1.0);
    vec3 S = sunCol * light * phase + mix(ambBot, ambTop, h);
    float a = 1.0 - exp(-dens * 0.13 * ds);
    col += T * a * S;
    T *= 1.0 - a;
    if (T < 0.02) break;
  }
  float haze = smoothstep(hazeRange.x, hazeRange.y, t0);
  col = mix(col, hazeCol * (1.0 - T), haze);
  return vec4(col, 1.0 - T);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  outputColor = inputColor;
  vec3 col = deckClouds(inputColor.rgb, uv, depth);

  vec4 v = invProj * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec3 view = v.xyz / v.w;
  vec3 ro = camWorld[3].xyz;
  vec3 rd = normalize(mat3(camWorld) * view);
  float sceneT = depth >= 0.9999999 ? 1e9 : length(view);
  // Composite the two nearest puffs on this ray, the far one first.
  vec2 nearSpan = vec2(1e9), farSpan = vec2(1e9);
  int nearI = -1, farI = -1;
  for (int i = 0; i < PUFF_COUNT; i++) {
    vec2 sp;
    if (!puffSpan(ro, rd, puffs[i], sp) || sp.x > sceneT) continue;
    if (sp.x < nearSpan.x) { farSpan = nearSpan; farI = nearI; nearSpan = sp; nearI = i; }
    else if (sp.x < farSpan.x) { farSpan = sp; farI = i; }
  }
  if (farI >= 0) {
    vec4 c = marchPuff(ro, rd, puffs[farI], puffTurn[farI], farSpan, sceneT);
    col = col * (1.0 - c.a) + c.rgb;
  }
  if (nearI >= 0) {
    vec4 c = marchPuff(ro, rd, puffs[nearI], puffTurn[nearI], nearSpan, sceneT);
    col = col * (1.0 - c.a) + c.rgb;
  }
  // A single bad value would be smeared across the screen by the bloom, so never let one through.
  if (!any(isnan(col)) && !any(isinf(col))) outputColor.rgb = col;
}`;

const WHITE = new THREE.Color(1, 1, 1);
// What lights the clouds: the sun by day, the moon by night, and through twilight a blend that
// swings from one to the other. t is 0 for full sun, 1 for full moon; the light never drops out.
// The light never comes in lower than MIN_UP: a grazing sun stretches the deck's shadow map into long
// streaks across it. The warmth of a lower sun is put back by sunTint.
const MIN_UP = 0.17;
const _light = new THREE.Vector3();
function cloudLight(env, sky) {
  const t = THREE.MathUtils.smoothstep(-env.sunElev, -0.07, 0.04);
  const sun = sky.uniforms.uSunDir.value;
  _light.set(sun.x, Math.max(sun.y, MIN_UP), sun.z).normalize().lerp(sky.moonLight, t);
  // Sun and moon can sit almost opposite each other: never let the blend shrink to nothing.
  if (_light.lengthSq() < 0.04) _light.copy(t < 0.5 ? sun : sky.moonLight).setY(Math.max(_light.y, 0.2));
  _light.normalize();
  return { dir: _light, t };
}

// Moonlight on the drifting clouds, at full night.
const MOON_LIGHT = new THREE.Color(0.62 * 0.22, 0.5 * 0.22, 0.22);

// How fast the cloud deck drifts past the islands, metres per second (world x, z).
const DRIFT = new THREE.Vector2(0.55, 0.4);
// Brightness of direct sunlight on the drifting clouds, matched by eye to the deck.
const SUN_GAIN = 2.1;
// Optical depth of the air above the islands, per airmass (red, green, blue): Rayleigh plus a little haze.
const SKY_EXT = [0.07, 0.13, 0.3];
// Relative air mass for the sun at height y (sine of its elevation), Kasten and Young.
function airmass(y) {
  const elev = Math.max(Math.asin(Math.min(1, Math.max(y, 0.035))) * (180 / Math.PI), -2);
  return 1 / (Math.max(y, 0.035) + 0.15 * Math.pow(elev + 3.885, -1.253));
}

// Where each drifting cloud goes: wide loops around the whole archipelago, some each way, far
// enough out to clear every island's outline.
function puffPaths() {
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const range = (a, b) => a + rnd() * (b - a);
  const paths = [];
  for (let i = 0; i < PUFF_COUNT; i++) {
    const size = range(16, 32);
    paths.push({ r: 330 + size * 2 + range(0, 80), a0: (i / PUFF_COUNT) * Math.PI * 2 + range(-0.2, 0.2), w: range(0.012, 0.02) * (i % 3 ? 1 : -1), y: range(-14, 30), size, phase: rnd() * 10 });
  }
  return paths;
}

class CloudComposite extends Effect {
  constructor(camera, clouds, deckTop, shape, detail) {
    super('CloudComposite', COMPOSITE, {
      attributes: EffectAttribute.DEPTH,
      defines: new Map([['PUFF_COUNT', String(PUFF_COUNT)]]),
      uniforms: new Map([
        ['cloudsTex', new THREE.Uniform(null)],
        ['shapeTex', new THREE.Uniform(shape)],
        ['detailTex', new THREE.Uniform(detail)],
        ['invProj', new THREE.Uniform(new THREE.Matrix4())],
        ['camWorld', new THREE.Uniform(new THREE.Matrix4())],
        ['deckTop', new THREE.Uniform(deckTop)],
        ['puffs', new THREE.Uniform(Array.from({ length: PUFF_COUNT }, () => new THREE.Vector4()))],
        ['puffTurn', new THREE.Uniform(Array.from({ length: PUFF_COUNT }, () => new THREE.Vector2(1, 0)))],
        ['sunDir', new THREE.Uniform(new THREE.Vector3(0, 1, 0))],
        ['sunCol', new THREE.Uniform(new THREE.Color())],
        ['ambTop', new THREE.Uniform(new THREE.Color())],
        ['ambBot', new THREE.Uniform(new THREE.Color())],
        ['hazeCol', new THREE.Uniform(new THREE.Color())],
        ['hazeRange', new THREE.Uniform(new THREE.Vector2(600, 3000))],
        ['drift', new THREE.Uniform(0)],
        ['puffSteps', new THREE.Uniform(20)],
      ]),
    });
    this.view = camera;
    this.clouds = clouds;
    this.paths = puffPaths();
  }

  update() {
    this.uniforms.get('cloudsTex').value = this.clouds.uniforms.get('cloudsBuffer').value;
    this.uniforms.get('invProj').value.copy(this.view.projectionMatrixInverse);
    this.uniforms.get('camWorld').value.copy(this.view.matrixWorld);
  }

  // Positions and light, once per frame.
  setEnv(env, sky, t) {
    const u = this.uniforms;
    u.get('puffs').value.forEach((v, i) => {
      const p = this.paths[i];
      const turn = p.phase + t * 0.002;
      u.get('puffTurn').value[i].set(Math.cos(turn), Math.sin(turn));
      // Drift round the world and bob gently. Their shapes change far too slowly to see.
      const a = p.a0 + t * p.w;
      const bob = Math.sin(t * 0.12 + p.phase) * 2.5;
      const r = p.r + Math.sin(t * 0.03 + p.phase) * 12;
      v.set(Math.cos(a) * r, p.y + bob, Math.sin(a) * r, p.size * (1 + Math.sin(t * 0.01 + p.phase * 2) * 0.03));
    });
    // Lit like the deck: sunlight that turns golden as it crosses more air near the horizon,
    // or the dim lilac moon at night, plus a soft sky glow from above and the deck below.
    const su = sky.uniforms;
    const light = cloudLight(env, sky);
    u.get('sunDir').value.copy(light.dir);
    const col = u.get('sunCol').value;
    const sun = su.uSunDir.value;
    const am = airmass(sun.y);
    col.setRGB(Math.exp(-SKY_EXT[0] * am), Math.exp(-SKY_EXT[1] * am), Math.exp(-SKY_EXT[2] * am)).multiplyScalar(SUN_GAIN);
    col.lerp(MOON_LIGHT.clone().multiplyScalar(Math.max(env.night, 0.5)), light.t);
    const day = 1 - env.night;
    u.get('ambTop').value.copy(su.uTop.value).lerp(WHITE, 0.55).multiplyScalar(0.42 * day + 0.06);
    u.get('ambBot').value.copy(su.uHorizon.value).lerp(WHITE, 0.3).multiplyScalar(0.3 * day + 0.04);
    u.get('hazeCol').value.copy(sky.fog.color);
    u.get('hazeRange').value.set(sky.fog.near, sky.fog.far);
    u.get('drift').value = t * 0.002;
  }
}

// The library's cube-sphere mapping from a point on the globe to weather-map coordinates.
function cubeSphereUv(p) {
  const n = p.clone().normalize();
  const f = [Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)];
  const mx = Math.max(...f);
  let m;
  if (f[1] > f[0] && f[1] > f[2]) m = n.y / mx > 0 ? [-n.x, n.z] : [n.x, n.z];
  else if (f[0] > f[1] && f[0] > f[2]) m = n.x / mx > 0 ? [n.y, n.z] : [-n.y, n.z];
  else m = n.z / mx > 0 ? [n.x, n.y] : [n.x, -n.y];
  const m2 = [m[0] * m[0], m[1] * m[1]];
  const q = -2 * m2[0] + 2 * m2[1] - 3;
  const ux = Math.sqrt(1.5 + m2[0] - m2[1] - 0.5 * Math.sqrt(-24 * m2[0] + q * q)) * (m[0] > 0 ? 1 : -1);
  const uy = Math.sqrt(6 / (3 - ux * ux)) * m[1];
  return new THREE.Vector2(ux * 0.5 + 0.5, uy * 0.5 + 0.5);
}

// Our own blue noise (generated offline, void and cluster), stacked into 64 frames with golden-ratio
// shifts: blue in space, evenly spread over time. It jitters the cloud ray march. Used instead of the
// library's noise texture, which is fetched from GitHub at load and sometimes fails, leaving no clouds.
async function ownBlueNoise() {
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = `${ASSETS}bluenoise128.png`;
  });
  const S = 128, FRAMES = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, S, S).data;
  const data = new Uint8Array(S * S * FRAMES);
  for (let z = 0; z < FRAMES; z++) {
    const shift = Math.floor(((z * 0.6180339887) % 1) * 256);
    for (let i = 0; i < S * S; i++) data[z * S * S + i] = (px[i * 4] + shift) & 255;
  }
  const t = new THREE.Data3DTexture(data, S, S, FRAMES);
  t.format = THREE.RedFormat;
  t.type = THREE.UnsignedByteType;
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

function loadTexture(url) {
  return new Promise((resolve, reject) =>
    new THREE.TextureLoader().load(
      url,
      (t) => {
        t.minFilter = THREE.LinearMipMapLinearFilter;
        t.magFilter = THREE.LinearFilter;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.colorSpace = THREE.NoColorSpace;
        t.needsUpdate = true;
        resolve(t);
      },
      undefined,
      reject,
    ),
  );
}

function load3D(url, size) {
  const loader = new DataTextureLoader(THREE.Data3DTexture, parseUint8Array, {
    width: size, height: size, depth: size,
    format: THREE.RedFormat,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, wrapR: THREE.RepeatWrapping,
    colorSpace: THREE.NoColorSpace,
  });
  return loader.loadAsync(url);
}

export async function createVolumetricClouds(renderer, camera, quality = 'high') {
  const atmosphere = new AtmosphereParameters();
  const clouds = new CloudsEffect(camera, {}, atmosphere);
  // The library's own composite is replaced by CloudComposite.
  clouds.skipRendering = true;

  const [localWeather, shape, shapeDetail, turbulence, stbn] = await Promise.all([
    loadTexture(`${ASSETS}local_weather.png`),
    load3D(`${ASSETS}shape.bin`, CLOUD_SHAPE_TEXTURE_SIZE),
    load3D(`${ASSETS}shape_detail.bin`, CLOUD_SHAPE_DETAIL_TEXTURE_SIZE),
    loadTexture(`${ASSETS}turbulence.png`),
    ownBlueNoise(),
  ]);
  Object.assign(clouds, { localWeatherTexture: localWeather, shapeTexture: shape, shapeDetailTexture: shapeDetail, turbulenceTexture: turbulence, stbnTexture: stbn });

  const generator = new PrecomputedTexturesGenerator(renderer);
  await generator.update();
  Object.assign(clouds, generator.textures);

  // Pin the world origin above a point on the globe: X north, Y up, Z east.
  const origin = new Geodetic(radians(139.7), radians(35.7), ALTITUDE).toECEF();
  Ellipsoid.WGS84.getNorthUpEastFrame(origin, clouds.worldToECEFMatrix);
  const toECEF = new THREE.Matrix3().setFromMatrix4(clouds.worldToECEFMatrix);

  // An upper deck just under the islands, broken into separate heaps with clear air between
  // them (the rocky undersides sink into it; its shadow maps shade the clouds themselves), and a
  // second layer far below that shows through the gaps and gives the sea its depth.
  const deck = clouds.cloudLayers[0];
  // Squat (220 m) with rounded tops, so from above it reads as billowing heaps. A taller deck with
  // flatter tops showed tall columns with shaded sides, like hanging curtains.
  Object.assign(deck, { altitude: ALTITUDE - 250, height: 220, densityScale: 0.2, shapeAmount: 1, shapeDetailAmount: 1, weatherExponent: 1, shapeAlteringBias: 0.6, coverageFilterWidth: 0.6, shadow: true });
  for (let i = 1; i < clouds.cloudLayers.length; i++) clouds.cloudLayers[i].height = 0;
  Object.assign(clouds.cloudLayers[1], { altitude: ALTITUDE - 1300, height: 600, densityScale: 0.2, shapeDetailAmount: 0, shadow: false });
  clouds.coverage = 0.5;
  // Small weather cells, so the deck splits into heaps a few island-widths across.
  clouds.localWeatherRepeat.setScalar(1500);
  // Our islands are small next to real clouds, so the cloud shapes are scaled down to match.
  clouds.shapeRepeat.setScalar(0.0008);
  clouds.shapeDetailRepeat.setScalar(0.012);
  atmosphere.sunRadianceToRelativeLuminance.multiplyScalar(EXPOSURE);
  atmosphere.skyRadianceToRelativeLuminance.multiplyScalar(EXPOSURE);
  // The deck drifts slowly as one piece. The library would slide the weather map under fixed cloud
  // shapes (and stir the shapes up and down as it goes), which makes heaps visibly thin out and swell
  // while you watch. Instead the weather map, the shapes and their detail all move together.
  clouds.localWeatherVelocity.set(0, 0);
  const originECEF = new THREE.Vector3().setFromMatrixPosition(clouds.worldToECEFMatrix);
  const up = originECEF.clone().normalize();
  const uv0 = cubeSphereUv(originECEF);
  // Weather-map coordinates per metre north (world x) and east (world z).
  const perX = cubeSphereUv(originECEF.clone().add(new THREE.Vector3(1, 0, 0).applyMatrix3(toECEF))).sub(uv0);
  const perZ = cubeSphereUv(originECEF.clone().add(new THREE.Vector3(0, 0, 1).applyMatrix3(toECEF))).sub(uv0);
  const driftECEF = new THREE.Vector3();
  const setDrift = (t) => {
    const dx = DRIFT.x * t, dz = DRIFT.y * t;
    const w = clouds.localWeatherOffset;
    w.set(-(perX.x * dx + perZ.x * dz), -(perX.y * dx + perZ.y * dz)).multiply(clouds.localWeatherRepeat);
    driftECEF.set(dx, 0, dz).applyMatrix3(toECEF);
    // Cancel the library's height shift tied to how far the weather map has moved.
    const lift = w.length() * 2e4;
    clouds.shapeOffset.copy(driftECEF).negate().addScaledVector(up, lift).multiply(clouds.shapeRepeat);
    clouds.shapeDetailOffset.copy(driftECEF).negate().multiply(clouds.shapeDetailRepeat);
  };

  const sunIrradiance = atmosphere.solarIrradiance.clone();
  const sunLum = atmosphere.sunRadianceToRelativeLuminance.clone();
  const skyLum = atmosphere.skyRadianceToRelativeLuminance.clone();
  const moonTint = new THREE.Vector3(0.62, 0.5, 1.0);
  const tint = new THREE.Vector3();
  const warmth = new THREE.Vector3();
  const dir = new THREE.Vector3();

  const composite = new CloudComposite(camera, clouds, deck.altitude + deck.height - ALTITUDE + 2, shape, shapeDetail);

  return {
    effects: [clouds, composite],
    setQuality(q) {
      const p = PRESETS[q] ?? PRESETS.high;
      clouds.qualityPreset = p.preset;
      composite.uniforms.get('puffSteps').value = { low: 10, medium: 14 }[q] ?? 20;
      clouds.resolutionScale = p.resolutionScale;
      clouds.lightShafts = false;
      const c = clouds.clouds, s = clouds.shadow;
      c.minStepSize *= STEP;
      c.maxStepSize *= STEP;
      c.minSecondaryStepSize *= STEP;
      c.minShadowLengthStepSize *= STEP;
      c.maxRayDistance = 6000;
      c.maxShadowLengthRayDistance = 6000;
      s.minStepSize *= STEP;
      s.maxStepSize *= STEP;
      // One shadow cascade covers our view distance; three cost a lot and look the same here.
      s.cascadeCount = 1;
      // The clouds are drawn a sixteenth at a time and built up over frames. Under a quick swipe the
      // library threw that history away too eagerly, and the deck thinned to see-through for a moment.
      // A looser check keeps it whole; any ghosting is hard to see on clouds.
      clouds.cloudsPass.resolveMaterial.uniforms.varianceGamma.value = 5;
    },
    update(env, sky, t) {
      composite.setEnv(env, sky, t);
      setDrift(t);
      // By day the sun lights the clouds; at night a dim lilac moon takes its place, which is the
      // same light far dimmer (sky glow included) and tinted lilac. Twilight blends the two.
      const light = cloudLight(env, sky);
      dir.copy(light.dir).applyMatrix3(toECEF).normalize();
      clouds.sunDirection.copy(dir);
      const k = THREE.MathUtils.lerp(1, 0.1, light.t);
      atmosphere.sunRadianceToRelativeLuminance.copy(sunLum).multiplyScalar(k);
      atmosphere.skyRadianceToRelativeLuminance.copy(skyLum).multiplyScalar(k);
      // The extra air a sun below MIN_UP shines through: redder and dimmer, as at a real sunrise.
      const sunY = sky.uniforms.uSunDir.value.y;
      const extra = sunY < MIN_UP ? airmass(sunY) - airmass(MIN_UP) : 0;
      warmth.set(Math.exp(-SKY_EXT[0] * extra), Math.exp(-SKY_EXT[1] * extra), Math.exp(-SKY_EXT[2] * extra));
      atmosphere.solarIrradiance.copy(sunIrradiance).multiply(tint.copy(warmth).lerp(moonTint, light.t));
    },
  };
}
