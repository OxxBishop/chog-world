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
import { READY } from './traitmap.js';
import { rng as makeRng } from './util.js';
import { createLoader, prewarm } from './loader.js';
import { SHOTS, createFlight } from './flight.js';
import { createSpace } from './space.js';
import { createEntry } from './entry.js';
import { createIntro } from './intro.js';
import { createArrival } from './arrival.js';

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
const camera = new THREE.PerspectiveCamera(outdoorFov(), window.innerWidth / window.innerHeight, 0.3, 2600);
const sky = new Sky(scene, renderer);
if (QUALITY === 'medium') sky.light.shadow.mapSize.set(2048, 2048);

// The lens: 42 degrees top to bottom, opened up on a tall phone screen so its width still takes in
// at least 36 degrees.
function outdoorFov() {
  const aspect = window.innerWidth / window.innerHeight;
  const needed = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(18)) / aspect));
  return Math.min(70, Math.max(42, needed));
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
let npcs = null;
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
  // The first screen (src/intro.js): the load, then connect or explore as a guest.
  intro = createIntro($('loading'));
  // Each step's share of the loading bar, roughly how long it takes.
  const load = createLoader($('loading'), [
    ['download', 5, 'Waking the island'],
    ['build', 3, 'Raising the islands'],
    ['shaders', 4, 'Lighting the sky'],
    ['frames', 1, 'Almost there'],
  ]);
  // The nature models, the building kits and the sign font all download at once.
  const got = { models: 0, kit: 0, furniture: 0, font: 0 };
  const weight = { models: 0.7, kit: 0.15, furniture: 0.1, font: 0.05 };
  const part = (k) => (f) => {
    got[k] = f;
    load.set('download', Object.keys(got).reduce((sum, x) => sum + got[x] * weight[x], 0));
  };
  await Promise.all([
    loadAll(part('models')),
    loadKit([...new Set([...HUB_KIT, ...LANDMARK_KIT])], 'kaykit', part('kit')),
    loadKit(FURNITURE_KIT, 'furniture', part('furniture')),
    document.fonts.load('600 120px Fredoka').catch(() => {}).then(() => part('font')(1)),
  ]);
  // The clouds are not needed for the first frame. Their pass joins the post chain now, held off;
  // they download once the world is showing, and fade in.
  clouds = createVolumetricClouds(renderer, camera);
  clouds.setQuality(QUALITY === 'auto' ? 'high' : QUALITY);
  post.addClouds(clouds.effects);
  clouds.hold(post.cloudPass);
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
  space = createSpace({ scene, camera, renderer, sky, clouds, rig, dip: fadeThrough });
  // Walking into the Hub's rooms and out again, as one move (src/entry.js).
  // The flight down to your Chog's home after signing in (src/arrival.js).
  arrival = createArrival({ camera, rig, space, domes: island.domes });
  entry = createEntry({ camera, rig, hub: island.hub, fovs: { outdoor: outdoorFov, indoor: () => (camera.aspect < 1 ? 64 : 52) }, dom: renderer.domElement, session: () => session });
  load.set('build', 1);
  // Build every shader the world needs (the rooms and the post chain too) in the background, so the
  // first frame you see is finished.
  load.set('shaders', 0);
  // The dry run goes first: it bakes the sky's light into the scene, so the rooms compile with it too.
  const warm = prewarm(renderer, frame, (f) => load.set('shaders', f));
  for (const r of island.rooms) r.room.group.visible = true;
  renderer.setRenderTarget(post.composer.inputBuffer);
  const rooms = renderer.compileAsync(scene, camera).catch(() => {});
  renderer.setRenderTarget(null);
  for (const r of island.rooms) r.room.group.visible = false;
  await Promise.all([rooms, warm]);
  // The dry run took the sky's light bake with it: bake it again for real.
  sky.envHour = -99;
  load.set('frames', 0);
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
  load.finish({ keep: withIntro });
  const cloudsIn = clouds.stream(() => post.render(0)).then((shown) => {
    if (shown) load.mark('clouds');
    return shown;
  });
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
  } else rig.jump('overview');
  renderer.setAnimationLoop(loop);
  // Signing in, and the Chogs who live round the world.
  session = initSession({
    camera,
    homes: island.rooms.filter((r) => r.id.startsWith('home')),
    bar: island.rooms.find((r) => r.id === 'bar'),
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
    enterSpace: ({ from, duration } = {}) => {
      leaveRoomUI();
      return space.enter({ from, duration });
    },
    leaveSpace: (opts) => space.leave(opts),
    // The first screen (src/intro.js) and the flight to your Chog's home (src/arrival.js), for A11:
    // intro.state(name, data), intro.close(), and intro.flyHome(room), which tears the screen away and
    // resolves once the camera is in front of the pod, with its door.
    intro: {
      state: (name, data) => intro.state(name, data),
      close: () => intro.close(),
      flyHome: (room) => {
        intro.close();
        return arrival.fly(room);
      },
      get open() {
        return !$('loading').classList.contains('done');
      },
    },
    // Compile a new object's shaders ahead of time, for the target the scene really draws into.
    prewarm: (obj) => {
      const was = renderer.getRenderTarget();
      renderer.setRenderTarget(post.composer.inputBuffer);
      const ready = renderer.compileAsync(obj, camera, scene);
      renderer.setRenderTarget(was);
      return ready.catch(() => {});
    },
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
  // The Chogs about town wait for their models; ?npcs shows their slots with stand-ins.
  if (READY.size || params.has('npcs')) buildNpcs({ scene, plaza: island.plaza }).then((n) => (npcs = n)).catch((err) => console.warn('Chogs about town:', err));
  if (params.has('debug')) window.chogDebug = debug = createDebug({ renderer, post, sky });
  if (SHOTS[params.get('demo')]) startDemo(SHOTS[params.get('demo')], cloudsIn);
  // ?space opens on the world seen from space.
  if (params.has('space')) space.enter({ duration: 0 });
  if (withIntro) {
    space.enter({ duration: 0 });
    intro.ready();
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
  if (import.meta.env.DEV) window.chogWorld = { THREE, time, rig, camera, post, scene, sky, island, clouds, renderer, frame, VIEWS, perf, get session() { return session; }, get npcs() { return npcs; }, space, get entry() { return entry; }, get intro() { return intro; }, get arrival() { return arrival; }, enterRoom: (id) => enterRoom(island.rooms.find((r) => r.id === id)), back: () => $('btn-back').click() };
}

// ?demo=<shot>: a camera flight for the video (src/flight.js) with the interface hidden. It holds its
// first frame until the clouds have faded in, then flies; window.chogDemo.at(s) poses any second of
// it and play(s) flies on from there, for frame-by-frame takes.
let demo = null;
function startDemo(shot, cloudsIn) {
  const flight = createFlight(shot);
  document.body.classList.add('demo');
  time.live = false;
  time.hour = shot.hour;
  rig.idleSpin = false;
  demo = {
    t: 0,
    playing: false,
    update(dt) {
      if (this.playing) this.t = Math.min(flight.duration, this.t + dt);
      flight.pose(camera, this.t);
    },
  };
  window.chogDemo = {
    duration: flight.duration,
    at: (s) => Object.assign(demo, { t: s, playing: false }),
    play: (from = 0) => Object.assign(demo, { t: from, playing: true }),
  };
  cloudsIn.then(() => setTimeout(() => !demo.playing && demo.t === 0 && window.chogDemo.play(), 3000));
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
  add(box, { id: 'hub', name: 'Chog Hub', center: new THREE.Vector3(DOWNTOWN.x, T + 7, DOWNTOWN.z), radius: hub.width * 0.42, theta: 0.25, phi: 1.2, rooms: ['lobby', 'bar'] });
  island.terrain.tops.forEach((top, i) => {
    const isl = ISLANDS[i];
    const name = isl.id === 'downtown' ? 'Downtown' : `Neighbourhood ${Number(isl.id.slice(4)) + 1}`;
    top.userData.place = { id: isl.id, name, center: new THREE.Vector3(isl.x, baseY(isl), isl.z), radius: isl.r * 1.05, phi: 0.95 };
    pickables.push(top);
  });
}
rig.onTap = (x, y) => {
  if (!island) return;
  if (session?.tapChog(x, y)) return;
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
    entry.enter(r).then(() => inRoom?.room === r && showBar(r.name));
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
  demo?.update(dt);
  space?.update();
  entry?.update(dt);
  arrival?.update(dt);
  // A wider lens indoors, wider still on a tall phone screen, so a room fits in view.
  const fov = entry?.fov() ?? (rig.room instanceof RoomBox ? (camera.aspect < 1 ? 64 : 52) : outdoorFov());
  if (Math.abs(camera.fov - fov) > 0.05) {
    camera.fov += (fov - camera.fov) * Math.min(1, dt * 4);
    camera.updateProjectionMatrix();
    setGlowFov(camera.fov);
  }
  const dist = rig.focusDist;
  sky.fog.near = 600 + dist * 1.3;
  sky.fog.far = sky.fog.near + 2600;
  const env = sky.update(hour, camera, t);
  space?.apply();
  // The shadow box covers the whole world, so only the sun moving calls for a fresh shadow map.
  if (Math.abs(hour - lastShadowHour) > 0.02) {
    renderer.shadowMap.needsUpdate = true;
    lastShadowHour = hour;
  }
  wind.uTime.value = t;
  island.update(env, t, camera, dt);
  entry?.apply(env, renderer);
  session?.update(dt);
  npcs?.update(dt, camera);
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
