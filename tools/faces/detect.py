# Find each Chog's skin colour, eyes and mouth in its front face capture (faces/<name>.png, 1024 px).
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

os.chdir(os.path.dirname(os.path.abspath(__file__)))
NAMES = ['plain', 'chog-1151', 'chog-132', 'chog-409', 'singer', 'dino', 'chog-66', 'chog-37', 'chog-124', 'chog-52', 'chog-56', 'chog-68', 'bartender']


def analyse(name, lo=0.35, darkk=0.62):
    im = np.asarray(Image.open(f'faces/{name}.png').convert('RGBA')).astype(np.float32) / 255
    rgb, a = im[..., :3], im[..., 3]
    H, W = a.shape
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    mx, mn = rgb.max(-1), rgb.min(-1)
    sat = (mx - mn) / np.maximum(mx, 1e-3)
    # Skin: warm, fairly light, not very saturated, in the lower middle of the frame.
    yy, xx = np.mgrid[0:H, 0:W] / np.array([H, W])[:, None, None]
    zone = (yy > 0.35) & (yy < 0.98) & (xx > 0.15) & (xx < 0.85) & (a > 0.9)
    warm = (r >= g - 0.02) & (g >= b - 0.06) & (sat < (0.62 if lo < 0.3 else 0.55)) & (lum > lo)
    cand = zone & warm
    # The biggest warm blob is the face.
    lab, n = ndi.label(cand)
    sizes = ndi.sum(cand, lab, range(1, n + 1))
    face = lab == (1 + int(np.argmax(sizes)))
    face = ndi.binary_closing(face, iterations=6)
    face_filled = ndi.binary_fill_holes(face)
    skin = np.median(rgb[face & cand], axis=0)
    skin_l = 0.299 * skin[0] + 0.587 * skin[1] + 0.114 * skin[2]
    # Features: inside the filled face, clearly darker than skin or strongly coloured (mouth red).
    inner = face_filled & ~ndi.binary_dilation(~face_filled, iterations=4)
    dark = inner & ((lum < skin_l * darkk) | ((r > g * 1.6) & (lum < skin_l * 0.85) & (sat > 0.45)))
    dark = ndi.binary_closing(dark, iterations=2)
    lab, n = ndi.label(dark)
    comps = []
    for i in range(1, n + 1):
        m = lab == i
        area = int(m.sum())
        if area < 60:
            continue
        ys, xs = np.nonzero(m)
        col = rgb[m].mean(0)
        comps.append(dict(area=area, x0=int(xs.min()), x1=int(xs.max()), y0=int(ys.min()), y1=int(ys.max()),
                          cx=float(xs.mean()), cy=float(ys.mean()), col=[round(float(c), 3) for c in col]))
    fy, fx = np.nonzero(face_filled)
    return dict(name=name, skin=[round(float(c), 3) for c in skin], face=[int(fx.min()), int(fy.min()), int(fx.max()), int(fy.max())],
                comps=sorted(comps, key=lambda c: -c['area'])[:8])


out = {}
for n in (sys.argv[1:] or NAMES):
    d = analyse(n, *( (0.16, 0.45) if n == 'chog-52' else ()))
    out[n] = d
    print(n, 'skin', d['skin'], 'face', d['face'])
    for c in d['comps']:
        print('   ', c['area'], (c['x0'], c['y0'], c['x1'], c['y1']), c['col'])
    im = Image.open(f'faces/{n}.png').convert('RGBA')
    bg = Image.new('RGBA', im.size, (60, 70, 90, 255)); bg.alpha_composite(im)
    dr = ImageDraw.Draw(bg)
    dr.rectangle(d['face'], outline=(0, 255, 0, 255), width=3)
    for k, c in enumerate(d['comps']):
        dr.rectangle((c['x0'], c['y0'], c['x1'], c['y1']), outline=(255, 0, 255, 255), width=3)
        dr.text((c['x0'], c['y0'] - 12), str(k), fill=(255, 255, 0, 255))
    bg.convert('RGB').resize((340, 340)).save(f'faces/{n}_det.jpg')
# Merged with what was found before, so models detected one at a time keep the others' (the kit's too).
prev = json.load(open('faces/detect.json')) if os.path.exists('faces/detect.json') else {}
json.dump({**prev, **out}, open('faces/detect.json', 'w'), indent=1)
