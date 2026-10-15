"""
Clear the skin out of a face sheet: python tools/models/fix/sheet.py <sheet.png> <out.png>

A face sheet's cells carry patches of the old capture's skin round the features (and its blush), which show
as smudges and slashes once the model's own face skin is clean (the singer). This keeps only the features:
eye whites, irises, lashes and lines, mouths. In the eye cells (top half) skin and blush go; in the mouth
cells (bottom half) only the skin, so the lips stay.
"""
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

src, dst = sys.argv[1], sys.argv[2]
im = np.asarray(Image.open(src).convert('RGBA'), np.float32) / 255
rgb, a = im[..., :3], im[..., 3]
mx, mn = rgb.max(-1), rgb.min(-1)
d = mx - mn
s = np.where(mx > 0, d / np.maximum(mx, 1e-5), 0)
r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
h = np.zeros_like(mx)
sel = d > 1e-5
rr = (mx == r) & sel
gg = (mx == g) & sel & ~rr
bb = sel & ~rr & ~gg
h[rr] = ((g - b)[rr] / d[rr]) % 6
h[gg] = (b - r)[gg] / d[gg] + 2
h[bb] = (r - g)[bb] / d[bb] + 4
h *= 60
H = im.shape[0]
top = np.zeros(im.shape[:2], bool)
top[: H // 2] = True
peach = (mx > 0.55) & (s > 0.08) & (s < 0.5) & (h > 8) & (h < 48)
pink = (mx > 0.55) & (s > 0.12) & ((h > 315) | (h < 12))
clear = (peach | (pink & top)) & (a > 0)
# Soft edge: features keep their alpha, cleared skin fades out over a pixel.
keep = (a > 0) & ~clear
fade = ndi.gaussian_filter(keep.astype(np.float32), 0.8)
out = im.copy()
out[..., 3] = np.where(clear, np.minimum(a, fade * 0.6), a)
Image.fromarray((out * 255 + 0.5).clip(0, 255).astype(np.uint8)).save(dst)
print('cleared', int(clear.sum()), 'px of', int((a > 0).sum()))
