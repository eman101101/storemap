#!/usr/bin/env node
/**
 * Seeds the demo store ("Freshmart Downtown") with a realistic supermarket:
 * perimeter walls with stocked wall shelving around most of the border, a checkout
 * area by the entrance, and central double-sided gondola pairs facing each other
 * across aisles — like a real grocery store. 150 products pinned to the shelf
 * faces (the wall each item is stocked against).
 *
 *   node scripts/seed-demo.mjs            # idempotent — skips if already seeded
 *   node scripts/seed-demo.mjs --reset    # wipe the demo store and rebuild
 */
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dbPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'storemap.db');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL;');

const reset = process.argv.includes('--reset');
const tiny = process.argv.includes('--tiny') || process.argv.includes('--profile=tiny');
const W = 54; // floor size, meters
const H = 36;

const store = db.prepare("SELECT id FROM stores WHERE slug = 'freshmart-downtown'").get();
if (!store) {
  console.error('Demo store "freshmart-downtown" not found — start the backend once to create it.');
  process.exit(1);
}
let floor = db.prepare('SELECT id, width_m, height_m FROM floors WHERE store_id = ? ORDER BY level LIMIT 1').get(store.id);
const shelfCount = db.prepare("SELECT COUNT(*) AS n FROM map_elements WHERE floor_id = ? AND type = 'shelf'").get(floor.id).n;

if (reset) {
  db.prepare('DELETE FROM product_locations WHERE floor_id = ?').run(floor.id);
  db.prepare('DELETE FROM products WHERE store_id = ?').run(store.id);
  db.prepare('DELETE FROM categories WHERE store_id = ?').run(store.id);
  db.prepare('DELETE FROM map_elements WHERE floor_id = ?').run(floor.id);
  db.prepare('UPDATE floors SET width_m = ?, height_m = ? WHERE id = ?').run(W, H, floor.id);
  console.log(`Reset demo store — rebuilding at ${W}×${H} m.`);
} else if (shelfCount >= 6 && Math.abs(floor.width_m - W) < 0.01) {
  console.log('Demo layout already present — skipping (use --reset to rebuild).');
  process.exit(0);
}
floor = db.prepare('SELECT id FROM floors WHERE store_id = ? ORDER BY level LIMIT 1').get(store.id);

const insEl = db.prepare(
  "INSERT INTO map_elements (id, floor_id, type, shape, geometry, label, color, meta, z_index) VALUES (?, ?, ?, ?, ?, ?, ?, '{}', ?)"
);
let z = 1;
const rect = (type, x, y, w, h, label = '') =>
  insEl.run(randomUUID(), floor.id, type, 'rect', JSON.stringify({ x, y, w, h, rot: 0 }), label, '', z++);
const point = (type, x, y, label = '') =>
  insEl.run(randomUUID(), floor.id, type, 'point', JSON.stringify({ x, y }), label, '', z++);

/* ---------- structure: walls, entrance, checkout, POIs ---------- */

rect('wall', 0, 0, W, 0.4, 'North wall');
rect('wall', 0, H - 0.4, W, 0.4, 'South wall');
rect('wall', 0, 0, 0.4, H, 'West wall');
rect('wall', W - 0.4, 0, 0.4, H, 'East wall');

point('entrance', 27, H - 0.9, 'Entrance');
point('exit', 31, H - 0.9, 'Exit');

rect('zone', 20, 29.6, 14, 3.2); // checkout area — counters are labeled individually
for (let i = 0; i < 4; i++) rect('shelf', 21.3 + i * 3.4, 30.3, 2.3, 1.3, `Checkout ${i + 1}`);

point('poi', 48.5, 33.2, 'Customer service');
point('poi', 2.2, 28.5, 'Restrooms');

/* ---------- shelves: stocked border + central facing aisle pairs ---------- */

// wall shelving around most of the border (inner faces hold products).
// 0.15 m gap from the wall: keeps faces coplanar-free so the 3D depth sort
// never ties a shelf face against the wall face behind it.
rect('shelf', 0.55, 2, 1.1, 31.35, 'West wall');
rect('shelf', 2, 0.55, W - 4.15, 1.1, 'North wall');
rect('shelf', W - 1.65, 2, 1.1, 31.35, 'East wall');
rect('shelf', 2, H - 1.65, 17, 1.1, 'South wall');
rect('shelf', 35, H - 1.65, 17, 1.1, 'South wall');

// central gondola pairs: two rows facing each other across a 1.5 m aisle
const SEGMENTS = [
  [6, 19],
  [28, 19],
]; // [x, length]
const faces = []; // product stocking lines: {axis:'h'|'v', line, from, to}
for (let p = 0; p < 4; p++) {
  const y0 = 6 + p * 6;
  const label = `Aisle ${p + 1}`;
  for (const [x0, len] of SEGMENTS) {
    rect('shelf', x0, y0, len, 0.7, label); // row A — its north + south faces
    rect('shelf', x0, y0 + 2.2, len, 0.7, label); // row B — faces the aisle
    faces.push({ axis: 'h', line: y0, from: x0 + 0.4, to: x0 + len - 0.4 });
    faces.push({ axis: 'h', line: y0 + 0.7, from: x0 + 0.4, to: x0 + len - 0.4 });
    faces.push({ axis: 'h', line: y0 + 2.2, from: x0 + 0.4, to: x0 + len - 0.4 });
    faces.push({ axis: 'h', line: y0 + 2.9, from: x0 + 0.4, to: x0 + len - 0.4 });
  }
}
// border stocking lines (inner faces of the wall shelving)
faces.push({ axis: 'v', line: 1.65, from: 2.6, to: H - 2.9 });
faces.push({ axis: 'h', line: 1.65, from: 2.6, to: W - 2.6 });
faces.push({ axis: 'v', line: W - 1.65, from: 2.6, to: H - 2.9 });
faces.push({ axis: 'h', line: H - 1.65, from: 2.6, to: 18.8 });
faces.push({ axis: 'h', line: H - 1.65, from: 35.2, to: W - 2.6 });

/* ---------- categories & 150 products pinned to the shelf faces ---------- */

const insCat = db.prepare('INSERT INTO categories (id, store_id, name, color, icon) VALUES (?, ?, ?, ?, ?)');
const insProd = db.prepare(
  'INSERT INTO products (id, store_id, category_id, name, brand, sku, barcode, description, price, image_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
);
const insLoc = db.prepare(
  "INSERT INTO product_locations (id, product_id, floor_id, x, y, rot, meta) VALUES (?, ?, ?, ?, ?, 0, '{}')"
);

const CATS = [
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

const cat = {};
const products = [];
for (const [name, color, icon, , items] of CATS) {
  const existing = db.prepare('SELECT id FROM categories WHERE store_id = ? AND name = ?').get(store.id, name);
  const id = existing?.id ?? randomUUID();
  if (!existing) insCat.run(id, store.id, name, color, icon);
  cat[name] = id;
  for (const item of items) products.push({ name: item, category: name });
}

// even slots along every stocking face, then sample 150 of them across the store
const slots = [];
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
for (let i = 0; i < take; i++) {
  const slot = slots[Math.min(total - 1, Math.round((i * total) / take))];
  const p = products[i];
  const id = randomUUID();
  const price = Math.round((0.79 + ((i * 37) % 920) / 100) * 100) / 100;
  insProd.run(id, store.id, cat[p.category], p.name, BRANDS[i % BRANDS.length], `${p.category.slice(0, 3).toUpperCase()}-${String(i + 1).padStart(3, '0')}`, '', '', price, '');
  insLoc.run(randomUUID(), id, floor.id, slot.x, slot.y);
}

if (tiny) {
  // tiny profile: strip to one aisle pair + entrance for docs/GIFs
  db.prepare("DELETE FROM map_elements WHERE label NOT LIKE 'Aisle 1%' AND type = 'shelf'").run();
  db.prepare('DELETE FROM product_locations WHERE id NOT IN (SELECT id FROM product_locations LIMIT 12)').run();
  console.log('Tiny profile applied: single aisle, 12 pins.');
}
console.log(`Seeded Freshmart Downtown: ${W}×${H} m, checkout area, border + aisle-pair shelving, ${take} products with pins.`);
