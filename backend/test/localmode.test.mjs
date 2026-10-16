/** Local mode (SELF_HOSTED=true): paid-tier features included, plan self-serve. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.NODE_ENV = 'test';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'storemap-local-test-'));
process.env.SESSION_SECRET = 'test-secret';
process.env.ENABLE_DEV_LOGIN = 'true';
process.env.SELF_HOSTED = 'true';
process.env.PORT = '0';

const { createApp } = await import('../src/app.js');
const app = createApp();
const server = app.listen(0);
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => new Promise((resolve) => server.close(resolve)));

async function call(path, { method = 'GET', body, cookie, headers = {} } = {}) {
  const raw = Buffer.isBuffer(body);
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : raw ? new Uint8Array(body) : JSON.stringify(body),
  });
  let json = null;
  try { json = JSON.parse(await res.text()); } catch { /* non-JSON */ }
  return { status: res.status, body: json, setCookie: res.headers.getSetCookie?.() ?? [] };
}

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000154a24f400000000049454e44ae426082', 'hex');

test('local mode includes product images for every store', async () => {
  const login = await call('/api/auth/dev-login', { method: 'POST', body: { email: 'local@example.com' } });
  const cookie = sessionCookie(login.setCookie);
  const store = (await call('/api/stores', { method: 'POST', cookie, body: { name: 'Local Mart' } })).body.store;
  assert.equal(store.plan, 'free');
  assert.equal(store.entitlements.productImages, true); // local mode: included

  const prod = await call(`/api/stores/${store.id}/products`, { method: 'POST', cookie, body: { name: 'Chips' } });
  const up = await call(`/api/products/${prod.body.product.id}/image`, {
    method: 'POST', cookie, headers: { 'Content-Type': 'image/png' }, body: PNG,
  });
  assert.equal(up.status, 200);
  assert.ok(up.body.url.startsWith('/uploads/'));

  // junk bytes with an image content-type are rejected
  const bad = await call(`/api/products/${prod.body.product.id}/image`, {
    method: 'POST', cookie, headers: { 'Content-Type': 'image/png' }, body: Buffer.from('definitely not a png'),
  });
  assert.equal(bad.status, 400);
});

test('local mode: owner can flip plan freely (billing not involved)', async () => {
  const login = await call('/api/auth/dev-login', { method: 'POST', body: { email: 'local2@example.com' } });
  const cookie = sessionCookie(login.setCookie);
  const store = (await call('/api/stores', { method: 'POST', cookie, body: { name: 'Local Two' } })).body.store;
  const patched = await call(`/api/stores/${store.id}`, { method: 'PATCH', cookie, body: { plan: 'pro' } });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.store.plan, 'pro');
});

function sessionCookie(setCookie) {
  const c = setCookie.find((s) => s.startsWith('st_session='));
  assert.ok(c, 'expected a session cookie');
  return c.split(';')[0];
}
