import * as THREE from 'three';
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

// Cloud quality per site quality setting.
const PRESETS = {
  low: { preset: 'low', resolutionScale: 0.75 },
  medium: { preset: 'medium', resolutionScale: 1 },
  high: { preset: 'high', resolutionScale: 1 },
  ultra: { preset: 'ultra', resolutionScale: 1 },
};

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
  clouds.skipRendering = false;

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

  // One dense deck just under the islands; the rocky undersides sink into it.
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

  return {
    effect: clouds,
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
