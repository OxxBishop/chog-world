import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/*
 * What stands over the bridges between the islands: glass hoops, the user's pick (10-19). A rounded band
 * of clear lilac glass arches over the deck every few metres, a line of light set in its inside face, the
 * taller pair at each end a gateway. After dark the lines glow and a pulse runs along each bridge. The
 * hoops stand on the deck inside its rails and follow it, landings and stairs; they leave the sky open,
 * so the camera behind you is never boxed in.
 *
 * paths: the bridges as buildBridges returns them ({ ax, az, bx, bz, len, deckY(t), width, hood }).
 * Three draw calls for every bridge: the hoops, the gateways and the lines.
 */

const SPACING = 7;
const BAND = 0.16; // the glass's thickness
const DEPTH = 0.62; // its width along the bridge
const RISE = 8.4; // how high a hoop stands over the deck
const PROFILE = 40;

// A hoop's band, in its own frame: across the bridge along x, up y, its depth along z.
function bandGeometry(hw, hi) {
  const shape = new THREE.Shape();
  const ring = (rx, ry, from, to) => {
    for (let j = 0; j <= PROFILE; j++) {
      const th = from + ((to - from) * j) / PROFILE;
      const x = Math.cos(th) * rx, y = Math.sin(th) * ry;
      if (j === 0 && from === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
  };
  ring(hw + BAND / 2, hi + BAND / 2, 0, Math.PI);
  ring(hw - BAND / 2, hi - BAND / 2, Math.PI, 0);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: DEPTH - 0.08, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.035, bevelSegments: 2, curveSegments: 4 });
  geo.translate(0, 0, -(DEPTH - 0.08) / 2);
  geo.deleteAttribute('uv');
  return geo;
}

// The line of light on the band's inside face.
function lineGeometry(hw, hi) {
  const pts = [];
  for (let j = 2; j <= PROFILE - 2; j++) {
    const th = (Math.PI * j) / PROFILE;
    pts.push(new THREE.Vector3(Math.cos(th) * (hw - BAND / 2 - 0.05), Math.sin(th) * (hi - BAND / 2 - 0.05), 0));
  }
  const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.05, 6);
  geo.deleteAttribute('uv');
  return geo;
}

export function buildTunnels(scene, paths) {
  // Clear face on, bright and reflective toward its edges, with a faint soap-film sheen.
  const glass = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#cdb8ff').lerp(new THREE.Color('#ffffff'), 0.55),
    roughness: 0.05,
    metalness: 0,
    transparent: true,
    envMapIntensity: 1.6,
    depthWrite: false,
    specularIntensity: 1,
    side: THREE.DoubleSide,
  });
  glass.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `float fres = pow(clamp(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0), 2.2);
diffuseColor.a = mix(0.22, 0.92, fres);
// (Gone right by the camera: it may sit above the hoops, looking down through them, A 10-21.)
diffuseColor.a *= smoothstep(1.2, 3.2, length(vViewPosition));
outgoingLight += mix(vec3(1.0, 0.62, 0.92), vec3(0.55, 0.9, 1.0), fres) * fres * 0.3;
#include <opaque_fragment>`,
    );
  };
  glass.customProgramCacheKey = () => 'hoop-glass';

  const group = new THREE.Group();
  const hw = (br) => br.width / 2 - 0.35;
  const shapes = new Map();
  const shapeFor = (br, gate) => {
    const key = `${br.width}-${gate ? 1 : 0}`;
    if (!shapes.has(key)) {
      const w = hw(br) + (gate ? 0.25 : 0), h = RISE + (gate ? 1.2 : 0);
      shapes.set(key, { band: bandGeometry(w, h), line: lineGeometry(w, h), at: [] });
    }
    return shapes.get(key);
  };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), Y = new THREE.Vector3(0, 1, 0);
  const lines = [];
  // Each bridge's hoops, for what can't pass through them (src/travel.js): where they stand along it.
  const corridors = [];
  for (const br of paths) {
    const ux = (br.bx - br.ax) / br.len, uz = (br.bz - br.az) / br.len;
    const count = Math.max(2, Math.round((br.len - 1.2) / SPACING));
    corridors.push({ br, ux, uz, hw: hw(br), first: 0.6, last: br.len - 0.6, step: (br.len - 1.2) / count });
    q.setFromAxisAngle(Y, Math.atan2(ux, uz));
    for (let k = 0; k <= count; k++) {
      // From just inside one end of the deck to just inside the other.
      const d = 0.6 + ((br.len - 1.2) * k) / count;
      const t = d / br.len;
      const gate = k === 0 || k === count;
      const s = shapeFor(br, gate);
      const p = new THREE.Vector3(br.ax + ux * d, br.deckY(t) + 0.15, br.az + uz * d);
      s.at.push(m4.compose(p, q, one).clone());
      // Its line, placed, with where it is along its bridge (for the running pulse) and whether it's a gateway.
      const g = s.line.clone().applyMatrix4(m4);
      const nv = g.attributes.position.count;
      g.setAttribute('aHoop', new THREE.Float32BufferAttribute(new Float32Array(nv * 2).map((_, i) => (i % 2 ? (gate ? 1 : 0) : d + (br.hood ?? 0) * 3.1)), 2));
      lines.push(g);
    }
  }
  for (const s of shapes.values()) {
    const inst = new THREE.InstancedMesh(s.band, glass, s.at.length);
    s.at.forEach((m, i) => inst.setMatrixAt(i, m));
    inst.renderOrder = 2;
    inst.frustumCulled = false;
    group.add(inst);
  }

  // The lines: one mesh, coloured in its shader. By day a soft lilac; after dark brighter, with a pulse of
  // pink running along each bridge, and the gateways in cyan.
  const uniforms = { uTime: { value: 0 }, uNight: { value: 0 } };
  const lineMat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      attribute vec2 aHoop;
      varying vec2 vHoop;
      varying float vNear;
      void main() {
        vHoop = aHoop;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNear = length(mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uNight;
      varying vec2 vHoop;
      varying float vNear;
      void main() {
        if (vNear < 1.8) discard;
        float wave = pow(max(0.0, sin(vHoop.x * 0.18 - uTime * 2.2)), 6.0);
        vec3 lilac = vec3(0.78, 0.62, 1.0), pink = vec3(1.0, 0.5, 0.78), cyan = vec3(0.5, 0.91, 1.0);
        vec3 c = mix(lilac, mix(pink, cyan, vHoop.y), wave);
        gl_FragColor = vec4(c * (0.7 + uNight * (0.9 + wave * 1.6)), 1.0);
      }`,
  });
  const lineMesh = new THREE.Mesh(mergeGeometries(lines), lineMat);
  lineMesh.frustumCulled = false;
  group.add(lineMesh);
  scene.add(group);

  // Where p is against a bridge's hoops: its bridge, how far along and out to the side, and its height
  // over the deck. Null away from them.
  const locate = (p) => {
    for (const c of corridors) {
      const dx = p.x - c.br.ax, dz = p.z - c.br.az;
      const along = dx * c.ux + dz * c.uz;
      if (along < c.first - 1.2 || along > c.last + 1.2) continue;
      const lat = -dx * c.uz + dz * c.ux;
      if (Math.abs(lat) > c.br.width / 2 + 6) continue;
      return { c, along, lat, y: p.y - (c.br.deckY(THREE.MathUtils.clamp(along / c.br.len, 0, 1)) + 0.15) };
    }
    return null;
  };
  const inner = (c, m) => [c.hw - BAND / 2 - m, RISE - BAND / 2 - m];

  let clock = 0;
  return {
    group,
    look: 'glass',
    /**
     * Inside a bridge's hoops (under their arch, between its gateways). strict, for the camera: whether
     * it is clear of them, under the arch by half a metre, or anywhere away from them.
     */
    inside(p, strict = false) {
      const at = locate(p);
      if (!at) return strict;
      const [a, b] = inner(at.c, strict ? 0.5 : 0.1);
      const y = Math.max(0, at.y);
      return (at.lat / a) ** 2 + (y / b) ** 2 < 1;
    },
    /** Which way the bridge whose hoops p is under runs (a yaw), or null. */
    axisAt(p) {
      const at = locate(p);
      return at ? Math.atan2(at.c.ux, at.c.uz) : null;
    },
    /**
     * Keeps a body (a column r round, h tall from its feet) clear of a bridge's hoops, rails and lamps,
     * moving it from `from` to p: on the bridge, in under the arch as far out as the band at its head
     * allows; beside the bridge (on the land by a landing), out past the rails. Moves p.
     */
    keepOff(from, p, r, h) {
      const at = locate(p);
      if (!at) return false;
      const c = at.c;
      if (at.along < c.first - DEPTH / 2 - r || at.along > c.last + DEPTH / 2 + r) return false;
      const gate = at.along < c.first + c.step / 2 || at.along > c.last - c.step / 2;
      const hwk = c.hw + (gate ? 0.25 : 0), rise = RISE + (gate ? 1.2 : 0);
      const top = Math.min(Math.max(0.1, at.y + h), rise * 0.95);
      // (Its head is narrower than its middle: a little less room kept round it up there.)
      const inLim = (hwk - BAND / 2) * Math.sqrt(1 - (top / rise) ** 2) - r * 0.7;
      const outLim = Math.max(hwk + BAND / 2, c.br.width / 2 + 0.3) + r;
      const fl = -(from.x - c.br.ax) * c.uz + (from.z - c.br.az) * c.ux;
      const inside = Math.abs(fl) <= (inLim + outLim) / 2;
      const a = Math.abs(at.lat);
      const want = inside ? Math.min(a, inLim) : Math.max(a, outLim);
      if (want === a) return false;
      const shift = (want - a) * Math.sign(at.lat || fl || 1);
      p.x += -c.uz * shift;
      p.z += c.ux * shift;
      return true;
    },
    update(env, renderer, dt = 0.016) {
      clock += dt;
      uniforms.uTime.value = clock;
      uniforms.uNight.value = env.night;
    },
  };
}
