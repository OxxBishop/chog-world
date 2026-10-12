import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ISLANDS, BRIDGES } from './layout.js';
import { undersidePoint, rimPoint } from './terrain.js';
import { rockGeometry } from './skyfx.js';

/*
 * What hangs below each island, so no two read the same from below: glowing crystals and rock
 * spikes under downtown, roots under the first neighbourhood, chains under the second, vines by
 * the third's waterfalls. Plus rocky ledges jutting from the cliffs of every island.
 */

// A tapered strand along a curve, thick at the top and thin at the tip.
function strand(points, r0, r1, sides = 6) {
  const curve = new THREE.CatmullRomCurve3(points);
  const N = Math.max(4, points.length * 3);
  const frames = curve.computeFrenetFrames(N, false);
  const pos = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const p = curve.getPointAt(t);
    const r = r0 + (r1 - r0) * Math.pow(t, 0.8);
    for (let j = 0; j <= sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      const n = frames.normals[i].clone().multiplyScalar(Math.cos(a)).addScaledVector(frames.binormals[i], Math.sin(a));
      pos.push(p.x + n.x * r, p.y + n.y * r, p.z + n.z * r);
    }
  }
  const row = sides + 1;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < sides; j++) {
      const a = i * row + j, b = a + 1, c = a + row, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// A hanging line that wanders a little as it drops.
function droop(top, length, rng, wander = 3) {
  const pts = [];
  const seg = 6;
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    pts.push(new THREE.Vector3(top.x + Math.sin(t * 3 + top.x) * wander * t + rng.range(-0.6, 0.6) * t, top.y - length * t, top.z + Math.cos(t * 2.4 + top.z) * wander * t + rng.range(-0.6, 0.6) * t));
  }
  return pts;
}

function crystals(isl, rng, group, glow) {
  const geos = [];
  const prism = new THREE.CylinderGeometry(1, 1, 1, 6, 1).translate(0, -0.5, 0);
  const tip = new THREE.ConeGeometry(1, 0.6, 6).rotateX(Math.PI).translate(0, -1.3, 0);
  const shard = mergeGeometries([prism, tip]);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  for (let c = 0; c < 26; c++) {
    const base = undersidePoint(isl, rng() * Math.PI * 2, rng.range(0.12, 0.75));
    for (let k = 0; k < rng.range(3, 7); k++) {
      const dir = new THREE.Vector3(rng.range(-0.6, 0.6), -1, rng.range(-0.6, 0.6)).normalize();
      q.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
      const len = rng.range(3, 10), r = rng.range(0.5, 1.5);
      geos.push(shard.clone().applyMatrix4(m.compose(base, q, s.set(r, len, r))));
    }
  }
  const mesh = new THREE.Mesh(mergeGeometries(geos), glow);
  group.add(mesh);
  // Big rock spikes give downtown a broad, many-pointed underside.
  const rock = new THREE.MeshLambertMaterial({ color: '#5e4f6a', flatShading: true });
  const spikes = [];
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const p = undersidePoint(isl, a, rng.range(0.25, 0.45));
    const len = rng.range(28, 46), r = rng.range(9, 14);
    const cone = new THREE.ConeGeometry(r, len, 9, 4).rotateX(Math.PI).translate(p.x, p.y - len / 2 + 4, p.z);
    const pos = cone.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setX(i, pos.getX(i) + Math.sin(pos.getY(i) * 0.3 + k) * 1.2);
    cone.computeVertexNormals();
    spikes.push(cone);
  }
  group.add(new THREE.Mesh(mergeGeometries(spikes), rock));
}

function roots(isl, rng, group) {
  const geos = [];
  for (let i = 0; i < 46; i++) {
    const top = undersidePoint(isl, rng() * Math.PI * 2, rng.range(0.05, 0.8));
    top.y += 1.5;
    geos.push(strand(droop(top, rng.range(10, 36), rng, rng.range(1.5, 5)), rng.range(0.45, 1.1), 0.06));
  }
  group.add(new THREE.Mesh(mergeGeometries(geos), new THREE.MeshLambertMaterial({ color: '#6b4a34' })));
}

function chains(isl, rng, group) {
  const link = new THREE.TorusGeometry(0.55, 0.15, 6, 12);
  const mats = [];
  const anchors = [];
  for (let k = 0; k < 4; k++) anchors.push(undersidePoint(isl, (k / 4) * Math.PI * 2 + 0.4, k % 2 ? 0.34 : 0.67));
  for (const a of anchors) {
    const n = 64;
    for (let i = 0; i < n; i++) {
      const m = new THREE.Matrix4();
      const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, i % 2 ? Math.PI / 2 : 0, 0));
      m.compose(new THREE.Vector3(a.x, a.y - 0.4 - i * 0.82, a.z), rot, new THREE.Vector3(1, 1, 1));
      mats.push(m);
    }
  }
  const steel = new THREE.MeshStandardMaterial({ color: '#8f8aa3', roughness: 0.45, metalness: 0.8 });
  const mesh = new THREE.InstancedMesh(link, steel, mats.length);
  mats.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.castShadow = true;
  group.add(mesh);
}

function vines(isl, rng, group) {
  const geos = [];
  const leafy = [];
  for (let i = 0; i < 60; i++) {
    const top = rimPoint(isl, rng() * Math.PI * 2, 1.0);
    top.y -= 0.6;
    const pts = droop(top, rng.range(6, 22), rng, 0.8);
    geos.push(strand(pts, 0.14, 0.05, 4));
    // A few leaves down each vine.
    for (let k = 1; k < 6; k++) {
      const p = pts[k];
      leafy.push(new THREE.IcosahedronGeometry(rng.range(0.4, 0.8), 0).scale(1, 0.6, 1).translate(p.x + rng.range(-0.3, 0.3), p.y, p.z + rng.range(-0.3, 0.3)));
    }
  }
  group.add(new THREE.Mesh(mergeGeometries(geos), new THREE.MeshLambertMaterial({ color: '#3f7f2f' })));
  group.add(new THREE.Mesh(mergeGeometries(leafy), new THREE.MeshLambertMaterial({ color: '#5aa83a', flatShading: true })));
}

// Rocky shelves jutting from the cliffs a little below the rim, away from the bridges.
function ledges(isl, rng, group, mat) {
  const avoid = BRIDGES.map((b) => (isl.id === 'downtown' ? b.angle : isl.id === `hood${b.hood}` ? b.angle + Math.PI : null)).filter((a) => a !== null);
  const gap = (a, b) => Math.abs(((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  let placed = 0;
  for (let tries = 0; tries < 40 && placed < 3; tries++) {
    const a = rng() * Math.PI * 2;
    if (avoid.some((b) => gap(a, b) < 0.5)) continue;
    const rim = rimPoint(isl, a, 1.0);
    const r = rng.range(6, 11);
    const rock = new THREE.Mesh(rockGeometry(r, r * rng.range(1.2, 1.8), rng() * 100), mat);
    rock.position.set(rim.x + Math.cos(a) * r * 0.55, rim.y - rng.range(2.5, 6), rim.z + Math.sin(a) * r * 0.55);
    rock.rotation.y = rng() * Math.PI * 2;
    rock.receiveShadow = true;
    rock.castShadow = true;
    group.add(rock);
    placed++;
  }
}

export function buildUndersides(scene, rng) {
  const group = new THREE.Group();
  const glow = new THREE.MeshStandardMaterial({ color: '#c9b3ff', emissive: new THREE.Color('#9b6bff'), emissiveIntensity: 0.3, roughness: 0.25, metalness: 0.1, flatShading: true });
  const ledgeMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  for (const isl of ISLANDS) {
    if (isl.under === 'crystal') crystals(isl, rng, group, glow);
    if (isl.under === 'roots') roots(isl, rng, group);
    if (isl.under === 'chains') chains(isl, rng, group);
    if (isl.under === 'falls') vines(isl, rng, group);
    ledges(isl, rng, group, ledgeMat);
  }
  scene.add(group);
  return {
    update(env) {
      glow.emissiveIntensity = 0.3 + env.night * 1.8;
    },
  };
}
