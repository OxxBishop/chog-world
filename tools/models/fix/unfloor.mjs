/*
 * A generated model (Hunyuan3D and the like) without the floor it made from its picture's ground: every
 * triangle in the slab at the bottom (up to the top of the wide floor, plus `--slab` of the body's height)
 * and outside the feet is
 * dropped, and the vertices nothing uses any more with it.
 *   node tools/models/fix/unfloor.mjs <in.glb> <out.glb> [--slab 0.01]
 */
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const [src, dst, ...rest] = process.argv.slice(2);
const opt = {};
for (let i = 0; i < rest.length; i += 2) opt[rest[i].replace(/^--/, '')] = rest[i + 1];
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(src);
let dropped = 0, kept = 0;
for (const mesh of doc.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    const n = pos.getCount();
    const P = new Float32Array(n * 3);
    const v = [];
    for (let i = 0; i < n; i++) (pos.getElement(i, v), P.set(v, i * 3));
    // The model's up axis: glTF's +Y.
    let ymin = Infinity, ymax = -Infinity;
    for (let i = 0; i < n; i++) (ymin = Math.min(ymin, P[i * 3 + 1])), (ymax = Math.max(ymax, P[i * 3 + 1]));
    // The floor: a wide thin slab at the bottom. Its top is the highest of the vertices far out to the
    // side (beyond 60% of the widest reach); everything up to it, outside the feet, goes.
    let R = 0;
    for (let i = 0; i < n; i++) R = Math.max(R, Math.hypot(P[i * 3], P[i * 3 + 2]));
    let top = ymin;
    for (let i = 0; i < n; i++) if (Math.hypot(P[i * 3], P[i * 3 + 2]) > R * 0.6) top = Math.max(top, P[i * 3 + 1]);
    const H = ymax - top;
    const slab = top + H * +(opt.slab ?? 0.01);
    // The feet's footprint: the body just over the floor (1% to 12% of its height up), near the middle.
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const y = P[i * 3 + 1];
      if (y < top + H * 0.01 || y > top + H * 0.12 || Math.hypot(P[i * 3], P[i * 3 + 2]) > R * 0.5) continue;
      x0 = Math.min(x0, P[i * 3]), x1 = Math.max(x1, P[i * 3]), z0 = Math.min(z0, P[i * 3 + 2]), z1 = Math.max(z1, P[i * 3 + 2]);
    }
    const gx = (x1 - x0) * 0.1, gz = (z1 - z0) * 0.1;
    const inFeet = (i) => P[i * 3] > x0 - gx && P[i * 3] < x1 + gx && P[i * 3 + 2] > z0 - gz && P[i * 3 + 2] < z1 + gz;
    const idx = prim.getIndices();
    const I = idx.getArray();
    const out = [];
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t], b = I[t + 1], c = I[t + 2];
      const low = P[a * 3 + 1] < slab && P[b * 3 + 1] < slab && P[c * 3 + 1] < slab;
      if (low && !(inFeet(a) && inFeet(b) && inFeet(c))) {
        dropped++;
        continue;
      }
      out.push(a, b, c);
      kept++;
    }
    idx.setArray(new Uint32Array(out));
    console.log(`height ${H.toFixed(3)}, slab under ${slab.toFixed(3)}, feet x ${x0.toFixed(2)}..${x1.toFixed(2)} z ${z0.toFixed(2)}..${z1.toFixed(2)}`);
  }
}
await doc.transform(prune());
await io.write(dst, doc);
console.log(path.basename(dst), `kept ${kept} triangles, dropped ${dropped}`, (fs.statSync(dst).size / 1e6).toFixed(2), 'MB');
