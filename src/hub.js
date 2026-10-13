import * as THREE from 'three';
import { piece, kitMaterial, repaint } from './kaykit.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mergeByMaterial } from './merge.js';
import { createGlows } from './glows.js';
import { buildLobbyRoom, buildBarRoom } from './interior.js';

/*
 * The Chog Hub: one building on the downtown plaza with three doors, each wing with its own
 * character. The domed lobby in the middle (where owners sign in) behind a wooden welcome arch,
 * with banners and a Chog statue; the bar on the left under a striped awning, with string lights
 * and tables outside; the casino on the right, closed for now, framed in marquee bulbs with a
 * giant die and chip on its roof. KayKit pods in warm cream, with wood, brass and the purple.
 */

export const HUB_KIT = ['basemodule_E', 'basemodule_A', 'basemodule_D', 'tunnel_straight_A'];

// Where the rooms sit inside the pods (hub space): floor heights just above each pod's base.
const LOBBY_ROOM = { x: 0, y: 0.6, z: 0 };
const BAR_ROOM = { x: -37, y: 0.45, z: 0.6 };

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
  const kit = new THREE.Group();
  kit.add(piece('basemodule_E', LOBBY_S));
  for (const side of [-1, 1]) {
    const wing = piece(side < 0 ? 'basemodule_A' : 'basemodule_D', WING_S);
    wing.position.x = side * WING_X;
    // Each wing in its own colours: the bar in warm taupe and wood brown under a green roof, like
    // a cosy pub; the casino in charcoal with gold trim under a deep red roof.
    if (side < 0) repaint(wing, { white: 'taupe', grey: 'brown', purple: 'brown' }, mats.barRoof);
    else repaint(wing, { white: 'charcoal', grey: 'dark', purple: 'gold' }, mats.casinoRoof);
    kit.add(wing);
    const tube = piece('tunnel_straight_A', WING_S);
    tube.position.x = side * (LOBBY_FRONT + (WING_X - 1.1 * WING_S - LOBBY_FRONT) / 2);
    kit.add(tube);
  }
  kit.traverse((o) => {
    if (o.isMesh && !o.userData.roof) o.material = warm;
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
  const casinoSign = signMesh(signTexture('CASINO', 'opening soon', '#e8b84a', 'rgba(60,14,26,0.95)'), 8.5);
  casinoSign.position.set(cx, 7.4, WING_FRONT + 0.3);
  signs.push(casinoSign);
  // A closed door: dark panel with a brass bar across it.
  props.add(box(4.2, 5.4, 0.2, mats.darkWood, cx, 2.7, WING_FRONT + 0.25));
  props.add(box(4.6, 0.25, 0.3, mats.brass, cx, 3.2, WING_FRONT + 0.4));
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

  // The rooms inside: the lobby in the middle pod, the bar in the left wing. The casino stays shut.
  const lobby = buildLobbyRoom();
  lobby.group.position.set(LOBBY_ROOM.x, LOBBY_ROOM.y, LOBBY_ROOM.z);
  const bar = buildBarRoom();
  bar.group.position.set(BAR_ROOM.x, BAR_ROOM.y, BAR_ROOM.z);
  const rooms = [
    { id: 'lobby', name: 'Lobby', room: lobby, at: new THREE.Vector3(LOBBY_ROOM.x, LOBBY_ROOM.y, LOBBY_ROOM.z), shell: 'lobby' },
    { id: 'bar', name: 'Bar', room: bar, at: new THREE.Vector3(BAR_ROOM.x, BAR_ROOM.y, BAR_ROOM.z), shell: 'bar' },
  ];
  for (const r of rooms) {
    r.room.group.visible = false;
    group.add(r.room.group);
  }

  // Bulbs: warm string lights over the bar, gold marquee bulbs that chase round the casino door.
  const bulbGeo = new THREE.SphereGeometry(0.13, 8, 6);
  const warmBulbs = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd9a0') });
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
      const n = env.night;
      for (const s of signs) s.material.emissiveIntensity = 0.35 + n * 1.6;
      // Bulbs glow by day as decoration and properly at night.
      warmBulbs.color.set('#ffd9a0').multiplyScalar(1 + n * 2.5);
      const step = Math.floor(t * 6);
      marquee.forEach((p, i) => {
        tmp.copy((i + step) % 3 === 0 ? lit : dim).multiplyScalar(1 + n * 2.5);
        marqueeMesh.setColorAt(i, tmp);
      });
      marqueeMesh.instanceColor.needsUpdate = true;
      for (const [k, b] of banners.entries()) b.rotation.y = Math.sin(t * 0.8 + k * 2) * 0.12;
      stringGlow.update(env, renderer);
      marqueeGlow.update(env, renderer);
    },
  };
}
