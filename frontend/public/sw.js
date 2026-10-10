/* StoreMap service worker (Stage-0 PWA, INFRASTRUCTURE §11.1).
 * - App shell: network-first, cached fallback (instant offline reload).
 * - Public store payloads: stale-while-revalidate, 30-day cache — the QR flow
 *   works with zero signal after the first view; routes/flights are pure
 *   client-side math and run offline.
 * - Never caches /api/* except public stores; uploads are immutable (1y).
 */
const SHELL_CACHE = 'storemap-shell-v1';
const DATA_CACHE = 'storemap-data-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL_CACHE)
      .then((c) => c.addAll(['/', '/manifest.webmanifest', '/icon.svg']))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => ![SHELL_CACHE, DATA_CACHE].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/uploads/')) {
    e.respondWith(
      caches.open(SHELL_CACHE).then((c) =>
        c.match(e.request).then((hit) =>
          hit || fetch(e.request).then((res) => { c.put(e.request, res.clone()); return res; })
        )
      )
    );
    return;
  }

  if (/^\/api\/public\/stores\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) {
    e.respondWith(
      caches.open(DATA_CACHE).then((c) =>
        c.match(e.request).then((hit) => {
          const net = fetch(e.request)
            .then((res) => { if (res.ok) c.put(e.request, res.clone()); return res; })
            .catch(() => hit);
          return hit || net;
        })
      )
    );
    return;
  }

  if (!url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put('/', copy));
          return res;
        })
        .catch(() => caches.match('/'))
    );
  }
});
