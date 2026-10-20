/*
 * New bones in a cast model's skeleton (the dino came from Tripo without arms):
 *   node tools/models/fix/addbones.mjs <in.glb> <out.glb> <bones.json>
 * bones.json: [{ "name": "UpperArmL", "parent": "Chest", "at": [x, y, z] }, ...], each joint where it sits in
 * the bind pose (model space), turned like the model (no turn of its own), in order (a parent before its
 * children). They join the skin after its own joints, so JOINTS_0 keeps its numbers; patch.mjs writes the
 * weights that use them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import * as THREE from 'three';

const [src, dst, spec] = process.argv.slice(2);
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(src);
const root = doc.getRoot();
const skin = root.listSkins()[0];
const byName = (n) => root.listNodes().find((x) => x.getName() === n);
const ibmAcc = skin.getInverseBindMatrices();
const ibm = Array.from(ibmAcc.getArray());
for (const b of JSON.parse(fs.readFileSync(spec, 'utf8'))) {
  if (byName(b.name)) throw new Error(`${b.name} is already in the skeleton`);
  const parent = byName(b.parent);
  if (!parent) throw new Error(`no ${b.parent}`);
  // The parent's bind (its world, as the scene stands: the bind pose), so the new joint lands at `at` with
  // no turn of its own in model space.
  const pw = new THREE.Matrix4().fromArray(parent.getWorldMatrix());
  const pr = new THREE.Quaternion();
  pw.decompose(new THREE.Vector3(), pr, new THREE.Vector3());
  const local = new THREE.Vector3(...b.at).applyMatrix4(pw.clone().invert());
  const node = doc.createNode(b.name).setTranslation(local.toArray()).setRotation(pr.invert().toArray());
  parent.addChild(node);
  skin.addJoint(node);
  ibm.push(...new THREE.Matrix4().makeTranslation(-b.at[0], -b.at[1], -b.at[2]).toArray());
  console.log(b.name, 'under', b.parent, 'at', b.at.map((v) => v.toFixed(3)).join(' '));
}
skin.setInverseBindMatrices(doc.createAccessor().setType('MAT4').setArray(new Float32Array(ibm)).setBuffer(ibmAcc.getBuffer()));
ibmAcc.dispose();
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
await io.write(dst, doc);
console.log(path.basename(dst), skin.listJoints().length, 'joints', (fs.statSync(dst).size / 1e6).toFixed(2), 'MB');
