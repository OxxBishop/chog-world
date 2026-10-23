import * as THREE from 'three';
import { makeChog, CHOG_HEIGHT } from './chog.js';
import { surfaceAt } from './travel.js';
import { chogInfo } from './chogdata.js';
import { HOODS, DOMES, DOWNTOWN, roadDistance, nearDome } from './layout.js';
import { COSMO_DOME } from './cosmo.js';
import { createRider } from './rider.js';
import { islandAt } from './terrain.js';
import { angleLerp } from './util.js';
import { throne, flowerArch, campfire } from './castspots.js';

/*
 * The Chogs who live round the world, in a few sets, each loaded only once the camera comes near it
 * (the files are about 2 MB each, so none of them is in the first load) and compiled before it shows.
 *
 *   plaza    the singer on their stage with a crowd watching, two Chogs strolling round the fountain,
 *            and one by the lobby door
 *   gardener #271 (Petal) out on the tree island among the flowers
 *   napper   #124 (Snooze) dozing at the foot of the giant tree there
 *   runner   #471 (Dash) lapping the loop on the beacon island
 *   walker   the astronaut, floating in zero g in his own dome on the middle island (src/cosmo.js)
 *
 * The bar's bartender and regulars are in src/barchat.js. Each Chog here is its own rigged model from
 * public/models/npcs/ (C's cast); ?npcs shows every slot even before it is near.
 */

const M = (file) => `models/npcs/${file}.glb`;
export const NPC_SLOTS = {
  // Faces out over the plaza, between the fountain and the walk the downtown view looks along.
  singer: { glb: M('singer'), plaza: [27, 30], faces: [10, 55] },
  // Watching from an arc in front of the stage (the middle left clear, so the singer can be seen):
  // plain Chogs in a few shades, a banana and a dragon.
  // (Puff in the front row; Peel went to the bar's counter, 10-23.)
  crowd: { plain: M('plain'), named: [{ id: 37, glb: M('chog-37') }] },
  // Each in a place of their own on the plaza (the user, 10-23): King Pom holding court on his throne by
  // the fountain, Quackers posing in a flower arch across from the stage. at: plaza x, z.
  courtiers: [
    { id: 409, glb: M('chog-409'), at: [-11, 50], prop: 'throne', moves: ['wave', 'talk'], every: [8, 14] },
    { id: 66, glb: M('chog-66'), at: [-24, 36], prop: 'arch', moves: ['cheer', 'wave'], every: [4, 8] },
  ],
  // Toasty at his campfire on the beacon island, telling stories; Dash laps the beacon bridge.
  storyteller: { id: 52, glb: M('chog-52'), at: [205.5, -106.8] },
  // By the lobby door, in the Monad look.
  doorman: { id: 1151, glb: M('chog-1151'), plaza: [-5.2, 23.2] },
  gardener: { id: 271, glb: M('chog-271'), hood: 0 },
  // At the foot of the giant tree, on the side you come up from the bridge (the user's pick, 10-21).
  napper: { id: 124, glb: M('chog-124'), hood: 0, r: 9.5 },
  runner: { id: 471, glb: M('chog-471'), hood: 2 },
  walker: { id: 68, glb: M('chog-68'), hood: 1, speed: -0.07 },
};

const FOUNTAIN = new THREE.Vector3(0, 0, 40);
// Sets load once the camera is this close (one at a time, the nearest first), and are drawn and
// animated once it is closer still.
const LOAD = 300;
const NEAR = 260;
// Outdoors everything is built bigger than life (the plaza's benches and lamps are 1.7x, plaza.js),
// so the characters out there are too, to sit right beside them.
const OUTDOOR = 1.7;

// One of the cast: its own model, and for a token Chog its traits and name (no aura ring under a model).
// Out here they are seen from a way off, so each is a lighter copy of its model.
const KEEP = 0.3;
async function npc(glb, id = null, tint = null) {
  const info = id ? await chogInfo(id) : {};
  const chog = await makeChog({ ...info, traits: { ...info.traits, Aura: null }, model: glb, tint, keep: KEEP });
  chog.root.userData.chogId = id;
  return chog;
}

/**
 * The singer: the plain Chog's body on its stage disc with a handheld mic, in one file (A rebuilt it on
 * 10-16: tools/models/fix/singer_rebuild.mjs), driven like any Chog (its face sings along).
 */
async function singerNpc(url) {
  const chog = await makeChog({ model: url });
  chog.root.traverse((o) => o.isMesh && (o.receiveShadow = true));
  return chog;
}

/*
 * The singer's stage lights (the user's pick, "fairy lights"): four slim posts round the stage with
 * strings of warm bulbs swagged between them that twinkle, one soft spotlight on the singer, and music
 * notes drifting up while it sings. In the square's space (1.7 x life size outdoors). The bulbs' halos
 * grow with the dusk; by day the bulbs still glow warm.
 */
function stageLights(facing) {
  const g = new THREE.Group();
  const posts = [];
  // Round the stage, the front pair wider so the crowd's view stays open.
  for (const [a, r] of [[0.75, 2.7], [-0.75, 2.7], [2.45, 2.5], [-2.45, 2.5]]) {
    const ang = facing + a;
    posts.push(new THREE.Vector3(Math.sin(ang) * r, 3.05, Math.cos(ang) * r));
  }
  const wood = new THREE.MeshStandardMaterial({ color: '#4a3a32', roughness: 0.8 });
  const brass = new THREE.MeshStandardMaterial({ color: '#cfa84e', metalness: 0.7, roughness: 0.35 });
  for (const p of posts) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 3.1, 8), wood);
    post.position.set(p.x, 1.55, p.z);
    post.castShadow = true;
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), brass);
    cap.position.set(p.x, 3.12, p.z);
    g.add(post, cap);
  }
  // Swags: round the four sides, and one across the back, each sagging in the middle.
  const cord = new THREE.MeshBasicMaterial({ color: '#2a2030' });
  const bulbs = [];
  for (const [i, j, sag] of [[0, 1, 0.5], [1, 3, 0.42], [3, 2, 0.42], [2, 0, 0.42], [2, 1, 0.55]]) {
    const A = posts[i], B = posts[j];
    const pts = [];
    for (let k = 0; k <= 24; k++) {
      const t = k / 24;
      pts.push(new THREE.Vector3().lerpVectors(A, B, t).setY(A.y - Math.sin(t * Math.PI) * sag));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.008, 4), cord));
    const n = Math.round(curve.getLength() / 0.24);
    for (let k = 1; k < n; k++) bulbs.push(curve.getPoint(k / n).add(new THREE.Vector3(0, -0.035, 0)));
  }
  const warm = ['#ffd38a', '#ffb870', '#fff0c0', '#ffc9a0'].map((c) => new THREE.Color(c));
  const bulbMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshBasicMaterial(), bulbs.length);
  const m4 = new THREE.Matrix4();
  bulbs.forEach((p, k) => {
    bulbMesh.setMatrixAt(k, m4.makeTranslation(p.x, p.y, p.z));
    bulbMesh.setColorAt(k, warm[k % warm.length]);
  });
  g.add(bulbMesh);
  // Halos: a point each, twinkling on its own beat.
  const geo = new THREE.BufferGeometry().setFromPoints(bulbs);
  geo.setAttribute('phase', new THREE.Float32BufferAttribute(bulbs.map(() => Math.random() * 6.28), 1));
  geo.setAttribute('tint', new THREE.Float32BufferAttribute(bulbs.flatMap((_, k) => warm[k % warm.length].toArray()), 3));
  const haloMat = new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 }, uStrength: { value: 0.4 }, uScale: { value: 400 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `attribute float phase; attribute vec3 tint; uniform float uT; uniform float uScale; varying float vK; varying vec3 vC;
      void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vK = 0.62 + 0.38 * sin(uT * (1.3 + fract(phase * 3.1) * 1.6) + phase); vC = tint;
        gl_PointSize = max(0.22 * uScale / -mv.z, 2.5); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uStrength; varying float vK; varying vec3 vC;
      void main() { vec2 p = gl_PointCoord * 2.0 - 1.0; float r = dot(p, p); if (r > 1.0) discard;
        float glow = exp(-r * 5.0) * 0.8 + exp(-r * 24.0) * 0.7; gl_FragColor = vec4(vC * glow * uStrength * vK, 1.0); }`,
  });
  const halos = new THREE.Points(geo, haloMat);
  halos.frustumCulled = false;
  halos.renderOrder = 4;
  g.add(halos);
  // One soft spotlight from up behind the back posts onto the singer.
  const beamMat = new THREE.ShaderMaterial({
    uniforms: { uI: { value: 0.5 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: 'varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = -mv.xyz; vN = normalMatrix * normal; gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform float uI; varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ float rim = pow(abs(dot(normalize(vN), normalize(vV))), 1.6); float fade = pow(vUv.y, 1.4); gl_FragColor = vec4(vec3(1.0, 0.85, 0.66) * rim * fade * uI * 0.4, 1.0); }',
  });
  const len = 4.2;
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.95, len, 32, 1, true).translate(0, -len / 2, 0), beamMat);
  const back = new THREE.Vector3(-Math.sin(facing) * 1.6, 4.1, -Math.cos(facing) * 1.6);
  cone.position.copy(back);
  cone.lookAt(0, 0.6, 0);
  cone.rotateX(-Math.PI / 2);
  g.add(cone);
  const pool = new THREE.Mesh(new THREE.CircleGeometry(1.0, 40), new THREE.MeshBasicMaterial({ map: glowTexture(), color: '#ffcf9a', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55 }));
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.32;
  g.add(pool);
  // Notes drifting up from the singer while it sings.
  const notes = [];
  for (let k = 0; k < 10; k++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: noteTexture(k % 2), color: k % 2 ? '#fff3d6' : '#ffe0b8', transparent: true, depthWrite: false, opacity: 0 }));
    s.scale.setScalar(0.24);
    s.userData = { life: 0 };
    g.add(s);
    notes.push(s);
  }
  let acc = 0, next = 0, t = 0;
  return {
    group: g,
    update(dt, singing, env, renderer) {
      t += dt;
      const night = env?.night ?? 0;
      haloMat.uniforms.uT.value = t;
      haloMat.uniforms.uStrength.value = 0.32 + night * 0.9;
      if (renderer) haloMat.uniforms.uScale.value = renderer.domElement.height / 2 / Math.tan(THREE.MathUtils.degToRad(21));
      beamMat.uniforms.uI.value = 0.35 + night * 0.65 + Math.sin(t * 0.8) * 0.05;
      pool.material.opacity = 0.25 + night * 0.5;
      acc += dt;
      if (singing && acc > 0.55) {
        acc = 0;
        const s = notes[next++ % notes.length];
        s.userData = { life: 1, x: (Math.random() - 0.5) * 0.6, z: (Math.random() - 0.5) * 0.4, y: 1.7, ph: Math.random() * 6 };
      }
      for (const s of notes) {
        const u = s.userData;
        if (u.life <= 0) {
          s.material.opacity = 0;
          continue;
        }
        u.life -= dt * 0.32;
        u.y += dt * 0.32;
        s.position.set(u.x + Math.sin(t * 1.8 + u.ph) * 0.14, u.y, u.z);
        s.material.rotation = Math.sin(t * 2.4 + u.ph) * 0.3;
        s.material.opacity = Math.min(1, (1 - u.life) * 5) * u.life * 0.9;
      }
    },
  };
}
let glowTex = null;
function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}
const noteTex = [];
// A quaver and a beamed pair, drawn (no font needed).
function noteTexture(kind) {
  if (noteTex[kind]) return noteTex[kind];
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.shadowColor = 'rgba(255,255,255,0.9)';
  g.shadowBlur = 10;
  g.fillStyle = g.strokeStyle = '#fff';
  g.lineWidth = 7;
  const head = (x, y) => {
    g.save();
    g.translate(x, y);
    g.rotate(-0.45);
    g.beginPath();
    g.ellipse(0, 0, 15, 11, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  };
  if (kind === 0) {
    head(50, 92);
    g.beginPath();
    g.moveTo(63, 88);
    g.lineTo(63, 26);
    g.stroke();
    g.beginPath();
    g.moveTo(63, 26);
    g.quadraticCurveTo(92, 40, 86, 66);
    g.quadraticCurveTo(84, 50, 63, 46);
    g.fill();
  } else {
    head(36, 96);
    head(88, 84);
    g.beginPath();
    g.moveTo(49, 92);
    g.lineTo(49, 36);
    g.moveTo(101, 80);
    g.lineTo(101, 24);
    g.stroke();
    g.beginPath();
    g.moveTo(46, 34);
    g.lineTo(104, 20);
    g.lineTo(104, 34);
    g.lineTo(46, 48);
    g.closePath();
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  noteTex[kind] = t;
  return t;
}

// The singer's set, on a loop: eight bars of the song, a cheer, a breather.
const SET = [['sing', 19.2], ['cheer', 2.66], ['idle', 4]];
// B's stage effects (src/fx/stagefx.js, the user's picks: the LED floor and confetti), once they're in:
// createStageFx({ facing, quality }) -> { group, update(dt, { singing, songTime, part, env, renderer }) },
// in the square's space (the singer at the origin, its stage's top at y 0.258, radius about 1.85).
const stageFx = Object.values(import.meta.glob('./fx/stagefx.js', { eager: true }))[0] ?? null;

// Someone who mostly stands about: idle, now and then a wave or a cheer (each at its own rhythm).
function idler(chog, moves = ['cheer'], every = [9, 16]) {
  let left = every[0] + Math.random() * (every[1] - every[0]);
  let busy = 0;
  chog.play('idle');
  return (dt) => {
    if (busy > 0) {
      busy -= dt;
      if (busy <= 0) chog.play('idle');
      return;
    }
    left -= dt;
    if (left > 0) return;
    chog.play(moves[Math.floor(Math.random() * moves.length)]);
    busy = 2.4;
    left = every[0] + Math.random() * (every[1] - every[0]);
  };
}

// A few shades for the plain Chogs in the crowd, so they read as different Chogs.
const SHADES = ['#ffffff', '#f3e3ff', '#ffe8d6', '#e2f4ff', '#e6ffe8', '#ffe1ee'];

// A spot out on a neighbourhood: on the grass, off the roads, clear of domes and the landmark.
function openSpot(hood, from, step = 0.35) {
  for (let i = 0; i < 40; i++) {
    const a = from + i * step;
    for (const r of [34, 38, 30]) {
      const x = hood.x + Math.cos(a) * r, z = hood.z + Math.sin(a) * r;
      const hit = islandAt(x, z);
      if (!hit || hit.k > 0.85 || roadDistance(x, z) < 5 || nearDome(x, z, 4)) continue;
      return new THREE.Vector3(x, surfaceAt(x, z), z);
    }
  }
  return new THREE.Vector3(hood.x, surfaceAt(hood.x, hood.z), hood.z);
}

/*
 * The cast notices you (A13; the user, 10-17: "just to the camera as they notice the visitor's presence",
 * "different lines for different characters tailored to their personality"). When you come near, each named
 * Chog turns to the camera, waves and says a line of its own in a bubble, then carries on; again only once
 * you have gone off and come back. A line is never the one it said last.
 */
const NOTICE = 7.5;
const NOTICE_AGAIN = 20;
const CAST = {
  1151: { name: 'Monty', face: 'excited', pace: 1.15, lines: ['Welcome to Chog Hub! The lobby is right behind me.', 'Hey! Fastest chain, friendliest door.', 'Good to see you. Purple suits this place, right?', 'Monad never sleeps, and neither do I.'], hi: ['Hey {n}! Come by the Hub later.', 'Good to see you, {n}!'] },
  409: { name: 'King Pom', face: 'happy', pace: 0.85, lines: ['Ah, a visitor. You may approach.', 'Bow if you like. I am not fussy. I am a little fussy.', 'The plaza is mine, but you may borrow it.', 'Mind the crown. It is heavier than it looks.'], hi: ['Ah, {n}. Carry on.', 'Good day to you, {n}.'] },
  68: { name: 'Cosmo', face: 'curious', pace: 1, lines: ['New lifeform spotted. Friendly. Logging it.', 'Coordinates noted. You are right where you should be.', 'I mapped this island twice. You are my favourite landmark.', 'Hello from orbit. Well, from the walkway.'], hi: ['{n}! Signal received.', 'Hey {n}, nice orbit.'] },
  124: { name: 'Snooze', face: 'sleepy', pace: 0.6, lines: ['Mmh? Oh, hi. Welcome...', 'Just resting my eyes. Nice to meet you.', 'You look lovely today. Sorry, I am so sleepy.'], hi: ['Oh... hi, {n}...', 'Mmh. Hey, {n}.'] },
  132: { name: 'Peel', face: 'excited', pace: 1.35, lines: ['You are a-peeling already!', 'Let us go bananas!', 'This crowd is ripe for a party!', 'Careful, I hear it is a long slip from here.'], hi: ['{n}! Looking a-peeling!', 'Hey hey, {n}!'] },
  37: { name: 'Puff', face: 'happy', pace: 1.1, lines: ['This song gets me every time.', 'Oh, hi! Do not mind me, happy tears.', 'You came! Group hug later?'], hi: ['{n}! Hi hi!', 'Oh, {n}! Hug later?'] },
  56: { name: 'Patrol', face: 'happy', pace: 0.85, lines: ['Afternoon. Please enjoy the plaza responsibly.', 'All clear here. Have a lovely day.', 'Pardon me. Just keeping an eye out.'], hi: ['All good, {n}?', 'Hey {n}. Stay safe out there.'] },
  66: { name: 'Quackers', face: 'excited', pace: 1.2, lines: ['Love the look. Mine is better, but love it.', 'Duck float? Iconic. Thanks for noticing.', 'Strike a pose with me. Quick!'], hi: ['{n}! Love the fit.', 'Hey {n}! Quack!'] },
  271: { name: 'Petal', face: 'happy', pace: 0.9, lines: ['Have you smelled these? Go on, I will wait.', 'Every flower here has a name. I named them.', 'Mind the petals, they bruise easy.', 'Sunny out. Perfect for growing.'], hi: ['Oh, {n}! Smell this one.', 'Hey {n}, the flowers missed you.'] },
  471: { name: 'Dash', face: 'excited', pace: 1.3, lines: ['Cannot stop, I am in training!', 'Ten laps before lunch. Easy.', 'Race you round the island!', 'Personal best today. Probably.'], hi: ['Keep up, {n}!', 'Hey {n}! One more lap?'] },
  52: { name: 'Toasty', face: 'happy', pace: 1, lines: ['Did I ever tell you about the coldest night on these islands?', 'Brr. Sit down, I have a story for you.', 'You look warm. Stand a little closer, friend.'], hi: ['{n}! Warm enough?', 'Hey {n}, I owe you a story.'] },
};
// Greetings: two of the cast who come across each other, one of them walking, greet by name, the first
// line and then the answer (the user, 10-18: "the chogs should say a greeting to each other if they come
// across themselves on the island"); and your Chog answers whoever greets you, by name. Within this far
// (metres), each pair once in so long (s), with a gap after any greeting (s).
const GREET_NEAR = 3.6;
const GREET_AGAIN = 70;
const GREET_GAP = 6;
const MY_HI = ['Hi, {n}!', 'Hey {n}!', 'Hello, {n}!'];
const fill = (line, name) => line.replace('{n}', name);
// Lyra, the singer: spots you joining the crowd, holds the mic out to you and dedicates the next song (it
// starts again from the top). From in front of the stage only.
const LYRA = { name: 'Lyra', face: 'excited', lines: ["This next one's for you!", 'Hey you! This one is yours.', 'Glad you made it. Here we go!'], near: 10, ahead: 0.2, rearm: 16, move: 'sing', reach: true };
// One line shows at a time; the next waits its turn (the user, 10-17: hard to keep track of). Each stays up
// long enough to read and comes and goes softly.
const VOICES = 1;
const FADE_IN = 0.3;
const FADE_OUT = 0.45;
// How long it says its hello (its talk; no waving since 10-21) before standing and talking on, facing you.
const WAVE_FOR = 2.6;

/**
 * The sets, each built the first time the camera comes near (or at once with standees: show every
 * slot, ?npcs). plaza is the plaza group (its origin is the square's). quality 'low' has a smaller crowd.
 * prewarm(obj) compiles a set's shaders before it shows.
 */
export async function buildNpcs({ scene, plaza, standees = false, prewarm, quality = 'high', bridges = null }) {
  const actors = [];
  const sets = [];
  // The light of the moment (night, the canvas), for the stage's bulbs.
  let lastEnv = null;
  let lastRenderer = null;
  const wp = new THREE.Vector3();
  const cp = new THREE.Vector3();
  let t = 0;

  // ---------- noticing you ----------
  const noticers = [];
  const _a = new THREE.Vector3();
  const _b = new THREE.Vector3();
  let speaking = 0;
  let lastCamera = null;
  // Your Chog (while you walk one), for the strollers to wait for.
  let lastMe = null;
  let lastBoards = null;
  // f: the Chog's own routine, which waits while it reacts. steer: whether that routine sets which way it
  // faces (a stroller does; one standing in the crowd keeps the way it faced). resume: back to its routine.
  // who: its CAST entry (name, face, pace, lines; near, how close you come; ahead, only from in front of the
  // way it stands, the least cosine; rearm, how far off you go before it notices you again; move, reach).
  function own(c, f, { steer = false, resume = () => c.play('idle'), who = CAST[c.root.userData.chogId] } = {}) {
    if (!who) return f;
    const near = who.near ?? NOTICE;
    const n = { c, who, steer, resume, near, ahead: who.ahead ?? -2, rearm: who.rearm ?? near + 6, armed: true, on: false, wait: 0, left: 0, cool: 1 + Math.random(), back: 0, yaw0: 0, yaw: 0, said: -1, bubble: null };
    noticers.push(n);
    return (...args) => (n.on ? undefined : f(...args));
  }
  function bubbleFor(n) {
    if (n.bubble) return n.bubble;
    const el = document.createElement('div');
    el.className = 'chog-bubble bar-bubble';
    el.hidden = true;
    el.style.transition = 'none';
    el.innerHTML = '<span class="who"></span><span class="line"></span>';
    el.firstChild.textContent = n.who.name;
    document.body.append(el);
    return (n.bubble = el);
  }
  // Turn to the camera, wave (the singer: her mic held out) and say a line.
  function pick(n, pool) {
    let i = Math.floor(Math.random() * pool.length);
    if (pool.length > 1 && i === n.said) i = (i + 1) % pool.length;
    n.said = i;
    return pool[i];
  }
  // A line in a reaction: its bubble shows from `from` to `from + len` seconds in, the whole reaction lasts
  // `total`; it faces `face` (a Chog's root) or else the camera. voice: it holds the one voice (VOICES).
  function say(n, line, { len, from = 0, total = from + len, move = null, wave = 0, face = null, voice = true }) {
    const { c, who } = n;
    n.from = from;
    n.to = from + len;
    n.left = total;
    n.age = 0;
    n.waving = wave;
    n.face = face;
    n.voice = voice;
    n.line = line;
    n.talked = false;
    if (move) c.play(move);
    c.setPace(who.pace ?? 1);
    c.express(who.face, total + 0.4);
    c.lookAt(face);
    const el = bubbleFor(n);
    el.lastChild.textContent = line;
    el.hidden = false;
    el.style.opacity = '0';
    n.sx = null;
    if (voice) speaking++;
  }
  const lineLen = (line, lo = 4.2, hi = 7.5) => THREE.MathUtils.clamp(2.2 + line.length * 0.075, lo, hi);
  // What they say about your Chog's traits (the user's pick, 10-23: "the cast reacts to your traits"): a
  // trait you share with them first, else something about your look. Most likely the first time each one
  // meets you, now and then after.
  function traitLine(n) {
    const mine = lastMe?.userData.api?.traits;
    if (!mine || Math.random() > (n.metYou ? 0.3 : 0.75)) return null;
    n.metYou = true;
    const theirs = n.c.traits ?? {};
    for (const k of ['Head', 'Body', 'Eyes', 'Accessory']) {
      const v = mine[k];
      if (v && v !== 'Base' && v === theirs[k]) return pick1([`We match! Same ${v.toLowerCase()}.`, `Twins! I love the ${v.toLowerCase()}.`, `Same ${v.toLowerCase()} as me. Great taste.`]);
    }
    const has = (k, re) => re.test(String(mine[k] ?? ''));
    const out = [];
    if (mine.Base === '1:1') out.push('A one of one! There is nobody else like you.');
    if (mine.Tier === 'Legendary') out.push('A Legendary, here? Everyone, look!');
    else if (mine.Tier === 'Epic') out.push('Epic look. Truly.');
    else if (mine.Tier === 'Rare') out.push('A rare one! Lucky me.');
    if (has('Head', /crown/i)) out.push(who(n) === 'King Pom' ? 'A crown? There can only be one of us.' : 'Love the crown!');
    else if (has('Head', /cap|hat|beanie/i)) out.push(`Nice ${String(mine.Head).toLowerCase()}.`);
    if (has('Eyes', /glass|shade|visor|goggle/i)) out.push('Nice shades.');
    if (has('Body', /hoodie/i)) out.push('That hoodie looks so cosy.');
    else if (has('Body', /jacket|suit|coat/i)) out.push(`Sharp ${String(mine.Body).toLowerCase()}.`);
    else if (has('Body', /jersey/i)) out.push('Love the jersey. Game day?');
    if (mine.Aura && mine.Aura !== 'None') out.push(`Your ${String(mine.Aura).toLowerCase().replace(/\s*aura$/, '')} aura is glowing today.`);
    if (mine.Form === 'Skull') out.push('Spooky. In a good way.');
    if (mine.Accessory && mine.Accessory !== 'None') out.push(`That ${String(mine.Accessory).toLowerCase()} suits you.`);
    return out.length ? pick1(out) : null;
  }
  const pick1 = (a) => a[Math.floor(Math.random() * a.length)];
  const who = (n) => n.who.name;
  function react(n) {
    const { c, who } = n;
    const line = traitLine(n) ?? pick(n, who.lines);
    const len = lineLen(line);
    // Your Chog answers once the line is done, and this one keeps facing you while it does.
    const api = lastMe?.userData.api;
    const answer = api && who.name ? fill(pick(meN(api), MY_HI), who.name) : null;
    const after = answer ? 0.3 + lineLen(answer, 2.4, 4) : 0;
    say(n, line, { len, total: len + after, move: who.move ?? 'talk', wave: who.move ? 0 : WAVE_FOR });
    if (answer) mine.pending = { line: answer, at: t + len + 0.3, len: after - 0.3 };
    if (who.reach && lastCamera) c.reach(lastCamera, n.left);
  }
  // Your Chog's own bubble (it answers a greeting).
  const mine = { c: null, who: { name: '', face: 'happy' }, bubble: null, said: -1, pending: null, left: 0, age: 0, from: 0, to: 0 };
  function meN(api) {
    if (mine.c !== api) {
      mine.c = api;
      // (Walking as one of the cast, its own name, not its token number.)
      const id = Number(String(api.name ?? '').match(/^Chog #(\d+)$/)?.[1]);
      mine.who.name = CAST[id]?.name ?? api.name ?? 'You';
      if (mine.bubble) mine.bubble.firstChild.textContent = mine.who.name;
    }
    return mine;
  }
  function mineTick(dt, camera) {
    const api = lastMe?.userData.api;
    if (!api || mine.c !== api) {
      if (mine.bubble) mine.bubble.hidden = true;
      mine.pending = null;
      return;
    }
    if (mine.pending && t >= mine.pending.at) {
      const p = mine.pending;
      mine.pending = null;
      mine.from = 0;
      mine.to = mine.left = p.len;
      mine.age = 0;
      mine.sx = null;
      const el = bubbleFor(mine);
      el.lastChild.textContent = p.line;
      el.hidden = false;
      el.style.opacity = '0';
      api.express('happy', p.len + 0.4);
      api.talk(Math.min(p.len - 0.8, 0.6 + p.line.length * 0.06));
    }
    if (mine.left <= 0 || !mine.bubble || mine.bubble.hidden) return;
    mine.age += dt;
    bubbleTick(mine, dt, camera, api.root);
    if ((mine.left -= dt) <= 0) mine.bubble.hidden = true;
  }
  // A bubble over its head, faded in and out over its own stretch of the reaction.
  function bubbleTick(n, dt, camera, root) {
    const el = n.bubble;
    if (!el || el.hidden || !camera) return;
    root.localToWorld(_a.set(0, CHOG_HEIGHT + 0.7, 0));
    _a.project(camera);
    const shown = _a.z < 1 && Math.abs(_a.x) < 1.2 && Math.abs(_a.y) < 1.2 && n.age >= n.from;
    const k = shown ? Math.min(1, (n.age - n.from) / FADE_IN) * Math.min(1, Math.max(0, n.to - n.age) / FADE_OUT) : 0;
    el.style.opacity = (k * k * (3 - 2 * k)).toFixed(3);
    if (shown) placeClear(n, el, ((_a.x + 1) / 2) * window.innerWidth, ((1 - _a.y) / 2) * window.innerHeight, dt);
  }
  // Two of the cast greeting each other (see GREET_NEAR): checked a few times a second.
  const pairCool = new Map();
  let greetGap = 0;
  let greetCheck = 0;
  const _g = new THREE.Vector3();
  function greetTick(dt, camera) {
    greetGap -= dt;
    if ((greetCheck -= dt) > 0) return;
    greetCheck = 0.25;
    if (greetGap > 0 || speaking > 0 || !camera) return;
    const free = (n) => !n.on && n.back <= 0 && n.who.hi && n.c.root.parent && n.c.root.visible && !n.c.root.userData.away;
    for (let i = 0; i < noticers.length; i++) {
      const a = noticers[i];
      if (!free(a)) continue;
      for (let j = i + 1; j < noticers.length; j++) {
        const b = noticers[j];
        if (!(a.steer || b.steer) || !free(b)) continue;
        a.c.root.getWorldPosition(_a);
        b.c.root.getWorldPosition(_b);
        if (_a.distanceTo(_b) > GREET_NEAR || Math.abs(_a.y - _b.y) > 2) continue;
        const key = a.who.name < b.who.name ? `${a.who.name}|${b.who.name}` : `${b.who.name}|${a.who.name}`;
        if ((pairCool.get(key) ?? -1) > t) continue;
        // Only where you can see and hear it: near the camera, on screen.
        _g.addVectors(_a, _b).multiplyScalar(0.5);
        if (_g.distanceTo(camera.position) > 30) continue;
        _g.y += CHOG_HEIGHT;
        _g.project(camera);
        if (_g.z > 1 || Math.abs(_g.x) > 0.85 || Math.abs(_g.y) > 0.9) continue;
        // The one walking speaks first.
        const [p, q] = a.steer ? [a, b] : [b, a];
        const l1 = fill(pick(p, p.who.hi), q.who.name);
        const l2 = fill(pick(q, q.who.hi), p.who.name);
        const len1 = lineLen(l1, 2.8, 5);
        const len2 = lineLen(l2, 2.8, 5);
        const total = len1 + 0.35 + len2 + 0.3;
        for (const n of [p, q]) {
          n.on = true;
          n.yaw0 = n.c.root.rotation.y;
        }
        say(p, l1, { len: len1, total, move: 'idle', face: q.c.root });
        say(q, l2, { len: len2, from: len1 + 0.35, total, move: 'idle', face: p.c.root, voice: false });
        pairCool.set(key, t + GREET_AGAIN);
        greetGap = GREET_GAP + total;
        return;
      }
    }
  }
  function endReaction(n) {
    n.c.lookAt(null);
    n.c.setPace(1);
    if (n.bubble) n.bubble.hidden = true;
    if (n.voice) speaking = Math.max(0, speaking - 1);
    n.face = null;
    n.on = false;
    n.cool = NOTICE_AGAIN;
    n.armed = false;
    n.back = 0.8;
    n.yaw = n.c.root.rotation.y;
    n.resume();
  }
  // A bubble over a head, kept clear of the compass and the map up top (on a phone the map sits over the
  // stage): it steps aside, its tail still at the head, or below if there is no room beside.
  let hud = null;
  let hudAt = 0;
  function placeClear(n, el, x, y, dt) {
    // Never off the top of the screen (a Chog right by the camera has its head up there).
    y = Math.max(y, el.offsetHeight + 10);
    // (The compass, the map, the title, Sign in and your Chog's panel; looked up again now and then, as
    // they come and go.)
    if (!hud || t - hudAt > 2) (hud = [...document.querySelectorAll('.tv-compass, .tv-map, .hud.top-left, #btn-signin, #chog-chip, #chog-chip .cel-acts, .pl-row, .tv-zoom, .pl-qpill')]), (hudAt = t);
    const half = el.offsetWidth / 2, h = el.offsetHeight;
    let cx = Math.min(Math.max(x, half + 8), window.innerWidth - half - 8);
    for (const box of hud) {
      const r = box.getBoundingClientRect();
      if (!r.width || y - h > r.bottom + 4 || y < r.top || cx + half < r.left - 4 || cx - half > r.right + 4) continue;
      if (r.left - half - 6 >= half + 8 && x < r.right) cx = r.left - half - 6;
      else if (r.right + half + 6 <= window.innerWidth - half - 8) cx = r.right + half + 6;
      else y = r.bottom + h + 6;
    }
    // It glides after the head rather than jump with every step, and pops in.
    if (n.sx == null) (n.sx = cx), (n.sy = y), (n.tx = x);
    const k = 1 - Math.exp(-dt * 10);
    n.sx += (cx - n.sx) * k;
    n.sy += (y - n.sy) * k;
    n.tx += (x - n.tx) * k;
    const pop = Math.min(1, Math.max(0, n.age - (n.from ?? 0)) / 0.35);
    const s = 0.82 + 0.18 * (1 + 2.2 * Math.pow(pop - 1, 3) + 1.2 * Math.pow(pop - 1, 2));
    el.style.setProperty('--tail', `${Math.max(-half + 18, Math.min(half - 18, n.tx - n.sx))}px`);
    el.style.transform = `translate(-50%, -100%) translate(${n.sx}px, ${n.sy}px) scale(${s.toFixed(3)})`;
    el.style.transformOrigin = '50% 100%';
  }
  function notice(n, dt, me, camera) {
    const c = n.c;
    n.cool -= dt;
    if (!n.on) {
      // Back from the reaction: turn the way its routine wants (a stroller's path, or the way it stood).
      if (n.back > 0) {
        n.back -= dt;
        n.yaw = angleLerp(n.yaw, n.steer ? c.root.rotation.y : n.yaw0, 1 - Math.exp(-dt * 6));
        c.root.rotation.y = n.yaw;
      }
      if (!me || !c.root.visible || c.root.userData.away) return;
      c.root.getWorldPosition(_a);
      me.getWorldPosition(_b);
      const far = _a.distanceTo(_b);
      if (!n.armed) {
        n.armed = far > n.rearm && n.cool <= 0;
        return;
      }
      if (n.cool > 0 || far > n.near || Math.abs(_a.y - _b.y) > 3) {
        n.wait = 0;
        return;
      }
      if (n.ahead > -1) {
        c.root.parent.worldToLocal(_b);
        _b.sub(c.root.position).setY(0).normalize();
        if (_b.x * Math.sin(c.root.rotation.y) + _b.z * Math.cos(c.root.rotation.y) < n.ahead) return;
      }
      // Only one you can see: one off screen would hold the voice while you can't see it.
      if (camera) {
        c.root.localToWorld(_a.set(0, CHOG_HEIGHT * 0.6, 0)).project(camera);
        if (_a.z > 1 || Math.abs(_a.x) > 0.85 || Math.abs(_a.y) > 0.9) return;
      }
      // Noticed: a beat later (so a few who see you at once don't all move as one), and only while a voice
      // is free.
      if (!n.wait) n.wait = 0.15 + Math.random() * 0.7;
      if ((n.wait -= dt) > 0 || speaking >= VOICES) return;
      n.wait = 0;
      n.on = true;
      n.yaw0 = c.root.rotation.y;
      react(n);
    }
    // Turn to whom it talks to (the camera, or another Chog), about its own middle.
    const to = n.face ? n.face.getWorldPosition(_b) : camera ? _b.copy(camera.position) : null;
    if (to && c.root.parent) {
      c.root.parent.worldToLocal(to);
      const want = Math.atan2(to.x - c.root.position.x, to.z - c.root.position.z);
      c.root.rotation.y = angleLerp(c.root.rotation.y, want, 1 - Math.exp(-dt * 5));
    }
    n.age += dt;
    if (!n.talked && n.age >= n.from) {
      n.talked = true;
      c.talk(Math.min(n.to - n.from - 1, 0.6 + n.line.length * 0.06));
    }
    // Waved enough: it stands and talks on, still facing you.
    if (n.waving > 0 && (n.waving -= dt) <= 0) c.play('idle');
    bubbleTick(n, dt, camera, c.root);
    if ((n.left -= dt) > 0) return;
    endReaction(n);
  }

  // A set: where it is (for the distance check), and how to build it.
  const set = (where, build) => sets.push({ where, build, state: 'waiting' });
  const shown = async (group, chogs) => {
    await prewarm?.(group);
    return chogs;
  };

  // ---------- the plaza ----------
  const s = NPC_SLOTS.singer;
  const square = new THREE.Group();
  plaza.add(square);
  square.position.set(s.plaza[0], 0, s.plaza[1]);
  // The stage lights' shaders, drawn once now in the load, so the plaza's first showing doesn't stall
  // on them (B12). The real ones come with the set; these are let go of (their shaders stay built).
  {
    const warm = stageLights(0);
    square.add(warm.group);
    await prewarm?.(warm.group);
    square.remove(warm.group);
  }
  square.scale.setScalar(OUTDOOR);
  const facing = Math.atan2(s.faces[0] - s.plaza[0], s.faces[1] - s.plaza[1]);
  set(
    (v) => square.getWorldPosition(v),
    async () => {
      const chogs = [];
      const ticks = [];
      // The singer, on its stage disc (in the same file: when the singer turns to you, the disc stays put).
      const singer = await singerNpc(s.glb);
      singer.root.rotation.y = facing;
      square.add(singer.root);
      chogs.push(singer);
      const disc = singer.root.getObjectByName('Stage');
      // Its fairy lights, spotlight and notes.
      const lights = stageLights(facing);
      square.add(lights.group);
      ticks.push((dt) => lights.update(dt, singer.state === 'sing', lastEnv, lastRenderer));
      let part = 0;
      let left = SET[0][1];
      singer.play(SET[0][0]);
      let songTime = 0;
      // Who the song playing now is for (it looks at them through it).
      let forYou = false;
      if (stageFx?.createStageFx) {
        const fx = stageFx.createStageFx({ facing, quality });
        square.add(fx.group);
        ticks.push((dt) => fx.update(dt, { singing: singer.state === 'sing', songTime, part: SET[part][0], env: lastEnv, renderer: lastRenderer }));
      }
      ticks.push(() => disc && (disc.rotation.y = facing - singer.root.rotation.y));
      ticks.push(own(singer, (dt) => {
        left -= dt;
        songTime += dt;
        if (left > 0) return;
        if (SET[(part + 1) % SET.length][0] === 'sing') songTime = 0;
        part = (part + 1) % SET.length;
        left = SET[part][1];
        singer.play(SET[part][0]);
        if (forYou) singer.lookAt(null), (forYou = false);
      }, {
        who: LYRA,
        // The dedicated song, from the top.
        resume: () => {
          part = 0;
          left = SET[0][1];
          songTime = 0;
          singer.play(SET[0][0]);
          singer.lookAt(null);
          forYou = true;
        },
      }));
      // The crowd, in an arc in front of the stage, watching and cheering.
      const plain = quality === 'low' ? 3 : 5;
      const plainOnes = Array.from({ length: plain }, (_, i) => ({ glb: NPC_SLOTS.crowd.plain, tint: new THREE.Color(SHADES[i % SHADES.length]) }));
      // The user's pick (10-16): three of the plain Chogs swapped for the bar's regulars, so the crowd is
      // Chogs of its own. ?crowd=plain or skins for comparison.
      const crowdLook = new URLSearchParams(location.search).get('crowd') ?? 'cast';
      if (crowdLook === 'skins' || crowdLook === 'cast') {
        const skins = ['#f7cdd6', '#8fb6ef', '#93d48c', '#f2d56b', '#e0705f'];
        for (let i = 0; i < plain; i++) plainOnes[i].tint = new THREE.Color('#ffffff').lerp(new THREE.Color(skins[i % skins.length]), 0.7);
      }
      // (Snooze and Toasty stood here too until they each had a place of their own, 10-23. Puff, the
      // cast's own fan, is in the middle of the front row.)
      const who = [...NPC_SLOTS.crowd.named, ...plainOnes];
      const crowd = await Promise.all(who.map((w) => npc(w.glb, w.id ?? null, w.tint ?? null)));
      const spots = [0.5, -0.5, 0.95, -0.95, 1.4, -1.4, 1.8].slice(0, crowd.length);
      crowd.forEach((c, i) => {
        const a = facing + spots[i];
        const r = 4.1 + (i % 2) * 0.5;
        c.root.position.set(Math.sin(a) * r, 0, Math.cos(a) * r);
        c.root.rotation.y = a + Math.PI;
        c.root.scale.setScalar(0.94 + ((i * 37) % 11) / 100);
        // A spectator's shadow is barely seen under the others; on the laptop's settings, skip them.
        if (quality === 'low') c.root.traverse((o) => o.isMesh && (o.castShadow = false));
        square.add(c.root);
        chogs.push(c);
        ticks.push(own(c, idler(c, ['cheer'], [6, 14])));
      });
      // King Pom on his throne, Quackers in his flower arch (the user, 10-23), each facing the fountain.
      const props = [];
      for (const w of NPC_SLOTS.courtiers) {
        const spot = new THREE.Group();
        spot.position.set(w.at[0], 0, w.at[1]);
        spot.rotation.y = Math.atan2(FOUNTAIN.x - w.at[0], FOUNTAIN.z - w.at[1]);
        spot.scale.setScalar(OUTDOOR);
        const prop = w.prop === 'throne' ? throne() : flowerArch();
        prop.traverse((o) => o.isMesh && (o.receiveShadow = true));
        spot.add(prop);
        plaza.add(spot);
        props.push(spot);
        const c = await npc(w.glb, w.id);
        // On the dais (its top is 0.4 up), or under the arch.
        c.root.position.set(0, w.prop === 'throne' ? 0.4 : 0, w.prop === 'throne' ? 0.15 : 0.2);
        spot.add(c.root);
        chogs.push(c);
        ticks.push(own(c, idler(c, w.moves, w.every)));
      }
      // By the lobby door, greeting whoever comes up the walk.
      const d = NPC_SLOTS.doorman;
      const doorman = await npc(d.glb, d.id);
      doorman.root.scale.setScalar(OUTDOOR);
      doorman.root.position.set(d.plaza[0], 0, d.plaza[1]);
      doorman.root.rotation.y = Math.atan2(FOUNTAIN.x - d.plaza[0], FOUNTAIN.z - d.plaza[1]);
      plaza.add(doorman.root);
      chogs.push(doorman);
      doorman.play('idle');
      ticks.push(own(doorman, () => {}));
      await prewarm?.(plaza);
      return { group: square, chogs, tick: (tt, dt) => ticks.forEach((f) => f(dt)), extra: [...props, doorman.root], solid: props };
    },
  );

  // ---------- Petal (#271), among the flowers on the tree island ----------
  const hood0 = HOODS[NPC_SLOTS.gardener.hood];
  const patch = new THREE.Group();
  patch.position.copy(openSpot(hood0, hood0.angle + Math.PI + 0.9));
  // Facing across the island.
  patch.rotation.y = Math.atan2(hood0.x - patch.position.x, hood0.z - patch.position.z);
  patch.scale.setScalar(OUTDOOR);
  scene.add(patch);
  set(
    (v) => patch.getWorldPosition(v),
    async () => {
      const g = NPC_SLOTS.gardener;
      const petal = await npc(g.glb, g.id);
      patch.add(petal.root);
      // Standing about the flowers, now and then a happy little jump.
      const tick = own(petal, idler(petal, ['cheer'], [10, 18]));
      return { group: patch, chogs: await shown(patch, [petal]), tick: (tt, dt) => tick(dt) };
    },
  );

  // ---------- Snooze (#124), napping at the foot of the giant tree ----------
  const nap = NPC_SLOTS.napper;
  const napHood = HOODS[nap.hood];
  const nest = new THREE.Group();
  {
    // Toward downtown from the tree, so he's the first thing you see coming up from the bridge.
    const a = napHood.angle + Math.PI + 0.35;
    const x = napHood.x + Math.cos(a) * nap.r, z = napHood.z + Math.sin(a) * nap.r;
    nest.position.set(x, surfaceAt(x, z), z);
    nest.rotation.y = Math.atan2(-Math.cos(a), -Math.sin(a)) + Math.PI;
  }
  nest.scale.setScalar(OUTDOOR);
  scene.add(nest);
  set(
    (v) => nest.getWorldPosition(v),
    async () => {
      const snooze = await npc(nap.glb, nap.id);
      nest.add(snooze.root);
      // Eyes shut, breathing slowly; he wakes for you and dozes off again after.
      const doze = () => (snooze.play('sleepy'), snooze.setPace(0.6));
      doze();
      const tick = own(snooze, () => {}, { resume: doze });
      return { group: nest, chogs: await shown(nest, [snooze]), tick: (tt, dt) => tick(tt, dt) };
    },
  );

  // ---------- Toasty (#52), at his campfire on the beacon island (the user, 10-23) ----------
  const st = NPC_SLOTS.storyteller;
  const fireSpot = new THREE.Group();
  fireSpot.position.set(st.at[0], surfaceAt(st.at[0], st.at[1]), st.at[1]);
  fireSpot.scale.setScalar(OUTDOOR);
  scene.add(fireSpot);
  // (The fire is there from the start: it glows across the island after dark.)
  const fire = campfire();
  fireSpot.add(fire.group);
  set(
    (v) => fireSpot.getWorldPosition(v),
    async () => {
      const toasty = await npc(st.glb, st.id);
      // Across the fire from its two log seats, facing them: a story for whoever sits down.
      toasty.root.position.set(Math.cos(-1.55) * 2.1, 0, Math.sin(-1.55) * 2.1);
      toasty.root.rotation.y = Math.atan2(-toasty.root.position.x, -toasty.root.position.z);
      fireSpot.add(toasty.root);
      const tell = idler(toasty, ['talk', 'talk', 'wave'], [3, 6]);
      const tick = own(toasty, tell);
      return {
        group: fireSpot,
        chogs: await shown(fireSpot, [toasty]),
        solid: [fire.group],
        tick: (tt, dt) => {
          fire.update(dt, lastEnv?.night ?? 0);
          tick(dt);
        },
      };
    },
  );

  // ---------- Dash (#471), laps of the beacon bridge (the user, 10-23: a place of his own) ----------
  const br2 = (bridges ?? [])[NPC_SLOTS.runner.hood];
  const lap = new THREE.Group();
  scene.add(lap);
  // Along its deck, end to end (a step short of each end).
  const U0 = 0.07, U1 = 0.93;
  let runU = 0.5;
  const lapAt = (u, v = new THREE.Vector3()) => v.set(br2.ax + (br2.bx - br2.ax) * u, br2.deckY(u) + 0.15, br2.az + (br2.bz - br2.az) * u);
  if (br2)
    set(
      (v) => lapAt(runU, v),
      async () => {
        const r = NPC_SLOTS.runner;
        const dash = await npc(r.glb, r.id);
        dash.root.scale.setScalar(OUTDOOR);
        lap.add(dash.root);
        // Its run at the speed its legs carry it (else its feet slide): up to speed, down to a stop near the
        // end, a breather, then he turns and runs back.
        const top = (dash.speedOf('run') || 3) * OUTDOOR;
        const len = br2.len;
        const along = Math.atan2(br2.bx - br2.ax, br2.bz - br2.az);
        let speed = 0;
        let dir = 1;
        let yaw = along;
        let mode = 'run';
        let left = 0;
        dash.play('run');
        const p = new THREE.Vector3();
        const step = (tt, dt) => {
          const room = (dir > 0 ? U1 - runU : runU - U0) * len;
          if (mode === 'run' && room < (speed * speed) / 10 + 0.6) mode = 'stop';
          else if (mode === 'stop' && speed < 0.15) {
            mode = 'rest';
            left = 1.8 + Math.random() * 2.2;
            dash.play(Math.random() < 0.4 ? 'cheer' : 'idle');
          } else if (mode === 'rest' && (left -= dt) <= 0) {
            dir = -dir;
            mode = 'run';
            dash.play('run');
          }
          const want = mode === 'run' ? top : 0;
          speed += (want - speed) * (1 - Math.exp(-dt * (mode === 'stop' ? 5 : 2.2)));
          runU = THREE.MathUtils.clamp(runU + (dt * speed * dir) / len, U0, U1);
          dash.setPace(mode === 'rest' ? 1 : THREE.MathUtils.clamp(speed / top, 0.35, 1.15));
          dash.root.position.copy(lapAt(runU, p));
          // Facing the way it's going; turning back takes about half a second.
          yaw = angleLerp(yaw, along + (dir < 0 ? Math.PI : 0), 1 - Math.exp(-dt * 7));
          dash.root.rotation.y = yaw;
        };
        step(0, 0);
        // It notices you and greets the others like the cast; its run waits while it does.
        const tick = own(dash, step, { steer: true, resume: () => dash.play(mode === 'rest' ? 'idle' : 'run') });
        return {
          group: lap,
          chogs: await shown(lap, [dash]),
          where: (v) => lapAt(runU, v),
          tick: (tt, dt) => tick(tt, dt),
        };
      },
    );

  // ---------- Patrol on his hover chopper, riding round the islands (B, src/rider.js; the user 10-19) ----------
  // The ride's ground: a bridge's deck where it crosses one, else the walking surface.
  const rideGround = (x, z) => {
    for (const br of bridges ?? []) {
      const ux = (br.bx - br.ax) / br.len, uz = (br.bz - br.az) / br.len;
      const along = (x - br.ax) * ux + (z - br.az) * uz;
      if (along < 0 || along > br.len) continue;
      if (Math.abs((x - br.ax) * -uz + (z - br.az) * ux) < br.width / 2) return br.deckY(along / br.len) + 0.15;
    }
    return surfaceAt(x, z);
  };
  const rideStart = new THREE.Vector3(Math.cos(2.5) * (DOWNTOWN.r + 2.5), 0, Math.sin(2.5) * (DOWNTOWN.r + 2.5));
  let rider = null;
  const meAt = new THREE.Vector3();
  // What Patrol keeps clear of, near him: your Chog (and the board under it), the hoverboards, the cast.
  const around = [];
  const aroundRider = () => {
    around.length = 0;
    const at = rider.group.position;
    const add = (x, z, r) => (x - at.x) ** 2 + (z - at.z) ** 2 < 400 && around.push({ x, z, r });
    if (lastMe) {
      lastMe.getWorldPosition(meAt);
      add(meAt.x, meAt.z, lastBoards?.some((b) => !b.parked) ? 1.7 : 1.1);
    }
    for (const b of lastBoards ?? []) if (b.parked) add(b.x, b.z, 1.5);
    for (const a of actors) {
      if (!a.group.visible) continue;
      for (const c of a.chogs) if (c.root.visible && c !== rider.chog) (c.root.getWorldPosition(wp), add(wp.x, wp.z, 1.0));
    }
    return around;
  };
  let riderSet = null;
  set(
    (v) => (rider ? v.copy(rider.group.position) : v.copy(rideStart)),
    async () => {
      const chog = await npc(M('chog-56'), 56);
      chog.root.scale.setScalar(OUTDOOR);
      rider = createRider({ chog, groundAt: rideGround });
      scene.add(rider.group);
      await shown(rider.group, [chog]);
      return {
        group: rider.group,
        // Its own clip and pose each frame (rider.update), so none for the cast's loop to move; solid for
        // your Chog to bump into all the same.
        chogs: [],
        solid: [chog.root],
        where: (v) => v.copy(rider.group.position),
        tick: (tt, dt) => {
          rider.group.visible = !away.has(56);
          rider.update(dt, lastEnv, lastCamera, aroundRider());
        },
      };
    },
  );

  riderSet = sets.at(-1);

  // Build a set the first time it is near: fetched, compiled, then shown.
  function load(st) {
    st.state = 'loading';
    st.build()
      .then((a) => {
        st.state = 'ready';
        actors.push(a);
        applyAway();
      })
      .catch((err) => {
        st.state = 'failed';
        console.warn('Chogs about town:', err?.message ?? err);
      });
  }
  if (standees) sets.forEach(load);

  // A Chog a guest is walking as stays out of the crowd meanwhile (one of each).
  const away = new Set();
  const applyAway = () => {
    for (const a of actors) for (const c of a.chogs) if (c.root.userData.chogId) c.root.userData.away = away.has(c.root.userData.chogId);
  };
  return {
    actors,
    setAway(id, on) {
      if (on) away.add(id);
      else away.delete(id);
      applyAway();
    },
    /** Every Chog about town that's showing (their roots), for walking round them. */
    roots() {
      return actors.flatMap((a) => (a.group.visible ? [...a.chogs.map((c) => c.root), ...(a.solid ?? [])] : []));
    },
    // Patrol on his chopper (src/rider.js), for a race (src/race.js): resolves with him, loading him first
    // if he hasn't been near yet; null if he can't come (a guest is walking as him).
    async patrol() {
      if (away.has(56)) return null;
      if (riderSet.state === 'waiting') load(riderSet);
      for (let i = 0; i < 600 && riderSet.state !== 'ready' && riderSet.state !== 'failed'; i++) await new Promise((r) => setTimeout(r, 50));
      return riderSet.state === 'ready' ? rider : null;
    },
    // A set still loading: the demo's shots wait for them all (B13).
    get loading() {
      return sets.some((st) => st.state === 'loading');
    },
    // me: the Chog you walk as (its root), or null when you're not out walking.
    // boards: the hoverboards (src/travel.js), for Patrol to keep clear of.
    update(dt, camera, env = null, renderer = null, me = null, boards = null) {
      lastBoards = boards;
      t += dt;
      lastEnv = env;
      lastRenderer = renderer;
      if (!sets.some((st) => st.state === 'loading')) {
        let nearest = null;
        let best = LOAD;
        for (const st of sets) {
          if (st.state !== 'waiting') continue;
          st.where(wp);
          const d = camera.position.distanceTo(wp);
          if (d < best) {
            best = d;
            nearest = st;
          }
        }
        if (nearest) load(nearest);
      }
      for (const a of actors) {
        if (a.where) a.where(wp);
        else a.group.getWorldPosition(wp);
        const near = camera.position.distanceTo(wp) < NEAR;
        a.group.visible = near;
        for (const r of a.extra ?? []) r.visible = near;
        for (const c of a.chogs) if (c.root.userData.away !== undefined) c.root.visible = !c.root.userData.away && (near || !a.extra?.includes(c.root));
        if (!near) continue;
        a.tick?.(t, dt);
        for (const c of a.chogs) {
          c.update(dt, camera);
          // A Chog right against the lens (the camera settling behind you out of a door, by the steps
          // where one stands) leaves the picture instead of filling it with one blurry ear: A, 10-21.
          const close = c.root.visible && c.root.getWorldPosition(cp).distanceTo(camera.position) < 1.5;
          if (close !== !!c.root.userData.atLens) {
            c.root.userData.atLens = close;
            c.setFade?.(close ? 0 : 1);
          }
        }
      }
      lastCamera = camera;
      lastMe = me;
      for (const n of noticers) if (n.c.root.parent && (n.on || n.back > 0 || me)) notice(n, dt, me, camera);
      greetTick(dt, camera);
      mineTick(dt, camera);
    },
  };
}
