import * as THREE from 'three';
import { ISLANDS } from './layout.js';

/*
 * The world seen from space: the whole archipelago as a little diorama floating in a starry void.
 * The sky, the sea of clouds and the sea below give way to deep space with a purple nebula across
 * it; the islands, their rocky undersides, the bridges and everything on them stay, lit softly
 * whatever the hour. The camera is carried out to a slow orbit round it.
 *
 * Used when the user is carried out of the world (a sale, signing out) and behind the sign-in panel.
 * Nothing here changes a shader: the void and the stars are their own two objects, compiled at load
 * with the rest of the world, and the rest is lights, fog distance and visibility.
 */

// The middle of the archipelago, and how far it reaches (rims and lobes included).
const CENTRE = new THREE.Vector3(0, 0, 0);
const REACH = Math.max(...ISLANDS.map((i) => Math.hypot(i.x, i.z) + i.r * 1.3));
// The orbit: looking down at it from this far above the horizon, turning slowly round.
const ELEVATION = 0.42;
const SPIN = 0.025;
// How much of the screen the diorama fills across, at most, and how far its rocky undersides hang.
const FILL = 0.88;
const HANG = 110;
const STARS = 3400;

const voidVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const voidFrag = /* glsl */ `
uniform float uOpacity;
uniform float uTime;
varying vec3 vDir;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; }
  return s;
}

void main() {
  vec3 d = normalize(vDir);
  // Deep violet, a touch lighter overhead.
  vec3 col = mix(vec3(0.010, 0.006, 0.030), vec3(0.040, 0.020, 0.090), smoothstep(-0.7, 0.9, d.y));
  // A band of nebula across the sky, in wisps, drifting very slowly.
  float band = exp(-pow((d.y * 0.85 + d.x * 0.4 - 0.15) / 0.5, 2.0));
  float n = fbm(d * 2.4 + vec3(0.0, 0.0, uTime * 0.004));
  float w = smoothstep(0.42, 0.85, n) * band;
  float core = smoothstep(0.6, 0.95, fbm(d * 5.1 + 3.7)) * w;
  col += vec3(0.30, 0.10, 0.50) * w * 0.5 + vec3(0.75, 0.30, 0.70) * core * 0.35;
  gl_FragColor = vec4(col, uOpacity);
  #include <colorspace_fragment>
}`;

const starVert = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
attribute float aPhase;
uniform float uTime;
uniform float uOpacity;
uniform float uScale;
varying vec3 vColor;
varying float vAlpha;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  // On the far plane, behind everything in the world.
  gl_Position.z = gl_Position.w;
  vAlpha = uOpacity * (0.7 + 0.3 * sin(uTime * (0.8 + aPhase) + aPhase * 40.0));
  vColor = aColor;
  gl_PointSize = aSize * uScale;
}`;

const starFrag = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float a = 1.0 - smoothstep(0.0, 1.0, r);
  gl_FragColor = vec4(vColor, a * a * vAlpha);
  #include <colorspace_fragment>
}`;

function starField(radius) {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pos = [], size = [], color = [], phase = [];
  const tints = [[1, 1, 1], [0.8, 0.88, 1], [1, 0.82, 0.95], [1, 0.93, 0.8], [0.86, 0.78, 1]];
  const v = new THREE.Vector3();
  for (let i = 0; i < STARS; i++) {
    // Uniform over the sphere, with a third of them gathered along the nebula's band.
    v.set(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1);
    if (v.lengthSq() > 1 || v.lengthSq() < 1e-4) {
      i--;
      continue;
    }
    v.normalize();
    if (i % 3 === 0) {
      const off = (v.y * 0.85 + v.x * 0.4 - 0.15) * 0.75;
      v.y -= off / 0.85;
      v.normalize();
    }
    pos.push(v.x * radius, v.y * radius, v.z * radius);
    // Mostly faint pinpricks, a few bright enough to glow.
    const bright = rnd();
    const k = bright > 0.985 ? 3.2 : bright > 0.9 ? 1.8 : 1.0 + rnd() * 0.5;
    size.push(bright > 0.985 ? 4.6 : bright > 0.9 ? 3.0 : 1.8 + rnd());
    const t = tints[Math.floor(rnd() * tints.length)];
    color.push(t[0] * k, t[1] * k, t[2] * k);
    phase.push(rnd());
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1));
  g.setAttribute('aColor', new THREE.Float32BufferAttribute(color, 3));
  g.setAttribute('aPhase', new THREE.Float32BufferAttribute(phase, 1));
  return g;
}

const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const clamp01 = (x) => Math.min(1, Math.max(0, x));

/**
 * rig: the camera rig, whose pose is kept so the view can fly back to it. dip(fn): a quick fade to
 * dark and back, running fn while it is dark.
 */
export function createSpace({ scene, camera, renderer, sky, clouds, rig, dip }) {
  const group = new THREE.Group();
  group.visible = false;
  const voidMat = new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0 }, uTime: { value: 0 } },
    vertexShader: voidVert,
    fragmentShader: voidFrag,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
  });
  const backdrop = new THREE.Mesh(new THREE.SphereGeometry(500, 48, 24), voidMat);
  // Before every other see-through thing, so the dome glass and the glows draw over it.
  backdrop.renderOrder = -1;
  backdrop.frustumCulled = false;
  const starMat = new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0 }, uTime: { value: 0 }, uScale: { value: 1 } },
    vertexShader: starVert,
    fragmentShader: starFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const stars = new THREE.Points(starField(500), starMat);
  stars.renderOrder = -1;
  stars.frustumCulled = false;
  group.add(backdrop, stars);
  scene.add(group);

  // The pose the rig gave the camera this frame, before space took over.
  const rigPos = new THREE.Vector3();
  const rigQuat = new THREE.Quaternion();
  // A flight: from (position, look) to the orbit, or from the orbit back to the rig.
  let flight = null;
  // 'off', 'in' (flying out), 'there' (orbiting), 'back' (flying home)
  let state = 'off';
  let theta = 0;
  let k = 0;
  let time = 0;
  let lastNow = performance.now();
  const look = new THREE.Vector3();
  const q = new THREE.Quaternion();

  // How far out the orbit sits: the archipelago fills FILL of the screen's width, unless its height
  // from this angle (the land foreshortened, the undersides below) would need more room than that.
  function orbitDist() {
    const halfV = THREE.MathUtils.degToRad(camera.fov / 2);
    const halfH = Math.atan(Math.tan(halfV) * camera.aspect);
    const across = REACH / Math.tan(halfH * FILL);
    const tall = (REACH * Math.sin(ELEVATION) + HANG) / Math.tan(halfV * 0.82);
    return Math.max(across, tall);
  }
  function orbitPos(out) {
    const d = orbitDist();
    return out.set(Math.sin(theta) * Math.cos(ELEVATION), Math.sin(ELEVATION), Math.cos(theta) * Math.cos(ELEVATION)).multiplyScalar(d).add(CENTRE);
  }
  // The camera's far plane has to take in the far side of the diorama.
  function ensureFar() {
    const need = orbitDist() + REACH + 200;
    if (camera.far < need) {
      camera.far = need;
      camera.updateProjectionMatrix();
    }
  }

  // Distance out from the centre eased in log space, so the pull back reads as one steady zoom, and
  // its direction swung round from where it starts to where it ends.
  const fromDir = new THREE.Vector3(), toDir = new THREE.Vector3(), axis = new THREE.Vector3();
  function dolly(a, b, s, out) {
    const da = a.distanceTo(CENTRE), db = b.distanceTo(CENTRE);
    fromDir.subVectors(a, CENTRE).normalize();
    toDir.subVectors(b, CENTRE).normalize();
    const angle = fromDir.angleTo(toDir);
    axis.crossVectors(fromDir, toDir);
    if (axis.lengthSq() < 1e-8) axis.set(0, 1, 0);
    out.copy(fromDir).applyAxisAngle(axis.normalize(), angle * s);
    return out.multiplyScalar(Math.exp(THREE.MathUtils.lerp(Math.log(da), Math.log(db), s))).add(CENTRE);
  }

  const api = {
    // The void and the stars, drawn once behind the loader so their shaders are built (B12).
    group,
    get active() {
      return state !== 'off';
    },

    /**
     * Carries the view out to the world seen from space. from: the room the view is in (its home),
     * if any; from inside a room the view first dips out to just beyond its dome. duration: seconds
     * from the start to the view settling (0 jumps straight there). Resolves once it has settled,
     * and stays in space until leave().
     */
    enter({ from = null, duration = 4 } = {}) {
      ensureFar();
      group.visible = true;
      const start = (pos, lookAt) => {
        theta = Math.atan2(pos.x - CENTRE.x, pos.z - CENTRE.z);
        const to = orbitPos(new THREE.Vector3());
        if (duration <= 0) {
          flight = null;
          state = 'there';
          k = 1;
          return Promise.resolve();
        }
        state = 'in';
        const fly = Math.max(0.5, duration * 0.85);
        return new Promise((resolve) => {
          flight = { t: 0, fly, hold: duration, pos: pos.clone(), look: lookAt.clone(), to, done: resolve };
        });
      };
      if (from) {
        // Out of the room to just beyond its dome, looking back at it, under a quick dip.
        return new Promise((resolve) => {
          dip(() => {
            // The rig lets go of the room too, so it stops keeping the view indoors.
            rig.room = null;
            const home = from.room.group.getWorldPosition(new THREE.Vector3());
            const out = new THREE.Vector3().subVectors(home, CENTRE).setY(0).normalize();
            const pos = home.clone().addScaledVector(out, 48).setY(home.y + 36);
            camera.position.copy(pos);
            camera.lookAt(home.x, home.y + 4, home.z);
            start(pos, home.clone().setY(home.y + 4)).then(resolve);
          });
        });
      }
      return start(camera.position.clone(), rig.target.clone());
    },

    /**
     * Back to the world: at once (under a fade the caller is running), or flying back to where the
     * rig has the view over duration seconds. Resolves once the world is back.
     */
    leave({ duration = 0 } = {}) {
      if (state === 'off') return Promise.resolve();
      flight?.done?.();
      if (duration <= 0) {
        flight = null;
        state = 'off';
        k = 0;
        api.apply();
        return Promise.resolve();
      }
      state = 'back';
      return new Promise((resolve) => {
        flight = { t: 0, fly: duration, pos: camera.position.clone(), look: CENTRE.clone(), done: resolve };
      });
    },

    // Poses the camera. Call each frame after the rig has had its turn. Runs on real time, like the
    // cutscenes that wait on it, so a duration is the same seconds on any machine.
    update() {
      const now = performance.now();
      const dt = Math.min(0.25, (now - lastNow) / 1000);
      lastNow = now;
      rigPos.copy(camera.position);
      rigQuat.copy(camera.quaternion);
      if (state === 'off') return;
      time += dt;
      theta += SPIN * dt;
      const f = flight;
      if (state === 'in') {
        f.t += dt;
        const s = ease(clamp01(f.t / f.fly));
        // Follow the orbit as it turns, so the arrival is seamless.
        orbitPos(f.to);
        dolly(f.pos, f.to, s, camera.position);
        look.lerpVectors(f.look, CENTRE, ease(clamp01((f.t / f.fly) * 1.35)));
        camera.lookAt(look);
        k = THREE.MathUtils.smoothstep(f.t / f.fly, 0.05, 0.7);
        if (f.t >= f.hold) {
          state = 'there';
          flight = null;
          f.done();
        }
      } else if (state === 'there') {
        orbitPos(camera.position);
        camera.lookAt(CENTRE);
        k = 1;
      } else if (state === 'back') {
        f.t += dt;
        const s = ease(clamp01(f.t / f.fly));
        dolly(f.pos, rigPos, s, camera.position);
        // Ease the gaze onto the rig's own, which takes over at the end.
        camera.lookAt(look.lerpVectors(f.look, rig.target, s));
        q.copy(camera.quaternion).slerp(rigQuat, THREE.MathUtils.smoothstep(s, 0.6, 1));
        camera.quaternion.copy(q);
        k = 1 - THREE.MathUtils.smoothstep(s, 0.3, 0.95);
        if (f.t >= f.fly) {
          state = 'off';
          flight = null;
          k = 0;
          camera.position.copy(rigPos);
          camera.quaternion.copy(rigQuat);
          f.done();
        }
      }
      camera.updateMatrixWorld();
    },

    // The world's side of it: call each frame after the sky has set the day's light.
    apply() {
      group.visible = k > 0;
      sky.mesh.visible = k < 1;
      clouds?.setAway(k);
      if (k <= 0) return;
      group.position.copy(camera.position);
      voidMat.uniforms.uOpacity.value = k;
      voidMat.uniforms.uTime.value = time;
      starMat.uniforms.uOpacity.value = k;
      starMat.uniforms.uTime.value = time;
      starMat.uniforms.uScale.value = renderer.getPixelRatio();
      // No haze out here.
      sky.fog.near += k * 1e5;
      sky.fog.far += k * 1e5;
      // Soft light on the diorama whatever the hour: never darker than an afternoon.
      sky.hemi.intensity = THREE.MathUtils.lerp(sky.hemi.intensity, Math.max(sky.hemi.intensity, 1.0), k);
      sky.light.intensity = THREE.MathUtils.lerp(sky.light.intensity, Math.max(sky.light.intensity, 2.2), k);
      scene.environmentIntensity = THREE.MathUtils.lerp(scene.environmentIntensity, Math.max(scene.environmentIntensity, 0.8), k);
    },
  };
  return api;
}
