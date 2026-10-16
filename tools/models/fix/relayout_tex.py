"""
Textures for a new layout from relayout.py (the singer, A 10-16): every texel of the new atlas takes the
shipped model's colour (every fix in it: the cleaned skin, the painted mouth) plus the 2048 original's fine
detail under it, held to a small amplitude (Tripo's stains were cleaned at 1024 and would come back at full
strength); the normal and metal-roughness maps are resampled from the shipped ones.
  python tools/models/fix/relayout_tex.py <work> <name> <shipped dump> <corners.bin> <out dir> [detail=0.04]

<work> is upres.py's (<name>/, o2k-<name>/, fix-<name>/, a-<name>/). <shipped dump>: dump.mjs of the
shipped (JPEG) file the corners index. Writes base.png (2048), normal.png, mr.png (1024) to <out>; then
  node tools/models/fix/apply.mjs <shipped.glb> <out.glb> --corners <corners.bin> --base base.png --normal normal.png --mr mr.png
and ktx2.mjs.
"""
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage
from scipy.spatial import cKDTree

sys.path.insert(0, os.path.dirname(__file__))
from texlib import Model, fill_gutters, islands, raster

work, name, shipped, corners_path, out = sys.argv[1:6]
N = 2048
DETAIL = float(sys.argv[6]) if len(sys.argv) > 6 else 0.04
s = Model(os.path.join(work, name))
o = Model(os.path.join(work, f'o2k-{name}'))
f = Model(shipped)
src = o.image('base')

# The shipped file's vertices back to the 1024 copy the fixes started from (atlas.py's corners: that copy's
# vertex and its UV in the shipped layout), and from there to the 2048 original's UVs.
a = np.fromfile(os.path.join(work, f'a-{name}', 'corners.bin'), dtype=[('t', '<i4'), ('v', '<i4'), ('u', '<f4'), ('w', '<f4')])
tree = cKDTree(np.concatenate([s.pos[a['v']], np.stack([a['u'], a['w']], 1)], 1))
d1, m1 = tree.query(np.concatenate([f.pos, f.uv], 1))
s_of_f = a['v'][m1]
d2, m2 = cKDTree(np.concatenate([o.pos, o.uv], 1)).query(np.concatenate([s.pos, s.uv], 1))
print(f'{name}: shipped to fix copy worst {d1.max():.2e}, fix copy to original worst {d2.max():.2e}')
o_uv = o.uv[m2[s_of_f]]

# The new layout, per corner.
c = np.fromfile(corners_path, dtype=[('t', '<i4'), ('v', '<i4'), ('u', '<f4'), ('w', '<f4')])
new_uv = np.stack([c['u'], c['w']], 1).astype(np.float32)
v = c['v'].astype(np.int64)
tris = np.arange(len(v)).reshape(-1, 3)
vals = np.concatenate([f.uv[v], o_uv[v]], 1).astype(np.float32)

def rasterise(size):
    tid, val = raster(new_uv * size, tris, vals, size)
    return tid >= 0, val

def sample(img, uv, order):
    h = img.shape[0]
    out_ = np.zeros(uv.shape[:1] + (img.shape[2],), np.float32)
    for k in range(img.shape[2]):
        out_[:, k] = ndimage.map_coordinates(img[..., k], [uv[:, 1] * h - 0.5, uv[:, 0] * h - 0.5], order=order, mode='nearest')
    return out_

def load(p):
    return np.asarray(Image.open(p).convert('RGB'), np.float32) / 255

os.makedirs(out, exist_ok=True)
cov, val = rasterise(N)
ys, xs = np.nonzero(cov)
l1, ouv = val[ys, xs, :2], val[ys, xs, 2:]
# The shipped colours (every fix in them) are the base; the 2048 original adds only its fine detail, held to
# a small amplitude, so Tripo's stains (which the fixes cleaned, and the old low resolution hid) stay out.
fixed = load(os.path.join(work, f'fix-{name}', 'base_fixed.png'))
pre = load(os.path.join(work, f'a-{name}', 'base.png'))
changed = np.abs(fixed - pre).max(-1) > 1.5 / 255
orig = np.zeros((N, N, 3), np.float32)
orig[ys, xs] = sample(src, ouv, 3).clip(0, 1)
covf = cov.astype(np.float32)
low = np.dstack([ndimage.gaussian_filter(orig[..., k] * covf, 2.5) for k in range(3)]) / np.maximum(ndimage.gaussian_filter(covf, 2.5), 1e-4)[..., None]
detail = np.clip(orig - low, -DETAIL, DETAIL)
# None of it near the original's own seams: Tripo packs its islands edge to edge, and the new layout runs
# across them, so a seam would come through as a line.
_, tri_isl, otris = islands(o.index, len(o.pos))
otid, _ = raster(o.uv * N, otris, None, N)
oisl = np.where(otid >= 0, tri_isl[np.maximum(otid, 0)], -1)
edge = np.zeros((N, N), bool)
edge[:, 1:] |= oisl[:, 1:] != oisl[:, :-1]
edge[1:, :] |= oisl[1:, :] != oisl[:-1, :]
seam = ndimage.distance_transform_edt(~edge).astype(np.float32)
away = np.clip((sample(seam[..., None], ouv, 1)[:, 0] - 2.0) / 3.0, 0, 1)
detail[ys, xs] *= away[:, None]
img = np.zeros((N, N, 3), np.float32)
img[ys, xs] = (sample(fixed, l1, 3) + detail[ys, xs]).clip(0, 1)
img = fill_gutters(img, cov)
Image.fromarray((img * 255 + 0.5).clip(0, 255).astype(np.uint8)).save(os.path.join(out, 'base.png'))
print(f'{name}: base {N} px, {cov.mean():.3f} covered; the fixes had changed {changed.mean():.3f} of the old atlas')
# The finer maps, at their own 1024.
cov1, val1 = rasterise(1024)
ys, xs = np.nonzero(cov1)
for key in ('normal', 'mr'):
    p = os.path.join(work, f'fix-{name}', f'{key}.png')
    if not os.path.exists(p):
        continue
    m = load(p)
    res = np.zeros((1024, 1024, 3), np.float32)
    res[ys, xs] = sample(m, val1[ys, xs, :2], 1)
    res = fill_gutters(res, cov1)
    Image.fromarray((res * 255 + 0.5).clip(0, 255).astype(np.uint8)).save(os.path.join(out, f'{key}.png'))
