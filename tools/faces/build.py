# Build each Chog's expression sheet from its front face capture.
#
# A sheet is 6 x 2 cells of CELL px over one square crop of the face: the top row holds the eye states
# (rest, blink, happy, surprised, sad, cross), the bottom row the mouth states (rest, smile, o, frown,
# talk-small, talk-open). Each cell is transparent except where it changes the face, so in the game the
# model's own painted face shows everywhere else. Old eyes and mouths are painted out with the skin
# around them (a harmonic fill), and the new ones come from the cast's own art: the King's or the
# bartender's eyes for the Chogs that only had closed eyes, the shark's closed lids for a blink, the
# plain Chog's lashes for a happy squint, the bartender's, the singer's and the dino's open mouths.
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

os.chdir(os.path.dirname(os.path.abspath(__file__)))
CELL = 256
EYES = ['rest', 'blink', 'happy', 'surprised', 'sad', 'cross']
MOUTHS = ['rest', 'smile', 'o', 'frown', 'talk1', 'talk2']
det = json.load(open('faces/detect.json'))


def img(name):
    return np.asarray(Image.open(f'faces/{name}.png').convert('RGBA')).astype(np.float32) / 255


def box_of(name, i):
    c = det[name]['comps'][i]
    return [c['x0'], c['y0'], c['x1'], c['y1']]


# Per Chog: which detected parts are its eyes, mouth and brows (or boxes, x0 y0 x1 y1 in the 1024 capture),
# what its resting eyes are, and how its blinks and squints are drawn.
CFG = {
    # The plain Chog and the singer (its body, since 10-16): eyes by box, the detected parts' order having
    # changed under them (10-21: the singer's eyes and mouth swapped places).
    'plain': dict(eyes=[[300, 668, 432, 746], [578, 668, 710, 746]], mouth=[474, 815, 556, 842], rest='king'),
    'chog-132': dict(eyes=[[270, 545, 430, 652], [575, 545, 735, 652]], mouth=[455, 700, 565, 752], rest='king', skin=[0.29, 0.16, 0.13]),
    'singer': dict(eyes=[[300, 668, 432, 746], [578, 668, 710, 746]], mouth=[474, 815, 556, 842], rest='barkeep', open_mouth=True),
    'chog-66': dict(eyes=[], mouth=[418, 776, 618, 838], rest='own', mk=0.8),
    # (10-21 second round: redrawn with a small tail.)
    # (His own closed, crying eyes at rest, as his NFT: King Pom's open ones drawn over them read as deformed,
    # the user 10-21.)
    'chog-37': dict(eyes=[[280, 552, 442, 628], [585, 552, 746, 628]], mouth=[468, 706, 556, 748], rest='own', lids='ink'),
    'chog-124': dict(eyes=[0, 1], mouth=5, rest='own', lids='ink', keep_blue=[500, 740, 640, 860]),
    # (10-21, rebuilt from his NFT art: his blue drool stays put over every mouth, keep_blue.)
    'chog-1151': dict(eyes=[0, 1], mouth=4, rest='own', lids='ink', keep_blue=[420, 700, 620, 900]),
    'chog-409': dict(eyes=[[303, 612, 447, 748], [578, 612, 722, 748]], mouth=4, rest='own', lids='ink'),
    'dino': dict(eyes=[0, 1], mouth=2, rest='own', lids='ink', open_mouth=True),
    # (10-21 second round: redrawn with his spikes out from under the hat and shorter arms.)
    'chog-52': dict(eyes=[[276, 543, 450, 717], [576, 543, 750, 717]], mouth=[488, 748, 538, 798], rest='own', lids='ink', skin=[0.39, 0.2, 0.16], mk=1.4, protect=[[0.68, 0.6, 0.47]], no_brows=True),
    'chog-56': dict(eyes=[], mouth=0, rest='own', mk=0.62),
    'chog-68': dict(eyes=[0, 1], mouth=5, rest='own', lids='ink', mk=1.7),
    # The two who took the sniffer's and the dino's places (10-21): Petal (#271) and Dash (#471).
    'chog-271': dict(eyes=[1, 2], mouth=3, rest='own', lids='ink', mk=0.85, keep_blue=[500, 690, 640, 820]),
    'chog-471': dict(eyes=[0, 1], mouth=4, rest='own', lids='ink'),
    'bartender': dict(eyes=[0, 1], mouth=2, rest='own', open_mouth=True),
}


def boxes(name, spec):
    return [box_of(name, s) if isinstance(s, int) else s for s in spec]


def skin_of(name):
    return np.array(CFG.get(name, {}).get('skin') or det[name]['skin'], np.float32)


def feature_mask(rgb, skin, box, pad=10, thresh=0.13):
    """Pixels of a painted feature inside its (padded) box: whatever differs clearly from the skin."""
    H, W = rgb.shape[:2]
    x0, y0, x1, y1 = box
    m = np.zeros((H, W), bool)
    sl = (slice(max(0, y0 - pad), min(H, y1 + pad + 1)), slice(max(0, x0 - pad), min(W, x1 + pad + 1)))
    d = np.linalg.norm(rgb[sl] - skin, axis=-1)
    m[sl] = d > thresh
    # keep the parts touching the core box (not stray blush)
    lab, n = ndi.label(m)
    core = np.zeros_like(m)
    core[y0:y1 + 1, x0:x1 + 1] = True
    keep = np.unique(lab[core & m])
    m = np.isin(lab, keep[keep > 0])
    return ndi.binary_fill_holes(ndi.binary_dilation(m, iterations=2))


def sprite(name, box, pad=10):
    """A feature cut out with soft, skin-free edges: (rgba patch, centre, size) in capture px."""
    im = img(name)
    rgb = im[..., :3]
    skin = skin_of(name)
    m = feature_mask(rgb, skin, box, pad)
    ys, xs = np.nonzero(m)
    y0, y1, x0, x1 = ys.min() - 3, ys.max() + 4, xs.min() - 3, xs.max() + 4
    c = rgb[y0:y1, x0:x1]
    d = np.linalg.norm(c - skin, axis=-1)
    a = np.clip((d - 0.04) / 0.16, 0, 1)
    a *= ndi.gaussian_filter(ndi.binary_dilation(m[y0:y1, x0:x1], iterations=1).astype(np.float32), 0.8)
    # un-mix the old skin out of the soft edge
    aa = np.maximum(a, 1e-3)[..., None]
    col = np.clip((c - (1 - aa) * skin) / aa, 0, 1)
    rgba = np.dstack([col, a])
    return rgba, np.array([(x0 + x1) / 2, (y0 + y1) / 2]), np.array([x1 - x0, y1 - y0], np.float32)


def no_blush(sp):
    """A borrowed eye without the blush its owner had painted under it: every Chog keeps its own (the user,
    10-21: Peel showed "two blushes", his own and a smaller one that came with King Pom's eyes)."""
    rgba, ctr, size = sp
    r, g, b = rgba[..., 0], rgba[..., 1], rgba[..., 2]
    pink = np.clip((r - g - 0.1) / 0.12, 0, 1) * np.clip((r - 0.35) / 0.12, 0, 1) * np.clip((b - g + 0.08) / 0.1, 0, 1)
    pink = np.maximum(pink, ndi.grey_dilation(pink, size=3) * 0.8)
    out = rgba.copy()
    out[..., 3] *= 1 - pink
    return out, ctr, size


def harmonic_fill(rgb, mask, iters=500, skin=None):
    """Paint a hole with the skin round it: a smooth first guess from the ring (normalised blur, coarse to
    fine), then relaxed so it meets the edge with no seam."""
    out = rgb.copy()
    ys, xs = np.nonzero(mask)
    if not len(ys):
        return out
    pad = 40
    y0, y1 = max(ys.min() - pad, 1), min(ys.max() + pad, rgb.shape[0] - 1)
    x0, x1 = max(xs.min() - pad, 1), min(xs.max() + pad, rgb.shape[1] - 1)
    sub = out[y0:y1, x0:x1].copy()
    m = mask[y0:y1, x0:x1]
    known = ~m
    if skin is not None:
        known &= np.linalg.norm(sub - skin, axis=-1) < 0.3
    known = known.astype(np.float32)
    guess = sub.copy()
    ring = ndi.binary_dilation(m, iterations=4) & ~m & (known > 0)
    guess[m] = sub[ring].mean(0) if ring.any() else skin
    for k_, sigma in enumerate((64, 32, 16, 8, 4)):
        num = np.dstack([ndi.gaussian_filter(sub[..., k] * known, sigma) for k in range(3)])
        den = ndi.gaussian_filter(known, sigma)[..., None]
        est = num / np.maximum(den, 1e-6)
        ok = ((den[..., 0] > 0.02) | (k_ == 0)) & m
        guess[ok] = est[ok]
    sub[m] = guess[m]
    for _ in range(iters):
        avg = (np.roll(sub, 1, 0) + np.roll(sub, -1, 0) + np.roll(sub, 1, 1) + np.roll(sub, -1, 1)) / 4
        sub[m] = avg[m]
    out[y0:y1, x0:x1] = sub
    return out


def paste(canvas, rgba, centre, scale, flipx=False):
    """Alpha-composite a sprite (float rgba) onto canvas (float rgba, straight alpha) at centre, scaled."""
    h, w = rgba.shape[:2]
    sx, sy = scale if hasattr(scale, '__len__') else (scale, scale)
    nw, nh = max(2, int(round(w * sx))), max(2, int(round(h * sy)))
    pim = Image.fromarray((np.clip(rgba, 0, 1) * 255).astype(np.uint8), 'RGBA')
    if flipx:
        pim = pim.transpose(Image.FLIP_LEFT_RIGHT)
    # resize premultiplied to keep edges clean
    pre = np.asarray(pim).astype(np.float32) / 255
    pre[..., :3] *= pre[..., 3:]
    P = np.asarray(Image.fromarray((pre * 255).astype(np.uint8), 'RGBA').resize((nw, nh), Image.LANCZOS)).astype(np.float32) / 255
    x0, y0 = int(round(centre[0] - nw / 2)), int(round(centre[1] - nh / 2))
    H, W = canvas.shape[:2]
    cx0, cy0, cx1, cy1 = max(0, x0), max(0, y0), min(W, x0 + nw), min(H, y0 + nh)
    if cx1 <= cx0 or cy1 <= cy0:
        return
    p = P[cy0 - y0:cy1 - y0, cx0 - x0:cx1 - x0]
    dst = canvas[cy0:cy1, cx0:cx1]
    a = np.clip(p[..., 3:], 0, 1)
    out_a = a + dst[..., 3:] * (1 - a)
    out_c = (p[..., :3] + dst[..., :3] * dst[..., 3:] * (1 - a)) / np.maximum(out_a, 1e-4)
    dst[..., :3] = out_c
    dst[..., 3:] = out_a


def stroke(canvas, pts, width, colour, ss=4):
    """An anti-aliased rounded polyline (capture px), supersampled."""
    H, W = canvas.shape[:2]
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    x0, y0 = int(min(xs) - width * 2), int(min(ys) - width * 2)
    x1, y1 = int(max(xs) + width * 2), int(max(ys) + width * 2)
    w, h = x1 - x0, y1 - y0
    layer = Image.new('L', (w * ss, h * ss), 0)
    d = ImageDraw.Draw(layer)
    sp = [((x - x0) * ss, (y - y0) * ss) for x, y in pts]
    d.line(sp, fill=255, width=int(width * ss), joint='curve')
    r = width * ss / 2
    for x, y in (sp[0], sp[-1]):
        d.ellipse((x - r, y - r, x + r, y + r), fill=255)
    a = np.asarray(layer.resize((w, h), Image.LANCZOS)).astype(np.float32) / 255
    rgba = np.zeros((h, w, 4), np.float32)
    rgba[..., :3] = colour
    rgba[..., 3] = a
    paste(canvas, rgba, ((x0 + x1) / 2, (y0 + y1) / 2), 1)


def arc(c, w, h, up=True, n=24):
    """Points of an arc across width w: up=True bulges upward (a happy squint), else downward (closed lid)."""
    pts = []
    for i in range(n + 1):
        t = i / n * 2 - 1
        y = (1 - t * t) * h
        pts.append((c[0] + t * w / 2, c[1] - y if up else c[1] + y))
    return pts


def lid_cut(rgba, slope, at, colour, width):
    """Hide the top of an eye sprite above a tilted lid line (fraction 'at' of its height from the top,
    rising 'slope' px per px toward +x), and draw the lid along the cut."""
    h, w = rgba.shape[:2]
    out = rgba.copy()
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    line = at * h - slope * (xx - w / 2)
    soft = np.clip((yy - line) / 1.5 + 0.5, 0, 1)
    out[..., 3] *= soft
    cols = np.nonzero(out[..., 3].max(0) > 0.3)[0]
    pts = []
    if len(cols):
        for x in (cols.min(), (cols.min() + cols.max()) / 2, cols.max()):
            pts.append((x, at * h - slope * (x - w / 2)))
    return out, pts


LASH = np.array([0.2, 0.12, 0.1], np.float32)
INK = np.array([0.1, 0.07, 0.08], np.float32)

# The shared art: open eyes, closed lids and squints, mouths. King Pom's, Snooze's and Patrol's come from their
# models before the 10-21 rebuild (captured as kit-409, kit-124, kit-56 from git: public/models/npcs/ at b758a1c).
KIT = {}


def kit():
    if KIT:
        return KIT
    KIT['king'] = [no_blush(sprite('kit-409', b)) for b in boxes('kit-409', [0, 1])]
    KIT['barkeep'] = [no_blush(sprite('bartender', b)) for b in boxes('bartender', [0, 1])]
    KIT['shut'] = [no_blush(sprite('kit-124', b)) for b in boxes('kit-124', [0, 1])]
    KIT['squint'] = [no_blush(sprite('plain', b)) for b in boxes('plain', [0, 1])]
    KIT['m_open'] = sprite('bartender', box_of('bartender', 2))
    KIT['m_laugh'] = sprite('singer', box_of('singer', 0))
    KIT['m_o'] = sprite('dino', box_of('dino', 2))
    KIT['m_frown'] = sprite('kit-56', box_of('kit-56', 2))
    KIT['m_smile'] = sprite('plain', box_of('plain', 2))
    return KIT


def build(name):
    K = kit()
    cfg = CFG[name]
    im = img(name)
    rgb, alpha = im[..., :3], im[..., 3]
    skin = skin_of(name)
    eye_boxes = boxes(name, cfg['eyes'])
    brow_boxes = boxes(name, cfg.get('brows', []))
    mouth_box = boxes(name, [cfg['mouth']])[0]
    # Old features to paint out.
    em = np.zeros(alpha.shape, bool)
    # Covers reach further than sprites: faint outlines of an eye white on pale skin count too.
    for b in eye_boxes + brow_boxes:
        em |= feature_mask(rgb, skin, b, pad=16, thresh=0.065)
    mm = feature_mask(rgb, skin, mouth_box, pad=12, thresh=0.08)
    # Drool (blue) round the mouth: painted out with the mouth, then laid back over every mouth state.
    keep = np.zeros(alpha.shape, bool)
    if cfg.get('keep_blue'):
        x0, y0, x1, y1 = cfg['keep_blue']
        kb = np.zeros(alpha.shape, bool)
        kb[y0:y1, x0:x1] = True
        keep = kb & (rgb[..., 2] > rgb[..., 0] + 0.15) & (alpha > 0.5)
        keep = ndi.binary_dilation(keep, iterations=2) & kb
        mm |= keep
    # Fill everything a cover paints solid, so no trace of the old outline survives under it.
    clean = harmonic_fill(rgb, ndi.binary_dilation(em | mm, iterations=14), skin=skin)
    # The face crop: a square round all features.
    allb = np.array(eye_boxes + brow_boxes + [mouth_box], np.float32)
    fx0, fy0, fx1, fy1 = allb[:, 0].min(), allb[:, 1].min(), allb[:, 2].max(), allb[:, 3].max()
    cx, cy = (fx0 + fx1) / 2, (fy0 + fy1) / 2
    side = max(fx1 - fx0, fy1 - fy0) * 1.5
    crop = [cx - side / 2, cy - side / 2, cx + side / 2, cy + side / 2]
    eyes = [((b[0] + b[2]) / 2, (b[1] + b[3]) / 2, b[2] - b[0], b[3] - b[1]) for b in eye_boxes]
    eyes.sort(key=lambda e: e[0])  # screen left, screen right
    mouth = ((mouth_box[0] + mouth_box[2]) / 2, (mouth_box[1] + mouth_box[3]) / 2, mouth_box[2] - mouth_box[0], mouth_box[3] - mouth_box[1])
    eh = np.mean([e[3] for e in eyes]) if eyes else 0
    ew = np.mean([e[2] for e in eyes]) if eyes else 0
    H, W = alpha.shape

    def layer():
        return np.zeros((H, W, 4), np.float32)

    # protect: colours a cover never paints over (Toasty's hat brim sits just over his eyes).
    keep_off = np.ones(alpha.shape, np.float32)
    for col in cfg.get('protect', []):
        d = np.linalg.norm(rgb - np.array(col, np.float32), axis=-1)
        keep_off *= ndi.gaussian_filter(np.clip((d - 0.1) / 0.08, 0, 1), 1.2)

    def base_cover(mask, grow=4):
        """A cell that paints the old features out: the clean skin, feathered."""
        c = layer()
        # Solid over the old feature and a little round it, feathering out beyond.
        a = ndi.gaussian_filter(ndi.binary_dilation(mask, iterations=grow + 4).astype(np.float32), 2.2)
        c[..., :3] = clean
        c[..., 3] = np.clip(a * 2.0, 0, 1) * keep_off
        return c

    own_eyes = [sprite(name, b) for b in sorted(eye_boxes, key=lambda b: b[0])] if cfg['rest'] == 'own' else None
    rest_src = {'king': K['king'], 'barkeep': K['barkeep'], 'sleepy': K['king']}.get(cfg['rest'])

    def put_open(c, scale=1.0, lift=0.0, lid=None):
        """The resting open eyes (its own, or the cast's for a Chog that only had closed eyes)."""
        for i, e in enumerate(eyes):
            if own_eyes:
                rgba, ctr, size = own_eyes[i]
                k = scale
                pos = (e[0], e[1] - lift * eh)
            else:
                rgba, ctr, size = rest_src[i]
                k = e[2] * 0.92 / size[0] * scale
                pos = (e[0], e[1] + size[1] * k * 0.12 - lift * eh)
            if lid:
                slope, at = lid
                s = slope if i == 0 else -slope
                rgba, pts = lid_cut(rgba, s, at, LASH, 0)
                h, w = rgba.shape[:2]
                ox, oy = pos[0] - w * k / 2, pos[1] - h * k / 2
                paste(c, rgba, pos, k)
                if len(pts) == 3:
                    stroke(c, [(ox + x * k, oy + y * k) for x, y in pts], max(3, eh * 0.09 * (k if own_eyes else 1)), INK if cfg.get('lids') == 'ink' else LASH)
            else:
                paste(c, rgba, pos, k)

    def put_lids(c, kind):
        """Closed lids (blink) or happy squints."""
        for i, e in enumerate(eyes):
            w = e[2] * (1.0 if own_eyes else 0.92)
            if cfg.get('lids') == 'ink':
                h = max(eh * (0.22 if kind == 'squint' else 0.16), 6)
                cy_ = e[1] + (eh * 0.05 if kind == 'squint' else eh * 0.12)
                stroke(c, arc((e[0], cy_), w * 0.9, h, up=(kind == 'squint')), max(5, eh * 0.11), INK)
            else:
                src = K['squint' if kind == 'squint' else 'shut'][i]
                rgba, ctr, size = src
                k = w / size[0]
                paste(c, rgba, (e[0], e[1] + (0 if kind == 'squint' else eh * 0.1)), k)

    def brows(c, kind):
        # (no_brows: a hat brim right over the eyes leaves no forehead to draw them on.)
        if not eyes or cfg.get('no_brows'):
            return
        col = LASH if cfg.get('lids') != 'ink' else INK
        if brow_boxes:
            col = np.median(rgb[feature_mask(rgb, skin, brow_boxes[0])], axis=0)
        for i, e in enumerate(eyes):
            inner = 1 if i == 0 else -1  # +x is toward the middle for the left eye
            bw = min(e[2] * 0.62, ew * 0.62)
            by = e[1] - eh * 0.5 - max(eh * 0.2, 14)
            if kind == 'up':
                pts = arc((e[0], by - eh * 0.06), bw, max(eh * 0.1, 5), up=True, n=12)
            elif kind == 'sad':
                pts = [(e[0] - inner * bw / 2, by + eh * 0.10), (e[0] + inner * bw / 2, by - eh * 0.14)]
            else:  # cross
                pts = [(e[0] - inner * bw / 2, by - eh * 0.12), (e[0] + inner * bw / 2, by + eh * 0.12)]
            stroke(c, pts, max(5, eh * 0.11), col)

    def mouth_sprite(c, key, wk=1.0, hk=1.0, dy=0.0):
        rgba, ctr, size = K[key]
        # mk: a model whose own mouth is wide and thin (Patrol's wavy line) gets smaller drawn mouths.
        k = mouth[2] * wk * cfg.get('mk', 1.0) / size[0]
        paste(c, rgba, (mouth[0], mouth[1] + dy * mouth[3]), (k, k * hk))

    eye_cells, mouth_cells = [], []
    rest_open = cfg['rest'] != 'own'
    for state in EYES:
        if not eyes:
            eye_cells.append(layer())
            continue
        if state == 'rest' and not rest_open:
            eye_cells.append(layer())
            continue
        c = base_cover(em)
        if state == 'rest':
            put_open(c, lid=(0.0, 0.42) if cfg['rest'] == 'sleepy' else None)
            if brow_boxes:
                c = layer()  # its own brows and eyes stay
        elif state == 'blink':
            put_lids(c, 'shut')
        elif state == 'happy':
            put_lids(c, 'squint')
        elif state == 'surprised':
            put_open(c, scale=1.14, lift=0.06)
            brows(c, 'up')
        elif state == 'sad':
            put_open(c, lid=(0.2, 0.24))
            brows(c, 'sad')
        elif state == 'cross':
            put_open(c, lid=(-0.26, 0.3))
            brows(c, 'cross')
        eye_cells.append(c)
    for state in MOUTHS:
        if state == 'rest':
            mouth_cells.append(layer())
            continue
        c = base_cover(mm, grow=5)
        if state == 'smile':
            mouth_sprite(c, 'm_open', 1.35, 0.95)
        elif state == 'o':
            mouth_sprite(c, 'm_o', 0.62, 0.95, -0.1)
        elif state == 'frown':
            mouth_sprite(c, 'm_frown', 1.0, 1.0)
        elif state == 'talk1':
            mouth_sprite(c, 'm_open', 1.1, 0.55)
        elif state == 'talk2':
            mouth_sprite(c, 'm_open', 1.25, 1.3)
        if keep.any():
            ka = ndi.gaussian_filter(keep.astype(np.float32), 0.8)
            c[..., :3] = c[..., :3] * (1 - ka[..., None]) + rgb * ka[..., None]
            c[..., 3] = np.maximum(c[..., 3], ka)
        mouth_cells.append(c)

    # Crop every cell to the face square and lay them out.
    sheet = Image.new('RGBA', (CELL * 6, CELL * 2), (0, 0, 0, 0))
    for row, cells in enumerate((eye_cells, mouth_cells)):
        for col, c in enumerate(cells):
            pre = c.copy()
            pre[..., :3] *= pre[..., 3:]
            # Resample in float (premultiplied), so faint edge pixels keep their true colour.
            box4 = tuple(int(round(v)) for v in crop)
            arr = np.dstack([np.asarray(Image.fromarray(np.ascontiguousarray(pre[..., k]), 'F').crop(box4).resize((CELL, CELL), Image.LANCZOS)) for k in range(4)])
            arr = np.clip(arr, 0, None)
            arr[..., 3] = np.clip(arr[..., 3], 0, 1)
            a = arr[..., 3:]
            arr[..., :3] = np.where(a > 1e-3, arr[..., :3] / np.maximum(a, 1e-3), 0)
            # Bleed colour into the clear area so filtering never pulls in black.
            if (a > 0.01).any():
                idx = ndi.distance_transform_edt(a[..., 0] <= 0.01, return_distances=False, return_indices=True)
                arr[..., :3] = arr[..., :3][idx[0], idx[1]]
            sheet.paste(Image.fromarray((np.clip(arr, 0, 1) * 255).astype(np.uint8), 'RGBA'), (col * CELL, row * CELL))
    os.makedirs('faces/out', exist_ok=True)
    sheet.save(f'faces/out/{name}.png', optimize=True)
    cap = json.load(open(f'faces/{name}.json'))
    meta = dict(crop=[float(v) / 1024 for v in crop], matrix=cap['matrix'], mesh=cap['mesh'])
    json.dump(meta, open(f'faces/out/{name}.json', 'w'))
    # A preview: the face with each state applied.
    prev = Image.new('RGB', (200 * 6, 200 * 2), (60, 70, 90))
    face = Image.fromarray((im * 255).astype(np.uint8), 'RGBA').crop(tuple(int(round(v)) for v in crop)).resize((CELL, CELL), Image.LANCZOS)
    for row in range(2):
        for col in range(6):
            base = Image.new('RGBA', (CELL, CELL), (60, 70, 90, 255))
            base.alpha_composite(face)
            # rest eyes under every mouth state, rest mouth under every eye state
            base.alpha_composite(sheet.crop((0 if row else col * CELL, 0, (0 if row else col * CELL) + CELL, CELL)))
            base.alpha_composite(sheet.crop(((col if row else 0) * CELL, CELL, (col if row else 0) * CELL + CELL, CELL * 2)))
            prev.paste(base.convert('RGB').resize((200, 200), Image.LANCZOS), (col * 200, row * 200))
    prev.save(f'faces/out/{name}_preview.jpg', quality=88)


for n in (sys.argv[1:] or list(CFG)):
    build(n)
    print('built', n)
