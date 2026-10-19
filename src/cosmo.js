import * as THREE from 'three';
import { DOMES, DOME_R } from './layout.js';
import { homeFor } from './chogdata.js';

/*
 * Cosmo's dome (the user, 10-19): Cosmo the astronaut's own home dome on the middle island, like the
 * others but with a grey moon floor, hardly any flowers, his pod at the back and tiny space rocks
 * drifting in the air. Cosmo floats in it in zero g (src/npcs.js), and so does your Chog once it walks
 * in (src/travel.js asks zeroG()).
 *
 * buildCosmoDome(dome) puts its floor and rocks in the dome's group; island.js leaves the dome's garden
 * to a few rocks and flowers (its biome is 'moon').
 */

export const COSMO_ID = 68;
// His home, as every Chog's: by token id (src/chogdata.js).
export const COSMO_DOME = homeFor(COSMO_ID, DOMES.length);

const R = DOME_R;

// Deterministic randoms, so the floor and the rocks are the same on every load.
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The floor, in the dome's own frame (its door at +z, the pod at the back): a pale grey disc with craters
// whose rims stand a little proud and whose bowls dip, kept low along the path to the pod.
function moonFloor(dome) {
  const rnd = seeded(68);
  const RINGS = 44, SEG = 132, rad = R - 0.45;
  const onPath = (x, z) => z > dome.homeZ && Math.abs(x - Math.sin(z * 0.25) * 0.8) < 1.9;
  const craters = [];
  for (let tries = 0; tries < 200 && craters.length < 11; tries++) {
    const a = rnd() * Math.PI * 2, r = 2 + rnd() * (rad - 3.5), cr = 0.9 + rnd() * 2.2;
    const x = Math.sin(a) * r, z = Math.cos(a) * r;
    if (!dome.isClear(x, z, cr) || onPath(x, z) || Math.abs(x) < cr + 1.2) continue;
    if (craters.some(([cx, cz, c]) => Math.hypot(x - cx, z - cz) < c + cr + 0.8)) continue;
    craters.push([x, z, cr]);
  }
  const pos = [0, 0.05, 0], col = [], idx = [];
  const grey = new THREE.Color('#cfc9dc'), dark = new THREE.Color('#a49cb8'), c = new THREE.Color();
  col.push(grey.r, grey.g, grey.b);
  for (let i = 1; i <= RINGS; i++) {
    for (let s = 0; s < SEG; s++) {
      const a = (s / SEG) * Math.PI * 2, rr = (i / RINGS) * rad;
      const x = Math.sin(a) * rr, z = Math.cos(a) * rr;
      let y = 0.05 + Math.sin(x * 0.9 + 1) * Math.cos(z * 0.8) * 0.025;
      let bowl = 0;
      for (const [cx, cz, cr] of craters) {
        const d = Math.hypot(x - cx, z - cz) / cr;
        if (d < 1) bowl = Math.max(bowl, 1 - d * d);
        else if (d < 1.6) y += Math.sin(((d - 1) / 0.6) * Math.PI) * 0.09 * cr;
      }
      y = Math.max(0.012, y + 0.06 * (1 - bowl) - 0.06 * bowl * 0.2);
      if (onPath(x, z)) y = 0.008;
      // Flat at its edge, under the glass's plinth.
      y *= 1 - THREE.MathUtils.smoothstep(rr / rad, 0.9, 1);
      pos.push(x, y, z);
      c.copy(grey).lerp(dark, bowl * 0.7 + (rnd() - 0.5) * 0.12);
      col.push(c.r, c.g, c.b);
    }
  }
  for (let s = 0; s < SEG; s++) idx.push(0, 1 + s, 1 + ((s + 1) % SEG));
  for (let i = 1; i < RINGS; i++) {
    for (let s = 0; s < SEG; s++) {
      const a = 1 + (i - 1) * SEG + s, b = 1 + (i - 1) * SEG + ((s + 1) % SEG);
      idx.push(a, a + SEG, b, b, a + SEG, b + SEG);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const floor = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }));
  floor.receiveShadow = true;
  return floor;
}

// Tiny space rocks: lumpy, flat-shaded, each turning on its own axis and bobbing on its own beat.
function spaceRocks(dome) {
  const rnd = seeded(1968);
  const base = new THREE.IcosahedronGeometry(1, 1);
  const p = base.attributes.position;
  // The same lumps on every rock (they differ by size and turn), welded so it stays closed.
  const lump = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!lump.has(key)) lump.set(key, 0.72 + rnd() * 0.5);
    const k = lump.get(key);
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.85, p.getZ(i) * k);
  }
  base.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: '#bdb5cf', roughness: 0.9, flatShading: true });
  const N = 56;
  const mesh = new THREE.InstancedMesh(base, mat, N);
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  const rocks = [];
  const tint = new THREE.Color();
  for (let tries = 0; tries < 600 && rocks.length < N; tries++) {
    const a = rnd() * Math.PI * 2, r = rnd() * (R - 2.5);
    const x = Math.sin(a) * r, z = Math.cos(a) * r;
    const roof = Math.sqrt(R * R - r * r) - 1.2;
    const overPod = !dome.isClear(x, z, 1.5) && z < dome.homeZ + dome.home.front + 1;
    const lo = overPod ? 9.5 : 1.6;
    if (roof - lo < 1) continue;
    const size = rnd() < 0.12 ? 0.42 + rnd() * 0.25 : 0.1 + rnd() * 0.22;
    rocks.push({
      x, z, y: lo + rnd() * (roof - lo), size,
      axis: new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize(),
      spin: (0.15 + rnd() * 0.5) * (rnd() < 0.5 ? -1 : 1),
      bob: 0.15 + rnd() * 0.35, beat: 0.35 + rnd() * 0.5, k: rnd() * 10,
    });
    mesh.setColorAt(rocks.length - 1, tint.set('#bdb5cf').offsetHSL((rnd() - 0.5) * 0.04, 0, (rnd() - 0.5) * 0.12));
  }
  mesh.count = rocks.length;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3();
  const place = (t) => {
    rocks.forEach((rk, i) => {
      q.setFromAxisAngle(rk.axis, rk.k + t * rk.spin);
      v.set(rk.x, rk.y + Math.sin(t * rk.beat + rk.k) * rk.bob, rk.z);
      mesh.setMatrixAt(i, m4.compose(v, q, s.setScalar(rk.size)));
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
  place(0);
  return { mesh, place };
}

/** Cosmo's dome: dome is its Dome (src/dome.js). Returns { dome, update(dt, camera), zeroG(p), contains(p, margin) }. */
export function buildCosmoDome(dome) {
  const floor = moonFloor(dome);
  dome.group.add(floor);
  const rocks = spaceRocks(dome);
  dome.group.add(rocks.mesh);
  let t = 0;
  const local = new THREE.Vector3();
  const centre = new THREE.Vector3();
  return {
    dome,
    /** Whether a point (world) is where Chogs float: inside the glass, clear of the pod and the doorway. */
    zeroG(p) {
      local.copy(p);
      dome.group.worldToLocal(local);
      const r = Math.hypot(local.x, local.z);
      if (r > R - 1.6 || local.z > R - 2.8 || local.y < -2 || local.y > R) return false;
      // Not in his pod (its room is a room like any other).
      const h = dome.home;
      return !(Math.abs(local.x) < h.halfW + 0.8 && local.z > dome.homeZ + h.back - 0.8 && local.z < dome.homeZ + h.front + 0.8);
    },
    /** Whether a point (world) is under the glass, margin metres in from it (the camera keeps in while
     * you float). */
    contains(p, margin = 0) {
      local.copy(p);
      dome.group.worldToLocal(local);
      return local.y > -1 && local.length() < R - margin;
    },
    update(dt, camera) {
      t += dt;
      dome.group.getWorldPosition(centre);
      if (camera && camera.position.distanceTo(centre) > 150) return;
      rocks.place(t);
    },
  };
}
