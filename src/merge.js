import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Bake every plain mesh under `group` into one mesh per material (in the group's space).
 * Lights, instanced meshes and anything flagged keep: true stay as they are.
 */
export function mergeByMaterial(group) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const buckets = new Map();
  const remove = [];
  group.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.userData.keep || o === group) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    const key = o.material;
    if (!buckets.has(key)) buckets.set(key, { geos: [], cast: false, receive: false });
    const b = buckets.get(key);
    b.geos.push(g);
    b.cast ||= o.castShadow;
    b.receive ||= o.receiveShadow;
    remove.push(o);
  });
  for (const o of remove) o.parent.remove(o);
  for (const [mat, b] of buckets) {
    const mesh = new THREE.Mesh(mergeGeometries(b.geos), mat);
    mesh.castShadow = b.cast;
    mesh.receiveShadow = b.receive;
    group.add(mesh);
  }
}
