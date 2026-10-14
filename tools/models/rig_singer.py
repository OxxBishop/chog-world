"""
Rig the Tripo singer: one skinned mesh (stage and mic stand pinned to Root), bones named the way
chog.js expects (Head, Spine, HandR ...), clips Idle / Sing / Cheer / Wave. Scaled so the Chog is
2.2 m tall, stage bottom on the origin, facing +z in glTF.

blender -b --factory-startup -P rig.py -- <in.glb> <out.glb> <out.blend>
"""
import bpy, bmesh, sys, math, colorsys
import numpy as np
from mathutils import Vector, Quaternion, Matrix
from mathutils.kdtree import KDTree

src, out_glb, out_blend = sys.argv[sys.argv.index('--') + 1:][:3]
S = 2.2 / (0.638 - 0.065)          # Chog (stage top to spike tips) becomes 2.2 m
FPS = 30

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
scene = bpy.context.scene
scene.render.fps = FPS
mesh = [o for o in bpy.data.objects if o.type == 'MESH'][0]
for o in list(bpy.data.objects):
    if o is not mesh:
        bpy.data.objects.remove(o)
mesh.parent = None
mesh.name = mesh.data.name = 'Singer'
bpy.context.view_layer.objects.active = mesh
mesh.select_set(True)
mesh.scale = (S, S, S)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

V = lambda x, y, z: Vector((x * S, y * S, z * S))

# ---------------------------------------------------------------- skeleton (model units x S)
BONES = [
    # name, parent, head, tail
    ('Root', None, (0, 0, 0), (0, 0, 0.05)),
    ('Hips', 'Root', (0.005, 0, 0.165), (0.005, 0, 0.20)),
    ('Spine', 'Hips', (0.005, 0, 0.20), (0.005, -0.002, 0.25)),
    ('Chest', 'Spine', (0.005, -0.002, 0.25), (0.005, -0.006, 0.295)),
    ('Neck', 'Chest', (0.005, -0.006, 0.295), (0.005, -0.01, 0.322)),
    ('Head', 'Neck', (0.005, -0.01, 0.322), (0.005, -0.01, 0.60)),
    ('UpperArmR', 'Chest', (-0.055, -0.01, 0.285), (-0.075, -0.065, 0.255)),
    ('ForeArmR', 'UpperArmR', (-0.075, -0.065, 0.255), (-0.05, -0.112, 0.255)),
    ('HandR', 'ForeArmR', (-0.05, -0.112, 0.255), (-0.03, -0.14, 0.27)),
    ('UpperArmL', 'Chest', (0.065, -0.015, 0.29), (0.097, -0.07, 0.30)),
    ('ForeArmL', 'UpperArmL', (0.097, -0.07, 0.30), (0.12, -0.112, 0.31)),
    ('HandL', 'ForeArmL', (0.12, -0.112, 0.31), (0.132, -0.14, 0.316)),
    ('ThighR', 'Hips', (-0.028, 0, 0.165), (-0.028, -0.004, 0.115)),
    ('ShinR', 'ThighR', (-0.028, -0.004, 0.115), (-0.028, -0.006, 0.075)),
    ('FootR', 'ShinR', (-0.028, -0.006, 0.075), (-0.028, -0.045, 0.07)),
    ('ThighL', 'Hips', (0.038, 0, 0.165), (0.038, -0.004, 0.115)),
    ('ShinL', 'ThighL', (0.038, -0.004, 0.115), (0.038, -0.006, 0.075)),
    ('FootL', 'ShinL', (0.038, -0.006, 0.075), (0.038, -0.045, 0.07)),
]
arm_data = bpy.data.armatures.new('SingerRig')
arm = bpy.data.objects.new('SingerRig', arm_data)
scene.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
for name, parent, h, t in BONES:
    b = arm_data.edit_bones.new(name)
    b.head, b.tail = V(*h), V(*t)
    b.roll = 0
    if parent:
        b.parent = arm_data.edit_bones[parent]
        b.use_connect = (b.parent.tail - b.head).length < 1e-6
    b.use_deform = name != 'Root' or True
bpy.ops.object.mode_set(mode='OBJECT')

# ---------------------------------------------------------------- what stays still, what is the mic
img = [i for i in bpy.data.images if 'basecolor' in i.name.lower()][0]
small = img.copy()
small.scale(1024, 1024)
px = np.empty(1024 * 1024 * 4, np.float32)
small.pixels.foreach_get(px)
px = px.reshape(1024, 1024, 4)
bpy.data.images.remove(small)
me = mesh.data
uvl = me.uv_layers.active.data
vuv = {}
for poly in me.polygons:
    for li in poly.loop_indices:
        vuv.setdefault(me.loops[li].vertex_index, uvl[li].uv.copy())


def hsv(vi):
    u, v = vuv.get(vi, (0, 0))
    r, g, b = px[min(1023, max(0, int(v * 1024))), min(1023, max(0, int(u * 1024))), :3]
    return colorsys.rgb_to_hsv(r, g, b)


POLE = Vector((0.145, -0.155))
static, mic = set(), set()
for v in me.vertices:
    p = v.co / S
    h, s, val = hsv(v.index)
    gray = s < 0.18 and 0.12 < val < 0.92
    d_pole = (Vector((p.x, p.y)) - POLE).length
    if p.z < 0.068:                                          # the stage (and the soles, which never move)
        static.add(v.index)
    elif p.z < 0.085 and not (-0.075 < p.x < 0.09 and -0.1 < p.y < 0.07):  # confetti and paper on the stage
        static.add(v.index)
    elif p.z < 0.085 and d_pole < 0.045:                     # the stand's foot
        static.add(v.index)
    elif d_pole < 0.016 and p.z < 0.275:                     # the pole
        static.add(v.index)
    elif gray and p.x > 0.06 and p.z > 0.24 and p.y < -0.1:  # the stand's microphone
        static.add(v.index)
    elif gray and p.x < 0.05 and p.y < -0.06 and 0.19 < p.z < 0.35:  # the hand-held microphone
        mic.add(v.index)
# The hand-held mic is a straight stick: keep only grey verts close to its axis, so grey teeth and
# stray grey texels elsewhere never ride along with the hand.
if mic:
    pts = np.array([tuple(me.vertices[i].co / S) for i in mic])
    c0 = np.median(pts, 0)
    core = pts[np.linalg.norm(pts - c0, axis=1) < 0.08]
    c0 = core.mean(0)
    axis = np.linalg.svd(core - c0)[2][0]
    rel = pts - c0
    radial = np.linalg.norm(rel - np.outer(rel @ axis, axis), axis=1)
    ids = list(mic)
    mic = {ids[k] for k in range(len(ids)) if radial[k] < 0.024}
    print('mic axis', axis.round(3), 'centre', c0.round(3))
print('static', len(static), 'mic', len(mic), 'of', len(me.vertices))

# ---------------------------------------------------------------- weights: bone heat on a welded copy
weld = mesh.copy()
weld.data = mesh.data.copy()
weld.name = 'weld'
scene.collection.objects.link(weld)
bm = bmesh.new()
bm.from_mesh(weld.data)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0004 * S)
bm.to_mesh(weld.data)
bm.free()
bpy.ops.object.select_all(action='DESELECT')
weld.select_set(True)
arm.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
names = [b.name for b in arm_data.bones]
wverts = weld.data.vertices
gidx = {g.index: g.name for g in weld.vertex_groups}
W = np.zeros((len(wverts), len(names)))
col = {n: i for i, n in enumerate(names)}
for v in wverts:
    for g in v.groups:
        n = gidx[g.group]
        if n in col:
            W[v.index, col[n]] = g.weight
empty = np.where(W.sum(1) < 1e-6)[0]
print('welded verts without weights:', len(empty))
if len(empty):
    kd = KDTree(len(wverts) - len(empty))
    have = [i for i in range(len(wverts)) if W[i].sum() >= 1e-6]
    for i in have:
        kd.insert(wverts[i].co, i)
    kd.balance()
    for i in empty:
        W[i] = W[kd.find(wverts[i].co)[1]]
kd = KDTree(len(wverts))
for v in wverts:
    kd.insert(v.co, v.index)
kd.balance()
OW = np.array([W[kd.find(v.co)[1]] for v in me.vertices])
bpy.data.objects.remove(weld)

# The head zone: bone heat lets the shoulders claim the lower hood and the chin (the chibi head sits
# nearer the shoulders than the head bone's middle, and the mic hand touches the chin in the sculpt).
# Everything above the neck that isn't arm or hand follows the head and neck only, blended at the neck.
from mathutils.geometry import intersect_point_line


def seg_dist(co, bname):
    b = arm_data.bones[bname]
    _, f = intersect_point_line(co, b.head_local, b.tail_local)
    f = min(1.0, max(0.0, f))
    return (co - (b.head_local + (b.tail_local - b.head_local) * f)).length / S


ARM_L = [col[n] for n in ('UpperArmL', 'ForeArmL', 'HandL')]
ARM_R = [col[n] for n in ('UpperArmR', 'ForeArmR', 'HandR')]
head_zone = 0
for v in me.vertices:
    p = v.co / S
    if p.z < 0.288 or v.index in static or v.index in mic:
        continue
    near_l = min(seg_dist(v.co, n) for n in ('UpperArmL', 'ForeArmL', 'HandL')) < 0.034 and p.x > 0.05
    near_r = (min(seg_dist(v.co, n) for n in ('ForeArmR', 'HandR')) < 0.028 or seg_dist(v.co, 'UpperArmR') < 0.026) and p.x < 0.02
    if near_l or near_r:
        continue
    head_zone += 1
    k = min(1.0, max(0.0, (p.z - 0.292) / 0.04))       # 0 at the neck, 1 from the chin up
    row = np.zeros(len(names))
    row[col['Head']] = k
    row[col['Neck']] = (1 - k) * 0.65
    row[col['Chest']] = (1 - k) * 0.35
    OW[v.index] = row
print('head zone verts', head_zone)

# The torso core: the forearms rest on the belly in the sculpt, so heat lets the arms claim it. Inside
# the torso's cross-section, and clear of the arm bones themselves, only the spine bones count.
SPINE = [col[n] for n in ('Hips', 'Spine', 'Chest', 'Neck')]
torso = 0
for v in me.vertices:
    p = v.co / S
    if not (0.17 < p.z < 0.292) or v.index in static or v.index in mic:
        continue
    if ((p.x - 0.01) / 0.074) ** 2 + ((p.y + 0.005) / 0.07) ** 2 >= 1:
        continue
    if min(seg_dist(v.co, n) for n in ('UpperArmR', 'ForeArmR', 'HandR', 'UpperArmL', 'ForeArmL', 'HandL')) < 0.021:
        continue
    row = OW[v.index].copy()
    row[ARM_L + ARM_R] = 0
    if row[SPINE].sum() < 0.05:
        k = min(1.0, max(0.0, (p.z - 0.2) / 0.08))
        row[:] = 0
        row[col['Spine']] = 1 - k
        row[col['Chest']] = k
    OW[v.index] = row / row.sum()
    torso += 1
print('torso core verts', torso)

root, handr = col['Root'], col['HandR']
for i in static:
    OW[i] = 0
    OW[i, root] = 1
for i in mic:
    OW[i] = 0
    OW[i, handr] = 1
OW[:, root] = np.where(np.isin(np.arange(len(OW)), list(static)), OW[:, root], 0)  # Root only for pinned parts
# Four influences at most, normalised.
for i in range(len(OW)):
    row = OW[i]
    if (row > 0).sum() > 4:
        row[np.argsort(row)[:-4]] = 0
    s = row.sum()
    OW[i] = row / s if s > 0 else np.eye(len(names))[col['Hips']]

for g in list(mesh.vertex_groups):
    mesh.vertex_groups.remove(g)
groups = {n: mesh.vertex_groups.new(name=n) for n in names}
for i in range(len(OW)):
    for j in np.nonzero(OW[i])[0]:
        groups[names[j]].add([i], float(OW[i, j]), 'REPLACE')
mesh.parent = arm
mod = mesh.modifiers.new('Armature', 'ARMATURE')
mod.object = arm
np.save(out_glb.replace('.glb', '_weights.npy'), OW)

# ---------------------------------------------------------------- pins (baked into the clips)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='POSE')
pb = arm.pose.bones
for p in pb:
    p.rotation_mode = 'QUATERNION'


def pin(chain_bone, end_bone, n):
    e = bpy.data.objects.new(f'pin_{end_bone}', None)
    scene.collection.objects.link(e)
    bone = arm_data.bones[end_bone]
    e.matrix_world = arm.matrix_world @ bone.matrix_local
    ik = pb[chain_bone].constraints.new('IK')
    ik.target = e
    ik.chain_count = n
    ik.use_tail = True
    # The IK aims the chain's tip at the empty's origin, which is the end bone's head.
    cr = pb[end_bone].constraints.new('COPY_TRANSFORMS')
    cr.target = e
    return e


pins = [pin('ShinL', 'FootL', 2), pin('ShinR', 'FootR', 2), pin('ForeArmL', 'HandL', 2)]

REST = {b.name: b.matrix_local.to_3x3().to_quaternion() for b in arm_data.bones}
AX = {'yaw': Vector((0, 0, 1)), 'lean': Vector((0, 1, 0)), 'nod': Vector((1, 0, 0))}


def turn(name, **deg):
    """Rotation of a bone relative to its parent, given about the model's own axes (degrees)."""
    q = Quaternion()
    for k, a in deg.items():
        q = Quaternion(AX[k], math.radians(a)) @ q
    B = REST[name]
    return B.inverted() @ q @ B


def key_action(name, frames, pose_at):
    act = bpy.data.actions.new(name)
    arm.animation_data_create()
    arm.animation_data.action = act
    for f in range(frames + 1):
        scene.frame_set(f)
        for p in pb:
            p.rotation_quaternion = Quaternion()
            p.location = Vector()
        for bname, (q, loc) in pose_at(f / frames).items():
            pb[bname].rotation_quaternion = q
            if loc is not None:
                # loc is in model space: turn it into the bone's own axes.
                pb[bname].location = REST[bname].inverted() @ loc
        for p in pb:
            p.keyframe_insert('rotation_quaternion', frame=f)
            p.keyframe_insert('location', frame=f)
    return act


two_pi = 2 * math.pi
sin = math.sin
cos = math.cos


def idle(u):
    t = u * two_pi
    return {
        'Hips': (turn('Hips', lean=1.2 * sin(t)), Vector((0, 0, -0.004 * (0.5 - 0.5 * cos(2 * t))))),
        'Chest': (turn('Chest', nod=-1.2 * sin(2 * t)), None),
        'Head': (turn('Head', lean=-2.5 * sin(t + 0.8), yaw=2.0 * sin(t), nod=1.0 * sin(2 * t + 1)), None),
        'UpperArmR': (turn('UpperArmR', nod=1.5 * sin(2 * t)), None),
    }


# Tripo fused the mic hand to the chin and the forearms to the belly, so the arms keep their sculpted
# pose relative to the chest (big arm swings would stretch that skin). The performance comes from the
# hips, knees, chest and head; the left hand stays on the stand's mic.
def sing(u):
    t = u * two_pi            # one bar
    beat = 4 * t              # four beats a bar
    dip = 0.5 - 0.5 * cos(beat)
    return {
        'Hips': (turn('Hips', yaw=7 * sin(t), lean=4.5 * sin(t)), Vector((0.014 * sin(t), 0, -0.035 * dip))),
        'Spine': (turn('Spine', lean=-2.5 * sin(t), nod=1.5 * dip), None),
        'Chest': (turn('Chest', yaw=3 * sin(t + 0.5), nod=-1.5 * dip), None),
        'Neck': (turn('Neck', lean=-2 * sin(t + 0.6)), None),
        'Head': (turn('Head', lean=-4 * sin(t + 0.6), nod=3 * sin(beat), yaw=3 * sin(t)), None),
    }


def cheer(u):
    t = u * two_pi            # two bounces a loop
    hop = 0.5 - 0.5 * cos(2 * t)
    return {
        'Hips': (turn('Hips', yaw=9 * sin(t), lean=6 * sin(t)), Vector((0.02 * sin(t), 0, -0.06 * hop))),
        'Spine': (turn('Spine', lean=-3 * sin(t), nod=3 * hop), None),
        'Chest': (turn('Chest', nod=-4 * hop, yaw=4 * sin(t)), None),
        'Neck': (turn('Neck', nod=-2 * hop), None),
        'Head': (turn('Head', lean=-5 * sin(t + 0.4), nod=-5 * hop + 2), None),
    }


CLIPS = [('Idle', 120, idle), ('Sing', 72, sing), ('Cheer', 40, cheer)]
for p in pb:
    if hasattr(p, 'select'):
        p.select = True
    else:
        p.bone.select = True
baked = []
for name, frames, fn in CLIPS:
    raw = key_action(name + '_raw', frames, fn)
    scene.frame_start, scene.frame_end = 0, frames
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
for a in bpy.data.actions:
    print('ACTION', a.name, a.frame_range[:])

# ---------------------------------------------------------------- lighter textures for the web
for im in bpy.data.images:
    n = im.name.lower()
    if 'basecolor' in n and im.size[0] > 2048:
        im.scale(2048, 2048)
    elif ('normal' in n or '_rm' in n) and im.size[0] > 1024:
        im.scale(1024, 1024)

bpy.ops.wm.save_as_mainfile(filepath=out_blend)
bpy.ops.object.select_all(action='DESELECT')
arm.select_set(True)
mesh.select_set(True)
bpy.ops.export_scene.gltf(filepath=out_glb, export_format='GLB', use_selection=True, export_animations=True,
                          export_animation_mode='ACTIONS', export_skins=True, export_all_influences=False,
                          export_image_format='JPEG', export_jpeg_quality=86, export_yup=True,
                          export_force_sampling=True, export_frame_range=False)
print('EXPORTED', out_glb)
