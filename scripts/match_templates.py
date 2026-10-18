"""Blank (text-free) templates for captioned memes -> `blank_template` in memes.json (used by editor.js 'Use blank template').

Pipeline (each step resumable; downloads/caches live OUTSIDE the repo in --cache, default ~/.cache/memevault-blanks):
  python3 scripts/match_templates.py fetch     # candidate blanks: memegen.link, Imgflip get_memes + memetemplates pages
                                               # (top-all-time), and the template of every captioned imgflip.com/i/... meme
  python3 scripts/match_templates.py match     # ORB features + LSH voting, similarity-RANSAC + pixel check -> review.json
  python3 scripts/match_templates.py sheets    # contact sheets (captioned | blank) of review.json for eyeballing
  python3 scripts/match_templates.py accept decisions.json   # {"accept": {meme_id: ref}, "reject": {meme_id: ref}}
  python3 scripts/match_templates.py           # (default) re-apply scripts/curation.json `blank_verified` to memes.json

Only pairs a human looked at are ever written: `blank_verified` (meme id -> blank image/title/source) and
`blank_rejected` (meme id -> rejected candidate) in scripts/curation.json. Rule used when reviewing: the blank must be
the captioned image minus its text / caption bands. Collages, edits that add new imagery, crops of one panel and
mostly-white text templates (e.g. "Marked Safe From") matching tweets are rejected.
Accepted blanks are stored as images/blank-<source>-<key>.jpg (max 1000px, JPEG q80); library templates are reused as-is.
Imgflip rate-limits: the fetch step sleeps 8-12 s between HTML pages and backs off 2/4/8/16 min on errors.
"""
import json, os, sys, re, io, time, html, random, pickle, shutil, glob, urllib.request
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CUR_P = os.path.join(ROOT, "scripts", "curation.json"); MJ = os.path.join(ROOT, "memes.json")
args = [a for a in sys.argv[1:] if not a.startswith("--cache=")]
CACHE = next((a[8:] for a in sys.argv[1:] if a.startswith("--cache=")), os.path.expanduser("~/.cache/memevault-blanks"))
CAND = os.path.join(CACHE, "cand"); FEAT = os.path.join(CACHE, "feat")
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129 Safari/537.36"}
S = 500  # matching resolution (max side)

def load_json(p, default):
    return json.load(open(p)) if os.path.exists(p) else default

# ------------------------------------------------------------------ apply (default)
def apply():
    d = json.load(open(MJ)); cur = load_json(CUR_P, {}); ver = cur.get("blank_verified", {}); n = 0
    for m in d["memes"]:
        v = ver.get(m["id"])
        if v: m["blank_template"], m["blank_template_title"], m["blank_template_source"] = v["blank"], v["title"], v["from"]
        else:
            for k in ("blank_template", "blank_template_title", "blank_template_source"): m.pop(k, None)
        n += bool(m.get("blank_template"))
    json.dump(d, open(MJ, "w"), indent=2, ensure_ascii=False); print("memes with a blank template:", n)

# ------------------------------------------------------------------ fetch
def http(url, binary=False, polite=True, tries=4):
    for att in range(tries):
        if polite: time.sleep(8 + random.random() * 4)
        try:
            b = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read()
            return b if binary else b.decode("utf8", "replace")
        except Exception as e:
            if getattr(e, "code", None) == 404: return None
            wait = 120 * 2 ** att; print("  error", url, e, "- backing off", wait, "s", flush=True); time.sleep(wait)
    return None

def save_img(data, path):
    from PIL import Image
    im = Image.open(io.BytesIO(data)); im.seek(0); im = im.convert("RGB"); im.thumbnail((1000, 1000)); im.save(path, quality=80)

def fetch():
    os.makedirs(CAND, exist_ok=True)
    TP = os.path.join(CACHE, "imgflip_templates.json"); tpl = load_json(TP, {})   # key -> {name, slug, ext}
    def keep(): json.dump(tpl, open(TP, "w"), indent=0)
    # 1. memegen.link (blank image for every template)
    mg = json.loads(http("https://api.memegen.link/templates", polite=False)); json.dump(mg, open(os.path.join(CACHE, "memegen.json"), "w"))
    for x in mg:
        p = os.path.join(CAND, f"memegen-{x['id']}.jpg")
        if not os.path.exists(p):
            b = http(x["blank"], binary=True, polite=False)
            if b: save_img(b, p)
            time.sleep(0.4)
    # 2. Imgflip get_memes (top 100 blanks)
    for x in json.loads(http("https://api.imgflip.com/get_memes", polite=False))["data"]["memes"]:
        k, ext = x["url"].rsplit("/", 1)[1].split(".")
        tpl.setdefault(k, {"name": x["name"], "slug": x["id"], "ext": ext})
    keep()
    # 3. Imgflip template listing (top-all-time, 40 per page); name comes from the <img alt> so it can't drift
    for p in range(1, 61):
        if tpl.get(f"_page{p}") is not None: continue
        h = http(f"https://imgflip.com/memetemplates?sort=top-all-time&page={p}")
        if h is None: break
        new = 0
        for box in h.split('class="mt-box"')[1:]:
            mm = re.search(r'alt="(.*?) Meme Template"[^>]*src="//i\.imgflip\.com/4/(\w+)\.(\w+)"', box)
            sl = re.search(r'href="/meme/([^"]+)"', box)
            if mm and mm.group(2) not in tpl:
                tpl[mm.group(2)] = {"name": html.unescape(mm.group(1)), "slug": sl.group(1) if sl else "", "ext": mm.group(3)}; new += 1
        tpl[f"_page{p}"] = new; keep(); print("listing page", p, "+", new, flush=True)
        if new == 0: break
    # 4. template behind each captioned imgflip.com/i/... meme ("Caption this Meme" link on its page)
    IT = os.path.join(CACHE, "imgflip_i.json"); itp = load_json(IT, {})
    for m in json.load(open(MJ))["memes"]:
        if not m["id"].startswith("imgflip-i-") or m["id"] in itp: continue
        h = http(m["source_url"]) or ""
        mm = re.search(r"class='recaption[^']*' href='/(?:memegenerator|gif-maker)/([^'?#]+)'><img src='//i\.imgflip\.com/2/(\w+)\.(\w+)' alt='(.*?) (?:meme|gif)'", h)
        itp[m["id"]] = mm.group(2) if mm else None
        if mm and mm.group(2) not in tpl: tpl[mm.group(2)] = {"name": html.unescape(mm.group(4)), "slug": mm.group(1), "ext": mm.group(3)}
        keep(); json.dump(itp, open(IT, "w"), indent=0)
    # 5. full-size blanks from the CDN (i.imgflip.com is not the rate-limited HTML site; still paced)
    for k, v in tpl.items():
        p = os.path.join(CAND, f"imgflip-{k}.jpg")
        if k.startswith("_") or os.path.exists(p) or os.path.exists(p + ".bad"): continue
        for ext in dict.fromkeys([v["ext"], "png", "jpg"]):
            b = http(f"https://i.imgflip.com/{k}.{ext}", binary=True, polite=False, tries=1); time.sleep(0.6)
            if b:
                try: save_img(b, p); break
                except Exception: pass
        else: open(p + ".bad", "w").close()
    print("candidates:", len(glob.glob(os.path.join(CAND, "*.jpg"))))

# ------------------------------------------------------------------ match
def candidates(memes):
    out = []
    for m in memes:   # blank templates already in the library (Imgflip API / curated templates)
        if m.get("template_id") and not m.get("captioned") and not m["image"].endswith(".gif"):
            out.append((os.path.join(ROOT, m["image"]), m["image"], m["title"]))
    tpl = load_json(os.path.join(CACHE, "imgflip_templates.json"), {})
    for k, v in tpl.items():
        p = os.path.join(CAND, f"imgflip-{k}.jpg")
        if not k.startswith("_") and os.path.exists(p): out.append((p, f"imgflip:{k}", v["name"]))
    for x in load_json(os.path.join(CACHE, "memegen.json"), []):
        p = os.path.join(CAND, f"memegen-{x['id']}.jpg")
        if os.path.exists(p): out.append((p, f"memegen:{x['id']}", x["name"]))
    return out

_G = {}
def _feats(p, n):
    import numpy as np, cv2
    key = os.path.join(FEAT, f"{os.path.basename(p)}.{n}.pkl")
    if os.path.exists(key) and os.path.getmtime(key) >= os.path.getmtime(p): return pickle.load(open(key, "rb"))
    im = cv2.imread(p, cv2.IMREAD_GRAYSCALE)
    if im is None: return None
    f = S / max(im.shape); im = cv2.resize(im, (max(1, round(im.shape[1] * f)), max(1, round(im.shape[0] * f))), interpolation=cv2.INTER_AREA)
    kp, de = cv2.ORB_create(nfeatures=n, fastThreshold=10).detectAndCompute(im, None)
    r = (np.float32([k.pt for k in kp]) if kp else np.zeros((0, 2), np.float32), de, im.shape)
    pickle.dump(r, open(key, "wb")); return r

def _tiny(p):
    import numpy as np, cv2
    im = cv2.imread(p)
    return None if im is None else (im.shape[1] / im.shape[0], cv2.resize(im, (32, 32), interpolation=cv2.INTER_AREA).astype(np.int16))

def _init():
    import numpy as np, cv2
    cv2.setNumThreads(1); os.makedirs(FEAT, exist_ok=True)
    C = candidates(json.load(open(MJ))["memes"]); CF = [_feats(c[0], 1000) for c in C]
    ds, own = [], []
    for i, f in enumerate(CF):
        if f is not None and f[1] is not None: ds.append(f[1]); own.append(np.full(len(f[1]), i))
    fl = cv2.FlannBasedMatcher(dict(algorithm=6, table_number=8, key_size=14, multi_probe_level=1), dict(checks=64))
    fl.add([np.vstack(ds)]); fl.train()
    _G.update(C=C, CF=CF, OWN=np.concatenate(own), FL=fl, TINY=[_tiny(c[0]) for c in C])

def _verify(qf, cf, qp, cp):
    import numpy as np, cv2
    if cf is None or cf[1] is None or len(cf[1]) < 10: return None
    mt = cv2.BFMatcher(cv2.NORM_HAMMING).knnMatch(qf[1], cf[1], k=2)
    good = [a for a, *b in mt if b and a.distance < 0.8 * b[0].distance]
    if len(good) < 12: return None
    M, inl = cv2.estimateAffinePartial2D(cf[0][[g.trainIdx for g in good]], qf[0][[g.queryIdx for g in good]],
                                         method=cv2.RANSAC, ransacReprojThreshold=4, maxIters=3000, confidence=0.995)
    if M is None or inl.sum() < 8: return None
    s = float(np.hypot(M[0, 0], M[1, 0])); rot = float(np.degrees(np.arctan2(M[1, 0], M[0, 0])))
    (hb, wb), (hq, wq) = cf[2], qf[2]; x0, y0 = M[0, 2], M[1, 2]; x1, y1 = x0 + wb * s, y0 + hb * s
    inter = max(0, min(x1, wq) - max(x0, 0)) * max(0, min(y1, hq) - max(y0, 0))
    r = dict(inl=int(inl.sum()), rot=rot, cov_q=inter / (wq * hq), cov_b=inter / ((x1 - x0) * (y1 - y0)))
    q, c = cv2.imread(qp), cv2.imread(cp)   # pixel check: warp blank onto the meme, median colour difference
    q = cv2.resize(q, (qf[2][1], qf[2][0])); c = cv2.resize(c, (cf[2][1], cf[2][0]))
    w = cv2.warpAffine(c, M, (q.shape[1], q.shape[0]))
    msk = cv2.erode(cv2.warpAffine(np.full(c.shape[:2], 255, np.uint8), M, (q.shape[1], q.shape[0])), np.ones((5, 5))) > 250
    if msk.sum() < 100: return None
    dd = np.abs(q.astype(np.int16) - w.astype(np.int16)).max(axis=2)[msk]
    r.update(med=float(np.median(dd)), close=float((dd < 30).mean())); return r

def _run(m):
    import numpy as np
    C, CF, OWN, FL, TINY = (_G[k] for k in ("C", "CF", "OWN", "FL", "TINY"))
    qp = os.path.join(ROOT, m["image"]); qf = _feats(qp, 2000)
    if qf is None or qf[1] is None or len(qf[1]) < 20: return m["id"], []
    votes = np.bincount(OWN[[x.trainIdx for xs in FL.knnMatch(qf[1], k=3) for x in xs if x.distance < 50]], minlength=len(C))
    order = [int(i) for i in np.argsort(-votes)[:15] if votes[i] >= 4]
    t = _tiny(qp); pix = []   # plus aspect-matched candidates with a low median tiny-image difference (old method)
    for i, c in enumerate(TINY):
        if c is None or t is None or abs(c[0] / t[0] - 1) > 0.05: continue
        dd = np.abs(c[1] - t[1]).max(axis=2); bw = (c[1].min(axis=2) > 225) & (t[1].min(axis=2) > 225)
        if bw.mean() <= 0.6: pix.append((float(np.median(dd[~bw])), i))
    order += [i for sc, i in sorted(pix)[:4] if sc < 25]
    res = []
    for ci in dict.fromkeys(order):
        if C[ci][1] == m["image"]: continue
        v = _verify(qf, CF[ci], qp, C[ci][0])
        if v: v.update(ref=C[ci][1], name=C[ci][2], path=C[ci][0]); res.append(v)
    return m["id"], sorted(res, key=lambda r: -r["inl"])

def pick(res):
    """best candidate; among near-equal inlier counts prefer a library image, then Imgflip, then memegen"""
    ok = [r for r in res if abs(r["rot"]) < 3]
    if not ok: return None
    top = max(r["inl"] for r in ok); pri = lambda r: 0 if r["ref"].startswith("images/") else 1 if r["ref"].startswith("imgflip") else 2
    return min([r for r in ok if r["inl"] >= top * 0.85], key=lambda r: (pri(r), -r["inl"]))

def grade(r):
    if r["cov_b"] < 0.8 or r["cov_q"] < 0.45: return "geom"      # crop of the template, or template is a small part
    if r["med"] <= 12 and r["close"] >= 0.6: return "A"
    if r["med"] <= 25 and r["close"] >= 0.4 and r["inl"] >= 12: return "B"
    return "C"

def match():
    from multiprocessing import Pool
    memes = json.load(open(MJ))["memes"]; cur = load_json(CUR_P, {})
    done = set(cur.get("blank_verified", {})) | set(cur.get("no_blank", []))
    qs = [m for m in memes if m["id"] not in done and not m["image"].endswith(".gif") and not (m.get("template_id") and not m.get("captioned"))]
    _init(); print("candidates", len(_G["C"]), "queries", len(qs), flush=True)
    out = {}
    with Pool(os.cpu_count(), initializer=_init) as p:
        for i, (mid, res) in enumerate(p.imap_unordered(_run, qs, chunksize=4)):
            b = pick([r for r in res if r["ref"] != cur.get("blank_rejected", {}).get(mid)])
            if b: b["grade"] = grade(b); out[mid] = b
            if i % 200 == 0: print(i, flush=True); json.dump(out, open(os.path.join(CACHE, "review.json"), "w"), indent=0)
    json.dump(out, open(os.path.join(CACHE, "review.json"), "w"), indent=0)
    from collections import Counter; print("proposals:", Counter(b["grade"] for b in out.values()))

def sheets():
    from PIL import Image, ImageDraw
    rv = load_json(os.path.join(CACHE, "review.json"), {}); mm = {m["id"]: m for m in json.load(open(MJ))["memes"]}
    for g in ("A", "B", "C", "geom"):
        ks = sorted(k for k, b in rv.items() if b["grade"] == g)
        for s in range(0, len(ks), 30):
            part = ks[s:s + 30]; W0 = 210; cw = 2 * W0 + 12; ch = W0 + 16
            Sh = Image.new("RGB", (cw * 5, ch * ((len(part) + 4) // 5)), "white"); dr = ImageDraw.Draw(Sh)
            for i, k in enumerate(part):
                x, y = (i % 5) * cw, (i // 5) * ch
                for j, p in enumerate((os.path.join(ROOT, mm[k]["image"]), rv[k]["path"])):
                    im = Image.open(p).convert("RGB"); im.thumbnail((W0, W0)); Sh.paste(im, (x + j * (W0 + 2), y + 14))
                dr.text((x + 2, y + 1), f"{s + i} {k[:22]} {rv[k]['name'][:22]}", fill="black")
            out = os.path.join(CACHE, f"sheet-{g}-{s // 30}.jpg"); Sh.save(out, quality=85); print(out)

def accept(path):
    dec = json.load(open(path)); cur = load_json(CUR_P, {}); rv = load_json(os.path.join(CACHE, "review.json"), {})
    memes = json.load(open(MJ))["memes"]; byimg = {m["image"]: m for m in memes}
    tpl = load_json(os.path.join(CACHE, "imgflip_templates.json"), {}); mg = {x["id"]: x for x in load_json(os.path.join(CACHE, "memegen.json"), [])}
    ver = cur.setdefault("blank_verified", {}); rej = cur.setdefault("blank_rejected", {})
    for mid, ref in dec.get("accept", {}).items():
        if ref.startswith("images/"): ver[mid] = {"blank": ref, "title": byimg[ref]["title"], "from": byimg[ref]["source_url"]}; continue
        src, key = ref.split(":")[:2]; dst = f"images/blank-{src}-{key}.jpg"
        if src == "imgflip": title, url = tpl.get(key, {}).get("name") or rv.get(mid, {}).get("name", key), f"https://i.imgflip.com/{key}.{tpl.get(key, {}).get('ext', 'jpg')}"
        else: title, url = mg[key]["name"], mg[key]["blank"]
        if not os.path.exists(os.path.join(ROOT, dst)): shutil.copy(os.path.join(CAND, f"{src}-{key}.jpg"), os.path.join(ROOT, dst))
        ver[mid] = {"blank": dst, "title": title, "from": url}
    rej.update(dec.get("reject", {}))
    json.dump(cur, open(CUR_P, "w"), indent=1, ensure_ascii=False); apply()

if __name__ == "__main__":
    cmd = args[0] if args else "apply"
    if cmd == "accept": accept(args[1])
    else: {"apply": apply, "fetch": fetch, "match": match, "sheets": sheets}[cmd]()
