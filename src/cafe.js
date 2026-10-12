import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Collects geometry per material and merges it, so a whole building costs a handful of draw calls.
class Builder {
  constructor() {
    this.byMat = new Map();
  }
  add(geo, mat, x = 0, y = 0, z = 0, ry = 0, rx = 0) {
    const g = geo.clone();
    if (rx) g.rotateX(rx);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    if (g.index === null) g.setIndex([...Array(g.attributes.position.count).keys()]);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!this.byMat.has(mat)) this.byMat.set(mat, []);
    this.byMat.get(mat).push(g);
  }
  box(w, h, d, mat, x, y, z, ry = 0) {
    this.add(new THREE.BoxGeometry(w, h, d), mat, x, y, z, ry);
  }
  build(group, { shadows = true } = {}) {
    for (const [mat, geos] of this.byMat) {
      const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
      mesh.castShadow = shadows && !mat.transparent;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
}

function stripes() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 8;
  const ctx = c.getContext('2d');
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 ? '#fbf6ff' : '#9d7bf2';
    ctx.fillRect(i * 16, 0, 16, 8);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

function signTexture(text) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 192;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#2a2140';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#f4efff';
  ctx.font = '600 120px Fredoka, "Trebuchet MS", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, c.width / 2, c.height / 2 + 6);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/**
 * Downtown café. Origin is the middle of the building footprint at ground level; the front faces +z.
 * Returns the group, the seats (for Chogs later) and a night-light hook.
 */
export function makeCafe() {
  const group = new THREE.Group();
  const b = new Builder();

  const plaster = new THREE.MeshLambertMaterial({ color: '#f4f1f8' });
  const timber = new THREE.MeshLambertMaterial({ color: '#c58a5a' });
  const dark = new THREE.MeshLambertMaterial({ color: '#2b2735' });
  const deck = new THREE.MeshLambertMaterial({ color: '#d7b48a' });
  const counter = new THREE.MeshLambertMaterial({ color: '#8f74d6' });
  const glass = new THREE.MeshPhysicalMaterial({ color: '#2a2f55', roughness: 0.05, metalness: 0.1, envMapIntensity: 1.5, emissive: new THREE.Color('#ffc890'), emissiveIntensity: 0.1, transparent: true, opacity: 0.55 });
  const awningMat = new THREE.MeshLambertMaterial({ map: stripes(), side: THREE.DoubleSide });
  const chairA = new THREE.MeshLambertMaterial({ color: '#b79cff' });
  const chairB = new THREE.MeshLambertMaterial({ color: '#fdf8ff' });
  const tableMat = new THREE.MeshLambertMaterial({ color: '#efe6da' });
  const canopyA = new THREE.MeshLambertMaterial({ color: '#a884ff', side: THREE.DoubleSide });
  const canopyB = new THREE.MeshLambertMaterial({ color: '#fff4e6', side: THREE.DoubleSide });
  const bulbMat = new THREE.MeshStandardMaterial({ color: '#fff4dc', emissive: new THREE.Color('#ffd49a'), emissiveIntensity: 0.3 });
  const signTex = signTexture('Chog Hub');
  const signMat = new THREE.MeshStandardMaterial({ map: signTex, emissive: new THREE.Color('#ffffff'), emissiveMap: signTex, emissiveIntensity: 0 });

  // Building shell.
  b.box(14, 0.3, 9, dark, 0, 0.15, 0);
  b.box(0.3, 4.6, 9, plaster, -7, 2.6, 0);
  b.box(0.3, 4.6, 9, plaster, 7, 2.6, 0);
  b.box(14, 4.6, 0.3, plaster, 0, 2.6, -4.5);
  b.box(4, 4.6, 0.3, timber, -5, 2.6, 4.5);
  b.box(15, 0.45, 10, dark, 0, 5.1, 0);
  // Front glazing with mullions and a door.
  b.box(10, 4.1, 0.08, glass, 2, 2.35, 4.52);
  for (const x of [-3, -0.5, 2, 4.5, 7]) b.box(0.12, 4.2, 0.16, dark, x, 2.4, 4.55);
  b.box(10.1, 0.12, 0.16, dark, 2, 4.45, 4.55);
  b.box(1.3, 2.5, 0.1, counter, -5, 1.25, 4.62);
  // Inside: a counter you can see through the glass, and pendant lamps.
  b.box(6, 1.1, 1.2, counter, 1.5, 0.85, -2.2);
  b.box(6.2, 0.1, 1.4, tableMat, 1.5, 1.45, -2.2);
  for (const x of [-0.5, 1.5, 3.5]) b.add(new THREE.SphereGeometry(0.28, 12, 8), bulbMat, x, 3.4, -1.4);

  // Sign on the roof edge.
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(7.5, 1.4), signMat);
  sign.position.set(0, 6.2, 4.3);
  group.add(sign);
  b.box(7.8, 1.6, 0.25, dark, 0, 6.2, 4.15);

  // Striped awning over the glass.
  const aw = new THREE.PlaneGeometry(10.4, 2.6, 1, 1);
  const uv = aw.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 6);
  b.add(aw, awningMat, 2, 4.25, 5.6, 0, -Math.PI / 2 + 0.45);

  // Terrace deck.
  b.box(18, 0.25, 8, deck, 0, 0.125, 8.6);
  for (let x = -8.5; x <= 8.5; x += 1) b.box(0.04, 0.02, 8, dark, x, 0.26, 8.6);

  // Tables, chairs, parasols. Seats are kept for the Chogs.
  const seats = [];
  const chairGeo = (() => {
    const parts = [];
    const seat = new THREE.BoxGeometry(0.55, 0.08, 0.55);
    seat.translate(0, 0.5, 0);
    parts.push(seat);
    const back = new THREE.BoxGeometry(0.55, 0.6, 0.07);
    back.translate(0, 0.82, -0.25);
    parts.push(back);
    for (const [lx, lz] of [[-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22]]) {
      const leg = new THREE.CylinderGeometry(0.03, 0.03, 0.5, 5);
      leg.translate(lx, 0.25, lz);
      parts.push(leg);
    }
    return mergeGeometries(parts.map((p) => p.toNonIndexed()));
  })();
  const tables = [];
  for (const row of [6.6, 10.4]) for (const col of [-5.6, 0, 5.6]) tables.push([col + (row > 8 ? 1.4 : 0), row]);
  tables.forEach(([tx, tz], i) => {
    b.add(new THREE.CylinderGeometry(0.75, 0.75, 0.06, 20), tableMat, tx, 0.98, tz);
    b.add(new THREE.CylinderGeometry(0.06, 0.06, 0.75, 6), dark, tx, 0.62, tz);
    b.add(new THREE.CylinderGeometry(0.4, 0.4, 0.04, 12), dark, tx, 0.27, tz);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + i;
      const cx = tx + Math.sin(a) * 1.2, cz = tz + Math.cos(a) * 1.2;
      const face = Math.atan2(tx - cx, tz - cz);
      b.add(chairGeo, k % 2 ? chairA : chairB, cx, 0.25, cz, face + Math.PI);
      seats.push({ x: cx, y: 0.25 + 0.55, z: cz, facing: face });
    }
    if (i % 2 === 0) {
      b.add(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 6), dark, tx, 1.55, tz);
      b.add(new THREE.ConeGeometry(1.9, 0.7, 8, 1, true), i % 4 === 0 ? canopyA : canopyB, tx, 2.95, tz);
    }
  });

  // String lights on posts around the deck.
  const posts = [[-9, 4.8], [9, 4.8], [9, 12.4], [-9, 12.4]];
  for (const [px, pz] of posts) b.box(0.14, 3.6, 0.14, dark, px, 1.8, pz);
  const bulbs = [];
  const spans = [[posts[0], posts[3]], [posts[1], posts[2]], [posts[3], posts[2]], [[-9, 8.6], [9, 8.6]]];
  for (const [[ax, az], [bx, bz]] of spans) {
    for (let t = 0; t <= 1.0001; t += 1 / 14) {
      const sag = Math.sin(t * Math.PI) * 0.7;
      bulbs.push([ax + (bx - ax) * t, 3.5 - sag, az + (bz - az) * t]);
    }
  }
  const bulbGeo = new THREE.SphereGeometry(0.09, 8, 6);
  for (const [x, y, z] of bulbs) b.add(bulbGeo, bulbMat, x, y, z);

  b.build(group);

  // One warm light for the terrace at night.
  const light = new THREE.PointLight('#ffcf9a', 0, 26, 1.4);
  light.position.set(0, 3.2, 8.5);
  group.add(light);

  return {
    group,
    seats,
    planters: [[-9.6, 4.6], [9.6, 4.6], [-9.6, 12.6], [9.6, 12.6]],
    setNight(n) {
      bulbMat.emissiveIntensity = 0.3 + n * 8;
      glass.emissiveIntensity = 0.1 + n * 1.2;
      signMat.emissiveIntensity = n * 0.35;
      light.intensity = n * 40;
    },
  };
}
