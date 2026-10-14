import * as THREE from 'three';
import { piece, repaint } from './kaykit.js';
import { buildHomeRoom } from './interior.js';
import { createGlows } from './glows.js';
import { DOME_R, WORLD } from './layout.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mergeByMaterial } from './merge.js';

const DOOR_HALF = 2.2;
// The home pod's size, and its trim colour (an atlas cell) in each biome.
const HOME_S = 7;
const POD_TRIM = { meadow: 'green', frost: 'sky', grove: 'pink' };
const DOOR_H = 5.2;

// Every dome's frame (the lattice and its joints, the entrance arches and their ties, the glass,
// the plinth and the sign strip) is the same shape in the dome's own space, so it is built once and
// all the domes share it, each in its own materials. Building it per dome was most of the island's
// build time.
let FRAME = null;
function domeFrame() {
  if (FRAME) return FRAME;
  const R = DOME_R;
  // Lattice: rings from the base to the crown, each joined to the next by a triangle strip.
  const rings = [];
  const RINGS = 8;
  for (let i = 0; i <= RINGS; i++) {
    const lat = (i / RINGS) * (Math.PI / 2) * 0.97;
    const n = Math.max(5, Math.round(30 * Math.cos(lat)));
    const ring = [];
    for (let k = 0; k < n; k++) {
      const az = ((k + (i % 2) * 0.5) / n) * Math.PI * 2;
      ring.push(new THREE.Vector3(R * Math.cos(lat) * Math.sin(az), R * Math.sin(lat), R * Math.cos(lat) * Math.cos(az)));
    }
    rings.push(ring);
  }
  const crown = new THREE.Vector3(0, R, 0);
  const edges = [];
  const inDoor = (p) => {
    const ax = Math.atan2(p.x, p.z) * R;
    return Math.abs(ax) < DOOR_HALF + 0.2 && p.y < DOOR_H + 0.3 && p.z > 0;
  };
  const addEdge = (a, b) => {
    if (inDoor(a) && inDoor(b)) return;
    // Skip struts that would cross the doorway.
    const mid = a.clone().add(b).multiplyScalar(0.5).setLength(R);
    if (inDoor(mid)) return;
    edges.push([a, b]);
  };
  for (let i = 0; i < rings.length; i++) {
    const ring = rings[i];
    for (let k = 0; k < ring.length; k++) {
      if (i > 0) addEdge(ring[k], ring[(k + 1) % ring.length]);
      if (i < rings.length - 1) {
        // Join to the two nearest points on the next ring up.
        const up = rings[i + 1];
        const az = Math.atan2(ring[k].x, ring[k].z);
        const sorted = up
          .map((p) => ({ p, d: Math.abs(((Math.atan2(p.x, p.z) - az + Math.PI * 3) % (Math.PI * 2)) - Math.PI) }))
          .sort((a, b) => a.d - b.d);
        addEdge(ring[k], sorted[0].p);
        addEdge(ring[k], sorted[1].p);
      } else {
        addEdge(ring[k], crown);
      }
    }
  }

  // Stands in for each dome's steel while the parts are merged.
  const steel = new THREE.MeshBasicMaterial();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  // Every strut baked into one geometry; `sides` lets the far version use plainer struts.
  const lattice = (sides) => {
    const base = new THREE.CylinderGeometry(0.09, 0.09, 1, sides, 1, true);
    return mergeGeometries(
      edges.map(([a, b]) => {
        const dir = b.clone().sub(a);
        const len = dir.length();
        q.setFromUnitVectors(up, dir.normalize());
        return base.clone().applyMatrix4(m.compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, len, 1)));
      }),
    );
  };
  // Close up the full lattice with its joints; from afar (where a joint is under a pixel) a lighter one.
  const near = new THREE.Group();
  const far = new THREE.Group();
  near.add(new THREE.Mesh(lattice(6), steel));
  const nodes = rings.flat().concat([crown]).filter((p) => !inDoor(p));
  const nodeGeo = new THREE.IcosahedronGeometry(0.18, 1);
  near.add(new THREE.Mesh(mergeGeometries(nodes.map((p) => nodeGeo.clone().translate(p.x, p.y, p.z))), steel));
  far.add(new THREE.Mesh(lattice(4), steel));

  // Entrance: a steel arch frame that steps out from the dome.
  const archPts = [];
  const postTop = DOOR_H - DOOR_HALF;
  const onDome = (ax, y, out = 0) => {
    const az = ax / R;
    const rr = Math.sqrt(Math.max(R * R - y * y, 0)) + out;
    return new THREE.Vector3(rr * Math.sin(az), y, rr * Math.cos(az));
  };
  for (const out of [0.05, 1.6]) {
    const pts = [onDome(-DOOR_HALF, 0, out), onDome(-DOOR_HALF, postTop, out)];
    for (let j = 1; j < 12; j++) {
      const th = Math.PI - (j / 12) * Math.PI;
      pts.push(onDome(DOOR_HALF * Math.cos(th), postTop + DOOR_HALF * Math.sin(th), out));
    }
    pts.push(onDome(DOOR_HALF, postTop, out), onDome(DOOR_HALF, 0, out));
    archPts.push(pts);
    const curve = new THREE.CatmullRomCurve3(pts);
    near.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.16, 8), steel));
    far.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.16, 4), steel));
  }
  // Ties between the two arches.
  for (let j = 0; j < archPts[0].length; j += 3) {
    const a = archPts[0][j], b = archPts[1][j];
    const dir = b.clone().sub(a);
    const tie = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, dir.length(), 6), steel);
    tie.position.copy(a).add(b).multiplyScalar(0.5);
    tie.quaternion.setFromUnitVectors(up, dir.normalize());
    near.add(tie);
  }
  const gap = (DOOR_HALF + 0.3) / R;
  // One mesh per level: the merge bakes every part into a single geometry.
  const single = (g) => {
    mergeByMaterial(g);
    return g.children[0].geometry;
  };
  FRAME = {
    near: single(near),
    far: single(far),
    nearGlass: new THREE.SphereGeometry(R - 0.02, 96, 32, 0, Math.PI * 2, 0, Math.PI / 2),
    farGlass: new THREE.SphereGeometry(R - 0.02, 48, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    plinth: new THREE.TorusGeometry(R, 0.45, 8, 96, Math.PI * 2 - gap * 2),
    gap,
    sign: new THREE.TubeGeometry(new THREE.CatmullRomCurve3(archPts[1].map((p) => p.clone().multiplyScalar(1.004))), 48, 0.06, 6),
  };
  return FRAME;
}

/**
 * A geodesic-style glass dome: triangulated steel lattice on rings, PBR glass that reflects
 * the sky, an arched doorway with a short entrance frame, and a Chog's home inside: a KayKit pod
 * in the dome's biome colours, with its room inside.
 * Plants inside are added by the island builder so they share the instanced batches.
 */
export class Dome {
  constructor({ x, y, z, facing, biome, accent }) {
    this.radius = DOME_R;
    this.biome = biome;
    this.group = new THREE.Group();
    this.group.position.set(x, y, z);
    this.group.rotation.y = facing;
    const R = this.radius;

    const f = domeFrame();
    const steel = new THREE.MeshStandardMaterial({ color: '#eceaf3', roughness: 0.32, metalness: 0.75, envMapIntensity: 1.2 });
    this.steel = steel;
    // Close up: the full lattice with its joints. From afar (where a joint is under a pixel): a lighter one.
    const near = new THREE.Group();
    const far = new THREE.Group();
    const nearSteel = new THREE.Mesh(f.near, steel);
    nearSteel.castShadow = true;
    nearSteel.receiveShadow = true;
    near.add(nearSteel);
    const farSteel = new THREE.Mesh(f.far, steel);
    farSteel.castShadow = true;
    far.add(farSteel);

    // Base ring, a low concrete plinth with a gap at the door.
    const plinthMat = new THREE.MeshStandardMaterial({ color: '#d9d4e2', roughness: 0.85 });
    const plinth = new THREE.Mesh(f.plinth, plinthMat);
    plinth.rotation.set(Math.PI / 2, 0, Math.PI / 2 + f.gap);
    plinth.scale.set(1, 1, 0.6);
    plinth.position.y = 0.15;
    plinth.receiveShadow = true;
    plinth.castShadow = true;
    this.group.add(plinth);

    // Glass.
    this.glass = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(accent).lerp(new THREE.Color('#ffffff'), 0.75),
      roughness: 0.04,
      metalness: 0,
      transparent: true,
      opacity: 1,
      envMapIntensity: 1.4,
      side: THREE.DoubleSide,
      depthWrite: false,
      specularIntensity: 1,
    });
    this.glass.onBeforeCompile = (shader) => {
      shader.uniforms.uR = { value: R };
      shader.uniforms.uDoorHalf = { value: DOOR_HALF };
      shader.uniforms.uDoorH = { value: DOOR_H };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vLocal;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocal = position;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vLocal;\nuniform float uR, uDoorHalf, uDoorH;')
        .replace(
          '#include <clipping_planes_fragment>',
          `#include <clipping_planes_fragment>
float ax = atan(vLocal.x, vLocal.z) * uR;
float postTop = uDoorH - uDoorHalf;
if (vLocal.z > 0.0 && abs(ax) < uDoorHalf && (vLocal.y < postTop || length(vec2(ax, vLocal.y - postTop)) < uDoorHalf)) discard;`,
        )
        .replace(
          '#include <opaque_fragment>',
          `// Clear face-on, reflective at grazing angles.
float fres = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 3.0);
diffuseColor.a = mix(0.07, 0.8, fres);
#include <opaque_fragment>`,
        );
    };
    this.glass.customProgramCacheKey = () => 'dome-glass';
    const glassMesh = new THREE.Mesh(f.nearGlass, this.glass);
    glassMesh.renderOrder = 2;
    glassMesh.userData.keep = true;
    near.add(glassMesh);
    // From afar only the outside of the glass shows: one side, fewer facets, half the overdraw.
    const farGlass = new THREE.Mesh(f.farGlass, this.glass.clone());
    farGlass.material.side = THREE.FrontSide;
    farGlass.material.onBeforeCompile = this.glass.onBeforeCompile;
    farGlass.material.customProgramCacheKey = () => 'dome-glass-far';
    farGlass.renderOrder = 2;
    farGlass.userData.keep = true;
    far.add(farGlass);
    this.farGlass = farGlass.material;

    // Accent light strip over the door, along the outer entrance arch.
    this.signMat = new THREE.MeshStandardMaterial({ color: accent, emissive: new THREE.Color(accent), emissiveIntensity: 0.4 });
    this.group.add(new THREE.Mesh(f.sign, this.signMat));

    // Home at the back, facing the door: the same pods as the hub, its trim in the biome's colour.
    const pod = piece('basemodule_B', HOME_S);
    repaint(pod, { purple: POD_TRIM[biome] ?? 'purple' });
    this.homeZ = -R * 0.38;
    pod.position.set(0, 0, this.homeZ);
    this.group.add(pod);
    this.home = { halfW: 7.6, back: -7.8, front: 8.6, center: this.homeZ + 0.35 };
    // A lamp by its door, lit after dark.
    const lampAt = new THREE.Vector3(3.2, 3.6, this.homeZ + 8.9);
    this.group.add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 3.6, 6).translate(lampAt.x, 1.8, lampAt.z), this.lampPost ??= new THREE.MeshStandardMaterial({ color: '#cfa84e', metalness: 0.7, roughness: 0.4 })));
    this.lampMat = new THREE.MeshStandardMaterial({ color: '#fff3dd', emissive: new THREE.Color('#ffd7a0'), emissiveIntensity: 0.2 });
    this.group.add(new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8).translate(lampAt.x, lampAt.y, lampAt.z), this.lampMat));
    this.lampGlow = createGlows([lampAt], { size: 2, minPx: 4 });

    // The two levels of detail: each its shared steel and its glass.
    const lod = new THREE.LOD();
    for (const [level, dist] of [[near, 0], [far, 90]]) {
      level.traverse((o) => (o.userData.keep = true));
      lod.addLevel(level, dist);
    }
    this.group.add(lod);
    mergeByMaterial(this.group);
    this.group.add(this.lampGlow.points);
    // The room inside the home, drawn only while the camera is in it.
    this.room = buildHomeRoom(biome);
    this.room.group.position.set(0, 0.2, this.home.center);
    this.room.group.visible = false;
    this.group.add(this.room.group);
    this.group.updateMatrixWorld(true);
  }

  // Ground-plane test in dome-local coordinates, used to keep plants off the house and the walk.
  isClear(lx, lz, pad = 0) {
    const R = this.radius;
    if (Math.hypot(lx, lz) > R - 1.2 - pad) return false;
    const h = this.home;
    if (Math.abs(lx) < h.halfW + pad && lz > this.homeZ + h.back - pad && lz < this.homeZ + h.front + pad) return false;
    // Walk from the door to the deck.
    if (Math.abs(lx - Math.sin(lz * 0.25) * 0.8) < 2.4 + pad && lz > this.homeZ) return false;
    return true;
  }

  toWorld(lx, lz) {
    return this.group.localToWorld(new THREE.Vector3(lx, 0, lz));
  }

  update(env, renderer) {
    const n = env.night;
    this.lampGlow.update(env, renderer);
    if (this.room.group.visible) this.room.update(env, renderer);
    this.lampMat.emissiveIntensity = 0.2 + n * 2.2;
    this.signMat.emissiveIntensity = 0.4 + n * 3;
  }
}
