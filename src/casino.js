import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Room } from './interior.js';
import { createFlight } from './flight.js';
import { LOOKS } from './casinolooks.js';
import { SYMBOLS, STRIP, NAMES, THREE_OF, payout, perksFor, chargesFor } from './casinoperks.js';
import { spinBall, settleSpin, colourOf, BETS as TABLE_BETS } from './roulette.js';

/*
 * The casino, in the Hub's right wing: the Starlite Lounge (B23), with Chog Slots and a roulette
 * wheel, for free chips only. Nothing here touches a wallet or a token: chips are a number kept in
 * this browser, topped up every day, and no transaction is ever asked for.
 *
 * Chog Slots: three reels of six symbols, the jackpot symbol your own Chog. The roulette: a European
 * wheel; pick a chip from the rack and tap the felt to put it down, then spin. Your Chog's traits
 * give it edges in both games (src/casinoperks.js): a few always-on, small enough that the house
 * keeps its edge, and power-ups a few times a day (free and wild spins, re-rolls, nudges, a second
 * spin of the wheel, a lost bet back). A leaderboard of the Chogs with the most chips hangs on the wall.
 *
 * The show: the reels blur as they spin and the camera leans in; a glint runs across the glass as
 * they land; a win throws chips out of the tray, piles coins in it, sparkles in your aura's colour and
 * puts its name up in lights, and the room joins in. Three Chogs play the casino's own cutscene: the
 * camera pulls back across the room as every machine flashes and chips rain from the ceiling, your
 * Chog waves, and the view comes back to the machine. At the roulette the camera leans over the
 * wheel while the ball runs. Walking in, the machines' lights ripple on.
 *
 * buildCasinoRoom() is the room itself (src/hub.js places it); createCasino() is the games, their
 * controls and camera moves (src/main.js). The controls are the user's pick, "Chips in hand" (10-16): no
 * panel, a rack of chips along the bottom, a round SPIN, and your Chog's edges as badges at the top
 * left that light up when they fire.
 */

const BASE = import.meta.env?.BASE_URL ?? '/';

// ---------- the games' rules (src/casinoperks.js) ----------
export { SYMBOLS, payout };
const BETS = [5, 10, 25, 50, 100];
// The most a roulette spin can carry, all its bets together.
const TABLE_MAX = 500;
// A lost bet back is never more than this.
const CASHBACK_MAX = 100;

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
// A fair draw of 0 to n - 1, from the browser's crypto (no bias: draws past the last whole n are redrawn).
function randomInt(n) {
  const a = new Uint32Array(1);
  const lim = Math.floor(0x100000000 / n) * n;
  do crypto.getRandomValues(a);
  while (a[0] >= lim);
  return a[0] % n;
}
const randomStop = () => randomInt(STRIP.length);

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

// The strip smeared round the reel, for while it spins fast.
function blurStrip(src, dst) {
  const g = dst.getContext('2d');
  const w = src.width;
  g.clearRect(0, 0, w, dst.height);
  const n = 12;
  g.globalAlpha = 1 / n;
  for (let k = 0; k < n; k++) {
    const dx = ((k / (n - 1)) - 0.5) * src.height * 0.9;
    for (const o of [-w, 0, w]) g.drawImage(src, dx + o, 0);
  }
  g.globalAlpha = 1;
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

// The leaderboard's face: the top Chogs by chips, or how to get on it, in the look's colours.
const BOARD_THEMES = {
  classic: { bg: '#1a0812', edge: 'rgba(232, 184, 74, 0.5)', title: '#ffe6a8', glow: '#ff9a3c', sub: '#ffb3c8', row: '#fff6e8', first: '#ffd23f', head: '600 64px Fredoka, sans-serif', font: 'Fredoka, sans-serif' },
  capsule: { bg: '#120a2a', edge: 'rgba(62, 242, 255, 0.7)', title: '#ff3d8b', glow: '#ff3d8b', sub: '#3ef2ff', row: '#fff4e6', first: '#ffe27a', head: '700 66px "Pixelify Sans", monospace', font: '"Pixelify Sans", monospace' },
  starlite: { bg: '#0e2232', edge: 'rgba(255, 201, 74, 0.8)', title: '#ff6f61', glow: '#3ef2ff', sub: '#7ff0c9', row: '#fff1d6', first: '#ffc94a', head: '600 64px Fredoka, sans-serif', font: 'Fredoka, sans-serif' },
  pier: { bg: '#fff9ef', edge: 'rgba(255, 143, 184, 0.9)', title: '#ff3d8b', glow: null, sub: '#4fb2d4', row: '#5a3a2a', first: '#ff3d8b', head: '700 64px Fredoka, sans-serif', font: 'Fredoka, sans-serif' },
};
function drawBoard(canvas, rows, shared, theme = 'classic') {
  const T = BOARD_THEMES[theme] ?? BOARD_THEMES.classic;
  const g = canvas.getContext('2d');
  const { width: w, height: h } = canvas;
  g.fillStyle = T.bg;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = T.edge;
  g.lineWidth = 4;
  g.strokeRect(14, 14, w - 28, h - 28);
  g.textAlign = 'center';
  g.fillStyle = T.title;
  g.shadowColor = T.glow ?? 'transparent';
  g.shadowBlur = T.glow ? 18 : 0;
  g.font = T.head;
  g.fillText('TOP CHOGS', w / 2, 86);
  g.shadowBlur = 0;
  g.font = '500 24px Figtree, sans-serif';
  g.fillStyle = T.sub;
  g.fillText(shared ? 'most chips in Chog World' : 'most chips at this machine', w / 2, 124);
  rows.slice(0, 7).forEach((row, i) => {
    const y = 180 + i * 46;
    g.fillStyle = i === 0 ? T.first : T.row;
    g.font = `600 32px ${T.font}`;
    g.textAlign = 'left';
    g.fillText(`${i + 1}`, 64, y);
    g.fillText(String(row.name).slice(0, 18), 112, y);
    g.textAlign = 'right';
    g.fillText(Number(row.chips).toLocaleString('en-US'), w - 64, y);
  });
  if (!rows.length) {
    g.textAlign = 'center';
    g.fillStyle = T.row;
    g.font = '500 30px Figtree, sans-serif';
    g.fillText('Sign in with your Chog', w / 2, 270);
    g.fillText('to get on the board.', w / 2, 312);
  }
}

// ---------- the slot machine ----------
const CHIPS_MAX = 160;
const LAMP = new THREE.Color('#ffe2bd');
const REEL_R = 0.42, REEL_W = 0.36;
const STEP = (Math.PI * 2) / STRIP.length;

/*
 * A slot machine, 2.3 m tall at Chog scale: a lacquered red cabinet on a dark base, three reels
 * behind a glass window ringed with bulbs, a lit "CHOG SLOTS" top and a lever on its right.
 * style (a casino look's, src/casinolooks.js): radius rounds the cabinet; top(group, add) builds its
 * top in place of the lit sign. The reels, the window, the bulbs and the lever stay where they are.
 * Returns { group, reels, lever, bulbs, spots }.
 */
function slotMachine(mats, faceStrip, style = {}) {
  const rad = style.radius ?? 0.08;
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
  add(new RoundedBoxGeometry(1.5, 0.9, 0.95, 3, rad), mats.dark, 0, 0.45, 0);
  add(new RoundedBoxGeometry(1.42, 1.5, 0.62, 3, rad), mats.body, 0, 1.62, -0.26);
  box(1.42, 0.375, 0.31, mats.body, 0, 1.0625, 0.205);
  box(1.42, 0.36, 0.31, mats.body, 0, 2.17, 0.205);
  for (const sx of [-1, 1]) box(0.11, 0.74, 0.31, mats.body, sx * 0.655, 1.62, 0.205);
  box(1.2, 0.74, 0.02, mats.bezel, 0, 1.62, -0.52);
  // The sloped play shelf, and gold round the window and the cabinet.
  box(1.46, 0.08, 0.5, mats.gold, 0, 0.93, 0.26).rotation.x = -0.18;
  for (const y of [1.235, 2.005]) box(1.26, 0.04, 0.04, mats.frame ?? mats.gold, 0, y, 0.37);
  for (const sx of [-1, 1]) box(0.04, 0.8, 0.04, mats.frame ?? mats.gold, sx * 0.61, 1.62, 0.37);
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
  // The top: a lit "CHOG SLOTS" panel, or the look's own.
  if (style.top) style.top(g, add);
  else {
    add(new RoundedBoxGeometry(1.5, 0.62, 0.7, 3, 0.12), mats.dark, 0, 2.68, -0.08);
    const sign = add(new THREE.PlaneGeometry(1.36, 0.4), mats.sign, 0, 2.69, 0.28);
    sign.renderOrder = 1;
  }
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
  // A glint that runs across the glass when the reels land (and now and then on its own).
  const glintTex = glintTexture().clone();
  glintTex.offset.x = 0.7;
  const glint = add(new THREE.PlaneGeometry(1.2, 0.74), new THREE.MeshBasicMaterial({ map: glintTex, color: new THREE.Color(1.5, 1.5, 1.5), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), 0, 1.62, 0.364);
  glint.renderOrder = 3;
  // The coin tray at the foot of the cabinet, the chute over it, a few coins in it. Wins pile more in.
  add(new THREE.PlaneGeometry(0.5, 0.12), mats.bezel, 0, 0.55, 0.478);
  box(0.8, 0.02, 0.22, mats.gold, 0, 0.33, 0.58);
  box(0.8, 0.1, 0.02, mats.gold, 0, 0.37, 0.69);
  for (const sx of [-1, 1]) box(0.02, 0.1, 0.22, mats.gold, sx * 0.39, 0.37, 0.58);
  const coins = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.034, 0.034, 0.008, 18), coinMaterial(), COIN_SLOTS.length);
  coins.frustumCulled = false;
  g.add(coins);
  const tray = { mesh: coins, count: 0, shown: 0, drops: [] };
  setCoins(tray, 4, true);
  return { group: g, reels, lever, bulbs, spots, glint: { mesh: glint, tex: glintTex, at: 2 + Math.random() * 4, t: -1 }, tray };
}

// The glint: a slanted streak of light, two bands, clear everywhere else (the glass shows through).
let glintTex = null;
function glintTexture() {
  if (glintTex) return glintTex;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d');
  g.setTransform(1, 0, -0.45, 1, 28, 0);
  for (const [x, w, a] of [[236, 70, 0.75], [318, 18, 0.55]]) {
    const grad = g.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.5, `rgba(255,255,255,${a})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(x - w / 2, 0, w, 128);
  }
  glintTex = new THREE.CanvasTexture(c);
  glintTex.colorSpace = THREE.SRGBColorSpace;
  return glintTex;
}

// The coins in a tray: where each one lies, a heap that grows from the middle of the tray outward.
const COIN_SLOTS = (() => {
  const out = [];
  let seed = 7;
  const r = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < 56; i++) {
    const spread = 0.08 + (i / 56) * 0.26;
    const x = (r() - 0.5) * 2 * spread, z = 0.58 + (r() - 0.5) * Math.min(0.17, spread);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((r() - 0.5) * 0.5, r() * 6, (r() - 0.5) * 0.5));
    // Its lowest edge on the tray's floor (0.34), tilted as it is, or on the heap: never through it.
    const c = Math.abs(new THREE.Vector3(0, 1, 0).applyQuaternion(q).y);
    const lift = 0.034 * Math.sqrt(1 - c * c) + 0.004 * c;
    const y = 0.341 + lift + Math.max(0, 1 - Math.abs(x) / 0.36) * Math.min(i, 30) * 0.0016 + r() * 0.003;
    out.push({ p: new THREE.Vector3(x, y, z), q });
  }
  return out;
})();
let coinMat = null;
const coinMaterial = () => (coinMat ??= new THREE.MeshStandardMaterial({ color: '#f2c14e', metalness: 0.85, roughness: 0.28, emissive: '#3a2400' }));
// Up to n coins in the tray; new ones drop from the chute (unless now, as in the load).
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
function setCoins(tray, n, now = false) {
  n = Math.min(n, COIN_SLOTS.length);
  for (let i = tray.count; i < n; i++) tray.drops.push({ i, t: now ? 1 : -(i - tray.count) * 0.035 });
  tray.count = n;
  stepCoins(tray, 0);
}
function stepCoins(tray, dt) {
  for (const d of tray.drops) d.t += dt / 0.32;
  tray.drops = tray.drops.filter((d) => d.t < 1.5);
  for (let i = 0; i < tray.count; i++) {
    const slot = COIN_SLOTS[i];
    const d = tray.drops.find((x) => x.i === i);
    const k = d ? THREE.MathUtils.clamp(d.t, 0, 1) : 1;
    // Out of the chute, falling into place with a small bounce.
    _p.copy(slot.p);
    if (k < 1) _p.set(slot.p.x * k, 0.52 - (0.52 - slot.p.y) * k * k, 0.5 + (slot.p.z - 0.5) * k);
    else if (d) _p.y += Math.abs(Math.sin((d.t - 1) * Math.PI * 2)) * 0.012 * (1.5 - d.t);
    _s.setScalar(d && d.t < 0 ? 0 : 1);
    tray.mesh.setMatrixAt(i, _m.compose(_p, slot.q, _s));
  }
  tray.mesh.count = tray.count;
  tray.mesh.instanceMatrix.needsUpdate = true;
}

/**
 * The casino: the Starlite Lounge (src/casinolooks.js), the user's pick (B23). The other looks it was
 * picked from stay a link away (?casino=capsule | pier | classic, the first one: a dark red room,
 * slot machines along the back, a card table, the leaderboard).
 */
export function buildCasinoRoom(look = new URLSearchParams(location.search).get('casino') ?? 'starlite') {
  if (LOOKS[look]) return LOOKS[look](KIT);
  const room = new Room({
    w: 15, d: 13, h: 6.6,
    wall: '#5e1c2a', wainscot: '#6e2a3a', floor: carpet(), trim: '#8a5a22', ceiling: '#2c1220',
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
  const strip = makeStrip();

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
  const board = makeBoard(room.onWall('back'), { x: 0, y: 4.75, w: 3.6, h: 2.4, frame: mats.gold });
  const burst = makeBurst(room);

  room.finish();
  room.casino = { machines, strip, mats, burst, board, look: { name: 'classic', lit: 0.2, glow: 0, bulbs: { on: [new THREE.Color('#ffd27a')], off: [new THREE.Color('#5a3a18')], hot: new THREE.Color('#ff6a8a') } } };
  return room;
}

// The reels' strip, redrawn with your Chog's face once it's known, and its blur for fast spins.
function makeStrip() {
  const stripCanvas = document.createElement('canvas');
  // 256 pixels a symbol: sharp at the machine on a phone's screen.
  stripCanvas.width = 256 * STRIP.length;
  stripCanvas.height = 256;
  drawStrip(stripCanvas, null);
  const stripTex = new THREE.CanvasTexture(stripCanvas);
  stripTex.colorSpace = THREE.SRGBColorSpace;
  stripTex.anisotropy = 8;
  const blurCanvas = document.createElement('canvas');
  blurCanvas.width = stripCanvas.width;
  blurCanvas.height = stripCanvas.height;
  blurStrip(stripCanvas, blurCanvas);
  const blurTex = new THREE.CanvasTexture(blurCanvas);
  blurTex.colorSpace = THREE.SRGBColorSpace;
  return {
    canvas: stripCanvas, tex: stripTex, mat: new THREE.MeshBasicMaterial({ map: stripTex }),
    blurCanvas, blurTex, blurMat: new THREE.MeshBasicMaterial({ map: blurTex }),
  };
}

// The leaderboard on a wall (x along it, y up, w by h metres) in a frame, drawn in the look's theme.
function makeBoard(wall, { x, y, w, h, frame, theme = 'classic' }) {
  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = 512;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex }));
  mesh.position.set(x, y, 0.07);
  wall.add(mesh);
  const edge = new THREE.Mesh(new THREE.BoxGeometry(w + 0.26, h + 0.26, 0.08), frame);
  edge.position.set(x, y, 0.02);
  wall.add(edge);
  drawBoard(canvas, [], false, theme);
  return { canvas, tex, theme };
}

// The chips a win throws out (B6), one mesh for all of them. One sits hidden in the middle machine
// so the load draws it, and the casino starts it empty. With them, the win's sparkles: little stars
// that burst out and twinkle (one dark one waiting, for the same reason).
function makeBurst(room) {
  const burst = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.06, 0.018, 14), new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#40202a' }), CHIPS_MAX);
  burst.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, 1.6, -room.d / 2 + 0.6));
  burst.setColorAt(0, new THREE.Color('#c4334a'));
  burst.count = 1;
  burst.frustumCulled = false;
  burst.userData.keep = true;
  room.group.add(burst);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPARKS_MAX * 3), 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(SPARKS_MAX * 3), 3).setUsage(THREE.DynamicDrawUsage));
  geo.attributes.position.setXYZ(0, 0, 1.6, -room.d / 2 + 0.6);
  geo.setDrawRange(0, 1);
  const sparks = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.11, map: sparkTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  sparks.frustumCulled = false;
  sparks.renderOrder = 4;
  sparks.userData.keep = true;
  room.group.add(sparks);
  burst.userData.sparks = sparks;
  return burst;
}
const SPARKS_MAX = 220;
// A four-point star with a soft glow round it.
function sparkTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.18, 'rgba(255,255,255,0.7)');
  r.addColorStop(0.5, 'rgba(255,255,255,0.12)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.beginPath();
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2, d = k % 2 ? 4 : 31;
    g.lineTo(32 + Math.cos(a) * d, 32 + Math.sin(a) * d);
  }
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const KIT = { Room, slotMachine, makeStrip, makeBoard, makeBurst, shadeMat: () => new THREE.MeshBasicMaterial({ map: reelShade(), transparent: true, depthWrite: false }) };

// ---------- the games ----------
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const COLOUR_NAME = { red: 'Red', black: 'Black', green: 'Green' };

// ---------- the controls' parts (styled in src/style.css, the casino's section) ----------
const TOUCH = typeof matchMedia === 'function' && matchMedia('(hover: none)').matches;
// The day's charges each game counts down on its badges.
const SLOT_CHARGES = new Set(['free', 'wild', 'rerolls', 'nudges', 'cashback']);
const WHEEL_CHARGES = new Set(['second', 'near', 'luckySave', 'luckyBig', 'anyBig', 'red', 'black', 'even', 'dozen', 'cashback']);
// What saved or paid a roulette bet (src/roulette.js settleSpin), as the edge that did it.
const WHY_TAG = { 'lucky number': 'luckyBig', 'first straight win': 'anyBig', 'near miss': 'near', shield: 'shield', red: 'red', black: 'black', 'even money': 'even', dozen: 'dozen', 'lucky save': 'luckySave' };
const TIERS = new Set(['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary']);
const ICON_OF = { aura: 'spark', wild: 'bolt', free: 'ticket', rerolls: 'reroll', nudges: 'nudge', streak: 'flame', cashback: 'back', shield: 'shield', second: 'eye', near: 'target', red: 'diamond', black: 'diamond', even: 'half', dozen: 'dozen', luckyBig: 'clover', anyBig: 'tooth', daily: 'gem' };
function iconOf(x) {
  if (TIERS.has(x.trait)) return 'crown';
  if (x.name === 'Fwog') return 'frog';
  if (x.name === 'Gold tooth') return 'tooth';
  for (const t of ['aura', ...x.tags]) if (x.tags.includes(t) && ICON_OF[t]) return ICON_OF[t];
  return x.tags.some((t) => t.startsWith('pays:')) ? 'star' : 'spark';
}
const ICONS = `<svg class="cz-defs" width="0" height="0" aria-hidden="true">
  <symbol id="czi-crown" viewBox="0 0 24 24"><path fill="currentColor" d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"/></symbol>
  <symbol id="czi-eye" viewBox="0 0 24 24"><path fill="currentColor" d="M12 5C6.5 5 2.7 9.4 1.5 12c1.2 2.6 5 7 10.5 7s9.3-4.4 10.5-7C21.3 9.4 17.5 5 12 5zm0 11.5A4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 0 1 0 9zm0-2.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/></symbol>
  <symbol id="czi-tooth" viewBox="0 0 24 24"><path fill="currentColor" d="M7 3c-2.6 0-4 2.2-4 5 0 2.2 1 3.6 1.6 5.6.6 2 .7 6.4 2.4 7.3 1.6.8 2.2-3 3-5 .5-1.2 1.5-1.2 2 0 .8 2 1.4 5.8 3 5 1.7-.9 1.8-5.3 2.4-7.3C18 11.6 21 10.2 21 8c0-2.8-1.4-5-4-5-2 0-3 1-5 1S9 3 7 3z"/></symbol>
  <symbol id="czi-spark" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2l2.2 6.8L21 11l-6.8 2.2L12 20l-2.2-6.8L3 11l6.8-2.2z"/><circle cx="19" cy="19" r="2" fill="currentColor"/></symbol>
  <symbol id="czi-diamond" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2l8 10-8 10-8-10z"/></symbol>
  <symbol id="czi-bolt" viewBox="0 0 24 24"><path fill="currentColor" d="M13 2L4 14h6l-1 8 9-12h-6z"/></symbol>
  <symbol id="czi-star" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2l3 6 6 1-4.5 4.2 1 6.3L12 16.8 6.5 19.5l1-6.3L3 9l6-1z"/></symbol>
  <symbol id="czi-frog" viewBox="0 0 24 24"><path fill="currentColor" d="M7 4a3 3 0 0 0-2.9 3.7C2.8 9 2 10.8 2 13c0 4.4 4.5 7 10 7s10-2.6 10-7c0-2.2-.8-4-2.1-5.3A3 3 0 1 0 15 6.6 12 12 0 0 0 12 6c-1 0-2 .2-3 .6A3 3 0 0 0 7 4zm0 2a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm10 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2zM8 13c1.2 1.2 2.5 1.8 4 1.8s2.8-.6 4-1.8l1 1c-1.4 1.6-3.1 2.4-5 2.4S8.4 15.6 7 14z"/></symbol>
  <symbol id="czi-ticket" viewBox="0 0 24 24"><path fill="currentColor" fill-rule="evenodd" d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2.6a2.4 2.4 0 0 0 0 4.8V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2.6a2.4 2.4 0 0 0 0-4.8zm12 0.6h1.6v2.2H15zm0 3.3h1.6v2.2H15zm0 3.3h1.6v2.2H15zM9 9.2l.9 1.8 2 .3-1.4 1.4.3 2-1.8-.9-1.8.9.3-2-1.4-1.4 2-.3z"/></symbol>
  <symbol id="czi-reroll" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" d="M19 12a7 7 0 1 1-2.1-5M19 3.5V8h-4.5"/></symbol>
  <symbol id="czi-nudge" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" d="M6.5 5.5l5.5 5.5 5.5-5.5M6.5 13l5.5 5.5 5.5-5.5"/></symbol>
  <symbol id="czi-flame" viewBox="0 0 24 24"><path fill="currentColor" d="M12.4 2c.7 3.6 6.1 5.8 6.1 11.4A6.5 6.5 0 0 1 5.5 13.6c0-2.9 1.6-4.9 3.4-6.4.2 1.9 1 3.1 2.2 3.7-.4-3.3.4-6.1 1.3-8.9z"/></symbol>
  <symbol id="czi-back" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" d="M4.6 9.2A8 8 0 1 1 4 12.5M4 4.5v4.7h4.7"/><circle cx="12" cy="12.5" r="3" fill="currentColor"/></symbol>
  <symbol id="czi-shield" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2l8 3v6.2c0 5-3.4 9.2-8 10.8-4.6-1.6-8-5.8-8-10.8V5z"/></symbol>
  <symbol id="czi-target" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" stroke-width="2.4"/><circle cx="12" cy="12" r="4.4" fill="none" stroke="currentColor" stroke-width="2.4"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/></symbol>
  <symbol id="czi-half" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" stroke-width="2.4"/><path fill="currentColor" d="M12 3.4a8.6 8.6 0 0 0 0 17.2z"/></symbol>
  <symbol id="czi-dozen" viewBox="0 0 24 24"><path fill="currentColor" d="M4 4.5h16v3.6H4zM4 10.2h16v3.6H4zM4 15.9h16v3.6H4z"/></symbol>
  <symbol id="czi-clover" viewBox="0 0 24 24"><g fill="currentColor"><circle cx="8.4" cy="8.4" r="3.9"/><circle cx="15.6" cy="8.4" r="3.9"/><circle cx="8.4" cy="15.6" r="3.9"/><circle cx="15.6" cy="15.6" r="3.9"/></g><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M14 14c2 2 3.5 4.5 4 7.5"/></symbol>
  <symbol id="czi-gem" viewBox="0 0 24 24"><path fill="currentColor" d="M6.5 3.5h11L22 9.4 12 21 2 9.4z"/><path fill="rgba(0,0,0,0.25)" d="M2 9.4h20L12 21z"/></symbol>
  <symbol id="czi-undo" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" d="M9 14.5L4 9.5l5-5M4.5 9.5h10a5.5 5.5 0 0 1 0 11H11"/></symbol>
  <symbol id="czi-clear" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></symbol>
  <symbol id="czi-rebet" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5A7.8 7.8 0 0 0 5.2 7.6M4.5 3.5v4.4h4.4M4.5 13.5a7.8 7.8 0 0 0 14.3 2.9M19.5 20.5v-4.4h-4.4"/></symbol>
  <symbol id="czi-leave" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" d="M14.5 5.5L8 12l6.5 6.5"/></symbol>
  <symbol id="czi-reels" viewBox="0 0 24 24"><path fill="currentColor" fill-rule="evenodd" d="M3.5 5h17a1.5 1.5 0 0 1 1.5 1.5v11a1.5 1.5 0 0 1-1.5 1.5h-17A1.5 1.5 0 0 1 2 17.5v-11A1.5 1.5 0 0 1 3.5 5zM4.5 8v8h4V8zm5.5 0v8h4V8zm5.5 0v8h4V8z"/></symbol>
  <symbol id="czi-wheel" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.8" fill="none" stroke="currentColor" stroke-width="2.4"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M12 3.2v17.6M3.2 12h17.6M5.8 5.8l12.4 12.4M18.2 5.8L5.8 18.2"/><circle cx="12" cy="12" r="3" fill="currentColor"/></symbol>
</svg>`;
const UI_HTML = `${ICONS}
  <div class="cz-edges">
    <div class="cz-who"><img alt="" width="44" height="44"><div><b></b><span></span><button type="button" class="cz-signin">Sign in for your Chog's edges</button></div></div>
    <ul class="cz-badges" aria-label="Your Chog's edges"></ul>
  </div>
  <div class="cz-tip" role="tooltip" hidden></div>
  <button type="button" class="cz-leave"><i><svg aria-hidden="true"><use href="#czi-leave"/></svg></i><span>Step back</span></button>
  <div class="cz-dock">
    <p class="cz-say" aria-live="polite"></p>
    <div class="cz-tokens" hidden></div>
    <div class="cz-felt" hidden>On the felt <b>0</b></div>
    <div class="cz-bar">
      <div class="cz-bank"><small>Your chips</small><b>0</b></div>
      <div class="cz-rack" role="radiogroup" aria-label="Chip in hand">${BETS.map((v) => `<button type="button" class="cz-chip v${v}" role="radio" aria-checked="false" data-v="${v}" aria-label="${v}"><b>${v}</b></button>`).join('')}</div>
      <div class="cz-act">
        <button type="button" class="cz-key cz-undo" title="Undo" aria-label="Take the last chip back"><svg aria-hidden="true"><use href="#czi-undo"/></svg></button>
        <button type="button" class="cz-key cz-clear" title="Clear" aria-label="Clear the felt"><svg aria-hidden="true"><use href="#czi-clear"/></svg></button>
        <button type="button" class="cz-key cz-rebet" title="Rebet" aria-label="Put the last bets down again"><svg aria-hidden="true"><use href="#czi-rebet"/></svg></button>
        <button type="button" class="cz-spin"><span>SPIN</span></button>
      </div>
      <div class="cz-games">
        <button type="button" class="cz-go" data-game="slots"><svg aria-hidden="true"><use href="#czi-reels"/></svg><span>Chog Slots</span></button>
        <button type="button" class="cz-go roulette" data-game="roulette"><svg aria-hidden="true"><use href="#czi-wheel"/></svg><span>Roulette</span></button>
      </div>
    </div>
  </div>`;

/**
 * The games, their controls and camera moves. room: the casino's island.rooms entry; rig and camera:
 * the camera rig; dom: the canvas (taps on the machines, the reels and the felt); session(): A's
 * session (for your Chog: its id, name, art and traits); entering(): the walk in is playing; sky: the
 * world's lights (the room lights itself). Call update(dt, env) every frame; show(inside) says
 * whether you're in the room, and the controls show while you are.
 */
export function createCasino({ room: r, rig, camera, dom, session, entering = () => false, sky = null }) {
  const c = r.room.casino;
  const machine = c.machines[1];
  const look = c.look;
  const table = c.roulette ?? null;
  const sparks = c.burst.userData.sparks;
  const ui = document.createElement('div');
  ui.className = `cz-ui look-${look.name}`;
  ui.hidden = true;
  ui.innerHTML = UI_HTML;
  document.body.appendChild(ui);
  const q$ = (sel) => ui.querySelector(sel);
  const el = {
    img: q$('.cz-who img'), name: q$('.cz-who b'), sub: q$('.cz-who span'), badges: q$('.cz-badges'), tip: q$('.cz-tip'),
    leave: q$('.cz-leave'), leaveText: q$('.cz-leave span'), say: q$('.cz-say'), tokens: q$('.cz-tokens'), felt: q$('.cz-felt'),
    feltN: q$('.cz-felt b'), bankLabel: q$('.cz-bank small'), bankN: q$('.cz-bank b'), chips: [...ui.querySelectorAll('.cz-chip')],
    undo: q$('.cz-undo'), clear: q$('.cz-clear'), rebet: q$('.cz-rebet'), spin: q$('.cz-spin'),
  };
  const banner = document.createElement('div');
  banner.className = `cz-banner look-${look.name}`;
  banner.hidden = true;
  document.body.appendChild(banner);

  const all = loadStore();
  let who = null; // { key, id, name, traits, image, perks }
  let state = null; // this player's stored state: { chips, day, best, name, charges }
  let mode = null; // null (looking round the room), 'slots' or 'roulette'
  let message = '';
  let faceFor = null;
  // The slots.
  let bet = 10;
  let spinning = null; // { t, stops, from, durations, kind, only, wild, stake, paid }
  let lastLine = null;
  let last = { wild: null, stake: 0, paid: 0 }; // the spin that just landed (a re-roll or nudge keeps it)
  let offer = false; // after a losing spin: power-ups to save it
  let picking = null; // 'reroll' or 'nudge', choosing which reel
  let run = 0; // wins in a row, for the hot streak
  // The roulette.
  let chip = 10;
  const bets = new Map(); // what's on the felt: key -> chips
  // Each chip as it went down, so Undo and a held bet can take them off again, last first.
  let placed = [];
  let lastBets = null;
  let wheel = null; // the spin running: { step, n, bets, kind }
  let coast = null; // the wheel turning on after the ball has landed
  let settledFelt = false; // the felt shows the last spin's result until the next bet
  let lost = null; // after a losing spin: the bets that lost, for a second spin or a take back
  let lostKind = null;
  let lastN = null;
  let backAt = 0; // seconds left at the wheel before the camera goes back to the felt
  let sweepAt = 0; // then seconds before the spin's chips are swept off the felt
  // The show.
  let flash = 0, push = 0, shake = 0, show = null, wake = 0, shownChips = 0, t = 0;
  const fx = { spin: 0, win: 0, jackpot: 0 };
  const auraCol = new THREE.Color('#ffd27a');
  c.burst.count = 0;

  // The casino's own framing (the look's, or from the right of the door across the floor to the
  // machines): the room's view, so the way in ends on it.
  r.room.group.updateMatrixWorld(true);
  const g = r.room.group;
  const L = (x, y, z) => g.localToWorld(new THREE.Vector3(x, y, z));
  // On a tall screen its own, so the machines and the sign over them fit.
  let tall = null;
  const roomView = () => {
    const now = window.innerWidth < window.innerHeight;
    if (now === tall) return;
    tall = now;
    const v = look.view?.[tall ? 'tall' : 'wide'] ?? (tall ? { pos: [0.4, 3.0, 5.6], target: [0, 2.6, -4.2] } : { pos: [5.4, 3.2, 5.4], target: [2.81, 2.2, -4.26] });
    r.view.pos.copy(L(...v.pos));
    r.view.target.copy(L(...v.target));
    // Already standing at it (a link straight into the casino, a phone turned): take the new framing.
    if (rig.view === r.id) rig.jump?.(r.id);
    // At a game: its framing for the new shape.
    if (mode === 'slots' && rig.view === 'casino-play') {
      playView();
      rig.jump?.('casino-play');
    }
    if (mode === 'roulette' && rig.view === 'casino-roulette') goTable(wheel ? 'wheel' : 'bet', true);
  };
  // Where to stand to play: in front of the middle machine, eyes level with its reels, the cabinet
  // in the middle of the screen between your Chog's edges and the chips.
  const M = (x, y, z) => machine.group.localToWorld(new THREE.Vector3(x, y, z));
  const playView = () => {
    const wide = window.innerWidth > window.innerHeight * 1.1;
    // A short wide screen (a phone on its side): further back and higher on screen, over the chips.
    const short = wide && window.innerHeight < 520;
    rig.views['casino-play'] = short
      ? { pos: M(0, 1.6, 4.3), target: M(0, 1.12, 0), enter: true }
      : wide
      ? { pos: M(0, 1.95, 3.4), target: M(0, 1.72, 0), enter: true }
      : // A tall screen: back far enough for the whole cabinet, top to tray, over the slim bar (B22).
        { pos: M(0, 2.15, 3.6), target: M(0, 1.65, 0), enter: true };
  };
  // At the roulette: over the felt to bet, over the wheel while the ball runs.
  const goTable = (kind, now = false) => {
    // Inside the room (so the camera keeps to it, and never takes up the world's slow idle turn).
    rig.views['casino-roulette'] = { ...table.view(kind, window.innerWidth < window.innerHeight), enter: true };
    rig.idleSpin = false;
    if (now) rig.jump?.('casino-roulette');
    else rig.go('casino-roulette', kind === 'wheel' ? 1.1 : 1.3);
  };
  roomView();

  function identify() {
    const s = session()?.active;
    const chog = s?.info ? { key: String(s.info.id ?? s.id), id: s.info.id ?? s.id, name: s.info.name, traits: s.info.traits ?? {}, image: s.info.image } : null;
    const next = chog ?? { key: 'guest', id: null, name: 'Guest', traits: {}, image: `${BASE}art/43.webp` };
    if (who?.key === next.key) return;
    // A spin still turning when you switch Chogs (or sign out) pays the Chog that staked it.
    if (who && (spinning || wheel)) finishNow();
    who = { ...next, perks: perksFor(next.traits, Number(next.id ?? 7)) };
    state = all[who.key] ?? { chips: 0, day: '', best: 0 };
    // A spin the page was closed or reloaded on: its result was drawn when it started, so it pays now.
    const owed = state.pending ? settlePending(state) : 0;
    // A new day: chips topped up to the day's free amount, the power-ups back.
    if (state.day !== today()) {
      state.day = today();
      state.chips = Math.max(state.chips, who.perks.daily);
      state.charges = chargesFor(who.perks);
    }
    state.charges ??= chargesFor(who.perks);
    delete state.rerolls;
    all[who.key] = state;
    saveStore(all);
    shownChips = state.chips - owed;
    message = owed > 0 ? `Your last spin paid ${fmt(owed)}.` : '';
    offer = false;
    picking = null;
    run = 0;
    bets.clear();
    lost = null;
    settledFelt = false;
    auraCol.set(who.perks.aura ?? '#ffd27a');
    banner.style.setProperty('--aura', who.perks.aura ?? '#3ef2ff');
    if (table) {
      table.setStacks([]);
      table.highlight({ lucky: who.perks.roulette.lucky });
    }
    // The jackpot symbol wears your Chog's face.
    if (faceFor !== who.image) {
      faceFor = who.image;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        drawStrip(c.strip.canvas, img);
        c.strip.tex.needsUpdate = true;
        blurStrip(c.strip.canvas, c.strip.blurCanvas);
        c.strip.blurTex.needsUpdate = true;
      };
      img.src = who.image;
    }
    render();
    board.refresh();
  }

  // Pays a stored spin that never landed on screen (see identify). Returns the chips it paid.
  function settlePending(st) {
    const x = st.pending;
    delete st.pending;
    let back = 0;
    try {
      if (x.game === 'slots') back = Math.round(payout(x.stops.map((i) => STRIP[i]), who.perks, x.wild).k * x.stake);
      else if (x.game === 'roulette') back = settleSpin(x.bets, x.n, who.perks, (st.charges ??= chargesFor(who.perks))).back;
    } catch {
      back = 0;
    }
    st.chips += back;
    st.best = Math.max(st.best ?? 0, st.chips);
    return back;
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
      drawBoard(c.board.canvas, top, shared, c.board.theme);
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

  // ---------- the slots ----------
  const ONE = { chog: 'Chog', star: 'star', heart: 'heart' };
  /**
   * A spin. kind: 'spin' (your bet), 'wild' (your bet, a wild on), 'free' (on the house), or, after a
   * losing spin, 'reroll' (reel only spins again) or 'nudge' (reel only moves one stop).
   */
  function spin(kind = 'spin', only = -1) {
    if (spinning || !who || show) return;
    const ch = state.charges;
    let stake = bet, paid = bet, wild = null;
    if (kind === 'spin' || kind === 'wild') {
      if (kind === 'wild' && ch.wild <= 0) return;
      if (state.chips < bet) {
        message = state.chips < BETS[0] ? 'Out of chips. More testnet chips tomorrow.' : 'Not enough chips for that bet.';
        return render();
      }
      state.chips -= bet;
      if (kind === 'wild') {
        ch.wild--;
        wild = who.perks.slots.wild;
      }
    } else if (kind === 'free') {
      if (ch.free <= 0) return;
      ch.free--;
      paid = 0;
    } else {
      // A re-roll or a nudge saves the spin that just lost: the same stake, the same wild.
      const use = kind === 'reroll' ? 'rerolls' : 'nudges';
      if (!offer || ch[use] <= 0 || only < 0) return;
      ch[use]--;
      ({ stake, paid, wild } = last);
    }
    fire(kind === 'free' ? 'free' : kind === 'wild' ? 'wild' : kind === 'reroll' ? 'rerolls' : kind === 'nudge' ? 'nudges' : null);
    offer = false;
    picking = null;
    hinted.slots = true;
    const stops = machine.reels.map((reel, i) => {
      if (kind === 'reroll') return i === only ? randomStop() : reel.userData.stop;
      if (kind === 'nudge') return i === only ? (reel.userData.stop + 1) % STRIP.length : reel.userData.stop;
      return randomStop();
    });
    const durations = machine.reels.map((_, i) => (kind === 'reroll' ? (i === only ? 1.2 : 0) : kind === 'nudge' ? (i === only ? 0.42 : 0) : 1.1 + i * 0.4));
    spinning = { t: 0, stops, from: machine.reels.map((reel) => reel.userData.angle), durations, kind, only, wild, stake, paid };
    state.pending = { game: 'slots', stops, stake, wild };
    message = kind === 'wild' ? `Wild spin: the ${ONE[wild.symbol]}${wild.mid ? ' on the middle reel' : ''} is wild.` : kind === 'free' ? `Free spin for ${bet}.` : '';
    lever.pull = kind === 'reroll' || kind === 'nudge' ? null : 0;
    save();
    render();
  }

  // The reels land: settle the line, pay it, light up.
  function land() {
    const { stops, kind, wild, stake, paid } = spinning;
    spinning = null;
    delete state.pending;
    const line = stops.map((i) => STRIP[i]);
    lastLine = line;
    last = { wild, stake, paid };
    const p = who.perks;
    const res = payout(line, p, wild);
    const k = res.k;
    let extra = 0;
    if (k > 1) {
      run++;
      extra = p.slots.streak * Math.min(run - 1, 4);
    } else run = 0;
    const won = Math.round(k * stake * (1 + extra));
    state.chips += won;
    sweep(machine, 1);
    // The edges that paid more on this line light up.
    if (extra > 0) fire('streak');
    if (res.three && p.slots.three[res.three] > THREE_OF[res.three]) fire(`pays:${res.three}`);
    if (!res.three && k > 1 && p.slots.twoChogs > 6) fire('pays:two');
    const streakNote = extra > 0 ? ` Streak +${Math.round(extra * 100)}%.` : '';
    if (res.three) {
      const name = NAMES[res.three];
      message = `Three ${name}${res.wild ? ' with a wild' : ''}! +${fmt(won)}.${streakNote}`;
      if (res.three === 'chog') jackpot(won);
      else {
        announce(`THREE ${name.toUpperCase()}!`, `+${fmt(won)} chips${res.wild ? ' · wild' : ''}`);
        flash = 2.5;
        fx.win = 1;
        throwChips(k >= 20 ? 70 : 36);
        sparkleSlots(k >= 20 ? 110 : 60);
        setCoins(machine.tray, machine.tray.count + Math.min(20, 5 + Math.round(k / 3)));
        if (k >= 20) shake = 0.45;
      }
    } else if (k > 1) {
      message = `Two Chogs! +${fmt(won)}.${streakNote}`;
      flash = 1.5;
      fx.win = 0.6;
      throwChips(18);
      sparkleSlots(30);
      setCoins(machine.tray, machine.tray.count + 4);
    } else if (k === 1) message = paid ? `Your ${stake} back.` : `Free spin: +${stake}.`;
    else {
      const ch = state.charges;
      offer = ch.rerolls > 0 || ch.nudges > 0 || (ch.cashback > 0 && paid > 0);
      message = offer ? 'No win. Save it?' : kind === 'reroll' || kind === 'nudge' ? 'No luck this time.' : 'No win.';
    }
    save();
    render();
  }

  // A lost bet back, in either game: up to CASHBACK_MAX, one of the day's.
  function takeBack(amount) {
    const ch = state.charges;
    if (ch.cashback <= 0 || amount <= 0) return;
    ch.cashback--;
    fire('cashback');
    const back = Math.min(amount, CASHBACK_MAX);
    state.chips += back;
    message = `${fmt(back)} back.`;
    offer = false;
    picking = null;
    lost = null;
    save();
    render();
  }

  const lever = { pull: null };

  // ---------- the roulette ----------
  const staked = () => [...bets.values()].reduce((a, v) => a + v, 0);
  function clearFelt() {
    if (!settledFelt) return;
    settledFelt = false;
    lost = null;
    table.mark(null);
  }
  // A spin's chips off the felt once you've seen them: what it paid is in your chips by then. The
  // number it landed on stays marked until the next bet.
  function sweepFelt() {
    sweepAt = 0;
    if (!table || wheel || !settledFelt || bets.size) return;
    for (const key of table.stacked()) sparkleAt(table.worldAt(key), 6, 0.4, false);
    table.setStacks([]);
    render();
  }
  function drawFelt(result = null) {
    if (!result) table.setStacks([...bets].map(([key, amount]) => ({ key, amount })));
    table.highlight({ bets: new Set(bets.keys()), lucky: who.perks.roulette.lucky, ...(result ?? {}) });
  }
  function placeBet(key) {
    if (!table || wheel || show) return;
    clearFelt();
    const now = staked();
    if (now + chip > TABLE_MAX) message = `The table takes up to ${TABLE_MAX} a spin.`;
    else if (now + chip > state.chips) message = state.chips < BETS[0] ? 'Out of chips. More testnet chips tomorrow.' : 'Not enough chips for that.';
    else {
      bets.set(key, (bets.get(key) ?? 0) + chip);
      placed.push({ key, amount: chip });
      message = '';
      hinted.roulette = true;
      table.dropped();
      sparkleAt(table.worldAt(key), 5, 0.35, false);
    }
    drawFelt();
    if (table.aimed) aimAt(table.aimed);
    render();
  }
  // Takes a chip back off the felt: the last one placed, or the last one on `key`.
  function takeOff(key = null) {
    if (!table || wheel || show) return;
    let i = placed.length - 1;
    if (key) while (i >= 0 && placed[i].key !== key) i--;
    let amount, k;
    if (i >= 0) ({ key: k, amount } = placed.splice(i, 1)[0]);
    else if (key && bets.has(key)) (k = key), (amount = bets.get(key));
    else return;
    const left = (bets.get(k) ?? 0) - amount;
    if (left > 0) bets.set(k, left);
    else bets.delete(k);
    message = '';
    drawFelt();
    if (table.aimed) aimAt(table.aimed);
    render();
  }
  function rebet() {
    if (!table || wheel || !lastBets) return;
    clearFelt();
    bets.clear();
    let total = 0;
    placed = [];
    for (const [key, amount] of lastBets) {
      if (total + amount > Math.min(state.chips, TABLE_MAX)) break;
      bets.set(key, amount);
      placed.push({ key, amount });
      total += amount;
    }
    message = bets.size < lastBets.size ? 'Not enough chips for all of them.' : '';
    drawFelt();
    render();
  }
  function clearBets() {
    if (wheel) return;
    clearFelt();
    bets.clear();
    placed = [];
    message = '';
    drawFelt();
    render();
  }
  /** The wheel. kind: 'spin' (the bets on the felt), or 'second' (the bets that just lost, free). */
  function spinWheel(kind = 'spin', forced = null) {
    if (!table || wheel || show || !who) return;
    if (kind === 'second') {
      if (!lost?.length || state.charges.second <= 0) return;
      state.charges.second--;
      fire('second');
      clearFelt();
      bets.clear();
      for (const x of lost) bets.set(x.key, x.amount);
    } else {
      if (!bets.size) {
        message = lastBets ? 'Put chips on the felt, or Rebet.' : 'Put chips on the felt first: tap a number or a box.';
        return render();
      }
      const total = staked();
      if (state.chips < total) {
        message = 'Not enough chips for that.';
        return render();
      }
      state.chips -= total;
      lastBets = new Map(bets);
    }
    placed = [];
    lost = null;
    settledFelt = false;
    const n = forced ?? randomInt(37);
    wheel = { step: spinBall(table, n), n, bets: [...bets].map(([key, amount]) => ({ key, amount })), kind };
    state.pending = { game: 'roulette', n, bets: wheel.bets };
    coast = null;
    table.mark(null);
    table.aim(null);
    drawFelt();
    goTable('wheel');
    message = kind === 'second' ? 'Second spin: your bets ride again.' : 'No more bets.';
    save();
    render();
  }
  function settleWheel() {
    const { n, kind } = wheel;
    const res = settleSpin(wheel.bets, n, who.perks, state.charges);
    delete state.pending;
    coast = wheel.step;
    wheel = null;
    lastN = n;
    state.chips += res.back;
    const colour = colourOf(n);
    const wins = new Set(res.results.filter((x) => x.back > x.amount).map((x) => x.key));
    // The felt: what came back stacked where it was won (or saved), the rest swept off.
    bets.clear();
    settledFelt = true;
    table.setStacks(res.results.filter((x) => x.back > 0).map((x) => ({ key: x.key, amount: x.back })));
    drawFelt({ hit: `n${n}`, wins, bets: new Set() });
    table.mark(n);
    // A glitter where the ball lands, whatever it lands on.
    sparkleAt(table.group.localToWorld(table.ball.position.clone()), 14, 0.7, false);
    // Each edge that saved or paid a bet lights up.
    for (const x of res.results) if (x.why) fire(WHY_TAG[x.why]);
    const notes = [];
    for (const x of res.results) {
      if (x.why === 'near miss') notes.push(`Near miss: ${fmt(x.back)} back.`);
      if (x.why === 'shield') notes.push(`Shield: ${fmt(x.back)} back.`);
      if (x.why === 'red' || x.why === 'black') notes.push(`${COLOUR_NAME[x.why]} bet saved.`);
      if (x.why === 'even money' || x.why === 'dozen') notes.push(`Bet saved.`);
    }
    if (res.saved.includes('lucky save')) notes.unshift(`Lucky ${n}! Your lost bets come back.`);
    const head = `${n} ${COLOUR_NAME[colour]}.`;
    const win = res.back;
    const big = res.results.some((x) => x.why === 'lucky number' || x.why === 'first straight win');
    if (wins.size) {
      message = `${head} +${fmt(win)}. ${[...new Set(notes)].join(' ')}`.trim();
      const straight = res.results.some((x) => wins.has(x.key) && x.key[0] === 'n');
      fx.win = straight ? 1 : 0.6;
      flash = straight ? 2.5 : 1.2;
      const at = table.worldAt(`n${n}`);
      if (big) announce(res.saved.includes('lucky number') ? `LUCKY ${n}!` : '50 TO 1!', `+${fmt(win)} chips`);
      else if (straight) announce(`${n} ${COLOUR_NAME[colour].toUpperCase()}!`, `+${fmt(win)} chips`);
      throwChips(straight ? 40 : 16, false, at);
      sparkleAt(at, straight ? 80 : 30, 1.6);
    } else {
      lost = res.results.filter((x) => x.back === 0);
      lostKind = kind;
      message = `${head} ${notes.length ? [...new Set(notes)].join(' ') : lost.length ? 'No win.' : ''}`.trim();
      if (notes.length) sparkleAt(table.worldAt(`n${n}`), 20, 1.0);
    }
    backAt = 1.8;
    save();
    render();
  }
  const lostTotal = () => (lost ?? []).reduce((a, x) => a + x.amount, 0);

  // ---------- the show ----------
  // Chips out of the tray (or, for the jackpot, down from the ceiling all over the room; or up from
  // the roulette's felt), in the room's own space: each a position, a velocity, a spin, and an age.
  const chips = [];
  const COLOURS = ['#c4334a', '#1d1d2a', '#e8b84a', '#fff6e8', '#c4334a', '#e8b84a'].map((x) => new THREE.Color(x));
  const local = (v) => g.worldToLocal(v);
  const tray = () => local(M(0, 1.0, 0.45));
  const top = () => local(M(0, 3.0, 0.15));
  const fwd = () => local(M(0, 0, 1)).sub(local(M(0, 0, 0)));
  function throwChips(n, rain = false, at = null) {
    // Half spill out of the tray onto the carpet, half fountain out of the top and down either side,
    // so none cross the reels while the winning line shows.
    const f = fwd(), side = new THREE.Vector3(f.z, 0, -f.x);
    const spill = tray(), crown = top(), felt = at ? local(at.clone()) : null;
    for (let i = 0; i < n && chips.length < CHIPS_MAX; i++) {
      const fountain = i % 2 === 1;
      let p, v;
      if (rain) {
        // The rain falls over the machines' half of the room, where the camera looks.
        p = new THREE.Vector3((Math.random() - 0.5) * (r.room.w - 3), r.room.h - 0.4, -r.room.d / 2 + 1 + Math.random() * (r.room.d * 0.55));
        v = new THREE.Vector3((Math.random() - 0.5) * 0.6, -0.5 - Math.random(), (Math.random() - 0.5) * 0.6);
      } else if (felt) {
        // Up off the felt and down round the table.
        const a = Math.random() * Math.PI * 2;
        p = felt.clone().setY(felt.y + 0.05);
        v = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(0.6 + Math.random() * 1.4).setY(2.2 + Math.random() * 1.6);
      } else {
        p = (fountain ? crown : spill).clone();
        v = fountain
          ? f.clone().multiplyScalar(0.2 + Math.random() * 0.6).addScaledVector(side, (Math.random() < 0.5 ? -1 : 1) * (1.2 + Math.random() * 1.6)).setY(2 + Math.random() * 1.6)
          : f.clone().multiplyScalar(0.8 + Math.random() * 1.0).addScaledVector(side, (Math.random() - 0.5) * 3.6).setY(1.2 + Math.random() * 1.2);
      }
      chips.push({
        p, v, age: rain ? -Math.random() * 1.6 : -i * 0.012,
        q: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 3, Math.random() * 3, Math.random() * 3)),
        w: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(14),
        colour: COLOURS[(Math.random() * COLOURS.length) | 0],
        life: rain ? 4.4 : 3.2,
        size: rain ? 1.8 : felt ? 0.8 : 1,
        onTable: !!felt,
      });
    }
  }
  const m4 = new THREE.Matrix4(), dq = new THREE.Quaternion(), flat = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), sc = new THREE.Vector3(), ax = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0), DOWN = new THREE.Vector3(0, -1, 0);
  // A chip (makeBurst's): its radius and half its thickness at size 1.
  const CHIP_R = 0.06, CHIP_H = 0.009;
  // Chips off the felt land back on the table where they fall over it, on the floor past its edge.
  const toTable = table ? table.group.matrix.clone().invert() : null;
  const floorAt = (ch) => {
    if (!ch.onTable) return 0.002;
    sc.copy(ch.p).applyMatrix4(toTable);
    return Math.abs(sc.x) < 1.75 && Math.abs(sc.z) < 0.8 ? 1.002 : 0.002;
  };
  // How high its middle sits when its lowest edge touches the floor, tilted as it is, at size s.
  const restAt = (ch, s) => {
    const c = Math.abs(ax.copy(UP).applyQuaternion(ch.q).y);
    return floorAt(ch) + s * (CHIP_R * Math.sqrt(Math.max(0, 1 - c * c)) + CHIP_H * c);
  };
  function stepChips(dt) {
    let n = 0;
    for (let i = chips.length - 1; i >= 0; i--) {
      const ch = chips[i];
      ch.age += dt;
      if (ch.age >= ch.life) chips.splice(i, 1);
    }
    for (const ch of chips) {
      if (ch.age < 0) continue;
      const s = THREE.MathUtils.clamp((ch.life - ch.age) / 0.5, 0, 1) * ch.size;
      const wasAbove = ch.p.y >= restAt(ch, s) - 0.002;
      if (!ch.down) ch.v.y -= 9.8 * dt;
      ch.p.addScaledVector(ch.v, dt);
      if (ch.w.lengthSq() > 1e-4) ch.q.premultiply(dq.setFromAxisAngle(sc.copy(ch.w).normalize(), ch.w.length() * dt));
      // Down on the carpet (or the felt): a small bounce, then it settles flat and lies there. Its
      // lowest edge never goes through, however fast it falls or slow the frame.
      const rest = restAt(ch, s);
      if (ch.p.y < rest && wasAbove) {
        ch.p.y = rest;
        if (!ch.down) {
          ch.v.y *= -0.28;
          ch.v.x *= 0.55;
          ch.v.z *= 0.55;
          ch.w.multiplyScalar(0.4);
          if (Math.abs(ch.v.y) < 0.4) ch.down = true;
        }
      }
      if (ch.down) {
        // Sliding to a stop, tipping flat onto whichever face is nearer the floor.
        ch.v.set(ch.v.x * Math.exp(-dt * 7), 0, ch.v.z * Math.exp(-dt * 7));
        ch.w.multiplyScalar(Math.exp(-dt * 10));
        ax.copy(UP).applyQuaternion(ch.q);
        flat.setFromUnitVectors(ax, ax.y >= 0 ? UP : DOWN).multiply(ch.q);
        ch.q.slerp(flat, 1 - Math.exp(-dt * 12));
        // Off the table's edge: it falls again.
        if (ch.p.y > restAt(ch, s) + 0.05) ch.down = false;
        else ch.p.y = restAt(ch, s);
      }
      m4.compose(ch.p, ch.q, sc.copy(one).multiplyScalar(s));
      c.burst.setMatrixAt(n, m4);
      c.burst.setColorAt(n, ch.colour);
      n++;
    }
    c.burst.count = n;
    if (n) {
      c.burst.instanceMatrix.needsUpdate = true;
      c.burst.instanceColor.needsUpdate = true;
    }
  }

  // The sparkles: little stars in your aura's colour, gold and white, that burst out and twinkle.
  const glitter = [];
  const GOLD = new THREE.Color('#ffd27a'), WHITE = new THREE.Color('#ffffff');
  function addSpark(p, v, life, grav) {
    if (glitter.length >= SPARKS_MAX - 1) return;
    const pick = Math.random();
    const col = (pick < 0.5 ? auraCol : pick < 0.8 ? GOLD : WHITE).clone().multiplyScalar(1.6);
    glitter.push({ p, v, age: -Math.random() * 0.15, life, grav, col, ph: Math.random() * 6 });
  }
  // Over the reel window, flying out toward you.
  function sparkleSlots(n) {
    const f = fwd(), side = new THREE.Vector3(f.z, 0, -f.x);
    for (let i = 0; i < n; i++) {
      const p = local(M((Math.random() - 0.5) * 1.1, 1.28 + Math.random() * 0.7, 0.42));
      const out = p.clone().sub(local(M(0, 1.62, 0.42)));
      const v = f.clone().multiplyScalar(0.5 + Math.random() * 1.4).addScaledVector(out, 1.6 + Math.random()).addScaledVector(side, (Math.random() - 0.5) * 0.6).setY(out.y * 1.4 + 0.4 + Math.random() * 0.6);
      addSpark(p, v, 1.1 + Math.random() * 0.9, -1.4);
    }
  }
  // Up from a point (world space), in a fountain.
  function sparkleAt(at, n, power = 1, up = true) {
    const o = local(at.clone());
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = (0.2 + Math.random() * 0.7) * power;
      const v = new THREE.Vector3(Math.cos(a) * s, (up ? 1.6 + Math.random() * 1.4 : 0.4 + Math.random() * 0.6) * power, Math.sin(a) * s);
      addSpark(o.clone().add(new THREE.Vector3(0, 0.03, 0)), v, 0.9 + Math.random() * 0.8, -3.2);
    }
  }
  function stepSparks(dt) {
    const pos = sparks.geometry.attributes.position, col = sparks.geometry.attributes.color;
    for (let i = glitter.length - 1; i >= 0; i--) {
      const s = glitter[i];
      s.age += dt;
      if (s.age >= s.life) glitter.splice(i, 1);
    }
    let n = 0;
    for (const s of glitter) {
      if (s.age < 0) continue;
      s.v.y += s.grav * dt;
      s.v.multiplyScalar(1 - dt * 1.2);
      s.p.addScaledVector(s.v, dt);
      const k = s.age / s.life;
      const tw = 0.55 + 0.45 * Math.sin(s.age * 26 + s.ph);
      const a = Math.min(1, s.age / 0.08) * (1 - k * k) * tw;
      pos.setXYZ(n, s.p.x, s.p.y, s.p.z);
      col.setXYZ(n, s.col.r * a, s.col.g * a, s.col.b * a);
      n++;
    }
    // None out: the one dark spark the load drew stays, black (it adds nothing).
    if (!n) col.setXYZ(0, 0, 0, 0);
    sparks.geometry.setDrawRange(0, Math.max(1, n));
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }

  // The glint across a machine's glass: k is how bright (1 on landing; idle machines catch the light
  // now and then on their own).
  function sweep(m, k = 0.6) {
    m.glint.t = 0;
    m.glint.k = k;
    m.glint.at = 5 + Math.random() * 3;
  }
  function stepGlints(dt) {
    for (const m of c.machines) {
      const gl = m.glint;
      if (gl.t >= 0) {
        gl.t += dt / 0.75;
        gl.tex.offset.x = 0.7 - 1.4 * easeInOut(Math.min(1, gl.t));
        gl.mesh.material.color.setScalar(1.5 * (gl.k ?? 0.6));
        if (gl.t >= 1) {
          gl.t = -1;
          gl.tex.offset.x = 0.7;
        }
      } else if ((gl.at -= dt) <= 0 && !(m === machine && spinning)) sweep(m, m === machine ? 0.5 : 0.4);
    }
  }

  // A win's name up in lights, over the world.
  function announce(title, sub, big = false) {
    banner.innerHTML = `<div class="czb-title">${title}</div><div class="czb-sub">${sub}</div>`;
    banner.classList.toggle('big', big);
    banner.hidden = false;
    banner.classList.remove('on');
    void banner.offsetWidth;
    banner.classList.add('on');
    clearTimeout(announce.t);
    announce.t = setTimeout(() => (banner.hidden = true), big ? 4200 : 2400);
  }

  // The jackpot: the casino's own cutscene. From the machine the camera pulls back and across the
  // room while every machine flashes and chips rain down, your Chog waves, and it comes back to the
  // machine. About 5 s; a tap or Esc skips it.
  function jackpot(won) {
    announce('JACKPOT', `three Chogs · +${fmt(won)} chips`, true);
    throwChips(40);
    throwChips(120, true);
    sparkleSlots(160);
    setCoins(machine.tray, COIN_SLOTS.length);
    flash = 6;
    fx.jackpot = 1;
    for (const m of c.machines) sweep(m, 1);
    const view = rig.views['casino-play'];
    const keys = [
      { t: 0, pos: camera.position.clone(), look: view.target.clone() },
      { t: 1.7, pos: L(4.4, 3.6, 4.2), look: L(0.4, 2.0, -5.2) },
      { t: 3.6, pos: L(-2.6, 3.0, 3.6), look: L(0.2, 1.8, -5.4) },
      { t: 5.2, pos: view.pos.clone(), look: view.target.clone() },
    ];
    show = { t: 0, flight: createFlight({ keys: keys.map((k) => ({ t: k.t, pos: k.pos.toArray(), look: k.look.toArray() })) }) };
    ui.classList.add('away');
    hideTip();
    // Your Chog, if it came in with you, waves at it.
    const chog = session()?.active?.chog;
    if (chog?.root.parent === g) {
      chog.play?.('wave');
      setTimeout(() => chog.play?.('idle'), 2600);
    }
  }
  function endShow() {
    show = null;
    ui.classList.remove('away');
    render();
  }
  const skip = (e) => {
    if (!show || (e.type === 'keydown' && e.key !== 'Escape')) return;
    e.stopImmediatePropagation();
    endShow();
  };
  dom?.addEventListener('pointerdown', skip, { capture: true });
  window.addEventListener('keydown', skip, { capture: true });

  // ---------- taps: a machine or the table to play, a reel to re-roll or nudge, the felt to bet ----------
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const aim = (x, y) => {
    ndc.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
  };
  // The bet spot under (x, y) at the roulette, while bets can go down, or null.
  function spotAt(x, y) {
    if (ui.hidden || show || !who || mode !== 'roulette' || !table || wheel) return null;
    aim(x, y);
    const hit = ray.intersectObject(table.layout, false)[0];
    return hit?.uv ? table.keyAt(hit.uv) : null;
  }
  // What a tap at (x, y) would do, or null.
  function target(x, y) {
    if (ui.hidden || show || !who) return null;
    if (mode === 'roulette' && table) {
      const key = spotAt(x, y);
      return key ? () => placeBet(key) : null;
    }
    aim(x, y);
    if (mode === 'slots') {
      if (!picking) return null;
      const hit = ray.intersectObjects(machine.reels, false)[0];
      return hit ? () => spin(picking, machine.reels.indexOf(hit.object)) : null;
    }
    if (table && ray.intersectObject(table.group, true)[0]) return () => goPlay('roulette');
    if (ray.intersectObject(machine.group, true)[0]) return () => goPlay('slots');
    return null;
  }
  // The glow on the felt where the chip in hand would land (coral where it can't go).
  const fits = () => staked() + chip <= Math.min(TABLE_MAX, state?.chips ?? 0);
  const aimAt = (key) => table?.aim(key, chip, fits());
  // Pressing on a bet and holding takes a chip off it; so does a right click.
  const HOLD = 420;
  let down = null;
  dom?.addEventListener('pointerdown', (e) => {
    if (down) clearTimeout(down.timer);
    down = e.isPrimary ? { x: e.clientX, y: e.clientY, t: performance.now(), at: e.timeStamp, id: e.pointerId, button: e.button, key: spotAt(e.clientX, e.clientY), held: false, timer: 0 } : null;
    if (!down?.key) return;
    if (e.button === 0) aimAt(down.key);
    if (e.button === 0 && bets.has(down.key)) {
      const d = down;
      d.timer = setTimeout(() => {
        if (down !== d || !bets.has(d.key)) return;
        d.held = true;
        takeOff(d.key);
      }, HOLD);
    }
  });
  let hoverAt = 0;
  dom?.addEventListener('pointermove', (e) => {
    if (down && down.id === e.pointerId) {
      // A drag turns the camera: no bet, and the glow goes.
      if (down.key && Math.hypot(e.clientX - down.x, e.clientY - down.y) >= 10) {
        clearTimeout(down.timer);
        down.key = null;
        table?.aim(null);
      }
      return;
    }
    // A mouse over something to tap shows the hand, and over the felt the glow.
    if (e.pointerType !== 'mouse' || e.buttons || ui.hidden) return;
    const now = performance.now();
    if (now - hoverAt < 50) return;
    hoverAt = now;
    const key = spotAt(e.clientX, e.clientY);
    if (key) aimAt(key);
    else if (table?.aimed) table.aim(null);
    dom.style.cursor = key || target(e.clientX, e.clientY) ? 'pointer' : '';
  });
  dom?.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && table?.aim(null));
  const lift = (e) => {
    if (!down || down.id !== e.pointerId) return;
    const d = down;
    down = null;
    clearTimeout(d.timer);
    const quick = performance.now() - d.t < 400 && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 10;
    // Held long enough, even if the page was too busy for the timer: a chip comes off.
    if (!d.held && d.key && d.button === 0 && e.type === 'pointerup' && e.timeStamp - d.at >= HOLD && bets.has(d.key) && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 10) {
      d.held = true;
      takeOff(d.key);
    }
    if (e.type === 'pointerup' && !d.held) {
      if (d.button === 2 && quick && d.key && bets.has(d.key)) takeOff(d.key);
      else if (d.button === 0 && quick) target(e.clientX, e.clientY)?.();
    }
    // A finger leaves no hover: the glow stays a moment where the chip went, then fades.
    if (e.pointerType !== 'mouse') setTimeout(() => !down && table?.aim(null), 500);
  };
  dom?.addEventListener('pointerup', lift);
  dom?.addEventListener('pointercancel', lift);

  // ---------- your Chog's edges, as badges ----------
  let badgeFor = '';
  let badgeEls = [];
  let tipFor = null, tipPinned = false;
  const capital = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  const charged = () => (mode === 'slots' ? SLOT_CHARGES : WHEEL_CHARGES);
  const chargeOf = (x) => x.tags.find((tag) => charged().has(tag)) ?? null;
  const edgesHere = () => (mode ? who.perks.list.filter((x) => x.game === mode || x.game === 'both') : []);
  function buildBadges() {
    const list = edgesHere();
    el.badges.innerHTML = list
      .map((x, i) => {
        const face = x.tags.includes('luckySave') ? `<b class="cz-num">${who.perks.roulette.lucky}</b>` : `<svg aria-hidden="true"><use href="#czi-${iconOf(x)}"/></svg>`;
        const tint = x.tags.includes('aura') ? ` style="--ic:${who.perks.aura ?? '#ffd36b'}"` : x.tags.includes('red') ? ' style="--ic:#ff6f61"' : x.tags.includes('black') ? ' style="--ic:#dcd6ea"' : '';
        return `<li><button type="button" class="cz-badge" data-i="${i}" aria-label="${x.name}"><i${tint}>${face}</i><span>${x.name}</span><em hidden></em></button></li>`;
      })
      .join('');
    badgeEls = [...el.badges.querySelectorAll('.cz-badge')].map((b, i) => ({ b, x: list[i], em: b.querySelector('em') }));
    hideTip();
  }
  function updateBadges() {
    for (const { b, x, em } of badgeEls) {
      const tag = chargeOf(x);
      const n = tag ? state.charges[tag] ?? 0 : null;
      em.hidden = !n;
      if (n) em.textContent = n;
      b.classList.toggle('used', n === 0);
    }
    if (tipFor) showTip(tipFor, tipPinned);
  }
  // An edge doing its work: every badge it belongs to lights up.
  function fire(tag) {
    if (!tag) return;
    for (const { b, x } of badgeEls) {
      if (!x.tags.includes(tag)) continue;
      b.classList.remove('fire');
      void b.offsetWidth;
      b.classList.add('fire');
      clearTimeout(b._fire);
      b._fire = setTimeout(() => b.classList.remove('fire'), 2400);
    }
  }
  function showTip(entry, pinned = false) {
    const { b, x } = entry;
    tipFor = entry;
    tipPinned = pinned;
    const tag = chargeOf(x);
    const n = tag ? state.charges[tag] ?? 0 : null;
    const left = n === null ? 'Always on.' : n > 0 ? `${n} left today.` : 'Used up today. Back tomorrow.';
    // Which trait gives it, unless the edge already says (Legendary, Gold tooth).
    const from = x.trait.startsWith('#') ? `Its number, ${x.trait}` : x.trait.toLowerCase() === x.name.toLowerCase() ? '' : x.trait;
    el.tip.innerHTML = `${from ? `<small>${from}</small>` : ''}<b>${x.name}</b>${capital(x.text)}.<em class="${n === 0 ? 'out' : ''}">${left}</em>`;
    el.tip.hidden = false;
    // Under the badge, kept on screen.
    const r = b.getBoundingClientRect();
    const w = el.tip.offsetWidth;
    const left0 = Math.max(12, Math.min(window.innerWidth - w - 12, r.left + r.width / 2 - 34));
    el.tip.style.left = `${left0}px`;
    el.tip.style.top = `${r.bottom + 12}px`;
    el.tip.style.setProperty('--arrow', `${Math.max(14, Math.min(w - 20, r.left + r.width / 2 - left0))}px`);
    for (const o of badgeEls) o.b.classList.toggle('open', o === entry && pinned);
  }
  function hideTip() {
    tipFor = null;
    tipPinned = false;
    el.tip.hidden = true;
    for (const o of badgeEls) o.b.classList.remove('open');
  }
  el.badges.addEventListener('click', (e) => {
    const b = e.target.closest('.cz-badge');
    const entry = b && badgeEls.find((o) => o.b === b);
    if (!entry) return;
    if (tipFor === entry && tipPinned) hideTip();
    else showTip(entry, true);
  });
  el.badges.addEventListener('pointerover', (e) => {
    const b = e.pointerType === 'mouse' && e.target.closest('.cz-badge');
    const entry = b && badgeEls.find((o) => o.b === b);
    if (entry && !tipPinned) showTip(entry, false);
  });
  el.badges.addEventListener('pointerout', (e) => {
    if (e.pointerType === 'mouse' && !tipPinned && !el.badges.contains(e.relatedTarget)) hideTip();
  });
  document.addEventListener('pointerdown', (e) => tipPinned && !e.target.closest?.('.cz-badge') && hideTip(), true);

  // ---------- the controls ----------
  // A first visit to each game says how it works, until you've played it.
  const hinted = { roulette: false, slots: false };
  const HINT = {
    roulette: TOUCH ? 'Pick a chip, then tap the felt. Hold a bet to take a chip back.' : 'Pick a chip, then click the felt. Right-click or hold a bet to take a chip back.',
    slots: 'The chip you hold is your bet. Pull with SPIN.',
  };
  let said = '';
  const token = (act, label, n = 0, cls = '', extra = '') => `<button type="button" class="cz-token ${cls}" data-act="${act}"${extra}><b>${label}</b>${n > 1 ? `<em>×${n}</em>` : ''}</button>`;
  function tokens() {
    const ch = state.charges;
    if (mode === 'slots') {
      if (picking) {
        return `<span class="cz-ask">${picking === 'reroll' ? 'Re-roll which reel?' : 'Nudge which reel?'}</span>${[1, 2, 3].map((n) => token('reel', String(n), 0, 'reel', ` data-i="${n - 1}" aria-label="Reel ${n}"`)).join('')}${token('cancel', '×', 0, 'reel cancel', ' aria-label="Cancel"')}`;
      }
      let out = '';
      if (offer) {
        if (ch.rerolls > 0) out += token('reroll', 'Re-roll a reel', ch.rerolls, 'save');
        if (ch.nudges > 0) out += token('nudge', 'Nudge a reel', ch.nudges, 'save');
        if (ch.cashback > 0 && last.paid > 0) out += token('back', `Take ${fmt(Math.min(last.paid, CASHBACK_MAX))} back`, ch.cashback, 'save');
      }
      if (!spinning && !show) {
        const w = who.perks.slots.wild;
        if (ch.free > 0) out += token('free', 'Free spin', ch.free);
        if (ch.wild > 0) out += token('wild', 'Wild spin', ch.wild, 'wild', ` title="The ${ONE[w.symbol]}${w.mid ? ' on the middle reel' : ''} stands in for any symbol"`);
      }
      return out;
    }
    if (mode === 'roulette' && lost?.length && !wheel) {
      let out = '';
      if (ch.second > 0) out += token('second', 'Spin again, free', ch.second, 'save');
      if (ch.cashback > 0 && lostKind === 'spin') out += token('back', `Take ${fmt(Math.min(lostTotal(), CASHBACK_MAX))} back`, ch.cashback, 'save');
      return out;
    }
    return '';
  }
  el.tokens.addEventListener('click', (e) => {
    const b = e.target.closest('.cz-token');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'reel') spin(picking, Number(b.dataset.i));
    else if (act === 'cancel') (picking = null), render();
    else if (act === 'reroll' || act === 'nudge') (picking = act), render();
    else if (act === 'free' || act === 'wild') spin(act);
    else if (act === 'back') takeBack(mode === 'slots' ? last.paid : lostTotal());
    else if (act === 'second') spinWheel('second');
  });
  // The chip in hand: at the roulette what a tap puts down, at the slots the bet.
  function hold(v) {
    if (!BETS.includes(v)) return;
    if (mode === 'slots') bet = v;
    else chip = v;
    if (table?.aimed) aimAt(table.aimed);
    render();
  }
  el.chips.forEach((b) => b.addEventListener('click', () => hold(Number(b.dataset.v))));
  // Arrow keys move along the rack, as a radio group does.
  ui.querySelector('.cz-rack').addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const now = BETS.indexOf(mode === 'slots' ? bet : chip);
    hold(BETS[Math.max(0, Math.min(BETS.length - 1, now + d))]);
    el.chips.find((b) => b.classList.contains('on'))?.focus();
  });
  el.undo.addEventListener('click', () => takeOff());
  el.clear.addEventListener('click', () => clearBets());
  el.rebet.addEventListener('click', () => rebet());
  el.spin.addEventListener('click', () => (mode === 'slots' ? spin() : spinWheel()));
  el.leave.addEventListener('click', () => {
    if (mode) stepBack();
    // In the room: out of the casino, the way the Back button goes (src/main.js).
    else document.getElementById('btn-back')?.click();
  });
  ui.querySelectorAll('.cz-go').forEach((b) => b.addEventListener('click', () => goPlay(b.dataset.game)));
  q$('.cz-signin')?.addEventListener('click', () => document.getElementById('btn-signin')?.click());

  function render() {
    if (!who) return;
    ui.classList.toggle('at-slots', mode === 'slots');
    ui.classList.toggle('at-roulette', mode === 'roulette');
    ui.classList.toggle('at-room', !mode);
    ui.classList.toggle('guest', who.key === 'guest');
    // Who's playing, and its edges at this game.
    const bk = `${who.key}|${mode}`;
    if (bk !== badgeFor) {
      badgeFor = bk;
      el.img.src = who.image;
      el.name.textContent = who.name;
      buildBadges();
    }
    const n = mode ? badgeEls.length : who.perks.list.length;
    el.sub.textContent = mode ? `${n} edge${n === 1 ? '' : 's'} at the ${mode}` : `${n} edge${n === 1 ? '' : 's'} here · pick a game`;
    updateBadges();
    // The chips in hand.
    const held = mode === 'slots' ? bet : chip;
    for (const b of el.chips) {
      const v = Number(b.dataset.v);
      b.classList.toggle('on', v === held);
      b.setAttribute('aria-checked', String(v === held));
      b.tabIndex = v === held ? 0 : -1;
      b.classList.toggle('poor', v > state.chips);
    }
    el.bankLabel.textContent = mode === 'slots' ? `Bet ${bet} a spin` : 'Your chips';
    el.bankN.textContent = fmt(shownChips);
    el.leaveText.textContent = mode ? 'Step back' : 'Leave';
    el.leave.setAttribute('aria-label', mode ? 'Step back from the game' : 'Leave the casino');
    // Undo and Clear for the chips on the felt; Rebet puts the last spin's bets down again on a bare felt.
    const on = mode === 'roulette' ? staked() : 0;
    el.undo.disabled = !!wheel || !on;
    el.clear.disabled = !!wheel || !on;
    el.rebet.disabled = !!wheel || !!on || !lastBets;
    el.rebet.classList.toggle('again', !wheel && !on && !!lastBets);
    // SPIN, with a light running round its ring while the reels or the wheel turn.
    const turning = mode === 'slots' ? !!spinning : !!wheel;
    el.spin.disabled = turning || !!show || (mode === 'slots' && !!picking);
    el.spin.classList.toggle('busy', turning);
    el.felt.hidden = !on;
    el.feltN.textContent = on >= TABLE_MAX ? `${fmt(on)} · table max` : fmt(on);
    // What just happened, or how to play.
    const hint = !message ? (mode ? (hinted[mode] ? '' : HINT[mode]) : 'Testnet chips, topped up every day.') : '';
    const text = message || hint;
    el.say.hidden = !text;
    el.say.classList.toggle('quiet', !message);
    if (text !== said) {
      said = text;
      el.say.textContent = text;
      el.say.classList.remove('pop');
      if (message) {
        void el.say.offsetWidth;
        el.say.classList.add('pop');
      }
    }
    el.tokens.innerHTML = mode ? tokens() : '';
    el.tokens.hidden = !el.tokens.innerHTML;
  }

  function goPlay(game = 'slots') {
    if (game === 'roulette' && !table) return;
    mode = game;
    picking = null;
    message = '';
    hideTip();
    if (game === 'slots') {
      table?.aim(null);
      playView();
      rig.idleSpin = false;
      rig.go('casino-play', 1.2);
    } else {
      drawFelt();
      goTable('bet');
    }
    document.body.classList.toggle('cz-playing', true);
    render();
  }
  function stepBack() {
    finishNow();
    mode = null;
    picking = null;
    message = '';
    table?.aim(null);
    hideTip();
    rig.go(r.id, 1.0);
    document.body.classList.toggle('cz-playing', false);
    render();
  }
  // Leaving mid-game: a spin still turning settles at once.
  function finishNow() {
    if (spinning) {
      machine.reels.forEach((reel, i) => {
        reel.userData.stop = spinning.stops[i];
        reel.userData.angle = spinning.stops[i] * STEP + STEP / 2;
        reel.rotation.x = reel.userData.angle;
        reel.material = c.strip.mat;
      });
      land();
    }
    if (wheel) {
      while (!wheel.step.landed) wheel.step.step(0.25);
      settleWheel();
    }
    if (show) endShow();
  }

  // Keys: Space or Enter spins, 1 to 5 pick a chip, Backspace takes the last chip back, Esc steps back.
  window.addEventListener('keydown', (e) => {
    if (ui.hidden || !mode || e.repeat || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || show) return;
    if (e.code === 'Space' || e.key === 'Enter') {
      // A focused button has the key itself.
      if (document.activeElement?.closest?.('.cz-ui button')) return;
      e.preventDefault();
      if (mode === 'slots') spin();
      else spinWheel();
    } else if (/^[1-5]$/.test(e.key)) hold(BETS[Number(e.key) - 1]);
    else if (e.key === 'Backspace' && mode === 'roulette') {
      e.preventDefault();
      takeOff();
    } else if (e.key === 'Escape') {
      if (tipFor) hideTip();
      else stepBack();
    }
  });

  const tmp = new THREE.Color();
  const camIn = new THREE.Vector3();
  let unlit = 0;
  const { on: ons, off: offs, hot } = look.bulbs;
  const Y = new THREE.Vector3(0, 1, 0), bv = new THREE.Vector3();
  const api = {
    room: r,
    _speed: 1,
    get open() {
      return !ui.hidden;
    },
    /** Whether you're in the casino (and no cutscene is playing): the controls show. */
    show(inside) {
      if (inside && ui.hidden) {
        identify();
        board.refresh();
      }
      if (!inside && mode) {
        finishNow();
        mode = null;
        picking = null;
        table?.aim(null);
        render();
      }
      if (!inside) hideTip();
      ui.hidden = !inside;
      document.body.classList.toggle('in-casino', inside);
      // Seated at a game: the walking controls can step aside (A's HUD).
      document.body.classList.toggle('cz-playing', inside && !!mode);
      if (!inside && dom) dom.style.cursor = '';
    },
    update(dt, env) {
      // Tests can run the games faster than the world (_speed).
      dt *= api._speed;
      t += dt;
      roomView();
      if (!r.room.group.visible) {
        wake = 0;
        unlit = 0;
        return;
      }
      // No windows: the casino is as bright at night as by day (the lamps make up for the sky).
      if (env) for (const m of r.room.lit) m.emissive.copy(m.color).multiply(LAMP).multiplyScalar(look.lit * (1 + env.night * 1.7));
      // A look lights the room itself, whatever the hour outside: no windows, so the sky has no say.
      if (look.light && sky) {
        sky.hemi.color.set(look.light.sky);
        sky.hemi.groundColor.set(look.light.ground);
        sky.hemi.intensity = look.light.intensity;
        sky.light.intensity *= look.light.sun ?? 0;
      }
      // Nor does its light on shiny things: by day the bright sky's reflections washed the room out
      // in a lilac haze. Shut out once the camera is inside, as dark as the night sky leaves it.
      g.worldToLocal(camIn.copy(camera.position));
      const inside = Math.abs(camIn.x) < r.room.w / 2 && Math.abs(camIn.z) < r.room.d / 2 && camIn.y < r.room.h;
      unlit += ((inside ? 1 : 0) - unlit) * Math.min(1, dt * 6);
      if (sky?.scene && unlit > 0.001) sky.scene.environmentIntensity *= 1 - unlit * (1 - (env?.night ?? 0));
      // The room joins in with the games.
      fx.spin += ((spinning || wheel ? 1 : 0) - fx.spin) * Math.min(1, dt * 3);
      fx.win = Math.max(0, fx.win - dt / 2.6);
      fx.jackpot = Math.max(0, fx.jackpot - dt / 5.5);
      look.update?.(t, dt, fx);
      if (!ui.hidden) identify();
      // Walking in, the machines' lights come on one after another, a ripple along each.
      wake = entering() || wake > 0 ? wake + dt : 3;
      // The chips counter runs up to what you have.
      if (state && shownChips !== state.chips) {
        const gap = state.chips - shownChips;
        shownChips = Math.abs(gap) < 1 ? state.chips : shownChips + gap * Math.min(1, dt * 5);
        el.bankN.textContent = fmt(shownChips);
      }
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
          const turns = spinning.kind === 'reroll' ? 2 : spinning.kind === 'nudge' ? 0 : 3 + i;
          let end = target + Math.PI * 2 * turns;
          while (end - from < Math.PI * 2 * turns - 1e-6) end += Math.PI * 2;
          const e = easeOut(k);
          const bounce = k > 0.85 ? Math.sin(((k - 0.85) / 0.15) * Math.PI) * (spinning.kind === 'nudge' ? 0.03 : 0.06) : 0;
          const before = reel.userData.angle;
          reel.userData.angle = k < 1 ? from + (end - from) * e - bounce : target;
          reel.userData.stop = spinning.stops[i];
          reel.rotation.x = reel.userData.angle;
          // Fast, it blurs.
          reel.material = Math.abs(reel.userData.angle - before) / Math.max(dt, 1e-3) > 9 ? c.strip.blurMat : c.strip.mat;
        });
        if (done) {
          for (const reel of machine.reels) reel.material = c.strip.mat;
          land();
        }
      }
      // The wheel: the ball runs and lands, the wheel turns on, then idles round slowly, the ball in
      // its pocket riding with it.
      if (table) {
        if (wheel) {
          wheel.step.step(dt);
          if (wheel.step.landed) settleWheel();
        } else if (coast) {
          if (!coast.step(dt)) coast = null;
        } else {
          const a = dt * 0.22;
          table.rotor.rotation.y += a;
          bv.copy(table.ball.position).sub(table.wheelAt).applyAxisAngle(Y, a);
          table.ball.position.copy(table.wheelAt).add(bv);
        }
        if (backAt > 0 && (backAt -= dt) <= 0) {
          if (mode === 'roulette' && !wheel) goTable('bet');
          sweepAt = 1.4;
        }
        if (sweepAt > 0 && (sweepAt -= dt) <= 0) sweepFelt();
        table.stepAim(dt, t);
      }
      stepChips(dt);
      stepSparks(dt);
      stepGlints(dt);
      if (machine.tray.drops.length) stepCoins(machine.tray, dt);
      // The camera: the jackpot's flight, or at the machine leaning in while the reels spin, and a
      // shake on a big win.
      if (show) {
        show.t += dt;
        show.flight.pose(camera, Math.min(show.t, show.flight.duration));
        if (show.t >= show.flight.duration) endShow();
      } else if (mode === 'slots' && !ui.hidden) {
        push += ((spinning ? 1 : 0) - push) * Math.min(1, dt * (spinning ? 3 : 2));
        if (push > 0.001) camera.position.lerp(machine.reels[1].getWorldPosition(new THREE.Vector3()), push * 0.06);
      }
      if (!show && shake > 0 && mode && !ui.hidden) {
        shake = Math.max(0, shake - dt);
        const a = shake * 0.06;
        camera.position.x += Math.sin(t * 71) * a;
        camera.position.y += Math.sin(t * 53 + 1) * a;
      }
      camera.updateMatrixWorld();
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
      c.machines.forEach((m, j) => {
        const mine = m === machine;
        const every = show !== null;
        for (let i = 0; i < m.spots.length; i++) {
          let lit;
          if (wake < 3) lit = wake > 0.6 + j * 0.45 + (i / m.spots.length) * 0.5 && (i + Math.floor(wake * 10)) % 2 === 0;
          else if ((mine || every) && flash > 0) lit = Math.floor(t * 8 + (every ? j : 0)) % 2 === 0;
          else if (mine && spinning) lit = (i + Math.floor(t * 14)) % 3 === 0;
          else lit = (i + Math.floor(t * 3 + (mine ? 0 : 5))) % 4 === 0;
          tmp.copy(lit ? (flash > 0 && (mine || every) ? hot : ons[i % ons.length]) : offs[i % offs.length]).multiplyScalar(lit ? 1.6 : 1);
          m.bulbs.setColorAt(i, tmp);
        }
        m.bulbs.instanceColor.needsUpdate = true;
      });
    },
    // For tests and the demo's shots: a spin that lands on the given stops (indexes into the strip);
    // a roulette spin of these bets ({ key: amount }) that lands on n.
    _spin(stops, kind = 'spin', only = -1) {
      identify();
      if (mode !== 'slots') mode = 'slots';
      if (kind === 'reroll' || kind === 'nudge') offer = true;
      spin(kind, only);
      if (spinning && stops) {
        spinning.stops = stops;
        state.pending.stops = stops;
        save();
      }
    },
    _roulette(n, placed = { red: 10 }) {
      identify();
      mode = 'roulette';
      clearFelt();
      bets.clear();
      for (const [key, amount] of Object.entries(placed)) bets.set(key, amount);
      spinWheel('spin', n);
    },
    play: (game = 'slots') => {
      identify();
      goPlay(game);
    },
    // How much the room asks the bloom for (its neon), while you're in it.
    get glow() {
      return r.room.group.visible ? look.glow : 0;
    },
    get state() {
      return { who: who?.name, chips: state?.chips, charges: state && { ...state.charges }, bet, chip, mode, message, line: lastLine, spinning: !!spinning, wheel: !!wheel, offer, picking, bets: Object.fromEntries(bets), lastN, perks: who?.perks };
    },
  };
  return api;
}
