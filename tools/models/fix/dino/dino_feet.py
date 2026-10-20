"""The dino's legs and feet in two clean colours: on every triangle of a shin or foot (not the claws), a texel
neither the suit's green nor the foot's pink (the grey band at the ankle, the white where the flat side piece sat)
takes the nearest clean texel's colour in its own island.
  python dino_feet.py <uv.f32> <base.png> <out.png>"""
import os
import sys
import numpy as np
from PIL import Image
from scipy import ndimage
from scipy.sparse.csgraph import connected_components
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from texlib import Model, raster
from cleanup import welded, hsv

uvf, src, dst = sys.argv[1:4]
m = Model('w2/dino')
uv = np.fromfile(uvf, np.float32).reshape(-1, 2)
img = np.asarray(Image.open(src).convert('RGB'), np.float32) / 255
n = img.shape[0]
rj = np.fromfile('w2/dino-rig/joints.f32', np.float32).reshape(-1, 4).astype(int)
rw = np.fromfile('w2/dino-rig/weights.f32', np.float32).reshape(-1, 4)
legs = [m.bones.index(b) for b in ('ShinL', 'FootL', 'ShinR', 'FootR')]
lw = np.where(np.isin(rj, legs), rw, 0).sum(1)
wid, A = welded(m)
_, lab = connected_components(A, directed=False)
shell = lab[wid]
big = np.bincount(lab)[shell] > 200
# By height, not weight (Tripo left some of the ankle on the thighs): the body below 25 cm, its claws aside.
P0 = np.fromfile('w2/dino-rig/pos.f32', np.float32).reshape(-1, 3)
sel = (P0[m.index][:, :, 1] < 0.25).all(1) & big[m.index].all(1)
tid, _ = raster(uv * n, m.index[sel], size=n)
region = tid >= 0
atid, _ = raster(uv * n, m.index, size=n)
cov = atid >= 0
isl, _ = ndimage.label(cov)
h, s, v = hsv(img)
hue = h * 360
green = (hue > 95) & (hue < 185) & (s > 0.4) & (v > 0.3)
pink = ((hue > 300) | (hue < 20)) & (s > 0.35) & (v > 0.35)
P = np.fromfile('w2/dino-rig/pos.f32', np.float32).reshape(-1, 3)
# Where the pink cuff ends, round each foot: per vertex the share of pink and green texels in its triangles, then
# for each turn round the leg, halfway between the pink's top and the green's bottom.
T = len(m.index)
ids = atid[cov]
tc = np.bincount(ids, minlength=T).astype(np.float32)
from scipy.sparse import coo_matrix
VT = coo_matrix((np.ones(3 * T), (m.index.ravel(), np.repeat(np.arange(T), 3))), shape=(len(P), T)).tocsr()
vt = VT @ tc
vp = (VT @ np.bincount(ids, weights=pink[cov].astype(np.float32), minlength=T)) / np.maximum(vt, 1)
vg = (VT @ np.bincount(ids, weights=green[cov].astype(np.float32), minlength=T)) / np.maximum(vt, 1)
inreg = np.zeros(len(P), bool)
inreg[m.index[sel].ravel()] = True
inreg &= P[:, 1] < 0.25
mid_x = (m.joint_pos('ThighL')[0] + m.joint_pos('ThighR')[0]) / 2
BINS = 12
border = {}
centre = {}
for side, sg in (('L', 1), ('R', -1)):
    fv = inreg & ((P[:, 0] - mid_x) * sg > 0)
    cx, cz = P[fv, 0].mean(), P[fv, 2].mean()
    centre[side] = (cx, cz)
    az = np.arctan2(P[:, 0] - cx, P[:, 2] - cz)
    b = np.full(BINS, np.nan)
    for i in range(BINS):
        a0 = -np.pi + i * 2 * np.pi / BINS
        inb = fv & (az >= a0) & (az < a0 + 2 * np.pi / BINS)
        pk = P[inb & (vp > 0.6), 1]
        gr = P[inb & (vg > 0.6), 1]
        if len(pk) and len(gr):
            b[i] = (np.percentile(pk, 90) + np.percentile(gr, 10)) / 2
    ok = ~np.isnan(b)
    xs = np.arange(BINS)
    b = np.interp(xs, xs[ok], b[ok], period=BINS)
    b = (np.roll(b, 1) + 2 * b + np.roll(b, -1)) / 4
    border[side] = b
    print(side, 'cuff top by turn', b.round(3))
_, Pt = raster(uv * n, m.index[sel], values=P.astype(np.float32), size=n)
yy, xx, zz = Pt[..., 1], Pt[..., 0], Pt[..., 2]
want_t = np.zeros((n, n), np.float32)
for side, sg in (('L', 1), ('R', -1)):
    on = region & ((xx - mid_x) * sg > 0)
    cx, cz = centre[side]
    az = np.arctan2(xx - cx, zz - cz)
    f = (az + np.pi) / (2 * np.pi) * BINS - 0.5
    bb = np.interp(f, np.arange(BINS), border[side], period=BINS)
    # A crisp edge, about a texel wide (pink blended into green passes through brown).
    t = np.clip((yy - bb) / 0.004 + 0.5, 0, 1)
    want_t[on] = (t * t * (3 - 2 * t))[on]
pc = np.median(img[region & pink], 0)
gc = np.median(img[region & green], 0)
paint = pc[None, None] * (1 - want_t[..., None]) + gc[None, None] * want_t[..., None]
# Kept where the texel is already what belongs there; painted in the band and wherever it isn't.
# (Near the clean colour too: the cuff's top had a dotted dark-red line that still counted as pink.)
keep_g = green & (want_t > 0.98) & (np.abs(img - gc).max(2) < 0.16)
keep_p = pink & (want_t < 0.02) & (np.abs(img - pc).max(2) < 0.14)
fix = region & ~keep_g & ~keep_p
out = img.copy()
out[fix] = paint[fix]
_, (gy, gx) = ndimage.distance_transform_edt(~cov, return_indices=True)
out[~cov] = out[gy[~cov], gx[~cov]]
Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8)).save(dst)
print('leg and foot texels', int(region.sum()), 'repainted', int(fix.sum()), 'pink', (pc * 255).astype(int), 'green', (gc * 255).astype(int))
