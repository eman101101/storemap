#!/usr/bin/env node
/**
 * Copy the demo product photos into a Worker database (D1's `media` table).
 *
 * The photos live in backend/demo-products and are stored IN the database,
 * not shipped with the frontend (see src/media.ts). A Worker cannot bundle
 * them (the set is several MB of images), so they are loaded from here:
 *
 *   node worker/scripts/load-demo-photos.mjs            # the local D1 of `wrangler dev`
 *   node worker/scripts/load-demo-photos.mjs --remote   # the deployed D1 (needs `wrangler login`)
 *   npm run photos [-- --remote]                        # the same, run from worker/
 *   … --persist-to <dir>                                # another local D1 (as in wrangler dev)
 *
 * Idempotent: an image already stored whole is skipped, so a second run
 * takes seconds. D1 caps one SQL statement at 100 KB, so each image is
 * written in 24 KB pieces and each import file is kept small.
 *
 * Mind the CAST on every appended piece: SQLite's `||` returns TEXT even
 * for two blobs (the bytes survive, but the Worker would then read the row
 * as a string and hand the browser garbage). CAST(… AS BLOB) keeps the
 * image a blob.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const WORKER = path.resolve(here, '..');
const ROOT = path.resolve(WORKER, '..');
const WRANGLER = path.join(WORKER, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const CONFIG = path.join(ROOT, 'wrangler.jsonc');
/** the D1 database's name (also a binding name in wrangler.jsonc) */
const DATABASE = 'storemap';

const PHOTOS = JSON.parse(fs.readFileSync(path.join(ROOT, 'backend', 'scripts', 'demo-photos.json'), 'utf8'));
const PHOTO_DIR = path.join(ROOT, 'backend', 'demo-products');
const MEDIA_URL = /^\/media\/((?:gen\/)?[a-z0-9-]+\.(?:jpe?g|png|webp|svg))$/;

const CHUNK_BYTES = 24 * 1024; // D1 caps a SQL statement at 100 KB, and hex doubles every byte
const FILE_BYTES = 320 * 1024; // one import file = one request: keep each small

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

const args = process.argv.slice(2);
const persistAt = args.indexOf('--persist-to');
const persistTo = persistAt >= 0 ? args[persistAt + 1] : null;
const isPath = (i) => persistAt >= 0 && i === persistAt + 1; // the value that follows --persist-to
if (args.some((a, i) => !isPath(i) && a !== '--remote' && a !== '--persist-to') || (persistAt >= 0 && !persistTo)) {
  console.error('Usage: node worker/scripts/load-demo-photos.mjs [--remote] [--persist-to <dir>]');
  process.exit(2);
}
const scope = args.includes('--remote') ? '--remote' : '--local';

if (!fs.existsSync(WRANGLER)) {
  console.error('wrangler is not installed — run `npm install` in worker/ first.');
  process.exit(1);
}

/** Run SQL against the database through wrangler (the supported way to reach
 *  either D1 — it uses the same local files as `wrangler dev`). */
function execute({ command, file, json = false }) {
  const out = execFileSync(
    process.execPath,
    [WRANGLER, 'd1', 'execute', DATABASE, scope, '--config', CONFIG, '--yes', ...(persistTo ? ['--persist-to', persistTo] : []), ...(json ? ['--json'] : []), ...(file ? ['--file', file] : ['--command', command])],
    { cwd: WORKER, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  return json ? JSON.parse(out.slice(out.indexOf('['), out.lastIndexOf(']') + 1)) : out;
};

const target = scope === '--remote' ? 'the deployed D1 database' : persistTo ? `the local D1 at ${persistTo}` : 'the local D1 (wrangler dev)';

// the table is created by the Worker's migration on first request; make it
// exist here too so the photos can be loaded before that first request
execute({ command: 'CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY, mime TEXT NOT NULL, size INTEGER NOT NULL, etag TEXT NOT NULL, data BLOB NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime(\'now\')))' });

/** What the database holds per image: its recorded content hash, and how the
 *  bytes are actually stored (type and length). */
const stored = new Map(
  execute({ command: 'SELECT id, etag, typeof(data) AS t, length(data) AS n FROM media', json: true })[0].results.map((r) => [r.id, r])
);
/** An image is done only when it is stored WHOLE: the right content hash, as
 *  a blob of its full length. Anything else is (re)loaded — which is also how
 *  a row left malformed by an earlier run repairs itself. */
const heldWhole = (id, { size, etag }) => {
  const row = stored.get(id);
  return !!row && row.etag === etag && row.t === 'blob' && Number(row.n) === size;
};

/** The photo set: file → { mime, etag, statements }, straight from disk. */
const wanted = new Map();
for (const url of new Set(Object.values(PHOTOS))) {
  const id = MEDIA_URL.exec(url)?.[1];
  if (!id) throw new Error(`Not a stored demo photo url: ${url}`);
  const buf = fs.readFileSync(path.join(PHOTO_DIR, id));
  const etag = createHash('sha256').update(buf).digest('hex');
  wanted.set(id, { size: buf.length, etag });
  if (heldWhole(id, wanted.get(id))) continue; // already stored whole
  const hex = buf.toString('hex');
  const pieces = [];
  for (let i = 0; i < hex.length; i += CHUNK_BYTES * 2) pieces.push(hex.slice(i, i + CHUNK_BYTES * 2));
  const key = `'${id}'`; // ids are [a-z0-9-/.] — nothing to escape
  wanted.get(id).statements = [
    `INSERT OR REPLACE INTO media (id, mime, size, etag, data) VALUES (${key}, '${MIME[path.extname(id)]}', ${buf.length}, '${etag}', X'${pieces[0]}');`,
    ...pieces.slice(1).map((piece) => `UPDATE media SET data = CAST(data || X'${piece}' AS BLOB) WHERE id = ${key};`),
  ];
}

const toLoad = [...wanted].filter(([, w]) => w.statements);
const stale = [...stored.keys()].filter((id) => !wanted.has(id));
const repair = toLoad.filter(([id]) => stored.has(id)).length;
console.log(
  `Demo photos: ${wanted.size} in the set, ${stored.size} in ${target} — ${toLoad.length} to load` +
    (repair ? ` (${repair} of them are there but not stored whole, so they are rewritten)` : '') +
    (stale.length ? `, ${stale.length} stale to remove` : '') + '.'
);

// group the images into import files of a bounded size, never splitting one
// across two files (a failed run then leaves only whole images to redo)
const files = [];
let pending = [];
let bytes = 0;
const flush = () => {
  if (pending.length) files.push(pending);
  pending = [];
  bytes = 0;
};
for (const [, w] of toLoad) {
  const size = w.statements.reduce((n, s) => n + s.length, 0);
  if (bytes + size > FILE_BYTES) flush();
  pending.push(...w.statements);
  bytes += size;
}
flush();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'storemap-demo-photos-'));
try {
  let done = 0;
  for (const [i, statements] of files.entries()) {
    const file = path.join(tmp, `photos-${String(i + 1).padStart(3, '0')}.sql`);
    fs.writeFileSync(file, `${statements.join('\n')}\n`);
    execute({ file });
    done += statements.filter((s) => s.startsWith('INSERT')).length;
    process.stdout.write(`\r  loaded ${done}/${toLoad.length} images`);
  }
  if (files.length) process.stdout.write('\n');
  if (stale.length) {
    execute({ command: `DELETE FROM media WHERE id NOT IN (${[...wanted.keys()].map((id) => `'${id}'`).join(', ')})` });
    console.log(`  removed ${stale.length} photos that are no longer in the set`);
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

// prove it against what is ACTUALLY stored — not the size and hash columns
// this script wrote itself: every row must be a blob as long as its file,
// carrying that file's content hash
const rows = execute({ command: 'SELECT id, etag, typeof(data) AS t, length(data) AS n FROM media', json: true })[0].results;
const wrong = [...wanted].filter(([id, w]) => {
  const r = rows.find((row) => row.id === id);
  return !r || r.etag !== w.etag || r.t !== 'blob' || Number(r.n) !== w.size;
}).map(([id]) => id);
if (wrong.length) {
  console.error(`\n${wrong.length} photos are not stored whole in ${target} (e.g. ${wrong.slice(0, 3).join(', ')}): run this again.`);
  process.exit(1);
}
console.log(`Done — ${wanted.size} demo photos are in ${target}, each stored as a blob of its file's full length and content hash.`);
if (scope === '--local') console.log('The demo maps now reference them at /media/… (the Worker re-points products on its next start).');
