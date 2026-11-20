/**
 * Sign in with Facebook — same OAuth authorization-code flow as Google, but
 * Facebook returns no OIDC id_token: the access token is exchanged for a
 * Graph /me call (id, name, email, picture) which IS the identity proof
 * (the token came from Facebook's own token endpoint over TLS).
 */
import { config } from '../config.js';

const AUTH_URL = 'https://www.facebook.com/v21.0/dialog/oauth';
const TOKEN_URL = 'https://graph.facebook.com/v21.0/oauth/access_token';
const ME_URL = 'https://graph.facebook.com/v21.0/me';

export const facebookEnabled = () =>
  Boolean(config.facebook.appId && config.facebook.appSecret);

export function redirectUri() {
  return `${config.publicBaseUrl}/api/auth/facebook/callback`;
}

export function authorizeUrl({ state }) {
  const params = new URLSearchParams({
    client_id: config.facebook.appId,
    redirect_uri: redirectUri(),
    state,
    response_type: 'code',
    scope: 'email,public_profile',
  });
  return `${AUTH_URL}?${params}`;
}

/** Full callback handling: code → access token → Graph /me → identity. */
export async function handleCallback({ code }) {
  const tokenRes = await fetch(
    `${TOKEN_URL}?${new URLSearchParams({
      client_id: config.facebook.appId,
      client_secret: config.facebook.appSecret,
      redirect_uri: redirectUri(),
      code,
    })}`,
    { signal: AbortSignal.timeout(15_000) }
  );
  if (!tokenRes.ok) throw new Error(`Facebook token exchange failed: ${tokenRes.status}`);
  const { access_token: accessToken } = await tokenRes.json();
  if (!accessToken) throw new Error('Facebook token exchange returned no token');

  const meRes = await fetch(
    `${ME_URL}?${new URLSearchParams({ fields: 'id,name,email,picture.type(large)', access_token: accessToken })}`,
    { signal: AbortSignal.timeout(15_000) }
  );
  if (!meRes.ok) throw new Error(`Facebook /me failed: ${meRes.status}`);
  const me = await meRes.json();
  if (!me.email) throw new Error('Facebook account has no shared email');

  return {
    provider: 'facebook',
    sub: String(me.id),
    email: String(me.email).toLowerCase(),
    name: me.name || me.email.split('@')[0],
    avatarUrl: me.picture?.data?.url || '',
  };
}
