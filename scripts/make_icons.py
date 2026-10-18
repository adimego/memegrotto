"""Generate the brand images from icons/logo.svg with headless Chrome (playwright):
icons/icon-192.png, icon-512.png, maskable-512.png, apple-touch-icon.png and the social preview og.jpg (1200x630)."""
import json, os, pathlib
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parent.parent
SVG = (ROOT / "icons/logo.svg").read_text()
TILE = """<html><body style="margin:0"><div style="width:{n}px;height:{n}px;border-radius:{r}px;overflow:hidden;display:flex;align-items:center;
justify-content:center;background:radial-gradient(circle at 50% 40%,#2a2150 0,#18162a 45%,#0f0e17 100%)">
<div style="width:{s}px;height:{s}px">{svg}</div></div></body></html>"""
def og_html():
    memes = json.loads((ROOT / "memes.json").read_text())["memes"]
    pick = [m for m in sorted(memes, key=lambda m: m.get("rank", 1e9)) if not m.get("nsfw") and not m["thumb"].endswith(".gif")
            and m.get("width", 0) >= 300][:18]
    cells = "".join(f'<div style="background:url(\'{(ROOT / m["thumb"]).as_uri()}\') center/cover"></div>' for m in pick)
    return f"""<html><head><style>body{{margin:0;width:1200px;height:630px;overflow:hidden;font-family:'DejaVu Sans',sans-serif;background:#0f0e17}}
.g{{position:absolute;inset:0;display:grid;grid-template-columns:repeat(6,1fr);grid-template-rows:repeat(3,1fr);filter:brightness(.42) saturate(.9)}}
.p{{position:absolute;left:110px;right:110px;top:150px;bottom:150px;background:#18162af0;border:3px solid #ff8906;border-radius:36px;
display:flex;align-items:center;justify-content:center;gap:28px;box-shadow:0 20px 60px #000c}}
.l{{width:200px;height:200px;flex:none}} h1{{margin:0;font-size:104px;color:#fffffe;letter-spacing:-3px;line-height:1}}
h1 b{{background:linear-gradient(90deg,#ff8906,#e53170);-webkit-background-clip:text;color:transparent}}
p{{margin:14px 0 0;white-space:nowrap;font-size:26px;font-weight:700;color:#ff8906}}</style></head><body><div class="g">{cells}</div>
<div class="p"><div class="l">{SVG}</div><div><h1>Meme<b>Spire</b></h1><p>2,000+ memes · search · upvote · share</p></div></div></body></html>"""
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox", "--allow-file-access-from-files"])
    for name, n, r, s, omit in (("icon-192.png", 192, 40, 150, True), ("icon-512.png", 512, 104, 400, True),
                                ("maskable-512.png", 512, 0, 300, False), ("apple-touch-icon.png", 180, 0, 128, False)):
        pg = b.new_page(viewport={"width": n, "height": n}); pg.set_content(TILE.format(n=n, r=r, s=s, svg=SVG))
        pg.screenshot(path=str(ROOT / "icons" / name), omit_background=omit); pg.close()
    tmp = ROOT / ".og.html"; tmp.write_text(og_html())
    pg = b.new_page(viewport={"width": 1200, "height": 630}); pg.goto(tmp.as_uri()); pg.wait_for_timeout(800)
    pg.screenshot(path=str(ROOT / "og.jpg"), type="jpeg", quality=86); tmp.unlink(); b.close()
print("brand images written")
