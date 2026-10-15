"""
The cast's fixes (the user's notes of 2026-10-15), one model at a time, from the original files:
  python tools/models/fix/run.py <work> <name...>      (work: a folder with dumps and reskins, see README)

For each model: its new skin (reskin.py, in <work>/k-<name>), its atlas repacked with gutters (repack.py),
then the colour fixes in CONFIG on the new atlas, the King's longer arms, and the result written over
public/models/npcs/<name>.glb by apply.mjs. Inputs it expects in <work>: orig/<name>.glb (the original
file), <name>/ (dump.mjs of it), k-<name>/ (reskin.py of it).
"""
import json
import os
import subprocess
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
import edits
from texlib import Model, W, texel_maps

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))

CONFIG = {
    'plain': dict(pink='arms'),
    'chog-1151': dict(pink='hands'),
    'chog-66': dict(pink='arms', duck=True),
    # Thousands of tiny islands, many sampling the wrong colour: a whole new unwrap (atlas.py smart=1).
    'singer': dict(pink='arms', blemish=True, pin_root=True, unwrap=True),
    'chog-409': dict(arms=1.45),
    'chog-68': dict(suit=True),
    'chog-124': {},
    'chog-52': {},
    'chog-56': {},
    'chog-132': {},
    'chog-37': {},
    'bartender': {},
}


def longer_arms(m, k):
    """Every arm k times as long: the vertices each arm bone carries slide out along it (blended by the new
    skin), and the elbow and wrist joints move with them. Returns new positions and bone translations."""
    pos = m.pos.astype(np.float64).copy()
    nodes = {n['name']: n for n in m.info['nodes']}
    bones = {}
    for side in 'LR':
        S, E, H = (m.joint_pos(f'{b}{side}') for b in ('UpperArm', 'ForeArm', 'Hand'))
        E2 = S + k * (E - S)
        H2 = E2 + k * (H - E)
        def t_on(a, b):
            ab = b - a
            return np.clip(((pos - a) @ ab) / (ab @ ab), 0, 1)[:, None]
        d_up = (k - 1) * t_on(S, E) * (E - S)
        d_fore = (E2 - E) + (k - 1) * t_on(E, H) * (H - E)
        d_hand = np.broadcast_to(H2 - H, pos.shape)
        w_up = m.bone_weight([f'UpperArm{side}'])[:, None]
        w_fore = m.bone_weight([f'ForeArm{side}'])[:, None]
        w_hand = m.bone_weight([f'Hand{side}'])[:, None]
        pos += w_up * d_up + w_fore * d_fore + w_hand * d_hand
        for b in (f'ForeArm{side}', f'Hand{side}'):
            bones[b] = [float(v) * k for v in nodes[b]['t']]
    return pos.astype(np.float32), bones


def blend_skin(m, J1, W1, core_rings=3, fade_rings=4):
    """
    Tripo's weights everywhere but round the shoulders, where they tear: there the heat weights take over,
    with the arm bones kept to what Tripo already gave the arms (so raising an arm never drags the chest or
    a robe with it), fading back to Tripo's over a few rings of the surface.
    """
    from scipy.sparse import coo_matrix
    nb = len(m.bones)
    n = len(m.pos)
    def dense(J, Wt):
        D = np.zeros((n, nb), np.float32)
        for k in range(4):
            np.add.at(D, (np.arange(n), J[:, k].astype(int)), Wt[:, k])
        return D
    W0 = dense(m.joints, m.weights)
    Wh = dense(J1, W1)
    arm = [m.bones.index(b) for b in m.bones if b.startswith(('UpperArm', 'ForeArm', 'Hand'))]
    head = m.bones.index('Head')
    # The surface: welded corners, neighbours by shared triangles.
    _, weld = np.unique(np.round(m.pos, 4), axis=0, return_inverse=True)
    weld = weld.ravel()
    t = weld[m.index]
    nw = weld.max() + 1
    r = np.concatenate([t[:, 0], t[:, 1], t[:, 2]])
    c = np.concatenate([t[:, 1], t[:, 2], t[:, 0]])
    A = coo_matrix((np.ones(len(r)), (r, c)), shape=(nw, nw)).tocsr()
    A = ((A + A.T) > 0).astype(np.float32)
    def grow(mask, k):
        for _ in range(k):
            mask = mask | ((A @ mask.astype(np.float32)) > 0)
        return mask
    armW = np.zeros(nw, bool)
    np.logical_or.at(armW, weld, W0[:, arm].sum(1) > 0.001)
    # The arm's own volume, sleeve and all: within a little more than the arm's thickness of the line from
    # shoulder to hand, and out past the shoulder joint (the torso is inside of it).
    inArm = np.zeros(len(m.pos), bool)
    for side in 'LR':
        S_, H_ = m.joint_pos(f'UpperArm{side}'), m.joint_pos(f'Hand{side}')
        ax = H_ - S_
        L = np.linalg.norm(ax)
        ax /= L
        rel = m.pos - S_
        tpar = rel @ ax
        dist = np.linalg.norm(rel - np.outer(tpar, ax), axis=1)
        mine = W0[:, [m.bones.index(f'{b}{side}') for b in ('UpperArm', 'ForeArm', 'Hand')]].sum(1) > 0.5
        r_arm = np.percentile(dist[mine & (tpar > 0.2 * L)], 95) if (mine & (tpar > 0.2 * L)).sum() > 20 else 0.08
        inArm |= (tpar > -0.04 * L) & (dist < 1.7 * r_arm) & (W0[:, head] < 0.5)
    armV = np.zeros(nw, bool)
    np.logical_or.at(armV, weld, inArm)
    allowed = grow(armW | armV, 1)
    core = grow(armW | armV, core_rings)
    # Blend factor: 1 in the core, easing to 0 over the next rings.
    b = core.astype(np.float32)
    ring = core.copy()
    for i in range(fade_rings):
        nxt = grow(ring, 1)
        b[nxt & ~ring] = 1 - (i + 1) / (fade_rings + 1)
        ring = nxt
    bv = b[weld]
    headish = W0[:, head] > 0.5
    bv[headish] = 0
    Wm = Wh.copy()
    Wm[np.ix_(~allowed[weld], arm)] = 0
    Wm /= np.maximum(Wm.sum(1, keepdims=True), 1e-6)
    Wf = W0 * (1 - bv[:, None]) + Wm * bv[:, None]
    # Four strongest, summing to 1.
    idx = np.argsort(-Wf, 1)[:, :4]
    val = np.take_along_axis(Wf, idx, 1)
    val /= np.maximum(val.sum(1, keepdims=True), 1e-6)
    return idx.astype(np.float32), val.astype(np.float32)


def run(work, name):
    cfg = CONFIG[name]
    d = os.path.join(work, name)
    out = os.path.join(work, f'fix-{name}')
    os.makedirs(out, exist_ok=True)
    m = Model(d)
    # The new skin.
    J = np.fromfile(os.path.join(work, f'k-{name}', 'joints.f32'), np.float32).reshape(-1, 4)
    Wt = np.fromfile(os.path.join(work, f'k-{name}', 'weights.f32'), np.float32).reshape(-1, 4)
    J, Wt = blend_skin(m, J, Wt)
    if cfg.get('pin_root'):
        # The singer's stage stays on Root, as it was.
        root = m.bone_weight(['Root']) > 0.6
        J[root] = m.joints[root]
        Wt[root] = m.weights[root]
    m.joints, m.weights = J.astype(np.int32), Wt
    J.tofile(os.path.join(out, 'joints.f32'))
    Wt.tofile(os.path.join(out, 'weights.f32'))
    # The atlas, with gutters (and without the dropped triangles).
    keep_file = os.path.join(d, 'keep.u8')
    corners = None
    if cfg.get('unwrap'):
        # atlas.py's bake: its corners split the vertices along the new seams.
        a = os.path.join(work, f'a-{name}')
        rec = np.fromfile(os.path.join(a, 'corners.bin'), dtype=[('t', '<i4'), ('v', '<i4'), ('u', '<f4'), ('w', '<f4')])
        keyed = {}
        src, uvs, idx = [], [], []
        for v, u, w in zip(rec['v'], rec['u'], rec['w']):
            k = (int(v), round(float(u), 6), round(float(w), 6))
            j = keyed.get(k)
            if j is None:
                j = keyed[k] = len(src)
                src.append(int(v))
                uvs.append((u, w))
            idx.append(j)
        src = np.array(src)
        m.pos, m.nrm, m.joints, m.weights = m.pos[src], m.nrm[src], m.joints[src], m.weights[src]
        m.index = np.array(idx, np.int64).reshape(-1, 3)
        uv = np.array(uvs, np.float32)
        keep = np.ones(len(m.index), bool)
        base = np.asarray(Image.open(os.path.join(a, 'base.png')).convert('RGB'), np.float32) / 255
        for key in ('normal', 'mr'):
            if os.path.exists(os.path.join(a, f'{key}.png')):
                import shutil
                shutil.copy(os.path.join(a, f'{key}.png'), os.path.join(out, f'{key}.png'))
        corners = os.path.join(a, 'corners.bin')
        maps = texel_maps(m, uv, keep)
    elif cfg.get('repack', True):
        args = [sys.executable, os.path.join(os.path.dirname(__file__), 'repack.py'), d, out, '6']
        if os.path.exists(keep_file):
            args.append(os.path.join(d, 'drop.npy'))
        subprocess.run(args, check=True)
        base = np.asarray(Image.open(os.path.join(out, 'base.png')).convert('RGB'), np.float32) / 255
    else:
        m.uv.astype(np.float32).tofile(os.path.join(out, 'uv.f32'))
        keep = np.fromfile(keep_file, np.uint8) if os.path.exists(keep_file) else np.ones(len(m.index), np.uint8)
        keep.tofile(os.path.join(out, 'keep.u8'))
        base = m.image('base')
        for key in ('normal', 'mr'):
            if os.path.exists(os.path.join(out, f'{key}.png')):
                os.remove(os.path.join(out, f'{key}.png'))
    if not corners:
        uv = np.fromfile(os.path.join(out, 'uv.f32'), np.float32).reshape(-1, 2)
        keep = np.fromfile(os.path.join(out, 'keep.u8'), np.uint8).astype(bool)
        maps = texel_maps(m, uv, keep)
    if cfg.get('pink'):
        base = edits.pink_limbs(base, maps, cfg['pink'], feet=True)
    if cfg.get('duck'):
        base = edits.duck_float(base, maps, m)
    if cfg.get('blemish'):
        face = json.load(open(os.path.join(ROOT, 'public/faces/faces.json'))).get(name)
        base = edits.singer_skin(base, maps)
        if face:
            base = edits.clean_face(base, maps, face)
            base = edits.mouth_cavity(base, maps, (0.11, 1.228, 1.325, 0.28, 0.455))
    if cfg.get('suit'):
        base = edits.astro_suit(base, maps)
    base = edits.fill(base, maps['covered'])
    Image.fromarray((base.clip(0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(out, 'base_fixed.png'))
    cmd = ['node', os.path.join(ROOT, 'tools/models/fix/apply.mjs'), os.path.join(work, 'orig', f'{name}.glb'), os.path.join(ROOT, 'public/models/npcs', f'{name}.glb')]
    cmd += ['--corners', corners] if corners else ['--uv', os.path.join(out, 'uv.f32')]
    cmd += ['--base', os.path.join(out, 'base_fixed.png'), '--joints', os.path.join(out, 'joints.f32'), '--weights', os.path.join(out, 'weights.f32')]
    for key in ('normal', 'mr'):
        if os.path.exists(os.path.join(out, f'{key}.png')):
            cmd += [f'--{key}', os.path.join(out, f'{key}.png')]
    if os.path.exists(keep_file) and not corners:
        cmd += ['--keep', os.path.join(out, 'keep.u8')]
    if cfg.get('arms'):
        pos, bones = longer_arms(m, cfg['arms'])
        pos.tofile(os.path.join(out, 'pos.f32'))
        json.dump(bones, open(os.path.join(out, 'bones.json'), 'w'))
        cmd += ['--pos', os.path.join(out, 'pos.f32'), '--bones', os.path.join(out, 'bones.json')]
    subprocess.run(cmd, check=True)


if __name__ == '__main__':
    work = sys.argv[1]
    for n in sys.argv[2:]:
        print('==', n)
        run(work, n)
