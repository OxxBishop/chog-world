/*
 * Retarget humanoid clips from an animation library onto the Chog rig (A, the user's ask for real cartoon
 * walks): each mapped bone takes the library bone's turn from its own T-pose, in the model's space, so the
 * Chog's bones keep their own rest directions and lengths. The hips' bounce and sway are scaled by leg length.
 * Works in the browser and in node (three.js only).
 *
 * retarget({ src, srcClip, srcRest, map, dst, name, fps }) -> THREE.AnimationClip for dst's bones.
 *   src / dst: scene roots (GLTF scenes, cloned), srcClip: the clip to bring over, srcRest: a clip holding the
 *   library's T-pose (or null: its bind pose), map: { dstBone: srcBone }.
 */
import * as THREE from 'three';

export const MAPS = {
  // Quaternius Universal Animation Library (CC0), Godot rig.
  ual: {
    Hips: 'DEF-hips', Spine: 'DEF-spine.002', Chest: 'DEF-spine.003', Neck: 'DEF-neck', Head: 'DEF-head',
    UpperArmL: 'DEF-upper_arm.L', ForeArmL: 'DEF-forearm.L', HandL: 'DEF-hand.L',
    UpperArmR: 'DEF-upper_arm.R', ForeArmR: 'DEF-forearm.R', HandR: 'DEF-hand.R',
    ThighL: 'DEF-thigh.L', ShinL: 'DEF-shin.L', FootL: 'DEF-foot.L',
    ThighR: 'DEF-thigh.R', ShinR: 'DEF-shin.R', FootR: 'DEF-foot.R',
  },
  // Quaternius Universal Animation Library 2 (CC0), Unreal-style mannequin.
  ual2: {
    Hips: 'pelvis', Spine: 'spine_02', Chest: 'spine_03', Neck: 'neck_01', Head: 'Head',
    UpperArmL: 'upperarm_l', ForeArmL: 'lowerarm_l', HandL: 'hand_l',
    UpperArmR: 'upperarm_r', ForeArmR: 'lowerarm_r', HandR: 'hand_r',
    ThighL: 'thigh_l', ShinL: 'calf_l', FootL: 'foot_l',
    ThighR: 'thigh_r', ShinR: 'calf_r', FootR: 'foot_r',
  },
  // KayKit Character Animations (CC0), Rig_Medium.
  kk: {
    Hips: 'hips', Spine: 'spine', Chest: 'chest', Neck: 'head', Head: 'head',
    UpperArmL: 'upperarm.l', ForeArmL: 'lowerarm.l', HandL: 'wrist.l',
    UpperArmR: 'upperarm.r', ForeArmR: 'lowerarm.r', HandR: 'wrist.r',
    ThighL: 'upperleg.l', ShinL: 'lowerleg.l', FootL: 'foot.l',
    ThighR: 'upperleg.r', ShinR: 'lowerleg.r', FootR: 'foot.r',
  },
};

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

// Each bone's rotation and joint in its scene root's own space.
function modelSpace(root, names) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const out = {};
  for (const n of names) {
    const b = root.getObjectByName(n);
    if (!b) continue;
    _m.multiplyMatrices(inv, b.matrixWorld).decompose(_p, _q, _s);
    out[n] = { q: _q.clone(), p: _p.clone() };
  }
  return out;
}

// Which way a rig faces (model space, flat): from its hips toward the toes' side of its feet.
function facing(rest, foot, leg) {
  const f = rest[foot]?.p, h = rest[leg]?.p;
  const v = new THREE.Vector3();
  if (f && h) v.set(f.x - h.x, 0, f.z - h.z);
  return v;
}

// A turn scaled: k times its angle about the same axis (k > 1 exaggerates it).
function scaleTurn(q, k) {
  if (k === 1) return q;
  const w = THREE.MathUtils.clamp(q.w, -1, 1);
  const ang = 2 * Math.acos(Math.abs(w));
  if (ang < 1e-5) return q;
  const s = Math.sqrt(1 - w * w) * Math.sign(w || 1);
  const axis = new THREE.Vector3(q.x / s, q.y / s, q.z / s);
  return new THREE.Quaternion().setFromAxisAngle(axis, ang * k);
}
const PART = (b) => (/Arm|Hand/.test(b) ? 'arms' : /Thigh|Shin|Foot/.test(b) ? 'legs' : /Spine|Chest|Neck|Head/.test(b) ? 'spine' : 'hips');

/*
 * amp: cartoon exaggeration, { arms, legs, spine, hips, bob }: each part's turns from the T-pose scaled
 * (relative to its parent part's), and the hips' up-and-down scaled by bob.
 */
export function retarget({ src, srcClip, srcRest = null, map: rawMap, dst, name = srcClip.name, fps = 30, armsOut = 0.12, srcToe = null, headK = 0.5, amp = null }) {
  // three.js drops reserved characters from node names on load (DEF-upper_arm.L is DEF-upper_armL).
  const clean = THREE.PropertyBinding.sanitizeNodeName;
  const map = Object.fromEntries(Object.entries(rawMap).map(([k, v]) => [k, clean(v)]));
  if (srcToe) srcToe = clean(srcToe);
  const srcNames = [...new Set(Object.values(map))];
  const dstNames = Object.keys(map);
  const mixer = new THREE.AnimationMixer(src);
  // The library's T-pose.
  if (srcRest) {
    const a = mixer.clipAction(srcRest);
    a.play();
    mixer.setTime(0);
  }
  const s0 = modelSpace(src, srcNames.concat(srcToe ? [srcToe] : []));
  mixer.stopAllAction();
  // The Chog's T-pose: its bind.
  const allDst = [];
  dst.traverse((o) => o.isBone && allDst.push(o));
  const bindLocal = new Map(allDst.map((b) => [b, { q: b.quaternion.clone(), p: b.position.clone() }]));
  const d0 = modelSpace(dst, allDst.map((b) => b.name));
  // Turn the library so it faces +z like the Chogs: its toes (or, failing that, +z) forward.
  let fwd = new THREE.Vector3(0, 0, 1);
  if (srcToe && s0[srcToe] && s0[map.FootL]) fwd = s0[srcToe].p.clone().sub(s0[map.FootL].p).setY(0);
  const align = new THREE.Quaternion().setFromUnitVectors(fwd.normalize(), new THREE.Vector3(0, 0, 1));
  // Hip height of each, for the bounce.
  const srcHip = s0[map.Hips].p.y, dstHip = d0.Hips.p.y;
  const hipK = dstHip / srcHip;
  const srcHip0 = s0[map.Hips].p.clone().applyQuaternion(align);

  const action = mixer.clipAction(srcClip);
  action.play();
  const n = Math.max(2, Math.round(srcClip.duration * fps) + 1);
  const times = new Float32Array(n);
  const rot = Object.fromEntries(dstNames.map((b) => [b, new Float32Array(n * 4)]));
  const hipPos = new Float32Array(n * 3);
  // The model-space rotation of a bone's non-bone parent (the rig node above the skeleton).
  dst.updateMatrixWorld(true);
  const dstInv = new THREE.Matrix4().copy(dst.matrixWorld).invert();
  const parentQ = (o) => {
    if (!o) return new THREE.Quaternion();
    const q = new THREE.Quaternion();
    new THREE.Matrix4().multiplyMatrices(dstInv, o.matrixWorld).decompose(new THREE.Vector3(), q, new THREE.Vector3());
    return q;
  };
  const rootBone = allDst.find((b) => b.name === 'Root');
  for (let i = 0; i < n; i++) {
    const t = Math.min(srcClip.duration, i / fps);
    times[i] = t;
    mixer.setTime(t);
    const s = modelSpace(src, srcNames);
    // World (model-space) rotation for each mapped Chog bone.
    const want = {};
    for (const b of dstNames) {
      const sb = map[b];
      if (!s[sb] || !d0[b]) continue;
      // The library bone's turn from its T-pose, seen from the Chog's facing.
      const delta = align.clone().multiply(s[sb].q).multiply(s0[sb].q.clone().invert()).multiply(align.clone().invert());
      // A Chog's head is most of its height: the head and neck take only part of the library's own turn
      // (relative to the chest), or every nod reads as a lurch.
      if ((b === 'Head' || b === 'Neck') && want.Chest && headK !== 1) {
        const chestDelta = want.Chest.clone().multiply(d0.Chest.q.clone().invert());
        delta.copy(chestDelta.clone().slerp(delta, headK));
      }
      want[b] = delta.multiply(d0[b].q);
    }
    // Arms a touch further from the body: a Chog is round and its arms are short.
    for (const [b, side] of [['UpperArmL', 1], ['UpperArmR', -1]]) {
      if (want[b]) want[b].premultiply(_q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), side * armsOut));
    }
    // Into local rotations, parents first (bones keep their order in the scene).
    const world = new Map();
    for (const b of allDst) {
      const parent = b.parent;
      const pw = world.get(parent) ?? parentQ(parent);
      const w = want[b.name] ?? pw.clone().multiply(bindLocal.get(b).q);
      world.set(b, w);
      if (want[b.name]) {
        const local = pw.clone().invert().multiply(w);
        local.toArray(rot[b.name], i * 4);
      }
    }
    // The hips' bounce and sway, scaled to the Chog's legs (forward drift kept out: these are walked in place).
    const off = s[map.Hips].p.clone().applyQuaternion(align).sub(srcHip0).multiplyScalar(hipK);
    off.z = 0;
    const hp = d0.Hips.p.clone().add(off);
    // Into the Root's space.
    const rootQ = d0.Root?.q ?? new THREE.Quaternion(), rootP = d0.Root?.p ?? new THREE.Vector3();
    const local = hp.sub(rootP).applyQuaternion(rootQ.clone().invert());
    local.toArray(hipPos, i * 3);
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(src);
  // Unwrap quaternion signs so interpolation takes the short way.
  for (const b of dstNames) {
    const a = rot[b];
    for (let i = 1; i < n; i++) {
      const dot = a[i * 4] * a[i * 4 - 4] + a[i * 4 + 1] * a[i * 4 - 3] + a[i * 4 + 2] * a[i * 4 - 2] + a[i * 4 + 3] * a[i * 4 - 1];
      if (dot < 0) for (let k = 0; k < 4; k++) a[i * 4 + k] *= -1;
    }
  }
  // Cartoon exaggeration: each bone's motion round its own average pose made bigger (its steady lean stays
  // as it is), and the hips' bounce round their average height.
  if (amp) {
    for (const b of dstNames) {
      const k = amp[PART(b)] ?? 1;
      const a = rot[b];
      if (k === 1 || !a) continue;
      const mean = new THREE.Quaternion(0, 0, 0, 0);
      for (let i = 0; i < n; i++) (mean.x += a[i * 4]), (mean.y += a[i * 4 + 1]), (mean.z += a[i * 4 + 2]), (mean.w += a[i * 4 + 3]);
      mean.normalize();
      const inv = mean.clone().invert(), q = new THREE.Quaternion();
      for (let i = 0; i < n; i++) {
        q.fromArray(a, i * 4);
        mean.clone().multiply(scaleTurn(inv.clone().multiply(q), k)).toArray(a, i * 4);
      }
    }
    if (amp.bob) {
      let my = 0;
      for (let i = 0; i < n; i++) my += hipPos[i * 3 + 1] / n;
      for (let i = 0; i < n; i++) hipPos[i * 3 + 1] = my + (hipPos[i * 3 + 1] - my) * amp.bob;
    }
  }
  const tracks = dstNames.filter((b) => rot[b] && d0[b] && src.getObjectByName(map[b])).map((b) => new THREE.QuaternionKeyframeTrack(`${b}.quaternion`, times, rot[b]));
  tracks.push(new THREE.VectorKeyframeTrack('Hips.position', times, hipPos));
  // Root stays as bound.
  if (rootBone) {
    const bq = bindLocal.get(rootBone).q;
    tracks.push(new THREE.QuaternionKeyframeTrack('Root.quaternion', [0], bq.toArray()));
  }
  return new THREE.AnimationClip(name, srcClip.duration, tracks);
}
