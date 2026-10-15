/*
 * Slims the rigged cast for the web: node tools/models/slim_cast.mjs <in.glb...> --out <dir>
 *
 * - Every texture is at most 1024 px JPEG (the colour map was 2048). The normal and roughness maps stay:
 *   they are small, and they are what makes crowns and glasses read as metal on a GPU that can afford
 *   them (src/chog.js slim() drops them where it can't).
 * - Animations are resampled (keys that a straight line between their neighbours already gives go).
 * - The geometry is compressed (EXT_meshopt_compression; the loader needs setMeshoptDecoder). Normals,
 *   UVs and skin weights are stored as small integers; positions stay floats, because src/chog.js
 *   lighten() simplifies Float32 positions for the distant copies.
 */
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, prune, quantize, reorder, resample } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { createRequire } from 'node:module';

// The same sharp (and libvips) that @gltf-transform/functions loads: two copies in one process clash.
const require = createRequire(import.meta.url);
const sharp = require(require.resolve('sharp', { paths: [path.dirname(require.resolve('ndarray-pixels'))] }));

const args = process.argv.slice(2);
const outAt = args.indexOf('--out');
const out = outAt >= 0 ? args.splice(outAt, 2)[1] : null;
if (!out || !args.length) throw new Error('usage: slim_cast.mjs <in.glb...> --out <dir>');
fs.mkdirSync(out, { recursive: true });

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

for (const file of args) {
  const doc = await io.read(file);
  await doc.transform(prune(), dedup());
  for (const t of doc.getRoot().listTextures()) {
    const img = await sharp(Buffer.from(t.getImage())).resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
    t.setImage(new Uint8Array(img)).setMimeType('image/jpeg').setURI(t.getURI().replace(/\.\w+$/, '.jpg'));
  }
  await doc.transform(
    resample(),
    reorder({ encoder: MeshoptEncoder, target: 'size' }),
    quantize({ pattern: /^(NORMAL|TEXCOORD_\d+|WEIGHTS_\d+)$/, quantizeNormal: 8, quantizeTexcoord: 12 }),
  );
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
  const dst = path.join(out, path.basename(file));
  await io.write(dst, doc);
  console.log(`${path.basename(file)}  ${(fs.statSync(file).size / 1e6).toFixed(2)} MB -> ${(fs.statSync(dst).size / 1e6).toFixed(2)} MB`);
}
