"""Pull every Chog Genesis token's traits from Monad mainnet + IPFS.

    python tools/traits/fetch_traits.py [OUT_DIR]

OUT_DIR defaults to ../chog-data (kept outside the repo). Writes:
    chogs.json         token id -> {file, name, image, traits{type: value}}
    trait_counts.json  type -> {value: count}, most common first
Resumable: tokens already in chogs.json are skipped.
"""
import json, os, sys, time, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

RPC = "https://rpc.monad.xyz"
CONTRACT = "0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763"
GATEWAYS = ["https://ipfs.filebase.io/ipfs/", "https://gateway.pinata.cloud/ipfs/"]
UA = {"User-Agent": "chog-world-traits/1.0", "content-type": "application/json"}
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.normpath(os.path.join(HERE, "..", "..", "..", "chog-data"))
os.makedirs(OUT, exist_ok=True)


def post(url, body, tries=5):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=UA)
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read())
        except Exception as e:
            if i == tries - 1:
                raise
            time.sleep(1.5 * (i + 1))


def get(path, tries=6):
    last = None
    for i in range(tries):
        g = GATEWAYS[i % len(GATEWAYS)]
        try:
            req = urllib.request.Request(g + path, headers={"User-Agent": UA["User-Agent"]})
            with urllib.request.urlopen(req, timeout=40) as r:
                return r.read()
        except Exception as e:
            last = e
            time.sleep(1.0 + 1.5 * i)
    raise last


def decode_string(hexdata):
    b = bytes.fromhex(hexdata[2:])
    off = int.from_bytes(b[0:32], "big")
    n = int.from_bytes(b[off:off + 32], "big")
    return b[off + 32: off + 32 + n].decode()


def call(data):
    return {"to": CONTRACT, "data": data}


def main():
    total = int(post(RPC, {"jsonrpc": "2.0", "id": 1, "method": "eth_call", "params": [call("0x18160ddd"), "latest"]})["result"], 16)
    print("supply", total)
    path = os.path.join(OUT, "chogs.json")
    chogs = json.load(open(path)) if os.path.exists(path) else {}

    # 1. tokenURI for every token, in JSON-RPC batches.
    uris = {}
    ids = [i for i in range(1, total + 1) if str(i) not in chogs]
    for s in range(0, len(ids), 50):
        chunk = ids[s:s + 50]
        batch = [{"jsonrpc": "2.0", "id": t, "method": "eth_call",
                  "params": [call("0xc87b56dd" + t.to_bytes(32, "big").hex()), "latest"]} for t in chunk]
        res = post(RPC, batch)
        for r in res:
            if "result" in r:
                uris[r["id"]] = decode_string(r["result"])
    print("tokenURIs", len(uris))

    # 2. metadata JSON from IPFS.
    def fetch(t):
        u = uris[t]
        meta = json.loads(get(u.replace("ipfs://", "")))
        return t, u, meta

    done = 0
    with ThreadPoolExecutor(max_workers=8) as ex:
        futs = [ex.submit(fetch, t) for t in sorted(uris)]
        for f in as_completed(futs):
            try:
                t, u, meta = f.result()
            except Exception as e:
                print("failed", e)
                continue
            chogs[str(t)] = {
                "file": u.rsplit("/", 1)[-1],
                "name": meta.get("name"),
                "image": meta.get("image"),
                "traits": {a["trait_type"]: a["value"] for a in meta.get("attributes", [])},
            }
            done += 1
            if done % 100 == 0:
                json.dump(chogs, open(path, "w"), indent=1)
                print("fetched", len(chogs))
    json.dump(chogs, open(path, "w"), indent=1)

    counts = {}
    for c in chogs.values():
        for k, v in c["traits"].items():
            counts.setdefault(k, {})
            counts[k][v] = counts[k].get(v, 0) + 1
    counts = {k: dict(sorted(v.items(), key=lambda kv: -kv[1])) for k, v in counts.items()}
    json.dump(counts, open(os.path.join(OUT, "trait_counts.json"), "w"), indent=1)
    print("tokens", len(chogs), "of", total)
    for k, v in counts.items():
        print(f"{k}: {len(v)} values")


if __name__ == "__main__":
    main()
