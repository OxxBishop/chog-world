import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { REDS } from './casinoperks.js';

/*
 * The roulette (B23): a European single-zero wheel on a table, with the betting layout on its felt.
 * buildRoulette() is the table; spinBall() runs the wheel and the ball for one spin, landing on the
 * number the game drew; settleSpin() pays a spin's bets with the Chog's edges (src/casinoperks.js).
 *
 * The ball runs round the track against the wheel, slows, drops onto the pockets' frets, bounces
 * over a few and comes to rest in the drawn pocket; the wheel spins on. About 6 s.
 */

// The wheel's numbers clockwise from zero, as on a European wheel.
export const ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const SLOT = (Math.PI * 2) / ORDER.length;
export const colourOf = (n) => (n === 0 ? 'green' : REDS.has(n) ? 'red' : 'black');
export const neighboursOf = (n) => {
  const i = ORDER.indexOf(n);
  return [ORDER[(i + ORDER.length - 1) % ORDER.length], ORDER[(i + 1) % ORDER.length]];
};

// The bets the panel offers, and what each covers.
export const BETS = {
  red: { label: 'Red', covers: (n) => n !== 0 && REDS.has(n), pays: 1, outside: true },
  black: { label: 'Black', covers: (n) => n !== 0 && !REDS.has(n), pays: 1, outside: true },
  odd: { label: 'Odd', covers: (n) => n % 2 === 1, pays: 1, outside: true },
  even: { label: 'Even', covers: (n) => n !== 0 && n % 2 === 0, pays: 1, outside: true },
  low: { label: '1 to 18', covers: (n) => n >= 1 && n <= 18, pays: 1, outside: true },
  high: { label: '19 to 36', covers: (n) => n >= 19, pays: 1, outside: true },
  d1: { label: '1st 12', covers: (n) => n >= 1 && n <= 12, pays: 2, dozen: 1, outside: true },
  d2: { label: '2nd 12', covers: (n) => n >= 13 && n <= 24, pays: 2, dozen: 2, outside: true },
  d3: { label: '3rd 12', covers: (n) => n >= 25, pays: 2, dozen: 3, outside: true },
  number: { label: 'Number', covers: (n, pick) => n === pick, pays: 35 },
};

export const keyOf = (type, pick) => (type === 'number' ? `n${pick}` : type);
export const betOf = (key) => (key[0] === 'n' && /^n\d+$/.test(key) ? { type: 'number', pick: Number(key.slice(1)) } : { type: key, pick: null });
const EVEN_MONEY = new Set(['red', 'black', 'odd', 'even', 'low', 'high']);

/**
 * One spin's bets settled on n, with a Chog's roulette edges (perks.roulette) and the day's power-ups
 * left (charges, used up here as they pay). bets: [{ key, amount }].
 * { results: [{ key, amount, back, why }], staked, back, lost, saved: [why] }: back counts every
 * stake that came home, lost the stakes that didn't.
 */
export function settleSpin(bets, n, perks, charges) {
  const r = perks.roulette;
  const results = [];
  for (const { key, amount } of bets) {
    const { type, pick } = betOf(key);
    const b = BETS[type];
    let back = 0, why = '';
    if (b.covers(n, pick)) {
      let pays = b.pays;
      if (type === 'number' && pick === r.lucky && charges.luckyBig > 0) {
        charges.luckyBig--;
        pays = 50;
        why = 'lucky number';
      } else if (type === 'number' && charges.anyBig > 0) {
        charges.anyBig--;
        pays = 50;
        why = 'first straight win';
      }
      back = amount * (1 + pays);
    } else if (type === 'number' && charges.near > 0 && neighboursOf(pick).includes(n)) {
      charges.near--;
      back = amount;
      why = 'near miss';
    } else if (n === 0 && r.shield && (r.shield === 'all' || b.outside)) {
      back = Math.floor(amount / 2);
      why = 'shield';
    } else if ((type === 'red' || type === 'black') && charges[type] > 0) {
      charges[type]--;
      back = amount;
      why = type;
    } else if (EVEN_MONEY.has(type) && charges.even > 0) {
      charges.even--;
      back = amount;
      why = 'even money';
    } else if (b.dozen && charges.dozen > 0) {
      charges.dozen--;
      back = amount;
      why = 'dozen';
    }
    results.push({ key, amount, back, why });
  }
  // The lucky number coming up saves every bet that lost, once a day.
  if (n === r.lucky && charges.luckySave > 0 && results.some((x) => x.back < x.amount && !x.why)) {
    charges.luckySave--;
    for (const x of results) if (x.back === 0) {
      x.back = x.amount;
      x.why = 'lucky save';
    }
  }
  const staked = results.reduce((a, x) => a + x.amount, 0);
  const back = results.reduce((a, x) => a + x.back, 0);
  const lost = results.reduce((a, x) => a + (x.back === 0 ? x.amount : 0), 0);
  return { results, staked, back, lost, saved: [...new Set(results.map((x) => x.why).filter(Boolean))] };
}

// The pocket ring, as seen from above: 37 coloured sectors with their numbers, frets between.
function pocketTex() {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const g = c.getContext('2d');
  const C = 512;
  g.fillStyle = '#2a1a10';
  g.fillRect(0, 0, 1024, 1024);
  ORDER.forEach((n, i) => {
    // Sector i spans [i, i + 1] slots, counterclockwise from +x seen from above (canvas y runs down).
    const a0 = -(i * SLOT), a1 = -((i + 1) * SLOT);
    g.beginPath();
    g.moveTo(C, C);
    g.arc(C, C, 500, a1, a0);
    g.closePath();
    g.fillStyle = n === 0 ? '#1f8a4c' : REDS.has(n) ? '#c62f3a' : '#16181f';
    g.fill();
    g.save();
    g.translate(C, C);
    g.rotate(-(i + 0.5) * SLOT);
    g.fillStyle = '#fff6e4';
    g.font = '600 54px Fredoka, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.translate(430, 0);
    g.rotate(Math.PI / 2);
    g.fillText(String(n), 0, 0);
    g.restore();
  });
  // The frets: brass lines between pockets, and the pocket floor ring inside the numbers.
  g.strokeStyle = '#e8c06a';
  g.lineWidth = 6;
  for (let i = 0; i < ORDER.length; i++) {
    const a = -(i * SLOT);
    g.beginPath();
    g.moveTo(C + Math.cos(a) * 250, C + Math.sin(a) * 250);
    g.lineTo(C + Math.cos(a) * 380, C + Math.sin(a) * 380);
    g.stroke();
  }
  g.beginPath();
  g.arc(C, C, 380, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.arc(C, C, 250, 0, Math.PI * 2);
  g.stroke();
  // The cone in the middle.
  const cone = g.createRadialGradient(C, C, 10, C, C, 250);
  cone.addColorStop(0, '#f6e7c4');
  cone.addColorStop(1, '#8a5a2e');
  g.fillStyle = cone;
  g.beginPath();
  g.arc(C, C, 248, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (document.fonts) document.fonts.load('600 54px Fredoka').then(() => {
    // Numbers redrawn once the font is in.
    ORDER.forEach((n, i) => {
      g.save();
      g.translate(C, C);
      g.rotate(-(i + 0.5) * SLOT);
      g.translate(430, 0);
      g.rotate(Math.PI / 2);
      g.fillStyle = n === 0 ? '#1f8a4c' : REDS.has(n) ? '#c62f3a' : '#16181f';
      g.fillRect(-34, -30, 68, 60);
      g.fillStyle = '#fff6e4';
      g.font = '600 54px Fredoka, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(n), 0, 0);
      g.restore();
    });
    t.needsUpdate = true;
  }).catch(() => {});
  return t;
}

// The layout on the felt: zero, the 3 x 12 grid of numbers, the dozens and the even-money bets.
// on: { bets: Set of keys with chips on them, hit: the winning number's key, wins: keys that won,
// lucky: the Chog's lucky number }.
const LAYOUT = { w: 1024, h: 420, x0: 70, cell: 74, rowH: 90, top: 20 };
const Y1 = LAYOUT.top + LAYOUT.rowH * 3, Y2 = Y1 + 54;
// Every spot on the layout: its key and its box in canvas pixels.
const SPOTS = (() => {
  const { x0, cell, rowH, top } = LAYOUT;
  const out = [{ key: 'n0', x: x0 - 60, y: top, w: 60, h: rowH * 3 }];
  for (let col = 0; col < 12; col++) {
    for (let row = 0; row < 3; row++) out.push({ key: `n${col * 3 + (3 - row)}`, x: x0 + col * cell, y: top + row * rowH, w: cell, h: rowH });
  }
  ['d1', 'd2', 'd3'].forEach((k, i) => out.push({ key: k, x: x0 + i * cell * 4, y: Y1, w: cell * 4, h: 54 }));
  ['low', 'even', 'red', 'black', 'odd', 'high'].forEach((k, i) => out.push({ key: k, x: x0 + i * cell * 2, y: Y2, w: cell * 2, h: 54 }));
  return out;
})();
const fillOf = (key) => {
  if (key === 'n0') return '#1f8a4c';
  if (key === 'red') return '#c62f3a';
  if (key === 'black') return '#16181f';
  if (key[0] === 'n' && /^n\d+$/.test(key)) return REDS.has(Number(key.slice(1))) ? '#c62f3a' : '#16181f';
  return 'rgba(0,0,0,0.12)';
};
const labelOf = (key) => (/^n\d+$/.test(key) ? key.slice(1) : BETS[key].label);
function drawLayout(g, on = {}) {
  const { w, h } = LAYOUT;
  g.clearRect(0, 0, w, h);
  g.lineWidth = 3;
  g.font = '600 34px Fredoka, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const { key, x, y, w: bw, h: bh } of SPOTS) {
    const hit = on.hit === key, won = on.wins?.has(key), bet = on.bets?.has(key);
    g.fillStyle = fillOf(key);
    g.fillRect(x, y, bw, bh);
    if (hit || won || bet) {
      g.fillStyle = hit ? 'rgba(255, 233, 160, 0.9)' : won ? 'rgba(255, 214, 110, 0.55)' : 'rgba(127, 240, 201, 0.32)';
      g.fillRect(x, y, bw, bh);
    }
    g.strokeStyle = '#f3e3b8';
    g.strokeRect(x, y, bw, bh);
    g.fillStyle = hit ? '#1a1206' : '#fff6e4';
    g.fillText(labelOf(key), x + bw / 2, y + bh / 2 + 2);
    // Your lucky number wears a gold ring.
    if (on.lucky !== undefined && key === `n${on.lucky}`) {
      g.strokeStyle = '#ffd166';
      g.lineWidth = 5;
      g.beginPath();
      g.arc(x + bw / 2, y + bh / 2 + 1, Math.min(bw, bh) * 0.36, 0, Math.PI * 2);
      g.stroke();
      g.lineWidth = 3;
    }
  }
}

/**
 * The roulette table, in the casino room's space at (x, z), turned by rot. style: { felt, wood, rail,
 * base, chrome, dolly }. Returns the table and what the game moves on it (below).
 */
export function buildRoulette(room, x, z, rot, style) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = rot;
  room.group.add(g);
  const mats = {
    base: new THREE.MeshStandardMaterial({ color: style.base, roughness: 0.4, metalness: 0.1 }),
    felt: new THREE.MeshStandardMaterial({ color: style.felt, roughness: 0.9 }),
    rail: style.rail,
    wood: new THREE.MeshStandardMaterial({ color: style.wood, roughness: 0.35, metalness: 0.05 }),
    track: new THREE.MeshStandardMaterial({ color: '#efe2c8', roughness: 0.3 }),
    chrome: style.chrome ?? new THREE.MeshStandardMaterial({ color: '#eef2f6', roughness: 0.22, metalness: 0.9 }),
    ball: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.12, metalness: 0.1, emissive: '#ffffff', emissiveIntensity: 0.25 }),
  };
  const W = 3.6, D = 1.7, H = 1.0;
  // The table: a coral base on chrome feet, felt on top, a padded rail round it.
  g.add(new THREE.Mesh(new RoundedBoxGeometry(W - 0.5, H - 0.12, D - 0.5, 3, 0.12).translate(0, (H - 0.12) / 2, 0), mats.base));
  g.add(new THREE.Mesh(new RoundedBoxGeometry(W, 0.1, D, 3, 0.05).translate(0, H - 0.05, 0), mats.felt));
  for (const sz of [-1, 1]) g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, W, 10).rotateZ(Math.PI / 2).translate(0, H + 0.02, sz * (D / 2)), mats.rail));
  for (const sx of [-1, 1]) g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, D, 10).rotateX(Math.PI / 2).translate(sx * (W / 2), H + 0.02, 0), mats.rail));
  // The layout on the felt's right part.
  const layoutCanvas = document.createElement('canvas');
  // Drawn at twice the layout's own units, so the numbers stay crisp close up on a phone's screen.
  layoutCanvas.width = LAYOUT.w * 2;
  layoutCanvas.height = LAYOUT.h * 2;
  const lg = layoutCanvas.getContext('2d');
  lg.setTransform(2, 0, 0, 2, 0, 0);
  drawLayout(lg);
  const layoutTex = new THREE.CanvasTexture(layoutCanvas);
  layoutTex.colorSpace = THREE.SRGBColorSpace;
  layoutTex.anisotropy = 8;
  const layout = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 2.0 * (LAYOUT.h / LAYOUT.w)).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: layoutTex, transparent: true, color: new THREE.Color(0.92, 0.92, 0.92) }));
  layout.position.set(0.62, H + 0.003, 0.02);
  layout.userData.keep = true;
  g.add(layout);
  document.fonts?.load('600 34px Fredoka').then(() => {
    drawLayout(lg);
    layoutTex.needsUpdate = true;
  }).catch(() => {});
  // The wheel, sunk into the left of the table: the wooden bowl, its ball track, the turning rotor.
  const wheelAt = new THREE.Vector3(-1.1, H, 0);
  const R = 0.62;
  const bowlPts = [[R + 0.06, -0.02], [R + 0.08, 0.1], [R + 0.02, 0.13], [R - 0.02, 0.1], [R - 0.12, 0.05], [R - 0.17, 0.02]].map(([a, b]) => new THREE.Vector2(a, b));
  const bowl = new THREE.Mesh(new THREE.LatheGeometry(bowlPts, 64), mats.wood);
  bowl.position.copy(wheelAt);
  g.add(bowl);
  const track = new THREE.Mesh(new THREE.LatheGeometry([[R - 0.02, 0.1], [R - 0.12, 0.05], [R - 0.18, 0.025]].map(([a, b]) => new THREE.Vector2(a, b)), 64), mats.track);
  track.position.copy(wheelAt).add(new THREE.Vector3(0, 0.002, 0));
  g.add(track);
  const rotor = new THREE.Group();
  rotor.position.copy(wheelAt);
  g.add(rotor);
  const ring = new THREE.Mesh(new THREE.CircleGeometry(R - 0.18, 74).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: pocketTex(), roughness: 0.35 }));
  ring.position.y = 0.022;
  rotor.add(ring);
  rotor.add(new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.16, 24).translate(0, 0.1, 0), mats.chrome));
  for (let k = 0; k < 4; k++) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 6).rotateZ(Math.PI / 2).translate(0, 0.17, 0), mats.chrome);
    arm.rotation.y = (k * Math.PI) / 2;
    rotor.add(arm);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), mats.chrome);
    knob.position.set(Math.cos((k * Math.PI) / 2) * 0.15, 0.17, -Math.sin((k * Math.PI) / 2) * 0.15);
    rotor.add(knob);
  }
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.028, 16, 12), mats.ball);
  g.add(ball);
  // Rest it in zero's pocket to start with.
  const place = (beta, radius, lift) => {
    ball.position.set(wheelAt.x + Math.cos(beta) * radius, wheelAt.y + lift, wheelAt.z - Math.sin(beta) * radius);
  };
  place(SLOT / 2, POCKET_R, POCKET_Y);

  // The chips on the felt, stacked on each bet, and the marker (the dolly) on the last number to win.
  // One sits in the stack from the start, so the load draws them.
  const chipMats = chipMaterials();
  const stacks = new THREE.InstancedMesh(new THREE.CylinderGeometry(CHIP_R, CHIP_R, CHIP_H, 28), chipMats, STACK_MAX);
  stacks.frustumCulled = false;
  g.add(stacks);
  const dolly = new THREE.Group();
  dolly.add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.07, 16).translate(0, 0.035, 0), mats.chrome));
  dolly.add(new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 10).translate(0, 0.09, 0), new THREE.MeshStandardMaterial({ color: style.dolly ?? '#7ff0c9', roughness: 0.2, emissive: style.dolly ?? '#7ff0c9', emissiveIntensity: 0.6 })));
  dolly.visible = false;
  g.add(dolly);
  // A spot's middle on the felt, in the table's space.
  const spotAt = (key, out = new THREE.Vector3()) => {
    const sp = SPOTS.find((q) => q.key === key);
    return out.set(layout.position.x + ((sp.x + sp.w / 2) / LAYOUT.w - 0.5) * LAYOUT_W, H + 0.003, layout.position.z + ((sp.y + sp.h / 2) / LAYOUT.h - 0.5) * LAYOUT_D);
  };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
  // How many chips stand on each spot, and how many instances the stacks use (the chip you hold, over
  // the spot it would land on, is the one after them).
  const tops = new Map();
  let base = 0;
  const aim = { key: null, value: 10, ok: true, k: 0, in: 1, shown: false, at: new THREE.Vector3(), size: new THREE.Vector2(0.1, 0.1) };
  const setStacks = (bets) => {
    let i = 0;
    tops.clear();
    for (const { key, amount, lift = 0 } of bets) {
      spotAt(key, v);
      const chips = chipsFor(amount);
      tops.set(key, chips.length);
      chips.forEach((value, k) => {
        if (i >= STACK_MAX) return;
        // A slight wobble, so a stack reads as chips and not a cylinder.
        const p = v.clone().add(new THREE.Vector3(Math.sin(k * 2.1 + amount) * 0.004, CHIP_H / 2 + k * CHIP_H + lift, Math.cos(k * 1.7) * 0.004));
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), k * 0.7);
        stacks.setMatrixAt(i, m4.compose(p, q, one));
        stacks.setColorAt(i, CHIP_COLOURS[value]);
        i++;
      });
    }
    stacks.count = base = i;
    stacks.instanceMatrix.needsUpdate = true;
    if (stacks.instanceColor) stacks.instanceColor.needsUpdate = true;
    aim.shown = false;
  };
  setStacks([{ key: 'red', amount: 5 }]);

  // Where a chip will land: a soft glow round the spot under the pointer or finger, and the chip you
  // hold hovering over it. Drawn from the load on (at nothing), so its shader is ready.
  const glowMat = new THREE.ShaderMaterial({
    uniforms: { uSize: { value: new THREE.Vector2(0.1, 0.1) }, uColor: { value: new THREE.Color('#ffe7a0') }, uAlpha: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec2 uSize;
      uniform vec3 uColor;
      uniform float uAlpha;
      varying vec2 vUv;
      void main() {
        vec2 full = uSize + vec2(${(2 * AIM_PAD).toFixed(3)});
        vec2 p = (vUv - 0.5) * full;
        // A rounded box the size of the spot: a bright rim, a light fill and a soft halo outside it.
        vec2 qd = abs(p) - uSize * 0.5 + 0.012;
        float d = length(max(qd, 0.0)) + min(max(qd.x, qd.y), 0.0) - 0.012;
        float rim = 1.0 - smoothstep(0.0, 0.007, abs(d));
        float fill = 0.3 * (1.0 - step(0.0, d));
        float halo = 0.6 * step(0.0, d) * exp(-max(d, 0.0) * 70.0);
        gl_FragColor = vec4(uColor * (rim * 0.95 + fill + halo) * uAlpha, 1.0);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), glowMat);
  glow.renderOrder = 2;
  glow.frustumCulled = false;
  glow.position.set(layout.position.x, H + 0.006, layout.position.z);
  glow.userData.keep = true;
  g.add(glow);
  const GOLD_GLOW = new THREE.Color('#ffe7a0'), NO_GLOW = new THREE.Color('#ff7a6b');
  const spin = new THREE.Quaternion(), tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.12);
  const size = new THREE.Vector2();
  const stepAim = (dt, t) => {
    const sp = aim.key ? SPOTS.find((x) => x.key === aim.key) : null;
    // Nothing aimed and all faded: nothing to do.
    if (!sp && aim.k < 0.002 && !aim.shown) {
      glowMat.uniforms.uAlpha.value = 0;
      return;
    }
    aim.k += ((sp ? 1 : 0) - aim.k) * Math.min(1, dt * 14);
    if (sp) {
      spotAt(sp.key, v);
      size.set((sp.w / LAYOUT.w) * LAYOUT_W, (sp.h / LAYOUT.h) * LAYOUT_D);
      // From nothing it starts where it is; from another spot it glides across.
      const f = aim.k < 0.08 ? 1 : Math.min(1, dt * 24);
      aim.at.lerp(v, f);
      aim.size.lerp(size, f);
    }
    glow.position.set(aim.at.x, H + 0.006, aim.at.z);
    glow.scale.set(aim.size.x + 2 * AIM_PAD, 1, aim.size.y + 2 * AIM_PAD);
    glowMat.uniforms.uSize.value.copy(aim.size);
    glowMat.uniforms.uColor.value.copy(aim.ok ? GOLD_GLOW : NO_GLOW);
    glowMat.uniforms.uAlpha.value = aim.k < 0.01 ? 0 : aim.k * (0.8 + 0.2 * Math.sin(t * 6.5));
    // The chip in hand, over the top of the spot's stack, bobbing and turning slowly.
    const show = sp && aim.ok && aim.k > 0.02 && base < STACK_MAX;
    if (show) {
      aim.in = Math.min(1, aim.in + dt / 0.24);
      const e = ease(aim.in);
      const top = tops.get(sp.key) ?? 0;
      v.copy(aim.at).setY(H + 0.003 + CHIP_H / 2 + top * CHIP_H + 0.035 + 0.05 * (1 - e) + 0.006 * Math.sin(t * 4));
      spin.setFromAxisAngle(UP, t * 0.9).multiply(tilt);
      stacks.setMatrixAt(base, m4.compose(v, spin, sc.setScalar(Math.max(0.001, aim.k * e))));
      stacks.setColorAt(base, CHIP_COLOURS[aim.value] ?? CHIP_COLOURS[10]);
      stacks.count = base + 1;
      stacks.instanceMatrix.needsUpdate = true;
      if (stacks.instanceColor) stacks.instanceColor.needsUpdate = true;
      aim.shown = true;
    } else if (aim.shown) {
      stacks.count = base;
      aim.shown = false;
    }
  };
  const sc = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  g.traverse((o) => o.isMesh && (o.userData.keep = true));
  const L = (a, b, c) => g.localToWorld(new THREE.Vector3(a, b, c));
  return {
    group: g,
    rotor,
    ball,
    wheelAt,
    layout,
    place,
    /**
     * Where to stand. 'bet': over the near side, the wheel and the layout both in view (on a tall
     * screen, straight down over the layout, so the numbers are big enough to tap); 'wheel': close
     * over the wheel while the ball runs.
     */
    view(kind, tall) {
      // In the middle of the screen, between your Chog's edges at the top and the chips along the
      // bottom: on a wide screen the whole table to bet, the wheel alone while the ball runs.
      if (kind === 'wheel') return tall ? { pos: L(-1.1, 3.1, 1.3), target: L(-1.1, 1.0, 0.3), enter: true } : { pos: L(-1.1, 2.3, 1.45), target: L(-1.1, 0.8, -0.15), enter: true };
      return tall ? { pos: L(0.62, 4.6, 0.44), target: L(0.62, 1.0, 0.26), enter: true } : { pos: L(0, 3.25, 2.35), target: L(0, 0.92, -0.05), enter: true };
    },
    highlight(on) {
      drawLayout(lg, on);
      layoutTex.needsUpdate = true;
    },
    /** The bet spot under a point on the layout (its uv), or null. */
    keyAt(uv) {
      const x = uv.x * LAYOUT.w, y = (1 - uv.y) * LAYOUT.h;
      return SPOTS.find((sp) => x >= sp.x && x < sp.x + sp.w && y >= sp.y && y < sp.y + sp.h)?.key ?? null;
    },
    spotAt,
    /** The chips on the felt: [{ key, amount, lift }]. */
    setStacks,
    /** The spots that have chips on them now. */
    stacked: () => [...tops.keys()],
    /** The dolly on n's spot, or away (null). */
    mark(n) {
      dolly.visible = n !== null;
      if (n !== null) spotAt(`n${n}`, dolly.position);
    },
    // Where the winning chips fly from, in the room's space.
    worldAt: (key) => g.localToWorld(spotAt(key)),
    /**
     * The glow where a chip will land: key (or null, to fade it out), the chip's value, and whether it
     * can go down there (if not, the glow turns coral and no chip hovers).
     */
    aim(key, value = 10, ok = true) {
      aim.key = key;
      aim.value = value;
      aim.ok = ok;
    },
    get aimed() {
      return aim.key;
    },
    /** A chip just went down where it aimed: the next one drops in from above. */
    dropped() {
      aim.in = 0;
    },
    stepAim,
  };
}

// ---------- the chips ----------
const CHIP_R = 0.046, CHIP_H = 0.014, STACK_MAX = 120;
// How far the landing glow reaches past its spot's edge.
const AIM_PAD = 0.035;
const LAYOUT_W = 2.0, LAYOUT_D = 2.0 * (LAYOUT.h / LAYOUT.w);
export const CHIP_VALUES = [100, 50, 25, 10, 5];
// The rack's colours (src/style.css, .cz-chip), so the chip in your hand is the one on the felt.
const CHIP_COLOURS = { 5: new THREE.Color('#efeaf7'), 10: new THREE.Color('#ff6f61'), 25: new THREE.Color('#2fb3a3'), 50: new THREE.Color('#8a63ff'), 100: new THREE.Color('#2a3c6e') };
// An amount as the chips that make it, biggest first, up to 9 in a stack.
function chipsFor(amount) {
  const out = [];
  let left = amount;
  for (const v of CHIP_VALUES) while (left >= v && out.length < 9) {
    out.push(v);
    left -= v;
  }
  return out.reverse();
}
// The chips' faces (an inset ring and notches round the edge) and their striped edge, in white, so
// each chip's colour tints them.
function chipMaterials() {
  const face = document.createElement('canvas');
  face.width = face.height = 128;
  const f = face.getContext('2d');
  f.fillStyle = '#ffffff';
  f.fillRect(0, 0, 128, 128);
  f.fillStyle = '#c9c9c9';
  for (let k = 0; k < 8; k++) {
    f.save();
    f.translate(64, 64);
    f.rotate((k / 8) * Math.PI * 2);
    f.fillRect(-7, -64, 14, 18);
    f.restore();
  }
  f.strokeStyle = '#d6d6d6';
  f.lineWidth = 5;
  f.beginPath();
  f.arc(64, 64, 36, 0, Math.PI * 2);
  f.stroke();
  const faceTex = new THREE.CanvasTexture(face);
  faceTex.colorSpace = THREE.SRGBColorSpace;
  const edge = document.createElement('canvas');
  edge.width = 128;
  edge.height = 8;
  const e = edge.getContext('2d');
  e.fillStyle = '#ffffff';
  e.fillRect(0, 0, 128, 8);
  e.fillStyle = '#c9c9c9';
  for (let k = 0; k < 8; k++) e.fillRect(k * 16, 0, 7, 8);
  const edgeTex = new THREE.CanvasTexture(edge);
  edgeTex.colorSpace = THREE.SRGBColorSpace;
  const side = new THREE.MeshStandardMaterial({ map: edgeTex, roughness: 0.5 });
  const top = new THREE.MeshStandardMaterial({ map: faceTex, roughness: 0.45 });
  return [side, top, top];
}

const TRACK_R = 0.5, POCKET_R = 0.33, TRACK_Y = 0.09, POCKET_Y = 0.045;
const ease = (t) => 1 - Math.pow(1 - t, 3);

/**
 * One spin of the wheel to land on n: returns a stepper, step(dt) -> true while it runs. The rotor
 * turns one way, the ball the other, slowing until it drops and comes to rest in n's pocket.
 */
export function spinBall(table, n, T = 6) {
  const rotor = table.rotor;
  const psi0 = rotor.rotation.y;
  const w0 = 1.6 + Math.random() * 0.4;
  const target = (ORDER.indexOf(n) + 0.5) * SLOT;
  // The ball's angle against the rotor: from wherever it is now round to the pocket, many turns back.
  const b = table.ball.position.clone().sub(table.wheelAt);
  const beta0 = Math.atan2(-b.z, b.x);
  const phi0 = beta0 - psi0;
  let phiEnd = target - Math.PI * 2 * 9;
  while (phiEnd > phi0 - Math.PI * 2 * 8) phiEnd -= Math.PI * 2;
  const seed = Math.random() * 10;
  let t = 0;
  return {
    get t() {
      return t;
    },
    T,
    step(dt) {
      t = Math.min(T + 1.5, t + dt);
      const k = Math.min(1, t / T);
      // The rotor slows but keeps turning.
      const psi = psi0 + w0 * T * (k - (k * k) / 2) * 1.2 + Math.max(0, t - T) * w0 * 0.2;
      rotor.rotation.y = psi;
      let phi = phi0 + (phiEnd - phi0) * ease(k);
      // Dropping onto the frets it rattles: a few small hops either way that die out.
      const drop = THREE.MathUtils.smoothstep(k, 0.62, 0.82);
      const rattle = drop * (1 - THREE.MathUtils.smoothstep(k, 0.82, 1));
      phi += Math.sin(t * 23 + seed) * 0.07 * rattle;
      const radius = THREE.MathUtils.lerp(TRACK_R, POCKET_R, drop);
      const lift = THREE.MathUtils.lerp(TRACK_Y, POCKET_Y, drop) + Math.abs(Math.sin(t * 17 + seed)) * 0.03 * rattle;
      table.place(psi + phi, radius, lift);
      return t < T + 1.5;
    },
    // The ball has come to rest (the game pays out then; the wheel still turns a while).
    get landed() {
      return t >= T;
    },
  };
}
