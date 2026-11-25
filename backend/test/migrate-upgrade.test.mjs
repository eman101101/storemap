/**
 * Upgrade-path migration test: a database created by the OLD schema (users
 * CHECK limited to google/apple/dev) with live users + stores, upgraded in
 * place by migrate(). Guards the 008 table rebuild — the DROP's implicit
 * delete must never cascade into stores, and the widened provider CHECK must
 * accept 'email' / 'facebook' rows afterwards.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

process.env.NODE_ENV = 'test';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'storemap-mig-'));
process.env.SESSION_SECRET = 'mig-test';

// a pre-008 database: old users CHECK, one google user owning one store
const raw = new DatabaseSync(path.join(process.env.DATA_DIR, 'storemap.db'));
raw.exec(`
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL DEFAULT '',
    avatar_url TEXT NOT NULL DEFAULT '',
    provider TEXT NOT NULL CHECK (provider IN ('google','apple','dev')),
    provider_sub TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE stores (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE
  );
  CREATE TABLE products (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    category_id TEXT,
    name TEXT NOT NULL,
    brand TEXT NOT NULL DEFAULT '',
    sku TEXT NOT NULL DEFAULT '',
    barcode TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    price REAL,
    image_url TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
raw.prepare("INSERT INTO users (id, email, provider, provider_sub) VALUES ('u1', 'owner@example.com', 'google', 'g1')").run();
raw.prepare("INSERT INTO stores (id, owner_id, name, slug) VALUES ('s1', 'u1', 'Old Store', 'old-store')").run();
// a live product row: later ALTER TABLE migrations (009 image_crop, and the
// products table itself) must apply against real data without losing it
raw.prepare("INSERT INTO products (id, store_id, name, price) VALUES ('p1', 's1', 'Old Oat Milk', 2.49)").run();
for (const name of [
  '001_initial_schema', '002_stock_tracking_and_integrations', '003-floor-snapshots',
  '004-store-geo-views', '005-store-plan', '006-product-search-fts', '007-store-members',
]) {
  raw.prepare('INSERT INTO migrations (name) VALUES (?)').run(name);
}
raw.close();

const { migrate, db } = await import('../src/db.js');
migrate();

test('013 creates app_settings on its own, for a database that already recorded 012', () => {
  // an install that applied the first cut of 012 (the media table alone)
  // before app_settings became its own migration
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name = 'media'").get(), 'media is there from 012');
  db.exec("DROP TABLE app_settings; DELETE FROM migrations WHERE name = '013-app-settings';");
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name = 'app_settings'").get(), undefined);
  migrate();
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name = 'app_settings'").get(), 'and the next migration brings the table');
  // the rest of the schema is untouched by re-running migrate()
  assert.equal(db.prepare("SELECT COUNT(*) n FROM products").get().n, 1, 'the live product row survived');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM migrations WHERE name = '013-app-settings'").get().n, 1, 'recorded exactly once');
});

test('008 rebuild keeps data and widens the provider CHECK', () => {
  // the store survived the users DROP (no cascade wipe)
  const store = db.prepare("SELECT id, owner_id FROM stores WHERE id = 's1'").get();
  assert.equal(store?.owner_id, 'u1', 'store row survived the users rebuild');

  // the user row was carried over
  const user = db.prepare("SELECT id, provider FROM users WHERE id = 'u1'").get();
  assert.equal(user?.provider, 'google');

  // the widened CHECK accepts the new providers
  db.prepare("INSERT INTO users (id, email, provider, provider_sub) VALUES ('u2', 'e@example.com', 'email', 'e@example.com')").run();
  db.prepare("INSERT INTO users (id, email, provider, provider_sub) VALUES ('u3', 'f@example.com', 'facebook', 'fb-1')").run();
  // …and still rejects unknown ones
  assert.throws(() =>
    db.prepare("INSERT INTO users (id, email, provider, provider_sub) VALUES ('u4', 'x@example.com', 'twitter', 't1')").run()
  );

  // login_tokens landed and the migration was recorded
  assert.ok(db.prepare("SELECT name FROM migrations WHERE name = '008-auth-email-facebook'").get());
  db.prepare("INSERT INTO login_tokens (id, email, code_hash, expires_at) VALUES ('t1', 'e@example.com', 'h', '2030-01-01')").run();

  // the pre-008 product row survived, and the 009 crop column landed
  const product = db.prepare("SELECT name, price, image_crop_url FROM products WHERE id = 'p1'").get();
  assert.equal(product?.name, 'Old Oat Milk');
  assert.equal(product?.price, 2.49);
  assert.equal(product?.image_crop_url, '');

  // FKs are enforced again after the pragma restore
  assert.throws(() =>
    db.prepare("INSERT INTO stores (id, owner_id, name, slug) VALUES ('s2', 'missing', 'Nope', 'nope')").run()
  );
});
