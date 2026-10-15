# Blender (background): find the duck float's faces by their UV islands, the band where it meets the
# body, and bake ambient occlusion for the whole model. Writes duckfix/{ao.png, base.png, faces.json}.
import bpy, bmesh, json, os, sys
import numpy as np
from mathutils import kdtree, Vector
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'work')
os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=r'C:\Users\HP\Documents\chog-world\public\models\npcs\chog-66.glb')
for o in list(bpy.data.objects):
    if o.name.startswith('Icosphere'): bpy.data.objects.remove(o)
ob = bpy.data.objects['Chog']; me = ob.data
mat = me.materials[0]
bsdf = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
img = bsdf.inputs['Base Color'].links[0].from_node.image
W, H = img.size
px = np.array(img.pixels[:], dtype=np.float32).reshape(H, W, 4)  # rows bottom-up
img.filepath_raw = os.path.join(OUT, 'base.png'); img.file_format = 'PNG'; img.save()
bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table(); bm.verts.ensure_lookup_table()
uv = bm.loops.layers.uv.active
def col(u, v):
    x = min(W - 1, max(0, int(u * W))); y = min(H - 1, max(0, int(v * H)))
    return px[y, x, :3]
def is_yellow(c): return c[0] > 0.55 and c[1] > 0.4 and c[2] < 0.35 and c[0] - c[2] > 0.35
def is_purple(c): return c[2] > c[1] + 0.12 and c[0] > c[1] - 0.02 and c[2] > 0.18
# UV islands: faces joined across an edge whose two ends have the same UVs on both faces.
parent = list(range(len(bm.faces)))
def find(a):
    while parent[a] != a:
        parent[a] = parent[parent[a]]; a = parent[a]
    return a
for e in bm.edges:
    lf = e.link_faces
    if len(lf) != 2: continue
    f1, f2 = lf
    def uvs(f):
        d = {}
        for l in f.loops: d[l.vert.index] = tuple(round(x, 5) for x in l[uv].uv)
        return d
    a, b = uvs(f1), uvs(f2)
    if all(a[v.index] == b[v.index] for v in e.verts):
        parent[find(f1.index)] = find(f2.index)
islands = {}
for f in bm.faces: islands.setdefault(find(f.index), []).append(f.index)
# The float: its yellow faces below the chest, then grown into stained neighbours on its upper and
# lower surfaces (their normals point up or down; the body's sides face outward).
mw = ob.matrix_world
nm = mw.to_3x3().inverted().transposed()
ZTOP = 0.78
def zc(f): return (mw @ f.calc_center_median()).z
def nz(f): return (nm @ f.normal).normalized().z
def fc(f):
    cc = [col(*l[uv].uv) for l in f.loops]
    return sum(is_yellow(x) for x in cc) / len(cc)
duck = set(f.index for f in bm.faces if zc(f) < ZTOP and fc(f) > 0.5)
for it in range(10):
    grow = set()
    for fi in duck:
        for e in bm.faces[fi].edges:
            for g in e.link_faces:
                if g.index in duck or g.index in grow: continue
                if zc(g) < 0.64 and zc(g) > 0.3 and abs(nz(g)) > 0.35: grow.add(g.index)
    if not grow: break
    duck |= grow
    print('grow', it, len(grow))
print('duck faces', len(duck))
# The band where the float meets the body: duck verts next to body verts, and faces near them.
duckv = set(v.index for fi in duck for v in bm.faces[fi].verts)
bodyv = [v for v in bm.verts if v.index not in duckv]
kd = kdtree.KDTree(len(bodyv))
for v in bodyv: kd.insert(mw @ v.co, v.index)
kd.balance()
junction = [mw @ bm.verts[i].co for i in duckv if kd.find(mw @ bm.verts[i].co)[2] < 0.02]
kdj = kdtree.KDTree(len(junction))
for i, p in enumerate(junction): kdj.insert(p, i)
kdj.balance()
size = max(ob.dimensions)
print('junction points', len(junction), 'model size', round(size, 3))
band = []
for f in bm.faces:
    d = kdj.find(mw @ f.calc_center_median())[2] if junction else 9
    if d < 0.06 * size / 2.2: band.append((f.index, d))
faces = {
    'duck': [[list(l[uv].uv) for l in bm.faces[fi].loops] for fi in duck],
    'band': [[[list(l[uv].uv) for l in bm.faces[fi].loops], d] for fi, d in band],
    'size': size,
    'duckIdx': sorted(duck),
    'body': [[list(l[uv].uv) for l in f.loops] for f in bm.faces if f.index not in duck],
    'bandIdx': [fi for fi, d in band],
}
json.dump(faces, open(os.path.join(OUT, 'faces.json'), 'w'))
# Ambient occlusion, baked into the model's own UVs.
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.device = 'CPU'
sc.cycles.samples = 96
ao = bpy.data.images.new('ao', W, H, alpha=False)
node = mat.node_tree.nodes.new('ShaderNodeTexImage'); node.image = ao
mat.node_tree.nodes.active = node
for o in bpy.data.objects: o.select_set(False)
ob.select_set(True); bpy.context.view_layer.objects.active = ob
sc.render.bake.margin = 8
bpy.ops.object.bake(type='AO')
ao.filepath_raw = os.path.join(OUT, 'ao.png'); ao.file_format = 'PNG'; ao.save()
print('baked', W, H)
