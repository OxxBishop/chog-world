"""
Repack a cast model's atlas with gutters: python tools/models/fix/repack.py <dumpdir> <outdir> [margin px] [drop.npy]

Tripo packs a model's texture islands edge to edge, so from any distance (the smaller mip levels) each
island's edge picks up its neighbour's colour: the body's purple along the duck float's seams, hair along
a face. This moves every island, pixel for pixel (no resampling, no turning), into a new atlas with a gap
of <margin> px round each, and fills the gaps from each island's own edge. drop.npy: triangle indices to
delete first (they leave the atlas too).

Writes <outdir>/base.png, normal.png, mr.png, uv.f32 (new UV per vertex), keep.npy (triangles kept),
islands.png (preview).
"""
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from texlib import Model, W, fill_gutters, islands, pack, raster

src, out = sys.argv[1], sys.argv[2]
margin = int(sys.argv[3]) if len(sys.argv) > 3 else 4
os.makedirs(out, exist_ok=True)
m = Model(src)
keep = np.ones(len(m.index), bool)
if len(sys.argv) > 4:
    keep[np.load(sys.argv[4])] = False
n, tri_isl, tris = islands(m.index, len(m.pos), keep)
px = m.uv * W
tid, _ = raster(px, tris)
pix_isl = np.where(tid >= 0, tri_isl[np.maximum(tid, 0)], -1)
print(f'{n} islands, {keep.sum()} triangles, {(tid >= 0).mean():.3f} of the atlas covered')

masks, boxes = [], []
for i in range(n):
    ys, xs = np.nonzero(pix_isl == i)
    if not len(ys):
        # Smaller than a texel: the texel under its middle.
        c = px[np.unique(tris[tri_isl == i])].mean(0)
        x, y = int(np.clip(c[0], 0, W - 1)), int(np.clip(c[1], 0, W - 1))
        masks.append(np.ones((1, 1), bool))
        boxes.append((y, x))
        continue
    # The box holds the island's texels and every one of its vertices, so no UV lands off the atlas.
    vp = px[np.unique(tris[tri_isl == i])]
    y0, x0 = min(ys.min(), int(np.floor(vp[:, 1].min()))), min(xs.min(), int(np.floor(vp[:, 0].min())))
    y1, x1 = max(ys.max(), int(np.ceil(vp[:, 1].max())) - 1), max(xs.max(), int(np.ceil(vp[:, 0].max())) - 1)
    mk = np.zeros((y1 - y0 + 1, x1 - x0 + 1), bool)
    mk[ys - y0, xs - x0] = True
    masks.append(mk)
    boxes.append((y0, x0))
order = np.argsort([-mk.size for mk in masks])
# The widest gutter that fits (a model of many tiny islands, like the singer, takes a narrower one).
places = None
while places is None and margin >= 1:
    places = pack(masks, W, margin, order)
    if places is None:
        margin -= 1
if places is None:
    sys.exit('does not fit even with a 1 px gutter')
print('gutter', margin, 'px')

uv = m.uv.copy()
vert_isl = np.full(len(m.pos), -1)
for c in range(3):
    vert_isl[tris[:, c]] = tri_isl
for i in range(n):
    dy, dx = places[i][0] - boxes[i][0], places[i][1] - boxes[i][1]
    sel = vert_isl == i
    uv[sel, 0] += dx / W
    uv[sel, 1] += dy / W
uv = uv.clip(0, 1)
uv.astype(np.float32).tofile(os.path.join(out, 'uv.f32'))
np.save(os.path.join(out, 'keep.npy'), keep)
keep.astype(np.uint8).tofile(os.path.join(out, 'keep.u8'))

covered = np.zeros((W, W), bool)
prev = np.zeros((W, W, 3), np.float32)
rng = np.random.default_rng(1)
cols = rng.random((n, 3)) * 0.8 + 0.2
newmaps = {}
for key in ('base', 'normal', 'mr'):
    img = m.image(key)
    if img is None:
        continue
    new = np.zeros_like(img)
    for i in range(n):
        y0, x0 = boxes[i]
        y1, x1 = places[i]
        mk = masks[i]
        h, w = mk.shape
        sy, sx = max(0, -y0), max(0, -x0)
        mk = mk[sy:, sx:]
        h, w = mk.shape
        y0, x0, y1, x1 = y0 + sy, x0 + sx, y1 + sy, x1 + sx
        src = img[y0 : y0 + h, x0 : x0 + w]
        mk = mk[: src.shape[0], : src.shape[1]]
        h, w = mk.shape
        new[y1 : y1 + h, x1 : x1 + w][mk] = src[mk]
        if key == 'base':
            covered[y1 : y1 + h, x1 : x1 + w] |= mk
            prev[y1 : y1 + h, x1 : x1 + w][mk] = cols[i]
    new = fill_gutters(new, covered)
    Image.fromarray((new * 255 + 0.5).clip(0, 255).astype(np.uint8)).save(os.path.join(out, f'{key}.png'))
Image.fromarray((prev * 255).astype(np.uint8)).save(os.path.join(out, 'islands.png'))
print('packed; atlas', f'{covered.mean():.3f}', 'covered')
