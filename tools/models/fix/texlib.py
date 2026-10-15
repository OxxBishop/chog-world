"""
Texture-space helpers for the cast fixes (numpy, scipy, Pillow): load a dump from dump.mjs, find UV islands,
rasterise per-vertex values into texture space, and repack a Tripo atlas with gutters.
"""
import json
import os

import numpy as np
from PIL import Image
from scipy import ndimage
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

W = 1024


class Model:
    def __init__(self, d):
        self.d = d
        self.info = json.load(open(os.path.join(d, 'model.json')))
        rd = lambda name, dt: np.fromfile(os.path.join(d, f'm0p0_{name}'), dtype=dt)
        self.pos = rd('pos.f32', np.float32).reshape(-1, 3)
        self.nrm = rd('nrm.f32', np.float32).reshape(-1, 3)
        self.uv = rd('uv.f32', np.float32).reshape(-1, 2)
        self.joints = rd('joints.f32', np.float32).reshape(-1, 4).astype(np.int32)
        self.weights = rd('weights.f32', np.float32).reshape(-1, 4)
        self.index = rd('index.u32', np.uint32).reshape(-1, 3).astype(np.int64)
        skin = self.info['skins'][0]
        self.bones = [self.info['nodes'][j]['name'] for j in skin['joints']]
        self.ibm = np.array(skin['ibm'], dtype=np.float64).reshape(-1, 4, 4).transpose(0, 2, 1)  # column-major
        mat = self.info['materials'][0]
        self.maps = {k: mat[k] for k in ('base', 'normal', 'mr')}

    def image(self, key):
        i = self.maps[key]
        if i is None:
            return None
        for ext in ('jpg', 'png'):
            p = os.path.join(self.d, f'img{i}.{ext}')
            if os.path.exists(p):
                return np.asarray(Image.open(p).convert('RGB'), dtype=np.float32) / 255
        return None

    def bone_weight(self, names):
        ids = [self.bones.index(n) for n in names if n in self.bones]
        w = np.zeros(len(self.pos), np.float32)
        for k in range(4):
            w += np.where(np.isin(self.joints[:, k], ids), self.weights[:, k], 0)
        return w

    def joint_pos(self, name):
        """A bone's head in the bind pose (model space)."""
        m = np.linalg.inv(self.ibm[self.bones.index(name)])
        return m[:3, 3]


def islands(index, nverts, keep=None):
    tris = index if keep is None else index[keep]
    r = np.concatenate([tris[:, 0], tris[:, 1], tris[:, 2]])
    c = np.concatenate([tris[:, 1], tris[:, 2], tris[:, 0]])
    k, lab = connected_components(coo_matrix((np.ones(len(r)), (r, c)), shape=(nverts, nverts)), directed=False)
    tl = lab[tris[:, 0]]
    used, tl = np.unique(tl, return_inverse=True)
    return len(used), tl, tris


def raster(px, tris, values=None, size=W):
    """
    Rasterise triangles (px: per-vertex pixel coords, tris: (n,3) vertex ids) at pixel centres.
    values: (nverts, k) per-vertex values to interpolate, or None. Returns (tri id per pixel, -1 outside;
    interpolated values).
    """
    tid = np.full((size, size), -1, np.int32)
    out = None if values is None else np.zeros((size, size, values.shape[1]), np.float32)
    P = px[tris]  # n,3,2
    lo = np.floor(P.min(1) - 0.5).astype(int).clip(0, size - 1)
    hi = np.ceil(P.max(1) - 0.5).astype(int).clip(0, size - 1)
    for t in range(len(tris)):
        x0, y0 = lo[t]
        x1, y1 = hi[t]
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        a, b, c = P[t]
        d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(d) < 1e-12:
            continue
        l0 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / d
        l1 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / d
        l2 = 1 - l0 - l1
        e = -1e-4
        inside = (l0 >= e) & (l1 >= e) & (l2 >= e)
        if not inside.any():
            continue
        yy, xx = np.nonzero(inside)
        yy += y0
        xx += x0
        tid[yy, xx] = t
        if out is not None:
            v = values[tris[t]]
            out[yy, xx] = l0[inside][:, None] * v[0] + l1[inside][:, None] * v[1] + l2[inside][:, None] * v[2]
    return tid, out


def fill_gutters(img, covered):
    """Every texel outside the islands takes the colour of the nearest texel inside one."""
    _, (iy, ix) = ndimage.distance_transform_edt(~covered, return_indices=True)
    return img[iy, ix]


def pack(masks, size=W, margin=4, order=None):
    """
    Place island masks (bool arrays, each its own bounding box) in a size x size atlas, at least margin px
    apart, without scaling or turning them. Returns [(y, x)] or None if they don't all fit.
    """
    occ = np.zeros((size, size), np.float32)
    F = None
    places = [None] * len(masks)
    r = int(np.ceil(margin / 2))
    st = ndimage.generate_binary_structure(2, 1)
    for i in order if order is not None else range(len(masks)):
        m = ndimage.binary_dilation(np.pad(masks[i], r), st, iterations=r)
        h, w = m.shape
        if h > size or w > size:
            return None
        F = np.fft.rfft2(occ)
        k = np.zeros((size, size), np.float32)
        k[:h, :w] = m
        corr = np.fft.irfft2(F * np.conj(np.fft.rfft2(k)), s=(size, size))
        valid = corr[: size - h + 1, : size - w + 1] < 0.5
        ys, xs = np.nonzero(valid)
        if not len(ys):
            return None
        # Bottom-left: the lowest top edge, then the leftmost.
        j = np.lexsort((xs, ys))[0]
        y, x = ys[j], xs[j]
        occ[y : y + h, x : x + w] = np.maximum(occ[y : y + h, x : x + w], m)
        places[i] = (y + r, x + r)
    return places


BONE_GROUPS = {
    'hand': ('HandL', 'HandR'),
    'forearm': ('ForeArmL', 'ForeArmR'),
    'upperarm': ('UpperArmL', 'UpperArmR'),
    'foot': ('FootL', 'FootR'),
    'shin': ('ShinL', 'ShinR'),
    'thigh': ('ThighL', 'ThighR'),
    'head': ('Head',),
    'neck': ('Neck',),
    'body': ('Hips', 'Spine', 'Chest', 'Root'),
}


def texel_maps(m, uv=None, keep=None, size=W):
    """
    What lies under each texel of the atlas (uv: per-vertex UVs, default the model's own): its triangle,
    its bind-pose position and normal, and how much of it each bone group carries.
    """
    tris = m.index if keep is None else m.index[keep]
    uv = m.uv if uv is None else uv
    vals = [m.pos, m.nrm] + [m.bone_weight(b)[:, None] for b in BONE_GROUPS.values()]
    tid, v = raster(uv * size, tris, np.concatenate(vals, 1).astype(np.float32), size)
    out = {'tid': tid, 'covered': tid >= 0, 'pos': v[..., :3], 'nrm': v[..., 3:6]}
    for k, name in enumerate(BONE_GROUPS):
        out[name] = v[..., 6 + k]
    return out


def save_maps(path, maps):
    np.savez_compressed(path, **maps)


def load_maps(path):
    return dict(np.load(path))


def lum(img):
    return img @ np.array([0.299, 0.587, 0.114], np.float32)


def soft(mask, sigma=1.0):
    from scipy import ndimage as ndi
    return ndi.gaussian_filter(mask.astype(np.float32), sigma)


def inpaint(img, bad, ok, sigmas=(24, 12, 6, 3, 1.5)):
    """Fill the texels in bad from the texels in ok round them (normalised convolution, coarse to fine)."""
    from scipy import ndimage as ndi
    out = img.copy()
    src = ok.astype(np.float32)
    for s in sigmas:
        num = np.dstack([ndi.gaussian_filter(img[..., k] * src, s) for k in range(img.shape[2])])
        den = ndi.gaussian_filter(src, s)[..., None]
        est = num / np.maximum(den, 1e-6)
        sel = bad & (den[..., 0] > 0.02)
        out[sel] = est[sel]
    return out
