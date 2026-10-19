import * as THREE from 'three';
import { ISLANDS, BRIDGES } from './layout.js';
import { edgeR, heightAt, islandAt, undersidePoint } from './terrain.js';
import { info } from './assets.js';
import { fbm, noise2, clamp, smoothstep } from './util.js';
import { mergeByMaterial } from './merge.js';
import { createGlows } from './glows.js';

const WHITE = new THREE.Color(1, 1, 1);

// Plank texture for bridge decks.
function planks() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const ctx = c.getContext('2d');
  for (let i = 0; i < 8; i++) {
    const tone = 0.82 + noise2(i * 3.7, 1) * 0.3;
    ctx.fillStyle = `rgb(${Math.round(201 * tone)},${Math.round(150 * tone)},${Math.round(104 * tone)})`;
    ctx.fillRect(0, i * 32, 128, 30);
    ctx.fillStyle = 'rgba(60,36,20,0.6)';
    ctx.fillRect(0, i * 32 + 30, 128, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/**
 * Walkway bridges between islands: timber deck, steel arch underneath, rails and lamps. Between
 * islands at different heights the deck slopes, and where the drop is steep it becomes a stair.
 */
export function buildBridges(scene) {
  const deckMat = new THREE.MeshLambertMaterial({ map: planks() });
  const steel = new THREE.MeshStandardMaterial({ color: '#eceaf3', roughness: 0.32, metalness: 0.75 });
  const globeMat = new THREE.MeshStandardMaterial({ color: '#fff3dd', emissive: new THREE.Color('#ffd7a0'), emissiveIntensity: 0.2 });
  const stone = new THREE.MeshLambertMaterial({ color: '#d9c6ad' });
  const glowSpots = [];
  const group = new THREE.Group();
  const up = new THREE.Vector3(0, 1, 0);
  const strut = (a, b, r, mat) => {
    const dir = b.clone().sub(a);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, dir.length(), 6), mat);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(up, dir.normalize());
    m.castShadow = true;
    group.add(m);
  };
  const paths = [];
  for (const br of BRIDGES) {
    const len = Math.hypot(br.bx - br.ax, br.bz - br.az);
    const ux = (br.bx - br.ax) / len, uz = (br.bz - br.az) / len;
    const nx = -uz, nz = ux;
    // The deck's height along the way (its middle; its top is 0.15 higher). Each end starts on its
    // island's level ground and stays level out past the island's sloping rim to its cliff, then the
    // span climbs or steps across the gap. (The span used to start where the walkable ground ends, a few
    // metres short of the cliff, so its stairs dug into the rim and a Chog walked through the deck: the
    // user, 10-18 and 10-19.)
    const half = br.width / 2;
    const P = (d, s) => [br.ax + ux * d + nx * s, br.az + uz * d + nz * s];
    const ACROSS = [-half, -half / 2, 0, half / 2, half];
    // The island's k (0 middle, 1 its edge) under the deck at d, the lowest across it: 1 once the island
    // has gone from under all of it.
    const kLo = (d) => Math.min(...ACROSS.map((s) => islandAt(...P(d, s))?.k ?? 9));
    const STEP = 0.25;
    let cA = 0, cB = len;
    while (cA < len / 2 && kLo(cA) < 1) cA += STEP;
    while (cB > len / 2 && kLo(cB) < 1) cB -= STEP;
    cA = Math.min(len / 2, cA + 0.6);
    cB = Math.max(len / 2, cB - 0.6);
    // A landing's height: the highest ground anywhere under it (the deck counts as paving, as travel.js
    // has it: 6.5 cm over the land), so no part of it is buried.
    const landing = (d0, d1, fallback) => {
      let top = -Infinity;
      for (let d = d0; d <= d1; d += 0.5) {
        for (const s of ACROSS) {
          const [x, z] = P(d, s);
          if ((islandAt(x, z)?.k ?? 9) < 1) top = Math.max(top, heightAt(x, z));
        }
      }
      return Number.isFinite(top) ? top + 0.065 : fallback;
    };
    // The deck's top 2 cm over the landing (its middle is 0.15 under its top).
    const y0 = landing(0, cA, br.ay + 1.6) - 0.13;
    const y1 = landing(cB, len, br.by + 1.6) - 0.13;
    const steep = Math.abs(y1 - y0) / Math.max(1, cB - cA) > 0.12;
    const hump = steep ? 0.8 : 2.4;
    const deckAt = (d) => {
      if (d <= cA) return y0;
      if (d >= cB) return y1;
      const u = (d - cA) / (cB - cA);
      return y0 + (y1 - y0) * u + Math.sin(u * Math.PI) * hump;
    };
    const deckY = (t) => deckAt(clamp(t, 0, 1) * len);
    const at = (t, side = 0, dy = 0) => new THREE.Vector3(br.ax + ux * len * t + nx * side, deckY(t) + dy, br.az + uz * len * t + nz * side);
    const s0 = cA, s1 = cB;
    paths.push({ ...br, len, deckY, s0, s1 });
    // Under each landing, where the rim falls away below it, a stone abutment down to the ground.
    for (const [a, b, y] of [[0, cA, y0], [cB, len, y1]]) {
      let lo = Infinity, from = null, to = null;
      for (let d = a; d <= b; d += 0.5) {
        let g = Infinity;
        for (const s of ACROSS) {
          const [x, z] = P(d, s);
          const h = (islandAt(x, z)?.k ?? 9) < 1 ? heightAt(x, z) : y - 2.2;
          g = Math.min(g, h);
        }
        if (g < y - 0.2) {
          from ??= d;
          to = d;
          lo = Math.min(lo, g);
        }
      }
      if (from === null) continue;
      const d0 = Math.max(a, from - 0.5), d1 = Math.min(b, to + 0.5);
      const bottom = Math.max(lo - 0.6, y - 3.2), topY = y - 0.15;
      const blk = new THREE.Mesh(new THREE.BoxGeometry(br.width - 0.3, topY - bottom, d1 - d0), stone);
      blk.position.set(br.ax + ux * (d0 + d1) / 2, (topY + bottom) / 2, br.az + uz * (d0 + d1) / 2);
      blk.rotation.y = Math.atan2(ux, uz);
      blk.castShadow = blk.receiveShadow = true;
      group.add(blk);
    }

    // Deck: short boards following the arch, or level treads stepping down a stair.
    const N = 28;
    const steps = steep ? Math.round(len / 0.85) : N;
    for (let i = 0; i < steps; i++) {
      const a = at(i / steps), b = at((i + 1) / steps);
      let seg;
      if (steep) {
        const h = 0.3 + Math.abs(b.y - a.y);
        const top = Math.max(a.y, b.y);
        seg = new THREE.Mesh(new THREE.BoxGeometry(br.width, h, a.clone().setY(0).distanceTo(b.clone().setY(0)) + 0.02), deckMat);
        seg.position.copy(a).add(b).multiplyScalar(0.5).setY(top - h / 2 + 0.15);
        seg.lookAt(b.x, seg.position.y, b.z);
      } else {
        seg = new THREE.Mesh(new THREE.BoxGeometry(br.width, 0.3, a.distanceTo(b) + 0.05), deckMat);
        seg.position.copy(a).add(b).multiplyScalar(0.5);
        seg.lookAt(b);
      }
      seg.receiveShadow = true;
      seg.castShadow = true;
      group.add(seg);
    }
    // Rails and posts.
    for (const side of [-1, 1]) {
      const s = side * (br.width / 2 - 0.1);
      const rail = [];
      for (let i = 0; i <= N; i++) rail.push(at(i / N, s, 1.1));
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rail), 64, 0.07, 6), steel);
      group.add(tube);
      for (let i = 0; i <= N; i += 2) strut(at(i / N, s, 0.1), at(i / N, s, 1.1), 0.05, steel);
      // Steel arch underneath, springing from the cliffs and rising to meet the deck mid-span.
      // Across the gap only, springing from under each cliff.
      const arch = [];
      const ta = s0 / len, tb = s1 / len;
      for (let i = 0; i <= N; i++) {
        const u = i / N;
        const p = at(ta + (tb - ta) * u, s * 0.8, 0);
        p.y = deckY(ta) + (deckY(tb) - deckY(ta)) * u - 9 + Math.sin(u * Math.PI) * 8.6;
        arch.push(p);
      }
      group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(arch), 64, 0.28, 8), steel));
      for (let i = 2; i <= N - 2; i += 2) {
        const top = at(ta + ((tb - ta) * i) / N, s * 0.8, -0.15);
        if (top.y - arch[i].y > 0.4) strut(arch[i], top, 0.06, steel);
      }
      // Lamps every few metres, alternating sides.
      for (let i = side > 0 ? 3 : 6; i < N; i += 6) {
        const base = at(i / N, side * (br.width / 2 + 0.05), 0);
        strut(base, base.clone().setY(base.y + 2.6), 0.06, steel);
        const g = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), globeMat);
        g.position.copy(base).setY(base.y + 2.75);
        group.add(g);
        glowSpots.push(g.position.clone());
      }
    }
  }
  mergeByMaterial(group);
  const glows = createGlows(glowSpots);
  scene.add(group, glows.points);
  return {
    paths,
    update(env, renderer) {
      globeMat.emissiveIntensity = 0.2 + env.night * 2.2;
      glows.update(env, renderer);
    },
  };
}

// Plants on small floating rocks drift with the rock, so they are plain instanced copies parented to it.
function plant(name, tint, scale) {
  const c = info(name);
  const g = new THREE.Group();
  for (const p of c.parts) {
    const m = new THREE.InstancedMesh(p.geometry, p.material, 1);
    m.setMatrixAt(0, p.matrix);
    if (p.tintable) m.setColorAt(0, new THREE.Color(tint));
    m.castShadow = false;
    m.receiveShadow = true;
    g.add(m);
  }
  g.scale.setScalar(scale);
  return g;
}

// A small floating rock: a domed grassy cap on a tapering stone underside.
export function rockGeometry(r, depth, seed) {
  const SEG = 48, LV = 12;
  const pos = [], col = [], idx = [];
  const grassA = new THREE.Color('#6fb53d'), grassB = new THREE.Color('#4f9a2e'), soil = new THREE.Color('#6e4b33');
  const tmp = new THREE.Color();
  const strata = ['#8a7a86', '#6d5e72', '#9b8a7c', '#5a4b62'].map((h) => new THREE.Color(h));
  const rimR = (a) => r * (1 + (fbm(Math.cos(a) * 1.5 + seed, Math.sin(a) * 1.5 - seed, 3) - 0.5) * 0.3);
  // Cap: a gentle dome in three rings, grass fading to soil at the lip.
  pos.push(0, r * 0.12, 0);
  col.push(grassA.r, grassA.g, grassA.b);
  const capRings = [0.45, 0.8, 1.0];
  for (const f of capRings) {
    for (let j = 0; j <= SEG; j++) {
      const a = (j / SEG) * Math.PI * 2;
      const e = rimR(a) * f;
      pos.push(Math.cos(a) * e, r * 0.12 * (1 - f * f), Math.sin(a) * e);
      tmp.copy(grassA).lerp(grassB, noise2(Math.cos(a) * 3 + seed, Math.sin(a) * 3 + f * 4));
      if (f === 1) tmp.lerp(soil, 0.6);
      col.push(tmp.r, tmp.g, tmp.b);
    }
  }
  const capRow = SEG + 1;
  for (let j = 0; j < SEG; j++) idx.push(0, j + 2, j + 1);
  for (let ring = 0; ring < capRings.length - 1; ring++) {
    for (let j = 0; j < SEG; j++) {
      const a = 1 + ring * capRow + j, b = a + 1, c2 = a + capRow, d2 = c2 + 1;
      idx.push(a, b, c2, b, d2, c2);
    }
  }
  // Underside rings.
  const base = pos.length / 3;
  for (let l = 0; l <= LV; l++) {
    const t = l / LV;
    for (let j = 0; j <= SEG; j++) {
      const a = (j / SEG) * Math.PI * 2;
      const crag = 1 + (noise2(a * 4 + seed, t * 6) - 0.5) * 0.4 * Math.sin(t * Math.PI);
      const rr = rimR(a) * Math.pow(1 - t, 1.5) * crag;
      pos.push(Math.cos(a) * rr, -t * depth, Math.sin(a) * rr);
      const c = t < 0.08 ? soil : strata[clamp(Math.floor(t * strata.length + noise2(a * 7, t * 9) - 0.5), 0, strata.length - 1)];
      col.push(c.r, c.g, c.b);
    }
  }
  const row = SEG + 1;
  for (let l = 0; l < LV; l++) {
    for (let j = 0; j < SEG; j++) {
      const a = base + l * row + j, b = a + 1, c2 = a + row, d2 = c2 + 1;
      idx.push(a, b, c2, b, d2, c2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Little floating rocks drifting around the archipelago, some carrying a tree. */
export function buildSkyRocks(scene, rng, models) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const rocks = [];
  const clearOf = (x, z, r) => {
    for (const isl of ISLANDS) if (Math.hypot(x - isl.x, z - isl.z) < isl.r * 1.3 + r + 14) return false;
    for (const b of BRIDGES) {
      const vx = b.bx - b.ax, vz = b.bz - b.az;
      const t = clamp(((x - b.ax) * vx + (z - b.az) * vz) / (vx * vx + vz * vz), 0, 1);
      if (Math.hypot(x - (b.ax + vx * t), z - (b.az + vz * t)) < r + 14) return false;
    }
    return rocks.every((o) => Math.hypot(x - o.x, z - o.z) > o.r + r + 10);
  };
  for (let tries = 0; tries < 400 && rocks.length < 14; tries++) {
    const a = rng() * Math.PI * 2, d = rng.range(140, 440);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const r = rng.range(3.5, 9);
    if (!clearOf(x, z, r)) continue;
    const y = rng.range(-8, 48);
    const g = new THREE.Group();
    const mesh = new THREE.Mesh(rockGeometry(r, r * rng.range(1.6, 2.6), rng() * 100), mat);
    mesh.receiveShadow = true;
    g.add(mesh);
    if (r > 6.5) {
      const t = plant(rng.pick(models.common), rng.pick(['#8fd14f', '#c8a2ff', '#e9a6e0', '#7cc843']), rng.range(0.6, 0.9) * (r / 10));
      t.position.set(rng.range(-r * 0.25, r * 0.25), 0.4, rng.range(-r * 0.25, r * 0.25));
      t.rotation.y = rng() * Math.PI * 2;
      g.add(t);
    }
    for (let k = 0; k < Math.floor(r / 3); k++) {
      const b = plant(rng.pick(models.bush), '#8fd14f', rng.range(0.5, 0.9));
      const ba = rng() * Math.PI * 2, bd = rng.range(0, r * 0.6);
      b.position.set(Math.cos(ba) * bd, 0.3, Math.sin(ba) * bd);
      g.add(b);
    }
    g.position.set(x, y, z);
    scene.add(g);
    rocks.push({ g, x, z, r, y, phase: rng() * 10, speed: rng.range(0.12, 0.25), amp: rng.range(1, 3) });
  }
  return {
    update(t) {
      for (const o of rocks) {
        o.g.position.y = o.y + Math.sin(t * o.speed + o.phase) * o.amp;
        o.g.rotation.y = Math.sin(t * o.speed * 0.5 + o.phase) * 0.15;
      }
    },
  };
}

/*
 * Waterfalls: a stream runs across the grass to the rim and pours over it. The curtain arcs out the
 * way falling water does, stays clear of the rock face all the way down, and fades into the cloud
 * sea. Its streaks travel with the water, so they speed up as it falls.
 */
const G = 9.8;
const STREAM_SPEED = 2.2;
const LIP_SPEED = 2.6;
// The tops of the cloud deck, and where the curtain ends, inside it.
const CLOUD_TOP = -30;
const FALL_END_Y = -62;

// How far the rock juts out past the lip at depth fraction t, across the curtain's width.
function rockOut(isl, a, half, lip, o, t) {
  if (t <= 0 || t >= 1) return -Infinity;
  let out = -Infinity;
  for (const k of [-1, -0.5, 0, 0.5, 1]) {
    const p = undersidePoint(isl, a + k * half, t);
    out = Math.max(out, (p.x - lip.x) * o.x + (p.z - lip.z) * o.z);
  }
  return out;
}

export function buildWaterfalls(scene, rng, noise) {
  const uniforms = { uTime: { value: 0 }, uNoise: { value: noise }, uNight: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    defines: { CLOUD_TOP: CLOUD_TOP.toFixed(1) },
    vertexShader: /* glsl */ `
attribute float aFlow;
attribute float aFade;
attribute float aMist;
varying vec2 vUv;
varying float vFlow, vFade, vMist, vY;
void main() {
  vUv = uv;
  vY = position.y;
  vFlow = aFlow;
  vFade = aFade;
  vMist = aMist;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
    fragmentShader: /* glsl */ `
uniform float uTime, uNight;
uniform sampler2D uNoise;
varying vec2 vUv;
varying float vFlow, vFade, vMist, vY;
void main() {
  // vFlow is how long the water has been travelling, so (vFlow - uTime) moves with it.
  float y = (vFlow - uTime) * 0.55;
  float s1 = texture2D(uNoise, vec2(vUv.x * 1.3, y * 0.5)).b;
  float s2 = texture2D(uNoise, vec2(vUv.x * 2.9 + 0.4, y * 0.9 + 0.3)).r;
  float streak = smoothstep(0.3, 0.8, s1 * 0.6 + s2 * 0.5);
  float edge = smoothstep(0.0, 0.14, vUv.x) * smoothstep(1.0, 0.86, vUv.x);
  // White water where it tips over the lip and as it breaks into spray lower down.
  float foam = smoothstep(0.4, 0.0, abs(vFlow - 0.1));
  vec3 col = mix(vec3(0.5, 0.8, 0.95), vec3(1.0), clamp(streak * 0.75 + foam * 0.5 + vMist * 0.5, 0.0, 1.0));
  col = mix(col, col * vec3(0.45, 0.4, 0.7), uNight * 0.7);
  float a = edge * vFade * mix(0.55 + 0.45 * streak, 0.3 + 0.3 * streak, vMist);
  // Drawn after the clouds, so it melts into the deck as it reaches the cloud tops.
  a *= smoothstep(CLOUD_TOP - 26.0, CLOUD_TOP + 4.0, vY);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`,
  });

  const falls = [];
  const gap = (a, b) => Math.abs(((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  for (const isl of ISLANDS) {
    for (let n = 0; n < (isl.falls ?? 0); n++) {
      // Islands known for their falls get wide ones.
      const width = isl.under === 'falls' ? rng.range(6, 9) : rng.range(3, 5.5);
      // Of a few rim spots away from the bridges and other falls, take the one where the rock
      // below tucks in furthest, so the water drops clear instead of running down a leaning face.
      let best = null;
      for (let tries = 0; tries < 24; tries++) {
        const a = rng() * Math.PI * 2;
        const e = edgeR(isl, a);
        const px = isl.x + Math.cos(a) * e, pz = isl.z + Math.sin(a) * e;
        if (BRIDGES.some((b) => Math.hypot(px - b.ax, pz - b.az) < 34 || Math.hypot(px - b.bx, pz - b.bz) < 34)) continue;
        if (falls.some((f) => f.isl === isl && gap(f.a, a) < 0.7)) continue;
        const o = { x: Math.cos(a), z: Math.sin(a) };
        const lip = { x: isl.x + o.x * e * 0.995, z: isl.z + o.z * e * 0.995 };
        const half = (width * 1.6) / e;
        let jut = -Infinity;
        for (let t = 0.05; t < 1; t += 0.05) jut = Math.max(jut, rockOut(isl, a, half, lip, o, t));
        if (!best || jut < best.jut) best = { a, e, o, lip, half, jut };
      }
      if (!best) continue;
      const { a, o, lip, half } = best;
      const tx = -o.z, tz = o.x;
      const lipY = heightAt(lip.x, lip.z);

      const pos = [], uv = [], flow = [], fade = [], mist = [], idx = [];
      const COLS = 6;
      // Index a grid of rows just pushed, COLS + 1 vertices each.
      const strip = (rows) => {
        const base = pos.length / 3 - (rows + 1) * (COLS + 1);
        for (let i = 0; i < rows; i++) {
          for (let c = 0; c < COLS; c++) {
            const k = base + i * (COLS + 1) + c, k2 = k + COLS + 1;
            idx.push(k, k + 1, k2, k + 1, k2 + 1, k2);
          }
        }
      };

      // The stream across the grass, narrow at its head and widening to the lip.
      const L = 12;
      const SR = 10;
      for (let i = 0; i <= SR; i++) {
        const dist = L * (1 - i / SR);
        const w = width * (0.55 + 0.45 * (1 - dist / L));
        for (let c = 0; c <= COLS; c++) {
          const s = (c / COLS) * 2 - 1;
          const x = lip.x - o.x * dist + tx * s * w * 0.5, z = lip.z - o.z * dist + tz * s * w * 0.5;
          pos.push(x, heightAt(x, z) + 0.07, z);
          uv.push(c / COLS, 0);
          flow.push(-dist / STREAM_SPEED);
          fade.push(0.8 * smoothstep(L, L * 0.55, dist));
          mist.push(0);
        }
      }
      strip(SR);

      // The curtain, row by row in time since the water left the lip.
      const H = lipY - FALL_END_Y;
      const F = Math.sqrt((2 * H) / G);
      const ROWS = 30;
      const rows = [];
      for (let i = 0; i <= ROWS; i++) {
        const f = F * (i / ROWS);
        const d = 0.5 * G * f * f;
        const t = d / isl.depth;
        const need = rockOut(isl, a, half, lip, o, t) + 1.8 + d * 0.04;
        rows.push({ f, d, out: Math.max(LIP_SPEED * f, need) });
      }
      // Never curl back in, and round off the bends where the rock pushed the water out.
      for (let i = 1; i <= ROWS; i++) rows[i].out = Math.max(rows[i].out, rows[i - 1].out);
      for (let pass = 0; pass < 3; pass++) {
        const sm = rows.map((r, i) => (i === 0 || i === ROWS ? r.out : (rows[i - 1].out + r.out * 2 + rows[i + 1].out) / 4));
        rows.forEach((r, i) => (r.out = Math.max(r.out, sm[i])));
      }
      for (const r of rows) {
        const v = r.d / H;
        const w = width * (1 + v * 1.1);
        const bulge = w * 0.08;
        for (let c = 0; c <= COLS; c++) {
          const s = (c / COLS) * 2 - 1;
          const out = r.out + bulge * (1 - s * s) * Math.min(1, r.f * 2);
          pos.push(lip.x + o.x * out + tx * s * w * 0.5, lipY + 0.07 - r.d, lip.z + o.z * out + tz * s * w * 0.5);
          uv.push(c / COLS, v);
          flow.push(r.f);
          fade.push(1 - smoothstep(0.5, 1.0, v));
          mist.push(smoothstep(0.25, 0.9, v));
        }
      }
      strip(ROWS);

      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute('aFlow', new THREE.Float32BufferAttribute(flow, 1));
      g.setAttribute('aFade', new THREE.Float32BufferAttribute(fade, 1));
      g.setAttribute('aMist', new THREE.Float32BufferAttribute(mist, 1));
      g.setIndex(idx);
      const mesh = new THREE.Mesh(g, mat);
      mesh.renderOrder = 3;
      scene.add(mesh);
      falls.push({ isl, a, half, x: lip.x, z: lip.z, w: width, head: [lip.x - o.x * L, lip.z - o.z * L] });
    }
  }
  return {
    falls,
    // Distance from a point to the nearest stream bank, to keep trees and props off the water.
    streamDistance(x, z) {
      let best = Infinity;
      for (const f of falls) {
        const [hx, hz] = f.head;
        const dx = f.x - hx, dz = f.z - hz;
        const u = clamp(((x - hx) * dx + (z - hz) * dz) / (dx * dx + dz * dz), 0, 1);
        best = Math.min(best, Math.hypot(x - hx - dx * u, z - hz - dz * u) - f.w * 0.5);
      }
      return best;
    },
    update(env, t) {
      uniforms.uTime.value = t;
      uniforms.uNight.value = env.night;
    },
  };
}
