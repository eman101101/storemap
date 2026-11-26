import { Router } from 'express';
import { db } from '../db.js';
import { handler, sendJson, badRequest } from '../lib/http.js';
import { edgeCache } from '../lib/cdn.js';
import { ftsExpression } from '../lib/search.js';
import { locationJson } from './catalog.js';

const router = Router();

/** Public store directory search. */
router.get('/stores', handler(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100);
  let rows;
  if (q) {
    const like = `%${q}%`;
    rows = db
      .prepare(
        `SELECT s.id, s.name, s.slug, s.address, s.description, s.logo_url,
           (SELECT COUNT(*) FROM floors f WHERE f.store_id = s.id) AS floor_count,
           COALESCE((SELECT json_extract(value, '$.products') FROM app_settings WHERE key = 'seed:catalog:' || s.slug),
                    (SELECT COUNT(*) FROM products p WHERE p.store_id = s.id)) AS product_count
         FROM stores s
         WHERE s.is_public = 1 AND (s.name LIKE ? OR s.address LIKE ? OR s.description LIKE ?)
         ORDER BY s.name COLLATE NOCASE LIMIT 30`
      )
      .all(like, like, like);
  } else {
    rows = db
      .prepare(
        `SELECT s.id, s.name, s.slug, s.address, s.description, s.logo_url,
           (SELECT COUNT(*) FROM floors f WHERE f.store_id = s.id) AS floor_count,
           COALESCE((SELECT json_extract(value, '$.products') FROM app_settings WHERE key = 'seed:catalog:' || s.slug),
                    (SELECT COUNT(*) FROM products p WHERE p.store_id = s.id)) AS product_count
         FROM stores s WHERE s.is_public = 1 ORDER BY s.name COLLATE NOCASE LIMIT 30`
      )
      .all();
  }
  sendJson(res, 200, { stores: rows });
}));

/**
 * A store's generated catalogue once one is loaded (backend/scripts/seed-demo.mjs
 * writes the record; backend/scripts/demo-catalog.mjs makes the catalogue):
 * how many SKUs the store carries and the first SKU of the generated part.
 */
function catalogMarker(slug) {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(`seed:catalog:${slug}`);
  if (!row) return null;
  try {
    const marker = JSON.parse(row.value);
    return typeof marker?.products === 'number' && typeof marker?.fromSku === 'string' ? marker : null;
  } catch {
    return null;
  }
}

/** Full public map payload for the shopper viewer. */
function publicStorePayload(slug) {
  const store = db.prepare('SELECT * FROM stores WHERE slug = ? AND is_public = 1').get(slug);
  if (!store) return null;
  const { owner_id, is_public, ...pub } = store;
  const floors = db
    .prepare('SELECT id, name, level, width_m, height_m, background_url FROM floors WHERE store_id = ? ORDER BY level ASC')
    .all(store.id);
  const floorIds = floors.map((f) => f.id);
  const elements = floorIds.length
    ? db.prepare(
        `SELECT id, floor_id, type, shape, geometry, label, color, meta, z_index
         FROM map_elements WHERE floor_id IN (${floorIds.map(() => '?').join(',')})
         ORDER BY z_index ASC, rowid ASC`
      ).all(...floorIds)
    : [];
  const categories = db
    .prepare('SELECT id, name, color, icon FROM categories WHERE store_id = ? ORDER BY name')
    .all(store.id);
  // A loaded catalogue is far too big to ship inline (120,000 SKUs is tens of
  // MB): the payload then carries the demo's own items only and says so in
  // `catalog`, and the viewer asks for shelf windows and searches through the
  // routes below instead.
  const catalog = catalogMarker(slug);
  const own = catalog ? ' AND p.sku < ?' : '';
  const ownFrom = catalog ? [catalog.fromSku] : [];
  const products = db
    .prepare(
      `SELECT p.id, p.name, p.brand, p.sku, p.description, p.price, p.image_url, p.image_crop_url,
              c.name AS category_name, c.color AS category_color
       FROM products p LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.store_id = ?${own} ORDER BY p.name COLLATE NOCASE`
    )
    .all(store.id, ...ownFrom);
  const locations = db
    .prepare(
      `SELECT l.id, l.product_id, l.floor_id, l.x, l.y, l.meta
       FROM product_locations l JOIN products p ON p.id = l.product_id
       WHERE p.store_id = ?${own}`
    )
    .all(store.id, ...ownFrom);
  return { store: pub, floors, elements, categories, products, locations: locations.map(locationJson), catalog };
}

router.get('/stores/:slug', handler(async (req, res) => {
  const slug = String(req.params.slug).slice(0, 120);
  const payload = publicStorePayload(slug);
  if (!payload) return sendJson(res, 404, { error: 'Store not found' });
  edgeCache(res, payload.store.id); // CDN: 5 min at the edge, per-store purge tag
  // owner-facing view counter: incremented on origin hits only (edge-cached
  // responses don't reach us), which keeps it a stable relative signal.
  db.prepare('UPDATE stores SET views = views + 1 WHERE id = ?').run(payload.store.id);
  sendJson(res, 200, payload);
}));

const SEARCH_FIELDS = ['p.name', 'p.brand', 'p.sku', 'p.barcode'];
// Each hit comes with where it faces — the location's meta (shelf, level and
// place along the shelf for a generated item) and its shelf's title — so the
// viewer can open the planogram right at the item.
const SEARCH_SELECT = `SELECT p.id, p.name, p.brand, p.sku, p.price, p.image_url,
        c.name AS category_name, c.color AS category_color,
        l.floor_id, l.x, l.y, l.meta AS location_meta, e.label AS shelf_label,
        f.name AS floor_name
 FROM products p
 LEFT JOIN categories c ON c.id = p.category_id
 LEFT JOIN product_locations l ON l.product_id = p.id
 LEFT JOIN map_elements e ON e.id = json_extract(l.meta, '$.shelfId')
 LEFT JOIN floors f ON f.id = l.floor_id`;

router.get('/stores/:slug/search', handler(async (req, res) => {
  const slug = String(req.params.slug).slice(0, 120);
  const q = String(req.query.q || '').trim().slice(0, 100);
  const store = db.prepare('SELECT id FROM stores WHERE slug = ? AND is_public = 1').get(slug);
  if (!store) return sendJson(res, 404, { error: 'Store not found' });
  if (!q) return sendJson(res, 200, { results: [] });

  // FTS5 path: inverted-index prefix match (name, brand, sku, barcode AND
  // category name, denormalized into the index) — a keystroke costs an index
  // lookup instead of a full catalog scan.
  const match = ftsExpression(q);
  // Alphabetical order is the usual one; a loaded catalogue orders by
  // relevance instead, since sorting every match of a 120,000-SKU store by
  // name means reading them all.
  const order = catalogMarker(slug) ? 'rank' : 'p.name COLLATE NOCASE';
  let results;
  if (match) {
    results = db
      .prepare(
        `${SEARCH_SELECT}
         JOIN products_fts fts ON fts.rowid = p.rowid
         WHERE products_fts MATCH ? AND p.store_id = ?
         GROUP BY p.id
         ORDER BY ${order} LIMIT 40`
      )
      .all(match, store.id);
  } else {
    // Fallback for input with no word characters (e.g. "###").
    const like = `%${q}%`;
    const where = SEARCH_FIELDS.map((f) => `${f} LIKE ?`).join(' OR ');
    results = db
      .prepare(
        `${SEARCH_SELECT}
         WHERE p.store_id = ? AND (${where} OR c.name LIKE ?)
         GROUP BY p.id
         ORDER BY ${order} LIMIT 40`
      )
      .all(store.id, like, like, like, like, `%${q}%`);
  }
  sendJson(res, 200, { results });
}));

const FACING_SELECT = `SELECT l.id AS location_id, l.product_id, l.floor_id, l.x, l.y, l.meta,
        p.name, p.brand, p.sku, p.price, p.image_url, p.image_crop_url, p.description,
        c.name AS category_name, c.color AS category_color
 FROM product_locations l
 JOIN products p ON p.id = l.product_id
 LEFT JOIN categories c ON c.id = p.category_id`;

/** A facing with its item — the item shaped as the store payload's items are —
 *  as the planogram window and product routes return them. */
function facingJson(row) {
  return {
    location: locationJson({ id: row.location_id, product_id: row.product_id, floor_id: row.floor_id, x: row.x, y: row.y, meta: row.meta }),
    product: {
      id: String(row.product_id),
      name: row.name, brand: row.brand, sku: row.sku, price: row.price,
      image_url: row.image_url, image_crop_url: row.image_crop_url, description: row.description,
      category_name: row.category_name, category_color: row.category_color,
    },
  };
}

const publicStoreId = (slug) => db.prepare('SELECT id FROM stores WHERE slug = ? AND is_public = 1').get(slug)?.id ?? null;

/**
 * The planogram window of one shelf: the stretch of shelf around a place
 * (`u`, 0..1 from the left end), a few facings either side on each level —
 * not the whole shelf, which may hold thousands. `levels` says how many
 * facings each level carries, so the caller can lay the window out to scale.
 */
router.get('/stores/:slug/shelves/:shelfId/window', handler(async (req, res) => {
  const slug = String(req.params.slug).slice(0, 120);
  const shelfId = String(req.params.shelfId).slice(0, 80);
  const u = Math.min(1, Math.max(0, Number(req.query.u ?? 0.5)) || 0);
  const each = Math.min(30, Math.max(1, Math.round(Number(req.query.each ?? 8)) || 8));
  const storeId = publicStoreId(slug);
  if (!storeId) return sendJson(res, 404, { error: 'Store not found' });
  // the shelf must be this store's own
  const shelf = db
    .prepare(
      `SELECT e.id FROM map_elements e JOIN floors f ON f.id = e.floor_id
       WHERE e.id = ? AND f.store_id = ? AND e.type = 'shelf'`
    )
    .get(shelfId, storeId);
  if (!shelf) return sendJson(res, 404, { error: 'Shelf not found' });

  const WHERE = `json_extract(l.meta, '$.shelfId') = ? AND json_extract(l.meta, '$.u') IS NOT NULL`;
  const levels = db
    .prepare(`SELECT json_extract(l.meta, '$.shelf_level') AS level, COUNT(*) AS n FROM product_locations l WHERE ${WHERE} GROUP BY 1`)
    .all(shelfId)
    .map((r) => ({ level: Number(r.level), count: Number(r.n) }));
  // the stretch of shelf that holds `each` facings a side on its fullest level
  const fullest = Math.max(1, ...levels.map((l) => l.count));
  const span = (each + 0.5) / fullest;
  const from = Math.max(0, u - span);
  const to = Math.min(1, u + span);
  const rows = levels.length
    ? db
        .prepare(
          `${FACING_SELECT}
           WHERE ${WHERE} AND json_extract(l.meta, '$.u') >= ? AND json_extract(l.meta, '$.u') <= ?
           ORDER BY json_extract(l.meta, '$.shelf_level'), json_extract(l.meta, '$.u')`
        )
        .all(shelfId, from, to)
    : [];
  sendJson(res, 200, { shelfId, u, from, to, levels, slots: rows.map(facingJson) });
}));

/** A product with everywhere it faces — for an item the payload did not carry. */
router.get('/stores/:slug/products/:id', handler(async (req, res) => {
  const slug = String(req.params.slug).slice(0, 120);
  const id = String(req.params.id).slice(0, 80);
  const storeId = publicStoreId(slug);
  if (!storeId) return sendJson(res, 404, { error: 'Store not found' });
  const rows = db.prepare(`${FACING_SELECT} WHERE p.store_id = ? AND p.id = ? ORDER BY l.rowid`).all(storeId, id);
  if (!rows.length) return sendJson(res, 404, { error: 'Product not found' });
  sendJson(res, 200, { product: facingJson(rows[0]).product, facings: rows.map(facingJson) });
}));

export default router;
