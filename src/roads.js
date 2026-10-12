import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ROADS, DOWNTOWN, roadDistance } from './layout.js';
import { heightAt, islandAt } from './terrain.js';

// Offset rows of pavers in warm stone tones, drawn once and tiled along each walkway.
function paverTexture() {
  const W = 256, H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#8c8074';
  ctx.fillRect(0, 0, W, H);
  const rows = 8, cols = 4;
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * 0.5;
    for (let k = -1; k <= cols; k++) {
      const x = ((k + off) / cols) * W, y = (r / rows) * H;
      const tone = 0.86 + rnd() * 0.2;
      const base = rnd() < 0.15 ? [214, 196, 236] : [226, 210, 184];
      ctx.fillStyle = `rgb(${base.map((v) => Math.round(v * tone)).join(',')})`;
      ctx.beginPath();
      ctx.roundRect(x + 3, y + 3, W / cols - 6, H / rows - 6, 5);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(x + 5, y + 4, W / cols - 12, 3);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Concentric paving for the downtown plaza.
function plazaTexture() {
  const S = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#8c8074';
  ctx.fillRect(0, 0, S, S);
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const cx = S / 2;
  const ringW = 26;
  for (let r = 30; r < S / 2; r += ringW) {
    const n = Math.max(6, Math.floor((Math.PI * 2 * r) / 44));
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2 + (r % 2) * 0.1, a1 = ((k + 1) / n) * Math.PI * 2 + (r % 2) * 0.1;
      const tone = 0.86 + rnd() * 0.2;
      const lilac = Math.floor(r / ringW) % 5 === 0;
      const base = lilac ? [206, 186, 238] : [228, 212, 186];
      ctx.fillStyle = `rgb(${base.map((v) => Math.round(v * tone)).join(',')})`;
      ctx.beginPath();
      ctx.arc(cx, cx, r + ringW - 3, a0 + 0.01, a1 - 0.01);
      ctx.arc(cx, cx, r + 3, a1 - 0.01, a0 + 0.01, true);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.fillStyle = '#d9c9ef';
  ctx.beginPath();
  ctx.arc(cx, cx, 27, 0, Math.PI * 2);
  ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// A flat strip following a polyline, lifted slightly off the ground.
function ribbon(points, closed, half, lift, offset = 0, vScale = 1) {
  const pts = closed ? [...points, points[0]] : points;
  const pos = [], uv = [], idx = [];
  let dist = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x, z] = pts[i];
    const prev = pts[Math.max(0, i - 1)], next = pts[Math.min(pts.length - 1, i + 1)];
    let tx = next[0] - prev[0], tz = next[1] - prev[1];
    if (closed && (i === 0 || i === pts.length - 1)) {
      const p = points[points.length - 1], n = points[1];
      tx = n[0] - p[0];
      tz = n[1] - p[1];
    }
    const tl = Math.hypot(tx, tz) || 1;
    const nx = -tz / tl, nz = tx / tl;
    if (i > 0) dist += Math.hypot(x - pts[i - 1][0], z - pts[i - 1][1]);
    for (const side of [-1, 1]) {
      const px = x + nx * (offset + side * half), pz = z + nz * (offset + side * half);
      pos.push(px, heightAt(px, pz) + lift, pz);
      uv.push(side < 0 ? 0 : 1, (dist / (half * 2)) * vScale);
    }
    if (i > 0) {
      const a = (i - 1) * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Densify a polyline so the strip hugs the ground.
function densify(points, closed, step = 2.5) {
  const out = [];
  const n = closed ? points.length : points.length - 1;
  for (let i = 0; i < n; i++) {
    const [ax, az] = points[i], [bx, bz] = points[(i + 1) % points.length];
    const len = Math.hypot(bx - ax, bz - az);
    const k = Math.max(1, Math.ceil(len / step));
    for (let j = 0; j < k; j++) out.push([ax + ((bx - ax) * j) / k, az + ((bz - az) * j) / k]);
  }
  if (!closed) out.push(points[points.length - 1]);
  return out;
}

export function buildRoads(scene) {
  const paver = paverTexture();
  const paveMat = new THREE.MeshLambertMaterial({ map: paver, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const curbMat = new THREE.MeshLambertMaterial({ color: '#efe8f6', polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });

  const paveGeos = [], curbGeos = [];
  const lampSpots = [];
  ROADS.forEach((road, ri) => {
    const pts = densify(road.points, road.closed);
    const half = road.width / 2;
    const lift = 0.06 + (ri % 3) * 0.004;
    paveGeos.push(ribbon(pts, road.closed, half, lift, 0, 1));
    curbGeos.push(ribbon(pts, road.closed, 0.22, lift + 0.08, half, 1));
    curbGeos.push(ribbon(pts, road.closed, 0.22, lift + 0.08, -half, 1));
    // Lamp posts every so often, alternating sides.
    if (road.kind !== 'drive') {
      let acc = 0, side = 1;
      for (let i = 1; i < pts.length; i++) {
        const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
        const seg = Math.hypot(bx - ax, bz - az);
        acc += seg;
        if (acc > 22) {
          acc = 0;
          side = -side;
          const nx = -(bz - az) / seg, nz = (bx - ax) / seg;
          const lx = bx + nx * side * (half + 0.9), lz = bz + nz * side * (half + 0.9);
          if (Math.hypot(lx - DOWNTOWN.x, lz - DOWNTOWN.z) > DOWNTOWN.r - 1 && roadDistance(lx, lz) > 0.4 && islandAt(lx, lz)) lampSpots.push([lx, lz]);
        }
      }
    }
  });
  const paving = new THREE.Mesh(mergeGeometries(paveGeos), paveMat);
  paving.receiveShadow = true;
  const curbs = new THREE.Mesh(mergeGeometries(curbGeos), curbMat);
  curbs.receiveShadow = true;
  scene.add(paving, curbs);

  // Downtown plaza.
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(DOWNTOWN.r, 96), new THREE.MeshLambertMaterial({ map: plazaTexture(), polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.set(DOWNTOWN.x, heightAt(DOWNTOWN.x, DOWNTOWN.z) + 0.09, DOWNTOWN.z);
  plaza.receiveShadow = true;
  scene.add(plaza);

  // Lamps: dark steel posts with a soft glowing globe.
  const poleGeo = new THREE.CylinderGeometry(0.07, 0.1, 3.6, 6);
  poleGeo.translate(0, 1.8, 0);
  const globeGeo = new THREE.SphereGeometry(0.26, 12, 8);
  globeGeo.translate(0, 3.75, 0);
  const steel = new THREE.MeshLambertMaterial({ color: '#2d2938' });
  const globeMat = new THREE.MeshStandardMaterial({ color: '#fff3dd', emissive: new THREE.Color('#ffd7a0'), emissiveIntensity: 0.2 });
  const poles = new THREE.InstancedMesh(poleGeo, steel, lampSpots.length);
  const globes = new THREE.InstancedMesh(globeGeo, globeMat, lampSpots.length);
  const m = new THREE.Matrix4();
  lampSpots.forEach(([x, z], i) => {
    m.makeTranslation(x, heightAt(x, z), z);
    poles.setMatrixAt(i, m);
    globes.setMatrixAt(i, m);
  });
  poles.castShadow = true;
  scene.add(poles, globes);

  return {
    lamps: lampSpots,
    update(env) {
      globeMat.emissiveIntensity = 0.2 + env.night * 7;
    },
  };
}
