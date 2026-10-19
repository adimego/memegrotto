"""Add content-hash cache busters (?v=<hash>) to the CSS/JS references in index.html. Run before each push."""
import hashlib, os, re
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
p = os.path.join(ROOT, "index.html"); h = open(p).read()
for f in ("style.css", "app.js", "features.js", "play.js", "reactions.js", "community.js", "editor.js"):
    v = hashlib.sha1(open(os.path.join(ROOT, f), "rb").read()).hexdigest()[:10]
    h = re.sub(rf'(["\']){re.escape(f)}(\?v=[\w]+)?(["\'])', rf'\g<1>{f}?v={v}\g<3>', h)
open(p, "w").write(h)
# the (unlinked) moderation page
mp = os.path.join(ROOT, "moderate.html")
if os.path.exists(mp):
    m = open(mp).read()
    for f in ("style.css", "moderate.css", "moderate.js"):
        v = hashlib.sha1(open(os.path.join(ROOT, f), "rb").read()).hexdigest()[:10]
        m = re.sub(rf'(["\']){re.escape(f)}(\?v=[\w]+)?(["\'])', rf'\g<1>{f}?v={v}\g<3>', m)
    open(mp, "w").write(m)
# service worker version = hash of index.html + stamped assets + memes.json, so every deploy ships a new worker
sw = os.path.join(ROOT, "sw.js")
if os.path.exists(sw):
    hh = hashlib.sha1(h.encode()); hh.update(open(os.path.join(ROOT, "memes.json"), "rb").read())
    s = open(sw).read(); s = re.sub(r'const VERSION = "[^"]*";', f'const VERSION = "{hh.hexdigest()[:10]}";', s); open(sw, "w").write(s)
print("stamped")
