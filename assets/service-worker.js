// Cache leve: guarda a casca do app pra abrir offline/instantâneo, e
// guarda em cache (sem travar a rede) os textos e áudios de capítulo
// conforme você vai abrindo — assim, na segunda vez, funcionam offline.
const SHELL_CACHE = "jesed-shell-v2";
const CONTENT_CACHE = "jesed-content-v1";
const SHELL_FILES = [
  "./",
  "index.html",
  "assets/style.css",
  "assets/app.js",
  "assets/comments.js",
  "assets/firebase-config.js",
  "manifest.webmanifest",
  "data/books.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_FILES)).catch(()=>{})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter(k => k!==SHELL_CACHE && k!==CONTENT_CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
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

  // casca do app: cache-first
  event.respondWith(
    caches.match(req).then((hit) => hit || fetch(req))
  );
});
