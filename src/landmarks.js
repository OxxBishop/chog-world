import * as THREE from 'three';
import { MODELS, info } from './assets.js';
import { TERRACES, ISLANDS } from './layout.js';
import { heightAt } from './terrain.js';
import { piece } from './kaykit.js';
import { mergeByMaterial } from './merge.js';

/*
 * One landmark per neighbourhood, standing on the plateau in its middle, so each island can be
 * told apart from across the sky: a giant tree, a wind turbine, and a beacon tower.
 */

export const LANDMARK_KIT = ['windturbine_tall', 'structure_tall', 'lights'];

// The tallest of the common trees, grown huge, as plain copies of its parts.
function giantTree(x, y, z) {
  const name = MODELS.common.reduce((best, n) => (info(n).box.max.y > info(best).box.max.y ? n : best));
  const g = new THREE.Group();
  for (const p of info(name).parts) {
    const m = new THREE.InstancedMesh(p.geometry, p.material, 1);
    m.setMatrixAt(0, p.matrix);
    if (p.tintable) m.setColorAt(0, new THREE.Color('#c8a2ff'));
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    g.add(m);
  }
  const h = info(name).box.max.y;
  g.scale.setScalar(38 / h);
  g.position.set(x, y - 0.4, z);
  g.rotation.y = 0.7;
  return { group: g, update() {} };
}

function turbine(x, y, z) {
  const g = piece('windturbine_tall', 14);
  g.position.set(x, y, z);
  g.rotation.y = -0.6;
  let fan = null;
  g.traverse((o) => {
    if (o.name.includes('fan')) fan = o;
  });
  return {
    group: g,
    update(env, t, dt) {
      if (fan) fan.rotation.z -= dt * 0.9;
    },
  };
}

function beacon(x, y, z) {
  const g = new THREE.Group();
  const S = 5;
  for (let k = 0; k < 3; k++) {
    const level = piece('structure_tall', S * (1 - k * 0.14));
    level.position.y = k * 2 * S * (1 - (k - 1) * 0.07);
    g.add(level);
  }
  const top = 2 * S * 2.86;
  const lamp = piece('lights', 7);
  lamp.position.y = top - 1;
  g.add(lamp);
  mergeByMaterial(g);
  // The lantern and two sweeping beams, bright at night.
  const lanternMat = new THREE.MeshStandardMaterial({ color: '#fff4dc', emissive: new THREE.Color('#ffe2a8'), emissiveIntensity: 1 });
  const lantern = new THREE.Mesh(new THREE.SphereGeometry(1.6, 16, 12), lanternMat);
  lantern.position.y = top + 5.8;
  g.add(lantern);
  const beamMat = new THREE.MeshBasicMaterial({ color: '#ffe9b8', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const head = new THREE.Group();
  head.position.y = lantern.position.y;
  for (const side of [-1, 1]) {
    const beam = new THREE.Mesh(new THREE.ConeGeometry(9, 120, 24, 1, true).translate(0, -60, 0).rotateZ((side * Math.PI) / 2), beamMat);
    head.add(beam);
  }
  g.add(head);
  g.position.set(x, y, z);
  return {
    group: g,
    update(env, t) {
      head.rotation.y = t * 0.5;
      beamMat.opacity = 0.03 + env.night * 0.16;
      lanternMat.emissiveIntensity = 1 + env.night * 4;
    },
  };
}

const BUILDERS = { tree: giantTree, turbine, beacon };

export function buildLandmarks(scene) {
  const marks = [];
  for (const t of TERRACES) {
    const isl = ISLANDS.find((i) => i.id === t.isl);
    const make = BUILDERS[isl.landmark];
    if (!make || t.x !== isl.x || t.z !== isl.z) continue;
    const mark = make(t.x, heightAt(t.x, t.z), t.z);
    scene.add(mark.group);
    marks.push(mark);
  }
  return {
    update(env, t, dt) {
      for (const m of marks) m.update(env, t, dt);
    },
  };
}
