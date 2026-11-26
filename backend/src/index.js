import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { db } from './db.js';
import { createApp } from './app.js';
import { CATALOG_VERSION, catalogKey, isBulkStore, layoutKey, LAYOUT_VERSION } from '../scripts/demo-catalog.mjs';
import { cornerStoreSpec, homeDepotSpec, walmartSpec } from '../scripts/demo-specs.mjs';

/**
 * An example store that is present but was laid out — or stocked with its
 * catalogue — by an earlier version of the seed. The seed script brings such
 * a store up to date, and finds nothing to do on the starts after. (Only the
 * versions are compared here: generating the catalogue to compare its whole
 * record is the seed script's job.) A store that is not there at all is left
 * to the store count below, which is how a fresh database gets its examples.
 */
function exampleStoreStale() {
  const setting = db.prepare('SELECT value FROM app_settings WHERE key = ?');
  for (const make of [walmartSpec, homeDepotSpec, cornerStoreSpec]) {
    const { slug } = make();
    if (!db.prepare('SELECT 1 FROM stores WHERE slug = ?').get(slug)) continue;
    if (setting.get(layoutKey(slug))?.value !== String(LAYOUT_VERSION)) return true;
    if (!isBulkStore(slug)) continue;
    let loaded = null;
    try {
      loaded = JSON.parse(setting.get(catalogKey(slug))?.value ?? 'null');
    } catch {
      /* an unreadable record is an out-of-date one */
    }
    if (loaded?.version !== CATALOG_VERSION) return true;
  }
  return false;
}

const app = createApp();
// Set before listening so req.ip respects the platform's TLS proxy.
if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);

const server = app.listen(config.port, () => {
  console.log(`StoreMap listening on ${config.publicBaseUrl} (port ${config.port})`);
  console.log(`  dev login: ${config.devLogin ? 'enabled' : 'disabled'}`);
});

// Local mode: seed the demo maps on boot so a fresh one-click deploy is
// immediately explorable AND existing databases pick up newly added examples
// (the seed script is idempotent per store — present stores are skipped).
// SEED_DEMO=false to skip.
if (config.selfHosted && config.seedDemo) {
  const n = db.prepare('SELECT COUNT(*) n FROM stores').get().n;
  // a database seeded before the demo photos moved into the `media` table
  // references images it does not hold yet — one more seed run loads them
  const photosPending =
    db.prepare('SELECT COUNT(*) n FROM media').get().n === 0 &&
    db.prepare("SELECT COUNT(*) n FROM products WHERE image_url LIKE '/media/%' OR image_url LIKE '/demo-products/%'").get().n > 0;
  const stale = n > 0 && exampleStoreStale();
  if (n < 6 || photosPending || stale) {
    console.log(
      `[boot] ${n === 0 ? 'empty database' : stale ? 'an example store is from an earlier version' : `${n} stores present, demo set grew`} — seeding demo maps (SEED_DEMO=false to disable)`
    );
    const seedPath = fileURLToPath(new URL('../scripts/seed-demo.mjs', import.meta.url));
    spawn(process.execPath, [seedPath], { stdio: 'inherit', env: process.env }).on('exit', (code) =>
      console.log(`[boot] demo seed ${code === 0 ? 'complete' : 'failed'} (${code})`)
    );
  }
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
