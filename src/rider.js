import * as THREE from 'three';
import { makeChog } from './chog.js';
import { chogInfo } from './chogdata.js';
import { ROADS, BRIDGES, HOODS, DOWNTOWN } from './layout.js';

/*
 * Patrol (#56, the durag and the sunset visor) riding round the islands. Three rides for the user to
 * pick (?bike=scooter|hover|chopper), each a chunky toy built from simple shapes round Patrol's own
 * size, so he sits on it, his feet on its footrests and his hands on its bars:
 *   scooter  a rounded retro scooter in Chog purple, a round headlight and a crate on the back
 *   hover    a pearl hover bike with violet thrusters, floating a hand over the ground and leaning into turns
 *   chopper  a low black chopper with a long fork, a fat back wheel and high bars
 * He rides the downtown ring, out over each bridge, once round each neighbourhood's loop and back.
 * createRider({ scene, look, groundAt }) resolves to { group, chog, route, update(dt, env, camera), at(s) }.
 */

export const BIKE_LOOKS = ['scooter', 'hover', 'chopper'];
const OUTDOOR = 1.7;
const SIT = 1.2;

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _q = new THREE.Quaternion(), _wq = new THREE.Quaternion(), _pq = new THREE.Quaternion();

// Turn a bone so the world direction from it to its child points at target.
function aim(bone, child, target) {
  bone.updateWorldMatrix(true, true);
  bone.getWorldPosition(_a);
  child.getWorldPosition(_b);
  _c.subVectors(_b, _a).normalize();
  _d.subVectors(target, _a).normalize();
  _q.setFromUnitVectors(_c, _d);
  bone.getWorldQuaternion(_wq).premultiply(_q);
  bone.parent.getWorldQuaternion(_pq);
  bone.quaternion.copy(_pq.invert().multiply(_wq));
  bone.updateWorldMatrix(false, true);
}

// Two bones reaching a point, the elbow bent toward pole.
const _e = new THREE.Vector3(), _s = new THREE.Vector3(), _n = new THREE.Vector3();
function reach(up, fore, hand, target, pole) {
  up.updateWorldMatrix(true, true);
  up.getWorldPosition(_s);
  const a = _s.distanceTo(fore.getWorldPosition(_e));
  const b = _e.distanceTo(hand.getWorldPosition(_n));
  const dir = _n.subVectors(target, _s);
  const d = Math.min(dir.length(), (a + b) * 0.999);
  dir.normalize();
  const x = (a * a - b * b + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, a * a - x * x));
  const side = _c.copy(pole).addScaledVector(dir, -pole.dot(dir)).normalize();
  _e.copy(_s).addScaledVector(dir, x).addScaledVector(side, h);
  aim(up, fore, _e.clone());
  aim(fore, hand, target);
}

const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0, ...o });
const chrome = () => mat('#eceaf4', { roughness: 0.22, metalness: 0.9 });
const lamp = (color) => new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: new THREE.Color(color), emissiveIntensity: 1.5, roughness: 0.3 });

function mesh(geo, material, x = 0, y = 0, z = 0, parent = null) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  if (parent) parent.add(m);
  return m;
}
const bar = (a, b, r, material, parent) => {
  const dir = new THREE.Vector3().subVectors(b, a);
  const m = mesh(new THREE.CylinderGeometry(r, r, dir.length(), 12), material, 0, 0, 0, parent);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return m;
};

function wheel(r, width, rim, parent, x, z, tyreColor = '#2b2535') {
  const w = new THREE.Group();
  w.position.set(x, r, z);
  const tyre = mesh(new THREE.TorusGeometry(r - width * 0.5, width * 0.5, 14, 40), mat(tyreColor, { roughness: 0.8 }), 0, 0, 0, w);
  tyre.rotation.y = Math.PI / 2;
  const hub = mesh(new THREE.CylinderGeometry(r * 0.62, r * 0.62, width * 0.7, 32), rim, 0, 0, 0, w);
  hub.rotation.z = Math.PI / 2;
  const cap = mesh(new THREE.CylinderGeometry(r * 0.2, r * 0.2, width * 0.9, 16), chrome(), 0, 0, 0, w);
  cap.rotation.z = Math.PI / 2;
  parent.add(w);
  return w;
}

/*
 * Each ride from Patrol's own measures (m, in the ride's frame: x right, y up, z forward, the ground at
 * y = 0): f.hip (his hip joint, seated), f.grip (where his hands go), f.peg (where his soles go).
 */
function scooter(f) {
  const g = new THREE.Group();
  const body = mat('#9b72f7'), cream = mat('#fff1dc'), dark = mat('#3a2d55');
  const S = f.seatY;
  const r = S * 0.42, wb = S * 2.5;
  const zr = -wb * 0.42, zf = wb * 0.58;
  const wheels = [wheel(r, r * 0.62, cream, g, 0, zr), wheel(r, r * 0.62, cream, g, 0, zf)];
  // The rounded back over the rear wheel, the seat on top of it.
  const back = mesh(new THREE.SphereGeometry(1, 40, 24), body, 0, S * 0.6, zr + S * 0.2, g);
  back.scale.set(S * 0.5, S * 0.42, S * 0.82);
  const seat = mesh(new THREE.CapsuleGeometry(S * 0.16, S * 0.72, 8, 20), cream, 0, S - S * 0.1, f.hip.z - S * 0.2, g);
  seat.rotation.x = Math.PI / 2;
  seat.scale.set(1.45, 1, 0.75);
  // The floor his feet rest on, and the leg shield curving up to the bars.
  mesh(new THREE.BoxGeometry(S * 0.62, S * 0.14, f.peg.z - zr + S * 0.3), body, 0, f.peg.y - S * 0.07, (f.peg.z + zr) / 2 + S * 0.12, g);
  mesh(new THREE.BoxGeometry(S * 0.5, S * 0.02, f.peg.z - zr - S * 0.4), dark, 0, f.peg.y + S * 0.005, (f.peg.z + zr) / 2 + S * 0.35, g);
  const shield = mesh(new THREE.CylinderGeometry(S * 0.42, S * 0.36, f.grip.y - f.peg.y - S * 0.08, 32, 1, true, -Math.PI * 0.45, Math.PI * 0.9), body, 0, (f.grip.y + f.peg.y) / 2 - S * 0.08, f.peg.z + S * 0.18, g);
  shield.material = body.clone();
  shield.material.side = THREE.DoubleSide;
  shield.rotation.x = -0.12;
  // The front: a fender over the wheel, the column up to the bars and a round headlight.
  const fender = mesh(new THREE.TorusGeometry(r * 1.1, r * 0.38, 12, 28, Math.PI * 0.95), body, 0, r, zf, g);
  fender.rotation.y = Math.PI / 2;
  fender.rotation.z = Math.PI * 0.03;
  const colTop = new THREE.Vector3(0, f.grip.y + S * 0.02, f.grip.z + S * 0.05);
  bar(new THREE.Vector3(0, r * 1.4, zf - r * 0.15), colTop, S * 0.1, body, g);
  const head = mesh(new THREE.SphereGeometry(S * 0.25, 28, 18), body, colTop.x, colTop.y, colTop.z + S * 0.04, g);
  head.scale.set(1.25, 0.8, 1);
  const light = mesh(new THREE.CylinderGeometry(S * 0.15, S * 0.15, S * 0.08, 28), lamp('#fff2c8'), colTop.x, colTop.y, colTop.z + S * 0.27, g);
  mesh(new THREE.TorusGeometry(S * 0.155, S * 0.03, 8, 28), chrome(), colTop.x, colTop.y, colTop.z + S * 0.31, g);
  light.rotation.x = Math.PI / 2;
  bar(new THREE.Vector3(-f.grip.x - S * 0.06, f.grip.y, f.grip.z), new THREE.Vector3(f.grip.x + S * 0.06, f.grip.y, f.grip.z), S * 0.05, chrome(), g);
  for (const s of [-1, 1]) mesh(new THREE.CapsuleGeometry(S * 0.065, S * 0.16, 4, 10), dark, s * f.grip.x, f.grip.y, f.grip.z, g).rotation.z = Math.PI / 2;
  for (const s of [-1, 1]) mesh(new THREE.SphereGeometry(S * 0.07, 12, 8), chrome(), s * (f.grip.x - S * 0.05), f.grip.y + S * 0.22, f.grip.z - S * 0.02, g).scale.set(1, 1, 0.4);
  // A crate on a little rack behind the seat.
  mesh(new THREE.BoxGeometry(S * 0.5, S * 0.04, S * 0.5), chrome(), 0, S * 0.9, zr - S * 0.42, g);
  const crate = mesh(new THREE.BoxGeometry(S * 0.48, S * 0.36, S * 0.44), mat('#d9a066', { roughness: 0.8 }), 0, S * 1.1, zr - S * 0.42, g);
  crate.rotation.y = 0.04;
  const tail = mesh(new THREE.SphereGeometry(S * 0.08, 12, 8), lamp('#ff5a7a'), 0, S * 0.66, zr - S * 0.62, g);
  return { group: g, wheels, wheelR: r, lights: [light.material], tail: tail.material };
}

function hover(f) {
  const g = new THREE.Group();
  const shell = mat('#f6f2ff', { roughness: 0.3, metalness: 0.15 }), trim = mat('#8f6bf0'), dark = mat('#2c2440');
  const S = f.seatY;
  const lift = S * 0.26;
  // The body: a long rounded shell, nose a little down, with the seat on its back.
  const len = S * 2.1;
  const body = mesh(new THREE.CapsuleGeometry(S * 0.36, len, 10, 28), shell, 0, S * 0.6, S * 0.1, g);
  body.rotation.x = Math.PI / 2 + 0.06;
  body.scale.set(1.3, 1, 0.82);
  const stripe = mesh(new THREE.CapsuleGeometry(S * 0.365, len * 0.9, 6, 28), trim, 0, S * 0.6, S * 0.12, g);
  stripe.rotation.x = Math.PI / 2 + 0.06;
  stripe.scale.set(1.31, 1, 0.2);
  const seat = mesh(new THREE.CapsuleGeometry(S * 0.15, S * 0.62, 8, 20), dark, 0, S - S * 0.09, f.hip.z - S * 0.12, g);
  seat.rotation.x = Math.PI / 2;
  seat.scale.set(1.4, 1, 0.7);
  // Thruster rings under the front and back, and a pool of light on the ground under them.
  const rings = [];
  for (const z of [-S * 0.85, S * 1.0]) {
    const pod = mesh(new THREE.CylinderGeometry(S * 0.4, S * 0.46, S * 0.26, 32), shell, 0, lift + S * 0.14, z, g);
    const ring = mesh(new THREE.TorusGeometry(S * 0.36, S * 0.065, 10, 40), lamp('#b48cff'), 0, lift + S * 0.01, z, g);
    ring.rotation.x = Math.PI / 2;
    rings.push(ring.material);
    pod.receiveShadow = true;
  }
  // Fins at the back, a light bar across the nose, the bars.
  for (const s of [-1, 1]) {
    const fin = mesh(new THREE.BoxGeometry(S * 0.07, S * 0.46, S * 0.56), trim, s * S * 0.36, S * 0.92, -S * 1.1, g);
    fin.rotation.set(0.5, 0, s * 0.35);
  }
  const nose = mesh(new THREE.CapsuleGeometry(S * 0.06, S * 0.5, 4, 12), lamp('#e8dcff'), 0, S * 0.66, S * 1.46, g);
  nose.rotation.z = Math.PI / 2;
  bar(new THREE.Vector3(0, S * 0.8, f.grip.z - S * 0.12), new THREE.Vector3(0, f.grip.y, f.grip.z), S * 0.09, shell, g);
  bar(new THREE.Vector3(-f.grip.x - S * 0.06, f.grip.y, f.grip.z), new THREE.Vector3(f.grip.x + S * 0.06, f.grip.y, f.grip.z), S * 0.05, chrome(), g);
  for (const s of [-1, 1]) mesh(new THREE.CapsuleGeometry(S * 0.065, S * 0.16, 4, 10), dark, s * f.grip.x, f.grip.y, f.grip.z, g).rotation.z = Math.PI / 2;
  // Footrests either side.
  for (const s of [-1, 1]) mesh(new THREE.BoxGeometry(S * 0.3, S * 0.07, S * 0.42), trim, s * S * 0.36, f.peg.y - S * 0.04, f.peg.z, g);
  const pool = new THREE.Mesh(
    new THREE.PlaneGeometry(S * 2.4, S * 3.4),
    new THREE.ShaderMaterial({
      uniforms: { uStrength: { value: 1 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform float uStrength; varying vec2 vUv; void main() { vec2 p = (vUv - 0.5) * 2.0; float d = dot(p, p); gl_FragColor = vec4(vec3(0.62, 0.45, 1.0) * exp(-d * 3.0) * 0.55 * uStrength, 1.0); }',
    }),
  );
  pool.rotation.x = -Math.PI / 2;
  pool.renderOrder = 3;
  return { group: g, wheels: [], wheelR: 1, lights: [...rings, nose.material], pool, hover: true };
}

function chopper(f) {
  const g = new THREE.Group();
  const paint = mat('#1d1826', { roughness: 0.25, metalness: 0.3 }), red = mat('#e8344e', { roughness: 0.3, metalness: 0.2 }), seatM = mat('#3b2a24', { roughness: 0.7 });
  const S = f.seatY;
  const rr = S * 0.56, rf = S * 0.48;
  const zr = -S * 1.0, zf = S * 1.95;
  const rearW = wheel(rr, rr * 0.85, chrome(), g, 0, zr);
  const frontW = wheel(rf, rf * 0.58, chrome(), g, 0, zf);
  // The frame: a low backbone from the head tube to the back axle, the tank on top.
  const headT = new THREE.Vector3(0, f.grip.y - S * 0.5, f.grip.z - S * 0.05);
  bar(new THREE.Vector3(0, rr, zr), headT, S * 0.09, chrome(), g);
  bar(new THREE.Vector3(0, rr * 0.7, zr + S * 0.2), new THREE.Vector3(0, rr * 0.75, S * 0.5), S * 0.11, paint, g);
  bar(new THREE.Vector3(0, rr * 0.75, S * 0.5), headT, S * 0.11, paint, g);
  const engine = mesh(new THREE.BoxGeometry(S * 0.42, S * 0.42, S * 0.5), chrome(), 0, rr * 0.95, S * 0.15, g);
  engine.rotation.x = 0.2;
  for (const s of [-1, 1]) mesh(new THREE.CylinderGeometry(S * 0.16, S * 0.16, S * 0.1, 20), paint, s * S * 0.24, rr * 1.0, S * 0.15, g).rotation.z = Math.PI / 2;
  const tank = mesh(new THREE.SphereGeometry(1, 32, 20), red, 0, (S + headT.y) / 2 + S * 0.05, (f.hip.z + headT.z) / 2 + S * 0.08, g);
  tank.scale.set(S * 0.3, S * 0.24, S * 0.52);
  tank.rotation.x = -0.18;
  // The long raked fork down to the front wheel, high bars up from it.
  for (const s of [-1, 1]) bar(new THREE.Vector3(s * S * 0.13, headT.y + S * 0.05, headT.z), new THREE.Vector3(s * S * 0.13, rf, zf), S * 0.055, chrome(), g);
  for (const s of [-1, 1]) bar(new THREE.Vector3(s * S * 0.13, headT.y + S * 0.05, headT.z), new THREE.Vector3(s * f.grip.x, f.grip.y, f.grip.z), S * 0.045, chrome(), g);
  for (const s of [-1, 1]) mesh(new THREE.CapsuleGeometry(S * 0.065, S * 0.16, 4, 10), seatM, s * f.grip.x, f.grip.y, f.grip.z, g).rotation.z = Math.PI / 2;
  const light = mesh(new THREE.SphereGeometry(S * 0.17, 24, 16), lamp('#fff2c8'), 0, headT.y + S * 0.02, headT.z + S * 0.24, g);
  mesh(new THREE.TorusGeometry(S * 0.16, S * 0.035, 8, 24), chrome(), 0, headT.y + S * 0.02, headT.z + S * 0.3, g);
  // A low seat and a fender over the fat back wheel, two pipes along the side.
  const seat = mesh(new THREE.CapsuleGeometry(S * 0.17, S * 0.55, 8, 20), seatM, 0, S - S * 0.1, f.hip.z - S * 0.14, g);
  seat.rotation.x = Math.PI / 2;
  seat.scale.set(1.5, 1, 0.75);
  const fender = mesh(new THREE.TorusGeometry(rr * 1.05, rr * 0.48, 12, 28, Math.PI * 0.75), red, 0, rr, zr, g);
  fender.rotation.y = Math.PI / 2;
  fender.rotation.z = Math.PI * 0.2;
  for (const y of [rr * 0.62, rr * 0.9]) {
    bar(new THREE.Vector3(S * 0.18, y + S * 0.12, S * 0.2), new THREE.Vector3(S * 0.3, y, S * 0.02), S * 0.06, chrome(), g);
    bar(new THREE.Vector3(S * 0.3, y, S * 0.02), new THREE.Vector3(S * 0.32, y + S * 0.12, zr - S * 0.5), S * 0.06, chrome(), g);
  }
  for (const s of [-1, 1]) mesh(new THREE.BoxGeometry(S * 0.26, S * 0.06, S * 0.16), chrome(), s * S * 0.34, f.peg.y - S * 0.03, f.peg.z, g);
  // A red fender over the front wheel, shrouds low on the fork, and a chrome sissy bar behind the seat.
  const ff = mesh(new THREE.TorusGeometry(rf * 1.08, rf * 0.3, 10, 24, Math.PI * 0.6), red, 0, rf, zf, g);
  ff.rotation.y = Math.PI / 2;
  ff.rotation.z = Math.PI * 0.32;
  const forkDir = new THREE.Vector3(0, rf - headT.y - S * 0.05, zf - headT.z).normalize();
  for (const sd of [-1, 1]) bar(new THREE.Vector3(sd * S * 0.13, rf, zf).addScaledVector(forkDir, -S * 0.55), new THREE.Vector3(sd * S * 0.13, rf, zf).addScaledVector(forkDir, -S * 0.08), S * 0.085, paint, g);
  const sissy = new THREE.CatmullRomCurve3([new THREE.Vector3(-S * 0.2, S * 0.85, zr + S * 0.1), new THREE.Vector3(-S * 0.18, S * 1.45, zr - S * 0.05), new THREE.Vector3(0, S * 1.62, zr - S * 0.1), new THREE.Vector3(S * 0.18, S * 1.45, zr - S * 0.05), new THREE.Vector3(S * 0.2, S * 0.85, zr + S * 0.1)]);
  mesh(new THREE.TubeGeometry(sissy, 24, S * 0.04, 8), chrome(), 0, 0, 0, g);
  const tail = mesh(new THREE.SphereGeometry(S * 0.08, 12, 8), lamp('#ff3a5a'), 0, rr * 2.1, zr - rr * 0.6, g);
  return { group: g, wheels: [rearW, frontW], radii: [rr, rf], wheelR: rr, lights: [light.material], tail: tail.material };
}

const BUILD = { scooter, hover, chopper };

// The ride: the downtown ring, and for each neighbourhood out along its road, over its bridge, once round
// its loop and back. A closed line of points about a metre apart, its corners rounded.
function tour() {
  const pts = [];
  const ringR = DOWNTOWN.r + 2.5;
  const ring = (a0, a1) => {
    const n = Math.max(2, Math.ceil((Math.abs(a1 - a0) * ringR) / 2));
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      pts.push(new THREE.Vector3(Math.cos(a) * ringR, 0, Math.sin(a) * ringR));
    }
  };
  const line = (ax, az, bx, bz) => {
    const n = Math.max(2, Math.ceil(Math.hypot(bx - ax, bz - az) / 2));
    for (let i = 1; i <= n; i++) pts.push(new THREE.Vector3(ax + ((bx - ax) * i) / n, 0, az + ((bz - az) * i) / n));
  };
  const hoods = [...HOODS].sort((p, q) => p.angle - q.angle);
  hoods.forEach((h, k) => {
    const br = BRIDGES[h.id];
    const ux = Math.cos(h.angle), uz = Math.sin(h.angle);
    const loopIn = [h.x - ux * h.loopR, h.z - uz * h.loopR];
    // Out: ring to the bridge, the bridge, the landing to the loop.
    line(ux * ringR, uz * ringR, br.ax, br.az);
    line(br.ax, br.az, br.bx, br.bz);
    line(br.bx, br.bz, loopIn[0], loopIn[1]);
    // Once round the loop, starting where the landing road meets it.
    const a0 = h.angle + Math.PI;
    const n = Math.ceil((Math.PI * 2 * h.loopR) / 2);
    for (let i = 1; i <= n; i++) {
      const a = a0 + (Math.PI * 2 * i) / n;
      pts.push(new THREE.Vector3(h.x + Math.cos(a) * h.loopR, 0, h.z + Math.sin(a) * h.loopR));
    }
    // And back.
    line(loopIn[0], loopIn[1], br.bx, br.bz);
    line(br.bx, br.bz, br.ax, br.az);
    line(br.ax, br.az, ux * ringR, uz * ringR);
    const next = hoods[(k + 1) % hoods.length];
    let a1 = next.angle;
    while (a1 <= h.angle) a1 += Math.PI * 2;
    ring(h.angle, a1);
  });
  // Rounded corners: a few passes of neighbour averaging.
  for (let pass = 0; pass < 6; pass++) {
    const copy = pts.map((p) => p.clone());
    for (let i = 0; i < pts.length; i++) {
      const p0 = copy[(i - 1 + pts.length) % pts.length], p2 = copy[(i + 1) % pts.length];
      pts[i].x = copy[i].x * 0.5 + (p0.x + p2.x) * 0.25;
      pts[i].z = copy[i].z * 0.5 + (p0.z + p2.z) * 0.25;
    }
  }
  return new THREE.CatmullRomCurve3(pts, true, 'centripetal');
}

export async function createRider({ scene, look = 'scooter', groundAt = null }) {
  const info = await chogInfo(56);
  const chog = await makeChog({ ...info, traits: { ...info.traits, Aura: null }, model: 'models/npcs/chog-56.glb', keep: 0.3 });
  chog.root.scale.setScalar(OUTDOOR);
  chog.play('idle');
  chog.root.traverse((o) => o.material?.uniforms?.uLen && (o.visible = false));
  const bone = (n) => chog.root.getObjectByName(n);
  const B = {
    hips: bone('Hips'),
    legs: ['L', 'R'].map((s) => ({ thigh: bone('Thigh' + s), shin: bone('Shin' + s), foot: bone('Foot' + s) })),
    arms: ['L', 'R'].map((s) => ({ s: s === 'L' ? 1 : -1, up: bone('UpperArm' + s), fore: bone('ForeArm' + s), hand: bone('Hand' + s) })),
  };
  // His measures, standing, in metres from his feet.
  chog.root.updateMatrixWorld(true);
  const W = (o) => o.getWorldPosition(new THREE.Vector3());
  const hipY = W(B.hips).y;
  const L = B.legs[0];
  const thigh = W(L.thigh).distanceTo(W(L.shin)), shin = W(L.shin).distanceTo(W(L.foot)), ankle = W(L.foot).y;
  const A = B.arms[0];
  const shoulder = W(A.up);
  const arm = shoulder.distanceTo(W(A.fore)) + W(A.fore).distanceTo(W(A.hand));
  // Seated: thighs forward by SIT, shins hanging. Where everything lands, his hips at the origin.
  const knee = new THREE.Vector3(0, -Math.cos(SIT) * thigh, Math.sin(SIT) * thigh);
  const sole = knee.clone().add(new THREE.Vector3(0, -shin - ankle, shin * 0.12));
  const PEG = 0.72;
  const hipAt = PEG - sole.y;
  const f = {
    hip: new THREE.Vector3(0, hipAt, 0),
    peg: new THREE.Vector3(0, PEG, sole.z),
    seatY: hipAt - thigh * 0.28,
  };
  const sh = new THREE.Vector3(Math.abs(shoulder.x), hipAt + (shoulder.y - hipY), shoulder.z);
  const down = arm * 0.42;
  const fwd = Math.sqrt(Math.max(0.01, (arm * 0.9) ** 2 - down * down - (arm * 0.12) ** 2));
  f.grip = new THREE.Vector3(sh.x + arm * 0.12, sh.y - down, sh.z + fwd);

  const ride = BUILD[look](f);
  const group = new THREE.Group();
  group.name = 'rider';
  const lean = new THREE.Group();
  group.add(lean);
  lean.add(ride.group);
  lean.add(chog.root);
  chog.root.position.set(0, hipAt - hipY, 0);
  if (ride.pool) scene.add(ride.pool);
  scene.add(group);
  const model = chog.root.children.find((o) => o.getObjectByProperty?.('isSkinnedMesh', true));

  const sitQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -SIT);
  const kneeQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), SIT * 0.92);
  const saved = [];
  const posed = [...B.legs.flatMap((l) => [l.thigh, l.shin]), ...B.arms.flatMap((a) => [a.up, a.fore])];
  const grip = new THREE.Vector3(), pole = new THREE.Vector3();
  const pose = () => {
    posed.forEach((b, i) => (saved[i] = b.quaternion.clone()));
    for (const l of B.legs) {
      l.thigh.quaternion.multiply(sitQ);
      l.shin.quaternion.multiply(kneeQ);
    }
    lean.updateMatrixWorld(true);
    for (const a of B.arms) {
      grip.set(a.s * f.grip.x, f.grip.y, f.grip.z).applyMatrix4(lean.matrixWorld);
      pole.set(a.s, -0.6, -0.3).transformDirection(lean.matrixWorld);
      reach(a.up, a.fore, a.hand, grip, pole);
    }
  };
  const unpose = () => posed.forEach((b, i) => saved[i] && b.quaternion.copy(saved[i]));

  const route = tour();
  const length = route.getLength();
  let s = 0;
  let y = null;
  let roll = 0;
  let t = 0;
  const SPEED = look === 'chopper' ? 7.5 : look === 'hover' ? 8 : 6;
  const p = new THREE.Vector3(), ahead = new THREE.Vector3(), behind = new THREE.Vector3();
  const place = (dt) => {
    const u = (s / length) % 1;
    route.getPointAt(u, p);
    route.getPointAt((u + 4 / length) % 1, ahead);
    route.getPointAt((u - 4 / length + 1) % 1, behind);
    const gy = (x, z, near) => groundAt?.(x, z, near)?.y ?? 0;
    const want = gy(p.x, p.z, y ?? 60);
    y = y === null || dt === 0 ? want : y + (want - y) * Math.min(1, dt * 10);
    const yaw = Math.atan2(ahead.x - behind.x, ahead.z - behind.z);
    // Lean into the turn: how fast the heading turns, times the speed.
    const h0 = Math.atan2(p.x - behind.x, p.z - behind.z), h1 = Math.atan2(ahead.x - p.x, ahead.z - p.z);
    let turn = h1 - h0;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    const want2 = THREE.MathUtils.clamp(-turn * SPEED * (ride.hover ? 0.55 : 0.4), -0.4, 0.4);
    roll += (want2 - roll) * Math.min(1, dt * 3 || 1);
    group.position.set(p.x, y + (ride.hover ? Math.sin(t * 2.2) * 0.06 : 0), p.z);
    group.rotation.y = yaw;
    lean.rotation.z = roll;
    // Up a slope, the nose up with it.
    const ya = gy(ahead.x, ahead.z, y), yb = gy(behind.x, behind.z, y);
    lean.rotation.x = -Math.atan2(ya - yb, 8) * 0.9;
    if (ride.pool) {
      ride.pool.position.set(p.x, want + 0.06, p.z);
      ride.pool.rotation.z = -yaw;
    }
  };

  return {
    group,
    chog,
    route,
    length,
    // Put him at a distance along the ride (for a still).
    at(d) {
      s = d;
      place(0);
    },
    update(dt, env, camera) {
      t += dt;
      s = (s + SPEED * dt) % length;
      place(dt);
      for (const w of ride.wheels) w.rotation.x += (SPEED * dt) / (ride.radii?.[ride.wheels.indexOf(w)] ?? ride.wheelR);
      const night = env?.night ?? 0;
      for (const m of ride.lights) m.emissiveIntensity = 1.2 + night * 2.5;
      if (ride.tail) ride.tail.emissiveIntensity = 1 + night * 2;
      if (ride.pool) ride.pool.material.uniforms.uStrength.value = 0.35 + night * 1.2;
      if (!camera || camera.position.distanceTo(group.position) < 260) {
        unpose();
        chog.update(dt, camera);
        if (model) model.position.y = 0;
        pose();
      }
    },
  };
}
