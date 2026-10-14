import * as THREE from 'three';
import { createFlight } from './flight.js';

/*
 * The arrival: from wherever the camera is (the world seen from space, behind the intro screen) down
 * over the island to your dome, in through its glass and down to the walk in front of your Chog's
 * pod, looking at its door, where A's spawn takes over (A11). About 6 seconds.
 *
 * The camera comes in through the glass at the middle of one of the lattice's triangles, high over
 * the dome's doorway, so no strut ever crosses the lens. Nothing here builds a shader.
 */

// Where the camera comes through the glass: the middle of the triangle between rings 3 and 4 of the
// lattice right over the door (see the rings in src/dome.js), as a latitude on the dome.
const THROUGH_LAT = 0.635;

export function createArrival({ camera, rig, space, domes }) {
  let run = null;

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
    // Called after rig.update: the camera on the flight's path.
    update(dt) {
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
  return api;
}
