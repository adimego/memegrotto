// MemeSpire moderation page. Needs supabase/features2.sql and a passphrase set with
//   select public.mod_set_passphrase('...');   (Supabase SQL editor)
// Every request sends the passphrase to security-definer RPCs, which check it against a bcrypt hash.
(() => {
  const SB_URL = "https://zvdhsibcwkvahfqglgvz.supabase.co", SB_KEY = "sb_publishable_t6UDizY_AOT9iTxrh9MxEQ_y4G46rG1";
  const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const djb2 = s => { let h = 5381; for (const ch of s) h = ((h << 5) + h + ch.codePointAt(0)) >>> 0; return h.toString(36); };
  const vid = id => id.length <= 64 ? id : id.slice(0, 55) + "~" + djb2(id);
  const KEY = "mv-modpass";
  let pass = sessionStorage.getItem(KEY) || "", tab = "pending", memeMap = null;
  const rpc = async (fn, body = {}) => {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: H, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.message || "Request failed (" + r.status + ")");
    return d;
  };
  const call = async (fn, body = {}) => {
    const d = await rpc(fn, { p: pass, ...body });
    if (d && d.ok === false && /passphrase|locked|too many|not set up/.test(d.error || "")) { logout(d.error); throw new Error(d.error); }
    if (d && d.ok === false) throw new Error(d.error || "Failed");
    return d;
  };
  let tt; function toast(t) { const el = $("#toast"); el.textContent = t; el.hidden = false; el.classList.add("show"); clearTimeout(tt); tt = setTimeout(() => { el.classList.remove("show"); el.hidden = true; }, 2600); }
  function msg(html) { const m = $("#modMsg"); m.innerHTML = html; m.hidden = !html; }
  function logout(why) {
    pass = ""; sessionStorage.removeItem(KEY); $("#modApp").hidden = true; $("#modOut").hidden = true; $("#modLogin").hidden = false;
    msg(why ? `<p>⚠️ ${esc(why)}</p>` : "");
  }
  async function signed(paths) {
    if (!paths.length) return {};
    const r = await fetch(`${SB_URL}/storage/v1/object/sign/submissions`, { method: "POST", headers: H, body: JSON.stringify({ expiresIn: 600, paths }) });
    const out = {}; if (r.ok) (await r.json()).forEach(x => { if (x.signedURL) out[x.path] = SB_URL + "/storage/v1" + x.signedURL; });
    return out;
  }
  async function memes() {
    if (memeMap) return memeMap;
    try { const d = await (await fetch("memes.json", { cache: "no-cache" })).json(); memeMap = new Map(d.memes.map(m => [vid(m.id), m])); } catch (e) { memeMap = new Map(); }
    return memeMap;
  }
  const isVid = p => /\.(mp4|webm)$/i.test(p);
  const when = t => new Date(t).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

  async function showPending() {
    const body = $("#modBody"); body.innerHTML = '<p class="muted">Loading the queue…</p>';
    const d = await call("mod_list_pending", { p_limit: 100 });
    const urls = await signed(d.items.map(x => x.image_path));
    $('[data-t=pending] .n').textContent = d.items.length || "";
    if (!d.items.length) { body.innerHTML = '<p class="muted">🎉 Nothing waiting for review.</p>'; return; }
    body.innerHTML = `<div class="mod-grid">${d.items.map(x => `<article class="mod-item" data-id="${esc(x.id)}">
      <div class="mod-media">${!urls[x.image_path] ? '<span class="muted">preview unavailable</span>' : isVid(x.image_path)
        ? `<video src="${esc(urls[x.image_path])}" controls muted playsinline preload="metadata"></video>` : `<img src="${esc(urls[x.image_path])}" alt="" loading="lazy">`}</div>
      <div class="mod-info"><b>${esc(x.title)}</b>
        <span>${x.kind === "creation" ? "✏️ Made in the editor" : "📤 Upload"}${x.category ? " · " + esc(x.category) : ""}${x.creator ? " · by " + esc(x.creator) : ""}</span>
        ${x.tags?.length ? `<span>#${x.tags.map(esc).join(" #")}</span>` : ""}
        <span>${when(x.created_at)}</span>
        ${x.sender_rejected ? `<span class="warn">⚠️ This sender had ${x.sender_rejected} earlier submission${x.sender_rejected == 1 ? "" : "s"} rejected</span>` : ""}
      </div>
      <div class="mod-acts"><button class="btn ok" data-s="approved">✅ Approve</button><button class="btn bad" data-s="rejected">❌ Reject</button></div></article>`).join("")}</div>`;
    body.querySelectorAll(".mod-item").forEach(a => a.querySelectorAll("[data-s]").forEach(b => b.onclick = async () => {
      a.classList.add("done");
      try { await call("mod_set_status", { p_id: a.dataset.id, p_status: b.dataset.s }); toast(b.dataset.s === "approved" ? "Approved ✅ (live in the Community gallery)" : "Rejected ❌");
        const n = $('[data-t=pending] .n'); n.textContent = Math.max(0, (+n.textContent || 1) - 1) || "";
        setTimeout(() => a.remove(), 300);
      } catch (e) { a.classList.remove("done"); toast(e.message); }
    }));
  }
  async function showReports() {
    const body = $("#modBody"); body.innerHTML = '<p class="muted">Loading reports…</p>';
    const [d, map] = await Promise.all([call("mod_list_reports", { p_include_dismissed: false }), memes()]);
    $('[data-t=reports] .n').textContent = d.items.length || "";
    if (!d.items.length) { body.innerHTML = '<p class="muted">🎉 No open reports.</p>'; return; }
    body.innerHTML = d.items.map(x => { const m = map.get(x.meme_id);
      return `<article class="mod-rep" data-id="${esc(x.meme_id)}">${m ? `<img src="${esc(m.thumb || m.image)}" alt="" loading="lazy">` : '<img alt="">'}
      <div class="mod-info"><b>${esc(m ? m.title : x.meme_id.startsWith("sub-") ? "Community submission" : x.meme_id)}</b>
        <span>${x.open_count} open report${x.open_count == 1 ? "" : "s"} · last ${when(x.last_at)} · <a href="./#m=${encodeURIComponent(m ? m.id : x.meme_id)}" target="_blank" rel="noopener">open on site ↗</a></span>
        <span class="reasons">${(x.reasons || []).map(r => `<span>${esc(r)}</span>`).join("")}</span>
        ${(x.notes || []).map(n => `<span>“<q>${esc(n)}</q>”</span>`).join("")}
        <div class="mod-acts"><button class="btn" data-a="dismiss">👍 Dismiss (keep meme)</button><button class="btn bad" data-a="hide">🙈 Hide meme site-wide</button></div></div></article>`; }).join("");
    body.querySelectorAll(".mod-rep").forEach(a => {
      a.querySelector("[data-a=dismiss]").onclick = async () => { try { await call("mod_dismiss_report", { p_meme_id: a.dataset.id }); toast("Reports dismissed"); a.remove(); } catch (e) { toast(e.message); } };
      a.querySelector("[data-a=hide]").onclick = async () => { try { await call("mod_hide_meme", { p_meme_id: a.dataset.id, p_hide: true, p_reason: "reported" }); toast("Hidden from the site 🙈"); a.remove(); } catch (e) { toast(e.message); } };
    });
  }
  async function showHidden() {
    const body = $("#modBody"); body.innerHTML = '<p class="muted">Loading…</p>';
    const [d, map] = await Promise.all([call("mod_list_hidden"), memes()]);
    if (!d.items.length) { body.innerHTML = '<p class="muted">No hidden memes.</p>'; return; }
    body.innerHTML = d.items.map(x => { const m = map.get(x.meme_id);
      return `<article class="mod-rep" data-id="${esc(x.meme_id)}">${m ? `<img src="${esc(m.thumb || m.image)}" alt="" loading="lazy">` : '<img alt="">'}
      <div class="mod-info"><b>${esc(m ? m.title : x.meme_id)}</b><span>Hidden ${when(x.hidden_at)}${x.reason ? " · " + esc(x.reason) : ""}</span>
      <div class="mod-acts"><button class="btn" data-a="unhide">👀 Show again</button></div></div></article>`; }).join("");
    body.querySelectorAll(".mod-rep").forEach(a => a.querySelector("[data-a=unhide]").onclick = async () => {
      try { await call("mod_hide_meme", { p_meme_id: a.dataset.id, p_hide: false }); toast("Visible again 👀"); a.remove(); } catch (e) { toast(e.message); } });
  }
  async function show() {
    document.querySelectorAll(".mod-tabs [data-t]").forEach(b => b.classList.toggle("on", b.dataset.t === tab));
    try { await ({ pending: showPending, reports: showReports, hidden: showHidden })[tab](); }
    catch (e) { if (pass) $("#modBody").innerHTML = `<p>⚠️ ${esc(e.message)}</p>`; }
  }
  async function enter(p) {
    const d = await rpc("mod_login", { p });
    if (!d.ok) throw new Error(d.error || "Login failed");
    pass = p; sessionStorage.setItem(KEY, p);
    $("#modLogin").hidden = true; $("#modApp").hidden = false; $("#modOut").hidden = false; msg("");
    $('[data-t=pending] .n').textContent = d.pending || ""; $('[data-t=reports] .n').textContent = d.reports || "";
    show();
  }
  $("#modLogin").onsubmit = async e => {
    e.preventDefault(); const f = e.target, btn = f.querySelector("[type=submit]"); btn.disabled = true;
    try { await enter(f.p.value); f.reset(); } catch (err) { msg(`<p>⚠️ ${esc(err.message)}</p>`); } finally { btn.disabled = false; }
  };
  $("#modOut").onclick = () => logout("");
  document.querySelectorAll(".mod-tabs [data-t]").forEach(b => b.onclick = () => { tab = b.dataset.t; show(); });
  $("[data-a=refresh]").onclick = () => show();

  (async () => {
    try { const r = await fetch(`${SB_URL}/rest/v1/rpc/mv_features2`, { method: "POST", headers: H, body: "{}" }); if (!r.ok) throw 0; }
    catch (e) { msg("<h2>Not set up yet</h2><p>Run <code>supabase/features2.sql</code> in the Supabase SQL editor, then set a passphrase with <code>select public.mod_set_passphrase('…');</code></p>"); return; }
    if (pass) { try { await enter(pass); return; } catch (e) { logout(e.message); return; } }
    $("#modLogin").hidden = false;
  })();
})();
