/** Store organization routes (mirror of backend/src/routes/members.js). */
import { Hono } from 'hono';
import type { AppEnv, Env } from '../config';
import { first, run } from '../db';
import { json, badRequest, notFound } from '../http';
import { requireAuth } from '../session';
import {
  memberStore, listMembers, createInvitation, findInvitation, acceptInvitation, INVITE_ROLES,
} from '../members';
import { touchStore } from '../ownership';

const app = new Hono<AppEnv>();

app.get('/stores/:id/members', requireAuth, async (c) => {
  const env = c.env as Env;
  const m = await memberStore(c, env, c.req.param('id'), 'viewer');
  if (m instanceof Response) return m;
  return json(c, 200, { members: await listMembers(env, String(m.store.id)), role: m.role });
});

app.post('/stores/:id/members/invite', requireAuth, async (c) => {
  const env = c.env as Env;
  const m = await memberStore(c, env, c.req.param('id'), 'manager');
  if (m instanceof Response) return m;
  const body = await c.req.json().catch(() => ({}));
  const email = String(body?.email || '').trim().toLowerCase().slice(0, 200);
  const role = String(body?.role || '');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return badRequest(c, 'A valid email is required');
  if (!INVITE_ROLES.includes(role)) return badRequest(c, 'Role must be manager, stock or viewer');
  if (role === 'manager' && m.role !== 'owner') {
    return json(c, 403, { error: 'Only the owner can invite managers' });
  }
  const token = await createInvitation(env, String(m.store.id), email, role);
  const cfg = c.get('config');
  return json(c, 201, { inviteUrl: `${cfg.publicBaseUrl}/invite/${token}`, role, email });
});

app.patch('/stores/:id/members/:userId', requireAuth, async (c) => {
  const env = c.env as Env;
  const m = await memberStore(c, env, c.req.param('id'), 'owner');
  if (m instanceof Response) return m;
  const body = await c.req.json().catch(() => ({}));
  const role = String(body?.role || '');
  if (!INVITE_ROLES.includes(role)) return badRequest(c, 'Role must be manager, stock or viewer');
  const row = await first(env, 'SELECT * FROM store_members WHERE store_id = ? AND user_id = ?', m.store.id, c.req.param('userId'));
  if (!row) return notFound(c, 'Member not found');
  await run(env, 'UPDATE store_members SET role = ? WHERE id = ?', role, row.id);
  return json(c, 200, { ok: true });
});

app.delete('/stores/:id/members/:userId', requireAuth, async (c) => {
  const env = c.env as Env;
  const m = await memberStore(c, env, c.req.param('id'), 'manager');
  if (m instanceof Response) return m;
  const target = await first(
    env,
    `SELECT m.*, CASE WHEN s.owner_id = m.user_id THEN 1 ELSE 0 END AS is_owner
     FROM store_members m JOIN stores s ON s.id = m.store_id
     WHERE m.store_id = ? AND m.user_id = ?`,
    m.store.id, c.req.param('userId')
  );
  if (!target || target.is_owner) return notFound(c, 'Member not found');
  if (m.role !== 'owner' && target.role !== 'stock' && target.role !== 'viewer') {
    return json(c, 403, { error: 'Only the owner can remove managers' });
  }
  await run(env, 'DELETE FROM store_members WHERE id = ?', target.id);
  return json(c, 200, { ok: true });
});

/* ---------------- Invitations ---------------- */

app.get('/invitations/:token', async (c) => {
  const env = c.env as Env;
  const inv = await findInvitation(env, c.req.param('token'));
  if (!inv) return notFound(c, 'This invitation is invalid or has expired.');
  return json(c, 200, { invitation: { storeName: inv.store_name, role: inv.role, email: inv.email } });
});

app.post('/invitations/:token/accept', requireAuth, async (c) => {
  const env = c.env as Env;
  const result = (await acceptInvitation(env, String(c.req.param('token') || ''), c.get('user'))) as any;
  if ((result as any).error) return json(c, (result as any).status || 403, { error: (result as any).error });
  await touchStore(env, String((result as any).storeId));
  return json(c, 200, { storeId: result.storeId, role: result.role });
});

export default app;
