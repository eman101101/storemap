/**
 * The example maps, as a shopper meets them. Demo product photos live IN the
 * database (the `media` table), not in the frontend's static files:
 * scripts/seed-demo.mjs copies backend/demo-products in, products reference
 * the rows at /media/<file>, and the app serves them from there. And two
 * guarantees every example keeps: each catalogue item faces on a shelf (an
 * item with no facing lists as "out of stock" in a search), and upgrading an
 * older database re-points photos in place instead of rebuilding the store.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';

process.env.NODE_ENV = 'test';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'storemap-media-test-'));
process.env.SESSION_SECRET = 'test-secret';
process.env.PORT = '0';
delete process.env.SELF_HOSTED; // the seeder is run by hand below, as in dev

const ROOT = path.resolve(import.meta.dirname, '..');
const PHOTOS_DIR = path.join(ROOT, 'demo-products');
const DB_PATH = path.join(process.env.DATA_DIR, 'storemap.db');
const EXAMPLES = ['walmart-example', 'home-depot-example', 'convenience-store-example'];

const { PHOTOS, walmartSpec, homeDepotSpec, cornerStoreSpec, stockEverything } = await import('../scripts/demo-specs.mjs');
const SPECS = [walmartSpec, homeDepotSpec, cornerStoreSpec].map((build) => build());
const { STORE_TOTALS } = await import('../scripts/demo-catalog.mjs');

const seed = () => spawnSync(process.execPath, ['scripts/seed-demo.mjs'], { cwd: ROOT, encoding: 'utf8' });
const open = () => new DatabaseSync(DB_PATH, { readOnly: true });
const inside = (rect, p) => p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h;

/* ── the specs: what gets written before any database is involved ────────── */

test('every example stocks its whole catalogue — one pin per group, a stored photo per item', () => {
  assert.deepEqual(SPECS.map((s) => s.slug), EXAMPLES);
  for (const spec of SPECS) {
    const name = spec.slug;
    const shelves = spec.elements.filter((e) => e.type === 'shelf');
    const pins = spec.locations.filter((l) => l.groupPin);

    assert.equal(pins.length, shelves.length, `${name}: one map pin per shelf group`);
    assert.equal(new Set(pins.map((l) => l.product)).size, pins.length, `${name}: each pin belongs to its own item`);

    // nothing sits in the catalogue unstocked: that is what a search would list as "out of stock"
    assert.deepEqual(
      [...new Set(spec.locations.map((l) => l.product))].sort((a, b) => a - b),
      spec.products.map((_, i) => i),
      `${name}: every catalogue item faces on a shelf`
    );
    assert.equal(stockEverything(structuredClone(spec)), 0, `${name}: the sweep that stocks strays has nothing to do`);
    assert.ok(spec.products.length > 50, `${name}: a real catalogue`);

    for (const l of spec.locations) {
      assert.ok(Number.isInteger(l.product) && l.product >= 0 && l.product < spec.products.length, `${name}: facing of a real item`);
      if (!l.groupOnly) continue;
      assert.ok(shelves.some((s) => inside(s.geometry, l)), `${name}: facing of "${spec.products[l.product].name}" lies on a shelf`);
    }
    // every category in the catalogue has a shelf of its own department
    const departments = new Set(shelves.map((s) => JSON.parse(s.meta).department));
    for (const c of spec.categories) assert.ok(departments.has(c.name), `${name}: category "${c.name}" is shelved`);
  }
});

test('every item references a photo that exists in the stored set', () => {
  for (const spec of SPECS) {
    for (const p of spec.products) {
      assert.match(p.image ?? '', /^\/media\/(?:gen\/)?[a-z0-9-]+\.(?:jpg|svg)$/, `${spec.slug}: "${p.name}" → ${p.image}`);
      assert.ok(fs.existsSync(path.join(PHOTOS_DIR, p.image.slice('/media/'.length))), `${spec.slug}: "${p.name}" → ${p.image} is a file`);
    }
  }
});

test('the sweep stocks an item the grouping left out — its department first, any shelf otherwise', () => {
  // a copy: the specs hand out their category list by reference
  const spec = structuredClone(cornerStoreSpec());
  const shelves = spec.elements.filter((e) => e.type === 'shelf');
  const coffee = shelves.find((s) => s.label === 'Coffee & Tea');
  spec.categories.push({ name: 'Magazines', color: '#777777', icon: '📖', items: [] });
  const base = spec.products.length;
  spec.products.push(
    { name: 'Auto Weekly', category: 'Magazines', brand: 'X' }, // a category with no shelf
    { name: 'Crossword Book', category: 'Coffee & Tea', brand: 'X' }, // an extra item of a shelved category
    { name: 'Loose Leaf', category: 'Nowhere', brand: 'X' } // not even a category
  );
  const facing = (i) => spec.locations.find((l) => l.product === i);
  assert.equal(facing(base), undefined, 'unstocked before the sweep');

  assert.equal(stockEverything(spec), 3);
  assert.equal(stockEverything(spec), 0, 'idempotent');
  for (const i of [base, base + 1, base + 2]) {
    const l = facing(i);
    assert.ok(l, `item ${i} now faces`);
    assert.equal(!!l.groupOnly, true, 'a planogram-only facing, never a second map pin');
    assert.equal(!!l.groupPin, false);
  }
  assert.ok(inside(coffee.geometry, facing(base + 1)), 'an item of a shelved category joins one of its shelves');
  assert.ok(inside(shelves[0].geometry, facing(base)), 'an item of an unshelved category takes the first shelf');
  assert.ok(inside(shelves[0].geometry, facing(base + 2)));
});

test('the frontend ships no demo photos', () => {
  assert.equal(
    fs.existsSync(path.join(ROOT, '..', 'frontend', 'public', 'demo-products')),
    false,
    'frontend/public/demo-products is gone — the photos are backend data now'
  );
  assert.equal(
    Object.values(PHOTOS).some((u) => !u.startsWith('/media/')),
    false,
    'every manifest url points at the database-backed route'
  );
});

/* ── the seeder: what lands in the database ──────────────────────────────── */

test('the seeder copies the whole photo set into the database, byte for byte', () => {
  const run = seed();
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /Demo photos in the database: \d+ images\./);

  const db = open();
  const rows = db.prepare('SELECT id, mime, size, etag, data FROM media').all();
  assert.deepEqual(
    new Set(rows.map((r) => r.id)),
    new Set(Object.values(PHOTOS).map((u) => u.replace(/^\/media\//, ''))),
    'exactly the photo set the manifest maps to — every photo, nothing else'
  );
  for (const row of rows) {
    const file = fs.readFileSync(path.join(PHOTOS_DIR, row.id));
    assert.deepEqual(Buffer.from(row.data), file, `${row.id}: stored bytes are the file`);
    assert.equal(row.size, file.length);
    assert.equal(row.mime, row.id.endsWith('.svg') ? 'image/svg+xml' : 'image/jpeg');
    assert.match(row.etag, /^[0-9a-f]{64}$/);
  }
  assert.ok(rows.length > 600, 'a full set, not a sample');
  db.close();
});

// the store's own (demo) items: their SKUs sort before the generated part of the catalogue
const OWN_ITEMS = `p.sku < json_extract((SELECT value FROM app_settings WHERE key = 'seed:catalog:' || s.slug), '$.fromSku')`;

test('every item of every example map is stocked and priced; the demo items are photographed from the database', () => {
  const db = open();
  for (const { slug } of SPECS) {
    const row = db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM products p JOIN stores s ON s.id = p.store_id WHERE s.slug = :slug) AS products,
           (SELECT COUNT(*) FROM products p JOIN stores s ON s.id = p.store_id WHERE s.slug = :slug
              AND NOT EXISTS (SELECT 1 FROM product_locations l WHERE l.product_id = p.id)) AS unstocked,
           (SELECT COUNT(*) FROM products p JOIN stores s ON s.id = p.store_id WHERE s.slug = :slug AND ${OWN_ITEMS}
              AND (p.image_url NOT LIKE '/media/%'
                   OR NOT EXISTS (SELECT 1 FROM media m WHERE '/media/' || m.id = p.image_url))) AS photoless,
           (SELECT COUNT(*) FROM products p JOIN stores s ON s.id = p.store_id WHERE s.slug = :slug AND NOT (${OWN_ITEMS})
              AND p.image_url <> '') AS generatedWithPhoto,
           (SELECT COUNT(*) FROM products p JOIN stores s ON s.id = p.store_id WHERE s.slug = :slug
              AND (p.price IS NULL OR p.price <= 0)) AS unpriced`
      )
      .get({ slug });
    assert.equal(row.products, STORE_TOTALS[slug], `${slug}: the whole catalogue is written — the demo items and the generated SKUs`);
    assert.equal(row.unstocked, 0, `${slug}: nothing lists as "out of stock"`);
    assert.equal(row.photoless, 0, `${slug}: every demo photo resolves inside the database`);
    assert.equal(row.generatedWithPhoto, 0, `${slug}: the generated SKUs come without photos`);
    assert.equal(row.unpriced, 0, `${slug}: every item has a price`);
  }
  db.close();
});

test('a database from before the move is upgraded in place — no rebuild, ids stable', () => {
  const db = new DatabaseSync(DB_PATH);
  // what an install seeded by the previous scheme looks like: static-file urls, no media rows
  const stale = db
    .prepare("UPDATE products SET image_url = REPLACE(image_url, '/media/', '/demo-products/') WHERE image_url LIKE '/media/%'")
    .run();
  assert.ok(stale.changes > 1000, 'the rows were actually rewound');
  db.exec('DELETE FROM media');
  // nothing recorded a photo sync before the move existed
  db.exec("DELETE FROM app_settings WHERE key LIKE 'seed:photos:%'");
  const before = db.prepare('SELECT id, sku, image_url FROM products ORDER BY store_id, sku').all();
  const locationsBefore = db.prepare('SELECT COUNT(*) n FROM product_locations').get().n;
  // a photo the owner replaced, on a demo product
  const picked = db.prepare("SELECT id FROM products WHERE image_url LIKE '/demo-products/%' LIMIT 1").get().id;
  db.prepare("UPDATE products SET image_url = '/uploads/owner-photo.png' WHERE id = ?").run(picked);
  db.close();

  const run = seed();
  assert.equal(run.status, 0, run.stderr);
  assert.doesNotMatch(run.stdout, /Reset .* rebuilding/, 'present stores are not rebuilt');
  assert.match(run.stdout, /product photos updated in place/);

  const after = open();
  assert.equal(after.prepare('SELECT COUNT(*) n FROM media').get().n, new Set(Object.values(PHOTOS)).size, 'the photo set is back in the database');
  assert.equal(after.prepare('SELECT COUNT(*) n FROM product_locations').get().n, locationsBefore, 'the layout is untouched');
  const ids = (rows) => rows.map(({ id, sku }) => `${sku} ${id}`);
  assert.deepEqual(
    ids(after.prepare('SELECT id, sku FROM products ORDER BY store_id, sku').all()),
    ids(before),
    'product ids are unchanged — deep links to them keep working'
  );
  assert.equal(after.prepare("SELECT COUNT(*) n FROM products WHERE image_url LIKE '/demo-products/%'").get().n, 0, 'no stale static-file urls');
  for (const { id, image_url } of before) {
    const now = after.prepare('SELECT image_url FROM products WHERE id = ?').get(id).image_url;
    if (id === picked) assert.equal(now, '/uploads/owner-photo.png', "the owner's own photo is left alone");
    else assert.equal(now, image_url.replace('/demo-products/', '/media/'));
  }
  after.close();
});

test('a store seeded before photos existed is filled in on its first sync — after that, a removed photo stays removed', () => {
  // (a first sync is also the one time a photo removed earlier comes back:
  //  nothing can tell "removed" apart from "never had one" in an old store)
  const db = new DatabaseSync(DB_PATH);
  // what the oldest seeds wrote: no photo on any product, and no sync ever recorded
  db.prepare("UPDATE products SET image_url = '' WHERE image_url LIKE '/media/%'").run();
  db.exec("DELETE FROM app_settings WHERE key LIKE 'seed:photos:%'");
  const before = db.prepare('SELECT sku, id FROM products ORDER BY store_id, sku').all();
  db.close();

  let run = seed();
  assert.equal(run.status, 0, run.stderr);
  assert.doesNotMatch(run.stdout, /Reset .* rebuilding/, 'filled in place, not rebuilt');
  const ids = (rows) => rows.map(({ sku, id }) => `${sku} ${id}`);
  const after = open();
  // the generated SKUs never carry one; every item of the store's own does
  const photoless = after
    .prepare(
      `SELECT COUNT(*) n FROM products p JOIN stores s ON s.id = p.store_id WHERE p.image_url = '' AND ${OWN_ITEMS}`
    )
    .get().n;
  assert.equal(photoless, 0, 'every product now carries its photo');
  assert.deepEqual(ids(after.prepare('SELECT sku, id FROM products ORDER BY store_id, sku').all()), ids(before), 'ids stable');
  after.close();

  // the store is in sync from now on: a photo removed again is the owner's choice
  const edit = new DatabaseSync(DB_PATH);
  const one = edit.prepare("SELECT id FROM products WHERE sku = 'HDX-00003'").get().id;
  edit.prepare("UPDATE products SET image_url = '' WHERE id = ?").run(one);
  edit.close();
  run = seed();
  assert.equal(run.status, 0, run.stderr);
  const last = open();
  assert.equal(last.prepare('SELECT image_url FROM products WHERE id = ?').get(one).image_url, '', 'stays removed after the first sync');
  assert.deepEqual(ids(last.prepare('SELECT sku, id FROM products ORDER BY store_id, sku').all()), ids(before));
  last.close();
});

test('a store someone claimed is never rebuilt or touched up by the demo seeder', () => {
  const db = new DatabaseSync(DB_PATH);
  const store = db.prepare("SELECT id FROM stores WHERE slug = 'home-depot-example'").get();
  db.prepare('INSERT INTO users (id, email, provider, provider_sub) VALUES (?, ?, ?, ?)').run('claimant', 'claim@example.com', 'dev', 'claim');
  db.prepare('UPDATE stores SET owner_id = ? WHERE id = ?').run('claimant', store.id);
  // the claimed store keeps a stale url, and has drifted from the spec's pin count
  db.prepare("UPDATE products SET image_url = '/demo-products/old.jpg' WHERE store_id = ? AND sku = 'HDX-00001'").run(store.id);
  db.prepare('DELETE FROM product_locations WHERE product_id IN (SELECT id FROM products WHERE store_id = ? LIMIT 1)').run(store.id);
  const locations = db.prepare('SELECT COUNT(*) n FROM product_locations').get().n;
  db.close();

  const run = seed();
  assert.equal(run.status, 0, run.stderr);
  assert.doesNotMatch(run.stdout, /Reset .* rebuilding/, 'a claimed store is not rebuilt even when it drifted');

  const after = open();
  const row = after.prepare('SELECT image_url FROM products WHERE store_id = ? AND sku = ?').get(store.id, 'HDX-00001');
  assert.equal(row.image_url, '/demo-products/old.jpg', 'its photos are not re-pointed either');
  assert.equal(after.prepare('SELECT COUNT(*) n FROM product_locations').get().n, locations);
  after.close();
});

/* ── serving ─────────────────────────────────────────────────────────────── */

const { createApp } = await import('../src/app.js');
const app = createApp();
const server = app.listen(0);
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => new Promise((resolve) => server.close(resolve)));

const FILE = 'osb-sheet-11mm.jpg'; // an OSB sheet — a real photo in the set
const SVG = 'gen/feta-cheese-200g.svg'; // a generated packshot

test('stored photos are served from the database with the right type and bytes', async () => {
  assert.ok(fs.existsSync(path.join(PHOTOS_DIR, FILE)) && fs.existsSync(path.join(PHOTOS_DIR, SVG)), 'the fixtures are real files');
  const res = await fetch(`${base}/media/${FILE}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/jpeg');
  assert.match(res.headers.get('cache-control'), /^public, max-age=\d+$/);
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), fs.readFileSync(path.join(PHOTOS_DIR, FILE)));

  const svg = await fetch(`${base}/media/${SVG}`);
  assert.equal(svg.status, 200);
  assert.equal(svg.headers.get('content-type'), 'image/svg+xml');
  assert.match(await svg.text(), /^<svg /);
});

test('a revalidation by ETag answers 304 with no body', async () => {
  const res = await fetch(`${base}/media/${FILE}`);
  const etag = res.headers.get('etag');
  assert.match(etag, /^"[0-9a-f]{64}"$/);
  await res.arrayBuffer();
  const again = await fetch(`${base}/media/${FILE}`, { headers: { 'If-None-Match': etag } });
  assert.equal(again.status, 304);
  assert.equal((await again.arrayBuffer()).byteLength, 0);
});

/** GET with the path sent exactly as given — `fetch` (and curl) squash
 *  `..` before sending, which would hide a traversal from the test. */
const rawGet = (path) =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path, method: 'GET' }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });

test('anything that is not a stored photo is a plain 404 — never the SPA shell, never a file', async () => {
  const notAStoredPhoto = [
    'missing.jpg', 'gen/missing.svg', 'OSB-SHEET-11MM.JPG', 'osb-sheet-11mm.jpg%00', 'x.sql', 'osb-sheet-11mm.jpg/x',
    '../package.json', 'gen/../../package.json', 'gen/../osb-sheet-11mm.jpg', '/osb-sheet-11mm.jpg', "x'--.jpg",
  ];
  for (const tail of notAStoredPhoto) {
    const res = await rawGet(`/media/${tail}`);
    assert.equal(res.status, 404, `/media/${tail}`);
    // a bare 404 — not the SPA shell (which answers unknown routes with 200), not some other file
    assert.doesNotMatch(res.body, /id="root"|<svg |module\.exports/, `/media/${tail} must not fall through to the SPA or a file`);
  }
  // a cache-busting query is fine — it is still the stored photo
  assert.equal((await rawGet(`/media/${FILE}?v=2`)).status, 200);
});
