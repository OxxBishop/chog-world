import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import { patchPlant, sphereNormals, upNormals } from './foliage.js';

// Quaternius Stylized Nature MegaKit (CC0), standard free version.
export const MODELS = {
  common: ['CommonTree_1', 'CommonTree_2', 'CommonTree_3', 'CommonTree_4', 'CommonTree_5'],
  pine: ['Pine_1', 'Pine_2', 'Pine_3', 'Pine_4', 'Pine_5'],
  twisted: ['TwistedTree_1', 'TwistedTree_2', 'TwistedTree_3', 'TwistedTree_4', 'TwistedTree_5'],
  dead: ['DeadTree_1', 'DeadTree_2'],
  bush: ['Bush_Common', 'Bush_Common_Flowers'],
  flowers: ['Flower_3_Group', 'Flower_4_Group', 'Flower_3_Single', 'Flower_4_Single'],
  grassShort: ['Grass_Common_Short', 'Grass_Wispy_Short'],
  grassTall: ['Grass_Common_Tall', 'Grass_Wispy_Tall'],
  ferns: ['Fern_1', 'Plant_1', 'Plant_7', 'Plant_1_Big', 'Plant_7_Big'],
  mushrooms: ['Mushroom_Common', 'Mushroom_Laetiporus'],
  clover: ['Clover_1', 'Clover_2'],
  rocks: ['Rock_Medium_1', 'Rock_Medium_2', 'Rock_Medium_3'],
  pebbles: ['Pebble_Round_1', 'Pebble_Round_2', 'Pebble_Round_3', 'Pebble_Round_4', 'Pebble_Round_5', 'Pebble_Square_1', 'Pebble_Square_2', 'Pebble_Square_3'],
  path: ['RockPath_Round_Small_1', 'RockPath_Round_Small_2', 'RockPath_Round_Small_3', 'RockPath_Square_Small_1', 'RockPath_Square_Small_2'],
  pathWide: ['RockPath_Round_Wide', 'RockPath_Round_Thin', 'RockPath_Square_Wide'],
  petals: ['Petal_1', 'Petal_2', 'Petal_3'],
};

const TREES = new Set([...MODELS.common, ...MODELS.pine, ...MODELS.twisted, ...MODELS.dead]);
// Kit materials we recolour per instance (their textures only give shape and light detail).
export const TINTED = new Set(['Leaves_NormalTree', 'Leaves_TwistedTree', 'Leaves_Pine', 'Grass']);

// Average linear luminance of a texture's opaque pixels, so recolouring keeps its brightness detail.
function averageLum(image) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  // Read back on the CPU: a GPU canvas would wait on the GPU, which is busy building shaders.
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, 64, 64);
  const d = ctx.getImageData(0, 0, 64, 64).data;
  const lin = (v) => Math.pow(v / 255, 2.2);
  let sum = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    sum += 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]);
    n++;
  }
  return n ? sum / n : 0.3;
}

// Cut bark triangle counts; borders stay locked so UV seams don't tear.
function simplify(geometry, ratio) {
  if (!geometry.index) return;
  const idx = new Uint32Array(geometry.index.array);
  const pos = new Float32Array(geometry.attributes.position.array);
  const [out] = MeshoptSimplifier.simplify(idx, pos, 3, Math.floor((idx.length * ratio) / 3) * 3, 0.02, ['LockBorder']);
  geometry.setIndex(new THREE.BufferAttribute(out, 1));
}
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const cache = new Map();

/*
 * The models load from one compressed file per kit (scripts/pack-models.mjs, npm run pack-models).
 * Hashed into their names at build, so a cached copy never outlives a change.
 */
const PACKS = {
  nature: new URL('./packs/nature.glb', import.meta.url).href,
  kaykit: new URL('./packs/kaykit.glb', import.meta.url).href,
  furniture: new URL('./packs/furniture.glb', import.meta.url).href,
};

/** Every model in a kit's pack, by name; empty if the pack is missing. onProgress gets 0 to 1. */
export async function loadPack(kit, onProgress) {
  try {
    const gltf = await loader.loadAsync(PACKS[kit], (e) => e.total && onProgress?.((0.9 * e.loaded) / e.total));
    onProgress?.(1);
    return new Map(gltf.scenes.map((s) => [s.name, s]));
  } catch (e) {
    console.warn(`The ${kit} pack did not load, so its loose files will: ${e.message}`);
    return new Map();
  }
}

/** A model from its pack, or from its loose file if the pack lacks it (run npm run pack-models). */
export async function loadModel(pack, dir, name, gltfLoader = loader) {
  if (pack.has(name)) return pack.get(name);
  if (pack.size) console.warn(`${name} is not in the ${dir} pack: run npm run pack-models`);
  return (await gltfLoader.loadAsync(`${import.meta.env.BASE_URL}assets/${dir}/${name}.gltf`)).scene;
}

/*
 * A packed model's geometry is small integers (see scripts/pack-models.mjs). Turn it back into plain
 * floats in the model's own space, as its loose file had it, so nothing downstream can tell.
 */
const unpacked = new WeakSet();
export function unpack(root) {
  root.traverse((o) => {
    const p = o.userData.packed;
    if (!o.isMesh || !p || unpacked.has(o.geometry)) return;
    const g = o.geometry;
    unpacked.add(g);
    const [x, y, z, step, u0, v0, uvStep] = p;
    for (const [name, a] of Object.entries(g.attributes)) {
      const n = a.itemSize;
      const out = new Float32Array(a.count * n);
      for (let i = 0; i < a.count; i++) for (let c = 0; c < n; c++) out[i * n + c] = a.getComponent(i, c);
      if (name === 'position') {
        for (let i = 0; i < out.length; i += 3) {
          out[i] = x + step * out[i];
          out[i + 1] = y + step * out[i + 1];
          out[i + 2] = z + step * out[i + 2];
        }
      } else if (name === 'uv' && uvStep) {
        for (let i = 0; i < out.length; i += 2) {
          out[i] = u0 + uvStep * out[i];
          out[i + 1] = v0 + uvStep * out[i + 1];
        }
      } else if (name === 'normal') {
        for (let i = 0; i < out.length; i += 3) {
          const l = Math.hypot(out[i], out[i + 1], out[i + 2]) || 1;
          out[i] /= l;
          out[i + 1] /= l;
          out[i + 2] /= l;
        }
      }
      g.setAttribute(name, new THREE.BufferAttribute(out, n));
    }
    g.computeBoundingBox();
    g.computeBoundingSphere();
  });
}
const materials = new Map();

// One material per kit material name, shared by every model, so instancing batches cleanly.
function prepMaterial(src, modelName) {
  const key = `${src.name}|${TREES.has(modelName) ? 'tree' : 'low'}`;
  if (materials.has(key)) return materials.get(key);
  const tint = TINTED.has(src.name);
  const lumRef = tint && src.map?.image ? averageLum(src.map.image) : 0.3;
  const name = src.name.toLowerCase();
  const isGrass = name.startsWith('grass');
  // Lambert lighting: plants are most of the pixels on screen, PBR is too heavy for them.
  const m = new THREE.MeshLambertMaterial({
    name: src.name,
    map: src.map,
    normalMap: src.normalMap ?? null,
    alphaTest: src.alphaTest,
    side: src.side,
    vertexColors: src.vertexColors && name.startsWith('bark'),
  });
  if (name.startsWith('rock') || name.startsWith('pathrock')) m.color.setScalar(1.25);
  if (name.startsWith('bark')) {
    patchPlant(m, { kind: 'bark', base: 1.5, top: 8, amp: 0.22, shade: [0.85, 1.0] });
  } else if (name.startsWith('lea')) {
    m.alphaTest = 0.35;
    m.side = THREE.DoubleSide;
    if (TREES.has(modelName)) patchPlant(m, { kind: 'canopy', base: 1.5, top: 8, amp: 0.22, translucency: 0.7, shade: [0.6, 1.1], tint, lumRef });
    else patchPlant(m, { kind: 'low', base: 0, top: 1.5, amp: 0.06, translucency: 0.5, shade: [0.7, 1.05], tint, lumRef });
  } else if (name.startsWith('grass') || name.startsWith('flower') || name.startsWith('mushroom') || name.startsWith('plant')) {
    m.alphaTest = Math.max(m.alphaTest, 0.35);
    m.side = THREE.DoubleSide;
    patchPlant(m, { kind: 'low', base: 0, top: 1.8, amp: 0.12, translucency: 0.45, shade: [0.65, 1.08], tint, lumRef });
  }
  materials.set(key, m);
  return m;
}

export async function loadAll(onProgress) {
  const names = [...new Set(Object.values(MODELS).flat())];
  // The pack's download is most of the work; the loose files, if any, the rest.
  const [pack] = await Promise.all([loadPack('nature', (f) => onProgress?.(0.9 * f)), MeshoptSimplifier.ready]);
  let done = 0;
  await Promise.all(
    names.map(async (name) => {
      const root = await loadModel(pack, 'nature', name);
      unpack(root);
      root.updateMatrixWorld(true);
      const parts = [];
      root.traverse((o) => {
        if (!o.isMesh) return;
        const mat = prepMaterial(o.material, name);
        const g = o.geometry;
        const lname = o.material.name.toLowerCase();
        if (lname.startsWith('lea') && TREES.has(name)) sphereNormals(g, 0.85);
        else if (lname.startsWith('lea')) sphereNormals(g, 0.6, 0);
        else if (lname.startsWith('grass') || lname.startsWith('flower') || lname.startsWith('plant')) upNormals(g, 0.65);
        // Packed models come already simplified.
        if (lname.startsWith('bark') && !o.userData.packed) simplify(g, 0.4);
        if (lname.startsWith('mushroom') && !o.userData.packed) simplify(g, 0.35);
        parts.push({ geometry: g, material: mat, matrix: o.matrixWorld.clone(), shadow: !lname.startsWith('grass'), tintable: TINTED.has(o.material.name) });
      });
      const box = new THREE.Box3().setFromObject(root);
      cache.set(name, {
        parts,
        box: box.clone(),
        height: Math.max(0.001, box.max.y - box.min.y),
        radius: Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2,
      });
      onProgress?.(0.9 + (0.1 * ++done) / names.length);
    }),
  );
}

export function info(name) {
  const c = cache.get(name);
  if (!c) throw new Error(`Model not loaded: ${name}`);
  return c;
}

// A plain (non-instanced) copy, for one-off placements.
export function spawn(name, height) {
  const c = info(name);
  const group = new THREE.Group();
  for (const p of c.parts) {
    const mesh = new THREE.Mesh(p.geometry, p.material);
    mesh.applyMatrix4(p.matrix);
    mesh.castShadow = p.shadow;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  if (height) group.scale.setScalar(height / c.height);
  return group;
}

/**
 * Collects placements per model and builds one InstancedMesh per model part.
 * Hundreds of trees and thousands of grass clumps cost a few dozen draw calls.
 */
export class Scatter {
  constructor() {
    this.items = new Map();
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.s = new THREE.Vector3();
    this.e = new THREE.Euler();
  }

  // height: target height in world units (or null for native size), rotY in radians.
  add(name, x, y, z, { height = null, scale = 1, rotY = 0, tilt = 0, tint = null } = {}) {
    const c = info(name);
    const k = (height ? height / c.height : 1) * scale;
    this.e.set(tilt * (Math.random() - 0.5), rotY, tilt * (Math.random() - 0.5));
    this.q.setFromEuler(this.e);
    this.s.set(k, k, k);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), this.q, this.s);
    m.tint = tint ? new THREE.Color(tint) : new THREE.Color('#8ccf4d');
    if (!this.items.has(name)) this.items.set(name, []);
    this.items.get(name).push(m);
    return k * c.radius;
  }

  build(parent, { shadows = true, chunk = 0 } = {}) {
    const meshes = [];
    const groups = [];
    for (const [name, all] of this.items) {
      if (!chunk) {
        groups.push([name, all]);
        continue;
      }
      const buckets = new Map();
      for (const m of all) {
        const key = `${Math.floor(m.elements[12] / chunk)},${Math.floor(m.elements[14] / chunk)}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(m);
      }
      for (const list of buckets.values()) groups.push([name, list]);
    }
    for (const [name, mats] of groups) {
      const c = info(name);
      for (const p of c.parts) {
        const im = new THREE.InstancedMesh(p.geometry, p.material, mats.length);
        const tmp = new THREE.Matrix4();
        mats.forEach((m, i) => {
          im.setMatrixAt(i, tmp.multiplyMatrices(m, p.matrix));
          if (p.tintable) im.setColorAt(i, m.tint);
        });
        im.instanceMatrix.needsUpdate = true;
        im.castShadow = shadows && p.shadow;
        im.receiveShadow = true;
        im.computeBoundingSphere();
        im.userData.model = name;
        parent.add(im);
        meshes.push(im);
      }
    }
    this.items.clear();
    return meshes;
  }
}
