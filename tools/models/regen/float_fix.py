"""Quackers' duck float rigid on the hips and spine (Tripo's new model mixes it into the body's UV islands, so
cleanup.py's duck task, which works by island, missed most of it): every vertex coloured like the float (yellow,
the beak's orange, the eyes' black) out past the waist at its height, plus the ring round it."""
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
duck = ((hue > 15) & (hue < 70) & (sat > 0.4) & (mx > 0.4)) | (mx < 0.15)
P = m.pos
hw = m.bone_weight(['Head', 'Neck'])
body = (hw < 0.5) & ~duck
ys = P[duck & (hw < 0.5), 1]
y0, y1 = np.percentile(ys, 2), np.percentile(ys, 98)
cx, cz = np.median(P[body, 0]), np.median(P[body, 2])
rad = np.hypot(P[:, 0] - cx, P[:, 2] - cz)
band = (P[:, 1] > y0 - 0.02) & (P[:, 1] < y1 + 0.02)
waist = np.percentile(rad[band & body & (m.bone_weight(['Spine', 'Hips', 'Chest']) > 0.5)], 85)
fl = duck & band & (rad > waist * 0.92) & (hw < 0.5)
# Grow over the welded surface a few rings within the band (the float's inner wall and seams).
wid, A = welded(m)
A = A.tocsr()
nw = A.shape[0]
F = np.zeros(nw, bool); np.logical_or.at(F, wid, fl)
B = np.zeros(nw, bool); np.logical_or.at(B, wid, band & (hw < 0.5) & (rad > waist * 0.85))
for _ in range(3):
    F = F | ((A @ F.astype(float)) > 0) & B
fl = F[wid]
J = m.joints.astype(np.int64).copy(); W = m.weights.copy()
hi, si = m.bones.index('Hips'), m.bones.index('Spine')
J[fl] = [hi, si, 0, 0]; W[fl] = [0.5, 0.5, 0, 0]
J.astype(np.float32).tofile(out + '/joints.f32'); W.astype(np.float32).tofile(out + '/weights.f32')
print('float band y', round(y0, 2), round(y1, 2), 'waist', round(waist, 2), 'vertices rigid', int(fl.sum()))
