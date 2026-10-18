// MemeVault extras: favorites & collections (localStorage), Meme of the Day, image-text search hints, "More like this".
(() => {
  const KEY = "mv-lib";
  const load = () => { try { const d = JSON.parse(localStorage.getItem(KEY)); if (d && Array.isArray(d.fav) && Array.isArray(d.cols)) return d; } catch (e) {} return { fav: [], cols: [] }; };
  let lib = load();
  const save = () => { localStorage.setItem(KEY, JSON.stringify(lib)); };
  window.addEventListener("storage", e => { if (e.key === KEY) { lib = load(); refresh(); } });
  const byId = id => memes.find(m => m.id === id);
  const col = id => lib.cols.find(c => c.id === id);
  const isFav = m => lib.fav.includes(m.id);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const clean = s => String(s || "").replace(/\s+/g, " ").trim().slice(0, 60);

  function refresh() { buildSidebar(); if (state.list) render(); paintHearts(); if (!$("#lb").hidden && view[idx]) lightbox(view[idx]); }
  function toggleFav(m) {
    const i = lib.fav.indexOf(m.id);
    if (i >= 0) lib.fav.splice(i, 1); else lib.fav.unshift(m.id);
    save(); toast(i >= 0 ? "Removed from favorites" : "Saved to favorites ❤️");
    buildSidebar(); paintHearts(); if (state.list === "fav") render();
  }
  function paintHearts() {
    document.querySelectorAll(".fav-btn[data-id]").forEach(b => {
      const on = lib.fav.includes(b.dataset.id); b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false"); b.title = on ? "Remove from favorites" : "Add to favorites";
      if (b.classList.contains("btn")) b.textContent = on ? "❤️ Saved" : "🤍 Save";
    });
  }
  function heart(m, big) {
    const b = document.createElement("button"); b.type = "button"; b.className = "fav-btn" + (big ? " btn" : ""); b.dataset.id = m.id;
    b.innerHTML = big ? "" : '<span aria-hidden="true">❤</span>'; b.setAttribute("aria-label", "Favorite " + m.title);
    b.onclick = e => { e.stopPropagation(); toggleFav(m); };
    return b;
  }
  function newCollection(firstId) {
    const name = clean(prompt("Name your collection:", "My collection"));
    if (!name) return null;
    const c = { id: uid(), name, items: firstId ? [firstId] : [] }; lib.cols.push(c); save(); buildSidebar();
    toast(firstId ? `Added to “${name}” 📁` : `Created “${name}” 📁`); return c;
  }

  // ---- collections popover (lightbox "📁 Collections")
  function colMenu(m, anchor) {
    closeColMenu();
    const menu = document.createElement("div"); menu.className = "col-menu"; menu.id = "colMenu"; menu.setAttribute("role", "dialog"); menu.setAttribute("aria-label", "Add to collection");
    menu.innerHTML = `<div class="sm-head"><b>Add to collection</b><button class="sm-x" aria-label="Close">✕</button></div>
      <div class="col-list">${lib.cols.length ? lib.cols.map(c => `<label><input type="checkbox" data-c="${c.id}" ${c.items.includes(m.id) ? "checked" : ""}> <span>${esc(c.name)}</span> <small>${c.items.length}</small></label>`).join("") : '<p class="muted">No collections yet.</p>'}</div>
      <button class="btn" data-a="new">＋ New collection</button>`;
    menu.querySelector(".sm-x").onclick = closeColMenu;
    menu.querySelectorAll("input[data-c]").forEach(cb => cb.onchange = () => {
      const c = col(cb.dataset.c); if (!c) return;
      if (cb.checked) { if (!c.items.includes(m.id)) c.items.unshift(m.id); } else c.items = c.items.filter(x => x !== m.id);
      save(); buildSidebar(); toast(cb.checked ? `Added to “${c.name}”` : `Removed from “${c.name}”`);
      cb.parentNode.querySelector("small").textContent = c.items.length; if (state.list === "c:" + c.id) render();
    });
    menu.querySelector('[data-a="new"]').onclick = () => { if (newCollection(m.id)) colMenu(m, anchor); };
    const bd = document.createElement("div"); bd.className = "share-backdrop"; bd.id = "colBackdrop"; bd.onclick = e => { e.stopPropagation(); closeColMenu(); };
    document.body.append(bd, menu);
    if (!isPhone() && anchor) {
      const r = anchor.getBoundingClientRect(), w = menu.offsetWidth, h = menu.offsetHeight;
      menu.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + "px";
      menu.style.top = (r.bottom + h + 8 < innerHeight ? r.bottom + 6 : Math.max(8, r.top - h - 6)) + "px";
    }
  }
  function closeColMenu() { $("#colMenu")?.remove(); $("#colBackdrop")?.remove(); }
  document.addEventListener("keydown", e => { if (e.key === "Escape" && $("#colMenu")) { e.stopImmediatePropagation(); closeColMenu(); } }, true);

  // ---- export / import
  function exportLib() {
    const data = { app: "MemeVault", version: 1, exported: new Date().toISOString(), favorites: lib.fav, collections: lib.cols };
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    a.download = `memevault-library-${new Date().toISOString().slice(0, 10)}.json`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000); toast("Library exported ⬇️");
  }
  function importLib() {
    const inp = document.createElement("input"); inp.type = "file"; inp.accept = "application/json,.json";
    inp.onchange = async () => {
      try {
        const d = JSON.parse(await inp.files[0].text()); const ok = id => typeof id === "string" && id.length < 200;
        const fav = (d.favorites || d.fav || []).filter(ok), cols = (d.collections || d.cols || []).filter(c => c && c.name && Array.isArray(c.items));
        let nf = 0, nc = 0;
        fav.forEach(id => { if (!lib.fav.includes(id)) { lib.fav.push(id); nf++; } });
        cols.slice(0, 200).forEach(c => {
          const ex = lib.cols.find(x => x.name === clean(c.name));
          if (ex) c.items.filter(ok).forEach(id => { if (!ex.items.includes(id)) ex.items.push(id); });
          else { lib.cols.push({ id: uid(), name: clean(c.name), items: [...new Set(c.items.filter(ok))].slice(0, 5000) }); nc++; }
        });
        save(); refresh(); toast(`Imported ${nf} favorite${nf === 1 ? "" : "s"} and ${nc} collection${nc === 1 ? "" : "s"} ⬆️`);
      } catch (e) { toast("That file isn't a MemeVault library export"); }
    };
    inp.click();
  }

  // ---- sidebar "My library"
  function go(list) { Object.assign(state, { list, cat: null, tag: null, top: false, trend: false }); closeMenu(); update(); }
  function sidebar() {
    let box = $("#mylib");
    if (!box) {
      box = document.createElement("div"); box.id = "mylib"; box.className = "mylib";
      const h = document.createElement("h3"); h.textContent = "My library";
      const spotH = [...document.querySelectorAll("#sidebar h3")].find(x => x.textContent === "Spotlight");
      spotH.before(h, box);
    }
    const n = id => lib.fav.filter(x => byId(x)).length;
    const item = (list, icon, name, count) => `<button type="button" class="cat${state.list === list ? " on" : ""}" data-list="${list}"><span class="ic">${icon}</span><span>${esc(name)}</span><span class="n">${count}</span></button>`;
    box.innerHTML = item("fav", "❤️", "My favorites", n()) +
      lib.cols.map(c => item("c:" + c.id, "📁", c.name, c.items.filter(x => byId(x)).length)).join("") +
      `<div class="mylib-tools"><button type="button" data-a="new">＋ New collection</button><button type="button" data-a="exp" title="Download favorites & collections as JSON">⬇ Export</button><button type="button" data-a="imp" title="Load a library export">⬆ Import</button></div>`;
    box.querySelectorAll("[data-list]").forEach(b => b.onclick = () => go(state.list === b.dataset.list ? null : b.dataset.list));
    box.querySelector('[data-a="new"]').onclick = () => { const c = newCollection(); if (c) go("c:" + c.id); };
    box.querySelector('[data-a="exp"]').onclick = exportLib;
    box.querySelector('[data-a="imp"]').onclick = importLib;
  }
  function label(list) {
    if (list === "fav") return "❤️ My favorites";
    const c = list.startsWith("c:") && col(list.slice(2)); return c ? "📁 " + c.name : "📁 Collection";
  }
  function items(list) {
    const ids = list === "fav" ? lib.fav : (col(list.slice(2)) || { items: [] }).items;
    return ids.map(byId).filter(Boolean);
  }

  // ---- after each grid render: collection toolbar, empty-state text, Meme of the Day, image-text hints
  function afterRender() {
    let tb = $("#listTools");
    if (!tb) { tb = document.createElement("div"); tb.id = "listTools"; tb.className = "list-tools"; $("#active").after(tb); }
    tb.innerHTML = ""; tb.hidden = !state.list;
    if (state.list) {
      const c = state.list.startsWith("c:") && col(state.list.slice(2));
      if (c) {
        tb.innerHTML = `<button class="btn" data-a="ren">✏️ Rename</button><button class="btn" data-a="del">🗑 Delete collection</button>`;
        tb.querySelector('[data-a="ren"]').onclick = () => { const nm = clean(prompt("Rename collection:", c.name)); if (nm) { c.name = nm; save(); buildSidebar(); render(); } };
        tb.querySelector('[data-a="del"]').onclick = () => { if (confirm(`Delete the collection “${c.name}”? The memes stay in the vault.`)) { lib.cols = lib.cols.filter(x => x !== c); save(); go(null); toast("Collection deleted"); } };
      } else if (state.list === "fav") tb.innerHTML = '<span class="muted">Tap ❤ on any meme to save it here. Favorites live in this browser; use Export in the sidebar to back them up.</span>';
      if (!view.length && !state.q) $("#empty").querySelector("p").firstChild.textContent = state.list === "fav" ? "No favorites yet. " : "This collection is empty. ";
    } else $("#empty").querySelector("p").firstChild.textContent = "No memes match that. ";
    motd();
    const terms = norm(state.q).split(/\s+/).filter(Boolean);
    if (terms.length) document.querySelectorAll("#grid .card").forEach(markText);
  }
  // cards whose match came only from the OCR'd image text get a small hint
  function markText(c) {
    const m = c._m, terms = norm(state.q).split(/\s+/).filter(Boolean);
    if (!m || !terms.length || c.querySelector(".badge.txt")) return;
    const meta = norm(m.title + " " + m.tags.join(" ") + " " + m.category + " " + (m.caption || ""));
    if (terms.some(t => !meta.includes(t)) && m.ocr) {
      const b = document.createElement("span"); b.className = "badge txt"; b.textContent = "🔤 text in image"; b.title = "Matched words written in the image";
      c.appendChild(b);
    }
  }
  function decorateCard(c, m) {
    c._m = m; const wrap = c.firstElementChild; wrap.classList.add("imgwrap"); wrap.appendChild(heart(m));
    paintOne(c); if (state.q) markText(c);
  }
  const paintOne = c => c.querySelectorAll(".fav-btn").forEach(b => { const on = lib.fav.includes(b.dataset.id); b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); b.title = on ? "Remove from favorites" : "Add to favorites"; });

  // ---- Meme of the Day: same pick for everyone on a given date (date-seeded), from top-voted + popular safe memes
  let votesSettled = false, motdPick = null;
  function hash(s) { let h = 2166136261; for (const ch of s) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
  function today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
  function pickMotd() {
    const day = today(), cached = JSON.parse(localStorage.getItem("mv-motd") || "null");
    if (cached && cached.day === day && byId(cached.id)) return byId(cached.id);
    const safe = memes.filter(m => !m.nsfw && !m.image.endsWith(".gif") && m.width >= 300);
    const pool = new Map();
    safe.filter(m => vcount(m) > 0).sort((a, b) => vcount(b) - vcount(a) || a.rank - b.rank).slice(0, 40).forEach(m => pool.set(m.id, m));
    safe.slice().sort((a, b) => a.rank - b.rank).slice(0, 160).forEach(m => pool.set(m.id, m));
    const arr = [...pool.values()].sort((a, b) => a.id < b.id ? -1 : 1);
    const m = arr[hash("motd:" + day) % arr.length];
    if (votesSettled) localStorage.setItem("mv-motd", JSON.stringify({ day, id: m.id }));
    return m;
  }
  function motd() {
    let el = $("#motd");
    if (!el) { el = document.createElement("section"); el.id = "motd"; el.className = "motd"; $("main").prepend(el); }
    if (!isHome() || !memes.length) { el.hidden = true; return; }
    const m = pickMotd(); el.hidden = false;
    if (motdPick === m.id && el.childElementCount) return; motdPick = m.id;
    const d = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
    el.innerHTML = `<button class="motd-img" type="button" aria-label="Open meme of the day"><img src="${m.thumb || m.image}" alt="${esc(m.title)}"></button>
      <div class="motd-body"><p class="motd-k">🌞 Meme of the Day · ${esc(d)}</p><h2>${esc(m.title)}</h2>
      <p class="motd-sub">${CAT_META[m.category]?.[0] || ""} ${esc(m.category)}${vcount(m) ? ` · ▲ ${vcount(m)}` : ""}</p>
      <div class="motd-actions"><button class="btn primary" data-a="open">View</button><button class="btn" data-edit="${esc(m.id)}" type="button">✏️ Caption it</button><button class="btn" data-a="share">↗ Share</button></div></div>`;
    el.querySelector(".motd-img").onclick = el.querySelector('[data-a="open"]').onclick = () => openById(m.id);
    el.querySelector('[data-a="share"]').onclick = e => share(m, e.currentTarget);
  }
  function votesReady() { votesSettled = true; motdPick = null; motd(); }

  // ---- lightbox: Save / Collections / More like this
  let SIM = null; fetch("similar.json").then(r => r.ok ? r.json() : null).then(d => { SIM = d; if (!$("#lb").hidden && view[idx]) moreLike(view[idx]); }).catch(() => {});
  function lightbox(m) {
    const acts = $("#lbActions") || $(".lb-actions");
    acts.querySelectorAll(".fav-btn,.col-btn").forEach(b => b.remove());
    const h = heart(m, true); const cb = document.createElement("button"); cb.type = "button"; cb.className = "btn col-btn"; cb.textContent = "📁 Collections";
    cb.onclick = e => { e.stopPropagation(); colMenu(m, cb); };
    acts.prepend(h, cb); paintHearts(); moreLike(m);
  }
  function hamming(a, b) { let d = 0; for (let i = 0; i < a.length; i += 8) { let x = parseInt(a.slice(i, i + 8), 16) ^ parseInt(b.slice(i, i + 8), 16); while (x) { x &= x - 1; d++; } } return d; }
  function similar(m, n = 8) {
    const tpl = m.blank_template || (m.template_id && !m.captioned ? m.image : null);
    const ph = SIM?.h?.[m.id], sc = [];
    for (const x of memes) {
      if (x === m || (x.nsfw && !state.nsfw)) continue;
      let s = 0;
      const xt = x.blank_template || (x.template_id && !x.captioned ? x.image : null);
      if (tpl && xt === tpl) s += 6;                                     // same template
      const sh = x.tags.filter(t => m.tags.includes(t) && !["reddit", "fresh", "template", "captioned", "classic", "kym", "blank template"].includes(t)).length;
      s += sh * 1.5; if (x.category === m.category) s += 1;
      if (ph && SIM.h[x.id]) { const d = hamming(ph, SIM.h[x.id]); if (d <= 10) s += (11 - d) * 0.6; }   // looks alike
      if (s >= 2.5) sc.push([s - x.rank / 1e5, x]);
    }
    return sc.sort((a, b) => b[0] - a[0]).slice(0, n).map(x => x[1]);
  }
  function moreLike(m) {
    let box = $("#lbMore");
    if (!box) { box = document.createElement("div"); box.id = "lbMore"; box.className = "lb-more"; $(".lb-info").appendChild(box); }
    const sims = similar(m);
    box.hidden = !sims.length;
    box.innerHTML = sims.length ? `<h3>More like this</h3><div class="lb-more-row">${sims.map(x => `<button type="button" data-id="${esc(x.id)}" title="${esc(x.title)}"><img loading="lazy" src="${x.thumb || x.image}" alt="${esc(x.title)}"></button>`).join("")}</div>` : "";
    box.querySelectorAll("button[data-id]").forEach(b => b.onclick = e => { e.stopPropagation(); openById(b.dataset.id); });
  }
  window.Lib = { sidebar, label, items, afterRender, decorateCard, lightbox, votesReady, similar, _lib: () => lib };
})();
