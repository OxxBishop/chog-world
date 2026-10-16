"""
King Pom's mane off his arms (the user, 10-16: "king pom's spikes, the bottom one is overextended"):
  python tools/models/fix/mane.py <work> <name> <shipped dump>

Tripo skinned the lowest spikes of the mane to the upper arms, so run.py's longer arms (1.45x) pushed those
spikes out along the arm, and every clip that moves an arm swings them. Every vertex outside the arm's own
volume (the sleeve included) goes back to where Tripo had it and keeps only its non-arm weights, easing
into the arm's own skin across a thin band at the volume's edge.

Inputs: <work>/<name>/ (dump of the copy run.py started from), <work>/fix-<name>/ (run.py: pos.f32,
joints.f32, weights.f32), <shipped dump> (dump.mjs of public/models/npcs/<name>.glb). Writes pos.f32,
joints.f32, weights.f32 in the shipped file's vertex order to <work>/mane-<name>/.
"""
import os
import sys

import numpy as np
from scipy.spatial import cKDTree

sys.path.insert(0, os.path.dirname(__file__))
from texlib import Model

work, name, shipped = sys.argv[1:4]
s = Model(os.path.join(work, name))
f = os.path.join(work, f'fix-{name}')
pos = np.fromfile(os.path.join(f, 'pos.f32'), np.float32).reshape(-1, 3) if os.path.exists(os.path.join(f, 'pos.f32')) else s.pos.copy()
J = np.fromfile(os.path.join(f, 'joints.f32'), np.float32).reshape(-1, 4).astype(np.int64)
Wt = np.fromfile(os.path.join(f, 'weights.f32'), np.float32).reshape(-1, 4)
nb = len(s.bones)
D = np.zeros((len(pos), nb), np.float32)
for k in range(4):
    np.add.at(D, (np.arange(len(pos)), J[:, k]), Wt[:, k])
arm_ids = [s.bones.index(b) for b in s.bones if b.startswith(('UpperArm', 'ForeArm', 'Hand'))]
head = s.bones.index('Head')

# Which vertices are mane: the mane's pink under them (the sleeves are red and white, so no distance from the
# arm can tell a wide sleeve from a spike), smoothed over the surface so the spike's root eases into the
# shoulder instead of tearing.
img = s.image('base')
n = img.shape[0]
blur = np.dstack([np.asarray(__import__('scipy.ndimage', fromlist=['uniform_filter']).uniform_filter(img[..., c], 3)) for c in range(3)])
col = blur[np.clip((s.uv[:, 1] * n).astype(int), 0, n - 1), np.clip((s.uv[:, 0] * n).astype(int), 0, n - 1)]
mx, mn = col.max(1), col.min(1)
sat = (mx - mn) / np.maximum(mx, 1e-6)
hue = np.degrees(np.arctan2(np.sqrt(3) * (col[:, 1] - col[:, 2]), 2 * col[:, 0] - col[:, 1] - col[:, 2])) % 360
pink = (mx > 0.55) & (sat > 0.15) & (sat < 0.6) & ((hue > 290) | (hue < 15))
red = (sat >= 0.6) & ((hue > 330) | (hue < 25))
moved = np.linalg.norm(pos - s.pos, axis=1) > 0.002
# The sleeve's far end and the hand stay the longer arm, whatever their colour (the cuff is white too).
outer = D[:, [s.bones.index(b) for b in ('ForeArmL', 'HandL', 'ForeArmR', 'HandR')]].sum(1) > 0.4
_, weld = np.unique(np.round(s.pos, 4), axis=0, return_inverse=True)
weld = weld.ravel()
nw = weld.max() + 1
tri = weld[s.index]
from scipy.sparse import coo_matrix
r_, c_ = np.concatenate([tri[:, 0], tri[:, 1], tri[:, 2]]), np.concatenate([tri[:, 1], tri[:, 2], tri[:, 0]])
A = coo_matrix((np.ones(len(r_)), (r_, c_)), shape=(nw, nw)).tocsr()
A = ((A + A.T) > 0).astype(np.float32)
deg = np.maximum(np.asarray(A.sum(1)).ravel(), 1)
seed = np.zeros(nw, bool)
np.logical_or.at(seed, weld, pink & moved & ~outer)
# The mane and what it covers (the collar under it, specks of shading): flooded over the surface from the
# pink, through anything that isn't the red sleeve or its far end.
open_ = np.ones(nw, bool)
np.logical_and.at(open_, weld, ~(red | outer))
region = seed.copy()
for _ in range(200):
    nxt = region | (((A @ region.astype(np.float32)) > 0) & open_)
    if (nxt == region).all():
        break
    region = nxt
# A soft edge a few rings wide, so the shoulder eases from the long arm into the mane without a tear.
kw = region.astype(np.float32)
for _ in range(6):
    kw = 0.5 * kw + 0.5 * (A @ kw) / deg
kw = np.where(region, np.maximum(kw, 0.5), kw)
for _ in range(2):
    kw = 0.5 * kw + 0.5 * (A @ kw) / deg
out = np.clip(kw[weld] * 1.25, 0, 1)
k = (out * out * (3 - 2 * out))[:, None]
touched = (k[:, 0] > 0.001) & (D[:, arm_ids].sum(1) > 0.001)
print(f'{name}: {touched.sum()} vertices of the mane carried arm weight; moved back up to {np.linalg.norm(pos - s.pos, axis=1)[touched].max():.3f} m')

# Positions: back to Tripo's where the mane is, the longer arm where the arm is.
new_pos = pos * (1 - k) + s.pos * k
# Weights: the mane's without the arms (what's left, renormalised; the chest if nothing is).
Dm = D.copy()
Dm[:, arm_ids] = 0
left = Dm.sum(1, keepdims=True)
Dm[left[:, 0] < 1e-3, s.bones.index('Chest')] = 1
Dm /= np.maximum(Dm.sum(1, keepdims=True), 1e-6)
Df = D * (1 - k) + Dm * k
idx = np.argsort(-Df, 1)[:, :4]
val = np.take_along_axis(Df, idx, 1)
val /= np.maximum(val.sum(1, keepdims=True), 1e-6)

# Into the shipped file's vertex order: same corners (position before this fix, and UV).
fs = Model(shipped)
uv_fix = np.fromfile(os.path.join(f, 'uv.f32'), np.float32).reshape(-1, 2)
tree = cKDTree(np.concatenate([pos, uv_fix], 1))
dist, m = tree.query(np.concatenate([fs.pos, fs.uv], 1))
print(f'{name}: matched {len(m)} shipped vertices, worst {dist.max():.2e}')
assert dist.max() < 2e-3
dst = os.path.join(work, f'mane-{name}')
os.makedirs(dst, exist_ok=True)
new_pos[m].astype(np.float32).tofile(os.path.join(dst, 'pos.f32'))
idx[m].astype(np.float32).tofile(os.path.join(dst, 'joints.f32'))
val[m].astype(np.float32).tofile(os.path.join(dst, 'weights.f32'))
