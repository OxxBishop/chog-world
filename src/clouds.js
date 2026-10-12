import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshoptSimplifier } from 'meshoptimizer';
import { WORLD, ISLANDS, BRIDGES } from './layout.js';

/*
 * The sea of clouds the islands float on.
 *
 * - A rolling, lit cloud surface just under the island rims; the rocky undersides sink into it.
 * - Cumulus banks (S. Paul Michael, CC-BY, via Poly Pizza) heaped around each island's base and
 *   scattered across the sea, so the surface has real 3D billows.
 * - A few small puffs (hat_my_guy, CC0, via Poly Pizza) drifting between the islands.
 */

const BANK_FILES = ['cumulus_3', 'cumulus_5', 'cumulus_6'];
const PUFF_FILE = 'puffs';
const WHITE = new THREE.Color(1, 1, 1);
const NIGHT_GLOW = new THREE.Color(0.32 * 0.3, 0.14 * 0.3, 0.58 * 0.3);

// Merge a model's many parts into one geometry: base on y = 0, centred, 1 unit wide, trimmed down.
function prepare(scene, ratio) {
  scene.updateMatrixWorld(true);
  const parts = [];
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
    g.applyMatrix4(o.matrixWorld);
    parts.push(g);
  });
  let geo = mergeGeometries(parts);
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const width = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z);
  geo.translate(-(bb.max.x + bb.min.x) / 2, -bb.min.y, -(bb.max.z + bb.min.z) / 2);
  geo.scale(1 / width, 1 / width, 1 / width);
  // Weld the flat-shaded parts, shade them smooth so they read as soft puffs, then trim triangles.
  geo = mergeVertices(geo, 1e-4);
  geo.computeVertexNormals();
  const idx = new Uint32Array(geo.index.array);
  const [out] = MeshoptSimplifier.simplify(idx, new Float32Array(geo.attributes.position.array), 3, Math.floor((idx.length * ratio) / 3) * 3, 0.02, []);
  geo.setIndex(new THREE.BufferAttribute(out, 1));
  geo.computeBoundingSphere();
  return geo;
}

export async function loadClouds() {
  await MeshoptSimplifier.ready;
  const loader = new GLTFLoader();
  const base = `${import.meta.env.BASE_URL}assets/clouds/`;
  const banks = await Promise.all(BANK_FILES.map(async (f) => prepare((await loader.loadAsync(`${base}${f}.glb`)).scene, 0.3)));
  const puff = prepare((await loader.loadAsync(`${base}${PUFF_FILE}.glb`)).scene, 0.8);
  return { banks, puff };
}

// Soft cloud shading shared by the banks and puffs: wrapped light, darker bellies, a bright rim.
function cloudMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms,
    fog: true,
    vertexShader: /* glsl */ `
varying vec3 vNormalW;
varying vec3 vWorld;
#include <fog_pars_vertex>
void main() {
  mat4 m = modelMatrix;
#ifdef USE_INSTANCING
  m = modelMatrix * instanceMatrix;
#endif
  vec4 wp = m * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormalW = normalize(mat3(m) * normal);
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`,
    fragmentShader: /* glsl */ `
uniform vec3 uLit, uShade, uRim, uLightDir;
varying vec3 vNormalW;
varying vec3 vWorld;
#include <fog_pars_fragment>
void main() {
  vec3 n = normalize(vNormalW);
  float wrap = clamp((dot(n, uLightDir) + 0.7) / 1.7, 0.0, 1.0);
  vec3 col = mix(uShade, uLit, smoothstep(0.05, 0.95, wrap));
  col *= mix(0.86, 1.0, smoothstep(-0.4, 0.5, n.y));
  vec3 v = normalize(cameraPosition - vWorld);
  col += uRim * pow(1.0 - max(dot(n, v), 0.0), 3.0) * 0.45;
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
  #include <colorspace_fragment>
}`,
  });
}

// The rolling cloud surface. Heights come from the shared noise texture, sampled in world space,
// so the surface stays put while its grid follows the camera.
const seaVert = /* glsl */ `
uniform sampler2D uNoise;
uniform float uTime, uTop, uAmp;
varying vec3 vWorld;
varying vec3 vNormalW;
float billow(vec2 p) {
  vec2 q = p / 1100.0 + vec2(uTime * 0.0006, uTime * 0.00025);
  float a = smoothstep(0.32, 0.82, texture2D(uNoise, q).r);
  float b = smoothstep(0.35, 0.85, texture2D(uNoise, q * 2.6 + 0.31).g);
  float c = texture2D(uNoise, q * 7.3 + 0.67).b;
  return a * 0.62 + b * 0.28 + c * 0.1;
}
float heightAt(vec2 p) { return uTop + (billow(p) - 0.5) * uAmp; }
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float e = 6.0;
  float h = heightAt(wp.xz);
  float hx = heightAt(wp.xz + vec2(e, 0.0));
  float hz = heightAt(wp.xz + vec2(0.0, e));
  wp.y = h;
  vWorld = wp.xyz;
  vNormalW = normalize(vec3(h - hx, e, h - hz));
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const seaFrag = /* glsl */ `
uniform vec3 uLit, uShade, uRim, uLightDir, uHorizon, uGlow, uCamPos;
varying vec3 vWorld;
varying vec3 vNormalW;
void main() {
  vec3 n = normalize(vNormalW);
  float wrap = clamp((dot(n, uLightDir) + 0.7) / 1.7, 0.0, 1.0);
  vec3 col = mix(uShade, uLit, smoothstep(0.05, 0.95, wrap));
  vec3 v = normalize(uCamPos - vWorld);
  col += uRim * pow(1.0 - max(dot(n, v), 0.0), 4.0) * 0.3;
  // Melt into exactly what the sky shows at the horizon, so there is no far edge.
  float d = length(vWorld.xz - uCamPos.xz);
  float h = normalize(vWorld - uCamPos).y;
  vec3 skyCol = uHorizon + uGlow * exp(-abs(h) * 9.0);
  col = mix(col, skyCol, smoothstep(500.0, 1700.0, d));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

export function buildCloudWorld(scene, rng, models, noise) {
  const shared = {
    uLit: { value: new THREE.Color() },
    uShade: { value: new THREE.Color() },
    uRim: { value: new THREE.Color() },
    uLightDir: { value: new THREE.Vector3(0, 1, 0) },
  };

  // Rolling surface.
  const seaUniforms = {
    ...shared,
    uNoise: { value: noise },
    uTime: { value: 0 },
    uTop: { value: WORLD.cloudSeaY },
    uAmp: { value: 34 },
    uHorizon: { value: new THREE.Color() },
    uGlow: { value: new THREE.Color() },
    uCamPos: { value: new THREE.Vector3() },
  };
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(3600, 3600, 160, 160).rotateX(-Math.PI / 2),
    new THREE.ShaderMaterial({ uniforms: seaUniforms, vertexShader: seaVert, fragmentShader: seaFrag }),
  );
  sea.frustumCulled = false;
  scene.add(sea);

  // Cumulus banks.
  const fogUniforms = THREE.UniformsUtils.clone(THREE.UniformsLib.fog);
  const bankMat = cloudMaterial({ ...fogUniforms, ...shared });
  const banks = models.banks.map(() => []);
  const addBank = (x, y, z, width) => {
    const k = Math.floor(rng() * banks.length);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rng() * Math.PI * 2, 0)),
      new THREE.Vector3(width, width * rng.range(0.9, 1.4), width),
    );
    banks[k].push(m);
  };
  // Heaped around each island's base, wrapping the rock.
  for (const isl of ISLANDS) {
    const n = Math.round(isl.r / 6);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng.range(-0.2, 0.2);
      const r = isl.r * rng.range(0.45, 1.15);
      addBank(isl.x + Math.cos(a) * r, WORLD.cloudSeaY + rng.range(-6, 10), isl.z + Math.sin(a) * r, rng.range(40, 85));
    }
  }
  // Under each bridge.
  for (const b of BRIDGES) {
    for (let t = 0.2; t < 0.9; t += 0.3) addBank(b.ax + (b.bx - b.ax) * t, WORLD.cloudSeaY + rng.range(-4, 6), b.az + (b.bz - b.az) * t, rng.range(35, 55));
  }
  // Out across the sea.
  for (let i = 0; i < 50; i++) {
    const a = rng() * Math.PI * 2, r = rng.range(150, 1000);
    addBank(Math.cos(a) * r, WORLD.cloudSeaY + rng.range(-8, 6), Math.sin(a) * r, rng.range(60, 170));
  }
  banks.forEach((list, k) => {
    const im = new THREE.InstancedMesh(models.banks[k], bankMat, list.length);
    list.forEach((m, i) => im.setMatrixAt(i, m));
    im.frustumCulled = false;
    scene.add(im);
  });

  // Small puffs drifting between the islands at their height.
  const clear = (x, z, pad) => ISLANDS.every((isl) => Math.hypot(x - isl.x, z - isl.z) > isl.r + pad);
  const puffs = [];
  for (let tries = 0; tries < 400 && puffs.length < 14; tries++) {
    const a = rng() * Math.PI * 2, r = rng.range(80, 380);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const size = rng.range(12, 26);
    if (!clear(x, z, size + 12)) continue;
    puffs.push({ x, z, y: rng.range(6, 38), size, rot: rng() * Math.PI * 2, speed: rng.range(1.5, 3.5) });
  }
  const puffMesh = new THREE.InstancedMesh(models.puff, cloudMaterial({ ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...shared }), puffs.length);
  puffMesh.frustumCulled = false;
  scene.add(puffMesh);

  const nightLit = new THREE.Color('#5a45a2'), nightShade = new THREE.Color('#23184a');
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const wind = new THREE.Vector2(1, 0.35).normalize();
  return {
    update(env, t, camera, skyU, dt) {
      const night = env.night;
      shared.uLit.value.copy(WHITE).lerp(skyU.uHorizon.value, 0.12).lerp(nightLit, night);
      shared.uShade.value.copy(skyU.uTop.value).lerp(WHITE, 0.4).lerp(nightShade, night);
      shared.uRim.value.copy(skyU.uHorizon.value).lerp(new THREE.Color('#b48cff'), night);
      shared.uLightDir.value.copy(night > 0.5 ? skyU.uMoonDir.value : skyU.uSunDir.value);
      seaUniforms.uTime.value = t;
      seaUniforms.uCamPos.value.copy(camera.position);
      seaUniforms.uHorizon.value.copy(skyU.uHorizon.value);
      seaUniforms.uGlow.value.copy(NIGHT_GLOW).multiplyScalar(night);
      // The grid follows the camera in whole steps, so the surface does not swim.
      sea.position.set(Math.round(camera.position.x / 32) * 32, 0, Math.round(camera.position.z / 32) * 32);
      puffs.forEach((o, i) => {
        o.x += wind.x * o.speed * dt;
        o.z += wind.y * o.speed * dt;
        if (Math.hypot(o.x, o.z) > 420) {
          o.x = -o.x * 0.97;
          o.z = -o.z * 0.97;
        }
        q.setFromEuler(new THREE.Euler(0, o.rot, 0));
        m.compose(p.set(o.x, o.y + Math.sin(t * 0.3 + i) * 1.2, o.z), q, s.setScalar(o.size));
        puffMesh.setMatrixAt(i, m);
      });
      puffMesh.instanceMatrix.needsUpdate = true;
    },
  };
}
