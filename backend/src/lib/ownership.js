import { db } from '../db.js';
import { purgeStoreCache } from './cdn.js';
import { sendJson, notFound } from './http.js';

/** Returns the store row if owned by req.user; otherwise sends the error response and returns null. */
export function ownedStore(req, res, storeId) {
  const store = db
    .prepare('SELECT * FROM stores WHERE id = ? AND owner_id = ?')
    .get(String(storeId), req.user.id);
  if (!store) {
    notFound(res, 'Store not found');
    return null;
  }
  return store;
}

/** Loads a floor and verifies its store is owned by req.user. */
export function ownedFloor(req, res, floorId) {
  const floor = db
    .prepare(`SELECT f.*, s.owner_id FROM floors f JOIN stores s ON s.id = f.store_id WHERE f.id = ?`)
    .get(String(floorId));
  if (!floor || floor.owner_id !== req.user.id) {
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
