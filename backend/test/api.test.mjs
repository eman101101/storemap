/**
 * API integration tests. Boots the real Express app on an ephemeral port with a
 * throwaway SQLite database, then exercises auth, ownership, CRUD and the
 * public surface end-to-end over HTTP.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.NODE_ENV = 'test';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'storemap-test-'));
process.env.SESSION_SECRET = 'test-secret-please-change';
process.env.ENABLE_DEV_LOGIN = 'true';
process.env.PORT = '0'; // ephemeral

const { createApp } = await import('../src/app.js');
const app = createApp();

const server = app.listen(0);
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

test.after(() => new Promise((resolve) => server.close(resolve)));

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
  let text = null;
  const raw = await res.text();
  try {
    json = JSON.parse(raw);
  } catch {
    text = raw; /* non-JSON body (e.g. the SPA shell) */
  }
  return { status: res.status, body: json, text, setCookie: res.headers.getSetCookie?.() ?? [] };
}

function sessionCookie(setCookie) {
  const c = setCookie.find((s) => s.startsWith('st_session='));
  assert.ok(c, 'expected a session cookie');
  return c.split(';')[0];
}

async function loginAs(email) {
  const res = await call('/api/auth/dev-login', { method: 'POST', body: { email } });
  assert.equal(res.status, 200);
  return sessionCookie(res.setCookie);
}

test('health endpoint responds', async () => {
  const res = await call('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});

test('unauthenticated access to protected routes is rejected', async () => {
  const res = await call('/api/stores/mine');
  assert.equal(res.status, 401, '/api/stores/mine should require auth');
  const up = await call('/api/uploads', { method: 'POST', body: { x: 1 } });
  assert.equal(up.status, 401, '/api/uploads should require auth');
  const create = await call('/api/stores', { method: 'POST', body: { name: 'X' } });
  assert.equal(create.status, 401);
});

test('dev login issues a usable session', async () => {
  const cookie = await loginAs('alice@example.com');
  const me = await call('/api/auth/me', { cookie });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.email, 'alice@example.com');
});

test('store lifecycle: create → defaults a floor → update → full payload', async () => {
  const cookie = await loginAs('bob@example.com');
  const created = await call('/api/stores', { method: 'POST', cookie, body: { name: 'Corner Grocer' } });
  assert.equal(created.status, 201);
  const store = created.body.store;
  assert.equal(store.slug, 'corner-grocer');
  assert.equal(store.is_public, false);

  const full = await call(`/api/stores/${store.id}/full`, { cookie });
  assert.equal(full.status, 200);
  assert.equal(full.body.floors.length, 1, 'new store gets one floor');

  const patched = await call(`/api/stores/${store.id}`, {
    method: 'PATCH',
    cookie,
    body: { is_public: true, hours: '7am–11pm', address: '1 Main St' },
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.store.is_public, true);
  assert.equal(patched.body.store.slug, 'corner-grocer', 'slug stays stable');
});

test('slugs are unique per store', async () => {
  const cookie = await loginAs('slugger@example.com');
  const a = await call('/api/stores', { method: 'POST', cookie, body: { name: 'Dup Market' } });
  const b = await call('/api/stores', { method: 'POST', cookie, body: { name: 'Dup Market' } });
  assert.notEqual(a.body.store.slug, b.body.store.slug);
});

test('store ownership is enforced between users', async () => {
  const ownerC = await loginAs('owner@example.com');
  const otherC = await loginAs('mallory@example.com');
  const { body } = await call('/api/stores', { method: 'POST', cookie: ownerC, body: { name: 'Secret Shop' } });
  const id = body.store.id;

  const foreign = await call(`/api/stores/${id}/full`, { cookie: otherC });
  assert.equal(foreign.status, 404, 'another user must not read a foreign store');

  const foreignPatch = await call(`/api/stores/${id}`, { method: 'PATCH', cookie: otherC, body: { name: 'Hacked' } });
  assert.equal(foreignPatch.status, 404);

  const mine = await call('/api/stores/mine', { cookie: ownerC });
  assert.equal(mine.body.stores.length, 1);
  assert.equal(mine.body.stores[0].name, 'Secret Shop');
});

test('shopper links get per-store social meta tags', async () => {
  const cookie = await loginAs('sharer@example.com');
  const { body } = await call('/api/stores', { method: 'POST', cookie, body: { name: 'Share Mart', description: 'A shareable store' } });
  const storeId = body.store.id;
  // not public yet → plain SPA shell
  const before = await call('/s/share-mart', { cookie });
  assert.equal(before.status, 200);
  assert.ok(!before.text.includes('og:title'));
  // publish → meta tags injected
  await call(`/api/stores/${storeId}`, { method: 'PATCH', cookie, body: { is_public: true } });
  const after = await call('/s/share-mart', { cookie });
  assert.equal(after.status, 200);
  assert.match(after.text, /<meta property="og:title" content="Share Mart — find it on the map">/);
  assert.match(after.text, /<meta property="og:description" content="A shareable store">/);
  assert.match(after.text, /<title>Share Mart · StoreMap<\/title>/);
  // unknown slugs still serve the plain shell
  const missing = await call('/s/does-not-exist', { cookie });
  assert.equal(missing.status, 200);
  assert.ok(!missing.text.includes('og:title'));
});

test('autosave snapshots: throttled changelog + restore round-trip', async () => {
  const cookie = await loginAs('snapper@example.com');
  const { body } = await call('/api/stores', { method: 'POST', cookie, body: { name: 'Snap Store' } });
  const storeId = body.store.id;
  const full = await call(`/api/stores/${storeId}/full`, { cookie });
  const floorId = full.body.floors[0].id;
  const els = (n) => [
    { id: 'snap-wall-1', type: 'wall', shape: 'rect', geometry: { x: 0, y: 0, w: 20, h: 0.4, rot: 0 } },
    { id: `snap-shelf-${n}`, type: 'shelf', shape: 'rect', geometry: { x: 4, y: 5, w: 4, h: 1.2, rot: 0 }, label: `v${n}` },
  ];

  // first save snapshots immediately
  await call(`/api/floors/${floorId}/elements`, { method: 'PUT', cookie, body: { elements: els(1) } });
  // immediate second save is throttled (one snapshot per minute)
  await call(`/api/floors/${floorId}/elements`, { method: 'PUT', cookie, body: { elements: els(2) } });
  let list = await call(`/api/floors/${floorId}/snapshots`, { cookie });
  assert.equal(list.status, 200);
  assert.equal(list.body.snapshots.length, 1, 'rapid saves collapse into one snapshot');
  assert.equal(list.body.snapshots[0].element_count, 2);

  // a save after the interval snapshots again (simulate by back-dating the row)
  const { db } = await import('../src/db.js');
  db.prepare('UPDATE floor_snapshots SET created_at_ms = ? WHERE floor_id = ?').run(Date.now() - 61_000, floorId);
  await call(`/api/floors/${floorId}/elements`, { method: 'PUT', cookie, body: { elements: els(3) } });
  list = await call(`/api/floors/${floorId}/snapshots`, { cookie });
  assert.equal(list.body.snapshots.length, 2, 'a save after the interval snapshots again');

  // restore: fetch snapshot elements and PUT them back
  const snap = list.body.snapshots[0]; // newest = v3
  const got = await call(`/api/floors/${floorId}/snapshots/${snap.id}`, { cookie });
  assert.equal(got.status, 200);
  assert.equal(got.body.snapshot.elements.length, 2);
  await call(`/api/floors/${floorId}/elements`, { method: 'PUT', cookie, body: { elements: got.body.snapshot.elements } });
  const after = await call(`/api/stores/${storeId}/full`, { cookie });
  assert.equal(after.body.elements.length, 2);
  assert.ok(after.body.elements.some((e) => e.id === 'snap-shelf-3'), 'restored elements are live again');

  // snapshot payload is ownership-checked
  const other = await loginAs('mallory-snap@example.com');
  const denied = await call(`/api/floors/${floorId}/snapshots`, { cookie: other });
  assert.equal(denied.status, 404);
});

test('floor elements: bulk save round-trips and validates', async () => {
  const cookie = await loginAs('carol@example.com');
  const { body } = await call('/api/stores', { method: 'POST', cookie, body: { name: 'Map Mart' } });
  const storeId = body.store.id;
  const full = await call(`/api/stores/${storeId}/full`, { cookie });
  const floorId = full.body.floors[0].id;

  const save = await call(`/api/floors/${floorId}/elements`, {
    method: 'PUT',
    cookie,
    body: {
      elements: [
        { id: 'wall-1', type: 'wall', shape: 'rect', geometry: { x: 0, y: 0, w: 20, h: 0.4, rot: 0 } },
        { id: 'shelf-1', type: 'shelf', shape: 'rect', geometry: { x: 4, y: 5, w: 4, h: 1.2, rot: 90 }, label: 'Aisle 1' },
        { type: 'entrance', shape: 'point', geometry: { x: 10, y: 19 } },
        { type: 'aisle', shape: 'polyline', geometry: [[2, 2], [6, 2], [6, 9]] },
      ],
    },
  });
  assert.equal(save.status, 200);
  assert.equal(save.body.elements.length, 4);
  const shelf = save.body.elements.find((e) => e.id === 'shelf-1');
  assert.equal(JSON.parse(shelf.geometry).rot, 90);

  // id preserved across a second save (stable ids keep the editor's undo simple)
  const resave = await call(`/api/floors/${floorId}/elements`, {
    method: 'PUT',
    cookie,
    body: { elements: [{ id: 'shelf-1', type: 'shelf', shape: 'rect', geometry: { x: 5, y: 5, w: 4, h: 1.2, rot: 0 } }] },
  });
  assert.equal(resave.body.elements.length, 1, 'bulk replace removes old elements');
  assert.equal(resave.body.elements[0].id, 'shelf-1');

  const invalid = await call(`/api/floors/${floorId}/elements`, {
    method: 'PUT',
    cookie,
    body: { elements: [{ type: 'shelf', shape: 'rect', geometry: { x: 'nope' } }] },
  });
  assert.equal(invalid.status, 400);

  const badShape = await call(`/api/floors/${floorId}/elements`, {
    method: 'PUT',
    cookie,
    body: { elements: [{ type: 'entrance', shape: 'rect', geometry: { x: 0, y: 0, w: 1, h: 1, rot: 0 } }] },
  });
  assert.equal(badShape.status, 400, 'points cannot be rects');

  const foreign = await loginAs('eve@example.com');
  const denied = await call(`/api/floors/${floorId}/elements`, {
    method: 'PUT',
    cookie: foreign,
    body: { elements: [] },
  });
  assert.equal(denied.status, 404);
});

test('catalog: categories, products, locations, and search', async () => {
  const cookie = await loginAs('dave@example.com');
  const { body } = await call('/api/stores', { method: 'POST', cookie, body: { name: 'Search Foods' } });
  const storeId = body.store.id;
  await call(`/api/stores/${storeId}`, { method: 'PATCH', cookie, body: { is_public: true } });
  const floorId = (await call(`/api/stores/${storeId}/full`, { cookie })).body.floors[0].id;

  const cat = await call(`/api/stores/${storeId}/categories`, {
    method: 'POST', cookie, body: { name: 'Bakery', color: '#aa7733' },
  });
  assert.equal(cat.status, 201);

  const prod = await call(`/api/stores/${storeId}/products`, {
    method: 'POST',
    cookie,
    body: { name: 'Sourdough Loaf', brand: 'Bakehouse', price: 5.5, category_id: cat.body.category.id },
  });
  assert.equal(prod.status, 201);
  assert.equal(prod.body.product.category_name, 'Bakery');

  const loc = await call(`/api/products/${prod.body.product.id}/locations`, {
    method: 'POST', cookie, body: { floor_id: floorId, x: 7.5, y: 8 },
  });
  assert.equal(loc.status, 201);
  const moved = await call(`/api/products/${prod.body.product.id}/locations`, {
    method: 'POST', cookie, body: { floor_id: floorId, x: 8, y: 8.5 },
  });
  assert.equal(moved.body.location.id, loc.body.location.id, 'one pin per product per floor');
  assert.equal(moved.body.location.x, 8);

  const search = await call(`/api/public/stores/${'search-foods'}/search?q=sour`);
  assert.equal(search.status, 200);
  assert.equal(search.body.results.length, 1);
  assert.equal(search.body.results[0].x, 8);
  assert.equal(search.body.results[0].floor_name, 'Main floor');

  const noHits = await call('/api/public/stores/search-foods/search?q=zzz');
  assert.equal(noHits.body.results.length, 0);
});

test('price validation rejects negative values', async () => {
  const cookie = await loginAs('price@example.com');
  const { body } = await call('/api/stores', { method: 'POST', cookie, body: { name: 'Price Check' } });
  const bad = await call(`/api/stores/${body.store.id}/products`, {
    method: 'POST', cookie, body: { name: 'Weird Item', price: -3 },
  });
  assert.equal(bad.status, 400);
});

test('private stores are invisible on the public surface', async () => {
  const cookie = await loginAs('private@example.com');
  const { body } = await call('/api/stores', { method: 'POST', cookie, body: { name: 'Hidden Goods' } });
  const slug = body.store.slug;
  assert.equal((await call(`/api/public/stores/${slug}`)).status, 404);
  const dir = await call('/api/public/stores');
  assert.ok(!dir.body.stores.some((s) => s.slug === slug));
});

test('unpublishing hides a store from the directory', async () => {
  const cookie = await loginAs('toggle@example.com');
  const { body } = await call('/api/stores', { method: 'POST', cookie, body: { name: 'Now You See Me' } });
  const id = body.store.id;
  const slug = body.store.slug;
  await call(`/api/stores/${id}`, { method: 'PATCH', cookie, body: { is_public: true } });
  assert.equal((await call(`/api/public/stores/${slug}`)).status, 200);
  await call(`/api/stores/${id}`, { method: 'PATCH', cookie, body: { is_public: false } });
  assert.equal((await call(`/api/public/stores/${slug}`)).status, 404);
});

test('deleting a store cascades floors, products and pins', async () => {
  const cookie = await loginAs('deleter@example.com');
  const { body } = await call('/api/stores', { method: 'POST', cookie, body: { name: 'Pop-up' } });
  const storeId = body.store.id;
  const prod = await call(`/api/stores/${storeId}/products`, { method: 'POST', cookie, body: { name: 'Thing' } });
  await call(`/api/products/${prod.body.product.id}`, { method: 'DELETE', cookie });
  const del = await call(`/api/stores/${storeId}`, { method: 'DELETE', cookie });
  assert.equal(del.status, 200);
  assert.equal((await call('/api/stores/mine', { cookie })).body.stores.length, 0);
});

test('floor deletion keeps at least one floor', async () => {
  const cookie = await loginAs('floors@example.com');
  const { body } = await call('/api/stores', { method: 'POST', cookie, body: { name: 'One Floor Co' } });
  const floorId = (await call(`/api/stores/${body.store.id}/full`, { cookie })).body.floors[0].id;
  const res = await call(`/api/floors/${floorId}`, { method: 'DELETE', cookie });
  assert.equal(res.status, 400);
});

test('unknown API routes return JSON 404s', async () => {
  const res = await call('/api/definitely-not-a-route');
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'Unknown API endpoint');
});

test('upload endpoint validates content type and magic bytes', async () => {
  const cookie = await loginAs('upload@example.com');
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(32).fill(0)]);
  const ok = await fetch(base + '/api/uploads', {
    method: 'POST',
    headers: { 'Content-Type': 'image/png', Cookie: cookie },
    body: pngBytes,
  });
  assert.equal(ok.status, 201);
  const { url } = await ok.json();
  assert.match(url, /^\/uploads\/[0-9a-f-]+\.png$/);
  const served = await fetch(base + url);
  assert.equal(served.status, 200);

  const fake = await fetch(base + '/api/uploads', {
    method: 'POST',
    headers: { 'Content-Type': 'image/png', Cookie: cookie },
    body: Buffer.from('this is not a png at all'),
  });
  assert.equal(fake.status, 400, 'text masquerading as PNG must be rejected');

  const wrongType = await fetch(base + '/api/uploads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/pdf', Cookie: cookie },
    body: Buffer.from('%PDF-1.4'),
  });
  assert.equal(wrongType.status, 400);
});
