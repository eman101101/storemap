/** Catalog routes: categories, products, product images, pins (port of catalog.js). */
import { Hono } from 'hono';
import type { AppEnv, Env } from '../config';
import { all, first, run } from '../db';
import { newId } from '../util';
import { json, badRequest, notFound, rateLimit } from '../http';
import { str, num } from '../validate';
import { ownedStore, ownedFloor, touchStore } from '../ownership';
import { productImagesEnabled } from '../entitlements';
import { saveImage, deleteImage } from '../storage';
import { reindexStoreFts } from '../search';
import { roleForStore, roleAtLeast } from '../members';

const app = new Hono<AppEnv>();

const HEX = /^#[0-9a-fA-F]{6}$/;

function productJson(row: Record<string, unknown>) {
  return { ...row, price: row.price ?? null };
}

/**
 * Serialize a product_locations row: the owning shelf travels both in the
 * raw `meta` JSON ({"shelfId": "…"}) and as a top-level `shelfId` field.
 */
export function locationJson(row: Record<string, unknown>) {
  let shelfId: string | null = null;
  try {
    const meta = JSON.parse(String(row.meta || '{}'));
    if (meta && typeof meta.shelfId === 'string') shelfId = meta.shelfId;
  } catch {
    /* unparseable meta → no owner */
  }
  return { ...row, shelfId };
}

const PRODUCT_JOIN = `SELECT p.*, c.name AS category_name, c.color AS category_color
  FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ?`;

async function requireAuth(c: any, next: () => Promise<void>) {
  if (!c.get('user')) return json(c, 401, { error: 'Authentication required' });
  await next();
}

/** Load a category and require at least the `stock` role on its store (edit access). */
async function ownedCategory(c: any, env: Env, id: unknown): Promise<Record<string, unknown> | Response> {
  const row = await first(
    env,
    'SELECT c.*, s.owner_id FROM categories c JOIN stores s ON s.id = c.store_id WHERE c.id = ?',
    String(id)
  );
  const role = row ? await roleForStore(env, c.get('user').id, String(row.store_id)) : null;
  if (!row || !role || !roleAtLeast(role, 'stock')) return notFound(c, 'Category not found');
  return row;
}

/** Load a product and require at least the `stock` role on its store (edit access). */
async function ownedProduct(c: any, env: Env, id: unknown): Promise<Record<string, unknown> | Response> {
  const row = await first(
    env,
    'SELECT p.*, s.owner_id FROM products p JOIN stores s ON s.id = p.store_id WHERE p.id = ?',
    String(id)
  );
  const role = row ? await roleForStore(env, c.get('user').id, String(row.store_id)) : null;
  if (!row || !role || !roleAtLeast(role, 'stock')) return notFound(c, 'Product not found');
  return row;
}

/* ---- Categories ---- */

app.post('/stores/:storeId/categories', requireAuth, async (c) => {
  const env = c.env as Env;
  const store = await ownedStore(c, env, c.req.param('storeId'));
  if (store instanceof Response) return store;
  const body = await c.req.json().catch(() => ({}));
  const name = str(body?.name, { max: 60, allowEmpty: false });
  if (!name) return badRequest(c, 'Category name is required');
  const color = HEX.test(body?.color || '') ? body.color : '#4f7d3f';
  const id = newId();
  await run(env, 'INSERT INTO categories (id, store_id, name, color, icon) VALUES (?, ?, ?, ?, ?)', id, store.id, name, color, str(body?.icon, { max: 16 }));
  return json(c, 201, { category: await first(env, 'SELECT * FROM categories WHERE id = ?', id) });
});

app.patch('/categories/:id', requireAuth, async (c) => {
  const env = c.env as Env;
  const cat = await ownedCategory(c, env, c.req.param('id'));
  if (cat instanceof Response) return cat;
  const body = await c.req.json().catch(() => ({}));
  const updates: Record<string, unknown> = {};
  if (body?.name !== undefined) {
    const name = str(body.name, { max: 60, allowEmpty: false });
    if (!name) return badRequest(c, 'Category name is required');
    updates.name = name;
  }
  if (body?.color !== undefined) {
    if (!HEX.test(body.color || '')) return badRequest(c, 'Color must be a hex value');
    updates.color = body.color;
  }
  if (body?.icon !== undefined) updates.icon = str(body.icon, { max: 16 });
  const keys = Object.keys(updates);
  if (keys.length) {
    await run(env, `UPDATE categories SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => updates[k]), cat.id);
    // Category renames don't fire the product triggers — refresh the search index.
    if (updates.name !== undefined) await reindexStoreFts(env, cat.store_id as string);
  }
  return json(c, 200, { category: await first(env, 'SELECT * FROM categories WHERE id = ?', cat.id) });
});

app.delete('/categories/:id', requireAuth, async (c) => {
  const env = c.env as Env;
  const cat = await ownedCategory(c, env, c.req.param('id'));
  if (cat instanceof Response) return cat;
  await run(env, 'DELETE FROM categories WHERE id = ?', cat.id);
  await reindexStoreFts(env, cat.store_id as string); // FK SET NULL bypasses triggers
  await touchStore(c, env, cat.store_id as string);
  return json(c, 200, { ok: true });
});

/* ---- Products ---- */

app.post('/stores/:storeId/products', requireAuth, async (c) => {
  const env = c.env as Env;
  const store = await ownedStore(c, env, c.req.param('storeId'));
  if (store instanceof Response) return store;
  const body = await c.req.json().catch(() => ({}));
  const name = str(body?.name, { max: 200, allowEmpty: false });
  if (!name) return badRequest(c, 'Product name is required');
  let categoryId: string | null = null;
  if (body?.category_id) {
    const cat = await ownedCategory(c, env, body.category_id);
    if (cat instanceof Response) return cat;
    categoryId = cat.id as string;
  }
  let price: number | null = null;
  if (body?.price !== undefined && body?.price !== null && body?.price !== '') {
    price = num(body.price)!;
    if (price === undefined || price < 0) return badRequest(c, 'Invalid price');
  }
  const id = newId();
  await run(
    env,
    `INSERT INTO products (id, store_id, category_id, name, brand, sku, barcode, description, price, image_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, store.id, categoryId, name,
    str(body?.brand, { max: 100 }), str(body?.sku, { max: 60 }),
    str(body?.barcode, { max: 60 }), str(body?.description, { max: 1000 }),
    price, str(body?.image_url, { max: 400 })
  );
  const product = productJson((await first(env, PRODUCT_JOIN, id))!);
  await touchStore(c, env, store.id);
  return json(c, 201, { product });
});

const IMAGE_TYPES: Record<string, { ext: string; magic: (b: Uint8Array) => boolean }> = {
  'image/png': { ext: '.png', magic: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  'image/jpeg': { ext: '.jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/webp': {
    ext: '.webp',
    magic: (b) =>
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  },
};

const imageLimiter = rateLimit({ windowMs: 60_000, max: 30 });

/** Pay-as-you-go photo accounting: charged by the SIZE of the images stored
 *  (MB used), accrued per upload against the account's quota. Self-hosted
 *  (local mode) instances include photos and skip the meter entirely. */
async function photoBytes(env: Env, userId: string): Promise<{ used: number; quota: number }> {
  const row = await first(env, 'SELECT photo_bytes_used, photo_bytes_quota FROM users WHERE id = ?', userId) as { photo_bytes_used?: number; photo_bytes_quota?: number } | null;
  return { used: row?.photo_bytes_used ?? 0, quota: row?.photo_bytes_quota ?? 209715200 };
}
async function chargePhotoBytes(env: Env, userId: string, bytes: number, selfHosted: boolean): Promise<void> {
  if (selfHosted) return;
  await run(env, 'UPDATE users SET photo_bytes_used = photo_bytes_used + ? WHERE id = ?', bytes, userId);
}
const OUT_OF_CREDITS = {
  error: 'Out of photo storage — the free plan includes 200 MB (≈1000 photos). Add more any time from Plan & credits.',
  upgrade: true,
};

app.post('/products/:id/image', requireAuth, imageLimiter, async (c) => {
  const env = c.env as Env;
  const cfg = c.get('config');
  const product = await ownedProduct(c, env, c.req.param('id'));
  if (product instanceof Response) return product;
  const store = await first(env, 'SELECT * FROM stores WHERE id = ?', product.store_id);
  if (!productImagesEnabled(cfg, store as { plan?: string })) {
    return json(c, 402, {
      error: 'Product photos are part of the paid plan. Self-hosted (local mode) instances have them included.',
      upgrade: true,
    });
  }
  const mb = await photoBytes(env, c.get('user').id);
  if (!cfg.selfHosted && mb.used >= mb.quota) return json(c, 402, OUT_OF_CREDITS);
  const type = (c.req.header('content-type') || '').split(';')[0].trim();
  const spec = IMAGE_TYPES[type];
  if (!spec) return badRequest(c, 'Only PNG, JPEG or WebP images are accepted');
  const buf = new Uint8Array(await c.req.arrayBuffer());
  if (!buf.length) return badRequest(c, 'Empty upload');
  if (buf.length > cfg.maxUploadBytes) return badRequest(c, 'Image exceeds 10 MB limit');
  if (!spec.magic(buf)) return badRequest(c, 'File content does not match its image type');

  let url: string;
  try {
    ({ url } = await saveImage(env, buf, spec.ext));
  } catch (err) {
    if ((err as Error).message === 'R2_DAILY_BUDGET_REACHED')
      return json(c, 503, { error: 'Daily media budget reached — uploads pause until tomorrow.', retry: true });
    throw err;
  }
  await chargePhotoBytes(env, c.get('user').id, buf.length, cfg.selfHosted);
  await run(env, 'UPDATE products SET image_url = ? WHERE id = ?', url, product.id);
  await touchStore(c, env, product.store_id as string);
  await deleteImage(env, product.image_url); // the replaced image, if any
  return json(c, 200, { url, product: productJson((await first(env, PRODUCT_JOIN, product.id))!) });
});

app.delete('/products/:id/image', requireAuth, async (c) => {
  const env = c.env as Env;
  const cfg = c.get('config');
  const product = await ownedProduct(c, env, c.req.param('id'));
  if (product instanceof Response) return product;
  const store = await first(env, 'SELECT * FROM stores WHERE id = ?', product.store_id);
  if (!productImagesEnabled(cfg, store as { plan?: string }))
    return json(c, 402, { error: 'Product photos are a paid feature', upgrade: true });
  await run(env, 'UPDATE products SET image_url = "" WHERE id = ?', product.id);
  await touchStore(c, env, product.store_id as string);
  await deleteImage(env, product.image_url);
  return json(c, 200, { ok: true });
});

/**
 * POST /api/products/:id/image-crop — raw image bytes; sets the owner-cropped
 * variant (products.image_crop_url) that planogram tiles show by default.
 * The original image_url is kept so search thumbs and the product sheet fall
 * back to it.
 */
app.post('/products/:id/image-crop', requireAuth, imageLimiter, async (c) => {
  const env = c.env as Env;
  const cfg = c.get('config');
  const product = await ownedProduct(c, env, c.req.param('id'));
  if (product instanceof Response) return product;
  const store = await first(env, 'SELECT * FROM stores WHERE id = ?', product.store_id);
  if (!productImagesEnabled(cfg, store as { plan?: string })) {
    return json(c, 402, {
      error: 'Product photos are part of the paid plan. Self-hosted (local mode) instances have them included.',
      upgrade: true,
    });
  }
  const mb = await photoBytes(env, c.get('user').id);
  if (!cfg.selfHosted && mb.used >= mb.quota) return json(c, 402, OUT_OF_CREDITS);
  const type = (c.req.header('content-type') || '').split(';')[0].trim();
  const spec = IMAGE_TYPES[type];
  if (!spec) return badRequest(c, 'Only PNG, JPEG or WebP images are accepted');
  const buf = new Uint8Array(await c.req.arrayBuffer());
  if (!buf.length) return badRequest(c, 'Empty upload');
  if (buf.length > cfg.maxUploadBytes) return badRequest(c, 'Image exceeds 10 MB limit');
  if (!spec.magic(buf)) return badRequest(c, 'File content does not match its image type');

  let url: string;
  try {
    ({ url } = await saveImage(env, buf, spec.ext));
  } catch (err) {
    if ((err as Error).message === 'R2_DAILY_BUDGET_REACHED')
      return json(c, 503, { error: 'Daily media budget reached — uploads pause until tomorrow.', retry: true });
    throw err;
  }
  await chargePhotoBytes(env, c.get('user').id, buf.length, cfg.selfHosted);
  await run(env, 'UPDATE products SET image_crop_url = ? WHERE id = ?', url, product.id);
  await touchStore(c, env, product.store_id as string);
  await deleteImage(env, product.image_crop_url); // the replaced crop, if any
  return json(c, 200, { url, product: productJson((await first(env, PRODUCT_JOIN, product.id))!) });
});

app.delete('/products/:id/image-crop', requireAuth, async (c) => {
  const env = c.env as Env;
  const cfg = c.get('config');
  const product = await ownedProduct(c, env, c.req.param('id'));
  if (product instanceof Response) return product;
  const store = await first(env, 'SELECT * FROM stores WHERE id = ?', product.store_id);
  if (!productImagesEnabled(cfg, store as { plan?: string }))
    return json(c, 402, { error: 'Product photos are a paid feature', upgrade: true });
  await run(env, 'UPDATE products SET image_crop_url = "" WHERE id = ?', product.id);
  await touchStore(c, env, product.store_id as string);
  await deleteImage(env, product.image_crop_url);
  return json(c, 200, { ok: true });
});

app.patch('/products/:id', requireAuth, async (c) => {
  const env = c.env as Env;
  const product = await ownedProduct(c, env, c.req.param('id'));
  if (product instanceof Response) return product;
  const body = await c.req.json().catch(() => ({}));
  const updates: Record<string, unknown> = {};
  if (body?.name !== undefined) {
    const name = str(body.name, { max: 200, allowEmpty: false });
    if (!name) return badRequest(c, 'Product name is required');
    updates.name = name;
  }
  for (const field of ['brand', 'sku', 'barcode', 'description', 'image_url']) {
    if (body?.[field] !== undefined) updates[field] = str(body[field], { max: 1000 });
  }
  if (body?.price !== undefined) {
    if (body.price === null || body.price === '') {
      updates.price = null;
    } else {
      const price = num(body.price);
      if (price === undefined || price < 0) return badRequest(c, 'Invalid price');
      updates.price = price;
    }
  }
  if (body?.category_id !== undefined) {
    if (!body.category_id) {
      updates.category_id = null;
    } else {
      const cat = await ownedCategory(c, env, body.category_id);
      if (cat instanceof Response) return cat;
      updates.category_id = cat.id;
    }
  }
  const keys = Object.keys(updates);
  if (keys.length) {
    await run(
      env,
      `UPDATE products SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`,
      ...keys.map((k) => updates[k]),
      product.id
    );
    // Write first, THEN purge: purging before the write lets a concurrent
    // cache miss re-serve the stale payload for the full TTL.
    await touchStore(c, env, product.store_id as string);
    if (updates.image_url !== undefined && updates.image_url !== product.image_url) {
      await deleteImage(env, product.image_url); // orphaned R2 object otherwise
    }
  }
  return json(c, 200, { product: productJson((await first(env, PRODUCT_JOIN, product.id))!) });
});

app.delete('/products/:id', requireAuth, async (c) => {
  const env = c.env as Env;
  const product = await ownedProduct(c, env, c.req.param('id'));
  if (product instanceof Response) return product;
  await run(env, 'DELETE FROM products WHERE id = ?', product.id);
  await touchStore(c, env, product.store_id as string);
  return json(c, 200, { ok: true });
});

/* ---- Product locations (pins on the map) ---- */

/**
 * Location meta JSON, in one place so the Workers and Express engines persist
 * the same fields: the owning shelf, the planogram placement (row + facing
 * width), the pin's own marker size and the group-model flags (groupPin = the
 * group's one map pin, groupOnly = a planogram-only facing that never draws
 * as a pin). Undefined fields are omitted, pin sizes clamp to 0.05–3 m.
 */
export function pinMetaJson(fields: {
  shelfId?: string | null;
  shelfLevel?: number;
  facingW?: number;
  pinW?: number;
  pinH?: number;
  groupOnly?: boolean;
  groupPin?: boolean;
}): string {
  const { shelfId, shelfLevel, facingW, pinW, pinH, groupOnly, groupPin } = fields;
  return JSON.stringify({
    ...(shelfId ? { shelfId } : {}),
    ...(shelfLevel !== undefined ? { shelf_level: shelfLevel } : {}),
    ...(facingW !== undefined ? { w: facingW } : {}),
    ...(pinW !== undefined ? { pinW: Math.min(3, Math.max(0.05, pinW)) } : {}),
    ...(pinH !== undefined ? { pinH: Math.min(3, Math.max(0.05, pinH)) } : {}),
    ...(groupOnly ? { groupOnly: 1 } : {}),
    ...(groupPin ? { groupPin: 1 } : {}),
  });
}

app.post('/products/:id/locations', requireAuth, async (c) => {
  const env = c.env as Env;
  const product = await ownedProduct(c, env, c.req.param('id'));
  if (product instanceof Response) return product;
  const body = await c.req.json().catch(() => ({}));
  const floor = body?.floor_id ? await ownedFloor(c, env, body.floor_id) : null;
  if (floor instanceof Response) return floor;
  if (!floor) return badRequest(c, 'floor_id is required');
  const x = num(body?.x);
  const y = num(body?.y);
  if (x === undefined || y === undefined) return badRequest(c, 'x and y are required');
  const rot = num(body?.rot) ?? 0;
  // The shelf the product was pinned to — persisted in meta so the editor's
  // "a persisted meta.shelfId wins" owner derivation survives reloads.
  const shelfId =
    typeof body?.shelfId === 'string' && body.shelfId.trim() ? body.shelfId.trim().slice(0, 64) : null;
  const meta = pinMetaJson({
    shelfId,
    shelfLevel: num(body?.shelfLevel),
    facingW: num(body?.facingW),
    pinW: num(body?.pinW),
    pinH: num(body?.pinH),
    groupOnly: body?.groupOnly === true,
    groupPin: body?.groupPin === true,
  });
  // A product can have several pins per floor (facings of the same item on a
  // shelf). With `locationId` the call MOVES that pin; without one it inserts
  // a new facing. (Parity with backend/src/routes/catalog.js.)
  const relocateId = typeof body?.locationId === 'string' ? body.locationId : null;
  if (relocateId) {
    const owned = await first(env, 'SELECT meta FROM product_locations WHERE id = ? AND product_id = ?', relocateId, product.id);
    if (owned) {
      // a move MERGES the sent fields over the pin's stored meta (matching the
      // sandbox) — a plain drag keeps its planogram row, size and group flags.
      // The shelf association stays REPLACE semantics: an absent shelfId
      // clears it (a pin dragged onto empty floor), `groupOnly: false` /
      // `groupPin: false` explicitly clear those flags.
      let merged: Record<string, unknown> = {};
      try { merged = JSON.parse(String(owned.meta || '{}')); } catch { /* fresh meta */ }
      Object.assign(merged, JSON.parse(meta) as Record<string, unknown>);
      if (!shelfId) delete merged.shelfId;
      if (body?.groupOnly === false) delete merged.groupOnly;
      if (body?.groupPin === false) delete merged.groupPin;
      await run(env, 'UPDATE product_locations SET x = ?, y = ?, rot = ?, meta = ? WHERE id = ?', x, y, rot, JSON.stringify(merged), relocateId);
      return json(c, 201, { location: locationJson((await first(env, 'SELECT * FROM product_locations WHERE id = ?', relocateId))!) });
    }
  }
  const id = newId();
  await run(
    env,
    'INSERT INTO product_locations (id, product_id, floor_id, x, y, rot, meta) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id, product.id, floor.id, x, y, rot, meta
  );
  return json(c, 201, { location: locationJson((await first(env, 'SELECT * FROM product_locations WHERE id = ?', id))!) });
});

app.delete('/locations/:id', requireAuth, async (c) => {
  const env = c.env as Env;
  const row = await first(
    env,
    `SELECT l.*, s.owner_id FROM product_locations l
     JOIN products p ON p.id = l.product_id
     JOIN stores s ON s.id = p.store_id WHERE l.id = ?`,
    String(c.req.param('id'))
  );
  const role = row ? await roleForStore(env, c.get('user').id, String(row.store_id)) : null;
  if (!row || !role || !roleAtLeast(role, 'stock')) return notFound(c, 'Location not found');
  await run(env, 'DELETE FROM product_locations WHERE id = ?', row.id);
  return json(c, 200, { ok: true });
});

export default app;
