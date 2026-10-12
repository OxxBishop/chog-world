import * as THREE from 'three';
import { Effect, EffectAttribute } from 'postprocessing';
import { CloudsEffect, CLOUD_SHAPE_TEXTURE_SIZE, CLOUD_SHAPE_DETAIL_TEXTURE_SIZE } from '@takram/three-clouds';
import { AtmosphereParameters, PrecomputedTexturesGenerator } from '@takram/three-atmosphere';
import { Ellipsoid, Geodetic, radians, DataTextureLoader, parseUint8Array, STBNLoader, DEFAULT_STBN_URL } from '@takram/three-geospatial';
import { HOODS } from './layout.js';

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
  for (int i = 0; i < 7; i++) body = max(body, 1.0 - smoothstep(LUMPS[i].w * 0.3, LUMPS[i].w, length(q - LUMPS[i].xyz)));
  body *= smoothstep(-0.42, -0.2, q.y);
  if (body <= 0.0) return 0.0;
  vec3 sp = x * 0.035 + vec3(drift, 0.0, drift * 0.4);
  float n = texture(shapeTex, sp).r * 0.7 + texture(shapeTex, sp * 2.3 + 0.31).r * 0.3;
  // Billows: near the middle most of the noise survives, at the edge only its peaks do.
  float dens = clamp((n - (1.0 - body)) / max(body, 1e-3), 0.0, 1.0);
  // Fine wisps eat into the thin outer parts.
  float detail = texture(detailTex, x * 0.11 + drift * 3.0).r;
  return clamp(dens - (1.0 - detail) * 0.45 * (1.0 - dens), 0.0, 1.0);
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
    float light = exp(-od * lightStep * 0.22) * mix(1.0, powder, 0.5);
    float h = clamp((x.y - p.y) / puffRadii(p).y * 0.5 + 0.5, 0.0, 1.0);
    vec3 S = sunCol * light * phase + mix(ambBot, ambTop, h);
    float a = 1.0 - exp(-dens * 0.4 * ds);
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
// Brightness of direct sunlight on the drifting clouds, matched by eye to the deck.
const SUN_GAIN = 2.1;
// Optical depth of the air above the islands, per airmass (red, green, blue): Rayleigh plus a little haze.
const SKY_EXT = [0.07, 0.13, 0.3];

// Where each drifting cloud goes: slow loops around the outside of the archipelago, and slow
// swings in and out along the three gaps between the neighbourhoods. All paths stay clear of the
// islands and bridges.
function puffPaths() {
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const range = (a, b) => a + rnd() * (b - a);
  const paths = [];
  for (let i = 0; i < 7; i++) {
    paths.push({ kind: 'orbit', r: range(360, 460), a0: (i / 7) * Math.PI * 2 + range(-0.3, 0.3), w: range(0.004, 0.008) * (i % 2 ? 1 : -1), y: range(-12, 30), size: range(20, 32), phase: rnd() * 10 });
  }
  // Halfway between neighbouring bridges, where no island is.
  const a = HOODS.map((h) => h.angle).sort((p, q) => p - q);
  const gaps = a.map((v, i) => (i === a.length - 1 ? (v + a[0] + Math.PI * 2) / 2 : (v + a[i + 1]) / 2));
  for (let i = 0; i < PUFF_COUNT - 7; i++) {
    paths.push({ kind: 'gap', a: gaps[i % 3] + range(-0.08, 0.08), r0: 165, r1: 270, w: range(0.02, 0.035), y: range(-10, 22), size: range(16, 24), phase: rnd() * 10 });
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
      const turn = p.phase + t * 0.01;
      u.get('puffTurn').value[i].set(Math.cos(turn), Math.sin(turn));
      const bob = Math.sin(t * 0.2 + p.phase) * 2;
      if (p.kind === 'orbit') {
        const a = p.a0 + t * p.w;
        v.set(Math.cos(a) * p.r, p.y + bob, Math.sin(a) * p.r, p.size);
      } else {
        const r = p.r0 + (p.r1 - p.r0) * (0.5 + 0.5 * Math.sin(t * p.w + p.phase));
        v.set(Math.cos(p.a) * r, p.y + bob, Math.sin(p.a) * r, p.size);
      }
    });
    // Lit like the deck: sunlight that turns golden as it crosses more air near the horizon,
    // or the dim lilac moon at night, plus a soft sky glow from above and the deck below.
    const su = sky.uniforms;
    const useSun = env.sunElev > -0.04;
    const dir = u.get('sunDir').value.copy(useSun ? su.uSunDir.value : su.uMoonDir.value);
    const col = u.get('sunCol').value;
    if (useSun) {
      const elev = Math.max(Math.asin(Math.min(1, dir.y)) * (180 / Math.PI), -2);
      const airmass = 1 / (Math.max(dir.y, 0) + 0.15 * Math.pow(elev + 3.885, -1.253));
      const k = SUN_GAIN * THREE.MathUtils.smoothstep(dir.y, -0.04, 0.1);
      col.setRGB(Math.exp(-SKY_EXT[0] * airmass) * k, Math.exp(-SKY_EXT[1] * airmass) * k, Math.exp(-SKY_EXT[2] * airmass) * k);
    } else {
      col.setRGB(0.62, 0.5, 1.0).multiplyScalar(0.22 * env.night);
    }
    const day = 1 - env.night;
    u.get('ambTop').value.copy(su.uTop.value).lerp(WHITE, 0.55).multiplyScalar(0.42 * day + 0.06);
    u.get('ambBot').value.copy(su.uHorizon.value).lerp(WHITE, 0.3).multiplyScalar(0.3 * day + 0.04);
    u.get('hazeCol').value.copy(sky.fog.color);
    u.get('hazeRange').value.set(sky.fog.near, sky.fog.far);
    u.get('drift').value = t * 0.004;
  }
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
    new STBNLoader().loadAsync(DEFAULT_STBN_URL),
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
  Object.assign(deck, { altitude: ALTITUDE - 370, height: 340, densityScale: 0.2, shapeAmount: 1, shapeDetailAmount: 1, weatherExponent: 1, shapeAlteringBias: 0.35, coverageFilterWidth: 0.6, shadow: true });
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
  clouds.localWeatherVelocity.set(0.0004, 0.0001);

  const sunIrradiance = atmosphere.solarIrradiance.clone();
  const sunLum = atmosphere.sunRadianceToRelativeLuminance.clone();
  const skyLum = atmosphere.skyRadianceToRelativeLuminance.clone();
  const moonTint = new THREE.Vector3(0.62, 0.5, 1.0);
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
    },
    update(env, sky, t) {
      composite.setEnv(env, sky, t);
      const su = sky.uniforms;
      // By day the sun lights the clouds; at night a dim lilac moon takes its place.
      const useSun = env.sunElev > -0.04;
      dir.copy(useSun ? su.uSunDir.value : su.uMoonDir.value).applyMatrix3(toECEF).normalize();
      clouds.sunDirection.copy(dir);
      // Moonlight is the same light, far dimmer (sky glow included) and tinted lilac.
      const k = useSun ? 1 : 0.1;
      atmosphere.sunRadianceToRelativeLuminance.copy(sunLum).multiplyScalar(k);
      atmosphere.skyRadianceToRelativeLuminance.copy(skyLum).multiplyScalar(k);
      atmosphere.solarIrradiance.copy(sunIrradiance);
      if (!useSun) atmosphere.solarIrradiance.multiply(moonTint);
    },
  };
}
