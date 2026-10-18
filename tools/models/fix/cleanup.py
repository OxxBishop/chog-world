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
  head   every head held by its head bone more firmly (the user, 10-17: "any head movements literally deforms
         their lower face"): the Head weight w becomes smoothstep(0.12, 0.5, w), the rest shared among the
         other bones as before, so the blend into the neck moves down under the chin. Continuous in w, so no
         seam opens.
  sides  the body's sides below each armpit held by the body, not the arm (the user, 10-17: "when waving the
         characters still have their sides sunk": Tripo's weights let a raised arm drag the side in). The arm's
         share fades out of a vertex the further inboard of the shoulder joint and the further under it it is.
  hips   clothes above the hips held by the body, not the thighs (the user, 10-17: Patrol's "clothing's
         literally deform whilst running"; Toasty's shirt hem tore as he jumped): a thigh's share fades out of
         a vertex the higher over its hip joint it is.
  duck   Quackers' duck float held by the body (spine and hips), not the thighs ("her duck deforms when she
         walks").
  spill  Patrol's goggles: the lens red that ran over the black rim and onto the face, painted out.
  blush  Patrol: the cast's pink blush on his cheeks, under the goggles ("where's his chog blush").
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
    # Clean bands across the back, as the front's hem runs straight round: at each height the class most of
    # the back has there (shirt red over flame orange), the shorts and skin below and beside left alone.
    _, ys = raster(m.uv * n, m.index[keep], values=m.pos[:, 1:2], size=n)
    yy = ys[..., 0]
    bins = np.round(yy / 0.01).astype(int)
    for bi in np.unique(bins[cls > 0]):
        row = (bins == bi) & (cls > 0)
        vals, counts = np.unique(cls[row], return_counts=True)
        cls[row] = vals[np.argmax(counts)]
    # The edge between them one straight line: everything under the lowest red-majority height is orange.
    red_rows = [bi for bi in np.unique(bins[cls == 1])]
    if red_rows:
        edge = np.percentile(yy[cls == 1], 2)
        cls[(cls > 0) & (yy < edge)] = 2
        cls[(cls > 0) & (yy >= edge)] = 1
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


def reweigh(m, joints, weights, vs, give):
    """Vertices vs held by the bones in give ({name: share}), wholly."""
    names = list(give)
    for k in range(4):
        joints[vs, k] = m.bones.index(names[k]) if k < len(names) else 0
        weights[vs, k] = give[names[k]] if k < len(names) else 0


def head_firm(m, joints, weights):
    H = m.bones.index('Head')
    w = weights.copy()
    hw = np.where(joints == H, w, 0).sum(1)
    t = np.clip((hw - 0.12) / (0.5 - 0.12), 0, 1)
    nw = t * t * (3 - 2 * t)
    rest = 1 - hw
    for k in range(4):
        is_h = joints[:, k] == H
        weights[:, k] = np.where(is_h, nw, np.where(rest > 1e-6, w[:, k] / np.maximum(rest, 1e-6) * (1 - nw), 0))
    # A vertex the head held a little but had no slot for it: give it the smallest slot.
    lack = (nw > 1e-3) & ~(joints == H).any(1)
    if lack.any():
        k = np.argmin(weights[lack], 1)
        rows = np.nonzero(lack)[0]
        joints[rows, k] = H
        weights[rows, k] = nw[lack]
        other = weights[rows].sum(1) - nw[lack]
        for j in range(4):
            sel = j != k
            weights[rows[sel], j] = weights[rows[sel], j] / np.maximum(other[sel], 1e-6) * (1 - nw[lack][sel])
    weights /= np.maximum(weights.sum(1, keepdims=True), 1e-6)
    print(f'  head: {int(((nw > 0.999) & (hw < 0.999)).sum())} vertices now wholly the head\'s, {int(((nw > 0) & (nw < 0.999)).sum())} in the blend')


def sides(m, joints, weights):
    x, y, _ = m.pos.T
    body = [m.bones.index(b) for b in ('Chest', 'Spine') if b in m.bones]
    moved = 0
    for side in 'LR':
        sh = m.joint_pos('UpperArm' + side)
        arm = [m.bones.index(b) for b in ('UpperArm' + side, 'ForeArm' + side, 'Hand' + side) if b in m.bones]
        inb = np.clip(((abs(sh[0]) - 0.02) - np.abs(x)) / 0.08, 0, 1) * (np.sign(x) == np.sign(sh[0]))
        under = np.clip(((sh[1] - 0.04) - y) / 0.1, 0, 1)
        r = inb * inb * (3 - 2 * inb) * under * under * (3 - 2 * under)
        for k in range(4):
            is_arm = np.isin(joints[:, k], arm)
            take = np.where(is_arm, weights[:, k] * r, 0)
            if not take.any():
                continue
            weights[:, k] -= take
            moved += int((take > 0.01).sum())
            # To the body bone it already has, else into the slot just freed.
            give = take.copy()
            for kb in range(4):
                has = np.isin(joints[:, kb], body) & (give > 0)
                weights[has, kb] += give[has]
                give[has] = 0
            rest = give > 0
            joints[rest, k] = np.where(y[rest] > m.joint_pos('Chest')[1] - 0.05, body[0], body[-1])
            weights[rest, k] += give[rest]
    weights /= np.maximum(weights.sum(1, keepdims=True), 1e-6)
    print(f'  sides: {moved} vertex weights moved off the arms')


def hips(m, joints, weights):
    y = m.pos[:, 1]
    legs = [m.bones.index(b) for b in ('ThighL', 'ThighR', 'ShinL', 'ShinR') if b in m.bones]
    hip_y = max(m.joint_pos('ThighL')[1], m.joint_pos('ThighR')[1])
    H = m.bones.index('Hips')
    up = np.clip((y - (hip_y + 0.02)) / 0.1, 0, 1)
    r = up * up * (3 - 2 * up)
    moved = 0
    for k in range(4):
        take = np.where(np.isin(joints[:, k], legs), weights[:, k] * r, 0)
        if not take.any():
            continue
        weights[:, k] -= take
        moved += int((take > 0.01).sum())
        give = take.copy()
        for kb in range(4):
            has = (joints[:, kb] == H) & (give > 0)
            weights[has, kb] += give[has]
            give[has] = 0
        rest = give > 0
        joints[rest, k] = H
        weights[rest, k] += give[rest]
    weights /= np.maximum(weights.sum(1, keepdims=True), 1e-6)
    print(f'  hips: {moved} vertex weights moved off the legs (hips at y {hip_y:.2f})')


def duck_float(m, img, joints, weights):
    """
    The float: the UV islands mostly its yellow, held by the spine and hips (the thighs pulled one side down as
    she walked), blended back to the old weights over the last 6 cm toward the body so the seam never tears;
    the purple smears on its top painted out in its own yellow.
    """
    from scipy.spatial import cKDTree
    n = img.shape[0]
    px = np.clip((m.uv * n).astype(int), 0, n - 1)
    c = img[px[:, 1], px[:, 0]]
    mx, mn = c.max(1), c.min(1)
    sat = (mx - mn) / np.maximum(mx, 1e-4)
    r, g, b = c.T
    hue = np.degrees(np.arctan2(np.sqrt(3) * (g - b), 2 * r - g - b)) % 360
    yellow = (hue > 20) & (hue < 70) & (sat > 0.45) & (mx > 0.45)
    low = (m.pos[:, 1] < 1.0) & (m.bone_weight(['Head']) < 0.5)
    k, tl, tris = islands(m.index, len(m.pos))
    fl = np.zeros(len(m.pos), bool)
    ftri = np.zeros(len(tris), bool)
    for i in range(k):
        sel = tl == i
        vs = np.unique(tris[sel])
        if yellow[vs].mean() > 0.6 and low[vs].mean() > 0.9 and len(vs) > 30:
            fl[vs] = True
            ftri |= sel
    other = np.nonzero(~fl & low)[0]
    d = cKDTree(m.pos[other]).query(m.pos[fl])[0]
    t = np.clip(d / 0.06, 0, 1)
    t = t * t * (3 - 2 * t)
    rigid = {m.bones.index('Spine'): 0.65, m.bones.index('Hips'): 0.35}
    for vi, tv in zip(np.nonzero(fl)[0], t):
        mix = {}
        for kk in range(4):
            mix[int(joints[vi, kk])] = mix.get(int(joints[vi, kk]), 0) + weights[vi, kk] * (1 - tv)
        for bj, bw in rigid.items():
            mix[bj] = mix.get(bj, 0) + bw * tv
        top = sorted(mix.items(), key=lambda kv: -kv[1])[:4]
        tot = sum(w for _, w in top) or 1
        for kk in range(4):
            joints[vi, kk], weights[vi, kk] = (top[kk][0], top[kk][1] / tot) if kk < len(top) else (0, 0)
    # The smears: purple and pink on the float's islands, filled from its nearest yellow.
    # Only on the ring itself: further out from the body's middle than the waist reaches (the islands carry
    # some of the shirt inside the ring too).
    tid, P = raster(m.uv * n, tris[ftri], values=m.pos, size=n)
    cz = np.median(m.pos[low, 2])
    ring_r = np.hypot(P[..., 0], P[..., 2] - cz)
    trunk = ~fl & (m.bone_weight(['Spine', 'Hips', 'Chest']) > 0.6) & (m.pos[:, 1] > 0.35) & (m.pos[:, 1] < 0.75)
    waist = np.percentile(np.hypot(m.pos[trunk, 0], m.pos[trunk, 2] - cz), 90)
    area = (tid >= 0) & (ring_r > waist + 0.02)
    h, s_, v = hsv(img)
    hh = h * 360
    good = area & (hh > 30) & (hh < 65) & (s_ > 0.5) & (v > 0.55)
    # Anything else on the ring but the duck's eyes (near black) and beak (bright orange).
    eyes = v < 0.2
    beak = (hh > 8) & (hh <= 32) & (s_ > 0.65) & (v > 0.7)
    smear = area & ~good & ~eyes & ~beak
    if smear.any() and good.any():
        _, (iy, ix) = ndimage.distance_transform_edt(~good, return_indices=True)
        img[smear] = img[iy[smear], ix[smear]]
    print(f'  duck: waist {waist:.2f}')
    print(f'  duck: {int(fl.sum())} vertices on the float ({int((t > 0.99).sum())} wholly the body\'s), {int(smear.sum())} smeared texels painted')
    return img, int(smear.sum())


def main():
    d, base, out_dir, *tasks = sys.argv[1:]
    os.makedirs(out_dir, exist_ok=True)
    m = Model(d)
    img = np.asarray(Image.open(base).convert('RGB'), np.float32) / 255
    painted = False
    joints = m.joints.astype(np.float32).copy()
    weights = m.weights.copy()
    skin_changed = False
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
        elif t == 'head':
            head_firm(m, joints, weights)
            skin_changed = True
        elif t == 'sides':
            sides(m, joints, weights)
            skin_changed = True
        elif t == 'hips':
            hips(m, joints, weights)
            skin_changed = True
        elif t == 'duck':
            img, c = duck_float(m, img, joints, weights)
            skin_changed = True
            painted |= c > 0
        elif t == 'spill':
            img, c = spill(m, img)
            painted |= c > 0
        elif t == 'blush':
            import json
            faces = json.load(open(os.path.join(os.path.dirname(__file__), '..', '..', '..', 'public', 'faces', 'faces.json')))
            name = os.path.basename(os.path.normpath(d))
            img, c = blush(m, img, faces[name])
            painted |= c > 0
    if skin_changed:
        joints.astype(np.float32).tofile(os.path.join(out_dir, 'joints.f32'))
        weights.astype(np.float32).tofile(os.path.join(out_dir, 'weights.f32'))
    if painted:
        Image.fromarray((np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(out_dir, 'base.png'))


if __name__ == '__main__':
    main()
