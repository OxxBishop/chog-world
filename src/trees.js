import * as THREE from 'three';
import { info } from './assets.js';
import { wind } from './foliage.js';

const CELL = 128;
const ATLAS_COLS = 16;
const VIEWS = 8;

const impostorVert = /* glsl */ `
attribute float aBase;
attribute vec2 aSize;
uniform float uCols;
uniform float uRows;
varying vec2 vUv;
varying vec3 vTint;
#include <fog_pars_vertex>
void main() {
  vec3 center = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float s = length(instanceMatrix[0].xyz);
  vec3 toCam = cameraPosition - center;
  toCam.y = 0.0;
  toCam = normalize(toCam);
  vec3 right = vec3(toCam.z, 0.0, -toCam.x);
  vec3 wp = center + right * position.x * aSize.x * s + vec3(0.0, 1.0, 0.0) * position.y * aSize.y * s;

  // Pick the baked view that matches where the camera is, relative to the tree's own rotation,
  // so the cutout and the full tree have the same silhouette.
  float yaw = atan(-instanceMatrix[0].z, instanceMatrix[0].x);
  float camAngle = atan(toCam.x, toCam.z) - yaw;
  float view = mod(floor(camAngle / (6.2831853 / ${VIEWS}.0) + 0.5), ${VIEWS}.0);
  float cell = aBase + view;
  vec2 cellUv = vec2(mod(cell, uCols), floor(cell / uCols));
  vUv = (cellUv + uv) / vec2(uCols, uRows);

#ifdef USE_INSTANCING_COLOR
  vTint = instanceColor;
#else
  vTint = vec3(1.0);
#endif
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const impostorFrag = /* glsl */ `
uniform sampler2D uColor;
uniform sampler2D uMask;
uniform vec3 uLight;
uniform vec2 uAtlas;
varying vec2 vUv;
varying vec3 vTint;
#include <fog_pars_fragment>
void main() {
  vec4 c = texture2D(uColor, vUv);
  // Smaller mip levels average the leaves with the gaps between them, so a hard cut thins far trees
  // until they vanish. Scale coverage back up by mip level so they keep their shape.
  vec2 px = vUv * uAtlas;
  float mip = max(0.0, 0.5 * log2(max(dot(dFdx(px), dFdx(px)), dot(dFdy(px), dFdy(px)))));
  if (c.a * (1.0 + mip * 0.32) < 0.4) discard;
  float leaf = texture2D(uMask, vUv).r / max(c.a, 0.001);
  vec3 col = mix(c.rgb, c.rgb * vTint, clamp(leaf, 0.0, 1.0)) / max(c.a, 0.001);
  gl_FragColor = vec4(col * uLight, 1.0);
  #include <fog_fragment>
}`;

// Flat white (leaves) or black (bark) that keeps the texture's cutout shape.
function maskMaterial(src, leaf) {
  const m = new THREE.MeshBasicMaterial({ color: leaf ? 0xffffff : 0x000000, map: src.map, alphaTest: src.alphaTest, side: THREE.DoubleSide });
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#ifdef USE_MAP
  diffuseColor.a *= texture2D(map, vMapUv).a;
#endif`,
    );
  };
  m.customProgramCacheKey = () => 'impostor-mask';
  return m;
}

/**
 * Every tree on the island. Trees near the camera are full instanced meshes with wind and shadows;
 * the rest are camera-facing cutouts baked from the same models, from eight directions, at load time.
 */
export class Forest {
  constructor() {
    this.trees = [];
    this.lodDist = 80;
    this.maxNear = 160;
  }

  add(name, x, y, z, { scale = 1, rotY = 0, tilt = 0, tint = '#8ccf4d' } = {}) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt * (Math.random() - 0.5), rotY, tilt * (Math.random() - 0.5)));
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(scale, scale, scale));
    this.trees.push({ name, m, x, z, tint: new THREE.Color(tint), near: false });
  }

  build(scene, renderer) {
    const names = [...new Set(this.trees.map((t) => t.name))];
    this.groups = new Map();
    for (const name of names) {
      const c = info(name);
      const count = this.trees.filter((t) => t.name === name).length;
      const parts = c.parts.map((p) => {
        const mesh = new THREE.InstancedMesh(p.geometry, p.material, count);
        mesh.count = 0;
        mesh.castShadow = p.shadow;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        if (p.tintable) mesh.setColorAt(0, new THREE.Color(1, 1, 1));
        scene.add(mesh);
        return { p, mesh };
      });
      this.groups.set(name, { parts, n: 0 });
    }
    for (const t of this.trees) t.partM = info(t.name).parts.map((p) => new THREE.Matrix4().multiplyMatrices(t.m, p.matrix));

    this.bake(renderer, names);

    const cap = this.trees.length;
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.translate(0, 0.5, 0);
    this.aBase = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    this.aSize = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2);
    geo.setAttribute('aBase', this.aBase);
    geo.setAttribute('aSize', this.aSize);
    this.impostorMat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        { uLight: { value: new THREE.Color(1, 1, 1) }, uCols: { value: ATLAS_COLS }, uRows: { value: this.rows }, uAtlas: { value: new THREE.Vector2(CELL * ATLAS_COLS, CELL * this.rows) } },
      ]),
      vertexShader: impostorVert,
      fragmentShader: impostorFrag,
      fog: true,
    });
    this.impostorMat.uniforms.uColor = { value: this.colorRT.texture };
    this.impostorMat.uniforms.uMask = { value: this.maskRT.texture };
    this.impostors = new THREE.InstancedMesh(geo, this.impostorMat, cap);
    this.impostors.setColorAt(0, new THREE.Color(1, 1, 1));
    this.impostors.count = 0;
    this.impostors.frustumCulled = false;
    scene.add(this.impostors);
    this.last = new THREE.Vector3(1e9, 0, 0);
  }

  // Render each tree model from eight directions into an atlas: colour (leaves untinted) and a leaf mask.
  bake(renderer, names) {
    const cells = names.length * VIEWS;
    this.rows = Math.ceil(cells / ATLAS_COLS);
    const W = CELL * ATLAS_COLS, H = CELL * this.rows;
    const mk = () => new THREE.WebGLRenderTarget(W, H, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
    this.colorRT = mk();
    this.maskRT = mk();
    this.cells = new Map();

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.0);
    scene.add(sun);
    const holder = new THREE.Group();
    scene.add(holder);
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);

    const prevTarget = renderer.getRenderTarget();
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    const prevShadow = renderer.shadowMap.enabled;
    const prevTime = wind.uTime.value;
    wind.uTime.value = 0;
    renderer.shadowMap.enabled = false;
    renderer.setClearColor(0x000000, 0);
    for (const rt of [this.colorRT, this.maskRT]) {
      renderer.setRenderTarget(rt);
      renderer.clear();
    }

    const white = new THREE.Color(1, 1, 1);
    names.forEach((name, i) => {
      const c = info(name);
      const box = c.box;
      // Widest reach around the trunk, so every view fits the same frame.
      const reach = Math.max(...[box.min.x, box.max.x].flatMap((x) => [box.min.z, box.max.z].map((z) => Math.hypot(x, z)))) * 1.02;
      const w = reach * 2;
      const h = box.max.y * 1.02;
      this.cells.set(name, { base: i * VIEWS, w, h });

      const passes = [
        { rt: this.colorRT, mat: (p) => p.material },
        { rt: this.maskRT, mat: (p) => maskMaterial(p.material, p.tintable) },
      ];
      for (const pass of passes) {
        holder.clear();
        for (const p of c.parts) {
          const mesh = new THREE.InstancedMesh(p.geometry, pass.mat(p), 1);
          mesh.setMatrixAt(0, p.matrix);
          if (p.tintable) mesh.setColorAt(0, white);
          holder.add(mesh);
        }
        for (let v = 0; v < VIEWS; v++) {
          const a = (v / VIEWS) * Math.PI * 2;
          cam.left = -w / 2;
          cam.right = w / 2;
          cam.bottom = -h / 2;
          cam.top = h / 2;
          cam.position.set(Math.sin(a) * 80, h / 2, Math.cos(a) * 80);
          cam.lookAt(0, h / 2, 0);
          cam.updateProjectionMatrix();
          // Light from the viewer's side and above, so every view is lit the same way.
          sun.position.set(Math.sin(a + 0.5) * 40, 50, Math.cos(a + 0.5) * 40);

          const cell = i * VIEWS + v;
          const px = (cell % ATLAS_COLS) * CELL, py = Math.floor(cell / ATLAS_COLS) * CELL;
          pass.rt.viewport.set(px, py, CELL, CELL);
          pass.rt.scissor.set(px, py, CELL, CELL);
          pass.rt.scissorTest = true;
          renderer.setRenderTarget(pass.rt);
          renderer.render(scene, cam);
          pass.rt.scissorTest = false;
        }
      }
    });
    holder.clear();

    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    renderer.shadowMap.enabled = prevShadow;
    wind.uTime.value = prevTime;
  }

  // Re-sort trees into near (full mesh) and far (cutout). A margin stops trees flicking back and forth.
  update(camPos, force = false) {
    if (!force && camPos.distanceToSquared(this.last) < 16) return;
    this.last.copy(camPos);
    const inR = this.lodDist, outR = this.lodDist + 12;
    const near = [];
    for (const t of this.trees) {
      t.d2 = (t.x - camPos.x) ** 2 + (t.z - camPos.z) ** 2;
      const limit = t.near ? outR : inR;
      t.near = false;
      if (t.d2 < limit * limit) near.push(t);
    }
    if (near.length > this.maxNear) near.sort((a, b) => a.d2 - b.d2).length = this.maxNear;
    for (const t of near) t.near = true;

    for (const g of this.groups.values()) g.n = 0;
    let f = 0;
    for (const t of this.trees) {
      if (t.near) {
        const g = this.groups.get(t.name);
        g.parts.forEach(({ p, mesh }, pi) => {
          mesh.setMatrixAt(g.n, t.partM[pi]);
          if (p.tintable) mesh.setColorAt(g.n, t.tint);
        });
        g.n++;
      } else {
        const cell = this.cells.get(t.name);
        this.impostors.setMatrixAt(f, t.m);
        this.impostors.setColorAt(f, t.tint);
        this.aBase.setX(f, cell.base);
        this.aSize.setXY(f, cell.w, cell.h);
        f++;
      }
    }
    for (const g of this.groups.values()) {
      for (const { mesh } of g.parts) {
        mesh.count = g.n;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }
    this.impostors.count = f;
    this.impostors.instanceMatrix.needsUpdate = true;
    this.impostors.instanceColor.needsUpdate = true;
    this.aBase.needsUpdate = true;
    this.aSize.needsUpdate = true;
  }

  setLight(env) {
    const n = env.night;
    this.impostorMat.uniforms.uLight.value.setRGB(1, 1, 1).lerp(new THREE.Color(0.22, 0.2, 0.36), n);
  }
}
