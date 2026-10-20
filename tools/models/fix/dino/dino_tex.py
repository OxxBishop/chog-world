"""The dino's colour map cleaned: on the green suit and the purple spikes, the stray colours (purple smudged onto
green, red-brown specks) painted out from the colour round them; then every texel outside the islands filled
from the nearest one inside (so seams stop bleeding Tripo's gutter colours). Writes w2/dino-tex/base.png and
r3/dinotex.png (what changed, in red)."""
import os
import sys
import numpy as np
from PIL import Image
from scipy import ndimage
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from texlib import Model, raster
from cleanup import hsv

OUT = 'w2/dino-tex'
SMOOTH = int(sys.argv[1]) if len(sys.argv) > 1 else 8
os.makedirs(OUT, exist_ok=True)
m = Model('w2/dino')
img = np.asarray(Image.open('w2/dino/base.png').convert('RGB'), np.float32) / 255
n = img.shape[0]
tid, _ = raster(m.uv * n, m.index, size=n)
cov = tid >= 0
h, s, v = hsv(img)
hue = h * 360
GREEN = (hue > 95) & (hue < 185) & (s > 0.25) & (v > 0.2)
PURPLE = (hue > 245) & (hue < 320) & (s > 0.2) & (v > 0.2)
# Each triangle's class by its own texels: green or purple when most of them are (a smudge inside one doesn't
# change it); the boundary between the two stays as it is.
T = len(m.index)
ids = tid[cov]
tot = np.bincount(ids, minlength=T).astype(np.float32)
fg = np.bincount(ids, weights=GREEN[cov].astype(np.float32), minlength=T) / np.maximum(tot, 1)
fp = np.bincount(ids, weights=PURPLE[cov].astype(np.float32), minlength=T) / np.maximum(tot, 1)
# Smaller triangles hold few texels: also count the triangles round them (by shared vertex).
from scipy.sparse import coo_matrix
r = np.repeat(np.arange(T), 3); c = m.index.ravel()
VT = coo_matrix((np.ones(len(r)), (c, r)), shape=(len(m.pos), T)).tocsr()
TT = (VT.T @ VT).tocsr()
sg = TT @ (fg * tot); sp = TT @ (fp * tot); st = TT @ tot
fg2, fp2 = sg / np.maximum(st, 1), sp / np.maximum(st, 1)
tg = (fg2 > 0.75) & (fg > 0.5)
tp = (fp2 > 0.75) & (fp > 0.5)
cls = np.zeros((n, n), np.int8)
cls[cov] = np.where(tg[ids], 1, np.where(tp[ids], 2, 0))
# Stray: anything off the class's colour, but not dark or white (the hood's eyes and nostrils, the teeth).
keep = (v < 0.2) | ((s < 0.15) & (v > 0.75))
bad = (((cls == 1) & ~GREEN) | ((cls == 2) & ~PURPLE)) & ~keep
bad = ndimage.binary_dilation(bad, iterations=1) & (cls > 0) & ~keep
print('stray texels: green', int((bad & (cls == 1)).sum()), 'purple', int((bad & (cls == 2)).sum()))
out = img.copy()
for c in (1, 2):
    good = (cls == c) & ~bad & (GREEN if c == 1 else PURPLE)
    b = bad & (cls == c)
    if not b.any():
        continue
    # A smooth fill: the good colour round each stray texel, wider where the patch is big.
    acc = np.zeros_like(img)
    wsum = np.zeros((n, n), np.float32)
    for sig in (2, 5, 12):
        wv = ndimage.gaussian_filter(good.astype(np.float32), sig)
        cv = np.stack([ndimage.gaussian_filter(img[..., k] * good, sig) for k in range(3)], -1)
        take = (wsum < 0.2) & (wv > 0.05)
        acc[take] = cv[take] / wv[take, None]
        wsum[take] = 1
    fill = b & (wsum > 0)
    out[fill] = acc[fill]
    # Anything a patch so big none of that reached: the nearest good texel.
    rest = b & ~fill
    if rest.any():
        _, (iy, ix) = ndimage.distance_transform_edt(~good, return_indices=True)
        out[rest] = img[iy[rest], ix[rest]]
# Tripo's smears where the green suit meets the purple spikes (a grey teal that reads as dirt). Where the edge
# goes is decided on the mesh, not in the atlas (whose neighbours aren't the surface's): each vertex clean green
# (0) or clean purple (1) by its colour, the smeared ones in between filled in smoothly across the welded surface;
# that, drawn into the atlas, puts a clean edge halfway, softened over a few texels.
from cleanup import welded
h2, s2, v2 = hsv(out)
hue2 = h2 * 360
pg = cov & (hue2 > 118) & (hue2 < 153) & (s2 > 0.5) & (v2 > 0.3)
pp = cov & (hue2 > 262) & (hue2 < 320) & (s2 > 0.33) & (v2 > 0.25)
mixed = cov & (v2 > 0.25) & (v2 < 0.72) & (s2 > 0.08) & (
    ((hue2 >= 153) & (hue2 <= 262)) | ((hue2 > 262) & (hue2 < 320) & (s2 <= 0.33)) | ((hue2 > 95) & (hue2 <= 153) & (s2 <= 0.5)))
# Each vertex's colours from the texels of its own triangles only (a 3x3 round its UV reached into the gutter,
# whose colours outlined the islands).
idc = tid[cov]
tcount = np.bincount(idc, minlength=T).astype(np.float32)
tri_frac = lambda mask: np.bincount(idc, weights=mask[cov].astype(np.float32), minlength=T)
vt_tot = VT @ tcount
vg_, vp_, vm_ = ((VT @ tri_frac(x)) / np.maximum(vt_tot, 1) for x in (pg, pp, mixed))
wid, A = welded(m)
nw = A.shape[0]
# Per welded vertex: the most of each kind among its copies.
cnt = np.bincount(wid, minlength=nw).astype(np.float32)
G_ = np.bincount(wid, weights=vg_, minlength=nw) / cnt
P_ = np.bincount(wid, weights=vp_, minlength=nw) / cnt
M_ = np.bincount(wid, weights=vm_, minlength=nw) / cnt
# A vertex's share of purple among the clean texels round it; one with too few clean ones is filled in.
known = (G_ + P_) > 0.3
f = np.where(known, P_ / np.maximum(G_ + P_, 1e-6), 0.0)
# Only the green and purple parts of the surface take part (skin, pink, teeth are walls).
part = known | (M_ > 0.3)
A = A.tocsr()
deg = np.asarray(A.multiply(part[None, :]).sum(1)).ravel()
free = part & ~known
for _ in range(400):
    nb = (A @ (f * part)) / np.maximum(deg, 1)
    f[free] = nb[free]
# Smoothed over the surface, so a speck of one colour inside the other (a vertex or two) goes with its
# surroundings and the edge runs clean.
for _ in range(SMOOTH):
    nb = (A @ (f * part)) / np.maximum(deg, 1)
    f[part] = 0.5 * f[part] + 0.5 * nb[part]
fv = f[wid].astype(np.float32)
_, fimg = raster(m.uv * n, m.index, values=fv[:, None], size=n)
fimg = fimg[..., 0]
# Where the suit and spikes are (the face, its brows and hair, the eyes and teeth are left alone).
_, pimg = raster(m.uv * n, m.index, values=part[wid].astype(np.float32)[:, None], size=n)
onsuit = pimg[..., 0] > 0.99
Gc = np.median(out[pg], 0)
Pc = np.median(out[pp], 0)
# The smear and a ring round it, so the edge's soft side blends into what's there.
zone = ndimage.binary_dilation(mixed, iterations=2) & cov & ~((hue2 > 95) & (hue2 < 320) & (s2 > 0.08) & ~mixed & ~pg & ~pp)
t = np.clip((fimg - 0.38) / 0.24, 0, 1)
t = t * t * (3 - 2 * t)
paint = (Gc[None, None] * (1 - t[..., None]) + Pc[None, None] * t[..., None])
# Painted: the smear, the band along the edge, and any texel of one colour where the surface says the other.
# (A speck: a small patch of one colour, under 400 texels, where the surface round it is clearly the other.)
def specks(mask, wrong):
    lab, k = ndimage.label(mask)
    if k == 0:
        return np.zeros_like(mask)
    size = ndimage.sum(np.ones_like(fimg), lab, np.arange(1, k + 1))
    mf = ndimage.mean(fimg, lab, np.arange(1, k + 1))
    ok = np.zeros(k + 1, bool)
    ms = ndimage.mean(onsuit.astype(np.float32), lab, np.arange(1, k + 1))
    ok[1:] = (size < 400) & wrong(mf) & (ms > 0.99)
    return ok[lab]
sp_g = specks(pg, lambda x: x > 0.8)
sp_p = specks(pp, lambda x: x < 0.2)
near = ((mixed | ((pg | pp) & (fimg > 0.35) & (fimg < 0.65))) & onsuit) | sp_g | sp_p
print('specks: green in purple', int(sp_g.sum()), 'purple in green', int(sp_p.sum()))
out[near] = paint[near]
ring = zone & ~mixed & (pg | pp)
# Smooth the boundary between the painted smear and the clean texels round it by a pixel.
blur = np.stack([ndimage.gaussian_filter(out[..., k], 0.8) for k in range(3)], -1)
edge = ndimage.binary_dilation(near, iterations=1) & ~ndimage.binary_erosion(near, iterations=1) & cov
out[edge] = blur[edge]
print('smear texels', int(near.sum()), 'vertices free', int(free.sum()))
# Thin dark brush lines on the green: a texel well off its 5x5 median's brightness takes the median.
g_now = cov & (hsv(out)[0] * 360 > 95) & (hsv(out)[0] * 360 < 185) & (hsv(out)[1] > 0.3)
mf = np.stack([ndimage.median_filter(out[..., k], 5) for k in range(3)], -1)
lum = lambda a: a @ np.array([0.299, 0.587, 0.114], np.float32)
streak = g_now & (np.abs(lum(out) - lum(mf)) > 0.035)
out[streak] = mf[streak]
print('streak texels', int(streak.sum()))
bad = bad | near | streak
# The hands all pink (the user on the cast, 10-17: "the pink doesn't cover their entire hand"): every texel of a
# triangle the new hand bones hold any of, but the green cuff, in the hands' own pink, shaded as it was.
rj = np.fromfile('w2/dino-rig/joints.f32', np.float32).reshape(-1, 4).astype(int)
rw = np.fromfile('w2/dino-rig/weights.f32', np.float32).reshape(-1, 4)
hand_ids = [len(m.bones) + 2, len(m.bones) + 5]
hw = np.where(np.isin(rj, hand_ids), rw, 0).sum(1)
htid, _ = raster(m.uv * n, m.index[(hw[m.index] > 0.03).all(1)], size=n)
hm = htid >= 0
h3, s3, v3 = hsv(out)
hue3 = h3 * 360
cuff = (hue3 > 95) & (hue3 < 185) & (s3 > 0.25)
pinkish = ((hue3 > 300) | (hue3 < 15)) & (s3 > 0.3) & (v3 > 0.4)
hpaint = hm & ~cuff
pink = np.median(out[hm & pinkish], 0)
L3 = lum(out)
shade = np.clip(L3 / max(np.median(L3[hm & pinkish]), 1e-3), 0.85, 1.1) ** 0.6
ha = ndimage.gaussian_filter(hpaint.astype(np.float32), 0.8) * hpaint
out = out * (1 - ha[..., None]) + np.clip(pink[None, None] * shade[..., None], 0, 1) * ha[..., None]
print('hands: pink', np.round(pink * 255).astype(int), 'over', int(hpaint.sum()), 'texels')
bad = bad | hpaint
# Gutters: every texel outside the islands takes the nearest island texel's colour.
_, (iy, ix) = ndimage.distance_transform_edt(~cov, return_indices=True)
out[~cov] = out[iy[~cov], ix[~cov]]
Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8)).save(f'{OUT}/base.png')
vis = (img * 0.5 * 255).astype(np.uint8)
vis[bad] = (255, 40, 40)
Image.fromarray(vis).save('r3/dinotex.png')
print('gutter texels filled', int((~cov).sum()))
