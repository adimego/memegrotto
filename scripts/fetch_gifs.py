#!/usr/bin/env python3
"""Add GIF / short-video memes to memes.json (discover -> stage -> review -> add).

Sources (all public, no API keys)
  imgflip  Imgflip GIF templates (https://imgflip.com/gif-templates?page=N); served as small MP4s (i.imgflip.com/<key>.mp4)
  tenor    Tenor public search pages (https://tenor.com/search/<q>-gifs); the page embeds JSON with mp4 URLs, shares and tags
  reddit   Reddit RSS (/r/<sub>/top/.rss?t=...): i.redd.it GIFs, imgur .gifv, giphy, and v.redd.it videos (DASH; the
           playlist is read and the video + optional audio tracks are merged with ffmpeg). The .json API returns 403.
  url      a single media URL (GIF/MP4/WebM/v.redd.it) with a title: `url URL "Title" Category [tags]`

Every clip is normalised with ffmpeg: H.264 main profile (iOS Safari), yuv420p, even dimensions, <=540 px on the long side,
<=20 s, +faststart, muted (audio is kept only when a candidate says "audio": true; the site's players always start muted).
Size target 1.5 MB (re-encodes at a higher CRF / smaller size / lower fps), hard max 4 MB. For each clip we write a poster
frame (images/<id>.jpg; the <video> poster and caption-editor still), a 480 px grid thumbnail (thumbs/<id>.jpg) and a
contact sheet of 4 frames for review. Duplicates are rejected by title and by dHash of 3 frames against the library's
existing clips (and against each other).

Workflow (staging dir defaults to /workspace/gifstage; nothing touches the repo until `add`)
  python3 scripts/fetch_gifs.py discover imgflip --pages 40 [--out cands.json]       # templates not yet in the library
  python3 scripts/fetch_gifs.py discover tenor "kombucha girl" "is this a pigeon" --n 2
  python3 scripts/fetch_gifs.py discover reddit reactiongifs HighQualityGifs --t all --n 40
  python3 scripts/fetch_gifs.py stage cands.json [--only id,id] [--jobs 6]           # download + encode + sheets + dedupe
  python3 scripts/fetch_gifs.py review [ids.txt]                                      # labelled review grids (review-NN.png)
  python3 scripts/fetch_gifs.py add picks.json      # [{"cid": ..., optional "title"/"category"/"tags"/"nsfw"}] -> repo
Candidate JSON fields: cid, title, category, tags, source, source_url, media_url, attribution, optional template_id, nsfw,
audio, ss (start seconds), t (max seconds). LOOK AT every review grid before `add` (same content rules as fetch_memes.py:
crude = nsfw flag; no hate/slurs, sexual imagery, gore/real violence or injury, nothing involving minors).
Legacy: --list / --imgflip PICKS.json / --reddit URL TITLE CATEGORY [tags] still work.
"""
import concurrent.futures, datetime, html, json, os, re, shutil, subprocess, sys, tempfile, time, urllib.parse, urllib.request
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_memes import BLOCK_RX, CRUDE_RX, EPSTEIN_RX, MINOR_RX, categorize, make_tags  # shared content rules

UA = {"User-Agent": "Mozilla/5.0 (MemeGrotto fetch script; +https://adimego.github.io/memegrotto/)"}
BROWSER_UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"}
MAX_SIDE, MAX_SECONDS = 540, 20
TARGET_BYTES, HARD_MAX_BYTES = 1_500_000, 4_000_000
STAGE = os.environ.get("GIF_STAGE", "/workspace/gifstage")
TODAY = datetime.date.today().isoformat()

def get(url, headers=UA, tries=3):
    for i in range(tries):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=60).read()
        except urllib.error.HTTPError as e:
            if e.code in (429, 503) and i < tries - 1: time.sleep(20 * (i + 1)); continue
            raise

def slug(s): return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:50].strip("-")
def norm_title(s): return re.sub(r"[^a-z0-9]", "", s.lower().replace("gif", ""))

# ---------------------------------------------------------------- ffmpeg helpers
def probe(path):
    o = json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,width,height,avg_frame_rate,r_frame_rate:format=duration",
                                   "-of", "json", path], capture_output=True, text=True, check=True).stdout)
    v = next(s for s in o["streams"] if s["codec_type"] == "video")
    fr = v.get("avg_frame_rate") or v.get("r_frame_rate") or "0/1"; n, d = (fr.split("/") + ["1"])[:2]
    fps = float(n) / float(d) if float(d) else 0
    return {"w": int(v["width"]), "h": int(v["height"]), "dur": float(o["format"].get("duration") or 0), "fps": fps,
            "audio": any(s["codec_type"] == "audio" for s in o["streams"])}

def encode(src, dst, ss=0, t=MAX_SECONDS, audio=False, audio_src=None):
    """Any GIF/MP4/WebM -> H.264 main-profile MP4. Steps down quality until it fits TARGET_BYTES; fails over HARD_MAX_BYTES."""
    p = probe(src); src_fps = p["fps"] if 5 <= p["fps"] <= 60 else 25
    for side, crf, fps in ((MAX_SIDE, 26, 30), (MAX_SIDE, 30, 30), (432, 31, 24), (360, 33, 20)):
        f = min(fps, round(src_fps))
        vf = (f"scale='if(gt(iw,ih),min({side},iw),-2)':'if(gt(iw,ih),-2,min({side},ih))':flags=lanczos,"
              f"pad=ceil(iw/2)*2:ceil(ih/2)*2,fps={f},format=yuv420p")
        cmd = ["ffmpeg", "-v", "error", "-y"] + (["-ss", str(ss)] if ss else []) + ["-i", src]
        if audio_src: cmd += (["-ss", str(ss)] if ss else []) + ["-i", audio_src]
        cmd += ["-t", str(min(t, MAX_SECONDS)), "-map", "0:v:0"]
        if audio and (audio_src or p["audio"]): cmd += ["-map", "1:a:0" if audio_src else "0:a:0", "-c:a", "aac", "-b:a", "64k", "-ac", "1"]
        else: cmd += ["-an"]
        cmd += ["-vf", vf, "-c:v", "libx264", "-profile:v", "main", "-level", "3.1", "-preset", "slow", "-crf", str(crf),
                "-pix_fmt", "yuv420p", "-movflags", "+faststart", dst]
        subprocess.run(cmd, check=True)
        if os.path.getsize(dst) <= TARGET_BYTES: break
    if os.path.getsize(dst) > HARD_MAX_BYTES: raise RuntimeError(f"too big after re-encode: {os.path.getsize(dst)} bytes")
    return probe(dst)

def frame(mp4, at, out, extra=()):
    for t in (at, at * 0.5, 0):     # very short / odd-timestamped clips: fall back towards the first frame
        r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{t:.2f}", "-i", mp4, "-frames:v", "1", *extra, "-q:v", "3", out])
        if r.returncode == 0 and os.path.exists(out) and os.path.getsize(out): return
    raise RuntimeError("could not extract a frame from " + mp4)

def dhash(path, n=16):
    from PIL import Image, ImageStat
    im = Image.open(path).convert("L")
    if ImageStat.Stat(im).stddev[0] < 8: return None          # near-blank frame (fade, black): useless for dedupe
    im = im.resize((n + 1, n)); px = list(im.get_flattened_data() if hasattr(im, "get_flattened_data") else im.getdata())
    return sum(1 << i for i in range(n * n) if px[(i // n) * (n + 1) + i % n] > px[(i // n) * (n + 1) + i % n + 1])

def clip_hashes(mp4, dur, tmp):
    hs = []
    for k, f in enumerate((0.15, 0.5, 0.85)):
        p = os.path.join(tmp, f"h{k}.jpg"); frame(mp4, dur * f, p)
        h = dhash(p); hs.append(h) if h is not None else None
    return hs

def is_dup(a, b, thr=22):
    """Two clips are duplicates if >=2 of a's frames (or all, if fewer) are within thr bits of some frame of b."""
    if not a or not b: return False
    hits = sum(1 for x in a if min(bin(x ^ y).count("1") for y in b) <= thr)
    return hits >= min(2, len(a))

def contact_sheet(mp4, dur, out, n=4, h=150):
    from PIL import Image
    with tempfile.TemporaryDirectory() as tmp:
        ims = []
        for k in range(n):
            p = os.path.join(tmp, f"{k}.jpg"); frame(mp4, max(0, dur * (0.04 + 0.92 * k / (n - 1)) - 0.05), p, ["-vf", f"scale=-2:{h}"])
            ims.append(Image.open(p).convert("RGB"))
        W = sum(i.width for i in ims) + 4 * (n - 1); sheet = Image.new("RGB", (W, h), "white"); x = 0
        for i in ims: sheet.paste(i, (x, 0)); x += i.width + 4
        sheet.save(out, quality=85)

# ---------------------------------------------------------------- library index (for dedupe)
def load_db(): return json.load(open(os.path.join(ROOT, "memes.json")))

def library_index():
    """Titles, template ids, source media URLs and frame hashes of clips already in the library (hashes cached in STAGE)."""
    db = load_db()["memes"]; vids = [m for m in db if m.get("video")]
    cache_p = os.path.join(STAGE, "library_hashes.json"); cache = json.load(open(cache_p)) if os.path.exists(cache_p) else {}
    with tempfile.TemporaryDirectory() as tmp:
        for m in vids:
            if m["id"] in cache: continue
            p = os.path.join(ROOT, m["video"])
            if os.path.exists(p): cache[m["id"]] = clip_hashes(p, probe(p)["dur"], tmp)
    os.makedirs(STAGE, exist_ok=True); json.dump(cache, open(cache_p, "w"))
    return {"titles": {norm_title(m["title"]): m["id"] for m in vids},
            "tids": {m.get("template_id") for m in vids if m.get("template_id")},
            "urls": {m.get("image_url") for m in db} | {m.get("source_url") for m in db},
            "hashes": cache, "ids": {m["id"] for m in db}}

# ---------------------------------------------------------------- discovery
def content_flags(text):
    """(blocked_reason or None, nsfw) using the shared fetch_memes rules."""
    if BLOCK_RX.search(text): return "block-word:" + BLOCK_RX.search(text).group(0), False
    if EPSTEIN_RX.search(text) and MINOR_RX.search(text): return "epstein+minor", False
    return None, bool(CRUDE_RX.search(text))

def discover_imgflip(pages=40):
    out = []
    for page in range(1, pages + 1):
        h = get("https://imgflip.com/gif-templates" + (f"?page={page}" if page > 1 else "")).decode()
        got = re.findall(r'<h3 class="mt-title">\s*<a title="[^"]*" href="/memetemplate/(\d+)/([^"]+)">([^<]+)</a>.*?src="//i\.imgflip\.com/2/(\w+)\.jpg"', h, re.S)
        if not got: break
        for tid, s, title, key in got:
            t = html.unescape(title).strip(); cat = categorize(t)
            out.append({"cid": f"imgflip-gif-{tid}-{slug(t)}", "template_id": int(tid), "key": key, "title": t, "category": cat,
                        "tags": make_tags(t, cat), "source": "Imgflip", "source_url": f"https://imgflip.com/memetemplate/{tid}/{s}",
                        "media_url": f"https://i.imgflip.com/{key}.mp4", "attribution": "GIF template via Imgflip (imgflip.com)", "page": page})
        time.sleep(1.5)
    return out

def discover_tenor(queries, n=3):
    out = []
    for q in queries:
        h = get(f"https://tenor.com/search/{urllib.parse.quote(slug(q))}-gifs", BROWSER_UA).decode()
        m = re.search(r'<script id="store-cache"[^>]*>(.*?)</script>', h, re.S)
        if not m: print("tenor: no data for", q); continue
        res = next(iter(json.loads(m.group(1))["universal"]["search"].values()), {}).get("results", [])
        res = [r for r in res if r.get("media_formats", {}).get("mp4") and r["media_formats"]["mp4"].get("duration", 0) >= 0.8]
        for r in sorted(res[:24], key=lambda r: -r.get("shares", 0))[:n]:
            t = r.get("h1_title") or q; t = re.sub(r"\s*GIF$", "", t).strip() or q.title()
            desc = r.get("content_description", ""); cat = categorize(q + " " + t)
            out.append({"cid": f"tenor-{r['id']}", "title": t, "query": q, "description": desc, "category": cat,
                        "tags": list(dict.fromkeys([*[x.lower() for x in r.get("tags", [])[:5]], *make_tags(q, cat)]))[:8],
                        "source": "Tenor", "source_url": r["itemurl"], "media_url": r["media_formats"]["mp4"]["url"],
                        "attribution": "Via Tenor" + (f" (uploaded by {r['user']['username']})" if r.get("user", {}).get("username") else ""),
                        "shares": r.get("shares", 0)})
        time.sleep(2)
    return out

SUB_CATS = {"reactiongifs": "Reaction", "HighQualityGifs": "Movies & TV", "gifs": "Absurd & Surreal", "memes": "Absurd & Surreal",
            "dankvideos": "Absurd & Surreal", "MemeVideos": "Absurd & Surreal", "SonicTheHedgehog": "Gaming", "gaming": "Gaming",
            "AnimalsBeingDerps": "Animals", "Unexpected": "Absurd & Surreal"}

def reddit_media(content):
    links = [html.unescape(l) for l in re.findall(r'https?://[^"\s<>]+', content)]
    for l in links:
        if re.match(r"https://v\.redd\.it/\w+$", l): return l
    for l in links:
        if re.match(r"https://i\.redd\.it/\w+\.gif$", l): return l
    for l in links:
        m = re.match(r"https?://(?:i\.|www\.)?imgur\.com/(\w+)\.(gifv|gif|mp4)$", l)
        if m: return f"https://i.imgur.com/{m.group(1)}.mp4"
        m = re.match(r"https://media\d?\.giphy\.com/media/(\w+)/", l)
        if m: return f"https://media.giphy.com/media/{m.group(1)}/giphy.mp4"
    return None

def discover_reddit(subs, t="all", n=50):
    out = []
    for i, sub in enumerate(subs):
        if i: time.sleep(10)                                   # anonymous RSS is rate limited
        x = get(f"https://www.reddit.com/r/{sub}/top/.rss?t={t}&limit={min(n, 100)}").decode()
        for e in x.split("<entry>")[1:]:
            title = html.unescape(re.search(r"<title>(.*?)</title>", e, re.S).group(1)).strip()
            link = html.unescape(re.search(r'<link href="([^"]+)"', e).group(1))
            author = re.search(r"<name>/u/([^<]+)</name>", e); content = html.unescape(re.search(r"<content[^>]*>(.*?)</content>", e, re.S).group(1))
            media = reddit_media(content); pid = re.search(r"/comments/(\w+)/", link)
            if not media or not pid: continue
            cat = categorize(title); cat = cat if cat not in ("Absurd & Surreal", "Classic Templates") else SUB_CATS.get(sub, "Absurd & Surreal")
            out.append({"cid": f"reddit-gif-{pid.group(1)}", "title": title, "category": cat, "tags": make_tags(title, cat, ["reddit", f"r/{sub}"]),
                        "source": f"Reddit r/{sub}", "source_url": link, "media_url": media, "audio": "v.redd.it" in media and sub in ("dankvideos", "MemeVideos"),
                        "attribution": f"Posted by /u/{author.group(1) if author else '?'} on r/{sub}", "kind": "video" if "v.redd.it" in media else "gif"})
    return out

# ---------------------------------------------------------------- download + stage
def download(c, tmp):
    """Returns (video_path, audio_path_or_None)."""
    url = c["media_url"]
    if re.match(r"https://v\.redd\.it/\w+/?$", url):
        base = url.rstrip("/"); mpd = get(base + "/DASHPlaylist.mpd").decode()
        reps = [(a, re.search(r"<BaseURL>([^<]+)</BaseURL>", body).group(1)) for a, body in
                re.findall(r"<Representation([^>]*)>(.*?)</Representation>", mpd, re.S) if "<BaseURL>" in body]
        def side(a): return max(int(re.search(r'\swidth="(\d+)"', a).group(1)), int(re.search(r'\sheight="(\d+)"', a).group(1)))
        vids = sorted(((side(a), u) for a, u in reps if 'height="' in a), key=lambda x: (x[0] > 720, abs(x[0] - 540)))
        auds = [u for a, u in reps if "audio" in a.lower()]
        vp = os.path.join(tmp, "v.mp4"); open(vp, "wb").write(get(f"{base}/{vids[0][1]}"))
        ap = None
        if auds and c.get("audio"):
            ap = os.path.join(tmp, "a.mp4"); open(ap, "wb").write(get(f"{base}/{auds[0]}"))
        return vp, ap
    ext = os.path.splitext(urllib.parse.urlparse(url).path)[1] or ".mp4"
    p = os.path.join(tmp, "in" + ext); open(p, "wb").write(get(url, BROWSER_UA if "tenor" in url or "giphy" in url else UA)); return p, None

def stage_one(c, lib):
    d = os.path.join(STAGE, c["cid"]); os.makedirs(d, exist_ok=True); mp4 = os.path.join(d, "clip.mp4")
    try:
        blocked, crude = content_flags(c["title"] + " " + " ".join(c.get("tags", [])) + " " + c.get("description", ""))
        if blocked: return {**c, "status": "blocked", "reason": blocked}
        if c.get("template_id") in lib["tids"] or c["media_url"] in lib["urls"] or c["source_url"] in lib["urls"] or c["cid"] in lib["ids"]:
            return {**c, "status": "dup", "reason": "already in library (id/url/template)"}
        if norm_title(c["title"]) in lib["titles"]: return {**c, "status": "dup", "reason": "title = " + lib["titles"][norm_title(c["title"])]}
        if not os.path.exists(mp4):
            with tempfile.TemporaryDirectory() as tmp:
                vp, ap = download(c, tmp)
                encode(vp, mp4, ss=c.get("ss", 0), t=c.get("t", MAX_SECONDS), audio=c.get("audio", False), audio_src=ap)
        p = probe(mp4)
        if p["dur"] < 0.5: return {**c, "status": "bad", "reason": "not animated"}
        frame(mp4, p["dur"] * 0.45, os.path.join(d, "poster.jpg"))
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", os.path.join(d, "poster.jpg"), "-vf", "scale='min(480,iw)':-2", "-q:v", "5", os.path.join(d, "thumb.jpg")], check=True)
        contact_sheet(mp4, p["dur"], os.path.join(d, "sheet.jpg"))
        with tempfile.TemporaryDirectory() as tmp: hs = clip_hashes(mp4, p["dur"], tmp)
        dup = next((k for k, v in lib["hashes"].items() if is_dup(hs, v)), None)
        r = {**c, "status": "dup" if dup else "ok", "hashes": hs, "w": p["w"], "h": p["h"], "dur": round(p["dur"], 1), "has_audio": p["audio"],
             "bytes": os.path.getsize(mp4), "nsfw": c.get("nsfw", crude)}
        if dup: r["reason"] = "frames match " + dup
        return r
    except Exception as e:
        return {**c, "status": "error", "reason": f"{type(e).__name__}: {e}"[:200]}

def manifest_path(): return os.path.join(STAGE, "manifest.json")
def load_manifest(): return json.load(open(manifest_path())) if os.path.exists(manifest_path()) else {}

def stage(cands, jobs=6):
    lib = library_index(); man = load_manifest()
    todo = [c for c in cands if c["cid"] not in man or man[c["cid"]]["status"] == "error"]
    with concurrent.futures.ThreadPoolExecutor(jobs) as ex:
        for r in ex.map(lambda c: stage_one(c, lib), todo):
            man[r["cid"]] = r; print(r["status"], r["cid"], r.get("reason", ""), r.get("bytes", ""), flush=True)
    # dedupe new clips against each other (keep the first staged)
    oks = [r for r in man.values() if r["status"] == "ok"]
    for i, a in enumerate(oks):
        for b in oks[:i]:
            if b["status"] == "ok" and (is_dup(a["hashes"], b["hashes"]) or norm_title(a["title"]) == norm_title(b["title"])):
                a["status"], a["reason"] = "dup", "same as staged " + b["cid"]; print("dup", a["cid"], "=", b["cid"]); break
    json.dump(man, open(manifest_path(), "w"), indent=1)
    from collections import Counter; print(Counter(r["status"] for r in man.values()))

def review(ids=None, per=10):
    """Labelled review grids: one row per clip (4 frames start..end), `per` rows per PNG -> STAGE/review-NN.png."""
    from PIL import Image, ImageDraw
    man = load_manifest(); rows = [r for r in man.values() if r["status"] == "ok" and (not ids or r["cid"] in ids)]
    for f in os.listdir(STAGE):
        if f.startswith("review-"): os.remove(os.path.join(STAGE, f))
    for g in range(0, len(rows), per):
        chunk = rows[g:g + per]; sheets = [Image.open(os.path.join(STAGE, r["cid"], "sheet.jpg")) for r in chunk]
        W = min(1400, max(s.width for s in sheets)); H = sum(s.height + 22 for s in sheets)
        im = Image.new("RGB", (W, H), "white"); dr = ImageDraw.Draw(im); y = 0
        for r, s in zip(chunk, sheets):
            dr.text((4, y + 4), f"[{g + chunk.index(r)}] {r['cid']} | {r['title'][:70]} | {r['dur']}s {r['bytes'] // 1024}KB{' AUDIO' if r.get('has_audio') else ''}{' NSFW' if r.get('nsfw') else ''}", fill="black")
            im.paste(s.crop((0, 0, min(W, s.width), s.height)), (0, y + 20)); y += s.height + 22
        im.save(os.path.join(STAGE, f"review-{g // per:02d}.png")); print("review", g // per, [r["cid"] for r in chunk])

def feed_of(r):
    """Trending-mix feed (app.js trendingList round-robins fresh memes across feeds): reddit:<sub> or gif:<source>."""
    return "reddit:" + r["source"].split("r/")[-1] if r["source"].startswith("Reddit r/") else "gif:" + r["source"].lower()

def add(picks):
    """Copy reviewed clips into the repo and append entries. picks: list of cid strings or {"cid", overrides...}."""
    man = load_manifest(); d = load_db(); have = {m["id"] for m in d["memes"]}; new = []
    for p in picks:
        p = {"cid": p} if isinstance(p, str) else p; r = {**man[p["cid"]], **p}
        if r["status"] != "ok" and not p.get("force"): print("skip", r["cid"], r["status"]); continue
        eid = r["cid"]
        if eid in have: continue
        src = os.path.join(STAGE, eid)
        shutil.copy(os.path.join(src, "clip.mp4"), os.path.join(ROOT, "videos", eid + ".mp4"))
        shutil.copy(os.path.join(src, "poster.jpg"), os.path.join(ROOT, "images", eid + ".jpg"))
        shutil.copy(os.path.join(src, "thumb.jpg"), os.path.join(ROOT, "thumbs", eid + ".jpg"))
        tags = list(dict.fromkeys([t.lower() for t in r.get("tags", [])] + ["gif", "animated"] + (["video"] if r.get("kind") == "video" else [])))
        e = {"id": eid, **({"template_id": r["template_id"]} if r.get("template_id") else {}), "title": r["title"], "category": r["category"],
             "source": r["source"], "source_url": r["source_url"], "image_url": r["media_url"], "attribution": r["attribution"], "tags": tags,
             "image": f"images/{eid}.jpg", "thumb": f"thumbs/{eid}.jpg", "video": f"videos/{eid}.mp4", "duration": r["dur"],
             "width": r["w"], "height": r["h"], "date_added": r.get("date_added", TODAY), "feed": feed_of(r)}
        if r.get("nsfw"): e["nsfw"] = True
        if r.get("has_audio"): e["audio"] = True
        new.append(e); have.add(eid); man[eid]["status"] = "added"
    d["memes"].extend(new); d["generated"] = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
    json.dump(d, open(os.path.join(ROOT, "memes.json"), "w"), ensure_ascii=False, indent=2)
    json.dump(man, open(manifest_path(), "w"), indent=1)
    print(f"added {len(new)} clips ({sum(os.path.getsize(os.path.join(ROOT, e['video'])) for e in new) / 1e6:.1f} MB video) -> {len(d['memes'])} memes")

# ---------------------------------------------------------------- CLI
def opt(a, name, default=None, cast=str):
    if name in a: i = a.index(name); v = cast(a[i + 1]); del a[i:i + 2]; return v
    return default

if __name__ == "__main__":
    a = sys.argv[1:]
    out = opt(a, "--out"); jobs = opt(a, "--jobs", 6, int)
    if a and a[0] == "discover":
        src = a[1]
        if src == "imgflip": c = discover_imgflip(opt(a, "--pages", 40, int))
        elif src == "tenor": n = opt(a, "--n", 3, int); c = discover_tenor(a[2:], n)
        elif src == "reddit": t = opt(a, "--t", "all"); n = opt(a, "--n", 50, int); c = discover_reddit(a[2:], t, n)
        else: sys.exit("discover imgflip|tenor|reddit")
        out = out or os.path.join(STAGE, f"cands-{src}.json"); os.makedirs(STAGE, exist_ok=True)
        json.dump(c, open(out, "w"), indent=1, ensure_ascii=False); print(len(c), "candidates ->", out)
    elif a and a[0] == "stage":
        only = opt(a, "--only"); c = json.load(open(a[1]))
        if only: keep = set(only.split(",")); c = [x for x in c if x["cid"] in keep]
        stage(c, jobs)
    elif a and a[0] == "review":
        review(set(open(a[1]).read().split()) if len(a) > 1 else None)
    elif a and a[0] == "add":
        add(json.load(open(a[1])))
    elif a and a[0] == "url":
        cat = a[3] if len(a) > 3 else categorize(a[2])
        c = [{"cid": "reddit-gif-" + slug(a[2]) if "redd" in a[1] else "clip-" + slug(a[2]), "title": a[2], "category": cat,
              "tags": a[4].split(",") if len(a) > 4 else make_tags(a[2], cat), "source": urllib.parse.urlparse(a[1]).netloc,
              "source_url": a[1], "media_url": a[1], "attribution": "Via " + urllib.parse.urlparse(a[1]).netloc}]
        stage(c, 1); print("now review + add", c[0]["cid"])
    # ---- legacy interface
    elif not a or a[0] == "--list":
        for o in discover_imgflip(3): print(o["template_id"], o["key"], o["title"])
    elif a[0] == "--imgflip":
        picks = json.load(open(a[1])); byk = {o["key"]: o for o in discover_imgflip(3)}
        c = [{**byk.get(p["key"], {}), **{k: v for k, v in p.items() if k in ("title", "category", "tags")}} for p in picks if p["key"] in byk]
        stage(c, jobs); add([x["cid"] for x in c])
    elif a[0] == "--reddit":
        sys.argv = [sys.argv[0], "url", *a[1:]]; os.execv(sys.executable, [sys.executable, *sys.argv])
    else:
        print(__doc__)
