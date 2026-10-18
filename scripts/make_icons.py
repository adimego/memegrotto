"""Generate the PWA icons (icons/*.png): gradient tile with a cartoon frog face + 'MV'."""
import os
from PIL import Image, ImageDraw, ImageFont
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
F = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"
def tile(n, maskable=False):
    S = n * 4; im = Image.new("RGB", (S, S)); px = im.load()
    a, b, c = (255, 137, 6), (229, 49, 112), (127, 90, 240)
    for y in range(S):
        for x in range(S):
            t = (x + y) / (2 * S); p, q, u = (a, b, t * 2) if t < .5 else (b, c, (t - .5) * 2)
            px[x, y] = tuple(int(p[i] + (q[i] - p[i]) * u) for i in range(3))
    d = ImageDraw.Draw(im); k = 0.78 if maskable else 1.0; cx = S / 2; r = S * .30 * k; cy = S * .45
    d.ellipse([cx - r, cy - r * .8, cx + r, cy + r * .8], fill=(44, 182, 125))                    # frog head
    for sx in (-1, 1):
        ex, ey, er = cx + sx * r * .55, cy - r * .62, r * .32
        d.ellipse([ex - er, ey - er, ex + er, ey + er], fill=(44, 182, 125))
        d.ellipse([ex - er * .7, ey - er * .7, ex + er * .7, ey + er * .7], fill="white")
        d.ellipse([ex - er * .32, ey - er * .32, ex + er * .32, ey + er * .32], fill=(15, 14, 23))
    d.arc([cx - r * .6, cy - r * .35, cx + r * .6, cy + r * .45], 20, 160, fill=(15, 14, 23), width=int(S * .018))
    f = ImageFont.truetype(F, int(S * .17 * k)); txt = "MemeVault" if False else "MV"
    w = d.textlength(txt, font=f); d.text((cx - w / 2, cy + r * .9), txt, font=f, fill="white")
    im = im.resize((n, n), Image.LANCZOS)
    if not maskable:   # rounded corners for the plain icon
        m = Image.new("L", (n, n), 0); ImageDraw.Draw(m).rounded_rectangle([0, 0, n - 1, n - 1], radius=n // 5, fill=255)
        o = Image.new("RGBA", (n, n)); o.paste(im, mask=m); return o
    return im
os.makedirs(os.path.join(ROOT, "icons"), exist_ok=True)
for n in (192, 512): tile(n).save(os.path.join(ROOT, f"icons/icon-{n}.png"), optimize=True)
tile(512, True).save(os.path.join(ROOT, "icons/maskable-512.png"), optimize=True)
tile(180, True).convert("RGB").save(os.path.join(ROOT, "icons/apple-touch-icon.png"), optimize=True)
print("icons written")
