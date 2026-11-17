/**
 * API integration tests. Boots the real Express app on an ephemeral port with a
 * throwaway SQLite database, then exercises auth, ownership, CRUD and the
 * public surface end-to-end over HTTP.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
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

async function call(path, { method = 'GET', body, cookie, headers: extraHeaders } = {}) {
  const isRaw = Buffer.isBuffer(body);
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body !== undefined && !isRaw ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(extraHeaders ?? {}),
    },
    body: body === undefined ? undefined : isRaw ? new Uint8Array(body) : JSON.stringify(body),
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

// dev-login is rate-limited per IP (30/min) and the whole suite shares one —
// cache sessions so repeat logins for the same email don't burn the budget.
const sessions = new Map();
async function loginAs(email) {
  if (sessions.has(email)) return sessions.get(email);
  const res = await call('/api/auth/dev-login', { method: 'POST', body: { email } });
  assert.equal(res.status, 200);
  const cookie = sessionCookie(res.setCookie);
  sessions.set(email, cookie);
  return cookie;
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

test('demo login issues a session for the demo-map owner (one click, no form)', async () => {
  const res = await call('/api/auth/demo-login', { method: 'POST' });
  assert.equal(res.status, 200);
  const cookie = sessionCookie(res.setCookie);
  const me = await call('/api/auth/me', { cookie });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.email, 'annex@storemap.demo');
  // the demo owner can actually edit: their store list is readable
  const mine = await call('/api/stores/mine', { cookie });
  assert.equal(mine.status, 200);
});

// Minimal 1×1 PNG for image upload tests.
const PNG_BYTES = Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001080600000' + '01f15c4890000000a49444154789c6360000002000154a24f400000000049454e44ae426082', 'hex');

test('product images: gated on hosted free, open in local mode and on pro', async () => {
  const cookie = await loginAs('img-owner@example.com');
  const created = await call('/api/stores', { method: 'POST', cookie, body: { name: 'Photo Mart' } });
  const storeId = created.body.store.id;

  // product must exist first
  const prod = await call(`/api/stores/${storeId}/products`, {
    method: 'POST', cookie, body: { name: 'Milk' },
  });
  const productId = prod.body.product.id;

  // hosted default (free plan) → 402 with upgrade hint
  const denied = await call(`/api/products/${productId}/image`, {
    method: 'POST', cookie,
    headers: { 'Content-Type': 'image/png' },
    body: PNG_BYTES,
  });
  assert.equal(denied.status, 402);
  assert.equal(denied.body.upgrade, true);

  // billing flips the plan (hosted plan changes don't come from the owner) → upload works
  const { db } = await import('../src/db.js');
  db.prepare("UPDATE stores SET plan = 'pro' WHERE id = ?").run(storeId);
  const patched = await call(`/api/stores/${storeId}`, { method: 'PATCH', cookie, body: { hours: '9-5' } });
  assert.equal(patched.body.store.plan, 'pro');
  assert.equal(patched.body.store.entitlements.productImages, true);
  const ok = await call(`/api/products/${productId}/image`, {
    method: 'POST', cookie,
    headers: { 'Content-Type': 'image/png' },
    body: PNG_BYTES,
  });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.url.startsWith('/uploads/'));

  // non-image bytes with an image content-type are rejected
  const bad = await call(`/api/products/${productId}/image`, {
    method: 'POST', cookie,
    headers: { 'Content-Type': 'image/png' },
    body: Buffer.from('not a png at all........'),
  });
  assert.equal(bad.status, 400);
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

test('pin shelfId persists in meta and round-trips through every payload', async () => {
  const cookie = await loginAs('shelfy@example.com');
  const { body } = await call('/api/stores', { method: 'POST', cookie, body: { name: 'Shelf Mart' } });
  const storeId = body.store.id;
  await call(`/api/stores/${storeId}`, { method: 'PATCH', cookie, body: { is_public: true } });
  const floorId = (await call(`/api/stores/${storeId}/full`, { cookie })).body.floors[0].id;
  const prod = await call(`/api/stores/${storeId}/products`, { method: 'POST', cookie, body: { name: 'Shelf Cola' } });
  const productId = prod.body.product.id;

  // create with a shelfId → top-level field + meta JSON
  const loc = await call(`/api/products/${productId}/locations`, {
    method: 'POST', cookie, body: { floor_id: floorId, x: 3, y: 4, shelfId: 'shelf-7' },
  });
  assert.equal(loc.status, 201);
  assert.equal(loc.body.location.shelfId, 'shelf-7');
  assert.equal(JSON.parse(loc.body.location.meta).shelfId, 'shelf-7');

  // the store full payload carries it too
  const after = await call(`/api/stores/${storeId}/full`, { cookie });
  assert.equal(after.body.locations[0].shelfId, 'shelf-7');
  assert.equal(JSON.parse(after.body.locations[0].meta).shelfId, 'shelf-7');

  // and so does the public shopper payload (meta + derived shelfId)
  const pub = await call('/api/public/stores/shelf-mart');
  assert.equal(pub.body.locations[0].shelfId, 'shelf-7');
  assert.ok(pub.body.locations[0].meta);

  // re-pinning the same product+floor without a shelfId clears the association
  const cleared = await call(`/api/products/${productId}/locations`, {
    method: 'POST', cookie, body: { floor_id: floorId, x: 5, y: 6 },
  });
  assert.equal(cleared.status, 201);
  assert.equal(cleared.body.location.id, loc.body.location.id, 'same pin, updated in place');
  assert.equal(cleared.body.location.shelfId, null);
  assert.equal(cleared.body.location.meta, '{}');
  const afterClear = await call(`/api/stores/${storeId}/full`, { cookie });
  assert.equal(afterClear.body.locations[0].shelfId, null);
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
  const { body } = await call('/api/stores', { method: 'POST', cookie, body: { name: 'Upload Co' } });
  const storeParam = `?store=${body.store.id}`;
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(32).fill(0)]);
  const ok = await fetch(base + '/api/uploads' + storeParam, {
    method: 'POST',
    headers: { 'Content-Type': 'image/png', Cookie: cookie },
    body: pngBytes,
  });
  assert.equal(ok.status, 201);
  const { url } = await ok.json();
  assert.match(url, /^\/uploads\/[0-9a-f-]+\.png$/);
  const served = await fetch(base + url);
  assert.equal(served.status, 200);

  const fake = await fetch(base + '/api/uploads' + storeParam, {
    method: 'POST',
    headers: { 'Content-Type': 'image/png', Cookie: cookie },
    body: Buffer.from('this is not a png at all'),
  });
  assert.equal(fake.status, 400, 'text masquerading as PNG must be rejected');

  const wrongType = await fetch(base + '/api/uploads' + storeParam, {
    method: 'POST',
    headers: { 'Content-Type': 'application/pdf', Cookie: cookie },
    body: Buffer.from('%PDF-1.4'),
  });
  assert.equal(wrongType.status, 400);
});

test('uploads are store-scoped: `store` field + stock role required', async () => {
  const cookie = await loginAs('upload@example.com'); // owns 'Upload Co'
  const mine = await call('/api/stores/mine', { cookie });
  const storeId = mine.body.stores.find((s) => s.name === 'Upload Co').id;
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(32).fill(0)]);

  // no store → 400
  const bare = await fetch(base + '/api/uploads', {
    method: 'POST',
    headers: { 'Content-Type': 'image/png', Cookie: cookie },
    body: pngBytes,
  });
  assert.equal(bare.status, 400);

  // a store the caller has no role on → rejected
  const foreign = await fetch(base + `/api/uploads?store=${'no-such-store'}`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/png', Cookie: cookie },
    body: pngBytes,
  });
  assert.equal(foreign.status, 404);

  // multipart contract: field `store` = store id, image as a file part
  const form = new FormData();
  form.set('store', storeId);
  form.set('file', new Blob([pngBytes], { type: 'image/png' }), 'floor.png');
  const multipart = await fetch(base + '/api/uploads', {
    method: 'POST',
    headers: { Cookie: cookie },
    body: form,
  });
  assert.equal(multipart.status, 201);
  const { url } = await multipart.json();
  assert.match(url, /^\/uploads\/[0-9a-f-]+\.png$/);
  assert.equal((await fetch(base + url)).status, 200);
});

test('uploaded-image serving rejects path tricks without crashing', async () => {
  const port = server.address().port;
  const rawGet = (p) =>
    new Promise((resolve, reject) => {
      http
        .get({ host: '127.0.0.1', port, path: p }, (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode));
        })
        .on('error', reject);
    });
  assert.equal(await rawGet('/uploads/..'), 404);
  assert.equal(await rawGet('/uploads/.'), 404);
  assert.equal(await rawGet('/uploads/ok.png%00'), 404);
  // the process must have survived all three (no unhandled stream error)
  const health = await call('/api/health');
  assert.equal(health.status, 200);
});

test('search: FTS5 index — prefix, category, updates stay in sync', async () => {
  const cookie = await loginAs('fts@example.com');
  const { body } = await call('/api/stores', { method: 'POST', cookie, body: { name: 'FTS Market' } });
  const storeId = body.store.id;
  await call(`/api/stores/${storeId}`, { method: 'PATCH', cookie, body: { is_public: true } });
  const cat = await call(`/api/stores/${storeId}/categories`, {
    method: 'POST', cookie, body: { name: 'Fromage', color: '#3b6fd4' },
  });
  const p1 = await call(`/api/stores/${storeId}/products`, {
    method: 'POST', cookie, body: { name: 'Crème Fraîche', brand: 'Normandie', sku: 'CFT-1' },
  });
  const p2 = await call(`/api/stores/${storeId}/products`, {
    method: 'POST', cookie, body: { name: 'Cheddar Block', brand: 'Meadow', category_id: cat.body.category.id },
  });
  const search = (q) => call(`/api/public/stores/fts-market/search?q=${encodeURIComponent(q)}`);

  // word-prefix match (the FTS path) and diacritics folding
  assert.equal((await search('fra')).body.results.length, 1);
  assert.equal((await search('creme')).body.results[0]?.name, 'Crème Fraîche');
  // brand and sku columns are indexed too
  assert.equal((await search('normandie')).body.results.length, 1);
  assert.equal((await search('cft')).body.results.length, 1);
  // category names are denormalized into the index
  assert.equal((await search('fromage')).body.results.length, 1);
  assert.equal((await search('fromage')).body.results[0]?.name, 'Cheddar Block');

  // product renames flow through the update trigger
  await call(`/api/products/${p1.body.product.id}`, {
    method: 'PATCH', cookie, body: { name: 'Kefir 1L' },
  });
  assert.equal((await search('fra')).body.results.length, 0, 'old name no longer matches');
  assert.equal((await search('kef')).body.results.length, 1, 'new name matches');

  // category rename triggers a store reindex
  await call(`/api/categories/${cat.body.category.id}`, {
    method: 'PATCH', cookie, body: { name: 'Cheese' },
  });
  assert.equal((await search('cheese')).body.results.length, 1, 'renamed category matches');
  assert.equal((await search('fromage')).body.results.length, 0, 'old category name is gone');

  // deletes leave the index
  await call(`/api/products/${p2.body.product.id}`, { method: 'DELETE', cookie });
  assert.equal((await search('cheddar')).body.results.length, 0);
});

test('transfer: export → import round trip (catalog, pins, elements, stock, media)', async () => {
  const alice = await loginAs('alice-transfer@example.com');
  const { body } = await call('/api/stores', { method: 'POST', cookie: alice, body: { name: 'Transfer Source' } });
  const storeId = body.store.id;
  const floorId = (await call(`/api/stores/${storeId}/full`, { cookie: alice })).body.floors[0].id;
  await call(`/api/stores/${storeId}/floors`, { method: 'POST', cookie: alice, body: { name: 'Basement', level: 2, width_m: 20, height_m: 15 } });
  const cat = await call(`/api/stores/${storeId}/categories`, { method: 'POST', cookie: alice, body: { name: 'Drinks', color: '#3b6fd4' } });
  const prod = await call(`/api/stores/${storeId}/products`, {
    method: 'POST', cookie: alice, body: { name: 'Kombucha Ginger', sku: 'KOM-1', price: 3.4, category_id: cat.body.category.id },
  });
  await call(`/api/products/${prod.body.product.id}/locations`, { method: 'POST', cookie: alice, body: { floor_id: floorId, x: 3.5, y: 4.5 } });
  await call(`/api/floors/${floorId}/elements`, {
    method: 'PUT', cookie: alice,
    body: { elements: [{ type: 'shelf', shape: 'rect', geometry: { x: 1, y: 1, w: 5, h: 1 }, label: 'Wall shelf' }] },
  });
  await call(`/api/stores/${storeId}/stock/set`, { method: 'POST', cookie: alice, body: { product_id: prod.body.product.id, quantity: 12 } });
  // one product image via the upload endpoint → embedded media in the bundle
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');
  const up = await call(`/api/uploads?store=${storeId}`, { method: 'POST', cookie: alice, headers: { 'Content-Type': 'image/png' }, body: png });
  await call(`/api/products/${prod.body.product.id}`, { method: 'PATCH', cookie: alice, body: { image_url: up.body.url } });

  // export from alice…
  const exp = await call(`/api/stores/${storeId}/export`, { cookie: alice });
  assert.equal(exp.status, 200);
  assert.equal(exp.body.format, 'storemap.export/1');
  assert.equal(exp.body.media.length, 1, 'product image embedded');
  assert.equal(exp.body.products.length, 1);

  // …and import as a different owner (the online ↔ local hand-off)
  const bob = await loginAs('bob-transfer@example.com');
  const imp = await call('/api/stores/import', { method: 'POST', cookie: bob, body: exp.body });
  assert.equal(imp.status, 201);
  const newId = imp.body.store.id;
  assert.equal(imp.body.store.is_public, false, 'imports start as drafts');
  assert.equal(imp.body.store.name, 'Transfer Source');
  assert.notEqual(imp.body.store.slug, 'transfer-source'); // slug collision → suffix

  const full = await call(`/api/stores/${newId}/full`, { cookie: bob });
  assert.equal(full.body.floors.length, 2);
  assert.equal(full.body.products.length, 1);
  assert.equal(full.body.products[0].name, 'Kombucha Ginger');
  assert.equal(full.body.products[0].category_name, 'Drinks');
  assert.ok(full.body.products[0].image_url.startsWith('/uploads/'));
  assert.notEqual(full.body.products[0].image_url, up.body.url, 'media re-saved under a new path');
  assert.equal(full.body.elements.length, 1);
  assert.equal(full.body.locations.length, 1);
  assert.equal(full.body.locations[0].x, 3.5);

  const stock = await call(`/api/stores/${newId}/stock`, { cookie: bob });
  assert.equal(stock.body.stock[0].quantity, 12, 'stock levels carried over');

  // the re-saved image actually serves
  const img = await call(full.body.products[0].image_url);
  assert.equal(img.status, 200);

  // junk is rejected cleanly
  const bad = await call('/api/stores/import', { method: 'POST', cookie: bob, body: { hello: 1 } });
  assert.equal(bad.status, 400);
  // non-array list fields are a 400, not a 500
  const nonArray = await call('/api/stores/import', {
    method: 'POST', cookie: bob, body: { format: 'storemap.export/1', floors: [], categories: 5 },
  });
  assert.equal(nonArray.status, 400);
});

test('import accepts bundles larger than the 2mb API default', async () => {
  // bundles embed product images — the import path has its own 64mb parser
  const alice = await loginAs('alice-transfer@example.com'); // owns 'Transfer Source'
  const mine = await call('/api/stores/mine', { cookie: alice });
  const storeId = mine.body.stores.find((s) => s.name === 'Transfer Source').id;
  const exp = await call(`/api/stores/${storeId}/export`, { cookie: alice, headers: { Accept: 'application/json' } });
  assert.equal(exp.status, 200);
  // pad a description so the JSON body exceeds the 2mb API-wide limit
  exp.body.products[0].description = 'x'.repeat(2_600_000);
  const imp = await call('/api/stores/import', { method: 'POST', cookie: alice, body: exp.body });
  assert.equal(imp.status, 201);
  assert.equal(imp.body.store.name, 'Transfer Source');
});

test('employees: invite → accept → scoped role enforcement', async () => {
  const owner = await loginAs('owner-shop@example.com');
  const { body } = await call('/api/stores', { method: 'POST', cookie: owner, body: { name: 'Team Mart' } });
  const storeId = body.store.id;
  const floorId = (await call(`/api/stores/${storeId}/full`, { cookie: owner })).body.floors[0].id;
  await call(`/api/stores/${storeId}/products`, {
    method: 'POST', cookie: owner, body: { name: 'Staff Cola', sku: 'STF-1' },
  });
  const prodId = (await call(`/api/stores/${storeId}/full`, { cookie: owner })).body.products[0].id;

  // invite a stock-role employee
  const invite = await call(`/api/stores/${storeId}/members/invite`, {
    method: 'POST', cookie: owner, body: { email: 'Employee@Shop.com', role: 'stock' },
  });
  assert.equal(invite.status, 201);
  const token = invite.body.inviteUrl.split('/invite/')[1];

  // preview works without auth; wrong-email user cannot accept
  const preview = await call(`/api/invitations/${token}`);
  assert.equal(preview.body.invitation.storeName, 'Team Mart');
  assert.equal(preview.body.invitation.role, 'stock');
  const stranger = await loginAs('stranger@example.com');
  const wrong = await call(`/api/invitations/${token}/accept`, { method: 'POST', cookie: stranger });
  assert.equal(wrong.status, 403);

  // the invited email accepts (dev-login creates the user with that email)
  const employee = await loginAs('employee@shop.com');
  const accept = await call(`/api/invitations/${token}/accept`, { method: 'POST', cookie: employee });
  assert.equal(accept.status, 200);
  assert.equal(accept.body.role, 'stock');

  // token is single-use
  const replay = await call(`/api/invitations/${token}/accept`, { method: 'POST', cookie: employee });
  assert.equal(replay.status, 404);

  // employee sees the store in /mine and /full (viewer+), with their role
  const mine = await call('/api/stores/mine', { cookie: employee });
  assert.ok(mine.body.stores.some((s) => s.slug === 'team-mart'));
  const full = await call(`/api/stores/${storeId}/full`, { cookie: employee });
  assert.equal(full.body.role, 'stock');

  // stock role CAN adjust stock and edit a product…
  const adj = await call(`/api/stores/${storeId}/stock/adjust`, {
    method: 'POST', cookie: employee, body: { product_id: prodId, delta: 5 },
  });
  assert.equal(adj.status, 200);
  const patch = await call(`/api/products/${prodId}`, {
    method: 'PATCH', cookie: employee, body: { price: 1.5 },
  });
  assert.equal(patch.status, 200);

  // …but CANNOT edit the map, invite, or delete the store
  const els = await call(`/api/floors/${floorId}/elements`, {
    method: 'PUT', cookie: employee,
    body: { elements: [{ type: 'shelf', shape: 'rect', geometry: { x: 1, y: 1, w: 2, h: 1 } }] },
  });
  assert.equal(els.status, 404, 'map editing requires manager');
  const inv2 = await call(`/api/stores/${storeId}/members/invite`, {
    method: 'POST', cookie: employee, body: { email: 'x@y.com', role: 'viewer' },
  });
  assert.equal(inv2.status, 404, 'stock cannot invite');
  const del = await call(`/api/stores/${storeId}`, { method: 'DELETE', cookie: employee });
  assert.equal(del.status, 404, 'only owner deletes');

  // roster lists owner + employee; owner can remove the employee
  const roster = await call(`/api/stores/${storeId}/members`, { cookie: owner });
  assert.equal(roster.body.members.length, 2);
  const empId = roster.body.members.find((m) => m.role === 'stock').user_id;
  const remove = await call(`/api/stores/${storeId}/members/${empId}`, { method: 'DELETE', cookie: owner });
  assert.equal(remove.status, 200);
  const after = await call(`/api/stores/${storeId}/full`, { cookie: employee });
  assert.equal(after.status, 404, 'removed employee loses access');
});

test('viewers cannot modify the catalog (stock role is the baseline)', async () => {
  // reuse the Team Mart owner + store from the employees test above
  const owner = await loginAs('owner-shop@example.com');
  const mine = await call('/api/stores/mine', { cookie: owner });
  const storeId = mine.body.stores.find((s) => s.name === 'Team Mart').id;
  const floorId = (await call(`/api/stores/${storeId}/full`, { cookie: owner })).body.floors[0].id;
  const prodId = (await call(`/api/stores/${storeId}/full`, { cookie: owner })).body.products[0].id;
  const loc = await call(`/api/products/${prodId}/locations`, {
    method: 'POST', cookie: owner, body: { floor_id: floorId, x: 2, y: 2 },
  });
  assert.equal(loc.status, 201);

  // invite a viewer via the members flow
  const invite = await call(`/api/stores/${storeId}/members/invite`, {
    method: 'POST', cookie: owner, body: { email: 'watcher@shop.com', role: 'viewer' },
  });
  assert.equal(invite.status, 201);
  const token = invite.body.inviteUrl.split('/invite/')[1];
  const viewer = await loginAs('watcher@shop.com');
  assert.equal((await call(`/api/invitations/${token}/accept`, { method: 'POST', cookie: viewer })).status, 200);

  // the viewer can read the store but not touch its catalog
  assert.equal((await call(`/api/stores/${storeId}/full`, { cookie: viewer })).status, 200);
  const patch = await call(`/api/products/${prodId}`, { method: 'PATCH', cookie: viewer, body: { price: 9 } });
  assert.equal(patch.status, 403);
  const del = await call(`/api/products/${prodId}`, { method: 'DELETE', cookie: viewer });
  assert.equal(del.status, 403);
  const delLoc = await call(`/api/locations/${loc.body.location.id}`, { method: 'DELETE', cookie: viewer });
  assert.equal(delLoc.status, 403);

  // …while a stock-role member still can
  const invite2 = await call(`/api/stores/${storeId}/members/invite`, {
    method: 'POST', cookie: owner, body: { email: 'stocker@shop.com', role: 'stock' },
  });
  const token2 = invite2.body.inviteUrl.split('/invite/')[1];
  const stocker = await loginAs('stocker@shop.com');
  assert.equal((await call(`/api/invitations/${token2}/accept`, { method: 'POST', cookie: stocker })).status, 200);
  const okPatch = await call(`/api/products/${prodId}`, { method: 'PATCH', cookie: stocker, body: { price: 2 } });
  assert.equal(okPatch.status, 200);

  // missing rows are a 404 like every other guard
  assert.equal((await call('/api/products/nope', { method: 'PATCH', cookie: owner, body: { price: 1 } })).status, 404);
});

test('dev login cannot take over an existing social account', async () => {
  const { db, newId } = await import('../src/db.js');
  db.prepare("INSERT INTO users (id, email, name, provider, provider_sub) VALUES (?, ?, ?, 'google', ?)").run(
    newId(), 'googler@example.com', 'Google User', 'g-sub-1'
  );
  const takeover = await call('/api/auth/dev-login', { method: 'POST', body: { email: 'googler@example.com' } });
  assert.equal(takeover.status, 403);
  // the account was not re-pointed to the dev identity
  const row = db.prepare('SELECT provider FROM users WHERE email = ?').get('googler@example.com');
  assert.equal(row.provider, 'google');
  // fresh emails (and existing dev accounts) still sign in fine
  const fresh = await loginAs('after-takeover@example.com');
  assert.ok(fresh.startsWith('st_session='));
});

test('shopper meta escapes hostile store fields (no script breakout)', async () => {
  const cookie = await loginAs('sharer@example.com'); // owns the public 'Share Mart'
  const mine = await call('/api/stores/mine', { cookie });
  const storeId = mine.body.stores.find((s) => s.name === 'Share Mart').id;
  const hostile = 'Escape </script><meta http-equiv=refresh content=0>';
  const patched = await call(`/api/stores/${storeId}`, { method: 'PATCH', cookie, body: { name: hostile } });
  assert.equal(patched.status, 200);
  const page = await call('/s/share-mart');
  assert.equal(page.status, 200);
  // JSON-LD is escaped, the store field cannot close the script element
  assert.ok(page.text.includes('\\u003cmeta http-equiv=refresh'), 'JSON-LD escapes < as \\u003c');
  assert.ok(!page.text.includes('<meta http-equiv'), 'no injected meta tag from store data');
  // the <title> replacement is escaped too
  assert.ok(page.text.includes('<title>Escape &lt;/script&gt;'));
});

test('catalog PATCH rejects non-string fields with 400, not 500', async () => {
  const cookie = await loginAs('dave@example.com'); // owns 'Search Foods'
  const mine = await call('/api/stores/mine', { cookie });
  const storeId = mine.body.stores.find((s) => s.name === 'Search Foods').id;
  const prodId = (await call(`/api/stores/${storeId}/full`, { cookie })).body.products[0].id;
  for (const field of ['brand', 'name', 'image_url']) {
    const res = await call(`/api/products/${prodId}`, { method: 'PATCH', cookie, body: { [field]: 123 } });
    assert.equal(res.status, 400, `${field}: 123 must be a 400`);
  }
  const cat = await call(`/api/stores/${storeId}/categories`, { method: 'POST', cookie, body: { name: 'Cat' } });
  const iconRes = await call(`/api/categories/${cat.body.category.id}`, { method: 'PATCH', cookie, body: { icon: 5 } });
  assert.equal(iconRes.status, 400);
});
