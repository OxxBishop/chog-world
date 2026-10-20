"""The dino's arms: bones (UpperArm, ForeArm, Hand each side, under the Chest), weights along each arm, and the
arms brought down from over its head to level (a T-pose like the cast's, for the retargeted clips).
Writes w2/dino-rig/{pos,nrm,joints,weights}.f32, w2/dino-rig/bones.json and r3/dinorig.png."""
import json
import os
import sys
import numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from texlib import Model
from cleanup import welded, hsv

OUT = 'w2/dino-rig'
os.makedirs(OUT, exist_ok=True)
DROP = float(sys.argv[1]) if len(sys.argv) > 1 else 0.0   # degrees below level for the new bind
RF0, RF1 = (float(sys.argv[2]), float(sys.argv[3])) if len(sys.argv) > 3 else (0.13, 0.22)
m = Model('w2/dino')
J = np.load('w2/dino-joints.npz')
S_ = np.load('w2/dino-armsel.npz')
wid = S_['wid']
n = len(m.pos)
nb = len(m.bones)
img = np.asarray(Image.open('w2/dino/base.png').convert('RGB'), np.float32) / 255
px = np.clip((m.uv * img.shape[0]).astype(int), 0, img.shape[0] - 1)
h, s, v = hsv(img[px[:, 1], px[:, 0]][None])
pink = (((h[0] * 360) > 290) | ((h[0] * 360) < 15)) & (s[0] > 0.3) & (v[0] > 0.35)


def smooth01(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def rot_between(a, b):
    a = a / np.linalg.norm(a); b = b / np.linalg.norm(b)
    v = np.cross(a, b); c = a @ b; s = np.linalg.norm(v)
    if s < 1e-8:
        return np.eye(3)
    k = v / s
    K = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
    ang = np.arctan2(s, c)
    return np.eye(3) + np.sin(ang) * K + (1 - np.cos(ang)) * K @ K


# Per vertex: [bone -> weight] as a dense table, the original first.
W = np.zeros((n, nb + 6))
for k in range(4):
    np.add.at(W, (np.arange(n), m.joints[:, k]), m.weights[:, k])
pos = m.pos.astype(np.float64).copy()
nrm = m.nrm.astype(np.float64).copy()
bones = []
report = {}
for si, (side, sg) in enumerate((('L', 1), ('R', -1))):
    sel = S_[side][wid]
    sh, hd = J[f'shoulder_{side}'].astype(np.float64), J[f'hand_{side}'].astype(np.float64)
    ax = hd - sh
    L = np.linalg.norm(ax); ax /= L
    t = (m.pos - sh) @ ax
    # The wrist: where the pink hand starts along the arm (its lowest tenth).
    tw = np.percentile(t[sel & pink], 8)
    te = 0.5 * tw
    d = np.linalg.norm((m.pos - sh) - np.outer(t, ax), axis=1)
    # Arm weight: up from the shoulder plane, and near the root fading out across the armpit's fillet (the
    # selection reaches into it, so its edge carries none).
    rf = np.maximum(1 - smooth01((d - RF0) / (RF1 - RF0)), smooth01((t - 0.16) / 0.12))
    a = np.where(sel, smooth01((t + 0.02) / 0.18) * rf, 0)
    e = smooth01((t - (te - 0.08)) / 0.16)
    hh = smooth01((t - (tw - 0.035)) / 0.07)
    ub, fb, hb = nb + si * 3, nb + si * 3 + 1, nb + si * 3 + 2
    W[sel] *= (1 - a[sel])[:, None]
    W[sel, ub] += (a * (1 - e))[sel]
    W[sel, fb] += (a * e * (1 - hh))[sel]
    W[sel, hb] += (a * e * hh)[sel]
    # Down to level (or DROP below), out to its own side, no forward or back.
    tgt = np.array([sg * np.cos(np.radians(DROP)), -np.sin(np.radians(DROP)), 0.0])
    R = rot_between(ax, tgt)
    moved = sh + (m.pos - sh) @ R.T
    pos[sel] = ((1 - a)[:, None] * m.pos + a[:, None] * moved)[sel]
    nr = (1 - a)[:, None] * m.nrm + a[:, None] * (m.nrm @ R.T)
    nr /= np.linalg.norm(nr, axis=1, keepdims=True)
    nrm[sel] = nr[sel]
    el = sh + R @ (ax * te)
    wr = sh + R @ (ax * tw)
    bones += [dict(name=f'UpperArm{side}', parent='Chest', at=sh.tolist()),
              dict(name=f'ForeArm{side}', parent=f'UpperArm{side}', at=el.tolist()),
              dict(name=f'Hand{side}', parent=f'ForeArm{side}', at=wr.tolist())]
    # How hard the seam round the selection is: the largest arm weight on a vertex next to an unselected one.
    print(side, 'arm length', round(L, 3), 'elbow t', round(te, 3), 'wrist t', round(tw, 3), 'turn', round(np.degrees(np.arccos(np.clip(ax @ tgt, -1, 1))), 1))
    report[side] = (sel, a)

# Top four, normalised.
order = np.argsort(-W, axis=1)[:, :4]
w4 = np.take_along_axis(W, order, axis=1)
w4 /= w4.sum(1, keepdims=True)
j4 = np.where(w4 > 0, order, 0)
# Seams: welded neighbours across each selection's edge.
tri = m.index
for side, (sel, a) in report.items():
    e0 = np.concatenate([tri[:, 0], tri[:, 1], tri[:, 2]]); e1 = np.concatenate([tri[:, 1], tri[:, 2], tri[:, 0]])
    cross = sel[e0] & ~sel[e1]
    print(side, 'max arm weight at the edge of the selection', round(float(a[e0[cross]].max()) if cross.any() else 0, 3))
# Stretch from the re-pose: edges longer or shorter than before.
def edge_ratio(p0, p1):
    l0 = np.linalg.norm(p0[tri[:, [1, 2, 0]]] - p0[tri], axis=2)
    l1 = np.linalg.norm(p1[tri[:, [1, 2, 0]]] - p1[tri], axis=2)
    return (l1 / np.maximum(l0, 1e-6)).max(1), (l1 / np.maximum(l0, 1e-6)).min(1)
hi, lo = edge_ratio(m.pos.astype(np.float64), pos)
print('triangles stretched >1.4x', int((hi > 1.4).sum()), 'squashed <0.6x', int((lo < 0.6).sum()), 'max', round(float(hi.max()), 2), 'min', round(float(lo.min()), 2))

pos.astype(np.float32).tofile(f'{OUT}/pos.f32')
nrm.astype(np.float32).tofile(f'{OUT}/nrm.f32')
j4.astype(np.float32).tofile(f'{OUT}/joints.f32')
w4.astype(np.float32).tofile(f'{OUT}/weights.f32')
json.dump(bones, open(f'{OUT}/bones.json', 'w'), indent=1)

# Picture: front and side, before (grey) and after (coloured by bone), the new joints.
S = 700; span = 2.6
im = Image.new('RGB', (S * 2, S), 'white'); d = ImageDraw.Draw(im)
cols = {nb: (220, 60, 60), nb + 1: (240, 160, 40), nb + 2: (200, 60, 200), nb + 3: (60, 60, 220), nb + 4: (40, 170, 200), nb + 5: (40, 160, 60)}
for k, (A, B, D) in enumerate([(0, 1, 2), (2, 1, 0)]):
    for i in np.argsort(pos[:, D] * (1 if k == 0 else -1)):
        X = k * S + (pos[i, A] / span + 0.5) * S; Y = S - (pos[i, B] / span) * S - 40
        top = order[i, 0]
        col = cols.get(top, (190, 190, 190))
        d.rectangle((X - 1, Y - 1, X + 1, Y + 1), fill=col)
    for b in bones:
        p = b['at']
        X = k * S + (p[A] / span + 0.5) * S; Y = S - (p[B] / span) * S - 40
        d.ellipse((X - 5, Y - 5, X + 5, Y + 5), outline='black', width=2)
im.save('r3/dinorig.png')
