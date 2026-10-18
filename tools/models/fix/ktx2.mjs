/*
 * A cast model's textures as KTX2 (A14): the GPU keeps them compressed (about a sixth of the memory of a
 * JPEG's pixels), so the colour map can be 2048 and still cost less than the 1024 one did.
 *   node tools/models/fix/ktx2.mjs <in.glb> <out.glb> [--base base2048.png] [--normalmap normal.png] [--rmmap rm.png] [--normal etc1s|uastc]
 * --base: a new colour map (upres.py's), else the file's own; --normalmap and --rmmap likewise for the normal and metal-roughness maps. Colour and metal-roughness are ETC1S
 * (Basis LZ, mipmapped); the normal map ETC1S by default, UASTC (zstd) when asked. Needs KTX-Software's
 * toktx (C:\Program Files\KTX-Software\bin, or on the PATH). The world loads them with KTX2Loader
 * (src/chog.js, transcoder in public/basis/).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression, KHRTextureBasisu } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const require = createRequire(import.meta.url);
const sharp = require(require.resolve('sharp', { paths: [path.dirname(require.resolve('ndarray-pixels'))] }));
const TOKTX = ['C:/Program Files/KTX-Software/bin/toktx.exe'].find((p) => fs.existsSync(p)) ?? 'toktx';

const [src, dst, ...rest] = process.argv.slice(2);
const opt = {};
for (let i = 0; i < rest.length; i += 2) opt[rest[i].replace(/^--/, '')] = rest[i + 1];
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(src);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ktx2-'));

async function encode(tex, { srgb, mode, png }) {
  if (!tex || (tex.getMimeType() === 'image/ktx2' && !png)) return;
  const input = path.join(tmp, `${tex.getName() || 'tex'}-${Math.random().toString(36).slice(2)}.png`);
  fs.writeFileSync(input, png ? fs.readFileSync(png) : await sharp(Buffer.from(tex.getImage())).png().toBuffer());
  const out = input.replace(/\.png$/, '.ktx2');
  const args = ['--t2', '--genmipmap', '--assign_oetf', srgb ? 'srgb' : 'linear'];
  if (mode === 'uastc') args.push('--encode', 'uastc', '--uastc_quality', '2', '--zcmp', '18');
  else args.push('--encode', 'etc1s', '--clevel', '4', '--qlevel', '255');
  execFileSync(TOKTX, [...args, out, input], { stdio: 'pipe' });
  tex.setImage(new Uint8Array(fs.readFileSync(out))).setMimeType('image/ktx2').setURI('');
}
for (const [i, mat] of doc.getRoot().listMaterials().entries()) {
  // --base is the body's (the first material's): the singer's stage keeps its own.
  await encode(mat.getBaseColorTexture(), { srgb: true, mode: 'etc1s', png: i === 0 ? opt.base : undefined });
  await encode(mat.getNormalTexture(), { srgb: false, mode: opt.normal ?? 'etc1s', png: i === 0 ? opt.normalmap : undefined });
  await encode(mat.getMetallicRoughnessTexture(), { srgb: false, mode: 'etc1s', png: i === 0 ? opt.rmmap : undefined });
  await encode(mat.getEmissiveTexture(), { srgb: true, mode: 'etc1s' });
  await encode(mat.getOcclusionTexture(), { srgb: false, mode: 'etc1s' });
}
doc.createExtension(KHRTextureBasisu).setRequired(true);
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
await io.write(dst, doc);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(path.basename(dst), (fs.statSync(src).size / 1e6).toFixed(2), 'MB ->', (fs.statSync(dst).size / 1e6).toFixed(2), 'MB');
