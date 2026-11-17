/* StoreMap service worker (Stage-0 PWA, INFRASTRUCTURE §11.1).
 * - App shell: network-first, cached fallback (instant offline reload).
 * - Public store payloads: stale-while-revalidate, 30-day cache — the QR flow
 *   works with zero signal after the first view; routes/flights are pure
 *   client-side math and run offline.
 * - Never caches /api/* except public stores; uploads are immutable (1y).
 */
const SHELL_CACHE = 'storemap-shell-v1';
const DATA_CACHE = 'storemap-data-v1';
const CACHE_PREFIX = 'storemap-';
const ASSETS_MAX = 200;
const ASSETS_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // ~30 days

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL_CACHE)
      .then((c) => c.addAll(['/', '/manifest.webmanifest', '/icon.svg']))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      // prune our own caches from older deployments (versioned names only —
      // never touch caches this app doesn't own)
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith(CACHE_PREFIX) && k !== SHELL_CACHE && k !== DATA_CACHE)
          .map((k) => caches.delete(k))
      );
      // best-effort housekeeping on the shell cache: hashed /assets/ entries
      // accumulate across deployments — evict stale ones, cap the rest
      try {
        const c = await caches.open(SHELL_CACHE);
        const dated = [];
        for (const req of await c.keys()) {
          if (!new URL(req.url).pathname.startsWith('/assets/')) continue;
          const res = await c.match(req);
          dated.push([req, Date.parse(res?.headers.get('date') || '') || 0]);
        }
        const now = Date.now();
        for (const [req, when] of dated) {
          if (when && when < now - ASSETS_MAX_AGE_MS) await c.delete(req);
        }
        if (dated.length > ASSETS_MAX) {
          dated.sort((a, b) => a[1] - b[1]); // oldest (undated first) go
          for (const [req] of dated.slice(0, dated.length - ASSETS_MAX)) await c.delete(req);
        }
      } catch {
        /* housekeeping is best-effort */
      }
      await self.clients.claim();
    })()
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
    // only HTML navigations maintain the offline shell — other same-origin
    // GETs (manifest, icons, misc files) are served from their own cache
    // entries and must never overwrite the '/' shell key
    if (e.request.mode !== 'navigate') {
      e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
      return;
    }
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put('/', copy));
          }
          return res;
        })
        .catch(() => caches.match('/'))
    );
  }
});
