// MemeSpire community features (Supabase): submissions + Community gallery, editor "Post to gallery", reports,
// view/share/caption/download events and a Stats page. Everything stays hidden until supabase/features.sql has been
// run (detected through the mv_features() RPC), so this file is safe to ship first.
(() => {
  const SB = SB_URL, H = SB_H, ST = `${SB}/storage/v1`;
  const F = { ok: false };
  const json = (url, opt = {}) => fetch(url, { ...opt, headers: { ...H, "Content-Type": "application/json", ...(opt.headers || {}) }, signal: opt.signal || AbortSignal.timeout(10000) });
  const rpc = (fn, body = {}) => json(`${SB}/rest/v1/rpc/${fn}`, { method: "POST", body: JSON.stringify(body) });
  let gallery = [], galleryLoaded = false, settled = false;
  let pendingId = (new URLSearchParams(location.hash.slice(1)).get("m") || "").startsWith("sub-") ? new URLSearchParams(location.hash.slice(1)).get("m") : null;

  // ---------- events (debounced, batched, fire-and-forget)
  const q = [], seen = new Set(); let tmr = null;
  function track(id, kind) {
    if (!F.ok || !id || !/^[A-Za-z0-9_.~-]{1,100}$/.test(id)) return;
    const k = kind + ":" + id;
    if (kind === "view" && seen.has(k)) return;               // one view per meme per page session
    seen.add(k); q.push({ meme_id: id, kind });
    clearTimeout(tmr); tmr = setTimeout(flush, q.length >= 20 ? 0 : 4000);
  }
  function flush(keep) {
    if (!q.length) return; const rows = q.splice(0, 50);
    fetch(`${SB}/rest/v1/events`, { method: "POST", keepalive: !!keep, headers: { ...H, "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify(rows) }).catch(() => {});
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(true); });
  addEventListener("pagehide", () => flush(true));
  window.MVTrack = (id, kind) => track(id, kind);
  const vidOf = m => (typeof vid === "function" ? vid(m) : m.id);
  // hook into the app: lightbox views, shares, downloads
  const _openLb = openLb; openLb = function (i) { _openLb(i); const m = view[idx]; if (m) { track(vidOf(m), "view"); lbExtras(m); } };
  const _share = share; share = function (m, a) { track(vidOf(m), "share"); return _share(m, a); };
  document.addEventListener("click", e => {
    const a = e.target.closest && e.target.closest("#lbDl, #shareMenu [data-a=dl]"); if (!a || !view[idx]) return;
    track(vidOf(view[idx]), "download");
  }, true);

  // ---------- probe
  function giveUp() { settled = true; if (pendingId) { const id = pendingId; pendingId = null; openById(id); } }
  async function probe() {
    try {
      const r = await rpc("mv_features"); if (!r.ok) return giveUp();
      Object.assign(F, await r.json(), { ok: true });
    } catch (e) { return giveUp(); }
    document.body.classList.add("has-community");
    sidebarBlock(); editorButton(); loadGallery();
    if (!$("#lb").hidden && view[idx]) lbExtras(view[idx]);
  }

  // ---------- Community gallery
  async function loadGallery() {
    try {
      const r = await json(`${SB}/rest/v1/submissions?select=id,title,tags,category,image_path,kind,created_at&status=eq.approved&order=created_at.desc&limit=300`);
      if (!r.ok) return; const rows = await r.json();
      let urls = {};
      if (rows.length) {
        const s = await json(`${ST}/object/sign/submissions`, { method: "POST", body: JSON.stringify({ expiresIn: 60 * 60 * 24, paths: rows.map(x => x.image_path) }) });
        if (s.ok) (await s.json()).forEach(x => { if (x.signedURL) urls[x.path] = ST + x.signedURL; });
      }
      memes = memes.filter(m => !m.community);
      gallery = rows.filter(x => urls[x.image_path]).map((x, i) => {
        const tags = [...(x.tags || []).map(t => String(t).toLowerCase().slice(0, 30)), "community", x.kind === "creation" ? "made on memespire" : "submitted"];
        return { id: "sub-" + x.id, title: x.title, category: x.category && CAT_META[x.category] ? x.category : "Community", tags, community: true, kind: x.kind,
                 image: urls[x.image_path], thumb: urls[x.image_path], source: "Community", source_url: location.origin + location.pathname + "#m=sub-" + x.id,
                 attribution: x.kind === "creation" ? "Made with the MemeSpire editor by a visitor" : "Submitted by a MemeSpire visitor",
                 date_added: (x.created_at || "").slice(0, 10), width: 0, height: 0, rank: 100000 + i,
                 hay: norm(x.title + " " + tags.join(" ") + " " + (x.category || "")) };
      });
      memes.push(...gallery); galleryLoaded = true;
      sidebarBlock(); if (state.list === "community") render();
      if (pendingId && $("#lb").hidden) openById(pendingId); pendingId = null;
    } catch (e) {}
    giveUp();
  }
  Lib.lists.community = {
    label: () => "🌍 Community gallery",
    items: () => gallery.slice(),
    render: tb => {
      tb.innerHTML = `<button class="btn primary" data-a="submit">＋ Submit a meme</button><span class="muted">Approved uploads and editor creations from visitors. New posts appear after a quick review.</span>`;
      tb.querySelector("[data-a=submit]").onclick = () => submitForm();
      if (!gallery.length) $("#empty").querySelector("p").firstChild.textContent = galleryLoaded ? "Nothing approved yet. Be the first! " : "Loading the gallery… ";
    }
  };
  Lib.lists.stats = { label: () => "📊 Stats", items: () => [], render: tb => statsPage(tb) };

  function sidebarBlock() {
    if (!F.ok) return; let box = $("#commBox");
    if (!box) {
      box = document.createElement("div"); box.id = "commBox"; box.className = "mylib";
      const h = document.createElement("h3"); h.textContent = "Community";
      h.id = "commHead"; const hs = [...document.querySelectorAll("#sidebar h3")];
      (hs.find(x => x.textContent === "Categories") || hs[0]).before(h, box);   // community sits above Categories
    }
    const it = (list, ic, name, n) => `<button type="button" class="cat${state.list === list ? " on" : ""}" data-list="${list}"><span class="ic">${ic}</span><span>${name}</span><span class="n">${n}</span></button>`;
    box.innerHTML = it("community", "🌍", "Community gallery", gallery.length) + (F.stats ? it("stats", "📊", "Stats", "") : "") +
      `<div class="mylib-tools"><button type="button" data-a="submit">＋ Submit a meme</button></div>`;
    box.querySelectorAll("[data-list]").forEach(b => b.onclick = () => { Object.assign(state, { list: state.list === b.dataset.list ? null : b.dataset.list, cat: null, tag: null, top: false, trend: false }); closeMenu(); update(); });
    box.querySelector("[data-a=submit]").onclick = () => { closeMenu(); submitForm(); };
  }
  const _bs = buildSidebar; buildSidebar = function () { _bs(); sidebarBlock(); };

  // ---------- uploads
  const TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" }, MAX = 5 * 1024 * 1024;
  const rid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).replace(/-/g, "");
  async function shrink(file) {   // keep uploads under 5 MB: re-encode big stills as JPEG, max 2000px
    if (file.size <= MAX && TYPES[file.type]) return file;
    if (file.type === "image/gif") throw new Error("GIFs must be under 5 MB");
    const bm = await createImageBitmap(file), sc = Math.min(1, 2000 / Math.max(bm.width, bm.height));
    const c = document.createElement("canvas"); c.width = Math.round(bm.width * sc); c.height = Math.round(bm.height * sc); c.getContext("2d").drawImage(bm, 0, 0, c.width, c.height);
    for (const qual of [0.9, 0.8, 0.65, 0.5]) { const b = await new Promise(r => c.toBlob(r, "image/jpeg", qual)); if (b && b.size <= MAX) return b; }
    throw new Error("That image is too big (max 5 MB)");
  }
  async function submit({ blob, title, tags, category, kind }) {
    const ext = TYPES[blob.type]; if (!ext) throw new Error("Use a PNG, JPEG, GIF or WebP image");
    const path = `pending/${rid()}.${ext}`;
    const up = await fetch(`${ST}/object/submissions/${path}`, { method: "POST", headers: { ...H, "Content-Type": blob.type, "x-upsert": "false", "cache-control": "3600" }, body: blob, signal: AbortSignal.timeout(60000) });
    if (!up.ok) throw new Error(up.status === 413 ? "That image is too big (max 5 MB)" : "Upload failed (" + up.status + "), try again later");
    const r = await fetch(`${SB}/rest/v1/submissions`, { method: "POST", headers: { ...H, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ title: title.slice(0, 120), tags: tags.slice(0, 10).map(t => t.slice(0, 30)), category: category || null, image_path: path, kind }) });
    if (!r.ok) { const t = await r.text().catch(() => ""); throw new Error(/too many/.test(t) ? "You've posted a lot today, try again later" : "Couldn't save the submission (" + r.status + ")"); }
  }
  function modal(html, cls = "") {
    closeModal();
    const bd = document.createElement("div"); bd.className = "mv-modal-bd"; bd.id = "mvModalBd";
    const m = document.createElement("div"); m.className = "mv-modal " + cls; m.id = "mvModal"; m.setAttribute("role", "dialog"); m.setAttribute("aria-modal", "true");
    m.innerHTML = `<div class="sm-head"><b></b><button class="sm-x" aria-label="Close">✕</button></div>` + html;
    bd.onclick = closeModal; m.querySelector(".sm-x").onclick = closeModal;
    document.body.append(bd, m); return m;
  }
  function closeModal() { $("#mvModal")?.remove(); $("#mvModalBd")?.remove(); }
  document.addEventListener("keydown", e => { if (e.key === "Escape" && $("#mvModal")) { e.stopImmediatePropagation(); closeModal(); } }, true);
  const catOpts = sel => Object.keys(CAT_META).map(c => `<option${c === sel ? " selected" : ""}>${c}</option>`).join("");
  const rules = `<label class="mv-check"><input type="checkbox" name="ok" required> <span>I made this or may share it, and it isn't hateful, sexual, gory or about minors.</span></label>`;
  function submitForm() {
    if (!F.ok) return toast("Submissions aren't open yet");
    const m = modal(`<form class="mv-form">
      <label class="mv-drop"><input type="file" name="file" accept="image/png,image/jpeg,image/gif,image/webp" required><span>📷 Choose an image<small>PNG, JPEG, GIF or WebP · max 5 MB</small></span><img alt="" hidden></label>
      <label>Title <input name="title" maxlength="120" required placeholder="What's the meme?"></label>
      <label>Tags <input name="tags" maxlength="200" placeholder="comma, separated, tags"></label>
      <label>Category <select name="category"><option value="">Pick one…</option>${catOpts()}</select></label>
      ${rules}<button class="btn primary" type="submit">Submit for review</button><p class="muted">Submissions are reviewed before they show up in the Community gallery.</p></form>`);
    m.querySelector("b").textContent = "＋ Submit a meme";
    const f = m.querySelector("form"), prev = m.querySelector(".mv-drop img");
    f.file.onchange = () => { const x = f.file.files[0]; if (x) { prev.src = URL.createObjectURL(x); prev.hidden = false; if (!f.title.value) f.title.value = x.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").slice(0, 120); } };
    f.onsubmit = async e => {
      e.preventDefault(); const btn = f.querySelector("[type=submit]"); btn.disabled = true; btn.textContent = "Uploading…";
      try {
        const blob = await shrink(f.file.files[0]);
        await submit({ blob, title: f.title.value.trim(), tags: f.tags.value.split(",").map(t => t.trim()).filter(Boolean), category: f.category.value, kind: "upload" });
        closeModal(); toast("Thanks! Your meme is waiting for review 🙌");
      } catch (err) { btn.disabled = false; btn.textContent = "Submit for review"; toast(err.message || "Upload failed"); }
    };
  }
  function editorButton() {
    const b = $("#edPost"); if (!b) return setTimeout(editorButton, 500);   // editor DOM is built on first open
    b.hidden = false; $("#edNote").textContent = "Drag text on the image to move it. Edits happen on your device; nothing is uploaded unless you tap Post to gallery.";
    b.onclick = async () => {
      const t = MemeEditor.meme(); const blob = await MemeEditor.blob().catch(() => null); if (!blob) return;
      const m = modal(`<form class="mv-form"><img class="mv-prev" alt="" src="${URL.createObjectURL(blob)}">
        <label>Title <input name="title" maxlength="120" required value="${esc((t?.title || "My meme").slice(0, 120))}"></label>
        ${rules}<button class="btn primary" type="submit">🌍 Post to gallery</button><p class="muted">Posts appear in the Community gallery after a quick review.</p></form>`);
      m.querySelector("b").textContent = "🌍 Post to the Community gallery";
      const f = m.querySelector("form");
      f.onsubmit = async e => {
        e.preventDefault(); const btn = f.querySelector("[type=submit]"); btn.disabled = true; btn.textContent = "Posting…";
        try {
          const small = blob.size > MAX ? await shrink(new File([blob], "meme.png", { type: "image/png" })) : blob;
          await submit({ blob: small, title: f.title.value.trim(), tags: (t?.tags || []).filter(x => !["reddit", "fresh", "blank template", "community", "submitted", "made on memespire", "made on memevault"].includes(x)).slice(0, 8), category: t?.category && CAT_META[t.category] ? t.category : "", kind: "creation" });
          closeModal(); toast("Posted! It'll show in the gallery once approved 🎉"); if (t) track(vidOf(t), "caption");
        } catch (err) { btn.disabled = false; btn.textContent = "🌍 Post to gallery"; toast(err.message || "Posting failed"); }
      };
    };
  }
  new MutationObserver(() => { if (F.ok && $("#edPost")?.hidden) editorButton(); }).observe(document.body, { childList: true });

  // ---------- reports
  function lbExtras(m) {
    const acts = $(".lb-actions"); acts.querySelector(".rep-btn")?.remove();
    if (!F.ok || !F.reports) return;
    const b = document.createElement("button"); b.type = "button"; b.className = "btn rep-btn"; b.textContent = "🚩 Report";
    b.onclick = e => { e.stopPropagation(); reportForm(m); }; acts.appendChild(b);
  }
  function reportForm(meme) {
    const m = modal(`<form class="mv-form"><p class="muted">Tell us what's wrong with “${esc(meme.title)}”.</p>
      <label>Reason <select name="reason" required><option value="">Choose…</option><option value="offensive">Offensive</option><option value="hateful">Hateful / slurs</option>
      <option value="sexual">Sexual content</option><option value="spam">Spam</option><option value="copyright">Copyright</option><option value="broken">Broken image / wrong info</option><option value="other">Other</option></select></label>
      <label>Details (optional) <textarea name="note" maxlength="500" rows="3"></textarea></label>
      <button class="btn primary" type="submit">Send report</button></form>`);
    m.querySelector("b").textContent = "🚩 Report this meme";
    const f = m.querySelector("form");
    f.onsubmit = async e => {
      e.preventDefault(); const btn = f.querySelector("[type=submit]"); btn.disabled = true;
      try {
        const r = await fetch(`${SB}/rest/v1/reports`, { method: "POST", headers: { ...H, "Content-Type": "application/json", Prefer: "return=minimal" },
          body: JSON.stringify({ meme_id: vidOf(meme), reason: f.reason.value, note: f.note.value.trim().slice(0, 500) || null }) });
        const t = r.ok ? "" : await r.text();
        if (!r.ok && !/already reported/.test(t)) throw new Error(/too many/.test(t) ? "Too many reports, try later" : "Couldn't send the report");
        closeModal(); toast("Thanks, we'll take a look 🚩");
      } catch (err) { btn.disabled = false; toast(err.message); }
    };
  }

  // ---------- Stats page (aggregates only)
  let statsP = null, statsT = 0;
  async function statsPage(tb) {
    tb.hidden = true; $("#sub").textContent = "What visitors view, share, caption and download most (all time)"; $("#empty").hidden = true; $("#grid").innerHTML = "";
    const p = document.createElement("section"); p.id = "listPanel"; p.className = "stats"; p.innerHTML = '<p class="muted">Loading stats…</p>';
    $("#grid").before(p);
    const kinds = [["view", "👀 Most viewed"], ["share", "↗ Most shared"], ["caption", "✏️ Most captioned"], ["download", "⬇️ Most downloaded"]];
    try {
      // one fetch per 20 s even when the page re-renders (sidebar/gallery loads trigger extra renders)
      if (!statsP || Date.now() - statsT > 20000) { statsT = Date.now(); statsP = Promise.all(kinds.map(([k]) => rpc("meme_stats", { p_kind: k, p_limit: 10 }).then(r => r.ok ? r.json() : []))); statsP.catch(() => { statsP = null; }); }
      const res = await statsP;
      if (state.list !== "stats") return;
      const byVid = new Map(memes.map(m => [vidOf(m), m]));
      p.innerHTML = kinds.map(([k, label], i) => {
        const rows = res[i].map(r => [byVid.get(r.meme_id), r.count]).filter(x => x[0] && (state.nsfw || !x[0].nsfw));
        return `<div class="stat-col"><h3>${label}</h3>${rows.length ? `<ol>${rows.map(([m, n]) => `<li><button type="button" data-id="${esc(m.id)}"><img loading="lazy" src="${m.thumb || m.image}" alt=""><span>${esc(m.title)}</span><b>${n}</b></button></li>`).join("")}</ol>` : '<p class="muted">No data yet.</p>'}</div>`;
      }).join("");
      p.querySelectorAll("button[data-id]").forEach(b => b.onclick = () => openById(b.dataset.id));
    } catch (e) { p.innerHTML = '<p class="muted">Stats are unavailable right now.</p>'; }
  }

  probe();
  window.MVCommunity = { features: F, track, flush, _gallery: () => gallery, loaded: () => settled };
})();
