import * as THREE from 'three';
import { noise2 } from './util.js';

const texCache = {};

// Vertical timber boards with grain, drawn once.
function timberTexture() {
  if (texCache.timber) return texCache.timber;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 512;
  const ctx = c.getContext('2d');
  const boards = 8;
  for (let b = 0; b < boards; b++) {
    const x0 = (b / boards) * c.width;
    const tone = 0.85 + noise2(b * 3.1, 7) * 0.3;
    ctx.fillStyle = `rgb(${Math.round(196 * tone)}, ${Math.round(140 * tone)}, ${Math.round(92 * tone)})`;
    ctx.fillRect(x0, 0, c.width / boards, c.height);
    for (let g = 0; g < 14; g++) {
      ctx.strokeStyle = `rgba(90, 55, 30, ${0.08 + noise2(b, g) * 0.12})`;
      ctx.lineWidth = 1 + noise2(g, b) * 1.5;
      ctx.beginPath();
      const gx = x0 + 3 + noise2(b * 5, g * 2) * (c.width / boards - 6);
      ctx.moveTo(gx, 0);
      for (let y = 0; y <= c.height; y += 32) ctx.lineTo(gx + Math.sin(y * 0.02 + g) * 2, y);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(40, 24, 12, 0.55)';
    ctx.fillRect(x0, 0, 2, c.height);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  texCache.timber = t;
  return t;
}

// Faint plaster speckle for the white walls.
function plasterTexture() {
  if (texCache.plaster) return texCache.plaster;
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(s, s);
  for (let i = 0; i < s * s; i++) {
    const x = i % s, y = Math.floor(i / s);
    const v = 236 + (noise2(x * 0.3, y * 0.3) - 0.5) * 14 + (Math.random() - 0.5) * 6;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v - 2;
    img.data[i * 4 + 2] = v + 3;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  texCache.plaster = t;
  return t;
}

/**
 * A small modern home: white plaster ground floor, timber-clad upper floor that cantilevers
 * over a deck, flat roofs with thin dark fascias, full-height glazing.
 * Front faces +z. Units are metres-ish; a door is 2.2 tall.
 */
export function makeHome({ accent = '#a78bfa' } = {}) {
  const group = new THREE.Group();
  const timber = timberTexture();
  const plaster = plasterTexture();

  const wall = new THREE.MeshStandardMaterial({ map: plaster, roughness: 0.92 });
  const wood = new THREE.MeshStandardMaterial({ map: timber, roughness: 0.75 });
  const fascia = new THREE.MeshStandardMaterial({ color: '#2b2735', roughness: 0.5, metalness: 0.4 });
  const frame = new THREE.MeshStandardMaterial({ color: '#25222d', roughness: 0.35, metalness: 0.7 });
  const door = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.45 });
  const glass = new THREE.MeshPhysicalMaterial({
    color: '#1d2340',
    roughness: 0.05,
    metalness: 0.1,
    envMapIntensity: 1.6,
    emissive: new THREE.Color('#ffc58a'),
    emissiveIntensity: 0,
    clearcoat: 1,
  });
  const deckMat = new THREE.MeshStandardMaterial({ map: timber, roughness: 0.8, color: '#d8c3a8' });

  const box = (w, h, d, mat, x, y, z, uvScale) => {
    const g = new THREE.BoxGeometry(w, h, d);
    if (uvScale) {
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uvScale[0], uv.getY(i) * uvScale[1]);
    }
    const m = new THREE.Mesh(g, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };

  // Ground floor.
  box(8, 3.2, 6, wall, 0, 1.6, 0, [2, 1]);
  box(8.4, 0.3, 6.4, fascia, 0, 3.35, 0);
  // Full-height glazing across the front with mullions.
  box(4.6, 2.6, 0.08, glass, -1.3, 1.45, 3.02);
  for (const x of [-3.6, -2.05, -0.5, 1.0]) box(0.1, 2.7, 0.14, frame, x, 1.45, 3.04);
  box(4.7, 0.1, 0.14, frame, -1.3, 2.78, 3.04);
  // Door.
  box(1.2, 2.3, 0.1, door, 2.6, 1.15, 3.03);
  box(1.4, 0.12, 0.16, frame, 2.6, 2.36, 3.05);

  // Upper floor, timber, shifted right and cantilevered forward.
  box(5.4, 2.8, 6.2, wood, 1.2, 4.9, 0.8, [1.6, 1]);
  box(5.8, 0.28, 6.6, fascia, 1.2, 6.44, 0.8);
  box(4.2, 1.5, 0.08, glass, 1.2, 5.0, 3.92);
  box(4.3, 0.1, 0.14, frame, 1.2, 5.78, 3.95);
  box(4.3, 0.1, 0.14, frame, 1.2, 4.22, 3.95);
  // Side window.
  box(0.08, 1.2, 2.6, glass, 3.92, 5.0, 0.4);

  // Roof terrace rail on the ground floor roof, left side.
  box(2.6, 0.06, 0.06, frame, -2.7, 4.3, 3.0);
  box(0.06, 0.06, 6, frame, -3.95, 4.3, 0);
  for (const x of [-3.95, -2.7, -1.5]) box(0.06, 0.9, 0.06, frame, x, 3.85, 3.0);

  // Deck and step.
  box(9.4, 0.22, 2.6, deckMat, 0, 0.11, 4.3, [3, 1]);
  box(2.2, 0.12, 0.8, deckMat, 2.6, 0.06, 5.9);

  // Wall lights by the door.
  const lampMat = new THREE.MeshStandardMaterial({ color: '#fff2d6', emissive: new THREE.Color('#ffd49a'), emissiveIntensity: 0 });
  for (const x of [1.75, 3.45]) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.4, 0.14), lampMat);
    l.position.set(x, 2.0, 3.1);
    group.add(l);
  }


  return {
    group,
    halfW: 4.8,
    back: -3.3,
    front: 6.4,
    setNight(n) {
      glass.emissiveIntensity = n * 1.4;
      glass.color.set('#1d2340').lerp(new THREE.Color('#5a4630'), n * 0.6);
      lampMat.emissiveIntensity = n * 6;
    },
  };
}
