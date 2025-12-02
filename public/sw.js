// sw.js — simple cache-first service worker
const CACHE = "quikchat-cache-v1";
self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(["/", "/index.html", "/style.css", "/app.js"]))
  );
});
self.addEventListener("fetch", (e) => {
  e.respondWith(caches.match(e.request).then(r=> r || fetch(e.request)));
});
