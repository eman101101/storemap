/** Store organization on the Worker — mirror of backend/src/lib/members.js. */
import type { Context } from 'hono';
import type { Env } from './config';
import { all, first, run } from './db';
import { newId, randomToken, sha256Hex } from './util';
import { notFound } from './http';

export const ROLES: Record<string, number> = { viewer: 0, stock: 1, manager: 2, owner: 3 };
export const INVITE_ROLES = ['manager', 'stock', 'viewer'];

export const roleAtLeast = (role: string, min: string): boolean => ROLES[role] >= ROLES[min];

/** Resolve the caller's role for a store, or null (owner_id = implicit owner). */
export async function roleForStore(env: Env, userId: string, storeId: string): Promise<string | null> {
  const member = await first(env, 'SELECT role FROM store_members WHERE store_id = ? AND user_id = ?', String(storeId), String(userId));
  if (member) return member.role as string;
  const owner = await first(env, 'SELECT 1 FROM stores WHERE id = ? AND owner_id = ?', String(storeId), String(userId));
  return owner ? 'owner' : null;
}

export interface MemberContext {
  store: Record<string, unknown>;
  role: string;
}

/**
 * Membership-aware check: returns the store + role, or the error Response
 * (handlers do `if (m instanceof Response) return m;`).
 */
export async function memberStore(c: Context, env: Env, storeId: unknown, min = 'stock'): Promise<MemberContext | Response> {
  const store = await first(env, 'SELECT * FROM stores WHERE id = ?', String(storeId));
  const role = store ? await roleForStore(env, c.get('user').id, String(store.id)) : null;
  if (!store || !role || !roleAtLeast(role, min)) return notFound(c, 'Store not found');
  return { store, role };
}

/** Every store the user can see (owned or a member of). */
export function storesForUser(env: Env, userId: string) {
  return all(
    env,
    `SELECT DISTINCT s.* FROM stores s
     LEFT JOIN store_members m ON m.store_id = s.id AND m.user_id = ?
     WHERE s.owner_id = ? OR m.user_id = ?
     ORDER BY s.created_at DESC`,
    String(userId), String(userId), String(userId)
  );
}

/** Members list: the implicit owner + explicit rows, with user info. */
export async function listMembers(env: Env, storeId: string) {
  const owner = await first(
    env,
    `SELECT u.id AS user_id, u.email, u.name, 'owner' AS role, u.created_at AS joined_at
     FROM stores s JOIN users u ON u.id = s.owner_id WHERE s.id = ?`,
    String(storeId)
  );
  const members = await all(
    env,
    `SELECT m.user_id, u.email, u.name, m.role, m.created_at AS joined_at
     FROM store_members m JOIN users u ON u.id = m.user_id
     WHERE m.store_id = ? ORDER BY m.created_at`,
    String(storeId)
  );
  return owner ? [owner, ...members] : members;
}

/** Create an invitation; returns the raw token (only its hash is stored). */
export async function createInvitation(env: Env, storeId: string, email: string, role: string, ttlHours = 48): Promise<string> {
  const token = randomToken(24);
  const expires = new Date(Date.now() + ttlHours * 3600_000).toISOString();
  await run(
    env,
    `INSERT INTO invitations (id, store_id, email, role, token_hash, expires_at) VALUES (?, ?, ?, ?, ?, ?)`,
    newId(), String(storeId), email.toLowerCase().slice(0, 200), role, await sha256Hex(token), expires
  );
  return token;
}

/** Look up a live invitation by raw token; null when missing/expired/used. */
export async function findInvitation(env: Env, token: string) {
  const inv = await first(
    env,
    'SELECT i.*, s.name AS store_name FROM invitations i JOIN stores s ON s.id = i.store_id WHERE i.token_hash = ?',
    await sha256Hex(String(token || ''))
  );
  if (!inv || inv.accepted_at || new Date(String(inv.expires_at)).getTime() < Date.now()) return null;
  return inv;
}

/** Accept: signed-in email must match the invited email; burns the token. */
export async function acceptInvitation(env: Env, token: string, user: Record<string, unknown>) {
  const inv = await findInvitation(env, token);
  if (!inv) return { error: 'This invitation is invalid or has expired.', status: 404 };
  if (String(user.email || '').toLowerCase() !== String(inv.email)) {
    return { error: `This invitation was sent to ${inv.email} — sign in with that account.`, status: 403 };
  }
  await run(
    env,
    `INSERT INTO store_members (id, store_id, user_id, role) VALUES (?, ?, ?, ?)
     ON CONFLICT(store_id, user_id) DO UPDATE SET role = excluded.role`,
    newId(), inv.store_id, user.id, inv.role
  );
  await run(env, `UPDATE invitations SET accepted_at = datetime('now') WHERE id = ?`, inv.id);
  return { storeId: inv.store_id, role: inv.role };
}
