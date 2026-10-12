import * as THREE from 'three';
import { WORLD, ISLANDS, BRIDGES } from './layout.js';
import { edgeR, heightAt } from './terrain.js';
import { info } from './assets.js';
import { fbm, noise2, clamp } from './util.js';
import { mergeByMaterial } from './merge.js';

const WHITE = new THREE.Color(1, 1, 1);

/**
 * A sea of soft clouds far below the islands. It fades into the horizon colour with distance,
 * so it meets the sky without an edge.
 */
export function buildCloudSea(scene, noise) {
  const uniforms = {
    uNoise: { value: noise },
    uTime: { value: 0 },
    uLit: { value: new THREE.Color() },
    uShade: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uGlow: { value: new THREE.Color() },
    uCamPos: { value: new THREE.Vector3() },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`,
    fragmentShader: /* glsl */ `
uniform sampler2D uNoise;
uniform float uTime;
uniform vec3 uLit, uShade, uHorizon, uGlow, uCamPos;
varying vec3 vWorld;
void main() {
  vec2 q = vWorld.xz / 2600.0 + vec2(uTime * 0.0016, uTime * 0.0006);
  vec2 warp = vec2(texture2D(uNoise, q * 0.7).g, texture2D(uNoise, q * 0.7 + 0.31).r) - 0.5;
  float n = texture2D(uNoise, q + warp * 0.3).r * 0.7 + texture2D(uNoise, q * 3.2 + warp).b * 0.3;
  float puff = smoothstep(0.32, 0.78, n);
  vec3 col = mix(uShade, uLit, puff);
  float d = length(vWorld.xz - uCamPos.xz);
  // Fade to exactly what the sky shows in this direction, so the far edge vanishes.
  float h = normalize(vWorld - uCamPos).y;
  vec3 skyCol = uHorizon + uGlow * exp(-abs(h) * 9.0);
  col = mix(col, skyCol, smoothstep(600.0, 2100.0, d));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`,
    depthWrite: true,
  });
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(2300, 96), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = WORLD.cloudSeaY;
  scene.add(mesh);
  const nightLit = new THREE.Color('#3a2466'), nightShade = new THREE.Color('#1a0f33');
  // Same soft glow the sky adds along the horizon at night, so the far edge disappears.
  const glow = new THREE.Color(0.32 * 0.3, 0.14 * 0.3, 0.58 * 0.3);
  return {
    update(env, t, camera, skyU) {
      uniforms.uTime.value = t;
      uniforms.uCamPos.value.copy(camera.position);
      uniforms.uHorizon.value.copy(skyU.uHorizon.value);
      uniforms.uGlow.value.copy(glow).multiplyScalar(env.night);
      uniforms.uLit.value.copy(WHITE).lerp(skyU.uHorizon.value, 0.25).lerp(nightLit, env.night);
      uniforms.uShade.value.copy(skyU.uTop.value).lerp(WHITE, 0.25).lerp(nightShade, env.night);
      mesh.position.x = camera.position.x;
      mesh.position.z = camera.position.z;
    },
  };
}

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

/** Arched walkway bridges between islands: timber deck, steel arch underneath, rails and lamps. */
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
    const L = WORLD.landH;
    const deckY = (t) => L + 0.25 + Math.sin(t * Math.PI) * 2.4;
    const at = (t, side = 0, dy = 0) => new THREE.Vector3(br.ax + ux * len * t + nx * side, deckY(t) + dy, br.az + uz * len * t + nz * side);
    paths.push({ ...br, len, deckY });

    // Deck: short boards following the arch.
    const N = 28;
    for (let i = 0; i < N; i++) {
      const a = at(i / N), b = at((i + 1) / N);
      const seg = new THREE.Mesh(new THREE.BoxGeometry(br.width, 0.3, a.distanceTo(b) + 0.05), deckMat);
      seg.position.copy(a).add(b).multiplyScalar(0.5);
      seg.lookAt(b);
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
        p.y = L - 9 + Math.sin(t * Math.PI) * 8.6;
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
function rockGeometry(r, depth, seed) {
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
    for (const isl of ISLANDS) if (Math.hypot(x - isl.x, z - isl.z) < isl.r + r + 18) return false;
    for (const b of BRIDGES) {
      const vx = b.bx - b.ax, vz = b.bz - b.az;
      const t = clamp(((x - b.ax) * vx + (z - b.az) * vz) / (vx * vx + vz * vz), 0, 1);
      if (Math.hypot(x - (b.ax + vx * t), z - (b.az + vz * t)) < r + 14) return false;
    }
    return rocks.every((o) => Math.hypot(x - o.x, z - o.z) > o.r + r + 10);
  };
  for (let tries = 0; tries < 400 && rocks.length < 22; tries++) {
    const a = rng() * Math.PI * 2, d = rng.range(90, 360);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const r = rng.range(4, 15);
    if (!clearOf(x, z, r)) continue;
    const y = rng.range(-70, 45);
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
  float fall = 1.0 - smoothstep(0.15, 1.0, vUv.y);
  vec3 col = mix(vec3(0.55, 0.85, 0.95), vec3(1.0), streak);
  col = mix(col, col * vec3(0.45, 0.4, 0.7), uNight * 0.7);
  float a = edge * fall * (0.45 + 0.5 * streak);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`,
  });

  const falls = [];
  for (const isl of ISLANDS) {
    for (let n = 0; n < 2; n++) {
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
      const width = rng.range(3, 5.5);
      const H = rng.range(90, 150);
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

// Four soft cumulus shapes in a 2x2 atlas: red channel is how lit a spot is (bright tops, darker bellies), alpha is density.
function cloudAtlas() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S * 2;
  const ctx = c.getContext('2d');
  let seed = 5;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let cell = 0; cell < 4; cell++) {
    const ox = (cell % 2) * S, oy = Math.floor(cell / 2) * S;
    const layer = document.createElement('canvas');
    layer.width = layer.height = S;
    const l = layer.getContext('2d');
    const blobs = 16 + Math.floor(rnd() * 10);
    for (let i = 0; i < blobs; i++) {
      // Heaped in the middle and top, flatter along the base.
      const a = rnd() * Math.PI;
      const rr = Math.sqrt(rnd());
      const x = S / 2 + Math.cos(a) * rr * S * 0.34 * (cell % 2 ? 1.1 : 0.9);
      const y = S * 0.62 - Math.sin(a) * rr * S * 0.26;
      const r = S * (0.1 + rnd() * 0.12);
      const g = l.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.95)');
      g.addColorStop(0.6, 'rgba(255,255,255,0.55)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      l.fillStyle = g;
      l.beginPath();
      l.arc(x, y, r, 0, Math.PI * 2);
      l.fill();
    }
    // Soft flat base.
    l.globalCompositeOperation = 'destination-in';
    const base = l.createLinearGradient(0, S * 0.6, 0, S * 0.8);
    base.addColorStop(0, 'rgba(0,0,0,1)');
    base.addColorStop(1, 'rgba(0,0,0,0)');
    l.fillStyle = base;
    l.fillRect(0, 0, S, S);
    // Shade: lit tops, darker bellies (kept in the colour channels).
    l.globalCompositeOperation = 'source-atop';
    const shade = l.createLinearGradient(0, S * 0.3, 0, S * 0.78);
    shade.addColorStop(0, 'rgb(255,255,255)');
    shade.addColorStop(1, 'rgb(90,90,90)');
    l.fillStyle = shade;
    l.fillRect(0, 0, S, S);
    ctx.drawImage(layer, ox, oy);
  }
  return new THREE.CanvasTexture(c);
}

/** Soft cloud banks drifting around and beneath the islands, so the height reads. */
export function buildCloudPuffs(scene, rng) {
  const puffs = [];
  const clearOfIslands = (x, z, pad) => ISLANDS.every((isl) => Math.hypot(x - isl.x, z - isl.z) > isl.r + pad);
  const add = (n, yMin, yMax, sMin, sMax, rMin, rMax, alpha, needClear) => {
    for (let i = 0, tries = 0; i < n && tries < n * 30; tries++) {
      const a = rng() * Math.PI * 2, r = rng.range(rMin, rMax);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const size = rng.range(sMin, sMax);
      if (needClear && !clearOfIslands(x, z, size * 0.5 + 20)) continue;
      puffs.push({ x, y: rng.range(yMin, yMax), z, size, cell: Math.floor(rng() * 4), alpha: alpha * rng.range(0.7, 1), speed: rng.range(1.2, 3) });
      i++;
    }
  };
  add(34, -175, -60, 80, 170, 0, 380, 0.85, false); // beneath the islands
  add(26, -28, 12, 45, 95, 110, 430, 0.8, true); // drifting between them
  add(14, 45, 110, 60, 120, 60, 420, 0.45, false); // high wisps

  const geo = new THREE.PlaneGeometry(1, 1);
  const aCell = new THREE.InstancedBufferAttribute(new Float32Array(puffs.length), 1);
  const aAlpha = new THREE.InstancedBufferAttribute(new Float32Array(puffs.length), 1);
  geo.setAttribute('aCell', aCell);
  geo.setAttribute('aAlpha', aAlpha);
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    { uLit: { value: new THREE.Color() }, uShade: { value: new THREE.Color() } },
  ]);
  uniforms.uMap = { value: cloudAtlas() };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    fog: true,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
attribute float aCell;
attribute float aAlpha;
varying vec2 vUv;
varying float vAlpha;
#include <fog_pars_vertex>
void main() {
  vec3 center = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float s = length(instanceMatrix[0].xyz);
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 wp = center + (right * position.x * 1.6 + up * position.y) * s;
  vec2 cell = vec2(mod(aCell, 2.0), floor(aCell / 2.0));
  vUv = (cell + uv) * 0.5;
  // Fade out as the camera gets close, so you glide through instead of hitting a wall.
  float d = distance(center, cameraPosition);
  vAlpha = aAlpha * smoothstep(s * 0.5, s * 1.4, d);
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`,
    fragmentShader: /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uLit, uShade;
varying vec2 vUv;
varying float vAlpha;
#include <fog_pars_fragment>
void main() {
  vec4 t = texture2D(uMap, vUv);
  float a = t.a * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(mix(uShade, uLit, t.r), a);
  #include <fog_fragment>
  #include <colorspace_fragment>
}`,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, puffs.length);
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  scene.add(mesh);

  const wind = new THREE.Vector2(1, 0.35).normalize();
  const m = new THREE.Matrix4();
  const order = puffs.map((_, i) => i);
  const nightLit = new THREE.Color('#5c44a6'), nightShade = new THREE.Color('#22164a');
  return {
    update(env, t, camera, skyU, dt) {
      uniforms.uLit.value.copy(WHITE).lerp(skyU.uHorizon.value, 0.18).lerp(nightLit, env.night);
      uniforms.uShade.value.copy(skyU.uTop.value).lerp(WHITE, 0.45).lerp(nightShade, env.night);
      const cp = camera.position;
      for (const p of puffs) {
        p.x += wind.x * p.speed * dt;
        p.z += wind.y * p.speed * dt;
        // Drifted off one side: come back in on the other.
        if (Math.hypot(p.x, p.z) > 460) {
          p.x = -p.x * 0.98;
          p.z = -p.z * 0.98;
        }
        p.d = (p.x - cp.x) ** 2 + (p.y - cp.y) ** 2 + (p.z - cp.z) ** 2;
      }
      // Far to near, so the soft edges layer correctly.
      order.sort((a, b) => puffs[b].d - puffs[a].d);
      order.forEach((idx, i) => {
        const p = puffs[idx];
        m.makeScale(p.size, p.size, p.size).setPosition(p.x, p.y, p.z);
        mesh.setMatrixAt(i, m);
        aCell.setX(i, p.cell);
        aAlpha.setX(i, p.alpha);
      });
      mesh.instanceMatrix.needsUpdate = true;
      aCell.needsUpdate = true;
      aAlpha.needsUpdate = true;
    },
  };
}
