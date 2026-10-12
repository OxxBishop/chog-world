import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WORLD, ISLANDS, BRIDGES } from './layout.js';

/*
 * Puffy low-poly clouds, built in code: a cluster of spheres merged into one shape, drawn as a
 * single instanced mesh with the same flat Lambert shading as the islands. Big ones bank up under
 * the islands so they float on a sea of clouds; small ones drift between the bridges.
 */

// One cloud, 1 unit wide, flat along the bottom.
function cloudGeometry() {
  // x, y, z, radius
  const balls = [
    [0, 0.2, 0, 0.3],
    [-0.27, 0.13, 0.05, 0.22],
    [0.29, 0.14, -0.04, 0.24],
    [0.09, 0.3, 0.12, 0.19],
    [-0.13, 0.27, -0.13, 0.18],
    [0.42, 0.07, 0.09, 0.14],
    [-0.43, 0.06, -0.07, 0.13],
    [0.04, 0.09, -0.22, 0.17],
  ];
  const geo = mergeGeometries(balls.map(([x, y, z, r]) => new THREE.IcosahedronGeometry(r, 1).translate(x, y, z)));
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, Math.max(pos.getY(i), 0));
  geo.computeVertexNormals();
  return geo;
}

const clearOf = (x, z, pad) =>
  ISLANDS.every((i) => Math.hypot(x - i.x, z - i.z) > i.r + pad) &&
  BRIDGES.every((b) => {
    const vx = b.bx - b.ax, vz = b.bz - b.az;
    const t = Math.min(1, Math.max(0, ((x - b.ax) * vx + (z - b.az) * vz) / (vx * vx + vz * vz)));
    return Math.hypot(x - (b.ax + vx * t), z - (b.az + vz * t)) > pad;
  });

export function buildClouds(scene, rng) {
  const sea = WORLD.cloudSeaY;
  const list = [];
  // The shape is half as tall as its height scale.
  const add = (x, y, z, width, height, sway) =>
    list.push({ x, y, z, width, height, depth: width * rng.range(0.6, 0.95), rot: rng() * Math.PI * 2, phase: rng() * 10, sway });

  // Banked up under every island, wrapping the rock.
  for (const isl of ISLANDS) {
    const n = 6;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + rng.range(-0.3, 0.3);
      const r = isl.r * rng.range(0.35, 1.05);
      // Tops stay below the grass: they wrap the rock, never poke through the lawn.
      add(isl.x + Math.cos(a) * r, sea + rng.range(-8, -2), isl.z + Math.sin(a) * r, rng.range(55, 85), rng.range(44, 56), 6);
    }
  }
  // A wider ring further out.
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + rng.range(-0.3, 0.3), r = rng.range(340, 560);
    const width = rng.range(90, 140);
    add(Math.cos(a) * r, sea + rng.range(-14, -4), Math.sin(a) * r, width, width * rng.range(0.55, 0.8), 14);
  }
  // Small ones at island height, between the bridges.
  for (let tries = 0; tries < 300 && list.length < 40; tries++) {
    const a = rng() * Math.PI * 2, r = rng.range(60, 300);
    const x = Math.cos(a) * r, z = Math.sin(a) * r, width = rng.range(16, 28);
    if (clearOf(x, z, width * 0.6 + 14)) add(x, rng.range(6, 24), z, width, width * rng.range(0.7, 1), 4);
  }

  const mat = new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true });
  const mesh = new THREE.InstancedMesh(cloudGeometry(), mat, list.length);
  mesh.frustumCulled = false;
  scene.add(mesh);

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const nightTint = new THREE.Color('#2a1f5c');
  return {
    update(env, t, horizon) {
      // A touch of the sky's colour so the shaded sides stay soft lilac instead of grey.
      mat.emissive.copy(horizon).multiplyScalar(0.22).lerp(nightTint, env.night * 0.6);
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        // Each cloud drifts slowly around its own spot, so none wander into an island.
        const x = c.x + Math.sin(t * 0.03 + c.phase) * c.sway;
        const z = c.z + Math.cos(t * 0.025 + c.phase) * c.sway;
        q.setFromAxisAngle(up, c.rot + Math.sin(t * 0.02 + c.phase) * 0.1);
        m.compose(p.set(x, c.y + Math.sin(t * 0.35 + c.phase) * 1.2, z), q, s.set(c.width, c.height, c.depth));
        mesh.setMatrixAt(i, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}
