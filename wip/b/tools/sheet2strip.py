"""The user's loading sprite sheet (8 frames, 4 x 2, on black) to a strip of transparent frames, each
aligned on its ring of dots so the loop holds still: python3 -I sheet2strip.py <sheet> <out.webp> [size]

- Black is keyed out to transparent, softly (the art has glow and anti-aliased edges).
- Each frame's ring is found from its dots: small, squarish blobs. The frame is cropped round the
  ring's centre, the same size for all, so the dots stay put while the Chog goes round.
"""
import sys
from PIL import Image
import numpy as np

src, out = sys.argv[1], sys.argv[2]
size = int(sys.argv[3]) if len(sys.argv) > 3 else 256
im = Image.open(src).convert('RGB')
a = np.asarray(im).astype(np.float32) / 255.0
H, W = a.shape[:2]
cols, rows = 4, 2
cw, ch = W / cols, H / rows

# Alpha from brightness: black is clear, anything lit is solid (a soft knee for the glow).
lum = a.max(axis=2)
alpha = np.clip((lum - 0.06) / 0.18, 0, 1)
# Un-premultiply the colour against black so edges don't go dark.
rgb = np.where(alpha[..., None] > 1e-3, np.clip(a / np.maximum(alpha[..., None], 1e-3), 0, 1), 0)


def components(mask):
    # Simple 4-connected labelling (the sheet is small enough).
    from collections import deque
    lab = np.zeros(mask.shape, np.int32)
    n = 0
    hh, ww = mask.shape
    comps = []
    for y in range(hh):
        for x in range(ww):
            if mask[y, x] and not lab[y, x]:
                n += 1
                q = deque([(y, x)])
                lab[y, x] = n
                pts = []
                while q:
                    cy, cx = q.popleft()
                    pts.append((cy, cx))
                    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        ny, nx = cy + dy, cx + dx
                        if 0 <= ny < hh and 0 <= nx < ww and mask[ny, nx] and not lab[ny, nx]:
                            lab[ny, nx] = n
                            q.append((ny, nx))
                comps.append(np.array(pts))
    return comps


frames = []
centres = []
radii = []
for r in range(rows):
    for c in range(cols):
        x0, y0 = int(c * cw), int(r * ch)
        x1, y1 = int((c + 1) * cw), int((r + 1) * ch)
        m = alpha[y0:y1, x0:x1] > 0.5
        dots = []
        for pts in components(m):
            hgt, wid = np.ptp(pts[:, 0]) + 1, np.ptp(pts[:, 1]) + 1
            # The ring's dots: solid squares about 30 px across (sparkles and the Chog are not).
            if 14 <= hgt <= 40 and 14 <= wid <= 40 and len(pts) / (hgt * wid) > 0.7 and 0.7 < wid / hgt < 1.4:
                dots.append((pts[:, 1].mean(), pts[:, 0].mean()))
        dots = np.array(dots)
        if len(dots) < 5:
            raise SystemExit(f'frame {r * cols + c}: only {len(dots)} dots found')
        # A circle through the dots (least squares).
        A = np.c_[2 * dots[:, 0], 2 * dots[:, 1], np.ones(len(dots))]
        b = (dots ** 2).sum(axis=1)
        cx, cy, k = np.linalg.lstsq(A, b, rcond=None)[0]
        rad = np.sqrt(k + cx * cx + cy * cy)
        centres.append((x0 + cx, y0 + cy))
        radii.append(rad)
        frames.append((x0, y0, x1, y1))

# Each frame is cropped by its own ring, so every ring comes out the same size and in the same place
# (the sheet's rings vary a little); room round it for the Chog that overhangs the ring.
K = 2.05
strip = Image.new('RGBA', (size * len(frames), size), (0, 0, 0, 0))
rgba = np.dstack([rgb, alpha])
full = Image.fromarray((rgba * 255).astype(np.uint8), 'RGBA')
for i, ((cx, cy), rad) in enumerate(zip(centres, radii)):
    half = rad * K
    f = full.transform((size, size), Image.EXTENT, (cx - half, cy - half, cx + half, cy + half), Image.BICUBIC)
    strip.paste(f, (i * size, 0))
R = float(np.median(radii))
strip.save(out, 'WEBP', quality=92, method=6, lossless=False)
print('frames', len(frames), 'ring r', [round(v, 1) for v in radii], 'out r', round(size / 2 / K, 1), 'centres', [tuple(round(v) for v in c) for c in centres])
