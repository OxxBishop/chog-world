/*
 * The singer rebuilt on the plain Chog's body (the user, 10-16): the old Tripo singer was the weakest model
 * in the cast. Its stage disc stays (cut from the old file, its own texture), the body is the plain Chog's
 * (clean texture, the cast's clips and face sheet), lifted onto the disc, and a handheld mic sits in its
 * right hand.
 *   node tools/models/fix/singer_rebuild.mjs <plain.glb> <old singer (JPEG)> <out.glb> [mic=x,y,z,rx,ry,rz]
 * Then addclips.mjs (Sing, from bake.html's singer source) and ktx2.mjs (the stage's texture).
 * mic: the mic's place in the right hand bone's frame (metres) and turn (degrees), for tuning.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const [plainPath, oldPath, outPath, micArg] = process.argv.slice(2);
// The stage disc's top in the old file: the body stands on it.
const STAGE_TOP = 0.258;
const mic = (micArg ?? '0.06,0.0,0.0,0,0,0').split(',').map(Number);
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(plainPath);
const old = await io.read(oldPath);
const root = doc.getRoot();
const buffer = root.listBuffers()[0];
const nodes = new Map(root.listNodes().map((n) => [n.getName(), n]));

// The body up onto the disc: the skeleton's root joint rises (its clips never move it).
const rootJoint = nodes.get('Root');
const t = rootJoint.getTranslation();
rootJoint.setTranslation([t[0], t[1] + STAGE_TOP, t[2]]);
// Tripo's own walk and run drove the Root too, and nothing plays them on the stage.
for (const a of root.listAnimations()) if (['Walk', 'Run'].includes(a.getName())) a.dispose();

// ---------- the stage disc, from the old singer: the triangles only its Root holds ----------
const oprim = old.getRoot().listMeshes()[0].listPrimitives()[0];
const el = [];
const read = (acc) => {
  const n = acc.getCount(), k = acc.getElementSize(), outA = new Float32Array(n * k);
  for (let i = 0; i < n; i++) {
    acc.getElement(i, el);
    for (let j = 0; j < k; j++) outA[i * k + j] = el[j];
  }
  return outA;
};
const P = read(oprim.getAttribute('POSITION')), N = read(oprim.getAttribute('NORMAL')), UV = read(oprim.getAttribute('TEXCOORD_0'));
const J = read(oprim.getAttribute('JOINTS_0')), Wt = read(oprim.getAttribute('WEIGHTS_0'));
const idx = oprim.getIndices().getArray();
const oldJoints = old.getRoot().listSkins()[0].listJoints().map((j) => j.getName());
const rootI = oldJoints.indexOf('Root');
const rootW = (v) => {
  let w = 0;
  for (let k = 0; k < 4; k++) if (J[v * 4 + k] === rootI) w += Wt[v * 4 + k];
  return w;
};
const remap = new Map(), pos = [], nrm = [], uv = [], tri = [];
for (let i = 0; i < idx.length; i += 3) {
  const vs = [idx[i], idx[i + 1], idx[i + 2]];
  if (!vs.every((v) => rootW(v) > 0.6)) continue;
  for (const v of vs) {
    if (!remap.has(v)) {
      remap.set(v, pos.length / 3);
      pos.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
      nrm.push(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]);
      uv.push(UV[v * 2], UV[v * 2 + 1]);
    }
    tri.push(remap.get(v));
  }
}
const oldBase = old.getRoot().listMaterials()[0].getBaseColorTexture();
const stageTex = doc.createTexture('stage').setImage(oldBase.getImage()).setMimeType(oldBase.getMimeType());
const stageMat = doc.createMaterial('stage').setBaseColorTexture(stageTex).setRoughnessFactor(0.75).setMetallicFactor(0);
const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
const stagePrim = doc.createPrimitive().setMaterial(stageMat)
  .setAttribute('POSITION', acc('VEC3', new Float32Array(pos)))
  .setAttribute('NORMAL', acc('VEC3', new Float32Array(nrm)))
  .setAttribute('TEXCOORD_0', acc('VEC2', new Float32Array(uv)))
  .setIndices(acc('SCALAR', new Uint32Array(tri)));
const scene = root.listScenes()[0];
scene.addChild(doc.createNode('Stage').setMesh(doc.createMesh('Stage').addPrimitive(stagePrim)));
console.log('stage:', tri.length / 3, 'triangles,', pos.length / 3, 'vertices');

// ---------- the mic: a round grille, a silver collar, a dark handle ----------
function addGeometry(mesh, geo, material) {
  const g = geo.toNonIndexed ? geo : geo;
  g.computeVertexNormals();
  const p = doc.createPrimitive().setMaterial(material)
    .setAttribute('POSITION', acc('VEC3', new Float32Array(g.attributes.position.array)))
    .setAttribute('NORMAL', acc('VEC3', new Float32Array(g.attributes.normal.array)));
  if (g.index) p.setIndices(acc('SCALAR', new Uint32Array(g.index.array)));
  mesh.addPrimitive(p);
}
const grille = doc.createMaterial('mic grille').setBaseColorFactor([0.62, 0.64, 0.7, 1]).setMetallicFactor(0.6).setRoughnessFactor(0.38);
const collar = doc.createMaterial('mic collar').setBaseColorFactor([0.85, 0.86, 0.9, 1]).setMetallicFactor(0.9).setRoughnessFactor(0.25);
const body = doc.createMaterial('mic body').setBaseColorFactor([0.13, 0.11, 0.17, 1]).setMetallicFactor(0.2).setRoughnessFactor(0.5);
const micMesh = doc.createMesh('Mic');
// Along +y from the grip: the handle (grip at the origin), the collar, the grille on top.
const K = 1.5;
addGeometry(micMesh, new THREE.CylinderGeometry(0.026 * K, 0.019 * K, 0.17 * K, 20, 1), body);
addGeometry(micMesh, new THREE.CylinderGeometry(0.034 * K, 0.028 * K, 0.03 * K, 24, 1).translate(0, 0.098 * K, 0), collar);
addGeometry(micMesh, new THREE.SphereGeometry(0.046 * K, 24, 16).translate(0, 0.14 * K, 0), grille);
// Held upright in the fist in the bind's T-pose (the grip a little past the wrist, along the hand), so a
// raised forearm brings the grille to the mouth; mic= nudges it: along the hand, up, forward (metres), then
// tilts toward the body, forward, and a spin (degrees).
const handR = nodes.get('HandR'), foreR = nodes.get('ForeArmR');
const m4 = (n) => new THREE.Matrix4().fromArray(n.getWorldMatrix());
const handW = m4(handR), foreW = m4(foreR);
const hp = new THREE.Vector3().setFromMatrixPosition(handW), fp = new THREE.Vector3().setFromMatrixPosition(foreW);
const along = hp.clone().sub(fp).normalize();
const grip = hp.clone().addScaledVector(along, mic[0]).add(new THREE.Vector3(0, mic[1], mic[2]));
const [tiltIn, tiltFwd, spin] = mic.slice(3, 6).map(THREE.MathUtils.degToRad);
const worldQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(tiltFwd, spin, -tiltIn * Math.sign(along.x || 1), 'XYZ'));
const micWorld = new THREE.Matrix4().compose(grip, worldQ, new THREE.Vector3(1, 1, 1));
const local = handW.clone().invert().multiply(micWorld);
const lp = new THREE.Vector3(), lq = new THREE.Quaternion(), ls = new THREE.Vector3();
local.decompose(lp, lq, ls);
const micNode = doc.createNode('Mic').setMesh(micMesh).setTranslation(lp.toArray()).setRotation(lq.toArray()).setScale(ls.toArray());
handR.addChild(micNode);
console.log('mic grip (bind, world):', grip.toArray().map((v) => v.toFixed(3)).join(', '), 'hand scale', ls.toArray().map((v) => v.toFixed(3)).join(','));

await doc.transform(prune({ keepAttributes: true }));
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
await io.write(outPath, doc);
console.log(path.basename(outPath), (fs.statSync(outPath).size / 1e6).toFixed(2), 'MB');
