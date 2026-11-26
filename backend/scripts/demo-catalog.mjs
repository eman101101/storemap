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

/** Bump when the generated catalogue should be reloaded (lines, totals, naming). */
export const CATALOG_VERSION = 2;

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
export const LAYOUT_VERSION = 2;

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
 * "Interior Paint"). Where PICKS names its kind, there. A product no title
 * describes (or that two titles describe equally) follows its line, else the
 * shelf with the fewest products so far, so the shelves stay about as full.
 */
function shelfForProducts(slug, category, lines, shelves, indexes, products) {
  if (shelves.length === 1) return indexes.map(() => 0);
  const labels = shelves.map((shelf, si) => new Set([...words(shelf.label), ...(SHELF_WORDS[slug]?.[category]?.[si] ?? []).flatMap((x) => [...words(x)])]));
  const picks = SHELF_PICKS[slug]?.[category] ?? {};
  const lineWords = lines.map((line) => new Set([...words(line.products[0].base ?? ''), ...words(line.kind ?? '')]));
  const chosen = indexes.map((product) => {
    const row = products[product].row;
    if (picks[lines[row].kind] != null) return picks[lines[row].kind];
    const sold = new Set([...words(products[product].name), ...lineWords[row]]);
    let best = -1;
    let bestScore = 0;
    let tied = false;
    labels.forEach((label, si) => {
      const score = [...label].filter((w) => sold.has(w)).length;
      if (score > bestScore) {
        best = si;
        bestScore = score;
        tied = false;
      } else if (score === bestScore && score > 0) tied = true;
    });
    return tied ? -1 : best;
  });
  // the shelf each line's described products went to, where they agree on one
  const lineShelf = new Map();
  indexes.forEach((product, i) => {
    if (chosen[i] < 0) return;
    const row = products[product].row;
    if (!lineShelf.has(row)) lineShelf.set(row, chosen[i]);
    else if (lineShelf.get(row) !== chosen[i]) lineShelf.set(row, -1);
  });
  const load = shelves.map((_, si) => chosen.filter((c) => c === si).length);
  indexes.forEach((product, i) => {
    if (chosen[i] >= 0) return;
    const own = lineShelf.get(products[product].row) ?? -1;
    const shelf = own >= 0 ? own : load.indexOf(Math.min(...load));
    chosen[i] = shelf;
    load[shelf] += 1;
  });
  return chosen;
}

/** Words a shelf's title does not say but its shelf holds (shelf index → words), for titles too terse to match by. */
const SHELF_WORDS = {
  "home-depot-example": {
    Lumber: { 1: ["plywood", "osb", "mdf", "particle", "hardboard", "panel", "sheathing"] },
    Paint: { 0: ["interior"], 1: ["exterior", "stain", "deck", "waterproof", "sealer", "primer"] },
    Appliances: { 0: ["refrigerator", "range", "oven", "dishwasher", "cooktop", "freezer"], 1: ["washer", "dryer", "laundry", "microwave", "compact"] },
    Plumbing: { 0: ["pipe", "fitting", "elbow", "tee", "coupling", "adapter", "nipple", "union", "flange", "valve"], 1: ["faucet", "sink", "toilet", "shower", "tub", "drain", "tank"] },
    "Lawn & Garden": { 0: ["fertilizer", "weed", "seed", "soil", "mulch", "compost", "insect"], 1: ["mower", "trimmer", "blower", "chainsaw", "tiller", "edger"], 2: ["hose", "sprinkler", "watering", "planter", "bird", "pruner", "shovel", "rake", "trowel", "gloves", "shears"] },
  },
  "walmart-example": {
    "Toys & Games": { 1: ["game", "puzzle", "board", "card"] },
    "Outdoor & Garden": { 0: ["lawn", "mower", "fertilizer", "weed"], 1: ["patio", "lights", "string"], 2: ["garden", "bird", "hose", "planter", "seeds"] },
  },
};

/** Where a kind of product is shelved when a department's shelf titles don't say (shelf index in spec order). */
const SHELF_PICKS = {
  "home-depot-example": {
    "Lawn & Garden": { lawnCare: 0, mower: 1, hose: 2 },
  },
  "walmart-example": {
    "Snacks & Candy": { candyBar: 1, chocolateBar: 1, boxedChocolates: 1, pbCups: 1, caramels: 1, gummy: 1, hardCandy: 1, chewyCandy: 1, jellyBeans: 1, licorice: 1, lollipop: 1, gum: 1, mints: 1 },
    "Pantry": { ketchup: 1, mustard: 1, mayo: 1, pickles: 1, olives: 1, hotSauce: 1, bbqSauce: 1, steakSauce: 1, soySauce: 1, dressing: 1, jam: 1, syrup: 1, honey: 1, peanutButter: 1, oil: 1, oliveOil: 1, vinegar: 1, spices: 1, salt: 1, cookingSpray: 1, shortening: 1, broth: 1, soup: 1, chili: 1, gravy: 1 },
    "Sports & Outdoors": { sportGear: 0, fitness: 0, camp: 1, bike: 1 },
    "Toys & Games": { toy: 0 },
    "Seasonal": { holiday: 1 },
    "Paper & Cleaning": { laundryDetergent: 1, fabricCare: 1, dishSoap: 1, dishwasher: 1, cleaners: 1, wipes: 1, sponges: 1, airFresh: 1, trashBags: 1, paperTowels: 0, bathTissue: 0, facialTissue: 0, paperPlates: 0, foodStorage: 1 },
    "Personal Care": { cosmetics: 1, femCare: 1, cotton: 1, shampoo: 0, conditioner: 0, bodyWash: 0, barSoap: 0, deodorant: 0, toothpaste: 0, oralCare: 0, lotion: 0, sunscreen: 0, shave: 0, hairCare: 0 },
    "Home & Bedding": { sheetSet: 0, comforter: 0, pillow: 0, curtain: 0, mattressPad: 0, towel: 0, storage: 1, laundryDetergent: 1, fabricCare: 1, officeFurniture: 2, airFresh: 2 },
    "Kitchen & Dining": { cookware: 1, bakeware: 1, cutlery: 1, smallAppliance: 1, gadgets: 0, dinnerware: 0, drinkware: 0, flatware: 0, kitchenStorage: 0 },
    "Outdoor & Garden": { lawnCare: 0, mower: 0, hose: 2, seeds: 2, planter: 2, stringLights: 1, patioSet: 1, birdFeeder: 2 },
    "Electronics": { tv: 0, speaker: 0, headphones: 0, charger: 1, battery: 1, device: 1 },
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
