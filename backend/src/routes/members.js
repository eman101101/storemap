/** Store organization routes: members list, invitations, role management. */
import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth/session.js';
import { handler, sendJson, badRequest, notFound } from '../lib/http.js';
import { memberStore, roleAtLeast, roleForStore, listMembers, createInvitation, findInvitation, acceptInvitation, INVITE_ROLES } from '../lib/members.js';
import { touchStore } from '../lib/ownership.js';
import { config } from '../config.js';

const router = Router();

/** GET /api/stores/:id/members — team roster (viewer+). */
router.get('/stores/:id/members', requireAuth, handler(async (req, res) => {
  const m = memberStore(req, res, req.params.id, 'viewer');
  if (!m) return;
  sendJson(res, 200, { members: listMembers(m.store.id), role: m.role });
}));

/**
 * POST /api/stores/:id/members/invite — { email, role }. Owner invites any
 * role; manager invites stock/viewer. Returns the invite link (no mail infra
 * yet — the UI shows it to copy; Queues come with billing).
 */
router.post('/stores/:id/members/invite', requireAuth, handler(async (req, res) => {
  const m = memberStore(req, res, req.params.id, 'manager');
  if (!m) return;
  const email = String(req.body?.email || '').trim().toLowerCase().slice(0, 200);
  const role = String(req.body?.role || '');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return badRequest(res, 'A valid email is required');
  if (!INVITE_ROLES.includes(role)) return badRequest(res, 'Role must be manager, stock or viewer');
  if (role === 'manager' && m.role !== 'owner') {
    return sendJson(res, 403, { error: 'Only the owner can invite managers' });
  }
  const token = createInvitation(m.store.id, email, role);
  sendJson(res, 201, { inviteUrl: `${config.publicBaseUrl}/invite/${token}`, role, email });
}));

/** PATCH /api/stores/:id/members/:userId — owner changes a member's role. */
router.patch('/stores/:id/members/:userId', requireAuth, handler(async (req, res) => {
  const m = memberStore(req, res, req.params.id, 'owner');
  if (!m) return;
  const role = String(req.body?.role || '');
  if (!INVITE_ROLES.includes(role)) return badRequest(res, 'Role must be manager, stock or viewer');
  const row = db.prepare('SELECT * FROM store_members WHERE store_id = ? AND user_id = ?').get(m.store.id, req.params.userId);
  if (!row) return notFound(res, 'Member not found');
  db.prepare('UPDATE store_members SET role = ? WHERE id = ?').run(role, row.id);
  sendJson(res, 200, { ok: true });
}));

/** DELETE /api/stores/:id/members/:userId — owner (or manager for stock/viewer). */
router.delete('/stores/:id/members/:userId', requireAuth, handler(async (req, res) => {
  const m = memberStore(req, res, req.params.id, 'manager');
  if (!m) return;
  const target = db
    .prepare(
      `SELECT m.*, CASE WHEN s.owner_id = m.user_id THEN 1 ELSE 0 END AS is_owner
       FROM store_members m JOIN stores s ON s.id = m.store_id
       WHERE m.store_id = ? AND m.user_id = ?`
    )
    .get(m.store.id, req.params.userId);
  if (!target || target.is_owner) return notFound(res, 'Member not found');
  if (m.role !== 'owner' && target.role !== 'stock' && target.role !== 'viewer') {
    return sendJson(res, 403, { error: 'Only the owner can remove managers' });
  }
  db.prepare('DELETE FROM store_members WHERE id = ?').run(target.id);
  sendJson(res, 200, { ok: true });
}));

/* ---------------- Invitation acceptance (no auth for info, auth to accept) ---------------- */

/** GET /api/invitations/:token — preview (store name, role, invited email). */
router.get('/invitations/:token', handler(async (req, res) => {
  const inv = findInvitation(String(req.params.token || ''));
  if (!inv) return notFound(res, 'This invitation is invalid or has expired.');
  sendJson(res, 200, { invitation: { storeName: inv.store_name, role: inv.role, email: inv.email } });
}));

/** POST /api/invitations/:token/accept — must be signed in as the invited email. */
router.post('/invitations/:token/accept', requireAuth, handler(async (req, res) => {
  const result = acceptInvitation(String(req.params.token || ''), req.user);
  if (result.error) return sendJson(res, result.status || 403, { error: result.error });
  touchStore(result.storeId);
  sendJson(res, 200, { storeId: result.storeId, role: result.role });
}));

export default router;
