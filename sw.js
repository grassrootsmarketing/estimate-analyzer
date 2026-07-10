/* Estimate Analyzer service worker — offline shell */
const CACHE = "ea-shell-v1";
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
  if(url.origin !== location.origin) return;        // CDN + /api go straight to network
  if(req.mode === "navigate"){
    // network-first for the page so new deploys flow; fall back to cached shell offline
    e.respondWith(fetch(req).catch(()=> caches.match("/index.html").then(r=> r || caches.match("/"))));
    return;
  }
  // cache-first for same-origin assets
  e.respondWith(caches.match(req).then(r => r || fetch(req).then(resp=>{
    if(resp && resp.status === 200){ const cp = resp.clone(); caches.open(CACHE).then(c=>c.put(req, cp)); }
    return resp;
  }).catch(()=> caches.match("/index.html"))));
});
