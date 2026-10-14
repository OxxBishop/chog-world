import * as THREE from 'three';

/*
 * The moments a Chog has with its owner: waking in its home when you sign in, waving goodbye when you
 * sign out, and going grey when it leaves your wallet. All are hooks the session calls; they can grow
 * here (sound, the rigged animations) without the session changing.
 */

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function caption(text, sub = '') {
  const el = document.getElementById('story');
  el.querySelector('.story-title').textContent = text;
  el.querySelector('.story-sub').textContent = sub;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('on'));
}

function hideCaption() {
  const el = document.getElementById('story');
  el.classList.remove('on');
  setTimeout(() => (el.hidden = true), 400);
}

// A burst of sparkles rising round a Chog, in its aura's colour: the moment it comes to life.
// Soft four-point twinkles that drift up and out, then fade.
const SPARKLE_VERT = /* glsl */ `
  attribute vec3 velocity;
  attribute float seed;
  uniform float uTime;
  uniform float uScale;
  varying float vSeed;
  void main() {
    float t = uTime;
    vec3 p = position + velocity * (1.0 - exp(-t * 1.6)) / 1.6;
    p.y += sin(t * 3.0 + seed * 20.0) * 0.04;
    vSeed = seed;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = uScale * (0.7 + seed * 1.1) / -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;
const SPARKLE_FRAG = /* glsl */ `
  uniform vec3 uColour;
  uniform float uTime;
  uniform float uFade;
  varying float vSeed;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d);
    float core = exp(-r * r * 90.0);
    float rays = exp(-abs(d.x) * 40.0) * exp(-abs(d.y) * 6.0) + exp(-abs(d.y) * 40.0) * exp(-abs(d.x) * 6.0);
    float twinkle = 0.65 + 0.35 * sin(uTime * 14.0 + vSeed * 40.0);
    float a = (core + rays * 0.6) * twinkle * uFade * smoothstep(0.5, 0.3, r);
    if (a < 0.01) discard;
    // Bright enough to catch the bloom, so each one glows; some lean warm, some take the aura's colour.
    vec3 tint = mix(uColour, vec3(1.0, 0.86, 0.55), step(0.6, vSeed));
    gl_FragColor = vec4(mix(tint, vec3(1.0), core * 0.5) * a * 2.6, a);
  }`;
function makeSparkle(root, colour = '#d0b4ff') {
  const N = 56;
  const pos = new Float32Array(N * 3);
  const vel = new Float32Array(N * 3);
  const seed = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    // A ring just wider than the Chog, so they show round it rather than behind it.
    const a = Math.random() * Math.PI * 2, r = 0.75 + Math.random() * 0.45;
    pos.set([Math.cos(a) * r, 0.1 + Math.random() * 2.1, Math.sin(a) * r], i * 3);
    const out = 0.2 + Math.random() * 0.5;
    vel.set([Math.cos(a) * out, 0.8 + Math.random() * 1.4, Math.sin(a) * out], i * 3);
    seed[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('velocity', new THREE.BufferAttribute(vel, 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColour: { value: new THREE.Color(colour) }, uTime: { value: 0 }, uFade: { value: 0 }, uScale: { value: 250 } },
    vertexShader: SPARKLE_VERT,
    fragmentShader: SPARKLE_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.visible = false;
  // Sized in pixels of whatever it's drawn into, so it looks the same at any resolution.
  points.onBeforeRender = (renderer) => {
    const target = renderer.getRenderTarget();
    mat.uniforms.uScale.value = 0.36 * (target ? target.height : renderer.domElement.height);
  };
  root.add(points);
  return {
    play: () => {
      points.visible = true;
      return tween(2600, (k) => {
        mat.uniforms.uTime.value = k * 2.6;
        mat.uniforms.uFade.value = Math.min(1, k * 8) * (1 - THREE.MathUtils.smoothstep(k, 0.5, 1));
      }).then(() => {
        points.removeFromParent();
        geo.dispose();
        mat.dispose();
      });
    },
  };
}

/** Set a Chog up for its wake before it's shown, so everything it needs is compiled ahead. */
export function prepareWake(chog) {
  chog.sparkle = makeSparkle(chog.root, chog.look.aura ?? '#d0b4ff');
}

// Where a Chog sleeps and stands in its home room (room space, metres).
export const BED = new THREE.Vector3(-2.7, 0.5, 0.2);
export const SPOT = new THREE.Vector3(0.3, 0, -0.8);

/**
 * Wake: the Chog is asleep on its bed when the view fades in, sits up, hops down and waves.
 * Resolves when it's standing and idle.
 */
export async function playWake({ chog, name }) {
  chog.root.position.copy(BED);
  chog.root.rotation.y = Math.PI / 2;
  chog.play('sleep');
  caption(`${name} is waking up`);
  await wait(1200);
  chog.play('wake');
  await wait(2400);
  // Down off the bed, turning to face you.
  const from = chog.root.position.clone();
  const t0 = performance.now();
  chog.play('walk');
  await new Promise((resolve) => {
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / 900);
      chog.root.position.lerpVectors(from, SPOT, k);
      chog.root.rotation.y = Math.PI / 2 * (1 - k) + 0.5 * k;
      if (k < 1) requestAnimationFrame(step);
      else resolve();
    };
    step();
  });
  chog.play('wave');
  (chog.sparkle ?? makeSparkle(chog.root, chog.look.aura ?? '#d0b4ff')).play();
  chog.sparkle = null;
  caption(`${name} is home`, 'Your Chog lives here now. It stays as long as it stays in your wallet.');
  await wait(2200);
  chog.play('idle');
  hideCaption();
}

/**
 * The sale: the Chog has left the wallet (sold or sent). It turns to you, its colour drains from the
 * feet up, and it walks out of its home grey. The view is carried out to the world seen from space,
 * the world fades, and it's gone: "Your Chog has moved on." Resolves at the end,
 * on a dark screen; the session signs out and the world comes back from there.
 *
 * world: { enterSpace({ from, duration }) (B7: carries the view out to the world seen from space,
 * resolves when it settles), blackout(text, sub) (fades to dark with a caption, resolves after it
 * has been read) }.
 */
export async function playGreyOut({ chog, name, room, world }) {
  chog.play('idle');
  caption(`${name} left your wallet`);
  // It turns to face you.
  const eye = room.room.group.worldToLocal(world.camera.getWorldPosition(new THREE.Vector3()));
  const turnFrom = chog.root.rotation.y;
  let turnBy = Math.atan2(eye.x - chog.root.position.x, eye.z - chog.root.position.z) - turnFrom;
  turnBy = Math.atan2(Math.sin(turnBy), Math.cos(turnBy));
  await tween(700, (k) => (chog.root.rotation.y = turnFrom + turnBy * THREE.MathUtils.smoothstep(k, 0, 1)));
  await wait(400);
  // Colour drains from the feet up.
  await tween(2600, (k) => chog.setGrey(THREE.MathUtils.smoothstep(k, 0, 1)));
  chog.play('sad');
  await wait(700);
  // It walks out of the door, grey.
  const door = new THREE.Vector3(0, 0, room.room.d / 2 - 0.6);
  const from = chog.root.position.clone();
  chog.root.rotation.y = Math.atan2(door.x - from.x, door.z - from.z);
  chog.play('walk');
  hideCaption();
  // It fades as it goes, since the door is on the camera's side of the room.
  await tween(2600, (k) => {
    chog.root.position.lerpVectors(from, door, k * 0.7);
    chog.setFade(1 - THREE.MathUtils.smoothstep(k, 0.25, 0.8));
  });
  chog.root.visible = false;
  await world.enterSpace({ from: room, duration: 5 });
  await world.blackout('Your Chog has moved on.', 'It goes grey and wanders off when it leaves your wallet. Its next owner can wake it again.');
}

/**
 * Logoff: the Chog waves goodbye in its home, then the view is carried out to the world seen from
 * space (B7). Resolves when it settles; the session signs out and the world comes back from there.
 */
export async function playLogoff({ chog, name, room, world }) {
  chog.play('wave');
  caption('See you soon', `${name} will be right here when you come back.`);
  await wait(2200);
  hideCaption();
  await world.enterSpace({ from: room, duration: 4 });
}

// Run fn(k) for k from 0 to 1 over ms, one step a frame.
function tween(ms, fn) {
  const t0 = performance.now();
  return new Promise((resolve) => {
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      fn(k);
      if (k < 1) requestAnimationFrame(step);
      else resolve();
    };
    step();
  });
}
