/**
 * Demo map generator — pure row arrays inserted via D1 batches. Seeds the
 * three homepage examples (Walmart, Home Depot and the Corner Store: every
 * department area carries shelf groups — ONE titled pin per group sized to
 * the group's plan length, items stocked as planogram-only `groupOnly`
 * facings) under demo owner accounts that "Open the demo maps" signs into.
 * Former examples (Freshmart Downtown, Annex Market, Harbor Warehouse,
 * Megamart Central, Maple Corner Store, Grand Mart) are retired on boot.
 *
 * Parity with backend/scripts/seed-demo.mjs + demo-specs.mjs — the same
 * floor plans, catalogue, stocking and photo urls; keep the two in step.
 *
 * Every catalogue item faces on a shelf: a shopper's search lists an item
 * with no facing as "out of stock". And the demo photos are stored IN the
 * database (the `media` table, see media.ts) — a present store is never
 * rebuilt because a photo changed; its product urls are updated in place.
 */
import type { Env } from './config';
import { all, first, run } from './db';
import { newId } from './util';
import { demoPhotoUrl } from './media';

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

const WW = 96;
const WH = 62;

/** The areas that hold no products — the plan's own colours for them. */
const WM_CHECKOUT = '#8b84b8'; // lavender checkout lanes
const WM_RESTROOM = '#2d809d'; // teal
const WM_SERVICE = '#9aa0a6'; // customer service grey
const WM_BANK = '#b23a5b'; // crimson
const WM_OFFICE = '#c3c7cc';

/** Pack variants per food base — trimmed from the old demo's ten so the
 *  catalog stays a sane size (~900 SKUs). */
const WM_VARIANTS = ['', ' Family Pack', ' Value Pack', ' 2-pack'];

const BRANDS = ['Fresh Farm', 'GreenVale', 'Sun Grove', 'Meadow', 'Olympus', 'Stone Oven', 'Napoli', 'Glacier', 'Nord Haus', 'Terra'];

const FM_VARIANTS = ['', ' Family Pack', ' Value Pack', ' Twin Pack', ' Jumbo', ' Party Size', ' Mini Pack', ' 2-pack', ' 3-pack', ' Multipack'];

const FM_DEPTS = [
  { name: 'Dairy', color: '#efc24a', icon: '🥛', items: ['Organic Whole Milk 1L', 'Semi-Skimmed Milk 2L', 'Oat Drink Barista 1L', 'Greek Yogurt 500g', 'Natural Yogurt 4-pack', 'Strawberry Yogurt 6-pack', 'Kefir 1L', 'Salted Butter 250g', 'Unsalted Butter 250g', 'Mild Cheddar Block 350g', 'Mature Cheddar Block 350g', 'Mozzarella Ball 125g', 'Feta Cheese 200g', 'Cream Cheese Tub 300g', 'Cottage Cheese 250g', 'Double Cream 500ml', 'Crème Fraîche 250ml', 'Brie Wheel 200g', 'Gouda Slices 200g', 'Lactose-Free Milk 1L'] },
  { name: 'Produce', color: '#55a64f', icon: '🥬', items: ['Bananas (bunch)', 'Fuji Apples 4-pack', 'Granny Smith Apples 6-pack', 'Navel Oranges 2kg Bag', 'Clementines 1kg', 'Lemons 4-pack', 'Strawberries 400g', 'Blueberries 150g', 'Raspberries 150g', 'Seedless Grapes 500g', 'Avocados (2-pack)', 'Baby Spinach 120g', 'Rocket Salad 100g', 'Roma Tomatoes 500g', 'Cherry Tomatoes 250g', 'Cucumbers (3-pack)', 'Red Bell Peppers (3-pack)', 'Broccoli Head', 'Carrots 1kg Bag', 'Russet Potatoes 2kg Bag'] },
  { name: 'Beverages', color: '#3d7fc2', icon: '🧃', items: ['Orange Juice 1L', 'Apple Juice 1L', 'Sparkling Water 6×500ml', 'Still Water 6×1.5L', 'Cola 2L', 'Lemon-Lime Soda 2L', 'Ginger Beer 4-pack', 'Iced Tea Lemon 1.5L', 'Cold Brew Coffee 1L', 'Ground Coffee 500g', 'Espresso Beans 1kg', 'Green Tea 40 Bags', 'English Breakfast Tea 80 Bags', 'Hot Chocolate Mix 400g', 'Energy Drink 4-pack', 'Tonic Water 6-pack', 'Almond Milk 1L', 'Coconut Water 1L', 'Sparkling Lemonade 750ml', 'Green Smoothie 400ml'] },
  { name: 'Snacks', color: '#e2663a', icon: '🍿', items: ['Sea Salt Crisps 150g', 'Salt & Vinegar Crisps 150g', 'Tortilla Chips 300g', 'Salsa Dip 300g', 'Salted Peanuts 200g', 'Roasted Cashews 200g', 'Mixed Nuts 300g', 'Sweet Popcorn 100g', 'Milk Chocolate Bar 100g', 'Dark Chocolate 70% 100g', 'Choc Chip Cookies 300g', 'Oat Raisin Cookies 250g', 'Digestive Biscuits 400g', 'Jaffa Cakes 12-pack', 'Cereal Bar 6-pack', 'Salted Pretzels 250g', 'Rice Cakes 150g', 'Gummy Bears 200g', 'Pretzel Sticks 100g', 'Trail Mix 150g'] },
  { name: 'Bakery', color: '#c9883b', icon: '🥖', items: ['Sourdough Loaf', 'Wholemeal Loaf 800g', 'Multiseed Bloomer', 'Baguettes (2-pack)', 'Croissants 4-pack', 'Pain au Chocolat 4-pack', 'Blueberry Muffins 4-pack', 'Cinnamon Rolls 4-pack', 'Bagels 6-pack', 'Tortilla Wraps 8-pack', 'Pita Breads 6-pack', 'Garlic Ciabatta', 'Brioche Buns 6-pack', 'Chelsea Buns 6-pack', 'Doughnuts 5-pack', 'Baguette', 'Multiseed Rolls 6-pack', 'Cinnamon Rolls 2-pack', 'Madeleines 6-pack', 'Apple Turnovers 4-pack'] },
  { name: 'Frozen', color: '#5db1ec', icon: '🧊', items: ['Frozen Pepperoni Pizza', 'Frozen Margherita Pizza', 'Frozen Berry Mix 500g', 'Garden Peas 1kg', 'Sweetcorn 1kg', 'French Fries 1.5kg', 'Vanilla Ice Cream 1L', 'Chocolate Ice Cream 1L', 'Salted Caramel Ice Cream 500ml', 'Fish Fingers 20-pack', 'King Prawns 400g', 'Frozen Salmon Fillets 2-pack', 'Chicken Nuggets 750g', 'Veg Spring Rolls 8-pack', 'Frozen Waffles 10-pack', 'Ice Lollies 8-pack', 'Frozen Berries 300g', 'Garlic Bread 400g', 'Hash Browns 1kg', 'Onion Rings 750g'] },
  { name: 'Household', color: '#9dc3de', icon: '🧻', items: ['Kitchen Roll 4 Rolls', 'Bath Tissue 9 Rolls', 'Bin Bags 30L 20-pack', 'Washing Up Liquid 500ml', 'Laundry Pods 30-pack', 'Fabric Softener 1.5L', 'Antibacterial Spray 750ml', 'Glass Cleaner 500ml', 'Bleach 750ml', 'Sponges 6-pack', 'Scourer Pads 4-pack', 'Dishwasher Tablets 40-pack', 'Trash Bags 60L 15-pack', 'Aluminum Foil 30m', 'Cling Film 30m', 'Baking Paper 25m', 'Air Freshener 300ml', 'Hand Soap 500ml', 'Shower Cleaner 750ml', 'Furniture Polish 300ml'] },
  { name: 'Meat & Seafood', color: '#d93a42', icon: '🥩', items: ['Chicken Breast Fillets 1kg', 'Chicken Thighs 750g', 'Whole Chicken 1.6kg', 'Beef Mince 500g', 'Pork Mince 500g', 'Ribeye Steak 300g', 'Sirloin Steak 300g', 'Lamb Chops 400g', 'Pork Loin Chops 6-pack', 'Bacon Rashers 300g', 'Streaky Bacon 200g', 'Pork Sausages 8-pack', 'Chorizo Ring 250g', 'Honey-Roast Ham 200g', 'Turkey Slices 150g', 'Salmon Fillets 2-pack', 'Cod Fillets 2-pack', 'Tuna Steaks 2-pack', 'Peeled Prawns 200g', 'Smoked Salmon 180g'] },
  { name: 'Home & DIY', color: '#8a5fd4', icon: '🔧', items: ['Light Bulbs 4-pack', 'Batteries AA 8-pack', 'Picture Hooks 50-pack', 'Duct Tape 50m', 'Super Glue 3-pack', 'Screwdriver Set 6pc', 'Felt Pads 40-pack', 'Door Stop 2-pack', 'Laundry Rack Foldable', 'Storage Boxes 3-pack', 'Door Mat 60×40', 'Extension Lead 4-way', 'Smoke Alarm', 'Indoor Thermometer', 'Cup Hooks 20-pack', 'Furniture Sliders 8-pack', 'Wall Anchors 100-pack', 'Utility Knife', 'Measuring Tape 5m', 'Spirit Level 60cm'] },
  { name: 'Health & Beauty', color: '#f0824c', icon: '🧼', items: ['Toothpaste 100ml', 'Shampoo 400ml', 'Conditioner 400ml', 'Shower Gel 500ml', 'Soap Bar 4-pack', 'Hand Cream 75ml', 'Roll-on Deodorant', 'Razor Blades 4pc', 'Cotton Pads 60pc', 'Lip Balm 4-pack', 'Mouthwash 500ml', 'Dental Floss 50m', 'Sun Cream SPF30 200ml', 'Hand Sanitiser 250ml', 'Face Wipes 25pc', 'Bath Salts 900g', 'Body Lotion 400ml', 'Hair Gel 250ml', 'Cotton Buds 200pc', 'Plasters 60-pack'] },
];

/** Food departments reuse the Freshmart item pools — demo-photos.json covers
 *  them, so their planograms carry real photos. */
const wmFood = (deptName: string, name?: string): SpecCat => {
  const src = FM_DEPTS.find((d) => d.name === deptName)!;
  return { name: name ?? src.name, color: src.color, icon: src.icon, items: src.items };
};

const WM_FOOD_CATS: SpecCat[] = [
  wmFood('Dairy', 'Dairy & Cheese'),
  { name: 'Deli & Cheese', color: '#f2a93b', icon: '🧀', items: ['Honey-Roast Ham 200g', 'Pork Sausages 8-pack', 'Chorizo Ring 250g', 'Bacon Rashers 300g', 'Smoked Salmon 180g', 'Mild Cheddar Block 350g', 'Mature Cheddar Block 350g', 'Gouda Slices 200g', 'Brie Wheel 200g', 'Feta Cheese 200g', 'Cream Cheese Tub 300g', 'Mozzarella Ball 125g'] },
  { name: 'Adult Beverages', color: '#7b5aa6', icon: '🍷', items: ['Cabernet Sauvignon 750ml', 'Chardonnay 750ml', 'Prosecco 750ml', 'Lager 12-pack', 'IPA 6-pack', 'Stout 4-pack', 'Whisky 700ml', 'Vodka 700ml', 'Gin 700ml', 'Spiced Rum 700ml', 'Aperitivo 700ml', 'Alcohol-Free Beer 6-pack'] },
  wmFood('Snacks', 'Snacks & Candy'),
  { name: 'Breakfast & Coffee', color: '#9a6b45', icon: '☕', items: ['Ground Coffee 500g', 'Espresso Beans 1kg', 'Cold Brew Coffee 1L', 'Green Tea 40 Bags', 'English Breakfast Tea 80 Bags', 'Hot Chocolate Mix 400g', 'Corn Flakes 500g', 'Granola 500g', 'Porridge Oats 1kg', 'Pancake Mix 500g', 'Cereal Bar 6-pack', 'Protein Bars 6-pack'] },
  { name: 'Pantry', color: '#9e9b33', icon: '🥫', items: ['Spaghetti 500g', 'Penne Rigate 500g', 'Basmati Rice 1kg', 'Long Grain Rice 1kg', 'Tomato Passata 700ml', 'Chopped Tomatoes 400g', 'Baked Beans 400g', 'Chickpeas 400g', 'Olive Oil 500ml', 'Sunflower Oil 1L', 'Tomato Ketchup 550g', 'Mayonnaise 400ml', 'Peanut Butter Smooth 350g', 'Honey Squeeze Bottle 350g', 'Instant Coffee 100g', 'Granulated Sugar 1kg', 'Plain Flour 1.5kg', 'Egg Noodles 250g'] },
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
  { name: 'Auto Care', color: '#3e4a52', icon: '🚗', items: ['Motor Oil 5W-30 5L', 'Car Wash Shampoo 2L', 'Wiper Blades Pair', 'Car Air Freshener', 'Jump Starter 600A', 'Tire Inflator 12V', 'Coolant 50/50 4L', 'Car Wax 500ml'] },
  { name: 'Sports & Outdoors', color: '#2e9e6b', icon: '🏕️', items: ['Camping Chair', 'Yoga Mat 6mm', 'Basketball Size 7', 'Bike Helmet Adult', 'Tent 4-Person', 'Dumbbell Set 20kg', 'Resistance Bands 5-pack', 'Sleeping Bag'] },
  { name: 'Toys & Games', color: '#b876c8', icon: '🧸', items: ['Building Bricks 500pc', 'Board Game Classic', 'Action Figure 30cm', 'Puzzle 1000pc', 'RC Car 1:16', 'Plush Bear 40cm', 'Race Track Set', 'Card Game Deck'] },
  { name: 'Electronics', color: '#3f5ba8', icon: '📺', items: ['Smart TV 50"', 'Wireless Earbuds', 'Laptop 15"', 'Tablet 10"', 'Bluetooth Speaker', 'Power Bank 20000mAh', 'Smart Watch', 'HDMI Cable 2m'] },
  { name: 'Home Office', color: '#c9a227', icon: '🖱️', items: ['Desk Lamp LED', 'Office Chair Mesh', 'Notebook 3-pack', 'Gel Pens 12-pack', 'Stapler Heavy Duty', 'Sticky Notes 12-pack', 'Desk Organizer', 'Paper Ream 500 Sheets'] },
  { name: 'Pet Care', color: '#5f8a8b', icon: '🐾', items: ['Dog Dry Food 12kg', 'Cat Litter 10L', 'Pet Shampoo 250ml', 'Dog Chew Toy', 'Cat Tree Tower', 'Aquarium Filter', 'Bird Seed 3kg', 'Pet Bowl Set'] },
  { name: 'Auto Accessories', color: '#7a8a99', icon: '🛞', items: ['Phone Car Mount', 'Seat Covers 2pc', 'Floor Mats 4pc', 'Trunk Organizer', 'Car Charger 2-port', 'Roof Cargo Box', 'Tow Rope 4t', 'Ice Scraper'] },
  { name: 'Outdoor & Garden', color: '#86b83e', icon: '🪴', items: ['Garden Hose 20m', 'Patio Chair Foldable', 'Charcoal 5kg', 'Planter Pot 30cm', 'Watering Can 10L', 'Lawn Seed 2kg', 'Garden Trowel', 'String Lights 10m'] },
  { name: 'Tools & Hardware', color: '#b5723a', icon: '🔧', items: ['Cordless Drill 18V', 'Claw Hammer 16oz', 'Screwdriver Set 12pc', 'Tape Measure 8m', 'Utility Knife', 'Duct Tape 50m', 'Picture Hooks 50-pack', 'Wall Anchors 100-pack'] },
  { name: 'Books & Media', color: '#4f7fb0', icon: '📚', items: ['Bestseller Novel', 'Cookbook Hardcover', 'Kids Storybook', 'Travel Guide', 'Journal Notebook', 'Magazine Special', 'Calendar 2027', 'Poster Print 60×90'] },
  { name: 'Arts & Crafts', color: '#d9924a', icon: '🎨', items: ['Acrylic Paint Set', 'Canvas 40×50 2-pack', 'Yarn 4-pack', 'Scrapbook Kit', 'Glue Gun + Sticks', 'Beads Assortment 2000pc', 'Brush Set 10pc', 'Origami Paper 200pc'] },
  { name: 'Celebrate', color: '#ee8fb0', icon: '🎉', items: ['Birthday Balloons 20pc', 'Party Banner', 'Gift Wrap Roll 30m', 'Greeting Cards 8pc', 'Birthday Candles 24pc', 'Confetti 3-pack', 'Party Bags 10pc', 'Number Balloon 90cm'] },
  { name: 'Seasonal', color: '#2e6b5e', icon: '🎄', items: ['Christmas Wreath 40cm', 'Fairy Lights 20m', 'Easter Basket', 'Halloween Pumpkin Decor', 'Beach Towel 2-pack', 'Sunshade UV 50', 'Advent Calendar', 'Door Wreath Hanger'] },
  { name: 'Home & Bedding', color: '#7c8fcb', icon: '🛏️', items: ['Duvet Cover Queen', 'Pillows 2-pack', 'Bed Sheet Set Queen', 'Throw Blanket Soft', 'Blackout Curtains 2pc', 'Storage Bins 6-pack', 'Laundry Basket Foldable', 'Mattress Topper Queen'] },
  { name: 'Kitchen & Dining', color: '#c0626e', icon: '🍽️', items: ['Frying Pan 28cm', 'Dinner Set 16pc', 'Cutlery Set 24pc', 'Mixing Bowls 5pc', 'Coffee Maker 12-cup', 'Cutting Board Bamboo', 'Food Containers 10pc', 'Kettle 1.7L'] },
  { name: 'Boys', color: '#4e9bd6', icon: '👕', items: ['Boys Tee 3-pack', 'Boys Jeans', 'Boys Hoodie', 'Boys Shorts 2-pack', 'Boys Pajama Set', 'Boys Sneakers'] },
  { name: 'Girls', color: '#d98bb8', icon: '👗', items: ['Girls Tee 3-pack', 'Girls Leggings 2-pack', 'Girls Dress', 'Girls Hoodie', 'Girls Pajama Set', 'Girls Sneakers'] },
  { name: 'Baby', color: '#f4a98a', icon: '🍼', items: ['Baby Onesies 5-pack', 'Diapers Size 4 44pc', 'Baby Wipes 12-pack', 'Baby Lotion 500ml', 'Baby Bottle 2-pack', 'Baby Sleep Sack'] },
  { name: 'Shoes', color: '#a5896b', icon: '👟', items: ['Sneakers Unisex 42', 'Running Shoes', 'Sandals Pair', 'Slippers Fleece', 'Hiking Boots', 'Kids Light-up Sneakers'] },
  { name: 'Mens', color: '#5a6b8c', icon: '👔', items: ["Men's Tee 3-pack", "Men's Jeans", "Men's Polo", "Men's Hoodie", "Men's Chinos", "Men's Belt Leather"] },
  { name: 'Ladies', color: '#d4788f', icon: '👚', items: ["Ladies' Tee 3-pack", "Ladies' Jeans", "Ladies' Blouse", "Ladies' Cardigan", "Ladies' Leggings", "Ladies' Scarf"] },
  { name: 'Pharmacy', color: '#2f9c8f', icon: '💊', items: ['Pain Reliever 500mg 24pc', 'Vitamin C 1000mg 60pc', 'First Aid Kit 60pc', 'Allergy Tablets 30pc', 'Cough Syrup 100ml', 'Bandages 100pc', 'Antacid Chewables 96pc', 'Electrolyte Powder 10-pack'] },
];

/** One colour per department: it fills the department's shelves, tints its
 *  area and colours its category chip — the categories are the source. */
const WM_COLORS: Record<string, string> = Object.fromEntries([...WM_FOOD_CATS, ...WM_GM_CATS].map((c) => [c.name, c.color]));

export function walmartSpec(): Spec {
  const elements: SpecEl[] = [];

  /* ---------- walls: the plan's outline, then its interior partitions ------- */
  const wall = (pts: [number, number][], height?: number) =>
    elements.push({
      type: 'wall', shape: 'polyline', label: '', geometry: pts,
      ...(height ? { meta: JSON.stringify({ height }) } : {}),
    });
  // The Dairy corner rises above the main back wall, the wine & beer wing runs
  // deeper than the rest of the front, and both entrances are OPEN GAPS in the
  // south edge (never walled over).
  wall([[0.4, 0.4], [21.4, 0.4], [21.4, 3.1], [95.6, 3.1], [95.6, 57.6], [87, 57.6]]);
  wall([[84, 57.6], [70.3, 57.6], [70.3, 61.4], [62.6, 61.4]]);
  wall([[57.4, 61.4], [50, 61.4], [50, 57.6], [46.4, 57.6], [46.4, 61.6], [0.4, 61.6], [0.4, 0.4]]);
  wall([[21.4, 3.1], [21.4, 6.4]]);
  // Interior partitions are low: they read as counters and rooms without
  // walling the 3D view off.
  wall([[72.4, 13.1], [81.3, 13.1], [81.3, 29.5], [72.4, 29.5], [72.4, 13.1]], 2.6);
  wall([[89.6, 3.1], [89.6, 25.6]], 2.6);
  wall([[0.4, 43.4], [7.3, 43.4], [7.3, 47.2], [0.4, 47.2]], 2.6);
  wall([[7.3, 47.2], [7.3, 45.6], [11.6, 45.6], [15.4, 48.6], [15.4, 57.4], [13.6, 57.4]], 1.1);
  wall([[17, 57.6], [17, 52.7], [33.6, 52.7], [33.6, 57.6]], 2.6);
  wall([[36.5, 57.6], [36.5, 53.3]], 1.2);
  wall([[50.2, 57.6], [50.2, 53.3]], 1.2);

  /* ---------- department areas: each the colour of the department it holds -- */
  // A rect's name draws at its centre, so an area whose centre a fixture
  // covers is two rects: the tint, and a named piece on open floor. An area
  // records the department it holds (meta.department): where that differs from
  // its name — "Produce" holding Fresh Produce — the shelves inside it are not
  // badged with it again.
  const zone = (x: number, y: number, w: number, h: number, label: string, color: string, department: string = label) =>
    elements.push({ type: 'zone', shape: 'rect', geometry: { x, y, w, h, rot: 0 }, label, color, meta: JSON.stringify({ department }) });
  const zonePoly = (pts: [number, number][], label: string, color: string, department: string = label) =>
    elements.push({ type: 'zone', shape: 'polygon', geometry: pts, label, color, meta: JSON.stringify({ department }) });
  zone(0.4, 0.4, 21, 9.2, 'Dairy', WM_COLORS['Dairy & Cheese'], 'Dairy & Cheese');

  zone(26.4, 3.3, 32.6, 10.3, 'Meat', WM_COLORS['Meat & Seafood'], 'Meat & Seafood');

  zone(59, 3.3, 15, 10.3, 'Service Meat & Seafood', WM_COLORS['Meat & Seafood'], 'Meat & Seafood');

  zone(76.6, 4.5, 13, 8.4, 'Deli', WM_COLORS['Deli & Cheese'], 'Deli & Cheese');

  zone(81.4, 12.9, 8.2, 15, 'Bakery', WM_COLORS['Bakery']);

  zone(72.4, 13.1, 8.9, 16.4, 'Bakery Kitchen', WM_COLORS['Bakery'], 'Bakery');

  zone(89.6, 3.3, 6, 22.3, 'Offices', WM_OFFICE);
  zone(0.4, 10, 9.5, 23, '', WM_COLORS['Personal Care'], 'Personal Care');

  zone(0.4, 33, 9.5, 4.4, 'Health & Beauty', WM_COLORS['Personal Care'], 'Personal Care');

  zone(19.4, 9.4, 9, 32.4, 'Frozen', WM_COLORS['Frozen']);
  zone(0.4, 37.6, 1, 3.4, '', WM_COLORS['Pharmacy'], 'Pharmacy');

  zone(1.4, 37.6, 8.4, 3.4, 'Pharmacy', WM_COLORS['Pharmacy']);
  zone(0.4, 41, 9.4, 6.2, '', WM_COLORS['Pharmacy'], 'Pharmacy');
  zone(6.5, 45.8, 9.1, 15.8, '', WM_COLORS['Adult Beverages'], 'Adult Beverages');

  zone(0.4, 47.4, 6.1, 3, 'Wine & Spirits', WM_COLORS['Adult Beverages'], 'Adult Beverages');
  zone(0.4, 50.4, 6.1, 11.2, '', WM_COLORS['Adult Beverages'], 'Adult Beverages');

  zone(17, 44.7, 35.3, 7.3, 'Checkouts', WM_CHECKOUT);

  zone(17, 52.7, 16.6, 4.9, 'Restrooms', WM_RESTROOM);

  zone(36, 52, 15.3, 5.6, 'Customer Service', WM_SERVICE);

  zonePoly([[61.6, 43.6], [65.3, 43.3], [65.3, 53.4], [53.4, 53.4], [53.4, 48.4], [58.3, 48.4], [58.3, 48.2]], 'Bank', WM_BANK);

  zonePoly([[50.6, 49], [51.2, 45.9], [53, 43.7], [55.6, 43.1], [58.3, 44.1], [58.3, 48.4], [53.4, 48.4], [53.4, 49]], 'Floral', WM_COLORS['Outdoor & Garden'], 'Outdoor & Garden');

  zone(72.6, 37.8, 23, 2.9, 'Produce', WM_COLORS['Fresh Produce'], 'Fresh Produce');
  zone(66, 40.7, 29.6, 16.9, '', WM_COLORS['Fresh Produce'], 'Fresh Produce');

  // checkout lanes, and the self-checkout kiosks between the two banks
  for (const x of [18.6, 21.2, 23.8, 26.3, 28.8, 38.6, 41, 43.8, 46.3, 49]) zone(x, 45.5, 1.35, 5.5, '', WM_CHECKOUT);
  for (const x of [31.1, 35.8]) {
    zone(x, 45.6, 1.1, 2.2, '', WM_CHECKOUT);
    zone(x, 48.9, 1.1, 2.1, '', WM_CHECKOUT);
  }

  /* ---------- aisles, numbered as the plan numbers them (there is no 12) ---- */
  const aisle = (n: number, x: number, y0: number, y1: number) =>
    elements.push({ type: 'aisle', shape: 'polyline', geometry: [[x, y0], [x, y1]], label: `Aisle ${n}` });
  aisle(1, 68, 16, 30.6);
  aisle(2, 64.1, 16, 30.6);
  aisle(3, 60.3, 16, 34.6);
  aisle(4, 56.4, 16, 34.6);
  aisle(5, 52.6, 16, 41.5);
  aisle(6, 48.7, 16, 41.5);
  aisle(7, 44.9, 16, 41.5);
  aisle(8, 41, 16, 41.5);
  aisle(9, 37.2, 16, 41.5);
  aisle(10, 33.3, 16, 41.5);
  aisle(11, 29.2, 16, 41.5);
  aisle(13, 18.5, 10, 41.5);
  aisle(14, 14.2, 10, 41.5);
  aisle(15, 10.3, 10, 41.5);
  aisle(16, 6.4, 11.2, 33.2);
  aisle(17, 2.7, 11.2, 36.5);

  // doors + points of interest — created AFTER the areas so the markers (and
  // their labels) sit on top and stay selectable
  elements.push({ type: 'entrance', shape: 'point', geometry: { x: 61.6, y: 60.5 }, label: 'Main Entrance' });
  elements.push({ type: 'entrance', shape: 'point', geometry: { x: 84.3, y: 56.9 }, label: 'Market Entrance' });
  elements.push({ type: 'poi', shape: 'point', geometry: { x: 1.2, y: 44.3 }, label: 'Drive-Up Pharmacy' });

  /* ---------- shelves: EVERY shelf is one titled group --------------------- */
  // [label, category, centre x, centre y, run length, depth, rotation, face, height]
  // A run is a long rect — its width runs along the shelf and its rotation
  // turns it (a vertical run is rot 90, the way the editor's rotate tool makes
  // one), the frame the app's shelf logic is written in. `face` is the side
  // shoppers stand on (N/S/E/W, a diagonal like SW, or C for the middle of a
  // double-sided gondola): the group's pin goes a quarter-depth in from it.
  const groups: { label: string; cat: string; cx: number; cy: number; len: number; depth: number; rot: number; face: string; height?: number }[] = [];
  const g = (label: string, cat: string, cx: number, cy: number, len: number, depth: number, rot: number = 0, face: string = 'C', height?: number) =>
    groups.push({ label, cat, cx, cy, len, depth, rot, face, height });

  // Dairy — the yellow corner: two wall coolers and an island
  g('Milk & Cream', 'Dairy & Cheese', 9.75, 1.25, 15.5, 1, 0, 'S', 2.2);
  g('Yogurt & Cheese', 'Dairy & Cheese', 1.25, 8.6, 13.4, 0.9, 90, 'E', 2.2);
  g('Butter, Eggs & Cream', 'Dairy & Cheese', 10.85, 6.5, 11.1, 1.8, 0);
  g('Ground Meat & Pork', 'Meat & Seafood', 32.1, 6.15, 10.6, 1.3, 0, 'S', 2.2);
  g('Steaks & Roasts', 'Meat & Seafood', 42.8, 6.15, 10.6, 1.3, 0, 'S', 2.2);
  g('Chicken & Turkey', 'Meat & Seafood', 53.4, 6.15, 10.6, 1.3, 0, 'S', 2.2);
  g('Service Meat & Seafood', 'Meat & Seafood', 66.6, 5.8, 13.6, 1.2, 0, 'S', 2.2);
  g('Family Pack Meat', 'Meat & Seafood', 36.95, 11.1, 11.3, 2, 0, 'C', 1.3);
  g('Chicken Cuts & Wings', 'Meat & Seafood', 51.75, 11.1, 11.3, 2, 0, 'C', 1.3);
  g('Seafood & Shellfish', 'Meat & Seafood', 63.9, 11.1, 6.2, 2, 0, 'C', 1.3);

  // Deli + Bakery — the run down the right: the counter, the diagonal corner, the wall strip
  g('Deli Counter', 'Deli & Cheese', 80.25, 5.85, 6.3, 1.1, 0, 'S', 1.1);
  g('Deli Cases', 'Deli & Cheese', 85.9, 7.75, 5.2, 1, 42.6, 'SW', 2.2);
  g('Sliced Meats & Cheese', 'Deli & Cheese', 88.1, 12.8, 5, 1, 90, 'W', 2.2);
  g('Bakery Bread & Rolls', 'Bakery', 88.1, 19.3, 7.6, 1, 90, 'W', 2.2);
  g('Donuts, Cakes & Pastries', 'Bakery', 90.05, 25.05, 4.5, 1, 45, 'SW', 2.2);

  // Salad bar and bulk foods
  g('Salad Bar', 'Fresh Produce', 83.1, 33.9, 8.6, 2.4, 75, 'W', 1.2);
  g('Bulk Foods', 'Pantry', 91.75, 33, 9.6, 1.5, 90, 'W', 2.2);

  // Produce — the wall (angled top, straight bottom), two racks, the tables;
  // the coffee bar and the floral nook
  g('Lettuce & Spinach', 'Fresh Produce', 92.7, 40.45, 5.5, 1.3, 52, 'SW', 2.2);
  g('Fresh Juices & Cut Fruit', 'Drinks', 92.8, 47.25, 7.5, 1.3, 90, 'W', 2.2);
  g('Potatoes & Onions', 'Fresh Produce', 66.2, 36.85, 14.4, 1.3, 315, 'SE');
  g('Herbs & Aromatics', 'Fresh Produce', 70, 40, 12, 1.3, 322, 'SE');
  g('Melons & Citrus', 'Fresh Produce', 73.95, 44.7, 2.9, 2.6, 0, 'C', 1.2);
  g('Berries & Grapes', 'Fresh Produce', 79.2, 41.95, 4.2, 2.1, 0, 'S', 1.2);
  g('Apples & Pears', 'Fresh Produce', 89.9, 44.55, 2.9, 2.8, 90, 'N', 1.2);
  g('Tomatoes & Peppers', 'Fresh Produce', 85.5, 46.6, 3.4, 3.4, 45, 'SW', 1.2);
  g('Broccoli, Cauliflower & Vegetables', 'Fresh Produce', 77.2, 50.7, 4.6, 4.2, 90, 'E', 1.2);
  g('Root Vegetables', 'Fresh Produce', 83.85, 51.55, 4.5, 4.1, 0, 'S', 1.2);
  g('Mushrooms & Corn', 'Fresh Produce', 72.3, 51.85, 3, 2.9, 0, 'W', 1.2);
  g('Avocados & Exotics', 'Fresh Produce', 70.9, 47.5, 2.8, 2.6, 0, 'C', 1.2);
  g('Coffee & Smoothie Bar', 'Drinks', 88.9, 53.7, 5.6, 1.2, 100, 'W', 1.1);
  g('Floral', 'Outdoor & Garden', 54.8, 44, 5.2, 1, 0, 'S', 1.1);

  // Health & Beauty — the wall shelf and two gondolas (aisles 16–17)
  g('Cosmetics & Beauty', 'Personal Care', 1.2, 27.15, 19.5, 0.8, 90, 'E', 2.2);
  g('Hair & Skin Care', 'Personal Care', 4.5, 22, 21.6, 1.3, 90);
  g('Oral Care & Deodorant', 'Personal Care', 8.35, 22, 21.6, 1.3, 90);

  /** A vertical run split top→bottom into equal titled groups. */
  const column = (cx: number, y0: number, y1: number, list: [string, string][], face: string = 'C', depth: number = 1.3, height?: number) => {
    const len = +((y1 - y0) / list.length).toFixed(3);
    list.forEach(([label, cat], i) => g(label, cat, cx, +(y0 + (i + 0.5) * len).toFixed(3), len, depth, 90, face, height));
  };

  // the greeting-cards gondola (aisle 15) and its neighbour (aisle 13–14)
  column(12.25, 10, 41.5, [
    ['Greeting Cards', 'Celebrate'],
    ['Party & Celebrate', 'Celebrate'],
    ['Books & Magazines', 'Books & Media'],
    ['Arts & Crafts', 'Arts & Crafts'],
  ]);
  column(16.1, 10, 41.5, [
    ["Men's", 'Mens'],
    ["Ladies'", 'Ladies'],
    ['Boys', 'Boys'],
    ['Girls', 'Girls'],
    ['Shoes', 'Shoes'],
  ]);

  // Frozen — two cooler walls with the wide frozen aisle between them; the doors face it
  column(21.1, 10, 40.9, [
    ['Frozen Pizza & Meals', 'Frozen'],
    ['Ice Cream & Novelties', 'Frozen'],
    ['Frozen Breakfast & Bread', 'Frozen'],
  ], 'E', 1.9, 2.2);

  // Frozen — two cooler walls with the wide frozen aisle between them; the doors face it
  column(26.7, 10, 40.9, [
    ['Frozen Vegetables & Fruit', 'Frozen'],
    ['Frozen Meat & Seafood', 'Frozen'],
    ['Frozen Family Meals', 'Frozen'],
  ], 'W', 1.9, 2.2);

  /** A double-sided gondola: a west run facing the aisle on its left and an
   *  east run facing the aisle on its right, each side with its own groups. */
  const gondola = (cx: number, y0: number, y1: number, west: [string, string][], east: [string, string][]) => {
    const side = (list: [string, string][], x: number, face: string) => {
      const len = +((y1 - y0) / list.length).toFixed(3);
      list.forEach(([label, cat], k) => g(label, cat, x, +(y0 + (k + 0.5) * len).toFixed(3), len, 0.65, 90, face));
    };
    side(west, +(cx - 0.325).toFixed(3), 'W');
    side(east, +(cx + 0.325).toFixed(3), 'E');
  };
  // Centre aisles 1–11. The right-hand runs step shorter toward Produce,
  // exactly as the plan draws them. [centre x, from y, to y, west, east]
  gondola(31.4, 16, 41.5, [
    ['Hardware & Fasteners', 'Tools & Hardware'],
    ['Seasonal Décor', 'Seasonal'],
    ['Patio & Garden', 'Outdoor & Garden'],
  ], [
    ['Tools & Hardware', 'Tools & Hardware'],
    ['Auto Accessories', 'Auto Accessories'],
    ['Motor Oil & Car Care', 'Auto Care'],
  ]);
  gondola(35.25, 16, 41.5, [
    ['Camping & Outdoors', 'Sports & Outdoors'],
    ['Sports & Fitness', 'Sports & Outdoors'],
    ['Home Office & School', 'Home Office'],
  ], [
    ['Batteries & Accessories', 'Electronics'],
    ['Computers & Mobile', 'Electronics'],
    ['TV & Audio', 'Electronics'],
  ]);
  gondola(39.1, 16, 41.5, [
    ['Ride-Ons & Outdoor Toys', 'Toys & Games'],
    ['Games & Puzzles', 'Toys & Games'],
    ['Toys', 'Toys & Games'],
  ], [
    ['Food Storage & Containers', 'Kitchen & Dining'],
    ['Dinnerware & Drinkware', 'Kitchen & Dining'],
    ['Seasonal & Holiday', 'Seasonal'],
  ]);
  gondola(42.95, 16, 41.5, [
    ['Storage & Organization', 'Home & Bedding'],
    ['Bath & Towels', 'Home & Bedding'],
    ['Bedding', 'Home & Bedding'],
  ], [
    ['Small Appliances', 'Kitchen & Dining'],
    ['Kitchen Tools & Gadgets', 'Kitchen & Dining'],
    ['Cookware & Bakeware', 'Kitchen & Dining'],
  ]);
  gondola(46.8, 16, 41.5, [
    ['Baby Bath & Care', 'Baby'],
    ['Formula & Baby Food', 'Baby'],
    ['Diapers & Wipes', 'Baby'],
  ], [
    ['Pet Supplies', 'Pet Care'],
    ['Cat Food & Litter', 'Pet Care'],
    ['Dog Food & Treats', 'Pet Care'],
  ]);
  gondola(50.65, 16, 41.5, [
    ['Cleaners & Air Care', 'Paper & Cleaning'],
    ['Dish & Dishwasher', 'Paper & Cleaning'],
    ['Laundry & Fabric Care', 'Paper & Cleaning'],
  ], [
    ['Paper Plates & Cups', 'Paper & Cleaning'],
    ['Paper Towels & Bath Tissue', 'Paper & Cleaning'],
    ['Trash Bags & Food Storage', 'Paper & Cleaning'],
  ]);
  gondola(54.5, 16, 41.5, [
    ['Iced Tea & Lemonade', 'Drinks'],
    ['Water & Sports Drinks', 'Drinks'],
    ['Soda & Energy Drinks', 'Drinks'],
  ], [
    ['Spices & Extracts', 'Pantry'],
    ['Oils & Cooking Sprays', 'Pantry'],
    ['Peanut Butter & Spreads', 'Pantry'],
  ]);
  gondola(58.35, 16, 34.6, [
    ['Baking, Flour & Sugar', 'Pantry'],
    ['Condiments & Sauces', 'Pantry'],
  ], [
    ['Tomatoes, Broth & Chili', 'Pantry'],
    ['Pasta & Noodles', 'Pantry'],
  ]);
  gondola(62.2, 16, 34.6, [
    ['Canned Vegetables & Fruit', 'Pantry'],
    ['Canned Soup & Meals', 'Pantry'],
  ], [
    ['Coffee', 'Breakfast & Coffee'],
    ['Tea & Hot Cocoa', 'Breakfast & Coffee'],
  ]);
  gondola(66.05, 16, 30.6, [
    ['Oatmeal & Breakfast', 'Breakfast & Coffee'],
    ['Cereal', 'Breakfast & Coffee'],
  ], [
    ['Cookies & Crackers', 'Snacks & Candy'],
    ['Snack Cakes & Bars', 'Snacks & Candy'],
  ]);
  gondola(69.9, 16, 30.6, [
    ['Tortilla Chips & Salsa', 'Snacks & Candy'],
    ['Chips & Pretzels', 'Snacks & Candy'],
  ], [
    ['Candy & Chocolate', 'Snacks & Candy'],
    ['Nuts, Jerky & Trail Mix', 'Snacks & Candy'],
  ]);

  // Pharmacy counter, then wine & beer in the corner
  g('Pharmacy', 'Pharmacy', 3.55, 40.45, 6.4, 0.8, 50, 'NE', 1.1);
  g('Beer', 'Adult Beverages', 1.45, 56.5, 9, 1.3, 90, 'E', 2.2);
  g('Wine', 'Adult Beverages', 7.3, 54.75, 8.1, 1.2, 90);
  g('Spirits', 'Adult Beverages', 10.5, 54.5, 8.8, 1.2, 90);
  g('Chilled Wine & Seltzer', 'Adult Beverages', 9.25, 60.75, 7.1, 0.9, 0, 'N', 2.2);

  for (const gr of groups) {
    elements.push({
      type: 'shelf',
      shape: 'rect',
      geometry: { x: +(gr.cx - gr.len / 2).toFixed(3), y: +(gr.cy - gr.depth / 2).toFixed(3), w: gr.len, h: gr.depth, rot: gr.rot },
      label: gr.label,
      color: WM_COLORS[gr.cat], // the department's colour: shelves, area and chip agree
      meta: JSON.stringify({
        department: gr.cat,
        planWidth: Math.round(Math.min(6, Math.max(1, gr.len)) * 10) / 10,
        ...(gr.height ? { height: gr.height } : {}),
      }),
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

  /* ---------- stock: every item lives in its section's group --------------- */
  // A shopper searching any catalog item must land in a group — an item with
  // no facing lists as "out of stock" in the viewer. Each category's full
  // pool is split evenly across its groups: the first item carries the
  // group's ONE map pin, the rest are planogram-only facings spread along the
  // shelf and staggered across the three levels.
  const locations: Spec['locations'] = [];
  const groupsOfCat: Record<string, number> = {};
  for (const gr of groups) groupsOfCat[gr.cat] = (groupsOfCat[gr.cat] ?? 0) + 1;
  const catGroupIdx: Record<string, number> = {};
  /** A point on a run: `along` (0..1) of its length, `across` (0..1) of its depth, in the rect's own frame. */
  const onRun = (gr: { cx: number; cy: number; len: number; depth: number; rot: number }, along: number, across: number) => {
    const a = (gr.rot * Math.PI) / 180;
    const dx = (along - 0.5) * gr.len;
    const dy = (across - 0.5) * gr.depth;
    return {
      x: +(gr.cx + dx * Math.cos(a) - dy * Math.sin(a)).toFixed(3),
      y: +(gr.cy + dx * Math.sin(a) + dy * Math.cos(a)).toFixed(3),
    };
  };
  const FACE: Record<string, [number, number]> = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0], NE: [1, -1], SW: [-1, 1], SE: [1, 1] };
  /** Where a run's group pin sits across its depth. A pin in the middle of a
   *  run is as near one long edge as the other and would anchor on an
   *  arbitrary one, so it goes a quarter-depth in from the face shoppers
   *  stand on. A double-sided gondola keeps the middle: its route then ends on
   *  the side the shopper arrives from. */
  const across = (gr: { face: string; rot: number }) => {
    if (gr.face === 'C') return 0.5;
    // the run's own top edge, turned by its rotation: which world side it faces
    const a = (gr.rot * Math.PI) / 180;
    const [wx, wy] = FACE[gr.face];
    return Math.sin(a) * wx - Math.cos(a) * wy > 0 ? 0.25 : 0.75;
  };
  for (const gr of groups) {
    const pool = poolByCat[gr.cat];
    const pinSpan = Math.round(Math.min(6, Math.max(2, gr.len)) * 10) / 10;
    const at = across(gr);
    // this group's even share of the category's catalogue (earlier groups
    // absorb the remainder items)
    const gi = catGroupIdx[gr.cat] ?? 0;
    catGroupIdx[gr.cat] = gi + 1;
    const total = groupsOfCat[gr.cat];
    const share = Math.floor(pool.length / total);
    const start = gi * share + Math.min(gi, pool.length % total);
    const mine = pool.slice(start, start + share + (gi < pool.length % total ? 1 : 0));
    // the group pin — ONE per group, spanning the group's plan length
    locations.push({ product: mine[0] ?? pool[gi % pool.length], ...onRun(gr, 0.5, at), level: 2, w: 1, pinW: pinSpan, pinH: 0.3, groupPin: 1 });
    const n = Math.max(1, mine.length - 1);
    mine.slice(1).forEach((p, j) => {
      locations.push({ product: p, ...onRun(gr, (j + 0.5) / n, at), level: (j % 3) + 1, w: 1, pinW: 0.3, groupOnly: 1 });
    });
  }

  return {
    slug: 'walmart-example', name: 'Walmart Example', address: '1 Supercenter Way',
    description:
      'Big-box example traced from the reference floor plan: every area is a department in its own colour and every shelf one titled group — the map shows ONE pin per group, the items live only inside its planogram. The centre gondolas are double-sided, each side with its own groups.',
    hours: '6am–11pm daily', floorName: 'Main floor', w: WW, h: WH,
    elements, categories: allCats, products, locations, skuPrefix: 'WMX', skuPad: 6,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   Home Depot Example — the big-box hardware reference plan: lumber and paint
   up top, tool/plumbing/electrical aisles down the middle, appliances and
   flooring on the right, the garden center yard in the bottom-right corner.
   Same group model as Walmart: one titled group per shelf, every catalog item
   facings inside its section's planogram.
   ══════════════════════════════════════════════════════════════════════════ */

const HD_W = 80;
const HD_H = 52;
const HD_ORANGE = '#d97a2b';
const HD_GRAY = '#9aa0a6';
const HD_GREEN = '#2f7d32';

const HD_CATS: SpecCat[] = [
  { name: 'Power Tools', color: '#c2453a', icon: '🪚', items: ['Cordless Drill Kit 18V', 'Circular Saw 185mm', 'Impact Driver 18V', 'Oscillating Multi-Tool', 'Angle Grinder 115mm', 'Reciprocating Saw', 'Rotary Hammer SDS', 'Belt Sander 75mm', 'Orbital Sander 125mm', 'Nail Gun 16ga'] },
  { name: 'Hand Tools', color: '#8a5fd4', icon: '🔧', items: ['Claw Hammer 16oz', 'Screwdriver Set 12pc', 'Adjustable Wrench 250mm', 'Pliers Set 3pc', 'Tape Measure 8m', 'Utility Knife', 'Spirit Level 600mm', 'Socket Set 40pc', 'Hex Key Set Metric', 'Stud Finder'] },
  { name: 'Paint', color: '#e4572e', icon: '🎨', items: ['Interior Paint 5L Eggshell', 'Exterior Paint 5L Satin', 'Primer Undercoat 3.8L', 'Wood Stain 946ml', 'Roller Frame 230mm', 'Roller Covers 3pc', 'Brush Set 3pc', 'Painter Tape 50m', 'Drop Cloth 3.6×2.7m', 'Paint Tray Kit'] },
  { name: 'Lumber', color: '#a4713d', icon: '🪵', items: ['Stud 45×90×2400mm', 'Plywood Sheet 18mm', 'MDF Board 12mm', 'Decking Board 3600mm', 'Fence Panel 1800mm', 'Dado Rail 2400mm', 'Architrave Set 2400mm', 'OSB Sheet 11mm', 'Plasterboard 12.5mm', 'Cedar Post 2400mm'] },
  { name: 'Plumbing', color: '#3b6fd4', icon: '🚰', items: ['PVC Pipe 32mm 3m', 'Copper Pipe 15mm 2m', 'Pipe Elbow 32mm', 'Ball Valve 15mm', 'Tap Washer Assortment', 'Bottle Trap 40mm', 'Toilet Fill Valve', 'Rain Shower Head', 'Hose Bib 20mm', 'Pipe Wrench 350mm'] },
  { name: 'Electrical', color: '#e8a33d', icon: '⚡', items: ['Twin & Earth Cable 10m', 'Conduit 20mm 2m', 'Double Socket Outlet', 'Light Switch Plate', 'Junction Box IP65', 'Circuit Breaker 20A', 'LED Downlight 9W', 'Wireless Doorbell Kit', 'Extension Reel 25m', 'Digital Multimeter'] },
  { name: 'Lighting', color: '#f2c94c', icon: '💡', items: ['LED Shop Light 1.2m', 'Pendant Lamp Kit', 'Ceiling Fan 1200mm', 'Track Light 3-head', 'Under-Cabinet Strip 600mm', 'Motion Sensor Light', 'Portable Work Light 20W', 'Smart Bulb 2-pack', 'Flood Light 30W', 'Vanity Bar 4-light'] },
  { name: 'Appliances', color: '#5b6b5f', icon: '🧺', items: ['Dishwasher 600mm', 'Refrigerator 500L', 'Washer 8kg', 'Dryer 7kg', 'Rangehood 600mm', 'Electric Oven 600mm', 'Induction Cooktop 4-zone', 'Microwave 30L', 'Chest Freezer 200L', 'Portable AC 9000BTU'] },
  { name: 'Hardware', color: '#7950f2', icon: '🔩', items: ['Wood Screws 4×40 200pc', 'Masonry Anchors 100pc', 'Cabinet Hinge Pair', 'Door Handle Set', 'Hasp & Staple 150mm', 'Padlock 50mm', 'Drawer Slides Pair', 'Gate Hinge Set', 'Turnbuckle M8', 'Eye Bolt M8 4pc'] },
  { name: 'Storage & Organization', color: '#4a7f6e', icon: '🗄️', items: ['Steel Shelving 5-tier', 'Plastic Tote 45L', 'Tool Box 480mm', 'Stackable Bin 4-pack', 'Garage Cabinet Steel', 'Pegboard 600×900', 'Crate 60L Foldable', 'Ceiling Storage Rack'] },
  { name: 'Lawn & Garden', color: '#57a86c', icon: '🌱', items: ['Garden Hose 20m', 'Oscillating Sprinkler', 'Petrol Lawn Mower', 'Hedge Trimmer 550mm', 'Potting Mix 40L', 'Planter Pot 300mm', 'Garden Trowel', 'Pruning Shears', 'Wheelbarrow 90L', 'Grass Seed 2kg'] },
  { name: 'Grills & Outdoor', color: '#b0413e', icon: '🔥', items: ['Gas BBQ 4-Burner', 'Charcoal Kettle 570mm', 'Electric Smoker', 'BBQ Tool Set 3pc', 'Propane Tank 9kg', 'Outdoor Pizza Oven', 'Steel Fire Pit', 'Gas Patio Heater', 'Rotomold Cooler 28L', 'Gazebo 3×3m'] },
  { name: 'Concrete', color: '#5b6b5f', icon: '🧱', items: ['Cement Bag 25kg', 'Mortar Mix 20kg', 'Concrete Mix 20kg', 'Post Crete 20kg', 'Self-Levelling Compound 20kg', 'Paver Base Sand 20kg', 'Render Mix 20kg', 'Crack Filler 1L'] },
  { name: 'Roofing', color: '#7d9e3a', icon: '🏚️', items: ['Corrugated Sheet 2400mm', 'Ridge Cap Steel', 'Gutter 3m', 'Downpipe 2m', 'Gutter Brackets 10pc', 'Roofing Screws 100pc', 'Roof Felt 10m Roll', 'Soffit Vent 100mm'] },
  { name: 'Flooring', color: '#a4713d', icon: '🧹', items: ['Laminate Planks 2.2m²', 'Vinyl Roll 3m', 'Engineered Oak 1.5m²', 'Tile Backer Board', 'Floor Underlay 10m²', 'Carpet Tiles 20pc', 'Floor Scraper 200mm', 'Skirting 2400mm'] },
  { name: 'Safety & Workwear', color: '#f2c94c', icon: '⛑️', items: ['Hard Hat', 'Safety Goggles', 'Leather Work Gloves', 'Hi-Vis Vest', 'Ear Defenders', 'Dust Mask FFP2 5pc', 'Steel Toe Boots', 'Gel Knee Pads', 'First Aid Kit 60pc', 'Fall Arrest Harness'] },
  { name: 'Doors & Windows', color: '#8a5fd4', icon: '🚪', items: ['Interior Door 800mm', 'Exterior Door 900mm', 'Door Frame Kit', 'Window 900×600', 'Screen Door 800mm', 'Door Closer', 'Threshold Strip 900mm', 'Weather Strip Roll'] },
  { name: 'Kitchens & Bath', color: '#c98a3d', icon: '🛁', items: ['Sink Mixer Chrome', 'Vanity Basin 600mm', 'Pull-out Kitchen Tap', 'Towel Rail Chrome', 'Shower Screen 900mm', 'Bath Panel 1700mm', 'Close-Coupled WC', 'Cabinet Pulls 10pc'] },
  { name: 'Seasonal', color: '#7d9e3a', icon: '🎄', items: ['Fairy Lights 20m', 'Christmas Tree 180cm', 'Halloween Pumpkin Decor', 'Snow Shovel', 'De-Icer Salt 10kg', 'Leaf Blower', 'Gazebo Side Panel', 'Advent Calendar'] },
];

export function homeDepotSpec(): Spec {
  const elements: SpecEl[] = [];

  // the outline: plain rectangle, two entrance gaps on the south edge and the
  // garden-center exit cutting the bottom-right corner
  elements.push({
    type: 'wall',
    shape: 'polyline',
    label: '',
    geometry: [
      [0.4, 0.4], [79.6, 0.4], [79.6, 51.6],
      [64, 51.6], [60, 51.6],
      [34, 51.6], [30, 51.6],
      [0.4, 51.6], [0.4, 0.4],
    ],
  });

  const zone = (x: number, y: number, w: number, h: number, label: string, color = HD_ORANGE) =>
    elements.push({ type: 'zone', shape: 'rect', geometry: { x, y, w, h, rot: 0 }, label, color, meta: JSON.stringify({ department: label }) });
  const poi = (x: number, y: number, label: string) =>
    elements.push({ type: 'poi', shape: 'point', geometry: { x, y }, label });

  // top band
  zone(2, 1, 26, 8, 'Lumber & Building Materials', HD_GRAY);
  zone(29, 1, 14, 8, 'Hardware & Fasteners');
  zone(44, 1, 10, 8, 'Key & Glass Desk', HD_GRAY);
  zone(55, 1, 23, 8, 'Paint & Décor');
  // middle aisles
  zone(2, 10, 30, 6, 'Tools');
  zone(33, 10, 22, 6, 'Electrical & Lighting');
  zone(56, 10, 22, 6, 'Appliances', HD_GRAY);
  zone(2, 17, 30, 6, 'Plumbing', '#3b6fd4');
  zone(33, 17, 22, 6, 'Building Supplies', HD_GRAY);
  zone(56, 17, 22, 6, 'Flooring & Rugs');
  zone(2, 24, 30, 6, 'Seasonal & Grills');
  zone(33, 24, 22, 6, 'Doors & Windows', HD_GRAY);
  zone(56, 24, 22, 6, 'Kitchens & Bath', HD_GRAY);
  zone(2, 31, 30, 6, 'Lawn & Garden', HD_GREEN);
  // bottom band
  zone(2, 40, 22, 8, 'Outdoor Yard', HD_GREEN);
  zone(30, 44, 20, 4.5, 'Checkout', HD_GRAY);
  zone(58, 40, 20, 10, 'Garden Center', HD_GREEN);
  poi(46, 9.5, 'Pro Desk');
  poi(5, 9.5, 'Tool Rental');
  poi(26, 49.5, 'Cart bay');

  elements.push({ type: 'entrance', shape: 'point', geometry: { x: 32, y: 50.9 }, label: 'Entrance' });
  elements.push({ type: 'entrance', shape: 'point', geometry: { x: 62, y: 50.9 }, label: 'Entrance' });
  elements.push({ type: 'exit', shape: 'point', geometry: { x: 78, y: 45 }, label: 'Garden Center' });

  /* shelves: every shelf is one titled group */
  const groups: { label: string; cat: string; x: number; y: number; w: number; h: number }[] = [];
  const g = (label: string, cat: string, x: number, y: number, w: number, h: number) =>
    groups.push({ label, cat, x, y, w, h });

  g('Framing Lumber', 'Lumber', 3, 2.2, 11, 1.4);
  g('Sheet & Panel Goods', 'Lumber', 15.5, 2.2, 11.5, 1.4);
  g('Hardware & Fasteners', 'Hardware', 30, 2.2, 12, 1.4);
  g('Interior Paint', 'Paint', 56, 2.2, 10.5, 1.4);
  g('Exterior Paint & Stain', 'Paint', 67, 2.2, 10, 1.4);
  g('Power Tools', 'Power Tools', 3, 11.5, 13.5, 1.4);
  g('Hand Tools', 'Hand Tools', 18, 11.5, 13.5, 1.4);
  g('Electrical Supplies', 'Electrical', 34, 11.5, 10, 1.4);
  g('Lighting & Fans', 'Lighting', 45, 11.5, 9.5, 1.4);
  g('Major Appliances', 'Appliances', 57, 11.5, 9, 1.4);
  g('Laundry & Kitchen', 'Appliances', 67.5, 11.5, 9.5, 1.4);
  g('Pipes & Fittings', 'Plumbing', 3, 18.5, 13.5, 1.4);
  g('Bath & Kitchen Fittings', 'Plumbing', 18, 18.5, 13.5, 1.4);
  g('Concrete & Mortar', 'Concrete', 34, 18.5, 10, 1.4);
  g('Roofing & Gutters', 'Roofing', 45, 18.5, 9.5, 1.4);
  g('Flooring & Rugs', 'Flooring', 57, 18.5, 9, 1.4);
  g('Storage & Organization', 'Storage & Organization', 67.5, 18.5, 9.5, 1.4);
  g('Grills & Outdoor Cooking', 'Grills & Outdoor', 3, 25.5, 13.5, 1.4);
  g('Seasonal Décor', 'Seasonal', 18, 25.5, 13.5, 1.4);
  g('Doors & Windows', 'Doors & Windows', 34, 25.5, 10, 1.4);
  g('Safety & Workwear', 'Safety & Workwear', 45, 25.5, 9.5, 1.4);
  g('Kitchens & Bath', 'Kitchens & Bath', 57, 25.5, 9, 1.4);
  g('Lawn & Garden', 'Lawn & Garden', 3, 32.5, 13.5, 1.4);
  g('Outdoor Power Equipment', 'Lawn & Garden', 18, 32.5, 13.5, 1.4);
  g('Garden Center', 'Lawn & Garden', 66, 41.5, 1.4, 6); // vertical, in the garden zone

  for (const gr of groups) {
    elements.push({
      type: 'shelf',
      shape: 'rect',
      geometry: { x: gr.x, y: gr.y, w: gr.w, h: gr.h, rot: 0 },
      label: gr.label,
      color: '',
      meta: JSON.stringify({ department: gr.cat, planWidth: Math.round(Math.min(6, Math.max(1, Math.max(gr.w, gr.h))) * 10) / 10 }),
    });
  }

  const products: { name: string; category: string; brand: string; image?: string }[] = [];
  const poolByCat: Record<string, number[]> = {};
  for (const c of HD_CATS) {
    poolByCat[c.name] = [];
    for (const base of c.items) {
      poolByCat[c.name].push(products.length);
      products.push({ name: base, category: c.name, brand: BRANDS[products.length % BRANDS.length], image: PHOTOS[base] ?? '' });
    }
  }

  // every item faces inside its section's group (same model as Walmart)
  const locations: Spec['locations'] = [];
  const groupsOfCat: Record<string, number> = {};
  for (const gr of groups) groupsOfCat[gr.cat] = (groupsOfCat[gr.cat] ?? 0) + 1;
  const catGroupIdx: Record<string, number> = {};
  for (const gr of groups) {
    const pool = poolByCat[gr.cat];
    const vertical = gr.h > gr.w;
    const pinSpan = Math.round(Math.min(6, Math.max(2, Math.max(gr.w, gr.h))) * 10) / 10;
    const center = { x: gr.x + gr.w / 2, y: gr.y + gr.h / 2 };
    const gi = catGroupIdx[gr.cat] ?? 0;
    catGroupIdx[gr.cat] = gi + 1;
    const total = groupsOfCat[gr.cat];
    const share = Math.floor(pool.length / total);
    const start = gi * share + Math.min(gi, pool.length % total);
    const mine = pool.slice(start, start + share + (gi < pool.length % total ? 1 : 0));
    locations.push({ product: mine[0] ?? pool[gi % pool.length], x: center.x, y: center.y, level: 2, w: 1, pinW: pinSpan, pinH: 0.3, groupPin: 1 });
    const n = Math.max(1, mine.length - 1);
    mine.slice(1).forEach((p, j) => {
      const at = ((j + 0.5) / n) * (vertical ? gr.h : gr.w);
      locations.push({
        product: p,
        x: vertical ? gr.x + gr.w / 2 : gr.x + at,
        y: vertical ? gr.y + at : gr.y + gr.h / 2,
        level: (j % 3) + 1, w: 1, pinW: 0.3, groupOnly: 1,
      });
    });
  }

  return {
    slug: 'home-depot-example', name: 'Home Depot Example', address: '1 Warehouse Row',
    description:
      'Hardware-store example: lumber and paint along the top, tool and trade aisles down the middle, appliances and flooring on the right, and the garden center yard in the corner. Every shelf is one titled item group and every catalog item faces inside its planogram.',
    hours: '6am–10pm daily', floorName: 'Main floor', w: HD_W, h: HD_H,
    elements, categories: HD_CATS, products, locations, skuPrefix: 'HDX', skuPad: 5,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   Corner Store Example — the small-floorplan reference: cooler wall along the
   top, two center snack shelves, coffee corner, hot-food case, essentials on
   the back wall and an ice-cream freezer by the door.
   ══════════════════════════════════════════════════════════════════════════ */

const CS_W = 16;
const CS_H = 12;

const CS_CATS: SpecCat[] = [
  { name: 'Soft Drinks', color: '#e4572e', icon: '🥤', items: ['Cola 500ml', 'Lemon-Lime Soda 500ml', 'Orange Soda 500ml', 'Sparkling Water 500ml', 'Still Water 600ml', 'Iced Tea Lemon 500ml', 'Cloudy Lemonade 500ml', 'Cola 1.5L'] },
  { name: 'Milk & Dairy', color: '#3b6fd4', icon: '🥛', items: ['Whole Milk 1L', 'Semi-Skimmed Milk 1L', 'Chocolate Milk 250ml', 'Salted Butter 250g', 'Greek Yogurt 150g', 'Yogurt Drink 250ml', 'Double Cream 250ml', 'Cheese Snack 4-pack'] },
  { name: 'Beer & Cider', color: '#7a4fd4', icon: '🍺', items: ['Lager 440ml Can', 'IPA 330ml Bottle', 'Cider 500ml Can', 'Stout 440ml Can', 'Alcohol-Free Lager 330ml', 'Radler Citrus 330ml', 'Craft Lager 4-pack', 'Red Wine Mini 187ml'] },
  { name: 'Salty Snacks', color: '#d4a017', icon: '🍿', items: ['Sea Salt Crisps 32g', 'Salt & Vinegar Crisps 32g', 'Tortilla Chips 100g', 'Salted Peanuts 50g', 'Salted Pretzels 45g', 'Sweet Popcorn 40g', 'Beef Jerky 25g', 'Rice Crackers 30g', 'Trail Mix 40g', 'Nachos & Dip 100g'] },
  { name: 'Candy & Chocolate', color: '#d9556b', icon: '🍫', items: ['Milk Chocolate Bar 45g', 'White Chocolate Bar 45g', 'Gummy Bears 100g', 'Sour Worms 100g', 'Mint Chews 50g', 'Caramel Wafer', 'Nougat Bar', 'Jelly Beans 40g'] },
  { name: 'Coffee & Tea', color: '#7a4f2a', icon: '☕', items: ['Ground Coffee 200g', 'Instant Coffee 50g', 'Tea Bags 40-pack', 'Green Tea 20-pack', 'Herbal Tea 20-pack', 'Hot Chocolate Sachets 5-pack', 'Chai Latte 8-pack', 'Coffee Creamer 250g'] },
  { name: 'Hot Food', color: '#e8a33d', icon: '🥪', items: ['Sausage Roll', 'Chicken Wrap', 'BLT Sandwich', 'Cheese & Ham Toastie', 'Pepperoni Pizza Slice', 'Hot Dog', 'Steak Pie', 'Samosa 2-pack', 'Chicken Wings 6pc', 'Mac & Cheese Cup'] },
  { name: 'Pantry Essentials', color: '#b98a2f', icon: '🥫', items: ['Instant Noodles 65g', 'Pasta Sauce 350g', 'Chicken Soup 400g', 'Baked Beans 200g', 'Rice Pudding 200g', 'Tuna Chunks 80g', 'Olive Oil 250ml', 'Tomato Ketchup 300ml'] },
  { name: 'Household Essentials', color: '#3a7ca5', icon: '🧻', items: ['Batteries AA 4-pack', 'Batteries AAA 4-pack', 'Lighter', 'Kitchen Roll 2 Rolls', 'Bin Bags 10-pack', 'Hand Soap 100ml', 'Dish Sponge 3-pack', 'Phone Charging Cable'] },
  { name: 'Ice Cream', color: '#7c3aed', icon: '🍦', items: ['Vanilla Cone', 'Magnum Classic', 'Cornetto Classic', 'Ice Cream Sandwich', 'Solero Exotic', 'Mini Milk 6-pack', 'Lemon Sorbet 500ml', 'Ice Lollies 4-pack'] },
];

export function cornerStoreSpec(): Spec {
  const elements: SpecEl[] = [];

  // one room, one door at the bottom-left
  elements.push({
    type: 'wall',
    shape: 'polyline',
    label: '',
    geometry: [
      [0.3, 0.3], [15.7, 0.3], [15.7, 11.7],
      [4.8, 11.7], [2, 11.7],
      [0.3, 11.7], [0.3, 0.3],
    ],
  });

  const zone = (x: number, y: number, w: number, h: number, label: string, color?: string) =>
    elements.push({ type: 'zone', shape: 'rect', geometry: { x, y, w, h, rot: 0 }, label, color: color ?? '', meta: JSON.stringify({ department: label }) });
  const poi = (x: number, y: number, label: string) =>
    elements.push({ type: 'poi', shape: 'point', geometry: { x, y }, label });

  zone(1, 1, 14, 2.4, 'Coolers', '#3b6fd4');
  zone(1, 4, 3.2, 3.2, 'Coffee Corner', '#7a4f2a');
  zone(5, 4, 6, 3.6, 'Snacks');
  zone(12, 4, 3.4, 3.6, 'Hot Food', '#e8a33d');
  zone(1, 8, 10, 2, 'Groceries & Essentials');
  zone(11.6, 8, 3.9, 2, 'Ice Cream', '#3b6fd4');
  zone(5.6, 10.4, 3.6, 1, 'Checkout', '#9aa0a6');
  poi(15, 10.9, 'ATM');

  elements.push({ type: 'entrance', shape: 'point', geometry: { x: 3.4, y: 11.4 }, label: 'Entrance' });
  elements.push({ type: 'exit', shape: 'point', geometry: { x: 3.4, y: 11.4 }, label: 'Exit' });

  const groups: { label: string; cat: string; x: number; y: number; w: number; h: number }[] = [];
  const g = (label: string, cat: string, x: number, y: number, w: number, h: number) =>
    groups.push({ label, cat, x, y, w, h });

  g('Soft Drinks', 'Soft Drinks', 1.5, 1.5, 4, 1.2);
  g('Milk & Dairy', 'Milk & Dairy', 6, 1.5, 4, 1.2);
  g('Beer & Cider', 'Beer & Cider', 10.5, 1.5, 4, 1.2);
  g('Coffee & Tea', 'Coffee & Tea', 1.5, 4.6, 2.2, 1.2);
  g('Salty Snacks', 'Salty Snacks', 5.5, 4.5, 5, 1.2);
  g('Candy & Chocolate', 'Candy & Chocolate', 5.5, 6.2, 5, 1.2);
  g('Hot Food', 'Hot Food', 12.6, 4.6, 2.2, 1.2);
  g('Pantry Essentials', 'Pantry Essentials', 1.5, 8.4, 4.4, 1.2);
  g('Household Essentials', 'Household Essentials', 6.6, 8.4, 3.9, 1.2);
  g('Ice Cream', 'Ice Cream', 12.1, 8.4, 2.9, 1.2);

  for (const gr of groups) {
    elements.push({
      type: 'shelf',
      shape: 'rect',
      geometry: { x: gr.x, y: gr.y, w: gr.w, h: gr.h, rot: 0 },
      label: gr.label,
      color: '',
      meta: JSON.stringify({ department: gr.cat, planWidth: Math.round(Math.min(6, Math.max(1, Math.max(gr.w, gr.h))) * 10) / 10 }),
    });
  }

  const products: { name: string; category: string; brand: string; image?: string }[] = [];
  const poolByCat: Record<string, number[]> = {};
  for (const c of CS_CATS) {
    poolByCat[c.name] = [];
    for (const base of c.items) {
      poolByCat[c.name].push(products.length);
      products.push({ name: base, category: c.name, brand: BRANDS[products.length % BRANDS.length], image: PHOTOS[base] ?? '' });
    }
  }

  const locations: Spec['locations'] = [];
  const groupsOfCat: Record<string, number> = {};
  for (const gr of groups) groupsOfCat[gr.cat] = (groupsOfCat[gr.cat] ?? 0) + 1;
  const catGroupIdx: Record<string, number> = {};
  for (const gr of groups) {
    const pool = poolByCat[gr.cat];
    const vertical = gr.h > gr.w;
    const pinSpan = Math.round(Math.min(6, Math.max(2, Math.max(gr.w, gr.h))) * 10) / 10;
    const center = { x: gr.x + gr.w / 2, y: gr.y + gr.h / 2 };
    const gi = catGroupIdx[gr.cat] ?? 0;
    catGroupIdx[gr.cat] = gi + 1;
    const total = groupsOfCat[gr.cat];
    const share = Math.floor(pool.length / total);
    const start = gi * share + Math.min(gi, pool.length % total);
    const mine = pool.slice(start, start + share + (gi < pool.length % total ? 1 : 0));
    locations.push({ product: mine[0] ?? pool[gi % pool.length], x: center.x, y: center.y, level: 2, w: 1, pinW: pinSpan, pinH: 0.3, groupPin: 1 });
    const n = Math.max(1, mine.length - 1);
    mine.slice(1).forEach((p, j) => {
      const at = ((j + 0.5) / n) * (vertical ? gr.h : gr.w);
      locations.push({
        product: p,
        x: vertical ? gr.x + gr.w / 2 : gr.x + at,
        y: vertical ? gr.y + at : gr.y + gr.h / 2,
        level: (j % 3) + 1, w: 1, pinW: 0.3, groupOnly: 1,
      });
    });
  }

  return {
    slug: 'convenience-store-example', name: 'Corner Store Example', address: '12 Corner Street',
    description:
      'Convenience-store example on a small floorplan: cooler wall along the top, snack shelves in the middle, coffee corner, hot-food case, essentials on the back wall and an ice-cream freezer by the door. Every shelf is one titled item group.',
    hours: '6am–11pm daily', floorName: 'Shop floor', w: CS_W, h: CS_H,
    elements, categories: CS_CATS, products, locations, skuPrefix: 'CNV', skuPad: 4,
  };
}

interface SpecEl {
  type: string;
  shape: 'rect' | 'polygon' | 'point' | 'polyline';
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



/**
 * Bumped whenever a spec's layout or SKU scheme changes in a way only a
 * rebuild can deliver (parity with backend/scripts/demo-catalog.mjs). The
 * version a store was laid out under is kept under `seed:layout:<slug>`; a
 * present store laid out under another version is rebuilt — which is also
 * what retires a loaded catalogue, since its rows go with the rebuild.
 */
const LAYOUT_VERSION = 3;
const layoutKey = (slug: string) => `seed:layout:${slug}`;
/** A store's generated catalogue is recorded as loaded under this key (scripts/load-demo-catalog.mjs writes it). */
const catalogKey = (slug: string) => `seed:catalog:${slug}`;
/** A generated catalogue's facings carry their place along the shelf (meta.u — see demo-catalog.mjs); the demo's own facings never do. */
const OWNED_FACINGS = "json_extract(meta, '$.u') IS NULL";

const skuOf = (spec: Spec, i: number) => `${spec.skuPrefix}-${String(i + 1).padStart(spec.skuPad ?? 3, '0')}`;

/**
 * Every catalogue item must face somewhere (parity with demo-specs.mjs).
 * The specs stock each category's items across that category's shelf groups;
 * anything the grouping left out is added here as a planogram-only facing on
 * the nearest group — its own department's, else the first shelf. Returns
 * how many were added (0 for the specs as written).
 */
export function stockEverything(spec: Spec): number {
  const shelves = spec.elements.filter((e) => e.type === 'shelf');
  const facing = new Set(spec.locations.map((l) => l.product));
  let added = 0;
  spec.products.forEach((p, i) => {
    if (facing.has(i)) return;
    const shelf = shelves.find((e) => JSON.parse(e.meta ?? '{}').department === p.category) ?? shelves[0];
    if (!shelf) return;
    const { x, y, w, h } = shelf.geometry as { x: number; y: number; w: number; h: number };
    spec.locations.push({ product: i, x: x + w / 2, y: y + h / 2, level: 1, w: 1, pinW: 0.3, groupOnly: 1 });
    facing.add(i);
    added++;
  });
  return added;
}

/**
 * A cheap change signal for a present store's photos: a fingerprint of
 * every photo url the spec assigns, in catalogue order. A mismatch means the
 * spec's picks — or the url scheme itself — changed since the store was last
 * synced. It is kept in app_settings, so the usual cold start costs one tiny
 * read instead of the whole catalogue.
 */
async function photoFingerprint(spec: Spec): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(spec.products.map((p) => p.image ?? '').join('\n')));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
const photoSyncKey = (slug: string) => `seed:photos:${slug}`;
const markPhotosInSync = (env: Env, spec: Spec, print: string) =>
  run(
    env,
    'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    photoSyncKey(spec.slug),
    print
  );

/**
 * Bring a present store's product photos up to date WITHOUT rebuilding it
 * (parity with the node seeder's repointPhotos). A photo picked later — or
 * the move of the whole set from static files into the media table — only
 * changes an url, so the rows are updated in place and product ids stay put
 * (deep links keep working). Only urls of the demo's own photo set are ever
 * replaced: a photo the owner uploaded, or one they removed, is left alone.
 * The one exception is a store's FIRST sync (none recorded yet): it was
 * seeded before photos were tracked, so its empty photo fields are filled too.
 */
async function repointPhotos(env: Env, spec: Spec, storeId: string, firstSync: boolean): Promise<number> {
  // only the demo's own items are looked at: a loaded catalogue (120,000 SKUs
  // without photos) is left out by its first SKU
  const marker = await first(env, 'SELECT value FROM app_settings WHERE key = ?', catalogKey(spec.slug));
  const fromSku = marker ? String(JSON.parse(String(marker.value)).fromSku ?? '') : '';
  const rows = await all(env, 'SELECT id, sku, image_url FROM products WHERE store_id = ? AND sku < ?', storeId, fromSku);
  const bySku = new Map(rows.map((r) => [String(r.sku), r]));
  const updates: D1PreparedStatement[] = [];
  spec.products.forEach((p, i) => {
    const cur = bySku.get(skuOf(spec, i));
    const image = p.image ?? '';
    const vacant = firstSync && cur?.image_url === '' && image !== '';
    if (cur && cur.image_url !== image && (!!demoPhotoUrl(cur.image_url) || vacant)) {
      updates.push(env.DB.prepare('UPDATE products SET image_url = ? WHERE id = ?').bind(image, cur.id));
    }
  });
  for (const update of chunks(updates, 50)) await env.DB.batch(update);
  await markPhotosInSync(env, spec, await photoFingerprint(spec));
  return updates.length;
}

async function seedExample(env: Env, spec: Spec, ownerEmail: string, ownerName: string): Promise<void> {
  const stray = stockEverything(spec);
  if (stray) console.log(`[boot] ${spec.name}: ${stray} catalogue items had no facing — added to a group`);
  const ownerId = await ensureDemoOwner(env, ownerEmail, ownerName, `${spec.slug}-demo`);
  // Capture the floor's size AND owner BEFORE ensureStore syncs the size — a
  // mismatch means the spec grew and the seeded layout is stale, so it gets
  // wiped and rebuilt (parity with the node seed script's rebuild signal).
  const prior = await first(
    env,
    `SELECT f.width_m AS w, f.height_m AS h, s.owner_id AS owner_id FROM floors f
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
  // A store can be left stale three ways: half-seeded (shelves + products
  // written, pins never inserted — an older seed version's work), seeded by
  // an older spec (its pin count no longer matches this spec's), or laid out
  // under another layout/SKU version. The skip-when-present check below
  // would keep it frozen forever, so rebuild — but only while the store is
  // still the demo's own (a user-claimed store is left as its owner made it).
  // Only the demo's own facings are counted: a loaded catalogue's facings are
  // not part of the layout, and go with it when it is rebuilt.
  const locRow = await first(env, `SELECT COUNT(*) AS n FROM product_locations WHERE floor_id = ? AND ${OWNED_FACINGS}`, floorId);
  const demoOwned = String(prior?.owner_id ?? '') === String(ownerId);
  const laidOut = await first(env, 'SELECT value FROM app_settings WHERE key = ?', layoutKey(spec.slug));
  const layoutChanged = laidOut?.value !== String(LAYOUT_VERSION);
  const locDrift = Number(locRow?.n ?? 0) !== spec.locations.length;
  if (shelves > 0 && (sizeChanged || (demoOwned && (locDrift || layoutChanged)))) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM product_locations WHERE floor_id = ?').bind(floorId),
      env.DB.prepare('DELETE FROM products WHERE store_id = ?').bind(storeId),
      env.DB.prepare('DELETE FROM categories WHERE store_id = ?').bind(storeId),
      env.DB.prepare('DELETE FROM map_elements WHERE floor_id = ?').bind(floorId),
      env.DB.prepare('DELETE FROM app_settings WHERE key = ?').bind(catalogKey(spec.slug)),
      env.DB.prepare('UPDATE stores SET description = ?, hours = ? WHERE id = ?').bind(spec.description, spec.hours, storeId),
    ]);
    shelves = 0;
    console.log(`[boot] ${spec.name} ${sizeChanged ? 'spec changed' : locDrift ? `stale pins (${locRow?.n} vs ${spec.locations.length})` : 'layout version changed'} — rebuilding layout`);
  }
  if (shelves > 0) {
    // present: keep it, but bring its photos up to date in place. Changed
    // photos used to trigger the rebuild above — which threw away every
    // product id (and deep link to them) for the sake of a new url
    if (demoOwned) {
      const synced = await first(env, 'SELECT value FROM app_settings WHERE key = ?', photoSyncKey(spec.slug));
      if (synced?.value !== (await photoFingerprint(spec))) {
        const n = await repointPhotos(env, spec, storeId, synced?.value === undefined);
        if (n) console.log(`[boot] ${spec.name}: ${n} product photos updated in place`);
      }
    }
    return; // already present — idempotent
  }

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
      id, storeId, catIds[p.category], p.name, p.brand, skuOf(spec, i), '', '', price, p.image ?? '',
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
  await markPhotosInSync(env, spec, await photoFingerprint(spec));
  await run(
    env,
    'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    layoutKey(spec.slug),
    String(LAYOUT_VERSION)
  );
  console.log(`[boot] seeded ${spec.name}: ${spec.elements.length} elements, ${spec.products.length} products (${spec.locations.length} pinned)`);
}

/** Seed the example stores (Walmart Example, Home Depot Example, Corner Store
 *  Example). Retires demo maps from databases that already seeded older
 *  examples — slug deletions cascade; per-store idempotency keeps the boot
 *  check cheap. Safe to race. */
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
  await seedExample(env, homeDepotSpec(), 'homedepot@storemap.demo', 'Home Depot Demo');
  await seedExample(env, cornerStoreSpec(), 'corner@storemap.demo', 'Corner Store Demo');
  console.log('[boot] demo maps seeded (Walmart, Home Depot, Corner Store examples)');
}

/* ══════════════════════════════════════════════════════════════════════════
   Demo product photos: scripts/fetch-demo-photos.mjs (Open Food Facts) and
   backend/scripts/fetch-demo-photos-cc.mjs (openly-licensed photos) write
   the mapping to demo-photos.json — with generated packshot fallbacks. The
   urls in it (/media/<file>) are stored images: scripts/load-demo-photos.mjs
   copies the files of backend/demo-products into the `media` table (see
   media.ts). An item the scripts couldn't source plans as a diagram tile.
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

