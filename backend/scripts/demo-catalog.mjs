/**
 * The bulk of the example stores' catalogues, generated — shared by the Node
 * seeder (backend/scripts/demo-specs.mjs) and the Worker's (worker/src/seed.ts),
 * so both engines hold the very same catalogue.
 *
 * The example stores carry realistic big-box assortments — Walmart 120,000
 * SKUs, Home Depot 40,000, the Corner Store 8,000 — far more than the demo
 * photo pool covers. The generated items therefore carry NO photo (they
 * planogram as diagram tiles) and real brands (see the demo-catalog-*.mjs
 * line tables). Everything is deterministic: the same call always yields the
 * same catalogue, so re-seeding is stable and a test can hold the two engines
 * equal.
 *
 * A store's total is split across its departments by SHARES; each department
 * draws its quota from its product grids by hashing, so even a small quota
 * already uses every brand, line and size instead of running through one
 * product at a time. Items are then ordered by brand, so a shelf reads in
 * brand blocks the way a real planogram is blocked.
 */
import { createHash } from 'node:crypto';
import WM from "./demo-catalog-walmart.mjs";
import HD from "./demo-catalog-homedepot.mjs";
import CS from "./demo-catalog-corner.mjs";

/** Bump when the generated catalogue should be reloaded (lines, totals, naming,
 *  or which shelf a kind of product is picked for). */
export const CATALOG_VERSION = 3;

/** How many SKUs each example store carries, its original demo items included. */
export const STORE_TOTALS = {
  "walmart-example": 120000,
  "home-depot-example": 40000,
  "convenience-store-example": 8000,
};

/** Real-brand product lines, by store and department (category name). */
const LINES = { "walmart-example": WM, "home-depot-example": HD, "convenience-store-example": CS };

/** Each department's share of its store's catalogue (relative weights). */
export const STORE_SHARES = {
  "walmart-example": {
    "Dairy & Cheese": 9, "Deli & Cheese": 3.5, "Adult Beverages": 5, "Snacks & Candy": 15, "Breakfast & Coffee": 8,
    "Pantry": 15, "Drinks": 8, "Meat & Seafood": 4, "Frozen": 9, "Bakery": 5, "Fresh Produce": 3.5, "Paper & Cleaning": 7,
    "Personal Care": 7, "Pharmacy": 4.5, "Baby": 3.5, "Pet Care": 3.5, "Home & Bedding": 2.5, "Kitchen & Dining": 3.5,
    "Home Office": 1.5, "Electronics": 3, "Toys & Games": 4, "Sports & Outdoors": 3.5, "Auto Care": 2.5, "Auto Accessories": 2.5,
    "Tools & Hardware": 2.5, "Outdoor & Garden": 2.5, "Boys": 1.2, "Girls": 1.2, "Shoes": 2, "Mens": 1.3, "Ladies": 1.5,
    "Books & Media": 0.8, "Arts & Crafts": 1.5, "Celebrate": 1.2, "Seasonal": 1.5,
  },
  "home-depot-example": {
    "Power Tools": 5, "Hand Tools": 3.5, "Paint": 4.5, "Lumber": 2.5, "Plumbing": 3.5, "Electrical": 3.5, "Lighting": 2.5,
    "Appliances": 1.8, "Hardware": 4, "Storage & Organization": 2.5, "Lawn & Garden": 3.5, "Grills & Outdoor": 1.2,
    "Concrete": 0.8, "Roofing": 0.9, "Flooring": 1.5, "Safety & Workwear": 1.2, "Doors & Windows": 1.5, "Kitchens & Bath": 2.5,
    "Seasonal": 1.5,
  },
  "convenience-store-example": {
    "Soft Drinks": 2, "Milk & Dairy": 1, "Beer & Cider": 1, "Salty Snacks": 1.6, "Candy & Chocolate": 1.2, "Coffee & Tea": 0.8,
    "Hot Food": 0.4, "Pantry Essentials": 0.6, "Household Essentials": 0.6, "Ice Cream": 0.8,
  },
};

/** Whether a store's catalogue is one of the generated big-box ones. */
export function isBulkStore(slug) {
  return Object.hasOwn(STORE_TOTALS, slug);
}

/**
 * Split `total` between weighted parts so the shares add up to exactly
 * `total` (largest-remainder rounding). `weights` maps a key to its weight;
 * the result maps every key to a whole-number share.
 */
export function apportion(total, weights) {
  const entries = Object.entries(weights);
  const sum = entries.reduce((n, [, w]) => n + w, 0);
  const out = {};
  let assigned = 0;
  const remainders = [];
  for (const [key, weight] of entries) {
    const exact = (total * weight) / sum;
    const whole = entries.length === 1 ? total : Math.floor(exact);
    out[key] = whole;
    assigned += whole;
    remainders.push([exact - whole, key]);
  }
  // the pieces lost to rounding go, largest first, until the total is exact
  remainders.sort((a, b) => b[0] - a[0] || a[1].localeCompare(b[1]));
  let left = total - assigned;
  for (let i = 0; left > 0; i = (i + 1) % remainders.length) {
    out[remainders[i][1]] += 1;
    left -= 1;
  }
  return out;
}


/**
 * The dimensions a line draws from: how many brands, and — for each of its
 * products — how many flavours, grades, sizes and packs. A pack its kind
 * lists twice is drawn twice as often, so the PACK list keeps its repeats.
 */
function lineParts(line) {
  return {
    brands: line.brands,
    packs: line.packs,
    products: line.products.map((p) => ({ ...p, distinctPacks: new Set(line.packs).size })),
  };
}

/** How many distinct products a line can form at most. */
export function lineCapacity(line) {
  const packs = new Set(line.packs).size;
  return line.brands.length * line.products.reduce((n, p) => n + p.flavours.length * p.grades.length * p.sizes.length, 0) * packs;
}

/**
 * The words of a text — lower-cased, singular ("Hammers" covers "Claw
 * Hammer"), kind names split at their humps — without the packing words
 * ("Family Pack", "Value Size") that say nothing about what a product is.
 */
const FILLER = new Set(['pack', 'family', 'value', 'variety', 'original', 'classic', 'premium', 'size', 'count', 'set', 'with', 'mini', 'large', 'small', 'jumbo', 'giant', 'regular', 'party', 'light']);
const words = (s) =>
  new Set(
    (String(s).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().match(/[a-z0-9]+/g) ?? [])
      .filter((w) => w.length > 2)
      .map((w) => w.replace(/s$/, ''))
      .filter((w) => !FILLER.has(w))
  );

/** A fast integer hash — deterministic across engines (pure 32-bit arithmetic). */
const mix = (x) => {
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  return (x ^ (x >>> 15)) >>> 0;
};

/** A 53-bit draw from a counter and a seed — enough to span any line's space. */
const draw53 = (k, seed) => mix(Math.imul(k, 2654435761) + Math.imul(seed + 1, 40503)) * 2 ** 21 + (mix(Math.imul(k, 1597334677) ^ Math.imul(seed + 7, 39916801)) >>> 11);

/**
 * The products a line has drawn so far, and a way to draw more. A product is
 * picked by decoding a hashed counter into a brand, flavour, grade, size and
 * pack — nothing bigger than one product is ever built — so the first few
 * hundred already span every brand, product and size instead of running
 * through one product at a time. `taken` is the department's names so far:
 * a name already used by another row of the department is passed over.
 */
function lineSampler(line, seed, taken, count, row = 0) {
  const products = line.products.map((p) => {
    const space = p.flavours.length * p.grades.length * p.sizes.length * line.packs.length;
    return { ...p, space };
  });
  const formSpace = products.reduce((n, p) => n + p.space, 0);
  const brands = line.brands;
  const space = brands.length * formSpace;
  const capacity = lineCapacity(line);
  const [lo, hi] = line.price;
  const drawn = [];
  const limit = Math.min(count, capacity);
  for (let k = 0; drawn.length < limit && k < space * 8 + limit * 40; k++) {
    const pick = draw53(k, seed) % space;
    const brand = brands[pick % brands.length];
    let rest = Math.floor(pick / brands.length);
    const product = products.find((p) => (rest -= p.space) < 0);
    rest += product.space;
    const flavour = product.flavours[rest % product.flavours.length];
    rest = Math.floor(rest / product.flavours.length);
    const grade = product.grades[rest % product.grades.length];
    rest = Math.floor(rest / product.grades.length);
    const size = product.sizes[rest % product.sizes.length];
    const pack = line.packs[Math.floor(rest / product.sizes.length) % line.packs.length];
    const name = [brand, flavour, product.base, grade, size, pack].filter(Boolean).join(" ");
    if (taken.has(name)) continue; // drawn before — by this row or another — so draw again
    taken.add(name);
    drawn.push({ name, category: "", brand, pack, row, price: priceOf(lo, hi, brand, name, pack, sizeRank(product, size)) });
  }
  return drawn;
}

/** The leading number of a size ("50 ft", "6 qt", "100-Count"), or null when it has none. */
const sizeNumber = (size) => {
  const m = /^(\d+(?:[.,]\d+)?)/.exec(size);
  return m ? Number(m[1].replace(",", "")) : null;
};

/**
 * Where a size sits among its product's sizes, 0 (smallest) to 1 (largest);
 * half when no size of the product carries a number ("Black", "Pint").
 */
function sizeRank(product, size) {
  const top = Math.max(0, ...product.sizes.map(sizeNumber).filter((n) => n !== null));
  const own = sizeNumber(size);
  return top > 0 && own !== null ? Math.min(1, own / top) : 0.5;
}

/**
 * A price inside the line's range, fixed by the product's brand and name: a
 * larger size costs more than a small one, and a multipack more than a single.
 */
function priceOf(lo, hi, brand, name, pack, size) {
  let h = 2166136261;
  for (const ch of `${brand}|${name}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const draw = (mix(h) % 1000) / 1000;
  const single = (0.25 + 0.55 * size) * (0.75 + 0.5 * draw);
  const rank = pack ? 0.5 + 0.5 * draw : Math.min(0.8, single);
  return Math.round((lo + rank * (hi - lo)) * 100) / 100;
}

/**
 * Each row's share of a department's quota, in proportion to its reach and
 * never more than it can form: what a full row cannot take goes to the others.
 */
function shareOut(rows, quota) {
  const reach = rows.map(lineCapacity);
  const counts = reach.map(() => 0);
  let open = reach.map((_, i) => i).filter((i) => reach[i] > 0);
  let left = quota;
  while (left > 0 && open.length) {
    const shares = apportion(left, Object.fromEntries(open.map((i) => [i, reach[i] - counts[i]])));
    open = open.filter((i) => {
      const add = Math.min(shares[i], reach[i] - counts[i]);
      counts[i] += add;
      left -= add;
      return counts[i] < reach[i];
    });
  }
  if (left > 0) {
    const most = reach.reduce((n, m) => n + m, 0);
    throw new Error(`its product rows can form at most ${most} of the ${quota} SKUs asked for`);
  }
  return counts;
}

/**
 * The generated SKUs that top a store up to its total. Deterministic. The
 * products carry a name, their department (category) and a real brand — and
 * no photo; `byCategory` maps a department to its products' indexes.
 */
export function generateCatalog(slug, baseCount) {
  const lines = LINES[slug];
  const shares = STORE_SHARES[slug];
  if (!lines || !shares) throw new Error(`No generated catalogue for "${slug}"`);
  const total = STORE_TOTALS[slug] - baseCount;
  if (total <= 0) throw new Error(`${slug}: its demo items already fill the catalogue total`);

  const products = [];
  const byCategory = {};
  const departments = Object.entries(apportion(total, shares));
  for (const [di, [category, quota]] of departments.entries()) {
    const rowsOf = lines[category];
    if (!rowsOf) throw new Error(`${slug}: no product rows for "${category}"`);
    const taken = new Set();
    let rows = [];
    try {
      shareOut(rowsOf, quota).forEach((count, fi) => {
        rows.push(...lineSampler(rowsOf[fi], fi + di * 101, taken, count, fi).map((made) => ({ ...made, category })));
      });
    } catch (err) {
      throw new Error(`${slug}, "${category}": ${err.message}`);
    }
    if (rows.length !== quota) throw new Error(`${slug}: "${category}" drew ${rows.length} of its ${quota} SKUs`);
    // brand-blocked, like a real planogram: the same brand's items sit together
    rows.sort((a, b) => a.brand.localeCompare(b.brand) || a.name.localeCompare(b.name));
    byCategory[category] = rows.map((_, i) => products.length + i);
    products.push(...rows);
  }
  return { products, byCategory, total: products.length };
}

/**
 * Add a store's generated SKUs to a spec being built: `products` is the
 * spec's product list so far (its demo items), `poolByCat` maps a department
 * to the indexes of its products so far. Returns how many were added.
 */
export function topUpCatalog(slug, products, poolByCat) {
  const { products: generated, byCategory } = generateCatalog(slug, products.length);
  const base = products.length;
  for (const row of generated) products.push(row);
  for (const [category, indexes] of Object.entries(byCategory)) {
    if (!poolByCat[category]) throw new Error(`${slug}: the spec has no department "${category}"`);
    poolByCat[category].push(...indexes.map((i) => base + i));
  }
  return generated.length;
}

/**
 * A real brand of a department for one of its original hand-picked demo
 * items — cycling through the department's brands, so neighbouring items on
 * a shelf read as different makes.
 */
export function brandFor(slug, category, index) {
  const brands = [...new Set((LINES[slug]?.[category] ?? []).flatMap((line) => line.brands))];
  if (!brands.length) throw new Error(`No brands for "${category}" in ${slug}`);
  return brands[index % brands.length];
}

/* ══════════════════════════════════════════════════════════════════════════
   Stocking the generated catalogue
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Bumped whenever a spec's layout or SKU scheme changes in a way that only a
 * rebuild can deliver. Both seeders keep the version they laid out under
 * `seed:layout:<slug>` and rebuild a present store when it differs — which is
 * also what retires a loaded catalogue (its rows go with the rebuild).
 */
export const LAYOUT_VERSION = 3;

/** A loaded catalogue is recorded in app_settings under this key. */
export const catalogKey = (slug) => `seed:catalog:${slug}`;
export const layoutKey = (slug) => `seed:layout:${slug}`;

/**
 * A bulk facing is told apart by its place along the shelf: a generated item
 * carries `u` (0..1 from the left end), a hand-placed one does not.
 */
export const isBulkFacing = (meta) => typeof meta?.u === 'number';

/** Only a store's own (hand-placed) facings — what a layout rebuild replaces. */
export const OWNED_FACINGS = "json_extract(meta, '$.u') IS NULL";

/** A stable id for a generated row, so reloading a catalogue is idempotent. */
function stableId(key) {
  const h = createHash('sha256').update(key).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** The shelf a facing belongs to, in spec order (the order the seeders write elements). */
export function specShelves(spec) {
  const shelves = [];
  spec.elements.forEach((e, index) => {
    if (e.type !== 'shelf' || e.shape !== 'rect') return;
    const g = e.geometry;
    const m = e.meta ? JSON.parse(e.meta) : {};
    // how many boards it is drawn with — its own count, else the app's default
    // (frontend/src/lib/shelfLayout.ts, DEFAULT_LEVELS): the catalogue stocks all of them
    const levels = Number.isFinite(m.levels) ? Math.min(8, Math.max(1, Math.round(m.levels))) : 4;
    shelves.push({ index, department: m.department ?? '', label: e.label, x: g.x + g.w / 2, y: g.y + g.h / 2, levels });
  });
  return shelves;
}

/**
 * Stock one shelf, column by column. Its products go to the boards in order —
 * brand-blocked — one facing per column. One product in six faces twice,
 * stacked in the same column on a neighbouring board (the board's partner:
 * the one above an odd board, below an even one), which is how shelves are
 * really stacked. Every board ends up with as many facings as the others, so
 * they share the same columns: none is squeezed or overlaps, and each runs
 * the whole length of the shelf.
 */
function stockShelf(shelf, products, place) {
  const boards = shelf.levels;
  const n = products.length;
  // every sixth product faces twice — spread over every brand alike
  const stacked = (j) => j % 6 === 0;
  const partner = (b) => (b === boards ? boards - 1 : b % 2 === 1 ? b + 1 : b - 1);
  const columns = Math.max(1, Math.ceil((n + Math.ceil(n / 6)) / boards));

  // where each board's own products begin. A board holds enough of its own
  // that, with the twins it is sent, it fills every column — what it is sent
  // depends on where the boards divide, so this settles over a few passes.
  let start = Array.from({ length: boards + 1 }, (_, b) => Math.round((n * b) / boards));
  for (let pass = 0; pass < 8; pass++) {
    // (a board that is its own partner — one board alone — receives what it sends)
    const sent = Array.from({ length: boards }, (_, b) => {
      let count = 0;
      for (let j = start[b]; j < start[b + 1]; j++) if (stacked(j)) count++;
      return count;
    });
    const own = Array.from({ length: boards }, (_, b) => Math.max(0, columns - sent[partner(b + 1) - 1]));
    // rounding gave the boards more than the shelf holds: the last ones give it back
    let spare = own.reduce((a, b) => a + b, 0) - n;
    for (let b = boards - 1; spare > 0 && b >= 0; b--) {
      const give = Math.min(spare, own[b]);
      own[b] -= give;
      spare -= give;
    }
    start = [0];
    for (const count of own) start.push(start[start.length - 1] + count);
  }
  // what each board holds of its own, in order; `twin` is the board the same product is stacked on
  const held = start.slice(0, -1).map((from, b) =>
    products.slice(from, start[b + 1]).map((product, i) => {
      const j = from + i;
      return { product, twin: stacked(j) ? partner(b + 1) : 0 };
    })
  );
  const fullest = Math.max(1, ...held.map((board, b) => board.length + held.reduce((n2, other) => n2 + other.filter((it) => it.twin === b + 1).length, 0)));
  const next = held.map(() => 0);
  for (let col = 0; next.some((at, b) => at < held[b].length); col++) {
    const taken = held.map(() => false);
    // first the products that face twice: their own board, and the one they are stacked on.
    // A board whose next such product cannot go in this column (a twin already
    // took the other board's slot) takes the nearest of its next few that can,
    // so that no slot is left empty
    for (let b = 0; b < boards; b++) {
      const fits = (at) => !taken[b] && !taken[held[b][at].twin - 1];
      if (next[b] >= held[b].length || taken[b] || !held[b][next[b]].twin || !fits(next[b])) {
        const nearer = [next[b] + 1, next[b] + 2, next[b] + 3].find((at) => at < held[b].length && held[b][at].twin && fits(at));
        if (nearer == null) continue;
        [held[b][next[b]], held[b][nearer]] = [held[b][nearer], held[b][next[b]]];
      }
      const it = held[b][next[b]];
      taken[b] = true;
      place(it.product, b + 1, col);
      taken[it.twin - 1] = true;
      place(it.product, it.twin, col);
      next[b]++;
    }
    // then the rest, one facing each
    for (let b = 0; b < boards; b++) {
      const it = held[b][next[b]];
      if (!it || taken[b] || it.twin) continue;
      taken[b] = true;
      place(it.product, b + 1, col);
      next[b]++;
    }
  }
  return fullest;
}

export function bulkCatalog(slug, spec) {
  const shelves = specShelves(spec);
  const byDept = new Map();
  for (const shelf of shelves) byDept.set(shelf.department, [...(byDept.get(shelf.department) ?? []), shelf]);
  const { products, byCategory } = generateCatalog(slug, spec.products.length);
  const base = spec.products.length;
  const pad = spec.skuPad ?? 3;

  const rows = [];
  const locations = [];
  for (const [category, indexes] of Object.entries(byCategory)) {
    const mine = byDept.get(category);
    if (!mine?.length) throw new Error(`${slug}: "${category}" has no shelf to stock`);
    // A department with several shelves sends each product line to the shelf
    // whose title describes it ("Potato Chips" → "Chips & Savoury Snacks"),
    // so a shelf holds one sort of thing, brand-blocked. The catalogue's
    // order (by brand) is kept within each shelf.
    const shelfOf = shelfForProducts(slug, category, LINES[slug][category], mine, indexes, products);
    const run = mine.map(() => []);
    indexes.forEach((product, i) => run[shelfOf[i]].push(product));
    // no shelf may be left empty: one that is takes a brand block (the last
    // brands) off the fullest shelf
    for (let guard = 0; guard < mine.length && run.some((r) => !r.length); guard++) {
      const to = run.findIndex((r) => !r.length);
      const empties = run.filter((r) => !r.length).length;
      const from = run.reduce((best, r, si) => (si !== to && r.length > 1 && (best < 0 || r.length > run[best].length) ? si : best), -1);
      if (from < 0) break;
      run[to] = run[from].splice(Math.max(1, run[from].length - Math.ceil(run[from].length / (empties + 1))));
    }
    mine.forEach((shelf, si) => {
      // `place` gets columns; they become places along the shelf once its count is known
      const facings = [];
      const columns = stockShelf(shelf, run[si], (product, level, col) => facings.push({ product, level, col }));
      for (const f of facings) {
        locations.push({
          product: base + f.product, shelf: shelf.index, x: shelf.x, y: shelf.y, level: f.level,
          u: Math.round(((f.col + 0.5) / columns) * 1e6) / 1e6,
        });
      }
    });
  }
  products.forEach((p, i) => rows.push({ ...p, id: stableId(`${slug}:p${base + i}`), sku: `${spec.skuPrefix}-${String(base + i + 1).padStart(pad, '0')}` }));
  // the board is part of the key: a product facing twice is stacked in one column, on two boards
  for (const l of locations) l.id = stableId(`${slug}:l:${l.product}:${l.shelf}:${l.level}:${l.u}`);
  return { products: rows, locations };
}

/** A bulk facing's stored meta — `shelfId` is the shelf element's database id. */
export function facingMeta(facing, shelfId) {
  return { shelfId, shelf_level: facing.level, w: 1, groupOnly: 1, u: facing.u };
}

/**
 * The shelf (index into `shelves`) each of a department's products is
 * stocked on. A product goes to the shelf whose title — plus the extra words
 * SHELF_WORDS gives a title — shares the most words with what it is: its
 * name and its line's product and kind ("BEHR Satin Interior Paint" →
 * "Interior Paint"). Where PICKS names its kind, there. Two titles that
 * describe a product equally: the emptier of them takes it. A product no title
 * describes follows its line — the shelf most of the line went to — else the
 * shelf with the fewest products so far, so the shelves stay about as full.
 */
export function shelfForProducts(slug, category, lines, shelves, indexes, products) {
  if (shelves.length === 1) return indexes.map(() => 0);
  // a shelf as the tables name it: by its title, or — the older tables — by its index
  const shelfNamed = (ref) => (typeof ref === "number" ? ref : shelves.findIndex((shelf) => shelf.label === ref));
  const wordsOf = shelves.map(() => []);
  for (const [key, list] of Object.entries(SHELF_WORDS[slug]?.[category] ?? {})) {
    const si = shelfNamed(/^\d+$/.test(key) ? Number(key) : key);
    if (si < 0) throw new Error(`${slug}, "${category}": extra words name a shelf that is not one of the department's ("${key}")`);
    wordsOf[si].push(...list);
  }
  const labels = shelves.map((shelf, si) => new Set([...words(shelf.label), ...wordsOf[si].flatMap((x) => [...words(x)])]));
  const picks = SHELF_PICKS[slug]?.[category] ?? {};
  const lineWords = lines.map((line) => new Set([...words(line.products[0].base ?? ''), ...words(line.kind ?? '')]));
  // what each product scores against every shelf: everything for its pick, else
  // how many words the shelf's title (and extra words) share with what the
  // product is — its own name counting for more than its line's kind name, so a
  // line called "saladGreens" does not pull every Swiss Chard toward "Salad Bar"
  const scores = indexes.map((product) => {
    const row = products[product].row;
    const picked = picks[lines[row].kind];
    if (picked != null) {
      const si = shelfNamed(picked);
      if (si < 0 || si >= shelves.length) throw new Error(`${slug}, "${category}": "${lines[row].kind}" is picked for a shelf that is not one of the department's ("${picked}")`);
      return labels.map((_, j) => (j === si ? Infinity : 0));
    }
    const own = new Set(words(products[product].name));
    return labels.map((label) => [...label].reduce((n, w) => n + (own.has(w) ? 10 : lineWords[row].has(w) ? 1 : 0), 0));
  });
  const load = shelves.map(() => 0);
  const chosen = scores.map((score) => {
    const best = Math.max(...score);
    if (best === 0) return -1; // no title describes it — settled below
    // two titles describing a product equally: the emptier of them takes it
    let si = -1;
    score.forEach((s, j) => { if (s === best && (si < 0 || load[j] < load[si])) si = j; });
    load[si] += 1;
    return si;
  });
  // where each line's described products went
  const described = new Map(); // row → per shelf
  indexes.forEach((product, i) => {
    if (chosen[i] < 0) return;
    const row = products[product].row;
    const tally = described.get(row) ?? shelves.map(() => 0);
    tally[chosen[i]] += 1;
    described.set(row, tally);
  });
  // A product no title describes follows its line — the shelf most of the
  // line's described products went to — else the shelf with the fewest
  // products so far, so the shelves stay about as full.
  indexes.forEach((product, i) => {
    if (chosen[i] >= 0) return;
    const tally = described.get(products[product].row);
    const fullest = tally ? Math.max(...tally) : 0;
    const shelf = fullest > 0 ? tally.indexOf(fullest) : load.indexOf(Math.min(...load));
    chosen[i] = shelf;
    load[shelf] += 1;
  });
  return chosen;
}

/** Words a shelf's title does not say but its shelf holds (shelf → words), for
 *  titles too terse to match by. A Walmart shelf is named by its title; a Home
 *  Depot one by its index among its department's shelves, in spec order. */
const SHELF_WORDS = {
  "home-depot-example": {
    Lumber: { 1: ["plywood", "osb", "mdf", "particle", "hardboard", "panel", "sheathing"] },
    Paint: { 0: ["interior"], 1: ["exterior", "stain", "deck", "waterproof", "sealer", "primer"] },
    Appliances: { 0: ["refrigerator", "range", "oven", "dishwasher", "cooktop", "freezer"], 1: ["washer", "dryer", "laundry", "microwave", "compact"] },
    Plumbing: { 0: ["pipe", "fitting", "elbow", "tee", "coupling", "adapter", "nipple", "union", "flange", "valve"], 1: ["faucet", "sink", "toilet", "shower", "tub", "drain", "tank"] },
    "Lawn & Garden": { 0: ["fertilizer", "weed", "seed", "soil", "mulch", "compost", "insect"], 1: ["mower", "trimmer", "blower", "chainsaw", "tiller", "edger"], 2: ["hose", "sprinkler", "watering", "planter", "bird", "pruner", "shovel", "rake", "trowel", "gloves", "shears"] },
  },
  "walmart-example": {
    // one kind of product split between shelves by what it is
    "Meat & Seafood": {
      "Ground Meat & Pork": ["stew", "patties", "tips", "liver", "oxtails", "soup", "bones", "corned", "shoulder"],
      "Steaks & Roasts": ["ribeye", "sirloin", "strip", "filet", "mignon", "brisket", "flank", "skirt", "tenderloin", "tri-tip", "ribs", "bavette", "hanger", "coulotte", "picanha", "denver"],
    },
    "Fresh Produce": {
      "Melons & Citrus": ["watermelon", "cantaloupe", "honeydew", "melon", "orange", "grapefruit", "lemon", "lime", "tangerine", "clementine", "mandarin", "satsuma", "kumquat", "pomelo", "tangelo"],
      "Berries & Grapes": ["strawberries", "blueberries", "raspberries", "blackberries", "cranberries", "boysenberries"],
      "Avocados & Exotics": ["banana", "mangoes", "pineapple", "papaya", "coconut", "plantain", "kiwi", "dragon fruit", "passion fruit", "guava", "starfruit", "pomegranate", "lychee"],
      "Lettuce & Spinach": ["romaine", "iceberg", "spring mix", "arugula", "kale", "chard", "endive", "escarole", "radicchio", "watercress", "mesclun", "cabbage", "hearts", "power"],
      "Salad Bar": ["salad kit", "garden salad", "coleslaw", "slaw"],
      "Broccoli, Cauliflower & Vegetables": ["celery", "asparagus", "beans", "snap peas", "brussels sprouts", "artichokes", "leeks"],
      "Tomatoes & Peppers": ["cucumber", "zucchini", "squash", "eggplant", "grape"],
      "Root Vegetables": ["carrots", "radishes", "beets", "garlic", "shallots"],
    },
    "Pet Care": {
      "Dog Food & Treats": ["dental chews", "dog treats"],
      "Cat Food & Litter": ["cat treats"],
    },
    "Toys & Games": {
      "Toys": ["action figure", "doll", "building set", "plush", "stuffed animal", "robot", "dinosaur", "car", "truck", "train", "playset", "STEM", "learning", "musical", "bath", "baby", "pretend", "dress-up", "collectible"],
      "Ride-Ons & Outdoor Toys": ["remote control", "RC", "vehicle", "blaster", "ride-on"],
    },
    "Seasonal": {
      "Seasonal & Holiday": ["tree", "light", "advent", "calendar", "candy", "basket", "egg", "card", "wrap"],
      "Seasonal Décor": ["ornament", "wreath", "garland", "stocking", "tree skirt", "tree topper", "nativity", "nutcracker", "snow globe", "village", "inflatable", "decoration", "figurine"],
    },
    "Celebrate": {
      "Party & Celebrate": ["balloon", "gift wrap", "wrapping paper", "gift bag", "tissue paper", "gift box", "bow", "ribbon", "banner", "candle", "confetti", "streamer", "tablecloth", "napkin"],
    },
  },
};

/** kind → the shelf it is picked for, written a shelf at a time. */
const on = (title, kinds) => Object.fromEntries(kinds.map((kind) => [kind, title]));

/** Where a kind of product is shelved when a department's shelf titles don't
 *  say — or say it for several at once. A Walmart shelf is named by its title
 *  (it survives the layout being drawn again); a Home Depot one by its index
 *  among its department's shelves, in spec order. Where PICKS names its kind,
 *  there. */
const SHELF_PICKS = {
  "home-depot-example": {
    "Lawn & Garden": { lawnCare: 0, mower: 1, hose: 2 },
  },
  "walmart-example": {
    "Dairy & Cheese": {
      ...on("Milk & Cream", ["milk", "cream", "creamer"]),
      ...on("Yogurt & Cheese", ["yogurt", "greekYogurt", "softCheese", "sourCream", "creamCheese", "shreddedCheese", "blockCheese", "slicedCheese", "stringCheese"]),
      ...on("Butter, Eggs & Cream", ["butter", "spread", "eggs", "eggProduct"]),
    },
    "Deli & Cheese": {
      ...on("Deli Counter", ["deliSalad", "hummus", "dip"]),
      ...on("Deli Cases", ["bacon", "hotDog", "breakfastSausage", "smokedSausage"]),
      ...on("Sliced Meats & Cheese", ["deliMeat", "deliCheese"]),
    },
    "Adult Beverages": {
      ...on("Beer", ["lagerBeer", "lightBeer", "ale"]),
      ...on("Wine", ["redWine", "whiteWine", "sparkling"]),
      ...on("Spirits", ["vodka", "bourbon", "scotch", "canadian", "irish", "tennessee", "flavoredWhiskey", "tequila", "rum", "gin", "cognac", "brandy"]),
      ...on("Chilled Wine & Seltzer", ["seltzer", "cocktail", "hardTea", "hardLemonade"]),
    },
    "Snacks & Candy": {
      ...on("Tortilla Chips & Salsa", ["tortilla"]),
      ...on("Chips & Pretzels", ["chips", "cornChips", "cheesePuffs", "pretzels", "popcornRTE", "popcornMicro", "porkRinds", "veggieStraws", "pitaChips"]),
      ...on("Candy & Chocolate", ["chocolateBar", "boxedChocolates", "pbCups", "candyBar", "caramels", "gummy", "hardCandy", "chewyCandy", "jellyBeans", "licorice", "lollipop", "gum", "mints"]),
      ...on("Nuts, Jerky & Trail Mix", ["nuts", "trailMix", "jerky", "meatSticks", "driedFruit"]),
      ...on("Cookies & Crackers", ["chocolateChipCookies", "sandwichCookies", "cookies", "crackers", "cheeseCrackers", "butterCrackers", "grahamCrackers", "sandwichCrackers"]),
      ...on("Snack Cakes & Bars", ["snackCakes", "riceCakes", "snackMix", "granolaBars", "proteinBars"]),
    },
    "Breakfast & Coffee": {
      ...on("Coffee", ["groundCoffee", "kcup", "instantCoffee"]),
      ...on("Tea & Hot Cocoa", ["teaBags", "cocoa"]),
      ...on("Oatmeal & Breakfast", ["hotCereal", "grits", "granola", "cerealBars", "breakfastBiscuits", "toasterPastries", "donuts", "muffins", "bagels"]),
      ...on("Cereal", ["coldCereal"]),
    },
    "Pantry": {
      ...on("Tomatoes, Broth & Chili", ["broth", "chili", "pastaSauce"]),
      ...on("Pasta & Noodles", ["pasta", "macCheese", "pastaMix", "tacoKit"]),
      ...on("Baking, Flour & Sugar", ["flour", "sugar", "cakeMix", "brownieMix", "bakingChips", "marshmallows", "leavening", "starch", "yeast", "cocoaPowder", "cornSyrup", "foodColoring", "sprinkles", "molasses", "gelatin", "pudding", "cannedMilk"]),
      ...on("Condiments & Sauces", ["ketchup", "mustard", "mayo", "pickles", "olives", "hotSauce", "bbqSauce", "steakSauce", "soySauce", "dressing", "gravy", "vinegar"]),
      ...on("Spices & Extracts", ["spices", "salt", "extract", "extractNutty"]),
      ...on("Oils & Cooking Sprays", ["oliveOil", "oil", "cookingSpray", "shortening"]),
      ...on("Peanut Butter & Spreads", ["peanutButter", "jam", "syrup", "honey"]),
      ...on("Canned Vegetables & Fruit", ["cannedVeg", "cannedBeans", "cannedFruit"]),
      ...on("Canned Soup & Meals", ["soup", "cannedPasta", "tuna", "cannedChicken"]),
      ...on("Bulk Foods", ["rice", "dryBeans", "tortillas", "stuffing", "instantPotato"]),
    },
    "Bakery": {
      ...on("Bakery Bread & Rolls", ["bread", "buns", "englishMuffins", "flat", "rolls", "bagels"]),
      ...on("Donuts, Cakes & Pastries", ["pie", "coffeeCake", "croissant", "cookies", "donuts", "muffins"]),
    },
    "Meat & Seafood": {
      ...on("Family Pack Meat", ["pork", "ham", "meatballs"]),
      ...on("Service Meat & Seafood", ["salmon", "scallops", "crab"]),
      ...on("Seafood & Shellfish", ["shrimp", "fish"]),
    },
    "Frozen": {
      ...on("Frozen Pizza & Meals", ["frozenPizza"]),
      ...on("Ice Cream & Novelties", ["iceCream", "frozenTreats", "frozenDessert"]),
      ...on("Frozen Breakfast & Bread", ["frozenBreakfast"]),
      ...on("Frozen Vegetables & Fruit", ["frozenVeg", "frozenFruit", "frozenPotato"]),
      ...on("Frozen Meat & Seafood", ["frozenChicken"]),
      ...on("Frozen Family Meals", ["frozenMeal", "frozenApps"]),
    },
    "Drinks": {
      ...on("Iced Tea & Lemonade", ["rtdTea", "lemonade"]),
      ...on("Fresh Juices & Cut Fruit", ["juice", "juiceBox", "vegJuice"]),
      ...on("Water & Sports Drinks", ["water", "sparklingWater", "sportsDrink", "coconutWater", "kombucha"]),
      ...on("Soda & Energy Drinks", ["cola", "lemonLime", "citrusSoda", "rootBeer", "gingerAle", "fruitSoda", "energyDrink"]),
      ...on("Coffee & Smoothie Bar", ["rtdCoffee"]),
    },
    "Fresh Produce": {
      ...on("Melons & Citrus", ["citrus", "melons"]),
      ...on("Berries & Grapes", ["berries", "grapes"]),
      ...on("Apples & Pears", ["treeFruit"]),
      ...on("Avocados & Exotics", ["tropical"]),
      ...on("Herbs & Aromatics", ["herbs"]),
    },
    "Paper & Cleaning": {
      ...on("Cleaners & Air Care", ["cleaners", "wipes", "sponges", "airFresh"]),
      ...on("Dish & Dishwasher", ["dishSoap", "dishwasher"]),
      ...on("Laundry & Fabric Care", ["laundryDetergent", "fabricCare"]),
      ...on("Paper Plates & Cups", ["paperPlates"]),
      ...on("Paper Towels & Bath Tissue", ["paperTowels", "bathTissue", "facialTissue"]),
      ...on("Trash Bags & Food Storage", ["trashBags", "foodStorage"]),
    },
    "Personal Care": {
      ...on("Cosmetics & Beauty", ["cosmetics", "femCare", "cotton"]),
      ...on("Hair & Skin Care", ["shampoo", "conditioner", "bodyWash", "barSoap", "lotion", "sunscreen", "shave", "hairCare"]),
      ...on("Oral Care & Deodorant", ["deodorant", "toothpaste", "oralCare"]),
    },
    "Baby": {
      ...on("Diapers & Wipes", ["diapers", "babyWipes"]),
      ...on("Formula & Baby Food", ["formula", "babyFood"]),
      ...on("Baby Bath & Care", ["babyCare"]),
    },
    "Pet Care": {
      ...on("Cat Food & Litter", ["catLitter"]),
      ...on("Pet Supplies", ["petCare"]),
    },
    "Home & Bedding": {
      ...on("Bedding", ["sheetSet", "comforter", "pillow", "mattressPad", "curtain"]),
      ...on("Bath & Towels", ["towel"]),
      ...on("Storage & Organization", ["storage", "laundryDetergent", "fabricCare", "officeFurniture", "airFresh"]),
    },
    "Kitchen & Dining": {
      ...on("Small Appliances", ["smallAppliance"]),
      ...on("Kitchen Tools & Gadgets", ["cutlery", "gadgets"]),
      ...on("Cookware & Bakeware", ["cookware", "bakeware"]),
      ...on("Food Storage & Containers", ["kitchenStorage"]),
      ...on("Dinnerware & Drinkware", ["dinnerware", "drinkware", "flatware"]),
    },
    "Electronics": {
      ...on("TV & Audio", ["tv", "headphones", "speaker"]),
      ...on("Computers & Mobile", ["device"]),
      ...on("Batteries & Accessories", ["charger", "battery"]),
    },
    "Sports & Outdoors": {
      ...on("Camping & Outdoors", ["camp", "bike"]),
      ...on("Sports & Fitness", ["sportGear", "fitness"]),
    },
    "Tools & Hardware": {
      ...on("Tools & Hardware", ["powerTool", "handTool", "tape", "ladder"]),
      ...on("Hardware & Fasteners", ["fastener", "adhesive", "storage"]),
    },
    "Outdoor & Garden": {
      ...on("Patio & Garden", ["hose", "lawnCare", "mower", "patioSet", "stringLights"]),
      ...on("Floral", ["planter", "seeds", "birdFeeder"]),
    },
  },
};

/** The record that a store's catalogue is loaded, kept in app_settings. */
export function catalogMarker(slug, spec) {
  const { products, locations } = bulkCatalog(slug, spec);
  return JSON.stringify({
    products: spec.products.length + products.length,
    fromSku: products[0]?.sku ?? '',
    locations: locations.length,
    version: CATALOG_VERSION,
  });
}

/**
 * A real brand for each of a spec's hand-picked demo items whose name matches
 * one of its department's product lines — by the line's product ("Greek
 * Yogurt 500g" → the Greek yogurt makers) or by a product the line lists
 * among its flavours or grades ("Cordless Drill 18V" → the drill makers);
 * the line covering the most of the item's name wins. An item no line covers keeps the brand it was written with.
 */
export function withRealBrands(slug, spec) {
  const lines = LINES[slug];
  spec.products.forEach((p, i) => {
    const rows = lines?.[p.category];
    if (!rows) return;
    const name = words(p.name);
    let best = null;
    let bestScore = 0;
    for (const line of rows) {
      const { base, flavours, grades } = line.products[0] ?? {};
      const covers = new Set([...words(base ?? ''), ...words(grades ?? ''), ...words((flavours ?? []).join(' '))]);
      const score = [...name].filter((w) => covers.has(w)).length;
      if (score > bestScore) {
        best = line;
        bestScore = score;
      }
    }
    if (best) p.brand = best.brands[i % best.brands.length];
  });
  return spec;
}
