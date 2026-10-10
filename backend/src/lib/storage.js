/**
 * Media storage for Stage 0 (docs/INFRASTRUCTURE.md §5.1): R2 when configured,
 * local disk otherwise. Uploads keep returning the same relative /uploads/<name>
 * URLs in both modes; serving checks disk first (legacy files) then R2, so a
 * deployment can switch to R2 at any time without moving old media.
 */
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { config } from '../config.js';
import { r2Enabled, r2Put, r2Get } from './r2.js';

const CONTENT_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

/**
 * Persist an image buffer. Returns the public URL path (`/uploads/<name>`).
 * R2 mode writes only to the bucket (keys `uploads/<name>`); disk mode writes
 * to the uploads dir as before.
 */
export async function saveImage(buf, ext) {
  const name = `${crypto.randomUUID()}${ext}`;
  if (r2Enabled()) {
    await r2Put(`uploads/${name}`, buf, CONTENT_TYPES[ext] || 'application/octet-stream');
  } else {
    await fsp.writeFile(path.join(config.uploadsDir, name), buf);
  }
  return { name, url: `/uploads/${name}` };
}

/**
 * Serve an uploaded image onto the response: disk file first, then R2, else
 * null (caller sends 404). Streams with immutable long-cache headers — image
 * names are unique UUIDs, so bytes never change under a given URL.
 */
export async function sendImage(res, name) {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return false; // no path tricks
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  const contentType = CONTENT_TYPES[path.extname(name).toLowerCase()];
  if (contentType) res.set('Content-Type', contentType);

  const local = path.join(config.uploadsDir, name);
  if (fs.existsSync(local)) {
    const stat = await fsp.stat(local);
    res.writeHead(200, { 'Content-Length': stat.size });
    fs.createReadStream(local).pipe(res);
    return true;
  }

  if (r2Enabled()) {
    const r2res = await r2Get(`uploads/${name}`);
    if (r2res) {
      const buf = Buffer.from(await r2res.arrayBuffer());
      res.writeHead(200, { 'Content-Length': buf.length });
      res.end(buf);
      return true;
    }
  }
  return false;
}
