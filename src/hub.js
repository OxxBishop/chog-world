import * as THREE from 'three';
import { piece, kitMaterial, repaint, carve, CELL } from './kaykit.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mergeByMaterial } from './merge.js';
import { createGlows } from './glows.js';
import { buildLobbyRoom, buildBarRoom } from './interior.js';
import { buildCasinoRoom } from './casino.js';
import { createLobbyFx } from './fx/lobbyfx.js';
import { domeTicker } from './fx/domeTicker.js';

/*
 * The Chog Hub: one building on the downtown plaza with three doors, each wing with its own
 * character. The domed lobby in the middle (where owners sign in) behind a wooden welcome arch,
 * with banners and a Chog statue; the bar on the left under a striped awning, with string lights
 * and tables outside; the casino on the right, closed for now, framed in marquee bulbs with a
 * giant die and chip on its roof. KayKit pods in warm cream, with wood, brass and the purple.
 */

export const HUB_KIT = ['basemodule_E', 'basemodule_A', 'basemodule_D', 'tunnel_straight_A', 'basemodule_B'];

// Where the rooms sit inside the pods (hub space): floor heights just above each pod's base.
const LOBBY_ROOM = { x: 0, y: 0.6, z: 0 };
const BAR_ROOM = { x: -37, y: 0.45, z: 0.6 };
const CASINO_ROOM = { x: 37, y: 0.45, z: 0.6 };

const LOBBY_S = 15;
const WING_S = 10;
const WING_X = 37;
const LOBBY_FRONT = 1.14 * LOBBY_S;
const WING_FRONT = 1.09 * WING_S;

const PURPLE = '#8b6cf0';

// A lit sign: rounded dark panel, big title, optional small line under it.
function signTexture(title, sub, accent, panel = 'rgba(40,24,52,0.94)') {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = sub ? 320 : 220;
  const ctx = c.getContext('2d');
  ctx.fillStyle = panel;
  ctx.beginPath();
  ctx.roundRect(8, 8, c.width - 16, c.height - 16, 48);
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 10;
  ctx.stroke();
  ctx.fillStyle = '#fff6e8';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '600 128px Fredoka, sans-serif';
  ctx.fillText(title, c.width / 2, sub ? 128 : c.height / 2 + 6);
  if (sub) {
    ctx.fillStyle = accent;
    ctx.font = '500 64px Figtree, sans-serif';
    ctx.fillText(sub, c.width / 2, 250);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function signMesh(map, width, glow = 0.35) {
  const aspect = map.image.height / map.image.width;
  const mat = new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: new THREE.Color('#ffffff'), emissiveIntensity: glow, transparent: true, roughness: 0.6 });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(width, width * aspect), mat);
  m.userData.keep = true;
  return m;
}

// The bar's neon: a mug outline and the word, glowing teal on a dark board.
function neonMugTexture() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 400;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(30,20,40,0.92)';
  ctx.beginPath();
  ctx.roundRect(8, 8, 1008, 384, 60);
  ctx.fill();
  ctx.strokeStyle = '#7ef0e4';
  ctx.shadowColor = '#7ef0e4';
  ctx.shadowBlur = 30;
  ctx.lineWidth = 16;
  ctx.lineJoin = 'round';
  // Mug body, handle and foam.
  ctx.beginPath();
  ctx.roundRect(110, 110, 190, 220, 24);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(300, 220, 58, -Math.PI / 2, Math.PI / 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(100, 112);
  for (let i = 0; i <= 4; i++) ctx.arc(120 + i * 42, 104, 22, Math.PI, 0);
  ctx.stroke();
  ctx.fillStyle = '#fff6e8';
  ctx.font = '600 210px Fredoka, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('BAR', 450, 215);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function stripes(a, b, n = 10) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 16;
  const ctx = c.getContext('2d');
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = i % 2 ? b : a;
    ctx.fillRect((i * 256) / n, 0, 256 / n + 1, 16);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Bulbs along a sagging line between two points.
function stringOfBulbs(a, b, spacing, sag, out) {
  const n = Math.max(2, Math.round(a.distanceTo(b) / spacing));
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    out.push(new THREE.Vector3().lerpVectors(a, b, u).add(new THREE.Vector3(0, -sag * 4 * u * (1 - u), 0)));
  }
}

// The lobby's runner: deep red with a gold border and a row of small diamonds down the middle.
function rugTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 512;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#8e2436';
  ctx.fillRect(0, 0, 128, 512);
  ctx.fillStyle = '#e8b84a';
  ctx.fillRect(8, 0, 6, 512);
  ctx.fillRect(114, 0, 6, 512);
  ctx.fillStyle = '#b8434f';
  ctx.fillRect(20, 0, 3, 512);
  ctx.fillRect(105, 0, 3, 512);
  ctx.fillStyle = '#e8b84a';
  for (let y = 32; y < 512; y += 64) {
    ctx.beginPath();
    ctx.moveTo(64, y - 14);
    ctx.lineTo(78, y);
    ctx.lineTo(64, y + 14);
    ctx.lineTo(50, y);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Casino chips: [base, stripe] colours. Red, black and gold.
const CHIPS = [['#c4334a', '#fff0dc'], ['#2a1a2e', '#e8b84a'], ['#e8b84a', '#7a1f2e']];

// Chip sides (one row of edge stripes per colour) and faces (one square per colour), in two atlases.
function chipTextures() {
  const side = document.createElement('canvas');
  side.width = 256;
  side.height = 16 * CHIPS.length;
  const sc = side.getContext('2d');
  const face = document.createElement('canvas');
  face.width = 128 * CHIPS.length;
  face.height = 128;
  const fc = face.getContext('2d');
  CHIPS.forEach(([base, stripe], i) => {
    sc.fillStyle = base;
    sc.fillRect(0, i * 16, 256, 16);
    sc.fillStyle = stripe;
    for (let k = 0; k < 8; k++) sc.fillRect(k * 32 + 8, i * 16, 14, 16);
    const cx = i * 128 + 64;
    fc.fillStyle = base;
    fc.fillRect(i * 128, 0, 128, 128);
    // Edge spots round the rim and a ring inside, like a real chip.
    fc.fillStyle = stripe;
    for (let k = 0; k < 8; k++) {
      fc.save();
      fc.translate(cx, 64);
      fc.rotate((k / 8) * Math.PI * 2);
      fc.fillRect(-7, -63, 14, 16);
      fc.restore();
    }
    fc.strokeStyle = stripe;
    fc.lineWidth = 5;
    fc.beginPath();
    fc.arc(cx, 64, 34, 0, Math.PI * 2);
    fc.stroke();
  });
  const tex = (c) => {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  };
  return { side: tex(side), face: tex(face) };
}

// One chip: an open side and two caps, with UVs pointing at its colour in the atlases.
function chipGeometry(r, h, colour) {
  const n = CHIPS.length;
  const side = new THREE.CylinderGeometry(r, r, h, 40, 1, true);
  const suv = side.attributes.uv;
  for (let i = 0; i < suv.count; i++) suv.setY(i, (colour + 0.1 + suv.getY(i) * 0.8) / n);
  const caps = [new THREE.CircleGeometry(r, 40).rotateX(-Math.PI / 2).translate(0, h / 2, 0), new THREE.CircleGeometry(r, 40).rotateX(Math.PI / 2).translate(0, -h / 2, 0)];
  for (const c of caps) {
    const uv = c.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, (colour + uv.getX(i)) / n);
  }
  return { side, caps: mergeGeometries(caps) };
}

// Pip layouts on a die face, in steps of a third of the face.
const PIPS = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [-1, 1], [1, -1], [1, 1]],
  5: [[-1, -1], [-1, 1], [1, -1], [1, 1], [0, 0]],
  6: [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 0], [1, 1]],
};

const box = (w, h, d, mat, x, y, z) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
};
const post = (r, h, mat, x, z, y = 0) => {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 10).translate(0, h / 2, 0), mat);
  m.position.set(x, y, z);
  return m;
};

/*
 * Sunlight on a material scaled by sun.value (0 to 1), its sky light and glow untouched. The halls
 * behind the doors are never in the sun (NO_SUN), and the doors go into the hall's shade as they
 * open: the patch of sun that came in through a doorway showed the shadow map's coarse stair-steps
 * along its edge, on the open doors and the hall walls.
 */
const SUN_SCALED = THREE.ShaderChunk.lights_fragment_begin
  .replace('getDirectionalLightInfo( directionalLight, directLight );', '$&\n\t\tdirectLight.color *= sunScale;')
  .replace('getSunLightInfo( sunLight, directLight );', '$&\n\t\tdirectLight.color *= sunScale;');
export const NO_SUN = { value: 0 };
export function sunScaled(m, sun) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.sunScale = sun;
    sh.fragmentShader = `uniform float sunScale;\n${sh.fragmentShader.replace('#include <lights_fragment_begin>', SUN_SCALED)}`;
  };
  m.customProgramCacheKey = () => 'sunScaled';
  m.userData.sunless = sun === NO_SUN;
  return m;
}
// A door's own copies of its materials, whose sunlight fades as it opens (doorSun(set, k)). The
// handles keep theirs: too small to show the steps, and one shader fewer to build.
export function doorMats({ darkWood, wood, brass }) {
  const sun = { value: 1 };
  // (The handles' own copy too: the door's clipping planes go on it, see slidingDoor.)
  return { darkWood: sunScaled(darkWood.clone(), sun), wood: sunScaled(wood.clone(), sun), brass: brass.clone(), sun };
}
export const doorSun = (set, k) => (set.sun.value = 1 - THREE.MathUtils.smoothstep(k, 0.1, 0.6));
// Sliding doors (the user, 10-19: "why not have a sliding door? like it just parts and the chog walks in").
// The two leaves part and each slides out past its jamb, as into a pocket in the wall. What has gone past
// the jamb isn't drawn: clipping planes on the door's own materials, there from the start (keeping all)
// so their shaders are built with the rest, and placed at the jambs the first time it opens. Nothing
// swings into the doorway, so nothing ever crosses the camera coming through. Returns open(k), 0 to 1.
export const keepAll = () => new THREE.Plane(new THREE.Vector3(0, 1, 0), 1e6);
export function slidingDoor(leaves) {
  const planes = leaves.map(keepAll);
  const mats = new Set();
  for (const l of leaves) l.traverse((o) => o.isMesh && mats.add(o.material));
  for (const m of mats) {
    m.clippingPlanes = planes;
    m.clipShadows = true;
  }
  let placed = false;
  return (k) => {
    if (!placed) {
      placed = true;
      leaves.forEach((l, i) => {
        l.userData.x0 = l.position.x;
        l.parent.updateWorldMatrix(true, false);
        // The leaf's side of its jamb (where it hangs from), in the world.
        planes[i].set(new THREE.Vector3(l.userData.dir, 0, 0), -l.userData.dir * l.position.x).applyMatrix4(l.parent.matrixWorld);
      });
    }
    const e = THREE.MathUtils.smootherstep(k, 0, 1);
    for (const l of leaves) l.position.x = l.userData.x0 - l.userData.dir * l.userData.width * 1.02 * e;
  };
}
// A room's own door, seen from its hall and from inside: never in the sun either. Its copy of the
// room's trim keeps the room's lamplight (room.lit).
const shaded = new WeakMap();
// It slides too (src/entry.js setRoomDoor), so its copies carry its clipping plane (room.doorway.clip).
export function shadeRoomDoor(room) {
  room.doorway.clip ??= keepAll();
  room.doorway.hinge.traverse((o) => {
    if (!o.isMesh) return;
    if (!shaded.has(o.material)) {
      const m = sunScaled(o.material.clone(), NO_SUN);
      m.clippingPlanes = [room.doorway.clip];
      m.clipShadows = true;
      if (room.lit?.includes(o.material)) room.lit.push(m);
      shaded.set(o.material, m);
    }
    o.material = shaded.get(o.material);
  });
}
// Nothing in a hall takes part in the sun's shadows: it is indoors, under the building's own.
export function shadeHalls(root) {
  root.traverse((o) => {
    if (o.isMesh && o.material.userData?.sunless) o.castShadow = o.receiveShadow = false;
  });
}

/*
 * A door leaf on its hinge (a point in hub space at ground level), reaching `width` from it along x
 * in direction dir (-1 or 1). Merged into one mesh per material and kept out of the hub's big merge,
 * so it can swing: rotation.y = dir * angle turns it inward, into the building.
 */
export function hingedLeaf({ hinge, dir, width, bottom, height, mats }) {
  const g = new THREE.Group();
  g.position.copy(hinge);
  g.userData.dir = dir;
  g.userData.width = width;
  const cx = (dir * width) / 2;
  // Meeting the other leaf with no gap, so the doorway can't be seen through.
  g.add(box(width - 0.01, height, 0.2, mats.darkWood, cx, bottom + height / 2, 0));
  for (const y of [bottom + 1.1, bottom + height - 1.1]) {
    for (const side of [-1, 1]) g.add(box(width - 0.6, 0.14, 0.08, mats.wood, cx, y, side * 0.13));
  }
  for (const side of [-1, 1]) g.add(box(0.12, 1.2, 0.14, mats.brass, dir * (width - 0.35), bottom + height / 2, side * 0.16));
  mergeByMaterial(g);
  g.traverse((o) => {
    if (o.isMesh) {
      o.userData.keep = true;
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return g;
}

/*
 * A short hall from a door in the pod's shell back to the room's own door (the shell is see-through
 * from inside, so the hall is what you see on the way in). Walls, ceiling and floor are slabs, seen
 * from either side. The floor is a landing at the outside door's sill, then steps down to the room's
 * floor if that is lower. A lamp on each wall. Returns the hall's floor height along it, floor(z).
 */
export function vestibule(parent, { x, half, top, zOut, zIn, sill, floorIn, roomDoor, mats: m, lamps, runner = 0 }) {
  // The hall's own surfaces, warmed by its lamps after dark (hallLight in buildHub).
  const mats = { ...m, cream: m.hallCream, darkWood: m.hallWood, steps: m.hallStone, runner: m.hallRunner ?? m.runner };
  // Its walls, panels and ceiling start 2 cm into the hall from the room's front wall: flush with it, their
  // ends fought it for the same pixels and flickered round the doorway, seen from inside the room (the
  // user, 10-19: "the casino doors are still glitching").
  const zWall = zIn + 0.02;
  const len = zOut - zWall;
  const mid = (zOut + zWall) / 2;
  const RISE = 0.8, RUN = 0.8;
  const count = Math.round((sill - floorIn) / RISE);
  const rise = count ? (sill - floorIn) / count : 0;
  const stepsAt = zIn + 1 + count * RUN;
  for (const side of [-1, 1]) {
    parent.add(box(0.3, top - floorIn + 0.3, len, mats.cream, x + side * (half + 0.15), (floorIn + top) / 2, mid));
    // Panelled lower walls: as high as the landing beside it, and a dado rail on top.
    parent.add(box(0.06, sill - floorIn + 1.2, zOut - stepsAt + count * RUN, mats.darkWood, x + side * (half - 0.03), (floorIn + sill + 1.2) / 2, (zOut + stepsAt - count * RUN) / 2));
    parent.add(box(0.06, 1.2, stepsAt - count * RUN - zWall, mats.darkWood, x + side * (half - 0.03), floorIn + 0.6, (stepsAt - count * RUN + zWall) / 2));
    const lamp = new THREE.Vector3(x + side * (half - 0.35), Math.max(sill, floorIn) + 3.1, (zIn + stepsAt) / 2 + 0.6);
    parent.add(box(0.5, 0.14, 0.14, mats.brass, x + side * (half - 0.2), lamp.y + 0.4, lamp.z));
    parent.add(new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 8).translate(lamp.x, lamp.y, lamp.z), mats.lantern));
    lamps.push(lamp);
  }
  parent.add(box(half * 2 + 0.6, 0.3, len, mats.cream, x, top + 0.15, mid));
  // The landing, and the steps down from it.
  parent.add(box(half * 2, sill - floorIn + 0.1, zOut - stepsAt, mats.steps, x, (sill + floorIn - 0.1) / 2, (zOut + stepsAt) / 2));
  if (runner) parent.add(box(runner, 0.04, zOut - stepsAt, mats.runner, x, sill + 0.02, (zOut + stepsAt) / 2));
  for (let i = 0; i < count; i++) {
    const t = sill - rise * (i + 1);
    const z0 = stepsAt - RUN * (i + 1);
    parent.add(box(half * 2, t - floorIn + 0.1, RUN, mats.steps, x, (t + floorIn - 0.1) / 2, z0 + RUN / 2));
    if (runner) {
      parent.add(box(runner, 0.04, RUN, mats.runner, x, t + 0.02, z0 + RUN / 2));
      parent.add(box(runner, rise, 0.04, mats.runner, x, t + rise / 2, z0 + RUN - 0.02));
    }
  }
  const flat = stepsAt - count * RUN - zIn;
  parent.add(box(half * 2, 0.1, flat, mats.steps, x, floorIn - 0.05, zIn + flat / 2));
  if (runner) parent.add(box(runner, 0.04, flat, mats.runner, x, floorIn + 0.02, zIn + flat / 2));
  // The end wall round the room's door, with a frame on this side.
  const shape = new THREE.Shape();
  shape.moveTo(-half, floorIn);
  shape.lineTo(half, floorIn);
  shape.lineTo(half, top);
  shape.lineTo(-half, top);
  const hole = new THREE.Path();
  hole.moveTo(-roomDoor.half, floorIn);
  hole.lineTo(-roomDoor.half, floorIn + roomDoor.h);
  hole.lineTo(roomDoor.half, floorIn + roomDoor.h);
  hole.lineTo(roomDoor.half, floorIn);
  shape.holes.push(hole);
  const end = new THREE.Mesh(new THREE.ShapeGeometry(shape), mats.cream);
  end.position.set(x, 0, zIn + 0.03);
  parent.add(end);
  for (const side of [-1, 1]) parent.add(box(0.3, roomDoor.h + 0.3, 0.28, mats.darkWood, x + side * (roomDoor.half + 0.15), floorIn + (roomDoor.h + 0.3) / 2, zWall + 0.14));
  parent.add(box(roomDoor.half * 2 + 0.6, 0.3, 0.28, mats.darkWood, x, floorIn + roomDoor.h + 0.15, zWall + 0.14));
  return (z) => {
    if (z >= stepsAt) return sill;
    if (z <= stepsAt - count * RUN) return floorIn;
    // Down the steps as a smooth slope, which is how a camera glides down them.
    return sill - ((stepsAt - z) / (count * RUN)) * (sill - floorIn);
  };
}

export function buildHub() {
  const group = new THREE.Group();
  const props = new THREE.Group();
  const signs = [];
  const mats = {
    wood: new THREE.MeshLambertMaterial({ color: '#9a6842' }),
    darkWood: new THREE.MeshLambertMaterial({ color: '#6e4630' }),
    cream: new THREE.MeshLambertMaterial({ color: '#f3e6cf' }),
    brass: new THREE.MeshStandardMaterial({ color: '#cfa84e', metalness: 0.75, roughness: 0.35 }),
    purple: new THREE.MeshLambertMaterial({ color: PURPLE }),
    red: new THREE.MeshLambertMaterial({ color: '#c4334a' }),
    gold: new THREE.MeshStandardMaterial({ color: '#e8b84a', metalness: 0.8, roughness: 0.3 }),
    barRoof: new THREE.MeshLambertMaterial({ color: '#3f7f58' }),
    casinoRoof: new THREE.MeshLambertMaterial({ color: '#9e2338' }),
  };

  // The pods themselves, in warm cream instead of cool white and grey.
  const warm = kitMaterial().clone();
  warm.color.set('#fff0dc');
  // The lobby is the warmest of the three: sand plaster walls, wooden panels and frames, and a gold
  // dome that stands out from every island. The tubes out to the wings match it.
  const plaster = kitMaterial().clone();
  plaster.name = 'lobby-plaster';
  plaster.color.set('#ecb87e');
  const kit = new THREE.Group();
  const lobbyPod = piece('basemodule_E', LOBBY_S);
  // The dome is the purple above the walls (the top 43% of the pod): it comes away whole, in gold.
  const isDome = (n, h, [c, r]) => c === CELL.purple[0] && r === CELL.purple[1] && h > 0.57;
  repaint(lobbyPod, { grey: 'brown', purple: 'brown', dark: 'brown' }, mats.gold, isDome);
  lobbyPod.traverse((o) => o.isMesh && !o.userData.roof && (o.userData.lobby = true));
  kit.add(lobbyPod);
  // The Monad ticker round the dome's foot (A, 10-21: the user's pick).
  const ticker = domeTicker(lobbyPod, group);
  let barWing = null, casinoWing = null, casinoTube = null;
  for (const side of [-1, 1]) {
    const wing = piece(side < 0 ? 'basemodule_A' : 'basemodule_D', WING_S);
    wing.position.x = side * WING_X;
    if (side < 0) barWing = wing;
    else casinoWing = wing;
    // Each wing in its own colours: the bar in warm taupe and wood brown under a green roof, like
    // a cosy pub; the casino in charcoal with gold trim under a deep red roof.
    if (side < 0) repaint(wing, { white: 'taupe', grey: 'brown', purple: 'brown' }, mats.barRoof);
    else repaint(wing, { white: 'charcoal', grey: 'dark', purple: 'gold' }, mats.casinoRoof);
    kit.add(wing);
    const tube = piece('tunnel_straight_A', WING_S);
    // From just inside the lobby's wall to just inside the wing's, no further: its end used to poke
    // through the wing's room, a dark curve behind the bar's regulars.
    const from = LOBBY_FRONT - 1, to = WING_X - 1.1 * WING_S + 1;
    const span = new THREE.Box3().setFromObject(tube);
    const k = (to - from) / (span.max.x - span.min.x);
    tube.scale.x *= k;
    tube.position.x = side * ((from + to) / 2) - ((span.min.x + span.max.x) / 2) * k;
    if (side > 0) casinoTube = tube;
    repaint(tube, { grey: 'brown' });
    tube.traverse((o) => o.isMesh && (o.userData.lobby = true));
    kit.add(tube);
  }
  kit.traverse((o) => {
    if (o.isMesh && !o.userData.roof) o.material = o.userData.lobby ? plaster : warm;
  });
  group.add(kit);

  // The name on the roof, big enough to read from the other islands, facing both ways.
  for (const turn of [0, Math.PI]) {
    const name = signMesh(signTexture('CHOG HUB', null, '#e8b84a'), 24);
    name.position.set(0, 1.65 * LOBBY_S + 3.2, 0);
    name.rotation.y = turn;
    name.translateZ(0.2);
    signs.push(name);
  }

  // Lobby: a wooden arch out on the walk to the door carries its sign on the crown, so nothing
  // stands in front of it. Banners, and a Chog statue.
  const archZ = LOBBY_FRONT + 10;
  for (const sx of [-7, 7]) {
    props.add(box(0.9, 7, 0.9, mats.wood, sx, 3.5, archZ));
    props.add(box(1.2, 0.4, 1.2, mats.brass, sx, 7.1, archZ));
  }
  props.add(new THREE.Mesh(new THREE.TorusGeometry(7, 0.45, 10, 32, Math.PI).translate(0, 7.1, archZ), mats.wood));
  const welcome = signMesh(signTexture('LOBBY', 'welcome to the Chog Hub', '#b89cff', 'rgba(70,40,30,0.95)'), 8, 0.5);
  welcome.position.set(0, 16, archZ);
  signs.push(welcome);
  const banners = [];
  const bannerTex = (() => {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 320;
    const ctx = c.getContext('2d');
    ctx.fillStyle = PURPLE;
    ctx.fillRect(0, 0, 128, 290);
    ctx.beginPath();
    ctx.moveTo(0, 290);
    ctx.lineTo(64, 320);
    ctx.lineTo(128, 290);
    ctx.fill();
    ctx.fillStyle = '#e8b84a';
    ctx.fillRect(0, 0, 128, 16);
    // A round Chog face with two ears.
    ctx.fillStyle = '#fff0dc';
    ctx.beginPath();
    ctx.arc(64, 140, 34, 0, Math.PI * 2);
    ctx.moveTo(38, 116);
    ctx.lineTo(30, 80);
    ctx.lineTo(56, 104);
    ctx.moveTo(90, 116);
    ctx.lineTo(98, 80);
    ctx.lineTo(72, 104);
    ctx.fill();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const bannerMat = new THREE.MeshLambertMaterial({ map: bannerTex, side: THREE.DoubleSide, transparent: true, alphaTest: 0.5 });
  for (const sx of [-12, 12]) {
    props.add(post(0.12, 12, mats.brass, sx, LOBBY_FRONT + 2));
    props.add(box(2.6, 0.12, 0.12, mats.brass, sx, 11.6, LOBBY_FRONT + 2));
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 6).translate(0, -3, 0), bannerMat);
    flag.position.set(sx, 11.5, LOBBY_FRONT + 2.05);
    flag.userData.keep = true;
    banners.push(flag);
    group.add(flag);
  }
  // The entrance. The pod's door is raised 3 m on its plinth: stone steps climb to its threshold, a
  // red runner comes down them and out to the arch, two wooden doors fill the doorway under a
  // transom that glows warm, and a lantern hangs on the wall either side.
  const DOOR = { half: 3.2, bottom: 3.0, top: 8.85, z: 17.25 };
  const STEP = { rise: 0.75, run: 0.9, half: 3.9, from: 18.08 };
  mats.runner = new THREE.MeshLambertMaterial({ color: '#8e2436' });
  mats.steps = new THREE.MeshLambertMaterial({ color: '#efd3ae' });
  // The halls behind the doors: lit only by their lamps, so they glow a little, more after dark.
  const hallLight = new THREE.Color('#ffb46e');
  mats.hallCream = sunScaled(new THREE.MeshLambertMaterial({ color: '#f3e6cf', emissive: hallLight }), NO_SUN);
  mats.hallWood = sunScaled(new THREE.MeshLambertMaterial({ color: '#6e4630', emissive: hallLight }), NO_SUN);
  mats.hallStone = sunScaled(new THREE.MeshLambertMaterial({ color: '#efd3ae', emissive: hallLight }), NO_SUN);
  // The runner glows in its own red, so it stays the same red as it comes in off the steps.
  mats.hallRunner = sunScaled(new THREE.MeshLambertMaterial({ color: '#8e2436', emissive: new THREE.Color('#8e2436').multiply(hallLight) }), NO_SUN);
  const hallMats = [mats.hallCream, mats.hallWood, mats.hallStone, mats.hallRunner];
  for (let i = 0; i < 3; i++) {
    const top = DOOR.bottom - STEP.rise * (i + 1);
    const z0 = STEP.from + STEP.run * i;
    props.add(box(STEP.half * 2, top, STEP.run, mats.steps, 0, top / 2, z0 + STEP.run / 2));
    // The runner over the tread, and down the face above it (the threshold's, for the top step).
    props.add(box(4.2, 0.04, STEP.run, mats.runner, 0, top + 0.02, z0 + STEP.run / 2));
    props.add(box(4.2, STEP.rise, 0.04, mats.runner, 0, top + STEP.rise / 2, z0 + 0.02));
  }
  props.add(box(4.2, STEP.rise, 0.04, mats.runner, 0, STEP.rise / 2, STEP.from + STEP.run * 3 + 0.02));
  const doorH = DOOR.top - 0.85 - DOOR.bottom;
  const lobbyDoor = doorMats(mats);
  const lobbyLeaves = [-1, 1].map((sx) => {
    const l = hingedLeaf({ hinge: new THREE.Vector3(sx * DOOR.half, 0, DOOR.z), dir: -sx, width: DOOR.half, bottom: DOOR.bottom, height: doorH, mats: lobbyDoor });
    group.add(l);
    return l;
  });
  props.add(box(DOOR.half * 2 + 0.3, 0.22, 0.3, mats.wood, 0, DOOR.top - 0.85, DOOR.z + 0.02));
  mats.fanlight = new THREE.MeshStandardMaterial({ color: '#ffe2b0', emissive: new THREE.Color('#ffc477'), emissiveIntensity: 0.4 });
  props.add(box(DOOR.half * 2, 0.6, 0.1, mats.fanlight, 0, DOOR.top - 0.42, DOOR.z - 0.04));
  const lanterns = [-5.1, 5.1].map((x) => new THREE.Vector3(x, 7.0, 16.0));
  mats.lantern = new THREE.MeshStandardMaterial({ color: '#fff3dd', emissive: new THREE.Color('#ffd7a0'), emissiveIntensity: 0.3 });
  for (const p of lanterns) {
    props.add(box(0.14, 0.14, 1.1, mats.brass, p.x, p.y + 0.5, 15.5));
    props.add(new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.32, 8).translate(p.x, p.y + 0.42, p.z), mats.brass));
    props.add(new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8).translate(p.x, p.y, p.z), mats.lantern));
  }

  // The rooms inside: the lobby in the middle pod, the bar in the left wing, the casino in the right.
  // Each is reached for real: its door in the pod's shell opens onto a short hall to the room's own
  // door, so the camera can fly in from the plaza without a cut (src/entry.js).
  const lobbyRoom = buildLobbyRoom();
  // The lobby's sun shafts and dust (B24). The light look keeps fewer motes.
  const lobbyLight = createLobbyFx(lobbyRoom, { quality: /[?&]q=low\b/.test(location.search) ? 'low' : 'high' });
  let lastT = null;
  const barRoom = buildBarRoom();
  const casinoRoom = buildCasinoRoom();
  for (const r of [lobbyRoom, barRoom, casinoRoom]) shadeRoomDoor(r);
  const lobbyIn = LOBBY_ROOM.z + lobbyRoom.d / 2;
  carve(lobbyPod, new THREE.Box3(new THREE.Vector3(-DOOR.half, DOOR.bottom, lobbyIn + 1), new THREE.Vector3(DOOR.half, DOOR.top - 0.85, DOOR.z + 0.3)), group);
  const lobbyFloor = vestibule(props, {
    x: 0, half: DOOR.half, top: DOOR.top - 0.97, zOut: DOOR.z - 0.12, zIn: lobbyIn, sill: DOOR.bottom, floorIn: LOBBY_ROOM.y,
    roomDoor: { half: lobbyRoom.doorway.w / 2, h: lobbyRoom.doorway.h }, mats, lamps: lanterns, runner: 4.2,
  });
  const rugFrom = STEP.from + STEP.run * 3;
  const rugLen = archZ + 1.5 - rugFrom;
  // Pulled forward further than the plaza's paving (see roads.js), so it never sinks into it.
  const rugMat = new THREE.MeshLambertMaterial({ map: rugTexture(), polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(4.2, rugLen).rotateX(-Math.PI / 2), rugMat);
  rug.position.set(0, 0.05, rugFrom + rugLen / 2);
  rug.receiveShadow = true;
  rug.userData.keep = true;
  group.add(rug);

  // The statue: a placeholder Chog in brass on a stone plinth, until the real model arrives.
  const statue = new THREE.Group();
  statue.add(box(3, 1.6, 3, mats.cream, 0, 0.8, 0));
  const body = new THREE.Mesh(new THREE.SphereGeometry(1.2, 24, 16).scale(1, 1.15, 0.95).translate(0, 2.9, 0), mats.brass);
  statue.add(body);
  for (const sx of [-0.6, 0.6]) statue.add(new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.8, 12).rotateZ(-sx * 0.3).translate(sx, 4.4, 0), mats.brass));
  statue.position.set(-13, 0, LOBBY_FRONT + 10);
  statue.rotation.y = 0.4;
  props.add(statue);

  // Bar: a striped awning over the door, string lights out to two posts, tables and stools.
  const bx = -WING_X;
  const awningMat = new THREE.MeshLambertMaterial({ map: stripes('#f3e6cf', '#9a7cf2', 14), side: THREE.DoubleSide });
  const awning = new THREE.Mesh(new THREE.PlaneGeometry(16, 4.8), awningMat);
  awning.position.set(bx, 6.4, WING_FRONT + 2.3);
  awning.rotation.x = -Math.PI / 2 + 0.38;
  awning.userData.keep = true;
  group.add(awning);
  const valance = new THREE.Mesh(new THREE.PlaneGeometry(16, 0.6), awningMat);
  valance.position.set(bx, 5.25, WING_FRONT + 4.55);
  valance.userData.keep = true;
  group.add(valance);
  for (const sx of [-7.8, 7.8]) props.add(post(0.1, 5.6, mats.brass, bx + sx, WING_FRONT + 4.5));
  const bulbs = [];
  const yardZ = WING_FRONT + 12;
  props.add(post(0.14, 5, mats.darkWood, bx - 7, yardZ));
  props.add(post(0.14, 5, mats.darkWood, bx + 7, yardZ));
  stringOfBulbs(new THREE.Vector3(bx - 7.8, 5.5, WING_FRONT + 4.5), new THREE.Vector3(bx - 7, 4.9, yardZ), 0.75, 0.6, bulbs);
  stringOfBulbs(new THREE.Vector3(bx + 7.8, 5.5, WING_FRONT + 4.5), new THREE.Vector3(bx + 7, 4.9, yardZ), 0.75, 0.6, bulbs);
  stringOfBulbs(new THREE.Vector3(bx - 7, 4.9, yardZ), new THREE.Vector3(bx + 7, 4.9, yardZ), 0.75, 0.9, bulbs);
  stringOfBulbs(new THREE.Vector3(bx - 7.8, 5.5, WING_FRONT + 4.5), new THREE.Vector3(bx + 7, 4.9, yardZ), 0.75, 1.1, bulbs);
  for (const [tx, tz] of [[-4.5, 8], [0.5, 10.5], [4.5, 7.5]]) {
    const x = bx + tx, z = WING_FRONT + tz;
    props.add(post(0.09, 1.05, mats.brass, x, z));
    props.add(new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.08, 20).translate(x, 1.08, z), mats.wood));
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + tx;
      const sxs = x + Math.cos(a) * 1.35, szs = z + Math.sin(a) * 1.35;
      props.add(post(0.05, 0.7, mats.brass, sxs, szs));
      props.add(new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.1, 14).translate(sxs, 0.75, szs), mats.darkWood));
    }
  }
  const mug = signMesh(neonMugTexture(), 7.5, 0.5);
  mug.position.set(bx, 8.4, WING_FRONT + 0.2);
  signs.push(mug);
  // The bar's door, cut through the wing's front and its window band and framed in dark wood: two
  // leaves like the lobby's, a stone step up to the sill, and a hall back to the bar's own door.
  const BAR_DOOR = { half: 1.8, bottom: BAR_ROOM.y, top: 5.0, z: WING_FRONT + 0.35 };
  const barIn = BAR_ROOM.z + barRoom.d / 2;
  carve(barWing, new THREE.Box3(new THREE.Vector3(bx - BAR_DOOR.half, BAR_DOOR.bottom, barIn + 1), new THREE.Vector3(bx + BAR_DOOR.half, BAR_DOOR.top, BAR_DOOR.z + 0.4)), group);
  for (const side of [-1, 1]) props.add(box(0.35, BAR_DOOR.top + 0.35, 1.8, mats.darkWood, bx + side * (BAR_DOOR.half + 0.175), (BAR_DOOR.top + 0.35) / 2, WING_FRONT - 0.45));
  props.add(box(BAR_DOOR.half * 2 + 0.7, 0.35, 1.8, mats.darkWood, bx, BAR_DOOR.top + 0.175, WING_FRONT - 0.45));
  props.add(box(BAR_DOOR.half * 2 + 0.8, BAR_DOOR.bottom, 0.9, mats.steps, bx, BAR_DOOR.bottom / 2, BAR_DOOR.z + 0.55));
  const barDoor = doorMats(mats);
  const barLeaves = [-1, 1].map((sx) => {
    const l = hingedLeaf({ hinge: new THREE.Vector3(bx + sx * BAR_DOOR.half, 0, BAR_DOOR.z), dir: -sx, width: BAR_DOOR.half, bottom: BAR_DOOR.bottom, height: BAR_DOOR.top - 0.1 - BAR_DOOR.bottom, mats: barDoor });
    group.add(l);
    return l;
  });
  const barFloor = vestibule(props, {
    x: bx, half: BAR_DOOR.half, top: BAR_DOOR.top - 0.05, zOut: BAR_DOOR.z - 0.12, zIn: barIn, sill: BAR_DOOR.bottom, floorIn: BAR_ROOM.y,
    roomDoor: { half: barRoom.doorway.w / 2, h: barRoom.doorway.h }, mats, lamps: lanterns,
  });

  // Casino: marquee bulbs round the door and sign, red and gold trim, a giant die and chip on the roof.
  const cx = WING_X;
  props.add(box(22.5, 0.7, 0.3, mats.red, cx, 0.6, WING_FRONT + 0.1));
  props.add(box(22.5, 0.25, 0.32, mats.gold, cx, 1.05, WING_FRONT + 0.12));
  props.add(box(22.5, 0.5, 0.3, mats.red, cx, 9.3, WING_FRONT + 0.1));
  const marquee = [];
  const mw = 12, mh = 8.6, my = 5.0, mz = WING_FRONT + 0.35;
  stringOfBulbs(new THREE.Vector3(cx - mw / 2, my - mh / 2, mz), new THREE.Vector3(cx - mw / 2, my + mh / 2, mz), 0.55, 0, marquee);
  stringOfBulbs(new THREE.Vector3(cx - mw / 2, my + mh / 2, mz), new THREE.Vector3(cx + mw / 2, my + mh / 2, mz), 0.55, 0, marquee);
  stringOfBulbs(new THREE.Vector3(cx + mw / 2, my + mh / 2, mz), new THREE.Vector3(cx + mw / 2, my - mh / 2, mz), 0.55, 0, marquee);
  props.add(box(mw + 0.6, 0.3, 0.25, mats.gold, cx, my + mh / 2 + 0.05, mz - 0.15));
  for (const sx of [-1, 1]) props.add(box(0.3, mh, 0.25, mats.gold, cx + (sx * mw) / 2, my, mz - 0.15));
  const casinoSign = signMesh(signTexture('CASINO', 'testnet chips', '#e8b84a', 'rgba(60,14,26,0.95)'), 8.5);
  casinoSign.position.set(cx, 7.4, WING_FRONT + 0.3);
  signs.push(casinoSign);
  // Its door, cut through the wing's front like the bar's and framed in gold: two red lacquered leaves
  // with gold rails, a stone step up to the sill, and a hall back to the casino's own door.
  const CASINO_DOOR = { half: 1.8, bottom: CASINO_ROOM.y, top: 5.0, z: WING_FRONT + 0.35 };
  const casinoIn = CASINO_ROOM.z + casinoRoom.d / 2;
  // The tube from the lobby reaches into the right wing, through where the casino's room stands: cut
  // it (and any of the wing's own shell) away inside the room, whose walls stand there.
  const casinoBox = new THREE.Box3(new THREE.Vector3(cx - casinoRoom.w / 2, CASINO_ROOM.y + 0.02, CASINO_ROOM.z - casinoRoom.d / 2), new THREE.Vector3(cx + casinoRoom.w / 2, CASINO_ROOM.y + casinoRoom.h, casinoIn));
  for (const o of [casinoWing, casinoTube]) carve(o, casinoBox, group);
  carve(casinoWing, new THREE.Box3(new THREE.Vector3(cx - CASINO_DOOR.half, CASINO_DOOR.bottom, casinoIn + 1), new THREE.Vector3(cx + CASINO_DOOR.half, CASINO_DOOR.top, CASINO_DOOR.z + 0.4)), group);
  for (const side of [-1, 1]) props.add(box(0.35, CASINO_DOOR.top + 0.35, 1.8, mats.gold, cx + side * (CASINO_DOOR.half + 0.175), (CASINO_DOOR.top + 0.35) / 2, WING_FRONT - 0.45));
  props.add(box(CASINO_DOOR.half * 2 + 0.7, 0.35, 1.8, mats.gold, cx, CASINO_DOOR.top + 0.175, WING_FRONT - 0.45));
  props.add(box(CASINO_DOOR.half * 2 + 0.8, CASINO_DOOR.bottom, 0.9, mats.steps, cx, CASINO_DOOR.bottom / 2, CASINO_DOOR.z + 0.55));
  const casinoDoor = doorMats({ darkWood: new THREE.MeshLambertMaterial({ color: '#7a1626' }), wood: new THREE.MeshLambertMaterial({ color: '#d9a944' }), brass: mats.gold });
  const casinoLeaves = [-1, 1].map((sx) => {
    const l = hingedLeaf({ hinge: new THREE.Vector3(cx + sx * CASINO_DOOR.half, 0, CASINO_DOOR.z), dir: -sx, width: CASINO_DOOR.half, bottom: CASINO_DOOR.bottom, height: CASINO_DOOR.top - 0.1 - CASINO_DOOR.bottom, mats: casinoDoor });
    group.add(l);
    return l;
  });
  const casinoFloor = vestibule(props, {
    x: cx, half: CASINO_DOOR.half, top: CASINO_DOOR.top - 0.05, zOut: CASINO_DOOR.z - 0.12, zIn: casinoIn, sill: CASINO_DOOR.bottom, floorIn: CASINO_ROOM.y,
    roomDoor: { half: casinoRoom.doorway.w / 2, h: casinoRoom.doorway.h }, mats, lamps: lanterns, runner: 2.4,
  });
  // A giant die resting on the roof: rounded cream cube, every face pipped properly (opposite faces
  // add up to seven), the six toward the plaza.
  const die = new THREE.Group();
  const D = 5;
  die.add(new THREE.Mesh(new RoundedBoxGeometry(D, D, D, 4, 0.45), mats.cream));
  const pip = new THREE.SphereGeometry(0.46, 14, 10).scale(1, 1, 0.3);
  const pipMat = new THREE.MeshLambertMaterial({ color: '#3a1f4a' });
  // Face value and how to place a point (u, v) on that face.
  const faceAt = [
    [6, (u, v) => [u, v, D / 2]],
    [1, (u, v) => [-u, v, -D / 2]],
    [3, (u, v) => [D / 2, v, -u]],
    [4, (u, v) => [-D / 2, v, u]],
    [5, (u, v) => [u, D / 2, -v]],
    [2, (u, v) => [u, -D / 2, v]],
  ];
  for (const [value, at] of faceAt) {
    for (const [u, v] of PIPS[value]) {
      const m = new THREE.Mesh(pip, pipMat);
      m.position.set(...at(u * D * 0.27, v * D * 0.27));
      m.lookAt(m.position.clone().multiplyScalar(2));
      die.add(m);
    }
  }
  die.position.set(cx + 4.5, WING_S + D / 2, -1);
  die.rotation.y = 0.45;
  props.add(die);

  // Stacks of chips lying flat beside it.
  const chipTex = chipTextures();
  const sides = [], caps = [];
  const CH = 0.6, CR = 2.3;
  const stacks = [
    { x: cx - 4, z: 1.5, colours: [0, 1, 2, 0, 1] },
    { x: cx - 0.5, z: 4.2, colours: [2, 0] },
  ];
  for (const s of stacks) {
    s.colours.forEach((c, k) => {
      const g = chipGeometry(CR, CH, c);
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(s.x + Math.sin(k * 2.1) * 0.18, WING_S + CH / 2 + k * CH, s.z + Math.cos(k * 1.7) * 0.18),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, k * 0.7, 0)),
        new THREE.Vector3(1, 1, 1),
      );
      sides.push(g.side.applyMatrix4(m));
      caps.push(g.caps.applyMatrix4(m));
    });
  }
  const chipSide = new THREE.Mesh(mergeGeometries(sides), new THREE.MeshLambertMaterial({ map: chipTex.side }));
  const chipFace = new THREE.Mesh(mergeGeometries(caps), new THREE.MeshLambertMaterial({ map: chipTex.face }));
  for (const m of [chipSide, chipFace]) {
    m.userData.keep = true;
    m.castShadow = true;
    group.add(m);
  }

  for (const s of signs) group.add(s);
  group.add(ticker.group);
  props.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  group.add(props);
  mergeByMaterial(group);
  group.traverse((o) => {
    if (o.isMesh && !o.userData.keep) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  shadeHalls(group);

  lobbyRoom.group.position.set(LOBBY_ROOM.x, LOBBY_ROOM.y, LOBBY_ROOM.z);
  barRoom.group.position.set(BAR_ROOM.x, BAR_ROOM.y, BAR_ROOM.z);
  casinoRoom.group.position.set(CASINO_ROOM.x, CASINO_ROOM.y, CASINO_ROOM.z);
  // How to walk in (hub space): the outside door, its leaves, the hall's floor, and the room's door.
  // steps: the fronts of the steps up to the sill from outside, the outermost first, as [z, the tread's
  // top], so a Chog walks to each riser and steps up it instead of floating up a slope through them.
  const entrance = (x, d, leaves, door, floor, zIn, room, steps = [[d.z + 1.0, d.bottom]]) => {
    const slide = slidingDoor(leaves);
    return {
      x, half: d.half, sill: d.bottom, top: d.top, z: d.z, zIn, floor, room, steps,
      // Parts the outside doors, sliding into the wall: 0 shut, 1 open. Open, the hall's in shade.
      open(k) {
        slide(k);
        doorSun(door, k);
      },
    };
  };
  const rooms = [
    {
      id: 'lobby', name: 'Lobby', room: lobbyRoom, at: new THREE.Vector3(LOBBY_ROOM.x, LOBBY_ROOM.y, LOBBY_ROOM.z), shell: 'lobby',
      entrance: entrance(0, { ...DOOR, top: DOOR.top - 0.85 }, lobbyLeaves, lobbyDoor, lobbyFloor, lobbyIn, lobbyRoom, [2, 1, 0, -1].map((i) => [STEP.from + STEP.run * (i + 1), DOOR.bottom - STEP.rise * (i + 1)])),
    },
    {
      id: 'bar', name: 'Bar', room: barRoom, at: new THREE.Vector3(BAR_ROOM.x, BAR_ROOM.y, BAR_ROOM.z), shell: 'bar',
      entrance: entrance(bx, BAR_DOOR, barLeaves, barDoor, barFloor, barIn, barRoom),
    },
    {
      id: 'casino', name: 'Casino', room: casinoRoom, at: new THREE.Vector3(CASINO_ROOM.x, CASINO_ROOM.y, CASINO_ROOM.z), shell: 'casino',
      entrance: entrance(cx, CASINO_DOOR, casinoLeaves, casinoDoor, casinoFloor, casinoIn, casinoRoom),
    },
  ];
  for (const r of rooms) {
    r.room.group.visible = false;
    group.add(r.room.group);
  }

  // Bulbs: warm string lights over the bar, gold marquee bulbs that chase round the casino door.
  const bulbGeo = new THREE.SphereGeometry(0.13, 8, 6);
  const warmBulbs = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd9a0') });
  // (Not drawn right by the camera: walking into the bar under them, they filled the view as big discs: A, the
  // user 10-21.)
  warmBulbs.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vNearD;').replace('#include <project_vertex>', '#include <project_vertex>\nvNearD = -mvPosition.z;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vNearD;').replace('void main() {', 'void main() {\n  if (vNearD < 1.6) discard;');
  };
  warmBulbs.customProgramCacheKey = () => 'warm-bulbs-near';
  const stringMesh = new THREE.InstancedMesh(bulbGeo, warmBulbs, bulbs.length);
  bulbs.forEach((p, i) => stringMesh.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z)));
  group.add(stringMesh);
  const marqueeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffffff') });
  const marqueeMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.17, 8, 6), marqueeMat, marquee.length);
  marquee.forEach((p, i) => {
    marqueeMesh.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z));
    marqueeMesh.setColorAt(i, new THREE.Color('#ffd27a'));
  });
  group.add(marqueeMesh);
  const lanternGlow = createGlows(lanterns, { size: 1.6, minPx: 3 });
  group.add(lanternGlow.points);
  const stringGlow = createGlows(bulbs, { color: '#ffcf8a', size: 0.9, minPx: 3 });
  const marqueeGlow = createGlows(marquee, { color: '#ffd27a', size: 0.8, minPx: 3 });
  group.add(stringGlow.points, marqueeGlow.points);
  const lit = new THREE.Color('#ffd27a'), dim = new THREE.Color('#6b4a20');
  const tmp = new THREE.Color();

  return {
    group,
    width: (WING_X + 1.1 * WING_S) * 2,
    depth: 2.3 * LOBBY_S,
    height: 1.65 * LOBBY_S,
    rooms,
    update(env, t, renderer) {
      for (const r of rooms) if (r.room.group.visible) r.room.update(env, renderer);
      const dt = lastT === null ? 0 : Math.min(0.1, Math.max(0, t - lastT));
      lastT = t;
      if (lobbyRoom.group.visible) lobbyLight.update(dt, env);
      const n = env.night;
      for (const s of signs) s.material.emissiveIntensity = 0.35 + n * 1.6;
      mats.lantern.emissiveIntensity = 0.3 + n * 2.2;
      mats.fanlight.emissiveIntensity = 0.4 + n * 1.8;
      for (const m of hallMats) m.emissiveIntensity = 0.1 + n * 0.32;
      lanternGlow.update(env, renderer);
      // Bulbs glow by day as decoration and properly at night.
      warmBulbs.color.set('#ffd9a0').multiplyScalar(1 + n * 2.5);
      const step = Math.floor(t * 6);
      marquee.forEach((p, i) => {
        tmp.copy((i + step) % 3 === 0 ? lit : dim).multiplyScalar(1 + n * 2.5);
        marqueeMesh.setColorAt(i, tmp);
      });
      marqueeMesh.instanceColor.needsUpdate = true;
      ticker.update(t, n);
      for (const [k, b] of banners.entries()) b.rotation.y = Math.sin(t * 0.8 + k * 2) * 0.12;
      stringGlow.update(env, renderer);
      marqueeGlow.update(env, renderer);
    },
  };
}
