#!/usr/bin/env node
/**
 * Load the example stores' generated catalogues into a Worker database (D1).
 *
 * The example stores carry big-box assortments — Walmart 120,000 SKUs, Home
 * Depot 40,000, the Corner Store 8,000 — made by
 * backend/scripts/demo-catalog.mjs: real brands, no photos, every SKU stocked
 * on the shelf of its department that holds its sort of product, with the
 * facing's level and place along the shelf. A Worker cannot make that many
 * rows on a request, so the Worker seeds only each store's floor plan and its
 * own demo items; the catalogue is loaded from here:
 *
 *   node worker/scripts/load-demo-catalog.mjs            # the local D1 of `wrangler dev`
 *   node worker/scripts/load-demo-catalog.mjs --remote   # the deployed D1 (needs `wrangler login`)
 *   … --persist-to <dir>                                # another local D1 (as in wrangler dev)
 *   … --store walmart-example                            # one store only
 *   … --config <file>                                  # another wrangler config (as in the deploy runbook)
 *   … --max-rows 60000                                 # write at most about this many rows in this run
 *
 * The store must already be laid out by the Worker's current version (start
 * the Worker once after a deploy): a store laid out by an older version is
 * rebuilt — catalogue included — on the Worker's next start, so loading it
 * here would be lost. What is loaded is recorded under
 * `seed:catalog:<slug>` in app_settings, which is how the public routes know
 * to serve the store without its catalogue inline.
 *
 * Idempotent: an up-to-date catalogue is skipped; a changed one is replaced
 * whole. An example store that someone claimed as their own is left alone, as
 * the seeder leaves it. D1 caps one SQL statement at 100 KB and takes one
 * import file per request, so rows go in multi-row statements of well under
 * 100 KB, grouped into files of a few MB. What lands is counted against what
 * was sent.
 *
 * The record that a catalogue is loaded goes in FIRST, marked as still
 * loading, and is settled at the end: from the first file on, the store is
 * served without its catalogue inline (the public routes go by the record),
 * so a run that stops part-way — the free plan's daily allowance of rows
 * written, a lost connection — leaves a light, working store, never a map of
 * tens of thousands of items inline. The next run carries on from where it
 * stopped rather than starting over: it looks up what the earlier run wrote
 * and sends only the rest.
 *
 * `--max-rows` stops a run before it has written that many rows. The free
 * plan allows a database 100,000 rows written a day (00:00 UTC to 00:00 UTC),
 * and once past it nothing can write until the next day — so on that plan a
 * catalogue goes in a day's worth at a time: one run with a budget each day
 * until the store reports "as sent".
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { walmartSpec, homeDepotSpec, cornerStoreSpec } from '../../backend/scripts/demo-specs.mjs';
import {
  LAYOUT_VERSION,
  STORE_TOTALS,
  OWNED_FACINGS,
  bulkCatalog,
  catalogKey,
  catalogMarker,
  facingMeta,
  layoutKey,
  withRealBrands,
} from '../../backend/scripts/demo-catalog.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const WORKER = path.resolve(here, '..');
const ROOT = path.resolve(WORKER, '..');
const WRANGLER = path.join(WORKER, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const CONFIG = path.join(ROOT, 'wrangler.jsonc');
/** the D1 database's name (also a binding name in wrangler.jsonc) */
const DATABASE = 'storemap';

const SPECS = { 'walmart-example': walmartSpec, 'home-depot-example': homeDepotSpec, 'convenience-store-example': cornerStoreSpec };
/** the account each example belongs to when the seeder made it (worker/src/seed.ts) */
const DEMO_OWNER = { 'walmart-example': 'walmart@storemap.demo', 'home-depot-example': 'homedepot@storemap.demo', 'convenience-store-example': 'corner@storemap.demo' };

const STATEMENT_BYTES = 80 * 1024; // D1 caps a SQL statement at 100 KB
const FILE_BYTES = 3 * 1024 * 1024; // one import file = one request: keep it small enough to finish

const args = process.argv.slice(2);
const FLAGS = ['--remote', '--persist-to', '--store', '--file-bytes', '--config', '--max-rows'];
const valueOf = (flag) => {
  const at = args.indexOf(flag);
  return at >= 0 ? args[at + 1] : null;
};
// every argument is a flag or the value of the flag before it
const isValue = (i) => FLAGS.includes(args[i - 1]) && FLAGS.includes(args[i - 1]) && args[i - 1] !== '--remote';
if (args.some((a, i) => !FLAGS.includes(a) && !isValue(i)) || ['--persist-to', '--store', '--file-bytes', '--config', '--max-rows'].some((f) => args.includes(f) && !valueOf(f))) {
  console.error('Usage: node worker/scripts/load-demo-catalog.mjs [--remote] [--persist-to <dir>] [--store <slug>] [--file-bytes <n>] [--config <file>] [--max-rows <n>]');
  process.exit(2);
}
const scope = args.includes('--remote') ? '--remote' : '--local';
const persistTo = valueOf('--persist-to');
const only = valueOf('--store');
const fileBytes = Number(valueOf('--file-bytes') ?? FILE_BYTES);
const config = valueOf('--config') ?? CONFIG;
const maxRows = valueOf('--max-rows') == null ? Infinity : Number(valueOf('--max-rows'));
if (only && !SPECS[only]) {
  console.error(`Unknown store "${only}" — one of ${Object.keys(SPECS).join(', ')}.`);
  process.exit(2);
}
if (!fs.existsSync(WRANGLER)) {
  console.error('wrangler is not installed — run `npm install` in worker/ first.');
  process.exit(1);
}

/** Run SQL against the database through wrangler (the supported way to reach
 *  either D1 — it uses the same local files as `wrangler dev`). */
function execute({ command, file, json = false }) {
  const out = execFileSync(
    process.execPath,
    [WRANGLER, 'd1', 'execute', DATABASE, scope, '--config', config, '--yes', ...(persistTo ? ['--persist-to', persistTo] : []), ...(json ? ['--json'] : []), ...(file ? ['--file', file] : ['--command', command])],
    { cwd: WORKER, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  return json ? JSON.parse(out.slice(out.indexOf('['), out.lastIndexOf(']') + 1))[0].results : out;
};

const q = (text) => `'${String(text).replace(/'/g, "''")}'`;
const n = (num) => (Number.isFinite(num) ? String(num) : 'NULL');
const target = scope === '--remote' ? 'the deployed D1 database' : persistTo ? `the local D1 at ${persistTo}` : 'the local D1 (wrangler dev)';

/** Multi-row INSERT statements of `rows`, each well under the statement cap —
 *  each with how many rows it writes. */
function inserts(table, columns, rows, render) {
  const statements = [];
  let values = [];
  let bytes = 0;
  const flush = () => {
    if (!values.length) return;
    // OR IGNORE: rows a stopped run already wrote are left as they are
    statements.push({ sql: `INSERT OR IGNORE INTO ${table} (${columns.join(', ')}) VALUES\n${values.join(',\n')};`, rows: values.length });
    values = [];
    bytes = 0;
  };
  for (const row of rows) {
    const value = `  (${render(row).join(', ')})`;
    if (bytes + value.length > STATEMENT_BYTES) flush();
    values.push(value);
    bytes += value.length + 2;
  }
  flush();
  return statements;
}

const STORE_QUERY = (slug) =>
  `SELECT s.id, f.id AS floor_id, u.email AS owner FROM stores s JOIN users u ON u.id = s.owner_id JOIN floors f ON f.store_id = s.id AND f.level = 1 WHERE s.slug = ${q(slug)} LIMIT 1`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'storemap-demo-catalog-'));
let failed = false;
try {
  for (const [slug, make] of Object.entries(SPECS)) {
    if (only && slug !== only) continue;
    const store = execute({ command: STORE_QUERY(slug), json: true })[0];
    if (!store) {
      console.error(`${slug}: not in ${target} — start the Worker once first (it seeds the example stores).`);
      failed = true;
      continue;
    }
    if (store.owner !== DEMO_OWNER[slug]) {
      console.log(`${slug}: claimed by ${store.owner} — its owner's store now, left as they made it.`);
      continue;
    }
    const laidOut = execute({ command: `SELECT value FROM app_settings WHERE key = ${q(layoutKey(slug))}`, json: true })[0]?.value;
    if (String(laidOut) !== String(LAYOUT_VERSION)) {
      console.error(`${slug}: laid out by another Worker version (recorded ${laidOut ?? 'nothing'}, this is ${LAYOUT_VERSION}) — start the Worker once first: it rebuilds the store, and a catalogue loaded now would go with the rebuild.`);
      failed = true;
      continue;
    }
    const key = catalogKey(slug);
    const marker = catalogMarker(slug, make());
    const held = execute({ command: `SELECT value FROM app_settings WHERE key = ${q(key)}`, json: true })[0]?.value;
    if (held === marker) {
      console.log(`${slug}: catalogue already up to date (${STORE_TOTALS[slug].toLocaleString('en-US')} SKUs) — skipped.`);
      continue;
    }

    const spec = withRealBrands(slug, make());
    let { products, locations } = bulkCatalog(slug, spec);
    // elements were written in spec order, so z_index - 1 is the spec's element index
    const shelfIds = Object.fromEntries(
      execute({ command: `SELECT id, z_index FROM map_elements WHERE floor_id = ${q(store.floor_id)} AND type = 'shelf'`, json: true }).map((r) => [Number(r.z_index) - 1, r.id])
    );
    const catIds = Object.fromEntries(execute({ command: `SELECT id, name FROM categories WHERE store_id = ${q(store.id)}`, json: true }).map((r) => [r.name, r.id]));
    const { fromSku } = JSON.parse(marker);
    // the same record, marked as still loading: what an interrupted run leaves behind
    const loading = JSON.stringify({ ...JSON.parse(marker), loading: true });
    const resume = held === loading;
    for (const p of products) if (!catIds[p.category]) throw new Error(`${slug}: the store has no department "${p.category}"`);
    for (const l of locations) if (!shelfIds[l.shelf]) throw new Error(`${slug}: shelf ${l.shelf} is not in the store`);

    // the demo's own items take real brands where a product line covers them
    const bySku = new Map(execute({ command: `SELECT id, sku, brand FROM products WHERE store_id = ${q(store.id)} AND sku < ${q(fromSku)}`, json: true }).map((r) => [r.sku, r]));
    const brandUpdates = spec.products
      .map((p, i) => ({ p, row: bySku.get(`${spec.skuPrefix}-${String(i + 1).padStart(spec.skuPad ?? 3, '0')}`) }))
      .filter(({ p, row }) => row && row.brand !== p.brand);

    // a facing names its product by its place in the whole list — kept, whatever is sent
    const every = products;
    // what an earlier run already wrote stays where it is: only the rest is sent
    if (resume) {
      const there = new Set(
        execute({
          command: `SELECT id FROM products WHERE store_id = ${q(store.id)} AND sku >= ${q(fromSku)}
                    UNION ALL SELECT id FROM product_locations WHERE floor_id = ${q(store.floor_id)} AND json_extract(meta, '$.u') IS NOT NULL`,
          json: true,
        }).map((r) => r.id)
      );
      const total = [products.length, locations.length];
      products = products.filter((p) => !there.has(p.id));
      locations = locations.filter((l) => !there.has(l.id) && every[l.product - spec.products.length]);
      console.log(
        `${slug}: an earlier run wrote ${(total[0] - products.length).toLocaleString('en-US')} SKUs and ${(total[1] - locations.length).toLocaleString('en-US')} facings — ${(products.length + locations.length).toLocaleString('en-US')} rows left to write.`
      );
    }

    // every statement with how many rows it writes (a budget is counted in those)
    const statements = [
      // first, so the store is served without its catalogue inline from here on
      { sql: `INSERT INTO app_settings (key, value) VALUES (${q(key)}, ${q(loading)}) ON CONFLICT(key) DO UPDATE SET value = excluded.value;`, rows: 1 },
      // what is already there of this catalogue stays; anything else makes way
      ...(resume
        ? []
        : [
            { sql: `DELETE FROM product_locations WHERE floor_id = ${q(store.floor_id)} AND NOT (${OWNED_FACINGS});`, rows: 0 },
            { sql: `DELETE FROM products WHERE store_id = ${q(store.id)} AND sku >= ${q(fromSku)};`, rows: 0 },
          ]),
      ...brandUpdates.map(({ p, row }) => ({ sql: `UPDATE products SET brand = ${q(p.brand)} WHERE id = ${q(row.id)};`, rows: 1 })),
      ...inserts('products', ['id', 'store_id', 'category_id', 'name', 'brand', 'sku', 'barcode', 'description', 'price', 'image_url'], products, (p) => [q(p.id), q(store.id), q(catIds[p.category]), q(p.name), q(p.brand), q(p.sku), "''", "''", n(p.price), "''"]),
      ...inserts('product_locations', ['id', 'product_id', 'floor_id', 'x', 'y', 'rot', 'meta'], locations, (l) => [q(l.id), q(every[l.product - spec.products.length].id), q(store.floor_id), n(l.x), n(l.y), '0', q(JSON.stringify(facingMeta(l, shelfIds[l.shelf])))]),
      // last: the record that settles the catalogue as loaded
      { sql: `INSERT INTO app_settings (key, value) VALUES (${q(key)}, ${q(marker)}) ON CONFLICT(key) DO UPDATE SET value = excluded.value;`, rows: 1 },
    ];

    const files = [];
    let pending = [];
    let bytes = 0;
    let rows = 0;
    for (const statement of statements) {
      if (bytes + statement.sql.length > fileBytes && pending.length) {
        files.push({ sql: pending, rows });
        pending = [];
        bytes = 0;
        rows = 0;
      }
      pending.push(statement.sql);
      bytes += statement.sql.length + 1;
      rows += statement.rows;
    }
    if (pending.length) files.push({ sql: pending, rows });

    console.log(
      `${slug}: ${resume ? 'finishing' : 'loading'} ${products.length.toLocaleString('en-US')} SKUs and ${locations.length.toLocaleString('en-US')} facings` +
        ` (${brandUpdates.length} demo items re-branded) in ${files.length} files…`
    );
    if (files[0].rows > maxRows) {
      console.error(`${slug}: --max-rows ${maxRows.toLocaleString('en-US')} is smaller than the first file (${files[0].rows.toLocaleString('en-US')} rows) — raise it, or lower --file-bytes.`);
      failed = true;
      continue;
    }
    const t0 = Date.now();
    let written = 0;
    for (const [i, group] of files.entries()) {
      if (written + group.rows > maxRows) {
        console.log(`\n  ${slug}: stopped at ${written.toLocaleString('en-US')} rows written (the --max-rows allowance) — run this again after 00:00 UTC; it carries on.`);
        break;
      }
      const file = path.join(tmp, `${slug}-${String(i + 1).padStart(3, '0')}.sql`);
      fs.writeFileSync(file, `${group.sql.join('\n')}\n`);
      execute({ file });
      written += group.rows;
      process.stdout.write(`\r  ${slug}: ${i + 1}/${files.length} files, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
    process.stdout.write('\n');
  }
} catch (err) {
  failed = true;
  console.error(`\n${err.message.split('\n').slice(-12).join('\n')}`);
  if (/limit|allowance|exceeded|over quota/i.test(err.message)) {
    console.error('The database would write no more (its daily allowance, on the free plan). Run this again after 00:00 UTC: it carries on from where it stopped.');
  }
  if (process.env.DEBUG) console.error(err.stack?.split('\n').slice(1, 5).join('\n'));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

// prove it against what is ACTUALLY stored: every SKU of the catalogue, every
// facing on its shelf, and each facing joined to its product
for (const [slug, make] of Object.entries(SPECS)) {
  if (only && slug !== only) continue;
  const store = execute({ command: STORE_QUERY(slug), json: true })[0];
  if (!store || store.owner !== DEMO_OWNER[slug]) continue;
  const expected = catalogMarker(slug, make());
  const record = execute({ command: `SELECT value FROM app_settings WHERE key = ${q(catalogKey(slug))}`, json: true })[0]?.value;
  if (record == null) {
    console.error(`${slug}: no catalogue record — nothing was loaded, or a run stopped before its first file.`);
    failed = true;
    continue;
  }
  const marker = String(record);
  const { loading } = JSON.parse(marker);
  if (marker !== expected && !(loading && marker === JSON.stringify({ ...JSON.parse(expected), loading: true }))) {
    console.error(`${slug}: its catalogue record does not match this version's catalogue.`);
    failed = true;
    continue;
  }
  const { fromSku, products: wanted, locations: facings } = JSON.parse(marker);
  const skus = execute({ command: `SELECT COUNT(*) AS n FROM products WHERE store_id = ${q(store.id)} AND sku >= ${q(fromSku)}`, json: true })[0].n;
  const rows = execute({ command: `SELECT COUNT(*) AS n FROM products WHERE store_id = ${q(store.id)}`, json: true })[0].n;
  const placed = execute({ command: `SELECT COUNT(*) AS n FROM product_locations WHERE floor_id = ${q(store.floor_id)} AND NOT (${OWNED_FACINGS})`, json: true })[0].n;
  const joined = execute({
    command: `SELECT COUNT(*) AS n FROM product_locations l JOIN products p ON p.id = l.product_id JOIN map_elements e ON e.id = json_extract(l.meta, '$.shelfId') WHERE p.store_id = ${q(store.id)} AND json_extract(l.meta, '$.u') IS NOT NULL`,
    json: true,
  })[0].n;
  const ok = Number(rows) === wanted && Number(placed) === facings && Number(joined) === facings;
  console.log(
    `${slug}: ${Number(rows).toLocaleString('en-US')} products (${Number(skus).toLocaleString('en-US')} generated), ${Number(placed).toLocaleString('en-US')} facings, ${Number(joined).toLocaleString('en-US')} of them on a shelf of the store — ${
      ok ? (loading ? 'all there, but not settled: run this again' : 'as sent') : 'NOT all there: run this again'
    }.`
  );
  if (!ok) failed = true;
}
process.exit(failed ? 1 : 0);
