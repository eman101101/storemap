/** Membership-aware ownership (Step 1) — mirror of the Node ownership.js. */
import type { Context } from 'hono';
import type { Env } from './config';
import { first, run } from './db';
import { notFound } from './http';
import { roleForStore, roleAtLeast } from './members';

/**
 * Returns the store row when the caller holds `minRole` (owner via
 * stores.owner_id, or a store_members row); otherwise the error Response —
 * handlers do `if (store instanceof Response) return store;`.
 */
export async function ownedStore(
  c: Context,
  env: Env,
  storeId: unknown,
  min = 'stock'
): Promise<Record<string, unknown> | Response> {
  const store = await first(env, 'SELECT * FROM stores WHERE id = ?', String(storeId));
  const role = store ? await roleForStore(env, c.get('user').id, String(store.id)) : null;
  if (!store || !role || !roleAtLeast(role, min)) return notFound(c, 'Store not found');
  return store;
}

/** Loads a floor and verifies the caller's role on its store. */
export async function ownedFloor(
  c: Context,
  env: Env,
  floorId: unknown,
  min = 'stock'
): Promise<Record<string, unknown> | Response> {
  const floor = await first(
    env,
    'SELECT f.*, s.owner_id FROM floors f JOIN stores s ON s.id = f.store_id WHERE f.id = ?',
    String(floorId)
  );
  const role = floor ? await roleForStore(env, c.get('user').id, String(floor.store_id)) : null;
  if (!floor || !role || !roleAtLeast(role, min)) return notFound(c, 'Floor not found');
  return floor;
}

export async function touchStore(env: Env, storeId: unknown): Promise<void> {
  await run(env, `UPDATE stores SET updated_at = datetime('now') WHERE id = ?`, String(storeId));
}
