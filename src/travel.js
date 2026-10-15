import * as THREE from 'three';
import { makeChog, CHOG_HEIGHT } from './chog.js';
import { chogInfo } from './chogdata.js';
import { modelFor } from './traitmap.js';
import { ISLANDS, HOODS, DOMES, DOME_R, DOWNTOWN, ROADS, TERRACES, PORTAL_SPOTS } from './layout.js';
import { heightAt, islandAt, cameraFloor, rimPoint } from './terrain.js';
import { RoomBox } from './camera.js';

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
const WALK = 3.6;
const RUN = 7.2;
const ACCEL = 9;
const TURN = 11;
const RADIUS = 0.9;
const STEP_UP = 1.25;
// Steeper than this (rise over run) is a cliff: you walk along it, not up it. A bridge's stair is about 0.4.
const MAX_SLOPE = 1.1;
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
  // The Hub's doors (hub space to the world): where you walk in, and which way is out.
  const doors = hub.rooms.map((h) => {
    const e = h.entrance;
    const at = hub.group.localToWorld(new THREE.Vector3(e.x, 0, e.z + 0.6));
    const out = hub.group.localToWorld(new THREE.Vector3(e.x, 0, e.z + 2)).sub(hub.group.localToWorld(new THREE.Vector3(e.x, 0, e.z))).setY(0).normalize();
    return { id: h.id, name: h.name, at, out, half: e.half, room: island.rooms.find((r) => r.id === h.id) };
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
  for (const p of portals) p.at.y = heightAt(p.at.x, p.at.z);
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
    camPos: new THREE.Vector3(),
    camLook: new THREE.Vector3(),
    lastLook: 0, // seconds since you last turned the view yourself
    move: '',
    busy: null, // a portal trip or a door: input waits
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
  const map = drawMap();

  // ---------- input ----------
  const keys = new Set();
  const stick = { id: null, x0: 0, y0: 0, x: 0, y: 0 };
  const looks = new Map();
  let pinch = null;
  const block = () => !state.on || state.busy;
  dom.addEventListener('pointerdown', (e) => {
    if (!state.on) return;
    e.stopImmediatePropagation();
    dom.setPointerCapture(e.pointerId);
    // A touch low on the left half is the joystick; anything else turns the view.
    if (e.pointerType === 'touch' && stick.id === null && e.clientX < window.innerWidth * 0.5 && e.clientY > window.innerHeight * 0.35 && !state.busy) {
      Object.assign(stick, { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY });
      hud.stick.hidden = false;
      hud.stick.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      hud.knob.style.transform = 'translate(0px, 0px)';
      hud.hint.classList.add('gone');
      return;
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
      const r = Math.min(1, Math.hypot(dx, dy) / 56);
      const a = Math.atan2(dy, dx);
      hud.knob.style.transform = `translate(${Math.cos(a) * r * 56}px, ${Math.sin(a) * r * 56}px)`;
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
      hud.stick.hidden = true;
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
  }, { capture: true });
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());

  // What you're asking for this frame: a direction relative to the camera (x right, y forward), 0 to 1.
  function wish() {
    if (block()) return { x: 0, y: 0, run: false };
    let x = 0, y = 0, run = keys.has('shift');
    if (keys.has('w') || keys.has('arrowup')) y += 1;
    if (keys.has('s') || keys.has('arrowdown')) y -= 1;
    if (keys.has('d') || keys.has('arrowright')) x += 1;
    if (keys.has('a') || keys.has('arrowleft')) x -= 1;
    const l = Math.hypot(x, y);
    if (l > 1) (x /= l), (y /= l);
    if (stick.id !== null) {
      const dx = stick.x - stick.x0, dy = stick.y - stick.y0;
      const d = Math.hypot(dx, dy);
      if (d > 6) {
        const k = Math.min(1, d / 56);
        x = (dx / d) * k;
        y = (-dy / d) * k;
        run = k > 0.92;
      }
    }
    return { x, y, run };
  }

  // ---------- the ground ----------
  // Where you can stand at (x, z), and how high: on an island (clear of its very rim) or a bridge's deck.
  function groundAt(x, z, nearY) {
    const options = [];
    for (const br of bridges) {
      const ux = (br.bx - br.ax) / br.len, uz = (br.bz - br.az) / br.len;
      const along = (x - br.ax) * ux + (z - br.az) * uz;
      const side = (x - br.ax) * -uz + (z - br.az) * ux;
      if (along < -0.5 || along > br.len + 0.5 || Math.abs(side) > br.width / 2 - 0.45) continue;
      options.push({ y: br.deckY(THREE.MathUtils.clamp(along / br.len, 0, 1)) + 0.15, on: 'bridge' });
    }
    const hit = islandAt(x, z);
    if (hit && hit.k < 0.955) options.push({ y: heightAt(x, z), on: 'land' });
    if (!options.length) return null;
    return options.reduce((a, b) => (Math.abs(a.y - nearY) <= Math.abs(b.y - nearY) ? a : b));
  }

  // Push a step clear of walls: domes (in and out only by their doors), buildings, the fountain, people.
  function collide(from, to) {
    for (const s of solids) {
      const dx = to.x - s.x, dz = to.z - s.z;
      const d = Math.hypot(dx, dz);
      if (d > s.r + 6) continue;
      if (s.enterable && s.facing !== null) {
        // A dome: the glass is a wall except at its door.
        const fromIn = Math.hypot(from.x - s.x, from.z - s.z) < s.r;
        const atDoor = s.atDoor(to) || s.atDoor(from);
        if (atDoor) continue;
        if (fromIn && d > s.r - RADIUS) to.set(s.x + (dx / d) * (s.r - RADIUS), to.y, s.z + (dz / d) * (s.r - RADIUS));
        else if (!fromIn && d < s.r + RADIUS) to.set(s.x + (dx / (d || 1)) * (s.r + RADIUS), to.y, s.z + (dz / (d || 1)) * (s.r + RADIUS));
      } else if (d < s.r + RADIUS) {
        const k = (s.r + RADIUS) / (d || 1);
        to.set(s.x + dx * k, to.y, s.z + dz * k);
      }
    }
    for (const b of blocks) {
      const dx = to.x - b.p.x, dz = to.z - b.p.z;
      const d = Math.hypot(dx, dz);
      if (d < b.r + RADIUS) to.set(b.p.x + (dx / (d || 1)) * (b.r + RADIUS), to.y, b.p.z + (dz / (d || 1)) * (b.r + RADIUS));
    }
    // The cast: a gentle shove round them rather than through.
    for (const c of world.npcRoots?.() ?? []) {
      if (c === state.chog?.root || !c.visible) continue;
      c.getWorldPosition(_v);
      const dx = to.x - _v.x, dz = to.z - _v.z;
      const d = Math.hypot(dx, dz);
      const r = 1.1 * c.getWorldScale(_w).y + RADIUS * 0.6;
      if (d < r && Math.abs(_v.y - to.y) < 3) to.set(_v.x + (dx / (d || 1)) * r, to.y, _v.z + (dz / (d || 1)) * r);
    }
    return to;
  }

  // ---------- the camera ----------
  function placeCamera(dt, snap = false) {
    const look = _v.copy(state.pos);
    look.y += CAM.look;
    // Behind and above, by yaw and pitch, pulled in where something's in the way.
    const cp = Math.cos(state.camPitch);
    const dir = _w.set(Math.sin(state.camYaw) * cp, Math.sin(state.camPitch), Math.cos(state.camYaw) * cp);
    const want = new THREE.Vector3();
    let dist = state.camDist;
    const inTunnel = tunnels?.inside(look);
    const steps = 14;
    for (let i = 1; i <= steps; i++) {
      const d = (dist * i) / steps;
      want.copy(look).addScaledVector(dir, d);
      if (blocked(want, inTunnel)) {
        dist = Math.max(2.6, d - dist / steps);
        break;
      }
    }
    // No room behind (a wall at your back): look down from higher up rather than crowd into your Chog.
    if (dist < 4.6) {
      for (const lift of [0.35, 0.7, 1.0]) {
        const pitch = Math.min(CAM.pitchMax, state.camPitch + lift);
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
        if (ok > dist + 1) {
          dir.copy(dir2);
          dist = ok;
        }
        if (dist >= 4.6) break;
      }
    }
    want.copy(look).addScaledVector(dir, dist);
    // Never under the grass (a bridge's deck counts when you're on it).
    const floor = inTunnel ? look.y - CAM.look + 0.8 : cameraFloor(want.x, want.z, 1.2);
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
  function blocked(p, inTunnel) {
    if (inTunnel && !tunnels.inside(p)) return true;
    for (const s of solids) {
      if (s.enterable) continue;
      if (Math.abs(p.x - s.x) > s.reach || Math.abs(p.z - s.z) > s.reach) continue;
      if (s.inside(p, 0.4)) return true;
    }
    return p.y < cameraFloor(p.x, p.z, 0.6);
  }

  // ---------- each frame ----------
  let lastT = 0;
  function update(dt) {
    const chog = state.chog;
    // A room, a cutscene or the session has your Chog (going home, the sale): step aside.
    if (state.own && chog && world.session()?.active?.chog !== chog) end();
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
    const fwd = _v.set(-Math.sin(state.camYaw), 0, -Math.cos(state.camYaw));
    const right = _w.set(-fwd.z, 0, fwd.x);
    const want = new THREE.Vector3().addScaledVector(fwd, w.y).addScaledVector(right, w.x);
    const mag = Math.min(1, want.length());
    const top = w.run ? RUN : WALK + (RUN - WALK) * Math.max(0, mag - 0.75) * 0;
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
    const climbable = (gy, x, z) => gy - state.pos.y < STEP_UP && (gy - state.pos.y < 0.12 || (gy - state.pos.y) / Math.max(Math.hypot(x - state.pos.x, z - state.pos.z), 1e-3) < MAX_SLOPE);
    if (g && climbable(g.y, next.x, next.z)) {
      next.y = g.y;
      state.pos.copy(next);
    } else {
      // A cliff, the rim or a wall too high: slide along it instead (try each axis on its own).
      for (const axis of ['x', 'z']) {
        const t = state.pos.clone();
        t[axis] = next[axis];
        const g2 = groundAt(t.x, t.z, state.pos.y);
        if (g2 && climbable(g2.y, t.x, t.z)) {
          t.y = g2.y;
          state.pos.copy(t);
          break;
        }
      }
      state.vel.multiplyScalar(0.4);
    }
    chog.root.position.copy(state.pos);
    chog.root.rotation.y = state.yaw;
    animate(chog, speed, dt);
    if (!state.own) chog.update(dt, camera);

    // The camera swings round behind you as you go (unless you've just turned it yourself).
    state.lastLook += dt;
    // Only while you're heading away from the camera: swinging round as you walk sideways would curl
    // your path into a circle.
    if (speed > 0.6 && state.lastLook > 1.2 && w.y > 0.55 && Math.abs(w.x) < 0.45) {
      const behind = state.yaw + Math.PI;
      state.camYaw += wrap(behind - state.camYaw) * (1 - Math.exp(-dt * 1.4 * Math.min(1, speed / WALK)));
    }
    if (keys.has('q')) state.camYaw += dt * 1.8;
    if (keys.has('e')) state.camYaw -= dt * 1.8;
    placeCamera(dt);

    // Doors and portals underfoot.
    if (!state.busy) {
      checkDoors();
      checkPortals();
    }
    lastT += dt;
    if (lastT > 1 / 30) {
      lastT = 0;
      drawHud();
    }
    return true;
  }

  // Idle, walk or run, its legs keeping pace with how fast it's actually going.
  function animate(chog, speed, dt) {
    const walkV = (chog.speedOf?.('walk') || 1) * SCALE;
    const runV = (chog.speedOf?.('run') || 2.4) * SCALE;
    let move = speed < 0.25 ? 'idle' : speed < (WALK + RUN) / 2 ? 'walk' : 'run';
    if (move !== state.move) {
      state.move = move;
      chog.play(move);
    }
    if (move === 'walk') chog.setPace(THREE.MathUtils.clamp(speed / walkV, 0.7, 1.7));
    else if (move === 'run') chog.setPace(THREE.MathUtils.clamp(speed / runV, 0.8, 1.9));
    else chog.setPace(1);
  }

  // ---------- doors ----------
  function checkDoors() {
    if (state.vel.lengthSq() < 0.5) return;
    for (const d of doors) {
      if (!d.room || !world.canEnter(d.room)) continue;
      const rel = _v.subVectors(state.pos, d.at).setY(0);
      const ahead = rel.dot(d.out);
      const side = Math.abs(rel.x * d.out.z - rel.z * d.out.x);
      // Right at the door, walking into it.
      if (ahead > -0.5 && ahead < 3.2 && side < d.half + 0.6 && state.vel.dot(d.out) < -0.8) {
        state.lastDoor = d;
        world.enterRoom(d.room);
        return;
      }
    }
    // Your own house in your own dome: walk up to its door to go in.
    const s = world.session()?.active;
    if (state.own && s?.room) {
      const home = homeDoor(s.room);
      if (home && _v.subVectors(state.pos, home.at).setY(0).length() < 2.6 && state.vel.dot(home.out) < -0.8) {
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
    state.busy = 'portal';
    state.vel.set(0, 0, 0);
    const chog = state.chog;
    chog.play('idle');
    state.move = 'idle';
    // Onto the middle of the pad, facing the camera, while the runes charge.
    const start = state.pos.clone();
    await tween(0.55, (t) => {
      state.pos.lerpVectors(start, from.centre, THREE.MathUtils.smootherstep(t, 0, 1));
      chog.root.position.copy(state.pos);
      from.charge = t;
    });
    // Up into the light, from the feet.
    await tween(1.15, (t) => {
      from.beam = Math.sin(t * Math.PI) + t * 0.4;
      chog.setBeam?.(THREE.MathUtils.smoothstep(t, 0, 1) * 1.1, 1);
    });
    chog.root.visible = false;
    await flash(true);
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
    to.beam = 1.4;
    await flash(false);
    chog.root.visible = true;
    // Down out of the light, from the head.
    await tween(1.05, (t) => {
      to.beam = (1 - t) * 1.4;
      chog.setBeam?.(1.1 - THREE.MathUtils.smoothstep(t, 0, 1) * 1.15, -1);
    });
    chog.setBeam?.(0, 0);
    to.charge = 0;
    chog.play('wave');
    state.move = 'wave';
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
  function flash(on) {
    hud.flash.classList.toggle('on', on);
    return new Promise((r) => setTimeout(r, on ? 260 : 220));
  }

  // ---------- the HUD ----------
  function buildHud() {
    const wrapEl = document.createElement('div');
    wrapEl.id = 'travel-hud';
    wrapEl.hidden = true;
    wrapEl.innerHTML = `
      <canvas class="tv-compass" width="560" height="44" aria-label="Compass"></canvas>
      <button class="tv-map" aria-label="Open the map"><canvas width="300" height="300"></canvas></button>
      <div class="tv-stick" hidden><div class="tv-knob"></div></div>
      <div class="tv-portal" hidden></div>
      <p class="tv-hint">${isTouch ? 'Drag on the left to walk, on the right to look round. Pinch to zoom.' : 'WASD to walk, Shift to run. Drag to look round, scroll to zoom. M for the map.'}</p>
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
    for (const m of marks) {
      const rel = _w.subVectors(m.at, state.pos);
      const dist = Math.hypot(rel.x, rel.z);
      if (dist < 6) continue;
      const x = xOf(bearingOf(rel));
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
      g.fillStyle = 'rgba(255, 255, 255, 0.85)';
      g.fillText(`${Math.round(dist)} m`, x, 36);
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
    // North on the rim.
    const nx = R + Math.sin(-look) * (R - 15), ny = R - Math.cos(-look) * (R - 15);
    m.fillStyle = '#2a1f4a';
    m.beginPath();
    m.arc(nx, ny, 11, 0, Math.PI * 2);
    m.fill();
    m.fillStyle = '#fff';
    m.font = '700 14px Fredoka, sans-serif';
    m.textAlign = 'center';
    m.textBaseline = 'middle';
    m.fillText('N', nx, ny + 1);
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
      const p = d.at.clone().addScaledVector(d.out, 6.5);
      const g = groundAt(p.x, p.z, p.y) ?? { y: heightAt(p.x, p.z) };
      state.pos.set(p.x, g.y, p.z);
      state.yaw = Math.atan2(d.out.x, d.out.z);
      state.camYaw = state.yaw + Math.PI;
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
          chog.setBeam?.(1.1, -1);
          resolve();
          // Beams down onto the plaza's portal.
          pad.charge = 1;
          pad.beam = 1.4;
          await tween(1.1, (t) => {
            pad.beam = (1 - t) * 1.4;
            chog.setBeam?.(1.1 - THREE.MathUtils.smoothstep(t, 0, 1) * 1.15, -1);
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
    update,
    beginOwn,
    pickGuest,
    end,
    portals,
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
