"""
Colour-map edits for the cast, on a repacked atlas (texlib.texel_maps gives what lies under each texel).
Each takes and returns float RGB in 0..1.
"""
import numpy as np
from scipy import ndimage as ndi

from texlib import inpaint, lum

# The Chog's arms and feet (the user's reference: the chef's forearms, hands and feet).
PINK = np.array([197, 103, 146], np.float32) / 255


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def shading(img, covered, sigma=10):
    """Light and shade painted into the map, apart from its colours: each texel's brightness against its
    neighbourhood's, in 0.75..1.15."""
    L = lum(img)
    c = covered.astype(np.float32)
    local = ndi.gaussian_filter(L * c, sigma) / np.maximum(ndi.gaussian_filter(c, sigma), 1e-4)
    return np.clip(L / np.maximum(local, 1e-3), 0.75, 1.15)


def recolour(img, maps, mask, colour=PINK, sigma=10):
    """Paint the texels in mask (0..1) the given colour, keeping the map's own light and shade."""
    s = ndi.gaussian_filter(shading(img, maps['covered'], sigma), 0.7)
    target = colour[None, None, :] * s[..., None]
    a = np.clip(mask, 0, 1)[..., None] * maps['covered'][..., None]
    return img * (1 - a) + target * a


def limb_mask(maps, parts):
    w = sum(maps[p] for p in parts)
    return smoothstep(0.42, 0.58, w)


def pink_limbs(img, maps, arms='hands', feet=True, ankle=0.13):
    """
    The Chog's own colour on its hands and feet only (the user: "only on their hands and feet, not the
    entire arm nor the entire leg"): hands from the wrist (the hand bone's share), feet from the ankle down
    (below ankle height, on the legs).
    """
    m = np.zeros(img.shape[:2], np.float32)
    if arms:
        m = np.maximum(m, limb_mask(maps, ('hand',)))
    if feet:
        legs = (maps['foot'] + maps['shin'] + maps['thigh']) > 0.5
        y = maps['pos'][..., 1]
        m = np.maximum(m, legs * (1 - smoothstep(ankle - 0.012, ankle + 0.012, y)))
    # Only the Chog itself: not what it holds (the singer's grey mic is held by its hand bone).
    h, s, v = hsv(img)
    skinlike = ((h < 55) | (h > 250)).astype(np.float32)
    m *= skinlike * smoothstep(0.1, 0.2, s) * smoothstep(0.3, 0.42, v)
    return recolour(img, maps, m)


def hsv(img):
    mx, mn = img.max(-1), img.min(-1)
    d = mx - mn
    h = np.zeros_like(mx)
    r, g, b = img[..., 0], img[..., 1], img[..., 2]
    sel = d > 1e-5
    rr = (mx == r) & sel
    gg = (mx == g) & sel & ~rr
    bb = sel & ~rr & ~gg
    h[rr] = ((g - b)[rr] / d[rr]) % 6
    h[gg] = (b - r)[gg] / d[gg] + 2
    h[bb] = (r - g)[bb] / d[bb] + 4
    return h * 60, np.where(mx > 0, d / np.maximum(mx, 1e-5), 0), mx


def clean_region(img, region, keep, base_colour=None, low=0.86, high=1.06, sigma=6):
    """
    A clean, even coat over region: every texel not in keep (features to leave alone) becomes the region's
    colour, shaded only by a smooth version of the map's own light, within low..high of its median. Stains,
    spills and grain go; the beak and eyes stay.
    """
    paint = region & ~keep
    col = base_colour if base_colour is not None else np.median(img[paint], 0)
    L = lum(img)
    med = np.median(L[paint])
    src = paint.astype(np.float32)
    sm = ndi.gaussian_filter(L * src, sigma) / np.maximum(ndi.gaussian_filter(src, sigma), 1e-4)
    k = np.clip(sm / med, low, high)
    out = img.copy()
    out[paint] = (col[None, :] * k[paint][:, None])
    # A soft edge where the coat meets what it keeps.
    edge = ndi.binary_dilation(keep, iterations=1) & paint
    out[edge] = 0.5 * out[edge] + 0.5 * img[edge]
    return out


def deblemish(img, region, thresh=0.07, size=9, keep=None):
    """Spots and grain inside region (texels unlike the median of their neighbourhood) filled from the
    texels round them."""
    med = np.dstack([ndi.median_filter(img[..., k], size=size) for k in range(3)])
    diff = np.linalg.norm(img - med, axis=-1)
    bad = region & (diff > thresh)
    if keep is not None:
        bad &= ~keep
    bad = ndi.binary_dilation(bad, iterations=1) & region
    ok = region & ~bad
    out = inpaint(img, bad, ok, sigmas=(6, 3, 1.5))
    # And the grain: a light smoothing that stops at colour edges.
    sm = np.dstack([ndi.gaussian_filter(out[..., k], 1.2) for k in range(3)])
    flat = region & (np.linalg.norm(out - sm, axis=-1) < 0.05)
    if keep is not None:
        flat &= ~keep
    out[flat] = sm[flat]
    return out, int(bad.sum())


def fill(img, covered):
    from texlib import fill_gutters
    return fill_gutters(img, covered)


def duck_float(img, maps, m):
    """
    The duck float on #66, one clean coat of its own yellow: purple spill, the muddy band where it meets the
    body and Tripo's grain all go. The beak and eyes stay. The float is the yellow at the waist (the crown's
    gold is far above it); its texels are the ones lying outside the body's own girth there.
    """
    h, s, v = hsv(img)
    c = maps['covered']
    y = maps['pos'][..., 1]
    r = np.hypot(maps['pos'][..., 0], maps['pos'][..., 2])
    band = c & (y > 0.28) & (y < 0.82)
    yel = band & (h > 32) & (h < 72) & (s > 0.4) & (v > 0.4)
    # The body's girth at each height (its purple), and the float is what lies beyond it.
    pur = band & (h > 250) & (h < 300) & (s > 0.3)
    ys = np.linspace(0.28, 0.82, 28)
    girth = np.array([np.percentile(r[pur & (abs(y - yy) < 0.03)], 60) if (pur & (abs(y - yy) < 0.03)).sum() > 50 else 0.2 for yy in ys])
    g = np.interp(y, ys, girth)
    # Triangles mostly yellow, or lying outside the body's girth next to yellow, are the float's.
    tid = maps['tid']
    nt = tid.max() + 1
    tot = np.bincount(tid[band], minlength=nt).astype(np.float32)
    yc = np.bincount(tid[yel], minlength=nt).astype(np.float32)
    frac = yc / np.maximum(tot, 1)
    outside = np.bincount(tid[band & (r > g + 0.03)], minlength=nt) / np.maximum(tot, 1)
    float_tri = (frac > 0.5) | ((frac > 0.12) & (outside > 0.6))
    region = band & float_tri[np.maximum(tid, 0)]
    beak = region & (h > 10) & (h < 34) & (s > 0.65) & (v > 0.55)
    eye = region & (v < 0.22)
    keep = ndi.binary_dilation(beak | eye, iterations=1)
    col = np.median(img[yel & region & ~keep], 0)
    return clean_region(img, region, keep, col, low=0.9, high=1.05, sigma=5)


def singer_skin(img, maps):
    """The singer: Tripo's grain and blotches off its skin and fur, every painted feature kept."""
    c = maps['covered'] & (maps['pos'][..., 1] > 0.24)
    h, s, v = hsv(img)
    dark = v < 0.25
    out, n = deblemish(img, c, thresh=0.06, size=11, keep=ndi.binary_dilation(dark, iterations=2))
    return out


def astro_suit(img, maps):
    """The astronaut's suit: the white panels even and clean, the seams, rings, flag and patches kept."""
    h, s, v = hsv(img)
    c = maps['covered'] & (maps['head'] < 0.5)
    white = c & (s < 0.18) & (v > 0.55)
    keep = c & ~white
    out, n = deblemish(img, white, thresh=0.05, size=9, keep=ndi.binary_dilation(keep, iterations=1))
    return out


def fix_chips(img, m, uv, keep, max_px=60):
    """
    Tiny texture islands that picked up a neighbour's colour (purple flecks on the singer's face, skin flecks
    in its hair): each island smaller than max_px texels takes the colour its surface neighbours have.
    """
    from texlib import W, islands, raster
    from scipy.sparse import coo_matrix
    n, tri_isl, tris = islands(m.index, len(m.pos), keep)
    tid, _ = raster(uv * W, tris)
    pix = np.bincount(tri_isl[tid[tid >= 0]], minlength=n)
    small = pix < max_px
    # Each triangle's colour: the mean of its texels (or the texel under its middle).
    cnt = np.bincount(tid[tid >= 0], minlength=len(tris)).astype(np.float32)
    col = np.zeros((len(tris), 3), np.float32)
    for k in range(3):
        col[:, k] = np.bincount(tid[tid >= 0], weights=img[..., k][tid >= 0], minlength=len(tris))
    mid = (uv[tris].mean(1) * W).astype(int).clip(0, W - 1)
    col = np.where(cnt[:, None] > 0, col / np.maximum(cnt, 1)[:, None], img[mid[:, 1], mid[:, 0]])
    # Neighbours on the surface: triangles sharing a welded corner.
    key = np.round(m.pos, 4)
    _, weld = np.unique(key, axis=0, return_inverse=True)
    weld = weld.ravel()
    wt = weld[tris]
    rows = np.repeat(np.arange(len(tris)), 3)
    vt = coo_matrix((np.ones(len(rows)), (rows, wt.ravel())), shape=(len(tris), weld.max() + 1)).tocsr()
    adj = (vt @ vt.T).tocsr()
    big_tri = ~small[tri_isl]
    out = img.copy()
    fixed = 0
    for i in np.nonzero(small)[0]:
        ts = np.nonzero(tri_isl == i)[0]
        # Two rings of neighbours, from the big islands only.
        nb = adj[ts].indices
        nb = np.unique(np.concatenate([nb, adj[nb].indices]))
        nb = nb[big_tri[nb]]
        if len(nb) < 3:
            continue
        target = np.median(col[nb], 0)
        mine = np.median(col[ts], 0)
        if np.linalg.norm(mine - target) < 0.08:
            continue
        sel = np.isin(tid, ts)
        sel = ndi.binary_dilation(sel, iterations=1) & ~np.isin(tid, np.nonzero(big_tri)[0])
        out[sel] = target
        fixed += 1
    print('chips repainted', fixed, 'of', int(small.sum()), 'small islands')
    return out


def paint_out_face(img, maps, face, keep_blush=True):
    """The painted eyes and mouth under the face overlay, filled with skin, so the old ones never show
    round the edges of the animated ones."""
    M = np.array(face['matrix'], np.float64).reshape(4, 4).T
    p = maps['pos']
    fp = p @ M[:3, :3].T + M[:3, 3]
    d = np.array(face['dir'])
    facing = (maps['nrm'] @ d) > 0.25
    inside = (fp[..., 0] > -0.02) & (fp[..., 0] < 1.02) & (fp[..., 1] > -0.02) & (fp[..., 1] < 1.02) & facing & maps['covered'] & (maps['head'] > 0.5)
    h, s, v = hsv(img)
    skin = inside & (v > 0.6) & (s > 0.1) & (s < 0.45) & ((h < 40) | (h > 340))
    blush = inside & (s >= 0.25) & ((h < 15) | (h > 330)) & (v > 0.6)
    feature = inside & ~skin & ~(blush if keep_blush else False)
    feature = ndi.binary_dilation(feature, iterations=2) & inside & ~(blush if keep_blush else False)
    return inpaint(img, feature, inside & skin & ~feature, sigmas=(12, 6, 3, 1.5))


def clean_face(img, maps, face):
    """
    The singer's face skin, one clean, softly shaded coat: Tripo's grain, smudges and blocky blush go, and so
    do the painted eyes and mouth (the face sheet draws the eyes, mouth and blush on top, see src/chog.js).
    """
    M = np.array(face['matrix'], np.float64).reshape(4, 4).T
    fp = maps['pos'] @ M[:3, :3].T + M[:3, 3]
    facing = (maps['nrm'] @ np.array(face['dir'])) > 0.0
    h, s, v = hsv(img)
    # The face by where it is, not by bone: a lower face can belong to the neck or chest.
    arms = maps['hand'] + maps['forearm'] + maps['upperarm']
    head = maps['covered'] & (maps['pos'][..., 1] > face.get('chin', 1.0)) & (arms < 0.2)
    purple = (h > 240) & (h < 320) & (s > 0.25)
    # The face: the head's front, inside a generous box round the sheet's square, not the hair.
    box = (fp[..., 0] > -0.2) & (fp[..., 0] < 1.2) & (fp[..., 1] > -0.5) & (fp[..., 1] < 1.4)
    region = head & facing & box & ~purple
    region = ndi.binary_opening(region, iterations=1)
    skin = region & (v > 0.62) & (s > 0.08) & (s < 0.42) & ((h < 45) | (h > 340))
    col = np.median(img[skin], 0)
    out = clean_region(img, region, np.zeros_like(region), col, low=0.93, high=1.04, sigma=4)
    # A soft round blush on each cheek, under and outside the sheet's eyes.
    BLUSH = np.array([240, 150, 170], np.float32) / 255
    for cx in (0.21, 0.79):
        e = ((fp[..., 0] - cx) / 0.085) ** 2 + ((fp[..., 1] - 0.43) / 0.06) ** 2
        k = 0.55 * (1 - smoothstep(0.35, 1.0, np.sqrt(e))) * region
        out = out * (1 - k[..., None]) + BLUSH[None, None, :] * k[..., None]
    return out


def mouth_cavity(img, maps, box):
    """
    The singer was modelled mid-song with its mouth open, a hollow in the face whose walls carried Tripo's
    blotchy teeth: the hollow becomes a clean open mouth, deep red, darker the deeper it goes.
    box: (x half-width, y low, y high, z back, z front) of the hollow in the model's space.
    """
    x, y, z = maps['pos'][..., 0], maps['pos'][..., 1], maps['pos'][..., 2]
    hw, y0, y1, zb, zf = box
    inside = maps['covered'] & (np.abs(x) < hw) & (y > y0) & (y < y1) & (z > zb) & (z < zf)
    depth = np.clip((zf - z) / max(zf - zb, 1e-4), 0, 1)
    col = np.array([0.55, 0.12, 0.14], np.float32)[None, None, :] * (1 - 0.55 * depth[..., None])
    a = ndi.gaussian_filter(inside.astype(np.float32), 1.0)[..., None]
    return img * (1 - a) + col * a
