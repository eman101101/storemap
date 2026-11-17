/** Upload route — raw image bytes to R2 (port of uploads.js). */
import { Hono } from 'hono';
import type { AppEnv, Env } from '../config';
import { saveImage } from '../storage';
import { json, badRequest, rateLimit } from '../http';
import { requireAuth } from '../session';
import { ownedStore } from '../ownership';

const app = new Hono<AppEnv>();

const ALLOWED: Record<string, { ext: string; magic: (b: Uint8Array) => boolean }> = {
  'image/png': { ext: '.png', magic: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  'image/jpeg': { ext: '.jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/webp': {
    ext: '.webp',
    magic: (b) =>
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  },
};

const limiter = rateLimit({ windowMs: 60_000, max: 20 });

app.post('/', requireAuth, limiter, async (c) => {
  const env = c.env as Env;
  const cfg = c.get('config');
  // Uploads are store-scoped: pass the target store as ?store=<id>, or as a
  // `store` field in a multipart body (the image rides along as another part).
  let storeId = c.req.query('store');
  let type = (c.req.header('content-type') || '').split(';')[0].trim();
  let buf: Uint8Array | null = null;
  if (type === 'multipart/form-data') {
    const form = await c.req.parseBody();
    for (const [field, value] of Object.entries(form)) {
      if (field === 'store') storeId = String(value);
      else if (value instanceof File) {
        buf = new Uint8Array(await value.arrayBuffer());
        type = value.type || '';
      }
    }
  } else {
    buf = new Uint8Array(await c.req.arrayBuffer());
  }
  if (!storeId) return badRequest(c, 'Missing field: store');
  const store = await ownedStore(c, env, storeId); // needs role ≥ stock
  if (store instanceof Response) return store;

  const spec = ALLOWED[type];
  if (!spec) return badRequest(c, 'Only PNG, JPEG or WebP images are accepted');
  if (!buf || !buf.length) return badRequest(c, 'Empty upload');
  if (buf.length > cfg.maxUploadBytes) return badRequest(c, 'Image exceeds 10 MB limit');
  if (!spec.magic(buf)) return badRequest(c, 'File content does not match its image type');

  try {
    const { url } = await saveImage(env, buf, spec.ext);
    return json(c, 201, { url });
  } catch (err) {
    if ((err as Error).message === 'R2_DAILY_BUDGET_REACHED')
      return json(c, 503, { error: 'Daily media budget reached — uploads pause until tomorrow.', retry: true });
    throw err;
  }
});

export default app;
