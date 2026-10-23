// First, so a demo shot's clock is in place before anything reads the time (B13).
import { demoClock } from './democlock.js';
import * as THREE from 'three';
import { loadAll } from './assets.js';
import { Sky } from './sky.js';
import { createVolumetricClouds } from './volclouds.js';
import { Post } from './post.js';
import { createDebug } from './debug.js';
import { buildIsland } from './island.js';
import { CameraRig, RoomBox } from './camera.js';
import { wind } from './foliage.js';
import { DOMES, DOME_R, HOODS, ISLANDS, DOWNTOWN, baseY } from './layout.js';
import { rimPoint } from './terrain.js';
import { setGlowFov } from './glows.js';
import { loadKit } from './kaykit.js';
import { HUB_KIT } from './hub.js';
import { LANDMARK_KIT } from './landmarks.js';
import { FURNITURE_KIT } from './interior.js';
import { initSession } from './session.js';
import { buildNpcs } from './npcs.js';
import { makeChog, setChogSun, setChogRenderer } from './chog.js';
import { rng as makeRng } from './util.js';
import { createLoader, prewarm } from './loader.js';
import { SHOTS, createDemo } from './shots.js';
import { createSpace } from './space.js';
import { createAudio } from './audio.js';
import { createRace } from './race.js';
import { createStars } from './stars.js';
import './play.css';
import './motion.js';
import { createEntry } from './entry.js';
import { createIntro } from './intro.js';
import { createArrival } from './arrival.js';
import { createCasino } from './casino.js';
import { postcard } from './fx/postcard.js';
import { createTravel } from './travel.js';
import { createBirds } from './birds.js';

const $ = (id) => document.getElementById(id);

const params = new URLSearchParams(location.search);
const TOUCH = window.matchMedia('(pointer: coarse)').matches;
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
// Quality: the full look by default. ?q=medium or ?q=low for slower machines, ?q=auto to adapt
// on the fly, ?q=ultra for the sharpest cloud shadows.
const ASKED = ['low', 'medium', 'high', 'ultra', 'auto'].includes(params.get('q')) ? params.get('q') : null;
// An integrated Intel HD or UHD chip (the HD 520 and its kin) gets a lighter look unless ?q asks for
// another: medium shadows, the light clouds, one pixel per screen pixel. Windows resets a graphics
// driver that spends 2 s on one job, and the full clouds came close on the HD 520. ?weakgpu tries it
// on any machine.
const WEAK_GPU = !ASKED && (params.has('weakgpu') || /\bIntel\b.*\bU?HD Graphics\b|\bU?HD Graphics \d{3}\b/i.test(gpuName(renderer)));
const QUALITY = ASKED ?? (WEAK_GPU ? 'medium' : 'high');
console.info(`GPU: ${gpuName(renderer)}; quality ${QUALITY}${WEAK_GPU ? ' (light look for this GPU)' : ''}`);
const LIGHT = WEAK_GPU || QUALITY === 'low' || QUALITY === 'medium';
// Phones and tablets draw at 2 (their screens are 3 pixels to the point, and at 1.5 the world looked soft
// beside the crisp panels); their clouds keep the pixel count they had (volclouds' setQuality).
const BASE_DPR = Math.min(window.devicePixelRatio, WEAK_GPU ? 1 : { low: 1, ultra: 2 }[QUALITY] ?? (TOUCH ? 2 : 1.5));
renderer.setPixelRatio(BASE_DPR);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = QUALITY !== 'low';
// The sliding doors hide what's slid into the wall with clipping planes (src/hub.js slidingDoor).
renderer.localClippingEnabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.toneMapping = THREE.NoToneMapping;
$('app').appendChild(renderer.domElement);
// The cast's KTX2 textures transcode to what this GPU takes (src/chog.js).
setChogRenderer(renderer);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(outdoorFov(), window.innerWidth / window.innerHeight, 0.3, 2600);
const sky = new Sky(scene, renderer);
if (QUALITY === 'medium') sky.light.shadow.mapSize.set(2048, 2048);

// The lens: 42 degrees top to bottom, opened up on a tall phone screen so its width still takes in
// at least 36 degrees.
// The GPU's name where the browser gives it (Chrome and Edge do; Firefox gives the family).
function gpuName(r) {
  const gl = r.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  return String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
}

function outdoorFov() {
  const aspect = window.innerWidth / window.innerHeight;
  const needed = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(18)) / aspect));
  return Math.min(70, Math.max(42, needed));
}

// Compile a new object's shaders ahead of time, for the target the scene really draws into, so it
// doesn't stall the frame it first appears in.
// Then it is drawn once, by itself: Intel's driver finishes a shader only on its first draw. A room's
// lights are part of its shaders, so the draw has the lights that are on now, when it is asked for. The
// load waits for every warm-up asked for while it is still up (warming).
const warming = new Set();
function warmUp(obj) {
  const lit = litNow();
  const was = renderer.getRenderTarget();
  renderer.setRenderTarget(post.composer.inputBuffer);
  const ready = renderer.compileAsync(obj, camera, scene);
  renderer.setRenderTarget(was);
  const done = ready.then(() => drawOnce(obj, lit, { all: true })).catch(() => {});
  warming.add(done);
  done.finally(() => warming.delete(done));
  return done;
}

function litNow() {
  const on = new Set();
  scene.traverseVisible((o) => o.isLight && on.add(o));
  return on;
}

// One object drawn by itself into the scene's own target, framed from in front, with the world's
// sky and the lights lit; then everything is put back. An object not in the scene is put in it for the draw.
function drawOnce(obj, lit, opts) {
  const added = !obj.parent;
  if (added) scene.add(obj);
  obj.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(obj);
  if (!box.isEmpty()) {
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const r = Math.max(sphere.radius, 0.5);
    drawWith(obj, sphere.center.clone().add(new THREE.Vector3(0, r * 0.4, r * 2.6)), sphere.center, lit, opts);
  }
  if (added) scene.remove(obj);
}

// Draws obj alone from pos looking at target, with only the lights in lit on (by default those on now)
// and the shadows left as they are, and puts the camera and the world back. All of obj is drawn, even
// what is out of view (the door behind a room's camera). shadows: draw obj into
// the shadow map too (its shadow shaders), and have the next frame draw the map afresh. all: every part
// of obj at once, the hidden ones too (a sparkle still to burst, a badge, each level of detail), since
// each is a shader to build before it first shows.
function drawWith(obj, pos, target, lit = litNow(), { shadows = false, all = false } = {}) {
  const keep = new Set();
  for (let o = obj; o; o = o.parent) keep.add(o);
  for (const l of lit) for (let o = l; o; o = o.parent) keep.add(o);
  const flipped = [];
  const show = (o, v) => {
    if (o.visible === v) return;
    flipped.push(o);
    o.visible = v;
  };
  const walk = (o) => {
    show(o, keep.has(o));
    if (o !== obj && keep.has(o)) o.children.forEach(walk);
  };
  walk(scene);
  const lods = [];
  const culled = [];
  obj.traverse((o) => {
    if (!o.frustumCulled) return;
    o.frustumCulled = false;
    culled.push(o);
  });
  if (all) {
    obj.traverse((o) => {
      // A badge with nothing on it yet never shows like that.
      if (o.isSprite && !o.material.map) return;
      show(o, true);
      if (o.isLOD && o.autoUpdate) {
        o.autoUpdate = false;
        lods.push(o);
      }
    });
  }
  const was = { pos: camera.position.clone(), quat: camera.quaternion.clone() };
  camera.position.copy(pos);
  camera.lookAt(target);
  camera.updateMatrixWorld();
  const mapWas = renderer.shadowMap.needsUpdate;
  renderer.shadowMap.needsUpdate = shadows;
  renderer.setRenderTarget(post.composer.inputBuffer);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  renderer.shadowMap.needsUpdate = shadows || mapWas;
  for (const o of flipped) o.visible = !o.visible;
  for (const o of lods) o.autoUpdate = true;
  for (const o of culled) o.frustumCulled = true;
  camera.position.copy(was.pos);
  camera.quaternion.copy(was.quat);
  camera.updateMatrixWorld();
}

// Draws one room by itself into the scene's own target, from the room's view, with the same lights
// and sky as the world (so its shaders are the very ones the world will use).
function drawAlone(r) {
  drawWith(r.room.group, r.view.pos, r.view.target);
}

/*
 * C's rigged cast loads as the camera comes near, after the loader, and each kind of shader it brings
 * is drawn once in the load first (B12), in every light setup, so its first draws never stall a frame
 * on Intel. The Chogs themselves come from makeChog (their shader has the grey-out and the dissolve
 * built in): the light copy seen about town and the full one your own Chog and the bar's regulars are,
 * loaded with the rest of the downloads. The rest are stand-ins on the cast's
 * vertex layout (meshopt-packed: normals in bytes, texture coordinates in shorts): the singer's material
 * with its normal and roughness maps, the mood badge (a sprite), and the plain materials props are made
 * of (standard, lambert, basic, physical, each with and without a texture), so a prop that loads later
 * finds its shader built and drawn too.
 */
const CAST_KINDS = [
  { model: 'models/npcs/plain.glb', keep: 0.3 },
  { model: 'models/npcs/plain.glb' },
  // The singer is a Chog now (A): its own two-sided material with normal and roughness maps.
  { model: 'models/npcs/singer.glb' },
];
function castStandIns() {
  const box = new THREE.BoxGeometry(0.5, 0.5, 0.5);
  const n = box.attributes.position.count;
  const geo = new THREE.BufferGeometry();
  geo.setIndex(box.index);
  geo.setAttribute('position', box.attributes.position);
  geo.setAttribute('normal', new THREE.BufferAttribute(Int8Array.from(box.attributes.normal.array, (v) => Math.round(v * 127)), 3, true));
  geo.setAttribute('uv', new THREE.BufferAttribute(Uint16Array.from(box.attributes.uv.array, (v) => Math.round(v * 65535)), 2, true));
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint8Array(n * 4), 4));
  const weights = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) weights[i * 4] = 255;
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(weights, 4, true));
  const pixel = (space) => {
    const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    t.colorSpace = space;
    t.needsUpdate = true;
    return t;
  };
  const colour = pixel(THREE.SRGBColorSpace), data = pixel(THREE.NoColorSpace);
  const singerMat = new THREE.MeshStandardMaterial({ map: colour, normalMap: data, roughnessMap: data, metalnessMap: data, side: THREE.DoubleSide });
  const singer = () => {
    const mesh = new THREE.SkinnedMesh(geo, singerMat);
    const bone = new THREE.Bone();
    mesh.add(bone);
    mesh.bind(new THREE.Skeleton([bone]));
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    return mesh;
  };
  const plainMats = [THREE.MeshStandardMaterial, THREE.MeshLambertMaterial, THREE.MeshBasicMaterial, THREE.MeshPhysicalMaterial].flatMap((M) => [new M(), new M({ map: colour })]);
  const plain = () =>
    plainMats.map((m) => {
      const mesh = new THREE.Mesh(box, m);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      return mesh;
    });
  const badgeMat = new THREE.SpriteMaterial({ map: colour, transparent: true, depthTest: false });
  const badge = () => {
    const s = new THREE.Sprite(badgeMat);
    s.frustumCulled = false;
    return s;
  };
  return {
    inside: () => [badge(), ...plain()],
    outside: () => [singer(), badge(), ...plain()],
    // The materials stay: disposing them would free their shaders, which the cast is to find built.
    dispose: () => {
      geo.dispose();
      box.dispose();
    },
  };
}

// A quick dip to dusk and back, for stepping indoors and out.
function fadeThrough(fn) {
  const f = $('fade');
  f.classList.add('on');
  setTimeout(() => {
    fn();
    requestAnimationFrame(() => requestAnimationFrame(() => f.classList.remove('on')));
  }, 220);
}

// Framed views for judging the look.
const T = DOWNTOWN.y;
const home = DOMES[2];
const fwd = (d, k) => new THREE.Vector3(d.x + Math.sin(d.facing) * k, 0, d.z + Math.cos(d.facing) * k);
const hood = HOODS[0];
const H = baseY(hood);
const VIEWS = {
  overview: { pos: new THREE.Vector3(270, 190, 345), target: new THREE.Vector3(0, 0, 40) },
  cloudline: { pos: new THREE.Vector3(205, 4, 290), target: new THREE.Vector3(0, 14, 0) },
  downtown: { pos: new THREE.Vector3(20, T + 14, 70), target: new THREE.Vector3(0, T + 8, 0) },
  neighbourhood: { pos: new THREE.Vector3(hood.x + 40, H + 38, hood.z + 70), target: new THREE.Vector3(hood.x, H + 2, hood.z - 10) },
  dome: { pos: fwd(home, DOME_R + 18).setY(home.y + 3), target: new THREE.Vector3(home.x, home.y + 4, home.z) },
  inside: { pos: fwd(home, DOME_R - 3).setY(home.y), target: fwd(home, 5).setY(home.y + 2), enter: true },
  ground: { pos: new THREE.Vector3(2, T + 1.8, 56), target: new THREE.Vector3(10, T + 3.5, 130) },
  sky: { pos: new THREE.Vector3(-20, T + 3, 60), target: new THREE.Vector3(-60, T + 70, -100) },
};
const rig = new CameraRig(camera, renderer.domElement, VIEWS);

/*
 * The overview: every island whole and centred, whatever the screen. Fitted to each island's rim and
 * the lip of its cliffs (the land is what gets centred; the undersides hang below), from a tilt that
 * suits the screen's shape. It stays whole and centred as the view idles round.
 */
const OVERVIEW_THETA = 0.72;
let overviewPoints = null;
function fitOverview(theta) {
  if (!overviewPoints) {
    overviewPoints = [];
    for (const isl of ISLANDS) {
      for (let k = 0; k < 24; k++) {
        const p = rimPoint(isl, (k / 24) * Math.PI * 2, 1.0);
        overviewPoints.push(p, p.clone().setY(p.y - 12));
      }
    }
    overviewPoints.push(new THREE.Vector3(DOWNTOWN.x, T + 28, DOWNTOWN.z));
  }
  camera.fov = outdoorFov();
  camera.updateProjectionMatrix();
  const phi = camera.aspect < 0.8 ? 0.78 : 1.02;
  const fit = rig.fitAll(overviewPoints, phi, camera.aspect < 0.8 ? 0.93 : 0.86);
  const target = rig.overviewAim(theta);
  const s = Math.sin(phi);
  VIEWS.overview = {
    pos: new THREE.Vector3(s * Math.sin(theta), Math.cos(phi), s * Math.cos(theta)).multiplyScalar(fit.dist).add(target),
    target,
  };
}
const post = new Post(renderer, scene, camera);
post.setPixelRatio(renderer.getPixelRatio());

let island;
let clouds;
let session = null;
let space = null;
let entry = null;
let intro = null;
let arrival = null;
let casino = null;
let npcs = null;

// The island's sound (src/audio.js): the themes, and the singer's song placed at her stage.
const audio = createAudio({ button: document.getElementById('btn-sound') });
const stageAt = new THREE.Vector3();
let stageNode = null;
function stagePos() {
  if (!stageNode && npcs) stageNode = scene.getObjectByName('Stage');
  return stageNode ? stageNode.getWorldPosition(stageAt) : null;
}
// The island's wildlife (B35, src/birds.js).
let birds = null;
let race = null;
let stars = null;
const birdFocus = new THREE.Vector3(), birdMe = new THREE.Vector3();
let debug = null;
// Walking your Chog round the islands (src/travel.js), and the last frame's step for its tweens.
let travel = null;
let frameDt = 1 / 60;
// A cutscene holding the camera (the sale's farewell): called each frame after the rig and the flights,
// fn(camera, dt); it lets go by returning false.
let cutCam = null;

// Time of day: live local clock, or a scrubbed hour from the slider.
const time = { live: true, hour: 12 };
function currentHour() {
  if (!time.live) return time.hour;
  const d = new Date();
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
}
function phaseName(h, night) {
  if (night > 0.75) return 'Night · aurora';
  if (h < 12 && night > 0.05) return 'Dawn';
  if (h >= 12 && night > 0.05) return 'Dusk';
  if (h > 17) return 'Sunset';
  return 'Day';
}

async function init() {
  // The first screen (src/intro.js): the load, then connect or explore as a guest.
  intro = createIntro($('loading'));
  // Each step's share of the loading bar, roughly how long it takes.
  const load = createLoader($('loading'), [
    ['download', 5, 'Waking the island'],
    ['build', 3, 'Raising the islands'],
    ['shaders', 4, 'Lighting the sky'],
    ['clouds', 2, 'Gathering the clouds'],
    ['frames', 1, 'Almost there'],
  ]);
  // The clouds: their pass joins the post chain held off, and their textures come down with the rest.
  clouds = createVolumetricClouds(renderer, camera);
  clouds.setQuality(WEAK_GPU ? 'low' : QUALITY === 'auto' ? 'high' : QUALITY, { pixelRatio: BASE_DPR });
  post.addClouds(clouds.effects);
  clouds.hold(post.cloudPass);
  clouds.fetch();
  // The nature models, the building kits and the sign font all download at once.
  const got = { models: 0, kit: 0, furniture: 0, font: 0 };
  const weight = { models: 0.7, kit: 0.15, furniture: 0.1, font: 0.05 };
  const part = (k) => (f) => {
    got[k] = f;
    load.set('download', Object.keys(got).reduce((sum, x) => sum + got[x] * weight[x], 0));
  };
  // The cast's kinds of Chog, for the load to draw once (B12); they stay cached for the cast.
  const castIn = Promise.race([Promise.all(CAST_KINDS.map((k) => makeChog(k))), new Promise((r) => setTimeout(() => r([]), 20000))]).catch(() => []);
  await Promise.all([
    loadAll(part('models')),
    loadKit([...new Set([...HUB_KIT, ...LANDMARK_KIT])], 'kaykit', part('kit')),
    loadKit(FURNITURE_KIT, 'furniture', part('furniture')),
    document.fonts.load('600 120px Fredoka').catch(() => {}).then(() => part('font')(1)),
  ]);
  // Let the bar show the next step before the long build.
  load.set('build', 0);
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r)));
  island = buildIsland(scene, makeRng(1969), renderer, sky, post.overlay);
  island.setQuality(perf.quality);
  rig.solids = island.solids;
  fitOverview(OVERVIEW_THETA);
  // Each room is a view too: ?view=lobby, ?view=bar, ?view=home (the home in the Dome view's dome).
  for (const r of island.rooms) VIEWS[r.id] = r.view;
  VIEWS.home = VIEWS[`home${DOMES.indexOf(home)}`];
  buildPickables();
  // The world seen from space, ready before the shaders are built so it never stalls.
  space = createSpace({ scene, camera, renderer, sky, clouds, rig, dip: fadeThrough, quality: LIGHT ? 'low' : 'high' });
  // Walking into the Hub's rooms and out again, as one move (src/entry.js).
  // The flight down to your Chog's home after signing in (src/arrival.js).
  arrival = createArrival({ camera, rig, space, domes: island.domes, dom: renderer.domElement, quality: LIGHT ? 'low' : 'high' });
  entry = createEntry({ camera, rig, hub: island.hub, fovs: { outdoor: outdoorFov, indoor: () => (camera.aspect < 1 ? 64 : 52) }, dom: renderer.domElement, session: () => session });
  // The Chogs about town, each once its model is in; ?npcs shows every slot, with stand-ins. They load
  // with the rest, so the first one drawn (the singer) is drawn behind the loader: every rigged Chog
  // shares its shader, which Intel builds on the first draw.
  birds = createBirds({ scene, island, quality: QUALITY, prewarm: warmUp });
  const npcsIn = buildNpcs({ scene, plaza: island.plaza, standees: params.has('npcs') || !!SHOTS[params.get('demo')], prewarm: warmUp, quality: QUALITY, bridges: island.bridges })
    .then((n) => (npcs = n))
    .catch((err) => console.warn('Chogs about town:', err));
  load.set('build', 1);
  // Build every shader the world needs (the rooms and the post chain too) in the background, so the
  // first frame you see is finished.
  load.set('shaders', 0);
  // The dry run goes first: it bakes the sky's light into the scene, so the rooms compile with it too.
  const warm = prewarm(renderer, frame, (f) => load.set('shaders', f));
  // Each room as it looks once you're in it (its lamps take the furniture's texture as their glow).
  for (const r of island.rooms) {
    r.room.group.visible = true;
    r.room.update?.(sky.env, renderer);
  }
  renderer.setRenderTarget(post.composer.inputBuffer);
  const rooms = renderer.compileAsync(scene, camera).catch(() => {});
  renderer.setRenderTarget(null);
  for (const r of island.rooms) r.room.group.visible = false;
  await Promise.all([rooms, warm]);
  // The dry run took the sky's light bake with it: bake it again for real.
  sky.envHour = -99;
  load.set('frames', 0);
  // Then each kind of room is drawn once, on its own, from its own view (every home shares one set of
  // materials). Building a shader isn't enough everywhere: Intel's driver finishes one only the first
  // time it draws with it, and on the HD 520 that made the first walk into a room crawl for seconds.
  const cast = castStandIns();
  const chogs = (await castIn).map((c) => c.root);
  for (const id of ['lobby', 'bar', 'casino', 'home0']) {
    const r = island.rooms.find((x) => x.id === id);
    const stand = [...chogs, ...cast.inside()];
    r.room.group.add(...stand);
    drawAlone(r);
    stand.forEach((o) => o.removeFromParent());
  }
  // The cast outside, in the sun's shadows too (the next frame draws the shadow map afresh).
  const outside = new THREE.Group();
  outside.add(...chogs, ...cast.outside());
  drawOnce(outside, litNow(), { shadows: true, all: true });
  outside.clear();
  cast.dispose();
  // A dome's glass and steel as you see them close up, as the arrival flies in.
  drawOnce(island.domes[0].group.children.find((o) => o.isLOD), litNow(), { all: true });
  // And space, the planet and the sky round it, which the connect screen opens on, and warp speed.
  drawOnce(space.group, litNow(), { all: true });
  drawOnce(space.warp.group, litNow(), { all: true });
  // Then the clouds go up onto the GPU and their pass is drawn for real in the frames below, still
  // behind the loader: out from space their first draw froze the page for seconds on Intel. A slow
  // download doesn't hold the world up for long; they come in when they can.
  load.set('clouds', 0);
  const cloudsIn = clouds.stream(() => post.render(0)).then((shown) => {
    if (shown) load.mark('clouds');
    return shown;
  });
  await Promise.race([Promise.all([cloudsIn, npcsIn]), new Promise((r) => setTimeout(r, 20000))]);
  load.set('clouds', 1);
  frame();
  frame();
  // Wait for the GPU to finish that first work (texture uploads) while the loader is still up, then
  // give it a couple of real frames, so the world appears already running smoothly.
  const gl = renderer.getContext();
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  for (let i = 0; i < 3; i++) {
    await new Promise(requestAnimationFrame);
    frame();
    load.set('frames', (i + 1) / 3);
  }
  // A link to a view, a shot or space goes straight there; otherwise the intro stays up, over the
  // world seen from space, asking you to connect.
  const withIntro = !params.has('view') && !params.has('space') && !SHOTS[params.get('demo')] && !params.has('nointro');
  // Optional ?view=dome&hour=22 in the address, handy for sharing a specific shot.
  if (params.has('hour')) {
    time.live = false;
    time.hour = parseFloat(params.get('hour'));
    $('time-slider').value = time.hour;
    $('btn-live').classList.remove('active');
  }
  if (VIEWS[params.get('view')]) {
    rig.jump(params.get('view'));
    // Highlight the view it opened on, not Overview.
    markView(params.get('view'));
  } else rig.jump('overview');
  renderer.setAnimationLoop(loop);
  // Getting about (A, the user's picks): your Chog in third person, a compass and a map, portals.
  try {
  travel = createTravel({
    scene,
    camera,
    renderer,
    rig,
    island,
    world: {
      session: () => session,
      entryActive: () => !!entry?.active,
      spaceActive: () => !!space?.active,
      introOpen: () => !$('loading').classList.contains('done'),
      canEnter: (r) => !!entry?.can(r) && !space?.active,
      enterRoom: (r) => enterRoom(r),
      currentRoom: () => (entry?.active ? entry.room : island.rooms.find((r) => r.pod === rig.room) ?? null),
      npcRoots: () => npcs?.roots?.() ?? [],
      setAway: (id, on) => npcs?.setAway?.(id, on),
      prewarm: warmUp,
      dip: (fn) => new Promise((resolve) => fadeThrough(() => (fn(), resolve()))),
      hideOldHud: () => {
        setMenu(false);
        leaveRoomUI();
      },
      dt: () => frameDt,
    },
  });
  } catch (err) {
    // Never lose the world over it: without it, the old views still work.
    console.error('Travel:', err);
  }
  // Racing Patrol round the first neighbourhood's loop (B, src/race.js; the user's pick, 10-23).
  // And the star hunt (B, src/stars.js; the user's pick, 10-23).
  if (travel) stars = createStars({ scene, camera, travel });
  if (travel) race = createRace({ scene, camera, travel, npcs: () => npcs, dip: (fn) => new Promise((resolve) => fadeThrough(() => (fn(), resolve()))) });
  // Signing in, and the Chogs who live round the world.
  session = initSession({
    get travel() {
      return travel;
    },
    camera,
    homes: island.rooms.filter((r) => r.id.startsWith('home')),
    domes: island.domes,
    bar: island.rooms.find((r) => r.id === 'bar'),
    rooms: island.rooms,
    // A room's door cutscene is playing (src/entry.js): your Chog walks in at its end.
    entering: () => !!entry?.active,
    enterRoom: (r) => enterRoom(r),
    currentRoom: () => (entry?.active ? entry.room : island.rooms.find((r) => r.pod === rig.room) ?? null),
    leaveToOverview: () =>
      fadeThrough(() => {
        leaveRoomUI();
        space.leave();
        rig.jump('overview');
        markView('overview');
      }),
    // The world seen from space (src/space.js): carried out to it from a room or wherever the view
    // is, and back (at once, or flying back over duration seconds).
    enterSpace: ({ from, duration, clip } = {}) => {
      leaveRoomUI();
      return space.enter({ from, duration, clip });
    },
    leaveSpace: (opts) => space.leave(opts),
    // The first screen (src/intro.js) and the flight to your Chog's home (src/arrival.js), for A11:
    // intro.state(name, data), intro.close(), and intro.flyHome(room), which tears the screen away and
    // resolves once the camera is in front of the pod, with its door.
    intro: {
      state: (name, data) => intro.state(name, data),
      close: () => intro.close(),
      flyHome: async (room) => {
        // The welcome has its moment first; the world's controls stay away until the camera is there.
        await intro.held();
        intro.close({ keepHud: true });
        // From the planet (B25): the warp in, the screen goes blank, and you wake up in the dome.
        let landed;
        if (space.active) {
          await space.dive();
          landed = await arrival.wake(room);
        } else landed = await arrival.fly(room);
        intro.revealHud();
        return landed;
      },
      get open() {
        return !$('loading').classList.contains('done');
      },
    },
    prewarm: warmUp,
    // The sale's farewell (B, 10-22; the user: being sent off the island was "too abrupt"). Out of its
    // home, the grey Chog walks out through its dome's door and away down the walk, slow and alone; the
    // camera stays behind it, then rises as it goes. Resolves after `stay` seconds, the camera still
    // moving (it keeps on under the white of the flight out, then lets go).
    farewell: ({ room, chog, stay = 7.5 }) =>
      new Promise((resolve) => {
        const i = Number(room.id.slice(4));
        const d = DOMES[i];
        if (!d || !chog) return resolve();
        const out = new THREE.Vector3(Math.sin(d.facing), 0, Math.cos(d.facing));
        const door = new THREE.Vector3(d.doorX, 0, d.doorZ);
        const ground = (p) => travel?.groundAt?.(p.x, p.z, 999)?.y ?? baseY(HOODS[d.hood]);
        // Its way: from a few steps inside its dome, out of the door and on down the walk.
        const from = door.clone().addScaledVector(out, -2.5);
        const to = door.clone().addScaledVector(out, 7.5);
        from.y = ground(from);
        to.y = ground(to);
        // The camera: inside the dome behind it, a little above; it rises as the Chog goes.
        const cam0 = door.clone().addScaledVector(out, -9.5);
        cam0.y = from.y + 1.9;
        const cam1 = cam0.clone().addScaledVector(out, 1.5).add(new THREE.Vector3(0, 4.6, 0));
        const look = new THREE.Vector3(), at = new THREE.Vector3(), pos = new THREE.Vector3();
        const walkS = 9;
        let t = 0;
        let done = false, stopped = false;
        fadeThrough(() => {
          leaveRoomUI();
          VIEWS.farewell = { pos: cam0.clone(), target: door.clone().setY(from.y + 1.2) };
          rig.jump('farewell');
          scene.add(chog.root);
          chog.root.position.copy(from);
          chog.root.rotation.y = Math.atan2(out.x, out.z);
          chog.root.visible = true;
          chog.setFade(1);
          chog.play('walk');
          // A slow walk, its feet keeping to the ground (its pace from how fast its walk clip goes).
          const v = from.distanceTo(to) / walkS;
          chog.setPace?.(v / (chog.speedOf?.('walk') || v));
          cutCam = (camera, dt) => {
            t += dt;
            const k = Math.min(1, t / walkS);
            at.lerpVectors(from, to, k);
            at.y = ground(at);
            chog.root.position.copy(at);
            if (k >= 1 && !stopped) {
              stopped = true;
              chog.play('idle');
            }
            // Still for a moment, then up.
            const u = THREE.MathUtils.smootherstep(t, 1.6, walkS + 2);
            pos.lerpVectors(cam0, cam1, u);
            camera.position.copy(pos);
            look.copy(at).setY(at.y + 1.1 - 1.6 * u).addScaledVector(out, 3.5 * u);
            camera.lookAt(look);
            if (!done && t >= stay) {
              done = true;
              resolve();
            }
            // Under the white and into the film by now.
            return t < stay + 3.2;
          };
        });
      }),
    blackout: (title, sub) =>
      new Promise((resolve) => {
        $('fade').classList.add('on', 'slow');
        const story = $('story');
        story.querySelector('.story-title').textContent = title;
        story.querySelector('.story-sub').textContent = sub;
        story.hidden = false;
        requestAnimationFrame(() => story.classList.add('on'));
        setTimeout(() => {
          story.classList.remove('on');
          setTimeout(() => {
            story.hidden = true;
            $('fade').classList.remove('slow');
            resolve();
          }, 450);
        }, 3800);
      }),
  });
  // The casino's game (B8): its panel shows while you're inside.
  // The postcard camera (B19): the view, framed and saved as a PNG.
  // (A, 10-21: where you are, and your Chog's art for the stamp; then a sheet to share it.)
  $('btn-photo')?.addEventListener('click', () => {
    const own = session?.active?.info, guest = travel?.active ? travel.guest : null;
    const id = own?.id ?? guest?.id ?? null;
    postcard({
      frame,
      canvas: renderer.domElement,
      name: own?.name ?? guest?.name ?? 'Chog World',
      place: inRoom?.room?.name ?? (travel?.active ? travel.placeName() : 'Chog World'),
      art: id ? `${import.meta.env.BASE_URL}art/${id}.webp` : null,
    });
  });
  casino = createCasino({ room: island.rooms.find((r) => r.id === 'casino'), rig, camera, dom: renderer.domElement, session: () => session, entering: () => !!entry?.active, sky });
  // The session warms its Chogs' shaders as it starts: the loader waits for those too.
  await Promise.race([Promise.all([session.warmed, space.ready, ...warming]), new Promise((r) => setTimeout(r, 15000))]);
  load.finish({ keep: withIntro });
  if (params.has('debug')) window.chogDebug = debug = createDebug({ renderer, post, sky });
  if (SHOTS[params.get('demo')]) {
    const capture = params.has('capture') || params.has('at');
    demo = createDemo(shotWorld(), params.get('demo'), { capture, from: params.has('at') ? parseFloat(params.get('at')) : null });
  }
  // ?space opens on the world seen from space.
  if (params.has('space')) space.enter({ duration: 0 });
  if (withIntro) {
    space.enter({ duration: 0 });
    intro.ready();
    // The still behind the screen gives way to the planet once it's painted and drawn.
    space.ready.then(() => requestAnimationFrame(() => requestAnimationFrame(() => intro.live())));
    // A11 drives the screen through sign-in (session.startIntro); until then, Connect opens the
    // sign-in panel and a guest is flown back down to the world.
    if (session.startIntro) session.startIntro(intro);
    else {
      intro.state('connect', {
        connect: () => intro.close().then(() => $('btn-signin').click()),
        guest: () => intro.close().then(() => space.leave({ duration: 2.5 })),
      });
    }
  }
  if (import.meta.env.DEV) window.chogWorld = { THREE, time, rig, camera, post, scene, sky, island, clouds, renderer, frame, VIEWS, perf, audio, get session() { return session; }, get npcs() { return npcs; }, space, get entry() { return entry; }, get intro() { return intro; }, get arrival() { return arrival; }, get casino() { return casino; }, get travel() { return travel; }, get birds() { return birds; }, get race() { return race; }, get stars() { return stars; }, enterRoom: (id) => enterRoom(island.rooms.find((r) => r.id === id)), back: () => $('btn-back').click() };
}

// ?demo=<shot>: one of the demo video's shots (src/shots.js), with the interface hidden. What a shot
// drives in the world, and how it waits for the world to be ready.
let demo = null;
function shotWorld() {
  const room = (id) => island.rooms.find((r) => r.id === id);
  return {
    camera,
    rig,
    time,
    space,
    intro,
    get session() {
      return session;
    },
    get casino() {
      return casino;
    },
    get entry() {
      return entry;
    },
    // What the trailer's shots pose and stage (B, 10-22): the island, its creatures, the boards.
    scene,
    island,
    get birds() {
      return birds;
    },
    get travel() {
      return travel;
    },
    enterRoom: (id) => enterRoom(room(id)),
    inRoom: (id) => rig.room === room(id)?.pod,
    // Models still loading or shaders still warming, which a shot waits for before it starts.
    busy: () => warming.size > 0 || !!npcs?.loading,
    // One frame of the world (a held take draws its own).
    frame,
    loop: (on) => renderer.setAnimationLoop(on ? loop : null),
  };
}

// UI.
const slider = $('time-slider');
slider.addEventListener('input', () => {
  time.live = false;
  time.hour = parseFloat(slider.value);
  $('btn-live').classList.remove('active');
});
$('btn-live').addEventListener('click', () => {
  time.live = true;
  $('btn-live').classList.add('active');
});
// Place buttons visit the same framed spots as tapping; the rest are fixed camera views.
const PLACE_FOR_VIEW = { downtown: 'hub', neighbourhood: 'hood0', dome: 'dome2' };
// On phones the places live in a menu behind one button that names the current view.
const placesMenu = $('places');
const placesToggle = $('places-toggle');
function setMenu(open) {
  placesMenu.classList.toggle('open', open);
  placesToggle.setAttribute('aria-expanded', String(open));
}
function markView(view) {
  document.querySelectorAll('[data-view]').forEach((o) => o.classList.toggle('active', o.dataset.view === view));
  const b = document.querySelector(`[data-view="${view}"]`);
  $('places-current').textContent = b ? b.textContent : 'Places';
}
placesToggle.addEventListener('click', () => setMenu(!placesMenu.classList.contains('open')));
renderer.domElement.addEventListener('pointerdown', () => setMenu(false));
document.querySelectorAll('[data-view]').forEach((b) =>
  b.addEventListener('click', () => {
    const placeId = PLACE_FOR_VIEW[b.dataset.view];
    const place = placeId && pickables.find((m) => m.userData.place.id === placeId)?.userData.place;
    leaveRoomUI();
    if (place) rig.focusOn(place);
    // Going indoors is a quick fade; everywhere else the camera flies.
    else if (VIEWS[b.dataset.view].enter || rig.room) fadeThrough(() => rig.jump(b.dataset.view));
    else rig.go(b.dataset.view);
    markView(b.dataset.view);
    setMenu(false);
  }),
);
// iOS Safari ignores the viewport lock for pinches and double taps, so stop those gestures here.
for (const type of ['gesturestart', 'gesturechange', 'dblclick']) document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
document.addEventListener('touchmove', (e) => e.touches.length > 1 && e.preventDefault(), { passive: false });

function resize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  if (!(rig.room instanceof RoomBox)) camera.fov = outdoorFov();
  camera.updateProjectionMatrix();
  // Turned the phone, or resized the window, while looking at the whole world: fit it again.
  if (island && rig.view === 'overview' && !rig.focused) {
    fitOverview(rig.goal.theta);
    rig.jump('overview');
  }
  renderer.setPixelRatio(BASE_DPR * perf.scale);
  renderer.setSize(window.innerWidth, window.innerHeight);
  post.setPixelRatio(renderer.getPixelRatio());
  post.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resize);

// Tap a place to visit it; tap again, tap the sky or press Back to leave.
const ray = new THREE.Raycaster();
const pickables = [];
function buildPickables() {
  const proxyMat = new THREE.MeshBasicMaterial();
  const add = (mesh, place) => {
    mesh.updateMatrixWorld(true);
    mesh.userData.place = place;
    pickables.push(mesh);
  };
  DOMES.forEach((d, i) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(DOME_R, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), proxyMat);
    m.position.set(d.x, d.y, d.z);
    const label = { meadow: 'Meadow dome', frost: 'Frost dome', grove: 'Grove dome' }[d.biome];
    add(m, { id: `dome${i}`, name: label, center: new THREE.Vector3(d.x, d.y + 4, d.z), radius: DOME_R + 3, theta: d.facing, phi: 1.12, rooms: [`home${i}`] });
  });
  const hub = island.hub;
  const box = new THREE.Mesh(new THREE.BoxGeometry(hub.width, hub.height, hub.depth), proxyMat);
  box.position.set(DOWNTOWN.x, T + hub.height / 2, DOWNTOWN.z);
  add(box, { id: 'hub', name: 'Chog Hub', center: new THREE.Vector3(DOWNTOWN.x, T + 7, DOWNTOWN.z), radius: hub.width * 0.42, theta: 0.25, phi: 1.2, rooms: ['lobby', 'bar', 'casino'] });
  island.terrain.tops.forEach((top, i) => {
    const isl = ISLANDS[i];
    const name = isl.id === 'downtown' ? 'Downtown' : `Neighbourhood ${Number(isl.id.slice(4)) + 1}`;
    top.userData.place = { id: isl.id, name, center: new THREE.Vector3(isl.x, baseY(isl), isl.z), radius: isl.r * 1.05, phi: 0.95 };
    pickables.push(top);
  });
}
rig.onTap = (x, y) => {
  if (!island) return;
  // At a casino game every tap is the game's (a bet on the felt), never a tap on your Chog (the user, 10-21:
  // each click on the roulette board opened the chat).
  if (casino?.state?.mode) return;
  if (session?.tapChog(x, y)) return;
  // Inside a room a tap belongs to the room (the casino's machines), never to the places outside.
  if (rig.room instanceof RoomBox) return;
  ray.setFromCamera(new THREE.Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1), camera);
  const hits = ray.intersectObjects(pickables, false);
  // Prefer a dome or the Hub over the island it sits on.
  const hit = hits.find((h) => !h.object.userData.place.id.startsWith('hood') && h.object.userData.place.id !== 'downtown') ?? hits[0];
  const place = hit?.object.userData.place;
  if (rig.focused && (!place || place.id === rig.focused.id)) rig.exitFocus();
  else if (place) rig.focusOn(place);
};
// While visiting a place, the pill offers its rooms (the Hub's lobby and bar, a dome's home). Inside a
// room, Back returns to the place it belongs to.
let inRoom = null;
function showBar(name, rooms = []) {
  $('focus-bar').hidden = false;
  $('nav-hint').classList.add('faded');
  $('focus-name').textContent = name;
  const box = $('focus-actions');
  box.replaceChildren(
    ...rooms.map((id) => {
      const r = island.rooms.find((x) => x.id === id);
      const b = document.createElement('button');
      b.textContent = r.name;
      b.addEventListener('click', () => enterRoom(r));
      return b;
    }),
  );
}
function enterRoom(r) {
  const place = pickables.find((m) => m.userData.place.id === r.place)?.userData.place;
  inRoom = { room: r, place };
  markView(null);
  // From outside, the Hub's rooms are flown into through their doors; anything else fades.
  if (entry.can(r) && !space.active) {
    $('focus-bar').hidden = true;
    // Walked up to its door (src/travel.js): your Chog goes in itself, the camera behind it.
    const t = travel?.state;
    const walker = t?.chog && t.lastDoor?.room === r ? { chog: t.chog, own: t.own, home: t.chog.root.parent, exit: t.lastDoor } : null;
    entry.enter(r, { walker }).then(() => inRoom?.room === r && showBar(r.name));
    return;
  }
  fadeThrough(() => {
    space.leave();
    rig.jump(r.id);
  });
  showBar(r.name);
}
function leaveRoomUI() {
  if (!inRoom) return;
  inRoom = null;
  $('focus-bar').hidden = true;
}
rig.onFocusChange = (place) => {
  if (place) {
    inRoom = null;
    showBar(place.name, place.rooms);
  } else if (!inRoom) {
    $('focus-bar').hidden = true;
    document.querySelectorAll('[data-view]').forEach((o) => o.classList.remove('active'));
    $('places-current').textContent = 'Places';
  }
};
$('btn-back').addEventListener('click', () => {
  if (inRoom?.place) {
    const { place, room } = inRoom;
    inRoom = null;
    if (entry.canLeave(room)) {
      $('focus-bar').hidden = true;
      entry.leave(room, place);
    } else fadeThrough(() => rig.focusOn(place, { instant: true }));
  } else rig.exitFocus();
});

$('nav-hint').textContent = TOUCH
  ? 'Swipe to look around · Two fingers to move · Pinch to zoom · Twist to turn · Tap a place to visit, tap again to leave'
  : 'Drag to look around · Right-drag to move · Scroll to zoom · Click a place to visit, click again or Esc to leave';
setTimeout(() => $('nav-hint')?.classList.add('faded'), 14000);

// Keeps the frame rate up on slow machines: lowers resolution first, then detail.
const perf = { ema: 16, scale: 1, quality: { low: 0, medium: 1 }[QUALITY] ?? 2, check: 0, frames: 0, fpsT: 0 };
function tunePerf(realMs, dt) {
  // Ignore stalls (tab in the background, window dragged): they are not render cost.
  perf.frames++;
  perf.fpsT += dt;
  if (perf.fpsT > 0.5) {
    const fps = $('fps');
    if (fps) fps.textContent = `${Math.round(perf.frames / perf.fpsT)} fps`;
    perf.frames = 0;
    perf.fpsT = 0;
  }
  // Only ?q=auto trades looks for speed; otherwise the chosen quality holds.
  if (realMs > 250 || QUALITY !== 'auto') return;
  perf.ema += (realMs - perf.ema) * 0.08;
  perf.check += dt;
  if (perf.check < 1.5) return;
  perf.check = 0;
  if (perf.ema > 38) {
    if (perf.scale > 0.6) {
      perf.scale = Math.round((perf.scale - 0.1) * 10) / 10;
      resize();
    } else if (perf.quality > 0) {
      island.setQuality(--perf.quality);
    }
  } else if (perf.ema < 20) {
    if (perf.quality < 2 && perf.scale >= 1) island.setQuality(++perf.quality);
    else if (perf.scale < 1) {
      perf.scale = Math.round((perf.scale + 0.1) * 10) / 10;
      resize();
    }
  }
}

const timer = new THREE.Timer();
timer.connect(document);
let lastClock = '';
let lastShadowHour = -1;
let indoorK = 0;

// While nothing is moving (camera still, clock not being scrubbed) a fast machine skips every
// other frame: the world keeps swaying and drifting at 30 fps and the machine gets a rest.
// Machines already under 40 fps are left alone.
const calm = { since: 0, last: 0, view: new THREE.Matrix4(), hour: 0, gap: 16 };
function loop(now) {
  const gap = now - calm.last;
  const still = now - calm.since > 500;
  if (still && calm.gap < 25 && gap < 30) return;
  if (!still && gap < 200) calm.gap += (gap - calm.gap) * 0.1;
  calm.last = now;
  frame();
  const hour = currentHour();
  if (!calm.view.equals(camera.matrixWorld) || Math.abs(hour - calm.hour) > 1e-3) calm.since = now;
  calm.view.copy(camera.matrixWorld);
  calm.hour = hour;
}

function frame() {
  const cpu0 = performance.now();
  debug?.begin();
  timer.update();
  const realDt = timer.getDelta();
  const dt = Math.min(realDt, 0.05);
  const t = demo?.worldT ?? timer.getElapsed();
  const hour = currentHour();
  if (time.live) slider.value = hour.toFixed(2);

  frameDt = dt;
  // Out walking, your Chog has the camera; otherwise the rig does (rooms, cutscenes, space).
  if (!travel?.update(dt)) rig.update(dt);
  // Out walking the camera is outdoors, whatever dome the rig last framed (your own Chog sets off from
  // its dome, and the Hub's doors only open from outside every room and dome).
  else if (rig.room && !(rig.room instanceof RoomBox)) rig.room = null;
  demo?.update();
  space?.update();
  entry?.update(dt, travel?.active ? travel.chog?.root : null);
  arrival?.update(dt);
  // (It lets go to the warp, if the flight out has no film to play: the warp has the lens then.)
  if (cutCam && (space?.fov() != null || cutCam(camera, dt) === false)) cutCam = null;
  // A wider lens indoors, wider still on a tall phone screen, so a room fits in view.
  // Warp speed (B25) has the lens to itself.
  const warpFov = space?.fov();
  const fov = warpFov ?? entry?.fov() ?? (rig.room instanceof RoomBox ? (camera.aspect < 1 ? 64 : 52) : outdoorFov());
  if (Math.abs(camera.fov - fov) > 0.05) {
    camera.fov = warpFov ?? camera.fov + (fov - camera.fov) * Math.min(1, dt * 4);
    camera.updateProjectionMatrix();
    setGlowFov(camera.fov);
  }
  const dist = rig.focusDist;
  sky.fog.near = 600 + dist * 1.3;
  sky.fog.far = sky.fog.near + 2600;
  const env = sky.update(hour, camera, t);
  setChogSun(sky.light, env.night);
  space?.apply();
  // The shadow box covers the whole world, so only the sun moving calls for a fresh shadow map.
  if (Math.abs(hour - lastShadowHour) > 0.02) {
    renderer.shadowMap.needsUpdate = true;
    lastShadowHour = hour;
  }
  wind.uTime.value = t;
  island.update(env, t, camera, dt);
  // (Quiet over the connect screen and through the flights down: it starts when you land, the user 10-22.)
  audio.update(dt, { camera, night: env.night, indoors: rig.room instanceof RoomBox || !!inRoom, stage: stagePos(), quiet: document.body.classList.contains('intro-open') || !!arrival?.active || !!space?.active || !!entry?.active && !rig.room });
  travel?.setEnv?.(env);
  entry?.apply(env, renderer);
  session?.update(dt);
  // (Only while its room is the one drawn: its chips once showed in the lobby, the user 10-21.)
  casino?.show(!entry?.active && rig.room === casino.room.pod && casino.room.room.group.visible);
  casino?.update(dt, env);
  npcs?.update(dt, camera, env, renderer, travel?.active ? travel.chog?.root : null, travel?.boards);
  race?.update(dt);
  stars?.update(dt, env);
  // Near your Chog out walking, else near what the camera looks at; hidden in rooms and in space.
  if (birds) {
    const me = travel?.active && travel.chog ? travel.chog.root.getWorldPosition(birdMe) : null;
    birds.update(dt, camera, env, { focus: me ? birdFocus.copy(me) : birdFocus.copy(rig.target), me, outdoors: !(rig.room instanceof RoomBox) && !space?.active });
  }
  // On a lighter look, settled in a room, the clouds fade out: they show only through its windows and
  // cost nearly half a frame. They come back as you leave, before the doors open.
  // In the casino (no windows) they never show, so they stop there on every machine.
  const settled = (LIGHT || rig.room === casino?.room.pod) && rig.room instanceof RoomBox && !entry?.active && !arrival?.active;
  indoorK = THREE.MathUtils.clamp(indoorK + (settled ? dt : -dt) / 0.8, 0, 1);
  clouds?.setIndoor(indoorK);
  clouds?.update(env, sky, t);

  const hh = Math.floor(hour) % 24, mm = Math.floor((hour % 1) * 60);
  const label = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}|${phaseName(hour, env.night)}`;
  if (label !== lastClock) {
    lastClock = label;
    const [clk, phase] = label.split('|');
    $('clock-time').textContent = clk;
    $('clock-phase').textContent = phase;
  }

  // A room's neon (the casino's) asks the bloom for more than the night alone would give.
  post.setNight(Math.max(env.night, casino?.glow ?? 0));
  // A demo shot's long seek moves the world on without drawing every step.
  const drawn = !demo || demo.draws;
  if (drawn && debug && !debug.state.post) {
    renderer.render(scene, camera);
    renderer.autoClear = false;
    renderer.render(post.overlay, camera);
    renderer.autoClear = true;
  } else if (drawn) post.render(dt);
  // A shot holds its quality (and a held take's time isn't the GPU's).
  if (!demo) tunePerf(realDt * 1000, realDt);
  debug?.end(realDt, performance.now() - cpu0);
}

init().catch((err) => {
  console.error(err);
  $('loading').querySelector('.sub').textContent = 'Could not load the island. Check the console.';
});
