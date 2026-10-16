/** CSV interchange for the catalog: paste-import and export. Provider
 *  integrations were removed — CSV and the v1 API are the ways in. */
import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth/session.js';
import { handler, sendJson, badRequest } from '../lib/http.js';
import { ownedStore } from '../lib/ownership.js';
import { rowsFromCsv, toCsv } from '../lib/stocksoft/csv.js';
import { upsertProduct } from '../lib/stock.js';

const router = Router();
router.use(requireAuth);

/** POST /api/stores/:storeId/integrations/csv — paste CSV, upsert the catalog. */
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
