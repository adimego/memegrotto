#!/usr/bin/env python3
"""Add GIF / short-video memes to memes.json.

Sources
  * Imgflip GIF templates (https://imgflip.com/gif-templates): Imgflip serves them as small MP4s (i.imgflip.com/<key>.mp4)
  * Reddit GIF / video posts: pass post media URLs (i.redd.it/*.gif, v.redd.it/<id>) with --reddit URL TITLE CATEGORY

Every clip is normalised with ffmpeg: H.264 MP4, no audio, max 720 px on the long side, max 15 s, +faststart.
Big GIFs are converted to MP4 the same way (GIFs are 5-20x bigger than the equivalent MP4).
For each clip we also write a poster frame (images/<id>.jpg, used by the caption editor and as the <video> poster)
and a 480 px grid thumbnail (thumbs/<id>.jpg). Entries get "video", "duration" and the "gif" tag.

Usage
  python3 scripts/fetch_gifs.py --list                     # print the Imgflip GIF templates (3 pages) with keys
  python3 scripts/fetch_gifs.py --imgflip PICKS.json       # add the reviewed picks: [{"key","title","category","tags"}...]
  python3 scripts/fetch_gifs.py --reddit URL "Title" "Category" [tag,tag]
Review the poster frames (contact-sheet them) before committing: same content rules as fetch_memes.py.
"""
import datetime, html, json, os, re, subprocess, sys, tempfile, urllib.request
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = {"User-Agent": "Mozilla/5.0 (MemeSpire fetch script)"}
MAX_SIDE, MAX_SECONDS = 720, 15

def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read()

def probe(path):
    o = json.loads(subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration",
                                   "-of", "json", path], capture_output=True, text=True, check=True).stdout)
    s = o["streams"][0]; return int(s["width"]), int(s["height"]), float(o["format"].get("duration") or 0)

def normalise(src, dst):
    """Any GIF/MP4/WebM -> small H.264 MP4 (no audio, <=720p, <=15 s)."""
    vf = f"scale='if(gt(iw,ih),min({MAX_SIDE},iw),-2)':'if(gt(iw,ih),-2,min({MAX_SIDE},ih))':flags=lanczos,pad=ceil(iw/2)*2:ceil(ih/2)*2,fps=30"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-t", str(MAX_SECONDS), "-an", "-vf", vf, "-c:v", "libx264", "-preset", "slow",
                    "-crf", "27", "-pix_fmt", "yuv420p", "-movflags", "+faststart", dst], check=True)

def frames(mp4, poster, thumb):
    w, h, d = probe(mp4)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{d * 0.45:.2f}", "-i", mp4, "-frames:v", "1", "-q:v", "3", poster], check=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", poster, "-vf", "scale='min(480,iw)':-2", "-q:v", "5", thumb], check=True)
    return w, h, d

def add(entry_id, raw_path, meta):
    mp4 = f"videos/{entry_id}.mp4"; poster = f"images/{entry_id}.jpg"; thumb = f"thumbs/{entry_id}.jpg"
    normalise(raw_path, os.path.join(ROOT, mp4))
    w, h, d = frames(os.path.join(ROOT, mp4), os.path.join(ROOT, poster), os.path.join(ROOT, thumb))
    tags = list(dict.fromkeys([*meta.get("tags", []), "gif", "animated"]))
    return {"id": entry_id, **{k: v for k, v in meta.items() if k not in ("tags", "key")}, "tags": tags, "image": poster, "thumb": thumb,
            "video": mp4, "duration": round(d, 1), "width": w, "height": h, "date_added": datetime.date.today().isoformat()}

def slug(s): return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:50]

def list_imgflip(pages=3):
    out = []
    for page in range(1, pages + 1):
        h = get("https://imgflip.com/gif-templates" + (f"?page={page}" if page > 1 else "")).decode()
        for tid, s, title, key in re.findall(r'<h3 class="mt-title">\s*<a title="[^"]*" href="/memetemplate/(\d+)/([^"]+)">([^<]+)</a>.*?src="//i\.imgflip\.com/2/(\w+)\.jpg"', h, re.S):
            out.append({"template_id": int(tid), "slug": s, "title": html.unescape(title).strip(), "key": key})
    return out

def save(new):
    p = os.path.join(ROOT, "memes.json"); d = json.load(open(p)); have = {m["id"] for m in d["memes"]}
    added = [m for m in new if m["id"] not in have]; d["memes"].extend(added)
    d["generated"] = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
    json.dump(d, open(p, "w"), ensure_ascii=False, indent=2); print(f"added {len(added)} entries -> {len(d['memes'])} memes")

if __name__ == "__main__":
    a = sys.argv[1:]
    if not a or a[0] == "--list":
        for o in list_imgflip(): print(o["template_id"], o["key"], o["title"])
    elif a[0] == "--imgflip":
        picks = json.load(open(a[1])); byk = {o["key"]: o for o in list_imgflip()}; new = []
        with tempfile.TemporaryDirectory() as tmp:
            for p in picks:
                o = byk.get(p["key"], {}); tid = o.get("template_id") or p.get("template_id")
                eid = f"imgflip-gif-{tid}-{slug(p['title'])}"
                raw = os.path.join(tmp, p["key"] + ".mp4"); open(raw, "wb").write(get(f"https://i.imgflip.com/{p['key']}.mp4"))
                new.append(add(eid, raw, {"template_id": tid, "title": p["title"], "category": p["category"], "tags": p.get("tags", []),
                    "source": "Imgflip", "source_url": f"https://imgflip.com/memetemplate/{tid}/{o.get('slug', slug(p['title']))}",
                    "image_url": f"https://i.imgflip.com/{p['key']}.mp4", "attribution": "GIF template via Imgflip (imgflip.com)"}))
                print("ok", eid)
        save(new)
    elif a[0] == "--reddit":
        url, title, cat = a[1], a[2], a[3]; tags = a[4].split(",") if len(a) > 4 else []
        if "v.redd.it" in url and not url.endswith(".mp4"):   # video-only stream (no audio needed for muted playback)
            url = url.rstrip("/") + "/CMAF_480.mp4"
        with tempfile.TemporaryDirectory() as tmp:
            raw = os.path.join(tmp, "in" + os.path.splitext(url.split("?")[0])[1]); open(raw, "wb").write(get(url))
            eid = "reddit-gif-" + slug(title)
            save([add(eid, raw, {"title": title, "category": cat, "tags": tags, "source": "Reddit", "source_url": url, "image_url": url,
                                 "attribution": "Via Reddit"})])
