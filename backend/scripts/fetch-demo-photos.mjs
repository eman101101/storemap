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
console.log(`\n${ok}/${WANTED.length} photos in ${OUT}`);
console.log('\nSeed mapping (paste into seed PHOTO_URLS):');
console.log(JSON.stringify(Object.fromEntries(Object.entries(mapping).map(([k, v]) => [k, v])), null, 2));
