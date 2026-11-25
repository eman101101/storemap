/**
 * Demo product photos, stored IN the database (the `media` table — parity
 * with backend/src/lib/media.js). They used to ship as static SPA assets
 * under frontend/public/demo-products; now a product references its photo by
 * url (`/media/<file>`) and the bytes live in D1.
 *
 * A Worker cannot bundle the photo set (several MB of images), so
 * scripts/load-demo-photos.mjs writes the files of backend/demo-products into
 * D1 — the local database of `wrangler dev`, or the deployed one.
 */
import type { Env } from './config';

/** `file` (the part after `/media/`) names a stored image — anything else is refused before it reaches a query. */
const MEDIA_NAME = /^(?:gen\/)?[a-z0-9-]+\.(?:jpe?g|png|webp|svg)$/;

const MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

let warnedEmpty = false; // per isolate: say it once

/** The public url of a stored image. */
export const MEDIA_URL = '/media/';

export function isMediaFile(file: string): boolean {
  return MEDIA_NAME.test(file);
}

/** A url of the demo photo set — either side of the move off static files — or null. */
export function demoPhotoUrl(url: unknown): string | null {
  return typeof url === 'string' && /^\/(?:media|demo-products)\/(?:gen\/)?[a-z0-9-]+\.(?:jpe?g|png|webp|svg)$/.test(url)
    ? url
    : null;
}

/**
 * Serve a stored image, or null (caller sends 404). Cached for a day and
 * revalidated by content hash (ETag → 304), so a re-picked photo shows up
 * without the url changing. Served straight from D1 — no R2, so demo photos
 * never eat into the media budget that user uploads depend on.
 */
export async function serveMedia(env: Env, file: string, ifNoneMatch?: string): Promise<Response | null> {
  if (!isMediaFile(file)) return null;
  // CAST on the read too: a row stored typed as text (SQLite's `||` returns
  // TEXT even for two blobs — see scripts/load-demo-photos.mjs) still holds
  // the right bytes, and this hands them back as a blob
  const row = await env.DB
    .prepare('SELECT mime, etag, CAST(data AS BLOB) AS data FROM media WHERE id = ?')
    .bind(file)
    .first<{ mime: string; etag: string; data: ArrayBuffer | number[] }>();
  if (!row) {
    // the example maps reference these from their first boot: with nothing
    // stored at all, the photo set was never loaded into this database (a
    // single missing photo is just that — no need to cry wolf over it)
    if (!warnedEmpty) {
      // claimed BEFORE the probe: the first burst of photo requests to reach a
      // cold isolate would otherwise all pass the check, and each log it
      warnedEmpty = true;
      if (!(await env.DB.prepare('SELECT 1 FROM media LIMIT 1').first())) {
        console.warn('[media] no stored photos — the demo photo set was not loaded into this database. Run `npm run photos` in worker/ (scripts/load-demo-photos.mjs)');
      }
    }
    return null;
  }
  const etag = `"${row.etag}"`;
  const headers: Record<string, string> = {
    'Content-Type': row.mime,
    'Cache-Control': 'public, max-age=86400',
    ETag: etag,
  };
  if (ifNoneMatch === etag) return new Response(null, { status: 304, headers });
  // D1 hands a BLOB back as an ArrayBuffer (the HTTP API would give bytes)
  const bytes = row.data instanceof ArrayBuffer ? row.data : Uint8Array.from(row.data).buffer;
  return new Response(bytes, { headers });
}

/** Content type of a stored image file. */
export function mimeOf(file: string): string {
  return MIME[file.slice(file.lastIndexOf('.') + 1).toLowerCase()] ?? 'application/octet-stream';
}
