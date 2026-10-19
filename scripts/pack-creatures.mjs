/*
 * Squeezes the birds' models (public/creatures/*.glb, src/birds.js) with meshopt: node scripts/pack-creatures.mjs.
 * They came from Quaternius' CC0 packs (Animated Fish, Ultimate Monsters), each turned to face +z, sized
 * to 1 m on its longest side and trimmed to the clips the birds use, then saved as GLB. Run on those.
 */
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, resample, meshopt } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'public', 'creatures');
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.glb'))) {
  const file = path.join(DIR, f);
  const before = fs.statSync(file).size;
  const doc = await io.read(file);
  await doc.transform(dedup(), resample(), prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write(file, doc);
  console.log(f, Math.round(before / 1024) + ' KB ->', Math.round(fs.statSync(file).size / 1024) + ' KB');
}
