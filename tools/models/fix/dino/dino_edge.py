"""Each atlas island's outermost texels (Tripo baked them with its neighbours' colours: thin red-brown lines
along every seam) and the gutters round it, filled from the island's own texels a couple inside.
  python dino_edge.py <dump with uv> <uv.f32> <base.png> <out.png> [depth px]"""
import os
import sys
import numpy as np
from PIL import Image
from scipy import ndimage
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from texlib import Model, raster

d, uvf, src, dst = sys.argv[1:5]
depth = int(sys.argv[5]) if len(sys.argv) > 5 else 2
m = Model(d)
uv = np.fromfile(uvf, np.float32).reshape(-1, 2)
img = np.asarray(Image.open(src).convert('RGB'), np.float32) / 255
n = img.shape[0]
tid, _ = raster(uv * n, m.index, size=n)
cov = tid >= 0
lab, k = ndimage.label(cov)
inner = ndimage.binary_erosion(cov, iterations=depth)
# An island too thin to have an inside keeps its texels as they are.
has_in = np.zeros(k + 1, bool)
has_in[np.unique(lab[inner])] = True
# The body's islands only (the head's carry the face, whose eye rims and brows run along their edges).
rj = np.fromfile('w2/dino-rig/joints.f32', np.float32).reshape(-1, 4).astype(int)
rw = np.fromfile('w2/dino-rig/weights.f32', np.float32).reshape(-1, 4)
hn = np.where(np.isin(rj, [m.bones.index('Head'), m.bones.index('Neck')]), rw, 0).sum(1)
btid, _ = raster(uv * n, m.index[(hn[m.index] < 0.5).all(1)], size=n)
body_share = ndimage.mean((btid >= 0).astype(np.float32), lab, np.arange(k + 1))
is_body = np.asarray(body_share) > 0.5
is_body[0] = False
src_ok = inner | (cov & ~has_in[lab]) | (cov & ~is_body[lab])
_, (iy, ix) = ndimage.distance_transform_edt(~src_ok, return_indices=True)
out = img.copy()
# An edge texel takes its own island's colour only (a thin claw's tip once came out dark from an eye nearby).
fill = cov & ~src_ok & (lab[iy, ix] == lab)
out[fill] = img[iy[fill], ix[fill]]
_, (gy, gx) = ndimage.distance_transform_edt(~cov, return_indices=True)
out[~cov] = out[gy[~cov], gx[~cov]]
Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8)).save(dst)
print(k, 'islands;', int(fill.sum()), 'edge texels and', int((~cov).sum()), 'gutter texels refilled')
