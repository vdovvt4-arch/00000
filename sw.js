// Service Worker - Power Gym Studio v4.0 (PWA Offline-First)
const CACHE_NAME = 'power-gym-web-v57';
const LOCAL_ASSETS = [
  './',
  './index.html',
  './dist/app.css',
  './visual-refresh.css',
  './assets/images/hero-gym.jpg',
  './storage-shim.js',
  './js/data-foundation.js',
  './js/core.js',
  './js/calendar.js',
  './js/finance.js',
  './js/telegram.js',
  './js/players.js',
  './ui-enhancements.js',
  './reports.js',
  './receipts.js',
  './extras.js',
  './advanced.js',
  './cloud-sync.js',
  './js/backend-api.js',
  './smart-ops.js',
  './store-admin.js',
  './smart-notifications.js',
  './store.html',
  './store.js',
  './manifest.json',
  './logo.svg',
  './icon.png',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './bg-watermark.png'
];
const CDN_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(LOCAL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  if (url.hostname.endsWith('.supabase.co') || url.hostname === 'api.telegram.org' || url.hostname === 'api.qrserver.com') {
    return;
  }

  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        cache.match(req).then(cached => {
          const net = fetch(req).then(res => {
            if (res && res.ok) cache.put(req, res.clone());
            return res;
          }).catch(() => cached);
          return cached || net;
        })
      )
    );
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req)
        .then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then(cached => cached || (req.mode === 'navigate' ? caches.match('./index.html') : undefined)))
    );
  }
});
