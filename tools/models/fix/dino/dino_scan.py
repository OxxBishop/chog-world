"""Thin marks on the dino's suit found where they show, in renders (colour with the map uncompressed, and the
texel each pixel shows): a pixel unlike nearly everything round it (under 15% of its 9x9 neighbourhood
shares its colour, so a border between two colours never counts) marks its texel; marked texels take the
colour of the nearest unmarked one in their island.
  python dino_scan.py <col.png> <uv.png> [<col.png> <uv.png> ...] -- <uv.f32> <base.png> <out.png>"""
import os
import sys
import numpy as np
from PIL import Image
from scipy import ndimage
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from texlib import Model, raster

args = sys.argv[1:]
k = args.index('--')
pairs = list(zip(args[:k:2], args[1:k:2]))
uvf, src, dst = args[k + 1:k + 4]
base = np.asarray(Image.open(src).convert('RGB'), np.float32) / 255
n = base.shape[0]
mark = np.zeros((n, n), np.int32)
seen = np.zeros((n, n), np.int32)
for cf, uf in pairs:
    col = np.asarray(Image.open(cf).convert('RGB'), np.float32) / 255
    uv = np.asarray(Image.open(uf).convert('RGB')).astype(int)
    model = uv.sum(2) > 0
    inner = ndimage.binary_erosion(model, iterations=3)
    tx = uv[..., 0] | ((uv[..., 2] & 15) << 8)
    ty = uv[..., 1] | ((uv[..., 2] >> 4) << 8)
    # Share of the 9x9 round each pixel within 0.09 of its colour (model pixels only).
    share = np.zeros(col.shape[:2], np.float32)
    cnt = np.zeros(col.shape[:2], np.float32)
    R = 4
    for dy in range(-R, R + 1):
        for dx in range(-R, R + 1):
            sh = np.roll(col, (dy, dx), (0, 1))
            mm = np.roll(model, (dy, dx), (0, 1))
            share += (np.abs(sh - col).max(2) < 0.09) & mm
            cnt += mm
    lone = inner & (share / np.maximum(cnt, 1) < 0.15)
    np.add.at(seen, (ty[inner], tx[inner]), 1)
    np.add.at(mark, (ty[lone], tx[lone]), 1)
    print(cf, 'lone pixels', int(lone.sum()))
bad = mark > 0
bad = ndimage.binary_dilation(bad, iterations=1) & (seen > 0) | bad
m = Model('w2/dino')
uvv = np.fromfile(uvf, np.float32).reshape(-1, 2)
tid, _ = raster(uvv * n, m.index, size=n)
cov = tid >= 0
lab, _ = ndimage.label(cov)
# The body only (not the head: its face's fine lines, eyes and brows are meant to be thin).
rj = np.fromfile('w2/dino-rig/joints.f32', np.float32).reshape(-1, 4).astype(int)
rw = np.fromfile('w2/dino-rig/weights.f32', np.float32).reshape(-1, 4)
hn = np.where(np.isin(rj, [m.bones.index('Head'), m.bones.index('Neck')]), rw, 0).sum(1)
btid, _ = raster(uvv * n, m.index[(hn[m.index] < 0.5).all(1)], size=n)
bad &= btid >= 0
good = cov & ~bad
_, (iy, ix) = ndimage.distance_transform_edt(~good, return_indices=True)
out = base.copy()
# Only from the same island.
fix = bad & (lab[iy, ix] == lab)
out[fix] = base[iy[fix], ix[fix]]
# Gutters again from the islands.
_, (gy, gx) = ndimage.distance_transform_edt(~cov, return_indices=True)
out[~cov] = out[gy[~cov], gx[~cov]]
Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8)).save(dst)
print('texels repainted', int(fix.sum()))
