# Blender (background): paint the float's faces red and the junction band blue, render front and side.
import bpy, json, os, math
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'work')
F = json.load(open(os.path.join(OUT, 'faces.json')))
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=r'C:\Users\HP\Documents\chog-world\public\models\npcs\chog-66.glb')
for o in list(bpy.data.objects):
    if o.name.startswith('Icosphere'): bpy.data.objects.remove(o)
ob = bpy.data.objects['Chog']; me = ob.data
for name, colr in (('red', (1, 0.1, 0.1, 1)), ('blue', (0.1, 0.3, 1, 1))):
    m = bpy.data.materials.new(name); m.diffuse_color = colr; me.materials.append(m)
for fi in F['bandIdx']: me.polygons[fi].material_index = 2
for fi in F['duckIdx']: me.polygons[fi].material_index = 1
sc = bpy.context.scene
sc.render.engine = 'BLENDER_WORKBENCH'
sc.display.shading.color_type = 'MATERIAL'
sc.render.resolution_x = 900; sc.render.resolution_y = 900
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
cam.data.lens = 60
for tag, ang in (('front', 0), ('side', 90), ('top', None)):
    if ang is None:
        cam.location = (0, -1.2, 2.6); cam.rotation_euler = (math.radians(30), 0, 0)
    else:
        a = math.radians(ang); cam.location = (math.sin(a) * 3.2, -math.cos(a) * 3.2, 0.7); cam.rotation_euler = (math.radians(88), 0, a)
    sc.render.filepath = os.path.join(OUT, f'viz_{tag}.png')
    bpy.ops.render.render(write_still=True)
print('done')
