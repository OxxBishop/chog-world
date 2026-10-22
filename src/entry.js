import * as THREE from 'three';
import { createFlight } from './flight.js';
import { CHOG_HEIGHT } from './chog.js';
import { setGlowFov } from './glows.js';

/*
 * Going into the Hub's rooms (the lobby, the bar, the casino) and out again.
 *
 * Out walking as your Chog (src/travel.js), it goes in itself: the building's door slides open as it
 * walks up, it steps through, a quick dip, and it is standing at its spot in the room by the room's
 * view. Out again: a dip, the door slides open on it just inside, and it walks out past the camera,
 * which comes round behind it, to where travel takes over (walkIn, walkOut below).
 *
 * Without a Chog out walking (the old framed views, the demo shots), the camera flies the whole way
 * instead: up to the building's door, through it and down the short hall behind, in through the room's
 * own door and round to the room's view as your Chog comes in after it (session.walkIn, A10); leaving,
 * the other way. A tap or Esc skips to the end of either.
 *
 * Every room has an entrance (src/hub.js): its outside door, the hall's floor and the room's door, all
 * real geometry. Nothing here builds a shader: the rooms are compiled with the world at load.
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
  // One door into each building, its outside one (the user, 10-19: "why are there even 2 doors? it's
  // unnecessary"). The room's own door at the end of the hall is left out: an open doorway, and through
  // the outside door the room shows beyond the hall (apply()).
  for (const h of hub.rooms) if (h.entrance && h.room?.doorway?.hinge) h.room.doorway.hinge.visible = false;

  const H = (x, y, z) => hub.group.localToWorld(new THREE.Vector3(x, y, z));
  const arr = (v) => v.toArray();
  const lookPoint = () => rig.target.clone();
  // Your Chog's model, while it is out in room r with you (A's session puts it in the room's group).
  const chogIn = (r) => {
    const root = session()?.active?.chog?.root;
    return root && root.parent === r.room.group ? root : null;
  };
  const midOf = (root) => root.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, CHOG_MID, 0));

  // The room's door slides into the wall on its hinge's side (the user, 10-19: sliding doors), what's past
  // its jamb not drawn (its clipping plane, src/hub.js shadeRoomDoor). Nothing swings into the doorway,
  // so nothing crosses the camera as it comes through, nor stands where a room's view does.
  const setRoomDoor = (r, k) => {
    const o = r.room.doorway, h = o.hinge;
    if (h.userData.x0 === undefined) {
      h.userData.x0 = h.position.x;
      h.parent.updateWorldMatrix(true, false);
      // The leaf hangs toward -x from its hinge (src/interior.js): the doorway's side of that line.
      o.clip?.set(new THREE.Vector3(-1, 0, 0), h.position.x).applyMatrix4(h.parent.matrixWorld);
    }
    h.userData.k = clamp01(k);
    h.position.x = h.userData.x0 + o.w * 1.02 * smooth(h.userData.k);
  };
  const _cam = new THREE.Vector3();
  const doorOf = (r) => r.room.doorway.hinge.userData.k ?? 0;
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

  // ---------- walking in and out (the user, 10-19: one door, no long walk) ----------
  // Out walking (src/travel.js), your Chog goes in itself. The building's door slides open as it walks
  // up (they open by themselves for it, like a shop's: autoDoors), the camera swings round to the side
  // so the doorway shows beside it, and it steps through. Once it's in, a quick dip, and it stands at
  // its spot in the room, by the room's view. Leaving is the other way round: a dip, and outside the
  // door slides open on it standing just inside; it walks out past the camera, which comes round behind
  // it, the door closes after it, and travel takes over from that very view. The hall behind the door
  // and the room's own door never show (the user: "why are there even 2 doors? it's unnecessary").
  const WALK_V = 3.5; // metres a second at its outdoor size (travel walks at 3.6)
  const DIP_OUT = 0.18, DIP_IN = 0.3; // the dip: down to dusk, and back
  const DOOR_S = 0.85; // seconds for the outside door to slide all the way
  const OUT_LEN = 5.5; // the walk out ends this far out from travel's mark at the door
  const resident = new Map(); // room id -> { walker, route, chat } while your Chog is in there
  // Out again: the camera eases from where the walk left it into travel's, which has taken over.
  let handoff = null;
  const HANDOFF_S = 0.9;

  // The dip, on the page's own fade (#fade), stepped with the world rather than by a timer.
  const fadeEl = document.getElementById('fade');
  let dipIn = null, dipOn = false;
  function setDip(k) {
    if (!fadeEl || (k === null && !dipOn)) return;
    dipOn = k !== null;
    fadeEl.style.transition = dipOn ? 'none' : '';
    fadeEl.style.opacity = dipOn ? String(clamp01(k)) : '';
  }
  // A cut's lens, at once (main.js eases toward entry.fov(), which would show as a zoom).
  function lens(fov) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
    setGlowFov(fov);
  }

  // The outside doors: 0 shut to 1 open (the door eases it). They open by themselves as your Chog walks
  // up to one, facing it, and close once it has gone or turned away.
  const doorK = new Map();
  const setDoor = (e, k) => {
    k = clamp01(k);
    if (doorK.get(e) === k) return;
    doorK.set(e, k);
    e.open(k);
  };
  const _p = new THREE.Vector3(), _f = new THREE.Vector3(), _q = new THREE.Quaternion();
  function autoDoors(dt, chogRoot) {
    for (const h of hub.rooms) {
      const e = h.entrance;
      if (!e || run?.e === e) continue;
      let want = 0;
      if (chogRoot) {
        const p = hub.group.worldToLocal(chogRoot.getWorldPosition(_p));
        const ahead = p.z - e.z, off = Math.abs(p.x - e.x);
        // Which way it faces, in the hub's space (the door is toward -z from out front).
        chogRoot.getWorldDirection(_f).applyQuaternion(hub.group.getWorldQuaternion(_q).invert());
        want = ahead > -0.6 && ahead < 6 && off < e.half + 1.6 && (-_f.z > 0.6 || ahead < 2.4) ? 1 : 0;
      }
      const k = doorK.get(e) ?? 0;
      if (k !== want) setDoor(e, k + Math.sign(want - k) * Math.min(Math.abs(want - k), dt / DOOR_S));
    }
  }

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
      // How far along the point nearest p is.
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
  // The feet's way in at the door, in the world: from `from` out front, up the steps to the sill (on the
  // level to each riser, then up it, for the ones still ahead of it), through the door and `inside`
  // metres on. Out is the same, backwards.
  function doorPts(e, from, inside) {
    const at = hub.group.worldToLocal(from.clone());
    const steps = [];
    let low = at.y;
    for (const [z, top] of e.steps ?? [[e.z + 1.0, e.sill]]) {
      if (z - 0.14 < at.z - 0.3) steps.push(H(e.x, low, z + 0.14), H(e.x, top, z - 0.14));
      low = top;
    }
    if (!steps.length) steps.push(H(e.x, e.sill, Math.min(at.z - 0.3, e.z + 0.6)));
    const pts = [from.clone(), ...steps, H(e.x, e.floor(e.z - 0.8), e.z - 0.8), H(e.x, e.floor(e.z - inside), e.z - inside)];
    // A first point barely apart from the next (it stopped right at the steps) would turn it sharply.
    if (pts[0].distanceTo(pts[1]) < 0.6) pts.splice(1, 1);
    return pts;
  }
  // Where your Chog stands in each room (room space, metres; the last point of each), found offline on a
  // walkable grid of each room, 0.62 m clear of the furniture: the clear bit of floor nearest A's spot
  // (src/session.js spotIn) in full view of the room's framing, above the casino's controls on a phone.
  // The bar has two more: its counter's two places for the Chog-to-Chog chat (src/barchat.js LAYOUTS),
  // where your own Chog joins in.
  const ROUTES = {
    // (A guest's Chog joins the bar's pair at the near end of the counter, turned to them; it stood between
    // them staring at the camera: the user, 10-21.)
    bar: {
      tall: { guest: [[-0.45, -1.95]], a: [[0.55, -2.3]], b: [[2.1, -2.3]] },
      wide: { guest: [[-0.85, -1.95]], a: [[0, -2.3]], b: [[2.6, -2.3]] },
    },
    casino: { tall: { guest: [[-2.55, -2.45]] }, wide: { guest: [[0.15, -1.85]] } },
    lobby: { tall: { guest: [[0.65, -0.35]] }, wide: { guest: [[0.65, -0.35]] } },
  };

  // Your Chog's spot (room space): its place for the bar's chat if it's yours and the bar has one, else
  // the room's spot; A's spot for a room without one.
  function routeFor(r, walker) {
    const by = ROUTES[r.id]?.[window.innerWidth < window.innerHeight ? 'tall' : 'wide'];
    const ses = session();
    if (r.id === 'bar' && walker.own && ses?.bar?.spotFor && ses.active) {
      const at = ses.bar.spotFor(ses.active);
      const seat = ['a', 'b'].find((k) => by?.[k] && Math.hypot(by[k].at(-1)[0] - at.x, by[k].at(-1)[1] - at.z) < 0.05);
      if (seat) return { pts: by[seat], chat: true };
      return { pts: [[at.x, at.z]], chat: true };
    }
    if (by?.guest) return { pts: by.guest, chat: false };
    const g = r.room.group;
    const p = g.worldToLocal(r.view.pos.clone()).lerp(g.worldToLocal(r.view.target.clone()), 0.72);
    return { pts: [[p.x, p.z]], chat: false };
  }
  const yawOf = (dir) => Math.atan2(dir.x, dir.z);
  const turnTowards = (from, to, k) => from + (((((to - from) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * k;

  // Your Chog's height at the size it has in rooms (1).
  // (Measured, it takes in what floats over your own Chog, its heart badge: no more than a Chog's height
  // and a little.)
  const heightOf = (root) => Math.min(CHOG_HEIGHT * 1.15, (new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3()).y || 5) / (root.getWorldScale(new THREE.Vector3()).x || 1));
  // Where travel's camera looks on your Chog at size sc (travel.js CAM.look), so a walk hands its view
  // straight on.
  const lookH = (sc) => CHOG_HEIGHT * sc * 0.72;
  // Its pace, so its feet keep to the ground at the size it is.
  const paceFor = (chog, v, sc) => THREE.MathUtils.clamp(v / ((chog.speedOf?.('walk') || 1) * sc), 0.7, 1.7);

  // The camera round a point c: th radians round from `back` (behind your Chog) toward `side` (+1 or
  // -1), dist away, pitched up by pitch. And the other way, where a camera at pos stands round c.
  function orbitAt(c, back, side, th, dist, pitch, out) {
    const hz = Math.cos(pitch) * dist, px = back.z * side, pz = -back.x * side;
    return out.set(c.x + (back.x * Math.cos(th) + px * Math.sin(th)) * hz, c.y + Math.sin(pitch) * dist, c.z + (back.z * Math.cos(th) + pz * Math.sin(th)) * hz);
  }
  function orbitOf(c, back, side, pos) {
    const rel = pos.clone().sub(c);
    const dist = Math.max(0.5, rel.length());
    const px = back.z * side, pz = -back.x * side;
    return { th: Math.atan2(rel.x * px + rel.z * pz, rel.x * back.x + rel.z * back.z), dist, pitch: Math.asin(THREE.MathUtils.clamp(rel.y / dist, -1, 1)) };
  }
  const lerp = THREE.MathUtils.lerp;

  function walkIn(r, walker) {
    handoff = null;
    const e = hubRooms.get(r.id).entrance;
    const chog = walker.chog;
    const root = chog.root;
    const from = root.getWorldPosition(new THREE.Vector3());
    const way = routeFor(r, walker);
    const path = polyline(doorPts(e, from, 2.6));
    const sDoor = path.sAt(H(e.x, e.sill, e.z));
    const sc0 = root.scale.x;
    // Through the door at its size out walking where it fits; a big one comes down to what fits on the
    // last steps before it.
    const fit = Math.min(sc0, (e.top - e.sill - 0.3) / heightOf(root));
    const sizeAt = (s) => sc0 + (fit - sc0) * smooth(clamp01((s - (sDoor - 3)) / 2.2));
    const out = H(e.x, 0, e.z + 1).sub(H(e.x, 0, e.z)).setY(0).normalize();
    const centre = new THREE.Vector3(), chest = new THREE.Vector3(), feet = new THREE.Vector3(), pos = new THREE.Vector3();
    path.at(0, centre).y += lookH(sc0);
    // From travel's camera behind it, round to about 45 degrees off behind on the side it is already
    // on, so the doorway shows beside your Chog as the door opens.
    const side = orbitOf(centre, out, 1, camera.position).th < 0 ? -1 : 1;
    const o0 = orbitOf(centre, out, side, camera.position);
    const th1 = THREE.MathUtils.clamp(o0.th, 0.75, 1.1), dist1 = THREE.MathUtils.clamp(o0.dist, 7.5, 10), pitch1 = 0.24;
    // The gaze: from where travel's camera looks, onto your Chog.
    const look0 = camera.position.clone().add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(o0.dist));
    const k0 = doorK.get(e) ?? 0;
    chog.play('walk');
    let yaw = root.rotation.y, v = WALK_V;
    // Your own Chog in the bar: A's chat holds its scene until it's at its place at the counter.
    let arrived = null;
    if (way.chat) session()?.bar?.expect?.(new Promise((ok) => (arrived = ok)));
    return new Promise((resolve) => {
      const me = {
        r, e, t: 0, resolve, mode: 'walkin', s: 0, walker, dip: -1,
        look: new THREE.Vector3(),
        showRoom: () => false,
        fovK: () => 0,
        inRoom: () => false,
        doors: () => setDoor(e, k0 + me.t / DOOR_S),
        step(dt) {
          // It waits short of the door if that isn't open enough yet (it opens as it comes up, so it seldom
          // has to).
          const cap = (doorK.get(e) ?? 0) < 0.7 ? sDoor - 1.0 : Infinity;
          v += (Math.min(WALK_V, Math.max(0, cap - me.s) * 4) - v) * (1 - Math.exp(-dt * 10));
          me.s = Math.min(path.total, me.s + v * dt);
          const sc = sizeAt(me.s);
          chog.setPace?.(paceFor(chog, v, sc));
          root.scale.setScalar(sc);
          path.at(me.s, feet);
          yaw = turnTowards(yaw, yawOf(path.dir(me.s)), 1 - Math.exp(-dt * 9));
          root.position.copy(root.parent ? root.parent.worldToLocal(feet.clone()) : feet);
          root.rotation.y = yaw;
          // The camera swings round over its first steps, and stays out front as it goes in.
          const u = smooth(clamp01(me.t / 0.9));
          path.at(Math.min(me.s, sDoor - 0.4), centre).y += lookH(sc);
          orbitAt(centre, out, side, lerp(o0.th, th1, u), lerp(o0.dist, dist1, u), lerp(o0.pitch, pitch1, u), pos);
          camera.position.copy(pos);
          chest.copy(feet).y += lookH(sc) * 0.9;
          me.look.copy(look0).lerp(chest, smooth(clamp01(me.t / 0.5)));
          camera.lookAt(me.look);
          camera.updateMatrixWorld();
          // Half through the door, the dip; and it's in.
          if (me.dip < 0 && (me.s >= sDoor + 0.4 || me.t > 5)) me.dip = 0;
          if (me.dip < 0) return false;
          me.dip += dt;
          setDip(me.dip / DIP_OUT);
          return me.dip >= DIP_OUT;
        },
        finish: () => {
          // At its spot by the room's view, facing it. It stays in the room (in its group, so it shows and
          // hides with it) till you leave.
          const g = r.room.group;
          g.attach(root);
          const [x, z] = way.pts.at(-1);
          const view = g.worldToLocal(r.view.pos.clone());
          root.scale.setScalar(1);
          root.position.set(x, 0, z);
          root.rotation.set(0, Math.atan2(view.x - x, view.z - z), 0);
          // At the bar as a guest: turned to the pair at the counter (a little open to the view, so its face
          // shows), listening in.
          if (r.id === 'bar' && !way.chat) {
            const toPair = Math.atan2(1.25 - x, -2.3 - z), toView = root.rotation.y;
            root.rotation.y = toPair + Math.atan2(Math.sin(toView - toPair), Math.cos(toView - toPair)) * 0.35;
          }
          resident.set(r.id, { walker: { ...walker, scale: sc0 }, route: way.pts, chat: way.chat });
          arrived?.();
          arrived = null;
          chog.play('idle');
          chog.setPace?.(1);
          // At the bar as a guest, the view settles on all three (trioAim).
          const target = r.id === 'bar' && !way.chat ? trioAim(r, root) ?? r.view.target.clone() : r.view.target.clone();
          rig.views.entry = { pos: r.view.pos.clone(), target, enter: true };
          rig.jump('entry');
          camera.position.copy(r.view.pos);
          camera.lookAt(target);
          camera.updateMatrixWorld();
          lens(fovs.indoor());
          setDoor(e, 0);
          setRoomDoor(r, 0);
          setDip(1);
          dipIn = { t: 0 };
        },
        skipTo() {
          me.s = path.total;
        },
      };
      run = me;
    });
  }

  function walkOut(r, place) {
    handoff = null;
    const e = hubRooms.get(r.id).entrance;
    const { walker, chat } = resident.get(r.id);
    resident.delete(r.id);
    // Out of the bar's chat first: the regular stays at the counter.
    if (chat) session()?.bar?.release?.();
    const chog = walker.chog;
    const root = chog.root;
    const sc1 = walker.scale ?? 1.7;
    const out = H(e.x, 0, e.z + 1).sub(H(e.x, 0, e.z)).setY(0).normalize();
    const back = out.clone().negate();
    // From just inside the door out to a few steps out front, where travel takes over (with the view
    // the walk ends on: walker.exit.resume, read by travel.js resume()).
    const exit = walker.exit ? walker.exit.at.clone().addScaledVector(walker.exit.out, OUT_LEN) : H(e.x, 0, e.z + 0.6 + OUT_LEN);
    const path = polyline(doorPts(e, exit, 1.3).reverse());
    const sDoor = path.sAt(H(e.x, e.sill, e.z));
    // The camera out front, off to the side toward the Hub's middle, low, looking in at the door; round
    // behind your Chog as it walks out past, to travel's own height and distance behind it.
    const side = hub.group.worldToLocal(H(e.x, 0, e.z)).x < -1 ? -1 : 1;
    const tall = camera.aspect < 1;
    const A = { th: 2.7, dist: tall ? 11 : 9.5, pitch: 0.12 }, B = { th: 1.05, dist: 8.6, pitch: 0.3 };
    const centre = new THREE.Vector3(), feet = new THREE.Vector3(), pos = new THREE.Vector3();
    let yaw = 0, v = 0, closeT = -1;
    return new Promise((resolve) => {
      const me = {
        r, e, t: 0, resolve, mode: 'walkout', s: 0, walker, cut: false, walking: false,
        look: new THREE.Vector3(),
        showRoom: () => false,
        fovK: () => (me.cut ? 0 : 1),
        inRoom: () => !me.cut,
        doors: () => {
          if (!me.cut) return;
          // Open as the dip lifts (it stands there as the leaves part); shut once it's well out.
          if (closeT < 0 && me.s > sDoor + 2.2) closeT = 0;
          setDoor(e, closeT >= 0 ? Math.min(doorK.get(e) ?? 1, 1 - closeT / DOOR_S) : (me.t - DIP_OUT) / DOOR_S);
        },
        // Outside: your Chog back where travel keeps it, at its outdoor size, just inside the door.
        goOut() {
          me.cut = true;
          (walker.home ?? root.parent).attach(root);
          root.scale.setScalar(sc1);
          path.at(0, feet);
          yaw = yawOf(path.dir(0.5));
          root.position.copy(root.parent.worldToLocal(feet.clone()));
          root.rotation.set(0, yaw, 0);
          chog.play('idle');
          chog.setPace?.(1);
          setRoomDoor(r, 0);
          setDoor(e, 0);
          lens(fovs.outdoor());
        },
        step(dt) {
          if (!me.cut) {
            // Down to dusk on the room's view first.
            setDip(me.t / DIP_OUT);
            if (me.t < DIP_OUT) return false;
            me.goOut();
          }
          const tc = me.t - DIP_OUT;
          setDip(tc < DIP_IN ? 1 - tc / DIP_IN : null);
          // It sets off once the door is half open, and slows as it gets to the end.
          if (!me.walking && tc > DOOR_S * 0.38) {
            me.walking = true;
            chog.play('walk');
          }
          if (me.walking) {
            v += (WALK_V * THREE.MathUtils.clamp((path.total - me.s) / 1.2, 0.3, 1) - v) * (1 - Math.exp(-dt * 8));
            me.s = Math.min(path.total, me.s + v * dt);
            chog.setPace?.(paceFor(chog, v, sc1));
          }
          if (closeT >= 0) closeT += dt;
          path.at(me.s, feet);
          yaw = turnTowards(yaw, yawOf(path.dir(me.s + 0.5)), 1 - Math.exp(-dt * 9));
          root.position.copy(root.parent.worldToLocal(feet.clone()));
          root.rotation.y = yaw;
          const u = smooth(me.s / path.total);
          path.at(me.s, centre).y += lookH(sc1);
          orbitAt(centre, back, side, lerp(A.th, B.th, u), lerp(A.dist, B.dist, u), lerp(A.pitch, B.pitch, u), pos);
          camera.position.copy(pos);
          me.look.copy(centre);
          camera.lookAt(me.look);
          camera.updateMatrixWorld();
          // Out of the room for the rig too, the moment the camera is.
          if (rig.room) {
            rig.views.exit = { pos: camera.position.clone(), target: me.look.clone() };
            rig.jump('exit');
          }
          return me.s >= path.total;
        },
        finish: () => {
          setDip(null);
          setRoomDoor(r, 0);
          root.scale.setScalar(sc1);
          chog.play('idle');
          chog.setPace?.(1);
          // Out of the room for the rig too; travel takes it from here (and the camera). Without travel,
          // the place's framed view.
          rig.views.exit = { pos: camera.position.clone(), target: me.look.clone() };
          rig.jump('exit');
          if (!walker.exit && place) rig.focusOn(place, { instant: true });
          if (walker.exit) {
            // Travel picks up right here, its camera where this one is (it eases the last of the way).
            const rel = camera.position.clone().sub(me.look);
            walker.exit.resume = { pos: feet.clone(), yaw, camYaw: Math.atan2(rel.x, rel.z), camPitch: Math.asin(THREE.MathUtils.clamp(rel.y / rel.length(), -1, 1)) };
            handoff = { t: 0, pos: camera.position.clone(), quat: camera.quaternion.clone() };
          }
        },
        skipTo() {
          if (!me.cut) me.goOut();
          me.t = Math.max(me.t, DIP_OUT + DIP_IN);
          me.walking = true;
          me.s = path.total;
          me.step(0);
          setDoor(e, 0);
        },
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
            setDoor(e, clamp01((t - (t1 - 0.45)) / 1.2) - clamp01((t - (t1 + 2.6)) / 1.2));
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
            setDoor(e, 0);
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
            setDoor(e, clamp01((t - 1.0) / 0.9) - clamp01((t - 3.4) / 1.1));
          },
          showRoom: (t) => t < 2.6,
          fovK: (t) => 1 - clamp01((t - 1.5) / 1.0),
          finish: () => {
            setDoor(e, 0);
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

    // Called after rig.update: puts the camera on the cutscene's path. chogRoot: your Chog out walking
    // (the outside doors open for it).
    update(dt, chogRoot = null) {
      autoDoors(Math.min(dt, 1 / 20), chogRoot);
      if (dipIn) {
        dipIn.t += Math.min(dt, 1 / 20);
        setDip(1 - dipIn.t / DIP_IN);
        if (dipIn.t >= DIP_IN) (dipIn = null), setDip(null);
      }
      for (let i = swings.length - 1; i >= 0; i--) {
        const s = swings[i];
        s.t = Math.min(1, s.t + dt / s.seconds);
        setRoomDoor(s.r, s.from + (s.to - s.from) * s.t);
        if (s.t >= 1) swings.splice(i, 1);
      }
      // A guest's Chog in a room it walked into: its animation is ours while it's there (travel's when out).
      for (const { walker } of resident.values()) if (!walker.own) walker.chog.update?.(dt, camera);
      // After travel has placed its camera this frame (main.js updates travel first).
      if (handoff && !run) {
        handoff.t += Math.min(dt, 1 / 20);
        const k = smooth(clamp01(handoff.t / HANDOFF_S));
        camera.position.lerpVectors(handoff.pos, camera.position, k);
        camera.quaternion.slerpQuaternions(handoff.quat, camera.quaternion, k);
        camera.updateMatrixWorld();
        if (k >= 1) handoff = null;
      }
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
      // The room draws only with the camera in it (src/island.js); through its open outside door, too.
      for (const h of hub.rooms) {
        if (!h.entrance || !h.room || h.room.group.visible || !(doorK.get(h.entrance) > 0)) continue;
        h.room.group.visible = true;
        h.room.update?.(env, renderer);
      }
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

  // Your guest Chog at the bar with the pair: the middle of all three (it, and the pair either side of
  // theirs), so all of them are in view on a phone (world), or null.
  function trioAim(r, mine) {
    // (The pair's places at the counter: as the walk ends they may still be taking them.)
    const tall = window.innerWidth < window.innerHeight;
    const fp = session()?.focusIn?.(r) ?? (r.id === 'bar' ? r.room.group.localToWorld(new THREE.Vector3(tall ? 1.33 : 1.3, 1.3, -2.3)) : null);
    if (!fp) return null;
    const g = mine.getWorldPosition(new THREE.Vector3()).setY(fp.y);
    const d = g.distanceTo(fp);
    const half = tall ? 0.78 : 1.3;
    return fp.clone().lerp(g, THREE.MathUtils.clamp((d - half) / (2 * Math.max(d, 1e-3)), 0, 0.5));
  }
  // A guest's view: from the room's framed view round to the room's people, then it settles there.
  function spot(t) {
    const k = smooth(clamp01((t - run.panAt) / 1.1));
    const mine = resident.get(run.r.id)?.walker?.chog?.root;
    const aim = (mine?.parent && trioAim(run.r, mine)) || run.spot;
    const look = run.r.view.target.clone().lerp(aim, k);
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
