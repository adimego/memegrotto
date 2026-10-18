// MemeVault caption editor: canvas-based, runs fully in the browser (nothing is uploaded or stored).
(() => {
  const $ = s => document.querySelector(s);
  const FONT = 'Impact, MemeAnton, "Arial Narrow Bold", sans-serif';
  const MAX_SIDE = 1600;
  let meme = null, img = null, cv, ctx, boxes = [], sel = -1, drag = null, fontReady = null;

  const newBox = (o = {}) => Object.assign({ text: "", x: .5, y: .5, anchor: "center", size: .1, fill: "#ffffff", stroke: "#000000",
    strokeW: .16, align: "center", caps: true }, o);

  function build() {
    const el = document.createElement("div");
    el.id = "editor"; el.className = "editor"; el.hidden = true;
    el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Caption editor");
    el.innerHTML = `
      <div class="ed-head"><b>✏️ Make your own</b><span class="ed-src" id="edSrc"></span>
        <button class="ed-x" id="edClose" aria-label="Close editor">✕</button></div>
      <div class="ed-main">
        <div class="ed-stage" id="edStage"><canvas id="edCanvas" aria-label="Meme preview, drag text to move it"></canvas></div>
        <div class="ed-panel">
          <div class="ed-boxes" id="edBoxes"></div>
          <textarea id="edText" rows="2" placeholder="Type your caption…" aria-label="Caption text"></textarea>
          <div class="ed-row">
            <label>Size <input type="range" id="edSize" min="3" max="25" step="0.5"></label>
            <label title="Text color">Text <input type="color" id="edFill"></label>
            <label title="Outline color">Outline <input type="color" id="edStroke"></label>
          </div>
          <div class="ed-row">
            <label>Outline <input type="range" id="edStrokeW" min="0" max="35" step="1"></label>
            <div class="ed-seg" role="group" aria-label="Alignment">
              <button data-al="left" aria-label="Align left">⟸</button><button data-al="center" aria-label="Align center">≡</button><button data-al="right" aria-label="Align right">⟹</button>
            </div>
            <button class="ed-chip" id="edCaps" aria-pressed="true" title="ALL CAPS">AA</button>
          </div>
          <div class="ed-row">
            <button class="btn" id="edAdd">＋ Text box</button>
            <button class="btn" id="edDel">🗑 Delete box</button>
            <button class="btn" id="edReset">↺ Reset</button>
          </div>
          <div class="ed-row ed-export">
            <button class="btn primary" id="edDl">⬇️ Download PNG</button>
            <button class="btn" id="edCopy">🖼️ Copy image</button>
            <button class="btn" id="edShare">↗ Share</button>
          </div>
          <p class="ed-note">Drag text on the image to move it. Everything happens on your device; nothing is uploaded.</p>
        </div>
      </div>`;
    document.body.appendChild(el);
    cv = $("#edCanvas"); ctx = cv.getContext("2d");
    $("#edClose").onclick = close;
    $("#edText").addEventListener("input", e => { if (sel >= 0) { boxes[sel].text = e.target.value; draw(); listBoxes(); } });
    $("#edSize").oninput = e => setProp("size", +e.target.value / 100);
    $("#edFill").oninput = e => setProp("fill", e.target.value);
    $("#edStroke").oninput = e => setProp("stroke", e.target.value);
    $("#edStrokeW").oninput = e => setProp("strokeW", +e.target.value / 100);
    el.querySelectorAll("[data-al]").forEach(b => b.onclick = () => setProp("align", b.dataset.al));
    $("#edCaps").onclick = () => sel >= 0 && setProp("caps", !boxes[sel].caps);
    $("#edAdd").onclick = () => { boxes.push(newBox({ text: "TEXT", y: .5, size: .08 })); select(boxes.length - 1); $("#edText").select(); };
    $("#edDel").onclick = () => { if (sel < 0) return; boxes.splice(sel, 1); select(Math.min(sel, boxes.length - 1)); };
    $("#edReset").onclick = () => { defaults(); select(0); };
    $("#edDl").onclick = download; $("#edCopy").onclick = copyImg; $("#edShare").onclick = shareImg;
    cv.addEventListener("pointerdown", down); cv.addEventListener("pointermove", move);
    cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
    document.addEventListener("keydown", e => {
      if (el.hidden) return;
      if (e.key === "Escape") { e.stopImmediatePropagation(); close(); }
      if ((e.key === "Delete" || e.key === "Backspace") && document.activeElement === document.body && sel >= 0) $("#edDel").click();
    }, true);
    return el;
  }

  function setProp(k, v) { if (sel < 0) return; boxes[sel][k] = v; draw(); syncPanel(); }
  function defaults() {
    boxes = [newBox({ text: "TOP TEXT", y: .03, anchor: "top" }), newBox({ text: "BOTTOM TEXT", y: .97, anchor: "bottom" })];
  }
  function select(i) { sel = i; syncPanel(); listBoxes(); draw(); }
  function syncPanel() {
    const b = boxes[sel], on = !!b;
    ["#edText", "#edSize", "#edFill", "#edStroke", "#edStrokeW", "#edCaps", "#edDel"].forEach(s => $(s).disabled = !on);
    document.querySelectorAll("#editor [data-al]").forEach(x => { x.disabled = !on; x.classList.toggle("on", on && b.align === x.dataset.al); });
    if (!on) { $("#edText").value = ""; return; }
    if (document.activeElement !== $("#edText")) $("#edText").value = b.text;
    $("#edSize").value = b.size * 100; $("#edFill").value = b.fill; $("#edStroke").value = b.stroke; $("#edStrokeW").value = Math.round(b.strokeW * 100);
    $("#edCaps").setAttribute("aria-pressed", b.caps); $("#edCaps").classList.toggle("on", b.caps);
  }
  function listBoxes() {
    const l = $("#edBoxes"); l.innerHTML = "";
    boxes.forEach((b, i) => {
      const c = document.createElement("button"); c.className = "ed-chip" + (i === sel ? " on" : "");
      c.textContent = (b.text.trim() || "(empty)").slice(0, 18); c.onclick = () => select(i); l.appendChild(c);
    });
  }

  // layout text of box b; returns lines, font px and bounding rect in canvas px
  function layout(b) {
    const W = cv.width, H = cv.height, px = Math.max(8, b.size * Math.min(W, H * 1.4));
    ctx.font = `${px}px ${FONT}`;
    const maxW = W * .94, words = (b.caps ? b.text.toUpperCase() : b.text).split(/\n/), lines = [];
    words.forEach(par => {
      let line = "";
      par.split(/\s+/).forEach(w => {
        const t = line ? line + " " + w : w;
        if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
      });
      lines.push(line);
    });
    const lh = px * 1.08, h = lh * lines.length, w = Math.max(...lines.map(l => ctx.measureText(l).width), px * .5);
    const cx = b.x * W, top = b.anchor === "top" ? b.y * H : b.anchor === "bottom" ? b.y * H - h : b.y * H - h / 2;
    const left = b.align === "left" ? cx - w / 2 : b.align === "right" ? cx - w / 2 : cx - w / 2;
    return { lines, px, lh, w, h, top, left, cx };
  }
  function draw(exporting = false) {
    if (!img) return;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    boxes.forEach((b, i) => {
      if (!b.text.trim() && exporting) return;
      const L = layout(b);
      ctx.font = `${L.px}px ${FONT}`; ctx.textBaseline = "top"; ctx.lineJoin = "round"; ctx.miterLimit = 2;
      ctx.textAlign = b.align;
      const ax = b.align === "left" ? L.left : b.align === "right" ? L.left + L.w : L.cx;
      L.lines.forEach((ln, k) => {
        const y = L.top + k * L.lh + L.px * .02;
        if (b.strokeW > 0) { ctx.lineWidth = L.px * b.strokeW; ctx.strokeStyle = b.stroke; ctx.strokeText(ln, ax, y); }
        ctx.fillStyle = b.fill; ctx.fillText(ln, ax, y);
      });
      b._r = [L.left - L.px * .2, L.top - L.px * .1, L.w + L.px * .4, L.h + L.px * .2];
      if (!exporting && i === sel) {
        ctx.save(); ctx.setLineDash([L.px * .25, L.px * .15]); ctx.lineWidth = Math.max(2, cv.width / 300);
        ctx.strokeStyle = "#ff8906"; ctx.strokeRect(...b._r); ctx.restore();
      }
    });
  }
  const pt = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
  function down(e) {
    const [x, y] = pt(e);
    const i = boxes.map((b, k) => k).reverse().find(k => { const r = boxes[k]._r; return r && x >= r[0] && x <= r[0] + r[2] && y >= r[1] && y <= r[1] + r[3]; });
    if (i === undefined) { select(-1); return; }
    e.preventDefault(); try { cv.setPointerCapture(e.pointerId); } catch (_) {}
    const b = boxes[i]; select(i);
    drag = { id: e.pointerId, dx: x - b.x * cv.width, dy: y - b.y * cv.height };
  }
  function move(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const [x, y] = pt(e), b = boxes[sel];
    b.x = Math.min(1, Math.max(0, (x - drag.dx) / cv.width)); b.y = Math.min(1, Math.max(0, (y - drag.dy) / cv.height)); draw();
  }
  function up(e) { if (drag && e.pointerId === drag.id) drag = null; }

  function blob() { draw(true); return new Promise(res => cv.toBlob(b => { draw(); res(b); }, "image/png")); }
  const fname = () => "memevault-" + (meme ? meme.id.slice(0, 40) : "meme") + ".png";
  async function download() {
    const b = await blob(), a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = fname();
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); toast("Saved PNG ⬇️");
  }
  function copyImg() {
    if (!navigator.clipboard?.write || !window.ClipboardItem) return toast("Copying images isn't supported here, use Download");
    navigator.clipboard.write([new ClipboardItem({ "image/png": blob() })]).then(() => toast("Image copied 🖼️"), () => toast("Couldn't copy, try Download"));
  }
  async function shareImg() {
    const b = await blob(), f = new File([b], fname(), { type: "image/png" });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [f] })) {
      try { await navigator.share({ files: [f], title: "My meme · MemeVault", text: "Made on MemeVault " + (typeof deepLink === "function" ? deepLink(meme) : location.href) }); return; }
      catch (e) { if (e.name === "AbortError") return; }
    }
    // no file sharing here: save the image and open the normal share menu for the template link
    download(); if (typeof openShare === "function") openShare(meme, $("#edShare"));
  }

  async function open(m) {
    const el = $("#editor") || build();
    meme = m; $("#edSrc").textContent = m.title;
    fontReady = fontReady || (document.fonts ? document.fonts.load(`40px MemeAnton`).catch(() => {}) : Promise.resolve());
    const im = new Image(); im.decoding = "async";
    await new Promise((res, rej) => { im.onload = res; im.onerror = rej; im.src = m.image; }).catch(() => null);
    if (!im.naturalWidth) return toast("Couldn't load that image");
    await fontReady;
    img = im;
    const s = Math.min(1, MAX_SIDE / Math.max(im.naturalWidth, im.naturalHeight));
    cv.width = Math.round(im.naturalWidth * s); cv.height = Math.round(im.naturalHeight * s);
    defaults(); el.hidden = false; document.body.style.overflow = "hidden"; select(0);
    try { ctx.getImageData(0, 0, 1, 1); } catch (e) { toast("This image can't be exported (cross-origin)"); }
  }
  function close() { const el = $("#editor"); if (el) el.hidden = true; if ($("#lb").hidden) document.body.style.overflow = ""; drag = null; }
  window.MemeEditor = { open, close, _state: () => ({ boxes, sel, w: cv && cv.width, h: cv && cv.height }) };
})();
