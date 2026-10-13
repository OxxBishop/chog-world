import * as THREE from 'three';
import { loadAll } from './assets.js';
import { Sky } from './sky.js';
import { createVolumetricClouds } from './volclouds.js';
import { Post } from './post.js';
import { createDebug } from './debug.js';
import { buildIsland } from './island.js';
import { CameraRig } from './camera.js';
import { wind } from './foliage.js';
import { DOMES, DOME_R, HOODS, ISLANDS, DOWNTOWN, baseY } from './layout.js';
import { loadKit } from './kaykit.js';
import { HUB_KIT } from './hub.js';
import { LANDMARK_KIT } from './landmarks.js';
import { rng as makeRng } from './util.js';

const $ = (id) => document.getElementById(id);

const params = new URLSearchParams(location.search);
const TOUCH = window.matchMedia('(pointer: coarse)').matches;
// Quality: the full look by default. ?q=medium or ?q=low for slower machines, ?q=auto to adapt
// on the fly, ?q=ultra for the sharpest cloud shadows.
const QUALITY = ['low', 'medium', 'high', 'ultra', 'auto'].includes(params.get('q')) ? params.get('q') : 'high';
const BASE_DPR = Math.min(window.devicePixelRatio, { low: 1, ultra: 2 }[QUALITY] ?? 1.5);
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.setPixelRatio(BASE_DPR);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = QUALITY !== 'low';
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.toneMapping = THREE.NoToneMapping;
$('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.3, 2400);
const sky = new Sky(scene, renderer);
if (QUALITY === 'medium') sky.light.shadow.mapSize.set(2048, 2048);

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
  inside: { pos: fwd(home, DOME_R - 3).setY(home.y), target: fwd(home, -4).setY(home.y + 1.3) },
  ground: { pos: new THREE.Vector3(2, T + 1.8, 56), target: new THREE.Vector3(10, T + 3.5, 130) },
  sky: { pos: new THREE.Vector3(-20, T + 3, 60), target: new THREE.Vector3(-60, T + 70, -100) },
};
const rig = new CameraRig(camera, renderer.domElement, VIEWS);
const post = new Post(renderer, scene, camera);
post.setPixelRatio(renderer.getPixelRatio());

let island;
let clouds;
let debug = null;

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
  await loadAll((p) => ($('loading').querySelector('.sub').textContent = `Waking the island... ${Math.round(p * 100)}%`));
  await document.fonts.load('600 120px Fredoka').catch(() => {});
  await loadKit([...new Set([...HUB_KIT, ...LANDMARK_KIT])]);
  island = buildIsland(scene, makeRng(1969), renderer, sky, post.overlay);
  island.setQuality(perf.quality);
  buildPickables();
  // Compile shaders and draw a couple of frames behind the loading screen, so the first frame you see is finished.
  $('loading').querySelector('.sub').textContent = 'Gathering clouds...';
  // If the clouds can't load (offline, blocked download), the world still opens without them.
  try {
    clouds = await createVolumetricClouds(renderer, camera);
    clouds.setQuality(QUALITY === 'auto' ? 'high' : QUALITY);
    post.addClouds(clouds.effects);
  } catch (err) {
    console.error('Clouds unavailable', err);
  }
  $('loading').querySelector('.sub').textContent = 'Lighting the sky...';
  await renderer.compileAsync(scene, camera).catch(() => {});
  frame();
  frame();
  // Wait for the GPU to finish that first work (shader builds, texture uploads) while the loader
  // is still up, then give it a couple of real frames, so the world appears already running smoothly.
  const gl = renderer.getContext();
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  for (let i = 0; i < 3; i++) {
    await new Promise(requestAnimationFrame);
    frame();
  }
  $('loading').classList.add('done');
  // Optional ?view=dome&hour=22 in the address, handy for sharing a specific shot.
  if (params.has('hour')) {
    time.live = false;
    time.hour = parseFloat(params.get('hour'));
    $('btn-live').classList.remove('active');
  }
  if (VIEWS[params.get('view')]) {
    rig.jump(params.get('view'));
    // Highlight the view it opened on, not Overview.
    markView(params.get('view'));
  }
  renderer.setAnimationLoop(loop);
  if (params.has('debug')) window.chogDebug = debug = createDebug({ renderer, post, sky });
  if (import.meta.env.DEV) window.chogWorld = { THREE, time, rig, camera, post, scene, sky, island, clouds, renderer, frame, VIEWS, perf };
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
    if (place) rig.focusOn(place);
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
  camera.updateProjectionMatrix();
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
    add(m, { id: `dome${i}`, name: label, center: new THREE.Vector3(d.x, d.y + 4, d.z), radius: DOME_R + 3, theta: d.facing, phi: 1.12 });
  });
  const hub = island.hub;
  const box = new THREE.Mesh(new THREE.BoxGeometry(hub.width, hub.height, hub.depth), proxyMat);
  box.position.set(DOWNTOWN.x, T + hub.height / 2, DOWNTOWN.z);
  add(box, { id: 'hub', name: 'Chog Hub', center: new THREE.Vector3(DOWNTOWN.x, T + 7, DOWNTOWN.z), radius: hub.width * 0.42, theta: 0.25, phi: 1.2 });
  island.terrain.tops.forEach((top, i) => {
    const isl = ISLANDS[i];
    const name = isl.id === 'downtown' ? 'Downtown' : `Neighbourhood ${Number(isl.id.slice(4)) + 1}`;
    top.userData.place = { id: isl.id, name, center: new THREE.Vector3(isl.x, baseY(isl), isl.z), radius: isl.r * 1.05, phi: 0.95 };
    pickables.push(top);
  });
}
rig.onTap = (x, y) => {
  if (!island) return;
  ray.setFromCamera(new THREE.Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1), camera);
  const hits = ray.intersectObjects(pickables, false);
  // Prefer a dome or the Hub over the island it sits on.
  const hit = hits.find((h) => !h.object.userData.place.id.startsWith('hood') && h.object.userData.place.id !== 'downtown') ?? hits[0];
  const place = hit?.object.userData.place;
  if (rig.focused && (!place || place.id === rig.focused.id)) rig.exitFocus();
  else if (place) rig.focusOn(place);
};
rig.onFocusChange = (place) => {
  $('focus-bar').hidden = !place;
  // The pill takes the hint's spot above the time bar.
  if (place) $('nav-hint').classList.add('faded');
  if (place) $('focus-name').textContent = place.name;
  if (!place) {
    document.querySelectorAll('[data-view]').forEach((o) => o.classList.remove('active'));
    $('places-current').textContent = 'Places';
  }
};
$('btn-back').addEventListener('click', () => rig.exitFocus());

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
    $('fps').textContent = `${Math.round(perf.frames / perf.fpsT)} fps`;
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
  const t = timer.getElapsed();
  const hour = currentHour();
  if (time.live) slider.value = hour.toFixed(2);

  rig.update(dt);
  const dist = rig.focusDist;
  sky.fog.near = 600 + dist * 1.3;
  sky.fog.far = sky.fog.near + 2600;
  const env = sky.update(hour, camera, t);
  // The shadow box covers the whole world, so only the sun moving calls for a fresh shadow map.
  if (Math.abs(hour - lastShadowHour) > 0.02) {
    renderer.shadowMap.needsUpdate = true;
    lastShadowHour = hour;
  }
  wind.uTime.value = t;
  island.update(env, t, camera, dt);
  clouds?.update(env, sky, t);

  const hh = Math.floor(hour) % 24, mm = Math.floor((hour % 1) * 60);
  const label = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}|${phaseName(hour, env.night)}`;
  if (label !== lastClock) {
    lastClock = label;
    const [clk, phase] = label.split('|');
    $('clock-time').textContent = clk;
    $('clock-phase').textContent = phase;
  }

  post.setNight(env.night);
  if (debug && !debug.state.post) {
    renderer.render(scene, camera);
    renderer.autoClear = false;
    renderer.render(post.overlay, camera);
    renderer.autoClear = true;
  } else post.render(dt);
  tunePerf(realDt * 1000, realDt);
  debug?.end(realDt, performance.now() - cpu0);
}

init().catch((err) => {
  console.error(err);
  $('loading').querySelector('.sub').textContent = 'Could not load the island. Check the console.';
});
