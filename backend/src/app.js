import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import { config } from './config.js';
import { migrate, db } from './db.js';
import { attachUser } from './auth/session.js';
import { sendImage } from './lib/storage.js';
import { sendJson } from './lib/http.js';
import authRoutes from './routes/auth.js';
import storeRoutes from './routes/stores.js';
import floorRoutes from './routes/floors.js';
import catalogRoutes from './routes/catalog.js';
import publicRoutes from './routes/public.js';
import uploadRoutes from './routes/uploads.js';
import stockRoutes from './routes/stock.js';
import integrationRoutes from './routes/integrations.js';
import v1Routes from './routes/v1.js';

export function createApp() {
  migrate();

  const app = express();
  app.disable('x-powered-by');

  // ---- Security headers (SPA-friendly CSP) ----
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Content-Security-Policy': [
        "default-src 'self'",
        "img-src 'self' data: blob:",
        "style-src 'self' 'unsafe-inline'",
        "script-src 'self'",
        "connect-src 'self'",
        "font-src 'self' data:",
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'none'",
      ].join('; '),
    });
    if (req.path.startsWith('/api')) {
      res.set('Cache-Control', 'no-store');
    }
    next();
  });

  app.use('/api', express.json({ limit: '2mb' }), attachUser);

  app.get('/api/health', (_req, res) => {
    sendJson(res, 200, { ok: true, service: 'storemap', time: new Date().toISOString() });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/stores', storeRoutes);
  app.use('/api/stores', stockRoutes);
  app.use('/api/stores', integrationRoutes);
  app.use('/api/floors', floorRoutes);
  // public before the catch-all catalog router (which is mounted at /api with auth)
  app.use('/api/public', publicRoutes);
  app.use('/api/v1', v1Routes);
  app.use('/api', catalogRoutes);
  // uploads take the raw image bytes as the body
  app.use('/api/uploads', express.raw({ type: () => true, limit: '10mb' }), uploadRoutes);

  app.use('/api', (_req, res) => sendJson(res, 404, { error: 'Unknown API endpoint' }));

  // ---- SEO plumbing: sitemap + robots (public stores only) ----
  app.get('/sitemap.xml', (_req, res) => {
    const rows = db.prepare('SELECT slug, updated_at FROM stores WHERE is_public = 1').all();
    const urls = rows
      .map(
        (r) =>
          `  <url><loc>${config.publicBaseUrl}/s/${r.slug}</loc><lastmod>${String(r.updated_at).slice(0, 10)}</lastmod></url>`
      )
      .join('\n');
    res.type('xml').send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${config.publicBaseUrl}/</loc></url>\n${urls}\n</urlset>`
    );
  });
  app.get('/robots.txt', (_req, res) => {
    res.type('text/plain').send(`User-agent: *\nAllow: /\nSitemap: ${config.publicBaseUrl}/sitemap.xml\n`);
  });

  // ---- Uploaded images (floor plans, logos) ----
  // Disk first (legacy files), then R2 when configured — see lib/storage.js.
  app.get('/uploads/:name', async (req, res) => {
    try {
      if (await sendImage(res, req.params.name)) return;
      res.status(404).end();
    } catch (err) {
      console.error('uploads serve failed:', err);
      res.status(502).end();
    }
  });

  // ---- Built SPA ----
  const distIndex = path.join(config.frontendDist, 'index.html');
  if (fs.existsSync(config.frontendDist)) {
    app.use(express.static(config.frontendDist, { maxAge: '1h', index: false }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
      // Shopper links (/s/:slug) get real social-share metadata: QR scans and
      // shared links preview the store name/logo instead of the generic SPA tag.
      const slugMatch = req.path.match(/^\/s\/([A-Za-z0-9_-]{1,120})$/);
      if (!slugMatch) return res.sendFile(distIndex);
      const store = db
        .prepare(
          'SELECT id, name, description, logo_url, address, phone, hours, lat, lng FROM stores WHERE slug = ? AND is_public = 1'
        )
        .get(slugMatch[1]);
      if (!store) return res.sendFile(distIndex);
      const cats = db
        .prepare('SELECT name FROM categories WHERE store_id = ? ORDER BY name LIMIT 12')
        .all(store.id)
        .map((c) => c.name);
      const prodCount = db.prepare('SELECT COUNT(*) n FROM products WHERE store_id = ?').get(store.id).n;
      const title = `${store.name} — find it on the map`;
      const desc =
        store.description ||
        `${prodCount} products mapped${cats.length ? ` across ${cats.join(', ')}` : ''}. Search any item and see exactly where it is.`;
      const abs = (u) => (u && /^https?:/.test(u) ? u : u ? config.publicBaseUrl + u : u);
      const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const jsonLd = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Store',
        name: store.name,
        description: desc,
        ...(store.address ? { address: store.address } : {}),
        ...(store.phone ? { telephone: store.phone } : {}),
        ...(store.logo_url ? { image: abs(store.logo_url) } : {}),
        ...(store.lat && store.lng ? { geo: { '@type': 'GeoCoordinates', latitude: store.lat, longitude: store.lng } } : {}),
        ...(store.hours ? { openingHours: store.hours } : {}),
      });
      const noscript = `<noscript><h1>${esc(store.name)}</h1><p>${esc(desc)}</p>${
        store.hours ? `<p>Hours: ${esc(store.hours)}</p>` : ''
      }${store.address ? `<p>Address: ${esc(store.address)}</p>` : ''}</noscript>`;
      const metas = [
        ['og:title', title],
        ['og:description', desc],
        ['og:type', 'website'],
        ['og:url', `${config.publicBaseUrl}/s/${slugMatch[1]}`],
        ...(store.logo_url ? [['og:image', abs(store.logo_url)]] : []),
        ['twitter:card', store.logo_url ? 'summary_large_image' : 'summary'],
        ['twitter:title', title],
        ['twitter:description', desc],
      ]
        .map(([k, v]) => `<meta property="${k}" content="${String(v).replace(/"/g, '&quot;')}">`)
        .join('');
      fs.readFile(distIndex, 'utf8', (err, html) => {
        if (err) return res.sendFile(distIndex);
        res.type('html').send(
          html
            .replace('</title>', `</title>${metas}<script type="application/ld+json">${jsonLd}</script>`)
            .replace('<title>StoreMap — Find products in-store</title>', `<title>${store.name} · StoreMap</title>`)
            .replace('<div id="root"></div>', `${noscript}<div id="root"></div>`)
        );
      });
    });
  } else {
    app.get('/', (_req, res) => {
      res
        .status(503)
        .send('StoreMap frontend is not built yet. Run `npm run build` in ./frontend (see README.md).');
    });
  }

  // ---- Errors ----
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err?.type === 'entity.too.large') {
      return sendJson(res, 413, { error: 'Payload too large' });
    }
    console.error('Unhandled error:', err);
    sendJson(res, 500, { error: 'Internal server error' });
  });

  return app;
}
