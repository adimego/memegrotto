"""Compute OCR text-line bounding boxes for each meme (tesseract TSV) -> ocrboxes.json (lazy-loaded by the editor's
'Auto-detect text'). Boxes are [x, y, w, h] as fractions of the image size. Incremental: existing entries are kept."""
import json, os, re, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "ocrboxes.json")
db = json.load(open(os.path.join(ROOT, "memes.json")))["memes"]
have = json.load(open(OUT)) if os.path.exists(OUT) else {}
todo = [m for m in db if m["id"] not in have and not m["image"].endswith(".gif")]
def run(m):
    try:
        tsv = subprocess.run(["tesseract", os.path.join(ROOT, m["image"]), "stdout", "--psm", "3", "tsv"], capture_output=True, text=True,
                             timeout=90, env={**os.environ, "OMP_THREAD_LIMIT": "1"}).stdout
    except Exception:
        return m["id"], []
    W = H = None; lines = {}
    for row in tsv.splitlines()[1:]:
        f = row.split("\t")
        if len(f) < 12: continue
        lvl, x, y, w, h, conf, txt = int(f[0]), int(f[6]), int(f[7]), int(f[8]), int(f[9]), float(f[10]), f[11].strip()
        if lvl == 1: W, H = w, h; continue
        if lvl != 5 or conf < 35 or len(txt) < 2 or sum(c.isalnum() for c in txt) / len(txt) < 0.6: continue
        if h > (H or 1) * 0.35: continue
        k = (f[2], f[3], f[4])
        b = lines.setdefault(k, [x, y, x + w, y + h, 0])
        b[0], b[1], b[2], b[3], b[4] = min(b[0], x), min(b[1], y), max(b[2], x + w), max(b[3], y + h), b[4] + 1
    if not W: return m["id"], []
    out = [[round(b[0] / W, 4), round(b[1] / H, 4), round((b[2] - b[0]) / W, 4), round((b[3] - b[1]) / H, 4)] for b in lines.values()]
    return m["id"], out
with ThreadPoolExecutor(8) as ex:
    for i, (k, v) in enumerate(ex.map(run, todo)):
        have[k] = v
        if i % 200 == 0: print(i, "/", len(todo), flush=True)
ids = {m["id"] for m in db}
have = {k: v for k, v in have.items() if k in ids and v}
json.dump(have, open(OUT, "w"), separators=(",", ":"))
print("memes with text boxes:", len(have), "size KB", os.path.getsize(OUT) // 1024)
