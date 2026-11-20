/**
 * Download real product photos from Open Food Facts for the demo planogram.
 *
 *   node backend/scripts/fetch-demo-photos.mjs
 *
 * Writes frontend/public/demo-products/<slug>.jpg (~200px fronts, small) and
 * ATTRIBUTION.md (ODbL credit + source URLs), plus prints the seed mapping:
 *   { 'Milk Chocolate Bar 100g': '/demo-products/milk-chocolate-bar.jpg', … }
 * Idempotent: existing files are kept unless --force.
 */
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve(import.meta.dirname, '../../frontend/public/demo-products');
const UA = 'StoreMap-demo-seeder/1.0 (self-hosted grocery map demo)';
// [seeded product name, OFF search term]
const WANTED = [
  ['Organic Whole Milk 1L', 'whole milk uht'],
  ['Oat Drink Barista 1L', 'oat drink barista'],
  ['Greek Yogurt 500g', 'greek yogurt total'],
  ['Mild Cheddar Block 350g', 'cheddar cheese block'],
  ['Mozzarella Ball 125g', 'mozzarella'],
  ['Salted Butter 250g', 'salted butter'],
  ['Kefir 1L', 'kefir drink'],
  ['Cream Cheese Tub 300g', 'cream cheese'],
  ['Gouda Slices 200g', 'gouda cheese slices'],
  ['Lactose-Free Milk 1L', 'lactose free milk'],
  ['Orange Juice 1L', 'orange juice 1l'],
  ['Cola 2L', 'coca-cola classic'],
  ['Ground Coffee 500g', 'ground coffee'],
  ['Espresso Beans 1kg', 'espresso coffee beans'],
  ['Green Tea 40 Bags', 'green tea bags'],
  ['English Breakfast Tea 80 Bags', 'english breakfast tea bags'],
  ['Hot Chocolate Mix 400g', 'hot chocolate powder'],
  ['Cold Brew Coffee 1L', 'cold brew coffee'],
  ['Almond Milk 1L', 'almond milk'],
  ['Coconut Water 1L', 'coconut water'],
  ['Iced Tea Lemon 1.5L', 'iced tea lemon'],
  ['Lemon-Lime Soda 2L', 'lemon lime soda'],
  ['Tonic Water 6-pack', 'tonic water bottle'],
  ['Energy Drink 4-pack', 'energy drink can'],
  ['Sea Salt Crisps 150g', 'potato crisps sea salt'],
  ['Tortilla Chips 300g', 'tortilla chips'],
  ['Salted Peanuts 200g', 'salted peanuts'],
  ['Mixed Nuts 300g', 'mixed nuts'],
  ['Roasted Cashews 200g', 'roasted cashews'],
  ['Milk Chocolate Bar 100g', 'cadbury dairy milk bar'],
  ['Dark Chocolate 70% 100g', 'lindt excellence 70% dark chocolate'],
  ['Choc Chip Cookies 300g', 'chocolate chip cookies'],
  ['Digestive Biscuits 400g', "mcvities digestive biscuits"],
  ['Jaffa Cakes 12-pack', 'jaffa cakes'],
  ['Gummy Bears 200g', 'haribo gold-bears'],
  ['Sweet Popcorn 100g', 'sweet popcorn'],
  ['Cereal Bar 6-pack', 'cereal bar pack'],
  ['Salted Pretzels 250g', 'salted pretzels'],
  ['Rice Cakes 150g', 'rice cakes'],
  ['Sourdough Loaf', 'sourdough bread'],
  ['Croissants 4-pack', 'croissants'],
  ['Bagels 6-pack', 'bagels'],
  ['Brioche Buns 6-pack', 'brioche buns'],
  ['Frozen Pepperoni Pizza', 'pepperoni pizza frozen'],
  ['Frozen Margherita Pizza', 'margherita pizza frozen'],
  ['Vanilla Ice Cream 1L', 'vanilla ice cream'],
  ['Chocolate Ice Cream 1L', 'chocolate ice cream'],
  ['French Fries 1.5kg', 'frozen french fries'],
  ['Garden Peas 1kg', 'frozen garden peas'],
  ['Fish Fingers 20-pack', 'fish fingers'],
  ['Chicken Nuggets 750g', 'chicken nuggets'],
  ['Washing Up Liquid 500ml', 'washing up liquid'],
  ['Hand Soap 500ml', 'liquid hand soap'],
  ['Antibacterial Spray 750ml', 'antibacterial spray'],
  ['Bacon Rashers 300g', 'bacon rashers'],
  ['Salmon Fillets 2-pack', 'salmon fillets'],
  ['Honey-Roast Ham 200g', 'honey roast ham'],
  ['Pork Sausages 8-pack', 'pork sausages'],
  ['Smoked Salmon 180g', 'smoked salmon'],
  ['Chorizo Ring 250g', 'chorizo sausage'],
  // ── Maple Corner Store (maple-corner) ──
  ['Fresh Milk 2L', 'whole milk bottle'],
  ['Chocolate Milk 1L', 'chocolate milk'],
  ['Orange Juice No Pulp 1L', 'orange juice'],
  ['Apple Juice 1L', 'apple juice'],
  ['Cola 330ml', 'cola can'],
  ['Lemon Soda 330ml', 'lemon soda can'],
  ['Sparkling Water 500ml', 'sparkling water bottle'],
  ['Iced Coffee 250ml', 'iced coffee bottle'],
  ['Energy Drink 250ml', 'energy drink'],
  ['Kefir Drink 500ml', 'kefir'],
  ['Salted Chips 150g', 'salted potato chips'],
  ['Tortilla Snack Chips 200g', 'tortilla chips bag'],
  ['Pretzel Sticks 100g', 'pretzel sticks'],
  ['Peanut Bars 3-pack', 'peanut bar'],
  ['Chocolate Cookies Pack', 'chocolate cookies'],
  ['Gummy Candy 200g', 'gummy bears'],
  ['Microwave Popcorn 3-pack', 'microwave popcorn'],
  ['Trail Mix 150g', 'trail mix'],
  ['Spaghetti 500g', 'spaghetti pasta'],
  ['Tomato Passata 700ml', 'tomato passata'],
  ['Basmati Rice 1kg', 'basmati rice'],
  ['Olive Oil 500ml', 'olive oil bottle'],
  ['Baked Beans 400g', 'baked beans can'],
  ['Instant Coffee 100g', 'instant coffee jar'],
  ['Black Tea 80 Bags', 'black tea bags'],
  ['Granulated Sugar 1kg', 'white sugar'],
  ['Dish Soap 500ml', 'dish soap'],
  ['Laundry Liquid 1L', 'laundry liquid detergent'],
  ['Paper Towels 2-roll', 'paper towels'],
  ['Trash Bags 20pc', 'trash bags'],
  ['Glass Cleaner 500ml', 'glass cleaner spray'],
  ['Cleaning Sponges 4-pack', 'kitchen sponges'],
  ['Air Freshener Spray 300ml', 'air freshener spray'],
  ['Toothpaste 100ml', 'toothpaste'],
  ['Shampoo 400ml', 'shampoo bottle'],
  ['Soap Bar 4-pack', 'soap bar'],
  ['Hand Cream 75ml', 'hand cream'],
  ['Roll-on Deodorant', 'deodorant roll on'],
  ['Razor Blades 4pc', 'razor blades'],
  ['Cotton Pads 60pc', 'cotton pads'],
  // ── Sunrise Grocers (sunrise-grocers) ──
  ['Bananas 1kg', 'bananas'],
  ['Red Apples 1kg', 'red apples'],
  ['Navel Oranges 6-pack', 'navel oranges'],
  ['Vine Tomatoes 500g', 'vine tomatoes'],
  ['Cucumber', 'cucumber'],
  ['Bell Peppers 3-pack', 'bell peppers'],
  ['Carrots 1kg', 'carrots'],
  ['Iceberg Lettuce', 'iceberg lettuce'],
  ['Avocados 2-pack', 'avocado'],
  ['Broccoli Head', 'broccoli'],
  ['Baby Potatoes 1.5kg', 'baby potatoes'],
  ['Red Onions 1kg', 'red onions'],
  ['Wholegrain Bread 800g', 'wholegrain bread'],
  ['Blueberry Muffins 4-pack', 'blueberry muffins'],
  ['Cinnamon Rolls 2-pack', 'cinnamon rolls'],
  ['Baguette', 'baguette bread'],
  ['Multiseed Rolls 6-pack', 'seeded bread rolls'],
  ['Butter Block 250g', 'butter block'],
  ['Cheddar Mature 350g', 'mature cheddar'],
  ['Feta Cheese 200g', 'feta cheese'],
  ['Cottage Cheese 250g', 'cottage cheese'],
  ['Free-Range Eggs 10pc', 'eggs free range'],
  ['Cold-Pressed Orange Juice 750ml', 'cold pressed orange juice'],
  ['Sparkling Lemonade 750ml', 'sparkling lemonade'],
  ['Oat Milk 1L', 'oat milk'],
  ['Ground Coffee 250g', 'ground coffee bag'],
  ['Herbal Tea 20 Bags', 'herbal tea bags'],
  ['Coconut Water 500ml', 'coconut water'],
  ['Green Smoothie 400ml', 'green smoothie'],
  ['Penne Rigate 500g', 'penne rigate'],
  ['Chickpeas 400g', 'chickpeas can'],
  ['Green Lentils 500g', 'green lentils'],
  ['Honey Squeeze Bottle 350g', 'honey squeeze bottle'],
  ['Peanut Butter Smooth 350g', 'smooth peanut butter'],
  ['Extra Virgin Olive Oil 750ml', 'extra virgin olive oil'],
  ['Balsamic Vinegar 500ml', 'balsamic vinegar'],
  ['Sea Salt Grinder 400g', 'sea salt grinder'],
  ['Plain Flour 1kg', 'plain flour'],
  ['Cane Sugar 1kg', 'cane sugar'],
  ['Granola 500g', 'granola'],
  ['Chia Seeds 250g', 'chia seeds'],
  ['Protein Bars 6-pack', 'protein bar'],
  ['Multivitamin 60 Tabs', 'multivitamin tablets'],
  ['Kimchi 300g', 'kimchi'],
  ['Ginger Kombucha 400ml', 'kombucha ginger'],
  ['Dark Chocolate 85% 100g', 'dark chocolate 85'],
  ['Almond Butter 250g', 'almond butter'],
  ['Quinoa 500g', 'quinoa'],
  ['Rooibos Tea 40 Bags', 'rooibos tea'],
  ['Eco Dish Soap 500ml', 'eco dish soap'],
  ['Laundry Sheets 30pc', 'laundry detergent sheets'],
  ['Bamboo Towels 2-roll', 'bamboo paper towels'],
  ['Compost Bags 50pc', 'compost bags'],
  ['All-Purpose Spray 750ml', 'all purpose cleaner'],
  ['Toilet Cleaner 750ml', 'toilet cleaner'],
  ['Recycled Foil 30m', 'aluminium foil'],
  ['Soap Bar Trio 3-pack', 'soap bars'],
  ['Glass Spray 500ml', 'glass cleaner'],
  ['Bin Liners 30pc', 'bin liners'],
];

const slug = (name) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40);

async function offSearch(term) {
  const url =
    'https://world.openfoodfacts.org/cgi/search.pl?search_terms=' +
    encodeURIComponent(term) +
    '&search_simple=1&action=process&json=1&page_size=8' +
    '&fields=product_name,brands,image_front_url,image_small_url';
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.ok) return (await res.json()).products ?? [];
    if (res.status !== 503) throw new Error(`search ${res.status}`);
    await new Promise((r) => setTimeout(r, 3000 * (attempt + 1))); // rate-limited — back off
  }
  throw new Error('search rate-limited');
}

/** OFF image urls end .100.jpg (small) — the 200px variant swaps the size. */
function bigger(url) {
  return url.replace(/\.(\d+)\.jpg$/, '.200.jpg');
}

async function download(url, file) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`image ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 800) throw new Error('image too small / placeholder');
  fs.writeFileSync(file, buf);
  return buf.length;
}

fs.mkdirSync(OUT, { recursive: true });
const force = process.argv.includes('--force');
const mapping = {};
const rows = [];

let ok = 0;
for (const [name, term] of WANTED) {
  const file = path.join(OUT, `${slug(name)}.jpg`);
  if (fs.existsSync(file) && !force) {
    mapping[name] = `/demo-products/${slug(name)}.jpg`;
    ok++;
    continue;
  }
  try {
    const products = await offSearch(term);
    const hit = products.find((p) => p.image_front_url || p.image_small_url);
    if (!hit) throw new Error('no imaged result');
    let url = hit.image_front_url || hit.image_small_url;
    let bytes;
    try {
      bytes = await download(bigger(url), file);
    } catch {
      bytes = await download(url, file); // 200px variant missing → original size
    }
    mapping[name] = `/demo-products/${slug(name)}.jpg`;
    rows.push(`| ${name} | ${(hit.brands ? hit.brands.split(',')[0] + ' ' : '') + (hit.product_name || term)} — ${url} |`);
    console.log(`✓ ${name} ← ${(hit.brands || '?').split(',')[0]} (${(bytes / 1024).toFixed(0)} KB)`);
    ok++;
  } catch (err) {
    console.warn(`✗ ${name}: ${err.message}`);
  }
  await new Promise((r) => setTimeout(r, 1200)); // be polite to the API
}

fs.writeFileSync(path.join(OUT, 'ATTRIBUTION.md'), [
  '# Demo product photos', '',
  'Downloaded from [Open Food Facts](https://world.openfoodfacts.org) —',
  'data and images licensed under the [Open Database License](https://opendatacommons.org/licenses/odbl/1-0/) (ODbL).', '',
  '| Demo product | Source |', '|---|---|', ...rows, '',
].join('\n'));

/* ── Generated packshot fallbacks ─────────────────────────────────────────
   Any WANTED name without a downloaded photo gets a stylized SVG packshot
   (bottle/can/box/bag/jar shape by keyword, deterministic category-ish hue,
   label text) so EVERY seeded item resolves to a real image file. */
const GEN = path.join(OUT, 'gen');
fs.mkdirSync(GEN, { recursive: true });

const hashHue = (s) => {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
};

const shapeFor = (name) => {
  const n = name.toLowerCase();
  if (/ml|liquid|juice|drink|water|soda|milk|oil|coffee|tea|kombucha|smoothie|kefir|lemonade|vinegar|honey|shampoo|spray|cleaner|soap\b/.test(n)) return 'bottle';
  if (/can|beans|cola|soda|pop|peas|chickpeas|lentils/.test(n)) return 'can';
  if (/bag|chips|crisps|popcorn|flour|sugar|rice|pasta|spaghetti|rolls|towels|foil|liners|bags/.test(n)) return 'bag';
  if (/jar|paste|butter|honey|spread|sauce|passata|kimchi/.test(n)) return 'jar';
  if (/tube|cream|paste|toothpaste/.test(n)) return 'tube';
  return 'box';
};

function packshotSvg(name, hue) {
  const words = name.replace(/(\d+%?)(g|kg|ml|l|pc|pack|roll|tabs)\b/gi, '$2').toUpperCase().split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > 11) { if (cur) lines.push(cur.trim()); cur = w; }
    else cur = (cur + ' ' + w).trim();
    if (lines.length >= 2) break;
  }
  if (cur && lines.length < 2) lines.push(cur.trim());
  const bg = `hsl(${hue} 55% 52%)`;
  const dark = `hsl(${hue} 60% 30%)`;
  const label = `hsl(${hue} 30% 96%)`;
  const shape = shapeFor(name);
  let body = '';
  if (shape === 'bottle') {
    body = `<rect x="62" y="38" width="16" height="26" rx="6" fill="${dark}"/><rect x="50" y="60" width="40" height="150" rx="12" fill="${dark}"/><rect x="56" y="86" width="28" height="66" rx="6" fill="${label}"/>`;
  } else if (shape === 'can') {
    body = `<rect x="46" y="52" width="48" height="150" rx="14" fill="${dark}"/><ellipse cx="70" cy="56" rx="24" ry="8" fill="hsl(${hue} 45% 72%)"/><rect x="54" y="88" width="32" height="64" rx="6" fill="${label}"/>`;
  } else if (shape === 'bag') {
    body = `<path d="M40 66 L100 66 L108 200 L32 200 Z" fill="${dark}"/><path d="M40 66 L100 66 L98 76 L42 76 Z" fill="hsl(${hue} 45% 72%)"/><rect x="48" y="102" width="44" height="60" rx="6" fill="${label}"/>`;
  } else if (shape === 'jar') {
    body = `<rect x="62" y="44" width="16" height="14" rx="3" fill="hsl(${hue} 45% 72%)"/><rect x="46" y="56" width="48" height="146" rx="10" fill="${dark}"/><rect x="54" y="92" width="32" height="62" rx="6" fill="${label}"/>`;
  } else if (shape === 'tube') {
    body = `<rect x="58" y="46" width="24" height="18" rx="6" fill="${dark}"/><path d="M52 62 L88 62 L96 198 L44 198 Z" fill="${dark}"/><rect x="56" y="96" width="28" height="58" rx="6" fill="${label}"/>`;
  } else {
    body = `<rect x="38" y="58" width="64" height="142" rx="8" fill="${dark}"/><path d="M38 74 L102 74" stroke="hsl(${hue} 45% 72%)" stroke-width="5"/><rect x="48" y="94" width="44" height="66" rx="6" fill="${label}"/>`;
  }
  const text = lines.map((l, i) => `<text x="70" y="${112 + i * 17}" text-anchor="middle" font-family="Arial, sans-serif" font-size="13" font-weight="bold" fill="${dark}">${l.slice(0, 12)}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="210" viewBox="0 0 140 210"><rect width="140" height="210" rx="10" fill="${bg}"/>${body}${text}</svg>`;
}

let gen = 0;
for (const [name] of WANTED) {
  if (mapping[name]) continue;
  const file = path.join(GEN, `${slug(name)}.svg`);
  if (!fs.existsSync(file)) fs.writeFileSync(file, packshotSvg(name, hashHue(name)));
  mapping[name] = `/demo-products/gen/${slug(name)}.svg`;
  gen++;
}

// the seeders read this map — one source of truth for demo photo urls
fs.writeFileSync(
  path.join(import.meta.dirname, 'demo-photos.json'),
  JSON.stringify(Object.fromEntries(Object.entries(mapping).sort(([a], [b]) => a.localeCompare(b))), null, 2)
);

console.log(`\n${ok} fetched + ${gen} generated = ${ok + gen}/${WANTED.length} photos in ${OUT}`);
console.log('Seed mapping written to backend/scripts/demo-photos.json');
