"""
Auto-rig a T-pose Tripo Chog for Chog World.

The skeleton is placed from the mesh itself (arm line, shoulders, neck, crotch and feet found by
slicing), weights come from bone heat on a welded copy with two fixes (everything above the neck that
is not arm follows the head; the torso core never follows the arms), and the clips are keyed with the
arms lowered from the T-pose. Scaled so the Chog is 2.2 m tall, feet on the origin, facing +z in glTF.

blender -b --factory-startup -P rig_chog.py -- <in.glb> <out.glb> <clips comma list>
"""
import bpy, bmesh, sys, math
import numpy as np
from mathutils import Vector, Quaternion
from mathutils.kdtree import KDTree
from mathutils.geometry import intersect_point_line

args = sys.argv[sys.argv.index('--') + 1:]
src, out_glb = args[0], args[1]
CLIPS_WANTED = args[2].split(',') if len(args) > 2 and args[2] else ['Idle', 'Walk', 'Run', 'Wave', 'Talk', 'Cheer']
import json
OVR = {k: float(v) for k, v in (kv.split('=') for kv in args[3].split(';') if '=' in kv)} if len(args) > 3 else {}  # hand-measured landmarks, 'z_arm=0.77;shoulder=0.22' (metres, after scaling)
HEIGHT = 2.2

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
scene = bpy.context.scene
scene.render.fps = 30
mesh = [o for o in bpy.data.objects if o.type == 'MESH'][0]
for o in list(bpy.data.objects):
    if o is not mesh:
        bpy.data.objects.remove(o)
mesh.parent = None
mesh.name = mesh.data.name = 'Chog'
bpy.context.view_layer.objects.active = mesh
mesh.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
co = np.array([tuple(v.co) for v in mesh.data.vertices])
zmin, zmax = co[:, 2].min(), co[:, 2].max()
S = HEIGHT / (zmax - zmin)
cx, cy = (co[:, 0].min() + co[:, 0].max()) / 2, np.median(co[:, 1])
mesh.location = (-cx * S, -cy * S, -zmin * S)
mesh.scale = (S, S, S)
bpy.ops.object.transform_apply(location=True, scale=True)
co = np.array([tuple(v.co) for v in mesh.data.vertices])
H = HEIGHT


def band(z0, z1):
    return co[(co[:, 2] >= z0) & (co[:, 2] < z1)]


def blobs_x(pts, gap):
    """Split a slice's points into runs along x separated by gaps wider than `gap`."""
    if len(pts) == 0:
        return []
    xs = np.sort(pts[:, 0])
    cuts = np.where(np.diff(xs) > gap)[0]
    runs, start = [], 0
    for c in list(cuts) + [len(xs) - 1]:
        runs.append((xs[start], xs[c]))
        start = c + 1
    return runs


# Arm line: going up from the feet, the first band where the body suddenly gets much wider than the
# torso (the outstretched arms). Wide hair or spikes higher up never count: they come after.
def reach_at(z):
    b = band(z, z + 0.01 * H)
    return min(-b[:, 0].min(), b[:, 0].max()) if len(b) > 10 else 0.0


zs = np.arange(0.15 * H, 0.70 * H, 0.005 * H)
w = np.array([reach_at(z) for z in zs])
base = np.median(w[(zs > 0.18 * H) & (zs < 0.28 * H)])
wide = np.where(w > max(2.2 * base, base + 0.18 * H))[0]
if len(wide):
    run = [wide[0]]
    for k in wide[1:]:
        if k == run[-1] + 1:
            run.append(k)
        else:
            break
    z_arm = float(zs[run[len(run) // 2]])
else:
    z_arm = 0.42 * H
z_arm = OVR.get('z_arm', z_arm)
reach = reach_at(z_arm)
arm_band = band(z_arm - 0.03 * H, z_arm + 0.03 * H)
hand_r, hand_l = arm_band[:, 0].min(), arm_band[:, 0].max()
if 'hand' in OVR:
    hand_r, hand_l = -OVR['hand'], OVR['hand']
# Shoulders: walking in along the arm from the hand, where the mesh suddenly gets much taller than the
# arm (the torso). Only points at the arm's own depth count, so wings, robes and hat flaps behind or
# around the body don't fool it.
outer = arm_band[np.abs(arm_band[:, 0]) > 0.6 * min(-hand_r, hand_l)]
arm_y_est = float(np.median(outer[:, 1])) if len(outer) else float(np.median(arm_band[:, 1]))
near = co[(np.abs(co[:, 1] - arm_y_est) < 0.06 * H) & (np.abs(co[:, 2] - z_arm) < 0.22 * H)]


# Front silhouette of the band just under the arm line, front half of the body only (wings and capes
# sit behind). Over the torso the band is filled top to bottom; over the arm only the arm's thickness.
front = co[co[:, 1] <= arm_y_est + 0.03 * H]
win = front[(front[:, 2] > z_arm - 0.09 * H) & (front[:, 2] < z_arm + 0.02 * H)]


def shoulder_x(hand):
    xs = np.linspace(0, hand, 140)
    for x in xs[3:]:
        c = win[np.abs(win[:, 0] - x) < 0.01 * H]
        if len(c) < 3:
            continue
        if c[:, 2].max() - c[:, 2].min() < 0.6 * 0.11 * H:
            return float(x)
    return float(hand * 0.35)


sh_r, sh_l = shoulder_x(hand_r), shoulder_x(hand_l)
sh = OVR.get('shoulder', min(-sh_r, sh_l))  # symmetric, the nearer of the two
sh = max(sh, 0.06 * H)
sh_r, sh_l = -sh, sh
# Crotch: the lowest point where the legs are still apart, searching up from the feet.
z_crotch = 0.12 * H
for z in np.arange(0.03 * H, 0.35 * H, 0.005 * H):
    r = blobs_x(band(z, z + 0.006 * H), 0.012 * H)
    if len(r) < 2:
        z_crotch = z
        break
feet = blobs_x(band(0.0, 0.04 * H), 0.012 * H)
feet = sorted(feet, key=lambda r: -(r[1] - r[0]))[:2]
feet = sorted(feet, key=lambda r: r[0])
foot_r = (feet[0][0] + feet[0][1]) / 2 if len(feet) == 2 else -0.07 * H
foot_l = (feet[1][0] + feet[1][1]) / 2 if len(feet) == 2 else 0.07 * H
foot_y = float(np.median(band(0, 0.03 * H)[:, 1]))
front_y = float(np.percentile(band(0, 0.03 * H)[:, 1], 5))
z_neck = z_arm + 0.035 * H
print('LANDMARKS', dict(arm=round(z_arm / H, 3), hands=(round(hand_r, 3), round(hand_l, 3)),
                        shoulders=(round(sh_r, 3), round(sh_l, 3)), crotch=round(z_crotch / H, 3),
                        feet=(round(foot_r, 3), round(foot_l, 3))))

V = Vector
y0 = float(np.median(band(z_crotch, z_arm)[:, 1]))
hipz = z_crotch + 0.02 * H
legx_r, legx_l = foot_r, foot_l
arm_y = arm_y_est
BONES = [
    ('Root', None, (0, y0, 0), (0, y0, 0.08 * H)),
    ('Hips', 'Root', (0, y0, hipz), (0, y0, hipz + 0.06 * H)),
    ('Spine', 'Hips', (0, y0, hipz + 0.06 * H), (0, y0, (hipz + z_arm) / 2 + 0.03 * H)),
    ('Chest', 'Spine', (0, y0, (hipz + z_arm) / 2 + 0.03 * H), (0, y0, z_neck - 0.01 * H)),
    ('Neck', 'Chest', (0, y0, z_neck - 0.01 * H), (0, y0, z_neck + 0.03 * H)),
    ('Head', 'Neck', (0, y0, z_neck + 0.03 * H), (0, y0, 0.97 * H)),
]
for side, sx, hx in (('R', sh_r, hand_r), ('L', sh_l, hand_l)):
    sgn = 1 if side == 'L' else -1
    span = hx - sx
    elbow = sx + span * 0.5
    wrist = sx + span * 0.82
    BONES += [
        (f'UpperArm{side}', 'Chest', (sx - sgn * 0.01 * H, arm_y, z_arm), (elbow, arm_y, z_arm)),
        (f'ForeArm{side}', f'UpperArm{side}', (elbow, arm_y, z_arm), (wrist, arm_y, z_arm)),
        (f'Hand{side}', f'ForeArm{side}', (wrist, arm_y, z_arm), (hx, arm_y, z_arm)),
    ]
for side, lx in (('R', legx_r), ('L', legx_l)):
    knee = hipz * 0.5
    BONES += [
        (f'Thigh{side}', 'Hips', (lx, y0, hipz), (lx, y0, knee)),
        (f'Shin{side}', f'Thigh{side}', (lx, y0, knee), (lx, foot_y, 0.05 * H)),
        (f'Foot{side}', f'Shin{side}', (lx, foot_y, 0.05 * H), (lx, front_y, 0.02 * H)),
    ]

arm_data = bpy.data.armatures.new('ChogRig')
arm = bpy.data.objects.new('ChogRig', arm_data)
scene.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
for name, parent, h, t in BONES:
    b = arm_data.edit_bones.new(name)
    b.head, b.tail = V(h), V(t)
    if parent:
        b.parent = arm_data.edit_bones[parent]
        b.use_connect = (b.parent.tail - b.head).length < 1e-6
bpy.ops.object.mode_set(mode='OBJECT')

# ---------------------------------------------------------------- weights
weld = mesh.copy()
weld.data = mesh.data.copy()
scene.collection.objects.link(weld)
bm = bmesh.new()
bm.from_mesh(weld.data)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0005 * H)
bm.to_mesh(weld.data)
bm.free()
bpy.ops.object.select_all(action='DESELECT')
weld.select_set(True)
arm.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
names = [b.name for b in arm_data.bones]
col = {n: i for i, n in enumerate(names)}
wv = weld.data.vertices
gidx = {g.index: g.name for g in weld.vertex_groups}
W = np.zeros((len(wv), len(names)))
for v in wv:
    for g in v.groups:
        if gidx[g.group] in col:
            W[v.index, col[gidx[g.group]]] = g.weight
have = W.sum(1) >= 1e-6
print('welded verts without weights:', int((~have).sum()))
if (~have).any():
    kd = KDTree(int(have.sum()))
    for i in np.where(have)[0]:
        kd.insert(wv[int(i)].co, int(i))
    kd.balance()
    for i in np.where(~have)[0]:
        W[i] = W[kd.find(wv[int(i)].co)[1]]
kd = KDTree(len(wv))
for v in wv:
    kd.insert(v.co, v.index)
kd.balance()
me = mesh.data
OW = np.array([W[kd.find(v.co)[1]] for v in me.vertices])
bpy.data.objects.remove(weld)


def seg_dist(c, bname):
    b = arm_data.bones[bname]
    _, f = intersect_point_line(c, b.head_local, b.tail_local)
    f = min(1.0, max(0.0, f))
    return (c - (b.head_local + (b.tail_local - b.head_local) * f)).length


ARM = [col[n] for n in ('UpperArmL', 'ForeArmL', 'HandL', 'UpperArmR', 'ForeArmR', 'HandR')]
# The arm's own radius, measured along the forearm where nothing else is near.
span_ = min(-hand_r, hand_l)
fa = co[(np.abs(co[:, 0]) > 0.62 * span_) & (np.abs(co[:, 0]) < 0.82 * span_) & (np.abs(co[:, 2] - z_arm) < 0.1 * H)]
r_arm = float((np.percentile(fa[:, 2], 97) - np.percentile(fa[:, 2], 3)) / 2) if len(fa) > 20 else 0.03 * H
r_arm = min(max(r_arm, 0.02 * H), 0.08 * H)
if 'r_arm' in OVR:
    r_arm = OVR['r_arm'] * H
print('ARM RADIUS', round(r_arm / H, 3))
LEG = [col[n] for n in ('ThighL', 'ShinL', 'FootL', 'ThighR', 'ShinR', 'FootR')]
head_zone = torso_core = 0
arm_r = 0.07 * H
for v in me.vertices:
    p = v.co
    d_arm = min(seg_dist(p, n) for n in ('UpperArmL', 'ForeArmL', 'HandL', 'UpperArmR', 'ForeArmR', 'HandR'))
    # Above the top of the outstretched arms nothing belongs to an arm (spikes, hat flaps and ties that
    # hang near the shoulders), except right at the hands.
    above_arm = p.z > z_arm + 1.3 * r_arm + 0.01 * H and abs(p.x) < 0.75 * min(-hand_r, hand_l)
    # (The top of a puffy shoulder or sleeve, out past the shoulder and just over the arm line, where bone heat
    # gives the arm most of it, stays on the arm: held by the head it tore into flaps as the arm came down,
    # 10-21, the regenerated cast.)
    arm_top = abs(p.x) > 0.92 * sh and p.z < z_arm + 0.12 * H and OW[v.index, ARM].sum() > 0.5
    if p.z > z_neck - 0.01 * H and (above_arm or d_arm > 1.5 * r_arm) and not arm_top:
        # The head and everything on it: head and neck only, blended at the neck.
        k = min(1.0, max(0.0, (p.z - (z_neck - 0.01 * H)) / (0.05 * H)))
        row = np.zeros(len(names))
        row[col['Head']] = k
        row[col['Neck']] = (1 - k) * 0.6
        row[col['Chest']] = (1 - k) * 0.4
        OW[v.index] = row
        head_zone += 1
    elif hipz < p.z < z_neck and d_arm > arm_r * 1.2 and (abs(p.x) < 0.8 * min(abs(sh_r), abs(sh_l))):
        # The torso core never follows the arms or the legs.
        row = OW[v.index].copy()
        row[ARM + LEG] = 0
        if row.sum() < 0.05:
            row[:] = 0
            row[col['Spine']] = 1
        OW[v.index] = row / row.sum()
        torso_core += 1
OW[:, col['Root']] = 0
# (10-21, the regenerated cast: Tripo's new models tore at the hips and at the tops of the shoulders in the walk,
# a hard line between spine and thigh, and between the arm and the collar.) The top of a shoulder in from the
# joint, over the arm line, never follows the arm; then the weights in two bands, round the hips and round each
# shoulder, are smoothed over the surface (welded by position), so each joint bends over several rings of the
# mesh, not one. The head (head and neck held) never changes.
cov = np.array([tuple(v.co) for v in me.vertices])
keys = np.round(cov / (0.0005 * H)).astype(np.int64)
_, wid = np.unique(keys, axis=0, return_inverse=True)
wid = wid.ravel()
nw = wid.max() + 1
ed = np.array([tuple(e.vertices) for e in me.edges])
a, b = wid[ed[:, 0]], wid[ed[:, 1]]
keep = a != b
ea, eb = np.r_[a[keep], b[keep]], np.r_[b[keep], a[keep]]
deg = np.bincount(ea, minlength=nw).astype(np.float64)


def nbmean(X):
    out = np.zeros_like(X)
    np.add.at(out, ea, X[eb])
    return out / np.maximum(deg, 1)[:, None]
cnt = np.bincount(wid, minlength=nw).astype(np.float64)
G = np.zeros((nw, len(names)))
np.add.at(G, wid, OW)
G /= cnt[:, None]
gp = np.zeros((nw, 3))
np.add.at(gp, wid, cov)
gp /= cnt[:, None]
HEADS = [col['Head'], col['Neck']]
locked = G[:, HEADS].sum(1) > 0.5
# What the head holds never follows an arm or a leg (a hood's rim over the shoulders stretched as the arm moved).
G[np.ix_(locked, ARM + LEG)] = 0
# A tail (or anything out behind the hips, below the arms) never follows a leg: it rides the hips.
behind = (gp[:, 1] > y0 + 0.13 * H) & (gp[:, 2] < z_arm) & (gp[:, 2] > z_crotch - 0.05 * H)
G[behind, col['Hips']] += G[behind][:, LEG].sum(1)
G[np.ix_(behind, LEG)] = 0
G /= np.maximum(G.sum(1, keepdims=True), 1e-9)
ax, gz = np.abs(gp[:, 0]), gp[:, 2]
inner_top = (ax < 0.9 * sh) & (gz > z_arm + 0.04 * H) & ~locked
moved = G[inner_top][:, ARM].sum(1)
G[np.ix_(inner_top, ARM)] = 0
G[inner_top, col['Chest']] += moved
hip_band = (gz > z_crotch - 0.03 * H) & (gz < z_crotch + 0.18 * H)
sh_band = (ax > 0.55 * sh) & (ax < 1.35 * sh) & (gz > z_arm - 0.1 * H) & (gz < z_arm + 0.14 * H)
zone = (hip_band | sh_band) & ~locked
for _ in range(12):
    nb = nbmean(G)
    G[zone] = 0.5 * G[zone] + 0.5 * nb[zone]
print('smoothed', int(zone.sum()), 'welded vertices; shoulder tops off the arm', int(inner_top.sum()), '; behind the hips', int(behind.sum()))
OW = G[wid]
for i in range(len(OW)):
    row = OW[i]
    if (row > 0).sum() > 4:
        row[np.argsort(row)[:-4]] = 0
    s = row.sum()
    OW[i] = row / s if s > 0 else np.eye(len(names))[col['Hips']]
print('head zone', head_zone, 'torso core', torso_core)
for g in list(mesh.vertex_groups):
    mesh.vertex_groups.remove(g)
groups = {n: mesh.vertex_groups.new(name=n) for n in names}
for i in range(len(OW)):
    for j in np.nonzero(OW[i])[0]:
        groups[names[j]].add([i], float(OW[i, j]), 'REPLACE')
mesh.parent = arm
mod = mesh.modifiers.new('Armature', 'ARMATURE')
mod.object = arm

# ---------------------------------------------------------------- clips
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='POSE')
pb = arm.pose.bones
for p in pb:
    p.rotation_mode = 'QUATERNION'
REST = {b.name: b.matrix_local.to_3x3().to_quaternion() for b in arm_data.bones}
AX = {'yaw': V((0, 0, 1)), 'lean': V((0, 1, 0)), 'nod': V((1, 0, 0))}


def turn(name, **deg):
    q = Quaternion()
    for k, a in deg.items():
        q = Quaternion(AX[k], math.radians(a)) @ q
    B = REST[name]
    return B.inverted() @ q @ B


def pin(chain_bone, end_bone):
    e = bpy.data.objects.new(f'pin_{end_bone}', None)
    scene.collection.objects.link(e)
    e.matrix_world = arm.matrix_world @ arm_data.bones[end_bone].matrix_local
    ik = pb[chain_bone].constraints.new('IK')
    ik.target = e
    ik.chain_count = 2
    ik.use_tail = True
    cr = pb[end_bone].constraints.new('COPY_TRANSFORMS')
    cr.target = e
    return e


sin, cos, tau = math.sin, math.cos, 2 * math.pi
DOWN = OVR.get('down', 68)  # arms lowered from the T-pose to hang at the sides


def arms(lr=-DOWN, ll=DOWN, nr=0, nl=0, fr=0, fl=0):
    return {
        'UpperArmR': (turn('UpperArmR', lean=lr, nod=nr), None),
        'UpperArmL': (turn('UpperArmL', lean=ll, nod=nl), None),
        'ForeArmR': (turn('ForeArmR', lean=fr), None),
        'ForeArmL': (turn('ForeArmL', lean=fl), None),
    }


def idle(u):
    t = u * tau
    d = arms(-DOWN + 2 * sin(t), DOWN - 2 * sin(t), fr=-8, fl=8)
    d.update({
        'Hips': (turn('Hips', lean=1.5 * sin(t)), V((0, 0, -0.006 * (0.5 - 0.5 * cos(2 * t))))),
        'Chest': (turn('Chest', nod=-1.5 * sin(2 * t)), None),
        'Head': (turn('Head', lean=-3 * sin(t + 0.8), yaw=3 * sin(t), nod=1.5 * sin(2 * t + 1)), None),
    })
    return d


def talk(u):
    t = u * tau
    d = arms(-DOWN + 8 + 10 * max(0, sin(2 * t)), DOWN - 4, nr=-25 * max(0, sin(2 * t)), fr=-25 - 20 * max(0, sin(2 * t)), fl=8)
    d.update({
        'Hips': (turn('Hips', lean=1.5 * sin(t)), None),
        'Chest': (turn('Chest', yaw=4 * sin(t)), None),
        'Head': (turn('Head', nod=5 * sin(4 * t), lean=-4 * sin(t + 0.5), yaw=5 * sin(t)), None),
    })
    return d


def wave(u):
    t = u * tau
    d = arms(-DOWN, DOWN, fl=8)
    # Upper arm out and a little up, forearm raised, waving from the elbow.
    d['UpperArmR'] = (turn('UpperArmR', lean=18, nod=-12), None)
    d['ForeArmR'] = (turn('ForeArmR', lean=55 + 22 * sin(2 * t)), None)
    d.update({
        'Hips': (turn('Hips', lean=2 * sin(t)), None),
        'Head': (turn('Head', lean=-6 * sin(t + 0.4), nod=-3), None),
    })
    return d


def cheer(u):
    t = u * tau
    hop = 0.5 - 0.5 * cos(2 * t)
    up = 28 + 12 * hop          # arms up in a V, clear of the head
    d = arms(up, -up, nr=-10, nl=-10, fr=25 + 15 * hop, fl=-25 - 15 * hop)
    d.update({
        'Hips': (turn('Hips', lean=3 * sin(t)), V((0, 0, -0.03 * H * hop))),
        'Chest': (turn('Chest', nod=-4 * hop), None),
        'Head': (turn('Head', nod=-8 * hop, lean=-4 * sin(t)), None),
    })
    return d


def stride(u, amp, bob, arm_amp):
    t = u * tau
    d = arms(-DOWN, DOWN, nr=arm_amp * sin(t), nl=-arm_amp * sin(t), fr=-10, fl=10)
    d.update({
        'Hips': (turn('Hips', yaw=6 * sin(t)), V((0, 0, -bob * H * (0.5 - 0.5 * cos(2 * t))))),
        'Chest': (turn('Chest', yaw=-8 * sin(t)), None),
        'Head': (turn('Head', yaw=3 * sin(t), nod=2 * sin(2 * t)), None),
        'ThighR': (turn('ThighR', nod=amp * sin(t)), None),
        'ThighL': (turn('ThighL', nod=-amp * sin(t)), None),
        'ShinR': (turn('ShinR', nod=-amp * 0.9 * max(0, -sin(t + 0.6))), None),
        'ShinL': (turn('ShinL', nod=-amp * 0.9 * max(0, sin(t + 0.6))), None),
    })
    return d


CLIPDEFS = {
    'Idle': (120, idle, True), 'Talk': (90, talk, True), 'Wave': (60, wave, True), 'Cheer': (40, cheer, True),
    'Walk': (32, lambda u: stride(u, 28, 0.012, 22), False), 'Run': (20, lambda u: stride(u, 45, 0.03, 40), False),
}


def key_action(name, frames, fn):
    act = bpy.data.actions.new(name)
    arm.animation_data_create()
    arm.animation_data.action = act
    for f in range(frames + 1):
        scene.frame_set(f)
        for p in pb:
            p.rotation_quaternion = Quaternion()
            p.location = V()
        for bname, (q, loc) in fn(f / frames).items():
            pb[bname].rotation_quaternion = q
            if loc is not None:
                pb[bname].location = REST[bname].inverted() @ loc
        for p in pb:
            p.keyframe_insert('rotation_quaternion', frame=f)
            p.keyframe_insert('location', frame=f)
    return act


for p in pb:
    if hasattr(p, 'select'):
        p.select = True
    else:
        p.bone.select = True
baked = []
for name in CLIPS_WANTED:
    frames, fn, pinned = CLIPDEFS[name]
    pins = [pin('ShinL', 'FootL'), pin('ShinR', 'FootR')] if pinned else []
    raw = key_action(name + '_raw', frames, fn)
    bpy.ops.nla.bake(frame_start=0, frame_end=frames, step=1, only_selected=True, visual_keying=True,
                     clear_constraints=False, clear_parents=False, use_current_action=False, bake_types={'POSE'})
    act = arm.animation_data.action
    act.name = name
    act.use_fake_user = True
    baked.append(act)
    bpy.data.actions.remove(raw)
    for p in pb:
        for c in list(p.constraints):
            p.constraints.remove(c)
    for e in pins:
        bpy.data.objects.remove(e)
arm.animation_data.action = None
bpy.ops.object.mode_set(mode='OBJECT')
for im in bpy.data.images:
    n = im.name.lower()
    if 'basecolor' in n and im.size[0] > 2048:
        im.scale(2048, 2048)
    elif ('normal' in n or '_rm' in n) and im.size[0] > 1024:
        im.scale(1024, 1024)
bpy.ops.wm.save_as_mainfile(filepath=out_glb.replace('.glb', '.blend'))
bpy.ops.object.select_all(action='DESELECT')
arm.select_set(True)
mesh.select_set(True)
bpy.ops.export_scene.gltf(filepath=out_glb, export_format='GLB', use_selection=True, export_animations=True,
                          export_animation_mode='ACTIONS', export_skins=True, export_all_influences=False,
                          export_image_format='JPEG', export_jpeg_quality=86, export_yup=True,
                          export_force_sampling=True, export_frame_range=False)
print('EXPORTED', out_glb, [a.name for a in baked])
