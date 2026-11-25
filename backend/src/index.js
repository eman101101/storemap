import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { db } from './db.js';
import { createApp } from './app.js';

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
  if (n < 6 || photosPending) {
    console.log(`[boot] ${n === 0 ? 'empty database' : `${n} stores present, demo set grew`} — seeding demo maps (SEED_DEMO=false to disable)`);
    const seedPath = fileURLToPath(new URL('../scripts/seed-demo.mjs', import.meta.url));
    spawn(process.execPath, [seedPath], { stdio: 'inherit', env: process.env }).on('exit', (code) =>
      console.log(`[boot] demo seed ${code === 0 ? 'complete' : 'failed'} (${code})`)
    );
  }
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
