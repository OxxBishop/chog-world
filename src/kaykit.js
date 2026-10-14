import * as THREE from 'three';
import { loadModel, loadPack, unpack } from './assets.js';

/*
 * KayKit kits by Kay Lousberg (CC0). Space Base Bits gives the modular pods, tubes and towers the hub,
 * homes and landmarks are built from; its colour atlas is recoloured to the world's lilac and pink.
 * Furniture Bits fills the rooms inside them. Each kit shares one material, so merged pieces cost one
 * draw call per kit.
 */

const kit = new Map();
const shared = new Map();

export async function loadKit(names, dir = 'kaykit', onProgress) {
  const pack = await loadPack(dir, (f) => onProgress?.(0.9 * f));
  let done = 0;
  await Promise.all(
    names.map(async (name) => {
      const scene = await loadModel(pack, dir, name);
      unpack(scene);
      scene.traverse((o) => {
        if (!o.isMesh) return;
        if (!shared.has(dir)) shared.set(dir, o.material);
        o.material = shared.get(dir);
      });
      kit.set(name, scene);
      onProgress?.(0.9 + (0.1 * ++done) / names.length);
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
 * material, faces turned up on the top half (the roof) come away into their own mesh in it. isRoof
 * can pick the roof faces another way: it gets the face normal, the face's height as a share of the
 * piece's height, and its atlas cell.
 */
export function repaint(obj, swaps, roofMat = null, isRoof = (n, h) => n.y > 0.6 && h > 0.55) {
  const map = new Map(Object.entries(swaps).map(([from, to]) => [key(CELL[from]), CELL[to]]));
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
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
      const cu = Math.floor(((uv.getX(t) + uv.getX(t + 1) + uv.getX(t + 2)) / 3) * 8);
      const cv = Math.floor(((uv.getY(t) + uv.getY(t + 1) + uv.getY(t + 2)) / 3) * 4);
      const to = map.get(`${cu},${cv}`);
      const h = ((a.y + b.y + c.y) / 3 - box.min.y) / (box.max.y - box.min.y);
      const out = roofMat && isRoof(n, h, [cu, cv]) ? roof : keep;
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

/*
 * Cut a passage through kit pieces: every face loses exactly the part of it inside box (a Box3 in
 * root's space), clipped, not dropped, so the wall around the opening stays whole. Normals and UVs
 * carry over, so the cut faces look as they did.
 */
export function carve(obj, box, root = obj) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const lo = box.min.toArray(), hi = box.max.toArray();
  const v = new THREE.Vector3();
  const lerp = (a, b, s) => a.map((x, i) => x + (b[i] - x) * s);
  const mix = (a, b, s) => ({ w: lerp(a.w, b.w, s), p: lerp(a.p, b.p, s), n: lerp(a.n, b.n, s), t: lerp(a.t, b.t, s) });
  // The part of a convex polygon with its axis coordinate at most c (below) or at least c.
  const clip = (poly, ax, c, below) => {
    const res = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const da = below ? c - a.w[ax] : a.w[ax] - c, db = below ? c - b.w[ax] : b.w[ax] - c;
      if (da >= 0) res.push(a);
      if (da >= 0 !== db >= 0) res.push(mix(a, b, da / (da - db)));
    }
    return res;
  };
  const meshes = [];
  obj.traverse((o) => o.isMesh && meshes.push(o));
  for (const o of meshes) {
    const M = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
    const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
    const out = { position: [], normal: [], uv: [] };
    const emit = (poly) => {
      for (let i = 1; i < poly.length - 1; i++) {
        for (const q of [poly[0], poly[i], poly[i + 1]]) {
          out.position.push(...q.p);
          out.normal.push(...q.n);
          out.uv.push(...q.t);
        }
      }
    };
    const vert = (k) => ({
      w: v.fromBufferAttribute(pos, k).applyMatrix4(M).toArray(),
      p: [pos.getX(k), pos.getY(k), pos.getZ(k)],
      n: [nor.getX(k), nor.getY(k), nor.getZ(k)],
      t: uv ? [uv.getX(k), uv.getY(k)] : [0, 0],
    });
    let cut = false;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let k = 0; k < pos.count; k += 3) {
      // Most faces are nowhere near the box: test them cheaply and copy them as they are.
      a.fromBufferAttribute(pos, k).applyMatrix4(M);
      b.fromBufferAttribute(pos, k + 1).applyMatrix4(M);
      c.fromBufferAttribute(pos, k + 2).applyMatrix4(M);
      const touches = [0, 1, 2].every((ax) => Math.max(a.getComponent(ax), b.getComponent(ax), c.getComponent(ax)) > lo[ax] && Math.min(a.getComponent(ax), b.getComponent(ax), c.getComponent(ax)) < hi[ax]);
      if (!touches) {
        for (let q = k; q < k + 3; q++) {
          out.position.push(pos.getX(q), pos.getY(q), pos.getZ(q));
          out.normal.push(nor.getX(q), nor.getY(q), nor.getZ(q));
          out.uv.push(uv ? uv.getX(q) : 0, uv ? uv.getY(q) : 0);
        }
        continue;
      }
      let poly = [vert(k), vert(k + 1), vert(k + 2)];
      cut = true;
      // Peel off what lies below and above the box on each axis in turn; what is left is inside it.
      for (let ax = 0; ax < 3 && poly.length >= 3; ax++) {
        emit(clip(poly, ax, lo[ax], true));
        emit(clip(poly, ax, hi[ax], false));
        poly = clip(clip(poly, ax, lo[ax], false), ax, hi[ax], true);
      }
    }
    if (!cut) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(out.position, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(out.normal, 3));
    if (uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(out.uv, 2));
    o.geometry = geo;
  }
}
