import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { lookFor, personalityFor, CLIPS, ATTACH } from './traitmap.js';

/*
 * A Chog in the world. Its rigged model (with its head item, outfit and accessory, per traitmap.js)
 * loads once it has arrived in public/models/. Until then the Chog stands in as a standee: a card
 * of its official art on a little stand, turned to face you, that bobs, hops and leans to act out the
 * same moves. Either way the world drives it the same way: play('idle' | 'walk' | 'run' | 'wave' |
 * 'sing' | 'sniff' | 'cheer' | 'sleep' | 'wake' | 'sad'), update(dt, camera), setGrey(k) for the
 * sold-and-gone grey-out (it drains from the feet up), and dispose().
 */

const BASE = import.meta.env.BASE_URL;
const loader = new GLTFLoader();
const gltfs = new Map();
const loadGltf = (url) => {
  if (!gltfs.has(url)) gltfs.set(url, loader.loadAsync(BASE + url));
  return gltfs.get(url);
};
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

function standee(image) {
  const mat = cardMaterial();
  if (image) {
    textures.load(image, (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      mat.uniforms.uMap.value = t;
      mat.uniforms.uLoaded.value = 1;
    });
  }
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
  return { body, card, stand, mat };
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
  float ring = exp(-pow((r - 0.62) * 5.0, 2.0)) + exp(-r * 3.0) * 0.35;
  float pulse = 0.8 + 0.2 * sin(uTime * 2.4);
  gl_FragColor = vec4(uColor * ring * pulse * uStrength, 1.0);
}`,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6).rotateX(-Math.PI / 2).translate(0, 0.04, 0), mat);
  m.renderOrder = 2;
  return m;
}

/** Build a Chog from its info ({ traits, image }). Resolves once its model (or standee) is ready. */
export async function makeChog({ traits = {}, image = null } = {}) {
  const look = lookFor(traits);
  const personality = personalityFor(traits);
  const root = new THREE.Group();
  let mixer = null;
  let model = null;
  const actions = {};
  const tintables = [];

  if (look.base) {
    try {
      const gltf = await loadGltf(look.base);
      model = cloneSkinned(gltf.scene);
      model.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.material = o.material.clone();
        tintables.push(o);
        if (o.name === 'Skin' || o.material.name === 'Skin') o.material.color.set(look.skin);
      });
      // Separate pieces hang from their bones.
      for (const [slot, url] of [['head', look.head], ['body', look.body], ['accessory', look.accessory]]) {
        if (!url) continue;
        const piece = cloneSkinned((await loadGltf(url)).scene);
        piece.traverse((o) => {
          if (!o.isMesh) return;
          o.material = o.material.clone();
          tintables.push(o);
        });
        (model.getObjectByName(ATTACH[slot]) ?? model).add(piece);
      }
      mixer = new THREE.AnimationMixer(model);
      for (const [name, clipName] of Object.entries(CLIPS)) {
        const clip = THREE.AnimationClip.findByName(gltf.animations, clipName);
        if (clip) actions[name] = mixer.clipAction(clip);
      }
      root.add(model);
    } catch (err) {
      console.warn('Chog model unavailable, using its standee:', err?.message ?? err);
      model = null;
    }
  }
  const stand = model ? null : standee(image);
  if (stand) root.add(stand.body);
  let aura = null;
  if (look.aura) {
    aura = auraRing(look.aura, look.glow);
    root.add(aura);
  }

  // Grey-out for a model's own materials: each mesh drains from the feet up by its height.
  const original = tintables.map((o) => o.material.color.clone());
  const box = model ? new THREE.Box3().setFromObject(model) : null;
  const centre = new THREE.Vector3();
  const tmp = new THREE.Color();

  let state = 'idle';
  let stateT = 0;
  let current = null;
  let t = Math.random() * 10;
  const speed = personality.idleSpeed;
  const toCam = new THREE.Vector3();

  const chog = {
    root,
    traits,
    look,
    personality,
    get state() {
      return state;
    },
    play(name) {
      if (name === state) return;
      state = name;
      stateT = 0;
      const next = actions[name] ?? (name === 'sleep' ? null : actions.idle);
      if (next && next !== current) {
        next.reset().fadeIn(0.3).play();
        current?.fadeOut(0.3);
        current = next;
      }
    },
    // Fade the Chog out (1 is solid, 0 gone), for walking off.
    setFade(k) {
      if (stand) stand.mat.uniforms.uFade.value = k;
      root.traverse((o) => o.isMesh && o !== stand?.card && (o.visible = k > 0.02));
    },
    setGrey(k) {
      if (stand) stand.mat.uniforms.uGrey.value = k;
      tintables.forEach((o, i) => {
        o.getWorldPosition(centre);
        const h = box ? (centre.y - root.position.y - box.min.y) / Math.max(box.max.y - box.min.y, 0.01) : 0;
        const kk = THREE.MathUtils.clamp((k * 1.2 - h) * 4, 0, 1);
        const c = original[i];
        const l = c.r * 0.299 + c.g * 0.587 + c.b * 0.114;
        o.material.color.copy(c).lerp(tmp.setScalar(l * 0.7 + 0.1), kk);
      });
      if (aura) aura.material.uniforms.uStrength.value = look.glow * (1 - k);
    },
    update(dt, camera) {
      t += dt;
      stateT += dt;
      if (aura) aura.material.uniforms.uTime.value = t;
      if (mixer) return mixer.update(dt);
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
  chog.play('idle');
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
