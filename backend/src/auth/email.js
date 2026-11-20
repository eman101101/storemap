/**
 * Passwordless email sign-in: a 6-digit code per login attempt. The code is
 * stored hashed (sha256) with a 10-minute TTL in the login_tokens table and
 * is single-use. With RESEND_API_KEY set the code is emailed via Resend;
 * without it the code is returned to the caller (devCode) so local/self-host
 * instances work with zero setup — the login UI labels it "local mode".
 */
import crypto from 'node:crypto';
import { config } from '../config.js';
import { db, newId } from '../db.js';

const CODE_TTL_MIN = 10;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const emailValid = (raw) => EMAIL_RE.test(String(raw || '')) && String(raw).length <= 200;

/** An email already owned by a social provider can't be claimed by a code. */
export function emailLoginAllowed(email) {
  const row = db.prepare('SELECT provider FROM users WHERE email = ?').get(email);
  return !row || row.provider === 'dev' || row.provider === 'email';
}

const hash = (code) => crypto.createHash('sha256').update(code).digest('hex');

/** Mint a fresh code for an email, purging expired rows. Returns devMode. */
export function issueLoginCode(email) {
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const expires = new Date(Date.now() + CODE_TTL_MIN * 60_000).toISOString();
  db.prepare('DELETE FROM login_tokens WHERE expires_at < ?').run(new Date().toISOString());
  db.prepare('INSERT INTO login_tokens (id, email, code_hash, expires_at) VALUES (?, ?, ?, ?)')
    .run(newId(), email, hash(code), expires);
  return { code, emailed: Boolean(config.resendApiKey) };
}

/** Send the code via Resend. Throws on API failure so the route can 502. */
export async function sendCode(email, code) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: config.emailFrom,
      to: email,
      subject: `Your ${CODE_TTL_MIN}-minute sign-in code`,
      text: `Your sign-in code is ${code}. It expires in ${CODE_TTL_MIN} minutes.\n\nIf you didn't request it, ignore this email.`,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Resend send failed: ${res.status}`);
}

/** Verify + consume the code. Returns true exactly once per issued code. */
export function checkLoginCode(email, code) {
  const now = new Date().toISOString();
  const row = db
    .prepare(
      `SELECT id, code_hash FROM login_tokens
        WHERE email = ? AND used_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1`
    )
    .get(email, now);
  if (!row || row.code_hash !== hash(String(code || '').trim())) return false;
  db.prepare('UPDATE login_tokens SET used_at = ? WHERE id = ?').run(now, row.id);
  return true;
}
