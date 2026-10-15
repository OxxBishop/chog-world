import * as THREE from 'three';
import { damp, easeInOut, clamp, angleLerp } from './util.js';
import { heightAt, isVoid, cameraFloor } from './terrain.js';

const MIN_DIST = 8;
const MAX_DIST = 1400;
// The view's centre stays over the archipelago (the far neighbourhood rims are about 320 out).
const TARGET_LIMIT = 330;
const TAP_MS = 300;
const TAP_PX = 10;
// How fast a flung swing or drag dies away after the finger lifts (per second), and the fastest
// it may glide, so a quick swipe eases on a little instead of spinning what you were looking at away.
const FRICTION = 4.5;
const FLING_MAX = { theta: 1.2, phi: 0.6 };
// On touch a swipe across the whole screen turns the view this far (radians), whatever its size.
const SWIPE_TURN = 1.1;
const SWIPE_TILT = 1.0;
// How far the view may tilt up past the point where the camera stops low, so the island never leaves the frame.
const TILT_ROOM = 0.26;
const _pos = new THREE.Vector3();
const _look = new THREE.Vector3();
const _u = new THREE.Vector3();
const _p = new THREE.Vector3();
const _fp = new THREE.Vector3();
const _fo = new THREE.Vector3();
const _back = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _rel = new THREE.Vector3();

/**
 * A solid the camera keeps out of: a round pod with a wall of radius r up to height wall, then a
 * domed roof rising cap more (a glass dome is all roof). Below its floor it counts as solid all the
 * way down, so the camera is always pushed out sideways or up, never under the ground. A door
 * (facing angle and half width in metres) marks where the view may walk in.
 *
 * An enterable pod (a dome, a room) can hold the view: the camera then stays inside it. A room sits
 * within other solids (its building, its dome), which stop pushing the camera out while it is in the
 * room, and may have a parent room the view steps back into when it leaves.
 */
export class Pod {
  constructor({ x, y, z, r, wall = 0, cap = r, margin = 1.2, facing = null, doorHalf = 0, enterable = false, within = [], parent = null }) {
    Object.assign(this, { x, y, z, r, wall, cap, margin, facing, doorHalf, enterable, within, parent });
    // Everything inside can see this point, so pushing out from it never jumps.
    this.c = new THREE.Vector3(x, y + (wall > 0 ? wall * 0.5 : cap * 0.25), z);
    this.reach = r + wall + cap + margin;
  }

  inside(p, grow = 0) {
    const rr = this.r + grow;
    const h = Math.hypot(p.x - this.x, p.z - this.z);
    if (h > rr) return false;
    const top = this.y + this.wall;
    if (p.y <= top) return true;
    const dy = (p.y - top) / (this.cap + grow);
    return (h / rr) ** 2 + dy * dy <= 1;
  }

  // How far from origin along u until leaving the pod (grown by grow).
  exit(origin, u, grow) {
    let lo = 0, hi = this.reach * 2;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (this.inside(_p.copy(origin).addScaledVector(u, mid), grow)) lo = mid;
      else hi = mid;
    }
    return hi;
  }

  // Slide a point inside out onto the surface, straight away from the pod's middle.
  pushOut(p) {
    if (!this.inside(p, this.margin)) return p;
    _u.subVectors(p, this.c);
    if (_u.lengthSq() < 1e-6) _u.set(0, 1, 0);
    _u.normalize();
    return p.copy(this.c).addScaledVector(_u, this.exit(this.c, _u, this.margin));
  }

  // From a target inside, bring a point outside back in along the line to the target.
  keepIn(p, target) {
    const g = -this.margin;
    if (this.inside(p, g) || !this.inside(target, g)) return p;
    _u.subVectors(p, target).normalize();
    return p.copy(target).addScaledVector(_u, this.exit(target, _u, g));
  }

  // Whether a point on the ground is in front of the door.
  atDoor(p) {
    if (this.facing === null) return false;
    let az = Math.atan2(p.x - this.x, p.z - this.z) - this.facing;
    az = Math.atan2(Math.sin(az), Math.cos(az));
    return Math.abs(az) * this.r < this.doorHalf + 1.5;
  }
}

/**
 * Map-style camera, built for touch first.
 *
 * One finger (or left mouse) swings the view around whatever you are looking at, all the way up
 * to the sky; two fingers drag to move, pinch to zoom and twist to turn (right mouse moves,
 * scroll zooms toward the pointer). Tap a place to visit it; tap again, tap empty sky or press
 * Back to return. Until the first touch the camera slowly circles the world.
 *
 * The camera never passes through an island or dips into the clouds: swing low and it stops at the
 * grass or the cloud tops, and further swiping tilts the view up to the sky from there.
 */
/**
 * A room the camera can be inside: a box w by d, h tall, turned by rot, on a floor at y. Its door is
 * in the front wall (local +z), doorHalf wide each side, and the view can walk in through it.
 */
export class RoomBox extends Pod {
  constructor({ x, y, z, w, d, h, rot = 0, doorHalf = 1.2, margin = 0.5, within = [], parent = null }) {
    super({ x, y, z, r: Math.hypot(w, d) / 2, wall: h, cap: 0.01, margin, facing: rot, doorHalf, enterable: true, within, parent });
    Object.assign(this, { hw: w / 2, hd: d / 2, h, cos: Math.cos(rot), sin: Math.sin(rot) });
    this.c.set(x, y + h / 2, z);
    this.reach = this.r + h;
  }

  inside(p, grow = 0) {
    const dx = p.x - this.x, dz = p.z - this.z;
    const lx = dx * this.cos - dz * this.sin, lz = dx * this.sin + dz * this.cos;
    return Math.abs(lx) <= this.hw + grow && Math.abs(lz) <= this.hd + grow && p.y <= this.y + this.h + grow && p.y >= this.y - 2 - grow;
  }

  // In front of the door: just outside the front wall, within the door's width.
  atDoor(p) {
    const dx = p.x - this.x, dz = p.z - this.z;
    const lx = dx * this.cos - dz * this.sin, lz = dx * this.sin + dz * this.cos;
    return lz > this.hd - 0.5 && lz < this.hd + 4 && Math.abs(lx) < this.doorHalf + 0.8;
  }
}

export class CameraRig {
  constructor(camera, dom, views) {
    this.camera = camera;
    this.dom = dom;
    this.views = views;
    this.target = new THREE.Vector3();
    this.goal = { target: new THREE.Vector3(), dist: 300, theta: 0, phi: 1 };
    this.dist = 300;
    this.theta = 0;
    this.phi = 1;
    this.tween = null;
    this.focused = null;
    this.saved = null;
    this.onTap = null;
    this.onFocusChange = null;
    this.keys = new Set();
    this.focusDist = 100;
    this.idleSpin = true;
    this.fling = { theta: 0, phi: 0, pan: new THREE.Vector3() };
    this.touching = 0;
    // Solids the camera stays out of, and the dome (if any) the view has gone inside.
    this.solids = [];
    this.room = null;
    this._lastTarget = new THREE.Vector3();
    this.bind();
    this.jump('overview');
  }

  // ---------- input ----------

  bind() {
    const el = this.dom;
    const pts = new Map();
    let gesture = null;
    el.style.touchAction = 'none';
    el.addEventListener('contextmenu', (e) => e.preventDefault());

    const snapshot = () => {
      const list = [...pts.values()];
      if (list.length === 1) return { n: 1, x: list[0].x, y: list[0].y };
      const [a, b] = list;
      return { n: 2, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x) };
    };

    // Velocity of the last moves, kept going after release so a swipe glides to a stop.
    const fling = this.fling;
    let lastMove = 0;
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button, t: performance.now(), sx: e.clientX, sy: e.clientY, far: 0 });
      this.touching = pts.size;
      this.tween = null;
      this.idleSpin = false;
      if (e.button !== 0 || pts.size > 1) this.view = null;
      fling.theta = fling.phi = 0;
      fling.pan.set(0, 0, 0);
      gesture = { ...snapshot(), move: e.button === 2 || e.ctrlKey || e.shiftKey };
    });
    el.addEventListener('pointermove', (e) => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX;
      p.y = e.clientY;
      p.far = Math.max(p.far, Math.hypot(p.x - p.sx, p.y - p.sy));
      const now = snapshot();
      if (!gesture || now.n !== gesture.n) {
        gesture = { ...now, move: gesture?.move };
        return;
      }
      const dx = now.x - gesture.x, dy = now.y - gesture.y;
      if (dx || dy) this.view = null;
      const before = { theta: this.goal.theta, phi: this.goal.phi, target: this.goal.target.clone() };
      if (now.n === 1) {
        if (gesture.move && !this.focused) this.pan(dx, dy);
        else this.rotate(dx, dy, e.pointerType === 'touch');
      } else {
        this.zoomAt(gesture.d / now.d, now.x, now.y);
        // Zooming shifts the target toward the fingers; only the drag part should glide.
        before.target.copy(this.goal.target);
        let dAng = now.ang - gesture.ang;
        if (dAng > Math.PI) dAng -= Math.PI * 2;
        if (dAng < -Math.PI) dAng += Math.PI * 2;
        this.goal.theta -= dAng;
        // Two fingers dragging together move around (or circle, while visiting a place).
        if (this.focused) this.rotate(dx, 0, true);
        else this.pan(dx, dy);
      }
      // Event timestamps, not handler time: on a slow frame moves arrive late and bunched together.
      const t = e.timeStamp;
      const span = Math.max(8, Math.min(60, t - lastMove)) / 1000;
      lastMove = t;
      const k = 0.45;
      fling.theta = clamp(fling.theta + ((this.goal.theta - before.theta) / span - fling.theta) * k, -FLING_MAX.theta, FLING_MAX.theta);
      fling.phi = clamp(fling.phi + ((this.goal.phi - before.phi) / span - fling.phi) * k, -FLING_MAX.phi, FLING_MAX.phi);
      fling.pan.lerp(this.goal.target.clone().sub(before.target).divideScalar(span), k);
      // A drag glides on at most a third of the view's width per second.
      fling.pan.clampLength(0, this.goal.dist * 0.3);
      gesture = { ...now, move: gesture.move };
    });
    const end = (e) => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      pts.delete(e.pointerId);
      this.touching = pts.size;
      // A tap is short and never wanders: any real movement along the way makes it a swipe.
      const far = Math.max(p.far, Math.hypot(e.clientX - p.sx, e.clientY - p.sy));
      const quick = performance.now() - p.t < TAP_MS && far < TAP_PX;
      if (quick && pts.size === 0 && gesture?.n === 1 && p.button === 0) this.onTap?.(e.clientX, e.clientY);
      // No glide after a tap or after a finger paused before lifting.
      if (pts.size === 0 && (quick || e.timeStamp - lastMove > 90)) {
        fling.theta = fling.phi = 0;
        fling.pan.set(0, 0, 0);
      }
      gesture = pts.size ? { ...snapshot(), move: false } : null;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.tween = null;
        this.idleSpin = false;
        this.view = null;
        this.zoomAt(Math.pow(1.0018, e.deltaY), e.clientX, e.clientY);
      },
      { passive: false },
    );
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      this.keys.add(e.key.toLowerCase());
      if (e.key === 'Escape') this.exitFocus();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  maxPhi() {
    // Well past level: once the camera is as low as it can go, the extra tilt looks up at the sky.
    return 2.8;
  }

  // World units per screen pixel at the target distance.
  unitsPerPixel() {
    return (2 * this.goal.dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / this.dom.clientHeight;
  }

  pan(dx, dy) {
    const k = this.unitsPerPixel();
    const right = new THREE.Vector3(Math.cos(this.theta), 0, -Math.sin(this.theta));
    const fwd = new THREE.Vector3(-Math.sin(this.theta), 0, -Math.cos(this.theta));
    // Steeper views move the ground more per pixel vertically.
    const vy = 1 / Math.max(0.35, Math.cos(Math.min(this.phi, 1.45)));
    this.goal.target.addScaledVector(right, -dx * k).addScaledVector(fwd, dy * k * Math.min(vy, 2.2));
  }

  rotate(dx, dy, touch = false) {
    // A finger moves further than a mouse for the same intent: scale touch swipes to the screen.
    const kx = touch ? SWIPE_TURN / this.dom.clientWidth : 0.006;
    const ky = touch ? SWIPE_TILT / this.dom.clientHeight : 0.005;
    this.goal.theta -= dx * kx;
    this.goal.phi = clamp(this.goal.phi - dy * ky, 0.15, this.tiltLimit());
  }

  // Swinging low stops the camera at the grass; past that the view may tilt up only a little.
  tiltLimit() {
    return Math.min(this.maxPhi(), (this.phiClear ?? this.maxPhi()) + TILT_ROOM);
  }

  // Zoom by a factor, pulling the target toward whatever is under the screen point.
  zoomAt(factor, sx, sy) {
    const next = clamp(this.goal.dist * factor, MIN_DIST, MAX_DIST);
    const real = next / this.goal.dist;
    if (!this.focused) {
      const p = this.groundPoint(sx, sy);
      if (p) {
        // Zooming in on an island settles the target onto the grass.
        const g = heightAt(p.x, p.z);
        if (!isVoid(g)) p.y = Math.max(p.y, g);
        this.goal.target.lerp(p, 1 - real);
      }
    }
    this.goal.dist = next;
  }

  groundPoint(sx, sy) {
    const ndc = new THREE.Vector2((sx / this.dom.clientWidth) * 2 - 1, -(sy / this.dom.clientHeight) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.goal.target.y);
    const hit = ray.ray.intersectPlane(plane, new THREE.Vector3());
    // Ignore points far out toward the horizon.
    return hit && hit.distanceTo(this.camera.position) < this.goal.dist * 4 ? hit : null;
  }

  // ---------- views and focus ----------

  fromPosTarget(pos, target) {
    const off = pos.clone().sub(target);
    const dist = off.length();
    return { target: target.clone(), dist, theta: Math.atan2(off.x, off.z), phi: Math.acos(clamp(off.y / dist, -1, 1)) };
  }

  setState(s) {
    this.goal.target.copy(s.target);
    this.goal.dist = s.dist;
    this.goal.theta = s.theta;
    this.goal.phi = s.phi;
  }

  jump(name) {
    if (this.focused) this.clearFocus();
    this.tween = null;
    this.view = name;
    const v = this.views[name];
    this.setState(this.fromPosTarget(v.pos, v.target));
    this.target.copy(this.goal.target);
    this.dist = this.goal.dist;
    this.theta = this.goal.theta;
    this.phi = this.goal.phi;
    this.enterFor(v);
    this.apply();
  }

  go(name, duration) {
    if (this.focused) this.clearFocus();
    this.view = name;
    const v = this.views[name];
    this.flyTo(this.fromPosTarget(v.pos, v.target), duration);
    this.enterFor(v);
  }

  /**
   * The whole archipelago in view and centred, from every direction round it. For each direction,
   * the aim that centres it on screen; one distance that fits it from all of them, so the slow idle
   * circling keeps it whole and centred without zooming in and out.
   */
  fitAll(points, phi, margin = 0.86) {
    const c0 = new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3());
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    const tanH = tanV * this.camera.aspect;
    const basis = (a) => {
      _back.set(Math.sin(phi) * Math.sin(a), Math.cos(phi), Math.sin(phi) * Math.cos(a));
      _right.set(Math.cos(a), 0, -Math.sin(a));
      _up.crossVectors(_back, _right);
    };
    // From aim c at distance d: the distance needed, and how far off-centre the picture sits.
    const measure = (c, d) => {
      let need = 0, x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const p of points) {
        _rel.subVectors(p, c);
        const z = _rel.dot(_back), x = _rel.dot(_right), y = _rel.dot(_up);
        need = Math.max(need, z + Math.abs(x) / (tanH * margin), z + Math.abs(y) / (tanV * margin));
        const depth = Math.max(d - z, 1);
        x0 = Math.min(x0, x / (depth * tanH));
        x1 = Math.max(x1, x / (depth * tanH));
        y0 = Math.min(y0, y / (depth * tanV));
        y1 = Math.max(y1, y / (depth * tanV));
      }
      return { need, mx: (x0 + x1) / 2, my: (y0 + y1) / 2 };
    };
    // Centre per direction; the farthest any direction needs becomes the one distance.
    const aims = [];
    let dist = 0;
    const N = 36;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      basis(a);
      const c = c0.clone();
      let d = measure(c, 0).need;
      for (let k = 0; k < 5; k++) {
        const m = measure(c, d);
        c.addScaledVector(_right, m.mx * d * tanH).addScaledVector(_up, m.my * d * tanV);
        d = measure(c, d).need;
      }
      aims.push(c);
      dist = Math.max(dist, d);
    }
    // With the one (larger) distance, centre each direction once more.
    for (let i = 0; i < N; i++) {
      basis((i / N) * Math.PI * 2);
      for (let k = 0; k < 3; k++) {
        const m = measure(aims[i], dist);
        aims[i].addScaledVector(_right, m.mx * dist * tanH).addScaledVector(_up, m.my * dist * tanV);
      }
    }
    this.overview = { aims, dist: clamp(dist, MIN_DIST, MAX_DIST * 3), phi };
    return this.overview;
  }

  // The overview's aim for a direction, eased between the fitted ones.
  overviewAim(theta, out = new THREE.Vector3()) {
    const { aims } = this.overview;
    const f = ((((theta / (Math.PI * 2)) % 1) + 1) % 1) * aims.length;
    const i = Math.floor(f) % aims.length;
    return out.lerpVectors(aims[i], aims[(i + 1) % aims.length], f - Math.floor(f));
  }

  // A view marked enter goes inside the innermost dome or room around its target; any other view stays outside.
  enterFor(v) {
    this.room = v.enter ? this.roomAt(v.target) : null;
    this._lastTarget.copy(this.goal.target);
  }

  roomAt(p) {
    let best = null;
    for (const s of this.solids) if (s.enterable && s.inside(p) && (!best || s.r < best.r)) best = s;
    return best;
  }

  // The view can walk into a dome only through its door, and leaves when it walks back out.
  guardTarget() {
    const t = this.goal.target;
    if (this.room && !this.room.inside(t)) this.room = this.room.parent?.inside(t) ? this.room.parent : null;
    for (const s of this.solids) {
      // Only a step from outside to inside counts; a view framing the dome from outside may aim at its middle.
      if (s.facing === null || s === this.room || !s.inside(t) || s.inside(this._lastTarget)) continue;
      // A dome can be walked into through its door; a room only through its button (zooming at a door
      // used to drop the view into the casino and keep it there).
      if (s.atDoor(this._lastTarget) && !(s instanceof RoomBox)) this.room = s;
      else {
        // Back out onto the ground just outside the glass.
        const a = Math.atan2(t.z - s.z, t.x - s.x);
        t.x = s.x + Math.cos(a) * (s.r + 0.5);
        t.z = s.z + Math.sin(a) * (s.r + 0.5);
      }
    }
    this._lastTarget.copy(t);
  }

  // Keep the camera out of every solid, and inside the dome the view is in.
  collide(pos) {
    for (const s of this.solids) {
      if (Math.abs(pos.x - s.x) > s.reach || Math.abs(pos.z - s.z) > s.reach) continue;
      if (s === this.room) s.keepIn(pos, this.target);
      else if (!this.room?.within.includes(s)) s.pushOut(pos);
    }
    return pos;
  }

  /**
   * Fly there like a drone: the camera glides along a straight line that lifts gently in the middle,
   * and its gaze turns onto the new spot a little ahead of the move, rather than swinging round an
   * orbit. Longer trips take a little longer.
   */
  flyTo(state, duration) {
    const fromPos = this.orbit(this.phi, new THREE.Vector3());
    const s = Math.sin(state.phi);
    const toPos = new THREE.Vector3(s * Math.sin(state.theta), Math.cos(state.phi), s * Math.cos(state.theta)).multiplyScalar(state.dist).add(state.target);
    const span = fromPos.distanceTo(toPos) + this.target.distanceTo(state.target) * 0.5;
    this.tween = {
      t: 0,
      duration: duration ?? clamp(0.8 + span / 500, 0.9, 2.0),
      fromPos,
      toPos,
      fromLook: this.target.clone(),
      lift: Math.min(span * 0.06, 24),
      to: { ...state, target: state.target.clone() },
    };
    this.fling.theta = this.fling.phi = 0;
    this.fling.pan.set(0, 0, 0);
    this.setState(state);
  }

  /**
   * Frame an object: { center, radius, name, theta?, phi? }. The camera keeps roughly the direction
   * it is looking from, turning at most 45 degrees toward the object's best side, so the trip reads
   * as flying over rather than swinging round. instant skips the flight.
   */
  focusOn(obj, { instant = false } = {}) {
    if (!this.focused) this.saved = { target: this.goal.target.clone(), dist: this.goal.dist, theta: this.goal.theta, phi: this.goal.phi, room: this.room, view: this.view };
    this.focused = obj;
    this.room = null;
    this.view = null;
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    // On a tall phone screen let the sides crop a little, so places still fill the view.
    const fit = obj.radius / Math.sin(Math.max(Math.min(vfov, hfov), vfov * 0.62) / 2);
    let theta = this.goal.theta;
    if (obj.theta !== undefined) {
      const turn = Math.atan2(Math.sin(obj.theta - theta), Math.cos(obj.theta - theta));
      theta += clamp(turn, -0.8, 0.8);
    }
    const state = { target: obj.center.clone(), dist: clamp(fit * 1.05, MIN_DIST, MAX_DIST), theta, phi: clamp(obj.phi ?? this.goal.phi, 0.95, 1.2) };
    if (instant) {
      this.tween = null;
      this.setState(state);
      this.target.copy(state.target);
      this.dist = state.dist;
      this.theta = state.theta;
      this.phi = state.phi;
    } else this.flyTo(state);
    this.onFocusChange?.(obj);
  }

  clearFocus() {
    this.focused = null;
    this.onFocusChange?.(null);
  }

  exitFocus() {
    if (!this.focused) return;
    const back = this.saved;
    this.clearFocus();
    if (back) {
      this.flyTo(back);
      // Never back into a room: leaving a visit always ends outside.
      this.room = back.room instanceof RoomBox ? null : back.room ?? null;
      this.view = back.view ?? null;
    }
  }

  // ---------- per frame ----------

  // Camera position for a tilt around the current target.
  orbit(phi, out) {
    const s = Math.sin(phi);
    return out.set(s * Math.sin(this.theta), Math.cos(phi), s * Math.cos(this.theta)).multiplyScalar(this.dist).add(this.target);
  }

  clearAt(phi) {
    const p = this.orbit(phi, _pos);
    return p.y >= cameraFloor(p.x, p.z);
  }

  apply() {
    // Swing down only as far as the camera stays clear of the grass and the clouds.
    let phi = this.phi;
    this.phiClear = this.maxPhi();
    if (!this.clearAt(phi)) {
      let hi = phi;
      let lo = phi;
      while (lo > 0.05 && !this.clearAt(lo)) {
        hi = lo;
        lo = Math.max(0.05, lo - 0.08);
      }
      for (let i = 0; i < 10; i++) {
        const mid = (lo + hi) / 2;
        if (this.clearAt(mid)) lo = mid;
        else hi = mid;
      }
      phi = lo;
      this.phiClear = lo;
    }
    const pos = this.orbit(phi, _pos);
    pos.y = Math.max(pos.y, cameraFloor(pos.x, pos.z));
    // Any tilt beyond that turns the view upward from where the camera stopped.
    const s = Math.sin(this.phi);
    _look.set(s * Math.sin(this.theta), Math.cos(this.phi), s * Math.cos(this.theta)).multiplyScalar(-this.dist).add(pos);
    // Slide off domes and buildings, still looking at the same spot.
    this.collide(pos);
    pos.y = Math.max(pos.y, cameraFloor(pos.x, pos.z));
    this.camera.position.copy(pos);
    this.camera.lookAt(_look);
  }

  keyMove(dt) {
    if (!this.keys.size) return;
    const k = this.keys;
    const f = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
    const s = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
    const turn = (k.has('e') ? 1 : 0) - (k.has('q') ? 1 : 0);
    const zoom = (k.has('-') || k.has('_') ? 1 : 0) - (k.has('=') || k.has('+') ? 1 : 0);
    const speed = this.goal.dist * 0.9 * dt;
    if (f || s || turn || zoom) {
      this.idleSpin = false;
      this.view = null;
    }
    if (f || s) {
      this.tween = null;
      const right = new THREE.Vector3(Math.cos(this.theta), 0, -Math.sin(this.theta));
      const fwd = new THREE.Vector3(-Math.sin(this.theta), 0, -Math.cos(this.theta));
      this.goal.target.addScaledVector(fwd, f * speed).addScaledVector(right, s * speed);
    }
    if (turn) this.goal.theta -= turn * 1.6 * dt;
    if (zoom) this.goal.dist = clamp(this.goal.dist * (1 + zoom * 1.5 * dt), MIN_DIST, MAX_DIST);
  }

  update(dt) {
    if (!this.focused) this.keyMove(dt);
    // Glide after a fling, slowing to a stop.
    const f = this.fling;
    if (!this.touching && (Math.abs(f.theta) + Math.abs(f.phi) > 1e-3 || f.pan.lengthSq() > 1e-3)) {
      this.goal.theta += f.theta * dt;
      this.goal.phi = clamp(this.goal.phi + f.phi * dt, 0.15, this.tiltLimit());
      if (!this.focused) this.goal.target.addScaledVector(f.pan, dt);
      const decay = Math.exp(-FRICTION * dt);
      f.theta *= decay;
      f.phi *= decay;
      f.pan.multiplyScalar(decay);
    }
    if (this.idleSpin && !this.focused && !this.tween) this.goal.theta += dt * 0.05;
    if (this.view === 'overview' && this.overview && !this.tween && !this.focused) {
      this.overviewAim(this.goal.theta, this.goal.target);
      this.goal.dist = this.overview.dist;
    }
    if (!this.tween) this.guardTarget();
    else this._lastTarget.copy(this.goal.target);
    // Stay over the archipelago.
    const r = Math.hypot(this.goal.target.x, this.goal.target.z);
    if (r > TARGET_LIMIT) {
      const y = this.goal.target.y;
      this.goal.target.multiplyScalar(TARGET_LIMIT / r).setY(y);
    }

    if (this.tween) {
      const tw = this.tween;
      tw.t = Math.min(1, tw.t + dt / tw.duration);
      const k = easeInOut(tw.t);
      // The gaze settles on the new spot a little before the camera arrives.
      const g = easeInOut(Math.min(1, tw.t * 1.3));
      _fp.lerpVectors(tw.fromPos, tw.toPos, k);
      _fp.y += Math.sin(Math.PI * k) * tw.lift;
      this.target.lerpVectors(tw.fromLook, tw.to.target, g);
      _fo.subVectors(_fp, this.target);
      this.dist = Math.max(_fo.length(), 1);
      this.theta = Math.atan2(_fo.x, _fo.z);
      this.phi = Math.acos(clamp(_fo.y / this.dist, -1, 1));
      if (tw.t >= 1) {
        this.tween = null;
        this.target.copy(tw.to.target);
        this.dist = tw.to.dist;
        this.theta = tw.to.theta;
        this.phi = tw.to.phi;
      }
    } else {
      const a = damp(12, dt);
      this.target.lerp(this.goal.target, a);
      this.dist += (this.goal.dist - this.dist) * a;
      this.theta = angleLerp(this.theta, this.goal.theta, a);
      this.phi += (this.goal.phi - this.phi) * a;
    }
    this.apply();
    this.focusDist = this.dist;
  }
}
