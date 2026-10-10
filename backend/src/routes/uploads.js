import { Router } from 'express';
import { config } from '../config.js';
import { requireAuth } from '../auth/session.js';
import { handler, sendJson, badRequest, rateLimit } from '../lib/http.js';
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
  (req, res, next) => {
    const type = (req.headers['content-type'] || '').split(';')[0].trim();
    if (!ALLOWED[type]) {
      return badRequest(res, 'Only PNG, JPEG or WebP images are accepted');
    }
    req._imageType = type;
    next();
  },
  handler(async (req, res) => {
    const spec = ALLOWED[req._imageType];
    const buf = Buffer.isBuffer(req.body) ? req.body : null;
    if (!buf || !buf.length) return badRequest(res, 'Empty upload');
    if (buf.length > config.maxUploadBytes) return badRequest(res, 'Image exceeds 10 MB limit');
    if (!spec.magic(buf)) return badRequest(res, 'File content does not match its image type');

    const { url } = await saveImage(buf, spec.ext);
    sendJson(res, 201, { url });
  })
);

export default router;
