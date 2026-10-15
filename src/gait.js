import * as THREE from 'three';

/*
 * How a Chog moves its body, worked out every frame instead of played from Tripo's clips (A, the user's
 * notes: a T-pose for idle, a bent right arm, a walk where "the land beneath the chog's feet is the one
 * moving"). A Chog's legs are tiny (a twelfth to a sixth of its height), too short to stride, so it walks
 * the way such bodies do, like a penguin: the whole body rocks onto one foot and pivots the other forward,
 * the hips dipping as the feet spread. Every foot stays planted where it lands until it lifts again, at
 * whatever speed the Chog is actually going. Faster, it breaks into a bouncy jog with a little hop each
 * step. At rest it breathes and shifts its weight; the gestures (wave, talk, cheer, sad, sleepy) blend in
 * and out on top.
 *
 * createGait(model, style) -> { update(dt, move) } for a skinned clone in the standard 18-bone rig, facing
 * +z. It reads how fast the model is going from its world position, frame to frame. STYLES gives each of the
 * cast its walk from its approved persona (CAST_STYLE).
 */

const NAMES = ['Root', 'Hips', 'Spine', 'Chest', 'Neck', 'Head', 'UpperArmL', 'ForeArmL', 'HandL', 'UpperArmR', 'ForeArmR', 'HandR', 'ThighL', 'ShinL', 'FootL', 'ThighR', 'ShinR', 'FootR'];

/*
 * A walk's character, each 1 for the neutral walk: bounce (the hop and the rise over each foot), cadence
 * (steps a second), pivot (the penguin turn onto each foot), roll (tipping onto the planted foot), sway
 * (sliding over it), arms (swing), lift (how high a foot comes up), lean (forward into it). And 0 unless set:
 * chest (out, head up), droop (head down), tuck (elbows bent, hands in), out (arms held out), stiff, skip,
 * float (arms resting on a float round the waist).
 */
export const STYLES = {
  neutral: {},
  bouncy: { bounce: 1.6, cadence: 1.15, lift: 1.3, arms: 1.3, pivot: 0.8 },
  stately: { bounce: 0.4, cadence: 0.78, lift: 0.6, arms: 0.4, chest: 1, pivot: 1.2, roll: 0.7, sway: 1.3, lean: 0.2 },
  waddle: { bounce: 0.7, cadence: 0.95, roll: 2.2, sway: 1.8, pivot: 1.5, arms: 0.35, lift: 0.7, float: 1 },
  floaty: { bounce: 1.5, cadence: 0.8, lift: 1.3, arms: 0.7, out: 0.6, lean: 0.4 },
  shuffle: { bounce: 0.3, cadence: 0.92, lift: 0.35, arms: 0.35, droop: 0.7, lean: 0.6, roll: 0.6, pivot: 0.7 },
  steady: { bounce: 0.7, cadence: 0.95, arms: 0.25, tuck: 1, lift: 0.8 },
  stiff: { bounce: 0.5, cadence: 0.92, arms: 0.3, stiff: 1, lift: 0.9, roll: 0.4, sway: 0.6, pivot: 0.6 },
  skip: { bounce: 2, cadence: 1.05, lift: 1.4, arms: 1.4, skip: 1 },
  plod: { bounce: 0.6, cadence: 0.82, lift: 0.75, sway: 1.5, roll: 1.5, pivot: 1.2, arms: 0.7, lean: 0.6 },
  strut: { bounce: 1.1, cadence: 0.9, sway: 1.4, roll: 1.1, chest: 0.7, arms: 0.9 },
};
// The cast, by model file, from their approved personas.
export const CAST_STYLE = {
  'chog-1151': 'bouncy', // Monty: bouncy, quick little steps
  'chog-409': 'stately', // King Pom: slow, chest out, robe swaying
  'chog-66': 'waddle', // Quackers: a little waddle, the float bobbing
  'chog-68': 'floaty', // Cosmo: slow, careful, slightly floaty steps
  'chog-124': 'shuffle', // Snooze: shuffling, unhurried
  'chog-52': 'steady', // Toasty: steady, hands tucked in
  'chog-56': 'stiff', // Patrol: stiff, careful steps
  'chog-132': 'skip', // Peel: bouncy, a little skip
  'chog-37': 'plod', // Puff: plodding
};
const DEF = { bounce: 1, cadence: 1, pivot: 1, roll: 1, sway: 1, arms: 1, lift: 1, lean: 1, chest: 0, droop: 0, tuck: 0, out: 0, stiff: 0, skip: 0, float: 0 };

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const ease = (t) => t * t * (3 - 2 * t);
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const clamp = THREE.MathUtils.clamp;
const GRAVITY = 9.8;

/** Whether a model has the standard rig this drives. */
export function canGait(model) {
  return NAMES.every((n) => model.getObjectByName(n)?.isBone);
}

export function createGait(model, styleName = 'neutral', seed = Math.random()) {
  const S = { ...DEF, ...(STYLES[styleName] ?? {}) };
  const B = {};
  for (const n of NAMES) B[n] = model.getObjectByName(n);
  // The bind pose, in the model's own space: each bone's rotation and its joint's place.
  model.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const bind = {};
  const m4 = new THREE.Matrix4();
  for (const n of NAMES) {
    m4.multiplyMatrices(inv, B[n].matrixWorld);
    const p = new THREE.Vector3(), q = new THREE.Quaternion();
    m4.decompose(p, q, new THREE.Vector3());
    bind[n] = { p, q, iq: q.clone().invert(), lp: B[n].position.clone(), lq: B[n].quaternion.clone() };
  }
  const P = (n) => bind[n].p;
  let height = 0;
  model.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    o.geometry.computeBoundingBox();
    height = Math.max(height, o.geometry.boundingBox.max.y - Math.min(0, o.geometry.boundingBox.min.y));
  });
  height ||= 2.2;
  // Proportions.
  const thighLen = P('ThighL').distanceTo(P('ShinL'));
  const shinLen = P('ShinL').distanceTo(P('FootL'));
  const legLen = thighLen + shinLen;
  const ankleH = P('FootL').y;
  const footSide = Math.abs(P('FootL').x);
  const footZ = (P('FootL').z + P('FootR').z) / 2;
  // How far a foot can sit ahead of or behind its hip with the hips dipping at most a quarter of a leg,
  // and how much further the penguin turn carries it.
  const reach = Math.sqrt(Math.max(1e-6, legLen * legLen - (legLen * 0.72) ** 2));
  const PIVOT = 0.26 * S.pivot;
  const pivotReach = footSide * Math.sin(PIVOT);

  const feet = {};
  for (const k of ['L', 'R']) feet[k] = { side: k === 'L' ? 1 : -1, planted: true, w: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), t: 0, lift: 0 };
  let ready = false;
  let phase = 0;
  let moving = 0;
  let speedS = 0;
  let air = 0; // height of the hop above where the legs would hold the hips, while both feet are up
  let airV = 0;
  let rise = 0;
  let sway = 0;
  let roll = 0;
  let yaw = 0;
  let kappaS = 0.7;
  const vel = new THREE.Vector3();
  const lastPos = new THREE.Vector3();
  const ws = new THREE.Vector3();
  let t = seed * 100;
  const G = { wave: 0, talk: 0, cheer: 0, sad: 0, sleepy: 0 };

  // Scratch.
  const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
  const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
  const cur = {}; // posed model-space rotation of each bone
  const posed = {}; // posed model-space joint of each bone
  const deltas = {}; // each bone's turn from its bind rotation, model space
  for (const n of NAMES) (cur[n] = new THREE.Quaternion()), (posed[n] = new THREE.Vector3()), (deltas[n] = new THREE.Quaternion());
  const qa = (axis, ang) => new THREE.Quaternion().setFromAxisAngle(axis, ang);

  // Pose a bone by a turn (model space) of its bind rotation; its joint follows its parent's.
  function place(n, delta) {
    deltas[n].copy(delta);
    cur[n].multiplyQuaternions(delta, bind[n].q);
    const pn = B[n].parent?.name;
    if (bind[pn]) {
      B[n].quaternion.copy(_q.copy(cur[pn]).invert().multiply(cur[n]));
      posed[n].copy(P(n)).sub(P(pn)).applyQuaternion(deltas[pn]).add(posed[pn]);
    } else B[n].quaternion.copy(cur[n]);
  }
  // Turn a bone so its child's joint lies along dir (model space), starting from where its parent left it.
  function aim(n, child, dir, parentDelta) {
    _v.copy(P(child)).sub(P(n)).applyQuaternion(parentDelta).normalize();
    _q2.setFromUnitVectors(_v, _v2.copy(dir).normalize());
    const d = new THREE.Quaternion().multiplyQuaternions(_q2, parentDelta);
    place(n, d);
    return d;
  }
  // A leg reaching for its ankle target, the knee bending forward.
  function leg(k, ankle) {
    const th = `Thigh${k}`, sh = `Shin${k}`, ft = `Foot${k}`;
    const hip = posed[th];
    const toA = ankle.clone().sub(hip);
    let c = toA.length();
    const maxC = legLen * 0.9995;
    if (c > maxC) toA.multiplyScalar(maxC / c), (c = maxC);
    const a = thighLen, b = shinLen;
    const u = toA.clone().normalize();
    const cosA = clamp((a * a + c * c - b * b) / (2 * a * Math.max(c, 1e-6)), -1, 1);
    const w = Z.clone().sub(u.clone().multiplyScalar(u.z));
    if (w.lengthSq() < 1e-8) w.copy(Y);
    w.normalize();
    const knee = u.clone().multiplyScalar(a * cosA).add(w.multiplyScalar(a * Math.sqrt(1 - cosA * cosA))).add(hip);
    const dTh = aim(th, sh, knee.clone().sub(hip), deltas.Hips);
    aim(sh, ft, toA.clone().add(hip).sub(posed[sh]), dTh);
  }
  const toModel = (w, out) => out.copy(w).applyMatrix4(inv);
  const toWorld = (m, out) => out.copy(m).applyMatrix4(model.matrixWorld);
  // Where a foot belongs under the body (world).
  const neutral = (k, out) => toWorld(_v.set(footSide * feet[k].side, 0, footZ), out);
  function plantAll(groundY) {
    for (const k of ['L', 'R']) {
      neutral(k, feet[k].w);
      feet[k].w.y = groundY;
      feet[k].planted = true;
    }
  }

  return {
    get speed() {
      return speedS;
    },
    debug() {
      const f = (k) => ({ p: toModel(feet[k].w, new THREE.Vector3()).toArray().map((x) => +x.toFixed(3)), down: feet[k].planted });
      return { L: f('L'), R: f('R'), phase: +phase.toFixed(3), speed: +speedS.toFixed(3), height: +height.toFixed(3), air: +air.toFixed(3), kappa: +kappaS.toFixed(2) };
    },
    /** Pose the model for this frame. move: the Chog's state ('idle', 'walk', 'wave', 'talk', ...). */
    update(dt, move) {
      dt = Math.min(dt, 0.05);
      t += dt;
      model.updateWorldMatrix(true, false);
      inv.copy(model.matrixWorld).invert();
      model.getWorldScale(ws);
      const scale = ws.y || 1;
      const here = new THREE.Vector3().setFromMatrixPosition(model.matrixWorld);
      if (!ready) {
        lastPos.copy(here);
        plantAll(here.y);
        ready = true;
      }
      // How fast it's going (its own units a second, smoothed), against its own height.
      const stepW = here.clone().sub(lastPos);
      lastPos.copy(here);
      if (stepW.lengthSq() > (3 * scale) ** 2) {
        plantAll(here.y);
        stepW.set(0, 0, 0);
        vel.set(0, 0, 0);
      }
      stepW.y = 0;
      vel.lerp(stepW.divideScalar(Math.max(dt, 1e-4) * scale), 1 - Math.exp(-dt * 12));
      const speed = Math.hypot(vel.x, vel.z);
      speedS = speed;
      const uh = speed / height; // body heights a second
      const going = uh > 0.03;
      let err = 0;
      for (const k of ['L', 'R']) err = Math.max(err, feet[k].w.distanceTo(neutral(k, _v2)) / scale);
      moving = damp(moving, going ? 1 : 0, going ? 10 : 4, dt);

      // The beat. Cadence from speed and the style; then how long each foot stays down so it never has to
      // reach further than the legs (and the turn) allow: past that, both feet leave the ground (the hop).
      let cadence = S.cadence * clamp(2.4 + 2.3 * uh, 2.4, 6);
      if (!going) cadence = 3.2 * S.cadence;
      const T = 1 / cadence;
      const stanceMax = (2 * (reach * (1 - S.stiff * 0.3) + pivotReach)) / Math.max(speed, 1e-4);
      let kappa = clamp(2 - stanceMax / T, S.skip ? 1.1 : 0.62, 1.55); // swing time, in steps
      if (!going) kappa = 0.7;
      kappaS = kappa;
      const swingTime = kappa * T;
      const stance = Math.max(0.02, 2 * T - swingTime);
      const win = kappa / 2;
      const swinging = !feet.L.planted || !feet.R.planted;
      const settle = !going && err > legLen * 0.25;
      if (going || swinging || settle) phase = (phase + (dt * cadence) / 2) % 1;
      for (const k of ['L', 'R']) {
        const f = feet[k];
        const into = (phase - (k === 'L' ? 0 : 0.5) + 1) % 1;
        const inWin = into < win;
        if (inWin && f.planted && into < win * 0.5 && (going || settle)) {
          f.planted = false;
          f.from.copy(f.w);
          f.lift = legLen * S.lift * clamp(0.22 + uh * 0.15, 0.2, 0.45) * (S.skip && k === 'L' ? 1.4 : 1) * (going ? 1 : 0.5);
        }
        if (!f.planted) {
          f.t = Math.min(1, into / win);
          // Land where the body will be then, half a stance ahead of that.
          neutral(k, f.to).addScaledVector(vel, ((1 - f.t) * swingTime + stance * 0.5) * scale);
          if (!inWin || f.t >= 1) {
            f.planted = true;
            f.w.copy(f.to).setY(here.y);
            f.t = 0;
          } else {
            const e = ease(f.t);
            f.w.lerpVectors(f.from, f.to, e);
            f.w.y = THREE.MathUtils.lerp(f.from.y, here.y, e);
          }
        }
      }
      const sL = feet.L.planted ? 0 : Math.sin(Math.PI * feet.L.t);
      const sR = feet.R.planted ? 0 : Math.sin(Math.PI * feet.R.t);
      const both = !feet.L.planted && !feet.R.planted;

      // The body over its feet: the penguin turn (the swinging side comes forward), tipping and sliding onto
      // the planted foot, rising over it.
      const m = moving;
      yaw = damp(yaw, (sR - sL) * PIVOT * m, 14, dt);
      roll = damp(roll, (sL - sR) * 0.09 * S.roll * m, 12, dt);
      sway = damp(sway, (sR - sL) * footSide * 0.35 * S.sway * m, 12, dt);
      const lean = clamp(uh * 0.16, 0, 0.24) * S.lean * m;
      // The hop: launched as both feet leave the ground, falling back under gravity (in model units).
      const g = (GRAVITY / scale) * 1.6;
      if (both && air <= 1e-5 && airV <= 0) airV = g * swingTime * 0.5 * (kappa - 1) * 0.9 * S.bounce;
      airV -= g * dt;
      air = Math.max(0, air + airV * dt);
      if (air <= 0 && airV < 0) airV = 0;
      rise = damp(rise, Math.max(sL, sR) * legLen * 0.05 * S.bounce * m, 20, dt);
      // Idle: breathing, a slow weight shift, the body never quite still.
      const idleK = 1 - m;
      const breath = Math.sin(t * 1.6);
      const shift = Math.sin(t * 0.43) * footSide * 0.18 * idleK;
      const idleRoll = Math.sin(t * 0.43) * 0.025 * idleK;
      const idleYaw = Math.sin(t * 0.29) * 0.04 * idleK;

      for (const n of Object.keys(G)) G[n] = damp(G[n], move === n || (n === 'sleepy' && move === 'sleep') ? 1 : 0, 6, dt);
      const hop = G.cheer * Math.max(0, Math.sin(t * 7.5)) * legLen * 0.35;

      // ---------- the hips: turned, then set as high as the planted legs allow ----------
      const hipD = qa(Y, yaw + idleYaw).multiply(qa(Z, roll + idleRoll)).multiply(qa(X, lean * 0.4));
      const hipBase = new THREE.Vector3(sway + shift, 0, 0);
      let drop = 0;
      for (const k of ['L', 'R']) {
        if (!feet[k].planted) continue;
        const ank = toModel(feet[k].w, new THREE.Vector3());
        ank.y += ankleH;
        const hipJ = P(`Thigh${k}`).clone().sub(P('Hips')).applyQuaternion(hipD).add(P('Hips')).add(hipBase);
        const h = Math.hypot(hipJ.x - ank.x, hipJ.z - ank.z);
        const fits = Math.sqrt(Math.max(0, (legLen * 0.995) ** 2 - h * h));
        drop = Math.max(drop, hipJ.y - (ank.y + fits));
      }
      drop = clamp(drop, 0, legLen * 0.45);
      const hipPos = P('Hips').clone().add(hipBase);
      hipPos.y += -drop + air + rise + hop - G.sad * legLen * 0.06;
      // The root as bound (a clip played in between may have moved it), then the hips' local position in its space.
      B.Root.position.copy(bind.Root.lp);
      B.Root.quaternion.copy(bind.Root.lq);
      B.Hips.position.copy(bind.Hips.lp).add(_v2.copy(hipPos).sub(P('Hips')).applyQuaternion(bind.Root.iq));
      cur.Root.copy(bind.Root.q);
      deltas.Root.identity();
      posed.Root.copy(P('Root'));
      deltas.Hips.copy(hipD);
      cur.Hips.multiplyQuaternions(hipD, bind.Hips.q);
      B.Hips.quaternion.copy(_q.copy(bind.Root.q).invert().multiply(cur.Hips));
      posed.Hips.copy(hipPos);

      // ---------- the spine, chest, neck and head ----------
      const counter = -yaw * 0.6; // the shoulders turn back against the hips
      const spD = hipD.clone().multiply(qa(X, lean * 0.5 + G.sad * 0.16 + G.sleepy * 0.08 - S.chest * 0.05)).multiply(qa(Z, -roll * 0.4));
      place('Spine', spD);
      const chD = qa(Y, counter * 0.5).multiply(spD).multiply(qa(X, breath * 0.014 - S.chest * 0.07 + G.sad * 0.08)).multiply(qa(Y, Math.sin(t * 2.1) * 0.06 * G.talk));
      place('Chest', chD);
      const nod = Math.sin(t * 5.3) * 0.05 * G.talk + Math.max(0, Math.sin(t * 7.5)) * 0.06 * G.cheer;
      const nkD = qa(Y, counter * 0.5).multiply(chD).multiply(qa(Z, -roll * 0.5)).multiply(qa(X, -lean * 0.7 + S.droop * 0.14 + G.sad * 0.24 + G.sleepy * (0.32 + Math.sin(t * 0.9) * 0.08) + nod - S.chest * 0.06));
      place('Neck', nkD);
      const hdD = nkD.clone().multiply(qa(Z, -roll * 0.3 + Math.sin(t * 0.9) * 0.1 * G.sleepy)).multiply(qa(X, -Math.max(sL, sR) * 0.03 * m));
      place('Head', hdD);

      // ---------- the legs ----------
      for (const k of ['L', 'R']) posed[`Thigh${k}`].copy(P(`Thigh${k}`)).sub(P('Hips')).applyQuaternion(hipD).add(hipPos);
      for (const k of ['L', 'R']) {
        const f = feet[k];
        const ankW = f.w.clone();
        if (!f.planted) ankW.y += Math.sin(Math.PI * ease(f.t)) * f.lift * scale;
        const ank = toModel(ankW, new THREE.Vector3());
        ank.y += ankleH;
        leg(k, ank);
        // The foot level with the ground, its toe lifting off and dipping to land, turned with the body.
        const pitch = f.planted ? 0 : Math.sin(Math.PI * f.t) * (f.t < 0.5 ? 0.45 : -0.2) * S.lift;
        place(`Foot${k}`, qa(Y, yaw * 0.5).multiply(qa(X, pitch)));
      }

      // ---------- the arms ----------
      for (const k of ['L', 'R']) {
        const side = k === 'L' ? 1 : -1;
        // Hanging at the sides, out a little from the body, elbows soft; swinging against the feet when
        // walking (the arm on the planted side comes forward).
        const out = 0.34 + S.out * 0.3 + S.tuck * 0.05 + breath * 0.012 - G.sad * 0.06;
        const sw = (k === 'L' ? sR - sL : sL - sR) * 0.5 * S.arms * m * (kappa > 1 ? 1.4 : 1);
        const up = new THREE.Vector3(side * out, -1, 0).normalize().applyAxisAngle(X, -sw);
        const bend = 0.18 + S.tuck * 1.05 + (kappa > 1 ? 0.9 : 0.25) * m;
        const fore = up.clone().applyAxisAngle(X, -bend);
        // Resting on the float: elbows out over its rim, forearms along the top of it.
        if (S.float) {
          const k2 = S.float * (1 - Math.max(G.wave * (side < 0 ? 1 : 0), G.cheer));
          up.lerp(new THREE.Vector3(side * 0.95, -0.55, 0.12).applyAxisAngle(X, -sw * 0.4).normalize(), k2).normalize();
          fore.lerp(new THREE.Vector3(side * 0.1, -0.12, 1).normalize(), k2).normalize();
        }
        // Gestures.
        if (G.wave > 0.01 && side < 0) {
          up.lerp(new THREE.Vector3(side * 0.9, 0.62, 0.22).normalize(), G.wave).normalize();
          fore.lerp(new THREE.Vector3(side * (0.2 + Math.sin(t * 9) * 0.55), 1, 0.12).normalize(), G.wave).normalize();
        }
        if (G.cheer > 0.01) {
          const pump = Math.max(0, Math.sin(t * 7.5));
          up.lerp(new THREE.Vector3(side * 0.6, 0.8, 0.12).normalize(), G.cheer).normalize();
          fore.lerp(new THREE.Vector3(side * (0.3 + pump * 0.25), 1, 0.05).normalize(), G.cheer).normalize();
        }
        if (G.talk > 0.01) {
          const beat = Math.max(0, Math.sin(t * 2.3 + (side < 0 ? 0 : 2.4)));
          const a = G.talk * (0.35 + beat * 0.65);
          up.lerp(new THREE.Vector3(side * 0.42, -0.9, 0.3).normalize(), a).normalize();
          fore.lerp(new THREE.Vector3(side * 0.25, -0.05 + beat * 0.45, 1).normalize(), a).normalize();
        }
        if (G.sleepy > 0.01) {
          up.lerp(new THREE.Vector3(side * 0.2, -1, 0.06).normalize(), G.sleepy * 0.7).normalize();
          fore.lerp(up, G.sleepy * 0.6).normalize();
        }
        const dUp = aim(`UpperArm${k}`, `ForeArm${k}`, up, deltas.Chest);
        const dFo = aim(`ForeArm${k}`, `Hand${k}`, fore, dUp);
        place(`Hand${k}`, dFo.clone().multiply(qa(Z, side * 0.12)));
      }
    },
  };
}
