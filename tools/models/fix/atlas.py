"""
Repack a cast model's texture atlas with gutters, and bake what the fixes need, in Blender:
  blender --background --python tools/models/fix/atlas.py -- <in.glb> <workdir> [drop.json]

Tripo packs a model's texture islands edge to edge, so from a distance (smaller mip levels) one island's
colour bleeds into its neighbours: the body's purple onto the duck float, the hair onto a face. This keeps
Tripo's islands and their relative sizes, repacks them with a gutter, and bakes the colour, normal and
metal-roughness maps across to the new layout with the gutters filled from each island's own edge.

drop.json (optional): {"tris": [triangle indices to delete]} (the singer's stage and stand).

Writes to <workdir>: base.png, normal.png, mr.png (1024, new layout), pos.exr (object-space position per
texel, glTF axes), weights.exr (R: hands, G: feet, B: forearms), cover.png (texels inside an island),
corners.bin (per triangle corner: glTF vertex index as float, u, v; in glTF triangle order), meta.json.
"""
import bpy, bmesh, sys, os, json, struct, math

argv = sys.argv[sys.argv.index('--') + 1:]
src, out = argv[0], argv[1]
opts = dict(a.split('=', 1) for a in argv[2:])
drop = json.load(open(opts['drop']))['tris'] if 'drop' in opts else []
# smart=1: a new unwrap instead of Tripo's islands (for a model cut into thousands of tiny ones), with the
# body's islands given `body` times the texels of the rest (the singer's stage).
smart = opts.get('smart') == '1'
body_k = float(opts.get('body', 1))
os.makedirs(out, exist_ok=True)
SIZE = 1024
MARGIN = 0.008

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src, merge_vertices=False)
obj = max((o for o in bpy.data.objects if o.type == 'MESH'), key=lambda o: len(o.data.vertices))
arm = next((o for o in bpy.data.objects if o.type == 'ARMATURE'), None)
if arm:
    arm.data.pose_position = 'REST'
me = obj.data
print('verts', len(me.vertices), 'polys', len(me.polygons))

# glTF triangle order: the importer keeps it; record each polygon's original index before any delete.
me.attributes.new('tri_id', 'INT', 'FACE')
ids = me.attributes['tri_id'].data
for i in range(len(me.polygons)):
    ids[i].value = i
me.attributes.new('vtx_id', 'INT', 'POINT')
vids = me.attributes['vtx_id'].data
for i in range(len(me.vertices)):
    vids[i].value = i
# Each corner's own glTF vertex, which survives welding (a welded vertex stands for several).
me.attributes.new('corner_vtx', 'INT', 'CORNER')
cv = me.attributes['corner_vtx'].data
for li, l in enumerate(me.loops):
    cv[li].value = l.vertex_index

if drop:
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    dset = set(drop)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index in dset], context='FACES_ONLY')
    bm.to_mesh(me)
    bm.free()
    print('dropped', len(drop), 'now polys', len(me.polygons))

old_uv = me.uv_layers[0].name
new = me.uv_layers.new(name='atlas')
for a, b in zip(me.uv_layers[old_uv].data, new.data):
    b.uv = a.uv
me.uv_layers.active = new

bpy.context.view_layer.objects.active = obj
obj.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.context.scene.tool_settings.use_uv_select_sync = True
if smart:
    import math
    # Tripo splits the surface at every seam: weld it so the unwrap sees one surface.
    bpy.ops.mesh.remove_doubles(threshold=1e-5)
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    if body_k != 1:
        # The body's faces (not held by Root alone) get more of the atlas.
        bpy.ops.object.mode_set(mode='OBJECT')
        root_g = obj.vertex_groups.get('Root')
        def rootw(v):
            return sum(g.weight for g in v.groups if root_g and g.group == root_g.index)
        uvl = me.uv_layers['atlas']
        k = math.sqrt(body_k)
        import bmesh as _bm
        bm2 = _bm.new()
        bm2.from_mesh(me)
        lay = bm2.loops.layers.uv['atlas']
        # Scale each body face's UVs about its island's middle: islands are joined faces, so scale about
        # each connected UV group's centre.
        bm2.faces.ensure_lookup_table()
        body = [f for f in bm2.faces if not all(rootw(me.vertices[v.index]) > 0.6 for v in f.verts)]
        bodyset = set(f.index for f in body)
        seen = set()
        for f in body:
            if f.index in seen:
                continue
            # Flood the UV island.
            stack, isl = [f], []
            seen.add(f.index)
            while stack:
                g = stack.pop()
                isl.append(g)
                for l in g.loops:
                    for e in (l.edge,):
                        for h in e.link_faces:
                            if h.index in seen or h.index not in bodyset:
                                continue
                            a = [x for x in g.loops if x.vert in e.verts]
                            b = [x for x in h.loops if x.vert in e.verts]
                            if len(a) == 2 and len(b) == 2 and all((x[lay].uv - y[lay].uv).length < 1e-6 for x in a for y in b if x.vert == y.vert):
                                seen.add(h.index)
                                stack.append(h)
            cx = sum(l[lay].uv.x for g in isl for l in g.loops) / sum(len(g.loops) for g in isl)
            cy = sum(l[lay].uv.y for g in isl for l in g.loops) / sum(len(g.loops) for g in isl)
            for g in isl:
                for l in g.loops:
                    l[lay].uv.x = cx + (l[lay].uv.x - cx) * k
                    l[lay].uv.y = cy + (l[lay].uv.y - cy) * k
        bm2.to_mesh(me)
        bm2.free()
        me.uv_layers.active = me.uv_layers['atlas']
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
ok = False
for kw in (dict(rotate=True, rotate_method='ANY', scale=True, merge_overlap=False, margin_method='FRACTION', margin=MARGIN, shape_method='CONCAVE'),
           dict(rotate=True, scale=True, margin=MARGIN)):
    try:
        bpy.ops.uv.pack_islands(**kw)
        ok = True
        break
    except TypeError as e:
        print('pack_islands', e)
bpy.ops.object.mode_set(mode='OBJECT')
assert ok
import time
print('packed', time.strftime('%X'))
for o in bpy.data.objects:
    o.select_set(o is obj)

# The material's three maps.
mat = obj.active_material
nt = mat.node_tree
bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
def linked_image(sock):
    if not sock.is_linked:
        return None
    n = sock.links[0].from_node
    while n.type != 'TEX_IMAGE':
        ins = [i for i in n.inputs if i.is_linked]
        if not ins:
            return None
        n = ins[0].links[0].from_node
    return n.image
img_base = linked_image(bsdf.inputs['Base Color'])
img_norm = linked_image(bsdf.inputs['Normal'])
img_mr = linked_image(bsdf.inputs['Roughness']) or linked_image(bsdf.inputs['Metallic'])
print('maps', img_base and img_base.name, img_norm and img_norm.name, img_mr and img_mr.name)

scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 4
scene.render.bake.margin = 24
try:
    scene.render.bake.margin_type = 'EXTEND'
except Exception:
    pass

def fresh_tree():
    nt.nodes.clear()
    o = nt.nodes.new('ShaderNodeOutputMaterial')
    return o

def target(name, float_buf=False, colorspace='sRGB'):
    im = bpy.data.images.new(name, SIZE, SIZE, alpha=False, float_buffer=float_buf)
    im.colorspace_settings.name = colorspace
    t = nt.nodes.new('ShaderNodeTexImage')
    t.image = im
    t.select = True
    nt.nodes.active = t
    return im

def source(img, noncolor=False):
    t = nt.nodes.new('ShaderNodeTexImage')
    t.image = img
    t.interpolation = 'Cubic'
    if noncolor:
        img.colorspace_settings.name = 'Non-Color'
    uvn = nt.nodes.new('ShaderNodeUVMap')
    uvn.uv_map = old_uv
    nt.links.new(uvn.outputs['UV'], t.inputs['Vector'])
    return t

def emit_bake(sock_fn, im_name, float_buf=False, colorspace='sRGB'):
    o = fresh_tree()
    e = nt.nodes.new('ShaderNodeEmission')
    nt.links.new(e.outputs['Emission'], o.inputs['Surface'])
    nt.links.new(sock_fn(), e.inputs['Color'])
    im = target(im_name, float_buf, colorspace)
    bpy.ops.object.bake(type='EMIT')
    return im

def save(im, name, fmt='PNG', depth='8'):
    im.filepath_raw = os.path.join(out, name)
    im.file_format = fmt
    if fmt == 'OPEN_EXR':
        scene.render.image_settings.file_format = 'OPEN_EXR'
        scene.render.image_settings.color_depth = '32'
        im.save_render(os.path.join(out, name), scene=scene)
    else:
        im.save()

base = emit_bake(lambda: source(img_base).outputs['Color'], 'base')
save(base, 'base.png')
if img_mr:
    mr = emit_bake(lambda: source(img_mr, True).outputs['Color'], 'mr', colorspace='Non-Color')
    save(mr, 'mr.png')
if img_norm:
    o = fresh_tree()
    p = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nm.uv_map = old_uv
    nt.links.new(source(img_norm, True).outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], p.inputs['Normal'])
    nt.links.new(p.outputs['BSDF'], o.inputs['Surface'])
    im = target('normal', colorspace='Non-Color')
    scene.render.bake.normal_space = 'TANGENT'
    bpy.ops.object.bake(type='NORMAL')
    save(im, 'normal.png')

# Masks for the fixes: where each texel is on the body, and which bones carry it.
groups = {g.name: g.index for g in obj.vertex_groups}
def wsum(v, names):
    return sum(g.weight for g in v.groups if obj.vertex_groups[g.group].name in names)
col = me.color_attributes.new('wts', 'FLOAT_COLOR', 'POINT')
for i, v in enumerate(me.vertices):
    col.data[i].color = (wsum(v, ('HandL', 'HandR')), wsum(v, ('FootL', 'FootR')), wsum(v, ('ForeArmL', 'ForeArmR')), 1)
def attr(name):
    a = nt.nodes.new('ShaderNodeAttribute')
    a.attribute_name = name
    return a.outputs['Color']
save(emit_bake(lambda: attr('wts'), 'weights', True, 'Non-Color'), 'weights.exr', 'OPEN_EXR')
pc = me.color_attributes.new('posc', 'FLOAT_COLOR', 'POINT')
for i, v in enumerate(me.vertices):
    x, y, z = v.co
    pc.data[i].color = (x, z, -y, 1)  # glTF axes
save(emit_bake(lambda: attr('posc'), 'pos', True, 'Non-Color'), 'pos.exr', 'OPEN_EXR')
scene.render.bake.margin = 0
cc = me.color_attributes.new('one', 'FLOAT_COLOR', 'POINT')
for i in range(len(me.vertices)):
    cc.data[i].color = (1, 1, 1, 1)
save(emit_bake(lambda: attr('one'), 'cover', False, 'Non-Color'), 'cover.png')

# Per triangle corner, in glTF order: the glTF vertex and its new UV (glTF v is flipped).
uvd = me.uv_layers['atlas'].data
cvd = me.attributes['corner_vtx'].data
tid = me.attributes['tri_id'].data
rows = []
for p in me.polygons:
    assert p.loop_total == 3
    for li in p.loop_indices:
        u, v = uvd[li].uv
        rows.append((tid[p.index].value, cvd[li].value, u, 1 - v))
with open(os.path.join(out, 'corners.bin'), 'wb') as f:
    for r in rows:
        f.write(struct.pack('<iiff', *r))
json.dump({'src': src, 'polys': len(me.polygons), 'verts': len(me.vertices), 'dropped': len(drop), 'maps': [bool(img_base), bool(img_norm), bool(img_mr)]}, open(os.path.join(out, 'meta.json'), 'w'))
print('done', out)
