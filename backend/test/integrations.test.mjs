/**
 * CSV interchange tests: parser, alias mapping, and round-trips.
 * (Provider adapters were removed — CSV and the v1 API are the ways in.)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.NODE_ENV = 'test';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'storemap-int-test-'));
process.env.SESSION_SECRET = 'test-secret';
process.env.ENABLE_DEV_LOGIN = 'true';
process.env.PORT = '0';

const { createApp } = await import('../src/app.js');
const { rowsFromCsv, parseCsv, toCsv } = await import('../src/lib/stocksoft/csv.js');
const app = createApp();
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => new Promise((r) => server.close(r)));

async function call(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* csv */ }
  return { status: res.status, body: json, text: res.text ? null : null, res };
}

function sessionCookie(res) {
  const c = res.headers.getSetCookie().find((s) => s.startsWith('st_session='));
  assert.ok(c);
  return c.split(';')[0];
}

async function seedStore(email) {
  const res = await call('/api/auth/dev-login', { method: 'POST', body: { email } });
  const cookie = sessionCookie(res.res);
  const { body } = await call('/api/stores', { method: 'POST', cookie, body: { name: 'Sync Mart' } });
  return { cookie, storeId: body.store.id };
}

/* ---------------- CSV helpers ---------------- */

test('csv parser handles quoted fields and embedded separators', () => {
  const rows = parseCsv('name,price\n"Flour, 1kg",2.50\n"Say ""hi""",1\n');
  assert.deepEqual(rows, [
    { name: 'Flour, 1kg', price: '2.50' },
    { name: 'Say "hi"', price: '1' },
  ]);
});

test('csv round-trips', () => {
  const csv = toCsv([{ a: 'x,y', b: 'q"z' }, { a: 'p', b: '' }]);
  const back = parseCsv(csv);
  assert.equal(back[0].a, 'x,y');
  assert.equal(back[0].b, 'q"z');
});

test('rowsFromCsv maps common column aliases', () => {
  const rows = rowsFromCsv('SKU,Product Name,Stock,RRP\r\nABC-1,Oat Milk,14,2.10\r\n');
  assert.deepEqual(rows, [{ sku: 'ABC-1', barcode: '', name: 'Oat Milk', brand: '', price: 2.1, quantity: 14 }]);
});

/* ---------------- adapters (mocked transport) ---------------- */

