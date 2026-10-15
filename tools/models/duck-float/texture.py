# Clean the purple spill off the float and add contact shadow where it meets the body, in the colour map.
import json
import os

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

D = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'work')
F = json.load(open(os.path.join(D, 'faces.json')))
base = np.asarray(Image.open(os.path.join(D, 'base.png')).convert('RGB')).astype(np.float32) / 255
ao = np.asarray(Image.open(os.path.join(D, 'ao.png')).convert('L')).astype(np.float32) / 255
H, W = base.shape[:2]
SS = 4


def mask_of(polys):
    m = Image.new('L', (W * SS, H * SS), 0)
    d = ImageDraw.Draw(m)
    for poly in polys:
        d.polygon([(u * W * SS, (1 - v) * H * SS) for u, v in poly], fill=255)
    return np.asarray(m.resize((W, H), Image.BOX)).astype(np.float32) / 255


duck = mask_of(F['duck'])
band = mask_of([p for p, dist in F['band']])
body = mask_of(F['body'])
# The float's own texels: covered by float faces more than by any body face.
duck_in = (duck > 0.2) & (duck >= body)
r, g, b = base[..., 0], base[..., 1], base[..., 2]
mx, mn = base.max(-1), base.min(-1)
sat = (mx - mn) / np.maximum(mx, 1e-3)
lum = base @ np.array([0.299, 0.587, 0.114], np.float32)
yellow = (r > 0.55) & (g > 0.4) & (b < 0.4) & (r - b > 0.3)
purple = (b > g + 0.06) & (sat > 0.18) & ~yellow
# Purple on the float (and the muddy mix at its edge) gets painted with the float's own yellow round it.
mud = duck_in & (purple | ((b > g) & (lum < 0.55) & (lum > 0.12) & ~yellow))
mud = ndi.binary_dilation(mud, iterations=1) & duck_in & ~((lum < 0.12) | ((r > 0.8) & (g < 0.6) & (b < 0.3)))  # keep eyes, beak
src = (duck_in & yellow & ~mud).astype(np.float32)
out = base.copy()
for sigma in (16, 8, 4, 2):
    num = np.dstack([ndi.gaussian_filter(base[..., k] * src, sigma) for k in range(3)])
    den = ndi.gaussian_filter(src, sigma)[..., None]
    est = num / np.maximum(den, 1e-6)
    ok = mud & (den[..., 0] > 0.03)
    out[ok] = est[ok]
# And the reverse: yellow that spilled onto the body next to the float goes back to the body's purple.
body_in = (body > 0.2) & (body > duck) & (band > 0.05)
spill = body_in & (yellow | ((r > b) & (g > b) & (sat > 0.25)))
spill = ndi.binary_dilation(spill, iterations=1) & body_in
src2 = (body_in & purple & ~spill).astype(np.float32)
for sigma in (16, 8, 4, 2):
    num = np.dstack([ndi.gaussian_filter(base[..., k] * src2, sigma) for k in range(3)])
    den = ndi.gaussian_filter(src2, sigma)[..., None]
    est = num / np.maximum(den, 1e-6)
    ok = spill & (den[..., 0] > 0.03)
    out[ok] = est[ok]
print('body px repainted', int(spill.sum()))
print('repainted px', int(mud.sum()), 'duck px', int((duck > 0.3).sum()))
# Contact shadow: the baked occlusion, only round the join (float and the body next to it), feathered.
where = ndi.gaussian_filter(np.clip(duck + band, 0, 1), 3)
k = 0.8 * where
shade = 1 - k * (1 - np.clip(ao, 0, 1))
out *= shade[..., None]
Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(D, 'basecolor_fixed.jpg'), quality=93, subsampling=0)
# Before/after crops of the float's area for a look.
ys, xs = np.nonzero(duck > 0.3)
x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
a = Image.fromarray((base[y0:y1, x0:x1] * 255).astype(np.uint8))
bimg = Image.fromarray((np.clip(out[y0:y1, x0:x1], 0, 1) * 255).astype(np.uint8))
cmp = Image.new('RGB', (a.width * 2 + 10, a.height))
cmp.paste(a, (0, 0)); cmp.paste(bimg, (a.width + 10, 0))
cmp.save(os.path.join(D, 'tex_cmp.jpg'), quality=88)
print('ao range', float(ao.min()), float(ao.max()))
