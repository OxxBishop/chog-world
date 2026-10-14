import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Room } from './interior.js';

/*
 * The casino (B8), in the Hub's right wing: one game, Chog Slots, for free chips only. Nothing here
 * touches a wallet or a token: chips are a number kept in this browser, topped up every day, and
 * no transaction is ever asked for.
 *
 * Three reels of six symbols, and the jackpot symbol is your own Chog. Your Chog's traits give perks:
 * its tier sets the day's free chips, laser eyes and lucky charms give re-rolls (spin one reel again
 * after a losing spin), and a crown, a king's robe or a sharp suit pays every win a little more.
 * A leaderboard of the Chogs with the most chips hangs on the wall.
 *
 * buildCasinoRoom() is the room itself (src/hub.js places it); createCasino() is the game, its
 * panel and its camera moves (src/main.js).
 */

const BASE = import.meta.env?.BASE_URL ?? '/';

// ---------- the game's rules ----------
// Twelve stops a reel, the rarer symbols paying more. Returns about 94% of what is bet, and something
// comes back on 4 spins in 10. The jackpot (three Chogs) is 1 in 1728.
export const SYMBOLS = ['chog', 'coin', 'die', 'chip', 'star', 'heart'];
const STRIP = ['heart', 'die', 'star', 'chip', 'heart', 'coin', 'star', 'die', 'heart', 'chog', 'star', 'chip'];
const THREE_OF = { chog: 150, coin: 50, die: 20, chip: 12, star: 8, heart: 6 };
const NAMES = { chog: 'Chogs', coin: 'Coins', die: 'Dice', chip: 'Chips', star: 'Stars', heart: 'Hearts' };
const BETS = [5, 10, 25, 50, 100];

/** What a line pays, as a multiple of the bet. */
export function payout(line) {
  const [a, b, c] = line;
  if (a === b && b === c) return THREE_OF[a];
  const chogs = line.filter((s) => s === 'chog').length;
  if (chogs === 2) return 6;
  if (chogs === 1) return 1;
  return a === b ? 1 : 0;
}

/**
 * The perks a Chog's traits give (traits as in public/data/chogs.json). A guest plays as Common.
 * { daily, rerolls, mult, list: [{ trait, text }] }
 */
export function perksFor(traits = {}) {
  const list = [];
  const tier = traits.Tier ?? 'Common';
  const daily = { Common: 500, Uncommon: 600, Rare: 800, Epic: 1000, Legendary: 1500 }[tier] ?? 500;
  list.push({ trait: tier, text: `${daily} free chips a day` });
  let rerolls = 1;
  if (/laser/i.test(traits.Eyes ?? '')) {
    rerolls += 2;
    list.push({ trait: traits.Eyes, text: '2 more re-rolls a day' });
  }
  if (['Coin', 'Heart', 'Green Candle', 'Fwog'].includes(traits.Accessory)) {
    rerolls += 1;
    list.push({ trait: traits.Accessory, text: 'a lucky charm: 1 more re-roll' });
  }
  let mult = 1;
  const royal = traits.Head === 'Crown' || traits.Body === 'Kings Robe' || traits.Accessory === 'Cigar';
  const sharp = ['Tuxedo', 'Gangster suit'].includes(traits.Body);
  if (royal) {
    mult = 1.2;
    list.push({ trait: traits.Head === 'Crown' ? 'Crown' : traits.Body === 'Kings Robe' ? 'Kings Robe' : 'Cigar', text: 'high roller: wins pay 1.2x' });
  } else if (sharp) {
    mult = 1.1;
    list.push({ trait: traits.Body, text: 'sharp dresser: wins pay 1.1x' });
  }
  return { daily, rerolls, mult, list };
}

const today = () => new Date().toISOString().slice(0, 10);
const STORE = 'chogworld.casino.v1';
function loadStore() {
  try {
    return JSON.parse(localStorage.getItem(STORE)) ?? {};
  } catch {
    return {};
  }
}
function saveStore(all) {
  try {
    localStorage.setItem(STORE, JSON.stringify(all));
  } catch {
    // Private window or storage off: the chips last as long as the page.
  }
}
const randomStop = () => {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] % STRIP.length;
};

// ---------- drawing ----------
function canvasTex(w, h, draw, repeat = false) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// The casino's carpet: deep plum, gold rings with red hearts of diamonds between, about 1.25 m a
// tile: busy, as a casino's carpet is.
const carpet = () =>
  canvasTex(256, 256, (g, w) => {
    g.fillStyle = '#2a1238';
    g.fillRect(0, 0, w, w);
    g.strokeStyle = '#c9963a';
    g.lineWidth = 6;
    for (const [x, y] of [[0, 0], [w, 0], [0, w], [w, w], [w / 2, w / 2]]) {
      g.beginPath();
      g.arc(x, y, w * 0.2, 0, Math.PI * 2);
      g.stroke();
    }
    g.strokeStyle = 'rgba(201, 150, 58, 0.45)';
    g.lineWidth = 2;
    for (const [x, y] of [[0, 0], [w, 0], [0, w], [w, w], [w / 2, w / 2]]) {
      g.beginPath();
      g.arc(x, y, w * 0.14, 0, Math.PI * 2);
      g.stroke();
    }
    g.fillStyle = '#b8283e';
    for (const [x, y] of [[w / 2, 0], [0, w / 2], [w, w / 2], [w / 2, w]]) {
      g.beginPath();
      g.moveTo(x, y - 18);
      g.lineTo(x + 14, y);
      g.lineTo(x, y + 18);
      g.lineTo(x - 14, y);
      g.fill();
    }
    g.fillStyle = '#e8b84a';
    for (const [x, y] of [[w / 4, w / 4], [(3 * w) / 4, w / 4], [w / 4, (3 * w) / 4], [(3 * w) / 4, (3 * w) / 4]]) {
      g.beginPath();
      g.arc(x, y, 4, 0, Math.PI * 2);
      g.fill();
    }
  }, true);

// The shade over a reel window: dark at the top and bottom, clear across the middle.
const reelShade = () =>
  canvasTex(8, 128, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(20, 8, 16, 0.85)');
    grad.addColorStop(0.3, 'rgba(20, 8, 16, 0)');
    grad.addColorStop(0.7, 'rgba(20, 8, 16, 0)');
    grad.addColorStop(1, 'rgba(20, 8, 16, 0.85)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });

// One symbol, drawn upright in a cell `s` pixels square centred on (0, 0).
function drawSymbol(g, name, s, face) {
  const r = s * 0.36;
  g.save();
  if (name === 'chog') {
    g.beginPath();
    g.arc(0, 0, r * 1.08, 0, Math.PI * 2);
    g.fillStyle = '#3a1f6e';
    g.fill();
    if (face) {
      g.save();
      g.beginPath();
      g.arc(0, 0, r, 0, Math.PI * 2);
      g.clip();
      const w = face.naturalWidth || face.width, h = face.naturalHeight || face.height, m = Math.min(w, h);
      g.drawImage(face, m * 0.1, m * 0.16, m * 0.8, m * 0.8, -r, -r, r * 2, r * 2);
      g.restore();
    } else {
      g.fillStyle = '#b89cff';
      g.font = `600 ${s * 0.42}px Fredoka, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('C', 0, s * 0.02);
    }
    g.lineWidth = s * 0.05;
    g.strokeStyle = '#e8b84a';
    g.beginPath();
    g.arc(0, 0, r * 1.08, 0, Math.PI * 2);
    g.stroke();
  } else if (name === 'coin') {
    const grad = g.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
    grad.addColorStop(0, '#fff2b0');
    grad.addColorStop(1, '#d99a22');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = s * 0.04;
    g.strokeStyle = '#9a6612';
    g.stroke();
    g.beginPath();
    g.arc(0, 0, r * 0.72, 0, Math.PI * 2);
    g.stroke();
    // A little Chog's head on the coin: round, two ears.
    g.fillStyle = '#9a6612';
    g.beginPath();
    g.arc(0, r * 0.08, r * 0.34, 0, Math.PI * 2);
    g.fill();
    for (const sx of [-1, 1]) {
      g.beginPath();
      g.moveTo(sx * r * 0.16, -r * 0.16);
      g.lineTo(sx * r * 0.38, -r * 0.5);
      g.lineTo(sx * r * 0.36, -r * 0.08);
      g.fill();
    }
  } else if (name === 'die') {
    g.fillStyle = '#fffaf0';
    g.strokeStyle = '#3a1f4a';
    g.lineWidth = s * 0.035;
    g.beginPath();
    g.roundRect(-r, -r, r * 2, r * 2, r * 0.32);
    g.fill();
    g.stroke();
    g.fillStyle = '#3a1f4a';
    for (const [u, v] of [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]]) {
      g.beginPath();
      g.arc(u * r * 0.52, v * r * 0.52, r * 0.15, 0, Math.PI * 2);
      g.fill();
    }
  } else if (name === 'chip') {
    g.fillStyle = '#c4334a';
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff6e8';
    for (let k = 0; k < 8; k++) {
      g.save();
      g.rotate((k / 8) * Math.PI * 2);
      g.fillRect(-r * 0.14, -r, r * 0.28, r * 0.26);
      g.restore();
    }
    g.beginPath();
    g.arc(0, 0, r * 0.56, 0, Math.PI * 2);
    g.fillStyle = '#fff6e8';
    g.fill();
    g.beginPath();
    g.arc(0, 0, r * 0.44, 0, Math.PI * 2);
    g.fillStyle = '#c4334a';
    g.fill();
  } else if (name === 'star') {
    g.fillStyle = '#ffd23f';
    g.strokeStyle = '#c47a12';
    g.lineWidth = s * 0.035;
    g.beginPath();
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + (k / 10) * Math.PI * 2;
      const rr = k % 2 ? r * 0.45 : r * 1.05;
      g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr + r * 0.06);
    }
    g.closePath();
    g.fill();
    g.stroke();
  } else if (name === 'heart') {
    g.fillStyle = '#ff5f8f';
    g.strokeStyle = '#b02a58';
    g.lineWidth = s * 0.035;
    g.beginPath();
    g.moveTo(0, r * 0.85);
    g.bezierCurveTo(-r * 1.3, -r * 0.05, -r * 0.6, -r * 1.05, 0, -r * 0.42);
    g.bezierCurveTo(r * 0.6, -r * 1.05, r * 1.3, -r * 0.05, 0, r * 0.85);
    g.fill();
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.beginPath();
    g.ellipse(-r * 0.42, -r * 0.3, r * 0.16, r * 0.1, -0.6, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

/*
 * A reel's strip, wrapped round a cylinder whose axis runs across the machine: the canvas runs
 * round the reel along x and across it along y, so each symbol is drawn turned a quarter, which
 * stands it upright at the front, and stretched round the reel by how much longer a pixel is across
 * it than round it, so it comes out square.
 */
function drawStrip(c, face) {
  const g = c.getContext('2d');
  const s = c.height;
  const stretch = ((REEL_W / s) / ((2 * Math.PI * REEL_R) / c.width));
  g.fillStyle = '#fffaf0';
  g.fillRect(0, 0, c.width, s);
  STRIP.forEach((name, i) => {
    g.save();
    g.translate((i + 0.5) * s, s / 2);
    g.fillStyle = i % 2 ? '#fff1d6' : '#fffaf0';
    g.fillRect(-s / 2, -s / 2, s, s);
    g.fillStyle = 'rgba(120, 60, 30, 0.22)';
    g.fillRect(-s / 2, -s / 2, 3, s);
    g.rotate(Math.PI / 2);
    g.scale(1, stretch);
    drawSymbol(g, name, s / stretch, face);
    g.restore();
  });
}

function signTex(title, sub) {
  return canvasTex(1024, 300, (g, w, h) => {
    g.fillStyle = '#2a0c18';
    g.beginPath();
    g.roundRect(6, 6, w - 12, h - 12, 60);
    g.fill();
    g.lineWidth = 10;
    g.strokeStyle = '#e8b84a';
    g.stroke();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#ffe6a8';
    g.shadowColor = '#ff9a3c';
    g.shadowBlur = 28;
    g.font = '600 150px Fredoka, sans-serif';
    g.fillText(title, w / 2, sub ? 120 : h / 2);
    if (sub) {
      g.shadowBlur = 0;
      g.fillStyle = '#ffb3c8';
      g.font = '500 54px Figtree, sans-serif';
      g.fillText(sub, w / 2, 240);
    }
  });
}

// The leaderboard's face: the top Chogs by chips, or how to get on it.
function drawBoard(canvas, rows, shared) {
  const g = canvas.getContext('2d');
  const { width: w, height: h } = canvas;
  g.fillStyle = '#1a0812';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(232, 184, 74, 0.5)';
  g.lineWidth = 4;
  g.strokeRect(14, 14, w - 28, h - 28);
  g.textAlign = 'center';
  g.fillStyle = '#ffe6a8';
  g.shadowColor = '#ff9a3c';
  g.shadowBlur = 18;
  g.font = '600 64px Fredoka, sans-serif';
  g.fillText('TOP CHOGS', w / 2, 86);
  g.shadowBlur = 0;
  g.font = '500 24px Figtree, sans-serif';
  g.fillStyle = '#ffb3c8';
  g.fillText(shared ? 'most chips in Chog World' : 'most chips at this machine', w / 2, 124);
  rows.slice(0, 7).forEach((row, i) => {
    const y = 180 + i * 46;
    g.fillStyle = i === 0 ? '#ffd23f' : '#fff6e8';
    g.font = '600 32px Fredoka, sans-serif';
    g.textAlign = 'left';
    g.fillText(`${i + 1}`, 64, y);
    g.fillText(String(row.name).slice(0, 18), 112, y);
    g.textAlign = 'right';
    g.fillText(Number(row.chips).toLocaleString('en-US'), w - 64, y);
  });
  if (!rows.length) {
    g.textAlign = 'center';
    g.fillStyle = '#fff6e8';
    g.font = '500 30px Figtree, sans-serif';
    g.fillText('Sign in with your Chog', w / 2, 270);
    g.fillText('to get on the board.', w / 2, 312);
  }
}

// ---------- the slot machine ----------
const REEL_R = 0.42, REEL_W = 0.36;
const STEP = (Math.PI * 2) / STRIP.length;

/*
 * A slot machine, 2.3 m tall at Chog scale: a lacquered red cabinet on a dark base, three reels
 * behind a glass window ringed with bulbs, a lit "CHOG SLOTS" top and a lever on its right.
 * Returns { group, reels, lever, bulbs, bulbMat, face(img) }.
 */
function slotMachine(mats, faceStrip) {
  const g = new THREE.Group();
  const add = (geo, m, x, y, z) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    g.add(mesh);
    return mesh;
  };
  const box = (w, h, d, m, x, y, z) => add(new THREE.BoxGeometry(w, h, d), m, x, y, z);
  // The base, the body behind the reels, and the front round the reel window (x +-0.6, y 1.25 to
  // 1.99), its recess deep enough for the reels to turn in.
  add(new RoundedBoxGeometry(1.5, 0.9, 0.95, 3, 0.08), mats.dark, 0, 0.45, 0);
  add(new RoundedBoxGeometry(1.42, 1.5, 0.62, 3, 0.08), mats.body, 0, 1.62, -0.26);
  box(1.42, 0.375, 0.31, mats.body, 0, 1.0625, 0.205);
  box(1.42, 0.36, 0.31, mats.body, 0, 2.17, 0.205);
  for (const sx of [-1, 1]) box(0.11, 0.74, 0.31, mats.body, sx * 0.655, 1.62, 0.205);
  box(1.2, 0.74, 0.02, mats.bezel, 0, 1.62, -0.52);
  // The sloped play shelf, and gold round the window and the cabinet.
  box(1.46, 0.08, 0.5, mats.gold, 0, 0.93, 0.26).rotation.x = -0.18;
  for (const y of [1.235, 2.005]) box(1.26, 0.04, 0.04, mats.gold, 0, y, 0.37);
  for (const sx of [-1, 1]) box(0.04, 0.8, 0.04, mats.gold, sx * 0.61, 1.62, 0.37);
  for (const y of [0.875, 2.36]) box(1.46, 0.05, 0.66, mats.gold, 0, y, 0.05);
  // Three reels, and dark dividers between them.
  const reels = [];
  for (const x of [-0.39, 0, 0.39]) {
    const geo = new THREE.CylinderGeometry(REEL_R, REEL_R, REEL_W, 48, 1, true).rotateZ(Math.PI / 2);
    const reel = add(geo, faceStrip.mat, x, 1.62, -0.08);
    reel.userData.angle = 0;
    reels.push(reel);
  }
  for (const x of [-0.195, 0.195]) box(0.025, 0.74, 0.9, mats.bezel, x, 1.62, -0.1);
  // The payline, the glass, and a soft shade top and bottom so the reels read as curving away.
  box(1.16, 0.016, 0.01, mats.line, 0, 1.62, 0.355);
  add(new THREE.PlaneGeometry(1.2, 0.74), mats.glass, 0, 1.62, 0.36);
  add(new THREE.PlaneGeometry(1.2, 0.74), mats.shade, 0, 1.62, 0.358);
  // The top: a lit "CHOG SLOTS" panel.
  add(new RoundedBoxGeometry(1.5, 0.62, 0.7, 3, 0.12), mats.dark, 0, 2.68, -0.08);
  const sign = add(new THREE.PlaneGeometry(1.36, 0.4), mats.sign, 0, 2.69, 0.28);
  sign.renderOrder = 1;
  // Bulbs round the window.
  const spots = [];
  for (let i = 0; i < 9; i++) spots.push([-0.62 + i * 0.155, 2.1], [-0.62 + i * 0.155, 1.14]);
  for (let i = 1; i < 6; i++) spots.push([-0.7, 1.14 + i * 0.16], [0.7, 1.14 + i * 0.16]);
  const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.032, 8, 6), mats.bulb, spots.length);
  spots.forEach(([x, y], i) => {
    bulbs.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x, y, 0.38));
    bulbs.setColorAt(i, new THREE.Color('#ffd27a'));
  });
  g.add(bulbs);
  // The lever: a gold arm on a hub on the right side, a red ball on top.
  const lever = new THREE.Group();
  lever.position.set(0.78, 1.5, 0.0);
  lever.add(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.1, 16).rotateZ(Math.PI / 2), mats.gold));
  lever.add(new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.6, 10).translate(0.06, 0.3, 0), mats.gold));
  lever.add(new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12).translate(0.06, 0.62, 0), mats.ball));
  g.add(lever);
  return { group: g, reels, lever, bulbs, spots };
}

/** The casino: a dark red room, slot machines along the back, a card table, the leaderboard. */
export function buildCasinoRoom() {
  const room = new Room({
    w: 15, d: 13, h: 6.6,
    wall: '#5e1c2a', wainscot: '#24101c', floor: carpet(), trim: '#8a5a22', ceiling: '#2c1220',
    openings: [{ wall: 'front', x: 0, y: 0, w: 3.2, h: 4.4, kind: 'door' }],
  });
  const mats = {
    body: new THREE.MeshStandardMaterial({ color: '#3a2266', roughness: 0.35, metalness: 0.15 }),
    dark: new THREE.MeshStandardMaterial({ color: '#1c1028', roughness: 0.5 }),
    gold: room.mats.brass,
    bezel: new THREE.MeshBasicMaterial({ color: '#120812' }),
    glass: room.mats.glass,
    shade: new THREE.MeshBasicMaterial({ map: reelShade(), transparent: true, depthWrite: false }),
    line: new THREE.MeshBasicMaterial({ color: '#ffcf5a' }),
    bulb: new THREE.MeshBasicMaterial({ color: '#ffffff' }),
    ball: new THREE.MeshStandardMaterial({ color: '#d8243c', roughness: 0.3 }),
    sign: new THREE.MeshBasicMaterial({ map: signTex('CHOG SLOTS'), transparent: true }),
    felt: new THREE.MeshLambertMaterial({ color: '#1f6b47' }),
    velvet: new THREE.MeshLambertMaterial({ color: '#a01e36' }),
  };
  // The reels' strip, redrawn with your Chog's face once it's known.
  const stripCanvas = document.createElement('canvas');
  stripCanvas.width = 128 * STRIP.length;
  stripCanvas.height = 128;
  drawStrip(stripCanvas, null);
  const stripTex = new THREE.CanvasTexture(stripCanvas);
  stripTex.colorSpace = THREE.SRGBColorSpace;
  stripTex.anisotropy = 8;
  const strip = { canvas: stripCanvas, tex: stripTex, mat: new THREE.MeshBasicMaterial({ map: stripTex }) };

  // Three machines along the back wall, the middle one yours to play, the others turned in a little.
  const machines = [-4.2, 0, 4.2].map((x) => {
    const m = slotMachine(mats, strip);
    m.group.position.set(x, 0, -room.d / 2 + 0.9);
    m.group.rotation.y = -x * 0.06;
    room.group.add(m.group);
    return m;
  });
  for (const m of machines) m.group.traverse((o) => o.isMesh && (o.userData.keep = true));
  // A low brass rail in front of the machines.
  for (const x of [-2.1, 2.1]) room.group.add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 8).translate(x, 0.5, -room.d / 2 + 2.4), mats.gold));

  // Gold pilasters up the walls and a gold band under the ceiling, art deco style.
  for (const [side, len] of [['back', room.w], ['left', room.d], ['right', room.d]]) {
    const wall = room.onWall(side);
    const n = Math.round(len / 3.2);
    for (let i = 0; i <= n; i++) {
      const x = -len / 2 + 0.3 + (i * (len - 0.6)) / n;
      // Not through the leaderboard.
      if (side === 'back' && Math.abs(x) < 2.1) continue;
      wall.add(new THREE.Mesh(new THREE.BoxGeometry(0.26, room.h - 1.3, 0.1).translate(x, 1.3 + (room.h - 1.3) / 2, 0.05), mats.gold));
    }
    wall.add(new THREE.Mesh(new THREE.BoxGeometry(len, 0.14, 0.12).translate(0, room.h - 0.5, 0.06), mats.gold));
  }
  // A stool at each machine: a red velvet seat on a gold post.
  for (const m of machines) {
    const p = m.group.localToWorld(new THREE.Vector3(0, 0, 1.15));
    room.group.worldToLocal(p);
    room.group.add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.16, 0.78, 12).translate(p.x, 0.39, p.z), mats.gold));
    room.group.add(new THREE.Mesh(new RoundedBoxGeometry(0.62, 0.16, 0.62, 3, 0.07).translate(p.x, 0.84, p.z), mats.velvet));
  }
  // A round card table in green felt on the left, chips stacked on it, four stools round it.
  const T = { x: -3.9, z: 2.4 };
  room.group.add(new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.35, 0.12, 40).translate(T.x, 1.1, T.z), mats.felt));
  room.group.add(new THREE.Mesh(new THREE.TorusGeometry(1.36, 0.08, 10, 48).rotateX(Math.PI / 2).translate(T.x, 1.14, T.z), room.mats.trim));
  room.group.add(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.5, 1.05, 16).translate(T.x, 0.52, T.z), mats.dark));
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    const x = T.x + Math.cos(a) * 1.95, z = T.z + Math.sin(a) * 1.95;
    room.group.add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.16, 0.78, 12).translate(x, 0.39, z), mats.gold));
    room.group.add(new THREE.Mesh(new RoundedBoxGeometry(0.62, 0.16, 0.62, 3, 0.07).translate(x, 0.84, z), mats.velvet));
  }
  const chipGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.035, 18);
  const chipMats = ['#c4334a', '#1d1d2a', '#e8b84a'].map((c) => new THREE.MeshLambertMaterial({ color: c }));
  [[-0.5, -0.3, 6], [-0.2, 0.1, 4], [0.4, -0.4, 8], [0.5, 0.45, 3], [-0.3, 0.6, 5]].forEach(([dx, dz, n], k) => {
    for (let i = 0; i < n; i++) {
      const c = new THREE.Mesh(chipGeo, chipMats[(i + k) % 3]);
      c.position.set(T.x + dx + Math.sin(i * 1.9) * 0.01, 1.18 + i * 0.036, T.z + dz + Math.cos(i * 1.3) * 0.01);
      room.group.add(c);
    }
  });
  // A velvet rope on gold posts either side of the way in, and plants by the door.
  for (const sx of [-1, 1]) {
    const posts = [[sx * 2.4, 5.2], [sx * 2.4, 3.2]];
    for (const [x, z] of posts) {
      room.group.add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.0, 10).translate(x, 0.5, z), mats.gold));
      room.group.add(new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8).translate(x, 1.04, z), mats.gold));
      room.group.add(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.06, 16).translate(x, 0.03, z), mats.gold));
    }
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(sx * 2.4, 0.95, 5.2), new THREE.Vector3(sx * 2.4, 0.6, 4.2), new THREE.Vector3(sx * 2.4, 0.95, 3.2));
    room.group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.035, 8), mats.velvet));
  }
  room.put('cactus_medium_A', -6.6, 5.6, 0);
  room.put('cactus_medium_A', 6.6, 5.6, 0);
  room.hang('right', 'pictureframe_large_A', -1.55, 3.4);
  for (const [x, z] of [[-4.2, -2.4], [0, -2.4], [4.2, -2.4], [-3.9, 2.4], [3.6, 2.2]]) room.pendant(x, z, 1.6);

  // The leaderboard: a lit board on the back wall over the machines, redrawn as the chips change.
  const board = document.createElement('canvas');
  board.width = 768;
  board.height = 512;
  const boardTex = new THREE.CanvasTexture(board);
  boardTex.colorSpace = THREE.SRGBColorSpace;
  boardTex.anisotropy = 8;
  const boardMesh = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 2.4), new THREE.MeshBasicMaterial({ map: boardTex }));
  boardMesh.position.set(0, 4.75, 0.07);
  room.onWall('back').add(boardMesh);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(3.86, 2.66, 0.08), mats.gold);
  frame.position.set(0, 4.75, 0.02);
  room.onWall('back').add(frame);
  drawBoard(board, [], false);

  room.finish();
  room.casino = { machines, strip, mats, board: { canvas: board, tex: boardTex } };
  return room;
}

// ---------- the game ----------
/**
 * The game, its panel and camera moves. room: the casino's island.rooms entry; rig and camera: the
 * camera rig; session(): A's session (for your Chog: its id, name, art and traits).
 * Call update(dt) every frame. A place on the island's list, the panel shows itself while you're in.
 */
export function createCasino({ room: r, rig, session }) {
  const c = r.room.casino;
  const machine = c.machines[1];
  const panel = document.createElement('div');
  panel.className = 'casino-panel';
  panel.hidden = true;
  document.body.appendChild(panel);

  const all = loadStore();
  let who = null; // { key, id, name, traits, image, perks }
  let state = null; // this player's stored state
  let bet = 10;
  let spinning = null; // { t, stops, from, durations, kind }
  let lastLine = null;
  let canReroll = false;
  let message = '';
  let atMachine = false;
  let flash = 0;
  let faceFor = null;

  // The casino's own framing: from the right of the door across the floor to the machines and the
  // board over them, clear of the panel on the right (the room's view, so the way in ends on it).
  r.room.group.updateMatrixWorld(true);
  const L = (x, y, z) => r.room.group.localToWorld(new THREE.Vector3(x, y, z));
  r.view.pos.copy(L(5.4, 3.2, 5.4));
  r.view.target.copy(L(2.81, 2.2, -4.26));
  // Where to stand to play: in front of the middle machine, eyes level with its reels; on a wide
  // screen a little to its right, so the panel doesn't cover it.
  const M = (x, y, z) => machine.group.localToWorld(new THREE.Vector3(x, y, z));
  const playView = () => {
    const wide = window.innerWidth > window.innerHeight * 1.1;
    rig.views['casino-play'] = wide
      ? { pos: M(0.62, 1.8, 2.5), target: M(0.62, 1.6, 0), enter: true }
      : { pos: M(0, 2.0, 2.9), target: M(0, 1.45, 0), enter: true };
  };

  function identify() {
    const s = session()?.active;
    const chog = s?.info ? { key: String(s.info.id ?? s.id), id: s.info.id ?? s.id, name: s.info.name, traits: s.info.traits ?? {}, image: s.info.image } : null;
    const next = chog ?? { key: 'guest', id: null, name: 'Guest', traits: {}, image: `${BASE}art/43.webp` };
    if (who?.key === next.key) return;
    who = { ...next, perks: perksFor(next.traits) };
    state = all[who.key] ?? { chips: 0, day: '', rerolls: 0, best: 0 };
    // A new day: chips topped up to the day's free amount, re-rolls back.
    if (state.day !== today()) {
      state.day = today();
      state.chips = Math.max(state.chips, who.perks.daily);
      state.rerolls = who.perks.rerolls;
    }
    all[who.key] = state;
    saveStore(all);
    message = '';
    canReroll = false;
    // The jackpot symbol wears your Chog's face.
    if (faceFor !== who.image) {
      faceFor = who.image;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        drawStrip(c.strip.canvas, img);
        c.strip.tex.needsUpdate = true;
      };
      img.src = who.image;
    }
    render();
    board.refresh();
  }

  function save() {
    state.best = Math.max(state.best ?? 0, state.chips);
    all[who.key] = state;
    saveStore(all);
    board.submit();
  }

  // ---------- the leaderboard: the world's, from /api/casino if it is up, else this browser's ----------
  const board = (() => {
    let top = [];
    let shared = false;
    let sendAt = 0;
    const local = () =>
      Object.entries(all)
        .filter(([k]) => k !== 'guest')
        .map(([k, v]) => ({ id: Number(k), name: v.name ?? `Chog #${k}`, chips: v.best ?? v.chips }))
        .sort((a, b) => b.chips - a.chips)
        .slice(0, 8);
    const draw = () => {
      drawBoard(c.board.canvas, top, shared);
      c.board.tex.needsUpdate = true;
    };
    let offUntil = 0;
    let asking = null;
    return {
      refresh() {
        asking ??= this.ask().finally(() => (asking = null));
        return asking;
      },
      async ask() {
        // The shared board isn't up (no /api/casino yet, or offline): this browser's, without asking
        // again for a few minutes.
        if (performance.now() < offUntil) {
          top = local();
          return draw();
        }
        try {
          const res = await fetch('/api/casino?top=8', { headers: { accept: 'application/json' } });
          if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) throw new Error(res.status);
          const out = await res.json();
          top = out.top ?? [];
          shared = true;
        } catch {
          shared = false;
          offUntil = performance.now() + 300000;
          top = local();
        }
        draw();
      },
      // Your Chog's best, sent at most every 20 s with your sign-in's signature, so the board can check
      // the Chog is yours (the demo Chog and guests stay on this browser's board).
      submit() {
        if (who.key === 'guest') return;
        all[who.key].name = who.name;
        const s = session()?.active;
        if (!shared || !s?.signature || s.demo) {
          top = shared ? top : local();
          return draw();
        }
        const now = performance.now();
        if (now - sendAt < 20000) return;
        sendAt = now;
        const body = { id: who.id, name: who.name, chips: state.best, session: { address: s.address, message: s.message, signature: s.signature } };
        fetch('/api/casino', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
          .then(() => this.refresh())
          .catch(() => {});
      },
    };
  })();

  // ---------- spinning ----------
  function spin(kind = 'spin', only = -1) {
    if (spinning || !who) return;
    if (kind === 'spin') {
      if (state.chips < bet) {
        message = state.chips < BETS[0] ? 'Out of chips. Free chips again tomorrow.' : 'Not enough chips for that bet.';
        return render();
      }
      state.chips -= bet;
      canReroll = false;
    } else {
      if (!canReroll || state.rerolls <= 0) return;
      state.rerolls -= 1;
      canReroll = false;
    }
    const stops = machine.reels.map((reel, i) => (kind === 'reroll' && i !== only ? reel.userData.stop : randomStop()));
    const durations = machine.reels.map((_, i) => (kind === 'reroll' ? (i === only ? 1.2 : 0) : 1.1 + i * 0.4));
    spinning = { t: 0, stops, from: machine.reels.map((reel) => reel.userData.angle), durations, kind, only };
    message = '';
    lever.pull = kind === 'spin' ? 0 : null;
    save();
    render();
  }

  // The reels land: settle the line, pay it, light up.
  function land() {
    const line = spinning.stops.map((i) => STRIP[i]);
    lastLine = line;
    const kind = spinning.kind;
    spinning = null;
    const k = payout(line);
    const won = Math.round(k * bet * (k > 1 ? who.perks.mult : 1));
    state.chips += won;
    if (k >= THREE_OF.heart) {
      message = `Three ${NAMES[line[0]]}! +${won.toLocaleString('en-US')}`;
      flash = line[0] === 'chog' ? 6 : 2.5;
    } else if (k === 6) {
      message = `Two Chogs! +${won}`;
      flash = 1.5;
    } else if (k === 1) message = `Your ${bet} back.`;
    else {
      canReroll = state.rerolls > 0;
      message = canReroll ? 'No win. Re-roll one reel?' : kind === 'reroll' ? 'No luck this time.' : 'No win.';
    }
    save();
    render();
  }

  const lever = { pull: null };
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);

  // ---------- the panel ----------
  function render() {
    if (!who) return;
    const p = who.perks;
    const perks = p.list.map((x) => `<li><b>${x.trait}</b> ${x.text}</li>`).join('');
    panel.innerHTML = atMachine
      ? `
        <div class="cz-top"><span class="cz-chips"><i></i>${state.chips.toLocaleString('en-US')}</span><span class="cz-who">${who.name}</span></div>
        <div class="cz-msg" aria-live="polite">${message || '&nbsp;'}</div>
        <div class="cz-row">
          <button class="cz-bet" data-d="-1" aria-label="Lower the bet">−</button>
          <span class="cz-betv">Bet ${bet}</span>
          <button class="cz-bet" data-d="1" aria-label="Raise the bet">+</button>
          <button class="cz-spin"${spinning ? ' disabled' : ''}>SPIN</button>
        </div>
        ${canReroll ? `<div class="cz-row cz-re"><span>Re-roll (${state.rerolls} left today)</span>${[1, 2, 3].map((n) => `<button class="cz-reroll" data-i="${n - 1}">Reel ${n}</button>`).join('')}</div>` : ''}
        <ul class="cz-perks">${perks}</ul>
        <button class="cz-leave">Step back</button>`
      : `
        <div class="cz-top"><span class="cz-chips"><i></i>${state.chips.toLocaleString('en-US')}</span><span class="cz-who">${who.name}</span></div>
        <p class="cz-note">Free chips only, topped up every day. Your Chog's traits give perks:</p>
        <ul class="cz-perks">${perks}</ul>
        <button class="cz-play">PLAY CHOG SLOTS</button>`;
    panel.querySelector('.cz-play')?.addEventListener('click', () => goPlay());
    panel.querySelector('.cz-leave')?.addEventListener('click', () => stepBack());
    panel.querySelector('.cz-spin')?.addEventListener('click', () => spin());
    panel.querySelectorAll('.cz-bet').forEach((b) =>
      b.addEventListener('click', () => {
        const i = Math.min(BETS.length - 1, Math.max(0, BETS.indexOf(bet) + Number(b.dataset.d)));
        bet = BETS[i];
        render();
      }),
    );
    panel.querySelectorAll('.cz-reroll').forEach((b) => b.addEventListener('click', () => spin('reroll', Number(b.dataset.i))));
  }

  function goPlay() {
    atMachine = true;
    playView();
    rig.go('casino-play', 1.2);
    render();
  }
  function stepBack() {
    atMachine = false;
    rig.go(r.id, 1.0);
    render();
  }

  window.addEventListener('keydown', (e) => {
    if (panel.hidden || !atMachine || e.repeat) return;
    if (e.code === 'Space' || e.key === 'Enter') {
      e.preventDefault();
      spin();
    }
  });

  const tmp = new THREE.Color();
  const on = new THREE.Color('#ffd27a'), off = new THREE.Color('#5a3a18'), hot = new THREE.Color('#ff6a8a');
  let t = 0;
  const api = {
    room: r,
    get open() {
      return !panel.hidden;
    },
    /** Whether you're in the casino (and no cutscene is playing): the panel shows. */
    show(inside) {
      if (inside && panel.hidden) {
        identify();
        board.refresh();
      }
      if (!inside && atMachine) atMachine = false;
      panel.hidden = !inside;
      document.body.classList.toggle('in-casino', inside);
    },
    update(dt) {
      t += dt;
      if (!r.room.group.visible) return;
      if (!panel.hidden) identify();
      // The reels.
      if (spinning) {
        spinning.t += dt;
        let done = true;
        machine.reels.forEach((reel, i) => {
          const d = spinning.durations[i];
          if (!d) return;
          const k = Math.min(1, spinning.t / d);
          if (k < 1) done = false;
          // Whole turns plus the way round to the stop, slowing to land with a little bounce.
          const target = spinning.stops[i] * STEP + STEP / 2;
          const from = spinning.from[i];
          const turns = spinning.kind === 'reroll' ? 2 : 3 + i;
          let end = target + Math.PI * 2 * turns;
          while (end - from < Math.PI * 2 * turns) end += Math.PI * 2;
          const e = easeOut(k);
          const bounce = k > 0.85 ? Math.sin(((k - 0.85) / 0.15) * Math.PI) * 0.06 : 0;
          reel.userData.angle = k < 1 ? from + (end - from) * e - bounce : target;
          reel.userData.stop = spinning.stops[i];
          reel.rotation.x = reel.userData.angle;
        });
        if (done) land();
      }
      // The idle machines drift their reels round now and then, so the floor feels alive.
      c.machines.forEach((m, j) => {
        if (m === machine) return;
        for (const [i, reel] of m.reels.entries()) {
          const phase = Math.sin(t * 0.3 + j * 2 + i) > 0.97 ? dt * 6 : 0;
          reel.rotation.x += phase;
        }
      });
      // The lever.
      if (lever.pull !== null) {
        lever.pull += dt / 0.6;
        const k = lever.pull < 0.4 ? lever.pull / 0.4 : Math.max(0, 1 - (lever.pull - 0.4) / 0.6);
        machine.lever.rotation.x = k * 1.1;
        if (lever.pull >= 1) lever.pull = null;
      }
      // The bulbs: chasing while it spins, flashing on a win, a slow twinkle otherwise.
      flash = Math.max(0, flash - dt);
      for (const m of c.machines) {
        const mine = m === machine;
        for (let i = 0; i < m.spots.length; i++) {
          let lit;
          if (mine && flash > 0) lit = Math.floor(t * 8) % 2 === 0;
          else if (mine && spinning) lit = (i + Math.floor(t * 14)) % 3 === 0;
          else lit = (i + Math.floor(t * 3 + (mine ? 0 : 5))) % 4 === 0;
          tmp.copy(lit ? (flash > 0 && mine ? hot : on) : off).multiplyScalar(lit ? 1.6 : 1);
          m.bulbs.setColorAt(i, tmp);
        }
        m.bulbs.instanceColor.needsUpdate = true;
      }
    },
    // For tests: a spin that lands on the given stops (indexes into the strip), or a re-roll.
    _spin(stops, reroll = -1) {
      identify();
      atMachine = true;
      spin(reroll >= 0 ? 'reroll' : 'spin', reroll);
      if (spinning && stops) spinning.stops = stops;
    },
    play: () => goPlay(),
    get state() {
      return { who: who?.name, chips: state?.chips, rerolls: state?.rerolls, bet, message, line: lastLine, spinning: !!spinning, canReroll };
    },
  };
  return api;
}
