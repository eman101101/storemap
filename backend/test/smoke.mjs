/**
 * End-to-end smoke test: boots the real server with a throwaway database and
 * walks the primary user journey over HTTP. Exits non-zero on any failure.
 *   npm run smoke
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.NODE_ENV = 'test';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'storemap-smoke-'));
process.env.SESSION_SECRET = 'smoke-secret';
process.env.ENABLE_DEV_LOGIN = 'true';

const { createApp } = await import('../src/app.js');
const server = createApp().listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

const step = (msg) => console.log(`  ✓ ${msg}`);

try {
  let res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 200);
  step('health endpoint OK');

  res = await fetch(base);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /<div id="root">/);
  step('SPA landing page served');

  res = await fetch(`${base}/api/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'smoke@example.com', name: 'Smoke Tester' }),
  });
  assert.equal(res.status, 200);
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith('st_session=')).split(';')[0];
  step('session login OK');

  res = await fetch(`${base}/api/stores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ name: 'Smoke Test Market' }),
  });
  assert.equal(res.status, 201);
  const { store } = await res.json();
  step(`store created (slug: ${store.slug})`);

  const full = await (await fetch(`${base}/api/stores/${store.id}/full`, { headers: { Cookie: cookie } })).json();
  const floorId = full.floors[0].id;
  res = await fetch(`${base}/api/floors/${floorId}/elements`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      elements: [
        { type: 'shelf', shape: 'rect', geometry: { x: 2, y: 2, w: 3, h: 1, rot: 0 }, label: 'Aisle 1' },
      ],
    }),
  });
  assert.equal(res.status, 200);
  step('map elements saved');

  const product = await (
    await fetch(`${base}/api/stores/${store.id}/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ name: 'Test Oat Milk', price: 2.99 }),
    })
  ).json();
  res = await fetch(`${base}/api/products/${product.product.id}/locations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ floor_id: floorId, x: 3, y: 2.5 }),
  });
  assert.equal(res.status, 201);
  step('product pinned on the map');

  await fetch(`${base}/api/stores/${store.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ is_public: true }),
  });

  res = await fetch(`${base}/api/public/stores/${store.slug}/search?q=oat`);
  assert.equal(res.status, 200);
  const { results } = await res.json();
  assert.equal(results.length, 1);
  assert.equal(results[0].x, 3);
  step('public search finds the pinned product');

  res = await fetch(`${base}/s/${store.slug}`);
  assert.equal(res.status, 200);
  step('public shopper page served');

  console.log('\nSmoke test passed — the full journey works.');
} finally {
  server.close();
}
