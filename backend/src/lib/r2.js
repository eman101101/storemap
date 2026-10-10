/**
 * Minimal S3-compatible client for Cloudflare R2 — AWS SigV4 signing with
 * node:crypto, no SDK dependency. Used for Stage-0 media storage (see
 * docs/INFRASTRUCTURE.md §5.1): uploads stream to R2, serving proxies back
 * through the app under the same /uploads/* URLs so nothing else changes.
 *
 * Enable by setting R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and
 * R2_BUCKET (see .env.example). Without them the app stores media on disk as
 * before — local dev needs nothing.
 */
import { createHash, createHmac } from 'node:crypto';
import { config } from '../config.js';

const sha256Hex = (data) => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();

export const r2Enabled = () => Boolean(config.r2);

const endpoint = () => `https://${config.r2.accountId}.r2.cloudflarestorage.com`;

/** RFC 3986 encode like S3 expects (optionally keep slashes in keys). */
const s3Encode = (s, keepSlash = false) => {
  const enc = encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return keepSlash ? enc.replace(/%2F/g, '/') : enc;
};

/** Build the Authorization header for a request (AWS SigV4, region "auto"). */
export function sigv4Headers({ method, key, body, contentType, now = new Date() }) {
  const url = new URL(`${endpoint()}/${config.r2.bucket}/${s3Encode(key, true)}`);
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);
  const host = url.host;

  const headers = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (contentType) headers['content-type'] = contentType;

  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((h) => `${h}:${headers[h]}\n`)
    .join('');
  const canonicalRequest = [
    method,
    `/${config.r2.bucket}/${s3Encode(key, true)}`,
    url.search.replace(/^\?/, ''),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${date}/auto/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = hmac(`AWS4${config.r2.secretAccessKey}`, date);
  const kScope = hmac(kDate, `${'auto'}/s3/aws4_request`);
  const signature = createHmac('sha256', kScope).update(stringToSign).digest('hex');

  return {
    ...headers,
    Authorization: `AWS4-HMAC-SHA256 Credential=${config.r2.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

/** PUT an object. Throws with status text on failure. */
export async function r2Put(key, body, contentType) {
  const headers = sigv4Headers({ method: 'PUT', key, body, contentType });
  const res = await fetch(`${endpoint()}/${config.r2.bucket}/${s3Encode(key, true)}`, {
    method: 'PUT',
    headers,
    body,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`R2 PUT ${key} failed: ${res.status} ${await res.text().catch(() => '')}`);
}

/** GET an object — returns the fetch Response (streamable), or null on 404. */
export async function r2Get(key) {
  const headers = sigv4Headers({ method: 'GET', key, body: Buffer.alloc(0) });
  const res = await fetch(`${endpoint()}/${config.r2.bucket}/${s3Encode(key, true)}`, {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`R2 GET ${key} failed: ${res.status}`);
  return res;
}
