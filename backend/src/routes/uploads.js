import { Router } from 'express';
import { config } from '../config.js';
import { requireAuth } from '../auth/session.js';
import { handler, sendJson, badRequest, rateLimit } from '../lib/http.js';
import { ownedStore } from '../lib/ownership.js';
import { saveImage } from '../lib/storage.js';

const router = Router();

const ALLOWED = {
  'image/png': { ext: '.png', magic: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  'image/jpeg': { ext: '.jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/webp': { ext: '.webp', magic: (b) => b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WEBP' },
};

router.post(
  '/',
  requireAuth,
  rateLimit({ windowMs: 60_000, max: 20 }),
  // Raw-body upload avoids multipart parsing: the client POSTs the file bytes directly.
  handler(async (req, res) => {
    // Uploads are store-scoped: pass the target store as ?store=<id>, or as a
    // `store` field in a multipart body (the image rides along as another part).
    let storeId = req.query.store;
    let type = String(req.headers['content-type'] || '').split(';')[0].trim();
    let buf = Buffer.isBuffer(req.body) ? req.body : null;
    if (type === 'multipart/form-data' && buf) {
      const form = await new Request('http://uploads', {
        method: 'POST',
        headers: { 'content-type': req.headers['content-type'] },
        body: buf,
      }).formData();
      for (const [field, value] of form.entries()) {
        if (field === 'store') storeId = String(value);
        else if (typeof value?.arrayBuffer === 'function') {
          // the file part (any field name)
          buf = Buffer.from(await value.arrayBuffer());
          type = value.type || '';
        }
      }
    }
    if (!storeId) return badRequest(res, 'Missing field: store');
    const store = ownedStore(req, res, String(storeId)); // needs role ≥ stock
    if (!store) return;

    const spec = ALLOWED[type];
    if (!spec) return badRequest(res, 'Only PNG, JPEG or WebP images are accepted');
    if (!buf || !buf.length) return badRequest(res, 'Empty upload');
    if (buf.length > config.maxUploadBytes) return badRequest(res, 'Image exceeds 10 MB limit');
    if (!spec.magic(buf)) return badRequest(res, 'File content does not match its image type');

    const { url } = await saveImage(buf, spec.ext);
    sendJson(res, 201, { url });
  })
);

export default router;
