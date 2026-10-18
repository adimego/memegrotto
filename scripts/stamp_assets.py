"""Add content-hash cache busters (?v=<hash>) to the CSS/JS references in index.html. Run before each push."""
import hashlib, os, re
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
p = os.path.join(ROOT, "index.html"); h = open(p).read()
for f in ("style.css", "app.js", "features.js", "editor.js"):
    v = hashlib.sha1(open(os.path.join(ROOT, f), "rb").read()).hexdigest()[:10]
    h = re.sub(rf'(["\']){re.escape(f)}(\?v=[\w]+)?(["\'])', rf'\g<1>{f}?v={v}\g<3>', h)
open(p, "w").write(h); print("stamped")
