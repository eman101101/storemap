import { config } from '../config.js';
import { signEs256, verifyOidcToken } from '../lib/jwt.js';

const AUTH_URL = 'https://appleid.apple.com/auth/authorize';
const TOKEN_URL = 'https://appleid.apple.com/auth/token';
const JWKS_URL = 'https://appleid.apple.com/auth/keys';
const ISSUER = 'https://appleid.apple.com';

export const appleEnabled = () =>
  Boolean(config.apple.clientId && config.apple.teamId && config.apple.keyId && config.apple.privateKey);

export function redirectUri() {
  return `${config.publicBaseUrl}/api/auth/apple/callback`;
}

/** Apple requires the OAuth client_secret to be a short-lived ES256 JWT. */
function clientSecret() {
  const now = Math.floor(Date.now() / 1000);
  return signEs256(
    {
      iss: config.apple.teamId,
      iat: now,
      exp: now + 3600,
      aud: ISSUER,
      sub: config.apple.clientId,
    },
    config.apple.privateKey,
    config.apple.keyId
  );
}

export function authorizeUrl({ state, nonce }) {
  const params = new URLSearchParams({
    client_id: config.apple.clientId,
    redirect_uri: redirectUri(),
    response_type: 'code id_token',
    response_mode: 'form_post',
    scope: 'name email',
    state,
    nonce,
  });
  return `${AUTH_URL}?${params}`;
}

async function exchangeCode(code) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.apple.clientId,
      client_secret: clientSecret(),
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Apple token exchange failed: ${res.status}`);
  return res.json();
}

/**
 * Apple POSTs back (form_post) with code + id_token, and `user` (name JSON)
 * only on first authorization.
 * @returns normalized identity
 */
export async function handleCallback({ code, idToken, nonce, userField }) {
  if (!code && idToken) {
    // Some configurations deliver only the id_token; it is verified below.
    var tokens = {};
  } else {
    var tokens = await exchangeCode(code);
  }
  const rawIdToken = tokens.id_token || idToken;
  const claims = await verifyOidcToken(rawIdToken, {
    jwksUrl: JWKS_URL,
    issuer: ISSUER,
    audience: config.apple.clientId,
    nonce,
  });
  let name = '';
  try {
    const u = typeof userField === 'string' ? JSON.parse(userField) : userField;
    if (u?.name) name = [u.name.firstName, u.name.lastName].filter(Boolean).join(' ');
  } catch {
    /* name only arrives on first authorization; absent afterwards */
  }
  return {
    provider: 'apple',
    sub: claims.sub,
    email: claims.email || '',
    name: name || claims.email?.split('@')[0] || 'Store owner',
    avatarUrl: '',
  };
}
