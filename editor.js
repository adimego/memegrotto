// MemeSpire caption editor: canvas-based, runs fully in the browser (nothing is uploaded or stored).
(() => {
  const $ = s => document.querySelector(s);
  const FONT = 'Impact, MemeAnton, "Arial Narrow Bold", sans-serif';
  const MAX_SIDE = 1600;
  let meme = null, img = null, cv, ctx, boxes = [], sel = -1, drag = null, fontReady = null;
  // Editable pixel layer (base), erase-selection layer (mask), tools and undo/redo history
  let base = null, bctx = null, mask = null, mctx = null, tool = "move", brush = .035, paint = "#ffffff", stroke = null;
  let hist = [], fut = [], baseVer = 0, usingBlank = false, lastPush = 0, ocrBoxes = null;
  const MAX_HIST = 20;

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
          <button type="button" class="ed-blank" id="edBlank" role="switch" aria-checked="false" hidden>
            <span class="ed-blank-txt">🧼 Use blank template<small id="edBlankSub">Swap in the clean, text-free version</small></span>
            <span class="ed-switch" aria-hidden="true"><i></i></span>
          </button>
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
          <details class="ed-erase" id="edErase">
            <summary>🧽 Remove text from the image</summary>
            <div class="ed-row">
              <button class="btn" id="edAuto">🔍 Auto-detect &amp; erase text</button>
            </div>
            <div class="ed-tools" role="group" aria-label="Image tools">
              <button data-tool="move" class="on" title="Move text boxes">✋<span>Move</span></button>
              <button data-tool="erase" title="Smart erase: paint over text">🩹<span>Erase</span></button>
              <button data-tool="rect" title="Smart erase: drag a box">⬚<span>Erase box</span></button>
              <button data-tool="paint" title="Paint with a color">🖌️<span>Paint</span></button>
              <button data-tool="fill" title="Fill a box with a color">⬛<span>Fill box</span></button>
              <button data-tool="pick" title="Pick a color from the image">💧<span>Pick</span></button>
            </div>
            <div class="ed-row">
              <label>Brush <input type="range" id="edBrush" min="1" max="12" step="0.5" value="3.5"></label>
              <label title="Paint color">Color <input type="color" id="edPaint" value="#ffffff"></label>
            </div>
          </details>
          <div class="ed-row">
            <button class="btn" id="edUndo" disabled>↶ Undo</button>
            <button class="btn" id="edRedo" disabled>↷ Redo</button>
          </div>
          <div class="ed-row ed-export">
            <button class="btn primary" id="edDl">⬇️ Download PNG</button>
            <button class="btn" id="edCopy">🖼️ Copy image</button>
            <button class="btn" id="edShare">↗ Share</button>
            <button class="btn" id="edPost" hidden>🌍 Post to gallery</button>
          </div>
          <p class="ed-note" id="edNote">Drag text on the image to move it. Everything happens on your device; nothing is uploaded.</p>
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
    $("#edAdd").onclick = () => { push(); boxes.push(newBox({ text: "TEXT", y: .5, size: .08 })); select(boxes.length - 1); $("#edText").select(); };
    $("#edDel").onclick = () => { if (sel < 0) return; push(); boxes.splice(sel, 1); select(Math.min(sel, boxes.length - 1)); };
    $("#edReset").onclick = () => { push(); defaults(); select(0); };
    el.querySelectorAll("[data-tool]").forEach(b => b.onclick = () => setTool(b.dataset.tool));
    $("#edBrush").oninput = e => { brush = +e.target.value / 100; };
    $("#edPaint").oninput = e => { paint = e.target.value; };
    $("#edUndo").onclick = undo; $("#edRedo").onclick = redo;
    $("#edAuto").onclick = autoErase; $("#edBlank").onclick = toggleBlank;
    $("#edText").addEventListener("focus", () => push());
    $("#edDl").onclick = download; $("#edCopy").onclick = copyImg; $("#edShare").onclick = shareImg;
    cv.addEventListener("pointerdown", down); cv.addEventListener("pointermove", move);
    cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
    document.addEventListener("keydown", e => {
      if (el.hidden) return;
      if (e.key === "Escape") { e.stopImmediatePropagation(); close(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && document.activeElement.tagName !== "TEXTAREA") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      if ((e.key === "Delete" || e.key === "Backspace") && document.activeElement === document.body && sel >= 0) $("#edDel").click();
    }, true);
    return el;
  }

  function setProp(k, v) { if (sel < 0) return; if (Date.now() - lastPush > 800) push(); lastPush = Date.now(); boxes[sel][k] = v; draw(); syncPanel(); }
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
    ctx.drawImage(base || img, 0, 0, cv.width, cv.height);
    if (!exporting && stroke) {
      if (stroke.kind === "mask") { ctx.save(); ctx.globalAlpha = .55; ctx.drawImage(mask, 0, 0); ctx.restore(); }
      if (stroke.rect) {
        const [x0, y0, x1, y1] = stroke.rect; ctx.save(); ctx.lineWidth = Math.max(2, cv.width / 300); ctx.setLineDash([10, 6]);
        ctx.fillStyle = stroke.tool === "fill" ? paint + "aa" : "#e5317055"; ctx.strokeStyle = "#ff8906";
        ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
        ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)); ctx.restore();
      }
    }
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
    if (tool !== "move" && base) {
      e.preventDefault(); try { cv.setPointerCapture(e.pointerId); } catch (_) {}
      if (tool === "pick") {
        const p = bctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
        paint = "#" + [p[0], p[1], p[2]].map(v => v.toString(16).padStart(2, "0")).join(""); $("#edPaint").value = paint;
        toast("Picked " + paint); setTool("paint"); return;
      }
      const r = brush * Math.max(cv.width, cv.height) / 2;
      if (tool === "erase") { mctx.clearRect(0, 0, mask.width, mask.height); stroke = { id: e.pointerId, kind: "mask", tool, r, last: [x, y] }; dab(mctx, x, y, x, y, r, "#e53170"); }
      else if (tool === "paint") { push(); stroke = { id: e.pointerId, kind: "paint", tool, r, last: [x, y] }; dab(bctx, x, y, x, y, r, paint); baseVer++; }
      else stroke = { id: e.pointerId, kind: "rect", tool, rect: [x, y, x, y] };
      draw(); return;
    }
    const i = boxes.map((b, k) => k).reverse().find(k => { const r = boxes[k]._r; return r && x >= r[0] && x <= r[0] + r[2] && y >= r[1] && y <= r[1] + r[3]; });
    if (i === undefined) { select(-1); return; }
    e.preventDefault(); try { cv.setPointerCapture(e.pointerId); } catch (_) {}
    const b = boxes[i]; select(i);
    drag = { id: e.pointerId, dx: x - b.x * cv.width, dy: y - b.y * cv.height };
  }
  function move(e) {
    if (stroke && e.pointerId === stroke.id) {
      const [x, y] = pt(e);
      if (stroke.kind === "mask") dab(mctx, ...stroke.last, x, y, stroke.r, "#e53170");
      else if (stroke.kind === "paint") { dab(bctx, ...stroke.last, x, y, stroke.r, paint); baseVer++; }
      else { stroke.rect[2] = x; stroke.rect[3] = y; }
      stroke.last = [x, y]; draw(); return;
    }
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.pushed) { push(); drag.pushed = true; }
    const [x, y] = pt(e), b = boxes[sel];
    b.x = Math.min(1, Math.max(0, (x - drag.dx) / cv.width)); b.y = Math.min(1, Math.max(0, (y - drag.dy) / cv.height)); draw();
  }
  function up(e) {
    if (stroke && e.pointerId === stroke.id) {
      const s = stroke; stroke = null;
      if (s.kind === "mask") { push(); eraseMask(); }
      else if (s.kind === "rect") {
        const [x0, y0, x1, y1] = s.rect, rx = Math.min(x0, x1), ry = Math.min(y0, y1), rw = Math.abs(x1 - x0), rh = Math.abs(y1 - y0);
        if (rw > 3 && rh > 3) {
          push();
          if (s.tool === "fill") { bctx.fillStyle = paint; bctx.fillRect(rx, ry, rw, rh); baseVer++; }
          else { mctx.clearRect(0, 0, mask.width, mask.height); mctx.fillStyle = "#e53170"; mctx.fillRect(rx, ry, rw, rh); eraseMask(); }
        }
      }
      draw(); return;
    }
    if (drag && e.pointerId === drag.id) drag = null;
  }
  function dab(c, x0, y0, x1, y1, r, color) {
    c.save(); c.strokeStyle = c.fillStyle = color; c.lineCap = c.lineJoin = "round"; c.lineWidth = r * 2;
    c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); c.beginPath(); c.arc(x1, y1, r, 0, Math.PI * 2); c.fill(); c.restore();
  }
  function setTool(t) {
    tool = t; document.querySelectorAll("#editor [data-tool]").forEach(b => b.classList.toggle("on", b.dataset.tool === t));
    cv.style.cursor = t === "move" ? "move" : t === "pick" ? "copy" : "crosshair";
    if (t !== "move") { $("#edErase").open = true; select(-1); }
  }

  // ---- history (undo/redo): snapshots of the pixel layer (shared while unchanged) + text boxes ----
  function snap() {
    const last = hist[hist.length - 1];
    const data = last && last.ver === baseVer && last.w === base.width && last.h === base.height ? last.data : bctx.getImageData(0, 0, base.width, base.height);
    return { data, ver: baseVer, w: base.width, h: base.height, boxes: JSON.stringify(boxes), blank: usingBlank };
  }
  function push() { if (!base) return; hist.push(snap()); if (hist.length > MAX_HIST) hist.shift(); fut = []; syncHist(); }
  function restore(st) {
    if (base.width !== st.w || base.height !== st.h) { base.width = mask.width = cv.width = st.w; base.height = mask.height = cv.height = st.h; }
    bctx.putImageData(st.data, 0, 0); baseVer = st.ver; boxes = JSON.parse(st.boxes); usingBlank = st.blank; syncBlank();
    select(Math.min(sel, boxes.length - 1));
  }
  function undo() { if (!hist.length) return; fut.push(snap()); restore(hist.pop()); syncHist(); }
  function redo() { if (!fut.length) return; hist.push(snap()); restore(fut.pop()); syncHist(); }
  function syncHist() { if ($("#edUndo")) { $("#edUndo").disabled = !hist.length; $("#edRedo").disabled = !fut.length; } }

  // ---- smart erase: onion-peel fill from the selection border inwards, then smoothing (diffusion) ----
  function eraseMask() {
    const W = base.width, H = base.height, md = mctx.getImageData(0, 0, W, H).data;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    const pad = Math.max(2, Math.round(Math.max(W, H) / 400));   // grow selection a little to swallow outlines/antialiasing
    const sel0 = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (md[(y * W + x) * 4 + 3] > 20) {
      sel0[y * W + x] = 1; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    mctx.clearRect(0, 0, W, H);
    if (x1 < 0) return;
    x0 = Math.max(0, x0 - pad - 3); y0 = Math.max(0, y0 - pad - 3); x1 = Math.min(W - 1, x1 + pad + 3); y1 = Math.min(H - 1, y1 + pad + 3);
    const rw = x1 - x0 + 1, rh = y1 - y0 + 1, im = bctx.getImageData(x0, y0, rw, rh), d = im.data;
    const m = new Uint8Array(rw * rh);
    for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
      if (!sel0[(y + y0) * W + x + x0]) continue;
      for (let dy = -pad; dy <= pad; dy++) for (let dx = -pad; dx <= pad; dx++) {
        const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < rw && Y < rh) m[Y * rw + X] = 1;
      }
    }
    // push-pull fill: average known pixels down an image pyramid, then pull the coarse colours back up into the hole.
    // Gives smooth, streak-free fills on flat or gradient backgrounds (most caption areas) in a few ms.
    pushPull(d, m, rw, rh);
    // smoothing passes over the filled area only (keeps it from looking streaky)
    const filled = []; for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
      const gx = x + x0, gy = y + y0; let inSel = false;
      for (let dy = -pad; dy <= pad && !inSel; dy++) for (let dx = -pad; dx <= pad; dx++) { const X = gx + dx, Y = gy + dy; if (X >= 0 && Y >= 0 && X < W && Y < H && sel0[Y * W + X]) { inSel = true; break; } }
      if (inSel && x > 0 && y > 0 && x < rw - 1 && y < rh - 1) filled.push(y * rw + x);
    }
    const iters = filled.length > 300000 ? 4 : 10;
    for (let it = 0; it < iters; it++) filled.forEach(i => { for (let c = 0; c < 3; c++)
      d[i * 4 + c] = (d[(i - 1) * 4 + c] + d[(i + 1) * 4 + c] + d[(i - rw) * 4 + c] + d[(i + rw) * 4 + c]) / 4; });
    // a touch of grain so big fills don't look plastic on photos
    filled.forEach(i => { const n = (Math.random() - .5) * 6; for (let c = 0; c < 3; c++) d[i * 4 + c] += n; });
    bctx.putImageData(im, x0, y0); baseVer++; draw();
  }

  function pushPull(d, m, w0, h0) {
    const lv = []; let w = w0, h = h0;
    let C = new Float32Array(w * h * 3), Wt = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) if (!m[i]) { Wt[i] = 1; C[i * 3] = d[i * 4]; C[i * 3 + 1] = d[i * 4 + 1]; C[i * 3 + 2] = d[i * 4 + 2]; }
    lv.push({ w, h, C, Wt });
    while (w > 1 || h > 1) {
      const W2 = Math.max(1, (w + 1) >> 1), H2 = Math.max(1, (h + 1) >> 1), C2 = new Float32Array(W2 * H2 * 3), T2 = new Float32Array(W2 * H2);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x, j = (y >> 1) * W2 + (x >> 1), t = Wt[i]; if (!t) continue;
        T2[j] += t; C2[j * 3] += C[i * 3]; C2[j * 3 + 1] += C[i * 3 + 1]; C2[j * 3 + 2] += C[i * 3 + 2];
      }
      for (let j = 0; j < W2 * H2; j++) if (T2[j] > 1) { const f = 1 / T2[j]; C2[j * 3] *= f; C2[j * 3 + 1] *= f; C2[j * 3 + 2] *= f; T2[j] = 1; }
      w = W2; h = H2; C = C2; Wt = T2; lv.push({ w, h, C, Wt });
    }
    for (let k = lv.length - 2; k >= 0; k--) {
      const L = lv[k], P = lv[k + 1];
      for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
        const i = y * L.w + x, t = L.Wt[i]; if (t >= 1) continue;
        // bilinear sample of the parent level (premultiplied colours, weight already 1 there)
        const fx = Math.min(P.w - 1, Math.max(0, (x - .5) / 2)), fy = Math.min(P.h - 1, Math.max(0, (y - .5) / 2));
        const xa = Math.floor(fx), ya = Math.floor(fy), xb = Math.min(P.w - 1, xa + 1), yb = Math.min(P.h - 1, ya + 1), ax = fx - xa, ay = fy - ya;
        for (let c = 0; c < 3; c++) {
          const v = (P.C[(ya * P.w + xa) * 3 + c] * (1 - ax) + P.C[(ya * P.w + xb) * 3 + c] * ax) * (1 - ay)
                  + (P.C[(yb * P.w + xa) * 3 + c] * (1 - ax) + P.C[(yb * P.w + xb) * 3 + c] * ax) * ay;
          L.C[i * 3 + c] += (1 - t) * v;
        }
        L.Wt[i] = 1;
      }
    }
    const C0 = lv[0].C;
    for (let i = 0; i < w0 * h0; i++) if (m[i]) { d[i * 4] = C0[i * 3]; d[i * 4 + 1] = C0[i * 3 + 1]; d[i * 4 + 2] = C0[i * 3 + 2]; }
  }

  async function autoErase() {
    if (!base) return;
    if (usingBlank) return toast("Already using the blank template ✨");
    try { ocrBoxes = ocrBoxes || await fetch("ocrboxes.json").then(r => r.ok ? r.json() : {}); } catch (e) { ocrBoxes = {}; }
    const bx = ocrBoxes[meme.id];
    if (!bx || !bx.length) return toast("No text detected here, try the Erase brush");
    push(); mctx.clearRect(0, 0, mask.width, mask.height); mctx.fillStyle = "#e53170";
    const W = base.width, H = base.height;
    bx.forEach(([x, y, w, h]) => { const px = h * H * .25 + 2, py = h * H * .3 + 2; mctx.fillRect(x * W - px, y * H - py, w * W + px * 2, h * H + py * 2); });
    eraseMask(); toast(`Erased ${bx.length} text line${bx.length > 1 ? "s" : ""} 🧽 (Undo to revert)`);
  }
  function syncBlank() {
    const b = $("#edBlank"); if (!b) return;
    b.hidden = !meme.blank_template; b.classList.toggle("on", usingBlank); b.setAttribute("aria-checked", usingBlank ? "true" : "false");
    $("#edBlankSub").textContent = usingBlank ? "On: showing the clean template" : "Swap in the clean, text-free version";
  }
  async function toggleBlank() {
    if (!meme.blank_template) return;
    const src = usingBlank ? meme.image : meme.blank_template;
    const im = new Image(); const ok = await new Promise(r => { im.onload = () => r(true); im.onerror = () => r(false); im.src = src; });
    if (!ok) return toast("Couldn't load the template");
    push(); usingBlank = !usingBlank; setBase(im); syncBlank(); draw();
    toast(usingBlank ? "Blank template loaded ✨" : "Back to the original");
  }
  function setBase(im) {
    const sc = Math.min(1, MAX_SIDE / Math.max(im.naturalWidth, im.naturalHeight));
    const w = Math.round(im.naturalWidth * sc), h = Math.round(im.naturalHeight * sc);
    base = base || document.createElement("canvas"); mask = mask || document.createElement("canvas");
    base.width = mask.width = cv.width = w; base.height = mask.height = cv.height = h;
    bctx = base.getContext("2d", { willReadFrequently: true }); mctx = mask.getContext("2d", { willReadFrequently: true });
    bctx.drawImage(im, 0, 0, w, h); baseVer++;
  }

  function blob() { if (!img) { toast("Still loading…"); return Promise.reject(new Error("not ready")); } draw(true); return new Promise(res => cv.toBlob(b => { draw(); res(b); }, "image/png")); }
  const fname = () => "memespire-" + (meme ? meme.id.slice(0, 40) : "meme") + ".png";
  async function download() {
    const b = await blob().catch(() => null); if (!b) return;
    const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = fname();
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); toast("Saved PNG ⬇️");
    window.MVTrack?.(meme.id, "caption");
  }
  function copyImg() {
    if (!navigator.clipboard?.write || !window.ClipboardItem) return toast("Copying images isn't supported here, use Download");
    if (!img) return toast("Still loading…");
    navigator.clipboard.write([new ClipboardItem({ "image/png": blob() })]).then(() => { toast("Image copied 🖼️"); window.MVTrack?.(meme.id, "caption"); }, () => toast("Couldn't copy, try Download"));
  }
  async function shareImg() {
    const b = await blob().catch(() => null); if (!b) return;
    const f = new File([b], fname(), { type: "image/png" });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [f] })) {
      try { await navigator.share({ files: [f], title: "My meme · MemeSpire", text: "Made on MemeSpire " + (typeof deepLink === "function" ? deepLink(meme) : location.href) }); window.MVTrack?.(meme.id, "caption"); return; }
      catch (e) { if (e.name === "AbortError") return; }
    }
    // no file sharing here: save the image and open the normal share menu for the template link
    download(); if (typeof openShare === "function") openShare(meme, $("#edShare"));
  }

  let openSeq = 0;
  // Show the editor immediately, then load the image + font in the background (font load is capped so a
  // slow or failing FontFace load in Safari can never block the editor from appearing).
  async function open(m) {
    if (!m) return;
    if (m.noEdit || !m.image) return typeof toast === "function" && toast("This clip can't be captioned yet 🎞️");
    const el = $("#editor") || build(), seq = ++openSeq;
    meme = m; img = null; $("#edSrc").textContent = m.title + (m.video || /\.gif$/i.test(m.image) ? " · captions a still frame" : "");
    el.hidden = false; el.classList.add("loading"); document.body.style.overflow = "hidden";
    boxes = []; base = null; stroke = null; select(-1);
    cv.width = m.width || 600; cv.height = m.height || 600; ctx.clearRect(0, 0, cv.width, cv.height);
    if (!fontReady) {
      const load = document.fonts && document.fonts.load ? document.fonts.load("40px MemeAnton").catch(() => {}) : Promise.resolve();
      fontReady = Promise.race([load, new Promise(r => setTimeout(r, 1500))]);
    }
    const im = new Image();
    if (/^https?:/.test(m.image) && !m.image.startsWith(location.origin)) im.crossOrigin = "anonymous";   // community uploads (Supabase)
    const ok = await new Promise(res => { im.onload = () => res(true); im.onerror = () => res(false); im.src = m.image; });
    if (seq !== openSeq || el.hidden) return;               // user closed or opened another meme meanwhile
    el.classList.remove("loading");
    if (!ok || !im.naturalWidth) { toast("Couldn't load that image"); return; }
    await fontReady;
    if (seq !== openSeq) return;
    img = im; usingBlank = false; hist = []; fut = []; syncHist(); setBase(im); syncBlank(); setTool("move");
    defaults(); select(0);
    try { ctx.getImageData(0, 0, 1, 1); bctx.getImageData(0, 0, 1, 1); } catch (e) { toast("This image can't be exported (cross-origin)"); }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (img === im) draw(); });   // redraw once the font lands
  }
  // Event delegation, so the buttons work even if a cached older app.js is running alongside this file.
  function memeFor(btn) {
    if (btn.id === "lbEdit") return typeof view !== "undefined" && typeof idx !== "undefined" ? view[idx] : null;
    const id = btn.dataset.edit;
    return typeof memes !== "undefined" ? memes.find(x => x.id === id) : null;
  }
  document.addEventListener("click", e => {
    const btn = e.target.closest && e.target.closest("#lbEdit, [data-edit]");
    if (!btn) return;
    e.preventDefault(); e.stopPropagation();
    open(memeFor(btn));
  }, true);
  function close() { openSeq++; const el = $("#editor"); if (el) el.hidden = true; if ($("#lb").hidden) document.body.style.overflow = ""; drag = null; }
  window.MemeEditor = { open, close, blob, meme: () => meme, _state: () => ({ boxes, sel, w: cv && cv.width, h: cv && cv.height, tool, hist: hist.length, fut: fut.length, blank: usingBlank, hasBlank: !!(meme && meme.blank_template) }) };
})();
