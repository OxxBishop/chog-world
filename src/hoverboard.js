import * as THREE from 'three';
import { DOMES } from './layout.js';

/*
 * Hoverboards (the user, 10-19): a way to get round the islands. One waits by every dome's door,
 * hovering a hand over the ground with violet light under it. Walk up to one and ride it
 * (src/travel.js): your Chog stands on it and goes about twice as fast, the board leaning into the turns;
 * hop off and it waits where you left it.
 *
 * All the boards are a handful of instanced meshes (five draw calls for every board), each moved every
 * frame: bobbing where it's parked, or carried under your Chog.
 */

export const BOARD = { len: 2.7, wide: 1.15, thick: 0.2, hover: 0.55 };

// Where they wait: beside each dome's drive, a few metres from its door.
function spots() {
  const out = [];
  for (const d of DOMES) {
    const out2 = { x: Math.sin(d.facing), z: Math.cos(d.facing) };
    const side = { x: out2.z, z: -out2.x };
    out.push({ x: d.doorX + out2.x * 2.5 + side.x * 4.2, z: d.doorZ + out2.z * 2.5 + side.z * 4.2, yaw: d.facing + Math.PI / 2 + 0.25 });
  }
  return out;
}

export function buildHoverboards(scene, groundAt) {
  const L = BOARD.len, W = BOARD.wide, T = BOARD.thick;
  // The deck: a rounded slab (a capsule laid along z, flattened).
  const deckGeo = new THREE.CapsuleGeometry(W / 2, L - W, 6, 20).rotateX(Math.PI / 2).scale(1, T / W, 1);
  const stripeGeo = new THREE.CapsuleGeometry(W * 0.16, L * 0.8 - W * 0.32, 4, 12).rotateX(Math.PI / 2).scale(1, 0.25, 1).translate(0, T * 0.52, 0);
  const ringGeo = new THREE.TorusGeometry(W * 0.3, 0.05, 8, 28).rotateX(Math.PI / 2);
  const glowGeo = new THREE.CircleGeometry(W * 0.3, 24).rotateX(Math.PI / 2);
  const poolGeo = new THREE.PlaneGeometry(W * 2.6, L * 1.6).rotateX(-Math.PI / 2);
  const deckMat = new THREE.MeshStandardMaterial({ color: '#f5f1ff', roughness: 0.28, metalness: 0.15 });
  const stripeMat = new THREE.MeshStandardMaterial({ color: '#8f6bf0', emissive: new THREE.Color('#8f6bf0'), emissiveIntensity: 0.3, roughness: 0.4 });
  const ringMat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: new THREE.Color('#b48cff'), emissiveIntensity: 1.6 });
  const glowMat = new THREE.MeshBasicMaterial({ color: '#c9a8ff', transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const poolMat = new THREE.ShaderMaterial({
    uniforms: { uStrength: { value: 1 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform float uStrength; varying vec2 vUv; void main() { vec2 p = (vUv - 0.5) * 2.0; float d = dot(p, p); gl_FragColor = vec4(vec3(0.62, 0.45, 1.0) * exp(-d * 3.2) * 0.55 * uStrength, 1.0); }',
  });

  const list = spots().map((s, i) => ({ ...s, y: groundAt(s.x, s.z, null), parked: true, k: i * 1.7, roll: 0, lift: BOARD.hover, carried: null }));
  const n = list.length;
  const mk = (geo, mat, count, shadow = false) => {
    const m = new THREE.InstancedMesh(geo, mat, count);
    m.frustumCulled = false;
    m.castShadow = shadow;
    scene.add(m);
    return m;
  };
  const deck = mk(deckGeo, deckMat, n, true);
  const stripe = mk(stripeGeo, stripeMat, n);
  const rings = mk(ringGeo, ringMat, n * 2);
  const glows = mk(glowGeo, glowMat, n * 2);
  const pools = mk(poolGeo, poolMat, n);
  pools.renderOrder = 3;

  const m4 = new THREE.Matrix4(), base = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
  const offset = new THREE.Matrix4();
  let t = 0;
  const place = (b, i) => {
    // The deck's middle: under your Chog's feet (lift over the ground), or bobbing where it's parked.
    const y = b.parked ? b.y + BOARD.hover + Math.sin(t * 1.8 + b.k) * 0.05 : b.carried.y + b.lift - T / 2;
    e.set(b.parked ? Math.sin(t * 1.3 + b.k) * 0.02 : 0, b.yaw, b.parked ? Math.sin(t * 1.1 + b.k) * 0.025 : b.roll, 'YXZ');
    base.compose(v.set(b.parked ? b.x : b.carried.x, y, b.parked ? b.z : b.carried.z), q.setFromEuler(e), one);
    deck.setMatrixAt(i, base);
    stripe.setMatrixAt(i, base);
    for (let k = 0; k < 2; k++) {
      offset.makeTranslation(0, -T / 2 - 0.03, (k ? -1 : 1) * L * 0.3);
      rings.setMatrixAt(i * 2 + k, m4.multiplyMatrices(base, offset));
      offset.makeTranslation(0, -T / 2 - 0.05, (k ? -1 : 1) * L * 0.3);
      glows.setMatrixAt(i * 2 + k, m4.multiplyMatrices(base, offset));
    }
    // The pool lies on the ground under it, turned with it.
    const gy = b.parked ? b.y : b.carried.y;
    q.setFromAxisAngle(v.set(0, 1, 0), b.yaw);
    pools.setMatrixAt(i, m4.compose(v.set(b.parked ? b.x : b.carried.x, gy + 0.05, b.parked ? b.z : b.carried.z), q, one));
  };
  list.forEach(place);

  return {
    boards: list,
    /** The nearest parked board within r of p (horizontally), or -1. */
    nearest(p, r) {
      let best = -1, bd = r;
      list.forEach((b, i) => {
        if (!b.parked) return;
        const d = Math.hypot(b.x - p.x, b.z - p.z);
        if (d < bd && Math.abs(b.y - p.y) < 2.5) (bd = d), (best = i);
      });
      return best;
    },
    /** Under your Chog from now on: carry(i, ...) each frame. */
    take(i) {
      list[i].parked = false;
      list[i].carried = new THREE.Vector3(list[i].x, list[i].y, list[i].z);
    },
    /** It moves with your Chog: ground is its feet's point on the ground, lift how high it rides. */
    carry(i, ground, yaw, roll, lift) {
      const b = list[i];
      b.carried.copy(ground);
      b.yaw = yaw;
      b.roll = roll;
      b.lift = lift;
    },
    /** Left where it is. */
    park(i, at, yaw) {
      const b = list[i];
      b.parked = true;
      b.x = at.x;
      b.z = at.z;
      b.y = groundAt(at.x, at.z, at.y);
      b.yaw = yaw;
      b.carried = null;
    },
    update(dt, env) {
      t += dt;
      list.forEach(place);
      for (const m of [deck, stripe, rings, glows, pools]) m.instanceMatrix.needsUpdate = true;
      const night = env?.night ?? 0;
      ringMat.emissiveIntensity = 1.4 + night * 1.8;
      stripeMat.emissiveIntensity = 0.25 + night * 1.2;
      glowMat.opacity = 0.55 + night * 0.4;
      poolMat.uniforms.uStrength.value = 0.4 + night * 1.1;
    },
  };
}
