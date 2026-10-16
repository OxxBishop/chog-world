"""
A new texture layout for a cast model whose atlas wastes most of its space (the singer: 27% used, much of it
on the stage disc under its feet), in Blender:
  blender --background --python tools/models/fix/relayout.py -- <in.glb> <out dir> [head=2] [stage=0.15] [unwrap=66]

unwrap=<degrees>: a new unwrap first (the surface welded, projected at that angle limit, then each island
relaxed angle-based), for a model cut into thousands of tiny islands; without it the model's own islands.
Each island is scaled by how much it matters (the head's get `head` times the area, the stage's, held by
Root alone, `stage` times), then all are packed as tightly as Blender can.
Writes <out>/corners.bin: per triangle corner, in glTF order: triangle (int32), glTF vertex (int32), u, v
(float32, glTF convention); the same layout atlas.py writes. relayout_tex.py resamples the textures into it.
"""
import bpy, bmesh, sys, os, math, struct

argv = sys.argv[sys.argv.index('--') + 1:]
src, out = argv[0], argv[1]
opts = dict(a.split('=', 1) for a in argv[2:])
HEAD = float(opts.get('head', 2))
STAGE = float(opts.get('stage', 0.15))
UNWRAP = float(opts['unwrap']) if 'unwrap' in opts else None
os.makedirs(out, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src, merge_vertices=False)
obj = max((o for o in bpy.data.objects if o.type == 'MESH'), key=lambda o: len(o.data.vertices))
me = obj.data
print('verts', len(me.vertices), 'polys', len(me.polygons))
groups = {g.name: g.index for g in obj.vertex_groups}
# Each corner's own glTF vertex, which survives welding (a welded vertex stands for several).
me.attributes.new('corner_vtx', 'INT', 'CORNER')
cv = me.attributes['corner_vtx'].data
for li, l in enumerate(me.loops):
    cv[li].value = l.vertex_index
me.attributes.new('tri_id', 'INT', 'FACE')
for i, d in enumerate(me.attributes['tri_id'].data):
    d.value = i
if UNWRAP is not None:
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=1e-5)
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(UNWRAP), island_margin=0.002, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.seams_from_islands()
    bpy.ops.uv.unwrap(method='ANGLE_BASED', margin=0.002)
    bpy.ops.object.mode_set(mode='OBJECT')
    me = obj.data
    print('welded to', len(me.vertices), 'verts')

def weight(v, name):
    gi = groups.get(name)
    return sum(g.weight for g in v.groups if g.group == gi) if gi is not None else 0.0

bm = bmesh.new()
bm.from_mesh(me)
bm.faces.ensure_lookup_table()
lay = bm.loops.layers.uv.active
# Each face's share of the atlas: the head's bigger, the stage's smaller.
def face_k(f):
    if all(weight(me.vertices[v.index], 'Root') > 0.6 for v in f.verts):
        return STAGE
    if any(weight(me.vertices[v.index], 'Head') > 0.5 for v in f.verts):
        return HEAD
    return 1.0

# UV islands: faces joined across an edge whose two corners match in UV on both sides.
seen = set()
islands = []
for f in bm.faces:
    if f.index in seen:
        continue
    stack, isl = [f], []
    seen.add(f.index)
    while stack:
        g = stack.pop()
        isl.append(g)
        for l in g.loops:
            e = l.edge
            for h in e.link_faces:
                if h.index in seen:
                    continue
                a = {x.vert.index: x[lay].uv.copy() for x in g.loops if x.vert in e.verts}
                b = {x.vert.index: x[lay].uv.copy() for x in h.loops if x.vert in e.verts}
                if len(a) == 2 and a.keys() == b.keys() and all((a[k] - b[k]).length < 1e-6 for k in a):
                    seen.add(h.index)
                    stack.append(h)
    islands.append(isl)
print('islands', len(islands))
for isl in islands:
    ks = [face_k(f) for f in isl]
    # An island takes the biggest share any of its faces asks for (a face's head and neck share one).
    k = math.sqrt(max(ks))
    n = sum(len(f.loops) for f in isl)
    cx = sum(l[lay].uv.x for f in isl for l in f.loops) / n
    cy = sum(l[lay].uv.y for f in isl for l in f.loops) / n
    for f in isl:
        for l in f.loops:
            l[lay].uv.x = cx + (l[lay].uv.x - cx) * k
            l[lay].uv.y = cy + (l[lay].uv.y - cy) * k
bm.to_mesh(me)
bm.free()

bpy.context.view_layer.objects.active = obj
obj.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.context.scene.tool_settings.use_uv_select_sync = True
ok = False
for kw in (dict(rotate=True, rotate_method='ANY', scale=True, merge_overlap=False, margin_method='FRACTION', margin=0.003, shape_method='CONCAVE'),
           dict(rotate=True, scale=True, margin=0.003)):
    try:
        bpy.ops.uv.pack_islands(**kw)
        ok = True
        break
    except TypeError as e:
        print('pack_islands', e)
bpy.ops.object.mode_set(mode='OBJECT')
assert ok

# Per corner, in glTF order (the importer keeps the glTF's vertices and triangles, merge_vertices=False).
uvl = me.uv_layers.active.data
cv = me.attributes['corner_vtx'].data
tid = me.attributes['tri_id'].data
with open(os.path.join(out, 'corners.bin'), 'wb') as fh:
    for p in sorted(me.polygons, key=lambda p: tid[p.index].value):
        assert p.loop_total == 3
        for li in range(p.loop_start, p.loop_start + 3):
            u, v = uvl[li].uv
            fh.write(struct.pack('<iiff', tid[p.index].value, cv[li].value, u, 1.0 - v))
area = 0.0
for p in me.polygons:
    a, b, c = (uvl[li].uv for li in range(p.loop_start, p.loop_start + 3))
    area += abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2
print('UV used', round(area, 3))
