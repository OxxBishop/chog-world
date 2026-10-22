"""Puff's bat wings rigid on his chest (the user, 10-21: from behind, walking, the wings twisted into each other:
the rigger's head zone had them, so every turn of his head swung them about). Every vertex coloured like the wings (a
deep red, redder and darker than his orange suit) behind his back between the waist and the neck goes wholly
to the Chest bone, plus a ring of their neighbours half way, so the join to the back stays soft.

python wing_fix.py <dump dir> <base colour image> <out dir>  ->  <out>/joints.f32, weights.f32 (patch.mjs)
"""
import os
import sys
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'fix'))
from texlib import Model
from cleanup import welded

d, base, out = sys.argv[1:4]
m = Model(d)
img = np.asarray(Image.open(base).convert('RGB'), np.float32) / 255
n = img.shape[0]
px = np.clip((m.uv * n).astype(int), 0, n - 1)
c = img[px[:, 1], px[:, 0]]
mx, mn = c.max(1), c.min(1)
sat = (mx - mn) / np.maximum(mx, 1e-4)
r, g, b = c.T
hue = np.degrees(np.arctan2(np.sqrt(3) * (g - b), 2 * r - g - b)) % 360
red = ((hue < 9) | (hue > 340)) & (sat > 0.55) & (mx < 0.8)
P = m.pos
chest = m.joint_pos('Chest')
hips = m.joint_pos('Hips')
neck = m.joint_pos('Neck') if 'Neck' in m.bones else chest + (chest - hips)
hw = m.bone_weight(['Head', 'Neck'])
# Behind the chest joint (the model faces +z), between the waist and just over the neck joint.
band = (P[:, 1] > hips[1]) & (P[:, 1] < neck[1] + 0.06) & (P[:, 2] < chest[2])
wing = red & band
wid, A = welded(m)
A = A.tocsr()
nw = A.shape[0]
W = np.zeros(nw, bool)
np.logical_or.at(W, wid, wing)
ring = ((A @ W.astype(float)) > 0) & ~W
wing_v, ring_v = W[wid], ring[wid] & band
J = m.joints.astype(np.int64).copy()
Wt = m.weights.copy()
ci = m.bones.index('Chest')
J[wing_v] = [ci, 0, 0, 0]
Wt[wing_v] = [1, 0, 0, 0]
# The ring: half chest, half what it had (its strongest bone).
for i in np.nonzero(ring_v)[0]:
    k = int(np.argmax(Wt[i]))
    J[i] = [ci, J[i, k], 0, 0]
    Wt[i] = [0.5, 0.5, 0, 0]
os.makedirs(out, exist_ok=True)
J.astype(np.float32).tofile(os.path.join(out, 'joints.f32'))
Wt.astype(np.float32).tofile(os.path.join(out, 'weights.f32'))
print('wing vertices rigid', int(wing_v.sum()), 'ring', int(ring_v.sum()), 'chest', np.round(chest, 3))
