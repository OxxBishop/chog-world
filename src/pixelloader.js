/*
 * The loading screen's Chog (the user's design, from their sprite sheet): a pixel Chog hopping round a
 * ring of square dots, the dots lighting up behind it and fading, sparkles in its wake. Everything is
 * drawn on one pixel grid (ART art pixels square, k device pixels to each), so it stays crisp at any
 * size; the Chog moves an art pixel at a time, smoothly, never rotated or scaled.
 *
 * createLoaderArt(canvas, k) works on a canvas or an OffscreenCanvas (src/pixelloader.worker.js draws
 * it off the main thread, so it keeps going while the world loads); draw(t) paints the frame at t
 * seconds.
 */

export const ART = 52;
// The ring: twelve dots round the middle, and the time one lap takes.
const R = 15;
const DOTS = 12;
const DOT = 3;
const LAP = 1.7;

// The Chog, facing right: its outline, lilac rim, mane, face, eyes, blush and mouth.
export const SPRITE = `
..........o.........
.........oLo........
..o......ollo..o....
.oLo....oLnnlooLo...
.ollo..oLnmmnlollo..
.olnlooLnmmmmnlnlo..
.oolnllnmmmmmmnmdlo.
oLlnmnnmmmmmmmmmmlo.
.olnmmmmmmmmmmmmmdlo
.olnmmmmmmmffffmmdlo
.olnmmmmmmffffffmdlo
oLnmmmmmmffffffffdlo
.olnmmmmmffeffeffdlo
.olnmdmmmffeffeffdlo
..olnldddpffkkffpdlo
...olollllllllllllo.
....o.oooooooooooo..`;
export const PAL = {
  o: '#120a2e', l: '#c3adff', L: '#f1eaff', m: '#3d2596', n: '#5b3fcc', d: '#29176c',
  f: '#fde9d6', e: '#1b1240', p: '#f7a1b6', k: '#ee93a8',
};
// A dot by how lately the Chog went by it: just now, a moment ago, a while ago, not lately.
const DOT_COLS = [
  { fill: '#f6f1ff', edge: '#c9b6ff' },
  { fill: '#c3adff', edge: '#9a7cf2' },
  { fill: '#7a5ae0', edge: '#5b3fcc' },
  { fill: '#33208a', edge: '#28186e' },
];
// A sparkle's frames as it twinkles: a dot, a small cross, a big one, the small one, the dot.
const TWINKLE = [0, 1, 2, 2, 1, 0];

export function createLoaderArt(canvas, k = 2, { calm = false } = {}) {
  canvas.width = canvas.height = ART * k;
  const ctx = canvas.getContext('2d');
  const rows = SPRITE.trim().split('\n');
  const SW = rows[0].length, SH = rows.length;
  // The Chog drawn once at k, to stamp each frame.
  const make = (w, h) => (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h }));
  const chog = make(SW * k, SH * k);
  const cc = chog.getContext('2d');
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '.') return;
    cc.fillStyle = PAL[ch];
    cc.fillRect(x * k, y * k, k, k);
  }));
  const px = (x, y, w, h, col) => {
    ctx.fillStyle = col;
    ctx.fillRect(x * k, y * k, w * k, h * k);
  };
  const C = ART / 2;
  const dots = Array.from({ length: DOTS }, (_, i) => {
    const a = (i / DOTS) * Math.PI * 2 - Math.PI / 2;
    return { a, x: Math.round(C + Math.cos(a) * R - DOT / 2), y: Math.round(C + Math.sin(a) * R - DOT / 2) };
  });
  // Sparkles come off its back as it goes: each where the Chog was, a little out from it.
  const sparks = [];
  let lastSpark = 0;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const lap = calm ? LAP * 2 : LAP;

  function draw(t) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Clockwise from the top.
    const a = ((t / lap) % 1) * Math.PI * 2 - Math.PI / 2;
    for (const d of dots) {
      // How far behind the Chog this dot is (0 just passed, up to a lap).
      const behind = (((a - d.a) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      // (It covers the ones it is on, so the trail starts at its back.)
      const c = DOT_COLS[behind < 1.2 ? 0 : behind < 1.9 ? 1 : behind < 2.7 ? 2 : 3];
      px(d.x, d.y, DOT, DOT, c.edge);
      px(d.x + 1, d.y + 1, DOT - 2, DOT - 2, c.fill);
      if (c === DOT_COLS[0]) {
        // The freshest one has a soft lit corner.
        px(d.x, d.y, 1, 1, c.fill);
      }
    }
    // Its hop: up a pixel for half of every step.
    const hop = calm ? 0 : (t * 5.2) % 1 < 0.5 ? 1 : 0;
    const cx = C + Math.cos(a) * R, cy = C + Math.sin(a) * R;
    if (t - lastSpark > (calm ? 0.5 : 0.2)) {
      lastSpark = t;
      const out = 3 + rnd() * 5, side = rnd() * 2 - 1;
      // Behind it along the ring, and off to one side of it.
      const back = a - 0.5 - rnd() * 0.5;
      sparks.push({ x: Math.round(C + Math.cos(back) * (R + side * out)), y: Math.round(C + Math.sin(back) * (R + side * out)), t0: t, life: 0.5 + rnd() * 0.3 });
    }
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      const f = (t - s.t0) / s.life;
      if (f >= 1 || f < 0) {
        sparks.splice(i, 1);
        continue;
      }
      const size = TWINKLE[Math.min(TWINKLE.length - 1, Math.floor(f * TWINKLE.length))];
      px(s.x, s.y, 1, 1, '#ffffff');
      if (size >= 1) {
        const arm = size === 2 ? '#c9b6ff' : '#e8deff';
        px(s.x - 1, s.y, 1, 1, arm);
        px(s.x + 1, s.y, 1, 1, arm);
        px(s.x, s.y - 1, 1, 1, arm);
        px(s.x, s.y + 1, 1, 1, arm);
      }
      if (size >= 2) {
        px(s.x - 2, s.y, 1, 1, '#8f72f0');
        px(s.x + 2, s.y, 1, 1, '#8f72f0');
        px(s.x, s.y - 2, 1, 1, '#8f72f0');
        px(s.x, s.y + 2, 1, 1, '#8f72f0');
      }
    }
    ctx.drawImage(chog, Math.round(cx - SW / 2) * k, (Math.round(cy - SH / 2) - hop) * k);
  }
  return { draw };
}
