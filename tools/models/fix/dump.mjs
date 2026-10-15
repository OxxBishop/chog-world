/*
 * Dump a cast model for the fixes in this folder: node tools/models/fix/dump.mjs <in.glb> <workdir>
 * Writes <workdir>/model.json (meshes, materials, images, skeleton) and, per mesh primitive, raw Float32 /
 * Uint32 arrays (pos, nrm, uv, joints, weights, index) plus every image as it is stored.
 */
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const [src, out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(src);
const root = doc.getRoot();
const info = { meshes: [], textures: [], materials: [], skins: [], nodes: [], animations: [] };
const f32 = (acc) => {
  const a = acc.getArray();
  const n = acc.getCount() * acc.getElementSize();
  const o = new Float32Array(n);
  for (let i = 0; i < acc.getCount(); i++) {
    const el = acc.getElement(i, []);
    for (let k = 0; k < el.length; k++) o[i * el.length + k] = el[k];
  }
  return o;
};
root.listTextures().forEach((t, i) => {
  const ext = t.getMimeType() === 'image/png' ? 'png' : 'jpg';
  fs.writeFileSync(path.join(out, `img${i}.${ext}`), t.getImage());
  info.textures.push({ i, name: t.getName(), uri: t.getURI(), mime: t.getMimeType(), size: t.getSize() });
});
root.listMaterials().forEach((m, i) => {
  const ti = (t) => (t ? root.listTextures().indexOf(t) : null);
  info.materials.push({ i, name: m.getName(), base: ti(m.getBaseColorTexture()), normal: ti(m.getNormalTexture()), mr: ti(m.getMetallicRoughnessTexture()), color: m.getBaseColorFactor(), metal: m.getMetallicFactor(), rough: m.getRoughnessFactor(), alpha: m.getAlphaMode() });
});
const nodes = root.listNodes();
nodes.forEach((n, i) => info.nodes.push({ i, name: n.getName(), t: n.getTranslation(), r: n.getRotation(), s: n.getScale(), children: n.listChildren().map((c) => nodes.indexOf(c)), mesh: n.getMesh() ? root.listMeshes().indexOf(n.getMesh()) : null, skin: n.getSkin() ? root.listSkins().indexOf(n.getSkin()) : null, world: n.getWorldMatrix() }));
root.listSkins().forEach((s) => info.skins.push({ joints: s.listJoints().map((j) => nodes.indexOf(j)), ibm: s.getInverseBindMatrices() ? Array.from(f32(s.getInverseBindMatrices())) : null }));
root.listAnimations().forEach((a) => info.animations.push({ name: a.getName(), channels: a.listChannels().map((c) => ({ node: nodes.indexOf(c.getTargetNode()), path: c.getTargetPath(), n: c.getSampler().getInput().getCount() })) }));
root.listMeshes().forEach((m, mi) => {
  const prims = [];
  m.listPrimitives().forEach((p, pi) => {
    const tag = `m${mi}p${pi}`;
    const rec = { tag, material: root.listMaterials().indexOf(p.getMaterial()), attrs: {} };
    for (const [k, file] of [['POSITION', 'pos'], ['NORMAL', 'nrm'], ['TEXCOORD_0', 'uv'], ['JOINTS_0', 'joints'], ['WEIGHTS_0', 'weights']]) {
      const a = p.getAttribute(k);
      if (!a) continue;
      fs.writeFileSync(path.join(out, `${tag}_${file}.f32`), Buffer.from(f32(a).buffer));
      rec.attrs[k] = { count: a.getCount(), size: a.getElementSize(), normalized: a.getNormalized(), type: a.getComponentType() };
    }
    const idx = p.getIndices();
    if (idx) fs.writeFileSync(path.join(out, `${tag}_index.u32`), Buffer.from(Uint32Array.from(idx.getArray()).buffer));
    rec.indexCount = idx?.getCount() ?? 0;
    prims.push(rec);
  });
  info.meshes.push({ i: mi, name: m.getName(), prims });
});
fs.writeFileSync(path.join(out, 'model.json'), JSON.stringify(info, null, 1));
console.log(path.basename(src), 'meshes', info.meshes.map((m) => `${m.name}[${m.prims.map((p) => p.attrs.POSITION?.count + 'v/' + p.indexCount / 3 + 't mat' + p.material).join(',')}]`).join(' '), '| textures', info.textures.map((t) => `${t.i}:${t.size?.join('x')}`).join(' '), '| mats', info.materials.map((m) => `${m.name}(b${m.base},n${m.normal},mr${m.mr})`).join(' '));
