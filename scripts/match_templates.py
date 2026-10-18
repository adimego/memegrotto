"""Find the blank Imgflip template behind captioned memes and store it as `blank_template` in memes.json.
Match = same aspect ratio (+-4%) and a low *median* per-pixel difference on a 32x32 colour thumbnail
(the median ignores the caption text, which only covers part of the image)."""
import json, os, sys
import numpy as np
from PIL import Image
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = os.path.join(ROOT, "memes.json"); d = json.load(open(P)); memes = d["memes"]
def feat(m):
    try:
        im = Image.open(os.path.join(ROOT, m.get("thumb") or m["image"])).convert("RGB")
        return im.width / im.height, np.asarray(im.resize((32, 32)), dtype=np.int16)
    except Exception:
        return None
tpls = [m for m in memes if m.get("template_id") and not m.get("captioned") and not m["image"].endswith(".gif")]
tf = [(m, feat(m)) for m in tpls]; tf = [(m, f) for m, f in tf if f]
NO = set(json.load(open(os.path.join(ROOT, "scripts", "curation.json"))).get("no_blank", []))  # eyeballed false matches
n = 0; thr = float(sys.argv[1]) if len(sys.argv) > 1 else 14
for m in memes:
    m.pop("blank_template", None)
    if m in tpls or m["image"].endswith(".gif") or m["id"] in NO: continue
    f = feat(m)
    if not f: continue
    best = None
    for t, (ar, a) in tf:
        if abs(ar / f[0] - 1) > 0.04: continue
        both_white = (a.min(axis=2) > 225) & (f[1].min(axis=2) > 225)
        if both_white.mean() > 0.6: continue          # mostly-white images (tweets, text posts) match anything
        diff = np.abs(a - f[1]).max(axis=2)[~both_white]
        score = float(np.median(diff)); p75 = float(np.percentile(diff, 70))
        if score < thr and p75 < thr * 3 and (best is None or score < best[0]): best = (score, t)
    if best:
        m["blank_template"] = best[1]["image"]; m["blank_template_title"] = best[1]["title"]; n += 1
json.dump(d, open(P, "w"), indent=2, ensure_ascii=False)
print("memes with a blank template:", n)
