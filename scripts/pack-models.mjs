/*
 * Packs the models the world loads at start into one compressed GLB per kit (npm run pack-models):
 *
 *   src/packs/nature.glb     every model named in MODELS (src/assets.js)
 *   src/packs/kaykit.glb     HUB_KIT (src/hub.js) and LANDMARK_KIT (src/landmarks.js)
 *   src/packs/furniture.glb  FURNITURE_KIT (src/interior.js)
 *
 * One file per kit instead of about 300, each texture once instead of once per model that uses it,
 * and the geometry compressed (EXT_meshopt_compression). Every model is its own scene, named after it.
 *
 * The geometry is stored as small integers (positions within each mesh's bounds, normals, UVs and
 * colours), which is what lets the codec squeeze it. How to turn them back into floats goes in each
 * mesh's extras as `packed: [x, y, z, step, u, v, uvStep]`, and src/assets.js does that as it loads, so
 * everything downstream gets plain floats in the model's own space, as the loose files gave.
 * (Opened anywhere else, a packed model shows at the wrong size.)
 *
 * Also done here rather than in the browser: bark and mushrooms simplified (as src/assets.js did on
 * load), vertex colours dropped where no nature material uses them, textures over 1024 halved.
 * A model missing from a pack still loads from its loose file, with a warning to run this again.
 */
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO, Document, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression, EXTTextureWebP, KHRMeshQuantization } from '@gltf-transform/extensions';
import { compactPrimitive, dedup, mergeDocuments, prune, reorder } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const src = (f) => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');
// The quoted names in `export const NAME = [...];` (or `= {...};`) in a source file.
const list = (file, name) => {
  const m = src(file).match(new RegExp(`export const ${name} = ([\\[{][\\s\\S]*?[\\]}]);`));
  if (!m) throw new Error(`${name} not found in src/${file}`);
  return [...new Set([...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]))];
};

const KITS = [
  { kit: 'nature', names: list('assets.js', 'MODELS'), nature: true },
  { kit: 'kaykit', names: [...new Set([...list('hub.js', 'HUB_KIT'), ...list('landmarks.js', 'LANDMARK_KIT')])] },
  { kit: 'furniture', names: list('interior.js', 'FURNITURE_KIT') },
];

// As src/assets.js did on load: cut bark and mushroom triangles, borders locked so UV seams hold.
function simplify(prim, ratio) {
  const idx = prim.getIndices();
  const indices = new Uint32Array(idx.getArray());
  const positions = new Float32Array(prim.getAttribute('POSITION').getArray());
  const [out] = MeshoptSimplifier.simplify(indices, positions, 3, Math.floor((indices.length * ratio) / 3) * 3, 0.02, ['LockBorder']);
  idx.setArray(out);
}

// Floats to integers. Normalized: [-1, 1] (signed) or [0, 1] over the type's whole range. Otherwise
// `steps` integer steps per unit after `map`, so a value is stored as round(map(v) * steps).
function quantize(attr, Ctor, { map = (v) => v, steps = 0 } = {}) {
  const src = attr.getArray();
  const full = Ctor === Int8Array ? 127 : Ctor === Int16Array ? 32767 : Ctor === Uint8Array ? 255 : 65535;
  const lo = Ctor === Int8Array || Ctor === Int16Array ? -1 : 0;
  const k = steps || full;
  const out = new Ctor(src.length);
  for (let i = 0; i < src.length; i++) out[i] = Math.round(Math.min(1, Math.max(lo, map(src[i], i))) * k);
  attr.setArray(out).setNormalized(!steps);
}

// Bits kept: nature is small and seen from afar, so it keeps what gltfpack keeps; the kits' pods and
// furniture are large and close, so they keep 16.
const BITS = { nature: { pos: 14, uv: 12, normal: Int8Array }, kit: { pos: 16, uv: 16, normal: Int16Array } };

function packMesh(mesh, bits) {
  const prims = mesh.listPrimitives();
  // One box round every primitive's positions, as a centre and a half-size.
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const p of prims) {
    const a = p.getAttribute('POSITION').getArray();
    for (let i = 0; i < a.length; i++) {
      min[i % 3] = Math.min(min[i % 3], a[i]);
      max[i % 3] = Math.max(max[i % 3], a[i]);
    }
  }
  const c = min.map((v, i) => (v + max[i]) / 2);
  const s = Math.max(...max.map((v, i) => (v - min[i]) / 2)) || 1;
  const posSteps = 2 ** (bits.pos - 1) - 1;
  // UVs over the mesh's own range (bark tiles past 0 to 1), at least `bits` per unit.
  const uvs = prims.map((p) => p.getAttribute('TEXCOORD_0')).filter((a) => a?.getComponentType() === 5126);
  const uMin = [Infinity, Infinity], uMax = [-Infinity, -Infinity];
  for (const a of uvs) {
    const v = a.getArray();
    for (let i = 0; i < v.length; i++) {
      uMin[i % 2] = Math.min(uMin[i % 2], v[i]);
      uMax[i % 2] = Math.max(uMax[i % 2], v[i]);
    }
  }
  const inUnit = uMin.every((v) => v >= 0) && uMax.every((v) => v <= 1);
  const uOff = inUnit ? [0, 0] : uMin;
  const range = inUnit ? 1 : Math.max(uMax[0] - uMin[0], uMax[1] - uMin[1]) || 1;
  const uvStep = Math.max(range / 65535, 1 / (2 ** bits.uv - 1));
  for (const p of prims) {
    for (const sem of p.listSemantics()) {
      const a = p.getAttribute(sem);
      if (a.getComponentType() !== 5126) continue;
      if (sem === 'POSITION') quantize(a, Int16Array, { map: (v, i) => (v - c[i % 3]) / s, steps: posSteps });
      else if (sem === 'NORMAL') quantize(a, bits.normal);
      else if (sem.startsWith('COLOR_')) quantize(a, Uint8Array);
      else if (sem === 'TEXCOORD_0') quantize(a, Uint16Array, { map: (v, i) => (v - uOff[i % 2]) / range, steps: range / uvStep });
    }
  }
  // How to get the floats back: position = centre + step * stored, uv = uvOffset + uvStep * stored.
  mesh.setExtras({ ...mesh.getExtras(), packed: [...c, s / posSteps, ...uOff, uvs.length ? uvStep : 0] });
}

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

await Promise.all([MeshoptEncoder.ready, MeshoptSimplifier.ready]);
// The newer vertex codec (version 1) packs tighter; the decoder in src/assets.js reads both.
const encodeGltfBuffer = MeshoptEncoder.encodeGltfBuffer.bind(MeshoptEncoder);
MeshoptEncoder.encodeGltfBuffer = (source, count, size, mode) => encodeGltfBuffer(source, count, size, mode, 1);
fs.mkdirSync(path.join(ROOT, 'src/packs'), { recursive: true });

for (const { kit, names, nature } of KITS) {
  const doc = new Document();
  doc.setLogger({ debug() {}, info() {}, warn: console.warn, error: console.error });
  const buffer = doc.createBuffer();
  let loose = 0;
  for (const name of names) {
    const file = path.join(ROOT, 'public/assets', kit, `${name}.gltf`);
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const f of [`${name}.gltf`, ...json.buffers.map((b) => b.uri), ...(json.images ?? []).map((i) => i.uri)]) {
      loose += fs.statSync(path.join(ROOT, 'public/assets', kit, f)).size;
    }
    const one = await io.read(file);
    one.getRoot().listScenes()[0].setName(name);
    mergeDocuments(doc, one);
  }
  // One buffer for the whole kit.
  for (const a of doc.getRoot().listAccessors()) a.setBuffer(buffer);
  for (const b of doc.getRoot().listBuffers()) if (b !== buffer) b.dispose();

  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const mat = (prim.getMaterial()?.getName() ?? '').toLowerCase();
      if (nature) {
        if (mat.startsWith('bark')) simplify(prim, 0.4);
        else if (mat.startsWith('mushroom')) simplify(prim, 0.35);
        // Only bark draws with vertex colours (src/assets.js).
        if (!mat.startsWith('bark')) prim.getAttribute('COLOR_0')?.dispose();
      }
      compactPrimitive(prim);
      const idx = prim.getIndices();
      if (idx && prim.getAttribute('POSITION').getCount() <= 65535) idx.setArray(new Uint16Array(idx.getArray()));
    }
  }
  // Vertices in the order the codec compresses best, then made small.
  await doc.transform(dedup({ propertyTypes: [PropertyType.TEXTURE] }), prune({ keepAttributes: true, keepLeaves: true }), reorder({ encoder: MeshoptEncoder, target: 'size' }));
  for (const mesh of doc.getRoot().listMeshes()) packMesh(mesh, nature ? BITS.nature : BITS.kit);
  doc.createExtension(KHRMeshQuantization).setRequired(true);

  // Halve anything over 1024: these are small plants and rocks, never seen that close.
  let webp = false;
  for (const tex of doc.getRoot().listTextures()) {
    const img = sharp(Buffer.from(tex.getImage()));
    const { width, format } = await img.metadata();
    if (format === 'webp') webp = true;
    if (width <= 1024) continue;
    const out = await img.resize(1024, 1024, { kernel: 'lanczos3' }).webp({ quality: 90, alphaQuality: 100, effort: 6 }).toBuffer();
    tex.setImage(new Uint8Array(out)).setMimeType('image/webp');
  }
  if (webp) doc.createExtension(EXTTextureWebP).setRequired(true);
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });

  const file = path.join(ROOT, 'src/packs', `${kit}.glb`);
  await io.write(file, doc);
  const kb = (b) => `${(b / 1024).toFixed(0)} KB`;
  console.log(`${kit}: ${names.length} models, ${doc.getRoot().listTextures().length} textures, ${kb(fs.statSync(file).size)} (loose files ${kb(loose)})`);
}
