"""
New skin weights for a cast model, in Blender:
  blender --background --python tools/models/fix/reskin.py -- <in.glb> <out_dir> [bones.json] [keep.u8]

Tripo's auto-rig weights switch from one bone to the next in a hard, jagged line, so the shoulders tear
into flaps when the arms come down (the shark's "things behind the arms", the King's sleeves) and robes
tear when the legs move. Blender's bone heat weights spread each bone's pull smoothly over the surface.
The mesh is welded first (Tripo splits it along every UV seam, which heat weighting would treat as cuts),
weighted, and the weights copied back to every glTF vertex. Root and Hips keep no automatic weights of
their own beyond what heat gives Hips; Root never deforms.

bones.json: the skin's joint names in order (from dump.mjs model.json). keep.u8: one byte per triangle,
0 for triangles that are being dropped from the model. Writes joints.f32 and
weights.f32 (4 per vertex, the dump's vertex order).
"""
import bpy, bmesh, sys, os, json, struct
from mathutils import kdtree

argv = sys.argv[sys.argv.index('--') + 1:]
src, out = argv[0], argv[1]
names = json.load(open(argv[2])) if len(argv) > 2 else None
keep = open(argv[3], 'rb').read() if len(argv) > 3 else None
os.makedirs(out, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src, merge_vertices=False)
obj = max((o for o in bpy.data.objects if o.type == 'MESH'), key=lambda o: len(o.data.vertices))
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
arm.data.pose_position = 'REST'
n = len(obj.data.vertices)

# A welded copy, unparented, at the same place.
weld = obj.copy()
weld.data = obj.data.copy()
bpy.context.scene.collection.objects.link(weld)
weld.parent = None
weld.matrix_world = obj.matrix_world.copy()
for m in list(weld.modifiers):
    weld.modifiers.remove(m)
weld.vertex_groups.clear()
bm = bmesh.new()
bm.from_mesh(weld.data)
if keep:
    # Triangles that leave the model (the singer's stage) take no part in the weighting.
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if not keep[f.index]], context='FACES')
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
bm.to_mesh(weld.data)
bm.free()
print('welded', n, '->', len(weld.data.vertices))

for b in arm.data.bones:
    b.use_deform = b.name not in ('Root',)
bpy.ops.object.select_all(action='DESELECT')
weld.select_set(True)
arm.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
groups = {g.index: g.name for g in weld.vertex_groups}

kd = kdtree.KDTree(len(weld.data.vertices))
for v in weld.data.vertices:
    kd.insert(weld.matrix_world @ v.co, v.index)
kd.balance()
orig = {g.index: g.name for g in obj.vertex_groups}
names = names or [b.name for b in arm.data.bones]
J = []
Wt = []
fallback = 0
for v in obj.data.vertices:
    co, wi, d = kd.find(obj.matrix_world @ v.co)
    ws = [(groups[g.group], g.weight) for g in weld.data.vertices[wi].groups if g.weight > 1e-4]
    if not ws:
        fallback += 1
        ws = [(orig[g.group], g.weight) for g in v.groups if g.weight > 1e-4]
    ws = sorted(ws, key=lambda x: -x[1])[:4]
    tot = sum(w for _, w in ws) or 1
    ws = [(names.index(nm), w / tot) for nm, w in ws] + [(0, 0.0)] * (4 - len(ws))
    J.append([j for j, _ in ws])
    Wt.append([w for _, w in ws])
with open(os.path.join(out, 'joints.f32'), 'wb') as f:
    for r in J:
        f.write(struct.pack('<4f', *r))
with open(os.path.join(out, 'weights.f32'), 'wb') as f:
    for r in Wt:
        f.write(struct.pack('<4f', *r))
print('reskinned', n, 'vertices;', fallback, 'kept their old weights (no heat solution)')
