import * as THREE from 'three';

/*
 * Camera flights. A flight is a drone path: keyframes, each a time, where the
 * camera is and what it looks at, joined by smooth curves, with the pace eased between the
 * keyframes' times so the drone can slow down near the ground and speed up far out without a jolt.
 * The demo's shots (src/shots.js) fly these, and so does the arrival (src/arrival.js). Coordinates
 * are world metres: downtown is at the origin, the Hub's doors face +z.
 */

// Monotone cubic through (x, y) points (Fritsch-Carlson), flat at both ends (the flight eases in and
// out): it never overshoots, so the camera never runs backwards along its path.
function monotone(xs, ys) {
  const n = xs.length;
  const d = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const m = [0];
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (2 * d[i - 1] * d[i]) / (d[i - 1] + d[i]));
  m.push(0);
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const s = (x - xs[i]) / h;
    const s2 = s * s, s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * ys[i] + (s3 - 2 * s2 + s) * h * m[i] + (-2 * s3 + 3 * s2) * ys[i + 1] + (s3 - s2) * h * m[i + 1];
  };
}

export function createFlight(shot) {
  const v = (a) => new THREE.Vector3(...a);
  const pos = new THREE.CatmullRomCurve3(shot.keys.map((k) => v(k.pos)), false, 'centripetal');
  const look = new THREE.CatmullRomCurve3(shot.keys.map((k) => v(k.look)), false, 'centripetal');
  // Key i sits at curve parameter i / (n - 1) on both curves. The pace follows the distance flown, so
  // the speed stays smooth through a key even where a short hop meets a long leg: the distance along
  // the path at each key is eased through the keys' times, then turned back into a curve parameter.
  const n = shot.keys.length;
  const STEPS = 200 * (n - 1);
  const dist = [0];
  const a = new THREE.Vector3(), b = pos.getPoint(0, new THREE.Vector3());
  for (let j = 1; j <= STEPS; j++) {
    pos.getPoint(j / STEPS, a);
    dist.push(dist[j - 1] + a.distanceTo(b));
    b.copy(a);
  }
  const flown = monotone(shot.keys.map((k) => k.t), shot.keys.map((_, i) => dist[(i * STEPS) / (n - 1)]));
  const param = (t) => {
    const d = flown(t);
    let lo = 0, hi = STEPS;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (dist[mid] < d) lo = mid;
      else hi = mid;
    }
    const span = dist[hi] - dist[lo];
    return (lo + (span > 0 ? (d - dist[lo]) / span : 0)) / STEPS;
  };
  const duration = shot.keys[n - 1].t;
  const target = new THREE.Vector3();
  return {
    duration,
    hour: shot.hour,
    // Puts the camera where the shot has it at t seconds.
    pose(camera, t) {
      const u = param(t);
      pos.getPoint(u, camera.position);
      camera.lookAt(look.getPoint(u, target));
      camera.updateMatrixWorld();
      return target;
    },
  };
}
