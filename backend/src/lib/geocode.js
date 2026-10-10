/**
 * Address → coordinates via OSM Nominatim (free, 1 req/s polite tier).
 * Best-effort and env-gated (STOREMAP_GEOCODE=true): failures never block a
 * store save, tests never touch the network. Results land in stores.lat/lng
 * for "stores near me" (landing + future mobile near-by).
 */
const cache = new Map(); // address → {lat, lng} | null (null = looked up, unknown)

export async function geocode(address) {
  const key = String(address || '').trim();
  if (!key || cache.has(key)) return cache.get(key) ?? null;
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'StoreMap/1.0 (store mapping; contact: site owner)' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`nominatim ${res.status}`);
    const rows = await res.json();
    const hit = rows?.[0] ? { lat: Number(rows[0].lat), lng: Number(rows[0].lon) } : null;
    cache.set(key, hit);
    return hit;
  } catch {
    cache.set(key, null);
    return null;
  }
}
