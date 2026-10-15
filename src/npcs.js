import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { makeChog } from './chog.js';
import { chogInfo } from './chogdata.js';
import { CLIPS } from './traitmap.js';
import { HOODS, roadDistance, nearDome } from './layout.js';
import { heightAt, islandAt } from './terrain.js';

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
const BASE = import.meta.env.BASE_URL;

// One of the cast: its own model, and for a token Chog its traits and name (no aura ring under a model).
// Out here they are seen from a way off, so each is a lighter copy of its model.
const KEEP = 0.3;
async function npc(glb, id = null, tint = null) {
  const info = id ? await chogInfo(id) : {};
  return makeChog({ ...info, traits: { ...info.traits, Aura: null }, model: glb, tint, keep: KEEP });
}

/**
 * The singer: one file with its own stage and mic stand, its clips named as in CLIPS. Driven like a
 * Chog: play(name) crossfades to that clip, update(dt) runs it.
 */
async function riggedNpc(url) {
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(BASE + url);
  const root = gltf.scene;
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
  });
  const mixer = new THREE.AnimationMixer(root);
  const actions = {};
  for (const [name, clipName] of Object.entries(CLIPS)) {
    const clip = THREE.AnimationClip.findByName(gltf.animations, clipName);
    if (clip) actions[name] = mixer.clipAction(clip);
  }
  let current = null;
  return {
    root,
    play(name, fade = 0.4) {
      const next = actions[name] ?? actions.idle;
      if (!next || next === current) return;
      next.reset().fadeIn(fade).play();
      current?.fadeOut(fade);
      current = next;
    },
    update(dt) {
      mixer.update(dt);
    },
  };
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
      const singer = await riggedNpc(s.glb);
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
        let angle = w.phase;
        let pause = 0;
        let next = 8 + Math.random() * 10;
        c.play('walk');
        ticks.push((dt) => {
          if (pause > 0) {
            pause -= dt;
            if (pause <= 0) c.play('walk');
            return;
          }
          next -= dt;
          if (next <= 0) {
            pause = 3.2;
            next = 12 + Math.random() * 12;
            c.play(Math.random() < 0.6 ? 'wave' : 'idle');
            return;
          }
          angle += (dt * w.speed * w.dir) / STROLL_R;
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
      const step = (tt) => {
        const p = lapAt(runAngle, hood2);
        dino.root.position.set(p.x, heightAt(p.x, p.z), p.z);
        // Facing along the path, the block held up over its head and bobbing with its stride.
        dino.root.rotation.y = Math.atan2(-Math.sin(runAngle), Math.cos(runAngle));
        // Riding on its head as it bobs: the head bone is at the base of its hood, which is about 0.8 tall.
        hp.set(0, 1.1, 0);
        if (head) {
          dino.root.updateMatrixWorld();
          dino.root.worldToLocal(head.getWorldPosition(hp));
        }
        block.position.set(hp.x, hp.y + 1.02 + Math.abs(Math.sin(tt * 9)) * 0.04, hp.z);
        block.rotation.x = Math.sin(tt * 4.5) * 0.15;
      };
      step(0);
      dino.play('run');
      return {
        group: lap,
        chogs: await shown(lap, [dino]),
        where: (v) => v.copy(lapAt(runAngle, hood2)),
        tick: (tt, dt) => {
          runAngle += dt * NPC_SLOTS.runner.speed;
          step(tt);
        },
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
      let pause = 0;
      let next = 14;
      return {
        group: stroll,
        chogs: await shown(stroll, [astro]),
        where: (v) => v.copy(lapAt(walkAngle, hood1)),
        tick: (tt, dt) => {
          if (pause > 0) {
            pause -= dt;
            if (pause <= 0) astro.play('walk');
            return;
          }
          if ((next -= dt) <= 0) {
            pause = 3;
            next = 14 + Math.random() * 10;
            astro.play('wave');
            return;
          }
          walkAngle += dt * w.speed;
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
