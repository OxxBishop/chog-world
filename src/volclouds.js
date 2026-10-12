import * as THREE from 'three';
import { Effect, EffectAttribute } from 'postprocessing';
import { CloudsEffect, CLOUD_SHAPE_TEXTURE_SIZE, CLOUD_SHAPE_DETAIL_TEXTURE_SIZE } from '@takram/three-clouds';
import { AtmosphereParameters, PrecomputedTexturesGenerator } from '@takram/three-atmosphere';
import { Ellipsoid, Geodetic, radians, DataTextureLoader, parseUint8Array, STBNLoader, DEFAULT_STBN_URL } from '@takram/three-geospatial';

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

// Puts the clouds over the scene. Anything solid above the deck can never have cloud in front of
// it (the camera stays above the deck), so it is left untouched; and next to those silhouettes the
// coarse cloud samples that partly saw the island are swapped for the fullest cloud nearby, so no
// jagged fringe shows along island rims and bridges.
const COMPOSITE = /* glsl */ `
uniform sampler2D cloudsTex;
uniform mat4 invProj;
uniform mat4 camWorld;
uniform float deckTop;

bool aboveDeck(const in vec2 uv, const in float d) {
  if (d >= 0.9999999) return false;
  vec4 v = invProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return (camWorld * vec4(v.xyz / v.w, 1.0)).y > deckTop;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  outputColor = inputColor;
  if (aboveDeck(uv, depth)) return;
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
  vec3 col = inputColor.rgb * (1.0 - c.a) + c.rgb;
  // A single bad value would be smeared across the screen by the bloom, so never let one through.
  if (!any(isnan(col)) && !any(isinf(col))) outputColor.rgb = col;
}`;

class CloudComposite extends Effect {
  constructor(camera, clouds, deckTop) {
    super('CloudComposite', COMPOSITE, {
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map([
        ['cloudsTex', new THREE.Uniform(null)],
        ['invProj', new THREE.Uniform(new THREE.Matrix4())],
        ['camWorld', new THREE.Uniform(new THREE.Matrix4())],
        ['deckTop', new THREE.Uniform(deckTop)],
      ]),
    });
    this.view = camera;
    this.clouds = clouds;
  }

  update() {
    this.uniforms.get('cloudsTex').value = this.clouds.uniforms.get('cloudsBuffer').value;
    this.uniforms.get('invProj').value.copy(this.view.projectionMatrixInverse);
    this.uniforms.get('camWorld').value.copy(this.view.matrixWorld);
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

  // One dense deck just under the islands; the rocky undersides sink into it. Its shadow maps
  // shade the clouds themselves (the blue-grey shadows between the tops at sunset).
  const deck = clouds.cloudLayers[0];
  Object.assign(deck, { altitude: ALTITUDE - 360, height: 340, densityScale: 0.3, shapeAmount: 1, shapeDetailAmount: 1, weatherExponent: 1, shapeAlteringBias: 0.35, coverageFilterWidth: 0.6, shadow: true });
  for (let i = 1; i < clouds.cloudLayers.length; i++) clouds.cloudLayers[i].height = 0;
  clouds.coverage = 0.72;
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

  const composite = new CloudComposite(camera, clouds, deck.altitude + deck.height - ALTITUDE + 2);

  return {
    effects: [clouds, composite],
    setQuality(q) {
      const p = PRESETS[q] ?? PRESETS.high;
      clouds.qualityPreset = p.preset;
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
    update(env, sky) {
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
