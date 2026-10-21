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
  // RobotExpressive (Quaternius, CC0; the three.js example robot): a big cartoon Wave, ThumbsUp, Jump, Dance.
  robot: {
    Hips: 'Hips', Spine: 'Abdomen', Chest: 'Torso', Neck: 'Neck', Head: 'Head',
    UpperArmL: 'UpperArm.L', ForeArmL: 'LowerArm.L', HandL: 'Palm2.L',
    UpperArmR: 'UpperArm.R', ForeArmR: 'LowerArm.R', HandR: 'Palm2.R',
    ThighL: 'UpperLeg.L', ShinL: 'LowerLeg.L', FootL: 'Foot.L',
    ThighR: 'UpperLeg.R', ShinR: 'LowerLeg.R', FootR: 'Foot.R',
  },
  // Another Chog (Tripo's rig, the same bone names): the old singer's Sing onto the plain body.
  chog: Object.fromEntries(['Hips', 'Spine', 'Chest', 'Neck', 'Head', 'UpperArmL', 'ForeArmL', 'HandL', 'UpperArmR', 'ForeArmR', 'HandR', 'ThighL', 'ShinL', 'FootL', 'ThighR', 'ShinR', 'FootR'].map((b) => [b, b])),
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
// A library that rests with its arms down (the robot): its arms turned straight out to the side, each bone
// toward the next, so the moves are measured from a T-pose like the Chog's.
function straightenArms(root, map) {
  root.updateMatrixWorld(true);
  for (const [side, sign] of [['L', 1], ['R', -1]]) {
    for (const [b, c] of [['UpperArm', 'ForeArm'], ['ForeArm', 'Hand']]) {
      const bone = root.getObjectByName(map[b + side]), child = root.getObjectByName(map[c + side]);
      if (!bone || !child) continue;
      const dir = child.getWorldPosition(new THREE.Vector3()).sub(bone.getWorldPosition(new THREE.Vector3())).normalize();
      const turn = new THREE.Quaternion().setFromUnitVectors(dir, new THREE.Vector3(sign, 0, 0));
      const world = turn.multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
      bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world));
      root.updateMatrixWorld(true);
    }
  }
}

/*
 * Arms that point where the library's point, with no turn about their own length (the user, 10-21: "the
 * characters arms look twisted, all of them"). The libraries' arms roll as they swing (a human's palm turns
 * in and back), and the robot's straightened arms start out rolled: on a Chog's mitten arm that roll reads as
 * a corkscrew, up to half a turn between elbow and hand in the cheer. Each arm bone keeps only the shortest
 * turn from its bind line to where it points now (palm down in the T-pose, palm in at the side, palm forward
 * raised), in place, frame by frame, parents first. rot: { bone: Float32Array of local quaternions }.
 */
/*
 * Where each arm's mesh really points in the bind (model space): from the shoulder joint to the middle of the
 * forearm's and hand's vertices. Tripo's T-poses hold the arms some 30 degrees down while the rig's arm bones run level, so
 * matching bones to the library put every arm that much lower than the library has it (hands hugging the
 * body, a wave that never got the hand up). Returns { L, R: { line, fix } }: fix turns the mesh's line onto
 * the bone's, so a library turn measured from its level T-pose lands on the mesh's own arm.
 */
function meshArmLines(dst, d0) {
  let mesh = null;
  dst.traverse((o) => o.isSkinnedMesh && (!mesh || o.geometry.attributes.position.count > mesh.geometry.attributes.position.count) && (mesh = o));
  const out = {};
  if (!mesh) return out;
  dst.updateMatrixWorld(true);
  const toModel = new THREE.Matrix4().copy(dst.matrixWorld).invert().multiply(mesh.matrixWorld);
  const pos = mesh.geometry.attributes.position, si = mesh.geometry.attributes.skinIndex, sw = mesh.geometry.attributes.skinWeight;
  const v = new THREE.Vector3();
  for (const side of ['L', 'R']) {
    const hi = mesh.skeleton.bones.findIndex((b) => b.name === 'Hand' + side);
    const fi = mesh.skeleton.bones.findIndex((b) => b.name === 'ForeArm' + side);
    if (hi < 0 || fi < 0 || !d0['UpperArm' + side] || !d0['ForeArm' + side]) continue;
    const c = new THREE.Vector3();
    let n = 0;
    for (let i = 0; i < pos.count; i++) {
      let w = 0;
      for (let j = 0; j < 4; j++) if (si.getComponent(i, j) === hi || si.getComponent(i, j) === fi) w += sw.getComponent(i, j);
      if (w < 0.5) continue;
      c.add(v.fromBufferAttribute(pos, i).applyMatrix4(toModel));
      n++;
    }
    if (n < 10) continue;
    c.divideScalar(n);
    const line = c.sub(d0['UpperArm' + side].p).normalize();
    const bone = d0['ForeArm' + side].p.clone().sub(d0['UpperArm' + side].p).normalize();
    out[side] = { line, fix: new THREE.Quaternion().setFromUnitVectors(line, bone), droop: THREE.MathUtils.radToDeg(line.angleTo(bone)) };
  }
  return out;
}

const ARM_BONES = ['UpperArmL', 'ForeArmL', 'HandL', 'UpperArmR', 'ForeArmR', 'HandR'];
const LINE_OF = { UpperArmL: ['UpperArmL', 'ForeArmL'], ForeArmL: ['ForeArmL', 'HandL'], HandL: ['ForeArmL', 'HandL'], UpperArmR: ['UpperArmR', 'ForeArmR'], ForeArmR: ['ForeArmR', 'HandR'], HandR: ['ForeArmR', 'HandR'] };
function untwistArms(rot, n, allDst, bindLocal, d0, parentQ, arms = {}) {
  const line = {};
  for (const b of ARM_BONES) {
    const [a, c] = LINE_OF[b];
    const own = arms[b.slice(-1)]?.line;
    if (rot[b] && d0[a] && d0[c]) line[b] = own ? own.clone() : d0[c].p.clone().sub(d0[a].p).normalize();
  }
  const q = new THREE.Quaternion(), dq = new THREE.Quaternion(), d = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const world = new Map();
    for (const b of allDst) {
      const pw = world.get(b.parent) ?? parentQ(b.parent);
      const local = rot[b.name] ? q.fromArray(rot[b.name], i * 4).clone() : bindLocal.get(b).q.clone();
      let w = pw.clone().multiply(local);
      if (line[b.name]) {
        // Its turn from the bind, model space; where that points the bind line; the shortest turn there.
        dq.copy(w).multiply(d0[b.name].q.clone().invert());
        d.copy(line[b.name]).applyQuaternion(dq);
        w = new THREE.Quaternion().setFromUnitVectors(line[b.name], d).multiply(d0[b.name].q);
        pw.clone().invert().multiply(w).toArray(rot[b.name], i * 4);
      }
      world.set(b, w);
    }
  }
}

export function retarget({ src, srcClip, srcRest = null, map: rawMap, dst, name = srcClip.name, fps = 30, armsOut = 0.12, armsFwd = 0, srcToe = null, headK = 0.5, amp = null, srcTPose = false, adjust = null }) {
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
  // srcTPose: measure from straightened arms, then put every bone back, so one the clip leaves alone (the
  // robot's resting arm in its wave) hangs as it does in the library.
  const bindQ = [];
  if (srcTPose) {
    src.traverse((o) => bindQ.push([o, o.quaternion.clone()]));
    straightenArms(src, map);
  }
  const s0 = modelSpace(src, srcNames.concat(srcToe ? [srcToe] : []));
  for (const [o, q] of bindQ) o.quaternion.copy(q);
  mixer.stopAllAction();
  // The Chog's T-pose: its bind.
  const allDst = [];
  dst.traverse((o) => o.isBone && allDst.push(o));
  const bindLocal = new Map(allDst.map((b) => [b, { q: b.quaternion.clone(), p: b.position.clone() }]));
  const d0 = modelSpace(dst, allDst.map((b) => b.name));
  const arms = meshArmLines(dst, d0);
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
      // An arm bone: the library's turn applied to the arm as if its mesh lay level like the library's.
      const side = ARM_BONES.includes(b) ? arms[b.slice(-1)] : null;
      want[b] = side ? delta.multiply(side.fix).multiply(d0[b].q) : delta.multiply(d0[b].q);
    }
    // Arms a touch further from the body: a Chog is round and its arms are short. armsFwd brings them
    // forward too, so hands rest in front of a wide robe instead of sinking into it (King Pom).
    for (const [b, side] of [['UpperArmL', 1], ['UpperArmR', -1]]) {
      if (want[b]) want[b].premultiply(_q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), side * armsOut));
      if (want[b] && armsFwd) want[b].premultiply(_q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -armsFwd));
    }
    // adjust: extra turns for a body of other proportions, [[bone, axis 'x' | 'y' | 'z', degrees], ...] in
    // the model's space, in order (the plain Chog's shorter arm needs more lift to bring the singer's mic to its mouth).
    for (const [b, ax, deg] of adjust ?? []) {
      if (want[b]) want[b].premultiply(_q.setFromAxisAngle(new THREE.Vector3(ax === 'x' ? 1 : 0, ax === 'y' ? 1 : 0, ax === 'z' ? 1 : 0), THREE.MathUtils.degToRad(deg)));
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
  untwistArms(rot, n, allDst, bindLocal, d0, parentQ, arms);
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
    // lean: how much of the body's tilt and sideways shift from straight up it keeps (hips to head). A
    // human idle stands on one hip with the spine tilted back over it; under a Chog's big head that read as
    // crooked (the user, 10-21: "peely looks crooked").
    if (amp.lean !== undefined && amp.lean !== 1) {
      const q = new THREE.Quaternion(), q0 = new THREE.Quaternion();
      for (const b of dstNames) {
        if (!rot[b] || !/^(Hips|Spine|Chest|Neck|Head)$/.test(b)) continue;
        q0.copy(bindLocal.get(allDst.find((o) => o.name === b)).q);
        for (let i = 0; i < n; i++) q0.clone().slerp(q.fromArray(rot[b], i * 4), amp.lean).toArray(rot[b], i * 4);
      }
      // The hips' sideways shift, in the model's space.
      const rootQ = d0.Root?.q ?? new THREE.Quaternion(), rootP = d0.Root?.p ?? new THREE.Vector3();
      const v = new THREE.Vector3();
      for (let i = 0; i < n; i++) {
        v.fromArray(hipPos, i * 3).applyQuaternion(rootQ).add(rootP);
        v.x = d0.Hips.p.x + (v.x - d0.Hips.p.x) * amp.lean;
        v.sub(rootP).applyQuaternion(rootQ.clone().invert()).toArray(hipPos, i * 3);
      }
    }
  }
  // The exaggeration above can bring a little twist back: once more, and the signs again.
  if (amp) {
    untwistArms(rot, n, allDst, bindLocal, d0, parentQ, arms);
    for (const b of ARM_BONES) {
      const a = rot[b];
      if (!a) continue;
      for (let i = 1; i < n; i++) {
        const dot = a[i * 4] * a[i * 4 - 4] + a[i * 4 + 1] * a[i * 4 - 3] + a[i * 4 + 2] * a[i * 4 - 2] + a[i * 4 + 3] * a[i * 4 - 1];
        if (dot < 0) for (let k = 0; k < 4; k++) a[i * 4 + k] *= -1;
      }
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
