import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/*
 * Three directions for the casino (B23), for the user to pick from: ?casino=capsule | starlite | pier.
 * Each is the whole room: its walls, floor and ceiling, its machines' shells (the reels, lever and
 * bulbs inside are the game's own, from src/casino.js), its hero props, signs and light, and the
 * panel's style. The game and its show are the same in all three.
 *
 *   capsule   Capsule Club: a night-time game centre at Chog size. Indigo dark, pink and cyan neon,
 *             cream capsule cabinets under acrylic domes, a gacha wall and a claw machine.
 *   starlite  Starlite Lounge: a 1958 atomic-age lounge in a toy box. Night teal and coral, a
 *             starburst sign, sputnik lamps, cabinets with tail fins and spinning orbits.
 *   pier      Sugar Pier: a seaside candy arcade. Candy-stripe walls, boardwalk floor, a sunset
 *             mural, ice-cream-cart cabinets under striped awnings, skee-ball and bunting.
 *
 * A look gets the kit (Room, slotMachine, the strip, board and chip burst builders) and returns the
 * room with room.casino filled in; look.update(t, dt) runs its own motion each frame.
 */

const C = (hex, k = 1) => new THREE.Color(hex).multiplyScalar(k);
// A colour bright enough to bloom: neon, signs, bulbs.
const glow = (hex, k = 2.2) => new THREE.MeshBasicMaterial({ color: C(hex, k) });

function canvas(w, h, draw, { repeat = false, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.userData.redraw = () => {
    draw(c.getContext('2d'), w, h);
    t.needsUpdate = true;
  };
  return t;
}

// A sign: a canvas on a plane, as bright as k (over 1 it blooms). Redrawn once the fonts are in.
function sign(w, h, px, draw, k = 1.8, fonts = []) {
  const tex = canvas(px, Math.round((px * h) / w), draw);
  const mat = new THREE.MeshBasicMaterial({ map: tex, color: C('#ffffff', k), transparent: true, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  mesh.userData.keep = true;
  mesh.renderOrder = 2;
  if (fonts.length) Promise.all(fonts.map((f) => document.fonts.load(f))).then(() => tex.userData.redraw()).catch(() => {});
  return mesh;
}

// A soft pool of coloured light on the floor (additive), r metres across.
const poolTex = (() => {
  let t = null;
  return () =>
    (t ??= canvas(128, 128, (g, w) => {
      const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      r.addColorStop(0, 'rgba(255,255,255,0.9)');
      r.addColorStop(0.45, 'rgba(255,255,255,0.35)');
      r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r;
      g.fillRect(0, 0, w, w);
    }));
})();
function pool(parent, x, z, rx, rz, hex, k = 0.7) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(rx * 2, rz * 2).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: poolTex(), color: C(hex, k), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  m.position.set(x, 0.015, z);
  m.renderOrder = 1;
  m.userData.keep = true;
  parent.add(m);
  return m;
}

// A neon tube through points (room space).
function tube(parent, pts, hex, r = 0.035, k = 2.6, closed = false) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)), closed, 'catmullrom', 0.05);
  const m = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(8, pts.length * 12), r, 6, closed), glow(hex, k));
  m.userData.keep = true;
  parent.add(m);
  return m;
}

// Bulbs as one instanced mesh; colours set per bulb by the look's chase.
function bulbs(parent, spots, r = 0.05) {
  const m = new THREE.InstancedMesh(new THREE.SphereGeometry(r, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffffff' }), spots.length);
  spots.forEach((p, i) => {
    m.setMatrixAt(i, new THREE.Matrix4().makeTranslation(...p));
    m.setColorAt(i, new THREE.Color('#ffffff'));
  });
  m.userData.keep = true;
  parent.add(m);
  return m;
}

// Lots of one small thing: an instanced mesh at the given positions, with per-instance colours.
function many(parent, geo, mat, list) {
  const m = new THREE.InstancedMesh(geo, mat, list.length);
  const q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3(), mx = new THREE.Matrix4();
  list.forEach((it, i) => {
    p.set(...it.at);
    e.set(...(it.rot ?? [0, 0, 0]));
    q.setFromEuler(e);
    s.setScalar(it.scale ?? 1);
    if (it.scales) s.set(...it.scales);
    m.setMatrixAt(i, mx.compose(p, q, s));
    m.setColorAt(i, new THREE.Color(it.colour ?? '#ffffff'));
  });
  m.userData.keep = true;
  parent.add(m);
  return m;
}

const pick = (arr, i) => arr[((i % arr.length) + arr.length) % arr.length];
// A steady little random, so a look comes out the same every time.
const rand = (seed) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

// The bulbs' chase, the same for every look: colours per bulb from the look's palette.
function chase(palette, offK = 0.18) {
  const on = palette.map((h) => C(h, 1.1));
  const off = palette.map((h) => C(h, offK));
  return { on, off, hot: C('#ffffff', 2.2) };
}

// ======================================================================================
// Capsule Club
// ======================================================================================
const CAPSULE = { ink: '#1a1033', pink: '#ff3d8b', cyan: '#3ef2ff', lilac: '#b79cff', butter: '#ffe27a', cream: '#fff4e6', mint: '#8ff5d2' };
const PASTELS = [CAPSULE.pink, CAPSULE.cyan, CAPSULE.butter, CAPSULE.lilac, CAPSULE.mint, '#ffb3d1'];

function capsuleFloor() {
  return canvas(512, 512, (g, w) => {
    g.fillStyle = '#140d2c';
    g.fillRect(0, 0, w, w);
    // Big soft checker, very low contrast, and a pixel grid over it.
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if ((x + y) % 2) {
      g.fillStyle = '#18103a';
      g.fillRect(x * 128, y * 128, 128, 128);
    }
    g.strokeStyle = 'rgba(183, 156, 255, 0.10)';
    g.lineWidth = 2;
    for (let i = 0; i <= w; i += 32) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i, w);
      g.moveTo(0, i);
      g.lineTo(w, i);
      g.stroke();
    }
    // Pixel sparkles.
    const r = rand(7);
    for (let i = 0; i < 46; i++) {
      g.fillStyle = pick(['rgba(255,61,139,0.55)', 'rgba(62,242,255,0.5)', 'rgba(255,226,122,0.45)'], i);
      const x = Math.floor(r() * 64) * 8, y = Math.floor(r() * 64) * 8;
      g.fillRect(x, y, 8, 8);
      if (i % 3 === 0) g.fillRect(x - 8, y, 24, 8), g.fillRect(x, y - 8, 8, 24);
    }
  }, { repeat: true });
}

function capsuleWall() {
  return canvas(64, 512, (g, w, h) => {
    const grad = g.createLinearGradient(0, h, 0, 0);
    grad.addColorStop(0, '#5b45b8');
    grad.addColorStop(0.45, '#3b2a86');
    grad.addColorStop(1, '#221857');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });
}

function capsuleLook(kit) {
  const room = new kit.Room({
    w: 15, d: 13, h: 6.6,
    wall: '#ffffff', wainscot: '#2a1f66', floor: capsuleFloor(), trim: '#7a62e0', ceiling: '#120b2c',
    openings: [{ wall: 'front', x: 0, y: 0, w: 3.2, h: 4.4, kind: 'door' }],
  });
  // The walls: a gradient from lilac-indigo at the floor to deep indigo up top (in metres, 6.6 tall).
  const wallTex = capsuleWall();
  wallTex.wrapS = THREE.RepeatWrapping;
  wallTex.repeat.set(1, 1 / 6.6);
  room.mats.wall.map = wallTex;
  room.mats.wall.color.set('#ffffff');
  const g = room.group;
  const mats = {
    body: new THREE.MeshStandardMaterial({ color: CAPSULE.cream, roughness: 0.45, metalness: 0.05 }),
    dark: new THREE.MeshStandardMaterial({ color: '#6a4fd0', roughness: 0.5 }),
    gold: new THREE.MeshStandardMaterial({ color: '#d4ccff', roughness: 0.35, metalness: 0.55 }),
    frame: glow(CAPSULE.cyan, 1.25),
    bezel: new THREE.MeshBasicMaterial({ color: '#120a26' }),
    glass: room.mats.glass,
    shade: kit.shadeMat(),
    line: glow(CAPSULE.pink, 1.6),
    bulb: new THREE.MeshBasicMaterial({ color: '#ffffff' }),
    ball: new THREE.MeshStandardMaterial({ color: CAPSULE.pink, roughness: 0.3 }),
    sign: null,
    acrylic: new THREE.MeshStandardMaterial({ color: '#efe6ff', roughness: 0.08, metalness: 0, transparent: true, opacity: 0.28, depthWrite: false }),
    capsule: new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#3a2a50' }),
    seat: new THREE.MeshStandardMaterial({ color: CAPSULE.pink, roughness: 0.5 }),
    post: new THREE.MeshStandardMaterial({ color: '#6a4fd0', roughness: 0.4, metalness: 0.2 }),
  };
  const strip = kit.makeStrip();

  // A capsule cabinet: round cream body, lilac base, and in place of a top sign an acrylic dome full of
  // capsules over a little pixel marquee.
  const capsules = [];
  const style = {
    radius: 0.22,
    top(m, add) {
      add(new RoundedBoxGeometry(1.5, 0.3, 0.72, 3, 0.12), mats.dark, 0, 2.5, -0.06);
      const marquee = sign(1.34, 0.22, 512, (c, w, h) => {
        c.clearRect(0, 0, w, h);
        c.fillStyle = '#140c2e';
        c.fillRect(0, 0, w, h);
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.font = `700 ${Math.round(h * 0.62)}px "Pixelify Sans", monospace`;
        c.fillStyle = CAPSULE.butter;
        c.shadowColor = CAPSULE.pink;
        c.shadowBlur = 14;
        c.fillText('CHOG SLOTS', w / 2, h / 2 + 2);
      }, 1.7, ['700 40px "Pixelify Sans"']);
      marquee.position.set(0, 2.5, 0.31);
      m.add(marquee);
      const dome = add(new THREE.SphereGeometry(0.66, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), mats.acrylic, 0, 2.65, -0.06);
      dome.renderOrder = 3;
      add(new THREE.TorusGeometry(0.66, 0.04, 8, 40).rotateX(Math.PI / 2), mats.frame, 0, 2.66, -0.06);
      const r = rand(m.id + 3);
      for (let i = 0; i < 22; i++) {
        const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.48;
        capsules.push({ m, at: [Math.cos(a) * d, 2.74 + Math.floor(i / 9) * 0.13 + r() * 0.05, -0.06 + Math.sin(a) * d], colour: pick(PASTELS, i + Math.floor(r() * 3)), rot: [r() * 3, r() * 3, 0] });
      }
    },
  };
  const machines = [-4.2, 0, 4.2].map((x) => {
    const m = kit.slotMachine(mats, strip, style);
    m.group.position.set(x, 0, -room.d / 2 + 0.9);
    m.group.rotation.y = -x * 0.06;
    g.add(m.group);
    return m;
  });
  // The capsules in each dome: two-tone, a coloured half and a clear one, as one mesh a machine.
  const capGeo = new THREE.CapsuleGeometry(0.075, 0.05, 4, 10);
  for (const m of machines) many(m.group, capGeo, mats.capsule, capsules.filter((c) => c.m === m.group));
  for (const m of machines) m.group.traverse((o) => o.isMesh && (o.userData.keep = true));

  // Neon along the walls: pink at the top, cyan above the dado, gaps where the signs are.
  const W = room.w / 2 - 0.08, D = room.d / 2 - 0.08;
  tube(g, [[-W, 4.05, D - 0.4], [-W, 4.05, -D], [-3.6, 4.05, -D]], CAPSULE.pink, 0.04);
  tube(g, [[3.6, 4.05, -D], [W, 4.05, -D], [W, 4.05, D - 0.4]], CAPSULE.pink, 0.04);
  // Lilac light strips up the walls, framing the bays.
  for (const z of [-3.9, 3.9]) for (const sx of [-1, 1]) tube(g, [[sx * W, 1.5, z], [sx * W, 3.95, z]], CAPSULE.lilac, 0.025, 1.5);
  for (const x of [-6.2, -2.1, 2.1, 6.2]) tube(g, [[x, 1.5, -D], [x, 3.95, -D]], CAPSULE.lilac, 0.025, 1.5);
  tube(g, [[-W, 1.42, D - 0.4], [-W, 1.42, -D], [W, 1.42, -D], [W, 1.42, D - 0.4]], CAPSULE.cyan, 0.03, 2.2);
  // Under the ceiling, a lilac line, and two neon shapes hanging: a star and a heart.
  tube(g, [[-W, 6.45, D], [-W, 6.45, -D], [W, 6.45, -D], [W, 6.45, D]], CAPSULE.lilac, 0.03, 1.6);
  // Neon shapes on the side walls by the back: a butter star on the left, a pink heart on the right.
  const star = [];
  for (let i = 0; i <= 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2, r = i % 2 ? 0.3 : 0.7;
    star.push([4.6 + Math.cos(a) * r, 5.0 + Math.sin(a) * r, 0.08]);
  }
  tube(room.onWall('left'), star, CAPSULE.butter, 0.035, 2.4);
  const heart = [];
  for (let i = 0; i <= 40; i++) {
    const t = (i / 40) * Math.PI * 2;
    heart.push([-4.6 + 0.042 * 16 * Math.sin(t) ** 3, 5.0 + 0.042 * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)), 0.08]);
  }
  tube(room.onWall('right'), heart, CAPSULE.pink, 0.035, 2.4, true);

  // The hero sign on the back wall, over the machines.
  const hero = sign(6.4, 1.7, 1024, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const f = Math.round(h * 0.5);
    c.font = `700 ${f}px "Pixelify Sans", monospace`;
    // The tube: a wide soft glow in pink, then a pale pink core.
    c.shadowColor = CAPSULE.pink;
    c.shadowBlur = 46;
    c.fillStyle = CAPSULE.pink;
    c.fillText('CAPSULE CLUB', w / 2, h * 0.42);
    c.shadowBlur = 12;
    c.fillStyle = '#ffd0e6';
    c.fillText('CAPSULE CLUB', w / 2, h * 0.42);
    c.font = `400 ${Math.round(h * 0.15)}px "Press Start 2P", monospace`;
    c.fillStyle = CAPSULE.cyan;
    c.shadowColor = CAPSULE.cyan;
    c.shadowBlur = 20;
    c.fillText('FREE PLAY  ·  INSERT CHOG', w / 2, h * 0.84);
  }, 1.9, ['700 80px "Pixelify Sans"', '400 20px "Press Start 2P"']);
  hero.position.set(0, 4.85, 0.06);
  room.onWall('back').add(hero);

  // The gacha wall on the right: two rows of six little capsule machines in pastel.
  const gacha = { bodies: [], domes: [], caps: [], knobs: [] };
  const R = room.w / 2;
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < 6; i++) {
      const z = -3.3 + i * 1.12, y = row * 1.32;
      const colour = pick(PASTELS, i + row * 2);
      gacha.bodies.push({ at: [R - 0.45, y + 0.42, z], colour });
      gacha.knobs.push({ at: [R - 0.78, y + 0.38, z], colour: '#ffffff', rot: [0, 0, Math.PI / 2] });
      gacha.domes.push({ at: [R - 0.45, y + 0.86, z] });
      const r = rand(31 + i + row * 6);
      for (let k = 0; k < 7; k++) gacha.caps.push({ at: [R - 0.45 + (r() - 0.5) * 0.3, y + 0.86 + r() * 0.16, z + (r() - 0.5) * 0.3], colour: pick(PASTELS, k + i), rot: [r() * 3, r() * 3, 0], scale: 0.8 });
    }
  }
  many(g, new RoundedBoxGeometry(0.66, 0.84, 0.66, 3, 0.1), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.5 }), gacha.bodies);
  many(g, new THREE.CylinderGeometry(0.11, 0.11, 0.06, 16), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.3 }), gacha.knobs);
  many(g, capGeo, mats.capsule, gacha.caps);
  const dm = many(g, new THREE.SphereGeometry(0.3, 20, 12), mats.acrylic, gacha.domes);
  dm.renderOrder = 3;
  for (const z of [-3.3, 2.3]) g.add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.7, 0.06).translate(R - 0.1, 1.35, z - 0.6), mats.frame));
  const gachaSign = sign(5.2, 0.6, 1024, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `400 ${Math.round(h * 0.42)}px "Press Start 2P", monospace`;
    c.fillStyle = CAPSULE.butter;
    c.shadowColor = '#ff9a3c';
    c.shadowBlur = 18;
    c.fillText('GACHA  WALL', w / 2, h / 2);
  }, 1.8, ['400 20px "Press Start 2P"']);
  gachaSign.position.set(-0.5, 3.15, 0.05);
  room.onWall('right').add(gachaSign);

  // The claw machine, front left: a lilac cabinet, a glass case of capsules, a claw on its gantry.
  const cl = new THREE.Group();
  cl.position.set(-5.7, 0, 2.6);
  cl.rotation.y = Math.PI / 2 - 0.35;
  g.add(cl);
  const clAdd = (geo, m, x, y, z) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    cl.add(mesh);
    return mesh;
  };
  clAdd(new RoundedBoxGeometry(1.5, 1.0, 1.5, 3, 0.1), mats.dark, 0, 0.5, 0);
  clAdd(new RoundedBoxGeometry(1.56, 0.36, 1.56, 3, 0.1), mats.body, 0, 2.95, 0);
  for (const [x, z] of [[-0.72, -0.72], [0.72, -0.72], [-0.72, 0.72], [0.72, 0.72]]) clAdd(new THREE.BoxGeometry(0.06, 1.8, 0.06), mats.frame, x, 1.9, z);
  const caseGlass = clAdd(new THREE.BoxGeometry(1.42, 1.78, 1.42), mats.acrylic, 0, 1.9, 0);
  caseGlass.renderOrder = 3;
  const clr = rand(77);
  const pile = [];
  for (let i = 0; i < 46; i++) pile.push({ at: [(clr() - 0.5) * 1.2, 1.06 + clr() * clr() * 0.42, (clr() - 0.5) * 1.2], colour: pick(PASTELS, i), rot: [clr() * 3, clr() * 3, 0], scale: 1.5 });
  many(cl, capGeo, mats.capsule, pile);
  const claw = new THREE.Group();
  claw.position.set(0.15, 2.3, 0.1);
  claw.add(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.55, 6).translate(0, 0.28, 0), mats.post));
  claw.add(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.12, 12), new THREE.MeshStandardMaterial({ color: '#d8dbe8', roughness: 0.3, metalness: 0.8 })));
  for (let k = 0; k < 3; k++) {
    const prong = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.22, 0.03).translate(0, -0.11, 0), new THREE.MeshStandardMaterial({ color: '#d8dbe8', roughness: 0.3, metalness: 0.8 }));
    prong.rotation.set(0.4, (k * Math.PI * 2) / 3, 0, 'YXZ');
    claw.add(prong);
  }
  cl.add(claw);
  const clawSign = sign(1.3, 0.28, 512, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `400 ${Math.round(h * 0.5)}px "Press Start 2P", monospace`;
    c.fillStyle = CAPSULE.cyan;
    c.shadowColor = CAPSULE.cyan;
    c.shadowBlur = 16;
    c.fillText('CHOG CLAW', w / 2, h / 2);
  }, 1.8, ['400 20px "Press Start 2P"']);
  clawSign.position.set(0, 2.95, 0.79);
  cl.add(clawSign);

  // Stools: a pink seat on a lilac post at each machine.
  for (const m of machines) {
    const p = room.group.worldToLocal(m.group.localToWorld(new THREE.Vector3(0, 0, 1.15)));
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.18, 0.78, 12).translate(p.x, 0.39, p.z), mats.post));
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.16, 20).translate(p.x, 0.84, p.z), mats.seat));
  }

  // The light: pools of pink under the machines, cyan by the gacha wall, butter at the claw.
  for (const x of [-4.2, 0, 4.2]) pool(g, x, -room.d / 2 + 2.2, 1.6, 1.4, CAPSULE.pink, 0.55);
  pool(g, R - 1.6, 0, 1.4, 3.8, CAPSULE.cyan, 0.4);
  pool(g, -5.4, 2.6, 1.6, 1.6, CAPSULE.butter, 0.45);
  pool(g, 0, 1.5, 3.2, 2.6, CAPSULE.lilac, 0.22);

  // The board, on the left wall over the claw machine.
  const board = kit.makeBoard(room.onWall('left'), { x: -0.4, y: 4.3, w: 3.3, h: 2.2, frame: mats.frame, theme: 'capsule' });
  const burst = kit.makeBurst(room);
  room.finish();
  room.casino = {
    machines, strip, mats, burst, board,
    look: {
      name: 'capsule',
      lit: 0.12,
      glow: 0.7,
      light: { sky: '#a493ff', ground: '#3b2270', intensity: 1.15 },
      bulbs: chase([CAPSULE.pink, CAPSULE.cyan]),
      update(t) {
        claw.position.x = 0.15 + Math.sin(t * 0.5) * 0.35;
        claw.position.z = 0.1 + Math.cos(t * 0.37) * 0.3;
      },
    },
  };
  return room;
}

// ======================================================================================
// Starlite Lounge
// ======================================================================================
const STAR = { night: '#12263a', coral: '#ff6f61', mint: '#7ff0c9', mustard: '#ffc94a', cream: '#fff1d6', cyan: '#3ef2ff' };

function terrazzo() {
  return canvas(512, 512, (g, w) => {
    g.fillStyle = '#efe2c8';
    g.fillRect(0, 0, w, w);
    const r = rand(11);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = pick(['#ff6f61', '#7ff0c9', '#ffc94a', '#12263a', '#d9c6a4', '#c9b48e'], i);
      const x = r() * w, y = r() * w, s = 2 + r() * 7;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + s, y + r() * s);
      g.lineTo(x + r() * s, y + s);
      g.fill();
    }
    // Brass strips in a big diamond grid.
    g.strokeStyle = 'rgba(176, 132, 52, 0.7)';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(w, w);
    g.moveTo(w, 0);
    g.lineTo(0, w);
    g.stroke();
  }, { repeat: true });
}

function atomicWall() {
  return canvas(256, 256, (g, w) => {
    g.fillStyle = '#1e4c60';
    g.fillRect(0, 0, w, w);
    // Boomerangs and little starbursts, scattered in a repeat: 1950s wallpaper.
    const r = rand(13);
    for (let i = 0; i < 9; i++) {
      const x = r() * w, y = r() * w, a = r() * Math.PI;
      g.save();
      g.translate(x, y);
      g.rotate(a);
      g.strokeStyle = i % 2 ? 'rgba(127, 240, 201, 0.35)' : 'rgba(255, 201, 74, 0.32)';
      g.lineWidth = 6;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(-22, 8);
      g.quadraticCurveTo(0, -14, 22, 8);
      g.stroke();
      g.restore();
    }
    g.strokeStyle = 'rgba(255, 241, 214, 0.35)';
    g.lineWidth = 2;
    for (let i = 0; i < 7; i++) {
      const x = r() * w, y = r() * w;
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI;
        g.beginPath();
        g.moveTo(x - Math.cos(a) * 9, y - Math.sin(a) * 9);
        g.lineTo(x + Math.cos(a) * 9, y + Math.sin(a) * 9);
        g.stroke();
      }
    }
  }, { repeat: true });
}

function starCeiling() {
  return canvas(512, 512, (g, w) => {
    g.fillStyle = '#0d1d2c';
    g.fillRect(0, 0, w, w);
    const r = rand(5);
    for (let i = 0; i < 160; i++) {
      const x = r() * w, y = r() * w, s = r() < 0.12 ? 3 : 1.4;
      g.fillStyle = `rgba(255, 244, 214, ${0.4 + r() * 0.6})`;
      g.beginPath();
      g.arc(x, y, s, 0, Math.PI * 2);
      g.fill();
    }
  }, { repeat: true });
}

function starburstShape(points, inner, outer) {
  const s = new THREE.Shape();
  for (let i = 0; i <= points * 2; i++) {
    const a = (i / (points * 2)) * Math.PI * 2 + Math.PI / 2;
    const r = i % 2 ? inner : outer * (i % 4 === 0 ? 1 : 0.78);
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  return s;
}

function starliteLook(kit) {
  const room = new kit.Room({
    w: 15, d: 13, h: 6.6,
    wall: '#ffffff', wainscot: '#c95f55', floor: terrazzo(), trim: STAR.mustard, ceiling: '#ffffff',
    openings: [{ wall: 'front', x: 0, y: 0, w: 3.2, h: 4.4, kind: 'door' }],
  });
  const wp = atomicWall();
  wp.repeat.set(0.5, 0.5);
  room.mats.wall.map = wp;
  room.mats.ceiling.map = starCeiling();
  room.mats.ceiling.map.repeat.set(4, 4);
  const g = room.group;
  const chrome = new THREE.MeshStandardMaterial({ color: '#e6eef4', roughness: 0.22, metalness: 0.95 });
  const mats = {
    body: new THREE.MeshStandardMaterial({ color: STAR.coral, roughness: 0.3, metalness: 0.1 }),
    dark: new THREE.MeshStandardMaterial({ color: STAR.cream, roughness: 0.4 }),
    gold: chrome,
    bezel: new THREE.MeshBasicMaterial({ color: '#0b1622' }),
    glass: room.mats.glass,
    shade: kit.shadeMat(),
    line: glow(STAR.coral, 1.6),
    bulb: new THREE.MeshBasicMaterial({ color: '#ffffff' }),
    ball: new THREE.MeshStandardMaterial({ color: STAR.mint, roughness: 0.25 }),
    fin: new THREE.MeshStandardMaterial({ color: STAR.mint, roughness: 0.3 }),
    mustard: new THREE.MeshStandardMaterial({ color: STAR.mustard, roughness: 0.35, metalness: 0.2 }),
    seat: new THREE.MeshStandardMaterial({ color: STAR.mint, roughness: 0.45 }),
  };
  const strip = kit.makeStrip();
  const orbits = [];
  // A cabinet with tail fins and an atomic orbit spinning over its crown.
  const finShape = new THREE.Shape();
  finShape.moveTo(0, 0);
  finShape.quadraticCurveTo(0.05, 0.9, -0.55, 1.35);
  finShape.lineTo(-0.62, 1.25);
  finShape.quadraticCurveTo(-0.3, 0.6, -0.45, 0);
  finShape.lineTo(0, 0);
  const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.06, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2 });
  const style = {
    radius: 0.14,
    top(m, add) {
      add(new RoundedBoxGeometry(1.5, 0.5, 0.72, 4, 0.22), mats.dark, 0, 2.62, -0.08);
      const marquee = sign(1.3, 0.34, 512, (c, w, h) => {
        c.clearRect(0, 0, w, h);
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.font = `600 ${Math.round(h * 0.62)}px Fredoka, sans-serif`;
        c.fillStyle = STAR.coral;
        c.fillText('Chog Slots', w / 2, h / 2 + 2);
      }, 1.0, ['600 60px Fredoka']);
      marquee.material.blending = THREE.NormalBlending;
      marquee.position.set(0, 2.62, 0.29);
      m.add(marquee);
      const orbit = new THREE.Group();
      orbit.position.set(0, 3.25, -0.08);
      orbit.add(new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 14), mats.mustard));
      for (let k = 0; k < 3; k++) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.014, 6, 48), glow(STAR.cyan, 2.2));
        ring.rotation.set(Math.PI / 2 + (k - 1) * 0.9, k * 1.1, 0);
        orbit.add(ring);
        const e = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), glow(STAR.mint, 2.4));
        e.position.set(0.4, 0, 0);
        ring.add(e);
      }
      add(new THREE.CylinderGeometry(0.02, 0.02, 0.4, 6), chrome, 0, 3.0, -0.08);
      m.add(orbit);
      orbits.push(orbit);
      for (const sx of [-1, 1]) {
        const fin = new THREE.Mesh(finGeo, mats.fin);
        fin.position.set(sx * 0.68, 1.0, 0.0);
        fin.rotation.y = sx < 0 ? Math.PI / 2 : -Math.PI / 2;
        if (sx > 0) fin.scale.x = -1;
        m.add(fin);
      }
    },
  };
  const machines = [-4.2, 0, 4.2].map((x) => {
    const m = kit.slotMachine(mats, strip, style);
    m.group.position.set(x, 0, -room.d / 2 + 0.9);
    m.group.rotation.y = -x * 0.06;
    g.add(m.group);
    return m;
  });
  for (const m of machines) m.group.traverse((o) => o.isMesh && (o.userData.keep = true));

  // The starburst on the back wall, over the machines, bulbs on its points, the name under it.
  const back = room.onWall('back');
  const burstGeo = new THREE.ExtrudeGeometry(starburstShape(12, 0.55, 1.45), { depth: 0.1, bevelEnabled: false });
  const sb = new THREE.Mesh(burstGeo, mats.mustard);
  sb.position.set(0, 5.0, 0.08);
  back.add(sb);
  const sbInner = new THREE.Mesh(new THREE.ExtrudeGeometry(starburstShape(12, 0.35, 0.85), { depth: 0.1, bevelEnabled: false }), glow(STAR.cream, 1.3));
  sbInner.position.set(0, 5.0, 0.14);
  back.add(sbInner);
  const tips = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2 + Math.PI / 2, r = i % 2 ? 0.55 : 1.45 * (i % 4 === 0 ? 1 : 0.78);
    if (i % 2) continue;
    tips.push([Math.cos(a) * r, 5.0 + Math.sin(a) * r, 0.22]);
  }
  const tipBulbs = bulbs(back, tips, 0.07);
  const name = sign(4.6, 1.0, 1024, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `600 ${Math.round(h * 0.62)}px Fredoka, sans-serif`;
    c.lineJoin = 'round';
    c.shadowColor = STAR.cyan;
    c.shadowBlur = 30;
    c.strokeStyle = STAR.cyan;
    c.lineWidth = 12;
    c.strokeText('Starlite', w / 2, h / 2);
    c.shadowBlur = 0;
    c.fillStyle = STAR.coral;
    c.fillText('Starlite', w / 2, h / 2);
  }, 1.7, ['600 60px Fredoka']);
  name.position.set(0, 4.95, 0.3);
  back.add(name);

  // The arrow sign on the right of the back wall, its bulbs chasing toward your machine.
  const arrow = new THREE.Shape();
  arrow.moveTo(-1.6, 0.18);
  arrow.lineTo(0.6, 0.18);
  arrow.lineTo(0.6, 0.45);
  arrow.lineTo(1.25, 0);
  arrow.lineTo(0.6, -0.45);
  arrow.lineTo(0.6, -0.18);
  arrow.lineTo(-1.6, -0.18);
  arrow.lineTo(-1.6, 0.18);
  const arrowMesh = new THREE.Mesh(new THREE.ExtrudeGeometry(arrow, { depth: 0.08, bevelEnabled: false }), mats.body);
  arrowMesh.position.set(4.6, 4.6, 0.06);
  arrowMesh.rotation.z = Math.PI + 0.5;
  back.add(arrowMesh);
  const arrowSpots = [];
  for (let i = 0; i < 12; i++) {
    const p = new THREE.Vector3(-1.45 + i * 0.22, 0, 0.14).applyAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI + 0.5).add(new THREE.Vector3(4.6, 4.6, 0));
    arrowSpots.push(p.toArray());
  }
  const arrowBulbs = bulbs(back, arrowSpots, 0.06);

  // Sputnik lamps: a brass ball with rods out to bulbs, over the floor.
  const lampSpots = [];
  const SPUTNIKS = [[-3.4, -0.6], [4.6, -1.6]];
  for (const [x, z] of SPUTNIKS) {
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.9, 6).translate(x, 6.15, z), chrome));
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12).translate(x, 5.7, z), mats.mustard));
    const r = rand(Math.round(x * 10) + 99);
    for (let k = 0; k < 16; k++) {
      const dir = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize();
      const L = 0.5 + r() * 0.2;
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, L, 5).translate(0, L / 2, 0), chrome);
      rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      rod.position.set(x, 5.7, z);
      g.add(rod);
      lampSpots.push([x + dir.x * L, 5.7 + dir.y * L, z + dir.z * L]);
    }
  }
  const lampBulbs = bulbs(g, lampSpots, 0.07);
  lampSpots.forEach((_, i) => lampBulbs.setColorAt(i, C('#ffe2a8', 2.2)));

  // A boomerang counter, front left, mustard top on a coral front.
  const boom = new THREE.Shape();
  boom.moveTo(-1.8, 0.6);
  boom.quadraticCurveTo(0, -0.4, 1.8, 0.6);
  boom.lineTo(1.6, 1.15);
  boom.quadraticCurveTo(0, 0.25, -1.6, 1.15);
  boom.lineTo(-1.8, 0.6);
  const counterTop = new THREE.Mesh(new THREE.ExtrudeGeometry(boom, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.04, bevelSegments: 2 }).rotateX(Math.PI / 2), mats.mustard);
  counterTop.position.set(-5.2, 1.15, -0.4);
  counterTop.rotation.y = Math.PI / 2 - 0.1;
  g.add(counterTop);
  const counterBody = new THREE.Mesh(new THREE.ExtrudeGeometry(boom, { depth: 1.0, bevelEnabled: false }).rotateX(Math.PI / 2).scale(0.96, 1, 0.96), mats.body);
  counterBody.position.set(-5.2, 1.03, -0.4);
  counterBody.rotation.y = Math.PI / 2 - 0.1;
  g.add(counterBody);
  const chips = sign(1.4, 0.36, 512, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `600 ${Math.round(h * 0.6)}px Fredoka, sans-serif`;
    c.fillStyle = STAR.cyan;
    c.shadowColor = STAR.cyan;
    c.shadowBlur = 16;
    c.fillText('Chips', w / 2, h / 2);
  }, 1.8, ['600 60px Fredoka']);
  chips.position.set(0.4, 2.6, 0.06);
  room.onWall('left').add(chips);

  // Tuck-and-roll stools in mint on chrome posts.
  for (const m of machines) {
    const p = room.group.worldToLocal(m.group.localToWorld(new THREE.Vector3(0, 0, 1.15)));
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.2, 0.78, 12).translate(p.x, 0.39, p.z), chrome));
    g.add(new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.1, 10, 24).rotateX(Math.PI / 2).translate(p.x, 0.86, p.z), mats.seat));
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.14, 20).translate(p.x, 0.86, p.z), mats.seat));
  }
  // Warm pools under the lamps, cyan by the machines.
  for (const [x, z] of SPUTNIKS) pool(g, x, z, 2.4, 2.4, '#ffd08a', 0.3);
  for (const x of [-4.2, 0, 4.2]) pool(g, x, -room.d / 2 + 2.2, 1.4, 1.2, STAR.cyan, 0.25);
  // A cyan neon line under the ceiling.
  const W = room.w / 2 - 0.08, D = room.d / 2 - 0.08;
  tube(g, [[-W, 6.4, D], [-W, 6.4, -D], [W, 6.4, -D], [W, 6.4, D]], STAR.cyan, 0.03, 1.8);

  const board = kit.makeBoard(room.onWall('right'), { x: -0.6, y: 3.9, w: 3.4, h: 2.3, frame: chrome, theme: 'starlite' });
  const burst = kit.makeBurst(room);
  room.finish();
  const warm = chase(['#ffe2a8']);
  room.casino = {
    machines, strip, mats, burst, board,
    look: {
      name: 'starlite',
      lit: 0.16,
      glow: 0.55,
      light: { sky: '#ffe9cf', ground: '#3d6a78', intensity: 1.6 },
      bulbs: warm,
      update(t) {
        orbits.forEach((o, i) => (o.rotation.y = t * (0.8 + i * 0.15)));
        for (let i = 0; i < arrowSpots.length; i++) arrowBulbs.setColorAt(i, (Math.floor(t * 9) - i) % 4 === 0 ? warm.hot : (i + Math.floor(t * 9)) % 4 < 2 ? warm.on[0] : warm.off[0]);
        arrowBulbs.instanceColor.needsUpdate = true;
        for (let i = 0; i < tips.length; i++) tipBulbs.setColorAt(i, (i + Math.floor(t * 4)) % 3 ? warm.on[0] : warm.hot);
        tipBulbs.instanceColor.needsUpdate = true;
      },
    },
  };
  return room;
}

// ======================================================================================
// Sugar Pier
// ======================================================================================
const PIER = { cream: '#fff4e6', pink: '#ff8fb8', mint: '#9ff0d8', sky: '#8fd8ff', butter: '#ffe27a', brand: '#ff3d8b' };

function stripes() {
  return canvas(128, 16, (g, w, h) => {
    g.fillStyle = PIER.cream;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffc2d8';
    g.fillRect(0, 0, w / 2, h);
    g.fillStyle = 'rgba(255,255,255,0.6)';
    g.fillRect(w / 2 - 4, 0, 4, h);
  }, { repeat: true });
}

function planks() {
  return canvas(512, 512, (g, w) => {
    const r = rand(23);
    for (let i = 0; i < 8; i++) {
      const y = i * 64;
      g.fillStyle = pick(['#d9a46c', '#cf9a62', '#e0ad76', '#d39e66'], i + Math.floor(r() * 2));
      g.fillRect(0, y, w, 64);
      g.fillStyle = 'rgba(90, 50, 20, 0.5)';
      g.fillRect(0, y, w, 4);
      const cut = Math.floor(r() * w);
      g.fillRect(cut, y, 4, 64);
      g.fillStyle = 'rgba(255, 240, 210, 0.18)';
      for (let k = 0; k < 6; k++) g.fillRect(0, y + 12 + k * 8, w, 1);
      g.fillStyle = 'rgba(70, 40, 20, 0.6)';
      for (const x of [cut - 14, cut + 18]) {
        g.beginPath();
        g.arc(x, y + 16, 3, 0, Math.PI * 2);
        g.arc(x, y + 48, 3, 0, Math.PI * 2);
        g.fill();
      }
    }
  }, { repeat: true });
}

function mural() {
  return canvas(1024, 400, (g, w, h) => {
    const sky = g.createLinearGradient(0, 0, 0, h * 0.62);
    sky.addColorStop(0, '#ffb8d6');
    sky.addColorStop(0.55, '#ffd2a8');
    sky.addColorStop(1, '#ffe9b0');
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);
    // The sun, half down into the sea, with bands.
    g.fillStyle = '#ff8f6e';
    g.beginPath();
    g.arc(w * 0.62, h * 0.62, h * 0.24, Math.PI, 0);
    g.fill();
    g.fillStyle = '#ffb8d6';
    for (let k = 0; k < 4; k++) g.fillRect(w * 0.62 - h * 0.25, h * 0.62 - h * 0.05 - k * h * 0.05, h * 0.5, h * 0.012 + k * 0.6);
    // Clouds.
    g.fillStyle = 'rgba(255,255,255,0.85)';
    for (const [x, y, s] of [[0.15, 0.2, 1], [0.38, 0.12, 0.7], [0.84, 0.25, 0.9]]) {
      for (const [dx, dy, r] of [[0, 0, 0.05], [0.05, -0.02, 0.06], [0.1, 0, 0.045]]) {
        g.beginPath();
        g.arc((x + dx * s) * w, (y + dy) * h, r * s * w, 0, Math.PI * 2);
        g.fill();
      }
    }
    // The sea.
    const sea = g.createLinearGradient(0, h * 0.62, 0, h);
    sea.addColorStop(0, '#7fd6e6');
    sea.addColorStop(1, '#4fb2d4');
    g.fillStyle = sea;
    g.fillRect(0, h * 0.62, w, h * 0.38);
    g.strokeStyle = 'rgba(255,255,255,0.7)';
    g.lineWidth = 4;
    for (let k = 0; k < 7; k++) {
      const y = h * 0.68 + k * h * 0.045;
      g.beginPath();
      for (let x = 0; x <= w; x += 32) g.lineTo(x, y + Math.sin(x * 0.03 + k) * 4);
      g.stroke();
    }
    // Floating islands in the distance, little domes on them.
    g.fillStyle = '#8fd07a';
    for (const [x, y, s] of [[0.2, 0.5, 1], [0.86, 0.46, 0.7]]) {
      g.beginPath();
      g.ellipse(x * w, y * h, 70 * s, 16 * s, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#c9a7e8';
      g.beginPath();
      g.moveTo((x - 0.05 * s) * w, y * h);
      g.lineTo(x * w, (y + 0.14 * s) * h);
      g.lineTo((x + 0.05 * s) * w, y * h);
      g.fill();
      g.fillStyle = 'rgba(230, 240, 255, 0.9)';
      g.beginPath();
      g.arc(x * w, y * h - 8 * s, 18 * s, Math.PI, 0);
      g.fill();
      g.fillStyle = '#8fd07a';
    }
  });
}

function pierLook(kit) {
  const room = new kit.Room({
    w: 15, d: 13, h: 6.6,
    wall: '#ffffff', wainscot: PIER.mint, floor: planks(), trim: '#ffffff', ceiling: PIER.sky,
    openings: [{ wall: 'front', x: 0, y: 0, w: 3.2, h: 4.4, kind: 'door' }],
  });
  const st = stripes();
  st.repeat.set(1.1, 1);
  room.mats.wall.map = st;
  const g = room.group;
  const mats = {
    body: new THREE.MeshStandardMaterial({ color: PIER.mint, roughness: 0.35 }),
    dark: new THREE.MeshStandardMaterial({ color: PIER.pink, roughness: 0.4 }),
    gold: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.3 }),
    bezel: new THREE.MeshBasicMaterial({ color: '#2a3a4a' }),
    glass: room.mats.glass,
    shade: kit.shadeMat(),
    line: glow(PIER.brand, 1.4),
    bulb: new THREE.MeshBasicMaterial({ color: '#ffffff' }),
    ball: new THREE.MeshStandardMaterial({ color: PIER.brand, roughness: 0.25 }),
    awning: new THREE.MeshStandardMaterial({ map: canvas(256, 16, (c, w, h) => {
      for (let i = 0; i < 8; i++) {
        c.fillStyle = i % 2 ? '#ffffff' : '#ff7fae';
        c.fillRect((i * w) / 8, 0, w / 8, h);
      }
    }), roughness: 0.5, side: THREE.DoubleSide }),
    wheel: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.4 }),
    seat: new THREE.MeshStandardMaterial({ color: PIER.butter, roughness: 0.4 }),
    wood: new THREE.MeshStandardMaterial({ color: '#e9b37a', roughness: 0.6 }),
  };
  const strip = kit.makeStrip();
  const scallop = [];
  // An ice-cream cart: mint cabinet, a striped awning on two white poles, wheels at its feet.
  const style = {
    radius: 0.12,
    top(m, add) {
      add(new RoundedBoxGeometry(1.5, 0.38, 0.7, 3, 0.1), mats.gold, 0, 2.55, -0.08);
      const marquee = sign(1.36, 0.3, 512, (c, w, h) => {
        c.clearRect(0, 0, w, h);
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.font = `600 ${Math.round(h * 0.66)}px Fredoka, sans-serif`;
        c.fillStyle = PIER.brand;
        c.fillText('Chog Slots', w / 2, h / 2 + 2);
      }, 1.0, ['600 60px Fredoka']);
      marquee.material.blending = THREE.NormalBlending;
      marquee.position.set(0, 2.55, 0.28);
      m.add(marquee);
      for (const sx of [-0.66, 0.66]) add(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 8), mats.gold, sx, 3.1, 0.15);
      const roof = add(new THREE.CylinderGeometry(0.62, 0.62, 1.7, 24, 1, true, -Math.PI / 2, Math.PI).rotateZ(Math.PI / 2).scale(1, 0.55, 1), mats.awning, 0, 3.5, 0.0);
      roof.rotation.x = 0;
      for (let i = 0; i < 9; i++) scallop.push({ m, at: [-0.76 + i * 0.19, 3.5, 0.62], colour: i % 2 ? '#ffffff' : '#ff7fae', rot: [Math.PI / 2, 0, 0] });
      add(new THREE.SphereGeometry(0.09, 12, 8), mats.ball, 0, 3.88, 0.0);
      for (const sx of [-1, 1]) add(new THREE.CylinderGeometry(0.22, 0.22, 0.08, 20).rotateZ(Math.PI / 2), mats.wheel, sx * 0.78, 0.22, 0.25);
    },
  };
  const machines = [-4.2, 0, 4.2].map((x) => {
    const m = kit.slotMachine(mats, strip, style);
    m.group.position.set(x, 0, -room.d / 2 + 0.9);
    m.group.rotation.y = -x * 0.06;
    g.add(m.group);
    return m;
  });
  const scGeo = new THREE.CircleGeometry(0.1, 12, 0, Math.PI);
  for (const m of machines) many(m.group, scGeo, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.5, side: THREE.DoubleSide }), scallop.filter((s) => s.m === m.group).map((s) => ({ ...s, at: [s.at[0], s.at[1] - 0.01, s.at[2]], rot: [Math.PI, 0, 0] })));
  for (const m of machines) m.group.traverse((o) => o.isMesh && (o.userData.keep = true));

  // The sunset mural over the machines, in a white frame, and the bulb-letter name over it.
  const back = room.onWall('back');
  const mu = new THREE.Mesh(new THREE.PlaneGeometry(9, 3.5), new THREE.MeshLambertMaterial({ map: mural(), emissive: '#ffffff', emissiveIntensity: 0.55 }));
  mu.material.emissiveMap = mu.material.map;
  mu.position.set(0, 4.0, 0.04);
  back.add(mu);
  back.add(new THREE.Mesh(new THREE.BoxGeometry(9.3, 3.8, 0.06).translate(0, 4.0, 0.0), mats.gold));
  const name = sign(5.4, 1.1, 1024, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `700 ${Math.round(h * 0.64)}px Fredoka, sans-serif`;
    c.lineJoin = 'round';
    c.lineWidth = 22;
    c.strokeStyle = '#ffffff';
    c.strokeText('Sugar Pier', w / 2, h / 2);
    c.fillStyle = PIER.brand;
    c.fillText('Sugar Pier', w / 2, h / 2);
  }, 1.0, ['700 60px Fredoka']);
  name.material.blending = THREE.NormalBlending;
  name.position.set(0, 5.62, 0.1);
  back.add(name);
  const nameBulbs = [];
  for (let i = 0; i < 26; i++) nameBulbs.push([-2.8 + i * 0.224, 5.04, 0.14], [-2.8 + i * 0.224, 6.22, 0.14]);
  const nb = bulbs(back, nameBulbs, 0.05);

  // Lifebuoys on the side walls.
  const buoy = new THREE.TorusGeometry(0.42, 0.13, 10, 32);
  const red = new THREE.MeshStandardMaterial({ roughness: 0.4, map: canvas(64, 8, (c, w, h) => {
    for (let i = 0; i < 8; i++) {
      c.fillStyle = i % 2 ? '#ffffff' : '#ff5a6e';
      c.fillRect((i * w) / 8, 0, w / 8, h);
    }
  }) });
  for (const [side, x] of [['left', -3], ['left', 3.5], ['right', 3.5]]) {
    const b = new THREE.Mesh(buoy, red);
    b.position.set(x, 3.7, 0.15);
    room.onWall(side).add(b);
  }

  // Bunting: four strings across the room, pennants in sweet colours.
  const flags = [];
  for (let s = 0; s < 4; s++) {
    const z = -1.6 + s * 2.2;
    for (let i = 0; i <= 22; i++) {
      const x = -7.2 + i * (14.4 / 22);
      const sag = 0.35 * (1 - ((x / 7.2) ** 2));
      flags.push({ at: [x, 6.5 - sag, z], colour: pick([PIER.pink, PIER.mint, PIER.sky, PIER.butter, '#ffffff'], i + s), rot: [0, 0, Math.PI] });
    }
  }
  const pennant = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.16, 0, 0), new THREE.Vector3(0.16, 0, 0), new THREE.Vector3(0, 0.36, 0)]);
  pennant.setIndex([0, 1, 2]);
  pennant.computeVertexNormals();
  many(g, pennant, new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide }), flags);

  // Skee-ball along the left wall: two lanes up to rings.
  for (const z of [-0.6, 1.8]) {
    const lane = new THREE.Group();
    lane.position.set(-6.0, 0, z);
    lane.add(new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.7, 1.0).translate(0.4, 0.35, 0), mats.dark));
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.08, 0.8), mats.wood);
    ramp.position.set(1.6, 0.9, 0);
    ramp.rotation.z = -0.22;
    lane.add(ramp);
    const backboard = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.0, 1.0).translate(-0.45, 1.2, 0), mats.body);
    lane.add(backboard);
    for (const sz of [-0.44, 0.44]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.16, 0.08), mats.gold);
      rail.position.set(1.6, 0.98, sz);
      rail.rotation.z = -0.22;
      lane.add(rail);
    }
    lane.add(new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.5, 0.9, 3, 0.08).translate(2.9, 0.25, 0), mats.dark));
    for (const [r, y, c] of [[0.36, 1.25, '#ffffff'], [0.24, 1.25, PIER.pink], [0.13, 1.25, PIER.butter]]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.035, 6, 24).rotateY(Math.PI / 2), new THREE.MeshStandardMaterial({ color: c, roughness: 0.4 }));
      ring.position.set(-0.32, y, 0);
      lane.add(ring);
    }
    g.add(lane);
  }
  const skee = sign(2.6, 0.5, 512, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `700 ${Math.round(h * 0.62)}px Fredoka, sans-serif`;
    c.lineWidth = 12;
    c.strokeStyle = '#ffffff';
    c.lineJoin = 'round';
    c.strokeText('Skee-Ball', w / 2, h / 2);
    c.fillStyle = '#4fb2d4';
    c.fillText('Skee-Ball', w / 2, h / 2);
  }, 1.0, ['700 60px Fredoka']);
  skee.material.blending = THREE.NormalBlending;
  skee.position.set(0.6, 3.0, 0.06);
  room.onWall('left').add(skee);

  // Butter stools on white posts.
  for (const m of machines) {
    const p = room.group.worldToLocal(m.group.localToWorld(new THREE.Vector3(0, 0, 1.15)));
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.17, 0.78, 12).translate(p.x, 0.39, p.z), mats.gold));
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.16, 20).translate(p.x, 0.84, p.z), mats.seat));
  }
  for (const x of [-4.2, 0, 4.2]) pool(g, x, -room.d / 2 + 2.1, 1.3, 1.1, '#fff0c8', 0.18);

  const board = kit.makeBoard(room.onWall('right'), { x: -0.8, y: 3.7, w: 3.3, h: 2.2, frame: mats.gold, theme: 'pier' });
  const burst = kit.makeBurst(room);
  room.finish();
  const warm = chase(['#fff2cf']);
  room.casino = {
    machines, strip, mats, burst, board,
    look: {
      name: 'pier',
      lit: 0.2,
      glow: 0.25,
      light: { sky: '#ffffff', ground: '#ffd2c0', intensity: 1.45 },
      bulbs: warm,
      update(t) {
        for (let i = 0; i < nameBulbs.length; i++) nb.setColorAt(i, (Math.floor(i / 2) + Math.floor(t * 6)) % 3 === 0 ? warm.hot : warm.on[0]);
        nb.instanceColor.needsUpdate = true;
      },
    },
  };
  return room;
}

export const LOOKS = { capsule: capsuleLook, starlite: starliteLook, pier: pierLook };
