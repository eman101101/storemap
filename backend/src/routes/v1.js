/**
 * Public "StockTrack" API v1 — the independent tracking surface any external
 * system (POS, e-commerce, spreadsheet tooling, other StoreMap stores) can use
 * with a store API key. Auth: `Authorization: Bearer skm_…` or `X-API-Key`.
 */
import { Router } from 'express';
import { db } from '../db.js';
import { handler, sendJson, badRequest } from '../lib/http.js';
import { rateLimit } from '../lib/http.js';
import { storeForApiKey, keyFromRequest, adjustStock, setStock, stockForStore, upsertProduct } from '../lib/stock.js';

const router = Router();

function requireApiKey(req, res, next) {
  const store = storeForApiKey(keyFromRequest(req));
  if (!store) {
    res.set('WWW-Authenticate', 'Bearer realm="stocktrack-v1"');
    return sendJson(res, 401, { error: 'A valid API key is required (Authorization: Bearer skm_…)' });
  }
  req.store = store;
  next();
}

router.use(rateLimit({ windowMs: 60_000, max: 300 }));
router.use(requireApiKey);

/** GET /api/v1/store — basic info about the keyed store. */
router.get('/store', handler(async (req, res) => {
  sendJson(res, 200, {
    store: { id: req.store.id, name: req.store.name, slug: req.store.slug },
  });
}));

/** GET /api/v1/products */
router.get('/products', handler(async (req, res) => {
  const products = db
    .prepare(
      `SELECT p.id, p.name, p.brand, p.sku, p.barcode, p.price, c.name AS category_name
       FROM products p LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.store_id = ? ORDER BY p.name COLLATE NOCASE`
    )
    .all(req.store.id);
  sendJson(res, 200, { products });
}));

/** GET /api/v1/stock — stock levels; include_products=1 merges product fields. */
router.get('/stock', handler(async (req, res) => {
  const stock = stockForStore(req.store.id);
  const items = stock.map((s) =>
    req.query.include_products
      ? s
      : { product_id: s.product_id, sku: s.sku, barcode: s.barcode, quantity: s.quantity ?? 0 }
  );
  sendJson(res, 200, { items });
}));

/**
 * POST /api/v1/products — upsert by sku/barcode/name.
 * Body: { sku?, barcode?, name, brand?, price?, quantity? }
 */
router.post('/products', handler(async (req, res) => {
  const b = req.body ?? {};
  if (!b || typeof b !== 'object') return badRequest(res, 'JSON body required');
  try {
    const result = upsertProduct(req.store.id, b, { source: 'api' });
    if (!result) return badRequest(res, 'Provide at least one of name, sku or barcode');
    sendJson(res, result.created ? 201 : 200, result);
  } catch (err) {
    return badRequest(res, err.message);
  }
}));

/** POST /api/v1/stock/adjust — { product_id?, sku?, barcode?, delta, reason? } */
router.post('/stock/adjust', handler(async (req, res) => {
  const productId = await resolveProduct(req, res);
  if (!productId) return;
  const delta = Number(req.body?.delta);
  if (!Number.isFinite(delta)) return badRequest(res, 'delta must be a number');
  try {
    const level = adjustStock(req.store.id, productId, delta, {
      reason: req.body?.reason,
      source: String(req.body?.source || 'api').slice(0, 40),
    });
    sendJson(res, 200, { level });
  } catch (err) {
    return badRequest(res, err.message);
  }
}));

/** POST /api/v1/stock/set — { product_id?|sku?|barcode?, quantity } absolute count. */
router.post('/stock/set', handler(async (req, res) => {
  const productId = await resolveProduct(req, res);
  if (!productId) return;
  const quantity = Number(req.body?.quantity);
  if (!Number.isFinite(quantity) || quantity < 0) return badRequest(res, 'quantity must be a non-negative number');
  try {
    const level = setStock(req.store.id, productId, quantity, {
      reason: req.body?.reason,
      source: String(req.body?.source || 'api').slice(0, 40),
    });
    sendJson(res, 200, { level });
  } catch (err) {
    return badRequest(res, err.message);
  }
}));

/** GET /api/v1/map — floors + elements so external tools can draw or verify layouts. */
router.get('/map', handler(async (req, res) => {
  const floors = db.prepare('SELECT id, name, level, width_m, height_m FROM floors WHERE store_id = ?').all(req.store.id);
  const ids = floors.map((f) => f.id);
  const elements = ids.length
    ? db.prepare(
        `SELECT id, floor_id, type, shape, geometry, label, color, meta, z_index
         FROM map_elements WHERE floor_id IN (${ids.map(() => '?').join(',')})`
      ).all(...ids)
    : [];
  sendJson(res, 200, { floors, elements });
}));

/** Resolve req.body.product_id | sku | barcode to a product of this store. */
function resolveProduct(req, res) {
  const b = req.body ?? {};
  let row = null;
  if (b.product_id) row = db.prepare('SELECT id FROM products WHERE id = ? AND store_id = ?').get(String(b.product_id), req.store.id);
  if (!row && b.sku) row = db.prepare('SELECT id FROM products WHERE store_id = ? AND sku = ?').get(req.store.id, String(b.sku));
  if (!row && b.barcode) row = db.prepare('SELECT id FROM products WHERE store_id = ? AND barcode = ?').get(req.store.id, String(b.barcode));
  if (!row) {
    badRequest(res, 'Unknown product: pass product_id, sku or barcode');
    return null;
  }
  return row.id;
}

export default router;
