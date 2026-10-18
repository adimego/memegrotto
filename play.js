// MemeSpire: meme battles (#battle), leaderboards (#leaderboard) and site-wide hidden memes.
// Battles work without the database (picks just aren't saved); ratings, leaderboards and hidden memes need
// supabase/features2.sql, detected through the mv_features2() RPC.
(() => {
  const F2 = { ok: false }, hidden = new Set();
  const rpc = (fn, body = {}) => fetch(`${SB_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: { ...SB_H, "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  const vidOf = m => (typeof vid === "function" ? vid(m) : m.id);
  const isHidden = m => hidden.size > 0 && (hidden.has(m.id) || hidden.has(vidOf(m)));
  const byVid = () => new Map(memes.map(m => [vidOf(m), m]));
  const isVideo = m => !!m.video;

  // short aliases: #battle and #leaderboard
  const alias = () => { const h = location.hash; if (h === "#battle" || h === "#leaderboard") history.replaceState(null, "", "#list=" + h.slice(1)); };
  alias();
  addEventListener("hashchange", () => { const h = location.hash; if (h === "#battle" || h === "#leaderboard") { alias(); go(h.slice(1)); } });
  function go(list) { Object.assign(state, { list, cat: null, tag: null, q: "", top: false, trend: false }); $("#q").value = ""; closeMenu(); update(); }

  // ---------- sidebar "Play" block (above Categories, below Community)
  function sidebarBlock() {
    let box = $("#playBox");
    if (!box) {
      box = document.createElement("div"); box.id = "playBox"; box.className = "mylib";
      const h = document.createElement("h3"); h.textContent = "Play"; h.id = "playHead";
      const cat = [...document.querySelectorAll("#sidebar h3")].find(x => x.textContent === "Categories");
      (cat || $("#sidebar h3")).before(h, box);
    }
    const it = (list, ic, name) => `<button type="button" class="cat${state.list === list ? " on" : ""}" data-list="${list}"><span class="ic">${ic}</span><span>${name}</span><span class="n"></span></button>`;
    box.innerHTML = it("battle", "⚔️", "Meme battle") + (F2.ok ? it("leaderboard", "🏆", "Leaderboards") : "");
    box.querySelectorAll("[data-list]").forEach(b => b.onclick = () => go(state.list === b.dataset.list ? null : b.dataset.list));
  }
  const _bs = buildSidebar; buildSidebar = function () { _bs(); sidebarBlock(); };

  // ---------- battles
  let pair = null, picked = false, recent = [];
  function pool() {
    const v = memes.filter(m => (state.nsfw || !m.nsfw) && !isHidden(m) && (m.thumb || m.image));
    return v.length > 400 ? v.filter(m => m.community || m.rank < 900) : v;   // popular + community memes make better battles
  }
  function nextPair() {
    const p = pool(); if (p.length < 2) return null;
    for (let t = 0; t < 50; t++) {
      const a = p[Math.floor(Math.random() * p.length)], b = p[Math.floor(Math.random() * p.length)];
      if (a === b || recent.includes(a.id) || recent.includes(b.id)) continue;
      if (a.template_id && a.template_id === b.template_id) continue;
      recent = [...recent, a.id, b.id].slice(-20); return [a, b];
    }
    return [p[0], p[1]];
  }
  const media = m => isVideo(m)
    ? `<video src="${esc(m.video)}" poster="${esc(m.thumb || m.image)}" muted loop playsinline autoplay preload="metadata"></video>`
    : `<img src="${esc(m.image)}" alt="${esc(m.title)}" decoding="async">`;
  function battlePage(tb) {
    tb.innerHTML = `<span class="muted">Tap the funnier meme. ${F2.ok ? "Every pick updates the battle ratings." : "Battle ratings arrive once the database update is installed; for now picks aren't saved."}</span>`;
    $("#sub").textContent = state.nsfw ? "Two memes enter, one meme leaves" : "Two memes enter, one meme leaves (crude memes are skipped)";
    $("#empty").hidden = true; $("#grid").innerHTML = ""; $("#motd")?.remove();
    const p = document.createElement("section"); p.id = "listPanel"; p.className = "battle"; $("#grid").before(p);
    if (!pair || picked || pair.some(m => (!state.nsfw && m.nsfw) || isHidden(m))) { pair = nextPair(); picked = false; }
    drawBattle(p);
  }
  function drawBattle(p) {
    if (!pair) { p.innerHTML = '<p class="muted">Not enough memes for a battle.</p>'; return; }
    p.innerHTML = `<div class="bt-pair">${pair.map((m, i) => `<div class="bt-side" data-i="${i}">
        <button type="button" class="bt-pick" data-i="${i}" aria-label="Pick “${esc(m.title)}”"><div class="bt-media">${media(m)}</div></button>
        <div class="bt-meta"><b>${esc(m.title)}</b><span class="bt-res" aria-live="polite"></span></div>
        <button type="button" class="btn primary bt-btn" data-i="${i}">😂 This one</button></div>`).join('<div class="bt-vs" aria-hidden="true">VS</div>')}</div>
      <div class="bt-foot"><button type="button" class="btn" data-a="skip">↻ Skip pair</button><button type="button" class="btn primary" data-a="next" hidden>Next battle ▶</button>
      <span class="muted bt-count"></span></div>`;
    p.querySelectorAll(".bt-pick, .bt-btn").forEach(b => b.onclick = () => pick(+b.dataset.i, p));
    p.querySelector("[data-a=skip]").onclick = () => { pair = nextPair(); picked = false; drawBattle(p); };
    p.querySelector("[data-a=next]").onclick = () => { pair = nextPair(); picked = false; drawBattle(p); p.scrollIntoView({ block: "nearest" }); };
    const n = +sessionStorage.getItem("mv-battles") || 0; p.querySelector(".bt-count").textContent = n ? `${n} battle${n === 1 ? "" : "s"} judged this session` : "";
  }
  async function pick(i, p) {
    if (picked || !pair) return; picked = true;
    const w = pair[i], l = pair[1 - i], sides = p.querySelectorAll(".bt-side");
    sides[i].classList.add("win"); sides[1 - i].classList.add("lose");
    p.querySelectorAll(".bt-btn").forEach(b => b.disabled = true); p.querySelector("[data-a=skip]").hidden = true; p.querySelector("[data-a=next]").hidden = false;
    sessionStorage.setItem("mv-battles", (+sessionStorage.getItem("mv-battles") || 0) + 1);
    const res = sides[i].querySelector(".bt-res"), res2 = sides[1 - i].querySelector(".bt-res");
    res.textContent = "🏆 Your pick"; res2.textContent = "";
    if (!F2.battles) return;
    try {
      const r = await rpc("battle_vote", { p_winner: vidOf(w), p_loser: vidOf(l) });
      const d = await r.json();
      if (!r.ok) { res.textContent = /already judged/.test(d.message || "") ? "🏆 Your pick (already counted)" : /too many/.test(d.message || "") ? "🏆 Your pick (slow down a little!)" : "🏆 Your pick"; return; }
      const fmt = (x, won) => `${won ? "🏆 " : ""}Rating ${Math.round(x.rating)} · ${x.wins}W–${x.losses}L · ${Math.round(100 * x.wins / Math.max(1, x.wins + x.losses))}% wins`;
      res.textContent = fmt(d.winner, true); res2.textContent = fmt(d.loser, false);
    } catch (e) {}
  }
  addEventListener("keydown", e => {
    if (state.list !== "battle" || e.target.closest?.("input,textarea,select") || !$("#lb").hidden || document.querySelector(".mv-modal")) return;
    const p = $("#listPanel.battle"); if (!p) return;
    if (e.key === "ArrowLeft" || e.key === "1") pick(0, p); else if (e.key === "ArrowRight" || e.key === "2") pick(1, p);
    else if ((e.key === "Enter" || e.key === " ") && picked) { e.preventDefault(); p.querySelector("[data-a=next]").click(); }
  });

  // ---------- leaderboards
  let lbTab = "day";
  const lbCache = {};
  const fetchLb = (key, fn, body) => {
    const c = lbCache[key]; if (c && Date.now() - c.t < 30000) return c.p;
    const pr = rpc(fn, body).then(r => r.ok ? r.json() : []).catch(() => []); lbCache[key] = { t: Date.now(), p: pr }; return pr;
  };
  function lbPage(tb) {
    const tabs = [["day", "Today"], ["week", "This week"], ["all", "All time"], ["creators", "Creators"], ["battles", "Battles"]];
    tb.innerHTML = `<div class="lb-tabs" role="tablist">${tabs.map(([k, t]) => `<button type="button" role="tab" class="chip${lbTab === k ? " on" : ""}" aria-selected="${lbTab === k}" data-t="${k}">${t}</button>`).join("")}</div>`;
    tb.querySelectorAll("[data-t]").forEach(b => b.onclick = () => { lbTab = b.dataset.t; render(); });
    $("#sub").textContent = { day: "Most upvoted in the last 24 hours", week: "Most upvoted in the last 7 days", all: "Most upvoted of all time",
      creators: "Community creators by votes on their approved memes", battles: "Battle ratings (Elo), memes with at least 3 battles" }[lbTab];
    $("#empty").hidden = true; $("#grid").innerHTML = ""; $("#motd")?.remove();
    const p = document.createElement("section"); p.id = "listPanel"; p.className = "lboard"; p.innerHTML = '<p class="muted">Loading…</p>'; $("#grid").before(p);
    const tab = lbTab;
    const done = html => { if (state.list === "leaderboard" && lbTab === tab && p.isConnected) p.innerHTML = html || '<p class="muted">Nothing here yet. Go vote! ▲</p>'; bind(p); };
    // community clips have no poster image: show the clip's first frame instead of a broken <img>
    const thumbOf = m => !m.thumb && !m.image && m.video ? `<video src="${esc(m.video)}#t=0.1" muted playsinline preload="metadata" aria-hidden="true"></video>` : `<img loading="lazy" src="${esc(m.thumb || m.image)}" alt="">`;
    const row = (n, m, right, sub) => `<li><button type="button" data-id="${esc(m.id)}"><span class="rk">${n}</span>${thumbOf(m)}<span class="tt">${esc(m.title)}${sub ? `<small>${sub}</small>` : ""}</span><b>${right}</b></button></li>`;
    if (tab === "creators") {
      fetchLb("creators", "leaderboard_creators", { p_limit: 25 }).then(rows => done(rows.length ? `<ol class="lb-list">${rows.map((r, i) =>
        `<li><div class="lb-row"><span class="rk">${i + 1}</span><span class="tt">${esc(r.creator)}<small>${r.approved} approved meme${r.approved == 1 ? "" : "s"}</small></span><b>▲ ${r.votes}</b></div></li>`).join("")}</ol>` : ""));
    } else if (tab === "battles") {
      fetchLb("battles", "leaderboard_battles", { p_limit: 50, p_min_games: 3 }).then(rows => {
        const map = byVid(); const list = rows.map(r => [map.get(r.meme_id), r]).filter(([m]) => m && !isHidden(m) && (state.nsfw || !m.nsfw)).slice(0, 25);
        done(list.length ? `<ol class="lb-list">${list.map(([m, r], i) => row(i + 1, m, Math.round(r.rating), `${r.wins}W–${r.losses}L · ${Math.round(100 * (r.win_rate || 0))}% win rate`)).join("")}</ol>`
          : `<p class="muted">No memes with 3+ battles yet. <button type="button" class="btn" data-go="battle">⚔️ Start a battle</button></p>`);
      });
    } else {
      fetchLb("v" + tab, "leaderboard_votes", { p_period: tab, p_limit: 60 }).then(rows => {
        const map = byVid(); const list = rows.map(r => [map.get(r.meme_id), r.votes]).filter(([m]) => m && !isHidden(m) && (state.nsfw || !m.nsfw)).slice(0, 25);
        done(list.length ? `<ol class="lb-list">${list.map(([m, v], i) => row(i + 1, m, "▲ " + v, m.category)).join("")}</ol>` : "");
      });
    }
  }
  function bind(p) {
    p.querySelectorAll("button[data-id]").forEach(b => b.onclick = () => openById(b.dataset.id));
    p.querySelectorAll("[data-go]").forEach(b => b.onclick = () => go(b.dataset.go));
  }

  Lib.lists.battle = { label: () => "⚔️ Meme battle", items: () => [], render: tb => battlePage(tb) };
  Lib.lists.leaderboard = { label: () => "🏆 Leaderboards", items: () => [], render: tb => F2.ok ? lbPage(tb) : (tb.innerHTML = '<span class="muted">Leaderboards are coming soon.</span>', $("#empty").hidden = true) };

  // ---------- probe + hidden memes
  async function probe() {
    try {
      const r = await rpc("mv_features2"); if (!r.ok) return;
      Object.assign(F2, await r.json(), { ok: true });
    } catch (e) { return; }
    document.body.classList.add("has-features2");
    try {
      const h = await fetch(`${SB_URL}/rest/v1/hidden_memes?select=meme_id&limit=5000`, { headers: SB_H, signal: AbortSignal.timeout(10000) });
      if (h.ok) (await h.json()).forEach(x => hidden.add(x.meme_id));
    } catch (e) {}
    sidebarBlock();
    if (hidden.size || ["leaderboard", "battle"].includes(state.list)) render();
  }
  probe();
  window.MVPlay = { features: F2, hidden, isHidden, isVideo };
})();
