"""
Rigs for the two Tripo characters that aren't in a T-pose. The arms stay in their sculpted pose and ride
on the chest; the body bends through a spine chain weighted smoothly by height, and the dino's legs run.

  sniffer: the Chog with a dandelion in its hand, next to a clump of flowers (the clump stays still).
           Clips: Idle, Sniff.
  dino:    the dino-suit Chog with its arms up. The loose toy blocks at its feet are removed (the game
           has its own block). Clips: Idle, Run.

blender -b --factory-startup -P rig_simple.py -- <in> <out.glb> <sniffer|dino>
"""
import bpy, bmesh, sys, math
import numpy as np
from mathutils import Vector, Quaternion
from mathutils.kdtree import KDTree

src, out_glb, mode = sys.argv[sys.argv.index('--') + 1:][:3]
H = 2.2
bpy.ops.wm.read_factory_settings(use_empty=True)
(bpy.ops.import_scene.fbx(filepath=src) if src.lower().endswith('.fbx') else bpy.ops.import_scene.gltf(filepath=src))
scene = bpy.context.scene
scene.render.fps = 30
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
for o in list(bpy.data.objects):
    if o.type != 'MESH':
        bpy.data.objects.remove(o)
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
mesh = bpy.context.view_layer.objects.active
mesh.parent = None
mesh.name = mesh.data.name = 'Chog'
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

if mode == 'sniffer':
    # 1.9M triangles down to a size the browser can carry.
    tris = sum(len(p.vertices) - 2 for p in mesh.data.polygons)
    dec = mesh.modifiers.new('dec', 'DECIMATE')
    dec.ratio = min(1.0, 60000 / tris)
    bpy.ops.object.modifier_apply(modifier='dec')
    print('decimated', tris, '->', sum(len(p.vertices) - 2 for p in mesh.data.polygons))


def components():
    """Connected parts (welded, so UV seams don't split them): per original vertex, a part id."""
    bm = bmesh.new()
    bm.from_mesh(mesh.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0008)
    bm.verts.ensure_lookup_table()
    comp = [-1] * len(bm.verts)
    cid = 0
    for v in bm.verts:
        if comp[v.index] >= 0:
            continue
        st = [v]
        comp[v.index] = cid
        while st:
            x = st.pop()
            for e in x.link_edges:
                y = e.other_vert(x)
                if comp[y.index] < 0:
                    comp[y.index] = cid
                    st.append(y)
        cid += 1
    kd = KDTree(len(bm.verts))
    for v in bm.verts:
        kd.insert(v.co, v.index)
    kd.balance()
    out = np.array([comp[kd.find(v.co)[1]] for v in mesh.data.vertices])
    bm.free()
    return out


comp = components()
co = np.array([tuple(v.co) for v in mesh.data.vertices])
ids = np.unique(comp)
box = {c: (co[comp == c].min(0), co[comp == c].max(0), int((comp == c).sum())) for c in ids}

if mode == 'dino':
    # The toy blocks: the loose bits in front of the right foot.
    # The block pieces, and any stray crumbs on the ground that aren't part of the feet.
    body_parts = sorted(box, key=lambda c: -box[c][2])[:2]
    def touches(c, k):
        (a0, a1, _), (b0, b1, _) = box[c], box[k]
        return all(a0[i] <= b1[i] + 0.01 and b0[i] <= a1[i] + 0.01 for i in range(3))
    blocks = [c for c, (mn, mx, n) in box.items() if (mx[2] < 0.17 and mx[1] < -0.06 and n < 400)
              or (mx[2] < 0.2 and n < 40 and not any(touches(c, k) for k in body_parts))]
    bm = bmesh.new()
    bm.from_mesh(mesh.data)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.verts[i] for i in np.where(np.isin(comp, blocks))[0]], context='VERTS')
    bm.to_mesh(mesh.data)
    bm.free()
    print('removed block parts', len(blocks))
    comp = components()
    co = np.array([tuple(v.co) for v in mesh.data.vertices])
    ids = np.unique(comp)
    box = {c: (co[comp == c].min(0), co[comp == c].max(0), int((comp == c).sum())) for c in ids}

# Which parts are the character, and how tall it is.
if mode == 'sniffer':
    body_c = max(ids, key=lambda c: box[c][1][2])                    # the Chog: the tallest part
    held = [c for c, (mn, mx, n) in box.items() if c != body_c and mn[0] > -0.12 and mx[0] < 0.05]
    still = [c for c in ids if c != body_c and c not in held]        # the flower clump
    char = np.isin(comp, [body_c] + held)
else:
    still = []
    held = []
    char = np.ones(len(co), bool)
cz0, cz1 = co[char][:, 2].min(), co[char][:, 2].max()
S = H / (cz1 - cz0)
cxy = co[comp == (body_c if mode == 'sniffer' else comp[0])].mean(0) if mode == 'sniffer' else co.mean(0)
mesh.location = (-cxy[0] * S, -cxy[1] * S, -cz0 * S)
mesh.scale = (S, S, S)
bpy.ops.object.transform_apply(location=True, scale=True)
co = np.array([tuple(v.co) for v in mesh.data.vertices])
body = co[np.isin(comp, [body_c]) if mode == 'sniffer' else np.ones(len(co), bool)]
bx, by = float(np.median(body[:, 0])), float(np.median(body[:, 1]))

# Crotch (dino only): the lowest point where the legs are still apart.
z_crotch = 0.15 * H
if mode == 'dino':
    for z in np.arange(0.03 * H, 0.35 * H, 0.005 * H):
        b = co[(co[:, 2] >= z) & (co[:, 2] < z + 0.006 * H) & (co[:, 1] < by + 0.05 * H)]
        xs = np.sort(b[:, 0])
        if len(xs) and not (np.diff(xs) > 0.012 * H).any():
            z_crotch = z
            break
    legs = co[(co[:, 2] < z_crotch) & (co[:, 1] < by + 0.05 * H)]
    foot_r = float(np.median(legs[legs[:, 0] < bx][:, 0]))
    foot_l = float(np.median(legs[legs[:, 0] >= bx][:, 0]))
print('crotch', round(z_crotch / H, 3))

hipz = z_crotch + 0.02 * H
V = Vector
BONES = [
    ('Root', None, (bx, by, 0), (bx, by, 0.08 * H)),
    ('Hips', 'Root', (bx, by, hipz), (bx, by, hipz + 0.08 * H)),
    ('Spine', 'Hips', (bx, by, hipz + 0.08 * H), (bx, by, 0.36 * H)),
    ('Chest', 'Spine', (bx, by, 0.36 * H), (bx, by, 0.46 * H)),
    ('Neck', 'Chest', (bx, by, 0.46 * H), (bx, by, 0.50 * H)),
    ('Head', 'Neck', (bx, by, 0.50 * H), (bx, by, 0.95 * H)),
]
if mode == 'dino':
    for side, lx in (('R', foot_r), ('L', foot_l)):
        BONES += [
            (f'Thigh{side}', 'Hips', (lx, by, hipz), (lx, by, hipz * 0.5)),
            (f'Shin{side}', f'Thigh{side}', (lx, by, hipz * 0.5), (lx, by, 0.04 * H)),
            (f'Foot{side}', f'Shin{side}', (lx, by, 0.04 * H), (lx, by - 0.08 * H, 0.02 * H)),
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
names = [b.name for b in arm_data.bones]
col = {n: i for i, n in enumerate(names)}


def smooth(a, b, x):
    k = min(1.0, max(0.0, (x - a) / (b - a)))
    return k * k * (3 - 2 * k)


# Weights by height: a smooth hand-off up the spine chain, so a lean bends the body like rubber.
CHAIN = [('Hips', hipz), ('Spine', 0.30 * H), ('Chest', 0.40 * H), ('Neck', 0.48 * H), ('Head', 0.55 * H)]
OW = np.zeros((len(co), len(names)))
head_part = None
if mode == 'dino':
    head_part = max([c for c in np.unique(comp)], key=lambda c: (co[comp == c][:, 2].mean() > 0.45 * H) * (comp == c).sum())
for i, p in enumerate(co):
    c = comp[i]
    if c in still:
        OW[i, col['Root']] = 1
        continue
    if c in held:
        OW[i, col['Chest']] = 1
        continue
    if mode == 'dino' and (c == head_part or co[comp == c][:, 2].mean() > 0.5 * H and (comp == c).sum() < 400):
        OW[i, col['Head']] = 1                      # the hood, eyes and teeth ride on the head
        continue
    z = p[2]
    if mode == 'dino' and z < z_crotch and p[1] < by + 0.06 * H:
        side = 'R' if p[0] < bx else 'L'
        k1 = smooth(0.0, 0.07 * H, z)              # foot -> shin
        k2 = smooth(0.07 * H, hipz * 0.6, z)        # shin -> thigh
        k3 = smooth(hipz * 0.8, hipz + 0.02 * H, z)  # thigh -> hips
        OW[i, col[f'Foot{side}']] = (1 - k1)
        OW[i, col[f'Shin{side}']] = k1 * (1 - k2)
        OW[i, col[f'Thigh{side}']] = k2 * (1 - k3)
        OW[i, col['Hips']] = k3
        continue
    if mode == 'sniffer' and z < hipz:
        OW[i, col['Root']] = 1                      # feet planted
        continue
    # Spine chain.
    zs = [h for _, h in CHAIN]
    for j in range(len(CHAIN)):
        lo = zs[j - 1] if j else -1
        hi = zs[j + 1] if j + 1 < len(CHAIN) else 1e9
        if j == 0:
            w = 1 - smooth(zs[0], zs[1], z)
        elif j == len(CHAIN) - 1:
            w = smooth(zs[j - 1], zs[j], z)
        else:
            w = smooth(lo, zs[j], z) * (1 - smooth(zs[j], hi, z))
        OW[i, col[CHAIN[j][0]]] += w
for i in range(len(OW)):
    s = OW[i].sum()
    OW[i] = OW[i] / s if s > 0 else np.eye(len(names))[col['Hips']]
groups = {n: mesh.vertex_groups.new(name=n) for n in names}
for i in range(len(OW)):
    for j in np.nonzero(OW[i])[0]:
        groups[names[j]].add([i], float(OW[i, j]), 'REPLACE')
mesh.parent = arm
mesh.modifiers.new('Armature', 'ARMATURE').object = arm

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


sin, cos, tau = math.sin, math.cos, 2 * math.pi
# The sniffer faces -x (toward its flowers): leaning toward them is a positive turn about +y.
if mode == 'sniffer':
    def idle(u):
        t = u * tau
        return {'Spine': (turn('Spine', lean=1.5 * sin(t)), None), 'Chest': (turn('Chest', yaw=2 * sin(t)), None),
                'Head': (turn('Head', lean=2.5 * sin(t + 0.7), yaw=3 * sin(t)), None)}

    def sniff(u):
        t = u * tau
        reach = 0.5 - 0.5 * cos(t)                  # lean in and back once per loop
        sn = max(0.0, sin(6 * t)) * reach           # quick sniffs while close
        return {'Spine': (turn('Spine', lean=6 * reach), None), 'Chest': (turn('Chest', lean=5 * reach), None),
                'Neck': (turn('Neck', lean=4 * reach), None),
                'Head': (turn('Head', lean=6 * reach + 3 * sn, nod=2 * sn), None)}
    CLIPS = [('Idle', 120, idle), ('Sniff', 96, sniff)]
else:
    def idle(u):
        t = u * tau
        return {'Hips': (turn('Hips', lean=1.5 * sin(t)), None), 'Chest': (turn('Chest', lean=-3 * sin(t), yaw=3 * sin(t)), None),
                'Head': (turn('Head', lean=-3 * sin(t + 0.6), nod=2 * sin(2 * t)), None)}

    def run(u):
        t = u * tau
        bob = 0.5 - 0.5 * cos(2 * t)
        return {'Hips': (turn('Hips', yaw=8 * sin(t)), V((0, 0, -0.035 * H * bob))),
                'Spine': (turn('Spine', nod=-6), None),
                'Chest': (turn('Chest', yaw=-10 * sin(t), lean=4 * sin(t)), None),
                'Head': (turn('Head', nod=4 * sin(2 * t) + 4, lean=-3 * sin(t)), None),
                'ThighR': (turn('ThighR', nod=28 * sin(t)), None), 'ThighL': (turn('ThighL', nod=-28 * sin(t)), None),
                'ShinR': (turn('ShinR', nod=-35 * max(0, -sin(t + 0.6))), None),
                'ShinL': (turn('ShinL', nod=-35 * max(0, sin(t + 0.6))), None)}
    CLIPS = [('Idle', 120, idle), ('Run', 20, run)]

for name, frames, fn in CLIPS:
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    arm.animation_data_create()
    arm.animation_data.action = act
    for f in range(frames + 1):
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
arm.animation_data.action = None
bpy.ops.object.mode_set(mode='OBJECT')
for im in bpy.data.images:
    if im.size[0] > 2048:
        im.scale(2048, 2048)
bpy.ops.object.select_all(action='DESELECT')
arm.select_set(True)
mesh.select_set(True)
bpy.ops.export_scene.gltf(filepath=out_glb, export_format='GLB', use_selection=True, export_animations=True,
                          export_animation_mode='ACTIONS', export_skins=True, export_all_influences=False,
                          export_image_format='JPEG', export_jpeg_quality=86, export_yup=True,
                          export_force_sampling=True, export_frame_range=False)
print('EXPORTED', out_glb, sum(len(p.vertices) - 2 for p in mesh.data.polygons), 'tris')
