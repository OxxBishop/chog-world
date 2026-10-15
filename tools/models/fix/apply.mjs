/*
 * Write fixes back into a cast model, keeping its skeleton, skin and clips:
 *   node tools/models/fix/apply.mjs <in.glb> <out.glb> [--uv uv.f32] [--pos pos.f32] [--keep keep.u8]
 *        [--base base.png] [--normal normal.png] [--mr mr.png] [--bones bones.json]
 *        [--joints joints.f32 --weights weights.f32] [--corners corners.bin]
 *
 * --corners: a new unwrap from atlas.py (applied after the skin). --uv / --pos: new per-vertex UVs / positions (Float32, the dump's vertex order). --joints/--weights:
 * new skin (4 per vertex, Float32, from reskin.py). --keep: one byte per
 * triangle, 0 drops it (unused vertices go too). --base/--normal/--mr: new maps (stored as JPEG, like
 * slim_cast.mjs). --bones: {"BoneName": [x, y, z]} new bind translations (local); the inverse bind
 * matrices and every clip's translation track for those bones follow.
 * Then compressed the way slim_cast.mjs does it (EXT_meshopt_compression, quantised normals, UVs, weights).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { prune, quantize, reorder } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const require = createRequire(import.meta.url);
const sharp = require(require.resolve('sharp', { paths: [path.dirname(require.resolve('ndarray-pixels'))] }));

const [src, dst, ...rest] = process.argv.slice(2);
const opt = {};
for (let i = 0; i < rest.length; i += 2) opt[rest[i].replace(/^--/, '')] = rest[i + 1];
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(src);
const root = doc.getRoot();
const prim = root.listMeshes()[0].listPrimitives()[0];
const f32 = (file) => new Float32Array(fs.readFileSync(file).buffer.slice(0));

function setAttr(name, arr, size) {
  const old = prim.getAttribute(name);
  const acc = doc.createAccessor().setType(size === 2 ? 'VEC2' : 'VEC3').setArray(arr).setBuffer(old.getBuffer());
  prim.setAttribute(name, acc);
}
// Every attribute back to plain floats first, so the edits and the re-quantising start clean.
for (const name of prim.listSemantics()) {
  const a = prim.getAttribute(name);
  if (a.getArray() instanceof Float32Array || name.startsWith('JOINTS')) continue;
  const n = a.getCount(), k = a.getElementSize(), out = new Float32Array(n * k), el = [];
  for (let i = 0; i < n; i++) {
    a.getElement(i, el);
    for (let j = 0; j < k; j++) out[i * k + j] = el[j];
  }
  prim.setAttribute(name, doc.createAccessor().setType(a.getType()).setArray(out).setBuffer(a.getBuffer()));
}
if (opt.uv) setAttr('TEXCOORD_0', f32(opt.uv), 2);
if (opt.pos) setAttr('POSITION', f32(opt.pos), 3);
if (opt.weights) {
  const w = f32(opt.weights), j = f32(opt.joints);
  prim.setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(w).setBuffer(prim.getAttribute('POSITION').getBuffer()));
  prim.setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(Uint8Array.from(j)).setBuffer(prim.getAttribute('POSITION').getBuffer()));
}
if (opt.keep) {
  const keep = fs.readFileSync(opt.keep);
  const idx = prim.getIndices().getArray();
  const kept = [];
  for (let t = 0; t < idx.length / 3; t++) if (keep[t]) kept.push(idx[3 * t], idx[3 * t + 1], idx[3 * t + 2]);
  prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(kept)).setBuffer(prim.getIndices().getBuffer()));
  console.log('triangles', idx.length / 3, '->', kept.length / 3);
}

// --corners (atlas.py's corners.bin): a whole new unwrap, with seams of its own. Every triangle corner
// carries its glTF vertex and its new UV; a vertex is copied wherever its corners disagree on the UV.
if (opt.corners) {
  const buf = fs.readFileSync(opt.corners);
  const n = buf.length / 16;
  const key = new Map();
  const src = [], uvs = [], index = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const v = buf.readInt32LE(i * 16 + 4), u = buf.readFloatLE(i * 16 + 8), w = buf.readFloatLE(i * 16 + 12);
    const k = `${v}|${u.toFixed(6)}|${w.toFixed(6)}`;
    let j = key.get(k);
    if (j === undefined) {
      j = src.length;
      key.set(k, j);
      src.push(v);
      uvs.push(u, w);
    }
    index[i] = j;
  }
  for (const name of prim.listSemantics()) {
    const a = prim.getAttribute(name);
    const k = a.getElementSize(), arr = a.getArray(), out = new arr.constructor(src.length * k);
    src.forEach((v, j) => out.set(arr.subarray(v * k, v * k + k), j * k));
    prim.setAttribute(name, doc.createAccessor().setType(a.getType()).setArray(name === 'TEXCOORD_0' ? new Float32Array(uvs) : out).setBuffer(a.getBuffer()));
  }
  prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(index).setBuffer(prim.getIndices().getBuffer()));
  console.log('re-unwrapped:', n / 3, 'triangles,', src.length, 'vertices');
}

const mat = prim.getMaterial();
async function swap(tex, file, q) {
  if (!tex || !file) return;
  const jpg = await sharp(fs.readFileSync(file)).jpeg({ quality: q, chromaSubsampling: q >= 92 ? '4:4:4' : '4:2:0' }).toBuffer();
  tex.setImage(new Uint8Array(jpg)).setMimeType('image/jpeg');
}
await swap(mat.getBaseColorTexture(), opt.base, 92);
await swap(mat.getNormalTexture(), opt.normal, 92);
await swap(mat.getMetallicRoughnessTexture(), opt.mr, 90);

if (opt.bones) {
  const moves = JSON.parse(fs.readFileSync(opt.bones, 'utf8'));
  const skin = root.listSkins()[0];
  const joints = skin.listJoints();
  for (const [name, t] of Object.entries(moves)) {
    const node = joints.find((j) => j.getName() === name);
    const old = node.getTranslation();
    node.setTranslation(t);
    // Clips that hold this bone's translation: scale each key the same way (they hold the rest offset).
    for (const anim of root.listAnimations())
      for (const ch of anim.listChannels()) {
        if (ch.getTargetNode() !== node || ch.getTargetPath() !== 'translation') continue;
        const out = ch.getSampler().getOutput();
        const n = out.getCount(), el = [], arr = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          out.getElement(i, el);
          for (let k = 0; k < 3; k++) arr[i * 3 + k] = el[k] + (t[k] - old[k]);
        }
        ch.getSampler().setOutput(doc.createAccessor().setType('VEC3').setArray(arr).setBuffer(out.getBuffer()));
      }
  }
  // Inverse bind matrices from the new rest pose.
  const ibm = new Float32Array(joints.length * 16);
  const inv = (m) => {
    const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    const d = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06);
    return [(a11 * b11 - a12 * b10 + a13 * b09) * d, (a02 * b10 - a01 * b11 - a03 * b09) * d, (a31 * b05 - a32 * b04 + a33 * b03) * d, (a22 * b04 - a21 * b05 - a23 * b03) * d,
      (a12 * b08 - a10 * b11 - a13 * b07) * d, (a00 * b11 - a02 * b08 + a03 * b07) * d, (a32 * b02 - a30 * b05 - a33 * b01) * d, (a20 * b05 - a22 * b02 + a23 * b01) * d,
      (a10 * b10 - a11 * b08 + a13 * b06) * d, (a01 * b08 - a00 * b10 - a03 * b06) * d, (a30 * b04 - a31 * b02 + a33 * b00) * d, (a21 * b02 - a20 * b04 - a23 * b00) * d,
      (a11 * b07 - a10 * b09 - a12 * b06) * d, (a00 * b09 - a01 * b07 + a02 * b06) * d, (a31 * b01 - a30 * b03 - a32 * b00) * d, (a20 * b03 - a21 * b01 + a22 * b00) * d];
  };
  joints.forEach((j, i) => ibm.set(inv(j.getWorldMatrix()), i * 16));
  skin.setInverseBindMatrices(doc.createAccessor().setType('MAT4').setArray(ibm).setBuffer(skin.getInverseBindMatrices().getBuffer()));
}

await doc.transform(prune({ keepAttributes: true }), reorder({ encoder: MeshoptEncoder, target: 'size' }), quantize({ pattern: /^(NORMAL|TEXCOORD_\d+|WEIGHTS_\d+)$/, quantizeNormal: 8, quantizeTexcoord: 12 }));
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
await io.write(dst, doc);
console.log(path.basename(dst), (fs.statSync(src).size / 1e6).toFixed(2), 'MB ->', (fs.statSync(dst).size / 1e6).toFixed(2), 'MB');
