import * as THREE from 'three';
import { damp, easeInOut, angleLerp, clamp } from './util.js';
import { heightAt, undersideAt, isVoid } from './terrain.js';
import { WORLD } from './layout.js';

const LIMIT_R = 750;
const MAX_Y = 450;
const LOOK_SENS = 0.0032;

/**
 * Free-fly camera, like a drone.
 * Drag to look (any direction, straight up included), WASD / arrows to fly, Space up, C down,
 * Shift for speed, scroll to glide forward or back, double-click to fly to a spot.
 * Speed scales with height so it feels right both at street level and high above the island.
 */
export class CameraRig {
  constructor(camera, dom, views) {
    this.camera = camera;
    this.dom = dom;
    this.views = views;
    camera.rotation.order = 'YXZ';
    this.yaw = 0;
    this.pitch = 0;
    this.yawGoal = 0;
    this.pitchGoal = 0;
    this.vel = new THREE.Vector3();
    this.keys = new Set();
    this.tween = null;
    this.focus = new THREE.Vector3();
    this.focusDist = 50;
    this.bind();
    this.jump('overview');
  }

  bind() {
    const el = this.dom;
    let drag = null;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
      el.setPointerCapture(e.pointerId);
      this.tween = null;
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      this.yawGoal -= (e.clientX - drag.x) * LOOK_SENS;
      this.pitchGoal = clamp(this.pitchGoal - (e.clientY - drag.y) * LOOK_SENS, -1.54, 1.54);
      drag.x = e.clientX;
      drag.y = e.clientY;
    });
    const end = (e) => {
      if (drag && drag.id === e.pointerId) drag = null;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.tween = null;
        const amount = clamp(-e.deltaY / 100, -3, 3);
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
        this.vel.addScaledVector(fwd, amount * this.speed() * 1.6);
      },
      { passive: false },
    );
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
      this.keys.add(k);
      this.tween = null;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  // Height above whatever is below (an island, or the cloud sea far down), used to scale speed.
  altitude() {
    const p = this.camera.position;
    const g = heightAt(p.x, p.z);
    return Math.max(1, Math.min(isVoid(g) ? 80 : p.y - g, Math.abs(p.y - WORLD.cloudSeaY)));
  }

  speed() {
    return clamp(this.altitude() * 1.1, 7, 160);
  }

  setLook(pos, target) {
    const d = target.clone().sub(pos);
    this.yaw = this.yawGoal = Math.atan2(-d.x, -d.z);
    this.pitch = this.pitchGoal = Math.atan2(d.y, Math.hypot(d.x, d.z));
  }

  jump(name) {
    const v = this.views[name];
    this.camera.position.copy(v.pos);
    this.setLook(v.pos, v.target);
    this.vel.set(0, 0, 0);
    this.apply();
  }

  go(name, duration = 2.2) {
    const v = this.views[name];
    this.flyTo(v.pos, v.target, duration);
  }

  flyTo(pos, target, duration = 1.6) {
    const d = target.clone().sub(pos);
    this.tween = {
      t: 0,
      duration,
      fromPos: this.camera.position.clone(),
      toPos: pos.clone(),
      fromYaw: this.yaw,
      fromPitch: this.pitch,
      toYaw: Math.atan2(-d.x, -d.z),
      toPitch: Math.atan2(d.y, Math.hypot(d.x, d.z)),
    };
    this.vel.set(0, 0, 0);
  }

  // Fly toward a spot on the ground, ending a comfortable distance away and looking at it.
  focusOn(point) {
    const from = this.camera.position;
    const dir = from.clone().sub(point);
    const dist = clamp(dir.length() * 0.35, 12, 60);
    dir.setLength(dist);
    dir.y = Math.max(dir.y, dist * 0.45);
    this.flyTo(point.clone().add(dir), point, 1.3);
  }

  apply() {
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  constrain() {
    const p = this.camera.position;
    const r = Math.hypot(p.x, p.z);
    if (r > LIMIT_R) {
      p.x *= LIMIT_R / r;
      p.z *= LIMIT_R / r;
    }
    p.y = clamp(p.y, WORLD.cloudSeaY + 25, MAX_Y);
    // Stay out of the islands: above the grass, or below the rocky underside.
    const top = heightAt(p.x, p.z);
    if (!isVoid(top)) {
      const bottom = undersideAt(p.x, p.z);
      if (p.y < top + 1.5 && p.y > bottom - 1.5) p.y = p.y - bottom < (top + 1.5 - p.y) ? bottom - 1.5 : top + 1.5;
    }
  }

  update(dt) {
    const cam = this.camera;
    if (this.tween) {
      const tw = this.tween;
      tw.t += dt / tw.duration;
      const k = easeInOut(Math.min(tw.t, 1));
      cam.position.lerpVectors(tw.fromPos, tw.toPos, k);
      this.yaw = this.yawGoal = angleLerp(tw.fromYaw, tw.toYaw, k);
      this.pitch = this.pitchGoal = tw.fromPitch + (tw.toPitch - tw.fromPitch) * k;
      if (tw.t >= 1) this.tween = null;
    } else {
      // Smooth look.
      this.yaw = angleLerp(this.yaw, this.yawGoal, damp(20, dt));
      this.pitch += (this.pitchGoal - this.pitch) * damp(20, dt);

      // Keys push the drone; it glides to a stop when you let go.
      const k = this.keys;
      const f = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
      const s = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
      const u = (k.has(' ') || k.has('e') ? 1 : 0) - (k.has('c') || k.has('q') || k.has('control') ? 1 : 0);
      if (f || s || u) {
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion).setY(0).normalize();
        const wish = fwd.multiplyScalar(f).add(right.multiplyScalar(s));
        wish.y += u;
        wish.normalize().multiplyScalar(this.speed() * (k.has('shift') ? 3 : 1));
        this.vel.lerp(wish, damp(6, dt));
      } else {
        this.vel.multiplyScalar(1 - damp(4, dt));
      }
      cam.position.addScaledVector(this.vel, dt);
    }
    this.constrain();
    this.apply();
    cam.updateMatrixWorld();

    // What the camera is looking at on the ground, for shadows and detail.
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const groundY = WORLD.landH;
    if (fwd.y < -0.05 && cam.position.y > groundY + 0.5) {
      const t = Math.min((cam.position.y - groundY) / -fwd.y, 250);
      this.focus.copy(cam.position).addScaledVector(fwd, t);
    } else {
      this.focus.copy(cam.position).addScaledVector(fwd.setY(0).normalize(), 25);
    }
    this.focus.y = groundY;
    this.focusDist = cam.position.distanceTo(this.focus);
  }
}
