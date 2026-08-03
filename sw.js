/* Service worker — offline shell + vendored libraries */
/* Bumped for the Homestead visual system: new palette, new display face. Without
   this every installed device keeps serving the old forest shell offline. */
const CACHE = "ea-shell-v12";
self.addEventListener("install", e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(["/","/index.html"])).then(()=>self.skipWaiting()).catch(()=>{}));
});
self.addEventListener("activate", e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener("fetch", e=>{
  const req = e.request;
  if(req.method !== "GET") return;                 // never touch POST (/api)
  const url = new URL(req.url);
  if(url.origin !== location.origin) return;        // cross-origin goes straight to network
  if(req.mode === "navigate"){
    // Network-first for the page so new deploys flow. On success, refresh the
    // cached shell so the offline fallback is always the latest deployed page
    // (the old worker cached index.html once at install and never updated it).
    e.respondWith(fetch(req).then(resp=>{
      if(resp && resp.ok){ const cp = resp.clone(); caches.open(CACHE).then(c=>{ c.put("/index.html", cp.clone()); c.put("/", cp); }).catch(()=>{}); }
      return resp;
    }).catch(()=> caches.match("/index.html").then(r=> r || caches.match("/"))));
    return;
  }
  // Cache-first for same-origin assets (icons, /vendor libraries). A miss while
  // offline fails honestly; index.html is never returned in place of an asset.
  e.respondWith(caches.match(req).then(r => r || fetch(req).then(resp=>{
    if(resp && resp.status === 200){ const cp = resp.clone(); caches.open(CACHE).then(c=>c.put(req, cp)).catch(()=>{}); }
    return resp;
  })));
});
