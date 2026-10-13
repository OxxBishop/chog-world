"""Build the trait-kit page (an HTML gallery) from samples.json and trait_counts.json.

    python tools/traits/build_page.py [DATA_DIR] [OUT_DIR]
"""
import json, os, sys, shutil, html

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = sys.argv[1] if len(sys.argv) > 1 else os.path.normpath(os.path.join(HERE, "..", "..", "..", "chog-data"))
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(DATA, "page")
os.makedirs(os.path.join(OUT, "img"), exist_ok=True)
samples = json.load(open(os.path.join(DATA, "samples.json")))
counts = json.load(open(os.path.join(DATA, "trait_counts.json")))
chogs = json.load(open(os.path.join(DATA, "chogs.json")))
N = len(chogs)
for v in samples.values():
    for s in v:
        src = os.path.join(DATA, "img", f"{s['token']}.webp")
        if os.path.exists(src):
            shutil.copy(src, os.path.join(OUT, "img", f"{s['token']}.webp"))

ORDER = ["Head", "Body", "Base", "Skin", "Accessory", "Eyes"]
BLURB = {
    "Head": "Hats, caps, helmets and hair. Make these as separate 3D pieces that snap onto the base Chog's head.",
    "Body": "Outfits. Make these as separate 3D pieces, or full Chogs wearing them.",
    "Base": "The head type. Skull, Radioactive and the 1:1 need their own 3D heads.",
    "Skin": "Fur colour: a tint on the base Chog, no new model needed.",
    "Accessory": "Held items: small props that attach to the hand.",
    "Eyes": "Eye styles: these go on the face texture, no new model needed.",
}
data = {cat: samples[cat] for cat in ORDER if cat in samples}
summary = {k: len(v) for k, v in counts.items()}

page = """<title>Chog Trait Kit</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&family=Inter:wght@400;500;600&display=swap">
<style>
:root{--bg:#f4f0fc;--panel:#fff;--ink:#22183a;--muted:#5f5480;--line:#e2daf5;--accent:#6a3ad0;--accent-ink:#fff;--chip:#efe8ff;--bar:#cdbdf5;color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#15101f;--panel:#1f1830;--ink:#f1ecff;--muted:#a99cc9;--line:#2f2645;--accent:#a98bff;--accent-ink:#15101f;--chip:#2a2140;--bar:#4a3b75;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#15101f;--panel:#1f1830;--ink:#f1ecff;--muted:#a99cc9;--line:#2f2645;--accent:#a98bff;--accent-ink:#15101f;--chip:#2a2140;--bar:#4a3b75;color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 Inter,system-ui,sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding-inline:16px;padding-block:28px 64px;display:flex;flex-direction:column;gap:22px}
.kicker{font:600 12px/1 Inter,system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:var(--accent)}
h1{font:700 clamp(28px,4.4vw,42px)/1.05 Fredoka,system-ui,sans-serif;margin:6px 0 0;text-wrap:balance}
h2{font:600 22px/1.2 Fredoka,system-ui,sans-serif;margin:0}
p{margin:0;max-width:72ch}
.muted{color:var(--muted)}
.steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}
.step{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:4px}
.step b{font:600 14px Inter,system-ui,sans-serif}
.step span{font-size:13px;color:var(--muted)}
.bar{position:sticky;top:env(safe-area-inset-top,0px);z-index:5;background:var(--bg);padding-block:10px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;border-bottom:1px solid var(--line)}
.bar button{font:600 13px Inter,system-ui,sans-serif;border:1px solid var(--line);border-radius:999px;padding:7px 13px;background:var(--chip);color:var(--ink);cursor:pointer}
.bar button.on{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}
.bar input{flex:1;min-width:160px;font:14px Inter,system-ui,sans-serif;padding:8px 12px;border-radius:999px;border:1px solid var(--line);background:var(--panel);color:var(--ink)}
section{display:flex;flex-direction:column;gap:12px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;overflow:hidden;display:flex;flex-direction:column}
.card img{display:block;width:100%;aspect-ratio:1;object-fit:cover;background:var(--chip)}
.meta{padding:10px 12px 12px;display:flex;flex-direction:column;gap:6px;flex:1}
.meta b{font:600 15px/1.25 Fredoka,system-ui,sans-serif}
.share{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}
.share i{flex:1;height:6px;border-radius:3px;background:var(--chip);overflow:hidden}
.share i s{display:block;height:100%;background:var(--bar);text-decoration:none}
.meta small{font-size:12px;color:var(--muted)}
.meta button{margin-top:auto;font:600 12px Inter,system-ui,sans-serif;border:0;border-radius:8px;padding:8px 10px;background:var(--accent);color:var(--accent-ink);cursor:pointer}
.meta a{font-size:12px;color:var(--accent);text-decoration:none}
.stats{display:flex;flex-wrap:wrap;gap:8px}
.stats span{background:var(--chip);border-radius:999px;padding:4px 10px;font-size:13px;font-variant-numeric:tabular-nums}
</style>
<div class="wrap">
  <header>
    <div class="kicker">Chog World &#183; Chogathon build</div>
    <h1>Chog trait kit</h1>
    <p class="muted" style="margin-top:6px">Every trait in Chog Genesis, pulled from the contract on Monad (__N__ tokens). Each card shows how many Chogs have that trait, a sample token's official art, and a Tripo prompt for a full-body 3D Chog wearing it.</p>
  </header>
  <div class="stats">__STATS__</div>
  <div class="steps">
    <div class="step"><b>1. Download the art</b><span>Right-click the card image and save it. It is the official portrait of that token.</span></div>
    <div class="step"><b>2. Make a full-body image</b><span>In Tripo's image tool, upload the portrait and paste the card's prompt. The NFT art is head-only; this fills in the body.</span></div>
    <div class="step"><b>3. Image to 3D, then rig</b><span>Turn the result into a 3D model and use Tripo's auto-rig.</span></div>
    <div class="step"><b>4. Cover the most Chogs first</b><span>Cards are sorted by how many holders share the trait. The first dozen heads and outfits cover a big share.</span></div>
  </div>
  <div class="bar" id="bar"></div>
  <div id="sections"></div>
</div>
<script>
const DATA = __DATA__;
const BLURB = __BLURB__;
const N = __N__;
const bar = document.getElementById('bar'), out = document.getElementById('sections');
const cats = Object.keys(DATA);
let cat = cats[0], q = '';
function esc(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
cats.forEach(c => { const b = document.createElement('button'); b.textContent = `${c} (${DATA[c].length})`; b.onclick = () => { cat = c; render(); }; b.dataset.c = c; bar.appendChild(b); });
const search = document.createElement('input'); search.placeholder = 'Search traits'; search.oninput = () => { q = search.value.toLowerCase(); render(); }; bar.appendChild(search);
function render(){
  bar.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.c === cat));
  const max = Math.max(...DATA[cat].map(s => s.count));
  const list = DATA[cat].filter(s => !q || s.value.toLowerCase().includes(q));
  out.innerHTML = `<section><h2>${esc(cat)}</h2><p class="muted">${esc(BLURB[cat]||'')}</p><div class="grid">${list.map((s,i) => `
    <div class="card"><img loading="lazy" src="img/${s.token}.webp" alt="${esc(s.name)}, ${esc(cat)}: ${esc(s.value)}">
    <div class="meta"><b>${esc(s.value)}</b>
    <div class="share"><i><s style="width:${(100*s.count/max).toFixed(1)}%"></s></i>${s.count} &#183; ${s.share}%</div>
    <small>Sample: token #${s.token}</small>
    <button data-i="${DATA[cat].indexOf(s)}">Copy Tripo prompt</button></div></div>`).join('')}</div></section>`;
  out.querySelectorAll('button[data-i]').forEach(b => b.onclick = async () => {
    const p = DATA[cat][+b.dataset.i].prompt;
    try { await navigator.clipboard.writeText(p); b.textContent = 'Copied'; }
    catch { b.textContent = 'Select and copy below'; b.insertAdjacentHTML('afterend', `<textarea readonly style="width:100%;height:120px;margin-top:6px">${esc(p)}</textarea>`); }
    setTimeout(() => { if (b.textContent === 'Copied') b.textContent = 'Copy Tripo prompt'; }, 1500);
  });
}
render();
</script>
"""
stats = " ".join(f"<span>{html.escape(k)} &#183; {v}</span>" for k, v in summary.items())
page = (page.replace("__DATA__", json.dumps(data)).replace("__BLURB__", json.dumps(BLURB)).replace("__N__", str(N)).replace("__STATS__", stats))
open(os.path.join(OUT, "index.html"), "w", encoding="utf8").write(page)
print("page", os.path.join(OUT, "index.html"), "images", len(os.listdir(os.path.join(OUT, "img"))))
