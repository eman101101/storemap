import { db } from '../db.js';
import { purgeStoreCache } from './cdn.js';
import { roleForStore, roleAtLeast } from './members.js';
import { sendJson, notFound } from './http.js';

/**
 * Membership-aware ownership (Step 1): the caller needs `minRole` on the
 * store (owner via stores.owner_id, or a store_members row). Sends the error
 * response and returns null when they lack it. Defaults to 'stock' — the
 * catalog/stock/uploads baseline.
 */
export function ownedStore(req, res, storeId, min = 'stock') {
  const store = db.prepare('SELECT * FROM stores WHERE id = ?').get(String(storeId));
  const role = store ? roleForStore(req.user.id, store.id) : null;
  if (!store || !role || !roleAtLeast(role, min)) {
    notFound(res, 'Store not found');
    return null;
  }
  return store;
}

/** Loads a floor and verifies the caller's role on its store. */
export function ownedFloor(req, res, floorId, min = 'stock') {
  const floor = db
    .prepare(`SELECT f.*, s.owner_id FROM floors f JOIN stores s ON s.id = f.store_id WHERE f.id = ?`)
    .get(String(floorId));
  const role = floor ? roleForStore(req.user.id, floor.store_id) : null;
  if (!floor || !role || !roleAtLeast(role, min)) {
    notFound(res, 'Floor not found');
    return null;
  }
  return floor;
}

export function touchStore(storeId) {
  db.prepare(`UPDATE stores SET updated_at = datetime('now') WHERE id = ?`).run(storeId);

  purgeStoreCache(storeId); // data changed → drop this store's edge cache
}

export { sendJson };
