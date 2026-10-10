import crypto from 'node:crypto';

const b64url = (buf) => Buffer.from(buf).toString('base64url');

export function decodeJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('malformed JWT');
  return {
    header: JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')),
    payload: JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')),
    signingInput: `${parts[0]}.${parts[1]}`,
    signature: Buffer.from(parts[2], 'base64url'),
  };
}

/** HMAC-SHA256 signed JWT (sessions). */
export function signHs256(payload, secret) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const input = `${header}.${body}`;
  const sig = crypto.createHmac('sha256', secret).update(input).digest('base64url');
  return `${input}.${sig}`;
}

export function verifyHs256(token, secret) {
  const expected = signHs256(decodeJwt(token).payload, secret);
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error('bad signature');
  return decodeJwt(token).payload;
}

/** ES256-signed JWT (Apple client_secret). keyPem: PKCS#8 or SEC1 EC private key. */
export function signEs256(payload, keyPem, kid) {
  const header = b64url(JSON.stringify({ alg: 'ES256', kid, typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const input = `${header}.${body}`;
  const sig = crypto
    .createSign('sha256')
    .update(input)
    .sign({ key: keyPem, dsaEncoding: 'ieee-p1363' })
    .toString('base64url');
  return `${input}.${sig}`;
}

const jwkCache = new Map(); // jwksUrl -> { keys, fetchedAt }

async function fetchJwks(jwksUrl) {
  const cached = jwkCache.get(jwksUrl);
  if (cached && Date.now() - cached.fetchedAt < 60 * 60 * 1000) return cached.keys;
  const res = await fetch(jwksUrl, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const keys = (await res.json()).keys ?? [];
  jwkCache.set(jwksUrl, { keys, fetchedAt: Date.now() });
  return keys;
}

/**
 * Verify an ES256 OIDC id_token against a JWKS endpoint:
 * signature, issuer, audience, expiry and (optionally) nonce.
 */
export async function verifyOidcToken(token, { jwksUrl, issuer, audience, nonce }) {
  const { header, payload, signingInput, signature } = decodeJwt(token);
  if (header.alg !== 'ES256') throw new Error(`unexpected alg ${header.alg}`);
  const keys = await fetchJwks(jwksUrl);
  const jwk = keys.find((k) => k.kid === header.kid) ?? keys[0];
  if (!jwk) throw new Error('no matching JWKS key');
  const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const ok = crypto.verify(
    'sha256',
    Buffer.from(signingInput),
    { key, dsaEncoding: 'ieee-p1363' },
    signature
  );
  if (!ok) throw new Error('bad id_token signature');
  const issuers = Array.isArray(issuer) ? issuer : [issuer];
  if (!issuers.includes(payload.iss)) throw new Error(`bad issuer ${payload.iss}`);
  if (payload.aud !== audience) throw new Error('bad audience');
  if (!payload.exp || payload.exp * 1000 < Date.now() - 60_000) throw new Error('expired id_token');
  if (nonce && payload.nonce !== nonce) throw new Error('nonce mismatch');
  return payload;
}

export function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}
