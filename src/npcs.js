import * as THREE from 'three';
import { makeChog, CHOG_HEIGHT } from './chog.js';
import { placeBubble } from './chat.js';
import { surfaceAt } from './travel.js';
import { chogInfo } from './chogdata.js';
import { HOODS, roadDistance, nearDome } from './layout.js';
import { islandAt } from './terrain.js';
import { angleLerp } from './util.js';

/*
 * The Chogs who live round the world, in a few sets, each loaded only once the camera comes near it
 * (the files are about 2 MB each, so none of them is in the first load) and compiled before it shows.
 *
 *   plaza    the singer on their stage with a crowd watching, two Chogs strolling round the fountain,
 *            and one by the lobby door
 *   sniffer  out on the tree island, nose in its flowers
 *   runner   the dino lapping the loop on the beacon island with a toy block over its head
 *   walker   an astronaut walking the loop on the middle island
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
  crowd: { plain: M('plain'), named: [{ id: 132, glb: M('chog-132') }, { id: 37, glb: M('chog-37') }] },
  // Strolling round the fountain, the opposite ways.
  strollers: [
    { id: 66, glb: M('chog-66'), speed: 1.7, dir: 1, phase: 0, r: 13.2 },
    { id: 409, glb: M('chog-409'), speed: 1.3, dir: -1, phase: 2.6, r: 15.4 },
  ],
  // By the lobby door, in the Monad look.
  doorman: { id: 1151, glb: M('chog-1151'), plaza: [-5.2, 23.2] },
  sniffer: { glb: M('sniffer'), hood: 0 },
  runner: { glb: M('dino'), hood: 2, speed: 0.22 },
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
function idler(chog, moves = ['wave'], every = [9, 16]) {
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

// A toy block: a chunky cube, a different colour on each face.
function toyBlock() {
  const mats = ['#e8484f', '#4f7fe0', '#f2c94c', '#5fbf6a', '#b07cf0', '#f08a3a'].map((c) => new THREE.MeshLambertMaterial({ color: c }));
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.45), mats);
  m.castShadow = true;
  return m;
}

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
  1151: { name: 'Monty', face: 'excited', pace: 1.15, lines: ['Welcome to Chog Hub! The lobby is right behind me.', 'Hey! Fastest chain, friendliest door.', 'Good to see you. Purple suits this place, right?', 'Monad never sleeps, and neither do I.'] },
  409: { name: 'King Pom', face: 'happy', pace: 0.85, lines: ['Ah, a visitor. You may approach.', 'Bow if you like. I am not fussy. I am a little fussy.', 'The plaza is mine, but you may borrow it.', 'Mind the crown. It is heavier than it looks.'] },
  68: { name: 'Cosmo', face: 'curious', pace: 1, lines: ['New lifeform spotted. Friendly. Logging it.', 'Coordinates noted. You are right where you should be.', 'I mapped this island twice. You are my favourite landmark.', 'Hello from orbit. Well, from the walkway.'] },
  124: { name: 'Snooze', face: 'sleepy', pace: 0.6, lines: ['Mmh? Oh, hi. Welcome...', 'Just resting my eyes. Nice to meet you.', 'You look lovely today. Sorry, I am so sleepy.'] },
  132: { name: 'Peel', face: 'excited', pace: 1.35, lines: ['You are a-peeling already!', 'Let us go bananas!', 'This crowd is ripe for a party!', 'Careful, I hear it is a long slip from here.'] },
  37: { name: 'Puff', face: 'happy', pace: 1.1, lines: ['This song gets me every time.', 'Oh, hi! Do not mind me, happy tears.', 'You came! Group hug later?'] },
  56: { name: 'Patrol', face: 'happy', pace: 0.85, lines: ['Afternoon. Please enjoy the plaza responsibly.', 'All clear here. Have a lovely day.', 'Pardon me. Just keeping an eye out.'] },
  66: { name: 'Quackers', face: 'excited', pace: 1.2, lines: ['Love the look. Mine is better, but love it.', 'Duck float? Iconic. Thanks for noticing.', 'Strike a pose with me. Quick!'] },
  52: { name: 'Toasty', face: 'happy', pace: 1, lines: ['Did I ever tell you about the coldest night on these islands?', 'Brr. Sit down, I have a story for you.', 'You look warm. Stand a little closer, friend.'] },
};
// Lyra, the singer: spots you joining the crowd, holds the mic out to you and dedicates the next song (it
// starts again from the top). From in front of the stage only.
const LYRA = { name: 'Lyra', face: 'excited', lines: ["This next one's for you!", 'Hey you! This one is yours.', 'Glad you made it. Here we go!'], near: 10, ahead: 0.2, rearm: 16, move: 'sing', reach: true };
// At most this many lines show at once; the next waits its turn.
const VOICES = 2;

/**
 * The sets, each built the first time the camera comes near (or at once with standees: show every
 * slot, ?npcs). plaza is the plaza group (its origin is the square's). quality 'low' has a smaller crowd.
 * prewarm(obj) compiles a set's shaders before it shows.
 */
export async function buildNpcs({ scene, plaza, standees = false, prewarm, quality = 'high' }) {
  const actors = [];
  const sets = [];
  // The light of the moment (night, the canvas), for the stage's bulbs.
  let lastEnv = null;
  let lastRenderer = null;
  const wp = new THREE.Vector3();
  let t = 0;

  // ---------- noticing you ----------
  const noticers = [];
  const _a = new THREE.Vector3();
  const _b = new THREE.Vector3();
  let speaking = 0;
  let lastCamera = null;
  // Your Chog (while you walk one), for the strollers to wait for.
  let lastMe = null;
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
    el.innerHTML = '<span class="who"></span><span class="line"></span>';
    el.firstChild.textContent = n.who.name;
    document.body.append(el);
    return (n.bubble = el);
  }
  // Turn to the camera, wave (the singer: her mic held out) and say a line.
  function react(n) {
    const { c, who } = n;
    const pool = who.lines;
    let i = Math.floor(Math.random() * pool.length);
    if (pool.length > 1 && i === n.said) i = (i + 1) % pool.length;
    n.said = i;
    const line = pool[i];
    n.left = THREE.MathUtils.clamp(1.4 + line.length * 0.05, 2.6, 4.4);
    c.play(who.move ?? 'wave');
    c.setPace(who.pace ?? 1);
    c.express(who.face, n.left + 0.4);
    c.talk(Math.min(n.left - 0.4, 0.3 + line.length * 0.055));
    c.lookAt(null);
    if (who.reach && lastCamera) c.reach(lastCamera, n.left);
    const el = bubbleFor(n);
    el.lastChild.textContent = line;
    el.hidden = false;
    el.style.opacity = '0';
    speaking++;
  }
  function endReaction(n) {
    n.c.lookAt(null);
    n.c.setPace(1);
    if (n.bubble) n.bubble.hidden = true;
    speaking = Math.max(0, speaking - 1);
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
  function placeClear(el, x, y) {
    // Never off the top of the screen (a Chog right by the camera has its head up there).
    y = Math.max(y, el.offsetHeight + 10);
    placeBubble(el, x, y);
    if (!hud?.length) hud = [...document.querySelectorAll('.tv-compass, .tv-map')];
    const half = el.offsetWidth / 2, h = el.offsetHeight;
    let cx = Math.min(Math.max(x, half + 8), window.innerWidth - half - 8);
    let moved = false;
    for (const box of hud) {
      const r = box.getBoundingClientRect();
      if (!r.width || y - h > r.bottom + 4 || y < r.top || cx + half < r.left - 4 || cx - half > r.right + 4) continue;
      moved = true;
      if (r.left - half - 6 >= half + 8 && x < r.right) cx = r.left - half - 6;
      else if (r.right + half + 6 <= window.innerWidth - half - 8) cx = r.right + half + 6;
      else y = r.bottom + h + 6;
    }
    if (!moved) return;
    el.style.setProperty('--tail', `${Math.max(-half + 18, Math.min(half - 18, x - cx))}px`);
    el.style.transform = `translate(-50%, -100%) translate(${cx}px, ${y}px)`;
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
      // Noticed: a beat later (so a few who see you at once don't all move as one), and only while a voice
      // is free.
      if (!n.wait) n.wait = 0.15 + Math.random() * 0.7;
      if ((n.wait -= dt) > 0 || speaking >= VOICES) return;
      n.wait = 0;
      n.on = true;
      n.yaw0 = c.root.rotation.y;
      react(n);
    }
    // Turn to the camera, about its own middle.
    if (camera && c.root.parent) {
      c.root.parent.worldToLocal(_b.copy(camera.position));
      const want = Math.atan2(_b.x - c.root.position.x, _b.z - c.root.position.z);
      c.root.rotation.y = angleLerp(c.root.rotation.y, want, 1 - Math.exp(-dt * 5));
    }
    const el = n.bubble;
    if (el && !el.hidden && camera) {
      c.root.localToWorld(_a.set(0, CHOG_HEIGHT + 0.7, 0));
      _a.project(camera);
      const shown = _a.z < 1 && Math.abs(_a.x) < 1.2 && Math.abs(_a.y) < 1.2;
      el.style.opacity = shown ? '1' : '0';
      if (shown) placeClear(el, ((_a.x + 1) / 2) * window.innerWidth, ((1 - _a.y) / 2) * window.innerHeight);
    }
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
      const who = [
        ...Array.from({ length: plain }, (_, i) => ({ glb: NPC_SLOTS.crowd.plain, tint: new THREE.Color(SHADES[i % SHADES.length]) })),
        ...NPC_SLOTS.crowd.named,
      ];
      // The user's pick (10-16): three of the plain Chogs swapped for the bar's regulars, so the crowd is
      // Chogs of its own. ?crowd=plain or skins for comparison.
      const crowdLook = new URLSearchParams(location.search).get('crowd') ?? 'cast';
      if (crowdLook === 'skins' || crowdLook === 'cast') {
        const skins = ['#f7cdd6', '#8fb6ef', '#93d48c', '#f2d56b', '#e0705f'];
        for (let i = 0; i < plain; i++) who[i].tint = new THREE.Color('#ffffff').lerp(new THREE.Color(skins[i % skins.length]), 0.7);
        if (crowdLook === 'cast') [124, 52, 56].slice(0, plain - 2).forEach((id, i) => (who[i] = { glb: M(`chog-${id}`), id }));
      }
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
      // Strolling round the fountain, now and then stopping to wave.
      for (const w of NPC_SLOTS.strollers) {
        const c = await npc(w.glb, w.id);
        c.root.scale.setScalar(OUTDOOR);
        plaza.add(c.root);
        chogs.push(c);
        // Walk at the pace its legs move (plaza space: the plaza group is at world scale).
        const pace = (c.speedOf('walk') || w.speed) * OUTDOOR;
        const legs = c.paceFor('walk');
        let angle = w.phase;
        let pause = 0;
        let next = 14 + Math.random() * 10;
        let held = false;
        c.play('walk');
        c.setPace(legs);
        ticks.push(own(c, (dt) => {
          if (pause > 0) {
            pause -= dt;
            if (pause <= 0) c.play('walk'), c.setPace(legs);
            return;
          }
          next -= dt;
          if (next <= 0) {
            // A moment's stop to look round.
            pause = 2.6;
            next = 16 + Math.random() * 12;
            c.play('idle');
            return;
          }
          // Someone in the way (you): it waits rather than walk through.
          const ahead = angle + (dt * pace * w.dir) / w.r + (2.4 * w.dir) / w.r;
          wp.set(FOUNTAIN.x + Math.sin(ahead) * w.r, 0, FOUNTAIN.z + Math.cos(ahead) * w.r);
          plaza.localToWorld(wp);
          const blocked = lastMe && lastMe.getWorldPosition(_b).setY(wp.y).distanceTo(wp) < 2.6;
          if (blocked !== held) {
            held = blocked;
            if (held) c.play('idle');
            else c.play('walk'), c.setPace(legs);
          }
          if (held) return;
          angle += (dt * pace * w.dir) / w.r;
          c.root.position.set(FOUNTAIN.x + Math.sin(angle) * w.r, 0, FOUNTAIN.z + Math.cos(angle) * w.r);
          c.root.rotation.y = angle + (w.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
        }, { steer: true, resume: () => (pause > 0 || held ? c.play('idle') : (c.play('walk'), c.setPace(legs))) }));
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
      return { group: square, chogs, tick: (tt, dt) => ticks.forEach((f) => f(dt)), extra: [...chogs.slice(-NPC_SLOTS.strollers.length - 1).map((c) => c.root)] };
    },
  );

  // ---------- the sniffer, at its flowers on the tree island ----------
  const hood0 = HOODS[NPC_SLOTS.sniffer.hood];
  const patch = new THREE.Group();
  patch.position.copy(openSpot(hood0, hood0.angle + Math.PI + 0.9));
  // Its model faces -x, toward its flowers: the group turns it to face across the island.
  patch.rotation.y = Math.atan2(hood0.x - patch.position.x, hood0.z - patch.position.z) + Math.PI / 2;
  patch.scale.setScalar(OUTDOOR);
  scene.add(patch);
  set(
    (v) => patch.getWorldPosition(v),
    async () => {
      const sniffer = await npc(NPC_SLOTS.sniffer.glb);
      patch.add(sniffer.root);
      // Mostly nose in the flowers, now and then a look up.
      let left = 6;
      let up = false;
      sniffer.play('sniff');
      return {
        group: patch,
        chogs: await shown(patch, [sniffer]),
        tick: (tt, dt) => {
          left -= dt;
          if (left > 0) return;
          up = !up;
          sniffer.play(up ? 'idle' : 'sniff');
          left = up ? 3 : 8 + Math.random() * 6;
        },
      };
    },
  );

  // ---------- the dino, lapping the beacon island with its block ----------
  const hood2 = HOODS[NPC_SLOTS.runner.hood];
  const lap = new THREE.Group();
  scene.add(lap);
  const lapAt = (a, hood) => new THREE.Vector3(hood.x + Math.cos(a) * hood.loopR, 0, hood.z + Math.sin(a) * hood.loopR);
  let runAngle = 0;
  set(
    (v) => v.copy(lapAt(runAngle, hood2)),
    async () => {
      const dino = await npc(NPC_SLOTS.runner.glb);
      dino.root.scale.setScalar(OUTDOOR);
      lap.add(dino.root);
      const block = toyBlock();
      dino.root.add(block);
      const head = dino.root.getObjectByName('Head');
      const hp = new THREE.Vector3();
      // Its run at the speed its legs carry it (else its feet slide), easing up to speed and back down,
      // in bursts: run a while, skid to a stop, look about with the block held up, now and then turn and
      // run back the other way.
      const top = (dino.speedOf('run') || 3) * OUTDOOR;
      const R = hood2.loopR;
      let speed = 0;
      let dir = 1;
      let yaw = Math.atan2(-Math.sin(runAngle), Math.cos(runAngle));
      let mode = 'run';
      let left = 7 + Math.random() * 5;
      let lean = 0;
      dino.play('run');
      const step2 = (tt, dt) => {
        left -= dt;
        if (mode === 'run' && left <= 0) (mode = 'stop'), (left = 0.5);
        else if (mode === 'stop' && speed < 0.15) {
          mode = 'rest';
          left = 2.2 + Math.random() * 2.5;
          dino.play('idle');
        } else if (mode === 'rest' && left <= 0) {
          if (Math.random() < 0.35) dir = -dir;
          mode = 'run';
          left = 6 + Math.random() * 7;
          dino.play('run');
        }
        const want = mode === 'run' ? top : 0;
        speed += (want - speed) * (1 - Math.exp(-dt * (mode === 'stop' ? 5 : 2.2)));
        runAngle += (dt * speed * dir) / R;
        dino.setPace(mode === 'rest' ? 1 : THREE.MathUtils.clamp(speed / top, 0.35, 1.15));
        const p = lapAt(runAngle, hood2);
        dino.root.position.set(p.x, surfaceAt(p.x, p.z), p.z);
        // Facing the way it's going; a turn back takes about half a second.
        const heading = Math.atan2(-Math.sin(runAngle), Math.cos(runAngle)) + (dir < 0 ? Math.PI : 0);
        yaw = angleLerp(yaw, heading, 1 - Math.exp(-dt * 7));
        dino.root.rotation.y = yaw;
        // Lean into the curve a little at speed.
        lean += ((speed * speed) / R * 0.02 * dir - lean) * (1 - Math.exp(-dt * 4));
        dino.root.rotation.z = lean;
        // The block rides on its head; held higher, with a little wiggle, while it rests.
        hp.set(0, 1.1, 0);
        if (head) {
          dino.root.updateMatrixWorld();
          dino.root.worldToLocal(head.getWorldPosition(hp));
        }
        const proud = mode === 'rest' ? Math.min(1, 1.5 * (3 - left)) : 0;
        block.position.set(hp.x, hp.y + 1.02 + Math.abs(Math.sin(tt * 9)) * 0.04 * (speed / top) + proud * 0.12, hp.z);
        block.rotation.set(Math.sin(tt * 4.5) * 0.15 * (speed / top), proud * Math.sin(tt * 3) * 0.4, 0);
      };
      step2(0, 0);
      return {
        group: lap,
        chogs: await shown(lap, [dino]),
        where: (v) => v.copy(lapAt(runAngle, hood2)),
        tick: (tt, dt) => step2(tt, dt),
      };
    },
  );

  // ---------- the astronaut, walking the loop on the middle island ----------
  const w = NPC_SLOTS.walker;
  const hood1 = HOODS[w.hood];
  const stroll = new THREE.Group();
  scene.add(stroll);
  let walkAngle = 1.2;
  set(
    (v) => v.copy(lapAt(walkAngle, hood1)),
    async () => {
      const astro = await npc(w.glb, w.id);
      astro.root.scale.setScalar(OUTDOOR);
      stroll.add(astro.root);
      const start = lapAt(walkAngle, hood1);
      astro.root.position.set(start.x, surfaceAt(start.x, start.z), start.z);
      astro.play('walk');
      const pace = (astro.speedOf('walk') || 1) * OUTDOOR;
      astro.setPace(astro.paceFor('walk'));
      let pause = 0;
      let next = 14;
      return {
        group: stroll,
        chogs: await shown(stroll, [astro]),
        where: (v) => v.copy(lapAt(walkAngle, hood1)),
        tick: own(astro, (tt, dt) => {
          if (pause > 0) {
            pause -= dt;
            if (pause <= 0) astro.play('walk'), astro.setPace(astro.paceFor('walk'));
            return;
          }
          if ((next -= dt) <= 0) {
            pause = 2.6;
            next = 18 + Math.random() * 10;
            astro.play('idle');
            return;
          }
          walkAngle += (dt * pace * Math.sign(w.speed)) / hood1.loopR;
          const p = lapAt(walkAngle, hood1);
          astro.root.position.set(p.x, surfaceAt(p.x, p.z), p.z);
          astro.root.rotation.y = Math.atan2(Math.sin(walkAngle), -Math.cos(walkAngle));
        }, { steer: true, resume: () => (pause > 0 ? astro.play('idle') : (astro.play('walk'), astro.setPace(astro.paceFor('walk')))) }),
      };
    },
  );

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
      return actors.flatMap((a) => (a.group.visible ? a.chogs.map((c) => c.root) : []));
    },
    // A set still loading: the demo's shots wait for them all (B13).
    get loading() {
      return sets.some((st) => st.state === 'loading');
    },
    // me: the Chog you walk as (its root), or null when you're not out walking.
    update(dt, camera, env = null, renderer = null, me = null) {
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
        for (const c of a.chogs) c.update(dt, camera);
      }
      lastCamera = camera;
      lastMe = me;
      for (const n of noticers) if (n.c.root.parent && (n.on || n.back > 0 || me)) notice(n, dt, me, camera);
    },
  };
}
