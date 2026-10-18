const CAT_META = {
  "Reaction": ["😮", "#e53170"], "Classic Templates": ["🖼️", "#7f5af0"], "Animals": ["🐶", "#2cb67d"],
  "Celebrities & Pop Culture": ["🌟", "#ff8906"], "Cartoons & Anime": ["📺", "#3da9fc"],
  "Work & School": ["💼", "#f25f4c"], "Gaming": ["🎮", "#16bfd6"], "Relatable Life": ["🛌", "#d4a017"],
  "Wholesome": ["💖", "#ff6fb5"], "Absurd & Surreal": ["🌀", "#9d4edd"],
  "Movies & TV": ["🎬", "#f72585"], "Tech & Science": ["🧪", "#4cc9f0"], "Sports": ["🏀", "#fb8500"],
  "Food": ["🍕", "#e9c46a"], "History & Politics": ["🏛️", "#8d99ae"],
};
const SPOTLIGHT = [
  { key: "harambe", label: "Harambe", sub: "Gone but not forgotten 🦍" },
  { key: "will smith", label: "Will Smith", sub: "Slaps, spaghetti & Fresh Prince" },
  { key: "sonic", label: "Sonic the Hedgehog", sub: "Gotta go fast 💨" },
  { key: "epstein", label: "Epstein didn't kill himself", sub: "Cameras off, guards asleep 📼" },
  { key: "spaghetti", label: "Spaghetti cinema", sub: "Somebody toucha my spaghet" },
  { key: "advice animal", label: "Advice animals", sub: "Old-school 2010s classics" },
  { key: "classic", label: "Meme canon", sub: "All-time classic templates & formats 🏛️" },
  { key: "reddit", label: "Fresh from Reddit", sub: "Top posts from meme subs" },
  { key: "programming", label: "Programmer humor", sub: "It works on my machine" },
  { key: "nsfw", label: "Crude & NSFW", sub: "Profanity & bad taste 🌶️" },
  { key: "blank template", label: "Blank templates", sub: "Clean, text-free version in the editor 🧼" },
  { key: "gif", label: "GIFs & Videos", sub: "Animated reactions ▶" },
];
const $ = s => document.querySelector(s);

// ---- Shared upvotes (Supabase; publishable key is public by design, writes only via the upvote RPC) ----
const SB_URL = "https://zvdhsibcwkvahfqglgvz.supabase.co";
const SB_KEY = "sb_publishable_t6UDizY_AOT9iTxrh9MxEQ_y4G46rG1";
const SB_H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };
const votes = new Map();            // vote id -> count
let votesOk = false;
const myVotes = new Set(JSON.parse(localStorage.getItem("mv-voted") || "[]"));
function djb2(s) { let h = 5381; for (const ch of s) h = ((h << 5) + h + ch.codePointAt(0)) >>> 0; return h.toString(36); }
const vid = m => m.id.length <= 64 ? m.id : m.id.slice(0, 55) + "~" + djb2(m.id);
const vcount = m => votes.get(vid(m)) || 0;
async function loadVotes() {
  try {
    for (let off = 0; ; off += 1000) {
      const r = await fetch(`${SB_URL}/rest/v1/votes?select=meme_id,count&order=meme_id&limit=1000&offset=${off}`,
                            { headers: SB_H, signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(r.status);
      const rows = await r.json();
      rows.forEach(x => { if (x.meme_id !== "__test__") votes.set(x.meme_id, x.count); });
      if (rows.length < 1000) break;
    }
    votesOk = true; document.body.classList.remove("no-votes");
  } catch (e) {
    console.warn("Votes unavailable:", e); votesOk = false; document.body.classList.add("no-votes");
  }
}
async function upvote(m, els) {
  const id = vid(m);
  if (!votesOk) return toast("Voting is offline right now");
  if (myVotes.has(id)) return toast("You already upvoted this one ✅");
  myVotes.add(id); localStorage.setItem("mv-voted", JSON.stringify([...myVotes]));
  votes.set(id, vcount(m) + 1); paintVotes(m);                       // optimistic
  try {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/upvote`, { method: "POST", headers: { ...SB_H, "Content-Type": "application/json" },
                                                         body: JSON.stringify({ p_meme_id: id }), signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(r.status);
    const n = await r.json(); if (typeof n === "number") votes.set(id, n);
    paintVotes(m); toast("Upvoted ▲");
  } catch (e) {
    myVotes.delete(id); localStorage.setItem("mv-voted", JSON.stringify([...myVotes]));
    votes.set(id, Math.max(0, vcount(m) - 1)); paintVotes(m); toast("Vote failed, try again later");
  }
}
function voteBtn(m) {
  const b = document.createElement("button");
  b.className = "vote" + (myVotes.has(vid(m)) ? " voted" : ""); b.dataset.vid = vid(m);
  b.title = myVotes.has(vid(m)) ? "You upvoted this" : "Upvote";
  b.innerHTML = `▲ <span>${vcount(m)}</span>`;
  b.onclick = e => { e.stopPropagation(); upvote(m); };
  return b;
}
function paintVotes(m) {
  document.querySelectorAll(`.vote[data-vid="${CSS.escape(vid(m))}"]`).forEach(b => {
    b.querySelector("span").textContent = vcount(m);
    b.classList.toggle("voted", myVotes.has(vid(m))); b.title = myVotes.has(vid(m)) ? "You upvoted this" : "Upvote";
  });
}
const state = { cat: null, tag: null, q: "", sort: "popular", top: false, trend: false, list: null, nsfw: localStorage.getItem("mv-nsfw") !== "0" };
let memes = [], view = [], idx = -1;

const norm = s => s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
const color = c => (CAT_META[c] || ["", "#7f5af0"])[1];

fetch("memes.json").then(r => r.json()).then(d => {
  memes = d.memes.map((m, i) => ({ ...m, tags: [...m.tags, ...(m.blank_template ? ["blank template"] : []), ...((m.video || /\.gif$/i.test(m.image)) && !m.tags.includes("gif") ? ["gif"] : [])], rank: i, hay: norm(m.title + " " + m.tags.join(" ") + " " + m.category + " " + (m.caption || "") + " " + (m.ocr || "") + (m.blank_template ? " blank template" : "")) }));
  $("#nsfw").checked = state.nsfw; readHash(); buildSidebar(); render();
  loadVotes().then(() => { if (votesOk) { buildSidebar(); if (state.sort === "popular" || state.top) render(); } window.Lib?.votesReady(); });
});

const visible = () => memes.filter(m => (state.nsfw || !m.nsfw) && (!m.community || state.list === "community") && !(window.MVPlay && MVPlay.isHidden(m)));

// ---- Trending: date-based. Fresh-source memes (Reddit / Imgflip captioned / KYM galleries) added in the last
// TREND_DAYS days, newest day first; within a day, round-robin across feeds by each feed's own popularity order.
const TREND_DAYS = 7, HOME_MIX = 24;
let hl = new Map();   // meme id -> "top" | "trend" badge on the home mix
function trendingList(pool) {
  const cutoff = new Date(Date.now() - TREND_DAYS * 864e5).toISOString().slice(0, 10), pos = {}, feedN = {};
  memes.forEach(m => { const f = m.feed || m.source; pos[m.id] = feedN[f] = (feedN[f] || 0) + 1; });
  return pool.filter(m => (m.date_added || "") >= cutoff && /^(reddit:|imgflip-tag:|kym-gallery:|epstein|gif:)/.test(m.feed || ""))
    .sort((a, b) => (b.date_added || "").localeCompare(a.date_added || "") || pos[a.id] - pos[b.id] || a.rank - b.rank);
}
function topVotedList(pool) { return pool.filter(m => vcount(m) > 0).sort((a, b) => vcount(b) - vcount(a) || a.rank - b.rank); }
function counts(list) { const c = {}; list.forEach(m => c[m.category] = (c[m.category] || 0) + 1); return c; }

function buildSidebar() {
  const pool = visible(), c = counts(pool), cats = $("#cats");
  cats.innerHTML = "";
  const mk = (name, n, icon) => {
    const b = document.createElement("button");
    b.className = "cat" + ((state.cat === name) ? " on" : "");
    b.innerHTML = `<span class="ic">${icon}</span><span>${name || "All memes"}</span><span class="n">${n}</span>`;
    b.onclick = () => { state.cat = name; state.tag = null; state.top = false; state.trend = false; state.list = null; closeMenu(); update(); };
    cats.appendChild(b);
  };
  mk(null, pool.length, "✨");
  Object.keys(CAT_META).filter(k => c[k]).sort((a, b) => c[b] - c[a]).forEach(k => mk(k, c[k], CAT_META[k][0]));

  const spot = $("#spot"); spot.innerHTML = "";
  {
    const tr = trendingList(pool);
    if (tr.length) {
      const b = document.createElement("button"); b.className = state.trend ? "on" : "";
      b.innerHTML = `<img src="${tr[0].thumb || tr[0].image}" alt=""><span>🔥 Trending <small>${tr.length} fresh memes · last ${TREND_DAYS} days</small></span>`;
      b.onclick = () => { state.trend = !state.trend; state.list = null; state.top = false; state.tag = null; state.cat = null; closeMenu(); update(); };
      spot.appendChild(b);
    }
  }
  if (votesOk) {
    const voted = pool.filter(m => vcount(m) > 0).sort((a, b) => vcount(b) - vcount(a));
    const b = document.createElement("button"); b.className = state.top ? "on" : "";
    b.innerHTML = `<span class="trophy">🏆</span><span>Top voted <small>${voted.length} memes with votes · community picks</small></span>`;
    if (voted[0]) b.querySelector(".trophy").outerHTML = `<img src="${voted[0].thumb || voted[0].image}" alt="">`;
    b.onclick = () => { state.top = !state.top; state.list = null; state.trend = false; state.tag = null; state.cat = null; closeMenu(); update(); };
    spot.appendChild(b);
  }
  SPOTLIGHT.forEach(s => {
    const hits = pool.filter(m => m.tags.includes(s.key));
    if (!hits.length) return;
    const b = document.createElement("button");
    b.className = state.tag === s.key ? "on" : "";
    b.innerHTML = `<img src="${hits[0].thumb || hits[0].image}" alt=""><span>${s.label} <small>${hits.length} memes · ${s.sub}</small></span>`;
    b.onclick = () => { state.tag = state.tag === s.key ? null : s.key; state.cat = null; state.top = false; state.trend = false; state.list = null; closeMenu(); update(); };
    spot.appendChild(b);
  });

  const tc = {}; pool.forEach(m => m.tags.forEach(t => tc[t] = (tc[t] || 0) + 1));
  const skip = new Set(Object.keys(CAT_META).map(k => k.split(" ")[0].toLowerCase()).concat(["template", "captioned", "nsfw", "reddit", "fresh", "blank template"]));
  $("#tagcloud").innerHTML = "";
  Object.entries(tc).filter(([t, n]) => n >= 3 && !skip.has(t)).sort((a, b) => b[1] - a[1]).slice(0, 26)
    .forEach(([t, n]) => $("#tagcloud").appendChild(tagEl(t, n)));
  window.Lib?.sidebar();
}

function tagEl(t, n) {
  const s = document.createElement("span");
  s.className = "tag" + (state.tag === t ? " on" : "");
  s.textContent = "#" + t + (n ? ` ${n}` : "");
  s.onclick = e => { e.stopPropagation(); state.tag = state.tag === t ? null : t; state.list = null; closeLb(); update(); };
  return s;
}

function filtered() {
  hl = new Map();
  const terms = norm(state.q).split(/\s+/).filter(Boolean);
  if (state.list && window.Lib) {
    const v = Lib.items(state.list).filter(m => (state.nsfw || !m.nsfw) && (!state.cat || m.category === state.cat) && (!state.tag || m.tags.includes(state.tag)) && terms.every(t => m.hay.includes(t)));
    return state.sort === "popular" ? v : sortBy(v);
  }
  if (state.trend) {
    const v = trendingList(visible()).filter(m => (!state.cat || m.category === state.cat) && (!state.tag || m.tags.includes(state.tag)) && terms.every(t => m.hay.includes(t)));
    return state.sort === "popular" ? v : sortBy(v);
  }
  let v = visible().filter(m => (!state.top || vcount(m) > 0) && (!state.cat || m.category === state.cat) && (!state.tag || m.tags.includes(state.tag))
    && terms.every(t => m.hay.includes(t)));
  if (state.sort === "popular" && !state.cat && !state.tag && !terms.length) {
    // interleave sources so the front page mixes classics, captioned memes and fresh posts
    const groups = {}; v.forEach(m => (groups[m.source.startsWith("Imgflip API") ? "a" : m.source.startsWith("Reddit") ? "c" : "b"] ??= []).push(m));
    const out = [], g = [groups.a || [], groups.b || [], groups.c || []];
    for (let i = 0; out.length < v.length; i++) g.forEach((arr, k) => { const per = [2, 1, 1][k]; for (let j = 0; j < per; j++) { const x = arr[i * per + j]; if (x) out.push(x); } });
    v = out;
  } else if (state.sort === "popular" && state.tag === "gif" && !state.cat && !terms.length) {
    // GIFs & Videos spotlight: round-robin Imgflip GIF templates / Tenor reactions / Reddit clips so every source shows up top
    const groups = {}; v.sort((a, b) => a.rank - b.rank).forEach(m => (groups[/^(gif:tenor)/.test(m.feed || "") ? "t" : m.source.startsWith("Reddit") ? "r" : "i"] ??= []).push(m));
    const g = [groups.i || [], groups.t || [], groups.r || []], out = [];
    for (let i = 0; out.length < v.length; i++) g.forEach(arr => { if (arr[i]) out.push(arr[i]); });
    v = out;
  } else if (state.sort === "popular") v.sort((a, b) => a.rank - b.rank);
  if (state.sort === "popular" && !state.top && !state.cat && !state.tag && !terms.length) {
    // Home page: alternate top-voted and trending memes (deduped), then the usual vote/popularity order
    const tv = topVotedList(v).slice(0, HOME_MIX), tr = trendingList(v).slice(0, HOME_MIX), head = [], seen = new Set();
    for (let i = 0; i < HOME_MIX; i++) [[tv[i], "top"], [tr[i], "trend"]].forEach(([m, k]) => {
      if (m && !seen.has(m.id)) { seen.add(m.id); head.push(m); hl.set(m.id, k); }
    });
    const rest = v.filter(m => !seen.has(m.id)).sort((a, b) => vcount(b) - vcount(a));
    return head.concat(rest);
  }
  if (state.sort === "popular" || state.top) {
    // votes first; ties keep the curated popularity order (Array.sort is stable)
    return v.sort((a, b) => vcount(b) - vcount(a));
  }
  return sortBy(v);
}
function sortBy(v) {
  if (state.sort === "az") v.sort((a, b) => a.title.localeCompare(b.title));
  else if (state.sort === "new") v.sort((a, b) => (b.date_added || "").localeCompare(a.date_added || "") || b.rank - a.rank);
  else if (state.sort === "shuffle") v.sort(() => Math.random() - .5);
  else v.sort((a, b) => a.rank - b.rank);
  return v;
}

function update() { writeHash(); buildSidebar(); render(); window.scrollTo({ top: 0, behavior: "smooth" }); }

const isHome = () => !state.list && !state.trend && !state.top && !state.cat && !state.tag && !state.q;
function render() {
  view = filtered();
  const grid = $("#grid"); grid.innerHTML = "";
  $("#heading").textContent = state.list && window.Lib ? Lib.label(state.list) : state.trend ? "🔥 Trending" : state.top ? "🏆 Top voted" : state.tag ? `#${state.tag}` : (state.cat || "All memes");
  const cats = Object.keys(counts(view)).length;
  $("#sub").textContent = `${view.length} meme${view.length === 1 ? "" : "s"}` + (cats > 1 ? ` across ${cats} categories` : "") + (state.q ? ` matching “${state.q}”` : "");
  const act = $("#active"); act.innerHTML = "";
  [["list", state.list && window.Lib && Lib.label(state.list)], ["trend", state.trend && "🔥 Trending"], ["top", state.top && "🏆 Top voted"], ["cat", state.cat], ["tag", state.tag && "#" + state.tag], ["q", state.q && `“${state.q}”`]].forEach(([k, v]) => {
    if (!v) return;
    const s = document.createElement("span"); s.innerHTML = `${v}<button aria-label="remove">✕</button>`;
    s.querySelector("button").onclick = () => { state[k] = k === "q" ? "" : (k === "top" || k === "trend") ? false : null; if (k === "q") $("#q").value = ""; update(); };
    act.appendChild(s);
  });
  $("#empty").hidden = view.length > 0;
  window.Lib?.afterRender();
  PAGE = isPhone() ? 16 : 60;
  const ncol = isPhone() ? (grid.clientWidth < 330 ? 1 : 2) : Math.max(1, Math.min(6, Math.floor((grid.clientWidth + 16) / 246)));
  cols = [...Array(ncol)].map(() => { const d = document.createElement("div"); d.className = "col"; grid.appendChild(d); return d; });
  hts = Array(ncol).fill(0); shown = 0;
  renderMore();
  lbRebase();
}

// Incremental rendering: cards are appended in pages of PAGE as the user scrolls (keeps 1000+ items fast)
const isPhone = () => window.matchMedia("(max-width: 640px)").matches;
let PAGE = isPhone() ? 16 : 60;
let cols = [], hts = [], shown = 0;
const sentinel = document.createElement("div"); sentinel.id = "sentinel";
const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) renderMore(); }, { rootMargin: "1200px 0px" });
function renderMore() {
  if (shown >= view.length) { $("#more").hidden = true; return; }
  const end = Math.min(view.length, shown + PAGE);
  view.slice(shown, end).forEach((m, off) => {
    const i = shown + off;
    const c = document.createElement("article"); c.className = "card";
    c.style.animationDelay = Math.min((i % PAGE) * 15, 400) + "ms";
    const ratio = m.width && m.height ? `aspect-ratio:${m.width}/${m.height}` : "min-height:180px";
    c.innerHTML = `<div class="ph" style="${ratio}">${!m.thumb && !m.image && m.video ? `<video class="clip on poster" muted playsinline loop preload="metadata" src="${esc(m.video)}#t=0.1"></video><img hidden alt="">` : `<img ${i < 4 ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" alt="${esc(m.title)}" src="${m.thumb || m.image}">`}${m.video || /\.gif$/i.test(m.image) ? (m.audio ? '<span class="anim-badge" aria-label="Video with sound">▶ 🔊</span>' : '<span class="anim-badge" aria-label="Animated">▶ GIF</span>') : ""}</div>
      ${hl.get(m.id) === "top" ? '<span class="badge hl top">🏆 Top</span>' : hl.get(m.id) === "trend" ? '<span class="badge hl trend">🔥 Trending</span>'
        : m.source.startsWith("Reddit") ? `<span class="badge">${esc(m.source.replace("Reddit ", ""))}</span>` : ""}
      ${m.nsfw ? '<span class="badge nsfw">🌶️ NSFW</span>' : ""}
      <div class="meta"><h4>${esc(m.title)}</h4><div class="row"><span class="pill" style="--c:${color(m.category)}">${CAT_META[m.category]?.[0] || ""} ${m.category}</span>
      <span class="src">${esc(m.source.split(" ")[0] === "Know" ? "KYM" : m.source.split(" ")[0])}</span></div></div>`;
    c.querySelector(".row").insertBefore(voteBtn(m), c.querySelector(".src"));
    const sb = document.createElement("button"); sb.className = "share"; sb.title = "Share"; sb.setAttribute("aria-label", "Share " + m.title);
    sb.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M18 16a3 3 0 0 0-2.2 1l-7-4a3 3 0 0 0 0-2l7-4A3 3 0 1 0 15 5l-7 4a3 3 0 1 0 0 6l7 4a3 3 0 1 0 3-3z"/></svg>';
    sb.onclick = e => { e.stopPropagation(); share(m, sb); };
    c.querySelector(".row").insertBefore(sb, c.querySelector(".src"));
    const eb = document.createElement("button"); eb.className = "share edit"; eb.title = "Make your own caption"; eb.setAttribute("aria-label", "Caption " + m.title);
    eb.textContent = "✏️"; eb.dataset.edit = m.id; eb.type = "button";   // click handled by editor.js (delegated)
    c.querySelector(".row").insertBefore(eb, c.querySelector(".src"));
    if (window.Lib) Lib.decorateCard(c, m);
    const img = c.querySelector("img");
    img.onload = () => { img.classList.add("ld"); img.parentNode.classList.remove("ph"); };
    c.onclick = () => openLb(i);
    if (m.video) clipCard(c, m);
    const k = hts.indexOf(Math.min(...hts));
    cols[k].appendChild(c); hts[k] += (m.height && m.width ? m.height / m.width : 1) + 0.35;
  });
  shown = end;
  const more = $("#more"); more.hidden = shown >= view.length;
  more.textContent = `Showing ${shown} of ${view.length} · loading more…`;
  if (!sentinel.isConnected) { $("main").appendChild(sentinel); io.observe(sentinel); }
}

// Animated cards: a static poster in the grid; the clip plays muted on hover (mouse) or while on screen (touch)
const hoverable = matchMedia("(hover: hover) and (pointer: fine)").matches;
const clipIO = "IntersectionObserver" in window ? new IntersectionObserver(es => es.forEach(e => {
  const c = e.target; if (e.isIntersecting && e.intersectionRatio >= 0.6) playClip(c); else stopClip(c);
}), { threshold: [0, 0.6] }) : null;
function clipCard(c, m) {
  c.classList.add("has-clip"); c._clip = m;
  if (hoverable) { c.addEventListener("mouseenter", () => playClip(c)); c.addEventListener("mouseleave", () => stopClip(c)); }
  else clipIO?.observe(c);
}
function playClip(c) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  let v = c.querySelector("video.clip");
  if (!v) {
    const wrap = c.querySelector("img").parentNode; v = document.createElement("video"); v.className = "clip";
    Object.assign(v, { muted: true, loop: true, playsInline: true, preload: "auto" }); v.setAttribute("muted", ""); v.setAttribute("playsinline", "");
    if (c._clip.thumb) v.poster = c._clip.thumb; v.src = c._clip.video; wrap.appendChild(v);
  }
  if (!hoverable) document.querySelectorAll("video.clip.on").forEach(o => { if (o !== v && document.querySelectorAll("video.clip.on").length >= 2) stopClip(o.closest(".card")); });
  v.classList.add("on"); v.play().catch(() => {});
}
function stopClip(c) { const v = c && c.querySelector("video.clip"); if (v) { v.pause(); v.classList.remove("on"); } }

function esc(s) { return s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

// The viewer walks a snapshot of the list it was opened from (lbList, by position idx) rather than the live `view`, so a
// re-render while it is open (votes, the community gallery or similar.json finishing loading, a vote re-sorting the grid,
// a resize) can't shift prev/next under it. Before the first hop the snapshot is re-based onto the freshly rendered order
// (so next/prev match the grid behind it); after a hop it stays frozen until the viewer closes, so prev always returns.
let lbList = [], lbHopped = false;
const lbCur = () => lbList[idx] || null;
const lbSkip = m => !m || (!state.nsfw && m.nsfw) || !!(window.MVPlay && MVPlay.isHidden(m));
function lbStep(d) {
  const n = lbList.length; if (!n || $("#lb").hidden) return;
  for (let k = 1; k <= n; k++) { const j = (((idx + d * k) % n) + n) % n; if (!lbSkip(lbList[j])) { lbHopped = true; return openLb(j, true); } }
}
function lbRebase() {   // called after each render while the viewer is open
  if ($("#lb").hidden || lbHopped || !lbCur()) return;
  const id = lbCur().id, j = view.findIndex(m => m.id === id); if (j >= 0) { lbList = view.slice(); idx = j; }
}
// openLb(i): open view[i] (grid card, deep link, "more like this") and snapshot the current list; openLb(i, true): step within the snapshot
function openLb(i, step) {
  if (!step) { if (!view.length) return; lbList = view.slice(); lbHopped = false; i = ((i % view.length) + view.length) % view.length; }
  idx = i; const m = lbList[idx]; if (!m) return;
  resetLbMedia();
  const gi = view.indexOf(m); while (gi >= 0 && shown <= gi && shown < view.length) renderMore();
  const lv0 = $("#lbVid");
  if (m.video) { $("#lbImg").hidden = true; $("#lbImg").removeAttribute("src"); lv0.hidden = false; lv0.poster = m.image; lv0.muted = true; lv0.src = m.video; lv0.play().catch(() => {}); }
  else { lv0.pause(); lv0.removeAttribute("src"); lv0.load(); lv0.hidden = true; $("#lbImg").hidden = false; $("#lbImg").src = m.image; $("#lbImg").alt = m.title; }
  $("#lbTitle").textContent = m.title;
  const cat = $("#lbCat"); cat.textContent = `${CAT_META[m.category]?.[0] || ""} ${m.category}`; cat.style.setProperty("--c", color(m.category));
  const tags = $("#lbTags"); tags.innerHTML = ""; m.tags.forEach(t => tags.appendChild(tagEl(t)));
  $("#lbSource").innerHTML = `<a href="${m.source_url}" target="_blank" rel="noopener">${esc(m.source)}</a>`;
  $("#lbAttr").textContent = m.attribution || "—";
  $("#lbCaption").textContent = m.caption ? `“${m.caption}”` : "";
  $("#lbDate").textContent = m.date_added || "—";
  $("#lbSize").textContent = (m.width ? `${m.width} × ${m.height}px` : "—") + (m.duration ? ` · ${m.duration}s clip` : "");
  $("#lbOpen").href = m.source_url; $("#lbDl").href = m.video || m.image;
  const lv = $("#lbVote"); lv.innerHTML = ""; const vb = voteBtn(m); vb.classList.add("big"); lv.appendChild(vb);
  $("#lb").hidden = false; document.body.style.overflow = "hidden";
  lbId = m.id; history.replaceState(null, "", "#m=" + encodeURIComponent(m.id));
  prefetchBlob(m);
  window.Lib?.lightbox(m);
}
let lbId = null;
function resetLbMedia() { $("#lbImg").style.transform = ""; $("#lbVid").style.transform = ""; }
function closeLb() { if (!$("#lb").hidden) { lbId = null; writeHash(); } closeShare(); $("#lbVid").pause(); $("#lb").hidden = true; document.body.style.overflow = ""; resetLbMedia(); lbList = []; lbHopped = false; idx = -1; }
let rz, lastW = innerWidth;
window.addEventListener("resize", () => {   // ignore height-only changes (mobile URL bar show/hide)
  if (innerWidth === lastW) return; lastW = innerWidth; clearTimeout(rz); rz = setTimeout(render, 150);
});
// Lightbox touch gestures: swipe left/right = next/prev, swipe down or tap the dark area = close
(() => {
  const area = $(".lb-img"); let x0 = null, y0 = 0, t0 = 0;
  area.addEventListener("touchstart", e => { if (e.touches.length !== 1) return x0 = null; x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now(); }, { passive: true });
  const media = () => $("#lbImg").hidden ? $("#lbVid") : $("#lbImg");   // whichever one is showing
  area.addEventListener("touchmove", e => {
    if (x0 === null) return; const dx = e.touches[0].clientX - x0, dy = e.touches[0].clientY - y0;
    media().style.transform = Math.abs(dx) > Math.abs(dy) ? `translateX(${dx}px)` : dy > 0 ? `translateY(${dy}px)` : "";
  }, { passive: true });
  area.addEventListener("touchcancel", () => { x0 = null; resetLbMedia(); }, { passive: true });
  area.addEventListener("touchend", e => {
    if (x0 === null) return; const t = e.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0; x0 = null;
    resetLbMedia();
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.2) lbStep(dx < 0 ? 1 : -1);
    else if (dy > 80 && dy > Math.abs(dx)) closeLb();
    else if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && Date.now() - t0 < 300 && e.target === area) closeLb();
  });
  area.addEventListener("click", e => { if (e.target === area) closeLb(); });
})();
$("#lbClose").onclick = closeLb;
$("#lbPrev").onclick = () => lbStep(-1);
$("#lbNext").onclick = () => lbStep(1);
$("#lb").onclick = e => { if (e.target.id === "lb") closeLb(); };
$("#lbShare").onclick = e => { e.stopPropagation(); share(lbCur(), e.currentTarget); };

// ---- Sharing: Web Share API on phones/tablets (with the image file when supported), share menu elsewhere ----
const blobCache = new Map();
function prefetchBlob(m) {
  if (blobCache.has(m.id) || !navigator.canShare) return;
  const p = fetch(m.image).then(r => r.ok ? r.blob() : null).catch(() => null);
  blobCache.set(m.id, p); p.then(b => blobCache.set(m.id, b));
}
const touchy = () => matchMedia("(pointer: coarse)").matches;
async function share(m, anchor) {
  const url = deepLink(m), title = m.title + " · MemeGrotto";
  if (navigator.share && touchy()) {
    const b = blobCache.get(m.id);
    const data = { title, text: m.title, url };
    if (b instanceof Blob) {
      const f = new File([b], m.image.split("/").pop(), { type: b.type || "image/jpeg" });
      if (navigator.canShare && navigator.canShare({ files: [f] })) data.files = [f];
    } else prefetchBlob(m);
    try { await navigator.share(data); return; }
    catch (e) { if (e.name === "AbortError") return; if (data.files) { try { delete data.files; await navigator.share(data); return; } catch (e2) { if (e2.name === "AbortError") return; } } }
  }
  openShare(m, anchor);
}
function copyText(s) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(s);
  const ta = document.createElement("textarea"); ta.value = s; ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select(); const ok = document.execCommand("copy"); ta.remove();
  return ok ? Promise.resolve() : Promise.reject();
}
function pngBlob(src) {
  return fetch(src).then(r => r.blob()).then(b => b.type === "image/png" ? b : createImageBitmap(b).then(bm => {
    const c = document.createElement("canvas"); c.width = bm.width; c.height = bm.height; c.getContext("2d").drawImage(bm, 0, 0);
    return new Promise(res => c.toBlob(res, "image/png"));
  }));
}
function openShare(m, anchor) {
  const menu = $("#shareMenu"), url = deepLink(m), u = encodeURIComponent(url), t = encodeURIComponent(m.title);
  const nets = [["𝕏", "X / Twitter", `https://twitter.com/intent/tweet?text=${t}&url=${u}`], ["👽", "Reddit", `https://www.reddit.com/submit?url=${u}&title=${t}`],
    ["📘", "Facebook", `https://www.facebook.com/sharer/sharer.php?u=${u}`], ["💬", "WhatsApp", `https://wa.me/?text=${t}%20${u}`],
    ["✈️", "Telegram", `https://t.me/share/url?url=${u}&text=${t}`]];
  menu.innerHTML = `<div class="sm-head"><b>Share meme</b><button class="sm-x" aria-label="Close share menu">✕</button></div>
    <div class="sm-url"><input readonly value="${esc(url)}" aria-label="Meme link"></div>
    <button data-a="link">🔗 Copy link</button>
    ${navigator.clipboard?.write && window.ClipboardItem ? '<button data-a="img">🖼️ Copy image</button>' : ""}
    <a data-a="dl" href="${m.image}" download>⬇️ Download</a>
    ${navigator.share ? '<button data-a="native">📲 More apps…</button>' : ""}
    <div class="sm-nets">${nets.map(([i, n, h]) => `<a href="${h}" target="_blank" rel="noopener" title="Share to ${n}"><span>${i}</span>${n}</a>`).join("")}</div>`;
  menu.querySelector(".sm-x").onclick = closeShare;
  menu.querySelector('[data-a="link"]').onclick = () => copyText(url).then(() => { toast("Link copied 🔗"); closeShare(); }, () => toast(url));
  const ib = menu.querySelector('[data-a="img"]');
  if (ib) ib.onclick = () => navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob(m.image) })])
    .then(() => { toast("Image copied 🖼️"); closeShare(); }, () => toast("Couldn't copy the image here, try Download"));
  const nb = menu.querySelector('[data-a="native"]');
  if (nb) nb.onclick = () => navigator.share({ title: m.title, url }).catch(() => {});
  menu.querySelectorAll(".sm-nets a, [data-a=dl]").forEach(a => a.addEventListener("click", () => setTimeout(closeShare, 50)));
  menu.hidden = false; $("#shareBackdrop").hidden = false;
  if (!isPhone() && anchor) {   // desktop: popover next to the button, kept on screen
    const r = anchor.getBoundingClientRect(), w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + "px";
    menu.style.top = (r.bottom + h + 8 < innerHeight ? r.bottom + 6 : Math.max(8, r.top - h - 6)) + "px";
  } else { menu.style.left = ""; menu.style.top = ""; }
  menu.querySelector('[data-a="link"]').focus({ preventScroll: true });
}
function closeShare() { $("#shareMenu").hidden = true; $("#shareBackdrop").hidden = true; }
$("#shareBackdrop").onclick = e => { e.stopPropagation(); closeShare(); };
function toast(t) { const el = $("#toast"); el.textContent = t; el.classList.add("show"); setTimeout(() => el.classList.remove("show"), 1800); }

document.addEventListener("keydown", e => {
  if (e.key === "Escape" && !$("#shareMenu").hidden) return closeShare();
  if (!$("#lb").hidden) {
    if (e.key === "Escape") closeLb(); if (e.key === "ArrowLeft") lbStep(-1); if (e.key === "ArrowRight") lbStep(1);
  } else if (e.key === "Escape" && $("#sidebar").classList.contains("open")) closeMenu();
  else if (e.key === "/" && document.activeElement !== $("#q")) { e.preventDefault(); $("#q").focus(); }
});
let t; $("#q").addEventListener("input", e => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value.trim(); writeHash(); render(); }, 120); });
$("#nsfw").onchange = e => {
  state.nsfw = e.target.checked; localStorage.setItem("mv-nsfw", state.nsfw ? "1" : "0");
  if (!state.nsfw && state.tag === "nsfw") state.tag = null;
  update(); toast(state.nsfw ? "Crude memes shown 🌶️" : "Crude memes hidden 😇");
};
$("#sort").onchange = e => { state.sort = e.target.value; render(); };
// Phones: shorter sort labels so the whole label fits in the header (full labels stay on wider screens)
(() => {
  const mq = matchMedia("(max-width: 640px)");
  const apply = () => document.querySelectorAll("#sort option").forEach(o => { o.dataset.full ??= o.textContent; o.textContent = mq.matches && o.dataset.short ? o.dataset.short : o.dataset.full; });
  apply(); mq.addEventListener?.("change", apply);
})();
$("#reset").onclick = () => { Object.assign(state, { cat: null, tag: null, q: "", top: false, trend: false, list: null }); $("#q").value = ""; update(); };
function openMenu() {
  $("#sidebar").classList.add("open"); $("#backdrop").hidden = false; document.body.classList.add("menu-open");
  $("#menuBtn").setAttribute("aria-expanded", "true");
}
function closeMenu() {
  $("#sidebar").classList.remove("open"); $("#backdrop").hidden = true; document.body.classList.remove("menu-open");
  $("#menuBtn").setAttribute("aria-expanded", "false");
}
$("#menuBtn").onclick = () => $("#sidebar").classList.contains("open") ? closeMenu() : openMenu();
$("#sbClose").onclick = closeMenu; $("#backdrop").onclick = closeMenu;
// swipe the open sidebar left to close it; swipe right from the left screen edge to open it
(() => {
  let sx = null, sy = 0, fromEdge = false;
  document.addEventListener("touchstart", e => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; fromEdge = sx < 24; }, { passive: true });
  document.addEventListener("touchend", e => {
    if (sx === null || !$("#lb").hidden) return; const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy; sx = null;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const open = $("#sidebar").classList.contains("open");
    if (open && dx < 0) closeMenu(); else if (!open && fromEdge && dx > 0 && matchMedia("(max-width: 900px)").matches) openMenu();
  }, { passive: true });
})();

function writeHash() {
  const p = new URLSearchParams(); if (state.list) p.set("list", state.list); if (state.top) p.set("top", "1"); if (state.trend) p.set("trending", "1"); if (state.cat) p.set("cat", state.cat); if (state.tag) p.set("tag", state.tag); if (state.q) p.set("q", state.q);
  history.replaceState(null, "", p.toString() ? "#" + p : location.pathname);
}
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  state.list = p.get("list"); state.top = p.get("top") === "1"; state.trend = p.get("trending") === "1"; state.cat = p.get("cat"); state.tag = p.get("tag"); state.q = p.get("q") || ""; $("#q").value = state.q;
  const mid = p.get("m") || p.get("open");
  if (mid) setTimeout(() => openById(mid), 0);
}
// Panels that aren't the card grid (leaderboards, stats): open a meme and walk that panel's own ranked list with prev/next
function openList(ids, id) {
  const list = ids.map(x => memes.find(m => m.id === x)).filter(Boolean), i = list.findIndex(m => m.id === id);
  if (i < 0) return openById(id);
  lbList = list; lbHopped = false; openLb(i, true);
}
// Deep links: #m=<meme id> opens that meme's lightbox (filters are cleared if it isn't in the current view)
function openById(id) {
  let i = view.findIndex(m => m.id === id);
  if (i < 0) {
    const m = memes.find(x => x.id === id);
    if (!m) { if (id.startsWith("sub-") && window.MVCommunity && !MVCommunity.loaded()) return; return toast("That meme isn't on MemeGrotto anymore 🤷"); }
    Object.assign(state, { cat: null, tag: null, q: "", top: false, trend: false, list: m.community ? "community" : null }); $("#q").value = "";
    if (m.nsfw && !state.nsfw) { state.nsfw = true; $("#nsfw").checked = true; }
    buildSidebar(); render(); i = view.findIndex(x => x.id === id);
  }
  if (i >= 0) openLb(i);
}
window.addEventListener("hashchange", () => { const id = new URLSearchParams(location.hash.slice(1)).get("m"); if (id && (lbId !== id)) openById(id); });
const deepLink = m => location.origin + location.pathname + "#m=" + encodeURIComponent(m.id);
