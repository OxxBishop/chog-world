"""Each dino arm's vertices: a flood along the welded mesh from the hand, kept inside a tube round the
shoulder-to-hand line and outward of the shoulder. Writes w2/dino-armsel.npz and r3/dinoarmsel.png."""
import os
import sys
import numpy as np
from PIL import Image, ImageDraw
from scipy.sparse.csgraph import connected_components
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from texlib import Model
from cleanup import welded

R_TUBE = float(sys.argv[1]) if len(sys.argv) > 1 else 0.16
m = Model('w2/dino')
J = np.load('w2/dino-joints.npz')
x, y, z = m.pos.T
wid, A = welded(m)
nw = A.shape[0]
P = np.zeros((nw, 3)); P[wid] = m.pos
A = A.tocsr()
sel = {}
for side in 'LR':
    sh, hd = J[f'shoulder_{side}'], J[f'hand_{side}']
    ax = hd - sh
    L = np.linalg.norm(ax); ax /= L
    t = (P - sh) @ ax
    d = np.linalg.norm((P - sh) - np.outer(t, ax), axis=1)
    # A tube widening a little toward the hand (the claws), from just inside the shoulder to past the hand.
    ok = (t > -0.02) & (t < L + 0.22) & (d < R_TUBE * (1 + 0.6 * np.clip(t / L, 0, 1)))
    seed = ok & (np.abs(t - L) < 0.06) & (d < 0.08)
    # Flood inside ok.
    mask = seed.copy()
    while True:
        grow = ok & ~mask & ((A @ mask.astype(float)) > 0)
        if not grow.any():
            break
        mask |= grow
    sel[side] = mask
    print(side, 'arm verts', int(mask.sum()), 'length', round(L, 3))
np.savez('w2/dino-armsel.npz', L=sel['L'], R=sel['R'], wid=wid)
S = 700; span = 2.4
im = Image.new('RGB', (S * 2, S), 'white'); d = ImageDraw.Draw(im)
for k, (a, b, depth) in enumerate([(P[:, 0], P[:, 1], P[:, 2]), (P[:, 2], P[:, 1], -P[:, 0])]):
    for i in np.argsort(depth):
        X = k * S + (a[i] / span + 0.5) * S; Y = S - (b[i] / span) * S - 40
        col = (220, 30, 30) if sel['L'][i] else (30, 30, 220) if sel['R'][i] else (200, 200, 200)
        d.rectangle((X - 1, Y - 1, X + 1, Y + 1), fill=col)
im.save('r3/dinoarmsel.png')
