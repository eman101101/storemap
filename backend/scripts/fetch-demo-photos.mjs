/**
 * Download real product photos from Open Food Facts for the grocery demo items.
 *
 *   node backend/scripts/fetch-demo-photos.mjs                 # idempotent — existing files are kept
 *   node backend/scripts/fetch-demo-photos.mjs --force         # re-download everything
 *   node backend/scripts/fetch-demo-photos.mjs --only "Cola 500ml,Lager 440ml Can"   # just these
 *   node backend/scripts/fetch-demo-photos.mjs --only @corner-store   # …or a whole section (@walmart, @original)
 *   node backend/scripts/fetch-demo-photos.mjs --credits       # also re-look-up the source of existing photos
 *   node backend/scripts/fetch-demo-photos.mjs --fallback-only  # no network: give every item still without a
 *                                                               # photo its generated packshot (finishing a run
 *                                                               # that was cut short — a later normal run retries)
 *
 * Writes backend/demo-products/<slug>.jpg (~200px fronts, small) and
 * ATTRIBUTION.md (ODbL credit + source URLs), and merges the name → url map
 * into demo-photos.json (entries written by fetch-demo-photos-cc.mjs — the
 * non-grocery photos — are kept; a real photo always beats a generated one).
 * Non-grocery items live in fetch-demo-photos-cc.mjs. The photos are not
 * shipped with the frontend: seed-demo.mjs copies each file into the
 * database's `media` table, served at the /media/… urls recorded here.
 *
 * Any wanted name without a downloaded photo gets a stylized SVG packshot
 * (see packshot-svg.mjs) so EVERY seeded item resolves to an image file.
 * ALIASES map a seed name onto an already-fetched photo of the same product
 * (the demo stores name some items differently — "Bananas (bunch)" is the
 * bananas photo).
 */
import fs from 'node:fs';
import path from 'node:path';
import { slug, writePackshotSvg } from './packshot-svg.mjs';
import { CORNER_STORE, ORIGINAL, WALMART } from './demo-photo-wanted.mjs';

const OUT = path.resolve(import.meta.dirname, '../demo-products');
const PHOTO_MAP = path.join(import.meta.dirname, 'demo-photos.json');
const UA = 'StoreMap-demo-seeder/1.0 (self-hosted grocery map demo)';
/** Section order = fetch order: the Corner Store first (the food database
 *  rate-limits hard, so the smallest, most-seen example is done first). */
const WANTED = [...CORNER_STORE, ...WALMART, ...ORIGINAL];
const SECTION = { '@corner-store': CORNER_STORE, '@walmart': WALMART, '@original': ORIGINAL };

/** seed name → wanted name whose photo is the same product. Used when the
 *  name's own lookup finds nothing (no download). */
const ALIASES = {
  'Air Freshener 300ml': 'Air Freshener Spray 300ml',
  'Avocados (2-pack)': 'Avocados 2-pack',
  'Bananas (bunch)': 'Bananas 1kg',
  'Carrots 1kg Bag': 'Carrots 1kg',
  'Kitchen Roll 4 Rolls': 'Paper Towels 2-roll',
  'Kitchen Roll 2 Rolls': 'Paper Towels 2-roll',
  'Mature Cheddar Block 350g': 'Mild Cheddar Block 350g',
  'Navel Oranges 2kg Bag': 'Navel Oranges 6-pack',
  'Red Bell Peppers (3-pack)': 'Bell Peppers 3-pack',
  'Sparkling Water 6×500ml': 'Sparkling Water 500ml',
  'Sponges 6-pack': 'Cleaning Sponges 4-pack',
  'Dish Sponge 3-pack': 'Cleaning Sponges 4-pack',
  'Streaky Bacon 200g': 'Bacon Rashers 300g',
  'Olive Oil 250ml': 'Olive Oil 500ml',
  'Iced Tea Lemon 500ml': 'Iced Tea Lemon 1.5L',
  'Ground Coffee 200g': 'Ground Coffee 500g',
  'Hot Chocolate Sachets 5-pack': 'Hot Chocolate Mix 400g',
  'Tortilla Chips 100g': 'Tortilla Chips 300g',
  'Salted Peanuts 50g': 'Salted Peanuts 200g',
  'Salted Pretzels 45g': 'Salted Pretzels 250g',
  'Sweet Popcorn 40g': 'Sweet Popcorn 100g',
  'Trail Mix 40g': 'Trail Mix 150g',
  'Gummy Bears 100g': 'Gummy Bears 200g',
  'Sea Salt Crisps 32g': 'Sea Salt Crisps 150g',
  'Salt & Vinegar Crisps 32g': 'Salt & Vinegar Crisps 150g',
  'Green Tea 20-pack': 'Green Tea 40 Bags',
  'Cod Fillets 2-pack': 'Cod Fillets',
  'Frozen Salmon Fillets 2-pack': 'Frozen Salmon Fillets',
  'Tuna Steaks 2-pack': 'Tuna Steaks',
  'Frozen Berry Mix 500g': 'Frozen Berries 300g',
  'Still Water 6×1.5L': 'Still Water 600ml',
  'Ice Lollies 8-pack': 'Ice Lollies 4-pack',
  'Tomato Ketchup 550g': 'Tomato Ketchup 300ml',
  'Hand Soap 100ml': 'Hand Soap 500ml',
};

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const force = flag('--force');
const fallbackOnly = flag('--fallback-only');
const credits = flag('--credits');
const only = (() => {
  const i = args.indexOf('--only');
  if (i < 0) return null;
  // names, or a whole section: --only @corner-store
  return new Set(args[i + 1].split(',').map((s) => s.trim()).flatMap((k) => SECTION[k]?.map(([n]) => n) ?? [k]));
})();
const WANTED_NAMES = only ? WANTED.filter(([name]) => only.has(name)) : WANTED;

async function offSearch(term) {
  const url =
    'https://world.openfoodfacts.org/cgi/search.pl?search_terms=' +
    encodeURIComponent(term) +
    '&search_simple=1&action=process&json=1&page_size=12' +
    '&fields=product_name,brands,image_front_url,image_small_url';
  // OFF rate-limits in bursts (503 + an HTML "temporarily unavailable"
  // page) — these queries run for minutes, so back off patiently instead of
  // giving up and silently downgrading the item to a generated packshot
  for (let attempt = 0; attempt < 7; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
      if (res.ok) return (await res.json()).products ?? [];
      if (res.status !== 503 && res.status !== 429) throw new Error(`search ${res.status}`);
      if (process.env.FETCH_DEBUG) console.log(`   · ${res.status} (attempt ${attempt + 1})`);
    } catch (err) {
      if (/^search /.test(err.message)) throw err;
      // network hiccup — fall through to the backoff
    }
    await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
  }
  throw new Error('search rate-limited');
}

/** OFF image urls end .100.jpg (small) — the 200px variant swaps the size. */
function bigger(url) {
  return url.replace(/\.(\d+)\.jpg$/, '.200.jpg');
}

async function download(url, file) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`image ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 800) throw new Error('image too small / placeholder');
  fs.writeFileSync(file, buf);
  return buf.length;
}

const wordsOf = (s) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
/** How much of the search term a product name covers (prefix match, so
 *  "yogurt" also accepts "yogurts"). */
function overlap(name, term) {
  const words = wordsOf(term);
  const n = ` ${name.toLowerCase()} `;
  return words.length
    ? words.filter((w) => n.includes(w.slice(0, Math.max(4, w.length - 1)))).length / words.length
    : 0;
}

/** The result to use: the imaged product whose name matches the search term
 *  best (the API's own order put near-misses first — "Diet Coke" for
 *  "cola can"), falling back to the first one with any photo. */
function pickResult(products, term) {
  const imaged = products.filter((p) => p.image_front_url || p.image_small_url);
  return [...imaged].sort((a, b) => overlap(b.product_name || '', term) - overlap(a.product_name || '', term))[0] ?? null;
}

fs.mkdirSync(OUT, { recursive: true });
const existingMap = fs.existsSync(PHOTO_MAP) ? JSON.parse(fs.readFileSync(PHOTO_MAP, 'utf8')) : {};
const mapping = {};
const rows = new Map(); // name → ATTRIBUTION.md row (this run's downloads + --credits lookups)

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').trim();
const creditRow = (name, hit, url) =>
  `| ${cell(name)} | ${cell((hit.brands ? hit.brands.split(',')[0] + ' ' : '') + (hit.product_name || ''))} — ${url} |`;

const CREDITS_FILE = path.join(OUT, 'ATTRIBUTION.md');
// the attribution table keeps rows from earlier runs (keyed by product)
const kept = new Map();
if (fs.existsSync(CREDITS_FILE)) {
  for (const line of fs.readFileSync(CREDITS_FILE, 'utf8').split('\n')) {
    const m = /^\| (.+?) \| (.+) \|$/.exec(line);
    if (m && !/^(Demo product|---)/.test(m[1])) kept.set(m[1], line);
  }
}

/** Write the attribution table and merge the name → url map into
 *  demo-photos.json. Called after EVERY item: the food database rate-limits
 *  hard and a run can be interrupted (or re-run for one item) at any point —
 *  the photos already fetched must show up in the demo either way. */
const saveOutputs = () => {
  for (const [name, row] of rows) kept.set(name, row);
  fs.writeFileSync(
    CREDITS_FILE,
    [
      '# Demo product photos', '',
      'Grocery, drink and household photos for the demo stores, downloaded from',
      '[Open Food Facts](https://world.openfoodfacts.org) — data and images licensed under the',
      '[Open Database License](https://opendatacommons.org/licenses/odbl/1-0/) (ODbL).', '',
      'Hardware, garden, electronics, apparel and toy photos come from openly-licensed sources instead —',
      'see [ATTRIBUTION-CC.md](ATTRIBUTION-CC.md).', '',
      'Regenerate: `node backend/scripts/fetch-demo-photos.mjs`.', '',
      'The photo files live in `backend/demo-products/` and are stored in the database',
      '(its `media` table) by `backend/scripts/seed-demo.mjs` — nothing ships with the frontend.', '',
      '| Demo product | Source |', '|---|---|',
      ...[...kept.keys()].sort((a, b) => a.localeCompare(b)).map((k) => kept.get(k)), '',
    ].join('\n')
  );

  // one source of truth for demo photo urls — the seeders read this map. The
  // non-grocery script merges here too, and a real photo always beats a
  // generated packshot, whichever script wrote the entry first. (Re-read
  // each time: the two scripts can run at the same time.)
  const latest = fs.existsSync(PHOTO_MAP) ? JSON.parse(fs.readFileSync(PHOTO_MAP, 'utf8')) : {};
  const merged = { ...latest };
  for (const [name, url] of Object.entries(mapping)) {
    if (url.endsWith('.jpg') || !latest[name]?.endsWith('.jpg')) merged[name] = url;
  }
  fs.writeFileSync(
    PHOTO_MAP,
    JSON.stringify(Object.fromEntries(Object.entries(merged).sort(([x], [y]) => x.localeCompare(y))), null, 2) + '\n'
  );
};

let ok = 0;
for (const [name, term] of WANTED_NAMES) {
  const file = path.join(OUT, `${slug(name)}.jpg`);
  const have = fs.existsSync(file) && !force;
  if (have && !credits) {
    mapping[name] = `/media/${slug(name)}.jpg`;
    ok++;
    continue;
  }
  if (!have && fallbackOnly) {
    console.warn(`· ${name}: no photo yet`);
  } else
  try {
    const hit = pickResult(await offSearch(term), term);
    if (!hit) throw new Error('no imaged result');
    const url = hit.image_front_url || hit.image_small_url;
    if (!have) {
      let bytes;
      try {
        bytes = await download(bigger(url), file);
      } catch {
        bytes = await download(url, file); // 200px variant missing → original size
      }
      console.log(`✓ ${name} ← ${(hit.brands || '?').split(',')[0]} (${(bytes / 1024).toFixed(0)} KB)`);
    } else {
      console.log(`© ${name} — source recorded`);
    }
    mapping[name] = `/media/${slug(name)}.jpg`;
    rows.set(name, creditRow(name, hit, url));
    ok++;
  } catch (err) {
    console.warn(`✗ ${name}: ${err.message}`);
  }
  saveOutputs();
  if (!fallbackOnly) await new Promise((r) => setTimeout(r, 2000)); // be polite to the API
}

// an alias shares its product's photo when its own lookup found nothing —
// only once that photo exists
let aliasedN = 0;
for (const name of [...WANTED_NAMES.map(([n]) => n), ...Object.keys(ALIASES)]) {
  if (only && !only.has(name)) continue;
  if (mapping[name]) continue;
  const twin = ALIASES[name] && (mapping[ALIASES[name]] ?? existingMap[ALIASES[name]]);
  if (twin?.endsWith('.jpg')) {
    mapping[name] = twin;
    aliasedN++;
    console.log(`≈ ${name} → photo of "${ALIASES[name]}"`);
  }
}

/* ── Generated packshot fallbacks ─────────────────────────────────────────
   Any wanted name without a photo gets a stylized SVG packshot
   (packshot-svg.mjs) so EVERY seeded item resolves to an image file. */
let gen = 0;
for (const [name] of WANTED_NAMES) {
  if (mapping[name]) continue;
  mapping[name] = writePackshotSvg(path.join(OUT, 'gen'), name);
  gen++;
}

saveOutputs();
console.log(`\n${ok} fetched/kept + ${gen} generated = ${ok + gen}/${WANTED_NAMES.length} wanted photos in ${OUT} (+${aliasedN} aliased to a photo above)`);
console.log(`Seed mapping merged into backend/scripts/demo-photos.json`);
