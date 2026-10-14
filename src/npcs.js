import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { makeChog } from './chog.js';
import { chogInfo } from './chogdata.js';
import { CLIPS, READY } from './traitmap.js';
import { HOODS, roadDistance, nearDome } from './layout.js';
import { heightAt, islandAt } from './terrain.js';

/*
 * The Chogs who live round the world before anyone signs in. Each is a slot: which Chog it is (by
 * token id, so its traits set its look), where it is, and what it does. A slot's `glb` names a
 * bespoke rigged model for that character; otherwise it's built from its traits (traitmap.js). A
 * character only appears once it has a model: a slot with no glb waits for the trait models (READY),
 * and ?npcs previews every slot with standees. Animation names are the ones chog.js plays: sing,
 * cheer, sniff, run, idle.
 *
 *   singer   on their stage in the plaza (stage and mic are part of the model), a ring of Chogs round them
 *   sniffer  out on the tree island, nose in a patch of flowers
 *   runner   lapping the loop path on the beacon island with a toy block in its arms
 */

export const NPC_SLOTS = {
  // Faces out over the plaza, between the fountain and the walk the downtown view looks along.
  singer: { id: 1035, glb: 'models/npcs/singer.glb', plaza: [27, 30], faces: [10, 55] },
  crowd: { ids: [2, 21, 99, 273, 737, 809, 929], glb: null, anims: ['cheer', 'idle'], radius: 5.5 },
  sniffer: { id: 1064, glb: null, anim: 'sniff', hood: 0 },
  runner: { id: 688, glb: null, anim: 'run', hood: 2, speed: 0.22 },
};

// The camera has to be this close for the characters to be drawn and animated.
const NEAR = 320;
// Outdoors everything is built bigger than life (the plaza's benches and lamps are 1.7x, plaza.js),
// so the characters out there are too, to sit right beside them.
const OUTDOOR = 1.7;
const BASE = import.meta.env.BASE_URL;

async function chogFor(id) {
  return makeChog(await chogInfo(id));
}

/**
 * A slot's own rigged model: one file with its clips named as in CLIPS. Driven like a Chog:
 * play(name) crossfades to that clip, update(dt) runs it.
 */
async function riggedNpc(url) {
  const gltf = await new GLTFLoader().loadAsync(BASE + url);
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

// A little patch of flowers, for the sniffer.
function flowers() {
  const g = new THREE.Group();
  const stem = new THREE.MeshLambertMaterial({ color: '#4f9a3a' });
  const petals = ['#f7a8d0', '#ffe066', '#c8a2ff', '#ff8a7a'].map((c) => new THREE.MeshLambertMaterial({ color: c }));
  for (let i = 0; i < 9; i++) {
    const a = i * 2.4, r = 0.4 + (i % 3) * 0.35;
    const x = Math.cos(a) * r, z = Math.sin(a) * r, h = 0.45 + (i % 4) * 0.1;
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, h, 5).translate(x, h / 2, z), stem));
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6).scale(1, 0.55, 1).translate(x, h, z), petals[i % 4]));
  }
  return g;
}

// A toy block: a chunky cube, a different colour on each face.
function toyBlock() {
  const mats = ['#e8484f', '#4f7fe0', '#f2c94c', '#5fbf6a', '#b07cf0', '#f08a3a'].map((c) => new THREE.MeshLambertMaterial({ color: c }));
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.55), mats);
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
 * Place the slots that have a model and start their animations. plaza is the plaza group (its origin
 * is the square's). standees: show every slot, with standees where there's no model yet (?npcs).
 */
export async function buildNpcs({ scene, plaza, standees = false, prewarm }) {
  const actors = [];
  const shown = (slot) => Boolean(slot.glb) || READY.size > 0 || standees;

  // The singer, on their stage in the plaza, and the crowd round them.
  const s = NPC_SLOTS.singer;
  const square = new THREE.Group();
  plaza.add(square);
  square.position.set(s.plaza[0], 0, s.plaza[1]);
  square.scale.setScalar(OUTDOOR);
  const chogs = [];
  if (shown(s)) {
    const singer = s.glb ? await riggedNpc(s.glb) : await chogFor(s.id);
    await prewarm?.(singer.root);
    // The stage and mic stand are part of the model, so it stands on the paving and doesn't turn.
    singer.root.rotation.y = Math.atan2(s.faces[0] - s.plaza[0], s.faces[1] - s.plaza[1]);
    square.add(singer.root);
    chogs.push(singer);
    let part = 0;
    let left = SET[0][1];
    singer.play(SET[0][0]);
    actors.push({
      group: square,
      chogs,
      tick: (t, dt) => {
        left -= dt;
        if (left > 0) return;
        part = (part + 1) % SET.length;
        left = SET[part][1];
        singer.play(SET[part][0]);
      },
    });
  }
  if (shown(NPC_SLOTS.crowd)) {
    const crowd = await Promise.all(NPC_SLOTS.crowd.ids.map(chogFor));
    crowd.forEach((c, i) => {
      const a = (i / crowd.length) * Math.PI * 2 + 0.4;
      c.root.position.set(Math.sin(a) * NPC_SLOTS.crowd.radius, 0, Math.cos(a) * NPC_SLOTS.crowd.radius);
      c.root.rotation.y = a + Math.PI;
      c.play(NPC_SLOTS.crowd.anims[i % 2]);
      square.add(c.root);
      chogs.push(c);
    });
    if (!actors.some((a) => a.group === square)) actors.push({ group: square, chogs });
  }

  await Promise.all([shown(NPC_SLOTS.sniffer) && buildSniffer(scene, actors), shown(NPC_SLOTS.runner) && buildRunner(scene, actors)]);

  const wp = new THREE.Vector3();
  let t = 0;
  return {
    actors,
    update(dt, camera) {
      t += dt;
      for (const a of actors) {
        if (a.where) a.where(wp);
        else a.group.getWorldPosition(wp);
        const near = camera.position.distanceTo(wp) < NEAR;
        a.group.visible = near;
        if (!near) continue;
        a.tick?.(t, dt);
        for (const c of a.chogs) c.update(dt, camera);
      }
    },
  };
}

async function buildSniffer(scene, actors) {
  // The sniffer, at its flowers on the tree island.
  const hood0 = HOODS[NPC_SLOTS.sniffer.hood];
  const spot = openSpot(hood0, hood0.angle + Math.PI + 0.9);
  const patch = new THREE.Group();
  patch.position.copy(spot);
  patch.rotation.y = 0.6;
  patch.scale.setScalar(OUTDOOR);
  patch.add(flowers());
  const sniffer = await chogFor(NPC_SLOTS.sniffer.id);
  sniffer.root.position.set(0, 0, -1.4);
  sniffer.play(NPC_SLOTS.sniffer.anim);
  patch.add(sniffer.root);
  scene.add(patch);
  actors.push({ group: patch, chogs: [sniffer] });
}

async function buildRunner(scene, actors) {
  // The runner, lapping the loop on the beacon island with its block.
  const hood2 = HOODS[NPC_SLOTS.runner.hood];
  const lap = new THREE.Group();
  scene.add(lap);
  const runner = await chogFor(NPC_SLOTS.runner.id);
  runner.root.scale.setScalar(OUTDOOR);
  const block = toyBlock();
  block.position.set(0, 1.0, 0.62);
  runner.root.add(block);
  runner.play(NPC_SLOTS.runner.anim);
  lap.add(runner.root);
  let angle = 0;
  actors.push({
    group: lap,
    chogs: [runner],
    // The lap group stays at the origin; the runner is what moves.
    where: (v) => v.copy(runner.root.position),
    tick: (t, dt) => {
      angle += dt * NPC_SLOTS.runner.speed;
      const r = hood2.loopR;
      const x = hood2.x + Math.cos(angle) * r, z = hood2.z + Math.sin(angle) * r;
      runner.root.position.set(x, heightAt(x, z), z);
      // Facing along the path, and tossing the block a little as it runs.
      runner.root.rotation.y = Math.atan2(-Math.sin(angle), Math.cos(angle));
      block.position.y = 1.0 + Math.abs(Math.sin(t * 9)) * 0.12;
      block.rotation.x = Math.sin(t * 4.5) * 0.25;
    },
  });
}

