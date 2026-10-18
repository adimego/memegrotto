"""Precompute a 64-bit difference hash (dHash) of every meme thumbnail into similar.json for the lightbox's
"More like this" (visual look-alikes; combined client-side with shared template/tags/category). Run after adding memes."""
import json, os
from PIL import Image
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
memes = json.load(open(os.path.join(ROOT, "memes.json")))["memes"]; out = {}
for m in memes:
    try: im = Image.open(os.path.join(ROOT, m.get("thumb") or m["image"])).convert("L").resize((9, 8), Image.LANCZOS)
    except Exception: continue
    px = list(im.get_flattened_data() if hasattr(im, "get_flattened_data") else im.getdata()); bits = 0
    for y in range(8):
        for x in range(8): bits = bits << 1 | (px[y * 9 + x] > px[y * 9 + x + 1])
    out[m["id"]] = f"{bits:016x}"
json.dump({"v": 1, "h": out}, open(os.path.join(ROOT, "similar.json"), "w"), separators=(",", ":"))
print(len(out), "hashes")
