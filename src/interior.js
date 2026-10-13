import * as THREE from 'three';
import { piece, kitMaterial } from './kaykit.js';
import { mergeByMaterial } from './merge.js';
import { createGlows } from './glows.js';

/*
 * The interior kit: one set of parts every room is built from. A room shell (floor, walls with window
 * and door openings, ceiling, trim) furnished with KayKit Furniture Bits, all at Chog scale and warmly
 * lit from inside. One room each: the lobby, the bar, and the home inside every dome. Rooms only draw
 * while the camera is in them; the Chogs move in later.
 */

export const FURNITURE_KIT = [
  'armchair', 'armchair_pillows', 'bed_single_A', 'bed_double_A', 'book_set', 'cabinet_medium', 'cabinet_small_decorated',
  'cactus_medium_A', 'cactus_small_A', 'chair_A_wood', 'chair_stool_wood', 'couch_pillows', 'lamp_standing',
  'lamp_table', 'pictureframe_large_A', 'pictureframe_large_B', 'pictureframe_medium', 'pillow_A', 'rug_oval_A',
  'rug_rectangle_A', 'rug_rectangle_stripes_A', 'shelf_A_big', 'shelf_B_large_decorated', 'shelf_B_small_decorated',
  'table_low', 'table_medium_long', 'table_small',
];

// Furniture is built about a third over life size; this brings it to the Chogs' scale, matching the
// plaza's benches.
const S = 1.2;
const WARM = new THREE.Color('#ffe2bd');

function canvasTexture(w, h, draw, repeatX = 1, repeatY = 1) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.anisotropy = 8;
  return t;
}

// Wooden boards, running along x, about 0.4 m each.
const planks = (base, gap) =>
  canvasTexture(256, 256, (g, w, h) => {
    for (let i = 0; i < 8; i++) {
      const tone = 0.88 + ((i * 37) % 11) / 50;
      const c = new THREE.Color(base).multiplyScalar(tone);
      g.fillStyle = `#${c.getHexString()}`;
      g.fillRect(0, i * 32, w, 32);
      g.fillStyle = gap;
      g.fillRect(0, i * 32, w, 2);
      g.fillRect(((i * 97) % 200) + 20, i * 32, 2, 32);
    }
  });

// Two-tone floor tiles, 1.2 m square.
const tiles = (a, b) =>
  canvasTexture(128, 128, (g) => {
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      g.fillStyle = (i + j) % 2 ? b : a;
      g.fillRect(i * 64, j * 64, 64, 64);
    }
    g.strokeStyle = 'rgba(0,0,0,0.12)';
    g.lineWidth = 2;
    g.strokeRect(0, 0, 128, 128);
    g.beginPath();
    g.moveTo(64, 0);
    g.lineTo(64, 128);
    g.moveTo(0, 64);
    g.lineTo(128, 64);
    g.stroke();
  });

// Faint plaster grain so painted walls don't read as flat colour.
const plaster = canvasTexture(128, 128, (g, w, h) => {
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, w, h);
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(0,0,0,${0.015 + rnd() * 0.03})`;
    g.fillRect(rnd() * w, rnd() * h, 2, 2);
  }
});

/**
 * Move a furniture piece's faces to other colour cells of its 8 x 4 atlas, e.g. a blue blanket to
 * green. Keys and values are "column,row".
 */
function recolour(obj, swaps) {
  const map = new Map(Object.entries(swaps).map(([from, to]) => [from, to.split(',').map(Number)]));
  obj.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    const uv = g.attributes.uv;
    for (let t = 0; t < uv.count; t += 3) {
      const cu = Math.floor(((uv.getX(t) + uv.getX(t + 1) + uv.getX(t + 2)) / 3) * 8);
      const cv = Math.floor(((uv.getY(t) + uv.getY(t + 1) + uv.getY(t + 2)) / 3) * 4);
      const to = map.get(`${cu},${cv}`);
      if (!to) continue;
      for (let k = t; k < t + 3; k++) uv.setXY(k, (to[0] + uv.getX(k) * 8 - cu) / 8, (to[1] + uv.getY(k) * 4 - cv) / 4);
    }
    o.geometry = g;
  });
}

/**
 * A room seen from inside, centred on its floor: w wide (x), d deep (z), h tall, front at +z.
 * Openings are cut in the walls: { wall, x, y, w, h, kind: 'window' | 'door' }, with x along the wall
 * as seen from inside it (from its middle) and y up from the floor. Windows look straight out.
 */
class Room {
  constructor({ w, d, h, wall, wainscot, floor, ceiling = '#fbf4ea', trim = '#6e4630', openings = [] }) {
    Object.assign(this, { w, d, h });
    this.group = new THREE.Group();
    this.lit = [];
    this.glowSpots = [];
    const mat = (opts) => {
      const m = new THREE.MeshLambertMaterial(opts);
      this.lit.push(m);
      return m;
    };
    this.mats = {
      wall: mat({ color: wall, map: plaster }),
      wainscot: mat({ color: wainscot }),
      trim: mat({ color: trim }),
      ceiling: mat({ color: ceiling }),
      floor: mat({ map: floor }),
      brass: new THREE.MeshStandardMaterial({ color: '#cfa84e', metalness: 0.75, roughness: 0.35 }),
      shade: new THREE.MeshStandardMaterial({ color: '#cfa84e', metalness: 0.6, roughness: 0.4, side: THREE.DoubleSide }),
      glass: new THREE.MeshBasicMaterial({ color: '#dceeff', transparent: true, opacity: 0.12, depthWrite: false }),
    };
    floor.repeat.set(w / 2.5, d / 2.5);
    const add = (geo, m, parent = this.group) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };
    add(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), this.mats.floor);
    add(new THREE.PlaneGeometry(w, d).rotateX(Math.PI / 2).translate(0, h, 0), this.mats.ceiling);

    for (const side of ['back', 'front', 'left', 'right']) {
      const len = side === 'back' || side === 'front' ? w : d;
      const holes = openings.filter((o) => o.wall === side);
      const panel = (y0, y1, m) => {
        const shape = new THREE.Shape();
        shape.moveTo(-len / 2, y0);
        shape.lineTo(len / 2, y0);
        shape.lineTo(len / 2, y1);
        shape.lineTo(-len / 2, y1);
        for (const o of holes) {
          const b = Math.max(o.y, y0), t = Math.min(o.y + o.h, y1);
          if (t <= b) continue;
          const hole = new THREE.Path();
          hole.moveTo(o.x - o.w / 2, b);
          hole.lineTo(o.x - o.w / 2, t);
          hole.lineTo(o.x + o.w / 2, t);
          hole.lineTo(o.x + o.w / 2, b);
          shape.holes.push(hole);
        }
        add(new THREE.ShapeGeometry(shape), m, this.onWall(side));
      };
      // Painted wall over a darker panelled lower band, with a rail and skirting.
      panel(0, 1.3, this.mats.wainscot);
      panel(1.3, h, this.mats.wall);
      const wallG = this.onWall(side);
      const gaps = holes.filter((o) => o.y < 1.4).map((o) => [o.x - o.w / 2, o.x + o.w / 2]);
      for (const [y, hh, depth] of [[1.3, 0.12, 0.08], [0, 0.22, 0.06]]) {
        let x0 = -len / 2;
        for (const [a, b] of [...gaps, [len / 2, len / 2]].sort((p, q) => p[0] - q[0])) {
          if (a - x0 > 0.05) add(new THREE.BoxGeometry(a - x0, hh, depth).translate((x0 + a) / 2, y + hh / 2, depth / 2), this.mats.trim, wallG);
          x0 = b;
        }
      }
      for (const o of holes) (o.kind === 'door' ? this.door : this.window).call(this, wallG, o);
    }
  }

  // A group placed on one wall: x along it (as seen from inside), y up, z out into the room.
  onWall(side) {
    let g = this.walls?.[side];
    if (g) return g;
    this.walls ??= {};
    g = new THREE.Group();
    const { w, d } = this;
    if (side === 'back') g.position.set(0, 0, -d / 2);
    if (side === 'front') g.position.set(0, 0, d / 2), (g.rotation.y = Math.PI);
    if (side === 'left') g.position.set(-w / 2, 0, 0), (g.rotation.y = Math.PI / 2);
    if (side === 'right') g.position.set(w / 2, 0, 0), (g.rotation.y = -Math.PI / 2);
    this.group.add(g);
    this.walls[side] = g;
    return g;
  }

  window(g, o) {
    const t = 0.2, dz = 0.3;
    const frame = (fw, fh, x, y) => g.add(new THREE.Mesh(new THREE.BoxGeometry(fw, fh, dz).translate(x, y, dz / 2 - 0.05), this.mats.trim));
    frame(o.w + t * 2, t, o.x, o.y + o.h + t / 2);
    frame(t, o.h, o.x - o.w / 2 - t / 2, o.y + o.h / 2);
    frame(t, o.h, o.x + o.w / 2 + t / 2, o.y + o.h / 2);
    frame(t * 0.5, o.h, o.x, o.y + o.h / 2);
    g.add(new THREE.Mesh(new THREE.BoxGeometry(o.w + 0.6, 0.12, 0.45).translate(o.x, o.y - 0.06, 0.18), this.mats.trim));
    g.add(new THREE.Mesh(new THREE.PlaneGeometry(o.w, o.h).translate(o.x, o.y + o.h / 2, -0.04), this.mats.glass));
  }

  door(g, o) {
    const t = 0.25;
    g.add(new THREE.Mesh(new THREE.BoxGeometry(o.w + t * 2, t, 0.3).translate(o.x, o.h + t / 2, 0.1), this.mats.trim));
    for (const s of [-1, 1]) g.add(new THREE.Mesh(new THREE.BoxGeometry(t, o.h, 0.3).translate(o.x + s * (o.w / 2 + t / 2), o.h / 2, 0.1), this.mats.trim));
    g.add(new THREE.Mesh(new THREE.BoxGeometry(o.w, o.h, 0.14).translate(o.x, o.h / 2, -0.05), this.mats.trim));
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8).translate(o.x + o.w * 0.35, o.h * 0.48, 0.1), this.mats.brass));
  }

  // A furniture piece at (x, z) on the floor (or at height y), turned by rot, optionally recoloured.
  put(name, x, z, rot = 0, { y = 0, scale = S, swaps } = {}) {
    const p = piece(name, scale);
    p.position.set(x, y, z);
    p.rotation.y = rot;
    if (swaps) recolour(p, swaps);
    p.traverse((o) => {
      if (o.isMesh) o.castShadow = false;
    });
    this.group.add(p);
    return p;
  }

  // Something hung on a wall: x along it, y up.
  hang(side, name, x, y, { scale = S, swaps } = {}) {
    const p = piece(name, scale);
    p.position.set(x, y, 0.02);
    if (swaps) recolour(p, swaps);
    this.onWall(side).add(p);
    return p;
  }

  // A warm ceiling lamp: brass rod, glowing shade, and a halo at night.
  pendant(x, z, drop = 1.2) {
    const g = this.group;
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, drop, 6).translate(x, this.h - drop / 2, z), this.mats.brass));
    g.add(new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.45, 16, 1, true).translate(x, this.h - drop - 0.1, z), this.mats.shade));
    this.bulbs ??= [];
    this.bulbs.push(new THREE.Vector3(x, this.h - drop - 0.3, z));
  }

  // Merge what can be merged and add the bulbs and their halos. Call once, after furnishing.
  finish() {
    if (this.bulbs?.length) {
      this.bulbMat = new THREE.MeshBasicMaterial({ color: '#ffd59a' });
      for (const b of this.bulbs) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), this.bulbMat);
        m.position.copy(b);
        this.group.add(m);
      }
      this.glows = createGlows(this.bulbs, { color: '#ffcf8a', size: 2.4, minPx: 4 });
      this.group.add(this.glows.points);
    }
    mergeByMaterial(this.group);
    // Nothing indoors throws shadows; the building around it does.
    this.group.traverse((o) => {
      if (o.isMesh) o.castShadow = false;
    });
    return this;
  }

  // Lamps are on all the time indoors, a little brighter after dark.
  update(env, renderer) {
    const k = 0.32 + env.night * 0.2;
    for (const m of this.lit) {
      m.emissive.copy(m.color).multiply(WARM).multiplyScalar(k * 0.6);
      if (m.map && !m.emissiveMap) m.emissiveMap = m.map, (m.needsUpdate = true);
    }
    if (this.bulbMat) this.bulbMat.color.set('#ffd59a').multiplyScalar(1.4 + env.night * 1.6);
    this.glows?.update({ night: 0.55 + env.night * 0.45 }, renderer);
  }
}

// Indoors, the furniture glows a little with lamplight so a room never reads dark.
function warmFurniture() {
  const m = kitMaterial('furniture');
  if (m && !m.userData.warmed) {
    m.emissive = WARM.clone();
    m.emissiveMap = m.map;
    m.emissiveIntensity = 0.16;
    m.userData.warmed = true;
    m.needsUpdate = true;
  }
}

// A glowing panel from a canvas, for screens and signs indoors.
function screen(draw, w, h, px = 512) {
  const tex = canvasTexture(px, Math.round((px * h) / w), draw);
  const mat = new THREE.MeshBasicMaterial({ map: tex });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.userData.keep = true;
  return m;
}

// The placeholder Chog: brass on a stone plinth, until the real model arrives.
function chogStatue(room, x, z, rot) {
  const g = new THREE.Group();
  const stone = new THREE.MeshLambertMaterial({ color: '#efe3cf' });
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.7, 1.4, 24).translate(0, 0.7, 0), stone));
  g.add(new THREE.Mesh(new THREE.SphereGeometry(1.1, 24, 16).scale(1, 1.15, 0.95).translate(0, 2.6, 0), room.mats.brass));
  for (const sx of [-0.55, 0.55]) g.add(new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.75, 12).rotateZ(-sx * 0.3).translate(sx, 4.0, 0), room.mats.brass));
  g.position.set(x, 0, z);
  g.rotation.y = rot;
  room.group.add(g);
}

/**
 * The lobby, where owners sign in: a reception desk before a glowing wall where you connect your
 * wallet, the Chog statue, and a seating corner. Fits inside the domed lobby pod.
 */
export function buildLobbyRoom() {
  warmFurniture();
  const room = new Room({
    w: 20, d: 22, h: 9,
    wall: '#efe4f6', wainscot: '#8d6ac9', floor: tiles('#f3ead9', '#d9c8ef'), trim: '#6e4630',
    openings: [
      { wall: 'front', x: 0, y: 0, w: 3.6, h: 5, kind: 'door' },
      { wall: 'front', x: -6.5, y: 2.2, w: 3.6, h: 4.2 },
      { wall: 'front', x: 6.5, y: 2.2, w: 3.6, h: 4.2 },
      { wall: 'left', x: 2, y: 2.2, w: 5, h: 4.2 },
      { wall: 'right', x: -2, y: 2.2, w: 5, h: 4.2 },
    ],
  });
  // The wallet wall: a big glowing screen on the back wall, framed in brass.
  const wallet = screen((g, w, h) => {
    const grad = g.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#2a1650');
    grad.addColorStop(1, '#4b2a8c');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#b89cff';
    g.lineWidth = 8;
    g.strokeRect(14, 14, w - 28, h - 28);
    g.fillStyle = '#fff6e8';
    g.textAlign = 'center';
    g.font = '600 64px Fredoka, sans-serif';
    g.fillText('Connect your wallet', w / 2, h * 0.36);
    g.fillStyle = '#d9c8ff';
    g.font = '500 30px Figtree, sans-serif';
    g.fillText('Your Chog lives here. Sign in to go home.', w / 2, h * 0.52);
    // Three slots for wallets, glowing softly.
    for (let i = 0; i < 3; i++) {
      const x = w / 2 + (i - 1) * 150;
      g.fillStyle = 'rgba(184,156,255,0.25)';
      g.beginPath();
      g.roundRect(x - 55, h * 0.64, 110, 80, 18);
      g.fill();
      g.strokeStyle = '#e8b84a';
      g.lineWidth = 4;
      g.stroke();
    }
  }, 10, 4.6, 1024);
  wallet.position.set(0, 4.2, 0.08);
  room.onWall('back').add(wallet);
  const back = room.onWall('back');
  for (const [fw, fh, x, y] of [[10.6, 0.3, 0, 6.65], [10.6, 0.3, 0, 1.75], [0.3, 5.2, -5.15, 4.2], [0.3, 5.2, 5.15, 4.2]]) {
    back.add(new THREE.Mesh(new THREE.BoxGeometry(fw, fh, 0.25).translate(x, y, 0.12), room.mats.brass));
  }
  // Reception desk in front of it: cabinets in a row under a long wooden top.
  for (const x of [-2.4, 0, 2.4]) room.put('cabinet_medium', x, -5.2, Math.PI);
  room.group.add(new THREE.Mesh(new THREE.BoxGeometry(7.8, 0.22, 1.8).translate(0, 1.32, -5.2), room.mats.trim));
  room.put('lamp_table', -2.6, -5.4, 0, { y: 1.43 });
  room.put('book_set', 2.4, -5.3, 0.2, { y: 1.43 });
  // The statue beside the desk, a seating corner on a rug at the front, plants and lamps.
  chogStatue(room, -7, -6.8, 0.6);
  room.put('rug_oval_A', -4.8, 4.2, 0, { scale: S * 1.7, swaps: { '0,1': '3,1' } });
  room.put('couch_pillows', -4.8, 1.8, 0);
  room.put('armchair_pillows', -7.6, 4.8, Math.PI / 2);
  room.put('armchair_pillows', -2.0, 4.8, -Math.PI / 2);
  room.put('table_low', -4.8, 4.6, 0);
  room.put('cactus_small_A', -4.4, 4.6, 0, { y: 0.6 });
  room.put('cactus_medium_A', 8.6, -9.4, 0);
  room.put('cactus_medium_A', -8.6, 9.6, 0);
  room.put('lamp_standing', 8.6, 8.8, 0);
  room.put('lamp_standing', -8.8, -1.2, 0);
  room.hang('left', 'pictureframe_large_A', -5.5, 4.4);
  room.hang('right', 'pictureframe_large_B', 5.5, 4.4);
  room.hang('right', 'shelf_B_large_decorated', -7.5, 3.6);
  for (const [x, z] of [[-5, -3], [5, -3], [-5, 5], [5, 5]]) room.pendant(x, z, 1.6);
  return room.finish();
}
