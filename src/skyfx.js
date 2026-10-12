import * as THREE from 'three';
import { WORLD, ISLANDS, BRIDGES } from './layout.js';
import { edgeR, heightAt } from './terrain.js';
import { info } from './assets.js';
import { fbm, noise2, clamp } from './util.js';
import { mergeByMaterial } from './merge.js';

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
    const rise = br.by - br.ay;
    const steep = Math.abs(rise) / len > 0.12;
    const deckY = (t) => br.ay + rise * t + 0.25 + Math.sin(t * Math.PI) * (steep ? 0.8 : 2.4);
    const at = (t, side = 0, dy = 0) => new THREE.Vector3(br.ax + ux * len * t + nx * side, deckY(t) + dy, br.az + uz * len * t + nz * side);
    paths.push({ ...br, len, deckY });

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
      const arch = [];
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const p = at(t, s * 0.8, 0);
        p.y = br.ay + rise * t - 9 + Math.sin(t * Math.PI) * 8.6;
        arch.push(p);
      }
      group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(arch), 64, 0.28, 8), steel));
      for (let i = 2; i <= N - 2; i += 2) {
        const top = at(i / N, s * 0.8, -0.15);
        if (top.y - arch[i].y > 0.4) strut(arch[i], top, 0.06, steel);
      }
      // Lamps every few metres, alternating sides.
      for (let i = side > 0 ? 3 : 6; i < N; i += 6) {
        const base = at(i / N, side * (br.width / 2 + 0.05), 0);
        strut(base, base.clone().setY(base.y + 2.6), 0.06, steel);
        const g = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), globeMat);
        g.position.copy(base).setY(base.y + 2.75);
        group.add(g);
      }
    }
  }
  mergeByMaterial(group);
  scene.add(group);
  return {
    paths,
    update(env) {
      globeMat.emissiveIntensity = 0.2 + env.night * 7;
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

/** Waterfalls spilling off the island rims into the sky, fading as they fall. */
export function buildWaterfalls(scene, rng, noise) {
  const uniforms = { uTime: { value: 0 }, uNoise: { value: noise }, uNight: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
    fragmentShader: /* glsl */ `
uniform float uTime, uNight;
uniform sampler2D uNoise;
varying vec2 vUv;
void main() {
  // Streaks rushing down, broken up by noise.
  float s1 = texture2D(uNoise, vec2(vUv.x * 1.6, vUv.y * 0.35 + uTime * 0.35)).b;
  float s2 = texture2D(uNoise, vec2(vUv.x * 3.1 + 0.4, vUv.y * 0.6 + uTime * 0.55)).r;
  float streak = smoothstep(0.35, 0.75, s1 * 0.6 + s2 * 0.5);
  float edge = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x);
  float fall = 1.0 - smoothstep(0.35, 1.0, vUv.y);
  vec3 col = mix(vec3(0.55, 0.85, 0.95), vec3(1.0), streak);
  col = mix(col, col * vec3(0.45, 0.4, 0.7), uNight * 0.7);
  float a = edge * fall * (0.45 + 0.5 * streak);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`,
  });

  const falls = [];
  for (const isl of ISLANDS) {
    for (let n = 0; n < (isl.falls ?? 0); n++) {
      // Pick a rim spot away from the bridges.
      let a = 0;
      for (let tries = 0; tries < 40; tries++) {
        a = rng() * Math.PI * 2;
        const px = isl.x + Math.cos(a) * isl.r, pz = isl.z + Math.sin(a) * isl.r;
        const nearBridge = BRIDGES.some((b) => Math.hypot(px - b.ax, pz - b.az) < 30 || Math.hypot(px - b.bx, pz - b.bz) < 30);
        if (!nearBridge) break;
      }
      const e = edgeR(isl, a);
      const ox = Math.cos(a), oz = Math.sin(a);
      const topX = isl.x + ox * e * 0.995, topZ = isl.z + oz * e * 0.995;
      const topY = heightAt(isl.x + ox * e * 0.98, isl.z + oz * e * 0.98);
      // Islands known for their falls get wide ones.
      const width = isl.under === 'falls' ? rng.range(6, 9) : rng.range(3, 5.5);
      // Long enough to pour into the cloud sea below.
      const H = topY - WORLD.cloudSeaY + 4;
      // A curtain that arcs out over the lip, then drops and widens.
      const rows = 24;
      const pos = [], uv = [], idx = [];
      const tx = -oz, tz = ox;
      for (let i = 0; i <= rows; i++) {
        const v = i / rows;
        const out = Math.sqrt(v) * 9 + 1.2;
        const y = topY + 0.3 - v * v * H;
        const w = width * (1 + v * 1.8);
        for (const side of [-1, 1]) {
          pos.push(topX + ox * out + tx * side * w * 0.5, y, topZ + oz * out + tz * side * w * 0.5);
          uv.push(side < 0 ? 0 : 1, v);
        }
        if (i > 0) {
          const k = (i - 1) * 2;
          idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      const mesh = new THREE.Mesh(g, mat);
      mesh.renderOrder = 3;
      scene.add(mesh);
      falls.push({ x: topX, z: topZ, a });
    }
  }
  return {
    falls,
    update(env, t) {
      uniforms.uTime.value = t;
      uniforms.uNight.value = env.night;
    },
  };
}

