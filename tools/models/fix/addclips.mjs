/*
 * Put retargeted clips (tools/models/bake.html's JSON) into cast models, in place of the ones they replace:
 *   node tools/models/fix/addclips.mjs <clips.json> <dir> [model...]
 * Each clip becomes a glTF animation on the model's own bones (rotation per mapped bone, the hips' position,
 * the root as bound). An existing animation of the same name is removed first; the others stay.
 */
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { resample } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const [file, dir, ...only] = process.argv.slice(2);
const all = JSON.parse(fs.readFileSync(file, 'utf8'));
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
for (const [model, clips] of Object.entries(all)) {
  if (only.length && !only.includes(model)) continue;
  const p = path.join(dir, `${model}.glb`);
  const doc = await io.read(p);
  const root = doc.getRoot();
  const buffer = root.listBuffers()[0];
  const nodes = new Map(root.listNodes().map((n) => [n.getName(), n]));
  for (const [name, clip] of Object.entries(clips)) {
    for (const a of root.listAnimations()) if (a.getName() === name) a.dispose();
    const anim = doc.createAnimation(name);
    for (const t of clip.tracks) {
      const [node, prop] = t.name.split('.');
      const target = nodes.get(node);
      if (!target) continue;
      const pathName = { quaternion: 'rotation', position: 'translation', scale: 'scale' }[prop];
      const input = doc.createAccessor().setType('SCALAR').setArray(new Float32Array(t.times)).setBuffer(buffer);
      const output = doc.createAccessor().setType(prop === 'quaternion' ? 'VEC4' : 'VEC3').setArray(new Float32Array(t.values)).setBuffer(buffer);
      const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
      anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(target).setTargetPath(pathName).setSampler(sampler));
    }
  }
  await doc.transform(resample());
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
  await io.write(p, doc);
  console.log(model, Object.keys(clips).join(' '), (fs.statSync(p).size / 1e6).toFixed(2), 'MB');
}
