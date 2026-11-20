/**
 * Passwordless email sign-in codes (port of backend/src/auth/email.js — keep
 * the flows identical). 6-digit code, sha256-hashed in login_tokens, 10-minute
 * TTL, single use. With RESEND_API_KEY set the code is emailed via Resend;
 * without it the route returns the code (devCode) for local/self-host use.
 */
import type { Env } from './config';
import { first, run } from './db';
import { newId } from './util';

const CODE_TTL_MIN = 10;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const emailValid = (raw: unknown): boolean =>
  EMAIL_RE.test(String(raw || '')) && String(raw).length <= 200;

/** An email already owned by a social provider can't be claimed by a code. */
export async function emailLoginAllowed(env: Env, email: string): Promise<boolean> {
  const row = await first(env, 'SELECT provider FROM users WHERE email = ?', email);
  return !row || row.provider === 'dev' || row.provider === 'email';
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Mint a fresh code for an email, purging expired rows. */
export async function issueLoginCode(env: Env, email: string): Promise<string> {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  const code = String(buf[0] % 1_000_000).padStart(6, '0');
  const now = new Date();
  const expires = new Date(now.getTime() + CODE_TTL_MIN * 60_000).toISOString();
  await run(env, 'DELETE FROM login_tokens WHERE expires_at < ?', now.toISOString());
  await run(env, 'INSERT INTO login_tokens (id, email, code_hash, expires_at) VALUES (?, ?, ?, ?)', newId(), email, await sha256Hex(code), expires);
  return code;
}

/** Send the code via Resend. Throws on API failure so the route can 502. */
export async function sendCode(apiKey: string, from: string, email: string, code: string): Promise<void> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: email,
      subject: `Your ${CODE_TTL_MIN}-minute sign-in code`,
      text: `Your sign-in code is ${code}. It expires in ${CODE_TTL_MIN} minutes.\n\nIf you didn't request it, ignore this email.`,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Resend send failed: ${res.status}`);
}

/** Verify + consume the code. Returns true exactly once per issued code. */
export async function checkLoginCode(env: Env, email: string, code: string): Promise<boolean> {
  const now = new Date().toISOString();
  const row = await first(
    env,
    `SELECT id, code_hash FROM login_tokens
      WHERE email = ? AND used_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1`,
    email, now
  );
  if (!row || row.code_hash !== (await sha256Hex(code))) return false;
  await run(env, 'UPDATE login_tokens SET used_at = ? WHERE id = ?', now, row.id);
  return true;
}
