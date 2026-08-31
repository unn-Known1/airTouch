const CACHE="airtouch-v2";
self.addEventListener("install", e=>{ e.waitUntil(caches.open(CACHE).then(c=>c.addAll(["./","./index.html","./manifest.json","./tv.html","./airmouse.html"]))); self.skipWaiting(); });
self.addEventListener("activate", e=>{ e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())); });
self.addEventListener("fetch", e=>{
  if(e.request.method!=='GET') return;
  e.respondWith(caches.match(e.request).then(cached=>{
    const fetched = fetch(e.request).then(resp=>{
      if(resp.ok) caches.open(CACHE).then(c=>c.put(e.request, resp.clone()));
      return resp;
    }).catch(()=>cached);
    return cached || fetched;
  }));
});
