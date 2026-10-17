"""
The user's notes of 10-17 on the shipped cast (A):
  python tools/models/fix/cleanup.py <dump dir> <base.png> <out dir> <task...>
<dump dir>: dump.mjs of the shipped model; <base.png>: its colour map, decoded (ktx extract --transcode rgba8).
Tasks:
  hands  the pink that only tipped the fingers now covers each hand ("that color on the chog's fingertips
         should cover her hands"); the sleeve stays as it is.
  back   Toasty's shirt back cleaned ("heavily scuffed"): Tripo smeared it; each texel is read as shirt red,
         flame orange or skin, the classes smoothed, and painted in the shirt's own clean colours from its front,
         keeping a little of the shading.
  cords  Toasty's hat cords (see cords()); writes joints.f32, weights.f32 and index.u32 for patch.mjs.
  rigid  pieces of skin (UV islands) the head holds almost entirely held by it wholly: Toasty's hat cords hung
         from the ear flaps to loops on his shoulders and stretched down his back when his arms came down.
Writes <out dir>/base.png (when a texture task ran) and joints.f32 / weights.f32 (rigid) for patch.mjs.
"""
import colorsys
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

sys.path.insert(0, os.path.dirname(__file__))
from texlib import Model, islands, raster


def hsv(img):
    mx, mn = img.max(2), img.min(2)
    v = mx
    s = np.where(mx > 1e-4, (mx - mn) / np.maximum(mx, 1e-4), 0)
    r, g, b = img[..., 0], img[..., 1], img[..., 2]
    d = np.maximum(mx - mn, 1e-4)
    h = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) / 6
    return h, s, v


def lum(img):
    return img @ np.array([0.299, 0.587, 0.114], np.float32)


def tri_mask_tris(m, tris, size):
    tid, _ = raster(m.uv * size, tris, size=size)
    return tid >= 0


def tri_mask(m, keep, size):
    px = m.uv * size
    tid, _ = raster(px, m.index[keep], size=size)
    return tid >= 0


def hands(m, img):
    n = img.shape[0]
    w = m.bone_weight(['HandL', 'HandR'])
    keep = (w[m.index] > 0.35).all(1)
    mask = tri_mask(m, keep, n)
    h, s, v = hsv(img)
    hue = h * 360
    # The sleeve (purple, blue) and anything dark stays; skin and pink become pink.
    sleeve = (hue > 200) & (hue < 320) & (s > 0.2)
    pinkish = ((hue > 320) | (hue < 15)) & (s > 0.22) & (v > 0.45)
    paint = mask & ~sleeve & (v > 0.3)
    ref = img[mask & pinkish]
    if len(ref) < 50:
        print('  no pink on the hands to match; skipped')
        return img, 0
    pink = np.median(ref, 0)
    L = lum(img)
    lref = np.median(L[paint])
    shade = np.clip(L / max(lref, 1e-3), 0.8, 1.12) ** 0.6
    new = np.clip(pink[None, None] * shade[..., None], 0, 1)
    # Soft at the sleeve's edge.
    a = ndimage.gaussian_filter(paint.astype(np.float32), 0.8) * paint
    out = img * (1 - a[..., None]) + new * a[..., None]
    print(f'  pink {np.round(pink * 255).astype(int)} over {paint.sum()} texels')
    return out, paint.sum()


def back(m, img):
    n = img.shape[0]
    body = m.bone_weight(['Hips', 'Spine', 'Chest', 'Neck'])
    arms = m.bone_weight(['UpperArmL', 'UpperArmR', 'ForeArmL', 'ForeArmR'])
    nz = m.nrm[:, 2]
    y = m.pos[:, 1]
    vk = (body > 0.6) & (arms < 0.25) & (nz < -0.15) & (y > 0.45) & (y < 1.15)
    keep = vk[m.index].all(1)
    mask = tri_mask(m, keep, n)
    front_k = ((body > 0.6) & (nz > 0.5) & (y > 0.45) & (y < 1.1))[m.index].all(1)
    front = tri_mask(m, front_k, n)
    h, s, v = hsv(img)
    hue = h * 360
    red = ((hue < 14) | (hue > 340)) & (s > 0.55) & (v > 0.35)
    # Flame orange is bright; the brown skin of the arms and neck is the same hue but darker.
    orange = (hue >= 18) & (hue < 55) & (s > 0.55) & (v > 0.72)
    skin = (hue >= 8) & (hue < 45) & (v <= 0.72) & ~red
    shirt_red = np.median(img[front & red], 0)
    flame = np.median(img[front & orange], 0)
    # Classes in the back: 0 leave, 1 red, 2 orange. Smoothed so the smears become clean shapes.
    cls = np.zeros(img.shape[:2], np.uint8)
    cls[mask & red] = 1
    cls[mask & orange] = 2
    # Whatever else smeared into the shirt (dark streaks, odd reds) joins the class around it.
    other = mask & (cls == 0) & ~skin
    if other.any():
        _, (iy, ix) = ndimage.distance_transform_edt(cls == 0, return_indices=True)
        cls[other] = cls[iy[other], ix[other]]
    cls = ndimage.median_filter(cls, size=9) * mask
    new = img.copy()
    L = lum(img)
    for k, col in ((1, shirt_red), (2, flame)):
        sel = cls == k
        if not sel.any():
            continue
        shade = np.clip(L[sel] / np.median(L[sel]), 0.85, 1.1) ** 0.35
        new[sel] = np.clip(col[None] * shade[:, None], 0, 1)
    a = ndimage.gaussian_filter((cls > 0).astype(np.float32), 1.2) * (cls > 0)
    out = img * (1 - a[..., None]) + new * a[..., None]
    # The class edges softened a touch, within the shirt only.
    soft = np.stack([ndimage.gaussian_filter(out[..., c], 1.0) for c in range(3)], 2)
    edge = (ndimage.morphological_gradient(cls, size=3) > 0) & (cls > 0)
    out[edge] = soft[edge]
    print(f'  back: red {np.round(shirt_red * 255).astype(int)}, flame {np.round(flame * 255).astype(int)}, {int((cls > 0).sum())} texels')
    return out, (cls > 0).sum()


def rigid(m, out_dir, keep_above=0.9):
    H = m.bones.index('Head')
    hw = m.bone_weight(['Head'])
    # Only pieces an arm pulls at (a cord's loop on the shoulder): the head's own, which meet the neck, keep
    # their blend there (made rigid, the neck's seam would open as the head turns).
    aw = m.bone_weight(['UpperArmL', 'UpperArmR', 'ForeArmL', 'ForeArmR', 'HandL', 'HandR'])
    k, tl, tris = islands(m.index, len(m.pos))
    joints = m.joints.astype(np.float32).copy()
    weights = m.weights.copy()
    changed = 0
    for i in range(k):
        vs = np.unique(tris[tl == i])
        if hw[vs].mean() < keep_above or hw[vs].min() > 0.995 or aw[vs].max() < 0.05:
            continue
        lo, hi = m.pos[vs].min(0), m.pos[vs].max(0)
        print(f'    piece {i}: {len(vs)} vertices, {np.round(lo, 2)} .. {np.round(hi, 2)}, arm up to {aw[vs].max():.2f}')
        joints[vs] = [H, 0, 0, 0]
        weights[vs] = [1, 0, 0, 0]
        changed += len(vs)
    joints.astype(np.float32).tofile(os.path.join(out_dir, 'joints.f32'))
    weights.astype(np.float32).tofile(os.path.join(out_dir, 'weights.f32'))
    print(f'  rigid: {changed} vertices now held by the head alone')


def cords(m, img, out_dir):
    """
    Toasty's hat cords: a thin red stick from each ear flap down to a ring on the shoulder, all one skin, so
    the stick stretched from the head to the arm. The stick goes with the head and the triangles joining it
    to the ring are cut (the ring stays on the arm, a band round the shoulder).
    """
    n = img.shape[0]
    px = np.clip((m.uv * n).astype(int), 0, n - 1)
    c = img[px[:, 1], px[:, 0]]
    mx, mn = c.max(1), c.min(1)
    red = (c[:, 0] > 0.45) & (c[:, 1] < 0.25) & ((mx - mn) / np.maximum(mx, 1e-4) > 0.6)
    x, y, _ = m.pos.T
    d = np.full(len(x), 9.0)
    for side in 'LR':
        a, b = m.joint_pos('UpperArm' + side), m.joint_pos('Hand' + side)
        sel = np.sign(x) == np.sign(a[0])
        ab = b - a
        t = np.clip(((m.pos[sel] - a) @ ab) / (ab @ ab), 0, 1)
        d[sel] = np.linalg.norm(m.pos[sel] - (a + t[:, None] * ab), axis=1)
    head = m.bone_weight(['Head'])
    # The stick: the column beside each ear flap standing off the sleeve's top (the flap itself is the
    # head's already). It goes with the head; the triangles joining it to the sleeve are cut.
    stick = (np.abs(x) > 0.7) & (np.abs(x) < 0.86) & (d > 0.19) & (y > 1.0) & (y < 1.3) & (head < 0.95)
    H = m.bones.index('Head')
    joints = m.joints.astype(np.float32).copy()
    weights = m.weights.copy()
    joints[stick] = [H, 0, 0, 0]
    weights[stick] = [1, 0, 0, 0]
    tri = m.index
    st = stick[tri]
    sleeve_side = (d <= 0.19)[tri]
    joined = st.any(1) & ~st.all(1) & (sleeve_side | ~st).any(1) & (head[tri] < 0.95).all(1)
    # Its stub on the sleeve's top (what stayed with the arm) would stick out in a flake as the arm drops.
    # (the arm itself is about 0.125 round there, its widest 0.15)
    stub = (np.abs(x) > 0.72) & (np.abs(x) < 0.86) & (d > 0.15) & (y > 1.0) & (head < 0.95) & ~stick
    gone = joined | (stub[tri].sum(1) >= 2)
    keep = tri[~gone]
    # What is left of the stick's foot on the arm, painted the arm's own colour so it doesn't show as red flecks.
    foot = (np.abs(x) > 0.66) & (np.abs(x) < 0.9) & (y > 0.98) & red & (head < 0.95) & ~stick
    ft = keep[foot[keep].any(1)]
    if len(ft):
        mask = tri_mask_tris(m, ft, n)
        armv = (np.abs(x) > 0.6) & (np.abs(x) < 1.0) & ~red & (m.bone_weight(['UpperArmL', 'UpperArmR', 'ForeArmL', 'ForeArmR']) > 0.5)
        skin_px = img[tri_mask(m, armv[m.index].all(1), n)]
        col = np.median(skin_px, 0)
        L = lum(img)
        shade = np.clip(L[mask] / max(np.median(L[mask]), 1e-3), 0.85, 1.1) ** 0.4
        img[mask] = np.clip(col[None] * shade[:, None], 0, 1)
        print(f'  cords: the foot ({len(ft)} triangles) painted {np.round(col * 255).astype(int)}')
    print(f'  cords: stub {int((stub[tri].sum(1) >= 2).sum())} triangles')
    joints.tofile(os.path.join(out_dir, 'joints.f32'))
    weights.tofile(os.path.join(out_dir, 'weights.f32'))
    keep.astype(np.uint32).tofile(os.path.join(out_dir, 'index.u32'))
    print(f'  cords: {stick.sum()} vertices go with the head, {joined.sum()} triangles cut; |x| {np.abs(x[stick]).min():.2f}-{np.abs(x[stick]).max():.2f}, y {y[stick].min():.2f}-{y[stick].max():.2f}')


def main():
    d, base, out_dir, *tasks = sys.argv[1:]
    os.makedirs(out_dir, exist_ok=True)
    m = Model(d)
    img = np.asarray(Image.open(base).convert('RGB'), np.float32) / 255
    painted = False
    for t in tasks:
        print(t)
        if t == 'hands':
            img, c = hands(m, img)
            painted |= c > 0
        elif t == 'back':
            img, c = back(m, img)
            painted |= c > 0
        elif t == 'rigid':
            rigid(m, out_dir)
        elif t == 'cords':
            cords(m, img, out_dir)
            painted = True
    if painted:
        Image.fromarray((np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(out_dir, 'base.png'))


if __name__ == '__main__':
    main()
