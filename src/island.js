import * as THREE from 'three';
import { MODELS, Scatter, info } from './assets.js';
import { Dome } from './dome.js';
import { Forest } from './trees.js';
import { buildTerrain, heightAt, islandAt } from './terrain.js';
import { buildRoads } from './roads.js';
import { buildHub } from './hub.js';
import { buildPlaza } from './plaza.js';
import { buildLandmarks } from './landmarks.js';
import { buildUndersides } from './underside.js';
import { buildBridges, buildSkyRocks, buildWaterfalls } from './skyfx.js';
import { buildTunnels } from './tunnels.js';
import { buildCosmoDome, COSMO_DOME } from './cosmo.js';
import { ISLANDS, HOODS, DOWNTOWN, DOMES, DOME_R, roadDistance, nearDome, nearPortal } from './layout.js';
import { fbm, noise2 } from './util.js';
import { Pod, RoomBox } from './camera.js';

// Leaf colours: lush greens, with lilac and pink blossom trees picking up the purple sky.
const GREENS = ['#8fd14f', '#7cc843', '#a3d85b', '#69b83b', '#9bd04a'];
const PINES = ['#4f9d4c', '#5aa851', '#468f45'];
const BLOSSOM = ['#c8a2ff', '#e9a6e0', '#b48cff', '#f2b5d8'];
const GRASS = ['#9bd55a', '#8ccf4d', '#a6da62', '#7fc544'];

// What grows inside each dome.
const BIOMES = {
  meadow: {
    trees: MODELS.common, treeCount: 5, treeScale: [0.75, 0.95], tints: ['#8fd14f', '#7cc843', '#a3d85b', '#c8a2ff'],
    under: [...MODELS.bush, ...MODELS.flowers, ...MODELS.flowers, ...MODELS.ferns], underCount: 60,
    grass: 380,
  },
  frost: {
    trees: [...MODELS.pine, ...MODELS.pine, ...MODELS.dead], treeCount: 6, treeScale: [0.75, 1.0], tints: ['#cfe6f2', '#b8d8e8', '#a9cbe0'],
    under: [...MODELS.rocks, ...MODELS.pebbles, ...MODELS.pebbles], underCount: 50,
    grass: 60,
  },
  grove: {
    trees: MODELS.twisted, treeCount: 5, treeScale: [0.7, 0.9], tints: ['#e05aa8', '#c94fd0', '#f07fc0'],
    under: [...MODELS.ferns, ...MODELS.ferns, ...MODELS.mushrooms, ...MODELS.bush], underCount: 60,
    grass: 300,
  },
  // Cosmo's dome (src/cosmo.js): a moon floor, a few grey rocks and hardly any flowers.
  moon: {
    trees: [], treeCount: 0, treeScale: [1, 1], tints: ['#d8d2e6', '#c6bfd8', '#e2dcef'],
    under: [...MODELS.rocks, ...MODELS.pebbles, ...MODELS.pebbles], underCount: 16, flowers: 4,
    grass: 0,
  },
};

// A random point somewhere on the islands, weighted by island area.
function randomOnIslands(rng) {
  const total = ISLANDS.reduce((s, i) => s + i.r * i.r, 0);
  let pick = rng() * total;
  let isl = ISLANDS[0];
  for (const i of ISLANDS) {
    pick -= i.r * i.r;
    if (pick <= 0) {
      isl = i;
      break;
    }
  }
  const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * isl.r;
  return [isl.x + Math.cos(a) * r, isl.z + Math.sin(a) * r];
}

/*
 * What a walker bumps into, from a model's own shape (B, 10-21: the user's Chog went through rocks, bushes
 * and trees). Its footprint at a Chog's body height, 0.3 to 3 m over its foot, as circles in the model's
 * own frame: one for something round, a short row along something long (a long rock). Cached per model and
 * scale step.
 */
const footCache = new Map();
const _fv = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
function footprint(name, s) {
  const step = Math.max(1, Math.round(s * 3));
  const key = `${name}@${step}`;
  if (footCache.has(key)) return footCache.get(key);
  const y0 = 0.3 / (step / 3), y1 = 3.0 / (step / 3);
  const pts = [];
  // Each triangle cut to the band; the corners of what's left.
  const cut = (poly, f) => {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], fa = f(a.y), fb = f(b.y);
      if (fa >= 0) out.push(a);
      if (fa >= 0 !== fb >= 0) out.push(a.clone().lerp(b, fa / (fa - fb)));
    }
    return out;
  };
  for (const p of info(name).parts) {
    const pos = p.geometry.attributes.position, idx = p.geometry.index;
    const n = idx ? idx.count / 3 : pos.count / 3;
    const every = Math.max(1, Math.floor(n / 1200));
    for (let t = 0; t < n; t += every) {
      for (let k = 0; k < 3; k++) _fv[k].fromBufferAttribute(pos, idx ? idx.getX(t * 3 + k) : t * 3 + k).applyMatrix4(p.matrix);
      if (Math.max(_fv[0].y, _fv[1].y, _fv[2].y) < y0 || Math.min(_fv[0].y, _fv[1].y, _fv[2].y) > y1) continue;
      let poly = cut([_fv[0].clone(), _fv[1].clone(), _fv[2].clone()], (y) => y - y0);
      if (poly.length >= 3) poly = cut(poly, (y) => y1 - y);
      if (poly.length >= 3) for (const q of poly) pts.push([q.x, q.z]);
    }
  }
  let circles = [];
  if (pts.length >= 3) {
    const pct = (arr, k) => arr.slice().sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor(arr.length * k))];
    let mx = 0, mz = 0;
    for (const [x, z] of pts) (mx += x), (mz += z);
    mx /= pts.length;
    mz /= pts.length;
    let sxx = 0, szz = 0, sxz = 0;
    for (const [x, z] of pts) (sxx += (x - mx) ** 2), (szz += (z - mz) ** 2), (sxz += (x - mx) * (z - mz));
    const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz), ux = Math.cos(ang), uz = Math.sin(ang);
    const along = pts.map(([x, z]) => (x - mx) * ux + (z - mz) * uz), across = pts.map(([x, z]) => -(x - mx) * uz + (z - mz) * ux);
    const a0 = pct(along, 0.03), a1 = pct(along, 0.97), b0 = pct(across, 0.03), b1 = pct(across, 0.97);
    const wide = Math.max(0.05, b1 - b0), bm = (b0 + b1) / 2;
    const count = a1 - a0 <= wide * 1.5 ? 1 : Math.min(5, Math.ceil((a1 - a0) / wide));
    const centres = [];
    for (let i = 0; i < count; i++) {
      const a = count === 1 ? (a0 + a1) / 2 : a0 + wide / 2 + ((a1 - a0 - wide) * i) / (count - 1);
      centres.push([mx + ux * a - uz * bm, mz + uz * a + ux * bm]);
    }
    const near = pts.map(([x, z]) => Math.min(...centres.map(([cx, cz]) => Math.hypot(x - cx, z - cz))));
    const r = pct(near, 0.99);
    circles = centres.map(([x, z]) => ({ x, z, r }));
  }
  footCache.set(key, circles);
  return circles;
}
// Circles for one placed copy (its matrix m) into list, each r scaled by soft (foliage gives a little).
const _fc = new THREE.Vector3();
function addFootprint(list, name, m, soft) {
  const s = m.getMaxScaleOnAxis();
  for (const c of footprint(name, s)) {
    _fc.set(c.x, 0, c.z).applyMatrix4(m);
    list.push({ x: _fc.x, y: m.elements[13], z: _fc.z, r: Math.max(0.15, c.r * s * soft) });
  }
}

export function buildIsland(scene, rng, renderer, sky, overlay = scene) {
  const noise = sky.uniforms.uNoise.value;
  const terrain = buildTerrain(scene);
  const roads = buildRoads(scene);
  const bridges = buildBridges(scene);
  // Glass hoops over the bridges, the user's pick (src/tunnels.js).
  const tunnels = buildTunnels(scene, bridges.paths);
  const skyRocks = buildSkyRocks(scene, rng, MODELS);
  const falls = buildWaterfalls(overlay, rng, noise);
  const undersides = buildUndersides(scene, rng, falls.falls);
  const landmarks = buildLandmarks(scene);
  const forest = new Forest();
  const props = new Scatter();
  const low = new Scatter();
  // Flowers get their own batches that draw much further out than grass, so the colour in the
  // meadows doesn't wink out as you zoom away.
  const bloom = new Scatter();
  const FLOWERS = new Set(MODELS.flowers);
  const plant = (name, ...rest) => (FLOWERS.has(name) ? bloom : low).add(name, ...rest);
  const shadeSpots = [];

  const domes = DOMES.map((d, i) => {
    const dome = new Dome(i === COSMO_DOME ? { ...d, biome: 'moon' } : d);
    scene.add(dome.group);
    return dome;
  });

  // The Chog Hub on the downtown plaza, its doors facing south.
  const hub = buildHub();
  hub.group.position.set(DOWNTOWN.x, heightAt(DOWNTOWN.x, DOWNTOWN.z) + 0.1, DOWNTOWN.z);
  scene.add(hub.group);
  const plaza = buildPlaza();
  plaza.group.position.copy(hub.group.position);
  plaza.group.updateMatrixWorld(true);
  scene.add(plaza.group);

  const downtownDist = (x, z) => Math.hypot(x - DOWNTOWN.x, z - DOWNTOWN.z);
  // On an island and back from the rim.
  const onLand = (x, z, margin = 0.93) => {
    const hit = islandAt(x, z);
    return !!hit && hit.k < margin;
  };
  // Each neighbourhood's landmark stands in a clearing on its central plateau.
  const nearLandmark = (x, z, pad) => HOODS.some((h) => Math.hypot(x - h.x, z - h.z) < 20 + pad);
  const built = (x, z, pad) =>
    roadDistance(x, z) < pad || nearDome(x, z, pad) || downtownDist(x, z) < DOWNTOWN.r + 4 + pad || nearLandmark(x, z, pad) || nearPortal(x, z, pad + 5) || falls.streamDistance(x, z) < pad;

  // Forest: jittered grid kept where a noise field says "woods", thinner in the built-up middle.
  const trees = [];
  const STEP = 7.5;
  const R = 330;
  for (let gx = -R; gx <= R; gx += STEP) {
    for (let gz = -R; gz <= R; gz += STEP) {
      const x = gx + rng.range(-2.5, 2.5), z = gz + rng.range(-2.5, 2.5);
      const hit = islandAt(x, z);
      if (!hit || hit.k > 0.92) continue;
      // Woods thicken toward each island's rim, framing the edge.
      const woods = fbm(x * 0.014 + 40, z * 0.014 - 20, 4) + (hit.k > 0.65 ? 0.12 : 0);
      if (woods < 0.5) continue;
      // On the neighbourhoods, trees gather in groves with open clearings between them.
      if (hit.isl.id !== 'downtown' && fbm(x * 0.022 + 7, z * 0.022 - 3, 3) < 0.47) continue;
      if (built(x, z, 4)) continue;
      const y = heightAt(x, z);
      const isPine = y > 9 ? rng() < 0.65 : rng() < 0.28;
      const kind = isPine ? rng.pick(MODELS.pine) : rng.pick(MODELS.common);
      const blossom = !isPine && fbm(x * 0.025 - 70, z * 0.025 + 15, 2) > 0.6;
      const tint = isPine ? rng.pick(PINES) : blossom ? rng.pick(BLOSSOM) : rng.pick(GREENS);
      const scale = rng.range(0.95, 1.45);
      forest.add(kind, x, y - 0.15, z, { scale, rotY: rng() * Math.PI * 2, tilt: 0.08, tint });
      trees.push([x, z]);
      shadeSpots.push([x, z, 3.2 * scale, 0.35]);
    }
  }
  // Street trees along the walkways, spaced out, blossom-heavy for a planned feel.
  for (let i = 0; i < 2200; i++) {
    const x = rng.range(-R, R), z = rng.range(-R, R);
    const rd = roadDistance(x, z);
    if (rd < 2.2 || rd > 4.5 || !onLand(x, z) || nearDome(x, z, 3) || downtownDist(x, z) < DOWNTOWN.r + 3) continue;
    if (noise2(x * 0.08, z * 0.08) < 0.68) continue;
    if (islandAt(x, z)?.isl.id !== 'downtown' && rng() < 0.45) continue;
    const scale = rng.range(0.7, 0.95);
    forest.add(rng.pick(MODELS.common), x, heightAt(x, z) - 0.1, z, { scale, rotY: rng() * Math.PI * 2, tint: rng() < 0.55 ? rng.pick(BLOSSOM) : rng.pick(GREENS) });
    shadeSpots.push([x, z, 2.6 * scale, 0.3]);
  }

  // Undergrowth around the forest trees.
  for (const [tx, tz] of trees) {
    const n = Math.floor(rng.range(0, 2.6));
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2, d = rng.range(1.5, 4);
      const x = tx + Math.cos(a) * d, z = tz + Math.sin(a) * d;
      if (!onLand(x, z) || built(x, z, 1)) continue;
      const pick = rng();
      const name = pick < 0.4 ? rng.pick(MODELS.bush) : pick < 0.82 ? rng.pick(MODELS.ferns) : pick < 0.9 ? MODELS.mushrooms[0] : rng.pick(MODELS.rocks);
      low.add(name, x, heightAt(x, z), z, { scale: rng.range(0.7, 1.2), rotY: rng() * Math.PI * 2, tint: rng.pick(GREENS) });
    }
  }

  // Meadow grass in patches and flowers in drifts.
  for (let i = 0; i < 9000; i++) {
    const [x, z] = randomOnIslands(rng);
    const dens = fbm(x * 0.05 + 3, z * 0.05 + 8, 3);
    if (dens < 0.44) continue;
    if (!onLand(x, z) || roadDistance(x, z) < 0.8 + noise2(x, z) || nearDome(x, z, 1.5) || downtownDist(x, z) < DOWNTOWN.r + 1 || falls.streamDistance(x, z) < 0.6) continue;
    const tall = dens > 0.6;
    const name = tall ? (rng() < 0.7 ? 'Grass_Common_Tall' : 'Grass_Wispy_Tall') : rng() < 0.8 ? 'Grass_Common_Short' : 'Grass_Wispy_Short';
    const opts = { scale: rng.range(0.6, 1.0), rotY: rng() * Math.PI * 2, tint: rng.pick(GRASS) };
    // Not on a portal's pad (the user, 10-18: "the grass is passing through the portal hub").
    if (nearPortal(x, z, 0.5)) continue;
    low.add(name, x, heightAt(x, z), z, opts);
  }
  for (let i = 0; i < 1600; i++) {
    const [x, z] = randomOnIslands(rng);
    if (noise2(x * 0.06 - 9, z * 0.06 + 2) < 0.62) continue;
    if (!onLand(x, z) || roadDistance(x, z) < 1 || nearDome(x, z, 1.5) || downtownDist(x, z) < DOWNTOWN.r + 1) continue;
    const flower = rng.pick(MODELS.flowers), opts = { scale: rng.range(0.6, 1.0), rotY: rng() * Math.PI * 2 };
    if (nearPortal(x, z, 0.5)) continue;
    bloom.add(flower, x, heightAt(x, z), z, opts);
  }
  // Boulders on the hills and near the rims.
  for (let i = 0; i < 200; i++) {
    const [x, z] = randomOnIslands(rng);
    if (!onLand(x, z, 0.97) || built(x, z, 6)) continue;
    const y = heightAt(x, z);
    const scale = rng.range(0.8, 2.2);
    props.add(rng.pick(MODELS.rocks), x, y - 0.3, z, { scale, rotY: rng() * Math.PI * 2, tilt: 0.3 });
    shadeSpots.push([x, z, 1.8 * scale, 0.3]);
  }

  // Rocks along both banks of each stream, and a few where it rises.
  for (const f of falls.falls) {
    const ox = Math.cos(f.a), oz = Math.sin(f.a);
    for (let k = 0; k < 7; k++) {
      const back = k === 6 ? 13 : rng.range(0.5, 10);
      const side = k === 6 ? rng.range(-1, 1) : k % 2 ? 1 : -1;
      const off = k === 6 ? side * 1.5 : side * (f.w * 0.5 * (0.6 + 0.4 * (1 - back / 12)) + rng.range(0.9, 2));
      const x = f.x - ox * back - oz * off, z = f.z - oz * back + ox * off;
      if (!onLand(x, z, 0.99)) continue;
      props.add(rng.pick(MODELS.rocks), x, heightAt(x, z) - 0.3, z, { scale: rng.range(0.7, 1.4), rotY: rng() * Math.PI * 2, tilt: 0.3 });
    }
  }

  // Downtown: a ring of blossom trees around the plaza edge, leaving the hub and the spokes clear.
  for (let k = 0; k < 18; k++) {
    const a = (k / 18) * Math.PI * 2 + 0.11;
    const x = DOWNTOWN.x + Math.cos(a) * (DOWNTOWN.r - 2.5), z = DOWNTOWN.z + Math.sin(a) * (DOWNTOWN.r - 2.5);
    if (Math.abs(z) < hub.depth / 2 + 4 && Math.abs(x) < hub.width / 2 + 4) continue;
    if (plaza.spots.some(([px, pz]) => Math.hypot(x - px, z - pz) < 5)) continue;
    if (roadDistance(x, z) < 2.5) continue;
    forest.add(rng.pick(MODELS.common), x, heightAt(x, z), z, { scale: 0.7, rotY: rng() * Math.PI * 2, tint: rng.pick(BLOSSOM) });
  }

  // Flowers and bushes in the plaza planters.
  for (const [px, pz, h] of plaza.planters) {
    const w = plaza.group.localToWorld(new THREE.Vector3(px, h, pz));
    low.add(rng.pick(MODELS.bush), w.x, w.y, w.z, { scale: 0.8, rotY: rng() * Math.PI * 2, tint: rng.pick(GREENS) });
    for (let k = 0; k < 3; k++) bloom.add(rng.pick(MODELS.flowers), w.x + rng.range(-0.6, 0.6), w.y, w.z + rng.range(-0.6, 0.6), { scale: 0.9, rotY: rng() * Math.PI * 2 });
  }

  // Dome gardens.
  for (const dome of domes) {
    const b = BIOMES[dome.biome];
    const y = dome.group.position.y;
    const place = (count, pad, minR, fn) => {
      let placed = 0;
      for (let tries = 0; tries < count * 12 && placed < count; tries++) {
        const a = rng() * Math.PI * 2, r = rng.range(minR, DOME_R - 1.5);
        const lx = Math.sin(a) * r, lz = Math.cos(a) * r;
        if (!dome.isClear(lx, lz, pad)) continue;
        const w = dome.toWorld(lx, lz);
        fn(w.x, w.z);
        placed++;
      }
    };
    // Trees must clear the curved glass: canopy edge and crown both inside the dome.
    const inside = DOME_R - 0.7;
    let planted = 0;
    for (let tries = 0; tries < 200 && planted < b.treeCount; tries++) {
      const name = rng.pick(b.trees);
      const scale = rng.range(...b.treeScale);
      const box = info(name).box;
      const reach = Math.max(...[box.min.x, box.max.x].flatMap((bx) => [box.min.z, box.max.z].map((bz) => Math.hypot(bx, bz)))) * scale * 0.85;
      const h = box.max.y * scale;
      const a = rng() * Math.PI * 2, r = rng.range(3, inside - reach);
      if (r <= 3) continue;
      if ((r + reach) ** 2 + (h * 0.8) ** 2 > inside * inside || r * r + h * h > inside * inside) continue;
      const lx = Math.sin(a) * r, lz = Math.cos(a) * r;
      if (!dome.isClear(lx, lz, 3)) continue;
      const w = dome.toWorld(lx, lz);
      forest.add(name, w.x, y - 0.1, w.z, { scale, rotY: rng() * Math.PI * 2, tint: rng.pick(b.tints) });
      shadeSpots.push([w.x, w.z, 3 * scale, 0.35]);
      planted++;
    }
    place(b.underCount, 0.3, 2, (x, z) => plant(rng.pick(b.under), x, y, z, { scale: rng.range(0.6, 1.1), rotY: rng() * Math.PI * 2, tint: rng.pick(dome.biome === 'frost' || dome.biome === 'moon' ? b.tints : GREENS) }));
    if (b.flowers) place(b.flowers, 0.3, 3, (x, z) => bloom.add(rng.pick(MODELS.flowers), x, y + 0.06, z, { scale: rng.range(0.7, 0.95), rotY: rng() * Math.PI * 2 }));
    place(b.grass, 0, 1, (x, z) => low.add(rng() < 0.6 ? 'Grass_Common_Short' : 'Grass_Common_Tall', x, y, z, { scale: rng.range(0.5, 0.85), rotY: rng() * Math.PI * 2, tint: dome.biome === 'grove' ? '#6fbf55' : rng.pick(GRASS) }));
    for (let lz = DOME_R - 1; lz > dome.homeZ + dome.home.front; lz -= 1.3) {
      const w = dome.toWorld(Math.sin(lz * 0.25) * 0.8 + rng.range(-0.3, 0.3), lz);
      low.add(rng.pick(MODELS.path), w.x, y + 0.02, w.z, { scale: rng.range(1.1, 1.4), rotY: rng() * Math.PI * 2 });
    }
  }

  // Rocks, bushes and the taller flowers a walker goes round (src/travel.js), taken before building them:
  // building empties each set's list, and these used to be read after, so none of them stopped anything
  // (B, 10-21: the user's Chog rode through everything).
  // Each by its own shape at body height (footprint): rocks firm, bushes and flowers a little soft. Not grass.
  const propObstacles = [];
  for (const [set, tallest, soft] of [[props, 0.55, 0.95], [low, 1.0, 0.85], [bloom, 0.85, 0.8]]) {
    for (const [name, all] of set.items) {
      if (/^Grass/.test(name)) continue;
      const c = info(name);
      for (const m of all) if (c.height * m.getMaxScaleOnAxis() >= tallest) addFootprint(propObstacles, name, m, soft);
    }
  }
  forest.build(scene, renderer);
  props.build(scene, { shadows: true, chunk: 64 });
  const lowMeshes = low.build(scene, { shadows: false, chunk: 40 });
  // Where the flowers stand, for the little monsters that flit about them (src/birds.js; build empties it).
  const flowerSpots = [...bloom.items.values()].flat().map((m) => new THREE.Vector3(m.elements[12], m.elements[13], m.elements[14]));
  const bloomMeshes = bloom.build(scene, { shadows: false, chunk: 70 });
  // What a walking Chog goes round (src/travel.js; A, the user 10-17: Chogs walked through flowers and
  // things): each tree by its trunk, rocks, bushes and the taller flowers by their footprint. Grass and low
  // plants it walks through.
  const obstacles = [...propObstacles];
  const reach = (box) => Math.max(...[box.min.x, box.max.x].flatMap((bx) => [box.min.z, box.max.z].map((bz) => Math.hypot(bx, bz))));
  // Trees by their trunk, and their branches where they hang as low as a Chog (pines' do).
  for (const t of forest.trees) {
    const s = t.m.getMaxScaleOnAxis();
    obstacles.push({ x: t.x, y: t.m.elements[13], z: t.z, r: THREE.MathUtils.clamp(reach(info(t.name).box) * 0.16, 0.35, 1.1) * s });
    addFootprint(obstacles, t.name, t.m, 0.95);
  }
  terrain.shade(shadeSpots);

  // Small plants only draw near the camera.
  const lowChunks = lowMeshes.map((m) => ({ mesh: m, c: m.boundingSphere.center.clone(), r: m.boundingSphere.radius }));
  const bloomChunks = bloomMeshes.map((m) => ({ mesh: m, c: m.boundingSphere.center.clone(), r: m.boundingSphere.radius }));
  let lowDist = 85;
  let bloomDist = 270;

  // What the camera keeps out of: each dome and the house in it, and the hub's three pods and tunnels.
  const solids = [];
  // Rooms you can go into: each with the pod holding the camera inside, and a framed view.
  const rooms = [];
  const addRoom = (id, name, room, pod, place) => {
    room.group.updateMatrixWorld(true);
    const { w, d, h } = room;
    const at = (x, y, z) => room.group.localToWorld(new THREE.Vector3(x, y, z));
    rooms.push({ id, name, room, pod, place, view: { pos: at(w * 0.34, h * 0.68, d * 0.4), target: at(-w * 0.08, h * 0.28, -d * 0.18), enter: true } });
    solids.push(pod);
  };
  domes.forEach((d, i) => {
    const p = d.group.position;
    const dome = new Pod({ x: p.x, y: p.y, z: p.z, r: d.radius, cap: d.radius, facing: d.group.rotation.y, doorHalf: 2.2, enterable: true });
    solids.push(dome);
    const h = d.toWorld(0, d.home.center);
    const house = new Pod({ x: h.x, y: p.y, z: h.z, r: 7.8, wall: 4.8, cap: 2.6, margin: 0.8 });
    solids.push(house);
    const { w, d: dd, h: hh } = d.room;
    const room = new RoomBox({ x: h.x, y: p.y + 0.2, z: h.z, w, d: dd, h: hh, rot: d.group.rotation.y, within: [house, dome], parent: dome });
    addRoom(`home${i}`, 'Home', d.room, room, `dome${i}`);
  });
  const hp = hub.group.position;
  const lobbyPod = new Pod({ x: hp.x, y: hp.y, z: hp.z, r: 17.8, wall: 11, cap: 14, margin: 1.5 });
  solids.push(lobbyPod);
  const wings = [-1, 1].map((side) => new Pod({ x: hp.x + side * 37, y: hp.y, z: hp.z, r: 12.3, wall: 7.5, cap: 3.5, margin: 1.5 }));
  solids.push(...wings);
  for (const side of [-1, 1]) solids.push(new Pod({ x: hp.x + side * 20.8, y: hp.y, z: hp.z, r: 5, wall: 8, cap: 0.5, margin: 1.2 }));
  for (const r of hub.rooms) {
    const c = r.at.clone().add(hp);
    const { w, d, h } = r.room;
    const shell = r.shell === 'lobby' ? lobbyPod : r.shell === 'casino' ? wings[1] : wings[0];
    const pod = new RoomBox({ x: c.x, y: c.y, z: c.z, w, d, h, doorHalf: r.id === 'lobby' ? 1.8 : 1.6, within: [shell] });
    addRoom(r.id, r.name, r.room, pod, 'hub');
  }

  const cosmo = buildCosmoDome(domes[COSMO_DOME]);

  return {
    obstacles,
    domes,
    cosmo,
    solids,
    bridges: bridges.paths,
    tunnels,
    rooms,
    plaza: plaza.group,
    terrain,
    forest,
    flowers: flowerSpots,
    // The street lamps along the walks, [x, z] in the world (src/roads.js), for what a walker bumps into.
    lamps: roads.lamps ?? [],
    hub,
    setQuality(q) {
      forest.lodDist = [45, 65, 90][q];
      forest.maxNear = [70, 120, 200][q];
      lowDist = [55, 85, 120][q];
      bloomDist = [230, 270, 320][q];
      forest.update(forest.last, true);
    },
    update(env, t, camera, dt = 0.016) {
      for (const d of domes) d.update(env, renderer);
      cosmo.update(dt, camera);
      // A room draws only while the camera is in it; from outside its building hides it anyway.
      for (const r of rooms) r.room.group.visible = r.pod.inside(camera.position, 1.5);
      roads.update(env, renderer);
      bridges.update(env, renderer);
      tunnels.update?.(env, renderer, dt);
      skyRocks.update(t);
      falls.update(env, t);
      hub.update(env, t, renderer);
      plaza.update(env, t, renderer);
      terrain.update(env, sky, camera);
      undersides.update(env);
      landmarks.update(env, t, dt);
      forest.setLight(env);
      forest.update(camera.position);
      const cp = camera.position;
      for (const ch of lowChunks) ch.mesh.visible = ch.c.distanceTo(cp) - ch.r < lowDist;
      for (const ch of bloomChunks) ch.mesh.visible = ch.c.distanceTo(cp) - ch.r < bloomDist;
    },
  };
}
