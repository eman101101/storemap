/**
 * Encryption-at-rest for integration credentials (IMPROVEMENTS F4).
 * AES-256-GCM with a key derived (scrypt) from INTEGRATION_KEY or SESSION_SECRET,
 * so the DB alone never yields provider tokens. Format: enc:v1:<iv>:<tag>:<ct>
 * (base64url segments). `decrypt` passes through non-prefixed values so rows
 * saved before this feature keep working until re-saved (lazy re-encrypt).
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const key = scryptSync(
  process.env.INTEGRATION_KEY || process.env.SESSION_SECRET || 'dev-only',
  'storemap-integrations-v1',
  32
);

export function encStr(plain) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return `enc:v1:${iv.toString('base64url')}:${c.getAuthTag().toString('base64url')}:${ct.toString('base64url')}`;
}

export function decStr(value) {
  if (typeof value !== 'string' || !value.startsWith('enc:v1:')) return value;
  const [, , iv, tag, ct] = value.split(':');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}
