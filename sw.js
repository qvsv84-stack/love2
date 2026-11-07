// sw.js — Service Worker cho PWA (network-first cho HTML/JS, cache-first cho ảnh/css)
const CACHE_NAME = 'cslx-pwa-v1';
const APP_SHELL = ['/', '/index.html', '/style.css'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll(APP_SHELL))
      .catch(err => console.warn('[SW] precache fail:', err))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Bỏ qua request khác origin (Supabase, Google Fonts, CDN...)
  if (url.origin !== location.origin) return;

  // Bỏ qua API Supabase
  if (url.pathname.startsWith('/rest/') || url.pathname.startsWith('/auth/') || url.pathname.startsWith('/realtime/')) return;

  // Network-first cho HTML, JS, JSON (để update bản mới ngay khi có mạng)
  const isHTML = url.pathname === '/' || url.pathname.endsWith('.html');
  const isJS = url.pathname.endsWith('.js');
  const isJSON = url.pathname.endsWith('.json');

  if (isHTML || isJS || isJSON) {
    e.respondWith(
      fetch(req)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, clone)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Cache-first cho ảnh, font, CSS, icon
  e.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(req, clone)).catch(() => {});
        return res;
      });
    })
  );
});