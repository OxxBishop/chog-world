"""Four claws on each of the dino's feet (the user, 10-21: "he only has a single claw as opposed to 4"; the
reference has a row of them across each foot's front). Each foot's own front claw (a shell of its own) is the
template: copies at even turns across the front, set into the foot's surface as deep as the original, a little
smaller. The original claw and the flat grey piece on the foot's side (another shell) go.
  python dino_claws.py [scale] [spread degrees]
Writes w2/dino-claws/{append_*.f32, index.u32} for patch.mjs --append --index, and r3/dinoclaws.png."""
import os
import sys
import numpy as np
from PIL import Image, ImageDraw
from scipy.sparse.csgraph import connected_components
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from texlib import Model
from cleanup import welded

SCALE = float(sys.argv[1]) if len(sys.argv) > 1 else 0.68
SPREAD = float(sys.argv[2]) if len(sys.argv) > 2 else 46.0
OUT = 'w2/dino-claws'
os.makedirs(OUT, exist_ok=True)
m = Model('w2/dino')
P = np.fromfile('w2/dino-rig/pos.f32', np.float32).reshape(-1, 3).astype(np.float64)
N = np.fromfile('w2/dino-rig/nrm.f32', np.float32).reshape(-1, 3).astype(np.float64)
UV = np.fromfile('w2/dino-rp/uv.f32', np.float32).reshape(-1, 2)
J = np.fromfile('w2/dino-rig/joints.f32', np.float32).reshape(-1, 4)
Wt = np.fromfile('w2/dino-rig/weights.f32', np.float32).reshape(-1, 4)
n = len(P)
wid, A = welded(m)
k, lab = connected_components(A, directed=False)
shell = lab[wid]
sizes = np.bincount(lab)
tri = m.index
drop = np.zeros(len(tri), bool)
new_pos, new_nrm, new_uv, new_j, new_w, new_tri = [], [], [], [], [], []
count = n
picture = []
for side, bone in (('L', 'FootL'), ('R', 'FootR')):
    fw = m.bone_weight([bone])
    foot = fw > 0.5
    # The foot's small shells: the claw (pointing forward, its tip furthest forward) and the side piece.
    small = [s for s in np.unique(shell[foot]) if sizes[s] < 200]
    claw = max(small, key=lambda s: P[shell == s, 2].max())
    for s in small:
        drop |= (shell[tri] == s).all(1)
    tv = np.nonzero(shell == claw)[0]
    tt = tri[(shell[tri] == claw).all(1)]
    # The foot's own surface at ground level (no small shells), its middle, and how far out it reaches each way.
    body = (fw > 0.2) & ~np.isin(shell, small) & (P[:, 1] < 0.09)
    c = P[body][:, [0, 2]]
    cx, cz = (c[:, 0].min() + c[:, 0].max()) / 2, (c[:, 1].min() + c[:, 1].max()) / 2
    phi_b = np.arctan2(c[:, 0] - cx, c[:, 1] - cz)
    rho_b = np.hypot(c[:, 0] - cx, c[:, 1] - cz)
    def reach(phi):
        d = np.abs((phi_b - phi + np.pi) % (2 * np.pi) - np.pi)
        return rho_b[d < np.radians(18)].max()
    q = P[tv]
    tip = q[np.argmax(q[:, 2])]
    base = q.mean(0)
    phi0 = np.arctan2(base[0] - cx, base[2] - cz)
    depth = np.hypot(base[0] - cx, base[2] - cz) - reach(phi0)
    print(side, 'claw', len(tv), 'verts, base', base.round(3), 'at', round(np.degrees(phi0), 1), 'deg, depth', round(depth, 3), 'foot middle', (round(cx, 3), round(cz, 3)))
    for a in np.linspace(-SPREAD, SPREAD, 4):
        phi = np.radians(a)
        turn = phi - phi0
        R = np.array([[np.cos(turn), 0, np.sin(turn)], [0, 1, 0], [-np.sin(turn), 0, np.cos(turn)]])
        r = reach(phi) + depth * SCALE
        at = np.array([cx + r * np.sin(phi), base[1] * (0.85 + 0.15 * SCALE), cz + r * np.cos(phi)])
        pos = at + SCALE * (q - base) @ R.T
        # Sat on the ground like the original (its lowest point where the original's was).
        pos[:, 1] += q[:, 1].min() - pos[:, 1].min()
        new_pos.append(pos)
        new_nrm.append(N[tv] @ R.T)
        new_uv.append(UV[tv])
        new_j.append(J[tv])
        new_w.append(Wt[tv])
        remap = np.full(n, -1)
        remap[tv] = np.arange(len(tv)) + count
        new_tri.append(remap[tt])
        count += len(tv)
        picture.append(pos)
keep = tri[~drop]
print('triangles dropped', int(drop.sum()), 'added', sum(len(t) for t in new_tri), 'vertices added', count - n)
for name, arr in (('pos', new_pos), ('nrm', new_nrm), ('uv', new_uv), ('joints', new_j), ('weights', new_w)):
    np.concatenate(arr).astype(np.float32).tofile(f'{OUT}/append_{name}.f32')
np.vstack([keep] + new_tri).astype(np.uint32).tofile(f'{OUT}/index.u32')
# Picture: the feet from above, the foot in grey, the new claws in red.
S = 600
im = Image.new('RGB', (S * 2, S), 'white'); d = ImageDraw.Draw(im)
for k_, (x0, x1) in enumerate(((0.25, 0.6), (-0.4, -0.05))):
    sc = S / (x1 - x0)
    def put(p, col):
        X = k_ * S + (p[0] - x0) * sc; Y = S / 2 - p[2] * sc
        d.rectangle((X - 1, Y - 1, X + 1, Y + 1), fill=col)
    for p in P[(P[:, 1] < 0.1) & (P[:, 0] > x0) & (P[:, 0] < x1)]:
        put(p, (180, 180, 180))
    for pos in picture:
        for p in pos:
            if x0 < p[0] < x1:
                put(p, (220, 30, 30))
im.save('r3/dinoclaws.png')
