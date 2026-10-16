/** Deck 01 — Platform Architecture & Data Model. */
import K from './kit.mjs';
const { C, F, W, M } = K;
const SYSTEM = 'Platform Architecture';

const p = K.mk(SYSTEM);
K.cover(p, {
  kicker: 'StoreMap systems  ·  01',
  title: 'Platform Architecture\n& Data Model',
  subtitle:
    'One Node.js process, one SQLite file, zero native dependencies. How a request travels from the browser to a byte-persisted map, and the rules that keep every store\'s data isolated.',
  stats: [
    { n: '9', label: 'route modules under /api' },
    { n: '1', label: 'SQLite file (WAL mode)' },
    { n: '100%', label: 'parameterized SQL' },
    { n: '0', label: 'native dependencies' },
  ],
  system: SYSTEM,
});

// --- 2 · System map -------------------------------------------------------
let s = p.addSlide();
K.header(s, { kicker: 'System map', title: 'One origin, one process, four external services', system: SYSTEM, page: 2 });
const boxY = 2.1, boxH = 1.15;
K.flow(p, s, { x: M, y: boxY, w: 4.2, bh: boxH, steps: [{ t: 'Shopper', d: '/s/:slug any device' }, { t: 'Store owner', d: '/dashboard editor' }] });
s.addShape('line', { x: 4.75, y: boxY + boxH / 2, w: 0.55, h: 0, line: { color: C.MUTED, width: 1.5, endArrowType: 'triangle' } });
K.card(p, s, { x: 5.35, y: boxY - 0.35, w: 3.1, h: boxH + 0.7, title: 'Express app (src/app.js)', body: 'Security headers + CSP · JSON 2 MB · attachUser · 9 route modules · static SPA + /uploads' });
s.addShape('line', { x: 8.5, y: boxY + boxH / 2, w: 0.55, h: 0, line: { color: C.MUTED, width: 1.5, endArrowType: 'triangle' } });
K.card(p, s, { x: 9.1, y: boxY - 0.35, w: 3.1, h: boxH + 0.7, title: 'node:sqlite (db.js)', body: 'storemap.db · WAL mode · FK on · 4 migrations · single writer' });
const ext = [
  ['Cloudflare', 'edge cache + per-store purge'],
  ['Cloudflare R2', 'uploaded media + backups'],
  ['Litestream', 'WAL replication to R2'],
  ['POS providers', 'Square, Shopify, Vend…'],
];
ext.forEach((e, i) => {
  const x = M + i * 3.12;
  s.addShape('line', { x: x + 1.4, y: 4.15, w: 0, h: 0.5, line: { color: C.LINE, width: 1 } });
  K.card(p, s, { x, y: 4.65, w: 2.9, h: 1.05, title: e[0], body: e[1], tint: true });
});
s.addText('Everything the browser loads — SPA, API, media — comes from one origin; only CDN and R2 sit in front of it.', { x: M, y: 6.1, w: W - 2 * M, h: 0.4, fontSize: 12, fontFace: F.body, color: C.MUTED, margin: 0 });

// --- 3 · Request lifecycle ------------------------------------------------
s = p.addSlide();
K.header(s, { kicker: 'Request lifecycle', title: 'Every /api request walks the same gauntlet', system: SYSTEM, page: 3 });
K.flow(p, s, {
  x: M, y: 1.7, w: W - 2 * M, bh: 1.0,
  steps: [
    { t: 'Headers', d: 'CSP, nosniff, frame-deny' },
    { t: 'JSON 2 MB', d: 'express.json body limit' },
    { t: 'attachUser', d: 'verify st_session JWT' },
    { t: 'Route', d: '9 modules, /api prefix' },
    { t: 'Handler', d: 'sync sqlite + sendJson' },
  ],
});
K.bullets(s, [
  { t: 'Security headers apply to every response, not just APIs — CSP is script-src \'self\' (no inline scripts anywhere).', bold: false },
  'attachUser never rejects: an invalid or expired cookie simply leaves req.user null; routes call requireAuth explicitly.',
  'Handlers are async wrappers (lib/http.js): a thrown error becomes a 500 JSON body — no HTML error pages, ever.',
  'Anything under /api/* gets Cache-Control: no-store; public reads opt back into caching explicitly (edgeCache).',
  'Unknown /api endpoint → 404 {error} JSON; the SPA catch-all only serves GETs outside /api and /uploads.',
], { x: M, y: 3.05, w: 7.6, h: 3.4, size: 12.5 });
K.codeCard(p, s, {
  x: M, y: 5.0, w: W - 2 * M, h: 1.75, file: 'src/app.js (mounting)', size: 9.5,
  code: `app.use('/api', express.json({ limit: '2mb' }), attachUser);

app.use('/api/auth', authRoutes);      app.use('/api/public', publicRoutes);
app.use('/api/stores', storeRoutes);   app.use('/api/v1', v1Routes);
app.use('/api/floors', floorRoutes);   app.use('/api', catalogRoutes);
app.get('/uploads/:name', …);          // media, then SPA fallback`,
});

// --- 4 · Data model -------------------------------------------------------
s = p.addSlide();
K.header(s, { kicker: 'Data model', title: 'Nine tables, one owner spine', system: SYSTEM, page: 4 });
const tY = 1.75;
const tbl = (x, y, name, rows, w = 2.15) => {
  s.addShape('roundRect', { x, y, w, h: 0.36 + rows.length * 0.27, rectRadius: 0.04, fill: { color: C.WHITE }, line: { color: C.PRIMARY, width: 1.2 } });
  s.addText(name, { x: x + 0.12, y: y + 0.04, w: w - 0.24, h: 0.28, fontSize: 11.5, fontFace: F.mono, bold: true, color: C.PRIMARY_DK, margin: 0, valign: 'top' });
  s.addText(rows.map((r, i) => ({ text: r, options: { breakLine: i < rows.length - 1 } })), { x: x + 0.12, y: y + 0.38, w: w - 0.24, h: rows.length * 0.27, fontSize: 9.5, fontFace: F.mono, color: C.MUTED, margin: 0, valign: 'top' });
};
tbl(M, tY, 'users', ['id (uuid)', 'email UNIQUE', 'provider/sub']);
tbl(M + 2.5, tY, 'stores', ['id, owner_id FK', 'slug UNIQUE', 'is_public, views', 'lat, lng']);
tbl(M + 5.0, tY, 'floors', ['id, store_id FK', 'level, w/h m', 'background_url']);
tbl(M + 7.5, tY, 'map_elements', ['id, floor_id FK', 'type CHECK(7)', 'shape CHECK(4)', 'geometry JSON']);
const sY = tY + 2.1;
tbl(M + 2.5, sY, 'categories', ['id, store_id FK', 'name, color, icon']);
tbl(M + 5.0, sY, 'products', ['id, store_id FK', 'category_id FK NULL', 'sku, barcode, price']);
tbl(M + 7.5, sY, 'product_locations', ['id, product_id FK', 'floor_id FK', 'x, y, rot, meta']);
const rY = sY + 1.75;
tbl(M, rY, 'store_api_keys', ['key_hash UNIQUE', 'prefix, revoked']);
tbl(M + 2.5, rY, 'integrations', ['UNIQUE(store,provider)', 'credentials, config']);
tbl(M + 5.0, rY, 'stock_levels', ['product_id PK', 'quantity, reorder']);
tbl(M + 7.5, rY, 'stock_movements', ['delta, resulting', 'source, created_at']);
s.addText('Every child table carries the store_id spine (or reaches it through one join) — that is what makes ownership checks one-liners.', { x: M, y: 6.72, w: W - 2 * M, h: 0.35, fontSize: 11.5, fontFace: F.body, color: C.MUTED, margin: 0 });
s.addShape('line', { x: M + 2.18, y: tY + 0.55, w: 0.28, h: 0, line: { color: C.FAINT, width: 1, endArrowType: 'triangle' } });
s.addShape('line', { x: M + 4.68, y: tY + 0.55, w: 0.28, h: 0, line: { color: C.FAINT, width: 1, endArrowType: 'triangle' } });
s.addShape('line', { x: M + 7.18, y: tY + 0.55, w: 0.28, h: 0, line: { color: C.FAINT, width: 1, endArrowType: 'triangle' } });

// --- 5 · Ownership --------------------------------------------------------
s = p.addSlide();
K.header(s, { kicker: 'Authorization', title: 'Ownership is a join, not a policy document', system: SYSTEM, page: 5 });
K.bullets(s, [
  'Every nested resource resolves through one helper that joins the owner — there is no per-route authorization logic to get wrong.',
  'Cross-tenant access returns 404, not 403: existence of another user\'s resource is never revealed.',
  'The public API re-scopes by is_public AND slug; the key-based v1 API re-scopes every product by store_id of the key.',
  'Tests pin the behavior: cross-user 404s, foreign-product stock rejection, revoked-key v1 access.',
], { x: M, y: 1.7, w: 6.7, h: 2.6, size: 12.5 });
K.codeCard(p, s, {
  x: M, y: 4.35, w: 6.7, h: 2.5, file: 'lib/ownership.js', size: 10,
  code: `function ownedStore(req, res, id) {
  const store = db.prepare(
    'SELECT s.* FROM stores s WHERE s.id = ? AND s.owner_id = ?'
  ).get(id, req.user.id);
  if (!store) sendJson(res, 404, { error: 'Not found' });
  return store;   // caller returns early when null
}`,
});
K.codeCard(p, s, {
  x: 7.5, y: 1.7, w: 5.33, h: 5.15, file: 'routes/floors.js — the pattern everywhere', size: 10,
  code: `// PATCH /api/floors/:id
const floor = ownedFloor(req, res, req.params.id);
if (!floor) return;              // 404 already sent

// elements resolve through floor → store → owner
const el = db.prepare(\`
  SELECT me.* FROM map_elements me
  JOIN floors f  ON f.id = me.floor_id
  JOIN stores s  ON s.id = f.store_id
  WHERE me.id = ? AND s.owner_id = ?
\`).get(req.params.id, req.user.id);

// v1 API does the same with the key's store:
'… WHERE p.id = ? AND p.store_id = ?'
  .get(id, keyStore.id);`,
});

// --- 6 · SQL discipline ---------------------------------------------------
s = p.addSlide();
K.header(s, { kicker: 'Data layer', title: 'Synchronous, transactional, parameterized — always', system: SYSTEM, page: 6 });
K.bullets(s, [
  { t: 'node:sqlite is synchronous: a handler\'s reads and writes complete atomically on the event loop — no async gaps for races to sneak into.', bold: false },
  'Multi-statement writes (bulk element replace, store duplicate, stock adjust, migrations) are wrapped in explicit BEGIN / COMMIT / ROLLBACK.',
  '100% parameterized statements; the only interpolated SQL fragments are code-owned identifiers and ? placeholders.',
  'WAL journal mode + foreign_keys ON are set at open; migrations run in a transaction each and are recorded in a migrations table.',
], { x: M, y: 1.7, w: 6.6, h: 2.9, size: 12.5 });
K.chip(p, s, { x: M, y: 4.8, w: 6.6, label: 'Trade-off', text: 'One writer at a time. Correct for a single-node deploy; the day you need N app servers, the database moves first.' });
K.codeCard(p, s, {
  x: 7.4, y: 1.7, w: 5.4, h: 5.0, file: 'routes/floors.js — bulk replace', size: 9.5,
  code: `db.exec('BEGIN');
try {
  db.prepare('DELETE FROM map_elements WHERE floor_id = ?').run(floorId);
  const ins = db.prepare(\`
    INSERT INTO map_elements
      (id, floor_id, type, shape, geometry,
       label, color, meta, z_index)
    VALUES (?,?,?,?,?,?,?,?,?)\`);
  for (const el of rows) ins.run(…);
  db.prepare('UPDATE stores SET updated_at = …').run(storeId);
  db.exec('COMMIT');
} catch (err) {
  db.exec('ROLLBACK');
  throw err;
}`,
});

// --- 7 · Caching & ETags --------------------------------------------------
s = p.addSlide();
K.header(s, { kicker: 'Caching', title: 'Edge cache for shoppers, ETags for editors', system: SYSTEM, page: 7 });
K.flow(p, s, {
  x: M, y: 1.7, w: W - 2 * M, bh: 1.0,
  steps: [
    { t: 'Shop edit', d: 'any mutation' },
    { t: 'touchStore', d: 'updated_at + purge' },
    { t: 'Cache-Tag purge', d: 'CF API, fire-and-forget' },
    { t: 'Edge revalidate', d: 'shoppers see it in seconds' },
  ],
});
K.bullets(s, [
  'Public store payload: s-maxage=300 + stale-while-revalidate=86400 + Cache-Tag store:<id> — one tag purge drops exactly that store.',
  'API responses are no-store by default; only /api/public/* opts in, so owner traffic never rides a cached response.',
  'Editor ETag = "v1-<updated_at>-<floor/element/product/location counts>": unchanged stores answer 304 with no payload.',
  'Uploaded images get immutable one-year cache — names are UUIDs, bytes never change under a URL.',
], { x: M, y: 3.1, w: 7.5, h: 3.3, size: 12.5 });
K.codeCard(p, s, {
  x: 8.3, y: 3.1, w: 4.5, h: 3.3, file: 'lib/cdn.js + routes/stores.js', size: 9.5,
  code: `// public read
res.set('Cache-Control',
  'public, max-age=0, s-maxage=300,' +
  ' stale-while-revalidate=86400');
res.set('Cache-Tag', 'store:' + id);

// editor revalidation
const etag = \`"v1-\${store.updated_at}-\${f}-\${e}-\${p}-\${l}"\`;
if (req.headers['if-none-match'] === etag)
  return res.status(304).end();`,
});

// --- 8 · Config -----------------------------------------------------------
s = p.addSlide();
K.header(s, { kicker: 'Configuration', title: 'Fail fast, default local', system: SYSTEM, page: 8 });
K.table(p, s, {
  x: M, y: 1.75, w: W - 2 * M,
  colW: [2.6, 2.3, 6.9],
  size: 11,
  rows: [
    ['Variable', 'Default', 'Behavior'],
    ['SESSION_SECRET', '— (required in prod)', 'HMAC key for session cookies; boot throws in NODE_ENV=production without it'],
    ['DATA_DIR', './backend/data', 'SQLite file + uploads/ live here; created on boot; mount a volume in production'],
    ['PUBLIC_BASE_URL', 'http://localhost:PORT', 'Builds OAuth redirect URIs, share links, sitemap'],
    ['ENABLE_DEV_LOGIN', 'true outside prod', 'Passwordless testing login; never on in production unless explicitly true'],
    ['R2_* (4 vars)', 'unset → local disk', 'Presence switches uploads + Litestream backups to Cloudflare R2'],
    ['CF_ZONE_ID / CF_API_TOKEN', 'unset → no CDN', 'Enables Cache-Tag headers and per-store purge calls'],
    ['TRUST_PROXY', 'false', 'Set behind TLS terminators so req.ip (rate limits) is the real client'],
  ],
});

// --- 9 · Measured performance --------------------------------------------
s = p.addSlide();
K.header(s, { kicker: 'Measured, not guessed', title: 'What one file actually delivers', system: SYSTEM, page: 9 });
K.stats(s, [
  { n: '64.8 KB', l: 'full store payload — 150 products, 34 fixtures, all pins' },
  { n: '~1.4k/s', l: 'payload requests served on a laptop (concurrent, full stack)' },
  { n: '2', l: 'origin requests per shopper visit — search runs client-side' },
]);
K.table(p, s, {
  x: M, y: 3.55, w: W - 2 * M, colW: [4.2, 4.0, 4.2], size: 11,
  rows: [
    ['Scenario', 'Comfortable capacity', 'What gives first'],
    ['No CDN (origin only)', '~150–300 visits/sec peak', 'event-loop saturation'],
    ['With Cloudflare on /api/public', 'effectively unbounded viewing', 'nothing on the view path'],
    ['Photos without CDN', 'thousands of visits/mo', 'Node proxies every byte'],
    ['Photos via Cloudflare', 'effectively unbounded', '—'],
  ],
});
s.addText('Measured on the real endpoint (node --input-type=module load script against a running server, Oct 2026). Cloud numbers are the laptop figure discounted 4–8× for a small cloud vCPU.', { x: M, y: 6.35, w: W - 2 * M, h: 0.5, fontSize: 10, fontFace: F.body, color: C.MUTED, margin: 0 });

// --- 10 · Tests -----------------------------------------------------------
s = p.addSlide();
K.header(s, { kicker: 'Verification', title: '39 backend tests, and what they honestly cover', system: SYSTEM, page: 10 });
K.table(p, s, {
  x: M, y: 1.75, w: 7.3, colW: [2.1, 1.0, 4.2], size: 11,
  rows: [
    ['Suite', 'Count', 'Covers'],
    ['api.test.mjs', '17', 'auth, ownership 404s, CRUD, floors, snapshots, uploads'],
    ['integrations.test.mjs', '8', 'adapter normalisation, CSV round-trip, sync endpoints'],
    ['stock.test.mjs', '4', 'adjust/set ledger, foreign-product rejection, key revocation'],
    ['r2.test.mjs', '4', 'SigV4 request signing for R2'],
    ['validate.test.mjs', '5', 'geometry/shape validation units'],
    ['smoke.mjs', '1', 'boots the real server, walks the user journey'],
  ],
});
K.bullets(s, [
  { t: 'Honest gaps:', bold: true },
  'OAuth flows (Google/Apple) have no automated tests — verified manually.',
  'secretbox encryption and the /uploads serving path (a P0 crash fix lives there) are untested.',
  'Rate limits and floor create/patch dimension checks are untested.',
], { x: 8.2, y: 1.85, w: 4.6, h: 4.6, size: 11.5 });

K.closing(p, {
  title: 'Architecture rules this codebase keeps',
  system: SYSTEM,
  points: [
    { t: 'One writer, synchronous transactions', d: 'node:sqlite on the event loop; BEGIN/COMMIT around every multi-statement write.' },
    { t: 'Ownership is structural', d: 'every table carries the store spine; every route resolves through one owner-join helper; 404, never 403.' },
    { t: 'Cache on purpose, not by accident', d: 'APIs no-store; public reads opt into the edge; editors revalidate via count-based ETags.' },
    { t: 'Fail fast on config', d: 'missing SESSION_SECRET in production refuses to boot rather than degrading silently.' },
  ],
});

p.writeFile({ fileName: '01-architecture-data-model.pptx' }).then(() => console.log('ok 01'));
