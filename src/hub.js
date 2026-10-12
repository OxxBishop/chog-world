import * as THREE from 'three';
import { piece } from './kaykit.js';
import { mergeByMaterial } from './merge.js';

/*
 * The Chog Hub: one building on the downtown plaza with three doors. The domed lobby in the
 * middle (where owners sign in), the bar wing on the left (where Chogs hang out), and the casino
 * wing on the right, closed for now. Built from KayKit pods and tubes.
 */

export const HUB_KIT = ['basemodule_E', 'basemodule_A', 'basemodule_D', 'tunnel_straight_A', 'roofmodule_solarpanels', 'roofmodule_cargo_A', 'lights'];

const LOBBY_S = 15;
const WING_S = 10;
const WING_X = 37;

// A lit sign: rounded dark panel, big title, optional small line under it.
function signTexture(title, sub, accent) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = sub ? 320 : 220;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(26,18,48,0.92)';
  ctx.beginPath();
  ctx.roundRect(8, 8, c.width - 16, c.height - 16, 48);
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 10;
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
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

function sign(title, sub, width, accent) {
  const map = signTexture(title, sub, accent);
  const aspect = map.image.height / map.image.width;
  const mat = new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.35, transparent: true, roughness: 0.6 });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(width, width * aspect), mat);
  m.userData.keep = true;
  return m;
}

export function buildHub() {
  const group = new THREE.Group();
  const signs = [];

  const lobby = piece('basemodule_E', LOBBY_S);
  group.add(lobby);
  const lobbyHalf = 1.14 * LOBBY_S;
  for (const side of [-1, 1]) {
    const wing = piece(side < 0 ? 'basemodule_A' : 'basemodule_D', WING_S);
    wing.position.x = side * WING_X;
    group.add(wing);
    const roof = piece(side < 0 ? 'roofmodule_solarpanels' : 'roofmodule_cargo_A', WING_S * 1.1);
    roof.position.set(side * WING_X, WING_S, 0);
    group.add(roof);
    const tube = piece('tunnel_straight_A', WING_S);
    tube.position.x = side * (lobbyHalf + (WING_X - 1.1 * WING_S - lobbyHalf) / 2);
    group.add(tube);
  }

  // Signs: the building's name over the lobby, a name over each door.
  const accent = '#b89cff';
  const front = (s) => 1.12 * s + 0.15;
  // The name stands on the roof, big enough to read from the other islands, facing both ways.
  for (const turn of [0, Math.PI]) {
    const name = sign('CHOG HUB', null, 24, accent);
    name.position.set(0, 1.65 * LOBBY_S + 3.2, 0);
    name.rotation.y = turn;
    name.translateZ(0.2);
    signs.push(name);
  }
  const doors = [
    { title: 'LOBBY', sub: null, x: 0, z: front(LOBBY_S), y: 9.4, w: 8.5, color: accent },
    { title: 'BAR', sub: null, x: -WING_X, z: front(WING_S), y: 8, w: 7, color: '#7ee0d8' },
    { title: 'CASINO', sub: 'opening soon', x: WING_X, z: front(WING_S), y: 8, w: 8.5, color: '#ff9bd6' },
  ];
  for (const d of doors) {
    const s = sign(d.title, d.sub, d.w, d.color);
    s.position.set(d.x, d.y, d.z);
    signs.push(s);
  }
  for (const s of signs) group.add(s);

  mergeByMaterial(group);
  group.traverse((o) => {
    if (o.isMesh && !o.userData.keep) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

  return {
    group,
    width: (WING_X + 1.1 * WING_S) * 2,
    depth: 2.3 * LOBBY_S,
    height: 1.65 * LOBBY_S,
    setNight(n) {
      for (const s of signs) s.material.emissiveIntensity = 0.35 + n * 1.6;
    },
  };
}
