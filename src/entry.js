import * as THREE from 'three';
import { createFlight } from './flight.js';

/*
 * Walking into a room (the Hub's lobby and bar; the casino once it opens) as one unbroken move, no
 * fade. The camera flies up to the building's door, the doors swing open and it glides through,
 * down the short hall behind them and in through the room's own door. A slow sweep shows the room,
 * then the view settles and turns to the door as your Chog walks in (session.walkIn, A10); a guest's
 * view settles on whoever is there (session.focusIn). Leaving runs it the other way: your Chog walks
 * out (session.walkOut), the camera follows it through the halls, and the doors close behind as it
 * pulls back to the building. A tap or Esc skips to the end.
 *
 * Every room the cutscene can reach has an entrance (src/hub.js): its outside door, the hall's floor
 * and the room's door, all real geometry, so nothing has to be hidden by a cut. Nothing here builds a
 * shader: the rooms are compiled with the world at load.
 */

// The camera's eye height as a share of the outside doorway's.
const EYE = 0.46;
// The longest a walk may hold the camera before it settles anyway.
const WALK_MAX = 6;

const smooth = (t) => THREE.MathUtils.smoothstep(t, 0, 1);
const clamp01 = (t) => Math.min(1, Math.max(0, t));

export function createEntry({ camera, rig, hub, fovs, dom, session }) {
  const hubRooms = new Map(hub.rooms.map((h) => [h.id, h]));
  let run = null;
  // Doors still swinging after a cutscene ends (the room's door closing behind your Chog).
  const swings = [];

  const H = (x, y, z) => hub.group.localToWorld(new THREE.Vector3(x, y, z));
  const arr = (v) => v.toArray();
  const lookPoint = () => rig.target.clone();

  // The room's own door, in the world: where its middle is on the floor, and which way is in.
  function doorOf(r) {
    const hinge = r.room.doorway.hinge;
    hinge.updateWorldMatrix(true, false);
    const position = hinge.localToWorld(new THREE.Vector3(r.room.doorway.w / 2, 0, 0));
    const inward = new THREE.Vector3();
    hinge.parent.getWorldDirection(inward);
    return { position, inward, width: r.room.doorway.w, height: r.room.doorway.h, room: r };
  }
  const setRoomDoor = (r, k) => {
    const h = r.room.doorway.hinge;
    h.rotation.y = h.userData.dir * smooth(clamp01(k)) * 1.55;
  };
  const swing = (r, from, to, seconds) => {
    for (let i = swings.length - 1; i >= 0; i--) if (swings[i].r === r) swings.splice(i, 1);
    swings.push({ r, from, to, t: 0, seconds });
  };

  /*
   * The path in, as keys { t, pos, look } in the world. From wherever the camera is to just in front
   * of the outside door, through it and down the hall, in through the room's door, then a sweep across
   * the room that ends on the room's framed view.
   */
  function pathIn(r, e) {
    const room = r.room;
    const g = room.group;
    const L = (x, y, z) => g.localToWorld(new THREE.Vector3(x, y, z));
    const { w, d, h } = room;
    const eye = (e.top - e.sill) * EYE;
    const front = H(e.x, e.sill + eye + 1.2, e.z + 13);
    const startDist = camera.position.distanceTo(front);
    const t1 = THREE.MathUtils.clamp(0.8 + startDist / 60, 1.1, 2.2);
    const mid = (e.z + e.zIn) / 2;
    const keys = [
      { t: 0, pos: camera.position.clone(), look: lookPoint() },
      { t: t1, pos: front, look: H(e.x, e.sill + eye * 0.9, e.z - 4) },
      { t: t1 + 0.95, pos: H(e.x, e.sill + eye, e.z + 1.1), look: H(e.x, e.floor(e.zIn + 1) + eye * 0.85, e.zIn - 3) },
      { t: t1 + 1.5, pos: H(e.x, e.floor(mid) + eye, mid), look: L(0, h * 0.4, -d * 0.2) },
      // In through the room's door, then along the front wall and up to the room's framed view while
      // the gaze sweeps left to right across the room, keeping clear of whoever stands in it.
      { t: t1 + 2.05, pos: L(0, eye + 0.2, d / 2 - 1.6), look: L(-w * 0.32, h * 0.3, -d * 0.3) },
      { t: t1 + 3.2, pos: L(w * 0.12, h * 0.5, d * 0.36), look: L(w * 0.3, h * 0.28, -d * 0.36) },
      { t: t1 + 4.4, pos: r.view.pos.clone(), look: r.view.target.clone() },
    ];
    return { keys, t1, eye };
  }

  // The path out: to the room's door, back down the hall and out of the doors, then up and round to
  // the place's own framed view.
  function pathOut(r, e, end) {
    const room = r.room;
    const L = (x, y, z) => room.group.localToWorld(new THREE.Vector3(x, y, z));
    const { d } = room;
    const eye = (e.top - e.sill) * EYE;
    const mid = (e.z + e.zIn) / 2;
    const out = H(e.x, e.sill + eye, e.z + 1.8);
    const fwd = H(e.x, 0, e.z + 1).sub(H(e.x, 0, e.z)).normalize();
    const side = new THREE.Vector3(fwd.z, 0, -fwd.x);
    if (side.dot(end.pos.clone().sub(out)) < 0) side.negate();
    const pos = out.clone().addScaledVector(fwd, 11).addScaledVector(side, 3).add(new THREE.Vector3(0, 6.5, 0));
    const arc = { out, pos, look: pos.clone().addScaledVector(side, 16).addScaledVector(fwd, 4).add(new THREE.Vector3(0, -4, 0)) };
    const keys = [
      { t: 0, pos: camera.position.clone(), look: lookPoint() },
      { t: 1.1, pos: L(0, eye + 0.9, d / 2 - 2.6), look: H(e.x, e.floor(e.zIn + 1) + eye, e.zIn + 3) },
      { t: 1.75, pos: H(e.x, e.floor(e.zIn + 0.8) + eye, e.zIn + 0.8), look: H(e.x, e.sill + eye, e.z + 6) },
      { t: 2.3, pos: H(e.x, e.floor(mid) + eye, mid), look: H(e.x, e.sill + eye, e.z + 10) },
      { t: 2.9, pos: arc.out, look: H(e.x, e.sill + eye - 0.4, e.z + 14) },
      // Up and round to the side, looking along the building, so the turn back to it never sweeps
      // the gaze through the ground; then on to the place's own view.
      { t: 3.9, pos: arc.pos, look: arc.look },
      { t: 5.1, pos: end.pos, look: end.look },
    ];
    return { keys };
  }

  // Where the place's framed view will put the camera, without leaving any trace on the rig.
  function focusPose(place, theta) {
    const keep = {
      goal: { ...rig.goal, target: rig.goal.target.clone() },
      target: rig.target.clone(), dist: rig.dist, theta: rig.theta, phi: rig.phi,
      focused: rig.focused, saved: rig.saved, room: rig.room, view: rig.view, tween: rig.tween, onFocusChange: rig.onFocusChange,
    };
    const pos = camera.position.clone(), quat = camera.quaternion.clone(), fov = camera.fov;
    // Framed with the outdoor lens, as it will be once the camera is out.
    camera.fov = fovs.outdoor();
    camera.updateProjectionMatrix();
    rig.onFocusChange = null;
    rig.goal.theta = theta;
    rig.focusOn(place, { instant: true });
    rig.apply();
    const out = { pos: camera.position.clone(), look: rig.target.clone() };
    Object.assign(rig, keep, { goal: keep.goal });
    camera.position.copy(pos);
    camera.quaternion.copy(quat);
    camera.fov = fov;
    camera.updateProjectionMatrix();
    return out;
  }

  // A tap or Esc skips to the end; the rig sees neither while a cutscene runs.
  const block = (e) => {
    if (!run || (e.type === 'keydown' && e.key !== 'Escape')) return;
    e.stopImmediatePropagation();
    if (e.type !== 'pointerup') api.skip();
  };
  dom.addEventListener('pointerdown', block, { capture: true });
  dom.addEventListener('pointerup', block, { capture: true });
  window.addEventListener('keydown', block, { capture: true });

  const api = {
    get active() {
      return !!run;
    },
    // The room the cutscene counts as being in: all the way in, and on the way out until the camera
    // leaves the hall.
    get room() {
      if (!run) return null;
      return (run.mode === 'in' && run.t > run.inside) || (run.mode === 'out' && run.t < 2.3) ? run.r : null;
    },
    // Whether there is a way to fly into this room (from outside), or out of it (from inside).
    can(r) {
      return !run && !!hubRooms.get(r.id)?.entrance && !rig.room;
    },
    canLeave(r) {
      return !run && !!hubRooms.get(r.id)?.entrance && rig.room === r.pod;
    },

    enter(r) {
      const e = hubRooms.get(r.id).entrance;
      const { keys, t1 } = pathIn(r, e);
      const flight = createFlight({ keys: keys.map((k) => ({ t: k.t, pos: arr(k.pos), look: arr(k.look) })) });
      const door = doorOf(r);
      const ses = session();
      const final = new THREE.Vector3();
      return new Promise((resolve) => {
        run = {
          r, e, t: 0, flight, resolve, mode: 'in',
          // The room counts as entered from the start, so its people are there, done appearing, by the
          // time the camera comes in (their words wait for the camera to be inside).
          inside: 0,
          // The outside doors open as the camera comes up the steps; the room's door as it crosses the hall.
          doors: (t) => {
            e.open(clamp01((t - (t1 - 0.45)) / 1.2) - clamp01((t - (t1 + 2.6)) / 1.2));
            setRoomDoor(r, (t - (t1 + 0.7)) / 0.9);
          },
          // The room shows from when the doors start to open.
          showRoom: (t) => t > t1 - 0.5,
          fovK: (t) => clamp01((t - (t1 + 1.3)) / 1.0),
          stage: 'fly',
          walk: null,
          final,
          finish: () => {
            // Settle where the room's view is, looking where the last move ended.
            const pos = r.view.pos.clone();
            const look = final.lengthSq() ? final.clone() : r.view.target.clone();
            rig.views.entry = { pos, target: look, enter: true };
            rig.jump('entry');
            e.open(0);
            // The room's door closes once your Chog is through it.
            const walk = run.walk;
            if (walk && !walk.done) walk.promise.finally(() => swing(r, 1, 0, 0.9));
            else swing(r, 1, 0, 0.9);
          },
          // After the sweep: turn to the door for your Chog, or settle on who is in the room.
          startPan: () => {
            const walk = ses?.walkIn?.(r, door);
            const spot = ses?.focusIn?.(r);
            run.spot = spot ?? null;
            const state = walk ? { promise: Promise.resolve(walk), chog: walk.chog ?? null, at: run.t, done: false } : null;
            if (state) state.promise.finally(() => (state.done = true));
            run.walk = state;
            run.panFrom = r.view.target.clone();
            run.panTo = walk ? door.position.clone().addScaledVector(door.inward, 1.2).setY(door.position.y + 1.3) : spot?.clone() ?? r.view.target.clone();
            run.panAt = run.t;
          },
        };
      });
    },

    leave(r, place) {
      const e = hubRooms.get(r.id).entrance;
      const out = new THREE.Vector3().subVectors(H(e.x, 0, e.z + 1), H(e.x, 0, e.z));
      const theta = Math.atan2(out.x, out.z);
      const end = focusPose(place, theta);
      const { keys } = pathOut(r, e, end);
      const flight = createFlight({ keys: keys.map((k) => ({ t: k.t, pos: arr(k.pos), look: arr(k.look) })) });
      const ses = session();
      ses?.walkOut?.(r, doorOf(r));
      return new Promise((resolve) => {
        run = {
          r, e, t: 0, flight, resolve, mode: 'out', stage: 'fly',
          doors: (t) => {
            setRoomDoor(r, clamp01((t - 0.2) / 0.8) - clamp01((t - 2.4) / 0.8));
            e.open(clamp01((t - 1.0) / 0.9) - clamp01((t - 3.4) / 1.1));
          },
          showRoom: (t) => t < 2.6,
          fovK: (t) => 1 - clamp01((t - 1.5) / 1.0),
          finish: () => {
            e.open(0);
            setRoomDoor(r, 0);
            camera.fov = fovs.outdoor();
            camera.updateProjectionMatrix();
            rig.goal.theta = theta;
            rig.focusOn(place, { instant: true });
          },
        };
      });
    },

    // Straight to the end: doors as they end up, the camera handed back to the rig.
    skip() {
      if (!run) return;
      if (run.mode === 'in' && run.stage === 'fly') {
        run.startPan();
        run.walk?.promise.skip?.();
      }
      end();
    },

    // Called after rig.update: puts the camera on the cutscene's path.
    update(dt) {
      for (let i = swings.length - 1; i >= 0; i--) {
        const s = swings[i];
        s.t = Math.min(1, s.t + dt / s.seconds);
        setRoomDoor(s.r, s.from + (s.to - s.from) * s.t);
        if (s.t >= 1) swings.splice(i, 1);
      }
      if (!run) return;
      run.t += Math.min(dt, 1 / 20);
      const t = run.t;
      run.doors(t);
      if (run.stage === 'fly') {
        run.flight.pose(camera, Math.min(t, run.flight.duration));
        if (t >= run.flight.duration) {
          if (run.mode === 'out') return end();
          run.stage = 'pan';
          run.startPan();
          // Nobody to turn to: the sweep was the ending.
          if (!run.walk && !run.spot) return end();
        }
        return;
      }
      // The pan: from the room's view to the door (and the Chog coming through it), or to the room's
      // people, then holding there until the walk is done.
      const k = smooth(clamp01((t - run.panAt) / 1.1));
      const look = run.panFrom.clone().lerp(run.panTo, k);
      const w = run.walk;
      if (w?.chog && t - w.at > 0.9) {
        const p = w.chog.getWorldPosition(new THREE.Vector3());
        p.y += 1.2;
        run.follow = (run.follow ?? look.clone()).lerp(p, 1 - Math.exp(-dt * 3));
        look.copy(run.follow);
      }
      camera.position.copy(run.r.view.pos);
      camera.lookAt(look);
      camera.updateMatrixWorld();
      run.final.copy(look);
      const walking = w && !w.done && t - w.at < WALK_MAX;
      if (!walking && t - run.panAt > 1.3) end();
    },

    // Called after the world's own update: shows the room while the camera is still outside it.
    apply(env, renderer) {
      if (!run || !run.showRoom(run.t)) return;
      const room = run.r.room;
      if (!room.group.visible) {
        room.group.visible = true;
        room.update?.(env, renderer);
      }
    },

    // The lens: widening from the outdoor one to the room's as the camera comes in.
    fov() {
      if (!run) return null;
      const k = smooth(run.fovK(run.t));
      return fovs.outdoor() + (fovs.indoor() - fovs.outdoor()) * k;
    },
  };

  function end() {
    const r = run;
    if (!r) return;
    r.finish();
    run = null;
    r.resolve();
  }

  return api;
}
