import * as THREE from 'three';
import { MODELS, info } from './assets.js';
import { TERRACES, ISLANDS } from './layout.js';
import { heightAt } from './terrain.js';
import { piece } from './kaykit.js';
import { mergeByMaterial } from './merge.js';

/*
 * Landmarks standing on the plateau in the middle of a neighbourhood, so it can be told apart from
 * across the sky: a giant tree on one, a beacon tower on another.
 */

export const LANDMARK_KIT = ['structure_tall', 'lights'];

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
  // Beams fade out along their length and tilt up a little, so they sweep the sky above the
  // other islands instead of cutting through them.
  const beamMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color('#ffe9b8') }, uStrength: { value: 0 } },
    vertexShader: 'varying float vAlong; void main() { vAlong = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 uColor; uniform float uStrength; varying float vAlong; void main() { gl_FragColor = vec4(uColor * uStrength * pow(vAlong, 2.2), 1.0); }',
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const head = new THREE.Group();
  head.position.y = lantern.position.y;
  const BEAM = 55;
  for (const side of [-1, 1]) {
    const beam = new THREE.Mesh(new THREE.ConeGeometry(4.5, BEAM, 20, 1, true).translate(0, -BEAM / 2, 0).rotateZ(side * (Math.PI / 2 + 0.16)), beamMat);
    head.add(beam);
  }
  g.add(head);
  g.position.set(x, y, z);
  return {
    group: g,
    update(env, t) {
      head.rotation.y = t * 0.5;
      beamMat.uniforms.uStrength.value = 0.04 + env.night * 0.22;
      lanternMat.emissiveIntensity = 1 + env.night * 4;
    },
  };
}

const BUILDERS = { tree: giantTree, beacon };

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
