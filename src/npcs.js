import * as THREE from 'three';
import { makeChog } from './chog.js';
import { chogInfo } from './chogdata.js';
import { HOODS, roadDistance, nearDome } from './layout.js';
import { heightAt, islandAt } from './terrain.js';
import { angleLerp } from './util.js';

/*
 * The Chogs who live round the world, in a few sets, each loaded only once the camera comes near it
 * (the files are about 2 MB each, so none of them is in the first load) and compiled before it shows.
 *
 *   plaza    the singer on their stage with a crowd watching, two Chogs strolling round the fountain,
 *            and one by the lobby door
 *   sniffer  out on the tree island, nose in its flowers
 *   runner   the dino lapping the loop on the beacon island with a toy block over its head
 *   walker   an astronaut walking the loop on the middle island
 *
 * The bar's bartender and regulars are in src/barchat.js. Each Chog here is its own rigged model from
 * public/models/npcs/ (C's cast); ?npcs shows every slot even before it is near.
 */

const M = (file) => `models/npcs/${file}.glb`;
export const NPC_SLOTS = {
  // Faces out over the plaza, between the fountain and the walk the downtown view looks along.
  singer: { glb: M('singer'), plaza: [27, 30], faces: [10, 55] },
  // Watching from an arc in front of the stage (the middle left clear, so the singer can be seen):
  // plain Chogs in a few shades, a banana and a dragon.
  crowd: { plain: M('plain'), named: [{ id: 132, glb: M('chog-132') }, { id: 37, glb: M('chog-37') }] },
  // Strolling round the fountain, the opposite ways.
  strollers: [
    { id: 66, glb: M('chog-66'), speed: 1.7, dir: 1, phase: 0 },
    { id: 409, glb: M('chog-409'), speed: 1.3, dir: -1, phase: 2.6 },
  ],
  // By the lobby door, in the Monad look.
  doorman: { id: 1151, glb: M('chog-1151'), plaza: [-5.2, 23.2] },
  sniffer: { glb: M('sniffer'), hood: 0 },
  runner: { glb: M('dino'), hood: 2, speed: 0.22 },
  walker: { id: 68, glb: M('chog-68'), hood: 1, speed: -0.07 },
};

const FOUNTAIN = new THREE.Vector3(0, 0, 40);
const STROLL_R = 15;
// Sets load once the camera is this close (one at a time, the nearest first), and are drawn and
// animated once it is closer still.
const LOAD = 300;
const NEAR = 260;
// Outdoors everything is built bigger than life (the plaza's benches and lamps are 1.7x, plaza.js),
// so the characters out there are too, to sit right beside them.
const OUTDOOR = 1.7;

// One of the cast: its own model, and for a token Chog its traits and name (no aura ring under a model).
// Out here they are seen from a way off, so each is a lighter copy of its model.
const KEEP = 0.3;
async function npc(glb, id = null, tint = null) {
  const info = id ? await chogInfo(id) : {};
  return makeChog({ ...info, traits: { ...info.traits, Aura: null }, model: glb, tint, keep: KEEP });
}

/**
 * The singer: one file with its own stage, driven like any Chog (its face sings along), with the mic
 * stand cut away so only the mic in its hand is left.
 */
async function singerNpc(url) {
  const chog = await makeChog({ model: url });
  chog.root.updateMatrixWorld(true);
  chog.root.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    dropStand(o);
    o.receiveShadow = true;
  });
  return chog;
}

/*
 * The singer's file has a mic on a stand as well as the one in its hand, all fused into one mesh. The
 * stand goes: the triangles round its pole and its mic, which only the root holds (no arm, hand or head
 * moves them), so the singer is left with the mic in its hand. Returns the triangle numbers to drop.
 */
const STAGE_FLOOR = 0.258;
const HOLDERS = ['UpperArmL', 'ForeArmL', 'HandL', 'UpperArmR', 'ForeArmR', 'HandR', 'Head', 'Neck'];
export function standTriangles(mesh) {
  const geo = mesh.geometry;
  const pos = geo.attributes.position, si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
  const names = mesh.skeleton.bones.map((b) => b.name);
  const rootI = names.indexOf('Root');
  const holders = new Set(HOLDERS.map((n) => names.indexOf(n)));
  const weightOn = (i, test) => {
    let w = 0;
    for (let j = 0; j < 4; j++) if (test(si.getComponent(i, j))) w += sw.getComponent(i, j);
    return w;
  };
  const v = new THREE.Vector3();
  const world = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) world.set(v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).toArray(), i * 3);
  // Vertices at one place are one vertex (UV seams split them in the file).
  const weld = new Map();
  const canon = new Int32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const k = `${world[i * 3].toFixed(4)},${world[i * 3 + 1].toFixed(4)},${world[i * 3 + 2].toFixed(4)}`;
    if (!weld.has(k)) weld.set(k, i);
    canon[i] = weld.get(k);
  }
  const idx = geo.index.array;
  const nbrs = new Map();
  const link = (a, b) => (nbrs.get(a) ?? nbrs.set(a, []).get(a)).push(b);
  for (let t = 0; t < idx.length; t += 3) {
    const a = canon[idx[t]], b = canon[idx[t + 1]], c = canon[idx[t + 2]];
    link(a, b), link(b, a), link(b, c), link(c, b), link(a, c), link(c, a);
  }
  // Seed: the stand's mic, held by the root alone at mouth height, away from the body's middle.
  const seeds = [];
  for (let i = 0; i < pos.count; i++) {
    const y = world[i * 3 + 1];
    if (canon[i] === i && y > 0.9 && y < 1.4 && weightOn(i, (b) => b === rootI) > 0.9) seeds.push(i);
  }
  const inStand = new Uint8Array(pos.count);
  if (!seeds.length) return new Set();
  let ax = 0, az = 0;
  for (const i of seeds) (ax += world[i * 3]), (az += world[i * 3 + 2]);
  ax /= seeds.length;
  az /= seeds.length;
  // Flood down the stand's surface: above the stage floor, near its line, never into an arm or the head.
  const queue = [...seeds];
  for (const i of seeds) inStand[i] = 1;
  while (queue.length) {
    const i = queue.pop();
    for (const j of nbrs.get(i) ?? []) {
      if (inStand[j]) continue;
      const x = world[j * 3], y = world[j * 3 + 1], z = world[j * 3 + 2];
      if (y < STAGE_FLOOR || Math.hypot(x - ax, z - az) > 0.42 || weightOn(j, (b) => holders.has(b)) > 0.3) continue;
      inStand[j] = 1;
      queue.push(j);
    }
  }
  // Its round foot stays: the stage has no floor under it.
  const cut = new Set();
  for (let t = 0; t < idx.length; t += 3) if (inStand[canon[idx[t]]] && inStand[canon[idx[t + 1]]] && inStand[canon[idx[t + 2]]]) cut.add(t / 3);
  return cut;
}
export function dropStand(mesh) {
  const geo = mesh.geometry;
  if (geo.userData.standCut) return;
  const cut = standTriangles(mesh);
  const idx = geo.index.array;
  const kept = new (idx.constructor)(idx.length - cut.size * 3);
  let o = 0;
  for (let t = 0; t < idx.length; t += 3) if (!cut.has(t / 3)) kept.set([idx[t], idx[t + 1], idx[t + 2]], (o += 3) - 3);
  geo.setIndex(new THREE.BufferAttribute(kept, 1));
  geo.userData.standCut = true;
}

// The singer's set, on a loop: eight bars of the song, a cheer, a breather.
const SET = [['sing', 19.2], ['cheer', 2.66], ['idle', 4]];

// Someone who mostly stands about: idle, now and then a wave or a cheer (each at its own rhythm).
function idler(chog, moves = ['wave'], every = [9, 16]) {
  let left = every[0] + Math.random() * (every[1] - every[0]);
  let busy = 0;
  chog.play('idle');
  return (dt) => {
    if (busy > 0) {
      busy -= dt;
      if (busy <= 0) chog.play('idle');
      return;
    }
    left -= dt;
    if (left > 0) return;
    chog.play(moves[Math.floor(Math.random() * moves.length)]);
    busy = 2.4;
    left = every[0] + Math.random() * (every[1] - every[0]);
  };
}

// A few shades for the plain Chogs in the crowd, so they read as different Chogs.
const SHADES = ['#ffffff', '#f3e3ff', '#ffe8d6', '#e2f4ff', '#e6ffe8', '#ffe1ee'];

// A toy block: a chunky cube, a different colour on each face.
function toyBlock() {
  const mats = ['#e8484f', '#4f7fe0', '#f2c94c', '#5fbf6a', '#b07cf0', '#f08a3a'].map((c) => new THREE.MeshLambertMaterial({ color: c }));
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.45), mats);
  m.castShadow = true;
  return m;
}

// A spot out on a neighbourhood: on the grass, off the roads, clear of domes and the landmark.
function openSpot(hood, from, step = 0.35) {
  for (let i = 0; i < 40; i++) {
    const a = from + i * step;
    for (const r of [34, 38, 30]) {
      const x = hood.x + Math.cos(a) * r, z = hood.z + Math.sin(a) * r;
      const hit = islandAt(x, z);
      if (!hit || hit.k > 0.85 || roadDistance(x, z) < 5 || nearDome(x, z, 4)) continue;
      return new THREE.Vector3(x, heightAt(x, z), z);
    }
  }
  return new THREE.Vector3(hood.x, heightAt(hood.x, hood.z), hood.z);
}

/**
 * The sets, each built the first time the camera comes near (or at once with standees: show every
 * slot, ?npcs). plaza is the plaza group (its origin is the square's). quality 'low' has a smaller crowd.
 * prewarm(obj) compiles a set's shaders before it shows.
 */
export async function buildNpcs({ scene, plaza, standees = false, prewarm, quality = 'high' }) {
  const actors = [];
  const sets = [];
  const wp = new THREE.Vector3();
  let t = 0;

  // A set: where it is (for the distance check), and how to build it.
  const set = (where, build) => sets.push({ where, build, state: 'waiting' });
  const shown = async (group, chogs) => {
    await prewarm?.(group);
    return chogs;
  };

  // ---------- the plaza ----------
  const s = NPC_SLOTS.singer;
  const square = new THREE.Group();
  plaza.add(square);
  square.position.set(s.plaza[0], 0, s.plaza[1]);
  square.scale.setScalar(OUTDOOR);
  const facing = Math.atan2(s.faces[0] - s.plaza[0], s.faces[1] - s.plaza[1]);
  set(
    (v) => square.getWorldPosition(v),
    async () => {
      const chogs = [];
      const ticks = [];
      // The singer, not turning (the stage and stand are part of it).
      const singer = await singerNpc(s.glb);
      singer.root.rotation.y = facing;
      square.add(singer.root);
      chogs.push(singer);
      let part = 0;
      let left = SET[0][1];
      singer.play(SET[0][0]);
      ticks.push((dt) => {
        left -= dt;
        if (left > 0) return;
        part = (part + 1) % SET.length;
        left = SET[part][1];
        singer.play(SET[part][0]);
      });
      // The crowd, in an arc in front of the stage, watching and cheering.
      const plain = quality === 'low' ? 3 : 5;
      const who = [
        ...Array.from({ length: plain }, (_, i) => ({ glb: NPC_SLOTS.crowd.plain, tint: new THREE.Color(SHADES[i % SHADES.length]) })),
        ...NPC_SLOTS.crowd.named,
      ];
      const crowd = await Promise.all(who.map((w) => npc(w.glb, w.id ?? null, w.tint ?? null)));
      const spots = [0.5, -0.5, 0.95, -0.95, 1.4, -1.4, 1.8].slice(0, crowd.length);
      crowd.forEach((c, i) => {
        const a = facing + spots[i];
        const r = 4.1 + (i % 2) * 0.5;
        c.root.position.set(Math.sin(a) * r, 0, Math.cos(a) * r);
        c.root.rotation.y = a + Math.PI;
        c.root.scale.setScalar(0.94 + ((i * 37) % 11) / 100);
        // A spectator's shadow is barely seen under the others; on the laptop's settings, skip them.
        if (quality === 'low') c.root.traverse((o) => o.isMesh && (o.castShadow = false));
        square.add(c.root);
        chogs.push(c);
        ticks.push(idler(c, ['cheer', 'cheer', 'wave'], [3, 9]));
      });
      // Strolling round the fountain, now and then stopping to wave.
      for (const w of NPC_SLOTS.strollers) {
        const c = await npc(w.glb, w.id);
        c.root.scale.setScalar(OUTDOOR);
        plaza.add(c.root);
        chogs.push(c);
        // Walk at the pace its legs move (plaza space: the plaza group is at world scale).
        const pace = (c.speedOf('walk') || w.speed) * OUTDOOR;
        const legs = c.paceFor('walk');
        let angle = w.phase;
        let pause = 0;
        let next = 8 + Math.random() * 10;
        c.play('walk');
        c.setPace(legs);
        ticks.push((dt) => {
          if (pause > 0) {
            pause -= dt;
            if (pause <= 0) c.play('walk'), c.setPace(legs);
            return;
          }
          next -= dt;
          if (next <= 0) {
            pause = 3.2;
            next = 12 + Math.random() * 12;
            c.play(Math.random() < 0.6 ? 'wave' : 'idle');
            return;
          }
          angle += (dt * pace * w.dir) / STROLL_R;
          c.root.position.set(FOUNTAIN.x + Math.sin(angle) * STROLL_R, 0, FOUNTAIN.z + Math.cos(angle) * STROLL_R);
          c.root.rotation.y = angle + (w.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
        });
      }
      // By the lobby door, greeting whoever comes up the walk.
      const d = NPC_SLOTS.doorman;
      const doorman = await npc(d.glb, d.id);
      doorman.root.scale.setScalar(OUTDOOR);
      doorman.root.position.set(d.plaza[0], 0, d.plaza[1]);
      doorman.root.rotation.y = Math.atan2(FOUNTAIN.x - d.plaza[0], FOUNTAIN.z - d.plaza[1]);
      plaza.add(doorman.root);
      chogs.push(doorman);
      ticks.push(idler(doorman, ['wave', 'talk'], [7, 13]));
      await prewarm?.(plaza);
      return { group: square, chogs, tick: (tt, dt) => ticks.forEach((f) => f(dt)), extra: [...chogs.slice(-NPC_SLOTS.strollers.length - 1).map((c) => c.root)] };
    },
  );

  // ---------- the sniffer, at its flowers on the tree island ----------
  const hood0 = HOODS[NPC_SLOTS.sniffer.hood];
  const patch = new THREE.Group();
  patch.position.copy(openSpot(hood0, hood0.angle + Math.PI + 0.9));
  // Its model faces -x, toward its flowers: the group turns it to face across the island.
  patch.rotation.y = Math.atan2(hood0.x - patch.position.x, hood0.z - patch.position.z) + Math.PI / 2;
  patch.scale.setScalar(OUTDOOR);
  scene.add(patch);
  set(
    (v) => patch.getWorldPosition(v),
    async () => {
      const sniffer = await npc(NPC_SLOTS.sniffer.glb);
      patch.add(sniffer.root);
      // Mostly nose in the flowers, now and then a look up.
      let left = 6;
      let up = false;
      sniffer.play('sniff');
      return {
        group: patch,
        chogs: await shown(patch, [sniffer]),
        tick: (tt, dt) => {
          left -= dt;
          if (left > 0) return;
          up = !up;
          sniffer.play(up ? 'idle' : 'sniff');
          left = up ? 3 : 8 + Math.random() * 6;
        },
      };
    },
  );

  // ---------- the dino, lapping the beacon island with its block ----------
  const hood2 = HOODS[NPC_SLOTS.runner.hood];
  const lap = new THREE.Group();
  scene.add(lap);
  const lapAt = (a, hood) => new THREE.Vector3(hood.x + Math.cos(a) * hood.loopR, 0, hood.z + Math.sin(a) * hood.loopR);
  let runAngle = 0;
  set(
    (v) => v.copy(lapAt(runAngle, hood2)),
    async () => {
      const dino = await npc(NPC_SLOTS.runner.glb);
      dino.root.scale.setScalar(OUTDOOR);
      lap.add(dino.root);
      const block = toyBlock();
      dino.root.add(block);
      const head = dino.root.getObjectByName('Head');
      const hp = new THREE.Vector3();
      // Its run at the speed its legs carry it (else its feet slide), easing up to speed and back down,
      // in bursts: run a while, skid to a stop, look about with the block held up, now and then turn and
      // run back the other way.
      const top = (dino.speedOf('run') || 3) * OUTDOOR;
      const R = hood2.loopR;
      let speed = 0;
      let dir = 1;
      let yaw = Math.atan2(-Math.sin(runAngle), Math.cos(runAngle));
      let mode = 'run';
      let left = 7 + Math.random() * 5;
      let lean = 0;
      dino.play('run');
      const step2 = (tt, dt) => {
        left -= dt;
        if (mode === 'run' && left <= 0) (mode = 'stop'), (left = 0.5);
        else if (mode === 'stop' && speed < 0.15) {
          mode = 'rest';
          left = 2.2 + Math.random() * 2.5;
          dino.play('idle');
        } else if (mode === 'rest' && left <= 0) {
          if (Math.random() < 0.35) dir = -dir;
          mode = 'run';
          left = 6 + Math.random() * 7;
          dino.play('run');
        }
        const want = mode === 'run' ? top : 0;
        speed += (want - speed) * (1 - Math.exp(-dt * (mode === 'stop' ? 5 : 2.2)));
        runAngle += (dt * speed * dir) / R;
        dino.setPace(mode === 'rest' ? 1 : THREE.MathUtils.clamp(speed / top, 0.35, 1.15));
        const p = lapAt(runAngle, hood2);
        dino.root.position.set(p.x, heightAt(p.x, p.z), p.z);
        // Facing the way it's going; a turn back takes about half a second.
        const heading = Math.atan2(-Math.sin(runAngle), Math.cos(runAngle)) + (dir < 0 ? Math.PI : 0);
        yaw = angleLerp(yaw, heading, 1 - Math.exp(-dt * 7));
        dino.root.rotation.y = yaw;
        // Lean into the curve a little at speed.
        lean += ((speed * speed) / R * 0.02 * dir - lean) * (1 - Math.exp(-dt * 4));
        dino.root.rotation.z = lean;
        // The block rides on its head; held higher, with a little wiggle, while it rests.
        hp.set(0, 1.1, 0);
        if (head) {
          dino.root.updateMatrixWorld();
          dino.root.worldToLocal(head.getWorldPosition(hp));
        }
        const proud = mode === 'rest' ? Math.min(1, 1.5 * (3 - left)) : 0;
        block.position.set(hp.x, hp.y + 1.02 + Math.abs(Math.sin(tt * 9)) * 0.04 * (speed / top) + proud * 0.12, hp.z);
        block.rotation.set(Math.sin(tt * 4.5) * 0.15 * (speed / top), proud * Math.sin(tt * 3) * 0.4, 0);
      };
      step2(0, 0);
      return {
        group: lap,
        chogs: await shown(lap, [dino]),
        where: (v) => v.copy(lapAt(runAngle, hood2)),
        tick: (tt, dt) => step2(tt, dt),
      };
    },
  );

  // ---------- the astronaut, walking the loop on the middle island ----------
  const w = NPC_SLOTS.walker;
  const hood1 = HOODS[w.hood];
  const stroll = new THREE.Group();
  scene.add(stroll);
  let walkAngle = 1.2;
  set(
    (v) => v.copy(lapAt(walkAngle, hood1)),
    async () => {
      const astro = await npc(w.glb, w.id);
      astro.root.scale.setScalar(OUTDOOR);
      stroll.add(astro.root);
      const start = lapAt(walkAngle, hood1);
      astro.root.position.set(start.x, heightAt(start.x, start.z), start.z);
      astro.play('walk');
      const pace = (astro.speedOf('walk') || 1) * OUTDOOR;
      astro.setPace(astro.paceFor('walk'));
      let pause = 0;
      let next = 14;
      return {
        group: stroll,
        chogs: await shown(stroll, [astro]),
        where: (v) => v.copy(lapAt(walkAngle, hood1)),
        tick: (tt, dt) => {
          if (pause > 0) {
            pause -= dt;
            if (pause <= 0) astro.play('walk'), astro.setPace(astro.paceFor('walk'));
            return;
          }
          if ((next -= dt) <= 0) {
            pause = 3;
            next = 14 + Math.random() * 10;
            astro.play('wave');
            return;
          }
          walkAngle += (dt * pace * Math.sign(w.speed)) / hood1.loopR;
          const p = lapAt(walkAngle, hood1);
          astro.root.position.set(p.x, heightAt(p.x, p.z), p.z);
          astro.root.rotation.y = Math.atan2(Math.sin(walkAngle), -Math.cos(walkAngle));
        },
      };
    },
  );

  // Build a set the first time it is near: fetched, compiled, then shown.
  function load(st) {
    st.state = 'loading';
    st.build()
      .then((a) => {
        st.state = 'ready';
        actors.push(a);
      })
      .catch((err) => {
        st.state = 'failed';
        console.warn('Chogs about town:', err?.message ?? err);
      });
  }
  if (standees) sets.forEach(load);

  return {
    actors,
    // A set still loading: the demo's shots wait for them all (B13).
    get loading() {
      return sets.some((st) => st.state === 'loading');
    },
    update(dt, camera) {
      t += dt;
      if (!sets.some((st) => st.state === 'loading')) {
        let nearest = null;
        let best = LOAD;
        for (const st of sets) {
          if (st.state !== 'waiting') continue;
          st.where(wp);
          const d = camera.position.distanceTo(wp);
          if (d < best) {
            best = d;
            nearest = st;
          }
        }
        if (nearest) load(nearest);
      }
      for (const a of actors) {
        if (a.where) a.where(wp);
        else a.group.getWorldPosition(wp);
        const near = camera.position.distanceTo(wp) < NEAR;
        a.group.visible = near;
        for (const r of a.extra ?? []) r.visible = near;
        if (!near) continue;
        a.tick?.(t, dt);
        for (const c of a.chogs) c.update(dt, camera);
      }
    },
  };
}
