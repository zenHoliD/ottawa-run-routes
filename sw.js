const CACHE_VERSION = 'ottawa-run-v3';
const STATIC_ASSETS = [
  './',
  './index.html',
  './app.js',
  './style.css',
  './manifest.json',
  './offline.html',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
];

// ── Install: cache all static assets ─────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_VERSION)
      .then(c => c.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: remove old caches ───────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch strategy ────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const { url, method } = e.request;

  // POST requests (ORS API) — always network, no caching
  if (method !== 'GET') return;

  // External APIs — network only, offline = silent fail
  if (url.includes('openrouteservice') || url.includes('nominatim.openstreetmap')) return;

  // Map tiles — network first, no cache (tiles are too numerous to cache)
  if (url.includes('tile.openstreetmap')) return;

  // CDN libraries and local static assets — cache first, then network
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request)
        .then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_VERSION).then(c => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => {
          // Offline fallback for navigation requests
          if (e.request.mode === 'navigate') {
            return caches.match('/offline.html');
          }
        });
    })
  );
});
