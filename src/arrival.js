import * as THREE from 'three';
import { createFlight } from './flight.js';

/*
 * The arrival: from wherever the camera is (the world seen from space, behind the intro screen) down
 * over the island to your dome, in through its glass, down to the pod and in through its door, along
 * the short hall and into your Chog's room, where it settles on the room's own view and A's spawn
 * takes over (A11: your Chog appears by the desk and steps out to say hello). About 7 seconds.
 *
 * The camera comes in through the glass at the middle of one of the lattice's triangles, high over
 * the dome's doorway, so no strut ever crosses the lens. The pod's doors and the room's own door
 * swing open as it comes, and close behind it (the room's while the camera settles, so it is shut
 * by the time the spawn starts). Nothing here builds a shader.
 */

// Where the camera comes through the glass: the middle of the triangle between rings 3 and 4 of the
// lattice right over the door (see the rings in src/dome.js), as a latitude on the dome.
const THROUGH_LAT = 0.635;
// The camera's eye height in the pod's doorway, as a share of the doorway's height.
const EYE = 0.46;

const smooth = (t) => THREE.MathUtils.smoothstep(t, 0, 1);
const clamp01 = (t) => Math.min(1, Math.max(0, t));

export function createArrival({ camera, rig, space, domes, fovs }) {
  let run = null;
  // Doors still closing after the flight has handed over.
  const swings = [];
  const roomDoor = (room, k) => {
    const h = room.room.doorway.hinge;
    h.rotation.y = h.userData.dir * smooth(clamp01(k)) * 1.55;
  };

  const api = {
    get active() {
      return !!run;
    },
    /**
     * Flies into the home `room` (one of island.rooms, a dome's home). Resolves once the camera has
     * settled on the room's own view, inside it.
     */
    fly(room) {
      const dome = domes[Number(room.id.replace('home', ''))];
      const R = dome.radius;
      const L = (x, y, z) => dome.group.localToWorld(new THREE.Vector3(x, y, z));
      const RL = (x, y, z) => room.room.group.localToWorld(new THREE.Vector3(x, y, z));
      const hall = dome.podDoor.hall;
      const eye = (hall.top - hall.sill) * EYE;
      const { d, h } = room.room;
      const front = L(0, hall.sill + eye + 0.4, hall.z + 4);
      const through = L(0, R * Math.sin(THROUGH_LAT), R * Math.cos(THROUGH_LAT));
      const dir = front.clone().sub(through).normalize();
      const mid = (hall.z + hall.zIn) / 2;
      // Over the island: high above the dome, a little out past its door, looking down at it.
      const over = L(0, 70, 60);
      const keys = [
        { t: 0, pos: camera.position.clone(), look: rig.target.clone() },
        { t: 2.0, pos: over, look: L(0, 0, 0) },
        { t: 3.4, pos: through.clone().addScaledVector(dir, -14), look: L(0, hall.sill + eye, hall.z) },
        { t: 4.0, pos: through, look: L(0, hall.sill + eye, hall.z) },
        { t: 5.0, pos: front, look: L(0, hall.floor(hall.zIn) + eye * 0.9, hall.zIn - 2) },
        { t: 5.6, pos: L(0, hall.floor(mid) + eye, mid), look: RL(0, h * 0.35, -d * 0.3) },
        { t: 6.2, pos: RL(0, eye + 0.1, d / 2 - 1.3), look: RL(-0.4, h * 0.3, -d * 0.3) },
        { t: 7.1, pos: room.view.pos.clone(), look: room.view.target.clone() },
      ];
      const flight = createFlight({ keys: keys.map((k) => ({ t: k.t, pos: k.pos.toArray(), look: k.look.toArray() })) });
      if (space?.active) space.leave({ duration: 2.2 });
      return new Promise((resolve) => {
        run = {
          room, dome, flight, t: 0, resolve,
          doors: (t) => {
            dome.podDoor.open(clamp01((t - 4.3) / 0.8));
            roomDoor(room, clamp01((t - 5.0) / 0.8) - clamp01((t - 6.3) / 0.8));
          },
          // The room shows from when the pod's doors open; the lens widens as the camera comes in.
          showRoom: (t) => t > 4.2,
          fovK: (t) => clamp01((t - 5.5) / 0.9),
        };
      });
    },

    // Called after rig.update: the camera on the flight's path.
    update(dt) {
      for (let i = swings.length - 1; i >= 0; i--) {
        const s = swings[i];
        s.t = Math.min(1, s.t + dt / 0.9);
        s.dome.podDoor.open(1 - s.t);
        if (s.t >= 1) swings.splice(i, 1);
      }
      if (!run) return;
      run.t += Math.min(dt, 1 / 20);
      run.doors(run.t);
      run.flight.pose(camera, Math.min(run.t, run.flight.duration));
      if (run.t < run.flight.duration) return;
      const r = run;
      run = null;
      rig.jump(r.room.id);
      // The doors close behind.
      swings.push({ dome: r.dome, room: r.room, t: 0 });
      r.resolve();
    },

    // Called after the world's own update: shows the room while the camera is still on its way in.
    apply(env, renderer) {
      if (!run || !run.showRoom(run.t)) return;
      const room = run.room.room;
      if (!room.group.visible) {
        room.group.visible = true;
        room.update?.(env, renderer);
      }
    },

    // The lens, outdoor to the room's as the camera comes in.
    fov() {
      if (!run) return null;
      const k = smooth(run.fovK(run.t));
      return fovs.outdoor() + (fovs.indoor() - fovs.outdoor()) * k;
    },
  };
  return api;
}
