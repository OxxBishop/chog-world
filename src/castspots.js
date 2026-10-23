import * as THREE from 'three';

/*
 * The props of the cast's own places (the user's pick, 10-23: every cast Chog gets a spot of its own),
 * built in a Chog's own measures (it stands 2.2 tall) and set out at the 1.7x outdoor scale by src/npcs.js:
 *   throne()      King Pom's dais and tall gold-and-velvet throne by the fountain, where he holds court
 *   flowerArch()  Quackers' arch of flowers on the plaza, where he poses
 *   campfire()    Toasty's fire on the beacon island: logs, a ring of stones, flames and embers; update(dt, night)
 */

const gold = () => new THREE.MeshStandardMaterial({ color: '#e9c46a', metalness: 0.75, roughness: 0.3, emissive: new THREE.Color('#5a3a08'), emissiveIntensity: 0.25 });
const velvet = () => new THREE.MeshStandardMaterial({ color: '#6b3fb8', roughness: 0.85 });

let glowTex = null;
function glow() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255, 236, 190, 1)');
  r.addColorStop(0.3, 'rgba(255, 160, 70, 0.55)');
  r.addColorStop(1, 'rgba(255, 120, 40, 0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

/** King Pom's throne: a round dais he stands on, the throne behind him (local -z), a crown on its back. */
export function throne() {
  const g = new THREE.Group();
  const G = gold(), V = velvet();
  const shadow = (m) => ((m.castShadow = true), (m.receiveShadow = true), m);
  // The dais: two steps of purple stone, gold-edged.
  const stone = new THREE.MeshStandardMaterial({ color: '#4a3486', roughness: 0.7 });
  const d1 = shadow(new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.45, 0.2, 40), stone));
  d1.position.y = 0.1;
  const d2 = shadow(new THREE.Mesh(new THREE.CylinderGeometry(1.75, 1.85, 0.2, 40), stone));
  d2.position.y = 0.3;
  const rim1 = new THREE.Mesh(new THREE.TorusGeometry(2.36, 0.045, 8, 64).rotateX(Math.PI / 2), G);
  rim1.position.y = 0.2;
  const rim2 = new THREE.Mesh(new THREE.TorusGeometry(1.8, 0.045, 8, 64).rotateX(Math.PI / 2), G);
  rim2.position.y = 0.4;
  g.add(d1, d2, rim1, rim2);
  // The throne: an arched back in velvet inside a gold frame, a cushioned seat, rolled gold arms.
  const back = new THREE.Group();
  back.position.set(0, 0.4, -1.15);
  const arch = (w, h) => {
    const s = new THREE.Shape();
    s.moveTo(-w / 2, 0);
    s.lineTo(-w / 2, h - w / 2);
    s.absarc(0, h - w / 2, w / 2, Math.PI, 0, true);
    s.lineTo(w / 2, 0);
    s.closePath();
    return s;
  };
  const frame = shadow(new THREE.Mesh(new THREE.ExtrudeGeometry(arch(2.0, 3.6), { depth: 0.22, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 2, curveSegments: 20 }), G));
  frame.position.z = -0.2;
  const panel = new THREE.Mesh(new THREE.ExtrudeGeometry(arch(1.62, 3.3), { depth: 0.12, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 2, curveSegments: 20 }), V);
  panel.position.set(0, 0.12, 0.02);
  const seat = shadow(new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.55, 1.1), G));
  seat.position.set(0, 0.28, 0.45);
  const cushion = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.18, 0.95), V);
  cushion.position.set(0, 0.64, 0.47);
  back.add(frame, panel, seat, cushion);
  for (const sx of [-1, 1]) {
    const arm = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.15, 16).rotateX(Math.PI / 2), G));
    arm.position.set(sx * 1.02, 1.05, 0.45);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.5, 12), G);
    post.position.set(sx * 1.02, 0.78, 0.9);
    back.add(arm, post);
  }
  // A crown on top of the back: a band and five points, each with a jewel.
  const crown = new THREE.Group();
  crown.position.set(0, 3.82, 0.0);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.46, 0.22, 24, 1, true), G);
  band.material = G;
  crown.add(band);
  const jewel = new THREE.MeshStandardMaterial({ color: '#ff5d8f', emissive: new THREE.Color('#ff2d6f'), emissiveIntensity: 0.6, roughness: 0.2 });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const pt = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.34, 8), G);
    pt.position.set(Math.cos(a) * 0.42, 0.26, Math.sin(a) * 0.42);
    const j = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), jewel);
    j.position.set(Math.cos(a) * 0.42, 0.46, Math.sin(a) * 0.42);
    crown.add(pt, j);
  }
  back.add(crown);
  g.add(back);
  return g;
}

/** Quackers' flower arch: a white arch wound with flowers and leaves, a planter at each foot. */
export function flowerArch() {
  const g = new THREE.Group();
  const R = 2.5;
  const white = new THREE.MeshStandardMaterial({ color: '#f7f2ff', roughness: 0.45 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(R, 0.11, 10, 48, Math.PI), white);
  ring.castShadow = true;
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(R + 0.32, 0.06, 8, 48, Math.PI), white);
  g.add(ring, ring2);
  for (const sx of [-1, 1]) {
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.4, 0.6, 16), new THREE.MeshStandardMaterial({ color: '#d9c08a', roughness: 0.6 }));
    pot.position.set(sx * (R + 0.16), 0.3, 0);
    pot.castShadow = pot.receiveShadow = true;
    const soil = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.05, 16), new THREE.MeshStandardMaterial({ color: '#5a3d2a', roughness: 1 }));
    soil.position.set(sx * (R + 0.16), 0.6, 0);
    g.add(pot, soil);
  }
  // Leaves and flowers along it (two instanced meshes), thicker toward the feet.
  const leafGeo = new THREE.SphereGeometry(0.17, 8, 6).scale(1, 0.45, 0.7);
  const flowerGeo = new THREE.IcosahedronGeometry(0.15, 1);
  const leafMat = new THREE.MeshStandardMaterial({ color: '#5fb85a', roughness: 0.7 });
  const flowerMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.55 });
  const nL = 70, nF = 46;
  const leaves = new THREE.InstancedMesh(leafGeo, leafMat, nL);
  const flowers = new THREE.InstancedMesh(flowerGeo, flowerMat, nF);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  const COLS = ['#ff8fb8', '#ffd25e', '#ffffff', '#c98cff', '#ff6f8f'].map((c) => new THREE.Color(c));
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const along = (k, out) => {
    const a = Math.PI * (k * 1.08 - 0.04);
    return out.set(Math.cos(a) * (R + 0.1 + (rnd() - 0.5) * 0.35), Math.sin(a) * (R + 0.1) + (rnd() - 0.5) * 0.3, (rnd() - 0.5) * 0.45);
  };
  for (let i = 0; i < nL; i++) {
    along(rnd() ** 0.9, p);
    e.set(rnd() * 3, rnd() * 3, rnd() * 3);
    q.setFromEuler(e);
    m.compose(p, q, sc.setScalar(0.8 + rnd() * 0.6));
    leaves.setMatrixAt(i, m);
  }
  for (let i = 0; i < nF; i++) {
    along(rnd(), p);
    m.compose(p, q.identity(), sc.setScalar(0.75 + rnd() * 0.7));
    flowers.setMatrixAt(i, m);
    flowers.setColorAt(i, COLS[i % COLS.length]);
  }
  // A few more in each planter.
  g.add(leaves, flowers);
  return g;
}

/** Toasty's campfire: stones, logs, flames that flicker, a warm glow (strong at night), embers rising. */
export function campfire() {
  const g = new THREE.Group();
  const stoneMat = new THREE.MeshStandardMaterial({ color: '#8a8794', roughness: 0.9, flatShading: true });
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.27 + (i % 3) * 0.04, 0), stoneMat);
    s.position.set(Math.cos(a) * 1.05, 0.14, Math.sin(a) * 1.05);
    s.rotation.set(i, i * 2, 0);
    s.scale.y = 0.7;
    s.castShadow = s.receiveShadow = true;
    g.add(s);
  }
  const wood = new THREE.MeshStandardMaterial({ color: '#7a4a2a', roughness: 0.9 });
  const charred = new THREE.MeshStandardMaterial({ color: '#3a2418', roughness: 1, emissive: new THREE.Color('#ff5a1a'), emissiveIntensity: 0.4 });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 1.3, 8), i % 2 ? wood : charred);
    log.position.set(Math.cos(a) * 0.32, 0.42, Math.sin(a) * 0.32);
    log.rotation.set(Math.sin(a) * 0.75, 0, -Math.cos(a) * 0.75);
    log.castShadow = true;
    g.add(log);
  }
  // Two logs to sit on.
  for (const a of [0.9, 2.5]) {
    const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.28, 1.7, 12).rotateZ(Math.PI / 2), wood);
    seat.position.set(Math.cos(a) * 2.5, 0.26, Math.sin(a) * 2.5);
    seat.rotation.y = -a + Math.PI / 2;
    seat.castShadow = seat.receiveShadow = true;
    g.add(seat);
  }
  // The flames: a few cones of light, an outer orange and an inner gold, each flickering on its own.
  const flames = [];
  const flameMat = (c, o) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const outer = flameMat('#ff7a2a', 0.75), inner = flameMat('#ffd27a', 0.9);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const r = i === 0 ? 0 : 0.18;
    const f = new THREE.Mesh(new THREE.ConeGeometry(i === 0 ? 0.36 : 0.22, i === 0 ? 1.35 : 0.9, 10, 1, true), i === 0 ? outer : i % 2 ? inner : outer);
    f.position.set(Math.cos(a) * r, 0.45 + (i === 0 ? 0.67 : 0.45), Math.sin(a) * r);
    f.userData = { k: i * 1.9, h: f.position.y };
    flames.push(f);
    g.add(f);
  }
  const core = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.7, 10, 1, true), flameMat('#fff3c8', 0.95));
  core.position.y = 0.8;
  g.add(core);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
  halo.position.y = 1.0;
  halo.scale.setScalar(4.2);
  g.add(halo);
  // Its warm light on the grass round it.
  const pool = new THREE.Mesh(new THREE.CircleGeometry(4.2, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: glow(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  pool.position.y = 0.04;
  g.add(pool);
  // Embers.
  const N = 24;
  const ep = new Float32Array(N * 3);
  const life = new Float32Array(N);
  for (let i = 0; i < N; i++) life[i] = Math.random();
  const eg = new THREE.BufferGeometry();
  eg.setAttribute('position', new THREE.BufferAttribute(ep, 3));
  const embers = new THREE.Points(eg, new THREE.PointsMaterial({ map: glow(), size: 0.22, color: '#ffb35a', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  embers.frustumCulled = false;
  g.add(embers);
  let t = 0;
  return {
    group: g,
    update(dt, night = 0) {
      t += dt;
      for (const f of flames) {
        const k = f.userData.k;
        const s = 0.85 + Math.sin(t * 9 + k) * 0.08 + Math.sin(t * 15.3 + k * 2) * 0.06;
        f.scale.set(1 + Math.sin(t * 7 + k) * 0.06, s, 1 + Math.cos(t * 8 + k) * 0.06);
        f.rotation.y = t * 0.6 + k;
      }
      core.scale.y = 0.9 + Math.sin(t * 13) * 0.1;
      const flick = 0.85 + Math.sin(t * 11) * 0.08 + Math.sin(t * 17.7) * 0.05;
      halo.material.opacity = (0.35 + night * 0.55) * flick;
      pool.material.opacity = (0.18 + night * 0.62) * flick;
      for (let i = 0; i < N; i++) {
        life[i] += dt * (0.45 + (i % 5) * 0.08);
        if (life[i] > 1) life[i] -= 1;
        const l = life[i];
        const a = i * 2.39 + l * 2;
        ep[i * 3] = Math.cos(a) * (0.15 + l * 0.5);
        ep[i * 3 + 1] = 0.7 + l * 3.2;
        ep[i * 3 + 2] = Math.sin(a) * (0.15 + l * 0.5);
      }
      eg.attributes.position.needsUpdate = true;
      embers.material.opacity = 0.9 * (0.4 + night * 0.6);
    },
  };
}
