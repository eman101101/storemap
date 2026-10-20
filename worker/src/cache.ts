/**
 * Edge caching for public payloads (Step 4 — INFRASTRUCTURE.md §6 on Workers).
 * Shopper map JSON is public and immutable-between-edits: serve repeats from
 * Cloudflare's cache (5 min TTL) and purge per store when an edit lands, so
 * shoppers see changes within seconds while D1 only sees cache misses.
 */
import type { Context } from 'hono';
import type { Env } from './config';
import { first } from './db';

const TTL_SECONDS = 300;

/**
 * Serve `path` (e.g. /api/public/stores/<slug>) through the edge cache.
 * `build` runs only on a miss. HIT/MISS is surfaced in X-Cache.
 */
export async function cachedJson(c: Context, path: string, build: () => Promise<Response>): Promise<Response> {
  const cache = caches.default;
  const key = new Request(new URL(path, new URL(c.req.url).origin).toString());
  const hit = await cache.match(key);
  if (hit) {
    const headers = new Headers(hit.headers);
    headers.set('X-Cache', 'HIT');
    return new Response(hit.body, { status: hit.status, headers });
  }
  const res = await build();
  if (res.status === 200) {
    const headers = new Headers(res.headers);
    headers.set('Cache-Control', `public, max-age=0, s-maxage=${TTL_SECONDS}`);
    headers.set('X-Cache', 'MISS');
    const toCache = new Response(res.clone().body, { status: 200, headers });
    c.executionCtx.waitUntil(cache.put(key, toCache));
    return new Response(res.body, { status: res.status, headers });
  }
  return res;
}

/**
 * Drop a store's cached public payload. Called from touchStore on every
 * mutation. Purges under both the configured public origin and the current
 * request origin (they differ until PUBLIC_BASE_URL is set to a custom
 * domain) — cache.delete matches exact URLs.
 */
export async function purgeStoreCache(c: Context, env: Env, storeId: unknown): Promise<void> {
  try {
    const store = await first(env, 'SELECT slug FROM stores WHERE id = ?', String(storeId));
    if (!store) return;
    const path = `/api/public/stores/${store.slug}`;
    const origins = new Set<string>([new URL(c.req.url).origin]);
    const cfg = c.get('config');
    if (cfg?.publicBaseUrl) origins.add(new URL(cfg.publicBaseUrl).origin);
    await Promise.all([...origins].map((o) => caches.default.delete(new Request(`${o}${path}`))));
  } catch {
    /* cache purge is best-effort — never fail the edit that triggered it */
  }
}
