import * as THREE from 'three';
import { mergeByMaterial } from './merge.js';

/*
 * Glass tunnels over the bridges between the islands, built like the pods' domes: a steel lattice of
 * arched ribs, purlins along the length and diagonal braces, glazed with the domes' glass (clear
 * face-on, reflective at grazing angles). Each follows its bridge's deck, its rise and its stairs, and
 * reaches a little way onto the island at each end, where a heavier arch frames the way in.
 *
 * paths: the bridges as buildBridges returns them ({ ax, az, bx, bz, len, deckY(t), width }).
 */

// The vault: a half ellipse over the deck, wide enough to clear the lamps on the rails and tall enough
// for a Chog outdoors (1.7 x life size) with room to spare.
const HALF_W = 3.3;
const HIGH = 5.6;
const SPRING = 0.2;
const RIB_EVERY = 3.2;
const PROFILE = 20;
const PURLINS = [2, 5, 8, 10, 12, 15, 18];

export function buildTunnels(scene, paths) {
  const steel = new THREE.MeshStandardMaterial({ color: '#eceaf3', roughness: 0.32, metalness: 0.75, envMapIntensity: 1.2 });
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
  glass.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `// Clear face-on, reflective at grazing angles (as the domes' glass).
float fres = pow(clamp(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0), 3.0);
diffuseColor.a = mix(0.07, 0.8, fres);
#include <opaque_fragment>`,
    );
  };
  glass.customProgramCacheKey = () => 'tunnel-glass';

  const frames = new THREE.Group();
  const panes = new THREE.Group();
  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();
  const strutGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
  const strut = (a, b, r) => {
    const dir = b.clone().sub(a);
    const m = new THREE.Mesh(strutGeo, steel);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.copy(q.setFromUnitVectors(up, dir.clone().normalize()));
    m.scale.set(r, dir.length(), r);
    m.castShadow = true;
    frames.add(m);
  };

  for (const br of paths) {
    const ux = (br.bx - br.ax) / br.len, uz = (br.bz - br.az) / br.len;
    const nx = -uz, nz = ux;
    // Out past each end of the deck onto the island, so the way in is under glass too.
    const over = 4 / br.len;
    const t0 = -over, t1 = 1 + over;
    const deck = (t) => br.deckY(THREE.MathUtils.clamp(t, 0, 1)) + (t < 0 || t > 1 ? 0.15 : 0);
    // A point on the vault: t along the bridge, j round the profile (0 one side, PROFILE the other).
    const at = (t, j, grow = 0) => {
      const th = Math.PI * (j / PROFILE);
      const s = Math.cos(th) * (HALF_W + grow), h = SPRING + Math.sin(th) * (HIGH + grow);
      return new THREE.Vector3(br.ax + ux * br.len * t + nx * s, deck(t) + h, br.az + uz * br.len * t + nz * s);
    };
    const span = br.len * (t1 - t0);
    const N = Math.ceil(span / 1.2);
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

    // Ribs: arches across the vault at an even spacing, heavier at the two ends.
    const ribs = Math.max(2, Math.round(span / RIB_EVERY));
    const ribT = Array.from({ length: ribs + 1 }, (_, k) => t0 + ((t1 - t0) * k) / ribs);
    ribT.forEach((t, k) => {
      const end = k === 0 || k === ribs;
      const pts = [];
      for (let j = 0; j <= PROFILE; j++) pts.push(at(t, j, 0.04));
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, end ? 0.2 : 0.1, end ? 8 : 6), steel);
      tube.castShadow = true;
      frames.add(tube);
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
  }
  mergeByMaterial(frames);
  scene.add(frames, panes);
  return {
    group: frames,
    panes,
    /** Whether a point (world) is inside a tunnel's vault: the camera keeps to it when you're inside. */
    inside(p) {
      for (const br of paths) {
        const ux = (br.bx - br.ax) / br.len, uz = (br.bz - br.az) / br.len;
        const along = (p.x - br.ax) * ux + (p.z - br.az) * uz;
        if (along < -4 || along > br.len + 4) continue;
        const side = (p.x - br.ax) * -uz + (p.z - br.az) * ux;
        const y = p.y - br.deckY(THREE.MathUtils.clamp(along / br.len, 0, 1)) - SPRING;
        if (y < -1 || Math.abs(side) > HALF_W) continue;
        if ((side / HALF_W) ** 2 + (Math.max(0, y) / HIGH) ** 2 <= 1) return true;
      }
      return false;
    },
  };
}
