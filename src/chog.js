import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { MeshoptSimplifier } from 'three/addons/libs/meshopt_simplifier.module.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { lookFor, personalityFor, CLIPS, CLIP_FALLBACK, CLIP_RATE, ATTACH, MOODS } from './traitmap.js';
import { createGait, canGait, CAST_STYLE } from './gait.js';

/*
 * A Chog in the world. Its rigged model (with its head item, outfit and accessory, per traitmap.js)
 * loads once it has arrived in public/models/. Until then the Chog stands in as a standee: a card
 * of its official art on a little stand, turned to face you, that bobs, hops and leans to act out the
 * same moves. Either way the world drives it the same way: play('idle' | 'walk' | 'run' | 'wave' |
 * 'talk' | 'sing' | 'sniff' | 'cheer' | 'sleep' | 'wake' | 'sad'), update(dt, camera), setGrey(k) for the
 * sold-and-gone grey-out (it drains from the feet up), and dispose().
 */

const BASE = import.meta.env.BASE_URL;
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

/*
 * The cast's textures are KTX2 (A14): they stay compressed on the GPU, so a 2048 colour map costs less
 * than the old 1024 JPEG did. The transcoder (public/basis/) needs the renderer to know which formats the
 * GPU takes: main.js hands it over with setChogRenderer before anything loads; a tool page without one gets
 * a throwaway renderer for the check. withKtx2(loader) lets another GLTFLoader read the cast's files.
 */
const ktx2 = new KTX2Loader().setTranscoderPath(`${BASE}basis/`);
let ktxReady = false;
export function setChogRenderer(renderer) {
  if (ktxReady) return;
  ktx2.detectSupport(renderer);
  ktxReady = true;
}
function ensureKtx() {
  if (ktxReady) return;
  const r = new THREE.WebGLRenderer();
  setChogRenderer(r);
  r.dispose();
}
export function withKtx2(gltfLoader) {
  ensureKtx();
  return gltfLoader.setKTX2Loader(ktx2);
}
loader.setKTX2Loader(ktx2);
const gltfs = new Map();
// Each file is fetched and put on the GPU once. keep < 1 also gives it a lighter index (that share of the
// triangles) for Chogs seen from a distance; their copies drop the finer maps (see makeChog).
const loadGltf = (url, keep = 1) => {
  ensureKtx();
  if (!gltfs.has(url)) gltfs.set(url, loader.loadAsync(BASE + url).then(slim));
  return keep < 1 ? gltfs.get(url).then((g) => lighten(g, keep)) : gltfs.get(url);
};

/*
 * Fewer triangles for a model seen from afar: meshoptimizer collapses edges where it changes the shape
 * least, writing a second index buffer over the same vertices, so the skinning still holds. Each Chog
 * swaps between the two by its distance from the camera (see LOD_NEAR).
 */
async function lighten(gltf, keep) {
  await MeshoptSimplifier.ready;
  gltf.scene.traverse((o) => {
    const g = o.geometry;
    if (!o.isMesh || !g.index || !(g.attributes.position.array instanceof Float32Array) || g.attributes.position.isInterleavedBufferAttribute) return;
    if (g.userData.lightKeep === keep) return;
    g.userData.lightKeep = keep;
    const src = g.index.array instanceof Uint32Array ? g.index.array : new Uint32Array(g.index.array);
    const target = Math.floor((src.length * keep) / 3) * 3;
    const [dst] = MeshoptSimplifier.simplify(src, g.attributes.position.array, 3, target, 0.02, []);
    g.userData.lightIndex = new THREE.BufferAttribute(dst, 1);
  });
  return gltf;
}

/*
 * Fit a model for the laptop: its textures down to 1024 px (a compressed texture is already sized for
 * the GPU). Done once per file; every copy shares the result. The light look (a Chog seen from a way off)
 * drops the normal and roughness maps on its own copy of the material (lightLook), which
 * barely show at that distance and cost fill; the full look (your own Chog, the bar's) keeps them, for
 * the metal of a crown or a pair of glasses.
 */
const SLIM_PX = 1024;
function shrink(tex) {
  const img = tex?.image;
  if (!img || tex.isCompressedTexture || Math.max(img.width, img.height) <= SLIM_PX) return tex;
  const c = document.createElement('canvas');
  const k = SLIM_PX / Math.max(img.width, img.height);
  c.width = Math.round(img.width * k);
  c.height = Math.round(img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const t = new THREE.CanvasTexture(c);
  for (const key of ['flipY', 'colorSpace', 'wrapS', 'wrapT', 'channel']) t[key] = tex[key];
  t.anisotropy = 4;
  tex.dispose();
  return t;
}
function slim(gltf) {
  const done = new Set();
  const shrunk = new Map();
  const once = (t) => {
    if (!t) return t;
    if (!shrunk.has(t)) shrunk.set(t, shrink(t));
    return shrunk.get(t);
  };
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.material)) {
      if (done.has(m)) continue;
      done.add(m);
      for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) m[key] = once(m[key]);
      m.needsUpdate = true;
    }
  });
  return gltf;
}

// The light look, on a Chog's own copy of its material: no normal, roughness or metal maps.
function lightLook(m) {
  for (const key of ['normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) m[key] = null;
  if (m.isMeshStandardMaterial) {
    m.roughness = 0.75;
    m.metalness = 0;
  }
}

/*
 * What every Chog model's shader adds: the sold-and-gone grey that drains up its body from the feet
 * (uGrey, 0 to 1, by height through its bind pose), and a dither dissolve for walking in and off (uFade,
 * 1 solid to 0 gone), the same as the standee's. Built in from the start, so neither ever rebuilds a
 * shader when it plays.
 */
function chogShader(material, geometry, fx, face, faceOn) {
  geometry.computeBoundingBox();
  const range = { value: new THREE.Vector2(geometry.boundingBox.min.y, geometry.boundingBox.max.y) };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGrey = fx.uGrey;
    shader.uniforms.uFade = fx.uFade;
    shader.uniforms.uCut = fx.uCut;
    shader.uniforms.uYRange = range;
    Object.assign(shader.uniforms, face, { uFaceOn: faceOn });
    shader.vertexShader =
      'varying float vChogY;\nvarying vec3 vChogP;\nvarying vec3 vFaceP;\nvarying float vFaceW;\nuniform mat4 uFaceM;\nuniform vec3 uFaceDir;\nuniform float uFaceHead;\n' +
      shader.vertexShader.replace(
        '#include <skinning_vertex>',
        `#include <skinning_vertex>
  vChogY = transformed.y;
  vChogP = transformed;
  vFaceP = vec3((uFaceM * vec4(position, 1.0)).xy, dot(normal, uFaceDir));
  #ifdef USE_SKINNING
    vFaceW = dot(skinWeight, vec4(equal(skinIndex, vec4(uFaceHead))));
  #else
    vFaceW = 0.0;
  #endif`,
      );
    shader.fragmentShader =
      'uniform float uGrey;\nuniform float uFade;\nuniform vec2 uCut;\nuniform vec2 uYRange;\nvarying float vChogY;\nvarying vec3 vChogP;\nuniform sampler2D uFace;\nuniform float uFaceOn;\nuniform float uEye;\nuniform float uMouth;\nvarying vec3 vFaceP;\nvarying float vFaceW;\n' +
      shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
  // Beaming (a portal): a cut that rises from the feet (uCut.y 1) or falls from the head (-1), with a
  // glowing edge (added as light below).
  float cutEdge = 0.0;
  if (uCut.y != 0.0) {
    float hn = (vChogY - uYRange.x) / max(uYRange.y - uYRange.x, 1e-4);
    float jag = fract(sin(dot(floor(vChogP * 22.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453) * 0.06;
    float dd = (hn + jag - uCut.x) * uCut.y;
    if (dd < 0.0) discard;
    cutEdge = 1.0 - smoothstep(0.0, 0.06, dd);
  }
  {
    // The face: this Chog's eye and mouth states laid over its painted face (see FACES).
    vec2 fp = vFaceP.xy;
    vec4 fe = texture2D(uFace, vec2((uEye + clamp(fp.x, 0.0, 1.0)) / 6.0, 0.5 + clamp(fp.y, 0.0, 1.0) * 0.5));
    vec4 fm = texture2D(uFace, vec2((uMouth + clamp(fp.x, 0.0, 1.0)) / 6.0, clamp(fp.y, 0.0, 1.0) * 0.5));
    float inside = step(0.0, fp.x) * step(fp.x, 1.0) * step(0.0, fp.y) * step(fp.y, 1.0);
    float k = uFaceOn * inside * smoothstep(0.35, 0.6, vFaceW) * smoothstep(0.08, 0.3, vFaceP.z);
    diffuseColor.rgb = mix(diffuseColor.rgb, fe.rgb * diffuse, fe.a * k);
    diffuseColor.rgb = mix(diffuseColor.rgb, fm.rgb * diffuse, fm.a * k);
  }
  {
    float h = (vChogY - uYRange.x) / max(uYRange.y - uYRange.x, 1e-4);
    float drained = max(smoothstep(uGrey * 1.1 - 0.05, uGrey * 1.1 - 0.12, h), step(0.999, uGrey));
    float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lum * 0.7 + 0.1), drained);
    if (uFade < 0.999 && fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) > uFade) discard;
  }`,
      ).replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += vec3(0.55, 0.95, 1.0) * cutEdge * 3.0;');
  };
  material.customProgramCacheKey = () => 'chog-model-3';
}

/*
 * Faces (public/faces/, built by tools/faces/ from a front capture of each model): an expression sheet of
 * six eye states over six mouth states, and how the model's own vertices map onto it. Eyes blink on their
 * own, moods change the face, and the mouth moves while a Chog talks or sings.
 */
const EYES = { rest: 0, blink: 1, happy: 2, surprised: 3, sad: 4, cross: 5 };
const MOUTHS = { rest: 0, smile: 1, o: 2, frown: 3, talk1: 4, talk2: 5 };
// Each mood (from chats and the world) as [eyes, mouth].
const EXPRESSIONS = {
  calm: ['rest', 'rest'],
  happy: ['happy', 'smile'],
  excited: ['surprised', 'smile'],
  surprised: ['surprised', 'o'],
  curious: ['rest', 'o'],
  sad: ['sad', 'frown'],
  cross: ['cross', 'frown'],
  sleepy: ['blink', 'rest'],
};
// What a move does to the face while it plays.
const MOVE_FACE = { cheer: 'happy', wave: 'happy', sad: 'sad', sleepy: 'sleepy', sleep: 'sleepy', wake: 'sleepy' };
let faceManifest = null;
const faceSheets = new Map();
const noFace = new THREE.DataTexture(new Uint8Array(4), 1, 1);
noFace.needsUpdate = true;
function faceFor(url) {
  const key = url?.match(/npcs\/([\w-]+)\.glb$/)?.[1];
  if (!key) return Promise.resolve(null);
  faceManifest ??= fetch(`${BASE}faces/faces.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  return faceManifest
    .then((all) => {
      const f = all[key];
      if (!f) return null;
      if (!faceSheets.has(key)) {
        // KTX2 (stored upside down, as a PNG would load), or the PNG if a sheet has no KTX2 yet.
        ensureKtx();
        faceSheets.set(key, ktx2.loadAsync(`${BASE}faces/${key}.ktx2`).catch(() => textures.loadAsync(`${BASE}faces/${key}.png`)).then((t) => {
          t.colorSpace = THREE.SRGBColorSpace;
          t.anisotropy = 4;
          return t;
        }));
      }
      return faceSheets.get(key).then((tex) => ({ ...f, tex }));
    })
    .catch(() => null);
}

/*
 * A model's soles, once per file: a few vertices that follow each foot (the lowest, and the front, back and
 * sides of that flat), so the world can keep its feet out of the ground whatever a clip does with the hips.
 */
function soleVertices(gltf) {
  let mesh = null;
  gltf.scene.traverse((o) => o.isSkinnedMesh && (!mesh || o.geometry.attributes.position.count > mesh.geometry.attributes.position.count) && (mesh = o));
  if (!mesh) return [];
  gltf.scene.updateMatrixWorld(true);
  const pos = mesh.geometry.attributes.position, si = mesh.geometry.attributes.skinIndex, sw = mesh.geometry.attributes.skinWeight;
  const names = mesh.skeleton.bones.map((b) => b.name);
  const out = [];
  const v = new THREE.Vector3();
  for (const foot of ['FootL', 'FootR'].map((n) => names.indexOf(n)).filter((i) => i >= 0)) {
    const near = [];
    let lo = Infinity;
    for (let i = 0; i < pos.count; i++) {
      let w = 0;
      for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === foot) w += sw.getComponent(i, k);
      if (w < 0.6) continue;
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.bindMatrix);
      near.push([i, v.x, v.y, v.z]);
      lo = Math.min(lo, v.y);
    }
    const flat = near.filter((n) => n[2] < lo + 0.03);
    if (!flat.length) continue;
    const pick = (f) => flat.reduce((a, b) => (f(b) > f(a) ? b : a))[0];
    out.push(...new Set([pick((n) => -n[2]), pick((n) => n[3]), pick((n) => -n[3]), pick((n) => n[1]), pick((n) => -n[1])]));
  }
  return out;
}

/*
 * The mouth, in the Head bone's frame, from where the mouth sits on the model's face sheet: the front-most
 * head vertices there (for a mic to be held to it).
 */
function mouthOf(gltf, f) {
  let mesh = null;
  gltf.scene.traverse((o) => o.isSkinnedMesh && (!mesh || o.geometry.attributes.position.count > mesh.geometry.attributes.position.count) && (mesh = o));
  if (!mesh || !(f.head >= 0)) return null;
  gltf.scene.updateMatrixWorld(true);
  const g = mesh.geometry, pos = g.attributes.position, nrm = g.attributes.normal, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
  const m = new THREE.Matrix4().fromArray(f.matrix), dir = new THREE.Vector3().fromArray(f.dir);
  const v = new THREE.Vector3(), n = new THREE.Vector3(), sum = new THREE.Vector3();
  let count = 0;
  for (let tol = 0.02; tol < 0.1 && !count; tol *= 1.6) {
    for (let i = 0; i < pos.count; i++) {
      let w = 0;
      for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === f.head) w += sw.getComponent(i, k);
      if (w < 0.8 || n.fromBufferAttribute(nrm, i).dot(dir) < 0.5) continue;
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      if (Math.abs(v.x - MOUTH_ON_SHEET[0]) > tol || Math.abs(v.y - MOUTH_ON_SHEET[1]) > tol) continue;
      sum.add(v.fromBufferAttribute(pos, i));
      count++;
    }
  }
  if (!count) return null;
  return sum.divideScalar(count).applyMatrix4(mesh.bindMatrix).applyMatrix4(mesh.skeleton.boneInverses[f.head]);
}

/*
 * Some models came out of auto-rigging with a hand bent back at the wrist (the bartender's left). For each
 * hand: how far it bends away from the line of its forearm in the bind pose, and the turn of its bone
 * that straightens it. handBends(gltf) -> [{ bone, degrees, fix }].
 */
const HAND_FIX_ABOVE = Infinity;
export function handBends(gltf) {
  let mesh = null;
  gltf.scene.traverse((o) => o.isSkinnedMesh && (!mesh || o.geometry.attributes.position.count > mesh.geometry.attributes.position.count) && (mesh = o));
  if (!mesh) return [];
  gltf.scene.updateMatrixWorld(true);
  const out = [];
  const pos = mesh.geometry.attributes.position, si = mesh.geometry.attributes.skinIndex, sw = mesh.geometry.attributes.skinWeight;
  const v = new THREE.Vector3();
  for (const [hand, arm] of [['HandL', 'ForeArmL'], ['HandR', 'ForeArmR']]) {
    const hb = mesh.skeleton.bones.find((b) => b.name === hand), ab = mesh.skeleton.bones.find((b) => b.name === arm);
    if (!hb || !ab) continue;
    const hi = mesh.skeleton.bones.indexOf(hb);
    const c = new THREE.Vector3();
    let n = 0;
    for (let i = 0; i < pos.count; i++) {
      let w = 0;
      for (let j = 0; j < 4; j++) if (si.getComponent(i, j) === hi) w += sw.getComponent(i, j);
      if (w < 0.7) continue;
      c.add(v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld));
      n++;
    }
    if (n < 10) continue;
    c.divideScalar(n);
    const hp = hb.getWorldPosition(new THREE.Vector3()), ap = ab.getWorldPosition(new THREE.Vector3());
    const dHand = c.sub(hp).normalize(), dArm = hp.clone().sub(ap).normalize();
    const degrees = THREE.MathUtils.radToDeg(dHand.angleTo(dArm));
    const world = new THREE.Quaternion().setFromUnitVectors(dHand, dArm);
    world.slerp(new THREE.Quaternion(), 0.15);
    const bq = hb.getWorldQuaternion(new THREE.Quaternion());
    const fix = bq.clone().invert().multiply(world).multiply(bq);
    out.push({ bone: hand, degrees, fix });
  }
  return out;
}

/*
 * How fast a walk or run clip carries a Chog, in metres a second at scale 1: how fast a foot slides back
 * under the body while it's planted. Moving a Chog at this speed (times its scale) keeps its feet
 * from sliding. Measured once per file and clip.
 */
export function clipSpeed(gltf, clipName) {
  gltf.userData.speeds ??= {};
  if (clipName in gltf.userData.speeds) return gltf.userData.speeds[clipName];
  const clip = THREE.AnimationClip.findByName(gltf.animations, clipName);
  let speed = 0;
  if (clip) {
    const rig = cloneSkinned(gltf.scene);
    const mixer = new THREE.AnimationMixer(rig);
    mixer.clipAction(clip).play();
    const feet = ['FootL', 'FootR'].map((n) => rig.getObjectByName(n)).filter(Boolean);
    const p = new THREE.Vector3();
    const N = 60;
    let best = 0;
    for (const foot of feet) {
      const zs = [], ys = [];
      for (let i = 0; i <= N; i++) {
        mixer.setTime((i / N) * clip.duration);
        rig.updateMatrixWorld(true);
        foot.getWorldPosition(p);
        zs.push(p.z);
        ys.push(p.y);
      }
      // While a foot is planted it slides back under the body at the body's own speed: its speed in
      // the lowest third of its swing is the walking speed.
      const y0 = Math.min(...ys), y1 = Math.max(...ys);
      const low = y0 + (y1 - y0) * 0.33;
      let dist = 0, n = 0;
      for (let i = 1; i <= N; i++) if (ys[i] <= low && ys[i - 1] <= low) (dist += Math.abs(zs[i] - zs[i - 1])), n++;
      if (n >= 3) best = Math.max(best, dist / ((n / N) * clip.duration));
    }
    speed = best;
  }
  gltf.userData.speeds[clipName] = speed;
  return speed;
}

/*
 * The same for the picked cartoon clips, whose feet roll heel to toe instead of sitting flat (so "the
 * lowest third of the swing" misses most of each step): each foot's backward sweep under the body, over the
 * time it spends sweeping back. Both feet averaged. Measured once per file and clip.
 */
export function sweepSpeed(gltf, clipName) {
  gltf.userData.sweeps ??= {};
  if (clipName in gltf.userData.sweeps) return gltf.userData.sweeps[clipName];
  const clip = THREE.AnimationClip.findByName(gltf.animations, clipName);
  let speed = 0;
  if (clip) {
    const rig = cloneSkinned(gltf.scene);
    const mixer = new THREE.AnimationMixer(rig);
    mixer.clipAction(clip).play();
    const feet = ['FootL', 'FootR'].map((n) => rig.getObjectByName(n)).filter(Boolean);
    const p = new THREE.Vector3();
    const N = 120;
    const dt = clip.duration / N;
    const speeds = [];
    for (const foot of feet) {
      let back = 0, n = 0, prev = null;
      for (let i = 0; i <= N; i++) {
        mixer.setTime(i * dt);
        rig.updateMatrixWorld(true);
        const z = foot.getWorldPosition(p).z;
        if (prev !== null && z < prev) (back += prev - z), n++;
        prev = z;
      }
      if (n >= 3) speeds.push(back / (n * dt));
    }
    if (speeds.length) speed = speeds.reduce((a, b) => a + b, 0) / speeds.length;
  }
  gltf.userData.sweeps[clipName] = speed;
  return speed;
}

// Heads turn toward the camera (or whatever a Chog is told to look at) when it's near and in front.
const LOOK_RANGE = 18;
const LOOK_MAX = THREE.MathUtils.degToRad(55);
// Upper arms lift no higher than this over level: above it Tripo's shoulders fold into the body (the user,
// 10-17: "their side goes into their body upon wave"). A hand still goes up, by the elbow.
const ARM_LIFT_MAX = THREE.MathUtils.degToRad(+(new URLSearchParams(globalThis.location?.search ?? '').get('armlift') ?? 30));
// Chog arms are short tubes with no elbow to speak of (the user, 10-17): a forearm bends no further than
// this from the line of its upper arm.
const ELBOW_MAX = THREE.MathUtils.degToRad(28);
// How much further the legs swing than the clip has them, walking and running (strideUpdate; the user, 10-17:
// "walking speed is way too slow": a Chog's legs are short for its height).
const STRIDE = { walk: 1.35, run: 1.3 };
// How much of the clip's body motion (spine to head) is kept, walking and running.
const TORSO = { walk: 0.6, run: 0.4 };
// The wave (waveUpdate): the right arm out and up from the shoulder, swinging, the hand rocking.
const WAVE = { lift: 0.5, swing: 0.2, forward: 0.45, hz: 1.6, rock: 0.4 };
// Moves melt into each other over this long, their weights always adding up to one: a sum under one blends
// toward the bind pose, the T-pose a quick change of mind used to flash (the user, 10-17).
const FADE = 0.3;
// The mic's head this far in front of the lips while singing (model units).
const MIC_GAP = 0.085;
// The mic's head along its own axis from its grip (tools/models/fix/singer_rebuild.mjs: 0.14 x 1.5).
const MIC_HEAD = 0.21;
// Where the mouth sits on a face sheet (tools/faces: a front capture, the mouth a little under the eyes).
const MOUTH_ON_SHEET = [0.5, 0.39];
// Up close a Chog is its full model; past this it's the lighter copy (for Chogs loaded with keep < 1).
const LOD_NEAR = 24;
// Bodies move by src/gait.js (walks, rest, gestures) for every Chog in the standard rig but the singer,
// whose file is posed round its mic and keeps its own clips. Past GAIT_FAR they move a third as often.
const GAIT_SKIP = /singer/;
const GAIT_FAR = 45;
// Moves the gait does itself (the rest play their clip, or the nearest it has).
const GAIT_MOVES = { idle: 'idle', walk: 'walk', run: 'walk', wave: 'wave', talk: 'talk', cheer: 'cheer', sing: 'cheer', sad: 'sad', sleepy: 'sleepy', sleep: 'sleepy', wake: 'wave', sniff: 'talk' };
// The procedural body (src/gait.js) is off: the user turned down its walk. The cast's clips are retargeted
// from the Quaternius animation libraries (CC0) instead (tools/models/retarget.js, bake.html, addclips.mjs).
const USE_GAIT = false;
const GAIT_WALKS = false;
// Switching between the gait and a clip, the old pose melts into the new over this long.
const BLEND = 0.25;
const _hp = new THREE.Vector3();
const _to = new THREE.Vector3();
const _bf = new THREE.Vector3();
const _cur = new THREE.Vector3();
const _lim = new THREE.Vector3();
const _rq = new THREE.Quaternion();
const _hq = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
const _dq = new THREE.Quaternion();
const _iq = new THREE.Quaternion();
const _sh = new THREE.Vector3();
const _el = new THREE.Vector3();
const _wr = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _side = new THREE.Vector3();
const _mo = new THREE.Vector3();
const _gl = new THREE.Vector3();
const _ax = new THREE.Vector3();
const _off = new THREE.Vector3();
const _tg = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _qh = new THREE.Quaternion();
const _qt = new THREE.Quaternion();

// A model has fewer moves than a standee: these borrow the nearest it has.
const STAND_IN = { sniff: 'talk', sing: 'cheer', wake: 'wave', sleepy: 'idle', sad: 'idle' };
const textures = new THREE.TextureLoader().setCrossOrigin('anonymous');
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

// How tall a Chog stands, in metres: fits its home's door with room to spare.
export const CHOG_HEIGHT = 2.2;

// The standee's card: the art in a rounded frame, drained to grey up to uGrey's height.
function cardMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uMap: { value: null }, uGrey: { value: 0 }, uLoaded: { value: 0 }, uFade: { value: 1 }, uFrame: { value: new THREE.Color('#fff6e8') } },
    side: THREE.DoubleSide,
    transparent: true,
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
uniform sampler2D uMap; uniform float uGrey, uLoaded, uFade; uniform vec3 uFrame;
varying vec2 vUv;
float box(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
void main() {
  vec2 p = vUv - 0.5;
  float outer = box(p, vec2(0.5), 0.09);
  if (outer > 0.0) discard;
  float inner = box(p, vec2(0.455), 0.07);
  vec3 art = mix(vec3(0.42, 0.34, 0.6), texture2D(uMap, (vUv - 0.045) / 0.91).rgb, uLoaded);
  vec3 col = inner < 0.0 ? art : uFrame;
  // Colour drains from the bottom up as uGrey rises.
  float drained = smoothstep(uGrey * 1.1 - 0.05, uGrey * 1.1 - 0.12, vUv.y);
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, vec3(lum * 0.7 + 0.1), max(drained, step(0.999, uGrey)));
  if (uFade < 0.999 && fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) > uFade) discard;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`,
  });
}

// Load the art from the first copy that answers. A copy that fails hands over to the next at once; one
// that's slow gets a few seconds before the next is asked as well, and whichever arrives first wins.
// Resolves to the texture, or null if none could be loaded.
function loadArt(urls, patience = 7000) {
  return new Promise((resolve) => {
    let done = false;
    let next = 0;
    let pending = 0;
    let timer = 0;
    const finish = (t) => {
      if (done) return t?.dispose();
      done = true;
      clearTimeout(timer);
      resolve(t);
    };
    const ask = () => {
      clearTimeout(timer);
      if (done) return;
      if (next >= urls.length) return void (pending || finish(null));
      pending++;
      textures.load(
        urls[next++],
        (t) => {
          pending--;
          t.colorSpace = THREE.SRGBColorSpace;
          finish(t);
        },
        undefined,
        () => {
          pending--;
          ask();
        },
      );
      timer = setTimeout(ask, patience);
    };
    ask();
    // Give up in the end, so nothing waits on it forever.
    setTimeout(() => finish(null), urls.length * patience + 8000);
  });
}

// Until the art is in (or if it can't be had), the card says who it is rather than staying blank.
function nameCard(name) {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, '#b89cff');
  grad.addColorStop(1, '#7a52c8');
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 512);
  g.fillStyle = '#fff8ee';
  g.textAlign = 'center';
  g.font = '600 64px Fredoka, sans-serif';
  g.fillText('Chog', 256, 230);
  g.font = '700 104px Fredoka, sans-serif';
  g.fillText(name.replace(/^Chog\s*/, ''), 256, 340);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function standee(images, name) {
  const mat = cardMaterial();
  const named = nameCard(name);
  mat.uniforms.uMap.value = named;
  mat.uniforms.uLoaded.value = 1;
  // Resolves true once the art is in (it replaces the name), false if it couldn't load.
  const ready = loadArt(images).then((t) => {
    if (!t) return false;
    t.anisotropy = 4;
    mat.uniforms.uMap.value = t;
    named.dispose();
    return true;
  });
  const size = CHOG_HEIGHT - 0.35;
  const card = new THREE.Mesh(new THREE.PlaneGeometry(size, size).translate(0, size / 2, 0), mat);
  card.position.y = 0.35;
  // Turn to face the camera first, then lean: leans stay in the card's own plane.
  card.rotation.order = 'YXZ';
  const stand = new THREE.Mesh(
    new THREE.CylinderGeometry(0.42, 0.5, 0.14, 24).translate(0, 0.07, 0),
    new THREE.MeshStandardMaterial({ color: '#e8dcc6', roughness: 0.6 }),
  );
  stand.add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.4, 8).translate(0, 0.3, 0), stand.material));
  stand.castShadow = true;
  card.castShadow = true;
  // The card turns to face the camera on its own; this group carries the moves.
  const body = new THREE.Group();
  body.add(card, stand);
  return { body, card, stand, mat, ready };
}

// A mood badge over the head: a round tag with the mood's glyph, drawn once per mood.
const badgeTextures = new Map();
function badgeTexture(mood) {
  if (badgeTextures.has(mood)) return badgeTextures.get(mood);
  const m = MOODS[mood] ?? MOODS.calm;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(30, 18, 52, 0.92)';
  g.beginPath();
  g.arc(64, 60, 50, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.moveTo(52, 104);
  g.lineTo(64, 124);
  g.lineTo(76, 104);
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = m.colour;
  g.beginPath();
  g.arc(64, 60, 47, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = m.colour;
  g.font = '700 58px Fredoka, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(m.badge, 64, 62);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  badgeTextures.set(mood, t);
  return t;
}

/*
 * A shadow on the ground that goes with the Chog (A15). The sun's own shadow map covers the whole
 * archipelago and redraws only when the hour moves, so a walking Chog has none. The user's pick (10-16):
 * 'sun', a soft shadow pushed and stretched away from the sun, longer as it sets, fainter by moonlight.
 * ?chogshadow=round (the same at any hour) or off for comparison. One small quad per Chog, one shader.
 */
const SHADOW_MODE = new URLSearchParams(location.search).get('chogshadow') ?? 'sun';
const shadowUniforms = { uDir: { value: new THREE.Vector2(0, 1) }, uLen: { value: 1 }, uOff: { value: 0 }, uStrength: { value: 0.6 } };
let shadowMat = null;
function groundShadow() {
  shadowMat ??= new THREE.ShaderMaterial({
    uniforms: shadowUniforms,
    transparent: true,
    depthWrite: false,
    // Over the paving even where a Chog's feet sink into it a little (the crowd's do), and over the paving's
    // own offset.
    polygonOffset: true,
    polygonOffsetFactor: -8,
    polygonOffsetUnits: -40,
    vertexShader: `
uniform vec2 uDir; uniform float uLen, uOff;
varying vec2 vRel;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec3 c = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float s = length(modelMatrix[0].xyz);
  // Into the shadow's own frame: along the light, then across it, in the Chog's own size.
  vec2 rel = (wp.xz - c.xz) / max(s, 1e-4);
  vRel = vec2(dot(rel, uDir) - uOff, dot(rel, vec2(-uDir.y, uDir.x)));
  gl_Position = projectionMatrix * viewMatrix * wp;
}`,
    fragmentShader: `
uniform float uLen, uStrength;
varying vec2 vRel;
void main() {
  vec2 e = vRel / vec2(0.62 * uLen, 0.62);
  float d = dot(e, e);
  float a = uStrength * (exp(-d * 2.2) - 0.01 * d) * (1.0 - smoothstep(0.75, 1.0, d));
  if (a <= 0.003) discard;
  gl_FragColor = vec4(0.12, 0.07, 0.2, a);
}`,
  });
  // Big enough for the longest evening shadow in any direction (Chog units: 2.2 m tall).
  const m = new THREE.Mesh(new THREE.PlaneGeometry(5, 5).rotateX(-Math.PI / 2).translate(0, 0.07, 0), shadowMat);
  m.renderOrder = 1;
  m.frustumCulled = false;
  return m;
}
/** Where the light comes from this frame, for the 'sun' shadows: the sun (or moon) light and the night. */
export function setChogSun(light, night = 0) {
  if (SHADOW_MODE !== 'sun' || !light) return;
  const d = light.position.clone().sub(light.target.position).normalize();
  const flat = Math.hypot(d.x, d.z);
  if (flat > 1e-4) shadowUniforms.uDir.value.set(-d.x / flat, -d.z / flat);
  const elev = Math.max(0.05, Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)));
  const len = THREE.MathUtils.clamp(1 + 0.45 / Math.tan(elev), 1, 2.4);
  shadowUniforms.uLen.value = len;
  shadowUniforms.uOff.value = (len - 1) * 0.55;
  shadowUniforms.uStrength.value = THREE.MathUtils.lerp(0.6, 0.3, night) * THREE.MathUtils.smoothstep(elev, 0.05, 0.25);
}

// The aura: a soft ring of light at the feet, pulsing gently.
function auraRing(colour, strength) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(colour) }, uTime: { value: 0 }, uStrength: { value: strength } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
uniform vec3 uColor; uniform float uTime, uStrength;
varying vec2 vUv;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float rx = (r - 0.62) * 5.0;
  float ring = exp(-rx * rx) + exp(-r * 3.0) * 0.35;
  float pulse = 0.8 + 0.2 * sin(uTime * 2.4);
  gl_FragColor = vec4(uColor * ring * pulse * uStrength, 1.0);
}`,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6).rotateX(-Math.PI / 2).translate(0, 0.04, 0), mat);
  m.renderOrder = 2;
  return m;
}

/**
 * Build a Chog from its info ({ traits, image }). Resolves once its model (or standee) is ready. model
 * names a Chog's own rigged file (an NPC from public/models/npcs/) in place of the trait-built one;
 * tint shades its colours, so copies of one model look like different Chogs.
 */
export async function makeChog({ traits = {}, image = null, images = image ? [image] : [], name = 'Chog', model: modelUrl = null, tint = null, keep = 1 } = {}) {
  const look = lookFor(traits);
  const base = modelUrl ?? look.base;
  const personality = personalityFor(traits);
  const root = new THREE.Group();
  let mixer = null;
  let model = null;
  const actions = {};
  // The clip each move plays (a picked clip, or the model's own when it lacks one).
  const clipOf = {};
  const tintables = [];
  // A model's grey and dissolve (see chogShader), shared by all its pieces.
  const fx = { uGrey: { value: 0 }, uFade: { value: 1 }, uCut: { value: new THREE.Vector2(0, 0) } };
  // Its face (see FACES): the sheet, how its vertices map onto it, and the current eye and mouth state.
  const face = {
    uFace: { value: noFace },
    uFaceM: { value: new THREE.Matrix4().makeScale(0, 0, 0) },
    uFaceDir: { value: new THREE.Vector3(0, 0, 1) },
    uFaceHead: { value: -1 },
    uEye: { value: 0 },
    uMouth: { value: 0 },
  };
  const faceOn = new Map();
  const lods = [];
  let gaze = null;
  // The right arm, for holding the hand (and what it holds) out toward something.
  let arm = null;
  // Both upper arms, kept from lifting too high (ARM_LIFT_MAX).
  let lifts = [];
  // Thighs and shins, spine to head, with their rest turns and how far each swings from it right now
  // (STRIDE, TORSO).
  const legs = [];
  // The soles (soleVertices) on its biggest skinned mesh.
  let soles = [];
  let skin = null;
  // How much of each move it shows (FADE).
  const fades = new Map();
  let handFix = [];
  let gltfRef = null;
  let gait = null;
  let gaitAcc = 0;
  let gaitTick = 0;
  let driver = null;
  let blendLeft = 0;
  const bones = [];
  const snapQ = [];
  const snapP = [];

  if (base) {
    try {
      const gltf = await loadGltf(base, keep);
      gltfRef = gltf;
      model = cloneSkinned(gltf.scene);
      // The legs and the body at rest (the bind pose), for the stride and the steadier body (strideUpdate).
      for (const [n, k] of [['ThighL', STRIDE], ['ShinL', STRIDE], ['ThighR', STRIDE], ['ShinR', STRIDE], ['Spine', TORSO], ['Chest', TORSO], ['Neck', TORSO], ['Head', TORSO]]) {
        const b = model.getObjectByName(n);
        if (b) legs.push({ b, k, rest: b.quaternion.clone(), d: new THREE.Quaternion(), now: 1 });
      }
      model.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.material = o.material.clone();
        if (keep < 1) lightLook(o.material);
        tintables.push(o);
        if (modelUrl) {
          if (tint) o.material.color.multiply(tint);
        } else if (o.name === 'Skin' || o.material.name === 'Skin') o.material.color.set(look.skin);
        const on = { value: 0 };
        faceOn.set(o, on);
        chogShader(o.material, o.geometry, fx, face, on);
        // A lighter copy to show from afar: the same vertices, fewer triangles.
        const lightIndex = keep < 1 ? o.geometry.userData.lightIndex : null;
        if (lightIndex) {
          const lite = new THREE.BufferGeometry();
          for (const [k, a] of Object.entries(o.geometry.attributes)) lite.setAttribute(k, a);
          lite.setIndex(lightIndex);
          lite.boundingBox = o.geometry.boundingBox;
          o.geometry.computeBoundingSphere();
          lite.boundingSphere = o.geometry.boundingSphere;
          lods.push({ mesh: o, full: o.geometry, lite });
          o.geometry = lite;
        }
      });
      // Separate pieces hang from their bones (a Chog's own model has them built in).
      for (const [slot, url] of modelUrl ? [] : [['head', look.head], ['body', look.body], ['accessory', look.accessory]]) {
        if (!url) continue;
        const piece = cloneSkinned((await loadGltf(url)).scene);
        piece.traverse((o) => {
          if (!o.isMesh) return;
          o.material = o.material.clone();
          tintables.push(o);
          chogShader(o.material, o.geometry, fx, face, { value: 0 });
        });
        (model.getObjectByName(ATTACH[slot]) ?? model).add(piece);
      }
      mixer = new THREE.AnimationMixer(model);
      if (USE_GAIT && canGait(model) && !GAIT_SKIP.test(base)) {
        gait = createGait(model, CAST_STYLE[base.match(/([\w-]+)\.glb$/)?.[1]] ?? 'neutral');
        model.traverse((o) => o.isBone && (bones.push(o), snapQ.push(new THREE.Quaternion()), snapP.push(new THREE.Vector3())));
      }
      for (const [name, clipName] of Object.entries(CLIPS)) {
        const clip = THREE.AnimationClip.findByName(gltf.animations, clipName) ?? THREE.AnimationClip.findByName(gltf.animations, CLIP_FALLBACK[name]);
        if (!clip) continue;
        actions[name] = mixer.clipAction(clip);
        clipOf[name] = clip.name;
      }
      root.add(model);
      // The head, and which way is its face in the head bone's own frame (the model faces +z).
      const head = model.getObjectByName('Head');
      if (head) {
        model.updateMatrixWorld(true);
        const rel = model.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(head.getWorldQuaternion(new THREE.Quaternion()));
        gaze = { head, fwd: new THREE.Vector3(0, 0, 1).applyQuaternion(rel.invert()), dir: new THREE.Vector3(0, 0, 1), w: 0, target: null, base: new THREE.Quaternion(), applied: false };
      }
      const up = model.getObjectByName('UpperArmR'), fore = model.getObjectByName('ForeArmR'), hand = model.getObjectByName('HandR');
      if (up && fore && hand) arm = { up, fore, hand, held: hand.getObjectByName('Mic'), at: new THREE.Vector3(), target: null, left: 0, w: 0, mouth: null, mw: 0, ww: 0, wt: 0 };
      lifts = ['L', 'R'].map((s) => ({ up: model.getObjectByName(`UpperArm${s}`), fore: model.getObjectByName(`ForeArm${s}`) })).filter((l) => l.up && l.fore);
      gltf.userData.soles ??= soleVertices(gltf);
      soles = gltf.userData.soles;
      model.traverse((o) => o.isSkinnedMesh && (!skin || o.geometry.attributes.position.count > skin.geometry.attributes.position.count) && (skin = o));
      // Straighten a hand that came out bent back at the wrist.
      gltf.userData.handBends ??= handBends(gltf);
      handFix = gltf.userData.handBends.filter((h) => h.degrees > HAND_FIX_ABOVE).map((h) => ({ bone: model.getObjectByName(h.bone), fix: h.fix, base: new THREE.Quaternion(), applied: false })).filter((h) => h.bone);
      // Its face, once the sheet is in.
      if (modelUrl) {
        faceFor(modelUrl).then((f) => {
          if (!f) return;
          face.uFace.value = f.tex;
          face.uFaceM.value.fromArray(f.matrix);
          face.uFaceDir.value.fromArray(f.dir);
          face.uFaceHead.value = f.head;
          if (arm?.held) arm.mouth = gltf.userData.mouth ??= mouthOf(gltf, f);
          for (const [o, on] of faceOn) if (o.name === f.mesh) on.value = 1;
        });
      }
    } catch (err) {
      console.warn('Chog model unavailable, using its standee:', err?.message ?? err);
      model = null;
    }
  }
  const stand = model ? null : standee(images, name);
  if (stand) root.add(stand.body);
  let aura = null;
  if (look.aura) {
    aura = auraRing(look.aura, look.glow);
    root.add(aura);
  }
  if (SHADOW_MODE === 'round' || SHADOW_MODE === 'sun') root.add(groundShadow());
  // The mood badge pops up over the head when the Chog reacts to something said.
  const badge = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false }));
  badge.scale.setScalar(0.62);
  badge.position.y = CHOG_HEIGHT + 0.45;
  badge.renderOrder = 6;
  badge.visible = false;
  root.add(badge);
  let moodT = 0;
  let moodLeft = 0;
  let resumeAct = 'idle';

  const centre = new THREE.Vector3();

  // Empty until the first play('idle') below, which would otherwise see 'idle' already and play nothing.
  let state = '';
  let stateT = 0;
  let current = null;
  // The face: a held expression, blinks, and the mouth while talking.
  let expr = 'calm';
  let exprLeft = 0;
  let blinkIn = 1 + Math.random() * 3;
  let blinking = 0;
  let talkLeft = 0;
  let flapIn = 0;
  let mouthNow = 'rest';
  let t = Math.random() * 10;
  const speed = personality.idleSpeed;
  const toCam = new THREE.Vector3();

  const chog = {
    root,
    traits,
    look,
    personality,
    // Its own rigged model (true), or the standee of its art if the model couldn't be had.
    isModel: !!model,
    // Resolves true once it can be shown as itself: its model, or its standee's art.
    ready: stand ? stand.ready : Promise.resolve(true),
    get state() {
      return state;
    },
    play(name) {
      if (name === state) return;
      state = name;
      stateT = 0;
      // Holding a mic, it sings with its talk's body and the mic held to its mouth (micUpdate).
      const pick = name === 'sing' && arm?.held && actions.talk ? 'talk' : name;
      const next = actions[pick] ?? actions[STAND_IN[name]] ?? (name === 'sleep' ? null : actions.idle);
      if (next && next !== current) {
        // A move coming back before it had faded away carries on from where it was; one from nothing starts
        // at its top. The weights are set each frame (fadeUpdate).
        if (!(fades.get(next) > 0.02)) next.reset();
        next.play();
        if (!fades.has(next)) fades.set(next, 0);
        current = next;
      }
    },
    /**
     * React to a mood from a chat: the mood's move for a few seconds, its badge over the head, and
     * for a rigged model its face morph. Then it settles back into what it was doing.
     */
    setMood(mood, seconds = 4) {
      const m = MOODS[mood];
      if (!m) return;
      if (moodLeft <= 0) resumeAct = state;
      badge.material.map = badgeTexture(mood);
      badge.material.needsUpdate = true;
      badge.visible = true;
      moodT = 0;
      moodLeft = seconds;
      chog.play(m.act);
      chog.express(mood, seconds);
      if (model) {
        model.traverse((o) => {
          if (!o.morphTargetDictionary) return;
          o.morphTargetInfluences.fill(0);
          const i = o.morphTargetDictionary[m.face];
          if (i !== undefined) o.morphTargetInfluences[i] = 1;
        });
      }
    },
    /**
     * Metres a second its walk or run carries it at scale 1 (0 for a standee or a clip it lacks). The picked
     * clips (CLIP_RATE) move at exactly what their feet cover at their rate, so nothing slides. A model's
     * own Tripo clips are kept to a natural pace instead: a robe that hides the legs, or a shuffling clip,
     * measures too slow. paceFor() is how fast to play the clip to match.
     */
    speedOf(move) {
      const name = clipOf[move];
      if (!gltfRef || !name) return 0;
      if (CLIP_RATE[name]) return sweepSpeed(gltfRef, name) * CLIP_RATE[name] * (STRIDE[move] ?? 1);
      const v = clipSpeed(gltfRef, name);
      if (!v) return 0;
      const [lo, hi] = move === 'run' ? [1.4, 3] : [0.5, 1.2];
      return THREE.MathUtils.clamp(v, lo, hi);
    },
    paceFor(move) {
      const name = clipOf[move];
      if (CLIP_RATE[name]) return CLIP_RATE[name];
      const v = gltfRef && name ? clipSpeed(gltfRef, name) : 0;
      return v ? THREE.MathUtils.clamp(Math.sqrt(chog.speedOf(move) / v), 0.85, 1.35) : 1;
    },
    /** Play its current move faster or slower (to match how fast it is actually going). */
    setPace(k) {
      if (current) current.timeScale = k;
    },
    /** Beaming through a portal: cut level 0 (feet) to 1 (head), dir 1 eats upward, -1 downward, 0 off. */
    setBeam(level, dir) {
      fx.uCut.value.set(level, dir);
    },
    /** Hold a face for a while: calm, happy, excited, surprised, curious, sad, cross or sleepy. */
    express(name, seconds = 3) {
      if (!EXPRESSIONS[name]) return;
      expr = name;
      exprLeft = seconds;
    },
    /** Move the mouth as if talking, for this many seconds. */
    talk(seconds = 2) {
      talkLeft = Math.max(talkLeft, seconds);
    },
    /** Look at something (a point or an object, whose head height is looked at), or null for the camera. */
    lookAt(target) {
      if (gaze) gaze.target = target;
    },
    /** Hold the right hand out toward something (a point, or an object's face) for this many seconds, with what it holds. */
    reach(target, seconds = 2) {
      if (!arm) return;
      arm.target = target;
      arm.left = seconds;
    },
    // Fade the Chog out (1 is solid, 0 gone), for walking off. A model pops in and out with a little
    // grow and shrink instead (fading its materials would rebuild their shaders).
    setFade(k) {
      if (stand) stand.mat.uniforms.uFade.value = k;
      fx.uFade.value = k;
      if (aura) aura.material.uniforms.uStrength.value = look.glow * k * (1 - fx.uGrey.value);
      root.traverse((o) => (o.isMesh || o.isSprite) && o !== stand?.card && o !== badge && !tintables.includes(o) && (o.visible = k > 0.02));
      if (model) model.visible = k > 0.02;
      if (k <= 0.02) badge.visible = false;
    },
    setGrey(k) {
      if (stand) stand.mat.uniforms.uGrey.value = k;
      fx.uGrey.value = k;
      if (aura) aura.material.uniforms.uStrength.value = look.glow * (1 - k);
    },
    update(dt, camera) {
      t += dt;
      stateT += dt;
      if (aura) aura.material.uniforms.uTime.value = t;
      if (moodLeft > 0) {
        moodT += dt;
        moodLeft -= dt;
        // The badge pops in, bobs, and fades away at the end.
        const pop = Math.min(1, moodT * 6);
        badge.scale.setScalar(0.62 * (pop + Math.sin(Math.min(1, moodT * 6) * Math.PI) * 0.15));
        badge.position.y = CHOG_HEIGHT + 0.45 + Math.sin(moodT * 3) * 0.05;
        badge.material.opacity = Math.min(1, moodLeft * 2);
        if (moodLeft <= 0) {
          badge.visible = false;
          chog.play(resumeAct);
        }
      }
      if (mixer) {
        // Undo last frame's head turn and wrist fix first: a bone no clip moves would keep them otherwise.
        if (gaze?.applied) gaze.head.quaternion.copy(gaze.base), (gaze.applied = false);
        for (const h of handFix) h.applied && (h.bone.quaternion.copy(h.base), (h.applied = false));
        const useGait = gait && (GAIT_WALKS || (state !== 'walk' && state !== 'run'));
        const now = useGait ? 'gait' : 'mixer';
        if (gait && driver && now !== driver) {
          // Hold the last pose and melt it into the new driver's.
          bones.forEach((b, i) => (snapQ[i].copy(b.quaternion), snapP[i].copy(b.position)));
          blendLeft = BLEND;
          if (now === 'mixer') current?.reset().play();
        }
        driver = now;
        if (useGait) {
          // Far off, the body moves a third as often (the steps stay where they are meanwhile).
          gaitAcc += dt;
          const far = camera && root.getWorldPosition(centre).distanceTo(camera.position) > GAIT_FAR;
          if (!far || ++gaitTick % 3 === 0) {
            gait.update(gaitAcc, GAIT_MOVES[state] ?? 'idle');
            gaitAcc = 0;
          }
        } else {
          fadeUpdate(dt);
          mixer.update(dt);
        }
        if (blendLeft > 0) {
          blendLeft = Math.max(0, blendLeft - dt);
          const k = THREE.MathUtils.smoothstep(1 - blendLeft / BLEND, 0, 1);
          bones.forEach((b, i) => (b.quaternion.slerpQuaternions(snapQ[i], b.quaternion.clone(), k), b.position.lerpVectors(snapP[i], b.position.clone(), k)));
        }
        for (const h of handFix) h.base.copy(h.bone.quaternion), h.bone.quaternion.multiply(h.fix), (h.applied = true);
        strideUpdate(dt);
        armClamp();
        waveUpdate(dt);
        micUpdate(dt);
        reachUpdate(dt);
        groundUpdate(dt, camera);
        faceUpdate(dt);
        if (camera) {
          lookUpdate(dt, camera);
          if (lods.length) {
            const near = root.getWorldPosition(centre).distanceTo(camera.position) < LOD_NEAR;
            for (const l of lods) l.mesh.geometry = near ? l.full : l.lite;
          }
        }
        return;
      }
      act(stand, state, t * speed, stateT);
      // The card turns to face the camera (about its upright axis), whatever way the Chog is facing.
      if (camera && state !== 'sleep') {
        root.getWorldPosition(centre);
        toCam.subVectors(camera.position, centre);
        const yaw = Math.atan2(toCam.x, toCam.z);
        root.parent?.getWorldQuaternion(_q);
        const parentYaw = root.parent ? _e.setFromQuaternion(_q, 'YXZ').y : 0;
        stand.card.rotation.y = yaw - root.rotation.y - parentYaw;
      }
    },
    dispose() {
      root.traverse((o) => {
        if (o.isMesh) {
          o.geometry.dispose();
          o.material.uniforms?.uMap?.value?.dispose();
        }
      });
    },
  };
  // The face for this frame: the held expression, else what the move shows, with blinks and talking.
  function faceUpdate(dt) {
    if (exprLeft > 0 && (exprLeft -= dt) <= 0) expr = 'calm';
    const shown = exprLeft > 0 ? expr : MOVE_FACE[state] ?? 'calm';
    let [eye, mouth] = EXPRESSIONS[shown];
    if ((blinkIn -= dt) <= 0) {
      blinking = 0.14;
      blinkIn = 2.2 + Math.random() * 4 + (Math.random() < 0.15 ? -1.8 : 0);
    }
    if (blinking > 0) {
      blinking -= dt;
      if (eye !== 'happy') eye = 'blink';
    }
    if (talkLeft > 0) talkLeft -= dt;
    if (talkLeft > 0 || state === 'talk' || state === 'sing') {
      if ((flapIn -= dt) <= 0) {
        flapIn = 0.07 + Math.random() * 0.1;
        const opts = mouthNow === 'rest' ? ['talk1', 'talk2'] : ['rest', 'talk1', 'talk2', mouthNow === 'talk1' ? 'talk2' : 'talk1'];
        mouthNow = opts[Math.floor(Math.random() * opts.length)];
      }
      mouth = mouthNow === 'rest' ? mouth : mouthNow;
    } else mouthNow = 'rest';
    face.uEye.value = EYES[eye];
    face.uMouth.value = MOUTHS[mouth];
  }

  // Turn the head toward what it looks at, within a natural reach, easing in and out.
  function lookUpdate(dt, camera) {
    const L = gaze;
    if (!L || !model.visible) return;
    const tgt = L.target ?? camera.position;
    let want = 0;
    if (state !== 'sleep' && state !== 'sleepy') {
      if (tgt.isObject3D) {
        tgt.getWorldPosition(_to);
        _to.y += CHOG_HEIGHT * 0.75 * tgt.getWorldScale(_lim).y;
      } else _to.copy(tgt);
      L.head.getWorldPosition(_hp);
      _to.sub(_hp);
      const dist = _to.length();
      root.getWorldQuaternion(_rq);
      _bf.set(0, 0, 1).applyQuaternion(_rq).normalize();
      _to.normalize();
      // Not at the camera on the move (the user, 10-17: the head swung round on its own as it turned).
      if (dist < LOOK_RANGE * root.getWorldScale(_lim).y && _to.dot(_bf) > -0.2) want = state === 'walk' || state === 'run' ? (L.target ? 0.35 : 0) : 1;
      // Within reach: no more than LOOK_MAX from straight ahead, and not far up or down.
      const ang = _to.angleTo(_bf);
      if (ang > LOOK_MAX) _to.lerpVectors(_bf, _to, LOOK_MAX / ang).normalize();
      _to.y = THREE.MathUtils.clamp(_to.y, -0.4, L.target ? 0.45 : 0.25);
      _to.normalize();
      L.dir.lerp(_to, 1 - Math.exp(-dt * 6)).normalize();
    }
    L.w += (want - L.w) * (1 - Math.exp(-dt * 3));
    if (L.w < 0.01) return;
    L.base.copy(L.head.quaternion);
    L.applied = true;
    L.head.getWorldQuaternion(_hq);
    _cur.copy(L.fwd).applyQuaternion(_hq);
    _dq.setFromUnitVectors(_cur, L.dir);
    _iq.identity().slerp(_dq, L.w * 0.85);
    _hq.premultiply(_iq);
    L.head.parent.getWorldQuaternion(_pq);
    L.head.quaternion.copy(_pq.invert().multiply(_hq));
  }

  // Walking and running, each leg swings further from rest than the clip has it: a longer stride for short
  // legs, so a Chog covers ground without its feet sliding (speedOf counts it).
  // The body steadier: the jog leant the chest far forward and swung the big head side to side (the user,
  // 10-17: they looked as if diving), so the spine to the head keep only part of the clip's motion.
  function strideUpdate(dt) {
    const blend = 1 - Math.exp(-dt * 8);
    for (const L of legs) {
      L.now += ((L.k[state] ?? 1) - L.now) * blend;
      if (Math.abs(L.now - 1) < 0.01) continue;
      L.d.copy(L.rest).invert().multiply(L.b.quaternion);
      _qh.identity().slerp(L.d, L.now);
      L.b.quaternion.copy(L.rest).multiply(_qh);
    }
  }
  // The moves' weights: the current one up, the rest down, over FADE, scaled to add up to one.
  function fadeUpdate(dt) {
    let sum = 0;
    for (const [a, w] of fades) {
      const nw = a === current ? Math.min(1, w + dt / FADE) : Math.max(0, w - dt / FADE);
      if (nw <= 0 && a !== current) {
        a.stop();
        fades.delete(a);
        continue;
      }
      fades.set(a, nw);
      sum += nw;
    }
    for (const [a, w] of fades) a.setEffectiveWeight(sum > 0 ? w / sum : 1);
  }
  // Upper arms brought down to ARM_LIFT_MAX over level, about their own level line, the forearm with them;
  // then each forearm straightened to within ELBOW_MAX of its upper arm.
  function armClamp() {
    for (const L of lifts) {
      L.up.updateWorldMatrix(true, true);
      L.up.getWorldPosition(_sh);
      L.fore.getWorldPosition(_el);
      _cur.subVectors(_el, _sh).normalize();
      if (_cur.y > Math.sin(ARM_LIFT_MAX)) {
        _to.copy(_cur).setY(0);
        if (_to.lengthSq() < 1e-4) _to.subVectors(_sh, root.getWorldPosition(_side)).setY(0);
        _to.normalize().multiplyScalar(Math.cos(ARM_LIFT_MAX));
        _to.y = Math.sin(ARM_LIFT_MAX);
        swing(L.up, _cur, _to, 1);
        L.up.getWorldPosition(_sh);
        L.fore.getWorldPosition(_el);
        _cur.subVectors(_el, _sh).normalize();
      }
      L.hand ??= L.fore.children.find((c) => c.isBone) ?? null;
      if (!L.hand) continue;
      L.hand.getWorldPosition(_wr);
      _aim.subVectors(_wr, _el).normalize();
      const bend = _aim.angleTo(_cur);
      if (bend > ELBOW_MAX) swing(L.fore, _aim, _to.copy(_cur).lerp(_aim, ELBOW_MAX / bend).normalize(), 1);
    }
  }
  // The wave, with a Chog's short arms: the right arm out to the side and up, nearly straight, swinging from
  // the shoulder, the hand rocking at the wrist (over whatever the clip's body does).
  function waveUpdate(dt) {
    const A = arm;
    if (!A) return;
    A.ww = (A.ww ?? 0) + ((state === 'wave' ? 1 : 0) - (A.ww ?? 0)) * (1 - Math.exp(-dt * 7));
    if (A.ww < 0.01) {
      A.wt = 0;
      return;
    }
    A.wt += dt;
    const w = THREE.MathUtils.smoothstep(A.ww, 0, 1);
    const ph = A.wt * WAVE.hz * Math.PI * 2;
    A.up.updateWorldMatrix(true, true);
    A.up.getWorldPosition(_sh);
    root.getWorldQuaternion(_rq);
    _bf.set(0, 0, 1).applyQuaternion(_rq).setY(0).normalize();
    root.getWorldPosition(_side);
    _side.subVectors(_sh, _side).setY(0).normalize();
    const lift = WAVE.lift + WAVE.swing * Math.sin(ph);
    _to.copy(_side).multiplyScalar(Math.cos(WAVE.forward)).addScaledVector(_bf, Math.sin(WAVE.forward)).normalize().multiplyScalar(Math.cos(lift));
    _to.y = Math.sin(lift);
    A.fore.getWorldPosition(_el);
    swing(A.up, _cur.subVectors(_el, _sh).normalize(), _to, w);
    A.fore.getWorldPosition(_el);
    A.hand.getWorldPosition(_wr);
    _aim.copy(_to);
    _aim.y += 0.25;
    swing(A.fore, _cur.subVectors(_wr, _el).normalize(), _aim.normalize(), w);
    // The hand rocks about the way it faces (forward), a beat behind the arm.
    _qh.setFromAxisAngle(_bf, -WAVE.rock * Math.sin(ph - 0.9) * w);
    A.hand.getWorldQuaternion(_qt).premultiply(_qh);
    A.hand.parent.getWorldQuaternion(_pq);
    A.hand.quaternion.copy(_pq.invert().multiply(_qt));
    A.hand.updateWorldMatrix(false, true);
  }
  // Singing with a mic (the singer, 10-17): the right hand brings it to the mouth, its head just in front of
  // the lips and its handle down and out, the arm bent below (two bones, the elbow down and out to the side).
  function micUpdate(dt) {
    const A = arm;
    if (!A?.held || !A.mouth || !gaze) return;
    A.mw += ((state === 'sing' ? 1 : 0) - A.mw) * (1 - Math.exp(-dt * 6));
    if (A.mw < 0.01) return;
    const w = THREE.MathUtils.smoothstep(A.mw, 0, 1);
    const s = root.getWorldScale(_lim).y;
    A.up.updateWorldMatrix(true, true);
    gaze.head.updateWorldMatrix(true, false);
    _mo.copy(A.mouth).applyMatrix4(gaze.head.matrixWorld);
    root.getWorldQuaternion(_rq);
    _bf.set(0, 0, 1).applyQuaternion(_rq).setY(0).normalize();
    // Where its head goes: just in front of the lips. Its grip: below that, so the mic stands up a little
    // forward of upright, but no further than the arm reaches (a Chog's arms are short and its face far
    // forward of its shoulders: then the mic leans out from under the chin to the lips).
    _gl.copy(_mo).addScaledVector(_bf, MIC_GAP * s);
    _gl.y -= 0.02 * s;
    A.up.getWorldPosition(_sh);
    A.fore.getWorldPosition(_el);
    A.hand.getWorldPosition(_wr);
    A.held.getWorldPosition(_e2);
    const a = _sh.distanceTo(_el), b = _el.distanceTo(_wr), grip = _wr.distanceTo(_e2);
    _ax.set(0, 0.85, 0).addScaledVector(_bf, 0.5).normalize();
    _tg.copy(_gl).addScaledVector(_ax, -MIC_HEAD * s);
    _aim.subVectors(_tg, _sh);
    const reach = (a + b + grip) * 0.97;
    if (_aim.length() > reach) _tg.copy(_sh).addScaledVector(_aim.normalize(), reach);
    _ax.subVectors(_gl, _tg).normalize();
    // The hand's turn that points the mic that way, and where the wrist goes for its grip to land there.
    A.held.getWorldQuaternion(_qh);
    _cur.set(0, 1, 0).applyQuaternion(_qh);
    _dq.setFromUnitVectors(_cur, _ax);
    _off.subVectors(_e2, _wr).applyQuaternion(_dq);
    _tg.sub(_off);
    A.hand.getWorldQuaternion(_qt).premultiply(_dq);
    // Two bones to reach it.
    _aim.subVectors(_tg, _sh);
    const d = THREE.MathUtils.clamp(_aim.length(), Math.abs(a - b) + 1e-4, (a + b) * 0.999);
    _aim.normalize();
    const cosA = THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
    root.getWorldPosition(_side);
    _side.subVectors(_sh, _side).setY(0).normalize();
    _pole.set(0, -1, 0).addScaledVector(_side, 0.8).addScaledVector(_bf, -0.15);
    _pole.addScaledVector(_aim, -_pole.dot(_aim)).normalize();
    _e2.copy(_sh).addScaledVector(_aim, a * cosA).addScaledVector(_pole, a * Math.sqrt(1 - cosA * cosA));
    swing(A.up, _cur.subVectors(_el, _sh).normalize(), _to.subVectors(_e2, _sh).normalize(), w);
    A.fore.getWorldPosition(_el);
    A.hand.getWorldPosition(_wr);
    swing(A.fore, _cur.subVectors(_wr, _el).normalize(), _to.subVectors(_tg, _el).normalize(), w);
    A.hand.getWorldQuaternion(_qh).slerp(_qt, w);
    A.hand.parent.getWorldQuaternion(_pq);
    A.hand.quaternion.copy(_pq.invert().multiply(_qh));
    A.hand.updateWorldMatrix(false, true);
  }
  // Its feet out of the ground: a clip that drops the hips further than the legs bend would sink the soles,
  // so the whole model rises by that much (never lowered: a jump stays a jump).
  function groundUpdate(dt, camera) {
    if (!soles.length || !skin) return;
    root.getWorldPosition(centre);
    if (camera && centre.distanceTo(camera.position) > 80) return;
    model.updateMatrixWorld(true);
    let lo = Infinity;
    for (const i of soles) lo = Math.min(lo, skin.getVertexPosition(i, _tg).applyMatrix4(skin.matrixWorld).y);
    const raw = (lo - centre.y) / root.getWorldScale(_lim).y - model.position.y;
    model.position.y += (Math.max(0, -raw) - model.position.y) * Math.min(1, dt * 20);
  }
  // Over the clip's pose: the upper arm out toward the target (the elbow a little out and down), the forearm
  // at it, and what the hand holds pointed at it (a mic's head). The clips set these bones every frame, so
  // nothing needs undoing.
  function swing(bone, from, to, w) {
    _dq.setFromUnitVectors(from, to);
    _iq.identity().slerp(_dq, w);
    bone.getWorldQuaternion(_hq).premultiply(_iq);
    bone.parent.getWorldQuaternion(_pq);
    bone.quaternion.copy(_pq.invert().multiply(_hq));
    bone.updateWorldMatrix(false, true);
  }
  function reachUpdate(dt) {
    const A = arm;
    if (!A) return;
    A.left -= dt;
    const want = A.left > 0 && A.target ? 1 : 0;
    A.w += (want - A.w) * (1 - Math.exp(-dt * (want ? 5 : 3.5)));
    if (A.w < 0.01) return;
    const w = THREE.MathUtils.smoothstep(A.w, 0, 1);
    A.up.updateWorldMatrix(true, true);
    A.up.getWorldPosition(_sh);
    if (want) {
      if (A.target.isCamera) A.target.getWorldPosition(A.at);
      else if (A.target.isObject3D) {
        A.target.getWorldPosition(A.at);
        A.at.y += CHOG_HEIGHT * 0.7 * A.target.getWorldScale(_lim).y;
      } else A.at.copy(A.target);
    }
    // Which way is ahead, and the arm's side, flat.
    root.getWorldQuaternion(_rq);
    _bf.set(0, 0, 1).applyQuaternion(_rq).setY(0).normalize();
    root.getWorldPosition(_side);
    _side.subVectors(_sh, _side).setY(0).normalize();
    // Toward the target, flat and kept in front: the arm is held out and up, about head height, whether the
    // target is up or down (only what the hand holds tips toward it).
    _aim.subVectors(A.at, _sh).setY(0).normalize();
    const ang = _aim.angleTo(_bf);
    if (ang > 1.2) _aim.lerpVectors(_bf, _aim, 1.2 / ang).normalize();
    A.fore.getWorldPosition(_el);
    swing(A.up, _cur.subVectors(_el, _sh).normalize(), _to.copy(_aim).addScaledVector(_side, 0.18).add(_hp.set(0, 0.22, 0)).normalize(), w);
    A.fore.getWorldPosition(_el);
    A.hand.getWorldPosition(_wr);
    swing(A.fore, _cur.subVectors(_wr, _el).normalize(), _to.copy(_aim).add(_hp.set(0, 0.5, 0)).normalize(), w);
    if (A.held) {
      A.hand.getWorldPosition(_wr);
      A.held.getWorldQuaternion(_hq);
      _cur.set(0, 1, 0).applyQuaternion(_hq);
      _to.subVectors(A.at, _wr).normalize();
      _to.y += 0.25;
      swing(A.hand, _cur, _to.normalize(), w * 0.85);
    }
  }

  // For the model tools (tools/models/pose.html): its arm, mouth and soles.
  if (import.meta.env?.DEV) chog.debug = () => ({ arm, soles, skin, model, gaze });
  chog.play('idle');
  mixer?.update(0);
  gait?.update(0, 'idle');
  return chog;
}

// The standee's moves: bobs, hops, leans and sways that read as each action from any side.
function act(s, state, t, st) {
  const { body, card } = s;
  body.position.set(0, 0, 0);
  body.rotation.set(0, 0, 0);
  card.rotation.x = 0;
  card.rotation.z = 0;
  card.position.y = 0.35;
  switch (state) {
    case 'walk':
      body.position.y = Math.abs(Math.sin(t * 5.5)) * 0.08;
      card.rotation.z = Math.sin(t * 5.5) * 0.06;
      break;
    case 'run':
      body.position.y = Math.abs(Math.sin(t * 9)) * 0.18;
      card.rotation.z = Math.sin(t * 9) * 0.1;
      break;
    case 'wave':
      card.rotation.z = Math.sin(t * 7) * 0.12;
      body.position.y = Math.abs(Math.sin(t * 3.5)) * 0.06;
      break;
    case 'talk':
      // Little quick bobs and a lean, like it's saying something.
      body.position.y = Math.abs(Math.sin(t * 8)) * 0.035;
      card.rotation.z = Math.sin(t * 2.6) * 0.05;
      card.rotation.x = -0.04 + Math.sin(t * 8) * 0.015;
      break;
    case 'sing':
      card.rotation.z = Math.sin(t * 1.6) * 0.14;
      body.position.y = Math.max(0, Math.sin(t * 3)) * 0.06;
      break;
    case 'cheer':
      body.position.y = Math.abs(Math.sin(t * 4.5)) * 0.32;
      card.rotation.z = Math.sin(t * 9) * 0.05;
      break;
    case 'sniff':
      card.rotation.x = 0.28 + Math.sin(t * 14) * 0.03 * (Math.sin(t * 0.9) > 0 ? 1 : 0.2);
      break;
    case 'sad':
      card.rotation.x = 0.22;
      card.position.y = 0.3;
      break;
    case 'sleepy':
      card.rotation.z = Math.sin(t * 0.9) * 0.12;
      card.rotation.x = 0.1 + Math.sin(t * 0.45) * 0.06;
      break;
    case 'sleep':
      card.rotation.x = -Math.PI / 2;
      card.position.y = 0.2;
      body.position.y = Math.sin(t * 0.8) * 0.01;
      break;
    case 'wake': {
      // Sits up off the bed over a couple of seconds, with a little stretch.
      const k = Math.min(1, st / 2.2);
      card.rotation.x = -Math.PI / 2 * (1 - THREE.MathUtils.smoothstep(k, 0, 0.7));
      card.position.y = 0.2 + 0.15 * THREE.MathUtils.smoothstep(k, 0, 0.7);
      card.rotation.z = Math.sin(st * 9) * 0.06 * (k > 0.7 ? 1 : 0);
      break;
    }
    default:
      body.position.y = Math.sin(t * 2) * 0.03;
      card.rotation.z = Math.sin(t * 0.7) * 0.03;
  }
}
