import * as THREE from 'three';
import { mergeByMaterial } from './merge.js';
import { createGlows } from './glows.js';

/*
 * Furniture for the downtown plaza in front of the Chog Hub: a tiered fountain, benches around
 * it, planters and a few lamps. Positions are on the plaza, in plaza space (y = 0 is the paving).
 */

export const FOUNTAIN = { x: 0, z: 40 };
// Benches are built at life size, then scaled up to match the fountain, lamps and pods around them.
const BENCH_SCALE = 1.7;

const stone = () => new THREE.MeshLambertMaterial({ color: '#efe3cf' });

// A solid of revolution from (radius, height) pairs.
const lathe = (pts, segs = 40) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), segs);

function waterMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uNight: { value: 0 } },
    transparent: true,
    depthWrite: false,
    vertexShader: 'varying vec2 vUv; varying vec3 vP; void main() { vUv = uv; vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
uniform float uTime, uNight;
varying vec2 vUv;
varying vec3 vP;
void main() {
  // Rings spreading out from the middle, with a little sparkle.
  float r = length(vP.xz);
  float ripple = 0.5 + 0.5 * sin(r * 3.2 - uTime * 2.4) * sin(atan(vP.z, vP.x) * 5.0 + uTime * 0.7);
  vec3 col = mix(vec3(0.42, 0.62, 0.86), vec3(0.85, 0.94, 1.0), ripple * 0.6);
  col = mix(col, col * vec3(0.4, 0.38, 0.7), uNight * 0.7);
  gl_FragColor = vec4(col, 0.78);
  #include <colorspace_fragment>
}`,
  });
}

function sheetMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uNight: { value: 0 } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
uniform float uTime, uNight;
varying vec2 vUv;
void main() {
  // Streaks pouring down off the bowl.
  float s = 0.5 + 0.5 * sin(vUv.x * 80.0 + sin(vUv.x * 13.0) * 3.0) * sin(vUv.y * 9.0 + uTime * 9.0);
  vec3 col = mix(vec3(0.62, 0.8, 0.95), vec3(1.0), s);
  col = mix(col, col * vec3(0.45, 0.42, 0.75), uNight * 0.7);
  gl_FragColor = vec4(col, (0.35 + 0.45 * s) * smoothstep(0.0, 0.25, vUv.y));
  #include <colorspace_fragment>
}`,
  });
}

function fountain() {
  const g = new THREE.Group();
  const mat = stone();
  // Basin with a lipped rim, a column, an upper bowl and a finial.
  g.add(new THREE.Mesh(lathe([[0, 0], [6.6, 0], [6.8, 0.25], [6.8, 0.95], [6.2, 1.05], [6.0, 0.4], [0, 0.4]]), mat));
  g.add(new THREE.Mesh(lathe([[0, 0.4], [1.1, 0.4], [0.8, 1.2], [0.7, 2.6], [1.0, 2.9], [0, 2.9]]), mat));
  g.add(new THREE.Mesh(lathe([[0, 2.9], [0.9, 2.9], [2.4, 3.3], [2.6, 3.7], [2.3, 3.8], [0.6, 3.5], [0, 3.6]]), mat));
  g.add(new THREE.Mesh(lathe([[0, 3.6], [0.45, 3.6], [0.25, 4.3], [0.45, 4.8], [0, 5.3]]), mat));
  g.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  mergeByMaterial(g);
  const water = waterMaterial();
  const pool = new THREE.Mesh(new THREE.CircleGeometry(6.0, 48).rotateX(-Math.PI / 2).translate(0, 0.8, 0), water);
  pool.userData.keep = true;
  const bowlWater = new THREE.Mesh(new THREE.CircleGeometry(2.2, 32).rotateX(-Math.PI / 2).translate(0, 3.62, 0), water);
  const sheet = sheetMaterial();
  const fall = new THREE.Mesh(new THREE.CylinderGeometry(2.45, 2.7, 2.9, 40, 1, true).translate(0, 2.25, 0), sheet);
  g.add(pool, bowlWater, fall);
  return { group: g, mats: [water, sheet] };
}

function bench(woodMat, brassMat) {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.08, 0.16), woodMat);
    slat.position.set(0, 0.5, -0.22 + i * 0.22);
    g.add(slat);
  }
  for (let i = 0; i < 2; i++) {
    const back = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.14, 0.06), woodMat);
    back.position.set(0, 0.75 + i * 0.22, -0.38);
    back.rotation.x = -0.15;
    g.add(back);
  }
  for (const sx of [-1.1, 1.1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.6), brassMat);
    leg.position.set(sx, 0.25, -0.05);
    g.add(leg);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.08), brassMat);
    arm.position.set(sx, 0.85, -0.38);
    g.add(arm);
  }
  return g;
}

export function buildPlaza() {
  const group = new THREE.Group();
  const wood = new THREE.MeshLambertMaterial({ color: '#9a6842' });
  const brass = new THREE.MeshStandardMaterial({ color: '#cfa84e', metalness: 0.75, roughness: 0.35 });
  const cream = stone();
  const props = new THREE.Group();
  const soilMat = new THREE.MeshLambertMaterial({ color: '#5a3d2b' });

  const f = fountain();
  f.group.position.set(FOUNTAIN.x, 0, FOUNTAIN.z);
  group.add(f.group);

  // Benches sized to the fountain and lamps: an even ring of eight facing the fountain, leaving the
  // four walks into it clear, and two more out on the plaza between the planters, facing the hub.
  const benchSpots = [];
  const addBench = (x, z, faceX, faceZ) => {
    const b = bench(wood, brass);
    b.scale.setScalar(BENCH_SCALE);
    b.position.set(x, 0, z);
    // The seat faces +z before turning; turn it to face the given point.
    b.rotation.y = Math.atan2(faceX - x, faceZ - z);
    props.add(b);
    benchSpots.push([x, z]);
  };
  for (let k = 0; k < 8; k++) {
    const a = ((k + 0.5) / 8) * Math.PI * 2;
    addBench(FOUNTAIN.x + Math.sin(a) * 11, FOUNTAIN.z + Math.cos(a) * 11, FOUNTAIN.x, FOUNTAIN.z);
  }
  for (const a of [0.675, -0.675]) addBench(Math.sin(a) * 44, Math.cos(a) * 44, 0, 0);

  // Planters at the plaza's edge, clear of the hub; island.js fills them with flowers.
  const planters = [];
  for (const a of [0.45, 0.9, 1.35, -0.45, -0.9, -1.35, Math.PI - 0.35, Math.PI + 0.35]) {
    const x = Math.sin(a) * 44, z = Math.cos(a) * 44;
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.0, 0.9, 20).translate(0, 0.45, 0), cream);
    pot.position.set(x, 0, z);
    props.add(pot);
    const soil = new THREE.Mesh(new THREE.CylinderGeometry(1.12, 1.12, 0.05, 20).translate(0, 0.86, 0), soilMat);
    soil.position.set(x, 0, z);
    props.add(soil);
    planters.push([x, z, 0.9]);
  }

  // Lamps around the fountain and along the walk from the lobby.
  const glowSpots = [];
  const spots = [...planters.map(([x, z]) => [x, z]), ...benchSpots];
  const globeMat = new THREE.MeshStandardMaterial({ color: '#fff3dd', emissive: new THREE.Color('#ffd7a0'), emissiveIntensity: 0.2 });
  // Two along the walk from the lobby, two out on the plaza, and four round the fountain in the gaps between its benches.
  const round = [1, 3, 5, 7].map((k) => [FOUNTAIN.x + Math.sin((k / 8) * Math.PI * 2) * 11.5, FOUNTAIN.z + Math.cos((k / 8) * Math.PI * 2) * 11.5]);
  for (const [x, z] of [[-9.5, 21], [9.5, 21], [-33, 25], [33, 25], ...round]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 4.2, 8).translate(0, 2.1, 0), brass);
    pole.position.set(x, 0, z);
    props.add(pole);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.35, 12).translate(0, 4.75, 0), brass);
    cap.position.set(x, 0, z);
    props.add(cap);
    const globe = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 10).translate(0, 4.35, 0), globeMat);
    globe.position.set(x, 0, z);
    props.add(globe);
    glowSpots.push(new THREE.Vector3(x, 4.35, z));
    spots.push([x, z]);
  }
  props.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  mergeByMaterial(props);
  group.add(props);
  const glows = createGlows(glowSpots);
  group.add(glows.points);

  return {
    group,
    planters,
    // Where furniture stands, so trees keep clear of it.
    spots,
    update(env, t, renderer) {
      for (const m of f.mats) {
        m.uniforms.uTime.value = t;
        m.uniforms.uNight.value = env.night;
      }
      globeMat.emissiveIntensity = 0.2 + env.night * 2.2;
      glows.update(env, renderer);
    },
  };
}
