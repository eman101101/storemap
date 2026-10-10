/**
 * Stock tracking + API key + integrations tests. Boots the real app on an
 * ephemeral port with a throwaway database.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.NODE_ENV = 'test';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'storemap-stock-test-'));
process.env.SESSION_SECRET = 'test-secret';
process.env.ENABLE_DEV_LOGIN = 'true';
process.env.PORT = '0';

const { createApp } = await import('../src/app.js');
const app = createApp();
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => new Promise((r) => server.close(r)));

async function call(path, { method = 'GET', body, cookie, headers = {} } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* not json */ }
  return { status: res.status, body: json, res };
}

function sessionCookie(setCookieList) {
  const c = setCookieList.find((s) => s.startsWith('st_session='));
  assert.ok(c, 'expected session cookie');
  return c.split(';')[0];
}

async function loginAs(email) {
  const res = await call('/api/auth/dev-login', { method: 'POST', body: { email } });
  return sessionCookie(res.res.headers.getSetCookie());
}

/** Set up a store with two products and return { cookie, storeId, products }. */
async function seedStore(email) {
  const cookie = await loginAs(email);
  const { body } = await call('/api/stores', { method: 'POST', cookie, body: { name: 'Stock Hall' } });
  const storeId = body.store.id;
  const p1 = await call(`/api/stores/${storeId}/products`, { method: 'POST', cookie, body: { name: 'Milk 2%', sku: 'MILK-2', barcode: '40012345' } });
  const p2 = await call(`/api/stores/${storeId}/products`, { method: 'POST', cookie, body: { name: 'Rye Bread', sku: 'BREAD-RYE' } });
  return { cookie, storeId, products: [p1.body.product, p2.body.product] };
}

test('stock adjust accumulates and logs movements', async () => {
  const { cookie, storeId, products } = await seedStore('stocker1@example.com');
  const milk = products[0];
  const a = await call(`/api/stores/${storeId}/stock/adjust`, { method: 'POST', cookie, body: { product_id: milk.id, delta: 10, reason: 'delivery' } });
  assert.equal(a.status, 200);
  assert.equal(a.body.level.quantity, 10);
  const b = await call(`/api/stores/${storeId}/stock/adjust`, { method: 'POST', cookie, body: { product_id: milk.id, delta: -3 } });
  assert.equal(b.body.level.quantity, 7);
  const c = await call(`/api/stores/${storeId}/stock/set`, { method: 'POST', cookie, body: { product_id: milk.id, quantity: 20 } });
  assert.equal(c.body.level.quantity, 20);

  const list = await call(`/api/stores/${storeId}/stock`, { cookie });
  assert.equal(list.status, 200);
  const milkRow = list.body.stock.find((s) => s.product_id === milk.id);
  assert.equal(milkRow.quantity, 20);
  assert.equal(list.body.movements.length, 3, 'each adjustment is a logged movement');
  assert.equal(list.body.movements[0].delta, 13, 'set logs the delta that produced the count');
});

test('stock endpoints reject invalid input and foreign products', async () => {
  const { cookie, storeId } = await seedStore('stocker2@example.com');
  assert.equal((await call(`/api/stores/${storeId}/stock/adjust`, { method: 'POST', cookie, body: { product_id: 'x', delta: 'lots' } })).status, 400);
  assert.equal((await call(`/api/stores/${storeId}/stock/set`, { method: 'POST', cookie, body: { product_id: 'x', quantity: -1 } })).status, 400);
  // product_id from another store must not resolve
  const other = await seedStore('stocker3@example.com');
  assert.equal(
    (await call(`/api/stores/${storeId}/stock/adjust`, { method: 'POST', cookie, body: { product_id: other.products[0].id, delta: 5 } })).status,
    400
  );
  assert.equal((await call(`/api/stores/${storeId}/stock`)).status, 401);
});

test('API keys: create once, authenticate the v1 API, revoke kills access', async () => {
  const { cookie, storeId, products } = await seedStore('keymaster@example.com');
  const created = await call(`/api/stores/${storeId}/keys`, { method: 'POST', cookie, body: { name: 'For my POS' } });
  assert.equal(created.status, 201);
  const key = created.body.api_key;
  assert.match(key, /^skm_/);

  const listed = await call(`/api/stores/${storeId}/keys`, { cookie });
  assert.equal(listed.body.keys.length, 1);
  assert.ok(!JSON.stringify(listed.body).includes(key), 'full key must never be listed again');
  assert.equal(listed.body.keys[0].key_prefix, key.slice(0, 10));

  // v1 with the key
  const auth = { Authorization: `Bearer ${key}` };
  assert.equal((await call('/api/v1/store', { headers: auth })).body.store.id, storeId);
  assert.equal((await call('/api/v1/store')).status, 401, 'no key → 401');
  assert.equal((await call('/api/v1/store', { headers: { 'X-API-Key': 'skm_bogus' } })).status, 401);

  const adj = await call('/api/v1/stock/adjust', { method: 'POST', headers: auth, body: { sku: products[0].sku, delta: 6, source: 'pos-terminal' } });
  assert.equal(adj.status, 200);
  assert.equal(adj.body.level.quantity, 6);
  const set = await call('/api/v1/stock/set', { method: 'POST', headers: auth, body: { barcode: products[0].barcode, quantity: 4 } });
  assert.equal(set.body.level.quantity, 4);
  const stock = await call('/api/v1/stock', { headers: auth });
  assert.equal(stock.body.items.find((i) => i.sku === 'MILK-2').quantity, 4);

  // upsert via v1: existing sku updated, new product created
  const upd = await call('/api/v1/products', { method: 'POST', headers: auth, body: { sku: 'BREAD-RYE', price: 3.25, quantity: 12 } });
  assert.equal(upd.status, 200);
  assert.equal(upd.body.created, false);
  const made = await call('/api/v1/products', { method: 'POST', headers: auth, body: { name: 'Choc Bar', sku: 'CHOC-1', quantity: 30 } });
  assert.equal(made.status, 201);
  assert.equal(made.body.level.quantity, 30);

  // map endpoint exposes the layout
  const map = await call('/api/v1/map', { headers: auth });
  assert.equal(map.status, 200);
  assert.ok(map.body.floors.length >= 1);

  // revoke
  const keyId = listed.body.keys[0].id;
  await call(`/api/stores/keys/${keyId}`, { method: 'DELETE', cookie });
  assert.equal((await call('/api/v1/store', { headers: auth })).status, 401, 'revoked key stops working');
});

test('API keys are scoped per store and ownership-checked', async () => {
  const owner = await seedStore('kown@example.com');
  const created = await call(`/api/stores/${owner.storeId}/keys`, { method: 'POST', cookie: owner.cookie, body: { name: 'k' } });
  const key = created.body.api_key;

  const stranger = await loginAs('kthief@example.com');
  const { body: s2 } = await call('/api/stores', { method: 'POST', cookie: stranger, body: { name: 'Other' } });
  const foreignKeyList = await call(`/api/stores/${s2.store.id}/keys`, { cookie: owner.cookie });
  assert.equal(foreignKeyList.status, 404, 'cannot list another store’s keys');

  // key only reaches its own store's data
  const stock = await call('/api/v1/stock', { headers: { Authorization: `Bearer ${key}` } });
  for (const item of stock.body.items) assert.ok(['MILK-2', 'BREAD-RYE'].includes(item.sku));
});
