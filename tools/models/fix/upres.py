"""
The cast's colour maps at 2048 (A14, the user: "scuffed and low res"), in each model's current layout:
  python tools/models/fix/upres.py <work> <out> <name...>

The shipped models were built (run.py) from 1024 px copies of Tripo's files; the originals in git (before
6f5f217) have 2048 px colour maps. This rebuilds every model's colour map at 2048 in its current atlas (the
repacked islands, or the singer's new unwrap) by sampling the 2048 original under each texel, then lays the
colour fixes (pink hands and feet, the duck float, the suit, the singer's face) back over it from the 1024
fix, so nothing the user approved changes.

Inputs in <work> (run.py's work folder): <name>/ (dump.mjs of the 1024 copy the fixes started from),
fix-<name>/ (run.py's output: uv.f32, keep.u8, base.png, base_fixed.png), a-singer/ (atlas.py: corners.bin,
base.png), o2k-<name>/ (dump.mjs of the 2048 original: git show 6f5f217^:public/models/npcs/<name>.glb).
Writes <out>/<name>.png (2048, sRGB) and <out>/<name>-cmp.jpg (old and new, side by side, on the face).
"""
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage
from scipy.spatial import cKDTree

sys.path.insert(0, os.path.dirname(__file__))
from texlib import Model, fill_gutters, raster

N = 2048


def load(path):
    return np.asarray(Image.open(path).convert('RGB'), np.float32) / 255


def corners_for(work, name, s):
    """Each kept triangle's corners: (vertex in the 1024 copy, its UV in the shipped atlas)."""
    a = os.path.join(work, f'a-{name}', 'corners.bin')
    if name == 'singer' and os.path.exists(a):
        rec = np.fromfile(a, dtype=[('t', '<i4'), ('v', '<i4'), ('u', '<f4'), ('w', '<f4')])
        return rec['v'].astype(np.int64), np.stack([rec['u'], rec['w']], 1).astype(np.float32), os.path.join(work, f'a-{name}', 'base.png')
    f = os.path.join(work, f'fix-{name}')
    uv = np.fromfile(os.path.join(f, 'uv.f32'), np.float32).reshape(-1, 2)
    keep = np.fromfile(os.path.join(f, 'keep.u8'), np.uint8).astype(bool)
    v = s.index[keep].reshape(-1)
    return v, uv[v], os.path.join(f, 'base.png')


def run(work, out, name):
    s = Model(os.path.join(work, name))
    o = Model(os.path.join(work, f'o2k-{name}'))
    src = o.image('base')
    assert src.shape[0] == N, f'{name}: the original colour map is {src.shape[0]} px'
    # The 1024 copy's vertices in the original: same positions, UVs within the 12-bit rounding.
    tree = cKDTree(np.concatenate([o.pos, o.uv], 1))
    dist, match = tree.query(np.concatenate([s.pos, s.uv], 1))
    print(f'{name}: matched {len(match)} vertices, worst {dist.max():.2e}, over 1e-3: {(dist > 1e-3).sum()}')
    v, new_uv, pre_path = corners_for(work, name, s)
    tris = np.arange(len(v)).reshape(-1, 3)
    # Every texel of the shipped atlas, at 2048: which triangle, and where that is in the original's UVs.
    tid, src_uv = raster(new_uv * N, tris, o.uv[match[v]].astype(np.float32), N)
    covered = tid >= 0
    ys, xs = np.nonzero(covered)
    sy, sx = src_uv[ys, xs, 1] * N - 0.5, src_uv[ys, xs, 0] * N - 0.5
    # Islands moved by whole texels sample texel centres exactly; a re-unwrap (the singer) resamples.
    order = 3 if name == 'singer' else 1
    img = np.zeros((N, N, 3), np.float32)
    for k in range(3):
        img[ys, xs, k] = ndimage.map_coordinates(src[..., k], [sy, sx], order=order, mode='nearest')
    img = img.clip(0, 1)
    # The approved colour fixes, from the 1024 fix: wherever the fix changed a texel inside an island.
    fixed = load(os.path.join(work, f'fix-{name}', 'base_fixed.png'))
    pre = load(pre_path)
    tid1, _ = raster(new_uv * 1024, tris, None, 1024)
    changed = (np.abs(fixed - pre).max(-1) > 1.5 / 255) & (tid1 >= 0)
    changed = ndimage.binary_dilation(changed, iterations=1)
    m = ndimage.gaussian_filter(changed.astype(np.float32), 0.6)
    m_up = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).resize((N, N), Image.BILINEAR), np.float32)[..., None] / 255
    fixed_up = np.asarray(Image.fromarray((fixed * 255 + 0.5).astype(np.uint8)).resize((N, N), Image.LANCZOS), np.float32) / 255
    img = img * (1 - m_up) + fixed_up * m_up
    img = fill_gutters(img, covered)
    print(f'{name}: {covered.mean():.3f} of the atlas covered, {changed.mean():.3f} from the fixes')
    os.makedirs(out, exist_ok=True)
    res = Image.fromarray((img * 255 + 0.5).clip(0, 255).astype(np.uint8))
    res.save(os.path.join(out, f'{name}.png'))
    # A check: the shipped 1024 (upscaled) beside the new 2048, round the face (the head's busiest island).
    head = s.bone_weight(['Head'])[v] > 0.6
    c = new_uv[head].mean(0) if head.any() else np.array([0.5, 0.5])
    cx, cy = int(c[0] * N), int(c[1] * N)
    box = (max(0, cx - 256), max(0, cy - 256), min(N, cx + 256), min(N, cy + 256))
    old = Image.fromarray((fixed * 255 + 0.5).astype(np.uint8)).resize((N, N), Image.LANCZOS).crop(box)
    cmp = Image.new('RGB', (old.width * 2 + 8, old.height), 'white')
    cmp.paste(old, (0, 0))
    cmp.paste(res.crop(box), (old.width + 8, 0))
    cmp.save(os.path.join(out, f'{name}-cmp.jpg'), quality=90)


if __name__ == '__main__':
    work, out = sys.argv[1], sys.argv[2]
    for n in sys.argv[3:]:
        run(work, out, n)
