/**
 * Edge-cache coordination for Stage 0 (docs/INFRASTRUCTURE.md §6).
 *
 * Public shopper payloads are safe to cache at the CDN for a few minutes:
 * `edgeCache(res, storeId)` marks responses with s-maxage + a per-store
 * `Cache-Tag`. After an edit lands, `purgeStoreCache(storeId)` asks Cloudflare
 * to drop exactly that store's cached URLs (tag purge), so shoppers see edits
 * within seconds instead of waiting out the TTL.
 *
 * Both are no-ops when CF_ZONE_ID / CF_API_TOKEN are unset (local dev).
 */
import { config } from '../config.js';

const cdnEnabled = () => Boolean(config.cdn.zoneId && config.cdn.apiToken);

/** Mark a public response as edge-cacheable, scoped to one store's purge tag. */
export function edgeCache(res, storeIds) {
  if (!cdnEnabled()) return;
  res.set(
    'Cache-Control',
    'public, max-age=0, s-maxage=300, stale-while-revalidate=86400'
  );
  const ids = Array.isArray(storeIds) ? storeIds : [storeIds];
  if (ids.length) res.set('Cache-Tag', ids.map((id) => `store:${id}`).join(', '));
}

/** Fire-and-forget tag purge; never blocks or fails the request that triggered it. */
export function purgeStoreCache(storeIds) {
  if (!cdnEnabled()) return;
  const ids = Array.isArray(storeIds) ? storeIds : [storeIds];
  const tags = ids.map((id) => `store:${id}`);
  fetch(`https://api.cloudflare.com/client/v4/zones/${config.cdn.zoneId}/cache/purge`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.cdn.apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ tags }),
    signal: AbortSignal.timeout(4000),
  }).catch((err) => console.error('CDN purge failed (non-fatal):', err.message));
}
