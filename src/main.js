import * as THREE from 'three';
import { loadAll } from './assets.js';
import { Sky } from './sky.js';
import { Post } from './post.js';
import { buildIsland } from './island.js';
import { CameraRig } from './camera.js';
import { wind } from './foliage.js';
import { DOMES, DOME_R, WORLD, HOODS, CAFE } from './layout.js';
import { rng as makeRng } from './util.js';

const $ = (id) => document.getElementById(id);

const BASE_DPR = Math.min(window.devicePixelRatio, 1.25);
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.setPixelRatio(BASE_DPR);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.toneMapping = THREE.NoToneMapping;
$('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.3, 2400);
const sky = new Sky(scene, renderer);

// Framed views for judging the look.
const L = WORLD.landH;
const home = DOMES[2];
const fwd = (d, k) => new THREE.Vector3(d.x + Math.sin(d.facing) * k, 0, d.z + Math.cos(d.facing) * k);
const hood = HOODS[0];
const VIEWS = {
  overview: { pos: new THREE.Vector3(360, 190, 380), target: new THREE.Vector3(0, -30, 0) },
  below: { pos: new THREE.Vector3(230, -150, 260), target: new THREE.Vector3(0, -20, 0) },
  downtown: { pos: new THREE.Vector3(14, L + 10, 26), target: new THREE.Vector3(0, L + 2.5, CAFE.z) },
  neighbourhood: { pos: new THREE.Vector3(hood.x + 40, L + 38, hood.z - 70), target: new THREE.Vector3(hood.x, L + 2, hood.z + 10) },
  dome: { pos: fwd(home, DOME_R + 18).setY(L + 5), target: new THREE.Vector3(home.x, L + 6, home.z) },
  inside: { pos: fwd(home, DOME_R - 3).setY(L + 2.2), target: fwd(home, -4).setY(L + 3.5) },
  ground: { pos: new THREE.Vector3(1.5, L + 1.8, 34), target: new THREE.Vector3(0, L + 3.5, 100) },
  sky: { pos: new THREE.Vector3(-20, L + 3, 40), target: new THREE.Vector3(-60, L + 70, -120) },
};
const rig = new CameraRig(camera, renderer.domElement, VIEWS);
const post = new Post(renderer, scene, camera);

let island;

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
  island = buildIsland(scene, makeRng(1969), renderer, sky);
  island.setQuality(perf.quality);
  $('loading').classList.add('done');
  // Optional ?view=dome&hour=22 in the address, handy for sharing a specific shot.
  const params = new URLSearchParams(location.search);
  if (params.has('hour')) {
    time.live = false;
    time.hour = parseFloat(params.get('hour'));
    $('btn-live').classList.remove('active');
  }
  if (VIEWS[params.get('view')]) rig.jump(params.get('view'));
  renderer.setAnimationLoop(frame);
  if (import.meta.env.DEV) window.chogWorld = { THREE, time, rig, camera, post, scene, sky, island, renderer, frame, VIEWS, perf };
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
document.querySelectorAll('[data-view]').forEach((b) =>
  b.addEventListener('click', () => {
    rig.go(b.dataset.view);
    document.querySelectorAll('[data-view]').forEach((o) => o.classList.toggle('active', o === b));
  }),
);

function resize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(BASE_DPR * perf.scale);
  renderer.setSize(window.innerWidth, window.innerHeight);
  post.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resize);

// Double-click the ground to fly there.
const ray = new THREE.Raycaster();
renderer.domElement.addEventListener('dblclick', (e) => {
  if (!island) return;
  ray.setFromCamera(new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1), camera);
  const hit = ray.intersectObjects(island.terrain.tops, false)[0];
  if (hit) rig.focusOn(hit.point);
});
setTimeout(() => $('nav-hint')?.classList.add('faded'), 25000);

// Keeps the frame rate up on slow machines: lowers resolution first, then detail.
const perf = { ema: 16, scale: 1, quality: 2, check: 0, frames: 0, fpsT: 0 };
function tunePerf(realMs, dt) {
  // Ignore stalls (tab in the background, window dragged): they are not render cost.
  if (realMs > 250) return;
  perf.ema += (realMs - perf.ema) * 0.08;
  perf.frames++;
  perf.fpsT += dt;
  if (perf.fpsT > 0.5) {
    $('fps').textContent = `${Math.round(perf.frames / perf.fpsT)} fps`;
    perf.frames = 0;
    perf.fpsT = 0;
  }
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
const lastShadow = { focus: new THREE.Vector3(1e9, 0, 0), hour: -1, r: 0, frames: 0 };

function frame() {
  timer.update();
  const realDt = timer.getDelta();
  const dt = Math.min(realDt, 0.05);
  const t = timer.getElapsed();
  const hour = currentHour();
  if (time.live) slider.value = hour.toFixed(2);

  rig.update(dt);
  // Shadows cover what the camera is looking at, sized to how far away it is.
  const dist = rig.focusDist;
  sky.focus.copy(rig.focus);
  sky.focusR = Math.round(Math.min(80, Math.max(24, dist * 0.55)) / 8) * 8;
  sky.fog.near = 220 + dist * 0.9;
  sky.fog.far = sky.fog.near + 1300;
  const env = sky.update(hour, camera, t);
  lastShadow.frames++;
  if (sky.focus.distanceTo(lastShadow.focus) > 3 || Math.abs(hour - lastShadow.hour) > 0.02 || sky.focusR !== lastShadow.r || lastShadow.frames > 90) {
    renderer.shadowMap.needsUpdate = true;
    lastShadow.focus.copy(sky.focus);
    lastShadow.hour = hour;
    lastShadow.r = sky.focusR;
    lastShadow.frames = 0;
  }
  wind.uTime.value = t;
  island.update(env, t, camera);

  const hh = Math.floor(hour) % 24, mm = Math.floor((hour % 1) * 60);
  const label = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}|${phaseName(hour, env.night)}`;
  if (label !== lastClock) {
    lastClock = label;
    const [clk, phase] = label.split('|');
    $('clock-time').textContent = clk;
    $('clock-phase').textContent = phase;
  }

  post.render(dt);
  tunePerf(realDt * 1000, realDt);
}

init().catch((err) => {
  console.error(err);
  $('loading').querySelector('.sub').textContent = 'Could not load the island. Check the console.';
});
