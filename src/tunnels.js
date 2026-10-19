import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mergeByMaterial } from './merge.js';
import { heightAt } from './terrain.js';
import { createGlows } from './glows.js';

/*
 * What stands over the bridges between the islands. Each look follows its bridge's deck, its rise and its
 * stairs, and reaches a little way onto the island at each end, sitting on the island's own ground there.
 *
 *   lattice    glass tunnels built like the pods' domes: a steel lattice of arched ribs, purlins and
 *              diagonal braces, glazed with the domes' glass (the look until 10-18)
 *   tube       the same glass vault, seamless, with only a slim gold ring every few metres
 *   hoops      no glass: tall white hoops over the deck, each with a glowing line inside, a light
 *              running from hoop to hoop after dark
 *   lanterns   open to the sky: posts along both rails with strings of warm bulbs swagged between them
 *              and across overhead, and a timber gateway at each end
 *
 * ?tunnel=<look> picks one (the user is choosing; 10-18). paths: the bridges as buildBridges returns them
 * ({ ax, az, bx, bz, len, deckY(t), width }).
 */
const LOOKS = ['lattice', 'tube', 'hoops', 'lanterns'];
const LOOK = (() => {
  try {
    const k = new URLSearchParams(location.search).get('tunnel');
    return LOOKS.includes(k) ? k : 'lattice';
  } catch {
    return 'lattice';
  }
})();

// The vault: a half ellipse over the deck, wide enough to clear the lamps on the rails and tall enough
// for a Chog outdoors (1.7 x life size) and the camera behind it, with room to spare.
const halfW = (br) => br.width / 2 + 1.0;
const HIGH = 7.6;
const SPRING = 0.2;
const RIB_EVERY = 3.2;
const PROFILE = 20;
const PURLINS = [2, 5, 8, 10, 12, 15, 18];

export function buildTunnels(scene, paths, look = LOOK) {
  const steel = new THREE.MeshStandardMaterial({ color: '#eceaf3', roughness: 0.32, metalness: 0.75, envMapIntensity: 1.2 });
  const gold = new THREE.MeshStandardMaterial({ color: '#e9c46a', roughness: 0.28, metalness: 0.85, envMapIntensity: 1.3 });
  const glass = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#d7c8ff').lerp(new THREE.Color('#ffffff'), 0.75),
    roughness: 0.04,
    metalness: 0,
    transparent: true,
    envMapIntensity: 1.4,
    side: THREE.DoubleSide,
    depthWrite: false,
    specularIntensity: 1,
  });
  const iridescent = look === 'tube';
  glass.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `// Clear face-on, reflective at grazing angles (as the domes' glass).
float fres = pow(clamp(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0), 3.0);
diffuseColor.a = mix(${iridescent ? '0.04, 0.62' : '0.07, 0.8'}, fres);
${iridescent ? '// A soap-film sheen at the edges: pink turning to cyan as the glass turns away.\noutgoingLight += mix(vec3(1.0, 0.55, 0.9), vec3(0.45, 0.9, 1.0), fres) * fres * 0.35;' : ''}
#include <opaque_fragment>`,
    );
  };
  glass.customProgramCacheKey = () => `tunnel-glass-${iridescent ? 'i' : 'p'}`;

  const frames = new THREE.Group();
  const panes = new THREE.Group();
  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();
  const strutGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
  const strut = (a, b, r, mat = steel) => {
    const dir = b.clone().sub(a);
    const m = new THREE.Mesh(strutGeo, mat);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.copy(q.setFromUnitVectors(up, dir.clone().normalize()));
    m.scale.set(r, dir.length(), r);
    m.castShadow = true;
    frames.add(m);
  };
  const wood = new THREE.MeshStandardMaterial({ color: '#7a4a2c', roughness: 0.7 });
  // What changes after dark: the hoops' lights and the lanterns' bulbs.
  const night = { lines: [], glows: null, bulbs: [], uniforms: null };

  for (const br of paths) {
    const ux = (br.bx - br.ax) / br.len, uz = (br.bz - br.az) / br.len;
    const nx = -uz, nz = ux;
    // Out past each end of the deck onto the island, so the way in is covered too.
    const over = 4 / br.len;
    const t0 = -over, t1 = 1 + over;
    // Past the deck's ends, on the island's own ground (it used to keep the deck's end height and run
    // into the hill).
    const deck = (t) => {
      if (t >= 0 && t <= 1) return br.deckY(t);
      const d = t * br.len;
      return heightAt(br.ax + ux * d, br.az + uz * d) - 0.13;
    };
    const HALF_W = halfW(br);
    // A point on the vault: t along the bridge, j round the profile (0 one side, PROFILE the other).
    const at = (t, j, grow = 0, hw = HALF_W, hi = HIGH) => {
      const th = Math.PI * (j / PROFILE);
      const s = Math.cos(th) * (hw + grow), h = SPRING + Math.sin(th) * (hi + grow);
      return new THREE.Vector3(br.ax + ux * br.len * t + nx * s, deck(t) + h, br.az + uz * br.len * t + nz * s);
    };
    const span = br.len * (t1 - t0);
    const N = Math.ceil(span / 1.2);
    const ring = (t, r, mat, hw = HALF_W, hi = HIGH, grow = 0.04) => {
      const pts = [];
      for (let j = 0; j <= PROFILE; j++) pts.push(at(t, j, grow, hw, hi));
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, r, 8), mat);
      tube.castShadow = true;
      frames.add(tube);
      return pts;
    };

    if (look === 'lattice' || look === 'tube') {
      // Glass: one sheet over the whole vault.
      const pos = [], nor = [], idx = [];
      for (let i = 0; i <= N; i++) {
        const t = t0 + ((t1 - t0) * i) / N;
        for (let j = 0; j <= PROFILE; j++) {
          const p = at(t, j);
          pos.push(p.x, p.y, p.z);
          const th = Math.PI * (j / PROFILE);
          // The ellipse's outward normal, in the section's plane.
          const ex = Math.cos(th) / HALF_W, ey = Math.sin(th) / HIGH;
          const l = Math.hypot(ex, ey);
          nor.push((nx * ex) / l, ey / l, (nz * ex) / l);
        }
      }
      const row = PROFILE + 1;
      for (let i = 0; i < N; i++)
        for (let j = 0; j < PROFILE; j++) {
          const a = i * row + j, b = a + 1, c = a + row, d = c + 1;
          idx.push(a, c, b, b, c, d);
        }
      const sheet = new THREE.BufferGeometry();
      sheet.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      sheet.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      sheet.setIndex(idx);
      const pane = new THREE.Mesh(sheet, glass);
      pane.renderOrder = 2;
      pane.userData.keep = true;
      panes.add(pane);
    }

    if (look === 'lattice') {
      // Ribs: arches across the vault at an even spacing, heavier at the two ends.
      const ribs = Math.max(2, Math.round(span / RIB_EVERY));
      const ribT = Array.from({ length: ribs + 1 }, (_, k) => t0 + ((t1 - t0) * k) / ribs);
      ribT.forEach((t, k) => {
        const end = k === 0 || k === ribs;
        ring(t, end ? 0.2 : 0.1, steel);
        // Feet where each rib meets the deck.
        if (end) for (const j of [0, PROFILE]) strut(at(t, j, 0.04).setY(deck(t)), at(t, j, 0.04), 0.22);
      });
      // Purlins along the length, and diagonal braces between them, alternating like the domes' lattice.
      for (const j of PURLINS) {
        const pts = [];
        for (let i = 0; i <= N; i += 2) pts.push(at(t0 + ((t1 - t0) * i) / N, j, 0.03));
        const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), N, 0.06, 5), steel);
        tube.castShadow = true;
        frames.add(tube);
      }
      for (let k = 0; k < ribs; k++)
        for (let p = 0; p < PURLINS.length - 1; p++) {
          const flip = (k + p) % 2 === 0;
          const a = at(ribT[k], flip ? PURLINS[p] : PURLINS[p + 1], 0.03);
          const b = at(ribT[k + 1], flip ? PURLINS[p + 1] : PURLINS[p], 0.03);
          strut(a, b, 0.045);
        }
    } else if (look === 'tube') {
      // A slim gold ring every 8 m, a heavier pair at each end, and gold feet.
      const rings = Math.max(2, Math.round(span / 8));
      for (let k = 0; k <= rings; k++) {
        const t = t0 + ((t1 - t0) * k) / rings;
        const end = k === 0 || k === rings;
        ring(t, end ? 0.16 : 0.06, gold);
        if (end) {
          ring(t + (k === 0 ? 0.6 : -0.6) / br.len, 0.08, gold);
          for (const j of [0, PROFILE]) strut(at(t, j, 0.04).setY(deck(t)), at(t, j, 0.04), 0.2, gold);
        }
      }
    } else if (look === 'hoops') {
      // White hoops every 7 m, a little narrower than the vault, each with a glowing line on its inside;
      // a taller pair at each end, the way in.
      const hw = br.width / 2 + 0.9, hi = 6.6;
      const count = Math.max(2, Math.round(span / 7));
      for (let k = 0; k <= count; k++) {
        const t = t0 + ((t1 - t0) * k) / count;
        const end = k === 0 || k === count;
        const H = end ? hi + 1.1 : hi, W = end ? hw + 0.35 : hw;
        ring(t, end ? 0.2 : 0.13, steel, W, H, 0.0);
        // The glowing line, set in a little on the hoop's inside.
        const pts = [];
        for (let j = 1; j < PROFILE; j++) pts.push(at(t, j, -0.17, W, H));
        const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 36, 0.055, 6);
        // Each hoop's place along its bridge (for the running light) and whether it's a gateway.
        const nv = geo.attributes.position.count;
        geo.setAttribute('aHoop', new THREE.Float32BufferAttribute(new Float32Array(nv * 2).map((_, i) => (i % 2 ? (end ? 1 : 0) : t * br.len + br.hood * 3.1)), 2));
        geo.deleteAttribute('uv');
        night.lines.push(geo);
        // Brass collars where each hoop meets the deck.
        for (const j of [0, PROFILE]) strut(at(t, j, 0, W, H).setY(deck(t) - 0.05), at(t, j, 0, W, H).setY(deck(t) + 0.55), end ? 0.32 : 0.24, gold);
      }
    } else if (look === 'lanterns') {
      // Posts along both rails every 6 m, strings of bulbs swagged between their tops along each side and
      // zigzagging across overhead, and at each end a timber gateway with two lanterns.
      const bulbs = night.bulbs;
      const side = br.width / 2 + 0.15;
      const P = (t, s, y) => new THREE.Vector3(br.ax + ux * br.len * t + nx * s, deck(t) + y, br.az + uz * br.len * t + nz * s);
      const posts = Math.max(2, Math.round(span / 6));
      const tops = { [-1]: [], [1]: [] };
      for (let k = 0; k <= posts; k++) {
        const t = t0 + ((t1 - t0) * k) / posts;
        for (const s of [-1, 1]) {
          strut(P(t, s * side, -0.1), P(t, s * side, 4.3), 0.09, wood);
          tops[s].push(P(t, s * side, 4.3));
        }
      }
      // A sagging string from a to b, with a bulb every 0.9 m.
      const swag = (a, b, sag) => {
        const pts = [];
        const n = Math.max(2, Math.ceil(a.distanceTo(b) / 0.3));
        for (let i = 0; i <= n; i++) {
          const u = i / n;
          pts.push(new THREE.Vector3().lerpVectors(a, b, u).addScaledVector(up, -sag * 4 * u * (1 - u)));
        }
        const wire = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n, 0.018, 4), wood);
        frames.add(wire);
        const m = Math.max(1, Math.round(a.distanceTo(b) / 0.9));
        for (let i = 1; i < m; i++) {
          const u = i / m;
          bulbs.push(new THREE.Vector3().lerpVectors(a, b, u).addScaledVector(up, -sag * 4 * u * (1 - u) - 0.08));
        }
      };
      for (let k = 0; k < posts; k++) {
        for (const s of [-1, 1]) swag(tops[s][k], tops[s][k + 1], 0.55);
        swag(tops[k % 2 ? 1 : -1][k], tops[k % 2 ? -1 : 1][k + 1], 1.1);
      }
      // Gateways: two thick posts and a crossbeam with a lantern hanging from each end.
      for (const t of [t0, t1]) {
        const gw = side + 0.5;
        for (const s of [-1, 1]) strut(P(t, s * gw, -0.2), P(t, s * gw, 6.2), 0.26, wood);
        strut(P(t, -gw - 0.9, 6.0), P(t, gw + 0.9, 6.0), 0.24, wood);
        strut(P(t, -gw - 0.6, 5.35), P(t, gw + 0.6, 5.35), 0.14, wood);
        for (const s of [-1, 1]) {
          strut(P(t, s * (gw - 0.9), 6.0), P(t, s * (gw - 0.9), 5.0), 0.025, wood);
          bulbs.push(P(t, s * (gw - 0.9), 4.75));
        }
      }
    }
  }

  // The hoops' glowing lines: one mesh, coloured in its shader. By day a soft lilac; after dark brighter,
  // with a pulse of pink running along each bridge, and the gateways in cyan.
  if (night.lines.length) {
    night.uniforms = { uTime: { value: 0 }, uNight: { value: 0 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: night.uniforms,
      vertexShader: /* glsl */ `
        attribute vec2 aHoop;
        varying vec2 vHoop;
        void main() {
          vHoop = aHoop;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uNight;
        varying vec2 vHoop;
        void main() {
          float wave = pow(max(0.0, sin(vHoop.x * 0.18 - uTime * 2.2)), 6.0);
          vec3 lilac = vec3(0.73, 0.55, 1.0), pink = vec3(1.0, 0.5, 0.78), cyan = vec3(0.5, 0.91, 1.0);
          vec3 c = mix(lilac, mix(pink, cyan, vHoop.y), wave);
          gl_FragColor = vec4(c * (0.55 + uNight * (0.9 + wave * 1.6)), 1.0);
        }`,
    });
    const lines = new THREE.Mesh(mergeGeometries(night.lines), mat);
    lines.frustumCulled = false;
    lines.userData.keep = true;
    panes.add(lines);
  }

  // Bulbs: small warm globes, instanced, with the bridges' soft halos after dark.
  if (night.bulbs.length) {
    const bulbMat = new THREE.MeshStandardMaterial({ color: '#fff3dd', emissive: new THREE.Color('#ffc983'), emissiveIntensity: 0.4 });
    const inst = new THREE.InstancedMesh(new THREE.SphereGeometry(0.11, 8, 6), bulbMat, night.bulbs.length);
    const m4 = new THREE.Matrix4();
    night.bulbs.forEach((p, i) => inst.setMatrixAt(i, m4.makeTranslation(p.x, p.y, p.z)));
    inst.userData.keep = true;
    panes.add(inst);
    night.bulbMat = bulbMat;
    night.glows = createGlows(night.bulbs, { color: '#ffcf8f', size: 1.0, minPx: 3 });
    panes.add(night.glows.points);
  }

  mergeByMaterial(frames);
  scene.add(frames, panes);
  const enclosed = look === 'lattice' || look === 'tube';
  let clock = 0;
  return {
    group: frames,
    panes,
    look,
    /**
     * Whether a point (world) is inside a tunnel's vault: the camera keeps to it when you're inside.
     * openEnds: past either end of the vault counts as inside too (the camera may stand out there,
     * behind you as you go in, with nothing between it and you).
     */
    inside(p, openEnds = false) {
      if (!enclosed) return false;
      for (const br of paths) {
        const ux = (br.bx - br.ax) / br.len, uz = (br.bz - br.az) / br.len;
        const along = (p.x - br.ax) * ux + (p.z - br.az) * uz;
        if (along < -4 || along > br.len + 4) {
          if (openEnds && along > -40 && along < br.len + 40 && Math.abs((p.x - br.ax) * -uz + (p.z - br.az) * ux) < halfW(br) + 1) return true;
          continue;
        }
        const side = (p.x - br.ax) * -uz + (p.z - br.az) * ux;
        const y = p.y - br.deckY(THREE.MathUtils.clamp(along / br.len, 0, 1)) - SPRING;
        const hw = halfW(br);
        if (y < -1 || Math.abs(side) > hw) continue;
        if ((side / hw) ** 2 + (Math.max(0, y) / HIGH) ** 2 <= 1) return true;
      }
      return false;
    },
    update(env, renderer, dt = 0.016) {
      clock += dt;
      if (night.uniforms) {
        night.uniforms.uTime.value = clock;
        night.uniforms.uNight.value = env.night;
      }
      if (night.bulbMat) night.bulbMat.emissiveIntensity = 0.4 + env.night * 2.4;
      night.glows?.update(env, renderer);
    },
  };
}
