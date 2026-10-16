/*
 * Patch a shipped cast model in place of its vertex order (no reorder, so its face sheet, clips and every
 * other fix stay as they are):
 *   node tools/models/fix/patch.mjs <in.glb> <out.glb> [--pos pos.f32] [--joints joints.f32 --weights weights.f32]
 *        [--base base.png] [--quality 92]
 * --pos / --joints / --weights: Float32, the shipped file's vertex order (mane.py writes them). --base: a new
 * colour map (upres.py's 2048), stored as JPEG. Then compressed the way apply.mjs does it.
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

if (opt.pos || opt.weights) {
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
  if (opt.pos) {
    const p = f32(opt.pos);
    if (p.length !== n * 3) throw new Error(`--pos has ${p.length / 3} vertices, the model ${n}`);
    prim.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(p).setBuffer(buf));
  }
  if (opt.weights) {
    const w = f32(opt.weights), j = f32(opt.joints);
    if (w.length !== n * 4) throw new Error(`--weights has ${w.length / 4} vertices, the model ${n}`);
    prim.setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(w).setBuffer(buf));
    prim.setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(Uint8Array.from(j)).setBuffer(buf));
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
