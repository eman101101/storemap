/** Stock tracking core — shared by owner routes, the public v1 API and integrations. */
import { db, newId } from '../db.js';
import { createHash, randomBytes } from 'node:crypto';

/**
 * Apply a signed delta to a product's stock level and log the movement.
 * Creates the level row lazily. Returns the new level row, or null if the
 * product doesn't belong to the store.
 */
export function adjustStock(storeId, productId, delta, { reason = '', source = 'manual' } = {}) {
  const product = db
    .prepare('SELECT id FROM products WHERE id = ? AND store_id = ?')
    .get(String(productId), String(storeId));
  if (!product) return null;

  const d = Number(delta);
  if (!Number.isFinite(d)) throw new Error('delta must be a number');

  db.exec('BEGIN');
  try {
    db.prepare('INSERT OR IGNORE INTO stock_levels (product_id, quantity) VALUES (?, 0)').run(product.id);
    db.prepare(
      `UPDATE stock_levels SET quantity = quantity + ?, updated_at = datetime('now') WHERE product_id = ?`
    ).run(d, product.id);
    const level = db.prepare('SELECT * FROM stock_levels WHERE product_id = ?').get(product.id);
    db.prepare(
      `INSERT INTO stock_movements (id, product_id, delta, resulting_quantity, reason, source)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(newId(), product.id, d, level.quantity, String(reason).slice(0, 200), String(source).slice(0, 40));
    db.exec('COMMIT');
    return level;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** Set an absolute quantity (logged as the delta that produced it). */
export function setStock(storeId, productId, quantity, { reason = '', source = 'manual' } = {}) {
  const level = db
    .prepare(
      `SELECT sl.quantity FROM stock_levels sl JOIN products p ON p.id = sl.product_id
       WHERE sl.product_id = ? AND p.store_id = ?`
    )
    .get(String(productId), String(storeId));
  const current = level?.quantity ?? 0;
  if (!Number.isFinite(Number(quantity))) throw new Error('quantity must be a number');
  return adjustStock(storeId, productId, Number(quantity) - current, { reason, source });
}

/** All stock levels for a store, joined with product info. */
export function stockForStore(storeId) {
  return db
    .prepare(
      `SELECT p.id AS product_id, p.name, p.sku, p.barcode, c.name AS category_name,
              sl.quantity, sl.reorder_point, sl.updated_at
       FROM products p
       LEFT JOIN stock_levels sl ON sl.product_id = p.id
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.store_id = ? ORDER BY p.name COLLATE NOCASE`
    )
    .all(String(storeId));
}

/** Recent movements for a store (newest first). */
export function movementsForStore(storeId, limit = 50) {
  return db
    .prepare(
      `SELECT m.id, m.product_id, p.name AS product_name, m.delta, m.resulting_quantity,
              m.reason, m.source, m.created_at
       FROM stock_movements m JOIN products p ON p.id = m.product_id
       WHERE p.store_id = ? ORDER BY m.created_at DESC, m.rowid DESC LIMIT ?`
    )
    .all(String(storeId), Math.max(1, Math.min(Number(limit) || 50, 200)));
}

/**
 * Upsert a product by SKU (then barcode, then name) and optionally set its stock.
 * Returns { product, created, level }. Used by integrations sync and the v1 API.
 */
export function upsertProduct(storeId, input, { source = 'api' } = {}) {
  const s = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const sku = s(input.sku, 60);
  const barcode = s(input.barcode, 60);
  const name = s(input.name);
  if (!name && !sku && !barcode) return null;

  let existing = null;
  if (sku) existing = db.prepare('SELECT * FROM products WHERE store_id = ? AND sku = ?').get(storeId, sku);
  if (!existing && barcode)
    existing = db.prepare('SELECT * FROM products WHERE store_id = ? AND barcode = ?').get(storeId, barcode);
  if (!existing && name && !sku && !barcode)
    existing = db.prepare('SELECT * FROM products WHERE store_id = ? AND name = ? AND sku = ?').get(storeId, name, '');

  let product;
  let created = false;
  if (existing) {
    db.prepare(
      `UPDATE products SET
         name = COALESCE(NULLIF(?, ''), name),
         brand = COALESCE(NULLIF(?, ''), brand),
         price = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      name,
      s(input.brand, 100),
      Number.isFinite(Number(input.price)) && input.price !== null && input.price !== '' ? Number(input.price) : existing.price,
      existing.id
    );
    product = db.prepare('SELECT * FROM products WHERE id = ?').get(existing.id);
  } else {
    if (!name) return null;
    const id = newId();
    db.prepare(
      `INSERT INTO products (id, store_id, name, brand, sku, barcode, price) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, storeId, name, s(input.brand, 100), sku, barcode, Number(input.price) || null);
    product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    created = true;
  }

  let level = null;
  if (input.quantity !== undefined && input.quantity !== null && Number.isFinite(Number(input.quantity))) {
    const cur = db.prepare('SELECT quantity FROM stock_levels WHERE product_id = ?').get(product.id);
    const q = Number(input.quantity);
    level =
      cur === undefined
        ? adjustStock(storeId, product.id, q, { reason: 'import', source })
        : setStock(storeId, product.id, q, { reason: 'import', source });
  }
  return { product, created, level };
}

/* ---------------- API keys ---------------- */

export function hashKey(key) {
  return createHash('sha256').update(key).digest('hex');
}

export function generateApiKey() {
  const secret = randomBytes(24).toString('hex');
  return { key: `skm_${secret}`, prefix: `skm_${secret.slice(0, 6)}` };
}

/** Resolve an API key to its store, or null. Also stamps last_used_at. */
export function storeForApiKey(rawKey) {
  if (typeof rawKey !== 'string' || !rawKey.startsWith('skm_')) return null;
  const row = db
    .prepare(
      `SELECT k.id AS key_id, s.* FROM store_api_keys k
       JOIN stores s ON s.id = k.store_id
       WHERE k.key_hash = ? AND k.revoked = 0`
    )
    .get(hashKey(rawKey));
  if (!row) return null;
  db.prepare('UPDATE store_api_keys SET last_used_at = datetime(\'now\') WHERE id = ?').run(row.key_id);
  return row;
}

/** Extract a key from Authorization: Bearer … or X-API-Key. */
export function keyFromRequest(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  const header = req.headers['x-api-key'];
  return typeof header === 'string' ? header.trim() : null;
}
