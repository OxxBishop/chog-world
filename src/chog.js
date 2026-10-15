import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { MeshoptSimplifier } from 'three/addons/libs/meshopt_simplifier.module.js';
import { lookFor, personalityFor, CLIPS, ATTACH, MOODS } from './traitmap.js';

/*
 * A Chog in the world. Its rigged model (with its head item, outfit and accessory, per traitmap.js)
 * loads once it has arrived in public/models/. Until then the Chog stands in as a standee: a card
 * of its official art on a little stand, turned to face you, that bobs, hops and leans to act out the
 * same moves. Either way the world drives it the same way: play('idle' | 'walk' | 'run' | 'wave' |
 * 'talk' | 'sing' | 'sniff' | 'cheer' | 'sleep' | 'wake' | 'sad'), update(dt, camera), setGrey(k) for the
 * sold-and-gone grey-out (it drains from the feet up), and dispose().
 */

const BASE = import.meta.env.BASE_URL;
const loader = new GLTFLoader();
const gltfs = new Map();
// keep < 1: a lighter copy with that share of the triangles, for Chogs seen from a distance.
const loadGltf = (url, keep = 1) => {
  const key = `${url}|${keep}`;
  if (!gltfs.has(key)) gltfs.set(key, loader.loadAsync(BASE + url).then(slim).then((g) => (keep < 1 ? lighten(g, keep) : g)));
  return gltfs.get(key);
};

/*
 * Fewer triangles for a model seen from afar: meshoptimizer collapses edges where it changes the shape
 * least, writing a new index buffer over the same vertices, so the skinning still holds.
 */
async function lighten(gltf, keep) {
  await MeshoptSimplifier.ready;
  gltf.scene.traverse((o) => {
    const g = o.geometry;
    if (!o.isMesh || !g.index || !(g.attributes.position.array instanceof Float32Array) || g.attributes.position.isInterleavedBufferAttribute) return;
    const src = g.index.array instanceof Uint32Array ? g.index.array : new Uint32Array(g.index.array);
    const target = Math.floor((src.length * keep) / 3) * 3;
    const [dst] = MeshoptSimplifier.simplify(src, g.attributes.position.array, 3, target, 0.02, []);
    g.setIndex(new THREE.BufferAttribute(dst, 1));
  });
  return gltf;
}

/*
 * Fit a model for the laptop: its colour texture down to 1024 px, and no normal or roughness maps (they
 * barely show at the distance a Chog is seen from, and cost a lot of memory and fill). Done once per
 * file; every copy of it shares the result.
 */
const SLIM_PX = 1024;
function slim(gltf) {
  const done = new Set();
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.material)) {
      if (done.has(m)) continue;
      done.add(m);
      const img = m.map?.image;
      if (img && Math.max(img.width, img.height) > SLIM_PX) {
        const c = document.createElement('canvas');
        const k = SLIM_PX / Math.max(img.width, img.height);
        c.width = Math.round(img.width * k);
        c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        const t = new THREE.CanvasTexture(c);
        for (const key of ['flipY', 'colorSpace', 'wrapS', 'wrapT', 'channel']) t[key] = m.map[key];
        t.anisotropy = 4;
        m.map.dispose();
        m.map = t;
      }
      for (const key of ['normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) {
        m[key]?.dispose();
        m[key] = null;
      }
      if (m.isMeshStandardMaterial) {
        m.roughness = 0.75;
        m.metalness = 0;
      }
      m.needsUpdate = true;
    }
  });
  return gltf;
}
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
  const tintables = [];

  if (base) {
    try {
      const gltf = await loadGltf(base, keep);
      model = cloneSkinned(gltf.scene);
      model.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.material = o.material.clone();
        tintables.push(o);
        if (modelUrl) {
          if (tint) o.material.color.multiply(tint);
        } else if (o.name === 'Skin' || o.material.name === 'Skin') o.material.color.set(look.skin);
      });
      // Separate pieces hang from their bones (a Chog's own model has them built in).
      for (const [slot, url] of modelUrl ? [] : [['head', look.head], ['body', look.body], ['accessory', look.accessory]]) {
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
  const stand = model ? null : standee(images, name);
  if (stand) root.add(stand.body);
  let aura = null;
  if (look.aura) {
    aura = auraRing(look.aura, look.glow);
    root.add(aura);
  }
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
    // Resolves true once it can be shown as itself: its model, or its standee's art.
    ready: stand ? stand.ready : Promise.resolve(true),
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
      if (model) {
        model.traverse((o) => {
          if (!o.morphTargetDictionary) return;
          o.morphTargetInfluences.fill(0);
          const i = o.morphTargetDictionary[m.face];
          if (i !== undefined) o.morphTargetInfluences[i] = 1;
        });
      }
    },
    // Fade the Chog out (1 is solid, 0 gone), for walking off. A model pops in and out with a little
    // grow and shrink instead (fading its materials would rebuild their shaders).
    setFade(k) {
      if (stand) stand.mat.uniforms.uFade.value = k;
      if (model) model.scale.setScalar(0.7 + 0.3 * THREE.MathUtils.smoothstep(k, 0, 1));
      root.traverse((o) => (o.isMesh || o.isSprite) && o !== stand?.card && o !== badge && (o.visible = k > 0.02));
      if (k <= 0.02) badge.visible = false;
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
