import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

export const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// node:sqlite before Node 24 bundles SQLite without FTS5, and migration 006
// (the product search index) would die with a cryptic "no such module: fts5".
// Probe once and fail with a message that names the requirement instead.
const fts5Probe = new DatabaseSync(':memory:');
try {
  fts5Probe.exec('CREATE VIRTUAL TABLE fts5_probe USING fts5(x)');
} catch {
  throw new Error(
    `Node ${process.versions.node}'s built-in SQLite lacks FTS5 (product search needs it). Use Node 24 or newer.`
  );
}
fts5Probe.close();

const MIGRATIONS = [
  {
    name: '001_initial_schema',
    sql: `
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
        slug TEXT NOT NULL UNIQUE,
        address TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        website TEXT NOT NULL DEFAULT '',
        hours TEXT NOT NULL DEFAULT '',
        logo_url TEXT NOT NULL DEFAULT '',
        is_public INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_stores_owner ON stores(owner_id);

      CREATE TABLE floors (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
        name TEXT NOT NULL DEFAULT 'Main floor',
        level INTEGER NOT NULL DEFAULT 1,
        width_m REAL NOT NULL DEFAULT 40,
        height_m REAL NOT NULL DEFAULT 30,
        background_url TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_floors_store ON floors(store_id);

      CREATE TABLE map_elements (
        id TEXT PRIMARY KEY,
        floor_id TEXT NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('wall','shelf','aisle','zone','entrance','exit','poi')),
        shape TEXT NOT NULL CHECK (shape IN ('rect','polygon','polyline','point')),
        geometry TEXT NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        color TEXT NOT NULL DEFAULT '',
        meta TEXT NOT NULL DEFAULT '{}',
        z_index INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_elements_floor ON map_elements(floor_id);

      CREATE TABLE categories (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '#4f7d3f',
        icon TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX idx_categories_store ON categories(store_id);

      CREATE TABLE products (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
        category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        brand TEXT NOT NULL DEFAULT '',
        sku TEXT NOT NULL DEFAULT '',
        barcode TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        price REAL,
        image_url TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_products_store ON products(store_id);

      CREATE TABLE product_locations (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        floor_id TEXT NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
        x REAL NOT NULL,
        y REAL NOT NULL,
        rot REAL NOT NULL DEFAULT 0,
        meta TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX idx_locations_product ON product_locations(product_id);
      CREATE INDEX idx_locations_floor ON product_locations(floor_id);
    `,
  },
  {
    name: '002_stock_tracking_and_integrations',
    sql: `
      CREATE TABLE store_api_keys (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
        name TEXT NOT NULL DEFAULT '',
        key_hash TEXT NOT NULL UNIQUE,
        key_prefix TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_used_at TEXT,
        revoked INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_api_keys_store ON store_api_keys(store_id);

      CREATE TABLE integrations (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        credentials TEXT NOT NULL DEFAULT '{}',
        config TEXT NOT NULL DEFAULT '{}',
        last_sync_at TEXT,
        last_error TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (store_id, provider)
      );
      CREATE INDEX idx_integrations_store ON integrations(store_id);

      CREATE TABLE stock_levels (
        product_id TEXT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
        quantity REAL NOT NULL DEFAULT 0,
        reorder_point REAL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE stock_movements (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        delta REAL NOT NULL,
        resulting_quantity REAL NOT NULL,
        reason TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT 'manual',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_movements_product ON stock_movements(product_id);
    `,
  },
  {
    name: '003-floor-snapshots',
    sql: `
      CREATE TABLE floor_snapshots (
        id TEXT PRIMARY KEY,
        floor_id TEXT NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
        elements TEXT NOT NULL,
        element_count INTEGER NOT NULL,
        created_at_ms INTEGER NOT NULL
      );
      CREATE INDEX idx_snapshots_floor ON floor_snapshots(floor_id, created_at_ms DESC);
    `,
  },
  {
    name: '004-store-geo-views',
    sql: `
      ALTER TABLE stores ADD COLUMN lat REAL;
      ALTER TABLE stores ADD COLUMN lng REAL;
      ALTER TABLE stores ADD COLUMN views INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    name: '005-store-plan',
    sql: `
      ALTER TABLE stores ADD COLUMN plan TEXT NOT NULL DEFAULT 'free';
    `,
  },
  {
    // Full-text search index (docs/INFRASTRUCTURE.md — search cost at scale):
    // LIKE '%q%' scans a store's whole catalog per keystroke; FTS5 serves the
    // same queries from an inverted index. Kept in sync by triggers; category
    // renames are handled by lib/search.js's reindexStoreFts (FK ON DELETE
    // SET NULL actions bypass UPDATE triggers).
    name: '006-product-search-fts',
    sql: `
      CREATE VIRTUAL TABLE products_fts USING fts5(
        name, brand, sku, barcode, category_name,
        tokenize = 'unicode61 remove_diacritics 2'
      );

      INSERT INTO products_fts (rowid, name, brand, sku, barcode, category_name)
        SELECT p.rowid, p.name, p.brand, p.sku, p.barcode, COALESCE(c.name, '')
        FROM products p LEFT JOIN categories c ON c.id = p.category_id;

      CREATE TRIGGER products_fts_ins AFTER INSERT ON products BEGIN
        INSERT INTO products_fts (rowid, name, brand, sku, barcode, category_name)
        VALUES (new.rowid, new.name, new.brand, new.sku, new.barcode,
          COALESCE((SELECT name FROM categories WHERE id = new.category_id), ''));
      END;

      CREATE TRIGGER products_fts_upd AFTER UPDATE OF name, brand, sku, barcode, category_id ON products BEGIN
        DELETE FROM products_fts WHERE rowid = old.rowid;
        INSERT INTO products_fts (rowid, name, brand, sku, barcode, category_name)
          VALUES (new.rowid, new.name, new.brand, new.sku, new.barcode,
            COALESCE((SELECT name FROM categories WHERE id = new.category_id), ''));
      END;

      CREATE TRIGGER products_fts_del AFTER DELETE ON products BEGIN
        DELETE FROM products_fts WHERE rowid = old.rowid;
      END;
    `,
  },
  {
    // Step 1 — store organization: employees join stores with scoped roles
    // (INFRASTRUCTURE.md §9). Owners stay implicit via stores.owner_id; these
    // tables hold everyone else (managers, stock editors, viewers) + invites.
    name: '007-store-members',
    sql: `
      CREATE TABLE IF NOT EXISTS store_members (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('owner','manager','stock','viewer')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (store_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_members_store ON store_members(store_id);
      CREATE INDEX IF NOT EXISTS idx_members_user ON store_members(user_id);

      CREATE TABLE IF NOT EXISTS invitations (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
        email TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('manager','stock','viewer')),
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        accepted_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_invitations_store ON invitations(store_id);
    `,
  },
  {
    // Sign in with email (magic codes) + Facebook: widen users.provider. A
    // CHECK can't be ALTERed in SQLite — rebuild the table with FKs OFF so
    // the DROP's implicit delete can't cascade into stores/store_members.
    // The pragma is a no-op inside a transaction, so migrate() runs it
    // before BEGIN and restores FKs after COMMIT.
    pragma: 'PRAGMA foreign_keys = OFF;',
    name: '008-auth-email-facebook',
    sql: `
      CREATE TABLE IF NOT EXISTS users_rebuild (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL DEFAULT '',
        avatar_url TEXT NOT NULL DEFAULT '',
        provider TEXT NOT NULL CHECK (provider IN ('google','apple','dev','email','facebook')),
        provider_sub TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO users_rebuild (id, email, name, avatar_url, provider, provider_sub, created_at)
        SELECT id, email, name, avatar_url, provider, provider_sub, created_at FROM users;
      DROP TABLE users;
      ALTER TABLE users_rebuild RENAME TO users;

      CREATE TABLE IF NOT EXISTS login_tokens (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        code_hash TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_login_tokens_email ON login_tokens(email);
    `,
  },
  {
    name: '009-product-image-crop',
    sql: `
      ALTER TABLE products ADD COLUMN image_crop_url TEXT NOT NULL DEFAULT '';
    `,
  },
  {
    // photo credits: every account starts with the free plan's 1000-photo
    // allotment on the account; pay-as-you-go packs top it up (1 credit = 1
    // product photo upload)
    name: '010-user-photo-credits',
    sql: `
      ALTER TABLE users ADD COLUMN photo_credits INTEGER NOT NULL DEFAULT 1000;
    `,
  },
];

export function migrate() {
  db.exec(`CREATE TABLE IF NOT EXISTS migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`);
  const applied = new Set(db.prepare('SELECT name FROM migrations').all().map((r) => r.name));
  for (const m of MIGRATIONS) {
    if (applied.has(m.name)) continue;
    // optional per-migration pragma (e.g. FKs off for a table rebuild) —
    // pragmas are no-ops inside a transaction, so they run before BEGIN
    if (m.pragma) db.exec(m.pragma);
    db.exec('BEGIN');
    try {
      db.exec(m.sql);
      db.prepare('INSERT INTO migrations (name) VALUES (?)').run(m.name);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    } finally {
      if (m.pragma) db.exec('PRAGMA foreign_keys = ON;');
    }
  }
}

export function newId() {
  return crypto.randomUUID();
}
