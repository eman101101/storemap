import { config } from '../config.js';
import { db } from '../db.js';
import { signHs256, verifyHs256, randomToken } from '../lib/jwt.js';
import { parseCookies, setCookie, clearCookie, sendJson } from '../lib/http.js';

const COOKIE = 'st_session';
const STATE_COOKIE = 'st_oauth';

export function issueSession(res, userId) {
  const now = Math.floor(Date.now() / 1000);
  const token = signHs256(
    { sub: userId, iat: now, exp: now + config.sessionDays * 86400 },
    config.sessionSecret || 'dev-secret'
  );
  setCookie(res, COOKIE, token, { maxAge: config.sessionDays * 86400 });
}

export function clearSession(res) {
  clearCookie(res, COOKIE);
}

export function currentUser(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  try {
    const payload = verifyHs256(token, config.sessionSecret || 'dev-secret');
    if (!payload.sub || payload.exp * 1000 < Date.now()) return null;
    const user = db.prepare('SELECT id, email, name, avatar_url, provider FROM users WHERE id = ?').get(payload.sub);
    return user || null;
  } catch {
    return null;
  }
}

export function attachUser(req, _res, next) {
  req.user = currentUser(req);
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return sendJson(res, 401, { error: 'Authentication required' });
  next();
}

/** OAuth state round-trip: random value stored in a short-lived cookie. */
export function makeState(res) {
  const state = randomToken(20);
  setCookie(res, STATE_COOKIE, state, { maxAge: 600 });
  return state;
}

export function checkState(req, state) {
  const expected = parseCookies(req)[STATE_COOKIE];
  return Boolean(state) && Boolean(expected) && state === expected;
}

export function clearState(res) {
  clearCookie(res, STATE_COOKIE);
}

/** Upsert a user from an OIDC identity claim set. */
export function upsertUser({ provider, sub, email, name, avatarUrl }) {
  const existing = db
    .prepare('SELECT * FROM users WHERE provider = ? AND provider_sub = ?')
    .get(provider, sub);
  if (existing) {
    db.prepare('UPDATE users SET email = ?, name = ?, avatar_url = ? WHERE id = ?').run(
      email || existing.email,
      name ?? existing.name,
      avatarUrl ?? existing.avatar_url,
      existing.id
    );
    return db.prepare('SELECT * FROM users WHERE id = ?').get(existing.id);
  }
  const byEmail = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (byEmail) {
    // Same human, new provider — link the identity instead of creating a dupe.
    db.prepare('UPDATE users SET provider = ?, provider_sub = ?, name = COALESCE(NULLIF(?, \'\'), name), avatar_url = COALESCE(NULLIF(?, \'\'), avatar_url) WHERE id = ?').run(
      provider, sub, name ?? '', avatarUrl ?? '', byEmail.id
    );
    return db.prepare('SELECT * FROM users WHERE id = ?').get(byEmail.id);
  }
  const id = crypto.randomUUID();
  db.prepare(
    'INSERT INTO users (id, email, name, avatar_url, provider, provider_sub) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, email, name ?? '', avatarUrl ?? '', provider, sub);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}
