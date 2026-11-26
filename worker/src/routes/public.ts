/** Public shopper routes (port of backend/src/routes/public.js). */
import { Hono } from 'hono';
import type { AppEnv, Env } from '../config';
import { all, first, run } from '../db';
import { json, badRequest } from '../http';
import { cachedJson } from '../cache';
import { ftsExpression } from '../search';
import { locationJson } from './catalog';

const app = new Hono<AppEnv>();

/**
 * A store's generated catalogue once one is loaded (scripts/load-demo-catalog.mjs
 * writes the record; backend/scripts/demo-catalog.mjs makes the catalogue):
 * how many SKUs the store carries and the first SKU of the generated part.
 */
interface CatalogMarker {
  products: number;
  fromSku: string;
  locations: number;
  version: number;
}
const CATALOG_KEY = (slug: string) => `seed:catalog:${slug}`;

async function catalogMarker(env: Env, slug: string): Promise<CatalogMarker | null> {
  const row = await first(env, 'SELECT value FROM app_settings WHERE key = ?', CATALOG_KEY(slug));
  if (!row) return null;
  try {
    const marker = JSON.parse(String(row.value));
    return typeof marker?.products === 'number' && typeof marker?.fromSku === 'string' ? marker : null;
  } catch {
    return null;
  }
}

/** Public store directory search. */
app.get('/stores', async (c) => {
  const env = c.env as Env;
  const q = String(c.req.query('q') || '').trim().slice(0, 100);
  const SELECT = `SELECT s.id, s.name, s.slug, s.address, s.description, s.logo_url,
     (SELECT COUNT(*) FROM floors f WHERE f.store_id = s.id) AS floor_count,
     COALESCE((SELECT json_extract(value, '$.products') FROM app_settings WHERE key = 'seed:catalog:' || s.slug),
              (SELECT COUNT(*) FROM products p WHERE p.store_id = s.id)) AS product_count
   FROM stores s`;
  let rows;
  if (q) {
    const like = `%${q}%`;
    rows = await all(
      env,
      `${SELECT} WHERE s.is_public = 1 AND (s.name LIKE ? OR s.address LIKE ? OR s.description LIKE ?)
       ORDER BY s.name COLLATE NOCASE LIMIT 30`,
      like, like, like
    );
  } else {
    rows = await all(env, `${SELECT} WHERE s.is_public = 1 ORDER BY s.name COLLATE NOCASE LIMIT 30`);
  }
  return json(c, 200, { stores: rows });
});

/** Full public map payload for the shopper viewer. */
async function publicStorePayload(env: Env, slug: string) {
  const store = await first(env, 'SELECT * FROM stores WHERE slug = ? AND is_public = 1', slug);
  if (!store) return null;
  const { owner_id, is_public, ...pub } = store;
  const floors = await all(
    env,
    'SELECT id, name, level, width_m, height_m, background_url FROM floors WHERE store_id = ? ORDER BY level ASC',
    store.id
  );
  const floorIds = floors.map((f) => f.id as string);
  const elements = floorIds.length
    ? await all(
        env,
        `SELECT id, floor_id, type, shape, geometry, label, color, meta, z_index
         FROM map_elements WHERE floor_id IN (${floorIds.map(() => '?').join(',')})
         ORDER BY z_index ASC, rowid ASC`,
        ...floorIds
      )
    : [];
  const categories = await all(env, 'SELECT id, name, color, icon FROM categories WHERE store_id = ? ORDER BY name', store.id);
  // A loaded catalogue is far too big to ship inline (120,000 SKUs is tens of
  // MB): the payload then carries the demo's own items only and says so in
  // `catalog`, and the viewer asks for shelf windows and searches through the
  // routes below instead.
  const catalog = await catalogMarker(env, slug);
  const own = catalog ? ' AND p.sku < ?' : '';
  const ownFrom = catalog ? [catalog.fromSku] : [];
  const products = await all(
    env,
    `SELECT p.id, p.name, p.brand, p.sku, p.description, p.price, p.image_url, p.image_crop_url,
            c.name AS category_name, c.color AS category_color
     FROM products p LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.store_id = ?${own} ORDER BY p.name COLLATE NOCASE`,
    store.id,
    ...ownFrom
  );
  const locations = await all(
    env,
    `SELECT l.id, l.product_id, l.floor_id, l.x, l.y, l.meta
     FROM product_locations l JOIN products p ON p.id = l.product_id
     WHERE p.store_id = ?${own}`,
    store.id,
    ...ownFrom
  );
  return { store: pub, floors, elements, categories, products, locations: locations.map(locationJson), catalog };
}

app.get('/stores/:slug', async (c) => {
  const env = c.env as Env;
  const slug = String(c.req.param('slug')).slice(0, 120);
  // Edge-cached (5 min, purged on edit — see src/cache.ts): repeat shopper
  // loads never touch D1. The view counter below therefore counts origin
  // hits only, which keeps it a stable relative signal.
  return cachedJson(c, `/api/public/stores/${slug}`, async () => {
    const payload = await publicStorePayload(env, slug);
    if (!payload) return json(c, 404, { error: 'Store not found' });
    await run(env, 'UPDATE stores SET views = views + 1 WHERE id = ?', payload.store.id);
    return json(c, 200, payload);
  });
});

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

app.get('/stores/:slug/search', async (c) => {
  const env = c.env as Env;
  const slug = String(c.req.param('slug')).slice(0, 120);
  const q = String(c.req.query('q') || '').trim().slice(0, 100);
  const store = await first(env, 'SELECT id FROM stores WHERE slug = ? AND is_public = 1', slug);
  if (!store) return json(c, 404, { error: 'Store not found' });
  if (!q) return json(c, 200, { results: [] });

  // FTS5 path: inverted-index prefix match — a keystroke is an index lookup,
  // not a catalog scan (see backend migration 006 / lib/search.js).
  const match = ftsExpression(q);
  // Alphabetical order is the usual one; a loaded catalogue orders by
  // relevance instead, since sorting every match of a 120,000-SKU store by
  // name means reading them all.
  const order = (await catalogMarker(env, slug)) ? 'rank' : 'p.name COLLATE NOCASE';
  let results;
  if (match) {
    results = await all(
      env,
      `${SEARCH_SELECT}
       JOIN products_fts fts ON fts.rowid = p.rowid
       WHERE products_fts MATCH ? AND p.store_id = ?
       GROUP BY p.id
       ORDER BY ${order} LIMIT 40`,
      match, store.id
    );
  } else {
    const like = `%${q}%`;
    const where = SEARCH_FIELDS.map((f) => `${f} LIKE ?`).join(' OR ');
    results = await all(
      env,
      `${SEARCH_SELECT}
       WHERE p.store_id = ? AND (${where} OR c.name LIKE ?)
       GROUP BY p.id
       ORDER BY ${order} LIMIT 40`,
      store.id, like, like, like, like, `%${q}%`
    );
  }
  return json(c, 200, { results });
});

/** The public store a request is about, or the 404 to return in its place. */
async function publicStore(c: any, env: Env, slug: string): Promise<{ id: string } | Response> {
  const store = await first(env, 'SELECT id FROM stores WHERE slug = ? AND is_public = 1', slug);
  return store ? { id: String(store.id) } : json(c, 404, { error: 'Store not found' });
}

/** A facing with its product, as the planogram window and product routes return them. */
const FACING_SELECT = `SELECT l.id AS location_id, l.product_id, l.floor_id, l.x, l.y, l.meta,
        p.name, p.brand, p.sku, p.price, p.image_url, p.image_crop_url, p.description,
        c.name AS category_name, c.color AS category_color
 FROM product_locations l
 JOIN products p ON p.id = l.product_id
 LEFT JOIN categories c ON c.id = p.category_id`;

const facingJson = (row: Record<string, unknown>) => ({
  location: locationJson({
    id: row.location_id, product_id: row.product_id, floor_id: row.floor_id, x: row.x, y: row.y, meta: row.meta,
  }),
  // the item, shaped as the store payload's items are
  product: {
    id: String(row.product_id),
    name: row.name, brand: row.brand, sku: row.sku, price: row.price,
    image_url: row.image_url, image_crop_url: row.image_crop_url, description: row.description,
    category_name: row.category_name, category_color: row.category_color,
  },
});

/**
 * The planogram window of one shelf: the stretch of shelf around a place
 * (`u`, 0..1 from the left end), a few facings either side on each level —
 * not the whole shelf, which may hold thousands. `levels` says how many
 * facings each level carries, so the caller can lay the window out to scale.
 */
app.get('/stores/:slug/shelves/:shelfId/window', async (c) => {
  const env = c.env as Env;
  const slug = String(c.req.param('slug')).slice(0, 120);
  const shelfId = String(c.req.param('shelfId')).slice(0, 80);
  const u = Math.min(1, Math.max(0, Number(c.req.query('u') ?? 0.5)) || 0);
  const each = Math.min(30, Math.max(1, Math.round(Number(c.req.query('each') ?? 8)) || 8));
  const store = await publicStore(c, env, slug);
  if (store instanceof Response) return store;
  // the shelf must be this store's own
  const shelf = await first(
    env,
    `SELECT e.id FROM map_elements e JOIN floors f ON f.id = e.floor_id
     WHERE e.id = ? AND f.store_id = ? AND e.type = 'shelf'`,
    shelfId, store.id
  );
  if (!shelf) return json(c, 404, { error: 'Shelf not found' });

  const WHERE = `json_extract(l.meta, '$.shelfId') = ? AND json_extract(l.meta, '$.u') IS NOT NULL`;
  const levelRows = await all(
    env,
    `SELECT json_extract(l.meta, '$.shelf_level') AS level, COUNT(*) AS n FROM product_locations l WHERE ${WHERE} GROUP BY 1`,
    shelfId
  );
  const levels = levelRows.map((r) => ({ level: Number(r.level), count: Number(r.n) }));
  // the stretch of shelf that holds `each` facings a side on its fullest level
  const fullest = Math.max(1, ...levels.map((l) => l.count));
  const span = (each + 0.5) / fullest;
  const from = Math.max(0, u - span);
  const to = Math.min(1, u + span);
  const rows = levels.length
    ? await all(
        env,
        `${FACING_SELECT}
         WHERE ${WHERE} AND json_extract(l.meta, '$.u') >= ? AND json_extract(l.meta, '$.u') <= ?
         ORDER BY json_extract(l.meta, '$.shelf_level'), json_extract(l.meta, '$.u')`,
        shelfId, from, to
      )
    : [];
  return json(c, 200, { shelfId, u, from, to, levels, slots: rows.map(facingJson) });
});

/** A product with everywhere it faces — for an item the payload did not carry. */
app.get('/stores/:slug/products/:id', async (c) => {
  const env = c.env as Env;
  const slug = String(c.req.param('slug')).slice(0, 120);
  const id = String(c.req.param('id')).slice(0, 80);
  const store = await publicStore(c, env, slug);
  if (store instanceof Response) return store;
  const rows = await all(env, `${FACING_SELECT} WHERE p.store_id = ? AND p.id = ? ORDER BY l.rowid`, store.id, id);
  if (!rows.length) return json(c, 404, { error: 'Product not found' });
  return json(c, 200, { product: facingJson(rows[0]!).product, facings: rows.map(facingJson) });
});

export default app;
