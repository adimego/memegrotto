const CAT_META = {
  "Reaction": ["😮", "#e53170"], "Classic Templates": ["🖼️", "#7f5af0"], "Animals": ["🐶", "#2cb67d"],
  "Celebrities & Pop Culture": ["🌟", "#ff8906"], "Cartoons & Anime": ["📺", "#3da9fc"],
  "Work & School": ["💼", "#f25f4c"], "Gaming": ["🎮", "#16bfd6"], "Relatable Life": ["🛌", "#d4a017"],
  "Wholesome": ["💖", "#ff6fb5"], "Absurd & Surreal": ["🌀", "#9d4edd"],
};
const SPOTLIGHT = [
  { key: "harambe", label: "Harambe", sub: "Gone but not forgotten 🦍" },
  { key: "will smith", label: "Will Smith", sub: "Slaps, spaghetti & Fresh Prince" },
  { key: "spaghetti", label: "Spaghetti cinema", sub: "Somebody toucha my spaghet" },
  { key: "advice animal", label: "Advice animals", sub: "Old-school 2010s classics" },
  { key: "reddit", label: "Fresh from Reddit", sub: "Top posts from meme subs" },
  { key: "programming", label: "Programmer humor", sub: "It works on my machine" },
  { key: "nsfw", label: "Crude & NSFW", sub: "Profanity & bad taste 🌶️" },
];
const $ = s => document.querySelector(s);
const state = { cat: null, tag: null, q: "", sort: "popular", nsfw: localStorage.getItem("mv-nsfw") !== "0" };
let memes = [], view = [], idx = -1;

const norm = s => s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
const color = c => (CAT_META[c] || ["", "#7f5af0"])[1];

fetch("memes.json").then(r => r.json()).then(d => {
  memes = d.memes.map((m, i) => ({ ...m, rank: i, hay: norm(m.title + " " + m.tags.join(" ") + " " + m.category + " " + (m.caption || "")) }));
  $("#nsfw").checked = state.nsfw; readHash(); buildSidebar(); render();
});

const visible = () => memes.filter(m => state.nsfw || !m.nsfw);
function counts(list) { const c = {}; list.forEach(m => c[m.category] = (c[m.category] || 0) + 1); return c; }

function buildSidebar() {
  const pool = visible(), c = counts(pool), cats = $("#cats");
  cats.innerHTML = "";
  const mk = (name, n, icon) => {
    const b = document.createElement("button");
    b.className = "cat" + ((state.cat === name) ? " on" : "");
    b.innerHTML = `<span class="ic">${icon}</span><span>${name || "All memes"}</span><span class="n">${n}</span>`;
    b.onclick = () => { state.cat = name; state.tag = null; closeMenu(); update(); };
    cats.appendChild(b);
  };
  mk(null, pool.length, "✨");
  Object.keys(CAT_META).filter(k => c[k]).sort((a, b) => c[b] - c[a]).forEach(k => mk(k, c[k], CAT_META[k][0]));

  const spot = $("#spot"); spot.innerHTML = "";
  SPOTLIGHT.forEach(s => {
    const hits = pool.filter(m => m.tags.includes(s.key));
    if (!hits.length) return;
    const b = document.createElement("button");
    b.className = state.tag === s.key ? "on" : "";
    b.innerHTML = `<img src="${hits[0].thumb || hits[0].image}" alt=""><span>${s.label} <small>${hits.length} memes · ${s.sub}</small></span>`;
    b.onclick = () => { state.tag = state.tag === s.key ? null : s.key; state.cat = null; closeMenu(); update(); };
    spot.appendChild(b);
  });

  const tc = {}; pool.forEach(m => m.tags.forEach(t => tc[t] = (tc[t] || 0) + 1));
  const skip = new Set(Object.keys(CAT_META).map(k => k.split(" ")[0].toLowerCase()).concat(["template", "captioned", "nsfw", "reddit", "fresh"]));
  $("#tagcloud").innerHTML = "";
  Object.entries(tc).filter(([t, n]) => n >= 3 && !skip.has(t)).sort((a, b) => b[1] - a[1]).slice(0, 26)
    .forEach(([t, n]) => $("#tagcloud").appendChild(tagEl(t, n)));
}

function tagEl(t, n) {
  const s = document.createElement("span");
  s.className = "tag" + (state.tag === t ? " on" : "");
  s.textContent = "#" + t + (n ? ` ${n}` : "");
  s.onclick = e => { e.stopPropagation(); state.tag = state.tag === t ? null : t; closeLb(); update(); };
  return s;
}

function filtered() {
  const terms = norm(state.q).split(/\s+/).filter(Boolean);
  let v = visible().filter(m => (!state.cat || m.category === state.cat) && (!state.tag || m.tags.includes(state.tag))
    && terms.every(t => m.hay.includes(t)));
  if (state.sort === "popular" && !state.cat && !state.tag && !terms.length) {
    // interleave sources so the front page mixes classics, captioned memes and fresh posts
    const groups = {}; v.forEach(m => (groups[m.source.startsWith("Imgflip API") ? "a" : m.source.startsWith("Reddit") ? "c" : "b"] ??= []).push(m));
    const out = [], g = [groups.a || [], groups.b || [], groups.c || []];
    for (let i = 0; out.length < v.length; i++) g.forEach((arr, k) => { const per = [2, 1, 1][k]; for (let j = 0; j < per; j++) { const x = arr[i * per + j]; if (x) out.push(x); } });
    return out;
  }
  if (state.sort === "az") v.sort((a, b) => a.title.localeCompare(b.title));
  else if (state.sort === "new") v.sort((a, b) => (b.date_added || "").localeCompare(a.date_added || "") || b.rank - a.rank);
  else if (state.sort === "shuffle") v.sort(() => Math.random() - .5);
  else v.sort((a, b) => a.rank - b.rank);
  return v;
}

function update() { writeHash(); buildSidebar(); render(); window.scrollTo({ top: 0, behavior: "smooth" }); }

function render() {
  view = filtered();
  const grid = $("#grid"); grid.innerHTML = "";
  $("#heading").textContent = state.tag ? `#${state.tag}` : (state.cat || "All memes");
  const cats = Object.keys(counts(view)).length;
  $("#sub").textContent = `${view.length} meme${view.length === 1 ? "" : "s"}` + (cats > 1 ? ` across ${cats} categories` : "") + (state.q ? ` matching “${state.q}”` : "");
  const act = $("#active"); act.innerHTML = "";
  [["cat", state.cat], ["tag", state.tag && "#" + state.tag], ["q", state.q && `“${state.q}”`]].forEach(([k, v]) => {
    if (!v) return;
    const s = document.createElement("span"); s.innerHTML = `${v}<button aria-label="remove">✕</button>`;
    s.querySelector("button").onclick = () => { state[k] = k === "q" ? "" : null; if (k === "q") $("#q").value = ""; update(); };
    act.appendChild(s);
  });
  $("#empty").hidden = view.length > 0;
  const ncol = Math.max(1, Math.min(6, Math.floor((grid.clientWidth + 16) / 246)));
  const cols = [...Array(ncol)].map(() => { const d = document.createElement("div"); d.className = "col"; grid.appendChild(d); return d; });
  const hts = Array(ncol).fill(0);
  view.forEach((m, i) => {
    const c = document.createElement("article"); c.className = "card";
    c.style.animationDelay = Math.min(i * 18, 500) + "ms";
    const ratio = m.width && m.height ? `aspect-ratio:${m.width}/${m.height}` : "min-height:180px";
    c.innerHTML = `<div class="ph" style="${ratio}"><img loading="lazy" alt="${esc(m.title)}" src="${m.thumb || m.image}"></div>
      ${m.source.startsWith("Reddit") ? `<span class="badge">🔥 ${esc(m.source.replace("Reddit ", ""))}</span>` : ""}
      ${m.nsfw ? '<span class="badge nsfw">🌶️ NSFW</span>' : ""}
      <div class="meta"><h4>${esc(m.title)}</h4><div class="row"><span class="pill" style="--c:${color(m.category)}">${CAT_META[m.category]?.[0] || ""} ${m.category}</span>
      <span class="src">${esc(m.source.split(" ")[0] === "Know" ? "KYM" : m.source.split(" ")[0])}</span></div></div>`;
    const img = c.querySelector("img");
    img.onload = () => { img.classList.add("ld"); img.parentNode.classList.remove("ph"); };
    c.onclick = () => openLb(i);
    const k = hts.indexOf(Math.min(...hts));
    cols[k].appendChild(c); hts[k] += (m.height && m.width ? m.height / m.width : 1) + 0.35;
  });
}

function esc(s) { return s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

function openLb(i) {
  idx = (i + view.length) % view.length; const m = view[idx];
  $("#lbImg").src = m.image; $("#lbImg").alt = m.title;
  $("#lbTitle").textContent = m.title;
  const cat = $("#lbCat"); cat.textContent = `${CAT_META[m.category]?.[0] || ""} ${m.category}`; cat.style.setProperty("--c", color(m.category));
  const tags = $("#lbTags"); tags.innerHTML = ""; m.tags.forEach(t => tags.appendChild(tagEl(t)));
  $("#lbSource").innerHTML = `<a href="${m.source_url}" target="_blank" rel="noopener">${esc(m.source)}</a>`;
  $("#lbAttr").textContent = m.attribution || "—";
  $("#lbCaption").textContent = m.caption ? `“${m.caption}”` : "";
  $("#lbDate").textContent = m.date_added || "—";
  $("#lbSize").textContent = m.width ? `${m.width} × ${m.height}px` : "—";
  $("#lbOpen").href = m.source_url; $("#lbDl").href = m.image;
  $("#lb").hidden = false; document.body.style.overflow = "hidden";
}
function closeLb() { $("#lb").hidden = true; document.body.style.overflow = ""; }
let rz; window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(render, 150); });
$("#lbClose").onclick = closeLb;
$("#lbPrev").onclick = () => openLb(idx - 1);
$("#lbNext").onclick = () => openLb(idx + 1);
$("#lb").onclick = e => { if (e.target.id === "lb") closeLb(); };
$("#lbCopy").onclick = () => {
  const url = new URL(view[idx].image, location.href).href;
  (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => toast("Link copied 📋"), () => toast(url));
};
function toast(t) { const el = $("#toast"); el.textContent = t; el.classList.add("show"); setTimeout(() => el.classList.remove("show"), 1800); }

document.addEventListener("keydown", e => {
  if (!$("#lb").hidden) {
    if (e.key === "Escape") closeLb(); if (e.key === "ArrowLeft") openLb(idx - 1); if (e.key === "ArrowRight") openLb(idx + 1);
  } else if (e.key === "/" && document.activeElement !== $("#q")) { e.preventDefault(); $("#q").focus(); }
});
let t; $("#q").addEventListener("input", e => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value.trim(); writeHash(); render(); }, 120); });
$("#nsfw").onchange = e => {
  state.nsfw = e.target.checked; localStorage.setItem("mv-nsfw", state.nsfw ? "1" : "0");
  if (!state.nsfw && state.tag === "nsfw") state.tag = null;
  update(); toast(state.nsfw ? "Crude memes shown 🌶️" : "Crude memes hidden 😇");
};
$("#sort").onchange = e => { state.sort = e.target.value; render(); };
$("#reset").onclick = () => { Object.assign(state, { cat: null, tag: null, q: "" }); $("#q").value = ""; update(); };
$("#menuBtn").onclick = () => $("#sidebar").classList.toggle("open");
function closeMenu() { $("#sidebar").classList.remove("open"); }

function writeHash() {
  const p = new URLSearchParams(); if (state.cat) p.set("cat", state.cat); if (state.tag) p.set("tag", state.tag); if (state.q) p.set("q", state.q);
  history.replaceState(null, "", p.toString() ? "#" + p : location.pathname);
}
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  state.cat = p.get("cat"); state.tag = p.get("tag"); state.q = p.get("q") || ""; $("#q").value = state.q;
  if (p.get("open")) setTimeout(() => { const i = view.findIndex(m => m.id === p.get("open")); if (i >= 0) openLb(i); }, 0);
}
