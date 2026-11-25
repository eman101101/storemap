/**
 * Demo product photos, stored IN the database. The example maps' photos
 * used to ship as static SPA assets (frontend/public/demo-products); they
 * now live in the `media` table — one row per image, bytes included — so
 * they travel with the database (a backup holds the whole store) and the
 * frontend bundle carries none of them. scripts/seed-demo.mjs copies them
 * in from backend/demo-products; products reference them by url
 * (`/media/<file>`), which is what this module serves.
 */
import path from 'node:path';
import { createHash } from 'node:crypto';
import { db } from '../db.js';

const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

/** A stored image's public url prefix — `file` is its name under backend/demo-products (e.g. `gen/feta-cheese-200g.svg`). */
export const MEDIA_URL = '/media/';

/** `file` (or a `/media/` url path) names a stored image — anything else is refused before it reaches a query. */
const MEDIA_NAME = /^(?:gen\/)?[a-z0-9-]+\.(?:jpe?g|png|webp|svg)$/;

export const isMediaFile = (file) => typeof file === 'string' && MEDIA_NAME.test(file);

/** A url that points at a stored image (either side of the move off static files), or null. */
export const isMediaUrl = (url) =>
  typeof url === 'string' && /^\/(?:media|demo-products)\/(?:gen\/)?[a-z0-9-]+\.(?:jpe?g|png|webp|svg)$/.test(url) ? url : null;

/**
 * Store (or refresh) an image under `file`; unchanged bytes are left alone.
 * Returns the image's public url.
 */
export function putMedia(file, buf) {
  if (!isMediaFile(file)) throw new Error(`Not a stored image name: ${file}`);
  const mime = MIME[path.extname(file).toLowerCase()];
  const etag = createHash('sha256').update(buf).digest('hex');
  const current = db.prepare('SELECT etag FROM media WHERE id = ?').get(file);
  if (current?.etag !== etag) {
    db.prepare(
      `INSERT INTO media (id, mime, size, etag, data) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET mime = excluded.mime, size = excluded.size, etag = excluded.etag, data = excluded.data`
    ).run(file, mime, buf.length, etag, buf);
  }
  return MEDIA_URL + file;
}

/** Drop every stored image that is no longer one of `files` — a photo retired from the set must not linger in the database. */
export function pruneMedia(files) {
  const keep = [...files];
  if (!keep.length) return 0;
  return db
    .prepare(`DELETE FROM media WHERE id NOT IN (${keep.map(() => '?').join(',')})`)
    .run(...keep).changes;
}

/**
 * Serve a stored image onto the response, or false when there is none.
 * Cached for a day and revalidated by content hash (ETag → 304), so a
 * re-picked photo shows up without the url changing.
 */
export function sendMedia(req, res, file) {
  if (!isMediaFile(file)) return false;
  const row = db.prepare('SELECT mime, size, etag, data FROM media WHERE id = ?').get(file);
  if (!row) return false;
  const etag = `"${row.etag}"`;
  res.set('Content-Type', row.mime);
  res.set('Cache-Control', 'public, max-age=86400');
  res.set('ETag', etag);
  if (req.headers['if-none-match'] === etag) {
    res.status(304).end();
    return true;
  }
  const buf = Buffer.from(row.data);
  res.set('Content-Length', buf.length);
  res.end(buf);
  return true;
}
