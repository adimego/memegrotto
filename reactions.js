// MemeGrotto emoji reactions (😂 💀 🔥 😭 ❤️ 👎): shared counts in Supabase (public.reactions, written only through the
// react / unreact RPCs from supabase/features3.sql). One reaction per emoji per browser (localStorage "mv-reacted"),
// tap again to un-react, optimistic UI. Everything stays hidden until features3.sql has been run (mv_features3() probe).
(() => {
  const EMOJIS = ["😂", "💀", "🔥", "😭", "❤️", "👎"];
  const R = { ok: false }, counts = new Map();   // vid -> { emoji: n }
  const mine = new Set(JSON.parse(localStorage.getItem("mv-reacted") || "[]"));   // "vid|emoji"
  const saveMine = () => localStorage.setItem("mv-reacted", JSON.stringify([...mine]));
  const rpc = (fn, body = {}) => fetch(`${SB_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: { ...SB_H, "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
  const vidOf = m => (typeof vid === "function" ? vid(m) : m.id);
  const get = (id, e) => (counts.get(id) || {})[e] || 0;
  const set = (id, e, n) => { const o = counts.get(id) || {}; o[e] = Math.max(0, n); counts.set(id, o); };
  const busy = new Set();

  async function toggle(m, e) {
    const id = vidOf(m), k = id + "|" + e; if (!R.ok || busy.has(k)) return;
    const on = !mine.has(k); busy.add(k);
    on ? mine.add(k) : mine.delete(k); saveMine(); set(id, e, get(id, e) + (on ? 1 : -1)); paint(m);   // optimistic
    try {
      const r = await rpc(on ? "react" : "unreact", { p_meme_id: id, p_emoji: e });
      if (!r.ok) { const t = await r.text(); if (on && /already reacted/.test(t)) return; throw new Error(/too many|busy/.test(t) ? "Too many reactions, take a break" : "Reaction failed, try again later"); }
      const n = await r.json(); if (typeof n === "number") set(id, e, n);
    } catch (err) {
      on ? mine.delete(k) : mine.add(k); saveMine(); set(id, e, get(id, e) + (on ? -1 : 1));
      toast(err.message && !/abort|fetch/i.test(err.message) ? err.message : "Reaction failed, try again later");
    } finally { busy.delete(k); paint(m); }
  }

  // ---------- viewer row
  function lbRow(m) {
    let row = $("#lbReact");
    if (!row) { row = document.createElement("div"); row.id = "lbReact"; row.className = "reacts"; row.setAttribute("role", "group"); row.setAttribute("aria-label", "Reactions"); $(".lb-top").after(row); }
    if (!R.ok || !m) { row.hidden = true; return; }
    row.hidden = false; row.dataset.vid = vidOf(m);
    row.innerHTML = EMOJIS.map(e => `<button type="button" class="react" data-e="${e}"><span class="e">${e}</span><span class="n"></span></button>`).join("");
    row.querySelectorAll(".react").forEach(b => b.onclick = ev => { ev.stopPropagation(); toggle(m, b.dataset.e); });
    paint(m);
  }
  // ---------- compact summary on grid cards (top reactions with counts; nothing when there are none)
  function summary(id) {
    const o = counts.get(id) || {}, top = EMOJIS.filter(e => o[e] > 0).sort((a, b) => o[b] - o[a]).slice(0, 2);
    return top.map(e => `<span>${e}<b>${o[e]}</b></span>`).join("");
  }
  function cardSum(c, m) {
    if (!R.ok) return; const id = vidOf(m); let s = c.querySelector(".rsum");
    if (!s) { s = document.createElement("div"); s.className = "rsum"; s.dataset.vid = id; c.querySelector(".meta").appendChild(s); }
    s.innerHTML = summary(id); s.hidden = !s.innerHTML;
  }
  function paint(m) {
    const id = vidOf(m), row = $("#lbReact");
    if (row && row.dataset.vid === id) row.querySelectorAll(".react").forEach(b => {
      const e = b.dataset.e, n = get(id, e), on = mine.has(id + "|" + e);
      b.querySelector(".n").textContent = n || ""; b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on); b.title = on ? `You reacted ${e} (tap to undo)` : `React ${e}`;
    });
    document.querySelectorAll(`.rsum[data-vid="${CSS.escape(id)}"]`).forEach(s => { s.innerHTML = summary(id); s.hidden = !s.innerHTML; });
  }

  // ---------- hooks
  const _dc = Lib.decorateCard; Lib.decorateCard = function (c, m) { _dc(c, m); cardSum(c, m); };
  const _lb = Lib.lightbox; Lib.lightbox = function (m) { _lb(m); lbRow(m); };

  // ---------- "Most 😂" page (#list=reactions)
  Lib.lists.reactions = { label: () => "😂 Reactions", items: () => [], render: tb => page(tb) };
  let lbP = null, lbT = 0;
  async function page(tb) {
    tb.hidden = true; $("#sub").textContent = "Memes with the most of each reaction (all time)"; $("#empty").hidden = true; $("#grid").innerHTML = "";
    const p = document.createElement("section"); p.id = "listPanel"; p.className = "stats";
    if (!R.ok) { p.innerHTML = '<p class="muted">Reactions are coming soon.</p>'; $("#grid").before(p); return; }
    p.innerHTML = '<p class="muted">Loading…</p>'; $("#grid").before(p);
    try {
      if (!lbP || Date.now() - lbT > 20000) { lbT = Date.now(); lbP = Promise.all(EMOJIS.map(e => rpc("leaderboard_reactions", { p_emoji: e, p_limit: 10 }).then(r => r.ok ? r.json() : []))); lbP.catch(() => { lbP = null; }); }
      const res = await lbP; if (state.list !== "reactions") return;
      const byVid = new Map(memes.map(m => [vidOf(m), m]));
      p.innerHTML = EMOJIS.map((e, i) => {
        const rows = res[i].map(r => [byVid.get(r.meme_id), r.count]).filter(x => x[0] && (state.nsfw || !x[0].nsfw) && !(window.MVPlay && MVPlay.isHidden(x[0])));
        return `<div class="stat-col"><h3>Most ${e}</h3>${rows.length ? `<ol>${rows.map(([m, n]) => `<li><button type="button" data-id="${esc(m.id)}"><img loading="lazy" src="${m.thumb || m.image}" alt=""><span>${esc(m.title)}</span><b>${n}</b></button></li>`).join("")}</ol>` : '<p class="muted">No reactions yet.</p>'}</div>`;
      }).join("");
      p.querySelectorAll("button[data-id]").forEach(b => b.onclick = () => {
        const ids = [...b.closest("ol").querySelectorAll("button[data-id]")].map(x => x.dataset.id);
        typeof openList === "function" ? openList(ids, b.dataset.id) : openById(b.dataset.id);
      });
    } catch (e) { p.innerHTML = '<p class="muted">Reactions are unavailable right now.</p>'; }
  }
  function sidebarItem() {
    const box = $("#playBox"); if (!R.ok || !box || box.querySelector('[data-list="reactions"]')) return;
    const b = document.createElement("button"); b.type = "button"; b.dataset.list = "reactions";
    b.className = "cat" + (state.list === "reactions" ? " on" : ""); b.innerHTML = '<span class="ic">😂</span><span>Most reacted</span><span class="n"></span>';
    b.onclick = () => { Object.assign(state, { list: state.list === "reactions" ? null : "reactions", cat: null, tag: null, q: "", top: false, trend: false }); $("#q").value = ""; closeMenu(); update(); };
    box.appendChild(b);
  }
  const _bs = buildSidebar; buildSidebar = function () { _bs(); sidebarItem(); };

  // ---------- probe + load
  async function load() {
    for (let off = 0; ; off += 1000) {
      const r = await fetch(`${SB_URL}/rest/v1/reactions?select=meme_id,emoji,count&count=gt.0&order=meme_id,emoji&limit=1000&offset=${off}`, { headers: SB_H, signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error(r.status); const rows = await r.json();
      rows.forEach(x => set(x.meme_id, x.emoji, x.count)); if (rows.length < 1000) break;
    }
  }
  async function probe() {
    try { const r = await rpc("mv_features3"); if (!r.ok) return; const f = await r.json(); if (!f || !f.reactions) return; await load(); }
    catch (e) { return; }
    R.ok = true; document.body.classList.add("has-reactions");
    buildSidebar(); document.querySelectorAll("#grid .card").forEach(c => { const m = c._m; if (m) cardSum(c, m); });
    if (!$("#lb").hidden && lbCur()) lbRow(lbCur());
    if (state.list === "reactions") render();
  }
  const _dc2 = Lib.decorateCard; Lib.decorateCard = function (c, m) { c._m = m; _dc2(c, m); };
  probe();
  window.MVReactions = { state: R, counts, mine, EMOJIS, toggle };
})();
