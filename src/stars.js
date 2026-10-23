import { playerStore, playerKey } from './playerstore.js';
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

// The chase (the user, 10-23: "make the stars move around ... just a fun chase"). Each star drifts about its
// spot like a wisp; come close and it darts away, a little slower than you run, tiring as you chase it, and
// never further than LEASH from its spot (or off the island), so it can always be caught.
const LEASH = 9, NOTICE = 8.5, FLEE = 3.4, TRAIL = 16;
const _d = new THREE.Vector3(), _w = new THREE.Vector3(), _n = new THREE.Vector3();
let trailMat = null;

export function createStars({ scene, camera, travel, onFound = null, onAll = null, sense = null }) {
  // This player's stars (src/playerstore.js), swapped in as the player changes (update).
  const store = playerStore(KEY);
  let saved = store.get();
  let who = playerKey();
  const write = () => store.save();
  const found = new Set(saved.found ?? []);
  const geo = starGeometry();
  trailMat ??= new THREE.PointsMaterial({ map: glowTexture(), size: 0.9, sizeAttenuation: true, vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
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
    // Its trail: a few glows behind it, fading (a wisp's tail).
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL * 3).fill(0), 3));
    tg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TRAIL * 3).fill(0), 3));
    const trail = new THREE.Points(tg, trailMat);
    trail.frustumCulled = false;
    trail.visible = group.visible;
    scene.add(trail);
    const home = new THREE.Vector3(x, y, z);
    const on = g?.on ?? 'land';
    return { name, group, mesh, glow, beam, y, lift, home, on, pos: home.clone(), vel: new THREE.Vector3(), tired: 0, chased: 0, trail, hist: [], histT: 0, leash: lift > 3 ? 2.4 : LEASH, k: i * 1.37, seed: i * 2.39, gone: 0 };
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

  // Another player: their stars out again where they haven't found them, and their sky.
  function swap() {
    who = playerKey();
    saved = store.get();
    found.clear();
    for (const n of saved.found ?? []) found.add(n);
    for (const s of stars) {
      s.gone = 0;
      s.mesh.visible = true;
      s.mesh.scale.setScalar(1);
      s.beam.visible = true;
      if (s.glow.material !== glowMat) s.glow.material = glowMat;
      s.group.visible = !found.has(s.name);
    }
    if (sky && found.size < SPOTS.length) {
      scene.remove(sky.group);
      sky = null;
    } else if (!sky && found.size === SPOTS.length) buildSky(false);
    lookUp = null;
    first = !saved.told;
    count();
  }
  const me = new THREE.Vector3();
  let first = !saved.told;
  let lookUp = null;
  let shown = false;

  // Where it goes: a slow wander round its spot; away from you when you're close.
  function move(s, dt, out) {
    const t = s.k + s.seed;
    // The wander: two slow sines each way, round its spot.
    _w.set(Math.sin(t * 0.33) * 0.6 + Math.sin(t * 0.71 + 1.3) * 0.4, 0, Math.cos(t * 0.29 + 0.7) * 0.6 + Math.sin(t * 0.53) * 0.4).multiplyScalar(s.leash * 0.45).add(s.home);
    _d.subVectors(_w, s.pos).setY(0);
    const wander = Math.min(1.3, _d.length() * 0.7);
    _d.setLength(wander);
    let chasing = false;
    if (out) {
      _n.set(s.pos.x - me.x, 0, s.pos.z - me.z);
      const dist = _n.length();
      if (dist < NOTICE) {
        chasing = true;
        // Away, faster the closer you are, slower as it tires.
        const k = THREE.MathUtils.smoothstep(NOTICE - dist, 0, NOTICE * 0.6);
        _n.setLength(FLEE * k * (1 - s.tired));
        _d.lerp(_n, k);
      }
    }
    s.tired = THREE.MathUtils.clamp(s.tired + (chasing ? dt / 7 : -dt / 4), 0, 0.55);
    // Held to its spot: at the end of its leash it slips round the edge instead of on away.
    _n.subVectors(s.pos, s.home).setY(0);
    const off = _n.length();
    if (off > s.leash * 0.8) {
      _n.divideScalar(off || 1);
      const outward = _d.dot(_n);
      if (outward > 0) _d.addScaledVector(_n, -outward * Math.min(1, (off - s.leash * 0.8) / (s.leash * 0.2)));
      if (off > s.leash) _d.addScaledVector(_n, -(off - s.leash) * 3);
    }
    s.vel.lerp(_d, 1 - Math.exp(-dt * 3.2));
    // Never anywhere you can't follow: off the island, off its bridge, into the fountain or a wall. Blocked,
    // it slips along the edge instead (the way turned a little, then more), or waits.
    const ok = (nx, nz) => {
      const g = s.lift > 3 ? { y: s.home.y - s.lift, on: s.on } : travel.groundAt?.(nx, nz, s.pos.y + 4);
      if (!g || g.y < s.home.y - s.lift - 3 || (s.on !== 'land' && g.on !== s.on)) return null;
      _w.set(nx, s.pos.y - s.lift, nz);
      return s.lift > 3 || !travel.walkable || travel.walkable(_w) ? g : null;
    };
    const vx = s.vel.x, vz = s.vel.z;
    for (const a of [0, 0.7, -0.7, 1.4, -1.4, 2.2, -2.2]) {
      const c = Math.cos(a), sn = Math.sin(a);
      const dx = (vx * c - vz * sn) * dt, dz = (vx * sn + vz * c) * dt;
      const g = ok(s.pos.x + dx, s.pos.z + dz);
      if (!g) continue;
      if (a) s.vel.set(dx / dt, 0, dz / dt);
      s.pos.x += dx;
      s.pos.z += dz;
      s.pos.y += (g.y + s.lift - s.pos.y) * (1 - Math.exp(-dt * 6));
      return;
    }
    s.vel.multiplyScalar(0.5);
  }
  // The trail: where it's been, the newest brightest.
  function drawTrail(s, dt) {
    s.trail.visible = true;
    if ((s.histT += dt) > 0.035) {
      s.histT = 0;
      s.hist.unshift(s.group.position.x, s.group.position.y, s.group.position.z);
      s.hist.length = Math.min(s.hist.length, TRAIL * 3);
    }
    const P = s.trail.geometry.attributes.position, C = s.trail.geometry.attributes.color;
    const n = s.hist.length / 3;
    for (let i = 0; i < TRAIL; i++) {
      const j = Math.min(i, n - 1);
      if (j < 0) break;
      P.setXYZ(i, s.hist[j * 3], s.hist[j * 3 + 1], s.hist[j * 3 + 2]);
      const f = i < n ? Math.pow(1 - i / TRAIL, 1.6) * 0.85 : 0;
      C.setXYZ(i, f, f * 0.82, f * 0.45);
    }
    P.needsUpdate = true;
    C.needsUpdate = true;
  }
  let senseT = 0, sensed = '';
  // A Chog of the trailer's (src/shots.js) to chase them in place of yours.
  let chaser = null;
  return {
    chase(p) {
      chaser = p;
      first = false;
    },
    where: (name) => stars.find((st) => st.name === name && st.group.visible && !st.gone)?.group.position ?? null,
    get found() {
      return found.size;
    },
    // For the trailer's shots (src/shots.js): this player's stars, found or not, set outright (all twelve
    // put the Chog in the sky); they take effect on the next update.
    setFound(names) {
      store.get().found = [...names];
      store.get().told = true;
      store.save();
      who = null;
    },
    names: SPOTS.map(([n]) => n),
    total: SPOTS.length,
    update(dt, env) {
      if (who !== playerKey()) swap();
      const night = env?.night ?? 0;
      const out = chaser ? true : travel.active && travel.chog;
      if (out !== shown) document.body.classList.toggle('stars-on', (shown = !!out));
      if (chaser) me.copy(chaser);
      else if (out) me.copy(travel.state.pos);
      mat.emissiveIntensity = 1.2 + night * 1.6;
      glowMat.opacity = 0.5 + night * 0.4;
      // A word about the hunt, the first time you're out walking.
      if (out && first) {
        first = false;
        saved.told = true;
        write(saved);
        // (The guide tells of the hunt now: src/guide.js.)
      }
      // Star sense (an Eyes trait, src/islandperks.js): the stars near you on the map, twice a second.
      if ((senseT -= dt) <= 0) {
        senseT = 0.5;
        const r = out ? (sense?.() ?? 0) : 0;
        const near = r ? stars.filter((st) => st.group.visible && !st.gone && Math.hypot(me.x - st.group.position.x, me.z - st.group.position.z) < r) : [];
        const key = near.map((st) => `${st.name}${Math.round(st.pos.x / 3)},${Math.round(st.pos.z / 3)}`).join('|');
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
          s.trail.visible = false;
          continue;
        }
        s.mesh.rotation.y = s.k * 1.3;
        move(s, dt, out);
        s.group.position.set(s.pos.x, s.pos.y + Math.sin(s.k * 1.8) * 0.12, s.pos.z);
        drawTrail(s, dt);
        // The column shows from a way off and goes as you come close.
        const d = camera.position.distanceTo(s.group.position);
        s.beam.material.uniforms.uA.value = THREE.MathUtils.smoothstep(d, 10, 34) * (0.55 + night * 0.45);
        if (!out) continue;
        const dx = me.x - s.group.position.x, dz = me.z - s.group.position.z;
        // (Its middle: floating in zero g it's up off the ground.)
        const dy = me.y + (chaser ? 0 : travel.state.lift ?? 0) + 1 - s.group.position.y;
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
