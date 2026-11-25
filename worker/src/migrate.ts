/**
 * Schema migrations + first-boot bootstrap (ports of backend/src/db.js and the
 * auto-seed branch of index.js). Runs once per isolate; guarded so concurrent
 * cold starts can't double-apply.
 */
import type { Env } from './config';
import { all, count, first, run } from './db';
import { randomToken } from './util';
import { seedDemoMaps } from './seed';

const MIGRATIONS: { name: string; sql: string; batch?: boolean }[] = [
  {
    name: '001_initial_schema',
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL DEFAULT '',
        avatar_url TEXT NOT NULL DEFAULT '',
        provider TEXT NOT NULL CHECK (provider IN ('google','apple','dev')),
        provider_sub TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS stores (
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
      CREATE INDEX IF NOT EXISTS idx_stores_owner ON stores(owner_id);
      CREATE TABLE IF NOT EXISTS floors (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
        name TEXT NOT NULL DEFAULT 'Main floor',
        level INTEGER NOT NULL DEFAULT 1,
        width_m REAL NOT NULL DEFAULT 40,
        height_m REAL NOT NULL DEFAULT 30,
        background_url TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_floors_store ON floors(store_id);
      CREATE TABLE IF NOT EXISTS map_elements (
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
      CREATE INDEX IF NOT EXISTS idx_elements_floor ON map_elements(floor_id);
      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '#4f7d3f',
        icon TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_categories_store ON categories(store_id);
      CREATE TABLE IF NOT EXISTS products (
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
      CREATE INDEX IF NOT EXISTS idx_products_store ON products(store_id);
      CREATE TABLE IF NOT EXISTS product_locations (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        floor_id TEXT NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
        x REAL NOT NULL,
        y REAL NOT NULL,
        rot REAL NOT NULL DEFAULT 0,
        meta TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_locations_product ON product_locations(product_id);
      CREATE INDEX IF NOT EXISTS idx_locations_floor ON product_locations(floor_id);
    `,
  },
  {
    name: '002_stock_tracking_and_integrations',
    sql: `
      CREATE TABLE IF NOT EXISTS store_api_keys (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
        name TEXT NOT NULL DEFAULT '',
        key_hash TEXT NOT NULL UNIQUE,
        key_prefix TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_used_at TEXT,
        revoked INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_api_keys_store ON store_api_keys(store_id);
      CREATE TABLE IF NOT EXISTS stock_levels (
        product_id TEXT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
        quantity REAL NOT NULL DEFAULT 0,
        reorder_point REAL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS stock_movements (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        delta REAL NOT NULL,
        resulting_quantity REAL NOT NULL,
        reason TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT 'manual',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_movements_product ON stock_movements(product_id);
    `,
  },
  {
    name: '003-floor-snapshots',
    sql: `
      CREATE TABLE IF NOT EXISTS floor_snapshots (
        id TEXT PRIMARY KEY,
        floor_id TEXT NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
        elements TEXT NOT NULL,
        element_count INTEGER NOT NULL,
        created_at_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_snapshots_floor ON floor_snapshots(floor_id, created_at_ms DESC);
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
    name: '006-app-settings',
    sql: `
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
  {
    name: '007-r2-budget',
    sql: `
      CREATE TABLE IF NOT EXISTS r2_budget (
        day TEXT PRIMARY KEY,
        used INTEGER NOT NULL DEFAULT 0
      );
    `,
  },
  {
    // Full-text search index — same as the Node backend's migration 006.
    // Rowid-based triggers stay correct through FK SET NULL and cascades.
    name: '008-product-search-fts',
    sql: `
      CREATE VIRTUAL TABLE IF NOT EXISTS products_fts USING fts5(
        name, brand, sku, barcode, category_name,
        tokenize = 'unicode61 remove_diacritics 2'
      );

      -- Backfill must be idempotent: a cold-start race loser re-runs this
      -- migration, and a plain INSERT ... SELECT would duplicate every row.
      DELETE FROM products_fts;
      INSERT INTO products_fts (rowid, name, brand, sku, barcode, category_name)
        SELECT p.rowid, p.name, p.brand, p.sku, p.barcode, COALESCE(c.name, '')
        FROM products p LEFT JOIN categories c ON c.id = p.category_id;

      CREATE TRIGGER IF NOT EXISTS products_fts_ins AFTER INSERT ON products BEGIN
        INSERT INTO products_fts (rowid, name, brand, sku, barcode, category_name)
        VALUES (new.rowid, new.name, new.brand, new.sku, new.barcode,
          COALESCE((SELECT name FROM categories WHERE id = new.category_id), ''));
      END;

      CREATE TRIGGER IF NOT EXISTS products_fts_upd AFTER UPDATE OF name, brand, sku, barcode, category_id ON products BEGIN
        DELETE FROM products_fts WHERE rowid = old.rowid;
        INSERT INTO products_fts (rowid, name, brand, sku, barcode, category_name)
        VALUES (new.rowid, new.name, new.brand, new.sku, new.barcode,
          COALESCE((SELECT name FROM categories WHERE id = new.category_id), ''));
      END;

      CREATE TRIGGER IF NOT EXISTS products_fts_del AFTER DELETE ON products BEGIN
        DELETE FROM products_fts WHERE rowid = old.rowid;
      END;
    `,
  },
  {
    // Step 1 — store organization (mirror of the Node backend's 007).
    name: '009-store-members',
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
    // One product per (store, sku) — makes SKU upserts race-free (concurrent
    // imports can no longer duplicate a SKU). Existing duplicates are deduped
    // first, keeping the lowest rowid per (store_id, sku); NULL/empty SKUs
    // stay allowed via the partial index.
    name: '010-unique-store-sku',
    sql: `
      DELETE FROM products
       WHERE sku IS NOT NULL AND sku != ''
         AND rowid NOT IN (
           SELECT MIN(rowid) FROM products WHERE sku IS NOT NULL AND sku != '' GROUP BY store_id, sku
         );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_products_store_sku
        ON products(store_id, sku) WHERE sku IS NOT NULL AND sku != '';
    `,
  },
  {
    // Sign in with email (magic codes) + Facebook: widen users.provider. A
    // CHECK can't be ALTERed in SQLite — rebuild the table with FKs OFF so
    // the DROP's implicit delete can't cascade into stores/store_members
    // (verified against remote D1: with FKs on, the naive rebuild wipes
    // stores). Runs as ONE batch: pragma state does not survive separate
    // D1 statements.
    batch: true,
    name: '011-auth-email-facebook',
    sql: `
      PRAGMA foreign_keys=OFF;
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
      PRAGMA foreign_keys=ON;

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
    name: '012-product-image-crop',
    sql: `
      ALTER TABLE products ADD COLUMN image_crop_url TEXT NOT NULL DEFAULT '';
    `,
  },
  {
    // photo credits: every account starts with the free plan's 1000-photo
    // allotment on the account; pay-as-you-go packs top it up (1 credit = 1
    // product photo upload)
    name: '013-user-photo-credits',
    sql: `
      ALTER TABLE users ADD COLUMN photo_credits INTEGER NOT NULL DEFAULT 1000;
    `,
  },
  {
    // size-based photo charging (replaces credits): usage accrues by the
    // byte count of stored images against the account's quota — free quota
    // ≈ 1000 photos at ~200 KB (200 MB); packs extend it
    name: '014-user-photo-storage',
    sql: `
      ALTER TABLE users ADD COLUMN photo_bytes_used INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE users ADD COLUMN photo_bytes_quota INTEGER NOT NULL DEFAULT 209715200;
    `,
  },
  {
    // Demo product photos live in the database: one row per image with its
    // bytes (mirror of the Node backend's 012). They used to ship as static
    // SPA assets; scripts/load-demo-photos.mjs now writes the files of
    // backend/demo-products in here and products reference them at
    // /media/<file> (served by media.ts).
    name: '015-media-table',
    sql: `
      CREATE TABLE IF NOT EXISTS media (
        id TEXT PRIMARY KEY,
        mime TEXT NOT NULL,
        size INTEGER NOT NULL,
        etag TEXT NOT NULL,
        data BLOB NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
];

/**
 * Split a migration's SQL into statements. Triggers (BEGIN…END blocks) contain
 * semicolons internally, so a naive ';' split truncates them — accumulate
 * until BEGIN/END keywords balance instead.
 */
function splitStatements(sql: string): string[] {
  const parts = sql.split(';');
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < parts.length; i++) {
    const cand = cur ? `${cur};${parts[i]}` : parts[i];
    const begins = (cand.match(/\bBEGIN\b/g) || []).length;
    const ends = (cand.match(/\bEND\b/g) || []).length;
    if (begins > 0 ? ends >= begins : true) {
      out.push(cand);
      cur = '';
    } else {
      cur = cand;
    }
  }
  if (cur.trim()) out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

/**
 * Apply pending migrations. Safe to run again at any time — another isolate
 * may be mid-migration, or this one may be recovering an abandoned bootstrap
 * (see bootstrap()): every statement is an IF NOT EXISTS, a tolerated
 * duplicate or a re-runnable backfill, and the ledger insert is OR IGNORE.
 */
export async function migrate(env: Env): Promise<void> {
  await run(
    env,
    `CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );`
  );
  const applied = new Set((await all(env, 'SELECT name FROM migrations')).map((r) => r.name as string));
  for (const m of MIGRATIONS) {
    if (applied.has(m.name)) continue;
    // ALTER TABLE can't run inside a D1 batch with other DDL; statements run
    // one by one — each migration is idempotent via IF NOT EXISTS / its guard.
    // EXCEPT migrations flagged `batch`: they need pragma state (e.g.
    // foreign_keys=OFF around a table rebuild) to hold across statements,
    // which only survives within a single batch/transaction.
    try {
      if (m.batch) {
        await env.DB.batch(splitStatements(m.sql).map((s) => env.DB.prepare(s)));
      } else {
        for (const statement of splitStatements(m.sql)) {
          await run(env, statement);
        }
      }
    } catch (err) {
      // 004/005 ALTERs fail if another cold start applied them first — accept.
      const msg = String((err as Error).message || '');
      if (!/duplicate column|already exists|unique constraint/i.test(msg)) throw err;
    }
    // OR IGNORE: a concurrent isolate may have recorded this migration first
    // (the UNIQUE constraint on name is the loser's only failure mode).
    await run(env, 'INSERT OR IGNORE INTO migrations (name) VALUES (?)', m.name);
  }
}

/** Get (or lazily create + persist) the session-signing secret. */
async function resolveSessionSecret(env: Env): Promise<string> {
  const row = await first(env, "SELECT value FROM app_settings WHERE key = 'session_secret'");
  if (row) return row.value as string;
  const secret = randomToken(48);
  await run(env, "INSERT OR IGNORE INTO app_settings (key, value) VALUES ('session_secret', ?)", secret);
  const stored = await first(env, "SELECT value FROM app_settings WHERE key = 'session_secret'");
  return (stored?.value as string) || secret;
}

/* ---- once per isolate, shared by every request ---- */

/** The bootstrap in flight on this isolate — the one started by whichever request got here first. */
let booting: Promise<string> | null = null;
/** Set the moment a bootstrap succeeds; every later request just reads it. */
let booted: string | null = null;

/**
 * How long a request waits on a bootstrap that ANOTHER request started before
 * it gives up on that one and runs its own. A cold start is ~1.5 s of D1
 * round-trips, so this is only ever reached by a run that was abandoned.
 */
const FOLLOW_MS = 10_000;

/**
 * Wait on another request's bootstrap — never without a way out. A promise
 * belongs to the request that created it: if that request ends while the
 * bootstrap is still pending, the promise can never settle, and the runtime
 * either rejects the wait or leaves it hanging. An isolate left holding such a
 * promise failed EVERY request it got for the rest of its life. Resolves null
 * when the wait failed or has taken implausibly long, so the caller can start
 * a bootstrap of its own instead.
 */
function follow(attempt: Promise<string>): Promise<string | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), FOLLOW_MS);
    attempt.then(
      (secret) => {
        clearTimeout(timer);
        resolve(secret);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      }
    );
  });
}

/**
 * Full first-boot bootstrap: migrations, session secret, and (in local mode,
 * when the database is empty) the demo maps — the same behavior as the Node
 * backend's SELF_HOSTED=true boot. Resolves with the session secret.
 *
 * Once per isolate: requests that arrive while it is in flight share the one
 * run. `keepAlive` is that run's lifeline — the request that starts it hands
 * the promise to ctx.waitUntil(), which keeps the request (and so the promise)
 * alive until the run settles even if the request itself ends first. Should a
 * run be abandoned anyway, the next request waits it out (follow()) and then
 * runs a bootstrap of its own, so the isolate heals instead of staying dead.
 */
export async function bootstrap(
  env: Env,
  selfHosted: boolean,
  keepAlive?: (pending: Promise<unknown>) => void
): Promise<string> {
  if (booted !== null) return booted;
  // A failure clears `booting` itself; an abandoned run has nobody left to do
  // that, so the waiter does. Either way, look again before starting one: other
  // waiters may already have got a new run going.
  for (let waited = 0; booting && waited < 2; waited++) {
    const running = booting;
    const secret = await follow(running);
    if (secret !== null) return (booted ??= secret);
    if (booting === running) booting = null;
  }
  const attempt = (async () => {
    await migrate(env);
    const secret = await resolveSessionSecret(env);
    // Seed on every cold start in local mode — per-store idempotency in
    // seedExample skips present stores, so this is a handful of cheap
    // SELECTs, and it also lets the seeder retire replaced examples
    // (seedDemoMaps deletes stores whose slugs are no longer in the set).
    if (selfHosted) {
      try {
        await seedDemoMaps(env);
      } catch (err) {
        // A concurrent cold start may have seeded first — unique slugs make the
        // second run fail harmlessly.
        console.error('[boot] demo seed failed (likely already seeded):', (err as Error).message);
      }
    }
    return secret;
  })();
  booting = attempt;
  // the derived promise never rejects: waitUntil() logs a rejection as an uncaught exception
  keepAlive?.(attempt.catch(() => {}));
  try {
    const secret = await attempt;
    booted = secret;
    return secret;
  } catch (err) {
    // Never memoise failure — a losing isolate must be able to retry on the
    // next request instead of 500ing for its whole lifetime.
    if (booting === attempt) booting = null;
    throw err;
  }
}
