import * as THREE from 'three';
import { damp, easeInOut, clamp, angleLerp } from './util.js';
import { heightAt, isVoid } from './terrain.js';
import { WORLD } from './layout.js';

const MIN_DIST = 8;
const MAX_DIST = 750;
const TARGET_LIMIT = 330;
const TAP_MS = 280;
const TAP_PX = 9;

/**
 * Map-style camera, built for touch first.
 *
 * Exploring: one finger (or left mouse) drags the world around, pinch or scroll zooms toward
 * where you point, two fingers twist to turn and slide up or down to tilt (right mouse does both).
 * Tap a place to visit it: the camera frames it and dragging then circles around it.
 * Tap again, tap empty sky or press Back to return to where you were.
 */
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
    this.focus = new THREE.Vector3();
    this.focusDist = 100;
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

    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button, t: performance.now(), sx: e.clientX, sy: e.clientY });
      this.tween = null;
      gesture = { ...snapshot(), rotate: e.button === 2 || e.ctrlKey || e.shiftKey };
    });
    el.addEventListener('pointermove', (e) => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX;
      p.y = e.clientY;
      const now = snapshot();
      if (!gesture || now.n !== gesture.n) {
        gesture = { ...now, rotate: gesture?.rotate };
        return;
      }
      const dx = now.x - gesture.x, dy = now.y - gesture.y;
      if (now.n === 1) {
        if (gesture.rotate || this.focused) this.rotate(dx, dy);
        else this.pan(dx, dy);
      } else {
        this.zoomAt(gesture.d / now.d, now.x, now.y);
        let dAng = now.ang - gesture.ang;
        if (dAng > Math.PI) dAng -= Math.PI * 2;
        if (dAng < -Math.PI) dAng += Math.PI * 2;
        this.goal.theta -= dAng;
        // Two fingers sliding together tilts the view.
        this.goal.phi = clamp(this.goal.phi - dy * 0.006, 0.2, this.maxPhi());
      }
      gesture = { ...now, rotate: gesture.rotate };
    });
    const end = (e) => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      pts.delete(e.pointerId);
      const quick = performance.now() - p.t < TAP_MS && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) < TAP_PX;
      if (quick && pts.size === 0 && gesture?.n === 1 && p.button === 0) this.onTap?.(e.clientX, e.clientY);
      gesture = pts.size ? { ...snapshot(), rotate: false } : null;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.tween = null;
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
    // Looking up from beneath the islands is allowed; otherwise stop a little past level.
    return this.goal.target.y < WORLD.landH - 5 ? 2.5 : 1.62;
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

  rotate(dx, dy) {
    this.goal.theta -= dx * 0.006;
    this.goal.phi = clamp(this.goal.phi - dy * 0.005, 0.2, this.maxPhi());
  }

  // Zoom by a factor, pulling the target toward whatever is under the screen point.
  zoomAt(factor, sx, sy) {
    const next = clamp(this.goal.dist * factor, MIN_DIST, MAX_DIST);
    const real = next / this.goal.dist;
    if (!this.focused) {
      const p = this.groundPoint(sx, sy);
      if (p) this.goal.target.lerp(p, 1 - real);
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
    const v = this.views[name];
    this.setState(this.fromPosTarget(v.pos, v.target));
    this.target.copy(this.goal.target);
    this.dist = this.goal.dist;
    this.theta = this.goal.theta;
    this.phi = this.goal.phi;
    this.apply();
  }

  go(name, duration = 1.8) {
    if (this.focused) this.clearFocus();
    const v = this.views[name];
    this.flyTo(this.fromPosTarget(v.pos, v.target), duration);
  }

  flyTo(state, duration = 1.4) {
    this.tween = {
      t: 0,
      duration,
      from: { target: this.target.clone(), dist: this.dist, theta: this.theta, phi: this.phi },
      to: state,
    };
    this.setState(state);
  }

  /** Frame an object: { center, radius, name, theta?, phi? }. */
  focusOn(obj) {
    if (!this.focused) this.saved = { target: this.goal.target.clone(), dist: this.goal.dist, theta: this.goal.theta, phi: this.goal.phi };
    this.focused = obj;
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    const fit = obj.radius / Math.sin(Math.min(vfov, hfov) / 2);
    this.flyTo({ target: obj.center.clone(), dist: clamp(fit * 1.05, MIN_DIST, MAX_DIST), theta: obj.theta ?? this.theta, phi: obj.phi ?? 1.05 });
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
    if (back) this.flyTo(back, 1.2);
  }

  // ---------- per frame ----------

  apply() {
    const s = Math.sin(this.phi);
    const off = new THREE.Vector3(s * Math.sin(this.theta), Math.cos(this.phi), s * Math.cos(this.theta)).multiplyScalar(this.dist);
    const pos = this.target.clone().add(off);
    // Keep the camera out of the ground.
    const g = heightAt(pos.x, pos.z);
    if (!isVoid(g) && pos.y < g + 1.5 && this.target.y > g - 3) pos.y = g + 1.5;
    pos.y = Math.max(pos.y, WORLD.cloudSeaY + 25);
    this.camera.position.copy(pos);
    this.camera.lookAt(this.target);
  }

  keyMove(dt) {
    if (!this.keys.size) return;
    const k = this.keys;
    const f = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
    const s = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
    const turn = (k.has('e') ? 1 : 0) - (k.has('q') ? 1 : 0);
    const zoom = (k.has('-') || k.has('_') ? 1 : 0) - (k.has('=') || k.has('+') ? 1 : 0);
    const speed = this.goal.dist * 0.9 * dt;
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
    // Stay over the archipelago.
    const r = Math.hypot(this.goal.target.x, this.goal.target.z);
    if (r > TARGET_LIMIT) {
      const y = this.goal.target.y;
      this.goal.target.multiplyScalar(TARGET_LIMIT / r).setY(y);
    }

    if (this.tween) {
      const tw = this.tween;
      tw.t += dt / tw.duration;
      const k = easeInOut(Math.min(tw.t, 1));
      this.target.lerpVectors(tw.from.target, tw.to.target, k);
      // Arc out a little mid-flight so the move reads as a glide.
      this.dist = THREE.MathUtils.lerp(tw.from.dist, tw.to.dist, k) * (1 + Math.sin(k * Math.PI) * 0.15);
      this.theta = angleLerp(tw.from.theta, tw.to.theta, k);
      this.phi = THREE.MathUtils.lerp(tw.from.phi, tw.to.phi, k);
      if (tw.t >= 1) this.tween = null;
    } else {
      const a = damp(12, dt);
      this.target.lerp(this.goal.target, a);
      this.dist += (this.goal.dist - this.dist) * a;
      this.theta = angleLerp(this.theta, this.goal.theta, a);
      this.phi += (this.goal.phi - this.phi) * a;
    }
    this.apply();
    this.focus.copy(this.target).setY(WORLD.landH);
    this.focusDist = this.dist;
  }
}
