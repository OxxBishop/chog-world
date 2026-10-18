/*
 * Patch a shipped cast model in place of its vertex order (no reorder, so its face sheet, clips and every
 * other fix stay as they are):
 *   node tools/models/fix/patch.mjs <in.glb> <out.glb> [--pos pos.f32] [--nrm nrm.f32] [--joints joints.f32 --weights weights.f32]
 *        [--base base.png] [--quality 92] [--requantize 1]
 * --index: Uint32 triangles to keep (cleanup.py cords). --pos / --nrm / --joints / --weights: Float32, the shipped file's vertex order (mane.py writes them). --base: a new
 * colour map (upres.py's 2048), stored as JPEG. --requantize: store its normals, UVs and weights the way the
 * rest of the cast does (the sniffer's UVs were floats: a vertex layout, so a shader, of its own on Intel).
 * Then compressed the way apply.mjs does it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { quantize } from '@gltf-transform/functions';
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
const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
const f32 = (file) => new Float32Array(fs.readFileSync(file).buffer.slice(0));
const n = prim.getAttribute('POSITION').getCount();

if (opt.pos || opt.nrm || opt.weights || opt.requantize || opt.index) {
  // Every attribute back to plain floats, so the re-quantising starts clean.
  for (const name of prim.listSemantics()) {
    const a = prim.getAttribute(name);
    if (a.getArray() instanceof Float32Array || name.startsWith('JOINTS')) continue;
    const k = a.getElementSize(), out = new Float32Array(n * k), el = [];
    for (let i = 0; i < n; i++) {
      a.getElement(i, el);
      for (let j = 0; j < k; j++) out[i * k + j] = el[j];
    }
    prim.setAttribute(name, doc.createAccessor().setType(a.getType()).setArray(out).setBuffer(a.getBuffer()));
  }
  const buf = prim.getAttribute('POSITION').getBuffer();
  // A UV a hair outside 0..1 (float rounding in the export) would keep them all floats: pull it in.
  const uv = prim.getAttribute('TEXCOORD_0')?.getArray();
  if (uv && uv.every((v) => v > -1e-3 && v < 1 + 1e-3)) for (let i = 0; i < uv.length; i++) uv[i] = Math.min(1, Math.max(0, uv[i]));
  if (opt.pos) {
    const p = f32(opt.pos);
    if (p.length !== n * 3) throw new Error(`--pos has ${p.length / 3} vertices, the model ${n}`);
    prim.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(p).setBuffer(buf));
  }
  if (opt.nrm) {
    const v = f32(opt.nrm);
    if (v.length !== n * 3) throw new Error(`--nrm has ${v.length / 3} vertices, the model ${n}`);
    prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(v).setBuffer(buf));
  }
  if (opt.weights) {
    const w = f32(opt.weights), j = f32(opt.joints);
    if (w.length !== n * 4) throw new Error(`--weights has ${w.length / 4} vertices, the model ${n}`);
    prim.setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(w).setBuffer(buf));
    prim.setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(Uint8Array.from(j)).setBuffer(buf));
  }
  if (opt.index) {
    const ix = new Uint32Array(fs.readFileSync(opt.index).buffer.slice(0));
    prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(ix).setBuffer(buf));
  }
  await doc.transform(quantize({ pattern: /^(NORMAL|TEXCOORD_\d+|WEIGHTS_\d+)$/, quantizeNormal: 8, quantizeTexcoord: 12 }));
}
if (opt.base) {
  const tex = prim.getMaterial().getBaseColorTexture();
  const q = +(opt.quality ?? 92);
  const jpg = await sharp(fs.readFileSync(opt.base)).jpeg({ quality: q, chromaSubsampling: '4:4:4' }).toBuffer();
  tex.setImage(new Uint8Array(jpg)).setMimeType('image/jpeg');
}
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
await io.write(dst, doc);
console.log(path.basename(dst), (fs.statSync(src).size / 1e6).toFixed(2), 'MB ->', (fs.statSync(dst).size / 1e6).toFixed(2), 'MB');
