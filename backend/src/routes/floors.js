import { Router } from 'express';
import { db, newId } from '../db.js';
import { requireAuth } from '../auth/session.js';
import { handler, sendJson, badRequest, notFound } from '../lib/http.js';
import { str, num, validateElement } from '../lib/validate.js';
import { ownedFloor, touchStore } from '../lib/ownership.js';

const router = Router();
router.use(requireAuth);

/** PATCH /api/floors/:floorId — rename, resize, set background image. */
router.patch('/:floorId', handler(async (req, res) => {
  const floor = ownedFloor(req, res, req.params.floorId, 'manager');
  if (!floor) return;
  const updates = {};
  if (req.body?.name !== undefined) {
    const name = str(req.body.name, { max: 80, allowEmpty: false });
    if (!name) return badRequest(res, 'Floor name is required');
    updates.name = name;
  }
  for (const field of ['width_m', 'height_m']) {
    if (req.body?.[field] !== undefined) {
      const v = num(req.body[field]);
      if (!v || v < 1 || v > 500) return badRequest(res, `${field} must be between 1 and 500 meters`);
      updates[field] = v;
    }
  }
  if (req.body?.level !== undefined) {
    const level = num(req.body.level);
    if (level === undefined) return badRequest(res, 'Invalid level');
    updates.level = level;
  }
  if (req.body?.background_url !== undefined) {
    updates.background_url = str(req.body.background_url, { max: 400 });
  }
  const keys = Object.keys(updates);
  if (keys.length) {
    db.prepare(`UPDATE floors SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(
      ...keys.map((k) => updates[k]), floor.id
    );
    touchStore(floor.store_id);
  }
  sendJson(res, 200, { floor: db.prepare('SELECT * FROM floors WHERE id = ?').get(floor.id) });
}));

router.delete('/:floorId', handler(async (req, res) => {
  const floor = ownedFloor(req, res, req.params.floorId, 'manager');
  if (!floor) return;
  const count = db.prepare('SELECT COUNT(*) c FROM floors WHERE store_id = ?').get(floor.store_id).c;
  if (count <= 1) return badRequest(res, 'A store must keep at least one floor');
  db.prepare('DELETE FROM floors WHERE id = ?').run(floor.id);
  touchStore(floor.store_id);
  sendJson(res, 200, { ok: true });
}));

/**
 * PUT /api/floors/:floorId/elements — bulk replace the floor's elements.
 * This is the editor's autosave endpoint: one transaction, all-or-nothing.
 */
router.put('/:floorId/elements', handler(async (req, res) => {
  const startedAt = Date.now(); // Phase-B trigger metric (INFRA §5): p95 autosave > 500 ms
  const floor = ownedFloor(req, res, req.params.floorId, 'manager');
  if (!floor) return;
  const list = Array.isArray(req.body?.elements) ? req.body.elements : null;
  if (!list) return badRequest(res, 'elements must be an array');
  if (list.length > 2000) return badRequest(res, 'Too many elements on one floor');

  const rows = [];
  const seenIds = new Set();
  for (const input of list) {
    const row = validateElement(input);
    if (!row) return badRequest(res, 'Invalid element in payload');
    const id = row.id && !seenIds.has(row.id) ? row.id : newId();
    seenIds.add(id);
    rows.push([id, floor.id, row.type, row.shape, row.geometry, row.label, row.color, row.meta, row.z_index]);
  }

  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM map_elements WHERE floor_id = ?').run(floor.id);
    const insert = db.prepare(
      `INSERT INTO map_elements (id, floor_id, type, shape, geometry, label, color, meta, z_index)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const r of rows) insert.run(...r);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  touchStore(floor.store_id);
  const took = Date.now() - startedAt;
  if (took > 400) console.warn(`[metrics] slow elements save: ${took}ms (${rows.length} elements)`);
  maybeSnapshot(floor.id, rows);
  const elements = db
    .prepare('SELECT * FROM map_elements WHERE floor_id = ? ORDER BY z_index ASC, rowid ASC')
    .all(floor.id);
  sendJson(res, 200, { elements });
}));

/* ---------------- autosave snapshots (the editor's changelog) ---------------- */

/** At most one snapshot per floor per interval — active drawing autosaves every
 *  few hundred ms, so unthrottled snapshots would spam rows and slow the save. */
const SNAP_MIN_INTERVAL_MS = 60_000;
/** Bounded storage: the oldest snapshots are pruned beyond this count. */
const SNAP_MAX_PER_FLOOR = 20;

function maybeSnapshot(floorId, rows) {
  const last = db
    .prepare('SELECT created_at_ms FROM floor_snapshots WHERE floor_id = ? ORDER BY created_at_ms DESC LIMIT 1')
    .get(floorId);
  if (last && Date.now() - last.created_at_ms < SNAP_MIN_INTERVAL_MS) return;
  const elements = rows.map((r) => ({
    id: r[0],
    type: r[2],
    shape: r[3],
    geometry: r[4],
    label: r[5],
    color: r[6],
    meta: r[7],
    z_index: r[8],
  }));
  db.prepare('INSERT INTO floor_snapshots (id, floor_id, elements, element_count, created_at_ms) VALUES (?, ?, ?, ?, ?)')
    .run(newId(), floorId, JSON.stringify(elements), elements.length, Date.now());
  // prune oldest beyond the cap
  const ids = db
    .prepare('SELECT id FROM floor_snapshots WHERE floor_id = ? ORDER BY created_at_ms DESC LIMIT -1 OFFSET ?')
    .all(floorId, SNAP_MAX_PER_FLOOR);
  if (ids.length) {
    const del = db.prepare('DELETE FROM floor_snapshots WHERE id = ?');
    for (const { id } of ids) del.run(id);
  }
}

/** GET /api/floors/:floorId/snapshots — the changelog list (newest first). */
router.get('/:floorId/snapshots', handler(async (req, res) => {
  const floor = ownedFloor(req, res, req.params.floorId, 'viewer');
  if (!floor) return;
  const snapshots = db
    .prepare('SELECT id, element_count, created_at_ms FROM floor_snapshots WHERE floor_id = ? ORDER BY created_at_ms DESC')
    .all(floor.id);
  sendJson(res, 200, { snapshots });
}));

/** GET /api/floors/:floorId/snapshots/:snapId — full elements of one autosave. */
router.get('/:floorId/snapshots/:snapId', handler(async (req, res) => {
  const floor = ownedFloor(req, res, req.params.floorId, 'viewer');
  if (!floor) return;
  const row = db
    .prepare('SELECT * FROM floor_snapshots WHERE id = ? AND floor_id = ?')
    .get(req.params.snapId, floor.id);
  if (!row) return notFound(res, 'Snapshot not found');
  sendJson(res, 200, {
    snapshot: {
      id: row.id,
      element_count: row.element_count,
      created_at_ms: row.created_at_ms,
      elements: JSON.parse(row.elements),
    },
  });
}));

export default router;
