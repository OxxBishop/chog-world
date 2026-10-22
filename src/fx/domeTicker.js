import * as THREE from 'three';
import { SPRITE, PAL } from '../pixelloader.js';

/*
 * The Monad ticker round the Hub's dome (A, 10-21; the user's pick of three billboard concepts: "i like
 * dome ticker", then "you can randomize it. from pixel chogs to monad etc"). An LED screen where the gold
 * dome meets the walls: a grid of round lamps, the picture stepping along it a lamp at a time, right to
 * left. The ring is a few panels long; whenever a panel goes round the back of the dome, out of your
 * sight, it comes round again with something new on it: the Monad mark, the loading screen's pixel Chogs
 * hopping, gmonad, a welcome, a Chog saying gm...
 *
 * Everything on it is drawn at one canvas pixel to a lamp (PANEL x ROWS a panel, up to FRAMES frames for
 * the ones that move), so it is as crisp as the loading screen. From afar the lamps blend into a clean
 * picture rather than shimmering.
 *
 * domeTicker(pod, space) -> { group, update(t, night) }: pod is the lobby's kit piece after repaint (its
 * dome faces are the children flagged userData.roof); space is the group the band goes into.
 */
const BAND = 3.0; // metres tall
const ROWS = 32; // lamps tall
const PANEL = 192; // lamps across one panel
const FRAMES = 4;
const STEP = 14; // lamps a second

const WHITE = '#ffffff', LILAC = '#c9b6ff', PURPLE = '#9b85ff', GOLD = '#ffd27a', PINK = '#ff9fc0';

// The pixel Chog, as rows of palette letters (the loading screen's own sprite).
const CHOG = SPRITE.trim().split('\n');

// Panels: each draws frame f (of n) into a PANEL x ROWS canvas, lamps on where it paints.
const text = (g, s, x, y, size, col, align = 'center') => {
  g.font = `${size}px 'Press Start 2P'`;
  g.textAlign = align;
  g.textBaseline = 'top';
  g.fillStyle = col;
  g.fillText(s, x, y);
};
const chog = (g, x, y, flip = false) => {
  CHOG.forEach((row, j) => [...row].forEach((ch, i) => {
    if (ch === '.') return;
    g.fillStyle = PAL[ch] === '#120a2e' ? '#4a3a8a' : PAL[ch]; // its dark outline lit dimly, not off
    g.fillRect(flip ? x + row.length - 1 - i : x + i, y + j, 1, 1);
  }));
};
// The Monad symbol in lamps: a rounded diamond ring.
const mark = (g, cx, cy, r, col) => {
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
    // A diamond with its corners rounded: the L1 distance softened toward L2 near the tips.
    const d = (Math.abs(x) + Math.abs(y)) * 0.8 + Math.hypot(x, y) * 0.2;
    if (d <= r * 0.92 && d >= r * 0.5) {
      g.fillStyle = col;
      g.fillRect(cx + x, cy + y, 1, 1);
    }
  }
};
const sparkle = (g, x, y, k, col = WHITE) => {
  g.fillStyle = col;
  g.fillRect(x, y, 1, 1);
  if (k > 0) g.fillRect(x - 1, y, 3, 1), g.fillRect(x, y - 1, 1, 3);
  if (k > 1) g.fillRect(x - 2, y, 5, 1), g.fillRect(x, y - 2, 1, 5);
};
export const PANELS = {
  monad: { n: 4, draw(g, f) {
    mark(g, 26, 16, 12, f === 2 ? WHITE : PURPLE);
    if (f === 1 || f === 2) sparkle(g, 33, 6, f);
    text(g, 'MONAD', 46, 4, 24, WHITE, 'left');
  } },
  chogs: { n: 2, draw(g, f) {
    // Three Chogs hopping the way the picture goes, out of step with each other.
    for (let k = 0; k < 3; k++) chog(g, 22 + k * 58, 10 - ((f + k) % 2) * 3, true);
    for (let k = 0; k < 3; k++) sparkle(g, 48 + k * 58, 8 + ((f + k) % 2) * 6, (f + k) % 2, LILAC);
  } },
  gmonad: { n: 2, draw(g, f) {
    text(g, 'gmonad', 104, 6, 24, WHITE);
    // A little pixel sun, its rays on and off.
    g.fillStyle = GOLD;
    g.fillRect(12, 12, 8, 8), g.fillRect(14, 10, 4, 12), g.fillRect(10, 14, 12, 4);
    if (f) for (const [x, y] of [[15, 5], [15, 25], [5, 15], [25, 15], [8, 8], [22, 8], [8, 22], [22, 22]]) g.fillRect(x, y, 2, 2);
  } },
  welcome: { n: 2, draw(g, f) {
    text(g, 'WELCOME TO', 96, 3, 8, LILAC);
    text(g, 'CHOG WORLD', 96, 14, 16, f ? WHITE : '#efe8ff');
    if (f) sparkle(g, 6, 16, 2, LILAC), sparkle(g, 185, 16, 2, LILAC);
    else sparkle(g, 6, 16, 0, LILAC), sparkle(g, 185, 16, 0, LILAC);
  } },
  built: { n: 2, draw(g, f) {
    mark(g, 166, 16, 12, PURPLE);
    if (f) sparkle(g, 173, 6, 2);
    text(g, 'BUILT ON', 78, 4, 8, LILAC);
    text(g, 'MONAD', 78, 14, 16, WHITE);
  } },
  gm: { n: 2, draw(g, f) {
    chog(g, 30, 14, true);
    // A speech bubble, its word blinking in.
    g.fillStyle = WHITE;
    g.fillRect(56, 2, 52, 18), g.fillRect(54, 4, 56, 14), g.fillRect(52, 18, 6, 2), g.fillRect(50, 20, 4, 2);
    g.fillStyle = '#24165a';
    if (f) g.font = "16px 'Press Start 2P'", g.textAlign = 'center', g.textBaseline = 'top', g.fillText('gm!', 82, 3);
    text(g, 'SAY HI', 152, 12, 8, LILAC);
  } },
  casino: { n: 4, draw(g, f) {
    // A die tumbling through its faces, and the casino's gold.
    const pips = [[[3, 3]], [[1, 1], [5, 5]], [[1, 1], [3, 3], [5, 5]], [[1, 1], [5, 1], [1, 5], [5, 5]]][f];
    g.fillStyle = WHITE;
    g.fillRect(14, 6, 21, 21);
    g.fillStyle = '#c4334a';
    for (const [x, y] of pips) g.fillRect(14 + x * 3, 6 + y * 3, 3, 3);
    text(g, 'CASINO', 112, 4, 16, GOLD);
    text(g, 'TESTNET CHIPS', 112, 22, 8, PINK);
  } },
  // Two Chogs from the collection, their art in lamps, each with its number (art for 1 to 1969 ships).
  portraits: {
    n: 2,
    load() {
      const ids = Array.from({ length: 2 }, () => 1 + Math.floor(Math.random() * 1969));
      return Promise.all(ids.map((id) => new Promise((ok) => {
        const img = new Image();
        img.onload = () => ok({ id, img });
        img.onerror = () => ok({ id, img: null });
        img.src = `${import.meta.env?.BASE_URL ?? '/'}art/${id}.webp`;
      })));
    },
    draw(g, f, chogs) {
      chogs.forEach(({ id, img }, k) => {
        const x = 12 + k * 96;
        if (img) {
          g.imageSmoothingEnabled = true;
          g.imageSmoothingQuality = 'high';
          g.drawImage(img, x, 2, 28, 28);
          g.imageSmoothingEnabled = false;
        }
        // Each in turn gets a lit frame.
        if (f === k % 2) {
          g.fillStyle = LILAC;
          g.fillRect(x - 1, 1, 30, 1), g.fillRect(x - 1, 30, 30, 1), g.fillRect(x - 1, 1, 1, 30), g.fillRect(x + 28, 1, 1, 30);
        }
        text(g, 'CHOG', x + 32, 7, 8, LILAC, 'left');
        text(g, `#${id}`, x + 32, 18, 8, WHITE, 'left');
      });
    },
  },
  hearts: { n: 4, draw(g, f) {
    // A wave of hearts in Monad's colours.
    const heart = ['.xx.xx.', 'xxxxxxx', 'xxxxxxx', '.xxxxx.', '..xxx..', '...x...'];
    for (let k = 0; k < 8; k++) {
      const y = 12 + Math.round(Math.sin((k + f) * (Math.PI / 2)) * 6);
      g.fillStyle = [PURPLE, PINK, LILAC, WHITE][(k + f) % 4];
      heart.forEach((row, j) => [...row].forEach((c, i) => c === 'x' && g.fillRect(8 + k * 23 + i, y + j, 1, 1)));
    }
  } },
};
const KINDS = Object.keys(PANELS);

export function domeTicker(pod, space) {
  space.updateMatrixWorld(true);
  pod.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(space.matrixWorld).invert();
  const v = new THREE.Vector3();
  const roof = [], walls = [];
  pod.traverse((o) => {
    if (!o.isMesh) return;
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    const pos = o.geometry.attributes.position;
    const out = o.userData.roof ? roof : walls;
    for (let i = 0; i < pos.count; i++) out.push(v.fromBufferAttribute(pos, i).applyMatrix4(m).clone());
  });
  // The dome's foot, and its centre.
  const foot = Math.min(...roof.map((p) => p.y));
  const box = new THREE.Box3().setFromPoints(roof);
  const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
  // Clear of everything (dome and walls) in the band's height, by a few centimetres.
  const y0 = foot - BAND * 0.6, y1 = foot + BAND * 0.4;
  let r = 0;
  for (const p of [...roof, ...walls]) if (p.y > y0 - 0.05 && p.y < y1 + 0.05) r = Math.max(r, Math.hypot(p.x - cx, p.z - cz));
  r += 0.12;
  // Whole panels round the ring, the lamps square.
  const N = Math.max(3, Math.round((2 * Math.PI * r) / ((BAND * PANEL) / ROWS)));
  const COLS = N * PANEL;

  // Every panel has its own FRAMES rows in one small texture, drawn again when it changes.
  const atlas = document.createElement('canvas');
  atlas.width = PANEL;
  atlas.height = ROWS * FRAMES * N;
  const ag = atlas.getContext('2d');
  const scratch = document.createElement('canvas');
  scratch.width = PANEL;
  scratch.height = ROWS;
  const sg = scratch.getContext('2d', { willReadFrequently: true });
  sg.imageSmoothingEnabled = false;
  const map = new THREE.CanvasTexture(atlas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.magFilter = THREE.NearestFilter;
  const frames = new Int32Array(N).fill(1);
  const kinds = new Array(N).fill(null);
  const paint = (slot, kind) => {
    const p = PANELS[kind];
    kinds[slot] = kind;
    // A panel that needs something loaded first (the collection's art) is drawn once it is in.
    if (p.load) p.load().then((data) => kinds[slot] === kind && draw(slot, p, data));
    else draw(slot, p);
  };
  const draw = (slot, p, data) => {
    frames[slot] = p.n;
    for (let f = 0; f < FRAMES; f++) {
      sg.clearRect(0, 0, PANEL, ROWS);
      p.draw(sg, f % p.n, data);
      // A lamp is on or off: snap the text's soft edges.
      const img = sg.getImageData(0, 0, PANEL, ROWS);
      for (let i = 3; i < img.data.length; i += 4) img.data[i] = img.data[i] > 110 ? 255 : 0;
      ag.clearRect(0, (slot * FRAMES + f) * ROWS, PANEL, ROWS);
      ag.putImageData(img, 0, (slot * FRAMES + f) * ROWS);
    }
    map.needsUpdate = true;
  };
  // Something new for a panel, not what its neighbours show.
  const reroll = (slot) => {
    const near = [kinds[(slot + 1) % N], kinds[(slot + N - 1) % N], kinds[slot]];
    const pick = KINDS.filter((k) => !near.includes(k));
    paint(slot, pick[Math.floor(Math.random() * pick.length)]);
  };
  // The first round: the Monad mark on the front, then a mix.
  const start = () => {
    kinds.fill(null);
    paint(0, 'monad');
    for (let s = 1; s < N; s++) reroll(s);
  };
  start();
  // Redrawn once the pixel font is in (the first draw may be in the fallback).
  document.fonts?.load("16px 'Press Start 2P'").then(start);

  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    map: { value: null },
    uScroll: { value: 0 },
    uFrame: { value: 0 },
    uGain: { value: 1 },
  }]);
  uniforms.map.value = map;
  uniforms.uFrames = { value: frames };
  const screen = new THREE.ShaderMaterial({
    uniforms,
    fog: true,
    defines: { N, COLS: `${COLS}.0`, PANEL: `${PANEL}.0`, ROWS: `${ROWS}.0`, FRAMES: `${FRAMES}.0` },
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform sampler2D map;
      uniform float uScroll;
      uniform float uFrame;
      uniform float uGain;
      uniform int uFrames[N];
      varying vec2 vUv;
      void main() {
        // Lamps: fixed to the band. The picture steps along them a whole lamp at a time.
        vec2 L = vec2(vUv.x * COLS, vUv.y * ROWS);
        vec2 cell = floor(L);
        float c = mod(cell.x + uScroll, COLS);
        float slot = floor(c / PANEL);
        int frames = 1;
        for (int i = 0; i < N; i++) if (float(i) == slot) frames = uFrames[i];
        float f = mod(uFrame, float(frames));
        float row = (slot * FRAMES + f) * ROWS + (ROWS - 1.0 - cell.y);
        vec2 at = vec2((mod(c, PANEL) + 0.5) / PANEL, 1.0 - (row + 0.5) / (ROWS * FRAMES * float(N)));
        // Mip level from the smooth lamp grid, not the stepped one (no seams, no shimmer from afar).
        vec2 g = L / vec2(PANEL, ROWS * FRAMES * float(N));
        vec4 lit = textureGrad(map, at, dFdx(g), dFdy(g));
        // The lamp: a round dot. As lamps shrink under a pixel the dots melt into a solid picture.
        float px = max(fwidth(L.x), fwidth(L.y));
        float dotMask = 1.0 - smoothstep(0.30, 0.30 + max(0.08, px), length(fract(L) - 0.5));
        dotMask = mix(dotMask, 0.75, smoothstep(0.35, 0.9, px));
        vec3 off = vec3(0.035, 0.022, 0.08); // an unlit lamp
        vec3 back = vec3(0.012, 0.008, 0.03); // between lamps
        vec3 on = lit.rgb * lit.a * uGain;
        vec3 col = mix(back, off + on, dotMask);
        // A faint sheen across the face, top to bottom.
        col += vec3(0.02, 0.015, 0.05) * smoothstep(0.6, 1.0, vUv.y);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const band = new THREE.Mesh(new THREE.CylinderGeometry(r, r, BAND, 160, 1, true), screen);
  // The rims: lilac neon tubes on the top and bottom edges.
  const neon = new THREE.MeshBasicMaterial({ color: new THREE.Color('#b9a6ff'), toneMapped: false });
  const rimGeo = new THREE.TorusGeometry(r + 0.03, 0.08, 6, 160).rotateX(Math.PI / 2);
  const top = new THREE.Mesh(rimGeo, neon);
  const bottom = new THREE.Mesh(rimGeo, neon);
  top.position.y = BAND / 2;
  bottom.position.y = -BAND / 2;
  const group = new THREE.Group();
  group.position.set(cx, (y0 + y1) / 2, cz);
  group.add(band, top, bottom);
  group.traverse((o) => o.isMesh && (o.userData.keep = true));

  // A panel is changed once it has been seen and then gone wholly round the back, out of the camera's
  // view (the camera's bearing from the dome's centre more than 90 degrees plus half a panel away).
  const seen = new Array(N).fill(true);
  const cam = new THREE.Vector3();
  let scroll = 0;
  band.onBeforeRender = (renderer, scene, camera) => {
    band.worldToLocal(cam.copy(camera.position));
    const facing = Math.atan2(cam.x, cam.z);
    const half = Math.PI / N;
    for (let s = 0; s < N; s++) {
      // The panel's middle on the band: its lamps are where the picture's column, less the scroll, is.
      const col = (((s + 0.5) * PANEL - scroll) % COLS + COLS) % COLS;
      const a = (col / COLS) * Math.PI * 2;
      const off = Math.abs(((a - facing + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (off < Math.PI / 2 + half) seen[s] = true;
      else if (seen[s] && off > Math.PI / 2 + half + 0.15) {
        seen[s] = false;
        reroll(s);
      }
    }
  };

  const day = new THREE.Color('#b9a6ff'), night = new THREE.Color('#bfa8ff');
  return {
    group,
    update(t, n) {
      scroll = Math.floor(t * STEP) % COLS;
      uniforms.uScroll.value = scroll;
      uniforms.uFrame.value = Math.floor(t * 3);
      // Lamps hold their own by day and glow (into the bloom) at night.
      uniforms.uGain.value = 1.15 + n * 0.6;
      neon.color.copy(day).lerp(night, n).multiplyScalar(1 + n * 0.35);
    },
  };
}
