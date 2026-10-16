/** Deck 02 — Authentication & Sessions. */
import K from './kit.mjs';
const { C, F, W, M } = K;
const SYSTEM = 'Authentication';

const p = K.mk(SYSTEM);
K.cover(p, {
  kicker: 'StoreMap systems  ·  02',
  title: 'Authentication\n& Sessions',
  subtitle:
    'Google and Apple sign-in via full OIDC — state, nonce, JWKS verification — feeding stateless HMAC session cookies. Plus the gated dev/demo logins that make local work one click.',
  stats: [
    { n: '2', label: 'OIDC providers (Google, Apple)' },
    { n: '30d', label: 'session lifetime' },
    { n: 'HS256', label: 'signed, timing-safe verify' },
    { n: '30/min', label: 'login rate limit per IP' },
  ],
  system: SYSTEM,
});

// 2 · Sign-in flow
let s = p.addSlide();
K.header(s, { kicker: 'Sign-in flow', title: 'Full OIDC round-trip — no library, hand-rolled', system: SYSTEM, page: 2 });
K.flow(p, s, {
  x: M, y: 1.7, w: W - 2 * M, bh: 1.05,
  steps: [
    { t: 'GET /auth/google', d: 'state+nonce cookie, redirect' },
    { t: 'Provider consent', d: 'Google / Apple' },
    { t: 'Callback', d: 'code + state echoed' },
    { t: 'Verify id_token', d: 'JWKS: sig, iss, aud, exp, nonce' },
    { t: 'upsertUser', d: 'link or create' },
    { t: 'issueSession', d: 'st_session cookie' },
  ],
});
K.bullets(s, [
  'State and nonce travel to the browser in one short-lived cookie (st_oauth, 10 min) and must come back verbatim — double-submit CSRF protection.',
  'Apple posts back via response_mode=form_post; the same state check and JWKS verification apply to its ES256 id_token.',
  'The ES256 Apple client_secret JWT (from the .p8 key) is built on the fly for each token exchange.',
  'Nothing about the user is trusted before the id_token clears signature, issuer, audience, expiry and nonce checks.',
], { x: M, y: 3.15, w: W - 2 * M, h: 2.9, size: 12.5 });
s.addText('Both providers degrade gracefully: unconfigured buttons render disabled on /login with an explanatory note.', { x: M, y: 6.15, w: W - 2 * M, h: 0.4, fontSize: 11, fontFace: F.body, color: C.MUTED, margin: 0 });

// 3 · token verification code
s = p.addSlide();
K.header(s, { kicker: 'Token verification', title: 'Verify everything, trust nothing implicit', system: SYSTEM, page: 3 });
K.codeCard(p, s, {
  x: M, y: 1.7, w: 7.3, h: 4.6, file: 'lib/jwt.js + auth/google.js (essentials)', size: 10,
  code: `// provider public keys, fetched and cached
const keys = await (await fetch(PROVIDER_JWKS)).json();

// kid must match — no silent fallback to keys[0]
const jwk = keys.find((k) => k.kid === header.kid);
if (!jwk) throw new Error('unknown kid');

verifySignature(token, jwk);          // RSA / ES256
if (payload.iss !== ISSUER)  throw …;
if (payload.aud !== CLIENT_ID) throw …;
if (payload.exp * 1000 < Date.now()) throw …;
if (payload.nonce !== expectedNonce) throw …;`,
});
K.bullets(s, [
  'JWKS are fetched from the provider\'s certs endpoint per verification (cached) — no shared secret with the provider.',
  'aud is checked against this app\'s client id, so another app\'s token is rejected even if signed by the same provider.',
  'nonce binds the token to this browser\'s authorization attempt — replayed tokens from another flow fail.',
  'Session JWTs use the same verify path with a symmetric secret and timingSafeEqual on the signature.',
], { x: 8.1, y: 1.75, w: 4.7, h: 4.5, size: 11.5 });

// 4 · sessions
s = p.addSlide();
K.header(s, { kicker: 'Sessions', title: 'A signed token in a hardened cookie', system: SYSTEM, page: 4 });
K.codeCard(p, s, {
  x: M, y: 1.7, w: 6.6, h: 3.0, file: 'auth/session.js', size: 10,
  code: `export function issueSession(res, userId) {
  const now = Math.floor(Date.now() / 1000);
  const token = signHs256(
    { sub: userId, iat: now,
      exp: now + config.sessionDays * 86400 },
    config.sessionSecret   // required in prod
  );
  setCookie(res, 'st_session', token,
    { maxAge: config.sessionDays * 86400 });
}`,
});
K.bullets(s, [
  'Stateless: no session table — the signed user id is the session; logout just clears the cookie.',
  'Cookie flags: HttpOnly (no JS access), SameSite=Lax (CSRF baseline), Path=/.',
  'verifyHs256 recomputes the signature and compares with timingSafeEqual, guarding the length first.',
  'Sessions expire after SESSION_DAYS (default 30); expired tokens fail the exp check in currentUser.',
  'currentUser never throws — a tampered cookie simply yields req.user = null.',
], { x: M, y: 4.95, w: 6.6, h: 2.1, size: 12 });
K.codeCard(p, s, {
  x: 7.4, y: 1.7, w: 5.4, h: 3.0, file: 'lib/http.js — cookie hygiene', size: 10,
  code: `res.setHeader('Set-Cookie',
  \`\${name}=\${encodeURIComponent(v)}; \` +
  \`Path=/; Max-Age=\${maxAge}; \` +
  'HttpOnly; SameSite=Lax');`,
});
K.chip(p, s, {
  x: 7.4, y: 4.95, w: 5.4, label: 'Watch out',
  text: 'Secure is not appended behind a TLS proxy — add it for production deployments (code-review finding, unfixed).',
});

// 5 · account linking
s = p.addSlide();
K.header(s, { kicker: 'Identity', title: 'One human, many providers — upsertUser', system: SYSTEM, page: 5 });
K.codeCard(p, s, {
  x: M, y: 1.7, w: 7.3, h: 4.4, file: 'auth/session.js — upsertUser (abridged)', size: 10,
  code: `// 1 · same identity signed in before?
SELECT * FROM users WHERE provider = ? AND provider_sub = ?
→ update profile fields, done.

// 2 · same email from another provider → link
UPDATE users SET provider = ?, provider_sub = ?,
  name  = COALESCE(NULLIF(?, ''), name),
  avatar_url = COALESCE(NULLIF(?, ''), avatar_url)
WHERE id = ?`,
});
K.bullets(s, [
  'Step 1 makes repeat sign-ins idempotent — no duplicate rows per login.',
  'Step 2 means signing in with Apple after Google keeps the same account (and all its stores).',
  'Otherwise a fresh uuid row is inserted; provider + provider_sub is the immutable identity.',
], { x: M, y: 6.25, w: 7.3, h: 1.0, size: 11.5 });
K.chip(p, s, {
  x: 8.1, y: 1.7, w: 4.7, label: 'Known issue',
  text: 'Email linking does not check OIDC email_verified. An identity asserting a victim\'s email could take over the account. Fix: require the claim before linking.',
});

// 6 · dev & demo login
s = p.addSlide();
K.header(s, { kicker: 'Local workflows', title: 'Dev login and one-click demo login', system: SYSTEM, page: 6 });
K.table(p, s, {
  x: M, y: 1.75, w: W - 2 * M, colW: [2.6, 3.1, 6.8], size: 11,
  rows: [
    ['Endpoint', 'Gate', 'Behavior'],
    ['POST /api/auth/dev-login', 'ENABLE_DEV_LOGIN=true (default outside prod)', 'Arbitrary email from the body → session; the e2e suite and local testing use it'],
    ['POST /api/auth/demo-login', 'same gate', 'No form: signs in as the demo-map owner (annex@storemap.demo) so anyone can edit the seeded maps'],
    ['Production', 'NODE_ENV=production', 'Both refuse unless ENABLE_DEV_LOGIN is explicitly true — a config mistake fails closed'],
  ],
});
K.bullets(s, [
  'The login page renders the one-click "Open the demo maps" button whenever the server reports dev login enabled (GET /api/auth/me → providers.dev).',
  'demo-login honors ?next= — "Edit map" on a demo store drops you straight into the editor after sign-in.',
  'Both endpoints sit behind the shared login rate limiter (30 requests/min per IP).',
], { x: M, y: 4.35, w: W - 2 * M, h: 2.0, size: 12.5 });

// 7 · hardening
s = p.addSlide();
K.header(s, { kicker: 'Hardening', title: 'What protects the endpoints', system: SYSTEM, page: 7 });
K.table(p, s, {
  x: M, y: 1.75, w: W - 2 * M, colW: [3.2, 10.2], size: 11.5,
  rows: [
    ['Control', 'Detail'],
    ['Rate limiting', 'In-memory fixed-window limiter (30/min) on all three login routes, keyed by req.ip; TRUST_PROXY makes the IP real behind proxies'],
    ['CSRF baseline', 'SameSite=Lax cookies; OAuth state double-submitted via cookie; JSON-only APIs'],
    ['Secret handling', 'SESSION_SECRET required in production; Apple .p8 key from env with \\n decoding; demo secrets never hardcoded'],
    ['OAuth errors', 'failLogin clears the state cookie and redirects to /login?error=… — no stack traces, no provider details leaked'],
    ['Session integrity', 'HS256 + timingSafeEqual; exp checked on every request in currentUser'],
    ['Logged out by default', 'requireAuth on every owner route; public routes explicitly scoped to is_public = 1'],
  ],
});
s.addText('Known gaps from the code review: cookie Secure flag behind TLS proxies, and JWKS kid fallback are tracked but not yet fixed.', { x: M, y: 6.35, w: W - 2 * M, h: 0.4, fontSize: 11, fontFace: F.body, color: C.MUTED, margin: 0 });

// 8 · tests
s = p.addSlide();
K.header(s, { kicker: 'Verification', title: 'What the tests pin down', system: SYSTEM, page: 8 });
K.bullets(s, [
  'api.test.mjs drives the real app: dev-login issues a usable session; /api/auth/me echoes the user.',
  'Unauthenticated access to every owner route is asserted (401), including uploads and the key API.',
  'The e2e journey signs in through dev-login and edits a store end to end on the built SPA.',
  'Demo login has its own test: session issued for annex@storemap.demo and /api/stores/mine is readable.',
  { t: 'Gap: the Google and Apple callback flows have no automated tests — they are verified manually against real provider consoles.', bold: true },
], { x: M, y: 1.75, w: W - 2 * M, h: 3.6, size: 12.5 });
K.codeCard(p, s, {
  x: M, y: 5.0, w: W - 2 * M, h: 1.7, file: 'test/api.test.mjs', size: 10,
  code: `test('demo login issues a session for the demo-map owner', async () => {
  const res = await call('/api/auth/demo-login', { method: 'POST' });
  assert.equal(res.status, 200);
  const me = await call('/api/auth/me', { cookie: sessionCookie(res.setCookie) });
  assert.equal(me.body.user.email, 'annex@storemap.demo');
});`,
});

K.closing(p, {
  title: 'Auth rules this system keeps',
  system: SYSTEM,
  points: [
    { t: 'Verify the whole token', d: 'signature, issuer, audience, expiry, nonce — every field, every login.' },
    { t: 'Stateless sessions', d: 'HS256 user-id tokens in HttpOnly cookies; no session table to scale or wipe.' },
    { t: 'Fail closed', d: 'dev conveniences refuse in production unless explicitly enabled; config mistakes stop the boot.' },
    { t: 'Honest gaps', d: 'email_verified linking, Secure cookies and JWKS kid fallback are documented review findings.' },
  ],
});

p.writeFile({ fileName: '02-authentication-sessions.pptx' }).then(() => console.log('ok 02'));
