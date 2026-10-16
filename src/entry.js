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

  // ---------- walking in and out (the user's ask, 10-16) ----------
  // Out walking (src/travel.js), your Chog goes in itself: on through the doors, down the hall and in
  // through the room's door to a spot a few steps inside, the camera following behind it; once it's
  // there the camera comes on in after it to the room's view. Leaving, it walks back out the same way
  // with the camera behind, and is handed back to travel a few steps outside the door.
  //
  // Out walking it is 1.7 times the size it is in rooms (travel's SCALE), too tall for the doors. On
  // the last steps to the door it comes down to its room size, and the camera's distance and height
  // come down with it, so on screen it stays the same and only the door grows; out again, the other way.
  const WALK_V = 3.4; // metres a second at its outdoor size (travel walks at 3.6)
  // The camera behind it, in its own heights at the size it is: back along the path, up, and a little
  // to the side so the doorway ahead shows past its head; looking ahead of it, about level with its
  // shoulders.
  const BACK = 1.55, UP = 1.2, SIDE = 0.3, AHEAD = 1.5, AIM = 0.72;
  const resident = new Map(); // room id -> { walker } while your Chog is in there

  // A path through points: where along it (s, metres) is which point, and which way it runs there.
  function polyline(pts) {
    const segs = [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      const len = Math.max(1e-4, pts[i].distanceTo(pts[i - 1]));
      segs.push({ a: pts[i - 1], b: pts[i], s0: total, len, dir: pts[i].clone().sub(pts[i - 1]).divideScalar(len) });
      total += len;
    }
    const seg = (s) => {
      let g = segs[0];
      for (const x of segs) if (s >= x.s0) g = x;
      return g;
    };
    return {
      total,
      // Before the start it runs back along the first leg; past the end, on along the last.
      at(s, out = new THREE.Vector3()) {
        const g = seg(s);
        return out.copy(g.a).addScaledVector(g.dir, s - g.s0);
      },
      dir(s, out = new THREE.Vector3()) {
        return out.copy(seg(s).dir);
      },
      // How far along the point nearest p is (for the doors' marks).
      sAt(p) {
        let best = 0, bd = Infinity;
        for (const x of segs) {
          const k = THREE.MathUtils.clamp(p.clone().sub(x.a).dot(x.dir), 0, x.len);
          const d = x.a.clone().addScaledVector(x.dir, k).distanceTo(p);
          if (d < bd) (bd = d), (best = x.s0 + k);
        }
        return best;
      },
    };
  }
  // The feet's way in, in the world: from where it stands to the outside door, through it, down the
  // hall, through the room's door and a few steps in. (Out is the same, backwards, to `exit`.)
  function feetPath(r, e, from, to = null) {
    const L = (x, y, z) => r.room.group.localToWorld(new THREE.Vector3(x, y, z));
    const { d } = r.room;
    const mid = (e.z + e.zIn) / 2;
    const pts = [
      from.clone(),
      H(e.x, e.sill, e.z + 1.0),
      H(e.x, e.floor(e.z - 0.8), e.z - 0.8),
      H(e.x, e.floor(mid), mid),
      H(e.x, e.floor(e.zIn + 0.6), e.zIn + 0.6),
      L(0, 0, d / 2 - 1.2),
      to ?? L(0, 0, d / 2 - 3.4),
    ];
    // A first point barely apart from the next (it stopped right at the door) would turn it sharply.
    if (pts[0].distanceTo(pts[1]) < 0.6) pts.splice(1, 1);
    return { pts, outside: H(e.x, e.sill, e.z), roomDoor: L(0, 0, d / 2) };
  }
  const yawOf = (dir) => Math.atan2(dir.x, dir.z);
  const turnTowards = (from, to, k) => from + (((((to - from) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * k;

  // Your Chog's height at the size it has in rooms (1).
  const heightOf = (root) => (new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3()).y || 5) / (root.getWorldScale(new THREE.Vector3()).x || 1);

  // What a walk needs to know of the way: its path, where the doors are on it, the heights the camera
  // keeps under (the outside doorway and the hall, then the room's lower door, with room to spare),
  // and the side it keeps to (the room's view's, so coming in it is already on its way there).
  function course(r, e, pts, outside, roomDoor, root) {
    const path = polyline(pts);
    const h = heightOf(root);
    const sDoor = path.sAt(outside), sRoom = path.sAt(roomDoor);
    const hallClear = e.top - e.sill - 0.55, doorClear = Math.min(hallClear, (r.room.doorway?.h ?? Infinity) - 0.5);
    // The room's door is lower than the hall: the camera comes down to go under it (it does only on
    // the way into the room's view, or on the way out at the start).
    const clear = (sCam) => THREE.MathUtils.lerp(hallClear, doorClear, smooth(clamp01((2.4 - Math.abs(sCam - sRoom)) / 1.5)));
    const d = path.dir(sRoom);
    const right = new THREE.Vector3(-d.z, 0, d.x);
    const side = Math.sign(right.dot(r.view.pos.clone().sub(roomDoor))) || 1;
    return { path, h, clear, side, sDoor, sRoom };
  }

  // The camera following a walk, for your Chog at s on the path at size sc.
  const _d = new THREE.Vector3();
  function followPose(c, s, sc, pos, look, dir = 1) {
    const { path, h, clear } = c;
    const back = BACK * h * sc;
    const sCam = s - back * dir;
    path.at(sCam, pos);
    path.dir(sCam, _d).multiplyScalar(dir);
    const side = SIDE * h * sc * c.side * dir;
    pos.x += -_d.z * side;
    pos.z += _d.x * side;
    pos.y += Math.min(UP * h * sc, clear(sCam));
    path.at(s + AHEAD * h * sc * dir, look);
    path.dir(s, _d).multiplyScalar(dir);
    look.x += -_d.z * side * 0.35;
    look.z += _d.x * side * 0.35;
    look.y += AIM * h * sc;
    return sCam;
  }
  // Its pace, so its feet keep to the ground at the size it is.
  const paceFor = (chog, v, sc) => THREE.MathUtils.clamp(v / ((chog.speedOf?.('walk') || 1) * sc), 0.7, 1.7);

  function walkIn(r, walker) {
    const e = hubRooms.get(r.id).entrance;
    const chog = walker.chog;
    const root = chog.root;
    const from = root.getWorldPosition(new THREE.Vector3());
    const { pts, outside, roomDoor } = feetPath(r, e, from);
    const c = course(r, e, pts, outside, roomDoor, root);
    const { path, sDoor, sRoom } = c;
    const sc0 = root.scale.x;
    // Down to its room size on the last steps before the door, done before it reaches it.
    const shrink0 = Math.max(0, sDoor - 4.6);
    const shrink1 = Math.max(shrink0 + 1.8, sDoor - 1.2);
    const sizeAt = (s) => sc0 + (1 - sc0) * smooth(clamp01((s - shrink0) / (shrink1 - shrink0)));
    // From where travel's camera is, looking at your Chog (the rig's own aim is stale while you walk).
    const cam0 = { pos: camera.position.clone(), look: from.clone().add(new THREE.Vector3(0, c.h * sc0 * 0.55, 0)) };
    chog.play('walk');
    let yaw = root.rotation.y;
    let sc = sc0;
    let sCam = -Infinity;
    const pos = new THREE.Vector3(), look = new THREE.Vector3(), feet = new THREE.Vector3();
    return new Promise((resolve) => {
      const me = {
        r, e, t: 0, resolve, mode: 'walkin', stage: 'walk', s: 0, path, walker, flight: null, flightT: 0,
        look: new THREE.Vector3(),
        showRoom: () => me.s > sDoor - 4,
        // The room's lens as the camera comes up to the door and through it.
        fovK: () => (me.stage === 'settle' ? 1 : clamp01((sCam - (sDoor - 2.5)) / 3.5)),
        doors: () => {
          e.open(clamp01((me.s - (sDoor - 3.2)) / 1.6) - clamp01((sCam - (sDoor + 1.2)) / 1.4));
          setRoomDoor(r, clamp01((me.s - (sRoom - 4.4)) / 1.8));
        },
        step(dt) {
          if (me.stage === 'walk') {
            sc = sizeAt(me.s);
            const v = WALK_V * (0.5 + (0.5 * sc) / sc0);
            chog.setPace?.(paceFor(chog, v, sc));
            me.s = Math.min(path.total, me.s + v * dt);
            sc = sizeAt(me.s);
            root.scale.setScalar(sc);
            path.at(me.s, feet);
            yaw = turnTowards(yaw, yawOf(path.dir(me.s)), 1 - Math.exp(-dt * 9));
            root.position.copy(root.parent ? root.parent.worldToLocal(feet.clone()) : feet);
            root.rotation.y = yaw;
            sCam = followPose(c, me.s, sc, pos, look);
            // Out of travel's camera and onto the path behind it, in the first moments.
            const k = smooth(clamp01(me.t / 0.9));
            camera.position.copy(cam0.pos).lerp(pos, k);
            me.look.copy(cam0.look).lerp(look, k);
            if (me.s >= path.total) {
              me.stage = 'settle';
              chog.play('idle');
              chog.setPace?.(1);
              me.flight = flightIn(c, r, camera.position.clone(), me.look.clone(), sCam, root);
            }
          } else {
            // There: the camera comes on through the room's door to the room's view, and your Chog turns
            // round to face it.
            me.flightT += dt;
            const face = yawOf(r.view.pos.clone().sub(root.getWorldPosition(feet)).setY(0).normalize());
            root.rotation.y = turnTowards(root.rotation.y, face, 1 - Math.exp(-dt * 4));
            me.look.copy(me.flight.pose(camera, Math.min(me.flightT, me.flight.duration)));
            return me.flightT >= me.flight.duration;
          }
          camera.lookAt(me.look);
          camera.updateMatrixWorld();
          return false;
        },
        finish: () => {
          // Your Chog stays in the room (in its group, so it shows and hides with it) till you leave.
          r.room.group.attach(root);
          root.scale.setScalar(1);
          root.rotation.set(0, root.rotation.y, 0);
          resident.set(r.id, { walker: { ...walker, scale: sc0 } });
          chog.play('idle');
          chog.setPace?.(1);
          rig.views.entry = { pos: r.view.pos.clone(), target: r.view.target.clone(), enter: true };
          rig.jump('entry');
          e.open(0);
          swing(r, 1, 0, 0.9);
        },
        skipTo() {
          me.s = path.total;
          path.at(me.s, feet);
          root.scale.setScalar(1);
          root.position.copy(root.parent ? root.parent.worldToLocal(feet.clone()) : feet);
          root.rotation.y = yawOf(r.view.pos.clone().sub(feet).setY(0).normalize());
          camera.position.copy(r.view.pos);
          camera.lookAt(r.view.target);
          camera.updateMatrixWorld();
        },
        inRoom: () => me.stage === 'settle' || sCam > sRoom - 0.5,
      };
      run = me;
    });
  }

  // From behind your Chog, standing at its spot, on along the path through the room's door and round
  // to the room's view, the gaze going from it to what the view looks at.
  function flightIn(c, r, pos, look, sCam, root) {
    const { path, h, clear, sRoom } = c;
    const mid = root.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, h * 0.6, 0));
    const keys = [{ t: 0, pos: pos.clone(), look: look.clone() }];
    let t = 0;
    let at = pos;
    // Under the room's door first, if the camera isn't through it yet, on the side it keeps to: down to
    // just before it, and on through.
    const onPath = (sx) => {
      const p = path.at(sx);
      path.dir(sx, _d);
      const side = SIDE * h * c.side;
      p.x += -_d.z * side;
      p.z += _d.x * side;
      p.y += Math.min(UP * h, clear(sx));
      return p;
    };
    if (sCam < sRoom - 0.7) {
      const p = onPath(sRoom - 0.7);
      t += Math.max(0.35, p.distanceTo(at) / 3.0);
      keys.push({ t, pos: p, look: mid.clone().lerp(look, 0.5) });
      at = p;
    }
    if (sCam < sRoom + 0.7) {
      const p = onPath(sRoom + 0.7);
      t += Math.max(0.45, p.distanceTo(at) / 3.0);
      keys.push({ t, pos: p, look: mid.clone() });
      at = p;
    }
    t += Math.max(1.0, r.view.pos.distanceTo(at) / 2.4);
    keys.push({ t, pos: r.view.pos.clone(), look: r.view.target.clone() });
    return createFlight({ keys: keys.map((k) => ({ t: k.t, pos: arr(k.pos), look: arr(k.look) })) });
  }

  function walkOut(r, place) {
    const e = hubRooms.get(r.id).entrance;
    const { walker } = resident.get(r.id);
    resident.delete(r.id);
    const chog = walker.chog;
    const root = chog.root;
    const here = root.getWorldPosition(new THREE.Vector3());
    // Back out the way it came, to a few steps outside the door: where travel takes over (its resume()).
    const h = heightOf(root);
    const outLen = Math.max(6.5, BACK * h + 3.4);
    const exit = walker.exit ? walker.exit.at.clone().addScaledVector(walker.exit.out, outLen) : H(e.x, e.sill, e.z + outLen);
    const { pts, outside, roomDoor } = feetPath(r, e, exit, here);
    pts.reverse();
    const c = course(r, e, pts, outside, roomDoor, root);
    const { path, sDoor, sRoom } = c;
    const sc1 = walker.scale ?? 1.7;
    // Back up to its outdoor size once the camera is out of the doors behind it.
    const grow0 = sDoor + BACK * h + 0.3;
    const grow1 = Math.min(path.total - 0.3, grow0 + 2.2);
    const sizeAt = (s) => 1 + (sc1 - 1) * smooth(clamp01((s - grow0) / Math.max(0.5, grow1 - grow0)));
    const cam0 = { pos: camera.position.clone(), look: rig.target.clone() };
    // Out of the room's group and back where travel keeps it, still where it stands.
    (walker.home ?? root.parent).attach(root);
    let yaw = root.rotation.y;
    let sCam = -Infinity;
    const pos = new THREE.Vector3(), look = new THREE.Vector3(), feet = new THREE.Vector3();
    return new Promise((resolve) => {
      const me = {
        r, e, t: 0, resolve, mode: 'walkout', stage: 'walk', s: 0, path, walker,
        look: new THREE.Vector3(),
        started: false,
        showRoom: () => sCam < sDoor + 1,
        fovK: () => 1 - clamp01((sCam - (sDoor - 0.5)) / 3),
        doors: () => {
          setRoomDoor(r, clamp01((me.s - (sRoom - 2.6)) / 1.4) - clamp01((sCam - (sRoom + 1.5)) / 1.4));
          e.open(clamp01((me.s - (sDoor - 3.2)) / 1.6) - clamp01((sCam - (sDoor + 1.0)) / 1.6));
        },
        step(dt) {
          if (!me.started) {
            me.started = true;
            chog.play('walk');
          }
          // A moment to turn to the door before it sets off.
          const go = me.t > 0.35;
          let sc = sizeAt(me.s);
          const v = WALK_V * (0.5 + (0.5 * sc) / sc1);
          chog.setPace?.(paceFor(chog, v, sc));
          if (go) me.s = Math.min(path.total, me.s + v * dt);
          sc = sizeAt(me.s);
          root.scale.setScalar(sc);
          path.at(me.s, feet);
          yaw = turnTowards(yaw, yawOf(path.dir(me.s + 0.5)), 1 - Math.exp(-dt * (go ? 9 : 6)));
          root.position.copy(root.parent.worldToLocal(feet.clone()));
          root.rotation.y = yaw;
          sCam = followPose(c, me.s, sc, pos, look);
          const k = smooth(clamp01(me.t / 1.2));
          camera.position.copy(cam0.pos).lerp(pos, k);
          me.look.copy(cam0.look).lerp(look, k);
          camera.lookAt(me.look);
          camera.updateMatrixWorld();
          return me.s >= path.total;
        },
        finish: () => {
          e.open(0);
          setRoomDoor(r, 0);
          root.scale.setScalar(sc1);
          camera.fov = fovs.outdoor();
          camera.updateProjectionMatrix();
          chog.play('idle');
          chog.setPace?.(1);
          // Out of the room for the rig too; travel takes it from here (and the camera). Without
          // travel, the place's framed view.
          rig.views.exit = { pos: camera.position.clone(), target: me.look.clone() };
          rig.jump('exit');
          if (!walker.exit && place) rig.focusOn(place, { instant: true });
        },
        skipTo() {
          me.s = path.total;
          me.t = 99;
          me.step(0);
        },
        inRoom: () => sCam < sRoom + 1,
      };
      run = me;
    });
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
      if (run.mode === 'walkin' || run.mode === 'walkout') return run.inRoom() ? run.r : null;
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

    // walker: your Chog out walking ({ chog, own, home, exit }): it goes in itself, the camera behind.
    enter(r, { walker = null } = {}) {
      if (walker?.chog) return walkIn(r, walker);
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
      if (resident.has(r.id)) return walkOut(r, place);
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
      if (run.mode === 'walkin' || run.mode === 'walkout') {
        run.skipTo();
        return end();
      }
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
      // A guest's Chog in a room it walked into: its animation is ours while it's there (travel's when out).
      for (const { walker } of resident.values()) if (!walker.own) walker.chog.update?.(dt, camera);
      if (!run) return;
      const step = Math.min(dt, 1 / 20);
      if (run.mode === 'walkin' || run.mode === 'walkout') {
        run.t += step;
        run.doors();
        if (!run.walker.own) run.walker.chog.update?.(step, camera);
        if (run.step(step)) end();
        return;
      }
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
