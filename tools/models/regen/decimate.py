# blender -b --factory-startup -P decimate.py -- <in.glb> <out.glb> <target tris> <turn degrees about up>
import bpy, sys, math
a = sys.argv[sys.argv.index('--') + 1:]
src, dst, target, turn = a[0], a[1], int(a[2]), float(a[3])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
mesh = [o for o in bpy.data.objects if o.type == 'MESH'][0]
bpy.context.view_layer.objects.active = mesh
mesh.select_set(True)
# Weld the seam-split copies first so the collapse sees one surface, keep the UV seams as seams.
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.remove_doubles(threshold=1e-6)
bpy.ops.object.mode_set(mode='OBJECT')
n = len(mesh.data.polygons)
if n > target * 1.05:
    m = mesh.modifiers.new('dec', 'DECIMATE')
    m.decimate_type = 'COLLAPSE'
    m.ratio = target / n
    m.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier='dec')
# Face +z (glTF forward for the cast): Tripo exports facing +x.
mesh.rotation_mode = 'XYZ'
mesh.rotation_euler[2] += math.radians(turn)
bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
print('faces', n, '->', len(mesh.data.polygons))
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', use_selection=False)
