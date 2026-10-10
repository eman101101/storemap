/** Stock-software integrations: connect a provider, sync its catalog/stock, CSV in/out. */
import { Router } from 'express';
import { db, newId } from '../db.js';
import { requireAuth } from '../auth/session.js';
import { handler, sendJson, badRequest, notFound } from '../lib/http.js';
import { ownedStore } from '../lib/ownership.js';
import { PROVIDERS, providerList, rowsFromCsv } from '../lib/stocksoft/index.js';
import { toCsv } from '../lib/stocksoft/csv.js';
import { upsertProduct } from '../lib/stock.js';
import { encStr, decStr } from '../lib/secretbox.js';

const router = Router();
router.use(requireAuth);

/** GET /api/stores/:storeId/integrations — available providers + this store's connections. */
router.get('/:storeId/integrations', handler(async (req, res) => {
  const store = ownedStore(req, res, req.params.storeId);
  if (!store) return;
  const connections = db
    .prepare(
      `SELECT id, provider, last_sync_at, last_error, created_at FROM integrations WHERE store_id = ?`
    )
    .all(store.id);
  sendJson(res, 200, { providers: providerList(), connections });
}));

/** POST /api/stores/:storeId/integrations — save credentials for a provider. */
router.post('/:storeId/integrations', handler(async (req, res) => {
  const store = ownedStore(req, res, req.params.storeId);
  if (!store) return;
  const provider = String(req.body?.provider || '');
  if (!PROVIDERS[provider]) return badRequest(res, `Unknown provider: ${provider}`);
  const creds = req.body?.credentials;
  if (!creds || typeof creds !== 'object') return badRequest(res, 'credentials object required');
  // Validate required fields so a broken sync fails fast with a clear message.
  for (const f of PROVIDERS[provider].fields) {
    if (f.required && !String(creds[f.key] ?? '').trim()) {
      return badRequest(res, `Missing credential: ${f.label}`);
    }
  }
  const id = newId();
  // Credentials are encrypted at rest (lib/secretbox) — the DB alone yields nothing.
  db.prepare(
    `INSERT INTO integrations (id, store_id, provider, credentials, config)
     VALUES (?, ?, ?, ?, '{}')
     ON CONFLICT (store_id, provider) DO UPDATE SET credentials = excluded.credentials, last_error = ''`
  ).run(id, store.id, provider, encStr(JSON.stringify(creds)));
  const row = db.prepare('SELECT id, provider, last_sync_at, created_at FROM integrations WHERE store_id = ? AND provider = ?').get(store.id, provider);
  sendJson(res, 201, { connection: row });
}));

router.delete('/:storeId/integrations/:integrationId', handler(async (req, res) => {
  const store = ownedStore(req, res, req.params.storeId);
  if (!store) return;
  const row = db
    .prepare('SELECT id FROM integrations WHERE id = ? AND store_id = ?')
    .get(String(req.params.integrationId), store.id);
  if (!row) return notFound(res, 'Integration not found');
  db.prepare('DELETE FROM integrations WHERE id = ?').run(row.id);
  sendJson(res, 200, { ok: true });
}));

/**
 * POST /api/stores/:storeId/integrations/:integrationId/sync
 * Pull products (and stock where the provider exposes it) and upsert them.
 */
router.post('/:storeId/integrations/:integrationId/sync', handler(async (req, res) => {
  const store = ownedStore(req, res, req.params.storeId);
  if (!store) return;
  const integ = db
    .prepare('SELECT * FROM integrations WHERE id = ? AND store_id = ?')
    .get(String(req.params.integrationId), store.id);
  if (!integ) return notFound(res, 'Integration not found');
  const provider = PROVIDERS[integ.provider];
  if (!provider) return badRequest(res, `Unknown provider: ${integ.provider}`);

  const creds = JSON.parse(decStr(integ.credentials) || '{}');
  try {
    let rows;
    if (integ.provider === 'csv') {
      rows = rowsFromCsv(String(req.body?.csv ?? ''));
    } else {
      rows = await provider.fetchProducts(creds, fetch);
    }
    let imported = 0;
    for (const row of rows) {
      const result = upsertProduct(store.id, row, { source: `sync:${integ.provider}` });
      if (result) imported += 1;
    }
    db.prepare(`UPDATE integrations SET last_sync_at = datetime('now'), last_error = '' WHERE id = ?`).run(integ.id);
    sendJson(res, 200, { imported, total: rows.length });
  } catch (err) {
    db.prepare(`UPDATE integrations SET last_error = ? WHERE id = ?`).run(String(err.message).slice(0, 500), integ.id);
    return sendJson(res, 502, { error: `Sync failed: ${err.message}` });
  }
}));

/** POST /api/stores/:storeId/integrations/csv — one-shot CSV import without saving a connection. */
router.post('/:storeId/integrations/csv', handler(async (req, res) => {
  const store = ownedStore(req, res, req.params.storeId);
  if (!store) return;
  const rows = rowsFromCsv(String(req.body?.csv ?? ''));
  if (!rows.length) return badRequest(res, 'No rows found in CSV (need a header row with name/sku columns)');
  let imported = 0;
  for (const row of rows) {
    const result = upsertProduct(store.id, row, { source: 'sync:csv' });
    if (result) imported += 1;
  }
  sendJson(res, 200, { imported, total: rows.length });
}));

/** GET /api/stores/:storeId/catalog.csv — export the catalog + stock in the interchange format. */
router.get('/:storeId/catalog.csv', handler(async (req, res) => {
  const store = ownedStore(req, res, req.params.storeId);
  if (!store) return;
  const rows = db
    .prepare(
      `SELECT p.name, p.brand, p.sku, p.barcode, p.price, c.name AS category,
              COALESCE(sl.quantity, '') AS quantity
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN stock_levels sl ON sl.product_id = p.id
       WHERE p.store_id = ? ORDER BY p.name COLLATE NOCASE`
    )
    .all(store.id);
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${store.slug}-catalog.csv"`);
  res.send(toCsv(rows));
}));

export default router;
