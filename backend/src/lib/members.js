/**
 * Store organization — members with scoped roles (INFRASTRUCTURE.md §9).
 *
 * Roles rank: owner > manager > stock > viewer. The store creator is owner
 * implicitly via stores.owner_id; store_members holds everyone else (and can
 * also carry an explicit owner row — the implicit check wins ties).
 *
 *   owner   everything: billing/plan, delete store, manage members
 *   manager edit map, catalog, settings; invite stock/viewer
 *   stock   adjust stock, edit products, upload media; maps stay read-only
 *   viewer  read-only dashboards
 */
import crypto from 'node:crypto';
import { db, newId } from '../db.js';
import { notFound, sendJson } from './http.js';

export const ROLES = { viewer: 0, stock: 1, manager: 2, owner: 3 };
export const INVITE_ROLES = ['manager', 'stock', 'viewer'];

export const roleAtLeast = (role, min) => ROLES[role] >= ROLES[min];

/**
 * Resolve the caller's role for a store, or null. The owner_id match is the
 * implicit owner membership — creation/import/seed paths never need changes.
 */
export function roleForStore(userId, storeId) {
  const member = db
    .prepare('SELECT role FROM store_members WHERE store_id = ? AND user_id = ?')
    .get(String(storeId), String(userId));
  if (member) return member.role;
  const owner = db.prepare('SELECT 1 FROM stores WHERE id = ? AND owner_id = ?').get(String(storeId), String(userId));
  return owner ? 'owner' : null;
}

/**
 * Membership-aware ownership check (replaces the old owner-only lookup).
 * Sends the error response and returns null when the caller lacks `minRole`.
 */
export function memberStore(req, res, storeId, min = 'stock') {
  const store = db.prepare('SELECT * FROM stores WHERE id = ?').get(String(storeId));
  const role = store ? roleForStore(req.user.id, store.id) : null;
  if (!store || !role || !roleAtLeast(role, min)) {
    notFound(res, 'Store not found');
    return null;
  }
  return { store, role };
}

/** Every store the user can see (owned or a member of), newest first. */
export function storesForUser(userId) {
  return db
    .prepare(
      `SELECT DISTINCT s.* FROM stores s
       LEFT JOIN store_members m ON m.store_id = s.id AND m.user_id = ?
       WHERE s.owner_id = ? OR m.user_id = ?
       ORDER BY s.created_at DESC`
    )
    .all(String(userId), String(userId), String(userId));
}

/** Members list: explicit rows + the implicit owner, with user info. */
export function listMembers(storeId) {
  const owner = db
    .prepare(
      `SELECT u.id AS user_id, u.email, u.name, 'owner' AS role, u.created_at AS joined_at
       FROM stores s JOIN users u ON u.id = s.owner_id WHERE s.id = ?`
    )
    .get(String(storeId));
  const members = db
    .prepare(
      `SELECT m.user_id, u.email, u.name, m.role, m.created_at AS joined_at
       FROM store_members m JOIN users u ON u.id = m.user_id
       WHERE m.store_id = ? ORDER BY m.created_at`
    )
    .all(String(storeId));
  return owner ? [owner, ...members] : members;
}

/** Create an invitation; returns the raw token (shown once, only its hash is stored). */
export function createInvitation(storeId, email, role, { ttlHours = 48 } = {}) {
  const token = crypto.randomBytes(24).toString('base64url');
  const expires = new Date(Date.now() + ttlHours * 3600_000).toISOString();
  db.prepare(
    `INSERT INTO invitations (id, store_id, email, role, token_hash, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(newId(), String(storeId), String(email).toLowerCase().slice(0, 200), role, hashToken(token), expires);
  return token;
}

export const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

/** Look up a live invitation by raw token; null when missing/expired/used. */
export function findInvitation(token) {
  const inv = db
    .prepare('SELECT i.*, s.name AS store_name FROM invitations i JOIN stores s ON s.id = i.store_id WHERE i.token_hash = ?')
    .get(hashToken(token));
  if (!inv || inv.accepted_at || new Date(inv.expires_at).getTime() < Date.now()) return null;
  return inv;
}

/**
 * Accept an invitation: the signed-in user's email must match the invited
 * email (case-insensitive). Creates/replaces the membership with the invited
 * role and burns the invitation.
 */
export function acceptInvitation(token, user) {
  const inv = findInvitation(token);
  if (!inv) return { error: 'This invitation is invalid or has expired.', status: 404 };
  if ((user.email || '').toLowerCase() !== inv.email) {
    return { error: `This invitation was sent to ${inv.email} — sign in with that account.`, status: 403 };
  }
  db.prepare(
    `INSERT INTO store_members (id, store_id, user_id, role) VALUES (?, ?, ?, ?)
     ON CONFLICT(store_id, user_id) DO UPDATE SET role = excluded.role`
  ).run(newId(), inv.store_id, user.id, inv.role);
  db.prepare('UPDATE invitations SET accepted_at = datetime(\'now\') WHERE id = ?').run(inv.id);
  return { storeId: inv.store_id, role: inv.role };
}
