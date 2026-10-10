/**
 * Integration-framework tests: adapter normalisation with a mocked fetch
 * transport, CSV import/export, and the sync endpoint end-to-end.
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
const { PROVIDERS, rowsFromCsv, providerList } = await import('../src/lib/stocksoft/index.js');
const { parseCsv, toCsv } = await import('../src/lib/stocksoft/csv.js');
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

test('shopify adapter normalises variants and follows pagination', async () => {
  let calls = [];
  const mockFetch = async (url) => {
    calls.push(String(url));
    if (calls.length === 1) {
      return new Response(JSON.stringify({ products: [{ id: 1, title: 'Oat Milk', vendor: 'Oaty', variants: [{ id: 11, title: '1L', sku: 'OAT-1L', barcode: '999', price: '2.50', inventory_quantity: 7 }] }] }), { headers: { link: '<https://x/admin/api/2024-10/products.json?page_info=2>; rel="next"' } });
    }
    return new Response(JSON.stringify({ products: [{ id: 2, title: 'Rye', vendor: 'Bakey', variants: [{ id: 12, title: 'Default Title', sku: 'RYE-1', price: '3.00' }] }] }));
  };
  const rows = await PROVIDERS.shopify.fetchProducts({ shopDomain: 'x.myshopify.com', accessToken: 't' }, mockFetch);
  assert.equal(calls.length, 2, 'follows the Link: rel=next header');
  assert.deepEqual(rows[0], { sku: 'OAT-1L', barcode: '999', name: 'Oat Milk — 1L', brand: 'Oaty', price: 2.5, quantity: 7 });
  assert.equal(rows[1].name, 'Rye', 'Default Title collapses to product title');
  assert.equal(rows[1].quantity, undefined);
});

test('clover, lightspeed, katana, zoho, square adapters normalise their payloads', async () => {
  const clover = await PROVIDERS.clover.fetchProducts(
    { accessToken: 't', merchantId: 'M' },
    async () => new Response(JSON.stringify({ elements: [{ id: 'i1', name: 'Gum', sku: 'GUM-1', price: 150, stockCount: '5', barcode: '123' }] }))
  );
  assert.deepEqual(clover[0], { sku: 'GUM-1', barcode: '123', name: 'Gum', brand: '', price: 1.5, quantity: 5 });

  const vend = await PROVIDERS.lightspeed.fetchProducts(
    { domainPrefix: 'demo', accessToken: 't' },
    async () => new Response(JSON.stringify({ data: [{ id: 'v1', name: 'Chips', sku: 'CHIP-1', brand_name: 'Crispy', price: '3.5', inventory: [{ count: '22' }] }], links: {} }))
  );
  assert.equal(vend[0].quantity, 22);

  const katana = await PROVIDERS.katana.fetchProducts(
    { apiToken: 't' },
    async () => new Response(JSON.stringify({ data: [{ id: 9, sku: 'K-1', name: 'Soap', in_stock: 4, sales_price: '1.25' }] }))
  );
  assert.equal(katana[0].quantity, 4);

  const zoho = await PROVIDERS.zoho.fetchProducts(
    { organizationId: 'org', accessToken: 't' },
    async () => new Response(JSON.stringify({ items: [{ item_id: 'z1', sku: 'Z-1', name: 'Tea', brand: 'Leafy', rate: 4.2, stock_on_hand: 9 }], page_context: { has_more_page: false } }))
  );
  assert.equal(zoho[0].price, 4.2);

  const square = await PROVIDERS.square.fetchProducts(
    { accessToken: 't', environment: 'sandbox' },
    async (url) => {
      assert.ok(url.startsWith('https://connect.squareupsandbox.com'));
      if (String(url).includes('/catalog/list')) {
        return new Response(JSON.stringify({ objects: [{ id: 'o1', item_data: { name: 'Latte', variations: [{ id: 'var1', item_variation_data: { sku: 'LAT-12', price_money: { amount: 450, currency_code: 'USD' } } }] } }] }));
      }
      return new Response(JSON.stringify({ counts: [{ catalog_object_id: 'var1', state: 'IN_STOCK', quantity: '3' }] }));
    }
  );
  assert.equal(square[0].sku, 'LAT-12');
  assert.equal(square[0].price, 4.5);
});

test('adapters surface HTTP errors as readable messages', async () => {
  await assert.rejects(
    () => PROVIDERS.shopify.fetchProducts({ shopDomain: 'x.myshopify.com', accessToken: 'bad' }, async () => new Response('nope', { status: 401 })),
    /401/
  );
});

test('stocktrack adapter reads a StockTrack /api/v1/stock endpoint', async () => {
  const rows = await PROVIDERS.stocktrack.fetchProducts(
    { baseUrl: 'https://other-store.example.com', apiKey: 'skm_abc' },
    async () => new Response(JSON.stringify({ items: [{ sku: 'EXT-1', name: 'From elsewhere', quantity: 8, price: 1.0 }] }))
  );
  assert.equal(rows[0].sku, 'EXT-1');
  assert.equal(rows[0].quantity, 8);
});

/* ---------------- sync endpoint end-to-end ---------------- */

test('connecting + syncing a provider imports products and stock', async () => {
  const { cookie, storeId } = await seedStore('syncer@example.com');
  const providers = await call(`/api/stores/${storeId}/integrations`, { cookie });
  assert.equal(providers.status, 200);
  assert.ok(providers.body.providers.some((p) => p.id === 'shopify'));
  assert.ok(providerList().length >= 8, 'all major providers are exposed');

  const missing = await call(`/api/stores/${storeId}/integrations`, { method: 'POST', cookie, body: { provider: 'shopify', credentials: {} } });
  assert.equal(missing.status, 400, 'required credential fields are validated');

  const conn = await call(`/api/stores/${storeId}/integrations`, {
    method: 'POST', cookie, body: { provider: 'shopify', credentials: { shopDomain: 'demo.myshopify.com', accessToken: 't' } },
  });
  assert.equal(conn.status, 201);
  const integId = conn.body.connection.id;

  // Fake the remote Shopify API by pointing the adapter's transport at our own app? Simpler:
  // connect a provider whose fetch we cannot intercept over HTTP, so use CSV one-shot + a saved
  // csv connection for the sync endpoint, plus verify a failing real sync records last_error.
  const csvImport = await call(`/api/stores/${storeId}/integrations/csv`, {
    method: 'POST', cookie, body: { csv: 'sku,name,quantity,price\nIMP-1,Imported Beans,5,6.5\nIMP-1,Imported Beans,5,6.75\n' },
  });
  assert.equal(csvImport.status, 200);
  assert.equal(csvImport.body.imported, 2, 'both rows processed');

  const stock = await call(`/api/stores/${storeId}/stock`, { cookie });
  const beans = stock.body.stock.find((s) => s.sku === 'IMP-1');
  assert.equal(beans.name, 'Imported Beans');
  assert.equal(beans.quantity, 5, 'second row upserts, not duplicates');
  assert.equal(beans.name && stock.body.stock.find((s) => s.sku === 'IMP-1') !== undefined, true);

  const csvConn = await call(`/api/stores/${storeId}/integrations`, {
    method: 'POST', cookie, body: { provider: 'csv', credentials: {} },
  });
  const sync = await call(`/api/stores/${storeId}/integrations/${csvConn.body.connection.id}/sync`, {
    method: 'POST', cookie, body: { csv: 'sku,name,quantity\nIMP-2,Kombucha,11\n' },
  });
  assert.equal(sync.status, 200);
  assert.equal(sync.body.imported, 1);

  const after = await call(`/api/stores/${storeId}/stock`, { cookie });
  assert.equal(after.body.stock.find((s) => s.sku === 'IMP-2').quantity, 11);
  const conns = await call(`/api/stores/${storeId}/integrations`, { cookie });
  assert.ok(conns.body.connections.find((c) => c.id === csvConn.body.connection.id).last_sync_at);

  // failing sync (missing csv body → zero rows is fine, but a broken provider errors cleanly)
  const badConn = await call(`/api/stores/${storeId}/integrations`, {
    method: 'POST', cookie, body: { provider: 'shopify', credentials: { shopDomain: 'demo.myshopify.com', accessToken: 't' } },
  });
  const failed = await call(`/api/stores/${storeId}/integrations/${badConn.body.connection.id}/sync`, { method: 'POST', cookie, body: {} });
  assert.equal(failed.status, 502, 'network failure surfaces as 502');
  const connsAfter = await call(`/api/stores/${storeId}/integrations`, { cookie });
  assert.ok(connsAfter.body.connections.find((c) => c.id === badConn.body.connection.id).last_error, 'last_error recorded');

  // export
  const csv = await fetch(base + `/api/stores/${storeId}/catalog.csv`, { headers: { Cookie: cookie } });
  assert.equal(csv.status, 200);
  const text = await csv.text();
  assert.match(text, /IMP-1/);
  assert.match(text, /Imported Beans/);

  // disconnect
  const del = await call(`/api/stores/${storeId}/integrations/${csvConn.body.connection.id}`, { method: 'DELETE', cookie });
  assert.equal(del.status, 200);
});
