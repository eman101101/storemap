#!/usr/bin/env node
/**
 * Seeds THE example store, Walmart Example — the big-box reference floor plan:
 * every area is a department (zone) and every shelf one titled item group.
 * Each group carries ONE map pin (meta.groupPin, sized to the group's plan
 * length) plus its items as planogram-only facings (meta.groupOnly) — items
 * never draw as pins; they live inside the group's planogram. The grocery
 * wing reuses the demo photo pool; general-merchandise items planogram as
 * diagram tiles. Former examples (Freshmart Downtown, Annex Market, Harbor
 * Warehouse, Megamart Central, Maple Corner Store, Grand Mart) are retired.
 *
 *   node scripts/seed-demo.mjs              # idempotent — skips if present
 *   node scripts/seed-demo.mjs --reset      # wipe the example store and rebuild
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
// db.js resolves DATA_DIR exactly like the server (via config) and migrate()
// creates the schema — so the script is safe on a first boot with a brand-new
// database file.
import { db, migrate } from '../src/db.js';

/** name → demo photo url, written by scripts/fetch-demo-photos.mjs (real
 *  Open Food Facts downloads + generated packshot fallbacks) — food items
 *  resolve to a real image file; general-merchandise items have none. */
const PHOTOS = JSON.parse(readFileSync(new URL('./demo-photos.json', import.meta.url), 'utf8'));

migrate();

const reset = process.argv.includes('--reset');

/* ══════════════════════════════════════════════════════════════════════════
   Retire replaced examples (mirrors the worker seeder's slug list).
   ══════════════════════════════════════════════════════════════════════════ */
function deleteDemoStore(slug) {
  const st = db.prepare('SELECT id FROM stores WHERE slug = ?').get(slug);
  if (!st) return;
  const floorIds = db.prepare('SELECT id FROM floors WHERE store_id = ?').all(st.id).map((r) => r.id);
  db.exec('BEGIN');
  try {
    for (const fid of floorIds) {
      db.prepare('DELETE FROM product_locations WHERE floor_id = ?').run(fid);
      db.prepare('DELETE FROM floor_snapshots WHERE floor_id = ?').run(fid);
      db.prepare('DELETE FROM map_elements WHERE floor_id = ?').run(fid);
    }
    db.prepare('DELETE FROM products WHERE store_id = ?').run(st.id);
    db.prepare('DELETE FROM categories WHERE store_id = ?').run(st.id);
    db.prepare('DELETE FROM floors WHERE store_id = ?').run(st.id);
    db.prepare('DELETE FROM store_members WHERE store_id = ?').run(st.id);
    db.prepare('DELETE FROM stores WHERE id = ?').run(st.id);
    db.exec('COMMIT');
    console.log(`Retired demo store ${slug}.`);
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function seedExample(spec, ownerEmail, ownerName) {
  const resetThis = reset || process.argv.includes(`--reset-${spec.slug}`);
  let st = db.prepare('SELECT id FROM stores WHERE slug = ?').get(spec.slug);
  if (!st) {
    let owner = db.prepare('SELECT id FROM users WHERE email = ?').get(ownerEmail);
    if (!owner) {
      const uid = randomUUID();
      db.prepare("INSERT INTO users (id, email, name, provider, provider_sub) VALUES (?, ?, ?, 'dev', ?)").run(
        uid, ownerEmail, ownerName, `${spec.slug}-demo`
      );
      owner = { id: uid };
    }
    const sid = randomUUID();
    db.prepare(
      `INSERT INTO stores (id, owner_id, name, slug, address, description, hours, is_public)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
    ).run(sid, owner.id, spec.name, spec.slug, spec.address, spec.description, spec.hours);
    db.prepare('INSERT INTO floors (id, store_id, name, level, width_m, height_m) VALUES (?, ?, ?, 1, ?, ?)').run(
      randomUUID(), sid, spec.floorName, spec.w, spec.h
    );
    st = { id: sid };
    console.log(`Created ${spec.name} (${spec.slug}).`);
  }
  let fl = db.prepare('SELECT id, width_m, height_m FROM floors WHERE store_id = ? ORDER BY level LIMIT 1').get(st.id);
  // a spec whose floor grew rebuilds the demo store, so an existing database
  // picks up the new layout instead of keeping the stale one forever
  const sizeChanged = Math.abs(fl.width_m - spec.w) > 0.01 || Math.abs(fl.height_m - spec.h) > 0.01;
  let shelves = db.prepare("SELECT COUNT(*) AS n FROM map_elements WHERE floor_id = ? AND type = 'shelf'").get(fl.id).n;
  // a spec whose pin count changed (items regrouped) also rebuilds — an old
  // seed's locations otherwise stick around forever
  const locCount = db.prepare('SELECT COUNT(*) AS n FROM product_locations WHERE floor_id = ?').get(fl.id).n;
  const locDrift = shelves > 0 && locCount !== spec.locations.length;
  if (shelves > 0 && (resetThis || sizeChanged || locDrift)) {
    db.prepare('DELETE FROM product_locations WHERE floor_id = ?').run(fl.id);
    db.prepare('DELETE FROM products WHERE store_id = ?').run(st.id);
    db.prepare('DELETE FROM categories WHERE store_id = ?').run(st.id);
    db.prepare('DELETE FROM map_elements WHERE floor_id = ?').run(fl.id);
    db.prepare('UPDATE stores SET description = ?, hours = ? WHERE id = ?').run(spec.description, spec.hours, st.id);
    shelves = 0;
    console.log(`Reset ${spec.name} — rebuilding.`);
  }
  if (shelves > 0) {
    console.log(`${spec.name} layout already present — skipping (use --reset-${spec.slug} to rebuild).`);
    return;
  }
  db.prepare('UPDATE floors SET width_m = ?, height_m = ? WHERE id = ?').run(spec.w, spec.h, fl.id);
  const insE = db.prepare(
    'INSERT INTO map_elements (id, floor_id, type, shape, geometry, label, color, meta, z_index) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const insC = db.prepare('INSERT INTO categories (id, store_id, name, color, icon) VALUES (?, ?, ?, ?, ?)');
  const insP = db.prepare(
    'INSERT INTO products (id, store_id, category_id, name, brand, sku, barcode, description, price, image_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const insL = db.prepare('INSERT INTO product_locations (id, product_id, floor_id, x, y, rot, meta) VALUES (?, ?, ?, ?, ?, 0, ?)');
  // single transaction: the big-box spec writes thousands of rows in one commit
  db.exec('BEGIN');
  try {
    spec.elements.forEach((e, z) => insE.run(randomUUID(), fl.id, e.type, e.shape, JSON.stringify(e.geometry), e.label, e.color ?? '', e.meta ?? '{}', z + 1));
    const catId = {};
    for (const c of spec.categories) {
      catId[c.name] = randomUUID();
      insC.run(catId[c.name], st.id, c.name, c.color, c.icon);
    }
    const pid = spec.products.map((p, i) => {
      const id = randomUUID();
      const price = p.price ?? Math.round((1.49 + ((i * 61) % 2400) / 100) * 100) / 100;
      insP.run(id, st.id, catId[p.category], p.name, p.brand, `${spec.skuPrefix}-${String(i + 1).padStart(spec.skuPad ?? 3, '0')}`, '', '', price, p.image ?? '');
      return id;
    });
    for (const l of spec.locations) {
      insL.run(randomUUID(), pid[l.product], fl.id, l.x, l.y, JSON.stringify({
        shelf_level: l.level ?? (l.product % 3) + 1,
        w: l.w ?? 1,
        ...(l.pinW != null ? { pinW: l.pinW } : {}),
        ...(l.pinH != null ? { pinH: l.pinH } : {}),
        ...(l.groupOnly ? { groupOnly: 1 } : {}),
        ...(l.groupPin ? { groupPin: 1 } : {}),
      }));
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  console.log(`Seeded ${spec.name}: ${spec.w}×${spec.h} m, ${spec.elements.length} elements, ${spec.products.length} products (${spec.locations.length} pinned).`);
}

/* ══════════════════════════════════════════════════════════════════════════
   Walmart Example — parity with worker/src/seed.ts walmartSpec(): the same
   floor plan, catalogue and group stocking, expressed for better-sqlite3.
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

/** Food departments reuse the Freshmart item pools — demo-photos.json covers
 *  them, so grocery-wing planograms carry real photos. */
const wmFood = (deptName, name) => {
  const src = FM_DEPTS.find((d) => d.name === deptName);
  return { name: name ?? src.name, color: src.color, icon: src.icon, items: src.items };
};

const WM_FOOD_CATS = [
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
const WM_GM_CATS = [
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

function walmartSpec() {
  const elements = [];

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

  const zone = (x, y, w, h, label, color = WM_BLUE) =>
    elements.push({ type: 'zone', shape: 'rect', geometry: { x, y, w, h, rot: 0 }, label, color, meta: JSON.stringify({ department: label }) });
  const poi = (x, y, label) =>
    elements.push({ type: 'poi', shape: 'point', geometry: { x, y }, label });
  const aisle = (pts, label) =>
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
  const groups = [];
  const g = (label, cat, x, y, w, h, plan) =>
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
  g('Soft Drinks & Juices', 'Drinks', 74.5, 38.9, 18.5, 1.4, 6);

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
  const products = [];
  const poolByCat = {};
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
  const locations = [];
  const groupsOfCat = {};
  for (const gr of groups) groupsOfCat[gr.cat] = (groupsOfCat[gr.cat] ?? 0) + 1;
  const catGroupIdx = {};
  for (const gr of groups) {
    const pool = poolByCat[gr.cat];
    const vertical = gr.h > gr.w;
    const pinSpan = Math.round(Math.min(6, Math.max(2, Math.max(gr.w, gr.h))) * 10) / 10;
    const center = { x: gr.x + gr.w / 2, y: gr.y + gr.h / 2 };
    // this group's even share of the category's catalogue (earlier groups
    // absorb the remainder items)
    const gi = catGroupIdx[gr.cat] ?? 0;
    catGroupIdx[gr.cat] = gi + 1;
    const total = groupsOfCat[gr.cat];
    const share = Math.floor(pool.length / total);
    const start = gi * share + Math.min(gi, pool.length % total);
    const mine = pool.slice(start, start + share + (gi < pool.length % total ? 1 : 0));
    // the group pin — ONE per group, spanning the group's plan length
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
    slug: 'walmart-example', name: 'Walmart Example', address: '1 Supercenter Way',
    description:
      'Big-box example built from the reference floor plan: every area is a department and every shelf one titled item group — the map shows ONE pin per group (sized to the group), the items live only inside its planogram. Grocery wing carries real product photos; general merchandise plans as diagram tiles.',
    hours: '6am–11pm daily', floorName: 'Main floor', w: WW, h: WH,
    elements, categories: allCats, products, locations, skuPrefix: 'WMX', skuPad: 4,
  };
}

/* ════════════════ Home Depot Example ════════════════
   Hardware-store reference plan: lumber and paint up top, tool and trade
   aisles down the middle, appliances and flooring on the right, the garden
   center yard in the bottom-right corner. Same group model as Walmart. */

const HD_W = 80;
const HD_H = 52;
const HD_ORANGE = '#d97a2b';
const HD_GRAY = '#9aa0a6';
const HD_GREEN = '#2f7d32';

const HD_CATS = [
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

function homeDepotSpec() {
  const elements = [];
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

  const zone = (x, y, w, h, label, color = HD_ORANGE) =>
    elements.push({ type: 'zone', shape: 'rect', geometry: { x, y, w, h, rot: 0 }, label, color, meta: JSON.stringify({ department: label }) });
  const poi = (x, y, label) =>
    elements.push({ type: 'poi', shape: 'point', geometry: { x, y }, label });

  zone(2, 1, 26, 8, 'Lumber & Building Materials', HD_GRAY);
  zone(29, 1, 14, 8, 'Hardware & Fasteners');
  zone(44, 1, 10, 8, 'Key & Glass Desk', HD_GRAY);
  zone(55, 1, 23, 8, 'Paint & Décor');
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
  zone(2, 40, 22, 8, 'Outdoor Yard', HD_GREEN);
  zone(30, 44, 20, 4.5, 'Checkout', HD_GRAY);
  zone(58, 40, 20, 10, 'Garden Center', HD_GREEN);
  poi(46, 9.5, 'Pro Desk');
  poi(5, 9.5, 'Tool Rental');
  poi(26, 49.5, 'Cart bay');

  elements.push({ type: 'entrance', shape: 'point', geometry: { x: 32, y: 50.9 }, label: 'Entrance' });
  elements.push({ type: 'entrance', shape: 'point', geometry: { x: 62, y: 50.9 }, label: 'Entrance' });
  elements.push({ type: 'exit', shape: 'point', geometry: { x: 78, y: 45 }, label: 'Garden Center' });

  const groups = [];
  const g = (label, cat, x, y, w, h) => groups.push({ label, cat, x, y, w, h });

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
  g('Garden Center', 'Lawn & Garden', 66, 41.5, 1.4, 6);

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

  const products = [];
  const poolByCat = {};
  for (const c of HD_CATS) {
    poolByCat[c.name] = [];
    for (const base of c.items) {
      poolByCat[c.name].push(products.length);
      products.push({ name: base, category: c.name, brand: BRANDS[products.length % BRANDS.length], image: '' });
    }
  }

  const locations = [];
  const groupsOfCat = {};
  for (const gr of groups) groupsOfCat[gr.cat] = (groupsOfCat[gr.cat] ?? 0) + 1;
  const catGroupIdx = {};
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
    elements, categories: HD_CATS, products, locations, skuPrefix: 'HDX', skuPad: 3,
  };
}

/* ════════════════ Corner Store Example ════════════════
   Convenience-store reference plan on a small floorplan: cooler wall along
   the top, snack shelves in the middle, coffee corner, hot-food case,
   essentials on the back wall and an ice-cream freezer by the door. */

const CS_W = 16;
const CS_H = 12;

const CS_CATS = [
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

function cornerStoreSpec() {
  const elements = [];
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

  const zone = (x, y, w, h, label, color) =>
    elements.push({ type: 'zone', shape: 'rect', geometry: { x, y, w, h, rot: 0 }, label, color: color ?? '', meta: JSON.stringify({ department: label }) });
  const poi = (x, y, label) =>
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

  const groups = [];
  const g = (label, cat, x, y, w, h) => groups.push({ label, cat, x, y, w, h });

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

  const products = [];
  const poolByCat = {};
  for (const c of CS_CATS) {
    poolByCat[c.name] = [];
    for (const base of c.items) {
      poolByCat[c.name].push(products.length);
      products.push({ name: base, category: c.name, brand: BRANDS[products.length % BRANDS.length], image: '' });
    }
  }

  const locations = [];
  const groupsOfCat = {};
  for (const gr of groups) groupsOfCat[gr.cat] = (groupsOfCat[gr.cat] ?? 0) + 1;
  const catGroupIdx = {};
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
    elements, categories: CS_CATS, products, locations, skuPrefix: 'CNV', skuPad: 3,
  };
}

// The homepage showcases the three example stores. Retire the previous demo
// maps from databases that already seeded them, then seed the current set
// (idempotent; `--reset` or `--reset-<slug>` forces a rebuild).
for (const slug of [
  'sunrise-grocers',
  'freshmart-downtown',
  'annex-market',
  'harbor-warehouse',
  'megamart-central',
  'maple-corner',
  'grand-mart',
]) {
  deleteDemoStore(slug);
}
seedExample(walmartSpec(), 'walmart@storemap.demo', 'Walmart Demo');
seedExample(homeDepotSpec(), 'homedepot@storemap.demo', 'Home Depot Demo');
seedExample(cornerStoreSpec(), 'corner@storemap.demo', 'Corner Store Demo');
