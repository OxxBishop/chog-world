"""From chogs.json, build what's needed to make 3D Chogs and run the testnet collection.

    python tools/traits/build_kit.py [DATA_DIR]

Writes into DATA_DIR (default ../chog-data):
    trait_counts.json     type -> {value: count}
    meta/<id>.json        testnet tokenURI files (same traits and art as mainnet token <id>)
    samples.json          for every Head / Body / Base / Skin / Accessory value: a sample token, its
                          count, and a ready Tripo prompt for a full-body Chog wearing that trait
    img/<id>.webp         the sample tokens' official art (Tripo's image input)
"""
import json, os, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = sys.argv[1] if len(sys.argv) > 1 else os.path.normpath(os.path.join(HERE, "..", "..", "..", "chog-data"))
GATEWAYS = ["https://ipfs.filebase.io/ipfs/", "https://gateway.pinata.cloud/ipfs/"]
chogs = json.load(open(os.path.join(DATA, "chogs.json")))
N = len(chogs)
print("tokens", N)

counts = {}
for c in chogs.values():
    for k, v in c["traits"].items():
        counts.setdefault(k, {}).setdefault(v, 0)
        counts[k][v] += 1
counts = {k: dict(sorted(v.items(), key=lambda kv: -kv[1])) for k, v in counts.items()}
json.dump(counts, open(os.path.join(DATA, "trait_counts.json"), "w"), indent=1)

# Testnet metadata: token <id> on testnet shows mainnet token <id>.
os.makedirs(os.path.join(DATA, "meta"), exist_ok=True)
for tid, c in chogs.items():
    json.dump({
        "name": f"Chog #{tid} (testnet)",
        "description": "Chog Genesis, testnet edition for Chog World. Same Chog as mainnet token #" + tid + ".",
        "image": c["image"].replace("ipfs://", "https://ipfs.filebase.io/ipfs/"),
        "attributes": [{"trait_type": k, "value": v} for k, v in c["traits"].items()],
    }, open(os.path.join(DATA, "meta", f"{tid}.json"), "w"))

# A sample token per trait value: prefer an otherwise plain Chog, so the trait reads clearly.
COMMON = {k: next(iter(v)) for k, v in counts.items()}
def plainness(c, keep):
    return sum(1 for k, v in c["traits"].items() if k != keep and v == COMMON.get(k))

def describe(t):
    base = t.get("Base", "Origin")
    head = t.get("Head")
    body = t.get("Body")
    acc = t.get("Accessory")
    parts = [
        "Full-body 3D Chog character in the official Chog plush 3D style: soft rounded chibi body, big head, "
        "a crown of soft spikes around the face in the same colour as the fur, cream face with big glossy eyes and pink blush, pink mitten hands and feet.",
        "Standing in a relaxed A-pose, arms slightly away from the body, legs slightly apart, facing the camera, plain white background, no props on the ground.",
    ]
    if base and base != "Origin":
        parts.append(f"Variant: {base} Chog (match the reference art's head exactly).")
    if t.get("Skin"):
        sk = t["Skin"]
        parts.append(f"Fur and spike colour: {'purple' if sk == 'Origin' else sk.lower()} (as in the reference).")
    if body and t.get("Naked") != "Yes":
        parts.append(f"Wearing: {body}.")
    if head and head.lower() not in ("none", "no head"):
        parts.append(f"On the head: {head}.")
    if t.get("Eyes"):
        parts.append(f"Eyes: {t['Eyes']}.")
    if t.get("Mouth"):
        parts.append(f"Mouth: {t['Mouth']}.")
    if acc and acc.lower() not in ("none",):
        parts.append(f"Holding or wearing: {acc}.")
    parts.append("Copy the face, colours and items from the reference image exactly; invent only the parts of the body the portrait does not show.")
    return " ".join(parts)

samples = {}
for cat in ("Head", "Body", "Base", "Skin", "Accessory", "Eyes"):
    if cat not in counts:
        continue
    samples[cat] = []
    for val, n in counts[cat].items():
        cands = [(plainness(c, cat), tid) for tid, c in chogs.items() if c["traits"].get(cat) == val]
        cands.sort(key=lambda x: (-x[0], int(x[1])))
        tid = cands[0][1]
        samples[cat].append({"value": val, "count": n, "share": round(100 * n / N, 1), "token": int(tid),
                             "name": chogs[tid]["name"], "traits": chogs[tid]["traits"],
                             "image": chogs[tid]["image"].replace("ipfs://", "https://ipfs.filebase.io/ipfs/"), "prompt": describe(chogs[tid]["traits"])})
json.dump(samples, open(os.path.join(DATA, "samples.json"), "w"), indent=1)

# Download the sample art.
os.makedirs(os.path.join(DATA, "img"), exist_ok=True)
want = sorted({s["token"] for v in samples.values() for s in v})
def fetch(tid):
    dst = os.path.join(DATA, "img", f"{tid}.webp")
    if os.path.exists(dst) and os.path.getsize(dst) > 1000:
        return tid, True
    path = chogs[str(tid)]["image"].replace("ipfs://", "")
    for i in range(6):
        try:
            req = urllib.request.Request(GATEWAYS[i % len(GATEWAYS)] + path, headers={"User-Agent": "chog-world-traits/1.0"})
            with urllib.request.urlopen(req, timeout=60) as r:
                open(dst, "wb").write(r.read())
            return tid, True
        except Exception:
            time.sleep(1.5 * (i + 1))
    return tid, False
with ThreadPoolExecutor(max_workers=4) as ex:
    res = list(ex.map(fetch, want))
print("images", sum(ok for _, ok in res), "of", len(want))
for k, v in counts.items():
    top = ", ".join(f"{a} {b}" for a, b in list(v.items())[:6])
    print(f"{k}: {len(v)} values | {top}")
