import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/*
 * KayKit kits by Kay Lousberg (CC0). Space Base Bits gives the modular pods, tubes and towers the hub,
 * homes and landmarks are built from; its colour atlas is recoloured to the world's lilac and pink.
 * Furniture Bits fills the rooms inside them. Each kit shares one material, so merged pieces cost one
 * draw call per kit.
 */

const ROOT = `${import.meta.env.BASE_URL}assets/`;
const kit = new Map();
const shared = new Map();

export async function loadKit(names, dir = 'kaykit') {
  const loader = new GLTFLoader();
  await Promise.all(
    names.map(async (name) => {
      const gltf = await loader.loadAsync(`${ROOT}${dir}/${name}.gltf`);
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        if (!shared.has(dir)) shared.set(dir, o.material);
        o.material = shared.get(dir);
      });
      kit.set(name, gltf.scene);
    }),
  );
}

/** A fresh copy of a kit piece at the given scale, casting and receiving shadows. */
export function piece(name, scale = 1) {
  const src = kit.get(name);
  if (!src) throw new Error(`Kit piece not loaded: ${name}`);
  const g = src.clone(true);
  g.scale.setScalar(scale);
  g.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return g;
}

export const kitMaterial = (dir = 'kaykit') => shared.get(dir);

// Colour cells (column, row) in the Space Base Bits 8 x 4 texture atlas.
export const CELL = {
  white: [1, 0], grey: [2, 0], dark: [3, 0], purple: [3, 1], lilac: [5, 1],
  charcoal: [0, 0], taupe: [6, 1], brown: [7, 1], gold: [0, 2],
  green: [2, 2], teal: [1, 2], sky: [0, 1], pink: [7, 2],
};
const key = ([c, r]) => `${c},${r}`;

/*
 * Give a kit piece its own colours without new textures: move each face's UVs to another cell of the
 * atlas, keeping its place in the cell so the cell's shading gradient still reads. With a roof
 * material, faces turned up on the top half (the roof) come away into their own mesh in it.
 */
export function repaint(obj, swaps, roofMat = null) {
  const map = new Map(Object.entries(swaps).map(([from, to]) => [key(CELL[from]), CELL[to]]));
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const roofY = box.min.y + (box.max.y - box.min.y) * 0.55;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  const meshes = [];
  obj.traverse((o) => o.isMesh && meshes.push(o));
  for (const o of meshes) {
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    const pos = g.attributes.position, uv = g.attributes.uv, nor = g.attributes.normal;
    const keep = { position: [], normal: [], uv: [] };
    const roof = { position: [], normal: [], uv: [] };
    for (let t = 0; t < pos.count; t += 3) {
      a.fromBufferAttribute(pos, t).applyMatrix4(o.matrixWorld);
      b.fromBufferAttribute(pos, t + 1).applyMatrix4(o.matrixWorld);
      c.fromBufferAttribute(pos, t + 2).applyMatrix4(o.matrixWorld);
      n.subVectors(b, a).cross(c.clone().sub(a)).normalize();
      const isRoof = roofMat && n.y > 0.6 && (a.y + b.y + c.y) / 3 > roofY;
      const cu = Math.floor(((uv.getX(t) + uv.getX(t + 1) + uv.getX(t + 2)) / 3) * 8);
      const cv = Math.floor(((uv.getY(t) + uv.getY(t + 1) + uv.getY(t + 2)) / 3) * 4);
      const to = map.get(`${cu},${cv}`);
      const out = isRoof ? roof : keep;
      for (let k = t; k < t + 3; k++) {
        out.position.push(pos.getX(k), pos.getY(k), pos.getZ(k));
        out.normal.push(nor.getX(k), nor.getY(k), nor.getZ(k));
        if (to) out.uv.push((to[0] + (uv.getX(k) * 8 - cu)) / 8, (to[1] + (uv.getY(k) * 4 - cv)) / 4);
        else out.uv.push(uv.getX(k), uv.getY(k));
      }
    }
    const build = (d) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(d.position, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(d.normal, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(d.uv, 2));
      return geo;
    };
    o.geometry = build(keep);
    if (roof.position.length) {
      const r = new THREE.Mesh(build(roof), roofMat);
      r.userData.roof = true;
      o.add(r);
    }
  }
}
