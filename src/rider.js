import * as THREE from 'three';
import { BRIDGES, HOODS, DOWNTOWN } from './layout.js';

/*
 * Patrol (#56, the durag and the sunset visor) on his hover chopper, the user's pick (10-19): a low black
 * chopper with a red tank, a long raked fork and high bars, floating on two glowing hover pods where its
 * wheels would be. It is built round Patrol's own measures, so he sits on it with his feet on its pegs and
 * his hands on its bars (his legs and arms posed over his idle clip each frame). He rides the downtown
 * ring, out over each bridge, once round each neighbourhood's loop and back, leaning into the turns, his
 * headlight on after dark.
 *
 * createRider({ chog, groundAt }) -> { group, update(dt, env, camera), at(d) }. src/npcs.js makes Patrol
 * and calls update each frame he's near (after his clip: this poses him).
 */

const SIT = 1.2;
const SPEED = 7.5;
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


// The bike, from Patrol's measures (m, in its own frame: x right, y up, z forward, the ground at y = 0):
// f.hip (his hip joint, seated), f.grip (where his hands go), f.peg (where his soles go), f.seatY.
function hoverChopper(f) {
  const g = new THREE.Group();
  const paint = mat('#1d1826', { roughness: 0.25, metalness: 0.3 }), red = mat('#e8344e', { roughness: 0.3, metalness: 0.2 }), seatM = mat('#3b2a24', { roughness: 0.7 });
  const S = f.seatY;
  const rr = S * 0.56, rf = S * 0.48;
  const zr = -S * 1.0, zf = S * 1.95;
  const lights = [], glows = [];
  // A hover pod: a red drum with a chrome band, a glowing ring under it, light streaming from its belly.
  const pod = (r, y, z) => {
    const body = mesh(new THREE.CylinderGeometry(r, r * 1.06, r * 0.46, 36), red, 0, y, z, g);
    mesh(new THREE.TorusGeometry(r * 1.04, r * 0.07, 8, 40), chrome(), 0, y - r * 0.12, z, g).rotation.x = Math.PI / 2;
    mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, r * 0.5, 24), chrome(), 0, y + r * 0.04, z, g);
    const ring = mesh(new THREE.TorusGeometry(r * 0.8, r * 0.1, 10, 40), lamp('#b48cff'), 0, y - r * 0.24, z, g);
    ring.rotation.x = Math.PI / 2;
    lights.push(ring.material);
    const glow = new THREE.Mesh(new THREE.CircleGeometry(r * 0.78, 32), new THREE.MeshBasicMaterial({ color: '#c9a8ff', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.rotation.x = Math.PI / 2;
    glow.position.set(0, y - r * 0.25, z);
    g.add(glow);
    glows.push(glow.material);
    return body;
  };
  pod(rr * 0.92, rr * 0.95, zr);
  pod(rf * 0.78, rf * 0.92, zf);
  // The frame: a low backbone from the head tube to the back pod, the engine and the tank on top.
  // The tank just clear of his tummy, the head tube past it (the bars then reach back to his hands).
  const tankZ = Math.max(f.belly + S * 0.4, (f.hip.z + f.grip.z) / 2 + S * 0.08);
  const headT = new THREE.Vector3(0, f.grip.y - S * 0.5, Math.max(f.grip.z - S * 0.05, tankZ + S * 0.42));
  bar(new THREE.Vector3(0, rr * 1.05, zr), headT, S * 0.09, chrome(), g);
  bar(new THREE.Vector3(0, rr * 0.75, zr + S * 0.25), new THREE.Vector3(0, rr * 0.8, S * 0.5), S * 0.11, paint, g);
  bar(new THREE.Vector3(0, rr * 0.8, S * 0.5), headT, S * 0.11, paint, g);
  // (Narrow, so his boots on the pegs show either side of it.)
  const engine = mesh(new THREE.BoxGeometry(S * 0.28, S * 0.38, S * 0.46), chrome(), 0, rr * 0.95, S * 0.1, g);
  engine.rotation.x = 0.2;
  for (const s of [-1, 1]) mesh(new THREE.CylinderGeometry(S * 0.13, S * 0.13, S * 0.08, 20), paint, s * S * 0.17, rr * 1.0, S * 0.1, g).rotation.z = Math.PI / 2;
  const tank = mesh(new THREE.SphereGeometry(1, 32, 20), red, 0, (S + headT.y) / 2 + S * 0.05, tankZ, g);
  tank.scale.set(S * 0.3, S * 0.24, S * 0.4);
  tank.rotation.x = -0.18;
  // The long raked fork down to the front pod, high bars up from it.
  const forkEnd = new THREE.Vector3(0, rf * 1.05, zf);
  for (const s of [-1, 1]) bar(new THREE.Vector3(s * S * 0.13, headT.y + S * 0.05, headT.z), forkEnd.clone().setX(s * S * 0.13), S * 0.055, chrome(), g);
  const forkDir = forkEnd.clone().sub(headT).normalize();
  for (const s of [-1, 1]) bar(forkEnd.clone().setX(s * S * 0.13).addScaledVector(forkDir, -S * 0.55), forkEnd.clone().setX(s * S * 0.13).addScaledVector(forkDir, -S * 0.05), S * 0.085, paint, g);
  for (const s of [-1, 1]) bar(new THREE.Vector3(s * S * 0.13, headT.y + S * 0.05, headT.z), new THREE.Vector3(s * f.grip.x, f.grip.y, f.grip.z), S * 0.045, chrome(), g);
  for (const s of [-1, 1]) mesh(new THREE.CapsuleGeometry(S * 0.065, S * 0.16, 4, 10), seatM, s * f.grip.x, f.grip.y, f.grip.z, g).rotation.z = Math.PI / 2;
  const light = mesh(new THREE.SphereGeometry(S * 0.17, 24, 16), lamp('#fff2c8'), 0, headT.y + S * 0.02, headT.z + S * 0.24, g);
  mesh(new THREE.TorusGeometry(S * 0.16, S * 0.035, 8, 24), chrome(), 0, headT.y + S * 0.02, headT.z + S * 0.3, g);
  lights.push(light.material);
  // A low seat, a chrome sissy bar behind it, two pipes along the side, the pegs.
  const seat = mesh(new THREE.CapsuleGeometry(S * 0.17, S * 0.55, 8, 20), seatM, 0, S - S * 0.1, f.hip.z - S * 0.14, g);
  seat.rotation.x = Math.PI / 2;
  seat.scale.set(1.5, 1, 0.75);
  const sissy = new THREE.CatmullRomCurve3([new THREE.Vector3(-S * 0.2, S * 0.85, zr + S * 0.1), new THREE.Vector3(-S * 0.18, S * 1.45, zr - S * 0.05), new THREE.Vector3(0, S * 1.62, zr - S * 0.1), new THREE.Vector3(S * 0.18, S * 1.45, zr - S * 0.05), new THREE.Vector3(S * 0.2, S * 0.85, zr + S * 0.1)]);
  mesh(new THREE.TubeGeometry(sissy, 24, S * 0.04, 8), chrome(), 0, 0, 0, g);
  for (const y of [rr * 0.7, rr * 0.98]) {
    bar(new THREE.Vector3(S * 0.18, y + S * 0.12, S * 0.2), new THREE.Vector3(S * 0.3, y, S * 0.02), S * 0.06, chrome(), g);
    bar(new THREE.Vector3(S * 0.3, y, S * 0.02), new THREE.Vector3(S * 0.32, y + S * 0.12, zr - S * 0.5), S * 0.06, chrome(), g);
  }
  for (const s of [-1, 1]) {
    mesh(new THREE.BoxGeometry(S * 0.2, S * 0.05, S * 0.22), chrome(), s * f.pegX, f.peg.y - S * 0.04, f.peg.z, g);
    bar(new THREE.Vector3(s * S * 0.12, f.peg.y - S * 0.04, f.peg.z - S * 0.05), new THREE.Vector3(s * (f.pegX - S * 0.08), f.peg.y - S * 0.04, f.peg.z), S * 0.03, chrome(), g);
  }
  const tail = mesh(new THREE.SphereGeometry(S * 0.08, 12, 8), lamp('#ff3a5a'), 0, rr * 1.6, zr - rr * 0.95, g);
  // A soft pool of violet light on the ground under it.
  const pool = new THREE.Mesh(
    new THREE.PlaneGeometry(S * 2.4, S * 4.2),
    new THREE.ShaderMaterial({
      uniforms: { uStrength: { value: 1 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform float uStrength; varying vec2 vUv; void main() { vec2 p = (vUv - 0.5) * 2.0; float d = dot(p, p); gl_FragColor = vec4(vec3(0.62, 0.45, 1.0) * exp(-d * 3.0) * 0.6 * uStrength, 1.0); }',
    }),
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(0, 0.06, (zr + zf) / 2);
  pool.renderOrder = 3;
  return { group: g, lights, glows, tail: tail.material, pool };
}

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


export function createRider({ chog, groundAt }) {
  chog.float?.(true);
  chog.play('idle');
  const bone = (n) => chog.root.getObjectByName(n);
  const B = {
    hips: bone('Hips'),
    legs: ['L', 'R'].map((s) => ({ thigh: bone('Thigh' + s), shin: bone('Shin' + s), foot: bone('Foot' + s) })),
    arms: ['L', 'R'].map((s) => ({ s: s === 'L' ? 1 : -1, up: bone('UpperArm' + s), fore: bone('ForeArm' + s), hand: bone('Hand' + s) })),
  };
  // His measures, standing, in metres from his feet, at his own size: the chopper is built for that and
  // the whole ride scaled up to the size he is out here (built at his outdoor size as it was, it came
  // out a toy under him).
  const size = chog.root.scale.x;
  const keep = { p: chog.root.position.clone(), r: chog.root.rotation.clone() };
  chog.root.position.set(0, 0, 0);
  chog.root.rotation.set(0, 0, 0);
  chog.root.scale.setScalar(1);
  chog.root.updateMatrixWorld(true);
  const W = (o) => o.getWorldPosition(new THREE.Vector3());
  const hipY = W(B.hips).y;
  const L = B.legs[0];
  const thigh = W(L.thigh).distanceTo(W(L.shin)), shin = W(L.shin).distanceTo(W(L.foot)), ankle = W(L.foot).y;
  const hipX = Math.abs(W(L.thigh).x);
  // How far his tummy reaches in front of his hips (the 10-21 cast is rounder: the tank, set by his arms'
  // reach alone, sat inside him).
  let skin = null;
  chog.root.traverse((o) => o.isSkinnedMesh && (!skin || o.geometry.attributes.position.count > skin.geometry.attributes.position.count) && (skin = o));
  let belly = 0.25;
  if (skin) {
    const bones = skin.skeleton.bones;
    const core = new Set(['Hips', 'Spine', 'Chest'].map((n) => bones.findIndex((b) => b.name === n)));
    const pos = skin.geometry.attributes.position, si = skin.geometry.attributes.skinIndex, sw = skin.geometry.attributes.skinWeight;
    const v = new THREE.Vector3(), hz = W(B.hips).z;
    for (let i = 0; i < pos.count; i++) {
      let w = 0;
      for (let j = 0; j < 4; j++) if (core.has(si.getComponent(i, j))) w += sw.getComponent(i, j);
      if (w < 0.5) continue;
      v.fromBufferAttribute(pos, i).applyMatrix4(skin.matrixWorld);
      belly = Math.max(belly, v.z - hz);
    }
  }
  const A = B.arms[0];
  const shoulder = W(A.up);
  const arm = shoulder.distanceTo(W(A.fore)) + W(A.fore).distanceTo(W(A.hand));
  chog.root.position.copy(keep.p);
  chog.root.rotation.copy(keep.r);
  // Seated: thighs forward by SIT, shins hanging. Where everything lands, his hips at the origin.
  const knee = new THREE.Vector3(0, -Math.cos(SIT) * thigh, Math.sin(SIT) * thigh);
  const sole = knee.clone().add(new THREE.Vector3(0, -shin - ankle, shin * 0.12));
  const PEG = 0.72;
  const hipAt = PEG - sole.y;
  const f = { hip: new THREE.Vector3(0, hipAt, 0), peg: new THREE.Vector3(0, PEG, sole.z), seatY: hipAt - thigh * 0.28, belly, pegX: hipX * 1.6 };
  const sh = new THREE.Vector3(Math.abs(shoulder.x), hipAt + (shoulder.y - hipY), shoulder.z);
  const down = arm * 0.42;
  const fwdReach = Math.sqrt(Math.max(0.01, (arm * 0.9) ** 2 - down * down - (arm * 0.12) ** 2));
  f.grip = new THREE.Vector3(sh.x + arm * 0.12, sh.y - down, sh.z + fwdReach);

  const ride = hoverChopper(f);
  const group = new THREE.Group();
  group.name = 'rider';
  const lean = new THREE.Group();
  lean.scale.setScalar(size);
  ride.pool.scale.multiplyScalar(size);
  group.add(lean, ride.pool);
  lean.add(ride.group, chog.root);
  chog.root.position.set(0, hipAt - hipY, 0);

  const saved = [];
  const posed = [...B.legs.flatMap((l) => [l.thigh, l.shin]), ...B.arms.flatMap((a) => [a.up, a.fore])];
  const grip = new THREE.Vector3(), pole = new THREE.Vector3();
  const pose = () => {
    posed.forEach((b, i) => (saved[i] = b.quaternion.clone()));
    // Each leg reaching its peg, the knee forward and up (in the bike's frame, so it works whichever way
    // the rig's own bones are turned: the 10-21 cast's thighs turned about their length here and hung
    // straight down through the bike).
    lean.updateMatrixWorld(true);
    B.legs.forEach((l, i) => {
      const sx = i === 0 ? 1 : -1;
      grip.set(sx * f.pegX, f.peg.y + ankle, f.peg.z).applyMatrix4(lean.matrixWorld);
      pole.set(sx * 0.25, 0.5, 1).transformDirection(lean.matrixWorld);
      reach(l.thigh, l.shin, l.foot, grip, pole);
    });
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
  // Swerving round your Chog: how far he's off his line, to his right.
  let side = 0, sideV = 0, slow = 1;
  const p = new THREE.Vector3(), ahead = new THREE.Vector3(), behind = new THREE.Vector3();
  const hits = [];
  // The bike's half width and how far it reaches behind him, out here; how far he swings off his line.
  const BIKE_HALF = 0.6 * size, BIKE_BACK = 1.3 * size, SWERVE = 4.6;
  // avoid: what's about, [{ x, z, r }] (your Chog, the hoverboards, the cast), or null.
  const place = (dt, avoid = null) => {
    const u = (s / length) % 1;
    route.getPointAt(u, p);
    route.getPointAt((u + 4 / length) % 1, ahead);
    route.getPointAt((u - 4 / length + 1) % 1, behind);
    // Anything in his way (your Chog, a hoverboard, one of the cast): he eases off and swings wide of it
    // to whichever side clears everything there, nearest his line; with no way round he stops and waits
    // (the user, 10-21: he rode through a hoverboard and Dash).
    const fx = ahead.x - behind.x, fz = ahead.z - behind.z, fl = Math.hypot(fx, fz) || 1;
    const dx = fx / fl, dz = fz / fl;
    let goal = 0, ease = 1;
    hits.length = 0;
    for (const o of avoid ?? []) {
      const rx = o.x - p.x, rz = o.z - p.z;
      const f = rx * dx + rz * dz, l = rx * -dz + rz * dx;
      if (f > -BIKE_BACK && f < 16 && Math.abs(l) < 7) hits.push({ f, l, r: o.r + BIKE_HALF });
    }
    if (hits.length) {
      const clear = (g) => Math.abs(g) <= SWERVE && hits.every((h) => Math.abs(h.l - g) >= h.r - 0.01);
      let best = clear(0) ? 0 : null;
      for (const h of hits) for (const g of [h.l - h.r, h.l + h.r]) if (clear(g) && (best === null || Math.abs(g - side) < Math.abs(best - side))) best = g;
      // The nearest thing ahead still across his path where he is now.
      let block = null;
      for (const h of hits) if (h.f > 0 && Math.abs(h.l - side) < h.r && (!block || h.f < block.f)) block = h;
      if (best === null) {
        goal = side;
        if (block) ease = THREE.MathUtils.clamp((block.f - block.r - 0.5) / 5, 0, 1);
      } else {
        goal = best;
        if (block) ease = THREE.MathUtils.clamp((block.f - block.r) / 7, 0, 1);
      }
    }
    sideV += ((goal - side) * 6 - sideV * 4.5) * dt;
    side += sideV * dt;
    slow += (ease - slow) * Math.min(1, dt * 3);
    // Lean into the turn: how fast his line turns, times the speed (and into a swerve as it starts).
    const h0 = Math.atan2(p.x - behind.x, p.z - behind.z), h1 = Math.atan2(ahead.x - p.x, ahead.z - p.z);
    let turn = h1 - h0;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    roll += (THREE.MathUtils.clamp(-turn * SPEED * 0.5 + sideV * 0.12, -0.38, 0.38) - roll) * Math.min(1, dt * 3 || 1);
    p.x += -dz * side;
    p.z += dx * side;
    const want = groundAt(p.x, p.z, y ?? 60);
    y = y === null || dt === 0 ? want : y + (want - y) * Math.min(1, dt * 10);
    // (Turned a little into a swerve.)
    const yaw = Math.atan2(ahead.x - behind.x, ahead.z - behind.z) - Math.atan2(sideV, Math.max(SPEED * slow, 3));
    group.position.set(p.x, y, p.z);
    group.rotation.y = yaw;
    lean.rotation.z = roll;
    // Bobbing on its pods, its nose up a slope with it.
    lean.position.y = Math.sin(t * 2.2) * 0.06;
    const ya = groundAt(ahead.x, ahead.z, y), yb = groundAt(behind.x, behind.z, y);
    lean.rotation.x = -Math.atan2(ya - yb, 8) * 0.9;
  };
  place(0);

  return {
    group,
    chog,
    // Puts him a distance along the ride.
    at(d) {
      s = d;
      place(0);
    },
    // avoid: [{ x, z, r }] to keep clear of (src/npcs.js: your Chog, the hoverboards, the cast), or null.
    update(dt, env, camera, avoid = null) {
      t += dt;
      s = (s + SPEED * slow * dt) % length;
      place(dt, avoid);
      const night = env?.night ?? 0;
      for (const m of ride.lights) m.emissiveIntensity = 1.2 + night * 2.5;
      for (const m of ride.glows) m.opacity = 0.45 + night * 0.5 + Math.sin(t * 9) * 0.05;
      ride.tail.emissiveIntensity = 1 + night * 2;
      ride.pool.material.uniforms.uStrength.value = 0.35 + night * 1.2;
      unpose();
      chog.update(dt, camera);
      pose();
    },
  };
}
