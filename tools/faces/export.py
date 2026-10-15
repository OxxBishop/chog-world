# Copy the built sheets into public/faces/ with faces.json: for each model, the matrix that takes its
# mesh's own vertex positions to a place on its sheet, which way its face looks, and its head bone.
import json
import os
import shutil

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
os.chdir(HERE)
out = os.path.join(HERE, '..', '..', 'public', 'faces')
os.makedirs(out, exist_ok=True)
manifest = {}
for f in sorted(os.listdir('faces/out')):
    if not f.endswith('.json'):
        continue
    name = f[:-5]
    meta = json.load(open(f'faces/out/{f}'))
    cap = json.load(open(f'faces/{name}.json'))
    M = np.array(meta['matrix'], dtype=np.float64).reshape(4, 4).T  # three's toArray is column-major
    cx0, cy0, cx1, cy1 = meta['crop']
    cw, ch = cx1 - cx0, cy1 - cy0
    # clip space -> the face square:  u = (0.5x + 0.5 - cx0) / cw ;  v = (0.5y + 0.5 - (1 - cy1)) / ch
    S = np.array([[0.5 / cw, 0, 0, (0.5 - cx0) / cw], [0, 0.5 / ch, 0, (0.5 - (1 - cy1)) / ch], [0, 0, 1, 0], [0, 0, 0, 1]])
    F = S @ M
    W = np.array(cap['meshWorld'], dtype=np.float64).reshape(4, 4).T
    d = np.linalg.inv(W[:3, :3]) @ np.array([0, 0, 1.0])
    d /= np.linalg.norm(d)
    manifest[name] = dict(matrix=[round(float(v), 7) for v in F.T.reshape(-1)], dir=[round(float(v), 5) for v in d], head=cap['headIdx'], mesh=meta['mesh'])
    shutil.copy(f'faces/out/{name}.png', os.path.join(out, f'{name}.png'))
json.dump(manifest, open(os.path.join(out, 'faces.json'), 'w'), separators=(',', ':'))
print(len(manifest), 'faces')
