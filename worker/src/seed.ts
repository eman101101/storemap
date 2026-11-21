/**
 * Demo map generator — pure row arrays inserted via D1 batches. Seeds ONE
 * example store, Walmart Example (the big-box reference floor plan: every
 * department area carries shelf groups — ONE titled pin per group sized to
 * the group's plan length, items stocked as planogram-only `groupOnly`
 * facings) — under the demo owner account that "Open the demo maps" signs
 * into. Former examples (Freshmart Downtown, Annex Market, Harbor Warehouse,
 * Megamart Central, Maple Corner Store, Grand Mart) are retired on boot.
 */
import type { Env } from './config';
import { first, run } from './db';
import { newId } from './util';

/** id, floor_id, type, shape, geometry, label, color, z_index — meta is inlined as '{}' in the SQL. */
type ElemRow = [string, string, string, string, string, string, string, string, number];
type ProdRow = [string, string, string | null, string, string, string, string, string, number, string];
type LocRow = [string, string, string, number, number, string];

const ELEMENT_SQL = `INSERT INTO map_elements (id, floor_id, type, shape, geometry, label, color, meta, z_index)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
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

/* ════════════════ Walmart Example ════════════════ */

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
  'Iced Tea Lemon 1.5L': '/demo-products/iced-tea-lemon-1-5l.jpg',
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
  'French Fries 1.5kg': '/demo-products/french-fries-1-5kg.jpg',
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


const BRANDS = ['Fresh Farm', 'GreenVale', 'Sun Grove', 'Meadow', 'Olympus', 'Stone Oven', 'Napoli', 'Glacier', 'Nord Haus', 'Terra'];

const FM_DEPTS = [
  { name: 'Dairy', color: '#3b6fd4', icon: '🥛', items: ['Organic Whole Milk 1L', 'Semi-Skimmed Milk 2L', 'Oat Drink Barista 1L', 'Greek Yogurt 500g', 'Natural Yogurt 4-pack', 'Strawberry Yogurt 6-pack', 'Kefir 1L', 'Salted Butter 250g', 'Unsalted Butter 250g', 'Mild Cheddar Block 350g', 'Mature Cheddar Block 350g', 'Mozzarella Ball 125g', 'Feta Cheese 200g', 'Cream Cheese Tub 300g', 'Cottage Cheese 250g', 'Double Cream 500ml', 'Crème Fraîche 250ml', 'Brie Wheel 200g', 'Gouda Slices 200g', 'Lactose-Free Milk 1L'] },
  { name: 'Produce', color: '#2f9e44', icon: '🥬', items: ['Bananas (bunch)', 'Fuji Apples 4-pack', 'Granny Smith Apples 6-pack', 'Navel Oranges 2kg Bag', 'Clementines 1kg', 'Lemons 4-pack', 'Strawberries 400g', 'Blueberries 150g', 'Raspberries 150g', 'Seedless Grapes 500g', 'Avocados (2-pack)', 'Baby Spinach 120g', 'Rocket Salad 100g', 'Roma Tomatoes 500g', 'Cherry Tomatoes 250g', 'Cucumbers (3-pack)', 'Red Bell Peppers (3-pack)', 'Broccoli Head', 'Carrots 1kg Bag', 'Russet Potatoes 2kg Bag'] },
  { name: 'Beverages', color: '#e4572e', icon: '🧃', items: ['Orange Juice 1L', 'Apple Juice 1L', 'Sparkling Water 6×500ml', 'Still Water 6×1.5L', 'Cola 2L', 'Lemon-Lime Soda 2L', 'Ginger Beer 4-pack', 'Iced Tea Lemon 1.5L', 'Cold Brew Coffee 1L', 'Ground Coffee 500g', 'Espresso Beans 1kg', 'Green Tea 40 Bags', 'English Breakfast Tea 80 Bags', 'Hot Chocolate Mix 400g', 'Energy Drink 4-pack', 'Tonic Water 6-pack', 'Almond Milk 1L', 'Coconut Water 1L', 'Sparkling Lemonade 750ml', 'Green Smoothie 400ml'] },
  { name: 'Snacks', color: '#d4a017', icon: '🍿', items: ['Sea Salt Crisps 150g', 'Salt & Vinegar Crisps 150g', 'Tortilla Chips 300g', 'Salsa Dip 300g', 'Salted Peanuts 200g', 'Roasted Cashews 200g', 'Mixed Nuts 300g', 'Sweet Popcorn 100g', 'Milk Chocolate Bar 100g', 'Dark Chocolate 70% 100g', 'Choc Chip Cookies 300g', 'Oat Raisin Cookies 250g', 'Digestive Biscuits 400g', 'Jaffa Cakes 12-pack', 'Cereal Bar 6-pack', 'Salted Pretzels 250g', 'Rice Cakes 150g', 'Gummy Bears 200g', 'Pretzel Sticks 100g', 'Trail Mix 150g'] },
  { name: 'Bakery', color: '#c47f17', icon: '🥖', items: ['Sourdough Loaf', 'Wholemeal Loaf 800g', 'Multiseed Bloomer', 'Baguettes (2-pack)', 'Croissants 4-pack', 'Pain au Chocolat 4-pack', 'Blueberry Muffins 4-pack', 'Cinnamon Rolls 4-pack', 'Bagels 6-pack', 'Tortilla Wraps 8-pack', 'Pita Breads 6-pack', 'Garlic Ciabatta', 'Brioche Buns 6-pack', 'Chelsea Buns 6-pack', 'Doughnuts 5-pack', 'Baguette', 'Multiseed Rolls 6-pack', 'Cinnamon Rolls 2-pack', 'Madeleines 6-pack', 'Apple Turnovers 4-pack'] },
  { name: 'Frozen', color: '#7c3aed', icon: '🧊', items: ['Frozen Pepperoni Pizza', 'Frozen Margherita Pizza', 'Frozen Berry Mix 500g', 'Garden Peas 1kg', 'Sweetcorn 1kg', 'French Fries 1.5kg', 'Vanilla Ice Cream 1L', 'Chocolate Ice Cream 1L', 'Salted Caramel Ice Cream 500ml', 'Fish Fingers 20-pack', 'King Prawns 400g', 'Frozen Salmon Fillets 2-pack', 'Chicken Nuggets 750g', 'Veg Spring Rolls 8-pack', 'Frozen Waffles 10-pack', 'Ice Lollies 8-pack', 'Frozen Berries 300g', 'Garlic Bread 400g', 'Hash Browns 1kg', 'Onion Rings 750g'] },
  { name: 'Household', color: '#3a7ca5', icon: '🧻', items: ['Kitchen Roll 4 Rolls', 'Bath Tissue 9 Rolls', 'Bin Bags 30L 20-pack', 'Washing Up Liquid 500ml', 'Laundry Pods 30-pack', 'Fabric Softener 1.5L', 'Antibacterial Spray 750ml', 'Glass Cleaner 500ml', 'Bleach 750ml', 'Sponges 6-pack', 'Scourer Pads 4-pack', 'Dishwasher Tablets 40-pack', 'Trash Bags 60L 15-pack', 'Aluminum Foil 30m', 'Cling Film 30m', 'Baking Paper 25m', 'Air Freshener 300ml', 'Hand Soap 500ml', 'Shower Cleaner 750ml', 'Furniture Polish 300ml'] },
  { name: 'Meat & Seafood', color: '#b0413e', icon: '🥩', items: ['Chicken Breast Fillets 1kg', 'Chicken Thighs 750g', 'Whole Chicken 1.6kg', 'Beef Mince 500g', 'Pork Mince 500g', 'Ribeye Steak 300g', 'Sirloin Steak 300g', 'Lamb Chops 400g', 'Pork Loin Chops 6-pack', 'Bacon Rashers 300g', 'Streaky Bacon 200g', 'Pork Sausages 8-pack', 'Chorizo Ring 250g', 'Honey-Roast Ham 200g', 'Turkey Slices 150g', 'Salmon Fillets 2-pack', 'Cod Fillets 2-pack', 'Tuna Steaks 2-pack', 'Peeled Prawns 200g', 'Smoked Salmon 180g'] },
  { name: 'Home & DIY', color: '#8a5fd4', icon: '🔧', items: ['Light Bulbs 4-pack', 'Batteries AA 8-pack', 'Picture Hooks 50-pack', 'Duct Tape 50m', 'Super Glue 3-pack', 'Screwdriver Set 6pc', 'Felt Pads 40-pack', 'Door Stop 2-pack', 'Laundry Rack Foldable', 'Storage Boxes 3-pack', 'Door Mat 60×40', 'Extension Lead 4-way', 'Smoke Alarm', 'Indoor Thermometer', 'Cup Hooks 20-pack', 'Furniture Sliders 8-pack', 'Wall Anchors 100-pack', 'Utility Knife', 'Measuring Tape 5m', 'Spirit Level 60cm'] },
  { name: 'Health & Beauty', color: '#2f9e6b', icon: '🧼', items: ['Toothpaste 100ml', 'Shampoo 400ml', 'Conditioner 400ml', 'Shower Gel 500ml', 'Soap Bar 4-pack', 'Hand Cream 75ml', 'Roll-on Deodorant', 'Razor Blades 4pc', 'Cotton Pads 60pc', 'Lip Balm 4-pack', 'Mouthwash 500ml', 'Dental Floss 50m', 'Sun Cream SPF30 200ml', 'Hand Sanitiser 250ml', 'Face Wipes 25pc', 'Bath Salts 900g', 'Body Lotion 400ml', 'Hair Gel 250ml', 'Cotton Buds 200pc', 'Plasters 60-pack'] },
];

const FM_VARIANTS = ['', ' Family Pack', ' Value Pack', ' Twin Pack', ' Jumbo', ' Party Size', ' Mini Pack', ' 2-pack', ' 3-pack', ' Multipack'];

/* ══════════════════════════════════════════════════════════════════════════
   Walmart Example — the big-box reference floor plan. Every area of the plan
   is a department (zone), every shelf in it is ONE titled item group: the
   group's map pin (groupPin, sized to the group's plan length) plus its items
   as planogram-only facings (groupOnly). The grocery wing reuses the demo
   photo pool; general-merchandise items planogram as diagram tiles.
   ══════════════════════════════════════════════════════════════════════════ */

const WW = 96;
const WH = 62;

/** The reference plan's palette: big-box blue general merchandise, the green
 *  grocery wing + garden center, gray service areas, orange front services,
 *  the thin yellow clearance strip. */
const WM_BLUE = '#2f6fd4';
const WM_GREEN = '#2f7d32';
const WM_GRAY = '#9aa0a6';
const WM_ORANGE = '#e8a33d';
const WM_YELLOW = '#f2c94c';

/** Pack variants per food base — trimmed from the old demo's ten so the
 *  catalog stays a sane size (~900 SKUs). */
const WM_VARIANTS = ['', ' Family Pack', ' Value Pack', ' 2-pack'];

/** Food departments reuse the Freshmart item pools — demo-photos.json covers
 *  them, so grocery-wing planograms carry real photos. */
const wmFood = (deptName: string, name?: string): SpecCat => {
  const src = FM_DEPTS.find((d) => d.name === deptName)!;
  return { name: name ?? src.name, color: src.color, icon: src.icon, items: src.items };
};

const WM_FOOD_CATS: SpecCat[] = [
  wmFood('Dairy', 'Dairy & Cheese'),
  { name: 'Deli & Cheese', color: '#d9822b', icon: '🧀', items: ['Honey-Roast Ham 200g', 'Pork Sausages 8-pack', 'Chorizo Ring 250g', 'Bacon Rashers 300g', 'Smoked Salmon 180g', 'Mild Cheddar Block 350g', 'Mature Cheddar Block 350g', 'Gouda Slices 200g', 'Brie Wheel 200g', 'Feta Cheese 200g', 'Cream Cheese Tub 300g', 'Mozzarella Ball 125g'] },
  { name: 'Adult Beverages', color: '#7a4fd4', icon: '🍷', items: ['Cabernet Sauvignon 750ml', 'Chardonnay 750ml', 'Prosecco 750ml', 'Lager 12-pack', 'IPA 6-pack', 'Stout 4-pack', 'Whisky 700ml', 'Vodka 700ml', 'Gin 700ml', 'Spiced Rum 700ml', 'Aperitivo 700ml', 'Alcohol-Free Beer 6-pack'] },
  wmFood('Snacks', 'Snacks & Candy'),
  { name: 'Breakfast & Coffee', color: '#7a4f2a', icon: '☕', items: ['Ground Coffee 500g', 'Espresso Beans 1kg', 'Cold Brew Coffee 1L', 'Green Tea 40 Bags', 'English Breakfast Tea 80 Bags', 'Hot Chocolate Mix 400g', 'Corn Flakes 500g', 'Granola 500g', 'Porridge Oats 1kg', 'Pancake Mix 500g', 'Cereal Bar 6-pack', 'Protein Bars 6-pack'] },
  { name: 'Pantry', color: '#b98a2f', icon: '🥫', items: ['Spaghetti 500g', 'Penne Rigate 500g', 'Basmati Rice 1kg', 'Long Grain Rice 1kg', 'Tomato Passata 700ml', 'Chopped Tomatoes 400g', 'Baked Beans 400g', 'Chickpeas 400g', 'Olive Oil 500ml', 'Sunflower Oil 1L', 'Tomato Ketchup 550g', 'Mayonnaise 400ml', 'Peanut Butter Smooth 350g', 'Honey Squeeze Bottle 350g', 'Instant Coffee 100g', 'Granulated Sugar 1kg', 'Plain Flour 1.5kg', 'Egg Noodles 250g'] },
  wmFood('Beverages', 'Drinks'),
  wmFood('Meat & Seafood'),
  wmFood('Frozen'),
  wmFood('Bakery'),
  wmFood('Produce', 'Fresh Produce'),
  wmFood('Household', 'Paper & Cleaning'),
  wmFood('Health & Beauty', 'Personal Care'),
];

/** General-merchandise departments — photo-less items that planogram as
 *  colored diagram tiles (the plan's blue areas). */
const WM_GM_CATS: SpecCat[] = [
  { name: 'Auto Care', color: '#5b6b5f', icon: '🚗', items: ['Motor Oil 5W-30 5L', 'Car Wash Shampoo 2L', 'Wiper Blades Pair', 'Car Air Freshener', 'Jump Starter 600A', 'Tire Inflator 12V', 'Coolant 50/50 4L', 'Car Wax 500ml'] },
  { name: 'Sports & Outdoors', color: '#4a7f6e', icon: '🏕️', items: ['Camping Chair', 'Yoga Mat 6mm', 'Basketball Size 7', 'Bike Helmet Adult', 'Tent 4-Person', 'Dumbbell Set 20kg', 'Resistance Bands 5-pack', 'Sleeping Bag'] },
  { name: 'Toys & Games', color: '#d9556b', icon: '🧸', items: ['Building Bricks 500pc', 'Board Game Classic', 'Action Figure 30cm', 'Puzzle 1000pc', 'RC Car 1:16', 'Plush Bear 40cm', 'Race Track Set', 'Card Game Deck'] },
  { name: 'Electronics', color: '#3b3b6f', icon: '📺', items: ['Smart TV 50"', 'Wireless Earbuds', 'Laptop 15"', 'Tablet 10"', 'Bluetooth Speaker', 'Power Bank 20000mAh', 'Smart Watch', 'HDMI Cable 2m'] },
  { name: 'Home Office', color: '#8a5fd4', icon: '🖱️', items: ['Desk Lamp LED', 'Office Chair Mesh', 'Notebook 3-pack', 'Gel Pens 12-pack', 'Stapler Heavy Duty', 'Sticky Notes 12-pack', 'Desk Organizer', 'Paper Ream 500 Sheets'] },
  { name: 'Pet Care', color: '#8a6d4b', icon: '🐾', items: ['Dog Dry Food 12kg', 'Cat Litter 10L', 'Pet Shampoo 250ml', 'Dog Chew Toy', 'Cat Tree Tower', 'Aquarium Filter', 'Bird Seed 3kg', 'Pet Bowl Set'] },
  { name: 'Auto Accessories', color: '#7950f2', icon: '🛞', items: ['Phone Car Mount', 'Seat Covers 2pc', 'Floor Mats 4pc', 'Trunk Organizer', 'Car Charger 2-port', 'Roof Cargo Box', 'Tow Rope 4t', 'Ice Scraper'] },
  { name: 'Outdoor & Garden', color: '#57a86c', icon: '🪴', items: ['Garden Hose 20m', 'Patio Chair Foldable', 'Charcoal 5kg', 'Planter Pot 30cm', 'Watering Can 10L', 'Lawn Seed 2kg', 'Garden Trowel', 'String Lights 10m'] },
  { name: 'Tools & Hardware', color: '#c2453a', icon: '🔧', items: ['Cordless Drill 18V', 'Claw Hammer 16oz', 'Screwdriver Set 12pc', 'Tape Measure 8m', 'Utility Knife', 'Duct Tape 50m', 'Picture Hooks 50-pack', 'Wall Anchors 100-pack'] },
  { name: 'Books & Media', color: '#4e8fd9', icon: '📚', items: ['Bestseller Novel', 'Cookbook Hardcover', 'Kids Storybook', 'Travel Guide', 'Journal Notebook', 'Magazine Special', 'Calendar 2027', 'Poster Print 60×90'] },
  { name: 'Arts & Crafts', color: '#d464a0', icon: '🎨', items: ['Acrylic Paint Set', 'Canvas 40×50 2-pack', 'Yarn 4-pack', 'Scrapbook Kit', 'Glue Gun + Sticks', 'Beads Assortment 2000pc', 'Brush Set 10pc', 'Origami Paper 200pc'] },
  { name: 'Celebrate', color: '#e4572e', icon: '🎉', items: ['Birthday Balloons 20pc', 'Party Banner', 'Gift Wrap Roll 30m', 'Greeting Cards 8pc', 'Birthday Candles 24pc', 'Confetti 3-pack', 'Party Bags 10pc', 'Number Balloon 90cm'] },
  { name: 'Seasonal', color: '#7d9e3a', icon: '🎄', items: ['Christmas Wreath 40cm', 'Fairy Lights 20m', 'Easter Basket', 'Halloween Pumpkin Decor', 'Beach Towel 2-pack', 'Sunshade UV 50', 'Advent Calendar', 'Door Wreath Hanger'] },
  { name: 'Home & Bedding', color: '#7a4fd4', icon: '🛏️', items: ['Duvet Cover Queen', 'Pillows 2-pack', 'Bed Sheet Set Queen', 'Throw Blanket Soft', 'Blackout Curtains 2pc', 'Storage Bins 6-pack', 'Laundry Basket Foldable', 'Mattress Topper Queen'] },
  { name: 'Kitchen & Dining', color: '#c98a3d', icon: '🍽️', items: ['Frying Pan 28cm', 'Dinner Set 16pc', 'Cutlery Set 24pc', 'Mixing Bowls 5pc', 'Coffee Maker 12-cup', 'Cutting Board Bamboo', 'Food Containers 10pc', 'Kettle 1.7L'] },
  { name: 'Boys', color: '#2f7ca5', icon: '👕', items: ['Boys Tee 3-pack', 'Boys Jeans', 'Boys Hoodie', 'Boys Shorts 2-pack', 'Boys Pajama Set', 'Boys Sneakers'] },
  { name: 'Girls', color: '#c25a8a', icon: '👗', items: ['Girls Tee 3-pack', 'Girls Leggings 2-pack', 'Girls Dress', 'Girls Hoodie', 'Girls Pajama Set', 'Girls Sneakers'] },
  { name: 'Baby', color: '#f2a35c', icon: '🍼', items: ['Baby Onesies 5-pack', 'Diapers Size 4 44pc', 'Baby Wipes 12-pack', 'Baby Lotion 500ml', 'Baby Bottle 2-pack', 'Baby Sleep Sack'] },
  { name: 'Shoes', color: '#5aa9c9', icon: '👟', items: ['Sneakers Unisex 42', 'Running Shoes', 'Sandals Pair', 'Slippers Fleece', 'Hiking Boots', 'Kids Light-up Sneakers'] },
  { name: 'Mens', color: '#4a6fa5', icon: '👔', items: ["Men's Tee 3-pack", "Men's Jeans", "Men's Polo", "Men's Hoodie", "Men's Chinos", "Men's Belt Leather"] },
  { name: 'Ladies', color: '#b05a8a', icon: '👚', items: ["Ladies' Tee 3-pack", "Ladies' Jeans", "Ladies' Blouse", "Ladies' Cardigan", "Ladies' Leggings", "Ladies' Scarf"] },
  { name: 'Pharmacy', color: '#2f9e6b', icon: '💊', items: ['Pain Reliever 500mg 24pc', 'Vitamin C 1000mg 60pc', 'First Aid Kit 60pc', 'Allergy Tablets 30pc', 'Cough Syrup 100ml', 'Bandages 100pc', 'Antacid Chewables 96pc', 'Electrolyte Powder 10-pack'] },
];

function walmartSpec(): Spec {
  const elements: SpecEl[] = [];

  // the store outline, traced from the reference plan's black line: the
  // Restrooms + grocery section rises above the general-merchandise top, the
  // two front entrances are OPEN GAPS in the south edge (never walled over),
  // and the Garden Center entry cuts the bottom-right corner diagonally
  elements.push({
    type: 'wall',
    shape: 'polyline',
    label: '',
    geometry: [
      [0.4, 3.3], [64, 3.3], [64, 0.4], [95.6, 0.4],
      [95.6, 44], [83, 61.6],
      [72, 61.6], [68, 61.6],
      [40, 61.6], [36, 61.6],
      [0.4, 61.6], [0.4, 3.3],
    ],
  });

  const zone = (x: number, y: number, w: number, h: number, label: string, color = WM_BLUE) =>
    elements.push({ type: 'zone', shape: 'rect', geometry: { x, y, w, h, rot: 0 }, label, color, meta: JSON.stringify({ department: label }) });
  const poi = (x: number, y: number, label: string) =>
    elements.push({ type: 'poi', shape: 'point', geometry: { x, y }, label });
  const aisle = (pts: [number, number][], label: string) =>
    elements.push({ type: 'aisle', shape: 'polyline', geometry: pts, label });

  /* ---------- department areas, matching the reference floor plan --------- */
  // top row (below the y 3.3 wall line of the GM section)
  zone(2, 4.5, 14, 12, 'Auto Care Center');
  zone(17, 4.5, 12, 12, 'Sports & Outdoors');
  zone(30, 4.5, 12, 12, 'Toys & Games');
  zone(43, 4.5, 12, 12, 'Electronics');
  zone(56, 4.5, 3, 12, 'Home Office');
  zone(60, 4.5, 6, 12, 'Paper & Cleaning');
  zone(67, 4.5, 5.5, 12, 'Pet Care');
  zone(64.5, 1, 8.5, 4.2, 'Restrooms', WM_GRAY);
  // the green grocery wing (right side, inside the raised top section)
  zone(73, 1.2, 22, 41, 'Grocery', WM_GREEN);
  // left flank
  zone(16.6, 17, 2, 12.5, 'Auto Accessories');
  zone(2, 30, 14, 14, 'Outdoor', WM_GREEN);
  zone(2, 45, 14, 15, 'Outdoor', WM_GREEN);
  zone(17, 38, 12, 6, 'Tools & Hardware');
  zone(17, 45, 1.8, 8, 'Clearance', WM_YELLOW);
  // center narrow column + big boxes
  zone(33, 16, 3.4, 3.6, 'Books');
  zone(33, 20, 3.4, 3.6, 'Arts & Crafts');
  zone(33, 24, 3.4, 3.6, 'Celebrate');
  zone(33, 28, 3.4, 3.6, 'Seasonal');
  zone(37, 16, 14, 15, 'Home & Bedding');
  zone(37, 32, 14, 7, 'Kitchen & Dining');
  zone(51, 16, 6.5, 5, 'Boys');
  zone(58, 16, 6.5, 5, 'Girls');
  zone(65, 16, 6.5, 5, 'Baby');
  zone(51, 21.5, 6.5, 5, 'Shoes');
  zone(51, 27, 6.5, 6.5, 'Mens');
  zone(58, 26.5, 13.5, 7, "Ladies'");
  // bottom band
  zone(17.5, 46, 19, 8, 'Personal Care & Beauty');
  zone(37.5, 46, 6, 8, 'Pharmacy');
  zone(44, 52, 24, 4, 'Checkout', WM_GRAY);
  zone(40, 57, 6, 3.6, 'Vision Center', WM_ORANGE);
  zone(48, 57, 8, 3.6, 'Customer Center', WM_ORANGE);
  zone(57, 57, 4, 3.6, 'Tenant', WM_ORANGE);
  zone(62, 57, 4.5, 3.6, 'Hair Salon', WM_ORANGE);
  zone(67, 57, 3.5, 3.6, 'Tenant', WM_ORANGE);
  zone(86, 46, 9, 9.5, 'Garden Center', WM_GREEN);
  aisle([[74.5, 15.2], [92.5, 15.2]], 'Grocery · 1–2');
  aisle([[74.5, 29.1], [92.5, 29.1]], 'Grocery · 3–4');
  aisle([[17, 44.5], [72, 44.5]], 'Action alley');

  // doors + points of interest — created AFTER the zones so the markers (and
  // their labels) sit on top and stay selectable
  elements.push({ type: 'entrance', shape: 'point', geometry: { x: 38, y: 60.8 }, label: 'Entrance' });
  elements.push({ type: 'entrance', shape: 'point', geometry: { x: 70, y: 60.8 }, label: 'Entrance' });
  elements.push({ type: 'exit', shape: 'point', geometry: { x: 90, y: 49 }, label: 'Garden Center' });
  poi(47, 55.8, 'Restrooms');
  poi(43.5, 56.2, 'Cart corral');
  poi(66, 56.2, 'Cart corral');

  /* ---------- shelves: EVERY shelf is one titled group --------------------- */
  // [label, category, x, y, w, h, planWidth?] — planWidth = the planogram
  // length in metres (the group pin spans the same length on the map)
  const groups: { label: string; cat: string; x: number; y: number; w: number; h: number; plan?: number }[] = [];
  const g = (label: string, cat: string, x: number, y: number, w: number, h: number, plan?: number) =>
    groups.push({ label, cat, x, y, w, h, plan });

  // grocery wing — photo-complete planograms, stacked top to bottom like the
  // plan (the wing fills the raised top section, so the run starts high)
  g('Dairy & Cheese', 'Dairy & Cheese', 74.5, 2.5, 18.5, 1.4, 6);
  g('Deli Counter', 'Deli & Cheese', 74.5, 5.3, 18.5, 1.4, 6);
  g('Adult Beverages', 'Adult Beverages', 74.5, 8.1, 18.5, 1.4, 6);
  g('Chips & Savoury Snacks', 'Snacks & Candy', 74.5, 10.9, 18.5, 1.4, 6);
  g('Candy & Chocolate', 'Snacks & Candy', 74.5, 13.7, 18.5, 1.4, 6);
  g('Coffee, Tea & Cereal', 'Breakfast & Coffee', 74.5, 16.5, 18.5, 1.4, 6);
  g('Pasta, Rice & Tins', 'Pantry', 74.5, 19.3, 18.5, 1.4, 6);
  g('Sauces & Spreads', 'Pantry', 74.5, 22.1, 18.5, 1.4, 6);
  g('Meat & Seafood', 'Meat & Seafood', 74.5, 24.9, 18.5, 1.4, 6);
  g('Frozen Favourites', 'Frozen', 74.5, 27.7, 18.5, 1.4, 6);
  g('Bakery', 'Bakery', 74.5, 30.5, 18.5, 1.4, 6);
  g('Fresh Produce', 'Fresh Produce', 74.5, 33.3, 18.5, 1.4, 6);
  g('Paper Towels & Cleaners', 'Paper & Cleaning', 74.5, 36.1, 18.5, 1.4, 6);

  // general merchandise — one titled group per department area
  g('Auto Care', 'Auto Care', 3.5, 8.5, 11, 1.4);
  g('Sports & Fitness', 'Sports & Outdoors', 18.5, 6.5, 10, 1.4);
  g('Camping & Outdoors', 'Sports & Outdoors', 18.5, 9.5, 10, 1.4);
  g('Toys', 'Toys & Games', 31.5, 6.5, 10, 1.4);
  g('Games & Puzzles', 'Toys & Games', 31.5, 9.5, 10, 1.4);
  g('TV & Audio', 'Electronics', 44.5, 6.5, 10, 1.4);
  g('Computers & Mobile', 'Electronics', 44.5, 9.5, 10, 1.4);
  g('Home Office', 'Home Office', 56.6, 6, 1.4, 8); // vertical strip, like the plan
  g('Cleaning Supplies', 'Paper & Cleaning', 60.5, 6.5, 5, 1.4);
  g('Pet Care', 'Pet Care', 67.5, 6.5, 4.8, 1.4);
  g('Auto Accessories', 'Auto Accessories', 16.8, 18.5, 1.4, 8); // vertical
  g('Patio & Garden Care', 'Outdoor & Garden', 3.5, 33, 11, 1.4);
  g('Outdoor Living', 'Outdoor & Garden', 3.5, 50, 11, 1.4);
  g('Tools & Hardware', 'Tools & Hardware', 18.5, 40, 10, 1.4);
  g('Clearance Buys', 'Seasonal', 17.5, 46.5, 1.4, 5); // the yellow strip
  g('Books', 'Books & Media', 33.3, 16.8, 2.8, 1.2);
  g('Arts & Crafts', 'Arts & Crafts', 33.3, 20.8, 2.8, 1.2);
  g('Party & Celebrate', 'Celebrate', 33.3, 24.8, 2.8, 1.2);
  g('Seasonal Decor', 'Seasonal', 33.3, 28.8, 2.8, 1.2);
  g('Bedding & Bath', 'Home & Bedding', 38, 17.5, 11, 1.4);
  g('Storage & Laundry', 'Home & Bedding', 38, 21.5, 11, 1.4);
  g('Furniture & Decor', 'Home & Bedding', 38, 25.5, 11, 1.4);
  g('Kitchen & Dining', 'Kitchen & Dining', 38, 33.5, 11, 1.4);
  g('Cookware & Small Appliances', 'Kitchen & Dining', 38, 36.5, 11, 1.4);
  g('Boys', 'Boys', 51.5, 17.5, 5, 1.4);
  g('Girls', 'Girls', 58.5, 17.5, 5, 1.4);
  g('Baby', 'Baby', 65.5, 17.5, 5.5, 1.4);
  g('Shoes', 'Shoes', 51.5, 22.5, 5, 1.4);
  g("Ladies' Fashion", 'Ladies', 58.5, 28, 12, 1.4);
  g("Men's Fashion", 'Mens', 51.5, 28.5, 6, 1.4);
  g('Skin & Hair Care', 'Personal Care', 19, 48, 11, 1.4);
  g('Beauty & Cosmetics', 'Personal Care', 19, 51, 11, 1.4);
  g('Pharmacy', 'Pharmacy', 38, 48, 4.5, 1.4);
  g('Garden Center', 'Outdoor & Garden', 87.5, 47.5, 1.4, 6); // vertical, in the garden zone

  for (const gr of groups) {
    const long = Math.max(gr.w, gr.h);
    elements.push({
      type: 'shelf',
      shape: 'rect',
      geometry: { x: gr.x, y: gr.y, w: gr.w, h: gr.h, rot: 0 },
      label: gr.label,
      color: '',
      meta: JSON.stringify({ department: gr.cat, planWidth: Math.round(Math.min(6, Math.max(1, gr.plan ?? long)) * 10) / 10 }),
    });
  }

  /* ---------- catalogue: food pools with variants, GM as-is --------------- */
  const allCats = [...WM_FOOD_CATS, ...WM_GM_CATS];
  const products: { name: string; category: string; brand: string; image?: string }[] = [];
  const poolByCat: Record<string, number[]> = {};
  for (const c of allCats) {
    poolByCat[c.name] = [];
    const gm = WM_GM_CATS.includes(c);
    for (const base of c.items) {
      for (const v of gm ? [''] : WM_VARIANTS) {
        poolByCat[c.name].push(products.length);
        products.push({ name: base + v, category: c.name, brand: BRANDS[products.length % BRANDS.length], image: PHOTOS[base] ?? '' });
      }
    }
  }

  /* ---------- stock: 1 group pin + 2 groupOnly facings per group ---------- */
  const locations: Spec['locations'] = [];
  const catCursor: Record<string, number> = {};
  for (const gr of groups) {
    const pool = poolByCat[gr.cat];
    catCursor[gr.cat] ??= 0;
    const vertical = gr.h > gr.w;
    const pinSpan = Math.round(Math.min(6, Math.max(2, Math.max(gr.w, gr.h))) * 10) / 10;
    const center = { x: gr.x + gr.w / 2, y: gr.y + gr.h / 2 };
    // the group pin — ONE per group, spanning the group's plan length and
    // carrying the section's first item; two more representative items are
    // planogram-only (groupOnly: never drawn or selectable on the map)
    const picks = [0, 1, 2].map((k) => pool[(catCursor[gr.cat] + k) % pool.length]);
    locations.push({ product: picks[0], x: center.x, y: center.y, level: 2, w: 1, pinW: pinSpan, pinH: 0.3, groupPin: 1 });
    for (const [k, quarter] of [0, 2].entries()) {
      const at = vertical
        ? { x: gr.x + gr.w / 2, y: gr.y + ((quarter + 0.5) * gr.h) / 4 }
        : { x: gr.x + ((quarter + 0.5) * gr.w) / 4, y: gr.y + gr.h / 2 };
      locations.push({ product: picks[k + 1], x: at.x, y: at.y, level: k === 0 ? 1 : 3, w: 1, pinW: 0.3, groupOnly: 1 });
    }
    catCursor[gr.cat] += 3;
  }

  return {
    slug: 'walmart-example', name: 'Walmart Example', address: '1 Supercenter Way',
    description:
      'Big-box example built from the reference floor plan: every area is a department and every shelf one titled item group — the map shows ONE pin per group (sized to the group), the items live only inside its planogram. Grocery wing carries real product photos; general merchandise plans as diagram tiles.',
    hours: '6am–11pm daily', floorName: 'Main floor', w: WW, h: WH,
    elements, categories: allCats, products, locations, skuPrefix: 'WMX', skuPad: 4,
  };
}

interface SpecEl {
  type: string;
  shape: 'rect' | 'point' | 'polyline';
  geometry: unknown;
  label: string;
  color?: string;
  meta?: string;
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
  products: { name: string; category: string; brand: string; price?: number; image?: string }[];
  locations: { product: number; x: number; y: number; level?: number; w?: number; pinW?: number; pinH?: number; groupOnly?: number; groupPin?: number }[];
  skuPrefix: string;
  skuPad?: number;
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
    newId(), floorId, e.type, e.shape, JSON.stringify(e.geometry), e.label, e.color ?? '', e.meta ?? '{}', z + 1,
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
      `${spec.skuPrefix}-${String(i + 1).padStart(spec.skuPad ?? 3, '0')}`, '', '', price, p.image ?? '',
    ]);
    return id;
  });
  const specLevels = 3;
  for (const l of spec.locations) {
    locRows.push([newId(), prodIds[l.product], floorId, l.x, l.y, JSON.stringify({
      shelf_level: l.level ?? (l.product % specLevels) + 1,
      w: l.w ?? 1,
      ...(l.pinW != null ? { pinW: l.pinW } : {}),
      ...(l.pinH != null ? { pinH: l.pinH } : {}),
      ...(l.groupOnly ? { groupOnly: 1 } : {}),
      ...(l.groupPin ? { groupPin: 1 } : {}),
    })]);
  }

  await insertAll(env, ELEMENT_SQL, elements);
  // shelves without an explicit planogram length draw at the 3 m auto length
  // (see the frontend's computeShelfLayout) — no blanket override
  await insertAll(env, 'INSERT INTO categories (id, store_id, name, color, icon) VALUES (?, ?, ?, ?, ?)', catRows);
  await insertAll(env, PRODUCT_SQL, prodRows);
  await insertAll(env, LOCATION_SQL, locRows);
  console.log(`[boot] seeded ${spec.name}: ${spec.elements.length} elements, ${spec.products.length} products (${spec.locations.length} pinned)`);
}

/** Seed the one example store (Walmart Example). Retires the previous demo
 *  maps from databases that already seeded them — slug deletions cascade;
 *  per-store idempotency keeps the boot check cheap. Safe to race. */
export async function seedDemoMaps(env: Env): Promise<void> {
  await ensureDemoOwner(env);
  for (const slug of [
    'sunrise-grocers',
    'freshmart-downtown',
    'annex-market',
    'harbor-warehouse',
    'megamart-central',
    'maple-corner',
    'grand-mart',
  ]) {
    await deleteDemoStore(env, slug);
  }
  await seedExample(env, walmartSpec(), 'walmart@storemap.demo', 'Walmart Demo');
  console.log('[boot] demo map seeded (Walmart Example)');
}

/* ══════════════════════════════════════════════════════════════════════════
   Demo product photos: scripts/fetch-demo-photos.mjs writes the mapping to
   demo-photos.json — real Open Food Facts downloads + generated packshot
   fallbacks, served as bundled SPA assets. Food items look theirs up here;
   general-merchandise items have none and planogram as diagram tiles.
   ══════════════════════════════════════════════════════════════════════════ */
import photoMap from '../../backend/scripts/demo-photos.json';

const PHOTOS = photoMap as Record<string, string>;

/** Remove a demo store wholesale (slug-based) — used to retire old examples
 *  from databases that already seeded them. */
async function deleteDemoStore(env: Env, slug: string): Promise<void> {
  const st = await first(env, 'SELECT id FROM stores WHERE slug = ?', slug);
  if (!st) return;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM product_locations WHERE floor_id IN (SELECT id FROM floors WHERE store_id = ?)').bind(st.id),
    env.DB.prepare('DELETE FROM floor_snapshots WHERE floor_id IN (SELECT id FROM floors WHERE store_id = ?)').bind(st.id),
    env.DB.prepare('DELETE FROM map_elements WHERE floor_id IN (SELECT id FROM floors WHERE store_id = ?)').bind(st.id),
    env.DB.prepare('DELETE FROM products WHERE store_id = ?').bind(st.id),
    env.DB.prepare('DELETE FROM categories WHERE store_id = ?').bind(st.id),
    env.DB.prepare('DELETE FROM floors WHERE store_id = ?').bind(st.id),
    env.DB.prepare('DELETE FROM store_members WHERE store_id = ?').bind(st.id),
    env.DB.prepare('DELETE FROM stores WHERE id = ?').bind(st.id),
  ]);
  console.log(`[boot] retired demo store ${slug}`);
}

