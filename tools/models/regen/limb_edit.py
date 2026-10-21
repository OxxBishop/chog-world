"""Proportion fixes on a decimated Tripo Chog, before rigging (A, 10-21, the user's phone test):
  arms   shorter arms with the same hands ("toasty's arms are longer than his legs"): each arm from the
         shoulder out pulled in along its own line to k of its length, the hand (its last `hand` metres) moved
         in whole, the cross-section kept.
  tail   a smaller tail ("sharky's tail is way too big"): everything behind the body's back below the waist
         shrunk toward where it joins the body, to k of its size.

blender -b --factory-startup -P limb_edit.py -- <in.glb> <out.glb> arms shoulder=0.37;k=0.62;hand=0.13
blender -b --factory-startup -P limb_edit.py -- <in.glb> <out.glb> tail k=0.6
Measures in metres on the Chog scaled to 2.2 m tall (as rig_chog.py does); writes the file unscaled.
"""
import bpy, sys
import numpy as np

args = sys.argv[sys.argv.index('--') + 1:]
src, dst, task = args[0], args[1], args[2]
P = {k: float(v) for k, v in (kv.split('=') for kv in (args[3] if len(args) > 3 else '').split(';') if '=' in kv)}
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
mesh = [o for o in bpy.data.objects if o.type == 'MESH'][0]
mw = np.array(mesh.matrix_world)
co = np.array([tuple(v.co) for v in mesh.data.vertices])
# World space (the import may sit the mesh under a turned node), metres at 2.2 m tall.
w = co @ mw[:3, :3].T + mw[:3, 3]
zmin, zmax = w[:, 2].min(), w[:, 2].max()
S = 2.2 / (zmax - zmin)
m = (w - [np.median(w[:, 0]), 0, zmin]) * S
x, y, z = m[:, 0], m[:, 1], m[:, 2]
moved = np.zeros_like(m)

if task == 'arms':
    sh, k, hand = P.get('shoulder', 0.37), P.get('k', 0.62), P.get('hand', 0.13)
    for sgn in (1, -1):
        # The arm's line through the part that is surely arm (well out past the shoulder): its centre and main
        # direction, pointing out. The shoulder: where that line crosses x = shoulder.
        sure = (x * sgn > sh + 0.12) & (z < P.get("top", 0.88)) & (z > 0.35)
        c = m[sure].mean(0)
        _, _, vt = np.linalg.svd(m[sure] - c, full_matrices=False)
        a = vt[0] * np.sign(vt[0][0] * sgn)
        S0 = c + a * ((sh * sgn - c[0]) / a[0])
        rel = m - S0
        t = rel @ a
        radial = np.linalg.norm(rel - np.outer(t, a), axis=1)
        rmax = np.percentile(radial[sure], 98) * 1.25
        L = t[sure].max()
        arm = (x * sgn > sh - 0.03) & (t > 0) & (radial < rmax) & (z < P.get("top", 0.88) + 0.05)
        tw = L - hand
        # Eased in over the first few centimetres so the sleeve's join to the body stays smooth.
        ease = np.clip(t / 0.06, 0, 1)
        new_t = np.where(t <= tw, t * (1 - (1 - k) * ease), tw * k + (t - tw))
        p1 = m + np.outer(new_t - t, a)
        # level=1: the arm turned up about the shoulder to lie level (a true T-pose), so the rig's level arm
        # bones run down its middle; eased over its first 10 cm so the shoulder bends rather than breaks.
        droop = float(np.degrees(np.arcsin(-a[2])))
        if P.get('level'):
            lv = a.copy(); lv[2] = 0; lv /= np.linalg.norm(lv)
            axis = np.cross(a, lv); axis /= np.linalg.norm(axis)
            ang = np.arcsin(np.clip(np.linalg.norm(np.cross(a, lv)), -1, 1))
            e = np.clip(t / 0.1, 0, 1); e = e * e * (3 - 2 * e)
            r = p1 - S0
            th = (ang * e)[:, None]
            # Rodrigues, per vertex.
            r2 = r * np.cos(th) + np.cross(axis, r) * np.sin(th) + np.outer(r @ axis, axis) * (1 - np.cos(th))
            p1 = S0 + r2
        moved[arm] += p1[arm] - m[arm]
        print('ARM', 'L' if sgn > 0 else 'R', 'length', round(L, 3), '->', round(tw * k + hand, 3), 'droop', round(droop, 1), '-> 0' if P.get('level') else '', 'shoulder z', round(float(S0[2]), 3), 'vertices', int(arm.sum()))
elif task == 'tail':
    k = P.get('k', 0.6)
    # Blender's -y is the Chog's front (glTF +z): the back is +y. The back's surface: how far the middle of the
    # body reaches behind its centre line; the tail is what sticks out past that under the waist.
    band = (z > 0.3) & (z < P.get('waist', 0.75)) & (np.abs(x) < 0.15)
    yc = np.median(y[band])
    back = yc + np.percentile(y[band] - yc, 90)
    s_ = y - back
    tail = (s_ > 0) & (z < P.get('waist', 0.75)) & (z > 0.03)
    J = m[tail & (s_ < 0.04)].mean(0)
    J[1] = back
    # The whole tail scaled about where it joins, the first few centimetres eased so the join stays put.
    wgt = np.clip(s_ / P.get('ease', 0.06), 0, 1)
    wgt = wgt * wgt * (3 - 2 * wgt)
    target = J + (m - J) * k
    moved[tail] = (target[tail] - m[tail]) * wgt[tail, None]
    print('TAIL vertices', int(tail.sum()), 'back', round(back, 3), 'reach', round(float(s_[tail].max()), 3), '->', round(float(s_[tail].max() * k), 3))
else:
    raise SystemExit('task: arms | tail')

# Back to the file's own units and space.
dw = moved / S
inv = np.linalg.inv(mw[:3, :3])
dl = dw @ inv.T
for i, v in enumerate(mesh.data.vertices):
    if dl[i].any():
        v.co = (co[i] + dl[i]).tolist()
mesh.data.update()
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', use_selection=False)
print('wrote', dst)
