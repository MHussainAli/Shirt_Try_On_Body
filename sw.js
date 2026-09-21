/* Minimal app-shell service worker: cache-first for our own static files. */
const CACHE = 'tailorai-v1';
const SHELL = [
  './', 'index.html', 'css/styles.css', 'manifest.webmanifest',
  'js/main.js', 'js/config.js', 'js/pose.js', 'js/filters.js', 'js/fit.js', 'js/draw.js', 'js/demo.js', 'js/catalog.js',
  'assets/catalog.json', 'assets/icons/icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.match(request).then((hit) => {
      const net = fetch(request).then((res) => {
        if (res.ok) caches.open(CACHE).then((c) => c.put(request, res.clone()));
        return res;
      });
      return hit || net; // stale-while-revalidate
    })
  );
});
