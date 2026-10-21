"""Find the dino's arms: hands (the pink claws up high), shoulders, and each arm's vertices (a flood from the hand
along the mesh, inside a tube round the shoulder-hand line). Writes r3/dinoarms.png and w2/dino-arms.npz."""
import os
import sys
import numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from texlib import Model
from cleanup import welded, hsv

m = Model('w2/dino')
x, y, z = m.pos.T
img = np.asarray(Image.open('w2/dino/base.png').convert('RGB'), np.float32) / 255
n = img.shape[0]
px = np.clip((m.uv * n).astype(int), 0, n - 1)
c = img[px[:, 1], px[:, 0]]
h, s, v = hsv(c[None])
h, s, v = h[0] * 360, s[0], v[0]
pink = ((h > 290) | (h < 15)) & (s > 0.3) & (v > 0.35)
neck = m.bone_weight(['Neck'])
cx = (m.joint_pos('ThighL')[0] + m.joint_pos('ThighR')[0]) / 2
print('body middle x', round(cx, 3))
wid, A = welded(m)
nw = A.shape[0]
P = np.zeros((nw, 3)); P[wid] = m.pos
out = {}
for side, sg in (('L', 1), ('R', -1)):
    lat = (x - cx) * sg
    hand = pink & (y > 0.95) & (lat > 0.3)
    hc = m.pos[hand].mean(0)
    # The hand's tip: the hand vertex furthest from the body's middle at its height.
    tip = m.pos[hand][np.argmax(np.hypot(m.pos[hand][:, 0] - cx, m.pos[hand][:, 1] - 1.0))]
    # Shoulder: the neck band's vertices out to this side, the innermost low ones.
    band = (neck > 0.4) & (lat > 0.12)
    bp = m.pos[band]
    order = np.argsort(np.hypot(bp[:, 0] - cx, bp[:, 1] - 0.9))
    sh = bp[order[: max(5, len(order) // 8)]].mean(0)
    print(side, 'hand', hc.round(3), 'tip', tip.round(3), 'shoulder', sh.round(3), 'hand verts', int(hand.sum()))
    out[side] = dict(hand=hc, tip=tip, shoulder=sh)
np.savez('w2/dino-joints.npz', **{f'{k}_{s}': v for s, d in out.items() for k, v in d.items()}, cx=cx)
# Picture: front and side, pink in red, neck band in orange, the estimated joints as circles.
S = 700; span = 2.4
im = Image.new('RGB', (S * 2, S), 'white'); d = ImageDraw.Draw(im)
for k, (a, b, depth) in enumerate([(x, y, z), (z, y, -x)]):
    for i in np.argsort(depth):
        X = k * S + (a[i] / span + 0.5) * S; Y = S - (b[i] / span) * S - 40
        col = (220, 30, 30) if pink[i] else (240, 140, 40) if neck[i] > 0.4 else tuple(int(t * 255) for t in c[i])
        d.rectangle((X - 1, Y - 1, X + 1, Y + 1), fill=col)
    for side in out:
        for key, colr in (('shoulder', 'blue'), ('hand', 'black'), ('tip', 'green')):
            p = out[side][key]
            X = k * S + ((p[0] if k == 0 else p[2]) / span + 0.5) * S; Y = S - (p[1] / span) * S - 40
            d.ellipse((X - 6, Y - 6, X + 6, Y + 6), outline=colr, width=3)
im.save('r3/dinoarms.png')
