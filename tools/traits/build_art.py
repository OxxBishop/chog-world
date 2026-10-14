"""
Self-hosted Chog art: every token's official art, shrunk to 384 px, in public/art/<id>.webp.

The app used to load the art from public IPFS gateways at runtime, which are slow, rate-limited or
blocked on some networks. These copies ship with the site instead (about 23 KB each against 277 KB).
Full-size originals are cached in ../chog-data/img/<id>.webp, so a rerun only fetches what is missing.

    python tools/traits/build_art.py [--size 384] [--quality 80]
"""
import argparse, io, json, os, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA = os.path.join(os.path.dirname(ROOT), "chog-data")
OUT = os.path.join(ROOT, "public", "art")
GATEWAYS = ["https://ipfs.filebase.io/ipfs/", "https://ipfs.io/ipfs/", "https://dweb.link/ipfs/"]

ap = argparse.ArgumentParser()
ap.add_argument("--size", type=int, default=384)
ap.add_argument("--quality", type=int, default=80)
args = ap.parse_args()

index = json.load(open(os.path.join(ROOT, "public", "data", "chogs.json"), encoding="utf-8"))
os.makedirs(OUT, exist_ok=True)
os.makedirs(os.path.join(DATA, "img"), exist_ok=True)


def original(tid, n):
    path = os.path.join(DATA, "img", f"{tid}.webp")
    if os.path.exists(path) and os.path.getsize(path) > 1000:
        return open(path, "rb").read()
    for attempt in range(6):
        for g in GATEWAYS:
            try:
                req = urllib.request.Request(f"{g}{index['cid']}/{n}.webp", headers={"User-Agent": "chog-world-art"})
                body = urllib.request.urlopen(req, timeout=30).read()
                if len(body) > 1000:
                    open(path, "wb").write(body)
                    return body
            except Exception:
                pass
        time.sleep(2 + attempt * 3)
    return None


def build(item):
    tid, c = item
    dst = os.path.join(OUT, f"{tid}.webp")
    if os.path.exists(dst):
        return "kept"
    body = original(tid, c["n"])
    if body is None:
        return "missing"
    im = Image.open(io.BytesIO(body)).convert("RGB").resize((args.size, args.size), Image.LANCZOS)
    im.save(dst, "WEBP", quality=args.quality, method=6)
    return "built"


items = sorted(index["chogs"].items(), key=lambda kv: int(kv[0]))
counts = {}
with ThreadPoolExecutor(8) as pool:
    for i, r in enumerate(pool.map(build, items), 1):
        counts[r] = counts.get(r, 0) + 1
        if i % 200 == 0:
            print(i, counts, flush=True)
print("done", counts, "->", OUT)
missing = [tid for tid, _ in items if not os.path.exists(os.path.join(OUT, f"{tid}.webp"))]
if missing:
    print("missing ids:", " ".join(missing))
    sys.exit(1)
