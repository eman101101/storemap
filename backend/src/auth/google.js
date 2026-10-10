import { config } from '../config.js';
import { verifyOidcToken } from '../lib/jwt.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';
const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

export const googleEnabled = () =>
  Boolean(config.google.clientId && config.google.clientSecret);

export function redirectUri() {
  return `${config.publicBaseUrl}/api/auth/google/callback`;
}

export function authorizeUrl({ state, nonce }) {
  const params = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce,
    access_type: 'online',
    prompt: 'select_account',
  });
  return `${AUTH_URL}?${params}`;
}

async function exchangeCode(code) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status}`);
  return res.json();
}

/** Full callback handling: code → id_token (verified) → normalized identity. */
export async function handleCallback({ code, nonce }) {
  const tokens = await exchangeCode(code);
  const claims = await verifyOidcToken(tokens.id_token, {
    jwksUrl: JWKS_URL,
    issuer: ISSUERS,
    audience: config.google.clientId,
    nonce,
  });
  return {
    provider: 'google',
    sub: claims.sub,
    email: claims.email,
    name: claims.name || claims.email?.split('@')[0] || 'Store owner',
    avatarUrl: claims.picture || '',
  };
}
