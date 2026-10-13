import * as THREE from 'three';
import { makeChog } from './chog.js';
import { chogInfo } from './chogdata.js';
import { HOODS, roadDistance, nearDome } from './layout.js';
import { heightAt, islandAt } from './terrain.js';

/*
 * The Chogs who live round the world before anyone signs in. Each is a slot: which Chog it is (by
 * token id, so its traits set its look), where it is, and what it does. A slot's `glb` can name a
 * bespoke rigged model for that character; until the models arrive (see traitmap.js) they use the
 * stand-in. Animation hooks are the names chog.js plays: sing, cheer, sniff, run, idle.
 *
 *   singer   on a little stage in the plaza, a ring of Chogs round them, cheering and swaying
 *   sniffer  out on the tree island, nose in a patch of flowers
 *   runner   lapping the loop path on the beacon island with a toy block in its arms
 */

export const NPC_SLOTS = {
  singer: { id: 1035, glb: null, anim: 'sing', plaza: [27, 30] },
  crowd: { ids: [2, 21, 99, 273, 737, 809, 929], glb: null, anims: ['cheer', 'idle'], radius: 5.5 },
  sniffer: { id: 1064, glb: null, anim: 'sniff', hood: 0 },
  runner: { id: 688, glb: null, anim: 'run', hood: 2, speed: 0.22 },
};

// The camera has to be this close for the characters to be drawn and animated.
const NEAR = 320;

async function chogFor(id) {
  return makeChog(await chogInfo(id));
}

function stage(mat) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(1.9, 2.1, 0.4, 28).translate(0, 0.2, 0), mat.wood));
  g.add(new THREE.Mesh(new THREE.TorusGeometry(1.95, 0.06, 6, 40).rotateX(Math.PI / 2).translate(0, 0.42, 0), mat.brass));
  return g;
}

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

/** Place the slots and start their animations. plaza is the plaza group (its origin is the square's). */
export async function buildNpcs({ scene, plaza }) {
  const actors = [];
  const mat = {
    wood: new THREE.MeshLambertMaterial({ color: '#8a5a3a' }),
    brass: new THREE.MeshStandardMaterial({ color: '#cfa84e', metalness: 0.75, roughness: 0.35 }),
  };

  // The singer and the crowd, in the plaza.
  const s = NPC_SLOTS.singer;
  const square = new THREE.Group();
  plaza.add(square);
  square.position.set(s.plaza[0], 0, s.plaza[1]);
  square.add(stage(mat));
  const singer = await chogFor(s.id);
  singer.root.position.y = 0.4;
  singer.play(s.anim);
  square.add(singer.root);
  // A microphone on a stand in front of them.
  square.add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.5, 6).translate(0, 1.15, 0.75), mat.brass));
  square.add(new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8).translate(0, 1.95, 0.72), new THREE.MeshLambertMaterial({ color: '#2a2a2a' })));
  const crowd = await Promise.all(NPC_SLOTS.crowd.ids.map(chogFor));
  crowd.forEach((c, i) => {
    const a = (i / crowd.length) * Math.PI * 2 + 0.4;
    c.root.position.set(Math.sin(a) * NPC_SLOTS.crowd.radius, 0, Math.cos(a) * NPC_SLOTS.crowd.radius);
    c.root.rotation.y = a + Math.PI;
    c.play(NPC_SLOTS.crowd.anims[i % 2]);
    square.add(c.root);
  });
  // The singer turns slowly to sing to everyone round them.
  actors.push({ group: square, chogs: [singer, ...crowd], tick: (t) => (singer.root.rotation.y = Math.sin(t * 0.25) * 1.4) });

  // The sniffer, at its flowers on the tree island.
  const hood0 = HOODS[NPC_SLOTS.sniffer.hood];
  const spot = openSpot(hood0, hood0.angle + Math.PI + 0.9);
  const patch = new THREE.Group();
  patch.position.copy(spot);
  patch.rotation.y = 0.6;
  patch.add(flowers());
  const sniffer = await chogFor(NPC_SLOTS.sniffer.id);
  sniffer.root.position.set(0, 0, -1.4);
  sniffer.play(NPC_SLOTS.sniffer.anim);
  patch.add(sniffer.root);
  scene.add(patch);
  actors.push({ group: patch, chogs: [sniffer] });

  // The runner, lapping the loop on the beacon island with its block.
  const hood2 = HOODS[NPC_SLOTS.runner.hood];
  const lap = new THREE.Group();
  scene.add(lap);
  const runner = await chogFor(NPC_SLOTS.runner.id);
  const block = toyBlock();
  block.position.set(0, 1.0, 0.62);
  runner.root.add(block);
  runner.play(NPC_SLOTS.runner.anim);
  lap.add(runner.root);
  let angle = 0;
  actors.push({
    group: lap,
    chogs: [runner],
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

  const wp = new THREE.Vector3();
  let t = 0;
  return {
    actors,
    update(dt, camera) {
      t += dt;
      for (const a of actors) {
        a.group.getWorldPosition(wp);
        if (a === actors[2]) wp.copy(runner.root.position);
        const near = camera.position.distanceTo(wp) < NEAR;
        a.group.visible = near;
        if (!near) continue;
        a.tick?.(t, dt);
        for (const c of a.chogs) c.update(dt, camera);
      }
    },
  };
}

