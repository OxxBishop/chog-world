import * as THREE from 'three';
import { goldChog } from './statue.js';
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
export class Room {
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
    // The leaf hangs on its own hinge, kept out of the merge so it can slide into the wall past its jamb
    // (src/entry.js setRoomDoor opens it; the sliding doors, the user 10-19).
    const hinge = new THREE.Group();
    hinge.position.set(o.x + o.w / 2, 0, -0.05);
    hinge.userData.dir = 1;
    hinge.add(new THREE.Mesh(new THREE.BoxGeometry(o.w, o.h, 0.14).translate(-o.w / 2, o.h / 2, 0), this.mats.trim));
    for (const z of [0.15, -0.15]) hinge.add(new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8).translate(-o.w * 0.85, o.h * 0.48, z), this.mats.brass));
    hinge.traverse((m) => m.isMesh && (m.userData.keep = true));
    g.add(hinge);
    this.doorway = { ...o, hinge };
  }

  // A furniture piece at (x, z) on the floor (or at height y), turned by rot, optionally recoloured.
  put(name, x, z, rot = 0, { y = 0, scale = S, swaps } = {}) {
    const p = piece(name, scale);
    p.position.set(x, y, z);
    p.rotation.y = rot;
    if (swaps) recolour(p, swaps);
    // Rugs lie flat: a Chog's feet sank into their thickness (the user, 10-21).
    if (name.startsWith('rug')) p.scale.y *= 0.2;
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

// A gold Chog on a stone plinth (src/statue.js).
function chogStatue(room, x, z, rot) {
  const g = new THREE.Group();
  const stone = new THREE.MeshLambertMaterial({ color: '#efe3cf' });
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.7, 1.4, 24).translate(0, 0.7, 0), stone));
  const chog = goldChog(3.1);
  chog.position.y = 1.4;
  g.add(chog);
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

/**
 * The bar, where Chogs hang out and talk: a counter with stools and bottles behind it, tables, warm
 * lights, a little stage and a jukebox in the corners. Fits inside the bar's pod.
 */
export function buildBarRoom() {
  warmFurniture();
  const room = new Room({
    w: 15, d: 13, h: 6.6,
    wall: '#f3dfc6', wainscot: '#6e4630', floor: planks('#a8744a', '#5a3a24'), trim: '#4a2e1e', ceiling: '#e9d6bd',
    openings: [
      { wall: 'front', x: 0, y: 0, w: 3.2, h: 4.4, kind: 'door' },
      { wall: 'front', x: -4.8, y: 2, w: 2.8, h: 2.8 },
      { wall: 'left', x: 0, y: 2, w: 3.6, h: 2.8 },
      { wall: 'right', x: 0, y: 2, w: 3.6, h: 2.8 },
    ],
  });
  // Counter along the back, stools in front of it, shelves of bottles behind.
  for (const x of [-3.6, -1.2, 1.2, 3.6]) room.put('cabinet_medium', x, -4.6, 0);
  room.group.add(new THREE.Mesh(new THREE.BoxGeometry(10.2, 0.22, 1.7).translate(0, 1.32, -4.6), room.mats.trim));
  for (const x of [-3.9, -1.3, 1.3, 3.9]) room.put('chair_stool_wood', x, -3.0, 0);
  room.hang('back', 'shelf_A_big', -2.6, 3.1);
  room.hang('back', 'shelf_A_big', 2.6, 3.1);
  room.hang('back', 'shelf_A_big', -2.6, 4.4);
  room.hang('back', 'shelf_A_big', 2.6, 4.4);
  // Bottles in a few colours on the shelves.
  const bottleGeo = new THREE.CylinderGeometry(0.11, 0.13, 0.55, 8).translate(0, 0.27, 0);
  const neckGeo = new THREE.CylinderGeometry(0.04, 0.06, 0.22, 6).translate(0, 0.65, 0);
  const colours = ['#3f7f58', '#8a3a2a', '#c99b3a', '#4a5fa8', '#7a3a8a'];
  const back = room.onWall('back');
  for (const [sx, sy] of [[-2.6, 3.12], [2.6, 3.12], [-2.6, 4.42], [2.6, 4.42]]) {
    for (let i = 0; i < 7; i++) {
      const mat = new THREE.MeshLambertMaterial({ color: colours[(i + Math.round(sx + sy * 3)) % colours.length] });
      room.lit.push(mat);
      for (const geo of [bottleGeo, neckGeo]) {
        const b = new THREE.Mesh(geo, mat);
        b.position.set(sx - 0.9 + i * 0.3, sy, 0.3);
        back.add(b);
      }
    }
  }
  // Tables with chairs in the middle, on a striped rug.
  room.put('rug_rectangle_stripes_A', 0.6, 1.4, 0, { scale: S * 1.6 });
  for (const [x, z] of [[-2.2, 0.6], [2.4, 0.2], [0.4, 3.4]]) {
    room.put('table_small', x, z, 0);
    room.put('chair_A_wood', x - 1.1, z, Math.PI / 2);
    room.put('chair_A_wood', x + 1.1, z, -Math.PI / 2);
  }
  // The stage: a low wooden platform in a corner with a microphone under a spot.
  const stageMat = room.mats.trim;
  room.group.add(new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.45, 3.4).translate(-5.4, 0.22, 4.6), stageMat));
  room.group.add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.7, 6).translate(-5.4, 1.3, 4.4), room.mats.brass));
  room.group.add(new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8).translate(-5.4, 2.2, 4.4), new THREE.MeshLambertMaterial({ color: '#2a2a2a' })));
  // The jukebox: a rounded cabinet with glowing bands, in the other corner.
  const juke = screen((g, w, h) => {
    g.fillStyle = '#3a1f2a';
    g.fillRect(0, 0, w, h);
    const bands = ['#ff7ac8', '#ffd27a', '#7ef0e4', '#b89cff'];
    bands.forEach((c, i) => {
      g.strokeStyle = c;
      g.lineWidth = 14;
      g.beginPath();
      g.arc(w / 2, h * 0.42, w * 0.42 - i * 26, Math.PI, 0);
      g.stroke();
    });
    g.fillStyle = '#ffd27a';
    g.fillRect(w * 0.2, h * 0.55, w * 0.6, h * 0.18);
    g.fillStyle = '#3a1f2a';
    for (let i = 0; i < 6; i++) g.fillRect(w * 0.23 + i * w * 0.093, h * 0.58, w * 0.06, h * 0.12);
  }, 1.9, 2.8, 256);
  juke.position.set(5.6, 1.4, 5.3);
  juke.rotation.y = Math.PI + 0.5;
  room.group.add(juke);
  const jukeBody = new THREE.Mesh(new THREE.BoxGeometry(2.1, 2.9, 1.0).translate(0, 1.45, 0), stageMat);
  jukeBody.position.set(5.86, 0, 5.75);
  jukeBody.rotation.y = 0.5;
  room.group.add(jukeBody);
  room.put('lamp_standing', -6.6, -5.4, 0);
  room.put('lamp_standing', 6.6, -5.4, 0);
  room.hang('left', 'pictureframe_medium', 3.5, 3.5);
  room.hang('right', 'pictureframe_medium', -3.5, 3.5);
  room.hang('front', 'pictureframe_large_A', 4.6, 3.7);
  for (const [x, z] of [[-3, -3.2], [0, -3.2], [3, -3.2], [-2.2, 0.6], [2.4, 0.2], [0.4, 3.4], [-5.4, 4.4]]) room.pendant(x, z, 1.4);
  return room.finish();
}

// Each dome's biome colours its home: wall paint, the blanket and the rug.
const HOME_STYLE = {
  meadow: { wall: '#e3efd2', wainscot: '#8fb86a', swaps: { '2,1': '7,2' } },
  frost: { wall: '#dfeaf5', wainscot: '#8eb3d6', swaps: { '0,1': '5,1' } },
  grove: { wall: '#f5dce8', wainscot: '#c97aa8', swaps: { '2,1': '7,1' } },
};

/**
 * Inside a Chog's home in its dome: a bed, a table and chair by the window looking out over the island,
 * a shelf, a rug, a lamp. The same room in every dome, coloured by the dome's biome. This is where your
 * Chog lives, and where the sign-in and sign-out scenes play.
 */
export function buildHomeRoom(biome) {
  warmFurniture();
  const style = HOME_STYLE[biome] ?? HOME_STYLE.meadow;
  const room = new Room({
    w: 9.4, d: 9.4, h: 4.6,
    wall: style.wall, wainscot: style.wainscot, floor: planks('#c99a6a', '#7a5638'), trim: '#7a5638',
    openings: [
      { wall: 'front', x: 0, y: 0, w: 2.4, h: 3.4, kind: 'door' },
      { wall: 'back', x: 1.7, y: 1.3, w: 3.8, h: 2.3 },
    ],
  });
  // A desk and chair under the window, looking out over the island; the bed along the side wall.
  room.put('table_small', 1.7, -3.7, 0, { scale: S * 1.15 });
  room.put('chair_A_wood', 1.7, -2.5, Math.PI);
  room.put('lamp_table', 2.6, -3.9, 0, { y: S * 1.15, scale: S * 0.7 });
  room.put('bed_single_A', -2.7, 0.2, Math.PI / 2, { swaps: style.swaps });
  room.put('cabinet_small_decorated', -4.0, -2.9, Math.PI / 2, { scale: S * 0.8 });
  room.put('lamp_table', -4.0, -2.9, 0, { y: 1.62 * S * 0.8, scale: S * 0.85 });
  room.put('rug_oval_A', 0.8, 0.6, Math.PI / 2, { swaps: style.swaps });
  room.put('pillow_A', 1.6, 2.6, 0.4, { swaps: style.swaps });
  room.put('cactus_small_A', 4.0, 3.9, 0);
  room.hang('right', 'shelf_B_small_decorated', 0.4, 2.4);
  room.hang('left', 'pictureframe_large_B', 0.2, 2.9, { scale: S * 0.8 });
  room.hang('back', 'pictureframe_medium', -2.6, 2.7);
  room.pendant(0, 0.4, 1.0);
  return room.finish();
}
