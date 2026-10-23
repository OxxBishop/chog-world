import * as THREE from 'three';
import { hudRow } from './hudrow.js';

/*
 * The star hunt (the user's pick, 10-23): twelve gold stars tucked round the islands, one on every island
 * and both glass bridges, one floating up in Cosmo's zero g. Each turns slowly in a soft glow, with a faint
 * column of light that shows from afar; walk (or ride) into one and it bursts into sparkles with a chime,
 * and the count under the map goes up. Find all twelve and a Chog lights up in the sky, star by star, line
 * by line, and stays there. Progress is kept on the device.
 *
 * createStars({ scene, camera, travel, onFound, onAll }) -> { update(dt, env), found, total }
 * onFound(n) after each star (n found so far), onAll() after the twelfth (the testnet $CHOG, src/purse.js).
 */

// [name, x, z, lift]: lift is how high over the ground it floats (Cosmo's floats up in his zero g).
const SPOTS = [
  ['fountain', 6, 47, 1.6],
  ['stage', 33.5, 24, 1.6],
  ['plaza rim', 20, -84, 1.6],
  ['beacon bridge', 118.3, -56.2, 1.7],
  ['dome bridge', -109.2, -82.7, 1.7],
  ['giant tree', -9.7, 235.7, 1.6],
  ['garden', -32.7, 205.1, 1.6],
  ['tree island rim', -37.3, 270.4, 1.6],
  ['zero g', -228.2, -165.1, 3.8],
  ['dome loop', -170.8, -162, 1.6],
  ['beacon', 211.2, -93.9, 1.6],
  ['beacon loop', 193, -120.4, 1.6],
];
const KEY = 'chogworld.stars.v1';
const read = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
};
const write = (v) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {}
};
const sfx = (name) => dispatchEvent(new CustomEvent('chog-sfx', { detail: name }));

// A soft round glow, drawn once.
let glowTex = null;
function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255, 248, 220, 1)');
  r.addColorStop(0.25, 'rgba(255, 216, 130, 0.55)');
  r.addColorStop(1, 'rgba(255, 200, 100, 0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

// A five-pointed star, puffy and gold.
function starGeometry(outer = 0.68, inner = 0.3) {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? inner : outer;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.14, bevelEnabled: true, bevelThickness: 0.09, bevelSize: 0.08, bevelSegments: 3 });
  geo.center();
  return geo;
}

// The Chog in the sky: twelve stars, an outline of a round head and two ears, a star for its nose.
const SKY = [
  [-0.95, 0.0], [-0.74, 0.46], [-0.56, 0.98], [-0.28, 0.62], [0.28, 0.62], [0.56, 0.98],
  [0.74, 0.46], [0.95, 0.0], [0.6, -0.66], [0.0, -0.86], [-0.6, -0.66], [0.0, -0.08],
];
// Which way it is (a heading, 0 toward +z): over the tree island, out past the plaza's fountain.
const SKY_AZ = -0.05;
const SKY_LINES = [0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 0];

export function createStars({ scene, camera, travel, onFound = null, onAll = null, sense = null }) {
  const saved = read();
  const found = new Set(saved.found ?? []);
  const geo = starGeometry();
  const mat = new THREE.MeshStandardMaterial({ color: '#ffe6a0', emissive: new THREE.Color('#ffc94a'), emissiveIntensity: 1.3, roughness: 0.3, metalness: 0.35 });
  const glowMat = new THREE.SpriteMaterial({ map: glowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.6, fog: false });
  // The column of light: brightest at its foot, gone at its top.
  const beamMat = new THREE.ShaderMaterial({
    uniforms: { uA: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: 'varying float vY; void main() { vY = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform float uA; varying float vY; void main() { gl_FragColor = vec4(vec3(1.0, 0.82, 0.45) * uA * pow(1.0 - vY, 1.6) * 0.5, 1.0); }',
  });
  const beamGeo = new THREE.CylinderGeometry(0.06, 0.34, 16, 10, 1, true).translate(0, 8, 0);
  const stars = SPOTS.map(([name, x, z, lift], i) => {
    const g = travel.groundAt?.(x, z, 999);
    const y = (g ? g.y : 0) + lift;
    const group = new THREE.Group();
    group.position.set(x, y, z);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = false;
    const glow = new THREE.Sprite(glowMat);
    glow.scale.setScalar(3.1);
    const beam = new THREE.Mesh(beamGeo, beamMat.clone());
    beam.position.y = -lift + 0.05;
    beam.frustumCulled = false;
    group.add(glow, mesh, beam);
    group.visible = !found.has(name);
    scene.add(group);
    return { name, group, mesh, glow, beam, y, k: i * 1.37, gone: 0 };
  });

  // ---------- the count, and a note now and then ----------
  const pill = document.createElement('div');
  pill.className = 'pl-stars';
  pill.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.8 6.1 6.6.7-4.9 4.5 1.4 6.5L12 17.1l-5.9 3.3 1.4-6.5-4.9-4.5 6.6-.7z"/></svg><span></span>';
  pill.title = 'Stars found round the islands';
  hudRow().append(pill);
  const toast = document.createElement('div');
  toast.className = 'pl-toast';
  document.body.append(toast);
  let toastT = 0;
  const note = (html, secs = 3, low = false) => {
    toast.innerHTML = html;
    toast.classList.toggle('low', low);
    toast.classList.add('on');
    toastT = secs;
  };
  const count = () => {
    pill.lastChild.textContent = `${found.size}/${SPOTS.length}`;
    pill.classList.toggle('all', found.size === SPOTS.length);
  };
  count();

  // ---------- sparkles ----------
  const bursts = [];
  function burst(at) {
    const n = 26;
    const pos = new Float32Array(n * 3);
    const vel = [];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, u = Math.random() * 0.9 + 0.2;
      vel.push(new THREE.Vector3(Math.cos(a) * u * 3, 1.5 + Math.random() * 3, Math.sin(a) * u * 3));
      pos.set([at.x, at.y, at.z], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ map: glowTexture(), size: 0.75, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: '#ffe2a0', fog: false });
    const p = new THREE.Points(g, m);
    p.frustumCulled = false;
    scene.add(p);
    bursts.push({ p, vel, t: 0 });
  }

  // ---------- the Chog in the sky ----------
  let sky = null;
  function buildSky(drawIn) {
    const group = new THREE.Group();
    const S = 46;
    const dots = SKY.map(([x, y], i) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, color: i === 11 ? '#fff6d8' : '#ffe2a0' }));
      s.position.set(x * S, y * S, 0);
      s.scale.setScalar(i === 11 ? 9 : 12);
      group.add(s);
      return s;
    });
    const lp = new Float32Array(SKY_LINES.length * 3);
    SKY_LINES.forEach((k, i) => lp.set([SKY[k][0] * S, SKY[k][1] * S, 0], i * 3));
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(lp, 3));
    const lm = new THREE.LineBasicMaterial({ color: '#f3d58f', transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const lines = new THREE.LineSegments(lg, lm);
    group.add(lines);
    group.renderOrder = -1;
    for (const o of [lines, ...dots]) o.frustumCulled = false;
    scene.add(group);
    sky = { group, dots, lines, draw: drawIn ? 0 : 1, az: SKY_AZ };
    lg.setDrawRange(0, drawIn ? 0 : SKY_LINES.length);
  }
  if (found.size === SPOTS.length) buildSky(false);

  const me = new THREE.Vector3();
  let first = !saved.told;
  let lookUp = null;
  let shown = false;

  let senseT = 0, sensed = '';
  return {
    get found() {
      return found.size;
    },
    total: SPOTS.length,
    update(dt, env) {
      const night = env?.night ?? 0;
      const out = travel.active && travel.chog;
      if (out !== shown) document.body.classList.toggle('stars-on', (shown = !!out));
      if (out) me.copy(travel.state.pos);
      mat.emissiveIntensity = 1.2 + night * 1.6;
      glowMat.opacity = 0.5 + night * 0.4;
      // A word about the hunt, the first time you're out walking.
      if (out && first) {
        first = false;
        saved.told = true;
        write(saved);
        setTimeout(() => found.size === 0 && note('Twelve <b>stars</b> are hidden round the islands. Find them all.', 5), 5000);
      }
      // Star sense (an Eyes trait, src/islandperks.js): the stars near you on the map, twice a second.
      if ((senseT -= dt) <= 0) {
        senseT = 0.5;
        const r = out ? (sense?.() ?? 0) : 0;
        const near = r ? stars.filter((st) => st.group.visible && !st.gone && Math.hypot(me.x - st.group.position.x, me.z - st.group.position.z) < r) : [];
        const key = near.map((st) => st.name).join('|');
        if (key !== sensed) {
          sensed = key;
          travel.setPins?.('stars', near.map((st) => ({ x: st.group.position.x, z: st.group.position.z, kind: 'star' })));
        }
      }
      for (const s of stars) {
        if (!s.group.visible) continue;
        s.k += dt;
        if (s.gone > 0) {
          // Found: it leaps up, grows and fades away.
          s.gone += dt;
          const k = Math.min(1, s.gone / 0.5);
          s.group.position.y = s.y + k * 1.2;
          s.mesh.scale.setScalar(1 + k * 0.6);
          s.glow.material = s.glow.material === glowMat ? glowMat.clone() : s.glow.material;
          s.glow.material.opacity = (1 - k) * 0.9;
          s.mesh.visible = k < 0.6;
          s.beam.visible = false;
          if (k >= 1) s.group.visible = false;
          continue;
        }
        s.mesh.rotation.y = s.k * 1.3;
        s.group.position.y = s.y + Math.sin(s.k * 1.8) * 0.12;
        // The column shows from a way off and goes as you come close.
        const d = camera.position.distanceTo(s.group.position);
        s.beam.material.uniforms.uA.value = THREE.MathUtils.smoothstep(d, 10, 34) * (0.55 + night * 0.45);
        if (!out) continue;
        const dx = me.x - s.group.position.x, dz = me.z - s.group.position.z;
        // (Its middle: floating in zero g it's up off the ground.)
        const dy = me.y + (travel.state.lift ?? 0) + 1 - s.group.position.y;
        if (dx * dx + dz * dz < 2.2 * 2.2 && Math.abs(dy) < 2.6) {
          found.add(s.name);
          saved.found = [...found];
          s.gone = 0.0001;
          burst(s.group.position);
          count();
          pill.classList.remove('bump');
          void pill.offsetWidth;
          pill.classList.add('bump');
          if (found.size === SPOTS.length) {
            sfx('stars');
            // The Chog in the sky: over the open sky toward the first neighbourhood, clear of the Hub's dome.
            saved.az = SKY_AZ;
            write(saved);
            buildSky(true);
            // The view eases up to it while it draws itself, then settles back.
            lookUp = { t: 0, p0: travel.state.camPitch, y0: travel.state.camYaw };
            note('All twelve <b>stars</b>. Look up: there is a Chog in the sky.', 6, true);
            onAll?.();
          } else {
            sfx('star');
            write(saved);
            note(`<b>Star ${found.size}</b> of ${SPOTS.length}`, 2.2);
          }
          onFound?.(found.size);
        }
      }
      for (let i = bursts.length - 1; i >= 0; i--) {
        const b = bursts[i];
        b.t += dt;
        const pos = b.p.geometry.attributes.position;
        for (let j = 0; j < b.vel.length; j++) {
          b.vel[j].y -= 4 * dt;
          pos.setXYZ(j, pos.getX(j) + b.vel[j].x * dt, pos.getY(j) + b.vel[j].y * dt, pos.getZ(j) + b.vel[j].z * dt);
        }
        pos.needsUpdate = true;
        b.p.material.opacity = Math.max(0, 1 - b.t / 0.9);
        if (b.t > 0.9) {
          scene.remove(b.p);
          b.p.geometry.dispose();
          b.p.material.dispose();
          bursts.splice(i, 1);
        }
      }
      if (toastT > 0 && (toastT -= dt) <= 0) toast.classList.remove('on');
      if (lookUp && out) {
        lookUp.t += dt;
        const k = THREE.MathUtils.smootherstep(lookUp.t, 0, 1.4) * (1 - THREE.MathUtils.smootherstep(lookUp.t, 5.2, 6.8));
        const st = travel.state;
        st.camPitch = THREE.MathUtils.lerp(lookUp.p0, -0.2, k);
        let dy = sky.az + Math.PI - lookUp.y0;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        st.camYaw = lookUp.y0 + dy * k;
        st.lastLook = 0;
        if (lookUp.t > 6.8) lookUp = null;
      } else if (lookUp) lookUp = null;
      // The Chog in the sky: far off where it went up, facing you; brighter at night, drawn in line by line.
      if (sky) {
        const el = 0.15;
        sky.group.position.set(Math.sin(sky.az) * Math.cos(el), Math.sin(el), Math.cos(sky.az) * Math.cos(el)).multiplyScalar(400).add(camera.position);
        sky.group.lookAt(camera.position);
        if (sky.draw < 1) {
          sky.draw = Math.min(1, sky.draw + dt / 3.2);
          sky.lines.geometry.setDrawRange(0, Math.floor(sky.draw * SKY_LINES.length / 2) * 2);
        }
        const a = 0.45 + night * 0.55;
        sky.lines.material.opacity = 0.75 * a;
        sky.dots.forEach((d, i) => (d.material.opacity = a * THREE.MathUtils.clamp(sky.draw * 12 - i, 0, 1) * (0.85 + Math.sin(performance.now() / 600 + i) * 0.15)));
      }
    },
  };
}
