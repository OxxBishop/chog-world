import * as THREE from 'three';
import { createFlight } from './flight.js';

/*
 * Walking into a room (the Hub's lobby and bar; the casino once it opens) as one unbroken move, no
 * fade. The camera flies up to the building's door, the doors swing open and it glides through,
 * down the short hall behind them and in through the room's own door. A slow sweep shows the room,
 * then the view settles and turns to the door as your Chog comes through it (session.walkIn, A10),
 * follows it to its spot and settles back on the room's view once it faces you (in the bar, on it
 * and its partner). A guest's view settles on whoever is there (session.focusIn), or the sweep is the
 * ending. Leaving runs it the other way: the camera watches your Chog walk out of the room's door
 * (session.walkOut), then goes out after it through the hall, and the doors close behind as it pulls
 * back to the building. A tap or Esc skips to the end.
 *
 * Every room the cutscene can reach has an entrance (src/hub.js): its outside door, the hall's floor
 * and the room's door, all real geometry, so nothing has to be hidden by a cut. Nothing here builds a
 * shader: the rooms are compiled with the world at load.
 */

// The camera's eye height as a share of the outside doorway's.
const EYE = 0.46;
// The longest a walk may hold the camera before it settles anyway.
const WALK_MAX = 6;
// When your Chog steps through the door, after the camera comes in (see pathIn): as the gaze comes
// round to the door.
const STEP = 3.2;
// The longest the camera waits on your Chog walking out.
const WALK_OUT_MAX = 4.5;
// Where the camera looks on a Chog: about its middle.
const CHOG_MID = 1.0;

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
  // Your Chog's model, while it is out in room r with you (A's session puts it in the room's group).
  const chogIn = (r) => {
    const root = session()?.active?.chog?.root;
    return root && root.parent === r.room.group ? root : null;
  };
  const midOf = (root) => root.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, CHOG_MID, 0));

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
   * the room that ends on the room's framed view. With your Chog walking in, the sweep comes on round
   * to the door instead, to meet it coming through.
   */
  function pathIn(r, e, owner, doorLook) {
    const room = r.room;
    const g = room.group;
    const L = (x, y, z) => g.localToWorld(new THREE.Vector3(x, y, z));
    const { w, d, h } = room;
    const eye = (e.top - e.sill) * EYE;
    const front = H(e.x, e.sill + eye + 1.2, e.z + 13);
    const startDist = camera.position.distanceTo(front);
    const t1 = THREE.MathUtils.clamp(0.7 + startDist / 70, 1.0, 1.9);
    const mid = (e.z + e.zIn) / 2;
    const keys = [
      { t: 0, pos: camera.position.clone(), look: lookPoint() },
      { t: t1, pos: front, look: H(e.x, e.sill + eye * 0.9, e.z - 4) },
      { t: t1 + 0.95, pos: H(e.x, e.sill + eye, e.z + 1.1), look: H(e.x, e.floor(e.zIn + 1) + eye * 0.85, e.zIn - 3) },
      { t: t1 + 1.5, pos: H(e.x, e.floor(mid) + eye, mid), look: L(0, h * 0.4, -d * 0.2) },
    ];
    // In through the room's door, then along the front wall and up to the room's framed view while
    // the gaze sweeps right to left across the room (away from the open door), keeping clear of
    // whoever stands in it.
    if (owner)
      keys.push(
        { t: t1 + 2.05, pos: L(0, eye + 0.2, d / 2 - 1.6), look: L(w * 0.32, h * 0.3, -d * 0.3) },
        { t: t1 + 3.1, pos: L(w * 0.12, h * 0.5, d * 0.36), look: L(-w * 0.3, h * 0.28, -d * 0.36) },
        { t: t1 + 3.9, pos: r.view.pos.clone(), look: doorLook.clone() },
      );
    else
      keys.push(
        { t: t1 + 2.05, pos: L(0, eye + 0.2, d / 2 - 1.6), look: L(w * 0.32, h * 0.3, -d * 0.3) },
        { t: t1 + 3.2, pos: L(w * 0.12, h * 0.5, d * 0.36), look: L(-w * 0.24, h * 0.28, -d * 0.36) },
        { t: t1 + 4.4, pos: r.view.pos.clone(), look: r.view.target.clone() },
      );
    return { keys, t1, eye };
  }

  // The path out: to the room's door, back down the hall and out of the doors, then up and round to
  // the place's own framed view.
  function pathOut(r, e, end, start) {
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
      { t: 0, pos: start.pos, look: start.look },
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
      if (run.mode === 'in') return run.t > run.inside ? run.r : null;
      return run.stage === 'turn' || run.t < 2.3 ? run.r : null;
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
      const g = r.room.group;
      const ses = session();
      // Just inside the room's door, where your Chog comes in.
      const doorLook = g.localToWorld(new THREE.Vector3(0, CHOG_MID + 0.15, r.room.d / 2 - 1.1));
      const owner = !!ses?.active?.chog && !ses.active.leaving;
      const { keys, t1 } = pathIn(r, e, owner, doorLook);
      const flight = createFlight({ keys: keys.map((k) => ({ t: k.t, pos: arr(k.pos), look: arr(k.look) })) });
      return new Promise((resolve) => {
        const me = {
          r, e, t: 0, flight, resolve, mode: 'in', stage: 'fly', owner, doorLook, doneAt: null,
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
          walk: null,
          look: new THREE.Vector3(),
          // Your Chog walks in with you (A10). Called the frame the room first shows, so it is never seen
          // already placed; it steps through the door as the camera's gaze comes round to it.
          // What the camera follows is A's: your Chog, or in the bar a mark easing to the pair.
          startWalk: () => {
            const promise = ses?.walkIn?.(r, undefined, { delay: Math.max(0, t1 + STEP - me.t) }) ?? null;
            const root = promise ? promise.chog ?? chogIn(r) : null;
            const w = { promise, root, own: !!root && root === chogIn(r), done: !root };
            if (root) Promise.resolve(promise).finally(() => (w.done = true));
            me.walk = w;
          },
          finish: () => {
            // Settle on the room's view, looking where the last move ended.
            const look = me.look.lengthSq() ? me.look.clone() : r.view.target.clone();
            rig.views.entry = { pos: r.view.pos.clone(), target: look, enter: true };
            rig.jump('entry');
            e.open(0);
            // The room's door closes once your Chog is through it.
            const w = me.walk;
            if (w && !w.done) Promise.resolve(w.promise).finally(() => swing(r, 1, 0, 0.9));
            else swing(r, 1, 0, 0.9);
          },
        };
        run = me;
      });
    },

    leave(r, place) {
      const e = hubRooms.get(r.id).entrance;
      const out = new THREE.Vector3().subVectors(H(e.x, 0, e.z + 1), H(e.x, 0, e.z));
      const theta = Math.atan2(out.x, out.z);
      const end = focusPose(place, theta);
      const root = chogIn(r);
      return new Promise((resolve) => {
        const me = {
          r, e, t: 0, resolve, mode: 'out',
          // With your Chog in the room, the camera first watches it walk out of the door (A10).
          stage: root ? 'turn' : 'fly',
          turnT: 0,
          root,
          look: lookPoint(),
          walked: false,
          // The flight out, from wherever the camera ends up watching.
          fly: () => {
            const { keys } = pathOut(r, e, end, { pos: camera.position.clone(), look: me.look.clone() });
            me.flight = createFlight({ keys: keys.map((k) => ({ t: k.t, pos: arr(k.pos), look: arr(k.look) })) });
            me.stage = 'fly';
          },
          doorK: 0,
          doors: (t) => {
            const open = me.root ? clamp01(me.doorK + t / 0.6) : clamp01((t - 0.2) / 0.8);
            setRoomDoor(r, open - clamp01((t - 2.4) / 0.8));
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
        if (root) Promise.resolve(session()?.walkOut?.(r)).finally(() => (me.walked = true));
        else me.fly();
        run = me;
      });
    },

    // Straight to the end: doors as they end up, your Chog in its place, the camera handed to the rig.
    skip() {
      if (!run) return;
      if (run.mode === 'in') {
        if (!run.walk) run.startWalk();
        run.walk.promise?.skip?.();
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
      const step = Math.min(dt, 1 / 20);
      if (run.stage === 'turn') return turn(step);
      run.t += step;
      const t = run.t;
      run.doors(t);
      if (run.stage === 'fly') {
        if (run.mode === 'in' && !run.walk && run.showRoom(t)) run.startWalk();
        run.flight.pose(camera, Math.min(t, run.flight.duration));
        if (t < run.flight.duration) return;
        if (run.mode === 'out') return end();
        run.panAt = t;
        if (run.owner) run.stage = 'pan';
        else {
          // A guest: on to the room's people, or the sweep was the ending.
          run.spot = session()?.focusIn?.(run.r) ?? null;
          if (!run.spot) return end();
          run.stage = 'spot';
        }
        return;
      }
      if (run.stage === 'spot') return spot(t);
      pan(t);
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

  // From the room's view, looking at its door: along with your Chog as it comes through to its spot,
  // and back to the room's view once it stands facing you. A mark of A's (the bar's pair) is followed
  // to the end instead.
  function pan(t) {
    const { r, walk: w } = run;
    const look = run.doorLook.clone();
    if (w?.root) look.lerp(midOf(w.root), smooth(clamp01((t - run.panAt) / 0.6)));
    if (run.doneAt === null && (!w?.root || w.done || t - run.panAt > WALK_MAX)) run.doneAt = t;
    const back = run.doneAt === null ? 0 : smooth(clamp01((t - run.doneAt) / 0.8));
    if (!w?.root || w.own) look.lerp(r.view.target, back);
    camera.position.copy(r.view.pos);
    camera.lookAt(look);
    camera.updateMatrixWorld();
    run.look.copy(look);
    if (back >= 1) end();
  }

  // A guest's view: from the room's framed view round to the room's people, then it settles there.
  function spot(t) {
    const k = smooth(clamp01((t - run.panAt) / 1.1));
    const look = run.r.view.target.clone().lerp(run.spot, k);
    camera.position.copy(run.r.view.pos);
    camera.lookAt(look);
    camera.updateMatrixWorld();
    run.look.copy(look);
    if (t - run.panAt > 1.4) end();
  }

  // Leaving with your Chog: the camera stays put and watches it walk to the room's door (which swings
  // open for it), and goes out after it as it reaches the door.
  function turn(dt) {
    const m = run;
    m.turnT += dt;
    m.doorK = clamp01((m.turnT - 0.2) / 0.8);
    setRoomDoor(m.r, m.doorK);
    const g = m.r.room.group;
    let near = false;
    if (m.root.parent === g) {
      m.look.lerp(midOf(m.root), 1 - Math.exp(-dt * 3.5));
      const p = m.root.position;
      near = m.turnT > 0.8 && Math.hypot(p.x, p.z - (m.r.room.d / 2 - 0.6)) < 1.4;
    }
    camera.lookAt(m.look);
    camera.updateMatrixWorld();
    if (near || m.walked || m.turnT > WALK_OUT_MAX) m.fly();
  }

  function end() {
    const r = run;
    if (!r) return;
    r.finish();
    run = null;
    r.resolve();
  }

  return api;
}
