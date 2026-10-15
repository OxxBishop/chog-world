import * as THREE from 'three';
import { createFlight } from './flight.js';

/*
 * The arrival: from wherever the camera is down to the walk in front of your Chog's pod, looking at
 * its door, where A's hello takes over (A11). Two ways:
 *
 *   wake(room)  from the planet (B25): the warp in has left the screen white (src/space.js dive()).
 *               It goes blank, and you wake up, dazed, lying on the grass in your Chog's dome: your
 *               eyes open a slit on the glass overhead, blink, everything swims and blurs, and you
 *               sit up, woozy, to face your Chog's door as it comes out to wave. About 6 seconds.
 *   fly(room)   from anywhere in the world: down over the island to your dome, in through its glass
 *               (at the middle of one of the lattice's triangles, high over the doorway, so no strut
 *               ever crosses the lens) and down to the walk. About 6 seconds.
 *
 * Both resolve with what A's hello needs. Nothing here builds a shader.
 */

// Where the camera comes through the glass: the middle of the triangle between rings 3 and 4 of the
// lattice right over the door (see the rings in src/dome.js), as a latitude on the dome.
const THROUGH_LAT = 0.635;

// The blank and the eyelids: a black sheet over the world, with an opening (the eyes) that the
// wake animates. Above the canvas, under the panels and captions.
function eyelids() {
  const el = document.createElement('div');
  el.className = 'eyelids';
  el.hidden = true;
  document.body.appendChild(el);
  return {
    // open: 0 shut to 1 wide open; the opening a soft-edged ellipse, so the lids read as lids.
    set(open, black = 1) {
      el.hidden = open >= 1 && black <= 0;
      const h = Math.max(0, open) * 135;
      const soft = 18 + (1 - Math.min(1, open)) * 16;
      const mask = `radial-gradient(ellipse 92% ${h.toFixed(1)}% at 50% 50%, transparent ${Math.max(0, 100 - soft * 2).toFixed(1)}%, #000 100%)`;
      el.style.webkitMaskImage = el.style.maskImage = open <= 0 ? 'none' : mask;
      el.style.opacity = black.toFixed(3);
    },
    hide() {
      el.hidden = true;
    },
  };
}

// How open the eyes are, waking (seconds since the blank): a slit, a slow blink, open a little more,
// a quick blink, then wide.
function lidAt(t) {
  const s = (a, b) => THREE.MathUtils.smoothstep(t, a, b);
  if (t < 1.0) return 0;
  if (t < 1.9) return 0.28 * s(1.0, 1.6) * (1 - s(1.6, 1.9));
  if (t < 3.2) return 0.62 * s(2.1, 2.8) * (1 - s(3.0, 3.2));
  return 1.15 * s(3.3, 3.9);
}

export function createArrival({ camera, rig, space, domes, dom = null, quality = 'high' }) {
  let run = null;
  const lids = eyelids();

  const api = {
    get active() {
      return !!run;
    },
    /**
     * Flies to the home `room` (one of island.rooms, a dome's home). Resolves once the camera has
     * settled in front of the pod, with what A's spawn needs: the pod's door (position: the middle of
     * its sill; inside: a spot just behind it, in the hall; outward; open(k), 0 shut to 1 open) and
     * the camera's resting point.
     */
    fly(room) {
      const dome = domes[Number(room.id.replace('home', ''))];
      const R = dome.radius;
      const L = (x, y, z) => dome.group.localToWorld(new THREE.Vector3(x, y, z));
      const podDoor = dome.homeZ + dome.home.front;
      const look = L(0, 2.4, podDoor);
      // Far enough back for your Chog to step out and say hello in the middle of the frame, with the
      // dome round it.
      const end = L(1.2, 3.3, podDoor + 10.5);
      const through = L(0, R * Math.sin(THROUGH_LAT), R * Math.cos(THROUGH_LAT));
      const dir = end.clone().sub(through).normalize();
      // Over the island: high above the dome, a little out past its door, looking down at it.
      const over = L(0, 0, 0).add(new THREE.Vector3(0, 70, 0)).add(L(0, 0, 60).sub(L(0, 0, 0)));
      const keys = [
        { t: 0, pos: camera.position.clone(), look: rig.target.clone() },
        { t: 2.4, pos: over, look: L(0, 0, 0) },
        { t: 4.0, pos: through.clone().addScaledVector(dir, -14), look },
        { t: 4.7, pos: through, look },
        { t: 6.2, pos: end, look },
      ];
      const flight = createFlight({ keys: keys.map((k) => ({ t: k.t, pos: k.pos.toArray(), look: k.look.toArray() })) });
      if (space?.active) space.leave({ duration: 2.2 });
      const pd = dome.podDoor;
      const door = { position: pd.at(), inside: pd.inside(), outward: pd.outward(), open: (k) => pd.open(k), dome, room };
      return new Promise((resolve) => {
        run = { flight, t: 0, resolve, end, look, done: { door, rest: end.clone() } };
      });
    },
    /**
     * Wakes you up in the home `room`'s dome (one of island.rooms), the screen white from the warp in.
     * Resolves, like fly(), once the camera has come to rest in front of the pod.
     */
    wake(room) {
      const dome = domes[Number(room.id.replace('home', ''))];
      const L = (x, y, z) => dome.group.localToWorld(new THREE.Vector3(x, y, z));
      const podDoor = dome.homeZ + dome.home.front;
      const look = L(0, 2.4, podDoor);
      const end = L(1.2, 3.3, podDoor + 10.5);
      // Lying on the grass a little short of where you'll sit up to, looking up at the glass, the
      // pod above your feet.
      const lie = L(0.6, 0.55, podDoor + 9.2);
      const sky = L(0.2, 9.0, podDoor + 5.5);
      const pd = dome.podDoor;
      const door = { position: pd.at(), inside: pd.inside(), outward: pd.outward(), open: (k) => pd.open(k), dome, room };
      // White to blank.
      lids.set(0, 0);
      return new Promise((resolve) => {
        run = { kind: 'wake', t: -0.45, lie, sky, end, look, resolve, done: { door, rest: end.clone() }, resolved: false };
      });
    },
    // Called after rig.update: the camera on the flight's path, or waking up.
    update(dt) {
      if (run?.kind === 'wake') return wakeStep(Math.min(dt, 1 / 20));
      if (!run) return;
      run.t += Math.min(dt, 1 / 20);
      run.flight.pose(camera, Math.min(run.t, run.flight.duration));
      if (run.t < run.flight.duration) return;
      const r = run;
      run = null;
      rig.views.arrival = { pos: r.end, target: r.look, enter: true };
      rig.jump('arrival');
      r.resolve(r.done);
    },
  };
  // The wake, a frame at a time. t < 0: the white going blank, then space let go of under it.
  const _p = new THREE.Vector3(), _l = new THREE.Vector3(), _up = new THREE.Vector3();
  const blur = (px) => {
    if (!dom) return;
    dom.style.filter = px > 0.05 ? `blur(${px.toFixed(2)}px)` : '';
  };
  function wakeStep(dt) {
    const r = run;
    r.t += dt;
    const t = r.t;
    if (t < 0) {
      lids.set(0, THREE.MathUtils.smoothstep(t, -0.45, -0.1));
      return;
    }
    if (!r.blank) {
      // Blank: the world swapped in behind it.
      r.blank = true;
      lids.set(0, 1);
      space?.leave();
      rig.views.arrival = { pos: r.end, target: r.look, enter: true };
      rig.jump('arrival');
    }
    // 0 to 2.6 s lying there, looking up, the view swimming; 2.6 to 4.6 sitting up to face the door,
    // woozy; then the last of the sway dies away.
    const s = (a, b) => THREE.MathUtils.smoothstep(t, a, b);
    const sit = THREE.MathUtils.smootherstep(t, 2.6, 4.7);
    _p.lerpVectors(r.lie, r.end, sit);
    // Sitting up isn't a straight line: up first, then forward a touch.
    _p.y += Math.sin(sit * Math.PI) * 0.35;
    _l.lerpVectors(r.sky, r.look, THREE.MathUtils.smootherstep(t, 2.4, 4.5));
    // Dazed: the gaze drifts in slow loops, the head rolls, both settling as you come round.
    const daze = 1 - s(3.2, 6.2);
    const a = t * 1.3;
    _l.x += Math.sin(a) * 0.9 * daze;
    _l.y += Math.sin(a * 0.7 + 1.2) * 0.5 * daze;
    _l.z += Math.cos(a * 0.9) * 0.6 * daze;
    camera.position.copy(_p);
    camera.up.set(0, 1, 0);
    camera.lookAt(_l);
    camera.rotateZ((Math.sin(t * 0.9) * 0.16 + 0.12) * daze);
    camera.updateMatrixWorld();
    lids.set(lidAt(t), 1);
    // Everything swims, then sharpens.
    blur((quality === 'low' ? 3 : 7) * (1 - s(2.4, 5.2)));
    // In front of the door, still coming round: A's hello can start.
    if (!r.resolved && t >= 4.6) {
      r.resolved = true;
      r.resolve(r.done);
    }
    if (t >= 6.3) {
      run = null;
      lids.hide();
      blur(0);
      camera.position.copy(r.end);
      camera.lookAt(r.look);
      camera.updateMatrixWorld();
    }
  }

  return api;
}
