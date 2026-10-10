/** Owner-facing stock tracking + API key management. */
import { Router } from 'express';
import { db, newId } from '../db.js';
import { requireAuth } from '../auth/session.js';
import { handler, sendJson, badRequest, notFound } from '../lib/http.js';
import { ownedStore } from '../lib/ownership.js';
import {
  adjustStock, setStock, stockForStore, movementsForStore,
  generateApiKey, hashKey,
} from '../lib/stock.js';

const router = Router();
router.use(requireAuth);

/** GET /api/stores/:storeId/stock — all levels + recent movements. */
router.get('/:storeId/stock', handler(async (req, res) => {
  const store = ownedStore(req, res, req.params.storeId);
  if (!store) return;
  sendJson(res, 200, {
    stock: stockForStore(store.id),
    movements: movementsForStore(store.id, 50),
  });
}));

/** POST /api/stores/:storeId/stock/adjust — { product_id, delta, reason? } */
router.post('/:storeId/stock/adjust', handler(async (req, res) => {
  const store = ownedStore(req, res, req.params.storeId);
  if (!store) return;
  const delta = Number(req.body?.delta);
  if (!Number.isFinite(delta)) return badRequest(res, 'delta must be a number');
  const level = adjustStock(store.id, req.body?.product_id, delta, {
    reason: req.body?.reason,
    source: 'manual',
  });
  if (!level) return badRequest(res, 'Product not found');
  sendJson(res, 200, { level });
}));

/** POST /api/stores/:storeId/stock/set — { product_id, quantity } absolute count. */
router.post('/:storeId/stock/set', handler(async (req, res) => {
  const store = ownedStore(req, res, req.params.storeId);
  if (!store) return;
  const quantity = Number(req.body?.quantity);
  if (!Number.isFinite(quantity) || quantity < 0) return badRequest(res, 'quantity must be a non-negative number');
  const level = setStock(store.id, req.body?.product_id, quantity, {
    reason: req.body?.reason || 'count',
    source: 'manual',
  });
  if (!level) return badRequest(res, 'Product not found');
  sendJson(res, 200, { level });
}));

/* ---------------- API keys (lets independent systems track stock for this store) ---------------- */

router.get('/:storeId/keys', handler(async (req, res) => {
  const store = ownedStore(req, res, req.params.storeId);
  if (!store) return;
  const keys = db
    .prepare('SELECT id, name, key_prefix, created_at, last_used_at, revoked FROM store_api_keys WHERE store_id = ? ORDER BY created_at DESC')
    .all(store.id);
  sendJson(res, 200, { keys });
}));

router.post('/:storeId/keys', handler(async (req, res) => {
  const store = ownedStore(req, res, req.params.storeId);
  if (!store) return;
  const name = String(req.body?.name || 'API key').slice(0, 80);
  const count = db.prepare('SELECT COUNT(*) c FROM store_api_keys WHERE store_id = ? AND revoked = 0').get(store.id).c;
  if (count >= 20) return badRequest(res, 'Too many API keys');
  const { key, prefix } = generateApiKey();
  const id = newId();
  db.prepare('INSERT INTO store_api_keys (id, store_id, name, key_hash, key_prefix) VALUES (?, ?, ?, ?, ?)').run(
    id, store.id, name, hashKey(key), prefix
  );
  // The full key is shown exactly once — only its hash is stored.
  sendJson(res, 201, { key: { id, name, key_prefix: prefix, created_at: new Date().toISOString() }, api_key: key });
}));

router.delete('/keys/:keyId', handler(async (req, res) => {
  const row = db
    .prepare(
      `SELECT k.id, s.owner_id FROM store_api_keys k JOIN stores s ON s.id = k.store_id WHERE k.id = ?`
    )
    .get(String(req.params.keyId));
  if (!row || row.owner_id !== req.user.id) return notFound(res, 'Key not found');
  db.prepare('UPDATE store_api_keys SET revoked = 1 WHERE id = ?').run(row.id);
  sendJson(res, 200, { ok: true });
}));

export default router;
