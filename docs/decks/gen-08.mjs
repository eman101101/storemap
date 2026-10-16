/** Deck 08 — Stock, Integrations & the v1 API. */
import K from './kit.mjs';
const { C, F, W, M } = K;
const SYSTEM = 'Stock & Integrations';

const p = K.mk(SYSTEM);
K.cover(p, {
  kicker: 'StoreMap systems  ·  08',
  title: 'Stock, Integrations\n& the v1 API',
  subtitle:
    'A movement-ledger stock model, one-click sync from eight POS providers and CSV, and an independent key-based API any external system can read and write stock through.',
  stats: [
    { n: '8', label: 'providers + generic StockTrack' },
    { n: '2', label: 'endpoints: adjust & set' },
    { n: 'v1', label: 'key-based REST API' },
    { n: '12', label: 'stock + integration tests' },
  ],
  system: SYSTEM,
});

// 2 · stock model
let s = p.addSlide();
K.header(s, { kicker: 'Stock model', title: 'A ledger, not a counter', system: SYSTEM, page: 2 });
K.bullets(s, [
  'stock_levels holds one row per product: quantity, reorder point, updated_at — the fast read.',
  'Every change appends to stock_movements: delta, resulting_quantity, reason, source (manual, pos, api…) — the audit trail.',
  'Adjust applies a delta (sales, breakage, deliveries); Set writes an absolute count — both record a movement.',
  'The dashboard lists movements per product with source and time; the v1 API enforces the same ledger semantics.',
  'Foreign products are rejected at the ownership join — a key or user can only move stock of their own store.',
], { x: M, y: 1.75, w: 7.3, h: 3.4, size: 12.5 });
K.codeCard(p, s, {
  x: 8.0, y: 1.75, w: 4.8, h: 4.9, file: 'lib/stock.js — adjust (shape)', size: 10,
  code: `// BEGIN
const lvl = getLevel(productId);
const delta = Number(input.delta);
const result = lvl.quantity + delta;

upsertLevel(productId, result);
insertMovement({
  productId, delta,
  resulting: result,
  reason: input.reason || '',
  source:  input.source || 'manual',
});
touchStore(storeId);      // cache purge
// COMMIT`,
});

// 3 · endpoints
s = p.addSlide();
K.header(s, { kicker: 'Owner endpoints', title: 'Two verbs, one ledger', system: SYSTEM, page: 3 });
K.table(p, s, {
  x: M, y: 1.75, w: W - 2 * M, colW: [3.4, 2.2, 7.8], size: 11.5,
  rows: [
    ['Endpoint', 'Body', 'Behavior'],
    ['POST /api/stores/:id/stock/adjust', '{ productId, delta, reason? }', 'delta applied (can be negative); movement recorded with source "manual"'],
    ['POST /api/stores/:id/stock/set', '{ productId, quantity, reason? }', 'absolute set; delta computed so the ledger stays truthful'],
    ['GET /api/stores/:id/stock', '—', 'levels joined with products + locations for the dashboard table'],
  ],
});
s.addText('Both write endpoints validate ownership of the product (through the store spine) and bump the store for cache purge.', { x: M, y: 4.6, w: W - 2 * M, h: 0.4, fontSize: 11.5, fontFace: F.body, color: C.MUTED, margin: 0 });

// 4 · integrations flow
s = p.addSlide();
K.header(s, { kicker: 'Integrations', title: 'Connect once, sync on demand', system: SYSTEM, page: 4 });
K.flow(p, s, {
  x: M, y: 1.75, w: W - 2 * M, bh: 1.1,
  steps: [
    { t: 'Save credentials', d: 'per provider form, stored on the integration row' },
    { t: 'Sync now', d: 'adapter fetchProducts(creds)' },
    { t: 'Normalise', d: 'common shape: sku, barcode, name, brand, price, quantity' },
    { t: 'Upsert', d: 'match by sku → barcode → name' },
    { t: 'Report', d: 'created / updated counts, last_sync_at, last_error' },
  ],
});
K.bullets(s, [
  'One integration row per (store, provider) — UNIQUE constraint; re-saving credentials updates in place.',
  'Quantities from the provider flow through the same ledger as manual edits (source = provider name).',
  'The store bumps its cache/ETag on sync, so shopper-facing prices update immediately.',
], { x: M, y: 3.3, w: W - 2 * M, h: 1.7, size: 12.5 });

// 5 · providers
s = p.addSlide();
K.header(s, { kicker: 'Providers', title: 'Eight adapters, one interface', system: SYSTEM, page: 5 });
K.table(p, s, {
  x: M, y: 1.7, w: W - 2 * M, colW: [3.2, 4.4, 5.8], size: 11,
  rows: [
    ['Provider', 'Auth', 'Notes'],
    ['Square', 'access token (+ location)', 'catalog list + inventory counts, sandbox option'],
    ['Shopify', 'Admin API token', 'products.json pagination via Link headers'],
    ['Lightspeed (Vend)', 'domain prefix + token', 'X-Series products & inventory'],
    ['Clover', 'merchant + token', 'items and stock counts'],
    ['Katana MRP', 'API token', 'inventory + products'],
    ['Zoho Inventory', 'region + token', 'region selects the data-center domain'],
    ['ERPNext', 'base URL + key:secret', 'self-hosted friendly'],
    ['StockTrack / CSV', 'endpoint / paste', 'generic adapter + pasted CSV for everything else'],
  ],
});
s.addText('Adapters receive fetchImpl as a parameter — tests inject a mock transport, no network needed (8 integration tests).', { x: M, y: 6.35, w: W - 2 * M, h: 0.4, fontSize: 11.5, fontFace: F.body, color: C.MUTED, margin: 0 });

// 6 · SSRF watch-out
s = p.addSlide();
K.header(s, { kicker: 'Watch-outs', title: 'Honest findings from the code review', system: SYSTEM, page: 6 });
K.bullets(s, [
  { t: 'SSRF surface:', bold: true },
  'Adapter URLs are built from user-supplied credentials (shopDomain, baseUrl…) with no host allowlist — a signed-in user can point a sync at internal services.',
  'Error messages reflect up to 200 chars of the provider response body — an internal payload could leak back to the attacker.',
  'Adapter fetches have no timeout; a hanging provider pins the request.',
  { t: 'Planned fixes:', bold: true },
  'Allowlist per-provider host suffixes (.myshopify.com, .vendhq.com…), https-only absolute URLs, private-range blocking, and AbortSignal.timeout on every fetch.',
  { t: 'Also tracked: the v1 API accepts negative prices (the UI route rejects them) — clamp at the adapter/upsert layer.', bold: false },
], { x: M, y: 1.75, w: W - 2 * M, h: 4.6, size: 12.5 });

// 7 · CSV
s = p.addSlide();
K.header(s, { kicker: 'CSV', title: 'The universal interchange', system: SYSTEM, page: 7 });
K.bullets(s, [
  'Export: GET /api/stores/:id/catalog.csv streams the catalog in a stable column order — sku, barcode, name, brand, price, quantity, category, location…',
  'Import: paste CSV in the Stock tab; parseCsv maps headers tolerantly and runs the same upsert path as providers.',
  'Round-trip tested: export → import preserves the catalog (integration tests).',
], { x: M, y: 1.75, w: 7.3, h: 2.2, size: 12.5 });
K.codeCard(p, s, {
  x: 8.0, y: 1.75, w: 4.8, h: 3.4, file: 'catalog.csv (export, sample)', size: 10,
  code: `sku,barcode,name,brand,price,quantity,…
DAI-001,,Organic Whole Milk 1L,GreenVale,3.49,14,…
DAI-002,,Oat Drink Barista 1L,Meadow,2.79,8,…
SNA-017,,Sea Salt Crisps 150g,Olympus,1.99,32,…`,
});
K.chip(p, s, {
  x: M, y: 4.35, w: 7.3, label: 'Watch out',
  text: 'CSV cells are not formula-neutralized (=, +, - prefixes) — values are owner-controlled and owner-facing, but worth adding before wider exports.',
});

// 8 · v1 API
s = p.addSlide();
K.header(s, { kicker: 'StockTrack v1', title: 'A key-based API any system can talk to', system: SYSTEM, page: 8 });
K.table(p, s, {
  x: M, y: 1.75, w: W - 2 * M, colW: [4.2, 9.2], size: 11.5,
  rows: [
    ['Endpoint', 'Behavior'],
    ['GET /api/v1/store', 'the key\'s store profile (name, slug, currency…)'],
    ['GET /api/v1/products', 'full catalog with stock levels'],
    ['GET /api/v1/stock', 'levels only (light payload for polling)'],
    ['POST /api/v1/products', 'upsert product + stock in one call — matched by sku → barcode → name'],
    ['POST /api/v1/stock/adjust · /set', 'ledger movements with source "api"'],
    ['GET /api/v1/map', 'the public map payload (fixtures, pins) for kiosk or third-party UIs'],
  ],
});
K.bullets(s, [
  'Auth: Authorization: Bearer skm_… or X-API-Key; keys are stored as hashes (key_hash UNIQUE) with a visible prefix for the dashboard list.',
  'Every lookup re-scopes by the key\'s store_id; revoking a key kills access instantly (tested).',
  'last_used_at updates per request — the dashboard shows which integrations are actually alive.',
], { x: M, y: 5.05, w: W - 2 * M, h: 1.6, size: 12 });

K.closing(p, {
  title: 'Stock rules this system keeps',
  system: SYSTEM,
  points: [
    { t: 'The ledger is the truth', d: 'every change — manual, POS, CSV, API — is a movement with a resulting quantity.' },
    { t: 'Adapters are swappable', d: 'one normalised shape; fetchImpl injection makes them testable without network.' },
    { t: 'External access is scoped and revocable', d: 'hashed keys, store-scoped queries, instant revocation.' },
    { t: 'Findings are tracked', d: 'SSRF hardening and negative-price clamping are documented, owned fixes.' },
  ],
});

p.writeFile({ fileName: '08-stock-integrations-v1.pptx' }).then(() => console.log('ok 08'));
