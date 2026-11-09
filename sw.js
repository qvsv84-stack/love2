// sw.js — Service Worker PWA (network-first cho HTML/JS, cache-first cho ảnh/css)
// BUMP CACHE_VERSION mỗi lần deploy để xoá cache cũ
const CACHE_VERSION = '2.0.2';
const CACHE_NAME = 'cslx-pwa-' + CACHE_VERSION;
const APP_SHELL = ['/', '/index.html', '/style.css', '/manifest.json'];

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
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Cho phép trang gửi "SKIP_WAITING" để kích hoạt SW mới ngay
self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Bỏ qua khác origin (Supabase, Google Fonts, CDN...)
  if (url.origin !== location.origin) return;

  // Bỏ qua API Supabase
  if (url.pathname.startsWith('/rest/') ||
      url.pathname.startsWith('/auth/') ||
      url.pathname.startsWith('/realtime/')) return;

  // Bỏ qua source map / HMR
  if (url.pathname.endsWith('.map')) return;

  // Network-first cho HTML, JS, JSON (update ngay khi có mạng)
  const isHTML = url.pathname === '/' || url.pathname.endsWith('.html');
  const isJS   = url.pathname.endsWith('.js') || url.pathname.endsWith('.mjs');
  const isJSON = url.pathname.endsWith('.json');

  if (isHTML || isJS || isJSON) {
    e.respondWith(
      fetch(req, { cache: 'no-store' })
        .then(res => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(req, clone)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req).then(c => c || fetch(req)))
    );
    return;
  }

  // Cache-first cho ảnh, font, CSS, icon
  e.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(res => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, clone)).catch(() => {});
        }
        return res;
      });
    })
  );
});