// MemeGrotto service worker. VERSION is rewritten by scripts/stamp_assets.py on every deploy, so each deploy installs a
// new worker that drops old caches. Strategy:
//  - pages (index.html) and data (*.json): network-first, revalidated (cache: "no-cache"), cached copy only when offline
//    -> a new deploy is picked up on the next load, never stuck on a stale shell (stamped ?v= asset URLs change with it)
//  - versioned assets (?v=...), fonts, icons: cache-first (the URL changes whenever the content does)
//  - images/thumbs: cache-first as they are viewed, capped at MAX_IMG entries
//  - other origins (Supabase API, Imgflip, etc.): not touched
const VERSION = "e03d00d55b";
const SHELL = `mg-shell-${VERSION}`, DATA = `mg-data-${VERSION}`, IMG = "mg-img-v1", MAX_IMG = 600;
const CORE = ["./", "index.html", "memes.json", "manifest.webmanifest", "icons/icon-192.png"];
self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    await Promise.all(CORE.map(u => fetch(u, { cache: "no-cache" }).then(r => r.ok && c.put(u, r)).catch(() => {})));
    // versioned assets referenced by the current index.html
    try {
      const html = await (await fetch("index.html", { cache: "no-cache" })).text();
      const urls = [...html.matchAll(/(?:src|href)="([^"]+\?v=[\w]+)"/g)].map(m => m[1]);
      await c.addAll(urls);
    } catch (err) {}
    self.skipWaiting();
  })());
});
self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    // keep the images viewed under the old MemeSpire (ms-img-v1) / MemeVault (mv-img-v1) cache names instead of re-downloading them
    for (const old of ["ms-img-v1", "mv-img-v1"]) {
      if (!(await caches.has(old))) continue;
      try {
        const o = await caches.open(old), n = await caches.open(IMG);
        for (const r of (await o.keys()).slice(-MAX_IMG)) { const v = await o.match(r); if (v && !(await n.match(r))) await n.put(r, v); }
      } catch (err) {}
    }
    // drop every old shell/data/image cache (old mg-* versions and all ms-* / mv-* caches from the previous brands)
    for (const k of await caches.keys()) if (/^(mg|ms|mv)-/.test(k) && k !== SHELL && k !== DATA && k !== IMG) await caches.delete(k);
    await self.clients.claim();
  })());
});
async function networkFirst(req, cacheName) {
  const c = await caches.open(cacheName);
  try {
    const r = await fetch(req, { cache: "no-cache" });
    if (r.ok) c.put(req, r.clone());
    return r;
  } catch (err) {
    const hit = await c.match(req, { ignoreSearch: true }) || await caches.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === "navigate") return (await caches.match("index.html")) || (await caches.match("./")) || Response.error();
    return Response.error();
  }
}
async function cacheFirst(req, cacheName, cap) {
  const c = await caches.open(cacheName), hit = await c.match(req) || await caches.match(req);
  if (hit) return hit;
  const r = await fetch(req);
  if (r.ok && r.type === "basic") {
    await c.put(req, r.clone());
    if (cap) c.keys().then(ks => { if (ks.length > cap) ks.slice(0, ks.length - cap).forEach(k => c.delete(k)); });
  }
  return r;
}
self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  const p = url.pathname;
  if (req.mode === "navigate" || p.endsWith("/") || p.endsWith(".html")) return e.respondWith(networkFirst(req, SHELL));
  if (p.endsWith(".json") || p.endsWith(".webmanifest")) return e.respondWith(networkFirst(req, DATA));
  if (/\/videos\//.test(p)) return;          // clips: let the browser stream them (range requests)
  if (/\/(images|thumbs)\//.test(p)) return e.respondWith(cacheFirst(req, IMG, MAX_IMG));
  if (url.search.includes("v=") || /\/(fonts|icons)\//.test(p)) return e.respondWith(cacheFirst(req, SHELL));
  if (p.endsWith("sw.js")) return;
  e.respondWith(networkFirst(req, SHELL));
});
