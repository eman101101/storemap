/**
 * Demo map generator — a faithful port of backend/scripts/seed-demo.mjs to
 * pure row arrays, inserted via D1 batches. Seeds Freshmart Downtown (the
 * 54×36 m supermarket, 150 pinned products), Annex Market (the complex
 * L-shaped hall + warehouse, 42 products) and the two homepage examples —
 * including Megamart Central, the FILLED big-box store (112×74 m, 27
 * categories, ~2,600 combinatorially generated SKUs pinned to every shelf,
 * byte-identical to the node engine's seed) — under the demo owner accounts
 * that "Open the demo maps" signs into.
 */
import type { Env } from './config';
import { first, run } from './db';
import { newId } from './util';

interface Face {
  axis: 'h' | 'v';
  line: number;
  from: number;
  to: number;
  hall?: boolean;
}
interface Slot {
  x: number;
  y: number;
  hall?: boolean;
}

/** id, floor_id, type, shape, geometry, label, color, z_index — meta is inlined as '{}' in the SQL. */
type ElemRow = [string, string, string, string, string, string, string, number];
type ProdRow = [string, string, string | null, string, string, string, string, string, number, string];
type LocRow = [string, string, string, number, number, string];

const ELEMENT_SQL = `INSERT INTO map_elements (id, floor_id, type, shape, geometry, label, color, meta, z_index)
  VALUES (?, ?, ?, ?, ?, ?, ?, '{}', ?)`;
const PRODUCT_SQL = `INSERT INTO products (id, store_id, category_id, name, brand, sku, barcode, description, price, image_url)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const LOCATION_SQL = `INSERT INTO product_locations (id, product_id, floor_id, x, y, rot, meta) VALUES (?, ?, ?, ?, ?, 0, ?)`;

/** Chunk statements — D1 batches stay comfortably within limits. */
function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function insertAll(env: Env, sql: string, rows: unknown[][]): Promise<void> {
  for (const chunk of chunks(rows, 40)) {
    await env.DB.batch(chunk.map((r) => env.DB.prepare(sql).bind(...r)));
  }
}

/** Create (or reuse) a demo owner account; returns its id. */
async function ensureDemoOwner(
  env: Env,
  email = 'annex@storemap.demo',
  name = 'Annex Demo',
  providerSub = 'annex-demo'
): Promise<string> {
  const owner = await first(env, 'SELECT id FROM users WHERE email = ?', email);
  if (owner) return owner.id as string;
  const uid = newId();
  await env.DB
    .prepare("INSERT INTO users (id, email, name, provider, provider_sub) VALUES (?, ?, ?, 'dev', ?)")
    .bind(uid, email, name, providerSub)
    .run();
  return uid;
}

async function ensureStore(
  env: Env,
  ownerId: string,
  opts: { slug: string; name: string; address: string; description: string; hours: string; floorName: string; w: number; h: number }
): Promise<{ id: string; floorId: string }> {
  let store = await first(env, 'SELECT id FROM stores WHERE slug = ?', opts.slug);
  if (!store) {
    const sid = newId();
    await env.DB
      .prepare(
        `INSERT INTO stores (id, owner_id, name, slug, address, description, hours, is_public)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
      )
      .bind(sid, ownerId, opts.name, opts.slug, opts.address, opts.description, opts.hours)
      .run();
    store = { id: sid };
  }
  let floor = await first(env, 'SELECT id FROM floors WHERE store_id = ? ORDER BY level LIMIT 1', store.id);
  if (!floor) {
    const fid = newId();
    await env.DB
      .prepare('INSERT INTO floors (id, store_id, name, level, width_m, height_m) VALUES (?, ?, ?, 1, ?, ?)')
      .bind(fid, store.id, opts.floorName, opts.w, opts.h)
      .run();
    floor = { id: fid };
  } else {
    // Keep the floor's size in sync with the spec on re-seed (backend parity).
    await env.DB
      .prepare('UPDATE floors SET width_m = ?, height_m = ? WHERE id = ?')
      .bind(opts.w, opts.h, floor.id)
      .run();
  }
  return { id: store.id as string, floorId: floor.id as string };
}

/* ════════════════ Freshmart Downtown ════════════════ */

const W = 54;
const H = 36;

/**
 * Real product photos for the demo planogram — bundled SPA assets (served
 * from frontend/public/demo-products by both engines, so the URL works on
 * Express and Workers with no storage setup). Downloaded from Open Food
 * Facts; see frontend/public/demo-products/ATTRIBUTION.md (ODbL).
 * Regenerate with: node backend/scripts/fetch-demo-photos.mjs
 */
const PHOTO_URLS: Record<string, string> = {
  'Organic Whole Milk 1L': '/demo-products/organic-whole-milk-1l.jpg',
  'Oat Drink Barista 1L': '/demo-products/oat-drink-barista-1l.jpg',
  'Greek Yogurt 500g': '/demo-products/greek-yogurt-500g.jpg',
  'Mozzarella Ball 125g': '/demo-products/mozzarella-ball-125g.jpg',
  'Mild Cheddar Block 350g': '/demo-products/mild-cheddar-block-350g.jpg',
  'Salted Butter 250g': '/demo-products/salted-butter-250g.jpg',
  'Kefir 1L': '/demo-products/kefir-1l.jpg',
  'Cream Cheese Tub 300g': '/demo-products/cream-cheese-tub-300g.jpg',
  'Gouda Slices 200g': '/demo-products/gouda-slices-200g.jpg',
  'Lactose-Free Milk 1L': '/demo-products/lactose-free-milk-1l.jpg',
  'Orange Juice 1L': '/demo-products/orange-juice-1l.jpg',
  'Cola 2L': '/demo-products/cola-2l.jpg',
  'Ground Coffee 500g': '/demo-products/ground-coffee-500g.jpg',
  'Espresso Beans 1kg': '/demo-products/espresso-beans-1kg.jpg',
  'Green Tea 40 Bags': '/demo-products/green-tea-40-bags.jpg',
  'English Breakfast Tea 80 Bags': '/demo-products/english-breakfast-tea-80-bags.jpg',
  'Hot Chocolate Mix 400g': '/demo-products/hot-chocolate-mix-400g.jpg',
  'Cold Brew Coffee 1L': '/demo-products/cold-brew-coffee-1l.jpg',
  'Almond Milk 1L': '/demo-products/almond-milk-1l.jpg',
  'Coconut Water 1L': '/demo-products/coconut-water-1l.jpg',
  'Iced Tea Lemon 1.5L': '/demo-products/iced-tea-lemon-15l.jpg',
  'Lemon-Lime Soda 2L': '/demo-products/lemon-lime-soda-2l.jpg',
  'Tonic Water 6-pack': '/demo-products/tonic-water-6-pack.jpg',
  'Energy Drink 4-pack': '/demo-products/energy-drink-4-pack.jpg',
  'Sea Salt Crisps 150g': '/demo-products/sea-salt-crisps-150g.jpg',
  'Tortilla Chips 300g': '/demo-products/tortilla-chips-300g.jpg',
  'Salted Peanuts 200g': '/demo-products/salted-peanuts-200g.jpg',
  'Mixed Nuts 300g': '/demo-products/mixed-nuts-300g.jpg',
  'Roasted Cashews 200g': '/demo-products/roasted-cashews-200g.jpg',
  'Milk Chocolate Bar 100g': '/demo-products/milk-chocolate-bar-100g.jpg',
  'Dark Chocolate 70% 100g': '/demo-products/dark-chocolate-70-100g.jpg',
  'Choc Chip Cookies 300g': '/demo-products/choc-chip-cookies-300g.jpg',
  'Digestive Biscuits 400g': '/demo-products/digestive-biscuits-400g.jpg',
  'Jaffa Cakes 12-pack': '/demo-products/jaffa-cakes-12-pack.jpg',
  'Gummy Bears 200g': '/demo-products/gummy-bears-200g.jpg',
  'Sweet Popcorn 100g': '/demo-products/sweet-popcorn-100g.jpg',
  'Salted Pretzels 250g': '/demo-products/salted-pretzels-250g.jpg',
  'Rice Cakes 150g': '/demo-products/rice-cakes-150g.jpg',
  'Sourdough Loaf': '/demo-products/sourdough-loaf.jpg',
  'Croissants 4-pack': '/demo-products/croissants-4-pack.jpg',
  'Bagels 6-pack': '/demo-products/bagels-6-pack.jpg',
  'Brioche Buns 6-pack': '/demo-products/brioche-buns-6-pack.jpg',
  'Frozen Pepperoni Pizza': '/demo-products/frozen-pepperoni-pizza.jpg',
  'Frozen Margherita Pizza': '/demo-products/frozen-margherita-pizza.jpg',
  'Vanilla Ice Cream 1L': '/demo-products/vanilla-ice-cream-1l.jpg',
  'Chocolate Ice Cream 1L': '/demo-products/chocolate-ice-cream-1l.jpg',
  'French Fries 1.5kg': '/demo-products/french-fries-15kg.jpg',
  'Garden Peas 1kg': '/demo-products/garden-peas-1kg.jpg',
  'Fish Fingers 20-pack': '/demo-products/fish-fingers-20-pack.jpg',
  'Chicken Nuggets 750g': '/demo-products/chicken-nuggets-750g.jpg',
  'Washing Up Liquid 500ml': '/demo-products/washing-up-liquid-500ml.jpg',
  'Hand Soap 500ml': '/demo-products/hand-soap-500ml.jpg',
  'Antibacterial Spray 750ml': '/demo-products/antibacterial-spray-750ml.jpg',
  'Bacon Rashers 300g': '/demo-products/bacon-rashers-300g.jpg',
  'Salmon Fillets 2-pack': '/demo-products/salmon-fillets-2-pack.jpg',
  'Honey-Roast Ham 200g': '/demo-products/honey-roast-ham-200g.jpg',
  'Pork Sausages 8-pack': '/demo-products/pork-sausages-8-pack.jpg',
  'Smoked Salmon 180g': '/demo-products/smoked-salmon-180g.jpg',
  'Chorizo Ring 250g': '/demo-products/chorizo-ring-250g.jpg',
};

const CATS: [string, string, string, number, string[]][] = [
  ['Dairy', '#3b6fd4', '🥛', 20, [
    'Organic Whole Milk 1L', 'Semi-Skimmed Milk 2L', 'Oat Drink Barista 1L', 'Greek Yogurt 500g',
    'Natural Yogurt 4-pack', 'Strawberry Yogurt 6-pack', 'Kefir 1L', 'Salted Butter 250g',
    'Unsalted Butter 250g', 'Mild Cheddar Block 350g', 'Mature Cheddar Block 350g', 'Mozzarella Ball 125g',
    'Feta Cheese 200g', 'Cream Cheese Tub 300g', 'Cottage Cheese 250g', 'Double Cream 500ml',
    'Crème Fraîche 250ml', 'Brie Wheel 200g', 'Gouda Slices 200g', 'Lactose-Free Milk 1L',
  ]],
  ['Produce', '#2f9e44', '🥬', 20, [
    'Bananas (bunch)', 'Fuji Apples 4-pack', 'Granny Smith Apples 6-pack', 'Navel Oranges 2kg Bag',
    'Clementines 1kg', 'Lemons 4-pack', 'Strawberries 400g', 'Blueberries 150g',
    'Raspberries 150g', 'Seedless Grapes 500g', 'Avocados (2-pack)', 'Baby Spinach 120g',
    'Rocket Salad 100g', 'Roma Tomatoes 500g', 'Cherry Tomatoes 250g', 'Cucumbers (3-pack)',
    'Red Bell Peppers (3-pack)', 'Broccoli Head', 'Carrots 1kg Bag', 'Russet Potatoes 2kg Bag',
  ]],
  ['Beverages', '#e4572e', '🧃', 18, [
    'Orange Juice 1L', 'Apple Juice 1L', 'Sparkling Water 6×500ml', 'Still Water 6×1.5L',
    'Cola 2L', 'Lemon-Lime Soda 2L', 'Ginger Beer 4-pack', 'Iced Tea Lemon 1.5L',
    'Cold Brew Coffee 1L', 'Ground Coffee 500g', 'Espresso Beans 1kg', 'Green Tea 40 Bags',
    'English Breakfast Tea 80 Bags', 'Hot Chocolate Mix 400g', 'Energy Drink 4-pack', 'Tonic Water 6-pack',
    'Almond Milk 1L', 'Coconut Water 1L',
  ]],
  ['Snacks', '#d4a017', '🍿', 18, [
    'Sea Salt Crisps 150g', 'Salt & Vinegar Crisps 150g', 'Tortilla Chips 300g', 'Salsa Dip 300g',
    'Salted Peanuts 200g', 'Roasted Cashews 200g', 'Mixed Nuts 300g', 'Sweet Popcorn 100g',
    'Milk Chocolate Bar 100g', 'Dark Chocolate 70% 100g', 'Choc Chip Cookies 300g', 'Oat Raisin Cookies 250g',
    'Digestive Biscuits 400g', 'Jaffa Cakes 12-pack', 'Cereal Bar 6-pack', 'Salted Pretzels 250g',
    'Rice Cakes 150g', 'Gummy Bears 200g',
  ]],
  ['Bakery', '#c47f17', '🥖', 15, [
    'Sourdough Loaf', 'Wholemeal Loaf 800g', 'Multiseed Bloomer', 'Baguettes (2-pack)',
    'Croissants 4-pack', 'Pain au Chocolat 4-pack', 'Blueberry Muffins 4-pack', 'Cinnamon Rolls 4-pack',
    'Bagels 6-pack', 'Tortilla Wraps 8-pack', 'Pita Breads 6-pack', 'Garlic Ciabatta',
    'Brioche Buns 6-pack', 'Chelsea Buns 6-pack', 'Doughnuts 5-pack',
  ]],
  ['Frozen', '#7c3aed', '🧊', 15, [
    'Frozen Pepperoni Pizza', 'Frozen Margherita Pizza', 'Frozen Berry Mix 500g', 'Garden Peas 1kg',
    'Sweetcorn 1kg', 'French Fries 1.5kg', 'Vanilla Ice Cream 1L', 'Chocolate Ice Cream 1L',
    'Salted Caramel Ice Cream 500ml', 'Fish Fingers 20-pack', 'King Prawns 400g', 'Frozen Salmon Fillets 2-pack',
    'Chicken Nuggets 750g', 'Veg Spring Rolls 8-pack', 'Frozen Waffles 10-pack',
  ]],
  ['Household', '#3a7ca5', '🧻', 22, [
    'Kitchen Roll 4 Rolls', 'Bath Tissue 9 Rolls', 'Bin Bags 30L 20-pack', 'Washing Up Liquid 500ml',
    'Laundry Pods 30-pack', 'Fabric Softener 1.5L', 'Antibacterial Spray 750ml', 'Glass Cleaner 500ml',
    'Bleach 750ml', 'Sponges 6-pack', 'Scourer Pads 4-pack', 'Dishwasher Tablets 40-pack',
    'Trash Bags 60L 15-pack', 'Aluminum Foil 30m', 'Cling Film 30m', 'Baking Paper 25m',
    'Air Freshener 300ml', 'Hand Soap 500ml', 'Shower Cleaner 750ml', 'Furniture Polish 300ml',
    'Light Bulbs 4-pack', 'Batteries AA 8-pack',
  ]],
  ['Meat & Seafood', '#b0413e', '🥩', 22, [
    'Chicken Breast Fillets 1kg', 'Chicken Thighs 750g', 'Whole Chicken 1.6kg', 'Beef Mince 500g',
    'Pork Mince 500g', 'Ribeye Steak 300g', 'Sirloin Steak 300g', 'Lamb Chops 400g',
    'Pork Loin Chops 6-pack', 'Bacon Rashers 300g', 'Streaky Bacon 200g', 'Pork Sausages 8-pack',
    'Chorizo Ring 250g', 'Honey-Roast Ham 200g', 'Turkey Slices 150g', 'Salmon Fillets 2-pack',
    'Cod Fillets 2-pack', 'Tuna Steaks 2-pack', 'Peeled Prawns 200g', 'Smoked Salmon 180g',
    'Mackerel Fillets 240g', 'Sea Bass Fillets 2-pack',
  ]],
];

const BRANDS = ['Fresh Farm', 'GreenVale', 'Sun Grove', 'Meadow', 'Olympus', 'Stone Oven', 'Napoli', 'Glacier', 'Nord Haus', 'Terra'];

async function seedFreshmart(env: Env, ownerId: string): Promise<void> {
  const { id: storeId, floorId } = await ensureStore(env, ownerId, {
    slug: 'freshmart-downtown',
    name: 'Freshmart Downtown',
    address: '400 Main St',
    description:
      'The full-size supermarket demo: perimeter wall shelving, double-sided gondola aisles, checkout by the entrance.',
    hours: '8am–10pm daily',
    floorName: 'Main floor',
    w: W,
    h: H,
  });

  const shelfCount = await first(
    env,
    "SELECT COUNT(*) AS n FROM map_elements WHERE floor_id = ? AND type = 'shelf'",
    floorId
  );
  if (Number(shelfCount?.n ?? 0) >= 6) return; // already present — idempotent

  const elements: ElemRow[] = [];
  let z = 1;
  const rect = (type: string, x: number, y: number, w: number, h: number, label = '') =>
    elements.push([newId(), floorId, type, 'rect', JSON.stringify({ x, y, w, h, rot: 0 }), label, '', z++]);
  const point = (type: string, x: number, y: number, label = '') =>
    elements.push([newId(), floorId, type, 'point', JSON.stringify({ x, y }), label, '', z++]);

  rect('wall', 0, 0, W, 0.4, 'North wall');
  rect('wall', 0, H - 0.4, W, 0.4, 'South wall');
  rect('wall', 0, 0, 0.4, H, 'West wall');
  rect('wall', W - 0.4, 0, 0.4, H, 'East wall');
  point('entrance', 27, H - 0.9, 'Entrance');
  point('exit', 31, H - 0.9, 'Exit');
  rect('zone', 20, 29.6, 14, 3.2);
  for (let i = 0; i < 4; i++) rect('shelf', 21.3 + i * 3.4, 30.3, 2.3, 1.3, `Checkout ${i + 1}`);
  point('poi', 48.5, 33.2, 'Customer service');
  point('poi', 2.2, 28.5, 'Restrooms');

  rect('shelf', 0.55, 2, 1.1, 31.35, 'West wall');
  rect('shelf', 2, 0.55, W - 4.15, 1.1, 'North wall');
  rect('shelf', W - 1.65, 2, 1.1, 31.35, 'East wall');
  rect('shelf', 2, H - 1.65, 17, 1.1, 'South wall');
  rect('shelf', 35, H - 1.65, 17, 1.1, 'South wall');

  const SEGMENTS: [number, number][] = [[6, 19], [28, 19]];
  const faces: Face[] = [];
  for (let p = 0; p < 4; p++) {
    const y0 = 6 + p * 6;
    const label = `Aisle ${p + 1}`;
    for (const [x0, len] of SEGMENTS) {
      rect('shelf', x0, y0, len, 0.7, label);
      rect('shelf', x0, y0 + 2.2, len, 0.7, label);
      faces.push({ axis: 'h', line: y0, from: x0 + 0.4, to: x0 + len - 0.4 });
      faces.push({ axis: 'h', line: y0 + 0.7, from: x0 + 0.4, to: x0 + len - 0.4 });
      faces.push({ axis: 'h', line: y0 + 2.2, from: x0 + 0.4, to: x0 + len - 0.4 });
      faces.push({ axis: 'h', line: y0 + 2.9, from: x0 + 0.4, to: x0 + len - 0.4 });
    }
  }
  faces.push({ axis: 'v', line: 1.65, from: 2.6, to: H - 2.9 });
  faces.push({ axis: 'h', line: 1.65, from: 2.6, to: W - 2.6 });
  faces.push({ axis: 'v', line: W - 1.65, from: 2.6, to: H - 2.9 });
  faces.push({ axis: 'h', line: H - 1.65, from: 2.6, to: 18.8 });
  faces.push({ axis: 'h', line: H - 1.65, from: 35.2, to: W - 2.6 });

  const products: { name: string; category: string }[] = [];
  const catIds: Record<string, string> = {};
  const catRows: unknown[][] = [];
  for (const [name, color, icon, , items] of CATS) {
    const existing = await first(env, 'SELECT id FROM categories WHERE store_id = ? AND name = ?', storeId, name);
    const id = (existing?.id as string) ?? newId();
    if (!existing) catRows.push([id, storeId, name, color, icon]);
    catIds[name] = id;
    for (const item of items) products.push({ name: item, category: name });
  }

  const slots: Slot[] = [];
  for (const f of faces) {
    const len = f.to - f.from;
    const n = Math.max(1, Math.floor(len / 2.2));
    for (let i = 0; i < n; i++) {
      const at = f.from + ((i + 0.5) * len) / n;
      slots.push(f.axis === 'h' ? { x: at, y: f.line } : { x: f.line, y: at });
    }
  }
  const total = slots.length;
  const take = Math.min(products.length, 150);
  const prodRows: ProdRow[] = [];
  const locRows: LocRow[] = [];
  for (let i = 0; i < take; i++) {
    const slot = slots[Math.min(total - 1, Math.round((i * total) / take))];
    const p = products[i];
    const pid = newId();
    const price = Math.round((0.79 + ((i * 37) % 920) / 100) * 100) / 100;
    prodRows.push([
      pid, storeId, catIds[p.category], p.name, BRANDS[i % BRANDS.length],
      `${p.category.slice(0, 3).toUpperCase()}-${String(i + 1).padStart(3, '0')}`, '', '', price,
      PHOTO_URLS[p.name] ?? '',
    ]);
    // stock planogram rows like a real store: facings cycle the shelf's rows
    // with a per-item facing width, so the planogram reads as a full gondola
    const levels = 4;
    const level = (i % levels) + 1;
    const facingW = Math.round((0.3 + ((i * 7) % 5) * 0.035) * 100) / 100;
    locRows.push([newId(), pid, floorId, slot.x, slot.y, JSON.stringify({ shelf_level: level, w: facingW })]);
  }

  await insertAll(env, ELEMENT_SQL, elements);
  await insertAll(env, 'INSERT INTO categories (id, store_id, name, color, icon) VALUES (?, ?, ?, ?, ?)', catRows);
  await insertAll(env, PRODUCT_SQL, prodRows);
  await insertAll(env, LOCATION_SQL, locRows);
}

/* ════════════════ Annex Market ════════════════ */

const AW = 48;
const AH = 46;

const ACATS: [string, string, string, string[]][] = [
  ['Dairy', '#3b6fd4', '🥛', ['Whole Milk 1L', 'Butter 250g', 'Cheddar 350g', 'Greek Yogurt 500g', 'Oat Milk 1L', 'Brie 200g']],
  ['Produce', '#2f9e44', '🥬', ['Bananas', 'Apples 4-pack', 'Rocket 100g', 'Tomatoes 500g', 'Avocados 2-pack', 'Carrots 1kg']],
  ['Snacks', '#d4a017', '🍿', ['Sea Salt Crisps', 'Tortilla Chips', 'Milk Chocolate', 'Cookies 300g', 'Pretzels', 'Popcorn']],
  ['Household', '#3a7ca5', '🧻', ['Kitchen Roll', 'Laundry Pods', 'Bin Bags', 'Washing Up Liquid', 'Bleach', 'Sponges']],
  ['Seasonal', '#e4572e', '🎃', ['Pumpkin', 'Fairy Lights', 'Gift Wrap', 'Candles', 'Wreath', 'Advent Calendar']],
  ['Hardware', '#7950f2', '🔧', ['Duct Tape', 'Batteries AA', 'Light Bulbs', 'Extension Lead', 'Screwdriver Set', 'Work Gloves']],
  ['Bulk', '#c47f17', '📦', ['Rice 10kg', 'Flour 5kg', 'Olive Oil 5L', 'Detergent 10L', 'Dog Food 12kg', 'Cat Litter 10L']],
];

async function seedAnnex(env: Env, ownerId: string): Promise<void> {
  const { id: storeId, floorId } = await ensureStore(env, ownerId, {
    slug: 'annex-market',
    name: 'Annex Market',
    address: '12 Harbour Rd',
    description: 'Complex-shape example: L-shaped hall with a loading-dock notch and an attached backstock warehouse.',
    hours: '7am-11pm daily',
    floorName: 'Main + Warehouse',
    w: AW,
    h: AH,
  });

  const shelfRow = await first(
    env,
    "SELECT COUNT(*) AS n FROM map_elements WHERE floor_id = ? AND type = 'shelf'",
    floorId
  );
  if (Number(shelfRow?.n ?? 0) > 0) return;

  const elements: ElemRow[] = [];
  let az = 1;
  const arect = (type: string, x: number, y: number, w: number, h: number, label = '') =>
    elements.push([newId(), floorId, type, 'rect', JSON.stringify({ x, y, w, h, rot: 0 }), label, '', az++]);
  const apoly = (type: string, pts: number[][], label = '') =>
    elements.push([newId(), floorId, type, 'polyline', JSON.stringify(pts.map((p) => [p[0], p[1]])), label, '', az++]);
  const apoint = (type: string, x: number, y: number, label = '') =>
    elements.push([newId(), floorId, type, 'point', JSON.stringify({ x, y }), label, '', az++]);

  apoly('wall', [[0, 0], [32, 0], [32, 8], [48, 8], [48, 46], [32, 46], [32, 34], [0, 34], [0, 0]], 'Outer walls');
  apoly('wall', [[32, 34], [38, 34]], 'Hall / warehouse');
  apoly('wall', [[41, 34], [48, 34]], 'Hall / warehouse');
  apoint('entrance', 6, 32.8, 'Entrance');
  apoint('exit', 26, 32.8, 'Exit');
  arect('zone', 2.5, 27.5, 13, 5, 'Checkout');
  for (let i = 0; i < 3; i++) arect('shelf', 4 + i * 4, 28.6, 2.6, 1.2, `Checkout ${i + 1}`);
  apoint('poi', 44.5, 3.5, 'Loading dock');
  arect('zone', 33, 1, 14, 6);

  arect('shelf', 0.55, 2.5, 1.1, 30, 'West wall');
  arect('shelf', 2, 0.55, 28, 1.1, 'North wall');
  const afaces: Face[] = [];
  afaces.push({ axis: 'v', line: 1.65, from: 3, to: 31 });
  afaces.push({ axis: 'h', line: 1.65, from: 3, to: 28 });
  for (let p = 0; p < 4; p++) {
    const y0 = 4.5 + p * 5.6;
    const label = `Aisle ${p + 1}`;
    arect('shelf', 3.5, y0, 24, 0.7, label);
    arect('shelf', 3.5, y0 + 2.2, 24, 0.7, label);
    apoly('aisle', [[4, y0 + 1.45], [27, y0 + 1.45]], label);
    for (const line of [y0, y0 + 0.7, y0 + 2.2, y0 + 2.9]) afaces.push({ axis: 'h', line, from: 4, to: 27 });
  }

  arect('zone', 33.2, 9.2, 14.6, 23.8, 'Seasonal');
  for (let v = 0; v < 2; v++) {
    const x0 = 35.2 + v * 6.4;
    const label = `Aisle ${5 + v}`;
    arect('shelf', x0, 10, 0.7, 21, label);
    arect('shelf', x0 + 2.7, 10, 0.7, 21, label);
    apoly('aisle', [[x0 + 1.7, 11], [x0 + 1.7, 30]], label);
    for (const line of [x0, x0 + 0.7, x0 + 2.7, x0 + 3.4]) afaces.push({ axis: 'v', line, from: 11, to: 30 });
  }

  arect('zone', 32.6, 34.6, 14.8, 10.8, 'Backstock');
  apoly('aisle', [[35, 40], [45, 40]], 'Rack row');
  for (let r = 0; r < 3; r++) {
    const x = 34.2 + r * 4.4;
    arect('shelf', x, 36.2, 1.3, 7.6, `Rack ${r + 1}`);
    afaces.push({ axis: 'v', line: x + 0.05, from: 36.6, to: 43.4 });
    afaces.push({ axis: 'v', line: x + 1.25, from: 36.6, to: 43.4 });
  }
  apoint('poi', 39.5, 44.9, 'Receiving');

  const aproducts: { name: string; category: string }[] = [];
  const acat: Record<string, string> = {};
  const catRows: unknown[][] = [];
  for (const [name, color, icon, items] of ACATS) {
    const cid = newId();
    catRows.push([cid, storeId, name, color, icon]);
    acat[name] = cid;
    for (const item of items) aproducts.push({ name: item, category: name });
  }

  const aslots: Slot[] = [];
  for (const f of afaces) {
    const len = f.to - f.from;
    const n = Math.max(1, Math.floor(len / 2.0));
    for (let i = 0; i < n; i++) {
      const at = f.from + ((i + 0.5) * len) / n;
      aslots.push(f.axis === 'h' ? { x: at, y: f.line, hall: f.axis === 'h' } : { x: f.line, y: at, hall: f.line < 32 });
    }
  }
  const hallSlots = aslots.filter((s) => s.hall);
  const whSlots = aslots.filter((s) => !s.hall);
  const hallItems = aproducts.filter((p) => !['Hardware', 'Bulk'].includes(p.category));
  const whItems = aproducts.filter((p) => ['Hardware', 'Bulk'].includes(p.category));

  const prodRows: ProdRow[] = [];
  const locRows: LocRow[] = [];
  const place = (items: { name: string; category: string }[], slots: Slot[], skuOffset: number) => {
    for (let i = 0; i < items.length && slots.length; i++) {
      const slot = slots[Math.floor((i * slots.length) / items.length)];
      const pid = newId();
      prodRows.push([
        pid, storeId, acat[items[i].category], items[i].name, 'Harbour Line',
        `ANN-${String(skuOffset + i + 1).padStart(3, '0')}`, '', '', Math.round((0.95 + ((i * 53) % 1800) / 100) * 100) / 100, '',
      ]);
      locRows.push([newId(), pid, floorId, slot.x, slot.y, JSON.stringify({ shelf_level: (i % 3) + 1, w: 0.32 })]);
    }
  };
  // skuOffset keeps SKUs unique across the two calls — D1's unique
  // (store, sku) index would reject duplicates and abort the seed
  place(hallItems, hallSlots, 0);
  place(whItems, whSlots, hallItems.length);

  await insertAll(env, ELEMENT_SQL, elements);
  await insertAll(env, 'INSERT INTO categories (id, store_id, name, color, icon) VALUES (?, ?, ?, ?, ?)', catRows);
  await insertAll(env, PRODUCT_SQL, prodRows);
  await insertAll(env, LOCATION_SQL, locRows);
}


/* ════════════════ Homepage examples: Harbor Warehouse + Megamart Central ════════════════
   Port of the seed-demo.mjs example specs — pure data builders so both runtimes
   seed identical stores (Megamart Central is the heavy one: a FILLED big-box
   floor with ~2,600 SKUs). Each gets its own demo owner and is idempotent. */

interface SpecFace {
  axis: 'h' | 'v';
  line: number;
  from: number;
  to: number;
  label: string;
}
interface SpecEl {
  type: string;
  shape: 'rect' | 'point';
  geometry: unknown;
  label: string;
}
interface SpecCat {
  name: string;
  color: string;
  icon: string;
  items: string[];
}
interface Spec {
  slug: string;
  name: string;
  address: string;
  description: string;
  hours: string;
  floorName: string;
  w: number;
  h: number;
  elements: SpecEl[];
  categories: SpecCat[];
  products: { name: string; category: string; brand: string; price?: number }[];
  locations: { product: number; x: number; y: number }[];
  skuPrefix: string;
  skuPad?: number;
}

/** Spread products over shelf faces: categories with preferred shelf labels go
 *  to those faces first; everything else round-robins over the general faces. */
function placeOnFaces(
  products: { name: string; category: string; brand: string }[],
  faces: SpecFace[],
  prefer: Record<string, string[]>,
  spacing: number
): { product: number; x: number; y: number }[] {
  const slotsOf = (fs: SpecFace[]) => {
    const out: { x: number; y: number }[] = [];
    for (const f of fs) {
      const len = f.to - f.from;
      const n = Math.max(1, Math.floor(len / spacing));
      for (let i = 0; i < n; i++) {
        const at = f.from + ((i + 0.5) * len) / n;
        out.push(f.axis === 'h' ? { x: at, y: f.line } : { x: f.line, y: at });
      }
    }
    return out;
  };
  const locations: { product: number; x: number; y: number }[] = [];
  const preferredLabels = new Set(Object.values(prefer).flat());
  const generalSlots = slotsOf(faces.filter((f) => !preferredLabels.has(f.label)));
  const general: number[] = [];
  products.forEach((p, idx) => {
    const labels = prefer[p.category];
    if (!labels) {
      general.push(idx);
      return;
    }
    const mine = products.map((q, j) => (q.category === p.category ? j : -1)).filter((j) => j >= 0);
    const k = mine.indexOf(idx);
    const slots = slotsOf(faces.filter((f) => labels.includes(f.label)));
    if (slots.length) {
      const s = slots[Math.min(slots.length - 1, Math.floor((k * slots.length) / mine.length))];
      locations.push({ product: idx, x: s.x, y: s.y });
    }
  });
  general.forEach((idx, k) => {
    if (!generalSlots.length) return;
    const s = generalSlots[Math.min(generalSlots.length - 1, Math.floor((k * generalSlots.length) / general.length))];
    locations.push({ product: idx, x: s.x, y: s.y });
  });
  return locations;
}

function warehouseSpec(): Spec {
  const W = 60;
  const H = 40;
  const elements: SpecEl[] = [];
  const faces: SpecFace[] = [];
  const rect = (type: string, x: number, y: number, w: number, h: number, label = '') =>
    elements.push({ type, shape: 'rect', geometry: { x, y, w, h, rot: 0 }, label });
  const point = (type: string, x: number, y: number, label = '') =>
    elements.push({ type, shape: 'point', geometry: { x, y }, label });

  rect('wall', 0, 0, W, 0.4, 'North wall');
  rect('wall', 0, H - 0.4, W, 0.4, 'South wall');
  rect('wall', 0, 0, 0.4, H, 'West wall');
  rect('wall', W - 0.4, 0, 0.4, H, 'East wall');
  point('entrance', 27, H - 0.9, 'Receiving');
  point('exit', 33, H - 0.9, 'Shipping');

  rect('zone', 1.5, 1, 41, 4.6, 'Loading docks');
  for (let i = 0; i < 4; i++) rect('shelf', 3 + i * 10, 2.2, 7, 1.5, `Dock ${i + 1}`);
  rect('zone', 44.5, 1, 14, 9.2, 'Offices');
  point('poi', 51, 3.8, 'Front desk');
  point('poi', 56.5, 8.4, 'Break room');
  point('poi', 45.5, 22, 'Battery charging');
  point('poi', 45.5, 26, 'Restrooms');
  rect('shelf', 44.5, 12, 5.5, 1.6, 'Cage — high value');
  faces.push({ axis: 'h', line: 13.6, from: 45, to: 49.5, label: 'Cage — high value' });

  rect('zone', 1.5, 7.5, 11.5, 31, 'Bulk floor');
  for (let i = 0; i < 4; i++) {
    const y = 9.5 + i * 7;
    const label = `Bulk ${String.fromCharCode(65 + i)}`;
    rect('shelf', 2.5, y, 9, 2.2, label);
    faces.push({ axis: 'h', line: y + 2.2, from: 3, to: 11, label });
  }

  for (let r = 0; r < 4; r++) {
    const y0 = 7 + r * 7;
    const label = `Rack ${String.fromCharCode(65 + r)}`;
    rect('shelf', 16, y0, 26, 1.3, label);
    rect('shelf', 16, y0 + 4.3, 26, 1.3, label);
    faces.push({ axis: 'h', line: y0 + 1.3, from: 16.6, to: 41.4, label });
    faces.push({ axis: 'h', line: y0 + 4.3, from: 16.6, to: 41.4, label });
  }
  for (let i = 0; i < 2; i++) {
    const x = 47 + i * 6;
    const label = `Rack ${String.fromCharCode(69 + i)}`;
    rect('shelf', x, 16, 1.3, 18, label);
    faces.push({ axis: 'v', line: x, from: 16.5, to: 33.5, label });
    faces.push({ axis: 'v', line: x + 1.3, from: 16.5, to: 33.5, label });
  }

  const categories: SpecCat[] = [
    { name: 'Power Tools', color: '#c2453a', icon: '🔌', items: ['Cordless Drill 18V', 'Impact Driver', 'Angle Grinder 900W', 'Circular Saw 190mm', 'Rotary Hammer SDS', 'Jigsaw 650W', 'Orbital Sander', 'Oscillating Multi-Tool', 'Heat Gun 2000W', 'Cordless Nail Gun'] },
    { name: 'Hand Tools', color: '#3b6fd4', icon: '🔧', items: ['Claw Hammer 16oz', 'Screwdriver Set 12pc', 'Adjustable Wrench 10"', 'Tape Measure 8m', 'Spirit Level 120cm', 'Utility Knife', 'Pliers Set 3pc', 'Socket Set 40pc', 'Hex Key Set Metric', 'Stud Finder'] },
    { name: 'Building Supply', color: '#b98a2f', icon: '🧱', items: ['Plywood Sheet 12mm', 'Drywall Panel 120×240', 'Timber Studs 8-pack', 'Cement Bag 25kg', 'Mortar Mix 20kg', 'Insulation Roll 10m', 'Gutter Kit 4m', 'Decking Boards 6-pack', 'OSB Sheet 11mm', 'Rebar Bundle 10pc'] },
    { name: 'Paint & Decor', color: '#2f9e44', icon: '🎨', items: ['Interior Emulsion 10L', 'Exterior Masonry Paint 10L', 'Primer 5L', 'Wood Stain 2.5L', 'Roller Kit 9"', 'Brush Set 5pc', 'Masking Tape 50m', 'Drop Sheet 3×4m', 'Caulk Gun + Sealant', 'Wallpaper Roll 10m'] },
    { name: 'Storage & Organization', color: '#7a4fd4', icon: '📦', items: ['Steel Shelving Unit 5-Tier', 'Plastic Crate 60L', 'Stackable Tote 45L', 'Tool Chest 7-Drawer', 'Workshop Trolley', 'Pallet Boxes 2-pack', 'Cable Ties 500-pack', 'Label Maker', 'Parts Organizer 12-Drawer', 'Garment Rail 1.2m'] },
    { name: 'Appliances', color: '#3a7ca5', icon: '🧊', items: ['Fridge-Freezer 60/40', 'Washing Machine 8kg', 'Dishwasher 12-Place', 'Microwave 25L', 'Split AC Unit', 'Water Heater 80L', 'Cooker Hood 60cm', 'Chest Freezer 200L', 'Electric Oven 60cm', 'Induction Hob 4-Zone'] },
  ];
  const products = categories.flatMap((c) => c.items.map((name) => ({ name, category: c.name, brand: 'Harbor Pro' })));
  const prefer: Record<string, string[]> = {
    Appliances: ['Bulk A', 'Bulk B', 'Bulk C', 'Bulk D'],
    'Building Supply': ['Bulk A', 'Bulk B', 'Bulk C', 'Bulk D'],
    'Power Tools': ['Cage — high value', 'Rack E', 'Rack F'],
  };
  const locations = placeOnFaces(products, faces, prefer, 1.6);
  return {
    slug: 'harbor-warehouse', name: 'Harbor Warehouse', address: '8 Dockside Way',
    description: 'Warehouse example: picking racks A–F with forklift aisles, four loading docks, a bulk pallet floor and a high-value cage.',
    hours: '6am–8pm Mon–Sat', floorName: 'Warehouse floor', w: W, h: H,
    elements, categories, products, locations, skuPrefix: 'HWH',
  };
}

function megamartSpec(): Spec {
  // The heavy demo: a FILLED big-box floor (112×74 m) carrying ~2,600 pinned
  // SKUs. Same geometry vocabulary as the other seeds — perimeter wall
  // shelving, facing gondola pairs on a 4.6 m pitch, labelled department
  // counters — just more of everything. Data is byte-identical to the node
  // seed script's megamartSpec so both engines seed the same store.
  const W = 112;
  const H = 74;
  const elements: SpecEl[] = [];
  const faces: SpecFace[] = [];
  const rect = (type: string, x: number, y: number, w: number, h: number, label = '') =>
    elements.push({ type, shape: 'rect', geometry: { x, y, w, h, rot: 0 }, label });
  const point = (type: string, x: number, y: number, label = '') =>
    elements.push({ type, shape: 'point', geometry: { x, y }, label });

  rect('wall', 0, 0, W, 0.4, 'North wall');
  rect('wall', 0, H - 0.4, W, 0.4, 'South wall');
  rect('wall', 0, 0, 0.4, H, 'West wall');
  rect('wall', W - 0.4, 0, 0.4, H, 'East wall');
  point('entrance', 30, H - 0.9, 'Entrance');
  point('exit', 36, H - 0.9, 'Exit');

  rect('zone', 22, 66, 30, 4.6); // checkouts
  for (let i = 0; i < 8; i++) rect('shelf', 23.4 + i * 3.5, 66.9, 2.3, 1.3, `Checkout ${i + 1}`);
  point('poi', 55, 70.5, 'Customer service');
  point('poi', 4, 70.5, 'Restrooms');
  point('poi', 104, 70.5, 'Pharmacy');
  point('poi', 100, 4.5, 'Café');

  // stocked perimeter walls
  rect('shelf', 0.55, 2, 1.1, 60, 'West wall');
  faces.push({ axis: 'v', line: 1.65, from: 2.6, to: 61.4, label: 'West wall' });
  rect('shelf', 2, 0.55, 108, 1.1, 'North wall');
  faces.push({ axis: 'h', line: 1.65, from: 2.6, to: 109.4, label: 'North wall' });
  rect('shelf', 2, H - 1.65, 18, 1.1, 'South wall');
  faces.push({ axis: 'h', line: H - 1.65, from: 2.6, to: 19.4, label: 'South wall' });
  rect('shelf', 54, H - 1.65, 56, 1.1, 'South wall');
  faces.push({ axis: 'h', line: H - 1.65, from: 54.6, to: 109.4, label: 'South wall' });

  // thirteen gondola aisle pairs in the centre (same pitch as the small specs)
  for (let p = 0; p < 13; p++) {
    const y0 = 4.5 + p * 4.6;
    const label = `Aisle ${p + 1}`;
    rect('shelf', 6, y0, 60, 0.7, label);
    rect('shelf', 6, y0 + 2.6, 60, 0.7, label);
    faces.push({ axis: 'h', line: y0, from: 6.4, to: 65.6, label });
    faces.push({ axis: 'h', line: y0 + 0.7, from: 6.4, to: 65.6, label });
    faces.push({ axis: 'h', line: y0 + 2.6, from: 6.4, to: 65.6, label });
    faces.push({ axis: 'h', line: y0 + 3.3, from: 6.4, to: 65.6, label });
  }

  // fresh-market wing down the east side: labelled department counters
  rect('zone', 70, 5, 40, 58, 'Fresh market');
  const depts = [
    'Produce', 'Produce', 'Produce', 'Produce', 'Bakery', 'Bakery', 'Bakery',
    'Butcher', 'Butcher', 'Seafood', 'Seafood', 'Deli', 'Deli', 'Ready Meals', 'Floral',
  ];
  depts.forEach((label, i) => {
    const y = 6 + i * 3.8;
    rect('shelf', 71, y, 38, 1.4, label);
    faces.push({ axis: 'h', line: y + 1.4, from: 71.5, to: 108.5, label });
  });

  /* ~2,600 SKUs built combinatorially per category — brand × item × variant,
     named "Brand · Item · Variant" (e.g. "Golden Vale · Oat Drink 1L ·
     Original"). Pure index arithmetic, no RNG, so the worker port of this
     spec seeds the byte-identical catalog. */
  type MegaCat = [string, string, string, number, number, number, string[], string[], string[], string[] | null];
  const CATS: MegaCat[] = [
    // [name, color, icon, count, priceLo, priceHi, brands, items, variants, preferred shelf labels]
    ['Produce', '#2f9e44', '🥬', 96, 0.79, 8.99,
      ['Sun Grove', 'Field & Sun', 'GreenVale', 'Meadow Ridge'],
      ['Bananas 1kg', 'Gala Apples 6-pack', 'Navel Oranges 2kg', 'Strawberries 400g', 'Blueberries 250g', 'Seedless Grapes 500g', 'Avocados 4-pack', 'Baby Spinach 200g', 'Roma Tomatoes 500g', 'Broccoli 2 Heads'],
      ['Organic', 'Class I', 'Value Pack', 'Family Size'], ['Produce']],
    ['Bakery', '#c47f17', '🥖', 75, 0.89, 5.49,
      ['Stone Oven', 'Hearth', 'Golden Crumb', 'Morning Mill'],
      ['Sourdough Loaf', 'Wholemeal Loaf 800g', 'Multiseed Bloomer', 'Baguette Pair', 'Croissants 6-pack', 'Pain au Chocolat 4-pack', 'Blueberry Muffins 6-pack', 'Cinnamon Rolls 6-pack', 'Bagels 6-pack', 'Brioche Buns 6-pack'],
      ['Classic', 'Butter', 'Wholegrain', 'Seeded'], ['Bakery']],
    ['Butcher', '#b0413e', '🥩', 50, 3.49, 18.99,
      ['Primal Cut', 'Ranch Direct', 'Black Angus Co', 'Meadow'],
      ['Chicken Breast 1.5kg', 'Whole Chicken 1.8kg', 'Beef Mince 750g', 'Ribeye Steak 400g', 'Pork Loin Chops 8-pack', 'Bacon 400g', 'Pork Sausages 12-pack', 'Lamb Chops 500g', 'Turkey Breast 900g', 'Beef Joint 1.2kg'],
      ['Standard', 'Free-Range', 'Organic', 'Extra Lean'], ['Butcher']],
    ['Seafood', '#3a7ca5', '🐟', 50, 2.99, 16.99,
      ['Harbor Catch', 'Blue Dock', 'Nordic Sea', 'Ocean Pearl'],
      ['Salmon Fillets 4-pack', 'Cod Fillets 4-pack', 'Tuna Steak 300g', 'King Prawns 300g', 'Smoked Salmon 200g', 'Sea Bass 2-pack', 'Mackerel 300g', 'Trout Fillets 2-pack', 'Calamari Rings 400g', 'Mussel Pot 1kg'],
      ['Fresh', 'Frozen', 'Wild-Caught', 'Farm-Raised'], ['Seafood']],
    ['Deli & Cheese', '#d9822b', '🧀', 50, 1.99, 12.49,
      ['Old World', 'Alpine Dairy', 'Terra', 'Meadow'],
      ['Honey Ham 250g', 'Salami 200g', 'Chorizo 300g', 'Mature Cheddar 400g', 'Mozzarella 250g', 'Feta 200g', 'Brie 200g', 'Gouda Slices 250g', 'Parmesan Wedge 300g', 'Halloumi 225g'],
      ['Classic', 'Matured', 'Smoked', 'Light'], ['Deli']],
    ['Ready Meals', '#7d9e3a', '🍱', 26, 2.99, 7.99,
      ['Chef Station', 'Urban Kitchen', 'Bella Cucina', 'Fresh & Fast'],
      ['Lasagne 400g', 'Chicken Korma 450g', 'Chilli Beef 450g', 'Mac & Cheese 400g', 'Pad Thai 400g', 'Sushi Selection 12pc', 'Ramen Bowl 450g', 'Cottage Pie 400g', 'Buddha Bowl 350g', 'Pizza Margherita 400g'],
      ['Classic', 'Spicy', 'Vegetarian', 'Family Size'], ['Ready Meals']],
    ['Floral', '#d464a0', '💐', 26, 4.99, 29.99,
      ['Bloom & Stem', 'Petal Co', 'Garden Whisper', 'Meadow'],
      ['Rose Bunch', 'Tulip Bunch 10 Stems', 'Sunflower Bunch', 'Mixed Bouquet', 'Peony Bunch', 'Alstroemeria Bunch', 'Dried Flower Bundle', 'Orchid Pot'],
      ['Small', 'Medium', 'Large', 'Gift-Wrapped'], ['Floral']],
    ['Dairy & Eggs', '#3b6fd4', '🥛', 150, 0.89, 6.49,
      ['Fresh Farm', 'GreenVale', 'Meadow', 'Alpine Dairy', 'Pure Pasture'],
      ['Whole Milk 2L', 'Semi-Skimmed Milk 1L', 'Oat Drink 1L', 'Greek Yogurt 1kg', 'Fruit Yogurt 12-pack', 'Salted Butter 250g', 'Unsalted Butter 250g', 'Cream Cheese 300g', 'Double Cream 500ml', 'Free-Range Eggs 12', 'Cheddar Block 350g', 'Cottage Cheese 400g'],
      ['Original', 'Light', 'Organic', 'Value'], null],
    ['Beverages', '#e4572e', '🧃', 150, 0.49, 13.99,
      ['Crystal Brook', 'Sun Grove', 'Fizz & Co', 'Cascade', 'Vivid'],
      ['Still Water 6×1.5L', 'Sparkling Water 8-pack', 'Cola 2L', 'Lemon-Lime Soda 2L', 'Orange Juice 2L', 'Apple Juice 2L', 'Iced Tea Lemon 1.5L', 'Ginger Beer 4-pack', 'Tonic Water 6-pack', 'Energy Drink 6-pack', 'Coconut Water 1L', 'Sports Drink 750ml'],
      ['Classic', 'Zero', 'Diet', 'Craft'], null],
    ['Coffee & Tea', '#6f4e37', '☕', 100, 2.49, 18.99,
      ['Bean & Leaf', 'Roast House', 'Emerald Peak', 'Chai Wallah'],
      ['Ground Coffee 500g', 'Whole Beans 1kg', 'Espresso Blend 1kg', 'Instant Coffee 200g', 'Cold Brew 750ml', 'Green Tea 50 Bags', 'English Breakfast 80 Bags', 'Earl Grey 80 Bags', 'Herbal Infusion 40 Bags', 'Hot Chocolate 400g'],
      ['Medium Roast', 'Dark Roast', 'Decaf', 'Single Origin'], null],
    ['Snacks', '#d4a017', '🍿', 140, 0.79, 5.49,
      ['Golden Vale', 'Crunch Bros', 'Field Harvest', 'Salty Isle'],
      ['Sea Salt Crisps 175g', 'Salt & Vinegar Crisps 175g', 'Tortilla Chips 400g', 'Salsa Dip 400g', 'Salted Peanuts 300g', 'Roasted Cashews 250g', 'Mixed Nuts 400g', 'Sweet Popcorn 150g', 'Pretzel Twists 250g', 'Rice Cakes 150g', 'Veggie Straws 150g', 'Corn Chips 300g'],
      ['Classic', 'Share Bag', 'Lightly Salted', 'Spiced'], null],
    ['Candy & Chocolate', '#a05ac0', '🍫', 110, 0.69, 4.99,
      ['Cocoa Lux', 'Sweet Meadow', 'Bella Dolce', 'Sugar Hill'],
      ['Milk Chocolate Bar 120g', 'Dark Chocolate 85% 100g', 'White Chocolate Bar 100g', 'Hazelnut Chocolate 100g', 'Gummy Bears 300g', 'Wine Gums 250g', 'Liquorice Allsorts 250g', 'Toffee Chews 200g', 'Marshmallows 250g', 'Mints 45g'],
      ['Standard', 'Family Pack', 'Sugar-Free', 'Fairtrade'], null],
    ['Breakfast & Cereal', '#caa53d', '🥣', 110, 1.29, 7.49,
      ['Morning Mill', 'Golden Vale', 'Sun Grove', 'Barnyard'],
      ['Corn Flakes 750g', 'Wholegrain Rings 500g', 'Chocolate Puffs 375g', 'Granola 550g', 'Muesli 750g', 'Porridge Oats 1kg', 'Instant Oat Sachets 18-pack', 'Honey Loops 375g', 'Breakfast Biscuits 300g', 'Pancake Mix 500g'],
      ['Original', 'No Added Sugar', 'Fruit & Nut', 'Organic'], null],
    ['Pantry & Dry Goods', '#b98a2f', '🍝', 130, 0.89, 8.49,
      ['Terra Larder', 'Molino', 'Harvest Barn', 'Golden Vale'],
      ['Spaghetti 500g', 'Penne 500g', 'Basmati Rice 2kg', 'Jasmine Rice 1kg', 'Plain Flour 1.5kg', 'Self-Raising Flour 1.5kg', 'Cane Sugar 1kg', 'Brown Sugar 500g', 'Baked Beans 4-pack', 'Chickpeas 400g', 'Red Lentils 500g', 'Couscous 500g'],
      ['Standard', 'Organic', 'Wholegrain', 'Value'], null],
    ['Condiments & Sauces', '#c25b4e', '🧴', 110, 0.99, 6.99,
      ['Old Port', 'Bella Cucina', 'Spice Route', 'Homestead'],
      ['Tomato Ketchup 750ml', 'Brown Sauce 450g', 'Mayonnaise 750ml', 'Salad Cream 460g', 'Olive Oil Extra Virgin 750ml', 'Sunflower Oil 1L', 'Malt Vinegar 568ml', 'Soy Sauce 150ml', 'Hot Sauce 148ml', 'Clear Honey 450g'],
      ['Classic', 'Organic', 'Light', 'Extra Hot'], null],
    ['Canned & Jarred', '#8a9a3b', '🥫', 110, 0.69, 4.49,
      ['Tin Row', 'Harbor Catch', 'Meadow', 'Preserve Co'],
      ['Chopped Tomatoes 400g', 'Sweetcorn 340g', 'Tuna Chunks 4-pack', 'Sardines 120g', 'Vegetable Soup 400g', 'Peaches in Juice 410g', 'Mandarin Segments 300g', 'Pickled Onions 720g', 'Beetroot 340g', 'Coconut Milk 400ml'],
      ['Standard', 'Salt Reduced', 'No Added Sugar', 'Value 4-pack'], null],
    ['World Foods', '#4e8fd9', '🌏', 100, 1.49, 9.99,
      ['Bella Cucina', 'Spice Route', 'Golden Dragon', 'Casa Fiesta'],
      ['Green Curry Paste 200g', 'Red Curry Paste 200g', 'Tikka Sauce 350g', 'Stir-Fry Noodles 400g', 'Ramen 5-pack', 'Taco Shells 12-pack', 'Fajita Kit 430g', 'Pappadums 10-pack', 'Gyoza 12-pack', 'Falafel Mix 200g'],
      ['Mild', 'Medium', 'Hot', 'Vegan'], null],
    ['Frozen', '#7c3aed', '🧊', 130, 1.29, 9.49,
      ['Glacier', 'North Frost', 'Frost & Field', 'Polar Pantry'],
      ['Pepperoni Pizza 2-pack', 'Margherita Pizza 550g', 'Berry Mix 750g', 'Tropical Fruit Mix 750g', 'Garden Peas 1.5kg', 'French Fries 2kg', 'Fish Fingers 30-pack', 'Chicken Nuggets 1kg', 'Spring Rolls 12-pack', 'Potato Waffles 12-pack', 'Veggie Burgers 8-pack', 'Puff Pastry 375g'],
      ['Standard', 'Family Pack', 'Plant-Based', 'Extra Crispy'], null],
    ['Ice Cream & Novelties', '#e8a1c9', '🍦', 90, 1.99, 7.99,
      ['Glacier', 'Sundae Co', 'Nord Haus', 'Dolce Freddo'],
      ['Vanilla Ice Cream 2L', 'Chocolate Ice Cream 2L', 'Strawberry Ice Cream 2L', 'Neapolitan Tub 2L', 'Lemon Sorbet 500ml', 'Pistachio Gelato 500ml', 'Ice Lollies 10-pack', 'Ice Cream Cones 4-pack', 'Cookie Dough Tub 473ml'],
      ['Classic', 'Light', 'Dairy-Free', 'Family Tub'], null],
    ['Household', '#2f7d4f', '🧻', 130, 0.89, 12.99,
      ['Sparkle Home', 'PureClean', 'Homestead', 'Bright & Co'],
      ['Kitchen Roll 6 Rolls', 'Bath Tissue 12 Rolls', 'Bin Bags 50L 20-pack', 'Bin Bags 30L 30-pack', 'Aluminium Foil 50m', 'Cling Film 50m', 'Baking Paper 25m', 'Sponges 10-pack', 'Scourer Pads 8-pack', 'Air Freshener 300ml', 'LED Bulbs 4-pack', 'AA Batteries 12-pack'],
      ['Standard', 'Value Pack', 'Eco', 'Extra Absorbent'], null],
    ['Laundry & Cleaning', '#5aa9c9', '🧼', 100, 1.49, 15.99,
      ['PureClean', 'Sparkle Home', 'Fresh Linen Co', 'EcoDrop'],
      ['Laundry Pods 40-pack', 'Liquid Detergent 2L', 'Fabric Softener 2L', 'Washing Up Liquid 1L', 'Dishwasher Tablets 60-pack', 'Bleach 1L', 'Antibacterial Spray 1L', 'Glass Cleaner 750ml', 'Floor Cleaner 1L', 'Limescale Remover 500ml'],
      ['Original', 'Sensitive', 'Concentrated', 'Refill'], null],
    ['Health & Beauty', '#e07a9e', '💊', 130, 1.29, 19.99,
      ['WellDay', 'Botanica', 'PureGlow', 'Apothecary & Co'],
      ['Toothpaste 100ml', 'Mouthwash 500ml', 'Shampoo 400ml', 'Conditioner 400ml', 'Body Wash 500ml', 'Bar Soap 4-pack', 'Deodorant 150ml', 'Hand Cream 75ml', 'Sunscreen SPF50 200ml', 'Paracetamol 16 Caplets', 'Vitamin C 60 Tablets', 'Hand Sanitiser 500ml'],
      ['Standard', 'Sensitive', 'Fresh Mint', 'Family Pack'], null],
    ['Baby & Toddler', '#f2a35c', '🍼', 90, 2.49, 21.99,
      ['Little Meadow', 'Tiny Steps', 'CuddlyCo', 'Pure Pasture'],
      ['Nappies Size 4 44-pack', 'Baby Wipes 12-pack', 'Baby Lotion 500ml', 'Baby Shampoo 500ml', 'Infant Formula 800g', 'Follow-On Milk 6-pack', 'Baby Rice 100g', 'Fruit Pouches 7-pack', 'Toddler Snacks 6-pack'],
      ['Standard', 'Sensitive', 'Organic', 'Value'], null],
    ['Pet Supplies', '#8a6d4b', '🐾', 100, 0.99, 24.99,
      ['Waggle', 'Purrfect', 'Field & Fur', 'Happy Tails'],
      ['Dog Dry Food 12kg', 'Dog Wet Food 12-pack', 'Dog Treats 500g', 'Dog Chews 7-pack', 'Cat Dry Food 10kg', 'Cat Wet Food 12-pack', 'Cat Litter 10L', 'Cat Treats 60g', 'Bird Seed 3kg', 'Pet Shampoo 500ml'],
      ['Standard', 'Grain-Free', 'Senior', 'Value Bag'], null],
    ['Electronics & Home', '#5b6b5f', '📺', 110, 4.99, 99.99,
      ['Volt', 'Nordik', 'Zenith', 'Hearth'],
      ['4K TV 50"', 'Soundbar 2.1', 'Bluetooth Speaker', 'Wireless Earbuds', 'LED Bulbs 10-pack', 'Extension Lead 4m', 'Table Lamp', 'Duvet Set Double', 'Bath Towels 4-pack', 'Frying Pan 28cm'],
      ['Standard', 'Premium', 'Compact', 'Black'], null],
    ['Sports & Leisure', '#4a7f6e', '🏒', 80, 3.99, 49.99,
      ['PeakLine', 'TrailCo', 'Zenith', 'Aqua Glide'],
      ['Yoga Mat 6mm', 'Dumbbell Set 10kg', 'Resistance Bands 5-pack', 'Football Size 5', 'Basketball Size 7', 'Tennis Balls 3-pack', 'Swim Goggles', 'Camp Chair', 'Water Bottle 1L'],
      ['Standard', 'Pro', 'Junior', 'Eco'], null],
    ['Toys & Games', '#d9556b', '🧸', 80, 4.99, 39.99,
      ['PlayWorks', 'Bright Blocks', 'Tiny Steps', 'Puzzle Palace'],
      ['Building Bricks 500pc', 'Jigsaw Puzzle 1000pc', 'Plush Bear 30cm', 'Race Track Set', 'Board Game Classic', 'Card Game Deck', 'Art Set 150pc', 'Doll Set', 'Model Kit 1:24'],
      ['Standard', 'Deluxe', 'Junior', 'Family Edition'], null],
  ];
  const prefer: Record<string, string[]> = {};
  const products: { name: string; category: string; brand: string; price?: number }[] = [];
  for (const [name, , , count, lo, hi, brands, items, variants, pref] of CATS) {
    if (pref) prefer[name] = pref;
    const span = Math.round((hi - lo) * 100);
    for (let n = 0; n < count; n++) {
      const brand = brands[n % brands.length];
      const item = items[Math.floor(n / brands.length) % items.length];
      const variant = variants[Math.floor(n / (brands.length * items.length)) % variants.length];
      products.push({
        name: `${brand} · ${item} · ${variant}`,
        category: name,
        brand,
        price: Math.round((lo + ((n * 61) % span) / 100) * 100) / 100,
      });
    }
  }
  const locations = placeOnFaces(products, faces, prefer, 1.4);
  return {
    slug: 'megamart-central', name: 'Megamart Central', address: '1 Central Plaza',
    description: 'Big-box demo: 13 gondola aisles, stocked perimeter walls, a fresh-market wing with produce, bakery, butcher, seafood and deli counters, an eight-lane checkout — 2,600+ pinned SKUs.',
    hours: '7am–11pm daily', floorName: 'Main floor', w: W, h: H,
    elements, categories: CATS.map(([name, color, icon, , , , , items]) => ({ name, color, icon, items })), products, locations,
    skuPrefix: 'MMC', skuPad: 4,
  };
}

async function seedExample(env: Env, spec: Spec, ownerEmail: string, ownerName: string): Promise<void> {
  const ownerId = await ensureDemoOwner(env, ownerEmail, ownerName, `${spec.slug}-demo`);
  // Capture the floor's size BEFORE ensureStore syncs it to the spec — a
  // mismatch means the spec grew and the seeded layout is stale, so it gets
  // wiped and rebuilt (parity with the node seed script's rebuild signal).
  const prior = await first(
    env,
    `SELECT f.width_m AS w, f.height_m AS h FROM floors f
     JOIN stores s ON s.id = f.store_id WHERE s.slug = ? ORDER BY f.level LIMIT 1`,
    spec.slug
  );
  const sizeChanged =
    !!prior && (Math.abs(Number(prior.w) - spec.w) > 0.01 || Math.abs(Number(prior.h) - spec.h) > 0.01);
  const { id: storeId, floorId } = await ensureStore(env, ownerId, {
    slug: spec.slug, name: spec.name, address: spec.address,
    description: spec.description, hours: spec.hours, floorName: spec.floorName, w: spec.w, h: spec.h,
  });
  const shelfRow = await first(env, "SELECT COUNT(*) AS n FROM map_elements WHERE floor_id = ? AND type = 'shelf'", floorId);
  let shelves = Number(shelfRow?.n ?? 0);
  if (shelves > 0 && sizeChanged) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM product_locations WHERE floor_id = ?').bind(floorId),
      env.DB.prepare('DELETE FROM products WHERE store_id = ?').bind(storeId),
      env.DB.prepare('DELETE FROM categories WHERE store_id = ?').bind(storeId),
      env.DB.prepare('DELETE FROM map_elements WHERE floor_id = ?').bind(floorId),
      env.DB.prepare('UPDATE stores SET description = ?, hours = ? WHERE id = ?').bind(spec.description, spec.hours, storeId),
    ]);
    shelves = 0;
    console.log(`[boot] ${spec.name} spec changed — rebuilding layout`);
  }
  if (shelves > 0) return; // already present — idempotent

  const elements: ElemRow[] = spec.elements.map((e, z) => [
    newId(), floorId, e.type, e.shape, JSON.stringify(e.geometry), e.label, '', z + 1,
  ]);
  const catRows: unknown[][] = [];
  const catIds: Record<string, string> = {};
  for (const c of spec.categories) {
    const id = newId();
    catIds[c.name] = id;
    catRows.push([id, storeId, c.name, c.color, c.icon]);
  }
  const prodRows: ProdRow[] = [];
  const locRows: LocRow[] = [];
  const prodIds = spec.products.map((p, i) => {
    const id = newId();
    const price = p.price ?? Math.round((1.49 + ((i * 61) % 2400) / 100) * 100) / 100;
    prodRows.push([
      id, storeId, catIds[p.category], p.name, p.brand,
      `${spec.skuPrefix}-${String(i + 1).padStart(spec.skuPad ?? 3, '0')}`, '', '', price, '',
    ]);
    return id;
  });
  const specLevels = 3;
  for (const l of spec.locations) {
    locRows.push([newId(), prodIds[l.product], floorId, l.x, l.y, JSON.stringify({ shelf_level: (l.product % specLevels) + 1, w: 0.3 })]);
  }

  await insertAll(env, ELEMENT_SQL, elements);
  // the example stores' planograms draw 2 m wide (planogram-only option —
  // the shelf footprints on the map keep their real size)
  await run(env, "UPDATE map_elements SET meta = ? WHERE floor_id = ? AND type = 'shelf' AND meta = '{}'", JSON.stringify({ planWidth: 2 }), floorId);
  await insertAll(env, 'INSERT INTO categories (id, store_id, name, color, icon) VALUES (?, ?, ?, ?, ?)', catRows);
  await insertAll(env, PRODUCT_SQL, prodRows);
  await insertAll(env, LOCATION_SQL, locRows);
  console.log(`[boot] seeded ${spec.name}: ${spec.elements.length} elements, ${spec.products.length} products (${spec.locations.length} pinned)`);
}

/** Seed both demo stores. Safe to race: unique slugs fail the second run. */
export async function seedDemoMaps(env: Env): Promise<void> {
  const ownerId = await ensureDemoOwner(env);
  await seedFreshmart(env, ownerId);
  await seedAnnex(env, ownerId);
  await seedExample(env, warehouseSpec(), 'warehouse@storemap.demo', 'Warehouse Demo');
  await seedExample(env, megamartSpec(), 'megamart@storemap.demo', 'Megamart Demo');
  console.log('[boot] demo maps seeded (Freshmart Downtown + Annex Market + Harbor Warehouse + Megamart Central)');
}
