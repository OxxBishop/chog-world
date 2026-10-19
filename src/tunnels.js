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
  for (const br of paths) {
    const ux = (br.bx - br.ax) / br.len, uz = (br.bz - br.az) / br.len;
    const count = Math.max(2, Math.round((br.len - 1.2) / SPACING));
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
      void main() {
        vHoop = aHoop;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uNight;
      varying vec2 vHoop;
      void main() {
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

  let clock = 0;
  return {
    group,
    look: 'glass',
    // Open to the sky: the camera is never inside anything here (travel.js asks).
    inside: () => false,
    update(env, renderer, dt = 0.016) {
      clock += dt;
      uniforms.uTime.value = clock;
      uniforms.uNight.value = env.night;
    },
  };
}
