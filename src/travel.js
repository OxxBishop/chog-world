import * as THREE from 'three';
import { makeChog, CHOG_HEIGHT, setChogGround } from './chog.js';
import { chogInfo } from './chogdata.js';
import { modelFor } from './traitmap.js';
import { ISLANDS, HOODS, DOMES, DOME_R, DOWNTOWN, ROADS, TERRACES, PORTAL_SPOTS, roadDistance } from './layout.js';
import { heightAt, islandAt, cameraFloor, rimPoint } from './terrain.js';
import { RoomBox } from './camera.js';
import { wind } from './foliage.js';

// B's portal effect (src/fx/teleport.js, built to the user's pick) takes over each trip once it's in:
// departs({ chog, pad, scene, camera }) and arrives(...) play on your Chog at a pad (pad.centre, pad.facing),
// and buildPad(scene, portal) can dress each hub ({ group, update(dt, { near, charge, beam }) }).
const teleportFx = Object.values(import.meta.glob('./fx/teleport.js', { eager: true }))[0] ?? null;
import { buildHoverboards, BOARD } from './hoverboard.js';
// Riding a hoverboard: how much faster than your walk and run.
const BOARD_BOOST = 2.1;

/*
 * Getting about (the user's picks, 2026-10-15): you walk your own Chog round the islands in third
 * person, the camera close behind. On a phone a joystick appears under your left thumb and a drag
 * anywhere else turns the view; on a laptop WASD (or the arrows) walk, Shift runs, a drag turns the
 * view and the wheel zooms. A compass runs across the top and a round map in the corner turns with
 * you (tap it for the whole map). Portal hubs stand on the plaza and in every neighbourhood: step on
 * one, pick where to, and your Chog dissolves up into a column of light and beams down there.
 *
 * Your Chog is yours when you're signed in (the session's), or one of the cast's for a guest, picked
 * on arrival. The Hub's doors take you in (src/entry.js's walk through the door); a room's Back brings
 * you out at its door. While a room or a cutscene has the camera, this steps aside.
 */

// Outdoors everything is built 1.7 x life size (plaza.js, npcs.js); so is the Chog you walk.
const SCALE = 1.7;
// The plaza's paving (roads.js): a flat disc a little over the land at the middle of downtown.
let plazaY = null;

/**
 * The ground you see at (x, z), which a Chog stands on: the plaza's paving, a walk's paving and its curbs
 * (roads.js lays them a few cm over the land), or the land (the user, 10-17: Chogs sank into the ground).
 */
setChogGround((x, z) => surfaceAt(x, z));
export function surfaceAt(x, z) {
  const h = heightAt(x, z);
  plazaY ??= heightAt(DOWNTOWN.x, DOWNTOWN.z) + 0.09;
  if (Math.hypot(x - DOWNTOWN.x, z - DOWNTOWN.z) < DOWNTOWN.r) return Math.max(h, plazaY);
  const r = roadDistance(x, z);
  return h + (r < -0.22 ? 0.065 : r < 0.22 ? 0.14 : 0);
}
// Walking and running go at the speed the Chog's feet cover in its walk and jog (the user's picks, 10-16,
// at their true pace), about 1 and 1.6 m/s; these are for a Chog without them.
const WALK = 1;
const RUN = 1.6;
// How fast you go (m/s; the user, 10-17: "walking speed is way too slow"): a Chog's own pace (its feet,
// with the longer stride and quicker steps of src/chog.js) kept within these, so every Chog walks and runs
// like it means it. Its steps speed up to match, up to STEP_MAX times their own rate (quicker since 10-18,
// when the legs were kept out of the body and their stride came out shorter).
const WALK_BAND = [1.9, 2.6];
const RUN_BAND = [4.2, 5.4];
const STEP_MAX = 1.55;
// The joystick: full walking speed at the ring's edge (its radius in px); running only once the thumb
// is pulled on past it, and back to walking a little inside that (the user: a small drag ran).
const STICK = 58;
const RUN_PAST = 1.45;
const RUN_UNTIL = 1.25;
const ACCEL = 9;
const TURN = 11;
const RADIUS = 0.9;
const STEP_UP = 1.25;
// Steeper than this (rise over run) is a cliff: you walk along it, not up it. A bridge's stair is about 0.4.
const MAX_SLOPE = 1.1;
// A portal pad's top over the ground, and how far out from its middle its edge's step reaches.
const PAD_TOP = 0.27 * SCALE;
const PAD_OUT = 1.75 * SCALE + 0.35;
// The map covers the archipelago out to this far from the middle (metres).
const EXT = 360;
// The camera: how far behind, how high it looks (a Chog's chest), its tilt.
const CAM = { dist: 8.6, min: 4.2, max: 18, pitch: 0.3, pitchMin: -0.2, pitchMax: 1.15, look: CHOG_HEIGHT * SCALE * 0.72 };
// The cast a guest can walk as: the Chogs with a model of their own (their faces, walks and runs).
export const CAST = [
  { id: 1151, name: 'Monty', line: 'Doorman, Monad superfan' },
  { id: 409, name: 'King Pom', line: 'Pompous, soft as a pillow' },
  { id: 68, name: 'Cosmo', line: 'Astronaut, maps everything' },
  { id: 124, name: 'Snooze', line: 'Sleepy shark, kind to all' },
  { id: 132, name: 'Peel', line: 'The hype Chog, all puns' },
  { id: 37, name: 'Puff', line: 'Big softie, cries at songs' },
  { id: 56, name: 'Patrol', line: 'Looks tough, very polite' },
  { id: 66, name: 'Quackers', line: 'Cheeky, a style icon' },
  { id: 52, name: 'Toasty', line: 'Storyteller, always cold' },
];
const NAMES = ['Neighbourhood 1', 'Neighbourhood 2', 'Neighbourhood 3'];
const MARKS = { tree: 'Giant Tree', beacon: 'Beacon' };

const $ = (id) => document.getElementById(id);
const smooth = (a, b, x) => THREE.MathUtils.smoothstep(x, a, b);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();

export function createTravel({ scene, camera, renderer, rig, island, world }) {
  const dom = renderer.domElement;
  const hub = island.hub;
  const bridges = island.bridges;
  // The ground a Chog's feet keep to (src/chog.js): on a bridge, its deck's treads; else the land's paving.
  const onBridge = (x, z) => {
    for (const br of bridges) {
      const ux = (br.bx - br.ax) / br.len, uz = (br.bz - br.az) / br.len;
      const along = (x - br.ax) * ux + (z - br.az) * uz;
      if (along < -0.5 || along > br.len + 0.5) continue;
      if (Math.abs((x - br.ax) * -uz + (z - br.az) * ux) > br.width / 2 - 0.2) continue;
      return { br, t: THREE.MathUtils.clamp(along / br.len, 0, 1) };
    }
    return null;
  };
  setChogGround(
    (x, z) => {
      const b = onBridge(x, z);
      return b ? (b.br.treadY ?? ((t) => b.br.deckY(t) + 0.15))(b.t) : surfaceAt(x, z);
    },
    (x, z) => (onBridge(x, z)?.br.rise ?? 0) + 0.3,
  );
  const tunnels = island.tunnels;
  const solids = island.solids.filter((s) => !(s instanceof RoomBox));
  const plaza = island.plaza;
  const P = (x, z) => plaza.localToWorld(new THREE.Vector3(x, 0, z));

  // ---------- places ----------
  // Round things on the plaza you can't walk through: the fountain's basin, the singer's stage.
  const blocks = [
    { p: P(0, 40), r: 7.1 },
    { p: P(27, 30), r: 3.6 },
  ];
  // The plaza's furniture (plaza.js): each bench a capsule along its seat, planters and lamp posts round.
  const furniture = plaza.userData.solid ?? { benches: [], round: [] };
  const benches = furniture.benches.map((f) => {
    const c = plaza.localToWorld(new THREE.Vector3(f.x, f.y, f.z));
    const along = new THREE.Vector3(Math.cos(f.rot), 0, -Math.sin(f.rot)).multiplyScalar(f.half - f.r);
    return { a: c.clone().sub(along), b: c.clone().add(along), r: f.r, y: c.y };
  });
  for (const f of furniture.round) blocks.push({ p: P(f.x, f.z), r: f.r });
  // Trees, rocks, bushes and tall flowers (island.js), in 8 m cells for a quick look round you.
  const OB = 8;
  const obstacles = new Map();
  for (const o of island.obstacles ?? []) {
    const k = `${Math.floor(o.x / OB)},${Math.floor(o.z / OB)}`;
    if (!obstacles.has(k)) obstacles.set(k, []);
    obstacles.get(k).push(o);
  }
  // Everything else outdoors a walker or a board bumps into (B; the user, 10-19: "phasing through
  // everything"): posts as circles and long things as capsules ({ ax, az, bx, bz, r }), each with the
  // height of the ground it stands on, binned like the obstacles.
  const props = new Map();
  const addProp = (c) => {
    const x0 = Math.min(c.ax, c.bx) - c.r, x1 = Math.max(c.ax, c.bx) + c.r, z0 = Math.min(c.az, c.bz) - c.r, z1 = Math.max(c.az, c.bz) + c.r;
    for (let i = Math.floor(x0 / OB); i <= Math.floor(x1 / OB); i++) {
      for (let j = Math.floor(z0 / OB); j <= Math.floor(z1 / OB); j++) {
        const k = `${i},${j}`;
        if (!props.has(k)) props.set(k, []);
        props.get(k).push(c);
      }
    }
  };
  const post = (x, z, r, y = heightAt(x, z)) => addProp({ ax: x, az: z, bx: x, bz: z, r, y });
  const bar = (a, b, r) => addProp({ ax: a.x, az: a.z, bx: b.x, bz: b.z, r, y: (a.y + b.y) / 2 });
  // The street lamps along the walks (src/roads.js).
  for (const [x, z] of island.lamps ?? []) post(x, z, 0.16);
  // Out in front of the Hub (src/hub.js, its own space): the welcome arch's posts, the Chog statue, the
  // banner poles, the bar's awning and yard posts, its terrace tables with their stools, the casino's
  // trim along its front (the wings' corners stand out past their round footprint).
  const HB = (x, z) => hub.group.localToWorld(new THREE.Vector3(x, 0, z));
  const hubPost = (x, z, r) => {
    const p = HB(x, z);
    post(p.x, p.z, r, p.y);
  };
  for (const sx of [-7, 7]) hubPost(sx, 27.1, 0.65);
  hubPost(-13, 27.1, 1.9);
  for (const sx of [-12, 12]) hubPost(sx, 19.1, 0.16);
  for (const x of [-44.8, -29.2]) hubPost(x, 15.4, 0.15);
  for (const x of [-44, -30]) hubPost(x, 22.9, 0.2);
  for (const [x, z] of [[-41.5, 18.9], [-36.5, 21.4], [-32.5, 18.4]]) hubPost(x, z, 1.7);
  for (const cx of [-37, 37]) bar(HB(cx - 11.25, 11.0), HB(cx + 11.25, 11.0), 0.25);
  // The bar wing's outer wall, square to its front corner.
  bar(HB(-47.6, -2.5), HB(-47.6, 10.4), 0.6);
  // The lobby's front steps: a block (its door's reach, below, goes past them).
  bar(HB(-3.4, 19.3), HB(3.4, 19.3), 1.4);
  // The singer's stage takes in its fairy-light posts.
  blocks[1].r = 3.9;
  // By each dome: the lamp at its home's door, and its entrance arch's posts, with the glass either side
  // of the arch (Pod.atDoor lets a walker through a wide band there).
  for (const d of island.domes ?? []) {
    const lamp = d.toWorld(3.2, d.homeZ + 8.9);
    post(lamp.x, lamp.z, 0.16, lamp.y);
    const R = DOME_R;
    for (const sx of [-1, 1]) {
      bar(d.toWorld(sx * 2.2, 16.6), d.toWorld(sx * 2.45, 18.6), 0.22);
      bar(d.toWorld(sx * 2.45, Math.sqrt(R * R - 2.45 * 2.45)), d.toWorld(sx * 4.4, Math.sqrt(R * R - 4.4 * 4.4)), 0.25);
    }
  }
  // The Hub's doors (hub space to the world): where you walk in, and which way is out.
  const doors = hub.rooms.map((h) => {
    const e = h.entrance;
    const at = hub.group.localToWorld(new THREE.Vector3(e.x, 0, e.z + 0.6));
    const out = hub.group.localToWorld(new THREE.Vector3(e.x, 0, e.z + 2)).sub(hub.group.localToWorld(new THREE.Vector3(e.x, 0, e.z))).setY(0).normalize();
    // (The lobby's front steps stand in the way: its door reaches out past them.)
    return { id: h.id, name: h.name, at, out, half: e.half, reach: h.id === 'lobby' ? 4.8 : 3.2, room: island.rooms.find((r) => r.id === h.id) };
  });
  // Portals: on the plaza across the fountain from the singer, and in each neighbourhood just off the
  // walk in from its bridge, on the side toward downtown (no domes there).
  const portals = [
    // Arriving here you face the fountain, with the singer's stage beyond it.
    { id: 'plaza', name: 'Chog Hub', sub: 'Downtown plaza', at: P(-27, 30), look: P(0, 40) },
    ...HOODS.map((h) => {
      const spot = PORTAL_SPOTS[h.id];
      // Arriving, you face into the neighbourhood, toward its landmark and its domes.
      return { id: `hood${h.id}`, name: NAMES[h.id], sub: MARKS[h.landmark] ?? 'Domes', at: new THREE.Vector3(spot.x, 0, spot.z), look: new THREE.Vector3(h.x, 0, h.z) };
    }),
  ];
  for (const p of portals) p.at.y = surfaceAt(p.at.x, p.at.z);
  // Things to steer by, on the compass and the map.
  const landmarks = [
    { name: 'Chog Hub', at: hub.group.getWorldPosition(new THREE.Vector3()), kind: 'hub' },
    { name: 'Stage', at: P(27, 30), kind: 'stage' },
    ...TERRACES.filter((t) => ISLANDS.find((i) => i.id === t.isl)?.landmark && ISLANDS.find((i) => i.id === t.isl).x === t.x).map((t) => {
      const isl = ISLANDS.find((i) => i.id === t.isl);
      return { name: MARKS[isl.landmark] ?? 'Hub', at: new THREE.Vector3(t.x, 0, t.z), kind: isl.landmark };
    }).filter((m) => m.kind !== 'hub'),
  ];

  // ---------- the portals in the world ----------
  const portalFx = portals.map((p) => buildPortal(scene, p));
  // B's hubs, when its effect brings its own: drawn in place of these pads, driven by the same state.
  if (teleportFx?.buildPad) {
    for (const f of portalFx) {
      const dress = teleportFx.buildPad(scene, { at: f.group.position.clone(), centre: f.centre.clone(), facing: f.facing, scale: SCALE });
      if (!dress) continue;
      f.group.visible = false;
      const own = f.update;
      f.update = (dt, on, who) => (own(dt, on, who), dress.update?.(dt, { near: on, charge: f.charge, beam: f.beam }));
    }
  }
  // B's trip effects too, when it brings its own (B12).
  if (teleportFx?.warmTrips) world.prewarm?.(teleportFx.warmTrips(scene));
  // Drawn once now, so their first sight never stalls a frame on Intel (B12); the beam too.
  for (const f of portalFx) {
    f.beamMesh.visible = true;
    world.prewarm?.(f.group)?.finally?.(() => (f.beamMesh.visible = f.beam > 0.01));
  }

  // ---------- state ----------
  const state = {
    on: false, // travel has the camera (not in a room or cutscene)
    chog: null,
    own: false, // the session's Chog (the session runs its animation) or a guest's (we do)
    guestId: null,
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    yaw: 0, // the Chog's heading (0 faces +z)
    camYaw: Math.PI, // the camera's heading round the Chog (0: camera on +z side)
    camPitch: CAM.pitch,
    camDist: CAM.dist,
    zoomTo: null, // the zoom button's distance the camera is easing to, or null
    camPos: new THREE.Vector3(),
    camLook: new THREE.Vector3(),
    lastLook: 0, // seconds since you last turned the view yourself
    move: '',
    busy: null, // a portal trip or a door: input waits
    float: 0, // in zero g (Cosmo's dome): 0 on the ground to 1 floating
    board: -1, // the hoverboard you ride (src/hoverboard.js), or -1
    roll: 0,
    hop: null, // stepping onto or off a board (rideStep)
    rideYaw: 0,
    ridePitch: 0,
    rideRise: 0,
    domeLim: 99, // how far back the camera may be, floating in Cosmo's dome (eased), and its tip up there
    domeTilt: 0,
    floatT: 0,
    zgSwim: 0, // zero g: how much it's swimming (0 still to 1), its trick under way, and the wait for the next
    zgTrick: null,
    zgNext: 1.2,
    lift: 0,
    floating: false,
    onPortal: null,
    lastDoor: null,
    suspended: false,
  };
  const root = new THREE.Group();
  root.name = 'travel';
  scene.add(root);

  // ---------- the HUD ----------
  const isTouch = matchMedia('(pointer: coarse)').matches;
  const hud = buildHud();
  // Hoverboards by the domes' doors (src/hoverboard.js).
  const boards = buildHoverboards(scene, (x, z, near) => groundAt(x, z, near ?? heightAt(x, z) + 1)?.y ?? heightAt(x, z));
  let lastEnv = null;
  hud.ride.addEventListener('click', () => (state.board >= 0 ? leaveBoard() : takeBoard()));
  // The zoom button (A, 10-21: "a zoom out feature ... more real estate"): close, as it starts, far; and back.
  // Pinch and the wheel still zoom anywhere in between.
  const ZOOMS = [6, CAM.dist, 15];
  hud.zoom.addEventListener('click', (e) => {
    e.stopPropagation();
    const i = ZOOMS.findIndex((z) => z > state.camDist + 0.5);
    state.zoomTo = i < 0 ? ZOOMS[0] : ZOOMS[i];
    zoomIcon();
  });
  const zoomIcon = () => {
    const out = (state.zoomTo ?? state.camDist) < ZOOMS[2] - 0.5;
    hud.zoom.classList.toggle('in', !out);
    hud.zoom.setAttribute('aria-label', out ? 'Zoom out' : 'Zoom in');
  };
  const map = drawMap();

  // ---------- input ----------
  const keys = new Set();
  const stick = { id: null, x0: 0, y0: 0, x: 0, y: 0, run: false };
  const looks = new Map();
  let pinch = null;
  const block = () => !state.on || state.busy;
  dom.addEventListener('pointerdown', (e) => {
    if (!state.on) return;
    e.stopImmediatePropagation();
    dom.setPointerCapture(e.pointerId);
    // A touch on the joystick (fixed, bottom left: it used to come up wherever the left thumb landed and
    // got in the way of pinching and looking, the user 10-21) walks; anything else turns the view.
    if (e.pointerType === 'touch' && stick.id === null && !state.busy) {
      const r = hud.stick.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      if (Math.hypot(e.clientX - cx, e.clientY - cy) < r.width * 0.75) {
        Object.assign(stick, { id: e.pointerId, x0: cx, y0: cy, x: e.clientX, y: e.clientY });
        hud.stick.classList.add('on');
        hud.hint.classList.add('gone');
        return;
      }
    }
    looks.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() });
    if (looks.size === 2) {
      const [a, b] = [...looks.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: state.camDist };
    }
  }, { capture: true });
  dom.addEventListener('pointermove', (e) => {
    if (!state.on) return;
    e.stopImmediatePropagation();
    if (e.pointerId === stick.id) {
      stick.x = e.clientX;
      stick.y = e.clientY;
      const dx = stick.x - stick.x0, dy = stick.y - stick.y0;
      const r = Math.min(1, Math.hypot(dx, dy) / STICK);
      const a = Math.atan2(dy, dx);
      // Pulled past the ring to run: the knob sits on the edge, a little bigger.
      hud.knob.style.transform = `translate(${Math.cos(a) * r * STICK}px, ${Math.sin(a) * r * STICK}px) scale(${stick.run ? 1.18 : 1})`;
      return;
    }
    const p = looks.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (looks.size >= 2 && pinch) {
      const [a, b] = [...looks.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      state.camDist = THREE.MathUtils.clamp((pinch.dist * pinch.d) / Math.max(d, 1), CAM.min, CAM.max);
      state.zoomTo = null;
      zoomIcon();
      return;
    }
    // A finger moves further than a mouse for the same turn: scale touch to the screen.
    const kx = e.pointerType === 'touch' ? 3.4 / window.innerWidth : 0.0055;
    const ky = e.pointerType === 'touch' ? 2.2 / window.innerHeight : 0.0045;
    state.camYaw -= dx * kx;
    state.camPitch = THREE.MathUtils.clamp(state.camPitch + dy * ky, CAM.pitchMin, CAM.pitchMax);
    state.lastLook = 0;
  }, { capture: true });
  const up = (e) => {
    if (!state.on && stick.id === null && !looks.size) return;
    e.stopImmediatePropagation();
    if (e.pointerId === stick.id) {
      stick.id = null;
      hud.stick.classList.remove('on');
      stick.run = false;
      hud.knob.style.transform = 'translate(0px, 0px)';
      return;
    }
    const p = looks.get(e.pointerId);
    looks.delete(e.pointerId);
    if (looks.size < 2) pinch = null;
    // A tap (short, still) on your own Chog opens the chat.
    if (p && performance.now() - p.t < 280 && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) < 10 && state.own) world.session()?.tapChog?.(e.clientX, e.clientY);
  };
  dom.addEventListener('pointerup', up, { capture: true });
  dom.addEventListener('pointercancel', up, { capture: true });
  dom.addEventListener('wheel', (e) => {
    if (!state.on) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    state.camDist = THREE.MathUtils.clamp(state.camDist * Math.pow(1.0015, e.deltaY), CAM.min, CAM.max);
    state.zoomTo = null;
    zoomIcon();
  }, { capture: true, passive: false });
  window.addEventListener('keydown', (e) => {
    if (!state.on || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    const k = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift', 'q', 'e'].includes(k)) {
      keys.add(k);
      hud.hint.classList.add('gone');
      e.stopImmediatePropagation();
      if (k.startsWith('arrow')) e.preventDefault();
    }
    if (k === 'm') toggleMap();
    if (k === 'escape') closeMap();
    // F: on or off a hoverboard (src/hoverboard.js).
    if (k === 'f' && !e.repeat) state.board >= 0 ? leaveBoard() : takeBoard();
  }, { capture: true });
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());

  // What you're asking for this frame: a direction relative to the camera (x right, y forward), 0 to 1.
  function wish() {
    if (block()) return { x: 0, y: 0, run: false, steer: 0 };
    let x = 0, y = 0, run = keys.has('shift');
    if (keys.has('w') || keys.has('arrowup')) y += 1;
    if (keys.has('s') || keys.has('arrowdown')) y -= 1;
    // A and D steer (the view and your Chog turn together) rather than step sideways: with the keys alone
    // you can go anywhere, no dragging the view round as you walk (the user, 10-21: "a little stiff").
    const steer = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
    const l = Math.hypot(x, y);
    if (l > 1) (x /= l), (y /= l);
    if (stick.id !== null) {
      const dx = stick.x - stick.x0, dy = stick.y - stick.y0;
      const d = Math.hypot(dx, dy);
      if (d > 6) {
        const k = Math.min(1, d / STICK);
        x = (dx / d) * k;
        y = (-dy / d) * k;
        stick.run = d > STICK * (stick.run ? RUN_UNTIL : RUN_PAST);
        run = stick.run;
      } else stick.run = false;
    }
    return { x, y, run, steer };
  }

  // ---------- the ground ----------
  // Where you can stand at (x, z), and how high: on an island (clear of its very rim) or a bridge's deck.
  function groundAt(x, z) {
    // A portal's pad: you stand on its top, not in it. Its edge is a short eased step, so you walk on.
    for (const p of portals) {
      const r = Math.hypot(x - p.at.x, z - p.at.z);
      if (r > PAD_OUT) continue;
      // (Eased up from the ground right there, which can lie below the pad's foot on a slope: the user, 10-18,
      // "my chog couldn't climb on to the portal hub".)
      const k = 1 - THREE.MathUtils.smoothstep(r, PAD_OUT - 0.8, PAD_OUT);
      const h = heightAt(x, z);
      return { y: h + Math.max(0, p.at.y + PAD_TOP - h) * k, on: 'pad' };
    }
    for (const br of bridges) {
      const ux = (br.bx - br.ax) / br.len, uz = (br.bz - br.az) / br.len;
      const along = (x - br.ax) * ux + (z - br.az) * uz;
      const side = (x - br.ax) * -uz + (z - br.az) * ux;
      if (along < -0.5 || along > br.len + 0.5 || Math.abs(side) > br.width / 2 - 0.45) continue;
      // The deck always stands over the ground under it (its landings are level, on stone where the
      // ground falls away), so on it the deck is the ground: from its end you walk on, from its side
      // it's a wall where it stands high.
      return { y: br.deckY(THREE.MathUtils.clamp(along / br.len, 0, 1)) + 0.15, on: 'bridge' };
    }
    const hit = islandAt(x, z);
    return hit && hit.k < 0.955 ? { y: surfaceAt(x, z), on: 'land' } : null;
  }

  // Push a step clear of walls: domes (in and out only by their doors), buildings, the fountain, props,
  // people. Riding a board, its nose and tail are kept clear too (it used to run through things).
  const _cn = new THREE.Vector3(), _cf = new THREE.Vector3();
  function collide(from, to) {
    pushOut(from, to, RADIUS, true);
    if (state.board >= 0 && !state.hop) {
      const fx = Math.sin(state.yaw), fz = Math.cos(state.yaw);
      for (const off of [BOARD.len / 2 - 0.3, -(BOARD.len / 2 - 0.3)]) {
        _cn.set(to.x + fx * off, to.y, to.z + fz * off);
        _cf.set(from.x + fx * off, from.y, from.z + fz * off);
        const x0 = _cn.x, z0 = _cn.z;
        pushOut(_cf, _cn, BOARD.wide / 2 + 0.05, false);
        to.x += _cn.x - x0;
        to.z += _cn.z - z0;
      }
    }
    return to;
  }
  // The point to (a body rad round, from where it was) pushed out of everything solid. body: your Chog
  // itself (the cast and the parked boards only shove it).
  function pushOut(from, to, rad, body) {
    for (const s of solids) {
      const dx = to.x - s.x, dz = to.z - s.z;
      const d = Math.hypot(dx, dz);
      if (d > s.r + 6) continue;
      if (s.enterable && s.facing !== null) {
        // A dome: the glass is a wall except at its door.
        const fromIn = Math.hypot(from.x - s.x, from.z - s.z) < s.r;
        const atDoor = s.atDoor(to) || s.atDoor(from);
        if (atDoor) continue;
        if (fromIn && d > s.r - rad) to.set(s.x + (dx / d) * (s.r - rad), to.y, s.z + (dz / d) * (s.r - rad));
        else if (!fromIn && d < s.r + rad) to.set(s.x + (dx / (d || 1)) * (s.r + rad), to.y, s.z + (dz / (d || 1)) * (s.r + rad));
      } else if (d < s.r + rad) {
        const k = (s.r + rad) / (d || 1);
        to.set(s.x + dx * k, to.y, s.z + dz * k);
      }
    }
    for (const b of blocks) {
      const dx = to.x - b.p.x, dz = to.z - b.p.z;
      const d = Math.hypot(dx, dz);
      if (d < b.r + rad) to.set(b.p.x + (dx / (d || 1)) * (b.r + rad), to.y, b.p.z + (dz / (d || 1)) * (b.r + rad));
    }
    for (const bn of benches) {
      if (Math.abs(bn.y - to.y) > 2.5) continue;
      const abx = bn.b.x - bn.a.x, abz = bn.b.z - bn.a.z;
      const t = THREE.MathUtils.clamp(((to.x - bn.a.x) * abx + (to.z - bn.a.z) * abz) / (abx * abx + abz * abz), 0, 1);
      const cx = bn.a.x + abx * t, cz = bn.a.z + abz * t;
      const dx = to.x - cx, dz = to.z - cz;
      const d = Math.hypot(dx, dz), r = bn.r + rad;
      if (d < r) to.set(cx + (dx / (d || 1)) * r, to.y, cz + (dz / (d || 1)) * r);
    }
    // Trees, rocks, bushes, tall flowers; and the props (lamps, posts, tables, the domes' arches).
    const cx = Math.floor(to.x / OB), cz = Math.floor(to.z / OB);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        for (const o of obstacles.get(`${cx + i},${cz + j}`) ?? []) {
          if (Math.abs(o.y - to.y) > 3) continue;
          const dx = to.x - o.x, dz = to.z - o.z;
          const d = Math.hypot(dx, dz), r = o.r + rad * 0.8;
          if (d < r) to.set(o.x + (dx / (d || 1)) * r, to.y, o.z + (dz / (d || 1)) * r);
        }
        for (const c of props.get(`${cx + i},${cz + j}`) ?? []) {
          if (Math.abs(c.y - to.y) > 3) continue;
          const abx = c.bx - c.ax, abz = c.bz - c.az, ll = abx * abx + abz * abz;
          const t = ll > 1e-6 ? THREE.MathUtils.clamp(((to.x - c.ax) * abx + (to.z - c.az) * abz) / ll, 0, 1) : 0;
          const px = c.ax + abx * t, pz = c.az + abz * t;
          const dx = to.x - px, dz = to.z - pz;
          const d = Math.hypot(dx, dz), r = c.r + rad;
          // (Right on its line: out the way it came from.)
          if (d < 1e-4) {
            const fx = from.x - px, fz = from.z - pz, fl = Math.hypot(fx, fz) || 1;
            to.set(px + (fx / fl) * r, to.y, pz + (fz / fl) * r);
          } else if (d < r) to.set(px + (dx / d) * r, to.y, pz + (dz / d) * r);
        }
      }
    }
    // The glass hoops over the bridges, their rails and lamps: kept in under the arch, or out past them.
    tunnels?.keepOff?.(from, to, rad, CHOG_HEIGHT * SCALE * 1.05 + (state.lift ?? 0));
    // The boards waiting by the domes: low, so only your Chog's middle bumps them.
    for (const b of boards?.boards ?? []) {
      if (!b.parked || Math.abs(b.x - to.x) > 4 || Math.abs(b.z - to.z) > 4 || Math.abs(b.y - to.y) > 2) continue;
      const hx = Math.sin(b.yaw) * (BOARD.len / 2 - BOARD.wide / 2), hz = Math.cos(b.yaw) * (BOARD.len / 2 - BOARD.wide / 2);
      const abx = 2 * hx, abz = 2 * hz;
      const t = THREE.MathUtils.clamp(((to.x - (b.x - hx)) * abx + (to.z - (b.z - hz)) * abz) / (abx * abx + abz * abz), 0, 1);
      const px = b.x - hx + abx * t, pz = b.z - hz + abz * t;
      const dx = to.x - px, dz = to.z - pz;
      const d = Math.hypot(dx, dz), r = BOARD.wide / 2 + rad * 0.6;
      if (d < r) to.set(px + (dx / (d || 1)) * r, to.y, pz + (dz / (d || 1)) * r);
    }
    if (!body) return;
    // The cast: a gentle shove round them rather than through. By their bodies' middles, so one floating in
    // zero g with you (Cosmo, whose middle is his pivot: userData.centre) is solid too (the user, 10-21).
    const myMid = to.y + (state.lift ?? 0) + CHOG_HEIGHT * SCALE * 0.45;
    for (const c of world.npcRoots?.() ?? []) {
      if (c === state.chog?.root || !c.visible) continue;
      const sc = c.getWorldScale(_w).y;
      if (c.userData.centre) c.userData.centre.getWorldPosition(_v);
      else c.getWorldPosition(_v).y += CHOG_HEIGHT * sc * 0.45;
      const dx = to.x - _v.x, dz = to.z - _v.z;
      const d = Math.hypot(dx, dz);
      const r = 1.1 * sc + rad * 0.6;
      if (d < r && Math.abs(_v.y - myMid) < CHOG_HEIGHT * Math.max(sc, SCALE) * 0.8) to.set(_v.x + (dx / (d || 1)) * r, to.y, _v.z + (dz / (d || 1)) * r);
    }
  }

  // ---------- the camera ----------
  let stairLift = 0, stairDip = 0;
  function placeCamera(dt, snap = false) {
    if (state.zoomTo !== null) {
      state.camDist += (state.zoomTo - state.camDist) * (snap ? 1 : 1 - Math.exp(-dt * 5));
      if (Math.abs(state.zoomTo - state.camDist) < 0.02) state.zoomTo = null;
    }
    const look = _v.copy(state.pos);
    look.y += CAM.look + state.lift;
    // Down a bridge's steps the camera rises to look down them (from just over the steps behind, their
    // edges would hide your Chog), easing back as the way levels out.
    const hereDeck = deckUnder(state.pos.x, state.pos.z);
    const backDeck = deckUnder(state.pos.x + Math.sin(state.camYaw) * 6, state.pos.z + Math.cos(state.camYaw) * 6);
    const rise = Number.isFinite(hereDeck) && Number.isFinite(backDeck) ? Math.max(0, (backDeck - hereDeck) / 6) : 0;
    // (Less on a hoverboard: riding high over the steps, its edges hide little, and tipped up as far under
    // a bridge's hoops the camera only saw the deck.)
    const stairs = rise > 0.05 ? (Math.atan(rise) + 0.32) * (state.board >= 0 ? 0.35 : 1) : 0;
    stairLift = snap ? stairs : stairLift + (stairs - stairLift) * (1 - Math.exp(-dt * 2.5));
    // Up a bridge's steps: the camera comes down behind and looks up them, to the top and what's beyond
    // (looking down from behind, the steps filled the screen: the user, 10-21, "the bridge ascent is still
    // heavily zoomed in").
    const aheadDeck = deckUnder(state.pos.x - Math.sin(state.camYaw) * 6, state.pos.z - Math.cos(state.camYaw) * 6);
    const climb = Number.isFinite(hereDeck) && Number.isFinite(aheadDeck) ? Math.max(0, (aheadDeck - hereDeck) / 6) : 0;
    const want0 = climb > 0.05 ? Math.atan(climb) : 0;
    stairDip = snap ? want0 : stairDip + (want0 - stairDip) * (1 - Math.exp(-dt * 2.5));
    look.y += stairDip * 2.2;
    const pitch0 = THREE.MathUtils.clamp(Math.max(state.camPitch - stairDip * 0.9, stairLift) + state.domeTilt, CAM.pitchMin, CAM.pitchMax);
    // Behind and above, by yaw and pitch, pulled in where something's in the way.
    const cp = Math.cos(pitch0);
    const dir = _w.set(Math.sin(state.camYaw) * cp, Math.sin(pitch0), Math.cos(state.camYaw) * cp);
    const want = new THREE.Vector3();
    let dist = state.camDist;
    const inTunnel = tunnels?.inside(look);
    const steps = 14;
    for (let i = 1; i <= steps; i++) {
      const d = (dist * i) / steps;
      want.copy(look).addScaledVector(dir, d);
      if (blocked(want, inTunnel)) {
        // (Under a bridge's hoops it may come in closer still, never out through their glass.)
        dist = Math.max(inTunnel ? 1.4 : 2.6, d - dist / steps);
        break;
      }
    }
    // No room behind (a wall at your back): look down from higher up rather than crowd into your Chog.
    // Under a bridge's hoops the room is under their arch, not over it: there it comes down lower instead
    // (on a hoverboard your Chog rides high, and the camera behind it went up through the glass and was
    // pulled in onto the back of its head: the user, 10-21).
    if (dist < 4.6) {
      for (const lift of inTunnel ? [-0.12, -0.24, -0.36, -0.48] : [0.35, 0.7, 1.0]) {
        const pitch = THREE.MathUtils.clamp(pitch0 + lift, CAM.pitchMin, CAM.pitchMax);
        const cp2 = Math.cos(pitch);
        const dir2 = new THREE.Vector3(Math.sin(state.camYaw) * cp2, Math.sin(pitch), Math.cos(state.camYaw) * cp2);
        let ok = state.camDist;
        for (let i = 1; i <= steps; i++) {
          const d = (state.camDist * i) / steps;
          if (blocked(want.copy(look).addScaledVector(dir2, d), inTunnel)) {
            ok = d - state.camDist / steps;
            break;
          }
        }
        if (ok > dist + (inTunnel ? 0.3 : 1)) {
          dir.copy(dir2);
          dist = ok;
        }
        // (Under the hoops, on down while it gains room: the lowest look along the bridge it can have.)
        if (dist >= (inTunnel ? state.camDist * 0.95 : 4.6)) break;
      }
    }
    // Under a bridge's hoops with no room behind (swung out to the side): it swings round behind your Chog,
    // to look along the bridge.
    if (inTunnel && dist < 4.6 && !snap) {
      const ax = tunnels.axisAt?.(look);
      if (ax !== null && ax !== undefined) {
        const back = Math.abs(wrap(ax - state.camYaw)) < Math.PI / 2 ? ax : ax + Math.PI;
        state.camYaw += wrap(back - state.camYaw) * (1 - Math.exp(-dt * 4));
      }
    }
    // Floating in Cosmo's dome, the camera keeps under its glass (lifted with you, it went out through the
    // glass and looked in past the struts). It eases in to it: a snap read as a zoom to your Chog's head as
    // it came in at the door (the user, 10-19).
    let domeMax = 99;
    if (state.float > 0.05 && island.cosmo) {
      // (By the glass your Chog itself is close to it: as much room as there is, then.)
      const m = island.cosmo.contains(look, 1.2) ? 1.2 : island.cosmo.contains(look, 0.5) ? 0.5 : 0;
      for (let i = 1; i <= steps; i++) {
        const d = (dist * i) / steps;
        if (!island.cosmo.contains(want.copy(look).addScaledVector(dir, d), m)) {
          domeMax = Math.max(1.5, d - dist / steps);
          break;
        }
      }
      // No room behind it there: the camera swings round to the dome's middle side and tips up to look
      // down at it (behind his pod, from over its roof).
      if (domeMax < 4.6 && !snap) {
        const c = island.cosmo.centre;
        const toMid = Math.atan2(c.x - look.x, c.z - look.z);
        state.camYaw += wrap(toMid - state.camYaw) * (1 - Math.exp(-dt * 2.5));
      }
    }
    const tilt = state.float > 0.05 && domeMax < 4.6 ? 0.55 : 0;
    state.domeTilt += (tilt - state.domeTilt) * (snap ? 1 : 1 - Math.exp(-dt * 1.5));
    if (domeMax >= 99 && state.domeLim >= dist - 0.05) state.domeLim = 99;
    else if (snap) state.domeLim = Math.min(domeMax, dist);
    else {
      // From where the camera is now, in (or back out) over a second or so.
      if (state.domeLim > dist) state.domeLim = dist;
      state.domeLim += (Math.min(domeMax, dist) - state.domeLim) * (1 - Math.exp(-dt * 1.8));
    }
    dist = Math.min(dist, state.domeLim);
    want.copy(look).addScaledVector(dir, dist);
    // Never under the grass, nor a bridge's deck (some fall a long way between islands: down one, the
    // steps behind you rise above where the camera would be, so it looks down on you from higher up).
    const floor = Math.max(cameraFloor(want.x, want.z, 1.2), deckUnder(want.x, want.z) + 1.2);
    if (want.y < floor) want.y = floor;
    if (snap) {
      state.camPos.copy(want);
      state.camLook.copy(look);
    } else {
      const k = 1 - Math.exp(-dt * 10);
      state.camPos.lerp(want, k);
      state.camLook.lerp(look, 1 - Math.exp(-dt * 14));
    }
    camera.position.copy(state.camPos);
    camera.lookAt(state.camLook);
    // Squeezed right up to your Chog: it fades out of the way rather than fill the screen.
    if (!state.busy && state.chog) state.chog.setFade?.(smooth(1.3, 2.8, state.camPos.distanceTo(state.camLook)));
  }
  // Whether the camera can't be at p: inside a building or a house (a dome's glass it may pass).
  // (A bridge's hoops it may now go out through: they fade away by the camera, and held under their arch
  // it was pulled in onto the back of your Chog's head, nothing else in view: the user, 10-21.)
  function blocked(p) {
    for (const s of solids) {
      if (s.enterable) continue;
      if (Math.abs(p.x - s.x) > s.reach || Math.abs(p.z - s.z) > s.reach) continue;
      if (s.inside(p, 0.4)) return true;
    }
    return p.y < Math.max(cameraFloor(p.x, p.z, 0.6), deckUnder(p.x, p.z) + 0.6);
  }
  // The height of a bridge's deck under (x, z), or -Infinity: the camera keeps above it, from a little
  // out beyond its ends and rails.
  function deckUnder(x, z) {
    for (const br of bridges) {
      const ux = (br.bx - br.ax) / br.len, uz = (br.bz - br.az) / br.len;
      const along = (x - br.ax) * ux + (z - br.az) * uz;
      if (along < -1 || along > br.len + 1) continue;
      if (Math.abs((x - br.ax) * -uz + (z - br.az) * ux) > br.width / 2 + 1.5) continue;
      return br.deckY(THREE.MathUtils.clamp(along / br.len, 0, 1));
    }
    return -Infinity;
  }

  // ---------- each frame ----------
  let lastT = 0;
  function update(dt) {
    const chog = state.chog;
    // A room, a cutscene or the session has your Chog (going home, the sale): step aside.
    if (state.own && chog && world.session()?.active?.chog !== chog) end();
    // Signing in while out as a guest: the guest goes at once (it came back for a moment between the
    // wake-up and your own Chog stepping out: the user, 10-22).
    else if (!state.own && chog && world.session()?.active) end();
    const inRoom = rig.room instanceof RoomBox || world.entryActive() || world.spaceActive();
    // Your own Chog went home with the session while you were in a room (src/session.js sendHome): back
    // out it comes with you, unless it's leaving (the goodbye, the sale).
    if (state.own && chog && chog.root.parent !== root && !inRoom && !world.introOpen() && !world.session()?.active?.leaving) root.add(chog.root);
    const ours = chog && chog.root.parent === root;
    const was = state.on;
    state.on = !!chog && ours && !inRoom && !world.introOpen();
    if (was && !state.on) suspend();
    if (!was && state.on) resume();
    portalFx.forEach((f, i) => f.update(dt, i === state.onPortal ? 1 : 0, state.pos));
    if (!state.on) return false;

    // Moving: toward what you ask for, relative to the camera, easing in and out.
    const w = wish();
    // Steering (A, D): the view turns, and your Chog with it (in place, if it's standing).
    if (w.steer) {
      state.camYaw -= w.steer * dt * (w.run ? 1.6 : 1.9);
      state.lastLook = 2;
      if (Math.abs(w.y) < 0.1) state.yaw += wrap(state.camYaw + Math.PI - state.yaw) * (1 - Math.exp(-dt * 8));
    }
    const fwd = _v.set(-Math.sin(state.camYaw), 0, -Math.cos(state.camYaw));
    const right = _w.set(-fwd.z, 0, fwd.x);
    const want = new THREE.Vector3().addScaledVector(fwd, w.y).addScaledVector(right, w.x);
    const mag = Math.min(1, want.length());
    const walkFeet = (chog?.speedOf?.('walk') || WALK / SCALE) * SCALE;
    const runFeet = Math.max(walkFeet, (chog?.speedOf?.('run') || RUN / SCALE) * SCALE);
    const walkV = THREE.MathUtils.clamp(walkFeet, ...WALK_BAND);
    const runV = THREE.MathUtils.clamp(runFeet, ...RUN_BAND);
    const top = (w.run ? runV : walkV) * (state.board >= 0 ? BOARD_BOOST : 1);
    const target = mag > 0.01 ? want.normalize().multiplyScalar(top * Math.max(mag, 0.35)) : want.set(0, 0, 0);
    state.vel.lerp(target, 1 - Math.exp(-dt * ACCEL));
    const speed = state.vel.length();
    if (speed > 0.05) {
      const goal = Math.atan2(state.vel.x, state.vel.z);
      state.yaw += wrap(goal - state.yaw) * (1 - Math.exp(-dt * TURN));
    }
    const next = state.pos.clone().addScaledVector(state.vel, dt);
    collide(state.pos, next);
    const g = groundAt(next.x, next.z, state.pos.y);
    // (A small step it just steps up at a walk: the domes' doors have a 14 cm sill, which stopped a walking
    // Chog at Cosmo's door and only let a running one through.)
    const climbable = (gy, x, z) => gy - state.pos.y < STEP_UP && (gy - state.pos.y < 0.25 || (gy - state.pos.y) / Math.max(Math.hypot(x - state.pos.x, z - state.pos.z), 1e-3) < MAX_SLOPE);
    if (g && (g.on === 'pad' || climbable(g.y, next.x, next.z))) {
      next.y = g.y;
      state.pos.copy(next);
    } else {
      // A cliff, the rim or a wall too high: slide along it instead (try each axis on its own).
      for (const axis of ['x', 'z']) {
        const t = state.pos.clone();
        t[axis] = next[axis];
        const g2 = groundAt(t.x, t.z, state.pos.y);
        if (g2 && (g2.on === 'pad' || climbable(g2.y, t.x, t.z))) {
          t.y = g2.y;
          state.pos.copy(t);
          break;
        }
      }
      state.vel.multiplyScalar(0.4);
    }
    chog.root.position.copy(state.pos);
    chog.root.rotation.y = state.yaw;
    // Zero g in Cosmo's dome (B, src/cosmo.js; the user, 10-19): your Chog lifts off and swims about in
    // there, and comes back down on the way out.
    const zg = island.cosmo?.zeroG(state.pos) ? 1 : 0;
    // (Off the hoverboard first: it waits by the door.)
    if (zg && state.board >= 0) leaveBoard(true);
    state.float += (zg - state.float) * (1 - Math.exp(-dt * (zg ? 0.8 : 1.5)));
    state.floatT += dt;
    const fk = state.float * state.float * (3 - 2 * state.float);
    // On a hoverboard (src/hoverboard.js): stood on its deck, leaning into the turns.
    const rideLift = rideStep(dt, speed);
    chog.root.position.copy(state.pos);
    // (Lower near the edge, where the glass comes down: its head, or a trick, kept under it.)
    const headroom = fk > 0.001 && island.cosmo ? island.cosmo.headroom(state.pos) - CHOG_HEIGHT * SCALE * 1.15 - 0.4 : 9;
    state.lift = fk * Math.max(0.3, Math.min(2.4 + Math.sin(state.floatT * 0.9) * 0.35, headroom)) + rideLift;
    chog.root.position.y += state.lift;
    // (Yaw, then its own pitch and roll.)
    chog.root.rotation.order = 'YXZ';
    const zgPose = zeroGStep(dt, speed, walkV, fk);
    chog.root.rotation.x = zgPose.pitch * fk;
    chog.root.rotation.y = state.yaw + zgPose.spin * fk;
    chog.root.rotation.z = zgPose.roll * fk + state.roll;
    // The floating rocks keep out of its way (src/cosmo.js).
    if (island.cosmo) island.cosmo.avoid?.(fk > 0.05 ? _zgMid.set(state.pos.x, state.pos.y + state.lift + CHOG_HEIGHT * SCALE * 0.5, state.pos.z) : null);
    if (fk > 0.001) {
      // Turning about its middle, not its feet.
      const mid = CHOG_HEIGHT * SCALE * 0.5;
      _zgMid.set(0, mid, 0).applyEuler(chog.root.rotation);
      chog.root.position.x -= _zgMid.x;
      chog.root.position.y += mid - _zgMid.y;
      chog.root.position.z -= _zgMid.z;
    }
    if (state.floating !== fk > 0.05) {
      state.floating = fk > 0.05;
      chog.float?.(state.floating);
    }
    pushGrass(chog);
    if (zgPose.move) {
      if (state.move !== zgPose.move) {
        state.move = zgPose.move;
        chog.play(zgPose.move.slice(3));
      }
      chog.setPace(zgPose.pace);
    } else animate(chog, state.hop ? state.hop.speed : state.board >= 0 ? 0 : speed, walkV, runV, walkFeet, runFeet);
    if (!state.own) chog.update(dt, camera);

    // The camera swings round behind you as you go (unless you've just turned it yourself).
    state.lastLook += dt;
    // Only while you're heading away from the camera: swinging round as you walk sideways would curl
    // your path into a circle.
    if (speed > 0.4 * walkV && state.lastLook > 1.2 && w.y > 0.55 && Math.abs(w.x) < 0.45) {
      const behind = state.yaw + Math.PI;
      state.camYaw += wrap(behind - state.camYaw) * (1 - Math.exp(-dt * 1.4 * Math.min(1, speed / walkV)));
    }
    if (keys.has('q')) state.camYaw += dt * 1.8;
    if (keys.has('e')) state.camYaw -= dt * 1.8;
    placeCamera(dt);

    // Doors and portals underfoot.
    if (!state.busy) {
      checkDoors();
      checkPortals();
    }
    // The hoverboard's button: by a parked board, or while riding one.
    const nearBoard = state.board >= 0 ? state.board : state.busy || state.hop ? -1 : boards.nearest(state.pos, 3.6);
    const showRide = nearBoard >= 0 && !state.busy && !(state.board >= 0 && state.rideRise > 0.15);
    if (hud.ride.hidden === showRide) hud.ride.hidden = !showRide;
    const rideLabel = state.board >= 0 ? 'Hop off' : 'Ride the hoverboard';
    if (showRide && hud.ride.textContent !== rideLabel) (hud.ride.textContent = rideLabel), (hud.ride.dataset.label = rideLabel), hud.ride.setAttribute('aria-label', rideLabel);
    lastT += dt;
    if (lastT > 1 / 30) {
      lastT = 0;
      drawHud();
    }
    return true;
  }

  // Idle, walk or run, its legs keeping pace with how fast it's actually going (the clip's own rate at its
  // full speed, slower while it speeds up or slows down).
  // The grass leans away from your Chog and the cast nearest it (src/foliage.js).
  const near = [];
  function pushGrass(chog) {
    const P = wind.uPush.value;
    // (A board's length clears a wider path.)
    P[0].set(state.pos.x, state.pos.y, state.pos.z, (state.board >= 0 ? 1.15 : 0.85) * chog.root.scale.y);
    near.length = 0;
    for (const c of world.npcRoots?.() ?? []) {
      if (c === chog.root || !c.visible) continue;
      c.getWorldPosition(_v);
      const d = _v.distanceToSquared(state.pos);
      if (d < 900) near.push([d, _v.x, _v.y, _v.z, 0.85 * c.getWorldScale(_w).y]);
    }
    near.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < P.length; i++) {
      const n = near[i - 1];
      if (n) P[i].set(n[1], n[2], n[3], n[4]);
      else P[i].w = 0;
    }
  }
  // ---------- zero g (B, src/cosmo.js; the user, 10-19: "more than just floating around") ----------
  // Moving, your Chog swims through the air: stretched out along its way, slow strokes of its walk. Still,
  // it bobs and sways, and now and then turns a lazy trick, arms up: a somersault, a slow spin or a roll.
  // Returns its pose (radians, before the float's own weight) and the move to play, if any.
  const _zgMid = new THREE.Vector3();
  const ZG_TRICKS = [
    { kind: 'flip', dur: 2.6 },
    { kind: 'spin', dur: 3.0 },
    { kind: 'roll', dur: 2.8 },
  ];
  function zeroGStep(dt, speed, walkV, fk) {
    if (fk < 0.001) {
      state.zgTrick = null;
      state.zgNext = 1.2;
      state.zgSwim = 0;
      return { pitch: 0, spin: 0, roll: 0, move: null };
    }
    const swim = THREE.MathUtils.clamp((speed / Math.max(1, walkV) - 0.15) / 0.6, 0, 1);
    state.zgSwim += (swim - state.zgSwim) * (1 - Math.exp(-dt * 2.5));
    const sw = state.zgSwim;
    let pitch = sw * 0.75 + Math.sin(state.floatT * 0.7) * 0.12 * (1 - sw);
    let roll = Math.sin(state.floatT * 0.53) * 0.16 * (1 - sw) + Math.sin(state.floatT * 1.1) * 0.06 * sw;
    let spin = 0;
    // A trick when it's been still a while (one under way always finishes, smoothly).
    if (!state.zgTrick && fk > 0.9 && sw < 0.15) {
      state.zgNext -= dt;
      if (state.zgNext <= 0) state.zgTrick = { ...ZG_TRICKS[Math.floor(Math.random() * ZG_TRICKS.length)], t: 0, dir: Math.random() < 0.5 ? -1 : 1 };
    }
    const tr = state.zgTrick;
    if (tr) {
      tr.t += dt;
      const u = Math.min(1, tr.t / tr.dur);
      const k = u * u * u * (u * (u * 6 - 15) + 10);
      if (tr.kind === 'flip') pitch += Math.PI * 2 * k;
      else if (tr.kind === 'spin') spin = Math.PI * 2 * k * tr.dir;
      else roll += Math.PI * 2 * k * tr.dir;
      if (u >= 1) {
        state.zgTrick = null;
        state.zgNext = 5 + Math.random() * 4;
      }
    }
    if (fk < 0.5) return { pitch, spin, roll, move: null };
    // Its moves: arms up through a trick, slow strokes swimming, a slow idle otherwise.
    if (tr) return { pitch, spin, roll, move: 'zg:cheer', pace: 0.8 };
    if (sw > 0.25) return { pitch, spin, roll, move: 'zg:walk', pace: 0.45 + sw * 0.15 };
    return { pitch, spin, roll, move: 'zg:idle', pace: 0.7 };
  }

  // ---------- hoverboards (B, src/hoverboard.js; the user, 10-19) ----------
  // Each frame: stepping onto or off a board, the board carried under your Chog, its lean into the turns
  // and its tip with the way (up and down a bridge's stair its nose dug into the steps: the user, 10-19).
  // Returns how far over the ground it puts your Chog's feet.
  const RIDE_TOP = BOARD.hover + BOARD.thick; // the deck's top over the ground, ridden
  const KNEEL = 0.34; // and sunk low to be stepped onto or off
  const STEP_V = 2.4; // stepping on and off: a careful walk, metres a second
  const HOP_T = 0.42, HOP_UP = 0.3; // the little hop on (and down off): how long, how high over the deck
  function rideStep(dt, speed) {
    let lift = state.board >= 0 ? RIDE_TOP : 0;
    let pitch = 0;
    if (state.hop) lift = hopStep(state.hop, dt);
    else if (state.board >= 0) {
      // Up or down a slope it glides, nearly level (the user, 10-19: a clean hover, no leaning): tipped a
      // little with the way, and riding higher over a stair so its nose and tail clear the treads (each
      // stands up to a tread's rise over the smooth slope a Chog walks on: src/skyfx.js), easing up and
      // down rather than stepping.
      const fx = Math.sin(state.yaw), fz = Math.cos(state.yaw), half = BOARD.len / 2;
      const gF = groundAt(state.pos.x + fx * half, state.pos.z + fz * half, state.pos.y)?.y ?? state.pos.y;
      const gB = groundAt(state.pos.x - fx * half, state.pos.z - fz * half, state.pos.y)?.y ?? state.pos.y;
      const slope = THREE.MathUtils.clamp((gF - gB) / BOARD.len, -1.2, 1.2);
      const tip = THREE.MathUtils.clamp(Math.atan(slope) * 0.45, -0.3, 0.3);
      state.ridePitch += (-tip - state.ridePitch) * (1 - Math.exp(-dt * 4));
      pitch = state.ridePitch;
      const tread = Math.abs(slope) > 0.12 ? 0.3 * Math.abs(slope) : 0;
      const need = Math.max(0, (gF + gB) / 2 - state.pos.y) + Math.max(0, BOARD.thick + 0.16 + tread + half * Math.abs(slope - Math.tan(-pitch)) - RIDE_TOP);
      state.rideRise += (need - state.rideRise) * (1 - Math.exp(-dt * (need > state.rideRise ? 9 : 3)));
      lift += state.rideRise;
    }
    // The lean: how fast it's turning, at speed.
    const turn = wrap(state.yaw - state.rideYaw) / Math.max(dt, 1e-3);
    state.rideYaw = state.yaw;
    const riding = state.board >= 0 && !state.hop;
    const want = riding ? THREE.MathUtils.clamp(-turn * 0.09 * Math.min(1, speed / 4), -0.32, 0.32) : 0;
    state.roll += (want - state.roll) * (1 - Math.exp(-dt * 5));
    if (riding) {
      lift += Math.sin(state.floatT * 2.2) * 0.04;
      boards.carry(state.board, state.pos, state.yaw, state.roll, lift, pitch);
    }
    boards.update(dt, lastEnv);
    return lift;
  }
  // Stepping on: the board floats round to meet your Chog, end on, and sinks low; your Chog walks up to its
  // tail and hops up onto it, and the board rises with it. Off: the board sinks, your Chog walks to its
  // front (or a side, if that's in the way), hops down and walks on, and the board rises back to wait. (It
  // used to be lifted on as if by invisible hands: the user, 10-19. Then it rose to the deck's height half
  // a metre short of the board and walked on air, and a door's sill popped it up and down: the user,
  // 10-21, "not as smooth as it used to be".)
  function hopStep(h, dt) {
    h.t += dt;
    const b = h.b;
    state.vel.set(0, 0, 0);
    // (Slowing as it comes to where it stops, so a hop starts from a step, not a dead halt.)
    const walk = (to) => {
      h.v += (Math.min(STEP_V, (to - h.s) * 3 + 0.9) - h.v) * (1 - Math.exp(-dt * 8));
      h.s = Math.min(h.len, h.s + h.v * dt);
      state.pos.x = h.from.x + h.dir.x * h.s;
      state.pos.z = h.from.z + h.dir.z * h.s;
      ground();
      return h.s >= to;
    };
    // (Over a door's sill or a kerb, smoothly.)
    const ground = () => {
      const g = groundAt(state.pos.x, state.pos.z, state.pos.y);
      if (g) state.pos.y += (g.y - state.pos.y) * (1 - Math.exp(-dt * 14));
      state.yaw += wrap(Math.atan2(h.dir.x, h.dir.z) - state.yaw) * (1 - Math.exp(-dt * 10));
    };
    // The hop: from where it stood (s0) to `land`, up from `y0` over the deck to `y1`; its feet's height.
    const hop = (land, y0, y1) => {
      h.t2 += dt;
      const u = Math.min(1, h.t2 / HOP_T);
      h.s = h.s0 + (land - h.s0) * (0.5 - 0.5 * Math.cos(Math.PI * u));
      state.pos.x = h.from.x + h.dir.x * h.s;
      state.pos.z = h.from.z + h.dir.z * h.s;
      ground();
      h.v = 0;
      return { u, feet: y0 + (y1 - y0) * u + HOP_UP * 4 * u * (1 - u) };
    };
    if (h.on) {
      // The board: from where it waited to end on in front of your Chog, turning and sinking.
      const k = smooth(0, 0.5, h.t);
      h.at.lerpVectors(h.c0, h.c1, k);
      const yaw = h.yaw0 + wrap(h.yaw1 - h.yaw0) * k;
      let top = RIDE_TOP - 0.1 + (KNEEL - RIDE_TOP + 0.1) * k;
      let feet = 0;
      if (h.phase === 'walk') {
        // A moment for the board to come round, then up to just short of its tail (and the hop once the
        // board is there: it comes round and sinks over half a second).
        const there = h.t > 0.2 && walk(Math.max(0, h.sTail - 0.2));
        if (there && h.t >= 0.5) (h.phase = 'jump'), (h.t2 = 0), (h.s0 = h.s);
      }
      if (h.phase === 'jump') {
        // Up and over its tail, landing near its middle.
        const j = hop(h.len - 0.15, 0, top);
        feet = j.feet;
        if (j.u >= 1) (h.phase = 'rise'), (h.t2 = 0);
      }
      if (h.phase === 'rise') {
        // On: up it comes to riding height, a little past it and back.
        h.t2 += dt;
        const u = Math.min(1, h.t2 / 0.45);
        top = KNEEL + (RIDE_TOP - KNEEL) * (1 + 3 * Math.pow(u - 1, 3) + 2 * Math.pow(u - 1, 2));
        feet = top;
        h.v = 0;
        if (u >= 1) {
          state.hop = null;
          state.ridePitch = 0;
        }
      }
      boards.carry(b, h.at, yaw, 0, top, 0);
      h.speed = h.phase === 'walk' && h.t > 0.2 ? h.v : 0;
      return feet;
    }
    // Off: down it sinks, then your Chog walks to its edge, hops down and walks on a step.
    if (h.phase === 'sink') {
      const k = smooth(0, 0.3, h.t);
      const top = RIDE_TOP + (KNEEL - RIDE_TOP) * k;
      boards.carry(b, h.from, h.yaw, 0, top, 0);
      h.speed = 0;
      if (k >= 1) h.phase = 'walk';
      return top;
    }
    let feet = 0;
    if (h.phase === 'walk') {
      if (walk(Math.max(0, h.sEdge - 0.3))) (h.phase = 'jump'), (h.t2 = 0), (h.s0 = h.s);
      feet = KNEEL;
    } else if (h.phase === 'jump') {
      const j = hop(h.sEdge + 0.5, KNEEL, 0);
      feet = j.feet;
      if (j.u >= 1) (h.phase = 'out'), (h.v = STEP_V * 0.5);
    } else walk(h.len);
    // Once its feet are off, the board rises back to wait.
    if (!h.parked && h.phase === 'out') {
      h.parked = true;
      boards.park(b, h.from, h.yaw, KNEEL);
    } else if (!h.parked) boards.carry(b, h.from, h.yaw, 0, KNEEL, 0);
    h.speed = h.phase === 'jump' ? 0 : h.v;
    if (h.phase === 'out' && h.s >= h.len) state.hop = null;
    return feet;
  }
  function takeBoard() {
    if (state.busy || state.hop || state.board >= 0 || !state.on) return;
    const b = boards.nearest(state.pos, 3.6);
    if (b < 0) return;
    const bd = boards.boards[b];
    const c0 = new THREE.Vector3(bd.x, bd.y, bd.z);
    const d = Math.hypot(c0.x - state.pos.x, c0.z - state.pos.z);
    // Toward the board (or the way your Chog faces, if it's standing on it).
    const dir = d > 0.3 ? new THREE.Vector3(c0.x - state.pos.x, 0, c0.z - state.pos.z).normalize() : new THREE.Vector3(Math.sin(state.yaw), 0, Math.cos(state.yaw));
    // It comes to rest end on, half a step beyond its tail; either end will do (it's the same both ways).
    const c1 = state.pos.clone().addScaledVector(dir, BOARD.len / 2 + 0.5);
    // (Not into a dome's glass or a tree, if it has to back off to make room.)
    collide(state.pos, c1);
    c1.y = groundAt(c1.x, c1.z, state.pos.y)?.y ?? state.pos.y;
    const len = Math.max(BOARD.len / 2 + 0.2, Math.hypot(c1.x - state.pos.x, c1.z - state.pos.z));
    const along = Math.atan2(dir.x, dir.z);
    const yaw1 = Math.abs(wrap(along - bd.yaw)) <= Math.PI / 2 ? along : along + Math.PI;
    state.board = b;
    boards.take(b);
    state.hop = { on: true, phase: 'walk', b, t: 0, s: 0, v: 0, speed: 0, from: state.pos.clone(), dir, len, sTail: len - BOARD.len / 2, c0, c1, at: c0.clone(), yaw0: bd.yaw, yaw1 };
  }
  // Off: the board waits where it is, and your Chog steps down off it. quick (a door, a portal): straight
  // down, the board left a step to its side.
  function leaveBoard(quick = false) {
    if (state.board < 0) return;
    // Not on a stair: there's nowhere level to step down to, or to leave it.
    if (!quick && !state.hop && state.rideRise > 0.15) return;
    const b = state.board;
    state.board = -1;
    state.ridePitch = 0;
    state.rideRise = 0;
    const side = new THREE.Vector3(Math.cos(state.yaw), 0, -Math.sin(state.yaw));
    if (quick || state.hop) {
      state.hop = null;
      boards.park(b, state.pos.clone().addScaledVector(side, 2.4), state.yaw);
      return;
    }
    // Off the front, or else whichever side is clear (somewhere to stand, nothing in the way).
    const fwd = new THREE.Vector3(Math.sin(state.yaw), 0, Math.cos(state.yaw));
    const ways = [[fwd, BOARD.len / 2], [side, BOARD.wide / 2], [side.clone().negate(), BOARD.wide / 2], [fwd.clone().negate(), BOARD.len / 2]];
    let pick = ways[0];
    for (const w of ways) {
      const to = state.pos.clone().addScaledVector(w[0], w[1] + 1.05);
      const g = groundAt(to.x, to.z, state.pos.y);
      const pushed = to.clone();
      collide(state.pos, pushed);
      if (g && Math.abs(g.y - state.pos.y) < 0.6 && pushed.distanceTo(to) < 0.05) {
        pick = w;
        break;
      }
    }
    const [dir, edge] = pick;
    state.hop = { on: false, phase: 'sink', b, t: 0, s: 0, v: 0, speed: 0, from: state.pos.clone(), dir, len: edge + 1.05, sEdge: edge, yaw: state.yaw, parked: false };
  }

  function animate(chog, speed, walkV, runV, walkFeet = walkV, runFeet = runV) {
    // A little either side of each change, so a speed near one never flickers between two moves.
    const was = state.move;
    const still = was === 'idle' || !was ? 0.16 : 0.08;
    const brisk = (walkV + runV) / 2 * (was === 'run' ? 0.9 : 1.05);
    let move = speed < still * walkV ? 'idle' : speed < brisk ? 'walk' : 'run';
    if (move !== state.move) {
      state.move = move;
      chog.play(move);
    }
    if (move === 'walk') chog.setPace((chog.paceFor?.('walk') ?? 1) * THREE.MathUtils.clamp(speed / walkFeet, 0.55, STEP_MAX));
    else if (move === 'run') chog.setPace((chog.paceFor?.('run') ?? 1) * THREE.MathUtils.clamp(speed / runFeet, 0.7, STEP_MAX));
    else chog.setPace(1);
  }

  // ---------- doors ----------
  function checkDoors() {
    if (state.vel.lengthSq() < 0.09) return;
    for (const d of doors) {
      if (!d.room || !world.canEnter(d.room)) continue;
      const rel = _v.subVectors(state.pos, d.at).setY(0);
      const ahead = rel.dot(d.out);
      const side = Math.abs(rel.x * d.out.z - rel.z * d.out.x);
      // Right at the door, walking into it.
      if (ahead > -0.5 && ahead < d.reach && side < d.half + 0.6 && state.vel.dot(d.out) < -0.3) {
        state.lastDoor = d;
        if (state.board >= 0) leaveBoard(true);
        world.enterRoom(d.room);
        return;
      }
    }
    // Your own house in your own dome: walk up to its door to go in.
    const s = world.session()?.active;
    if (state.own && s?.room) {
      const home = homeDoor(s.room);
      if (home && _v.subVectors(state.pos, home.at).setY(0).length() < 2.6 && state.vel.dot(home.out) < -0.3) {
        state.lastDoor = home;
        world.enterRoom(s.room);
      }
    }
  }
  // A home's front door and its way out, in the world (the house stands in its dome, facing the door).
  function homeDoor(room) {
    const i = Number(room.id.replace('home', ''));
    const d = DOMES[i];
    if (!d) return null;
    const dome = island.domes[i];
    const house = solids.find((s) => s.r < DOME_R - 3 && Math.hypot(s.x - d.x, s.z - d.z) < DOME_R);
    if (!house || !dome) return null;
    const out = new THREE.Vector3(Math.sin(d.facing), 0, Math.cos(d.facing));
    return { at: new THREE.Vector3(house.x, d.y, house.z).addScaledVector(out, house.r + 1.2), out, room, domeDoor: new THREE.Vector3(d.doorX, d.y, d.doorZ) };
  }

  // ---------- portals ----------
  function checkPortals() {
    let on = null;
    portals.forEach((p, i) => {
      if (Math.hypot(state.pos.x - p.at.x, state.pos.z - p.at.z) < 2.6) on = i;
    });
    if (on !== state.onPortal) {
      state.onPortal = on;
      if (on === null) hud.portal.hidden = true;
      else showPortalMenu(on);
      hud.hint.classList.add('gone');
    }
  }
  function showPortalMenu(i) {
    const here = portals[i];
    hud.portal.innerHTML = `<div class="tv-portal-head"><span class="tv-rune" aria-hidden="true"></span><div><strong>${here.name}</strong><span>${here.sub}</span></div></div>
      <div class="tv-portal-go">${portals.map((p, k) => (k === i ? '' : `<button data-k="${k}"><strong>${p.name}</strong><span>${p.sub}</span></button>`)).join('')}</div>`;
    hud.portal.hidden = false;
    hud.portal.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => travelTo(Number(b.dataset.k))));
  }
  async function travelTo(k) {
    const fromIdx = state.onPortal;
    if (state.busy || fromIdx === null || fromIdx === k) return;
    const from = portalFx[fromIdx];
    const to = portalFx[k];
    hud.portal.hidden = true;
    if (state.board >= 0) leaveBoard(true);
    state.busy = 'portal';
    state.vel.set(0, 0, 0);
    const chog = state.chog;
    chog.play('idle');
    state.move = 'idle';
    // B's wormhole (src/fx/teleport.js) takes it from where it stands: the whole trip is about 1.3 s (the
    // user, 10-19: 19 s was far too long). Without it, onto the middle of the pad and up into the light.
    from.charge = 1;
    if (teleportFx?.departs) await teleportFx.departs({ chog, pad: from, scene, camera });
    else {
      const start = state.pos.clone();
      await tween(0.3, (t) => {
        state.pos.lerpVectors(start, from.centre, THREE.MathUtils.smootherstep(t, 0, 1));
        chog.root.position.copy(state.pos);
      });
      await tween(0.6, (t) => {
        from.beam = Math.sin(t * Math.PI) + t * 0.4;
        chog.setBeam?.(THREE.MathUtils.smoothstep(t, 0, 1) * 1.1, 1);
      });
    }
    chog.root.visible = false;
    await flash(true, true);
    // There: the camera comes round behind the pad, looking out across the place.
    state.pos.copy(to.centre);
    state.yaw = to.facing;
    state.camYaw = to.facing + Math.PI;
    chog.root.position.copy(state.pos);
    chog.root.rotation.y = state.yaw;
    placeCamera(0, true);
    from.charge = 0;
    from.beam = 0;
    to.charge = 1;
    // (No pillar of light with the wormhole: its swirl is already open there.)
    to.beam = teleportFx?.arrives ? 0 : 1.4;
    await flash(false, true);
    chog.root.visible = true;
    // Down out of the light, from the head.
    if (teleportFx?.arrives) {
      await teleportFx.arrives({ chog, pad: to, scene, camera });
      // B's wormhole has it walk out toward the camera: it stays facing that way.
      if (teleportFx.facingAfter) state.yaw = teleportFx.facingAfter(to);
    } else
      await tween(1.05, (t) => {
        to.beam = (1 - t) * 1.4;
        chog.setBeam?.(1.1 - THREE.MathUtils.smoothstep(t, 0, 1) * 1.15, 1);
      });
    chog.setBeam?.(0, 0);
    to.charge = 0;
    chog.play('wave');
    state.move = 'wave';
    // (Arriving, its picker stays away till you step off the pad and on again: the user, 10-21.)
    state.onPortal = k;
    state.busy = null;
    setTimeout(() => state.move === 'wave' && ((state.move = ''), 0), 1800);
  }
  function tween(seconds, fn) {
    return new Promise((resolve) => {
      let t = 0;
      const tick = () => {
        t = Math.min(1, t + (world.dt() || 1 / 60) / seconds);
        fn(t);
        if (t >= 1) resolve();
        else requestAnimationFrame(tick);
      };
      tick();
    });
  }
  // quick: a blink, for the portal trip.
  function flash(on, quick = false) {
    hud.flash.classList.toggle('on', on);
    hud.flash.classList.toggle('quick', quick);
    return new Promise((r) => setTimeout(r, quick ? (on ? 90 : 100) : on ? 260 : 220));
  }

  // ---------- the HUD ----------
  function buildHud() {
    const wrapEl = document.createElement('div');
    wrapEl.id = 'travel-hud';
    wrapEl.hidden = true;
    wrapEl.innerHTML = `
      <canvas class="tv-compass" width="560" height="44" aria-label="Compass"></canvas>
      <button class="tv-map" aria-label="Open the map"><canvas width="300" height="300"></canvas></button>
      <div class="tv-stick"${isTouch ? '' : ' hidden'}><div class="tv-knob"></div></div>
      <div class="tv-portal" hidden></div>
      <button class="tv-ride" hidden></button>
      <button class="tv-zoom" aria-label="Zoom out"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21M7.5 10.5h6"/><path class="tv-zoom-plus" d="M10.5 7.5v6"/></svg></button>
      <p class="tv-hint">${isTouch ? 'The stick walks (push it to the edge to run). Drag anywhere else to look round, pinch to zoom.' : 'W and S to walk, A and D to steer, Shift to run. Drag to look round, scroll to zoom. M for the map.'}</p>
      <div class="tv-full" hidden>
        <div class="tv-full-card">
          <div class="tv-full-top"><strong>Chog World</strong><button class="tv-close" aria-label="Close the map">Close</button></div>
          <canvas width="900" height="900"></canvas>
          <p class="tv-full-note">Portals take you between the plaza and the neighbourhoods.</p>
        </div>
      </div>
      <div class="tv-flash"></div>`;
    document.body.append(wrapEl);
    const q = (s) => wrapEl.querySelector(s);
    const el = {
      root: wrapEl,
      compass: q('.tv-compass'),
      mapBtn: q('.tv-map'),
      mini: q('.tv-map canvas'),
      stick: q('.tv-stick'),
      knob: q('.tv-knob'),
      portal: q('.tv-portal'),
      ride: q('.tv-ride'),
      zoom: q('.tv-zoom'),
      hint: q('.tv-hint'),
      full: q('.tv-full'),
      fullCanvas: q('.tv-full canvas'),
      flash: q('.tv-flash'),
    };
    el.mapBtn.addEventListener('click', () => toggleMap());
    q('.tv-close').addEventListener('click', () => closeMap());
    el.full.addEventListener('click', (e) => e.target === el.full && closeMap());
    setTimeout(() => el.hint.classList.add('gone'), 16000);
    return el;
  }
  function toggleMap() {
    if (hud.full.hidden) {
      hud.full.hidden = false;
      drawFull();
    } else closeMap();
  }
  function closeMap() {
    hud.full.hidden = true;
  }

  // The whole archipelago drawn once, north up (north is -z), for the minimap and the full map.
  function drawMap() {
    const S = 1400;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    const k = S / (EXT * 2);
    const X = (x) => (x + EXT) * k, Z = (z) => (z + EXT) * k;
    // Islands: a soft cliff shadow, then the grass.
    for (const isl of ISLANDS) {
      const pts = [];
      for (let i = 0; i < 128; i++) pts.push(rimPoint(isl, (i / 128) * Math.PI * 2, 1.0));
      const shape = () => {
        g.beginPath();
        pts.forEach((p, i) => (i ? g.lineTo(X(p.x), Z(p.z)) : g.moveTo(X(p.x), Z(p.z))));
        g.closePath();
      };
      g.save();
      g.shadowColor = 'rgba(40, 20, 70, 0.35)';
      g.shadowBlur = 18;
      g.shadowOffsetY = 6;
      shape();
      g.fillStyle = '#8ccf68';
      g.fill();
      g.restore();
      shape();
      g.lineWidth = 3;
      g.strokeStyle = '#5f9e47';
      g.stroke();
    }
    for (const t of TERRACES) {
      g.beginPath();
      g.arc(X(t.x), Z(t.z), t.r * k, 0, Math.PI * 2);
      g.fillStyle = '#a3dc7c';
      g.fill();
    }
    // Bridges, their decks under glass.
    for (const b of bridges) {
      g.lineCap = 'round';
      g.strokeStyle = 'rgba(214, 205, 255, 0.9)';
      g.lineWidth = 6.6 * k;
      g.beginPath();
      g.moveTo(X(b.ax), Z(b.az));
      g.lineTo(X(b.bx), Z(b.bz));
      g.stroke();
      g.strokeStyle = '#c89366';
      g.lineWidth = b.width * k;
      g.stroke();
    }
    // Walks.
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const r of ROADS) {
      g.strokeStyle = r.kind === 'drive' ? '#efe2c8' : '#f4e9d4';
      g.lineWidth = Math.max(2, r.width * k);
      g.beginPath();
      r.points.forEach(([x, z], i) => (i ? g.lineTo(X(x), Z(z)) : g.moveTo(X(x), Z(z))));
      if (r.closed) g.closePath();
      g.stroke();
    }
    // The plaza.
    g.beginPath();
    g.arc(X(DOWNTOWN.x), Z(DOWNTOWN.z), DOWNTOWN.r * k, 0, Math.PI * 2);
    g.fillStyle = '#efe0f2';
    g.fill();
    // Domes.
    for (const d of DOMES) {
      g.beginPath();
      g.arc(X(d.x), Z(d.z), DOME_R * k, 0, Math.PI * 2);
      g.fillStyle = 'rgba(222, 234, 255, 0.95)';
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = '#9cb2e2';
      g.stroke();
    }
    // The Hub: its pod and wings.
    for (const s of solids) {
      if (Math.hypot(s.x - DOWNTOWN.x, s.z - DOWNTOWN.z) > 45) continue;
      g.beginPath();
      g.arc(X(s.x), Z(s.z), s.r * k, 0, Math.PI * 2);
      g.fillStyle = '#d8b48a';
      g.fill();
    }
    const hubAt = hub.group.getWorldPosition(new THREE.Vector3());
    g.beginPath();
    g.arc(X(hubAt.x), Z(hubAt.z), 9 * k, 0, Math.PI * 2);
    g.fillStyle = '#e8b84a';
    g.fill();
    for (const b of blocks) {
      g.beginPath();
      g.arc(X(b.p.x), Z(b.p.z), b.r * k, 0, Math.PI * 2);
      g.fillStyle = b === blocks[0] ? '#8fd3f0' : '#f39ac9';
      g.fill();
    }
    return { canvas: c, k, X, Z, S };
  }

  function drawHud() {
    const heading = state.camYaw + Math.PI; // the way the camera looks (0: toward +z... see bearing())
    // Compass: bearings round the way you're looking, cardinal points and the places to head for.
    const cv = hud.compass;
    const g = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    g.clearRect(0, 0, W, H);
    const look = bearingOf(_v.set(-Math.sin(state.camYaw), 0, -Math.cos(state.camYaw)));
    const span = Math.PI * 0.75;
    const xOf = (b) => W / 2 + (wrap(b - look) / span) * W;
    g.font = '600 16px Fredoka, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let i = 0; i < 24; i++) {
      const b = (i / 24) * Math.PI * 2;
      const x = xOf(b);
      if (x < 0 || x > W) continue;
      const fade = 1 - Math.abs(x - W / 2) / (W / 2);
      if (i % 3 === 0) {
        const label = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][i / 3];
        g.fillStyle = `rgba(255, 255, 255, ${0.35 + fade * 0.65})`;
        g.font = `${label.length === 1 ? 700 : 600} ${label.length === 1 ? 17 : 13}px Fredoka, sans-serif`;
        g.fillText(label, x, H / 2 + 1);
      } else {
        g.fillStyle = `rgba(255, 255, 255, ${fade * 0.45})`;
        g.fillRect(x - 1, H / 2 - 4, 2, 8);
      }
    }
    // The places: portals as runes, landmarks as dots, each with how far.
    const marks = [
      ...portals.map((p) => ({ at: p.at, kind: 'portal', name: p.name })),
      ...landmarks.map((m) => ({ at: m.at, kind: m.kind, name: m.name })),
    ];
    g.font = '600 11px Figtree, sans-serif';
    // Nearest first: a distance is printed only where it has room, so two markers close together never print
    // over each other (the user, 10-21: "232 m" and "64 m" read as "23264 m"); the nearer one keeps its label.
    const shown = [];
    for (const m of marks) {
      const rel = _w.subVectors(m.at, state.pos);
      m.dist = Math.hypot(rel.x, rel.z);
      m.x = xOf(bearingOf(rel));
    }
    marks.sort((a, b) => a.dist - b.dist);
    for (const m of marks) {
      const { dist, x } = m;
      if (dist < 6) continue;
      if (x < 8 || x > W - 8) continue;
      g.fillStyle = m.kind === 'portal' ? '#8ff3ff' : m.kind === 'hub' ? '#ffd27a' : m.kind === 'stage' ? '#ff9ad0' : '#b9f39a';
      g.beginPath();
      if (m.kind === 'portal') {
        g.moveTo(x, 6);
        g.lineTo(x + 5, 11);
        g.lineTo(x, 16);
        g.lineTo(x - 5, 11);
      } else g.arc(x, 11, 4, 0, Math.PI * 2);
      g.fill();
      const text = `${Math.round(dist)} m`;
      const half = g.measureText(text).width / 2 + 4;
      // In the way of one already printed: nudged aside a little if that clears it, else left off.
      let lx = x;
      const hit = () => shown.find(([a, b]) => lx + half > a && lx - half < b);
      for (let k = 0, h = hit(); h && k < 3; k++, h = hit()) lx = x < (h[0] + h[1]) / 2 ? h[0] - half : h[1] + half;
      if (hit() || Math.abs(lx - x) > 30 || lx - half < 0 || lx + half > W) continue;
      shown.push([lx - half, lx + half]);
      g.fillStyle = 'rgba(255, 255, 255, 0.85)';
      g.fillText(text, lx, 36);
    }
    g.fillStyle = '#ffffff';
    g.fillRect(W / 2 - 1, 0, 2, 5);

    // Minimap: centred on you, the way you look always up.
    const mc = hud.mini;
    const m = mc.getContext('2d');
    const R = mc.width / 2;
    m.clearRect(0, 0, mc.width, mc.height);
    m.save();
    m.beginPath();
    m.arc(R, R, R - 2, 0, Math.PI * 2);
    m.clip();
    m.fillStyle = '#cfc6ec';
    m.fillRect(0, 0, mc.width, mc.height);
    const metres = 85;
    const scale = R / metres / map.k;
    m.translate(R, R);
    m.rotate(-look);
    m.scale(scale, scale);
    m.drawImage(map.canvas, -map.X(state.pos.x), -map.Z(state.pos.z));
    m.restore();
    // Portals on it, and you: an arrow the way your Chog faces.
    m.save();
    m.translate(R, R);
    m.rotate(-look);
    for (const p of portals) {
      const dx = (p.at.x - state.pos.x) * (R / metres), dz = (p.at.z - state.pos.z) * (R / metres);
      if (Math.hypot(dx, dz) > R - 10) continue;
      m.save();
      m.translate(dx, dz);
      m.rotate(look);
      rune(m, 8);
      m.restore();
    }
    m.restore();
    m.save();
    m.translate(R, R);
    m.rotate(bearingOf(_v.set(Math.sin(state.yaw), 0, Math.cos(state.yaw))) - look);
    m.beginPath();
    m.moveTo(0, -11);
    m.lineTo(8, 9);
    m.lineTo(0, 4);
    m.lineTo(-8, 9);
    m.closePath();
    m.fillStyle = '#ffffff';
    m.strokeStyle = '#5b3fd6';
    m.lineWidth = 3;
    m.stroke();
    m.fill();
    m.restore();
    // The bezel (Celestial, the user's pick 10-21; it stands in for the compass strip): a gold rim, a tick
    // every 15 degrees, the bearings turning with the view, north a gold diamond, and the places off the
    // map as small gems on the rim at their bearing.
    const GOLD = '#ecdcae', INK = 'rgba(20, 12, 40, 0.72)';
    m.save();
    m.translate(R, R);
    m.lineWidth = 12;
    m.strokeStyle = 'rgba(22, 16, 44, 0.5)';
    m.beginPath();
    m.arc(0, 0, R - 8, 0, Math.PI * 2);
    m.stroke();
    m.lineWidth = 5;
    m.strokeStyle = GOLD;
    m.beginPath();
    m.arc(0, 0, R - 3, 0, Math.PI * 2);
    m.stroke();
    m.rotate(-look);
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2, big = k % 6 === 0;
      m.beginPath();
      m.moveTo(Math.sin(a) * (R - (big ? 22 : 16)), -Math.cos(a) * (R - (big ? 22 : 16)));
      m.lineTo(Math.sin(a) * (R - 6), -Math.cos(a) * (R - 6));
      m.lineWidth = big ? 4 : 2.5;
      m.strokeStyle = big ? GOLD : 'rgba(236, 220, 174, 0.65)';
      m.stroke();
    }
    m.font = '700 30px Cinzel, serif';
    m.textAlign = 'center';
    m.textBaseline = 'middle';
    m.lineJoin = 'round';
    for (const [label, a] of [['E', Math.PI / 2], ['S', Math.PI], ['W', -Math.PI / 2]]) {
      const x = Math.sin(a) * (R - 40), y = -Math.cos(a) * (R - 40);
      m.lineWidth = 7;
      m.strokeStyle = INK;
      m.strokeText(label, x, y + 2);
      m.fillStyle = GOLD;
      m.fillText(label, x, y + 2);
    }
    m.save();
    m.translate(0, -(R - 38));
    m.rotate(Math.PI / 4);
    m.fillStyle = GOLD;
    m.strokeStyle = INK;
    m.lineWidth = 5;
    m.strokeRect(-12, -12, 24, 24);
    m.fillRect(-12, -12, 24, 24);
    m.fillStyle = '#fffaf0';
    m.fillRect(-4.5, -4.5, 9, 9);
    m.restore();
    for (const l of landmarks) {
      const dx = l.at.x - state.pos.x, dz = l.at.z - state.pos.z;
      if (Math.hypot(dx, dz) * (R / metres) < R - 30) continue;
      const a = bearingOf(_v.set(dx, 0, dz));
      m.save();
      m.translate(Math.sin(a) * (R - 13), -Math.cos(a) * (R - 13));
      m.rotate(Math.PI / 4);
      m.fillStyle = l.kind === 'stage' ? '#ffb4dc' : '#9be7ff';
      m.strokeStyle = INK;
      m.lineWidth = 3;
      m.strokeRect(-6, -6, 12, 12);
      m.fillRect(-6, -6, 12, 12);
      m.restore();
    }
    m.restore();
    if (!hud.full.hidden) drawFull();
    return heading;
  }
  // A compass bearing for a direction in the world: 0 north (-z), a quarter turn east (+x).
  function bearingOf(d) {
    return Math.atan2(d.x, -d.z);
  }
  function rune(g, r) {
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.fillStyle = 'rgba(30, 20, 60, 0.75)';
    g.fill();
    g.lineWidth = 2.5;
    g.strokeStyle = '#8ff3ff';
    g.stroke();
    g.beginPath();
    g.arc(0, 0, r * 0.45, 0, Math.PI * 2);
    g.fillStyle = '#8ff3ff';
    g.fill();
  }
  function drawFull() {
    const c = hud.fullCanvas;
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = '#cfc6ec';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(map.canvas, 0, 0, c.width, c.height);
    const f = c.width / map.S;
    g.font = '600 22px Fredoka, sans-serif';
    g.textAlign = 'center';
    for (const p of portals) {
      const x = map.X(p.at.x) * f, y = map.Z(p.at.z) * f;
      g.save();
      g.translate(x, y);
      rune(g, 13);
      g.restore();
      g.fillStyle = '#2a1f4a';
      g.fillText(p.name, x, y - 22);
    }
    for (const l of landmarks) {
      if (l.kind === 'stage') continue;
      const x = map.X(l.at.x) * f, y = map.Z(l.at.z) * f;
      g.fillStyle = 'rgba(42, 31, 74, 0.8)';
      g.font = '600 18px Figtree, sans-serif';
      g.fillText(l.name, x, y + 30);
    }
    // You.
    const x = map.X(state.pos.x) * f, y = map.Z(state.pos.z) * f;
    g.save();
    g.translate(x, y);
    g.rotate(bearingOf(_v.set(Math.sin(state.yaw), 0, Math.cos(state.yaw))));
    g.beginPath();
    g.moveTo(0, -16);
    g.lineTo(12, 13);
    g.lineTo(0, 6);
    g.lineTo(-12, 13);
    g.closePath();
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#5b3fd6';
    g.lineWidth = 4;
    g.stroke();
    g.fill();
    g.restore();
    g.fillStyle = '#2a1f4a';
    g.font = '700 20px Fredoka, sans-serif';
    g.fillText('N', c.width / 2, 30);
  }

  // ---------- suspending and resuming round rooms ----------
  function suspend() {
    state.lastRoom = world.currentRoom?.() ?? null;
    document.body.classList.remove('travel');
    hud.root.hidden = true;
    hud.portal.hidden = true;
    keys.clear();
    stick.id = null;
    looks.clear();
    rig.enabled = true;
  }
  function resume() {
    document.body.classList.add('travel');
    hud.root.hidden = false;
    rig.enabled = false;
    rig.clearFocus?.();
    world.hideOldHud();
    // Out of a room: back at the door you went in by, a step outside, facing out.
    const d = state.lastDoor ?? (state.lastRoom?.id?.startsWith('home') ? homeDoor(state.lastRoom) : null);
    state.lastRoom = null;
    if (d) {
      // Where the Hub's walk out (src/entry.js) left it, with its view, if it walked out.
      const w = d.resume;
      delete d.resume;
      const p = w?.pos ?? d.at.clone().addScaledVector(d.out, /^(bar|casino|lobby)$/.test(d.room?.id ?? '') ? 9.5 : 6.5);
      const g = groundAt(p.x, p.z, p.y) ?? { y: heightAt(p.x, p.z) };
      state.pos.set(p.x, g.y, p.z);
      state.yaw = w?.yaw ?? Math.atan2(d.out.x, d.out.z);
      state.camYaw = w?.camYaw ?? state.yaw + Math.PI;
      if (w) state.camPitch = THREE.MathUtils.clamp(w.camPitch, CAM.pitchMin, CAM.pitchMax);
      state.lastDoor = null;
    }
    state.vel.set(0, 0, 0);
    state.move = '';
    state.chog.root.position.copy(state.pos);
    state.chog.root.rotation.y = state.yaw;
    state.chog.root.scale.setScalar(SCALE);
    state.chog.root.visible = true;
    state.chog.setFade?.(1);
    placeCamera(0, true);
  }

  // ---------- who you walk as ----------
  function takeChog(chog, own) {
    // Out walking from now on: the old fixed views and their menu go.
    document.body.classList.add('walking');
    if (state.chog && state.chog !== chog && !state.own) {
      state.chog.root.removeFromParent();
      state.chog.dispose?.();
    }
    state.chog = chog;
    state.own = own;
    root.add(chog.root);
    chog.root.scale.setScalar(SCALE);
    chog.lookAt?.(null);
  }
  function place(at, facing) {
    const g = groundAt(at.x, at.z, at.y ?? heightAt(at.x, at.z)) ?? { y: heightAt(at.x, at.z) };
    state.pos.set(at.x, g.y, at.z);
    state.yaw = facing;
    state.camYaw = facing + Math.PI;
    state.camPitch = CAM.pitch;
    state.camDist = CAM.dist;
    state.chog.root.position.copy(state.pos);
    state.chog.root.rotation.y = facing;
  }

  /** Your own Chog steps out of its dome to explore (after its hello, or coming out of its home). */
  async function beginOwn(s) {
    const home = homeDoor(s.room);
    if (!home) return;
    await world.dip(() => {
      takeChog(s.chog, true);
      const at = home.domeDoor.clone().addScaledVector(home.out, 3.2);
      place(at, Math.atan2(home.out.x, home.out.z));
      state.lastDoor = null;
    });
  }

  // The picker's portraits are short animated loops (tools/models/portraits.html, ~300 KB each): fetched
  // quietly once the world is up, so the picker opens with them already playing.
  const portraits = CAST.map((c) => `${import.meta.env.BASE_URL}faces/portraits/${c.id}.webp`);
  const warm = () => portraits.forEach((src) => (new Image().src = src));
  if (window.requestIdleCallback) requestIdleCallback(warm, { timeout: 8000 });
  else setTimeout(warm, 4000);

  /** A guest picks who to walk as, then beams down on the plaza. */
  function pickGuest() {
    return new Promise((resolve) => {
      const el = document.createElement('div');
      el.className = 'tv-pick';
      el.innerHTML = `<div class="tv-pick-card">
        <h2>Who are you exploring as?</h2>
        <p>Pick a Chog from the island's own crowd to walk around with.</p>
        <div class="tv-pick-grid">${CAST.map((c) => `<button data-id="${c.id}"><img src="${import.meta.env.BASE_URL}faces/portraits/${c.id}.webp" alt="" width="160" height="160"><strong>${c.name}</strong><span>${c.line}</span></button>`).join('')}</div>
      </div>`;
      document.body.append(el);
      requestAnimationFrame(() => el.classList.add('on'));
      el.querySelectorAll('button').forEach((b) =>
        b.addEventListener('click', async () => {
          const id = Number(b.dataset.id);
          el.classList.add('busy');
          b.classList.add('chosen');
          const info = await chogInfo(id).catch(() => ({ name: CAST.find((c) => c.id === id).name }));
          const chog = await makeChog({ ...info, traits: { ...info.traits, Aura: null }, ...modelFor(id, info.traits) });
          await world.prewarm?.(chog.root);
          el.classList.remove('on');
          setTimeout(() => el.remove(), 400);
          state.guestId = id;
          world.setAway?.(id, true);
          takeChog(chog, false);
          const pad = portalFx[0];
          place(pad.centre, pad.facing);
          state.onPortal = 0;
          if (!teleportFx?.arrives) chog.setBeam?.(1.1, 1);
          resolve();
          // Beams down onto the plaza's portal.
          pad.charge = 1;
          pad.beam = 1.4;
          if (teleportFx?.arrives) {
            await teleportFx.arrives({ chog, pad, scene, camera });
            if (teleportFx.facingAfter) state.yaw = teleportFx.facingAfter(pad);
          } else
            await tween(1.1, (t) => {
              pad.beam = (1 - t) * 1.4;
              chog.setBeam?.(1.1 - THREE.MathUtils.smoothstep(t, 0, 1) * 1.15, 1);
            });
          chog.setBeam?.(0, 0);
          pad.charge = 0;
          chog.play('wave');
        }),
      );
    });
  }

  /** Stop: signed out, or a guest leaving. */
  function end() {
    if (state.chog && !state.own) {
      state.chog.root.removeFromParent();
      state.chog.dispose?.();
      world.setAway?.(state.guestId, false);
    }
    state.chog = null;
    state.own = false;
    state.guestId = null;
    document.body.classList.remove('walking');
    suspend();
  }

  return {
    // The light of the moment, for the hoverboards' glow (main.js, each frame).
    setEnv(env) {
      lastEnv = env;
    },
    update,
    beginOwn,
    pickGuest,
    end,
    portals,
    // Where you are, by the nearest portal's place (for the postcard), and the cast Chog you walk as.
    placeName() {
      let best = null, bd = Infinity;
      for (const p of portals) {
        const d = Math.hypot(state.pos.x - p.at.x, state.pos.z - p.at.z);
        if (d < bd) (bd = d), (best = p);
      }
      return best && bd < 160 ? best.name : 'Chog World';
    },
    get guest() {
      const c = CAST.find((g) => g.id === state.guestId);
      return c ? { id: c.id, name: c.name } : null;
    },
    // The hoverboards (src/hoverboard.js), for the cast to keep clear of.
    get boards() {
      return boards.boards;
    },
    get active() {
      return state.on;
    },
    get chog() {
      return state.chog;
    },
    get state() {
      return state;
    },
    travelTo,
    groundAt,
    // Where the portal pads stand (the plaza's first).
    portals: () => portals.map((p) => p.at.clone()),
  };
}

/*
 * A waypoint portal (the user's pick, A): a stone pad ringed with runes that glow and turn, motes
 * drifting up, and a column of light when someone travels. charge (0 to 1) brightens it; beam (0 to
 * about 1.4) is the column.
 */
const runeTexture = (() => {
  let t = null;
  return () => {
    if (t) return t;
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const g = c.getContext('2d');
    const m = 256;
    g.strokeStyle = '#fff';
    g.lineWidth = 10;
    g.beginPath();
    g.arc(m, m, 232, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 5;
    g.beginPath();
    g.arc(m, m, 192, 0, Math.PI * 2);
    g.stroke();
    // Little marks round the band (drawn, so no font is needed).
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      g.save();
      g.translate(m + Math.cos(a) * 212, m + Math.sin(a) * 212);
      g.rotate(a + Math.PI / 2);
      g.lineWidth = 4;
      g.beginPath();
      const k = i % 3;
      if (k === 0) (g.moveTo(-7, -8), g.lineTo(0, 8), g.lineTo(7, -8));
      else if (k === 1) (g.moveTo(0, -9), g.lineTo(0, 9), g.moveTo(-6, 0), g.lineTo(6, 0));
      else g.arc(0, 0, 6, 0, Math.PI * 2);
      g.stroke();
      g.restore();
    }
    g.lineWidth = 3;
    g.beginPath();
    g.arc(m, m, 118, 0, Math.PI * 2);
    g.stroke();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      g.beginPath();
      g.moveTo(m + Math.cos(a) * 118, m + Math.sin(a) * 118);
      g.lineTo(m + Math.cos(a + Math.PI * (2 / 3)) * 118, m + Math.sin(a + Math.PI * (2 / 3)) * 118);
      g.stroke();
    }
    t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  };
})();
let moteTex = null;
function glowTexture() {
  if (moteTex) return moteTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.3, 'rgba(255,255,255,0.5)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  moteTex = new THREE.CanvasTexture(c);
  return moteTex;
}

function buildPortal(scene, p) {
  const S = SCALE;
  const g = new THREE.Group();
  g.position.copy(p.at);
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.6 * S, 1.75 * S, 0.3 * S, 48), new THREE.MeshStandardMaterial({ color: '#d2c9e2', roughness: 0.8 }));
  pad.position.y = 0.12 * S;
  pad.receiveShadow = true;
  pad.castShadow = true;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1.62 * S, 0.07 * S, 8, 64), new THREE.MeshStandardMaterial({ color: '#cfa84e', metalness: 0.75, roughness: 0.35 }));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.27 * S;
  const runeMat = new THREE.MeshBasicMaterial({ map: runeTexture(), color: '#7ee8ff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.35 });
  const runes = new THREE.Mesh(new THREE.PlaneGeometry(3.4 * S, 3.4 * S), runeMat);
  runes.rotation.x = -Math.PI / 2;
  runes.position.y = 0.285 * S;
  const beamMat = new THREE.ShaderMaterial({
    uniforms: { uI: { value: 0 }, uT: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: 'varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = -mv.xyz; vN = normalMatrix * normal; gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform float uI; uniform float uT; varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ float rim = pow(abs(dot(normalize(vN), normalize(vV))), 2.0); float bands = 0.75 + 0.25 * sin(vUv.y * 40.0 - uT * 12.0); float fade = smoothstep(0.0, 0.06, vUv.y) * (1.0 - vUv.y); gl_FragColor = vec4(vec3(0.55, 0.95, 1.0) * rim * bands * fade * uI, 1.0); }',
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.0 * S, 1.25 * S, 26, 40, 1, true), beamMat);
  beam.position.y = 13;
  beam.visible = false;
  const glowMat = new THREE.SpriteMaterial({ map: glowTexture(), color: '#7ee8ff', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.2 });
  const glow = new THREE.Sprite(glowMat);
  glow.scale.setScalar(6 * S);
  glow.position.y = 0.6 * S;
  g.add(pad, rim, runes, beam, glow);
  const motes = [];
  for (let i = 0; i < 26; i++) {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#9ff6ff', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    m.userData = { a: Math.random() * Math.PI * 2, r: 0.4 + Math.random() * 1.1, y: Math.random() * 4, sp: 0.5 + Math.random() };
    m.scale.setScalar(0.12 + Math.random() * 0.18);
    g.add(m);
    motes.push(m);
  }
  scene.add(g);
  let t = 0;
  let near = 0;
  const fx = {
    group: g,
    beamMesh: beam,
    centre: p.at.clone().setY(p.at.y + 0.27 * S),
    // Arriving, you face away from the pad's middle toward the place (the plaza's faces the Hub).
    // Which way you face arriving: toward what the portal looks out on.
    facing: Math.atan2(p.look.x - p.at.x, p.look.z - p.at.z),
    charge: 0,
    beam: 0,
    update(dt, on, who) {
      t += dt;
      near += ((on ? 1 : 0) - near) * (1 - Math.exp(-dt * 4));
      const c = Math.max(fx.charge, near * 0.55);
      runeMat.opacity = 0.32 + c * 0.68 + Math.sin(t * 2) * 0.04;
      runes.rotation.z += dt * (0.12 + c * 1.4);
      glowMat.opacity = 0.18 + c * 0.45 + fx.beam * 0.4;
      beam.visible = fx.beam > 0.01;
      beamMat.uniforms.uI.value = fx.beam;
      beamMat.uniforms.uT.value = t;
      // Motes only where someone might see them.
      if (who.distanceToSquared(g.position) > 140 * 140) return;
      for (const m of motes) {
        const u = m.userData;
        u.y += dt * u.sp * (0.35 + c * 2 + fx.beam * 3);
        if (u.y > 5) u.y = 0;
        u.a += dt * (0.4 + c * 2);
        m.position.set(Math.cos(u.a) * u.r * S, 0.4 + u.y * S * 0.7, Math.sin(u.a) * u.r * S);
        m.material.opacity = (0.25 + c * 0.75) * (1 - u.y / 5);
      }
    },
  };
  return fx;
}
