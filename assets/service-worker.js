// Cache leve: guarda a casca do app pra abrir offline/instantâneo, e
// guarda em cache (sem travar a rede) os textos e áudios de capítulo
// conforme você vai abrindo — assim, na segunda vez, funcionam offline.
const SHELL_CACHE = "jesed-shell-v78";
const CONTENT_CACHE = "jesed-content-v1";
const SHELL_FILES = [
  "./",
  "index.html",
  "assets/style-v6.css",
  "assets/app-v3.js",
  "assets/feedback-core-v8.js",
  "assets/beta-diagnostics-v1.js",
  "assets/beta-analytics-v1.js",
  "assets/beta-presence-v1.js",
  "assets/beta-feedback-v1.js",
  "assets/feedback-admin-v3.js",
  "assets/popup-messages.js",
  "assets/reader-hub-v3.js",
  "assets/firebase-config.js",
  "manifest.webmanifest",
  "data/books.json",
  "data/beta-feedback.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_FILES)).catch(()=>{})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k!==SHELL_CACHE&&k!==CONTENT_CACHE).map(k=>caches.delete(k)));
    await self.clients.claim();

    // Uma nova versão precisa realmente chegar às abas/PWAs já abertas.
    // Ao assumir o controle, recarrega cada janela uma única vez nesta ativação.
    const windows=await self.clients.matchAll({type:"window",includeUncontrolled:true});
    await Promise.all(windows.map(async client=>{
      try{ await client.navigate(client.url); }catch(e){}
    }));
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if(req.method !== "GET") return;
  const url = new URL(req.url);

  const isMedia = /\.(mp3|wav|m4a)$/i.test(url.pathname);
  const isChapterText = /\.md$/i.test(url.pathname);
  const isData = /\/data\/.*\.json$/i.test(url.pathname);

  if(isMedia){
    // cache-first: áudio é pesado, uma vez baixado não precisa de novo
    event.respondWith(
      caches.open(CONTENT_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if(hit) return hit;
        const res = await fetch(req);
        if(res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => fetch(req))
    );
    return;
  }

  if(isChapterText || isData){
    // network-first: texto é leve, prioriza sempre a versão mais nova,
    // mas cai pro cache se estiver offline
    event.respondWith(
      fetch(req).then((res) => {
        if(res.ok) caches.open(CONTENT_CACHE).then((c) => c.put(req, res.clone()));
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // casca do app: network-first. Isso evita que uma versão antiga de JS/CSS
  // continue presa no aparelho depois de um deploy. Se estiver offline, cai no cache.
  event.respondWith(
    fetch(req).then((res) => {
      if(res.ok && url.origin === self.location.origin){
        caches.open(SHELL_CACHE).then((cache) => cache.put(req, res.clone()));
      }
      return res;
    }).catch(() => caches.match(req))
  );
});
