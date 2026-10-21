"""A Tripo model's metal-roughness map made vinyl: no metal anywhere (Tripo marked whole suits half metal, and
crowns full metal: with nothing to reflect they rendered dark).
  python orm_fix.py <dump dir of the 2048 model> <out.png>"""
import json, os, sys
import numpy as np
from PIL import Image
d, out = sys.argv[1:3]
i = json.load(open(os.path.join(d, 'model.json')))
m = i['materials'][0]
pick = lambda k: os.path.join(d, [x for x in os.listdir(d) if x.startswith('img%d.' % m[k])][0])
orm = np.asarray(Image.open(pick('mr')).convert('RGB'), np.float32) / 255
base = np.asarray(Image.open(pick('base')).convert('RGB').resize(orm.shape[1::-1]), np.float32) / 255
mx, mn = base.max(-1), base.min(-1)
sat = (mx - mn) / np.maximum(mx, 1e-3)
r, g, b = base[..., 0], base[..., 1], base[..., 2]
hue = np.degrees(np.arctan2(np.sqrt(3) * (g - b), 2 * r - g - b)) % 360
gold = (hue > 28) & (hue < 62) & (sat > 0.35) & (mx > 0.4)
silver = (sat < 0.12) & (mx > 0.45) & (mx < 0.85)
# (None at all: without a sky to reflect, metal renders near black; King Pom's plain gold crown read best.)
keep = np.zeros(orm.shape[:2], bool)
before = float((orm[..., 2] > 0.5).mean())
orm[..., 2] = np.where(keep, orm[..., 2], 0)
Image.fromarray((orm * 255 + 0.5).astype(np.uint8)).resize((1024, 1024), Image.LANCZOS).save(out)
print('metal share', round(before, 3), '->', round(float((orm[..., 2] > 0.5).mean()), 3))
