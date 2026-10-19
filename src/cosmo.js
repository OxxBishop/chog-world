import * as THREE from 'three';
import { HOODS } from './layout.js';
import { heightAt } from './terrain.js';
import { makeChog } from './chog.js';
import { chogInfo } from './chogdata.js';

/*
 * Cosmo the astronaut (#68) and his dome, on the middle island's plateau (the one plateau with no
 * landmark). Three looks for the user to pick (?astro=space|tether|moon):
 *   space   a glass dome holding a pocket of space: stars and a nebula inside even at noon, Cosmo
 *           floating in zero g with little planets going round him
 *   tether  no dome: a satellite dish on the plateau and Cosmo out on a spacewalk above it, on a line
 *   moon    a clear glass dome over a grey moon garden, Cosmo bouncing round it in slow moon hops
 * createCosmo({ scene, look }) resolves to { group, chog, update(dt, env, camera) }.
 */

export const ASTRO_LOOKS = ['space', 'tether', 'moon'];
const OUTDOOR = 1.7;
const R = 11;
const PLINTH = 1.2;

const pearl = () => new THREE.MeshStandardMaterial({ color: '#f4effc', roughness: 0.34, metalness: 0.08 });
const glow = (color) => new THREE.MeshStandardMaterial({ color: '#000000', emissive: new THREE.Color(color), emissiveIntensity: 1.2, roughness: 1 });

// The pocket of space inside the dome: a deep violet sky, a nebula in three soft colours and two
// layers of twinkling stars, all worked out from the direction you look (no textures).
const SPACE_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const SPACE_FRAG = /* glsl */ `
uniform float uTime;
varying vec3 vDir;
float hash(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
float noise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
vec3 stars(vec3 d, float scale, float keep) {
  vec3 p = d * scale, i = floor(p), f = fract(p) - 0.5;
  float h = hash(i);
  if (h < keep) return vec3(0.0);
  vec3 o = (vec3(hash(i + 1.3), hash(i + 2.7), hash(i + 5.1)) - 0.5) * 0.5;
  float r = length(f - o);
  float tw = 0.55 + 0.45 * sin(uTime * (1.2 + h * 2.5) + h * 40.0);
  vec3 col = mix(vec3(0.78, 0.82, 1.0), vec3(1.0, 0.86, 0.72), hash(i + 9.0));
  return col * smoothstep(0.11, 0.0, r) * tw * 2.4;
}
void main() {
  vec3 d = normalize(vDir);
  vec3 base = mix(vec3(0.035, 0.016, 0.09), vec3(0.09, 0.035, 0.19), smoothstep(-0.2, 1.0, d.y));
  float n1 = fbm(d * 2.1 + vec3(0.0, uTime * 0.008, 0.0));
  float n2 = fbm(d * 4.3 + 3.1);
  float n3 = fbm(d * 3.0 + 7.7);
  vec3 neb = vec3(0.46, 0.2, 0.86) * smoothstep(0.42, 0.78, n1) * 0.85
           + vec3(1.0, 0.42, 0.74) * smoothstep(0.56, 0.86, n2) * 0.45
           + vec3(0.22, 0.74, 0.82) * smoothstep(0.6, 0.9, n3) * 0.3;
  vec3 col = base + neb + stars(d, 48.0, 0.9) + stars(d, 120.0, 0.955) * 0.55;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function glassMaterial(tint = '#d9ccff', edge = 0.78) {
  const m = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(tint).lerp(new THREE.Color('#ffffff'), 0.7),
    roughness: 0.03,
    metalness: 0,
    transparent: true,
    envMapIntensity: 1.5,
    depthWrite: false,
    specularIntensity: 1,
  });
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `float fres = pow(clamp(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0), 3.0);
diffuseColor.a = mix(0.05, ${edge.toFixed(2)}, fres);
outgoingLight += mix(vec3(1.0, 0.6, 0.92), vec3(0.5, 0.88, 1.0), fres) * fres * 0.22;
#include <opaque_fragment>`,
    );
  };
  m.customProgramCacheKey = () => `cosmo-glass-${edge}`;
  return m;
}

// The dome's base: a rounded pearl ring with a band of light round it, sunk a little into the plateau.
function plinth(group, lights) {
  const prof = [
    new THREE.Vector2(R - 0.1, PLINTH),
    new THREE.Vector2(R + 0.35, PLINTH),
    new THREE.Vector2(R + 0.62, PLINTH - 0.12),
    new THREE.Vector2(R + 0.78, PLINTH - 0.4),
    new THREE.Vector2(R + 0.95, 0.1),
    new THREE.Vector2(R + 1.05, -0.8),
  ];
  const ring = new THREE.Mesh(new THREE.LatheGeometry(prof, 128), pearl());
  ring.castShadow = ring.receiveShadow = true;
  group.add(ring);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.86, R + 0.86, 0.14, 128, 1, true), glow('#b98cff'));
  band.position.y = 0.55;
  group.add(band);
  lights.push(band.material);
}

// Thin pearl ribs over the glass and a little cap with a blinking light on top: something for the eye
// to hold on to from across the sky.
function ribs(group, lights) {
  const mat = pearl();
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const pts = [];
    for (let k = 0; k <= 24; k++) {
      const e = (k / 24) * (Math.PI / 2) * 0.93;
      pts.push(new THREE.Vector3(Math.cos(a) * Math.cos(e) * (R + 0.04), PLINTH + Math.sin(e) * (R + 0.04), Math.sin(a) * Math.cos(e) * (R + 0.04)));
    }
    const rib = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.1, 6), mat);
    rib.castShadow = true;
    group.add(rib);
  }
  const capY = PLINTH + R * Math.sin((Math.PI / 2) * 0.93);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.0, R * Math.cos((Math.PI / 2) * 0.93) + 0.15, 0.5, 48), mat);
  cap.position.y = capY + 0.1;
  group.add(cap);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 1.6, 8), mat);
  mast.position.y = capY + 1.1;
  group.add(mast);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 10), glow('#ff6b8a'));
  tip.position.y = capY + 1.95;
  group.add(tip);
  return tip.material;
}

// Little planets and twinkling star bits, going round inside the dome.
function orbiters(group) {
  const items = [];
  const planet = (r, color, orbit, y, speed, phase, ring = null) => {
    const p = new THREE.Group();
    const ball = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 18), new THREE.MeshStandardMaterial({ color, roughness: 0.55 }));
    p.add(ball);
    if (ring) {
      const rg = new THREE.Mesh(new THREE.RingGeometry(r * 1.35, r * 1.95, 64), new THREE.MeshStandardMaterial({ color: ring, roughness: 0.6, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
      rg.rotation.x = -Math.PI / 2 + 0.45;
      p.add(rg);
    }
    group.add(p);
    items.push({ p, orbit, y, speed, phase });
  };
  planet(0.75, '#ffb27c', 6.2, PLINTH + 7.2, 0.11, 0.4, '#ffe3bd');
  planet(0.5, '#64e0cf', 5.0, PLINTH + 3.4, -0.17, 2.3);
  planet(0.36, '#d9d1f3', 7.4, PLINTH + 5.0, 0.07, 4.4);
  planet(0.28, '#ff8cc0', 3.6, PLINTH + 8.4, -0.22, 1.2);
  const bits = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.11), new THREE.MeshBasicMaterial({ color: '#fff1c2' }), 46);
  const seeds = [];
  for (let i = 0; i < bits.count; i++) {
    const a = Math.random() * Math.PI * 2, rr = 2 + Math.random() * (R - 4), y = PLINTH + 1.5 + Math.random() * (R - 4.5) * Math.sqrt(1 - (rr / R) ** 2);
    seeds.push({ x: Math.cos(a) * rr, y, z: Math.sin(a) * rr, s: 0.6 + Math.random() * 0.8, w: 1 + Math.random() * 2.5, k: Math.random() * 10 });
  }
  bits.frustumCulled = false;
  group.add(bits);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  return (t) => {
    for (const it of items) {
      const a = it.phase + t * it.speed;
      it.p.position.set(Math.cos(a) * it.orbit, it.y + Math.sin(t * 0.3 + it.phase) * 0.35, Math.sin(a) * it.orbit);
      it.p.rotation.y = t * 0.4;
    }
    for (let i = 0; i < seeds.length; i++) {
      const s = seeds[i];
      const k = s.s * (0.55 + 0.45 * Math.sin(t * s.w + s.k));
      m.compose(v.set(s.x, s.y + Math.sin(t * 0.4 + s.k) * 0.25, s.z), q.setFromEuler(e.set(t * 0.7 + s.k, t * 0.5, 0)), sc.setScalar(k));
      bits.setMatrixAt(i, m);
    }
    bits.instanceMatrix.needsUpdate = true;
  };
}

// A grey moon floor with craters, inside the plinth.
function moonFloor() {
  const geo = new THREE.CircleGeometry(R - 0.05, 96, 0, Math.PI * 2);
  // More rings than CircleGeometry gives, for the craters' rims.
  const g = new THREE.BufferGeometry();
  const pos = [], idx = [];
  const RINGS = 40, SEG = 120;
  pos.push(0, 0, 0);
  for (let r = 1; r <= RINGS; r++) for (let s = 0; s < SEG; s++) {
    const a = (s / SEG) * Math.PI * 2, rr = (r / RINGS) * (R - 0.05);
    pos.push(Math.cos(a) * rr, 0, Math.sin(a) * rr);
  }
  for (let s = 0; s < SEG; s++) idx.push(0, 1 + ((s + 1) % SEG), 1 + s);
  for (let r = 1; r < RINGS; r++) for (let s = 0; s < SEG; s++) {
    const a = 1 + (r - 1) * SEG + s, b = 1 + (r - 1) * SEG + ((s + 1) % SEG), c = a + SEG, d = b + SEG;
    idx.push(a, b, c, b, d, c);
  }
  const craters = [[3.2, 2.1, 2.2], [-4.6, -2.8, 2.8], [-1.5, 5.6, 1.6], [5.8, -4.2, 1.9], [-6.8, 3.4, 1.3], [1.4, -6.6, 1.5]];
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], z = pos[i + 2];
    let y = Math.sin(x * 0.7) * Math.cos(z * 0.6) * 0.08;
    for (const [cx, cz, cr] of craters) {
      const d = Math.hypot(x - cx, z - cz) / cr;
      if (d < 1) y -= (1 - d * d) * 0.45 * cr * 0.35;
      else if (d < 1.5) y += Math.sin(((d - 1) / 0.5) * Math.PI) * 0.12 * cr;
    }
    const edge = Math.hypot(x, z) / R;
    pos[i + 1] = y * (1 - THREE.MathUtils.smoothstep(edge, 0.85, 1));
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  geo.dispose();
  const floor = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: '#c5c0d3', roughness: 0.95, flatShading: true }));
  floor.receiveShadow = true;
  return { floor, craters };
}

// A white dish on a post, tilted up at the sky, and a short mast beside it.
function dish(group, lights) {
  const mat = pearl();
  const pts = [];
  for (let i = 0; i <= 20; i++) {
    const r = (i / 20) * 3.2;
    pts.push(new THREE.Vector2(r, (r * r) / 9));
  }
  const bowl = new THREE.Mesh(new THREE.LatheGeometry(pts, 64), new THREE.MeshStandardMaterial({ color: '#f4effc', roughness: 0.4, side: THREE.DoubleSide }));
  bowl.castShadow = true;
  const head = new THREE.Group();
  head.add(bowl);
  // The rim, and three struts holding the feed over the bowl.
  const rim = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.09, 8, 64), mat);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = (3.2 * 3.2) / 9;
  head.add(rim);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const from = new THREE.Vector3(Math.cos(a) * 3.1, rim.position.y, Math.sin(a) * 3.1), to = new THREE.Vector3(0, 2.7, 0);
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, from.distanceTo(to), 6), mat);
    strut.position.copy(from).add(to).multiplyScalar(0.5);
    strut.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
    head.add(strut);
  }
  const feed = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 10), glow('#b98cff'));
  feed.position.y = 2.7;
  head.add(feed);
  lights.push(feed.material);
  head.rotation.set(0.7, 0, -0.2);
  head.position.set(-3.5, 3.6, -2.5);
  group.add(head);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, 3.6, 16), mat);
  post.position.set(-3.5, 1.6, -2.5);
  post.castShadow = true;
  group.add(post);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.7, 0.5, 48), mat);
  base.position.set(-3.5, 0.05, -2.5);
  base.receiveShadow = true;
  group.add(base);
  // A round pad with a ring of light, the ground station's floor.
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(9, 9.4, 0.5, 96), mat);
  pad.position.y = -0.1;
  pad.receiveShadow = true;
  group.add(pad);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(8.4, 0.08, 8, 128), glow('#b98cff'));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.17;
  group.add(ring);
  lights.push(ring.material);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.14, 7, 8), mat);
  mast.position.set(3.8, 3.3, -3.6);
  group.add(mast);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 10), glow('#ff6b8a'));
  tip.position.set(3.8, 6.9, -3.6);
  group.add(tip);
  // Where the line is clipped on.
  const hook = new THREE.Vector3(-3.5, 3.0, -1.8);
  return { tip: tip.material, hook };
}

export async function createCosmo({ scene, look = 'space' }) {
  const hood = HOODS[1];
  const group = new THREE.Group();
  group.name = 'cosmo';
  group.position.set(hood.x, heightAt(hood.x, hood.z), hood.z);
  // Facing downtown, so the side you come up to from the bridge is the front.
  group.rotation.y = Math.atan2(-hood.x, -hood.z);
  scene.add(group);
  const lights = [];
  let blink = null;
  let tick = () => {};

  const info = await chogInfo(68);
  const chog = await makeChog({ ...info, traits: { ...info.traits, Aura: null }, model: 'models/npcs/chog-68.glb', keep: 0.3 });
  chog.root.scale.setScalar(OUTDOOR);
  // Floating: no shadow disc under him (the sun's own shadow still falls from him).
  chog.root.traverse((o) => o.material?.uniforms?.uLen && (o.visible = false));
  const pivot = new THREE.Group();
  pivot.add(chog.root);
  group.add(pivot);
  chog.play('idle');
  const model = chog.root.children.find((o) => o.getObjectByProperty?.('isSkinnedMesh', true));
  // His middle, so he turns about his belly and not his feet.
  chog.root.position.y = -CHOG_MID * OUTDOOR;

  if (look === 'space' || look === 'moon') {
    plinth(group, lights);
    blink = ribs(group, lights);
    const glass = new THREE.Mesh(new THREE.SphereGeometry(R, 96, 48, 0, Math.PI * 2, 0, Math.PI / 2), glassMaterial(look === 'space' ? '#cbb8ff' : '#e6ddff', look === 'space' ? 0.7 : 0.62));
    glass.position.y = PLINTH;
    glass.renderOrder = 2;
    group.add(glass);
  }

  if (look === 'space') {
    const spaceMat = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 } }, vertexShader: SPACE_VERT, fragmentShader: SPACE_FRAG, side: THREE.BackSide });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(R - 0.08, 96, 48, 0, Math.PI * 2, 0, Math.PI / 2), spaceMat);
    sky.position.y = PLINTH;
    group.add(sky);
    // The floor: a dark glassy disc with a ring of light at its edge and a pad in the middle.
    const floor = new THREE.Mesh(new THREE.CircleGeometry(R - 0.05, 96), new THREE.MeshStandardMaterial({ color: '#140b2b', roughness: 0.22, metalness: 0.4 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = PLINTH + 0.01;
    group.add(floor);
    for (const [r, w] of [[R - 0.7, 0.07], [2.2, 0.06], [1.5, 0.04]]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, w, 8, 128), glow('#a77bff'));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = PLINTH + 0.04;
      group.add(ring);
      lights.push(ring.material);
    }
    const spin = orbiters(group);
    tick = (t) => {
      spaceMat.uniforms.uTime.value = t;
      spin(t);
      // Zero g: a slow drift round the middle of the dome and a slow somersault about a turning axis.
      pivot.position.set(Math.sin(t * 0.13) * 2.2, PLINTH + 5.2 + Math.sin(t * 0.37) * 0.6, Math.sin(t * 0.17 + 1) * 1.9);
      pivot.rotation.set(t * 0.23, Math.sin(t * 0.05) * 2.5, Math.sin(t * 0.29) * 0.55);
    };
  }

  if (look === 'moon') {
    const { floor, craters } = moonFloor();
    floor.position.y = PLINTH;
    group.add(floor);
    // A little flag in the Chog purple.
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 8), pearl());
    pole.position.set(-2.6, PLINTH + 1.3, 4.6);
    group.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.95), new THREE.MeshStandardMaterial({ color: '#8b5cf6', roughness: 0.7, side: THREE.DoubleSide }));
    flag.position.set(-1.85, PLINTH + 2.1, 4.6);
    group.add(flag);
    // Hops from one spot to the next, clear of the craters' holes.
    const spots = [[0, 0], [3.8, -1.2], [1.2, 3.6], [-3.4, 1.2], [-1.8, -3.6], [4.2, 3.2], [-4.4, -1.6]];
    let from = 0, to = 1, h = 0;
    const HOP = 3.4;
    const puffs = [];
    const puffGeo = new THREE.SphereGeometry(0.22, 10, 8);
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(puffGeo, new THREE.MeshStandardMaterial({ color: '#dcd7e6', roughness: 1, transparent: true, opacity: 0 }));
      m.visible = false;
      group.add(m);
      puffs.push({ m, a: (i / 14) * Math.PI * 2, t: 9 });
    }
    const floorY = (x, z) => {
      let y = 0;
      for (const [cx, cz, cr] of craters) {
        const d = Math.hypot(x - cx, z - cz) / cr;
        if (d < 1) y -= (1 - d * d) * 0.45 * cr * 0.35;
        else if (d < 1.5) y += Math.sin(((d - 1) / 0.5) * Math.PI) * 0.12 * cr;
      }
      return y;
    };
    let puffAt = null;
    tick = (t, dt) => {
      h += dt / HOP;
      if (h >= 1) {
        h -= 1;
        from = to;
        to = (to + 1 + Math.floor(Math.random() * (spots.length - 2))) % spots.length;
        puffAt = spots[from];
        for (const p of puffs) p.t = 0;
      }
      const a = spots[from], b = spots[to];
      // Crouch, then a slow high arc, then a soft landing.
      const k = THREE.MathUtils.smootherstep(h, 0.08, 0.92);
      const x = a[0] + (b[0] - a[0]) * k, z = a[1] + (b[1] - a[1]) * k;
      const air = Math.sin(Math.PI * THREE.MathUtils.clamp((h - 0.08) / 0.84, 0, 1));
      pivot.position.set(x, PLINTH + floorY(x, z) + CHOG_MID * OUTDOOR + air * 4.2, z);
      pivot.rotation.set(air * 0.18, Math.atan2(b[0] - a[0], b[1] - a[1]), 0);
      for (const p of puffs) {
        p.t += dt;
        const on = puffAt && p.t < 1.6;
        p.m.visible = on;
        if (!on) continue;
        const r = 0.6 + p.t * 1.4;
        p.m.position.set(puffAt[0] + Math.cos(p.a) * r, PLINTH + floorY(puffAt[0], puffAt[1]) + 0.2 + p.t * 0.25, puffAt[1] + Math.sin(p.a) * r);
        p.m.scale.setScalar(1 + p.t * 1.6);
        p.m.material.opacity = 0.7 * (1 - p.t / 1.6);
      }
    };
  }

  if (look === 'tether') {
    const d = dish(group, lights);
    blink = d.tip;
    // The line: short segments laid along a sagging curve from the dish to his belt, every frame.
    const SEG = 28;
    const line = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.045, 0.045, 1, 6, 1, true), new THREE.MeshStandardMaterial({ color: '#ffd36b', roughness: 0.5, metalness: 0.3 }), SEG);
    line.frustumCulled = false;
    group.add(line);
    const belt = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), mid = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    const at = (s, out) => {
      // A quadratic curve whose middle sags below the straight line.
      mid.copy(d.hook).lerp(belt, 0.5);
      mid.y -= 2.2;
      return out.copy(d.hook).multiplyScalar((1 - s) * (1 - s)).addScaledVector(mid, 2 * s * (1 - s)).addScaledVector(belt, s * s);
    };
    tick = (t) => {
      pivot.position.set(Math.sin(t * 0.11) * 3, 11.5 + Math.sin(t * 0.33) * 0.9, 1.5 + Math.sin(t * 0.16 + 1) * 2.5);
      pivot.rotation.set(Math.sin(t * 0.12) * 0.9, t * 0.06, Math.sin(t * 0.19) * 0.5 + 0.2);
      pivot.updateMatrixWorld(true);
      belt.set(0, 0, -0.25).applyMatrix4(pivot.matrix);
      for (let i = 0; i < SEG; i++) {
        at(i / SEG, a);
        at((i + 1) / SEG, b);
        const len = a.distanceTo(b);
        q.setFromUnitVectors(up, b.clone().sub(a).normalize());
        m.compose(a.clone().add(b).multiplyScalar(0.5), q, sc.set(1, len * 1.04, 1));
        line.setMatrixAt(i, m);
      }
      line.instanceMatrix.needsUpdate = true;
    };
  }

  let t = 0;
  return {
    group,
    chog,
    update(dt, env, camera) {
      t += dt;
      const night = env?.night ?? 0;
      for (const m of lights) m.emissiveIntensity = 0.9 + night * 2.2;
      if (blink) blink.emissiveIntensity = (Math.sin(t * 3) > 0.55 ? 3 : 0.3) * (0.6 + night);
      tick(t, dt);
      if (!camera || camera.position.distanceTo(group.position) < 260) {
        chog.update(dt, camera);
        // The feet aren't kept on any ground up here.
        if (model) model.position.y = 0;
      }
    },
  };
}

// About where his belly is, in his own height.
const CHOG_MID = 1.0;
