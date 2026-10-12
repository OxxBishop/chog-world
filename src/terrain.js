import * as THREE from 'three';
import { WORLD, ISLANDS, BRIDGES, TERRACES, DOWNTOWN, DOMES, DOME_R, baseY, roadDistance, nearDome } from './layout.js';
import { fbm, noise2, smoothstep, clamp } from './util.js';

const VOID = -1e4;
const RINGS = 64;
const SEGS = 192;
const LEVELS = 30;

// Directions (from each island's centre) where a bridge lands: the rim stays put there.
const PINS = new Map(
  ISLANDS.map((isl) => [
    isl.id,
    BRIDGES.flatMap((b) => (isl.id === 'downtown' ? [b.angle] : isl.id === `hood${b.hood}` ? [b.angle + Math.PI] : [])),
  ]),
);
const angleGap = (a, b) => Math.abs(((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI);

// Island outline: radius of the rim at a given angle. Big lobes and bays push out from the inner
// outline r (never in), except where a bridge lands.
function edgeR(isl, a) {
  const s = isl.seed;
  const wave = 0.5 * Math.sin(2 * a + s * 1.7) + 0.4 * Math.sin(3 * a + s * 4.1) + 0.25 * Math.sin(5 * a + s * 0.7);
  const n = fbm(Math.cos(a) * 1.6 + s * 7.3, Math.sin(a) * 1.6 - s * 3.1, 4) - 0.5;
  let pin = 1;
  for (const p of PINS.get(isl.id)) pin = Math.min(pin, smoothstep(0.22, 0.6, angleGap(a, p)));
  return isl.r * (1 + Math.max(0, wave) * 0.2 * pin + n * 0.06 * pin + 0.012 * Math.sin(11 * a + s));
}

/** Which island a point is over, with k = distance from centre / rim radius (1 at the rim). */
export function islandAt(x, z) {
  for (const isl of ISLANDS) {
    const dx = x - isl.x, dz = z - isl.z;
    const d = Math.hypot(dx, dz);
    if (d > isl.r * 1.4) continue;
    const e = edgeR(isl, Math.atan2(dz, dx));
    if (d <= e) return { isl, k: d / e, edge: e, d };
  }
  return null;
}

// Raised plateaus on an island: full height inside, a short steep cliff at the edge.
function terraceLift(isl, x, z) {
  let h = 0;
  for (const t of TERRACES) {
    if (t.isl !== isl.id) continue;
    const dx = x - t.x, dz = z - t.z;
    const d = Math.hypot(dx, dz) - (noise2(Math.atan2(dz, dx) * 2 + t.x * 0.1, t.z * 0.1) - 0.5) * 3;
    h = Math.max(h, t.h * smoothstep(t.r + 2.5, t.r, d));
  }
  return h;
}

// Surface height for a point known to be on `hit`.
function surface(x, z, hit) {
  const isl = hit.isl;
  const rolling = (fbm(x * 0.012 + 11, z * 0.012 - 4, 4) - 0.45) * 5;
  const hills = Math.max(0, fbm(x * 0.009 - 3, z * 0.009 + 9, 3) - 0.52) * 30;
  const lift = Math.max(-1, rolling) + hills;
  let flat = smoothstep(14, 1.5, roadDistance(x, z));
  flat = Math.max(flat, smoothstep(DOWNTOWN.r + 16, DOWNTOWN.r + 4, Math.hypot(x - DOWNTOWN.x, z - DOWNTOWN.z)));
  for (const d of DOMES) {
    const dd = Math.hypot(x - d.x, z - d.z);
    if (dd < DOME_R + 16) flat = Math.max(flat, smoothstep(DOME_R + 16, DOME_R + 3, dd));
  }
  const terrace = terraceLift(isl, x, z);
  if (terrace > 0) flat = Math.max(flat, terrace / 4);
  // Hills settle toward the rim, and the rim itself rounds over like the lip of a cliff.
  const rim = smoothstep(0.8, 1.0, hit.k);
  return baseY(isl) + terrace + lift * (1 - Math.min(1, flat)) * (1 - rim) - smoothstep(0.9, 1.0, hit.k) * 1.6;
}

/** Ground height, or a huge negative number over open sky. */
export function heightAt(x, z) {
  const hit = islandAt(x, z);
  return hit ? surface(x, z, hit) : VOID;
}

export const isVoid = (y) => y <= VOID + 1;

/**
 * Lowest the camera may sit at a point: just over the grass on an island, easing down past the rim
 * to just above the tallest cloud tops.
 */
export function cameraFloor(x, z, clearance = 1.5) {
  const sky = WORLD.cloudSeaY + 28;
  let floor = sky;
  for (const isl of ISLANDS) {
    const dx = x - isl.x, dz = z - isl.z;
    const d = Math.hypot(dx, dz);
    if (d > isl.r * 1.6) continue;
    const k = d / edgeR(isl, Math.atan2(dz, dx));
    const ground = (k <= 1 ? surface(x, z, { isl, k }) : baseY(isl) - 1.6) + clearance;
    floor = Math.max(floor, ground + (sky - ground) * smoothstep(1, 1.3, k));
  }
  return floor;
}

const C = (hex) => new THREE.Color(hex);
const PAL = {
  grassA: C('#76c93b'),
  grassB: C('#4f9f2c'),
  grassC: C('#a9d548'),
  rock: C('#8f8a7c'),
  verge: C('#8fc94a'),
  snow: C('#eef2fb'),
  grove: C('#3f8a4a'),
  soil: C('#6e4b33'),
};
const TIP = C('#2a1b4b');
const STRATA = [C('#6e4b33'), C('#8a7a86'), C('#6d5e72'), C('#9b8a7c'), C('#75657e'), C('#5a4b62'), C('#3d3249')];

// Painterly detail: soft mottling plus little strokes, tileable, multiplied over vertex colours.
function detailTexture() {
  const s = 512;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgb(214,214,214)';
  ctx.fillRect(0, 0, s, s);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 260; i++) {
    const x = rnd() * s, y = rnd() * s, r = 10 + rnd() * 34;
    const v = rnd() < 0.5 ? 190 : 236;
    for (const ox of [-s, 0, s]) for (const oy of [-s, 0, s]) {
      const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      g.addColorStop(0, `rgba(${v},${v},${v},0.35)`);
      g.addColorStop(1, `rgba(${v},${v},${v},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
    }
  }
  ctx.lineCap = 'round';
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * s, y = rnd() * s;
    const len = 5 + rnd() * 9, lean = (rnd() - 0.5) * 5;
    const v = rnd() < 0.55 ? 255 : 160 + rnd() * 30;
    ctx.strokeStyle = `rgba(${v},${v},${v},${0.25 + rnd() * 0.3})`;
    ctx.lineWidth = 1 + rnd() * 1.6;
    for (const ox of [-s, 0, s]) for (const oy of [-s, 0, s]) {
      ctx.beginPath();
      ctx.moveTo(x + ox, y + oy);
      ctx.quadraticCurveTo(x + ox + lean * 0.3, y + oy - len * 0.6, x + ox + lean, y + oy - len);
      ctx.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Top surface of one island as a polar grid that follows the wobbly rim.
function topGeometry(isl) {
  const pos = [], col = [], uv = [], idx = [];
  const c = new THREE.Color();
  for (let i = 0; i <= RINGS; i++) {
    for (let j = 0; j <= SEGS; j++) {
      const a = (j / SEGS) * Math.PI * 2;
      const e = edgeR(isl, a) * 0.9995;
      const rr = e * Math.pow(i / RINGS, 0.85);
      const x = isl.x + Math.cos(a) * rr, z = isl.z + Math.sin(a) * rr;
      const k = rr / e;
      const y = surface(x, z, { isl, k });
      pos.push(x, y, z);
      uv.push(x / 5, z / 5);
      const n1 = fbm(x * 0.03, z * 0.03, 3), n2 = noise2(x * 0.15 + 5, z * 0.15 - 2);
      c.copy(PAL.grassA).lerp(PAL.grassB, smoothstep(0.45, 0.7, n1)).lerp(PAL.grassC, smoothstep(0.55, 0.85, n2) * 0.6);
      c.lerp(PAL.verge, smoothstep(3, 0.5, roadDistance(x, z)) * 0.5);
      const d = nearDome(x, z, -0.3);
      if (d?.biome === 'frost') c.lerp(PAL.snow, 0.85);
      if (d?.biome === 'grove') c.lerp(PAL.grove, 0.7);
      c.lerp(PAL.soil, smoothstep(0.96, 1.0, k) * 0.8);
      col.push(c.r, c.g, c.b);
    }
  }
  const row = SEGS + 1;
  for (let i = 0; i < RINGS; i++) {
    for (let j = 0; j < SEGS; j++) {
      const a = i * row + j, b = a + 1, c2 = a + row, d2 = c2 + 1;
      idx.push(a, b, c2, b, d2, c2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// How each island's underside narrows with depth (t from 0 at the rim to 1 at the bottom), so no
// two hang the same: a broad plug, a round root ball, stepped tiers, or a leaning spike.
const PROFILES = {
  crystal: { radius: (t) => Math.pow(1 - t, 1.25), lean: 0 },
  roots: { radius: (t) => Math.pow(1 - t, 0.75) * (1 - 0.15 * t), lean: 0 },
  chains: { radius: (t) => (1 - 0.92 * Math.min(1, (Math.floor(t * 3) + smoothstep(0.7, 1.0, (t * 3) % 1)) / 3)) * (1 - smoothstep(0.9, 1.0, t)), lean: 0 },
  falls: { radius: (t) => Math.pow(1 - t, 1.45), lean: 0.45 },
};

/** A point on an island's underside at angle a and depth fraction t, for hanging things off it. */
export function undersidePoint(isl, a, t) {
  const prof = PROFILES[isl.under] ?? PROFILES.crystal;
  const shift = prof.lean * Math.pow(t, 1.5) * isl.r * 0.45;
  const leanA = isl.seed * 2.3;
  const e = edgeR(isl, a);
  // Same crags and wobble as the mesh, so things fixed here sit on the actual rock.
  const crag = 1 + (fbm(Math.cos(a) * 3 + isl.seed, Math.sin(a) * 3 + t * 6, 3) - 0.5) * 0.35 * Math.sin(t * Math.PI);
  const rr = e * prof.radius(t) * crag;
  const rimY = surface(isl.x + Math.cos(a) * e * 0.9995, isl.z + Math.sin(a) * e * 0.9995, { isl, k: 0.9995 });
  const y = rimY - t * isl.depth - (noise2(a * 9 + isl.seed, t * 12) - 0.5) * 3 * t;
  return new THREE.Vector3(isl.x + Math.cos(leanA) * shift + Math.cos(a) * rr, y, isl.z + Math.sin(leanA) * shift + Math.sin(a) * rr);
}

/** Where an island's rim is at angle a: the edge point and its ground height. */
export function rimPoint(isl, a, k = 0.99) {
  const e = edgeR(isl, a) * k;
  const x = isl.x + Math.cos(a) * e, z = isl.z + Math.sin(a) * e;
  return new THREE.Vector3(x, surface(x, z, { isl, k }), z);
}

// Rocky underside in layered rock tones, shaped by the island's profile.
function undersideGeometry(isl) {
  const pos = [], col = [], uv = [], idx = [];
  const c = new THREE.Color();
  const prof = PROFILES[isl.under] ?? PROFILES.crystal;
  const leanA = isl.seed * 2.3;
  for (let l = 0; l <= LEVELS; l++) {
    const t = l / LEVELS;
    // A leaning island's rings drift sideways as they go down.
    const shift = prof.lean * Math.pow(t, 1.5) * isl.r * 0.45;
    const cx = isl.x + Math.cos(leanA) * shift, cz = isl.z + Math.sin(leanA) * shift;
    for (let j = 0; j <= SEGS; j++) {
      const a = (j / SEGS) * Math.PI * 2;
      const e = edgeR(isl, a);
      const crag = 1 + (fbm(Math.cos(a) * 3 + isl.seed, Math.sin(a) * 3 + t * 6, 3) - 0.5) * 0.35 * Math.sin(t * Math.PI);
      // The top ring shares the lawn's edge vertices exactly, so no sliver of sky shows between them.
      const rr = l === 0 ? e * 0.9995 : e * prof.radius(t) * crag;
      const x = (l === 0 ? isl.x : cx) + Math.cos(a) * rr, z = (l === 0 ? isl.z : cz) + Math.sin(a) * rr;
      const rimY = surface(isl.x + Math.cos(a) * e * 0.9995, isl.z + Math.sin(a) * e * 0.9995, { isl, k: 0.9995 });
      const y = l === 0 ? rimY : rimY - t * isl.depth - (noise2(a * 9 + isl.seed, t * 12) - 0.5) * 3 * t;
      pos.push(x, y, z);
      uv.push((a * isl.r) / 9, y / 9);
      const band = clamp(Math.floor(t * (STRATA.length - 1) + (noise2(a * 5, t * 20) - 0.5) * 1.2), 0, STRATA.length - 1);
      c.copy(STRATA[band]).lerp(STRATA[Math.min(STRATA.length - 1, band + 1)], noise2(a * 13, t * 31) * 0.4);
      if (t < 0.04) c.copy(PAL.soil);
      // Deepening to dusky violet toward the tip.
      c.lerp(TIP, smoothstep(0.25, 1.0, t) * 0.65);
      col.push(c.r, c.g, c.b);
    }
  }
  const row = SEGS + 1;
  for (let l = 0; l < LEVELS; l++) {
    for (let j = 0; j < SEGS; j++) {
      const a = l * row + j, b = a + 1, c2 = a + row, d2 = c2 + 1;
      idx.push(a, b, c2, b, d2, c2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function buildTerrain(scene) {
  const detail = detailTexture();
  const topMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: detail });
  const rockMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: detail });
  // A soft rim of light along the rock edges, strongest on the side facing a low sun.
  const rim = { value: new THREE.Color(0, 0, 0) };
  const sunView = { value: new THREE.Vector3(0, 1, 0) };
  rockMat.onBeforeCompile = (sh) => {
    sh.uniforms.uRim = rim;
    sh.uniforms.uSunView = sunView;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uRim;\nuniform vec3 uSunView;').replace(
      '#include <opaque_fragment>',
      `{
        vec3 nv = normalize(normal);
        float fres = pow(1.0 - clamp(dot(nv, normalize(vViewPosition)), 0.0, 1.0), 3.0);
        float facing = 0.3 + 0.7 * clamp(dot(nv, uSunView) * 0.5 + 0.5, 0.0, 1.0);
        outgoingLight += uRim * fres * facing;
      }
      #include <opaque_fragment>`,
    );
  };
  rockMat.customProgramCacheKey = () => 'island-rock';
  const meshes = [];
  const tops = [];
  for (const isl of ISLANDS) {
    const top = new THREE.Mesh(topGeometry(isl), topMat);
    top.receiveShadow = true;
    const under = new THREE.Mesh(undersideGeometry(isl), rockMat);
    under.receiveShadow = true;
    scene.add(top, under);
    meshes.push(top, under);
    tops.push(top);
  }

  // Vertex buckets so ground shading under trees stays fast.
  const CELL = 4;
  const buckets = new Map();
  tops.forEach((m, mi) => {
    const p = m.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const key = Math.floor(p.getX(i) / CELL) * 100003 + Math.floor(p.getZ(i) / CELL);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(mi, i);
    }
  });

  // Darken the ground under trees and rocks: cheap baked contact shading.
  function shade(spots) {
    for (const [sx, sz, radius, strength] of spots) {
      for (let gx = Math.floor((sx - radius) / CELL); gx <= Math.floor((sx + radius) / CELL); gx++) {
        for (let gz = Math.floor((sz - radius) / CELL); gz <= Math.floor((sz + radius) / CELL); gz++) {
          const list = buckets.get(gx * 100003 + gz);
          if (!list) continue;
          for (let n = 0; n < list.length; n += 2) {
            const g = tops[list[n]].geometry, i = list[n + 1];
            const p = g.attributes.position, colA = g.attributes.color;
            const dd = Math.hypot(p.getX(i) - sx, p.getZ(i) - sz) / radius;
            if (dd >= 1) continue;
            const k = 1 - strength * (1 - dd * dd);
            colA.setXYZ(i, colA.getX(i) * k, colA.getY(i) * k, colA.getZ(i) * k);
          }
        }
      }
    }
    for (const m of tops) m.geometry.attributes.color.needsUpdate = true;
  }

  const lilac = new THREE.Color('#7c5cff');
  return {
    meshes,
    tops,
    shade,
    edgeR,
    update(env, sky, camera) {
      const su = sky.uniforms;
      const low = 1 - smoothstep(0.02, 0.4, env.sunElev);
      rim.value.copy(su.uSunColor.value).multiplyScalar(low * (1 - env.night) * 0.9).add(lilac.clone().multiplyScalar(0.12 * env.night));
      sunView.value.copy(env.sunElev > -0.04 ? su.uSunDir.value : su.uMoonDir.value).transformDirection(camera.matrixWorldInverse);
    },
  };
}

export { edgeR };
