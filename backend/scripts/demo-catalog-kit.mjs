/**
 * The vocabulary the example stores' product-line tables are written with
 * (demo-catalog-walmart.mjs, -homedepot.mjs, -corner.mjs).
 *
 * A product row names a product, the brands that really make it, and the
 * KIND of product it is — one row per line:
 *
 *     Potato Chips~Lay's|Ruffles|Kettle Brand|Cape Cod|Utz|Herr's~potatoChips
 *     Tortilla Chips~Doritos|Tostitos|On The Border|Mission~tortillaChips
 *
 * A KIND (demo-catalog-kinds-*.mjs) says what a sort of product comes in — its
 * flavours or styles, its grades or specs, its sizes, its packs and its price
 * range — because a cordless drill comes in volts, a corded saw in blade sizes
 * and a beach towel in inches. A product is one pick from each, prefixed with
 * its brand and suffixed with its pack:
 *
 *     "Kettle Brand Sea Salt Potato Chips Kettle Cooked 8 oz 2-Pack"
 *      brand       flavour?  product  grade?  size  pack?
 *
 * A row whose product is "-" adds no word of its own: its kind's flavours
 * then ARE the products ("Ore-Ida Golden Fries 28 oz", "Dole Bananas 2 lb").
 * A flavour or grade list may open with "|" — the plain, unqualified product.
 * Lists are "|"-separated words; repeats are dropped, so a row can never form
 * the same product twice. The one exception is a kind's PACKS, given as a
 * list: a pack named twice is drawn twice as often (most SKUs sell singly).
 */

const words = (s) =>
  [...new Set(s.split("|").map((x) => x.trim()))].map((x) => {
    // a note-to-self left in a list ("...? (brand) skip") is not a word a product can be
    if (/[?~]|\bdup\b|no →/i.test(x)) throw new Error(`Not a word: "${x}"`);
    return x;
  });

/** The standard packs: three of every six SKUs sell singly, the rest are multipacks. */
export const PACKS = ["", "", "", "2-Pack", "4-Pack", "Value Pack"];
export const SINGLE = [""];

export const w = words;

/**
 * The sizes a sort of product is sold in, as far as its kind doesn't name its
 * own: a canned vegetable and a canned soup are both sold BY.can.
 */
export const BY = {
  can: "10.5 oz|10.75 oz|11 oz|12 oz|13.5 oz|14 oz|14.5 oz|15 oz|15.25 oz|15.5 oz|16 oz|19 oz|27 oz|28 oz|29 oz|101 oz",
  jar: "8 oz|10 oz|12 oz|13 oz|14 oz|15 oz|16 oz|18 oz|20 oz|24 oz|32 oz|40 oz|64 oz|1 gal",
  bottle: "8 oz|12 oz|14 oz|15 oz|16 oz|18 oz|20 oz|24 oz|26 oz|28 oz|30 oz|32 oz|40 oz|48 oz|64 oz|1 gal",
  drink: "12 oz|16 oz|20 oz|1 L|1.25 L|2 L|3 L|6-Pack|8-Pack|12-Pack|18-Pack|24-Pack|28-Pack|32-Pack",
  juice: "12 oz|15.2 oz|32 oz|46 oz|52 oz|54 oz|59 oz|64 oz|89 oz|96 oz|128 oz|1 gal|8-Pack|12-Pack|15-Pack",
  bag: "1.5 oz|2 oz|2.75 oz|3 oz|5 oz|6 oz|7 oz|8 oz|9 oz|10 oz|11 oz|12 oz|13 oz|14 oz|16 oz|20 oz",
  bigBag: "5 oz|8 oz|10 oz|12 oz|14 oz|16 oz|18 oz|20 oz|24 oz|26 oz|28 oz|32 oz|40 oz|48 oz|5 lb",
  box: "6 oz|8 oz|10 oz|11 oz|12 oz|13 oz|14 oz|15 oz|16 oz|18 oz|20 oz|24 oz|26 oz|30 oz",
  pouch: "2.5 oz|3 oz|4 oz|5 oz|6 oz|7 oz|8 oz|9 oz|10 oz|12 oz|14 oz|16 oz|20 oz",
  frozen: "10 oz|12 oz|14 oz|16 oz|18 oz|20 oz|22 oz|24 oz|26 oz|28 oz|32 oz|36 oz|40 oz|48 oz|64 oz",
  count: "6-Count|8-Count|10-Count|12-Count|16-Count|18-Count|20-Count|24-Count|30-Count|36-Count|40-Count|48-Count",
  lb: "1 lb|1.5 lb|2 lb|3 lb|4 lb|5 lb|10 lb|20 lb|25 lb|50 lb",
  meat: "12 oz|16 oz|20 oz|24 oz|32 oz|40 oz|1 lb|1.5 lb|2 lb|2.5 lb|3 lb|4 lb|5 lb|10 lb|20 lb",
  produce: "Each|1 lb|2 lb|3 lb|5 lb|8 oz|10 oz|12 oz|16 oz|24 oz|32 oz|5-Count|10-Count|16 oz Bag|32 oz Bag|48 oz Bag|5 lb Bag",
  rolls: "2 Rolls|4 Rolls|6 Rolls|8 Rolls|12 Rolls|16 Rolls|24 Rolls|32 Rolls",
  sheets: "40 Sheets|80 Sheets|100 Sheets|120 Sheets|150 Sheets|176 Sheets|200 Sheets|250 Sheets|312 Sheets|440 Sheets|500 Sheets|1000 Sheets",
  fluid: "8 fl oz|12 fl oz|16 fl oz|20 fl oz|24 fl oz|28 fl oz|33.8 fl oz|40 fl oz|64 fl oz|1 gal|2 pack|4 pack|6 pack",
  tube: "0.85 oz|1 oz|1.5 oz|2 oz|2.5 oz|3 oz|3.3 oz|3.4 oz|3.5 oz|3.75 oz|4 oz|4.6 oz|5 oz|5.5 oz|6 oz|8 oz|12 oz",
  apparel: "XS|S|M|L|XL|XXL|3XL|Small|Medium|Large|X-Large|2X-Large|3X-Large|S/M|M/L|One Size|Plus|Petite|Tall|Husky|Slim",
  waist: "28x30|30x30|30x32|32x30|32x32|32x34|34x30|34x32|34x34|36x30|36x32|36x34|38x30|38x32|38x34|40x30|40x32|40x34|42x32|42x34|44x30|44x32|46x32",
  shoe: "5|5.5|6|6.5|7|7.5|8|8.5|9|9.5|10|10.5|11|11.5|12|13|14|1 Little Kid|2 Little Kid|3 Little Kid|4 Little Kid|5 Big Kid|6 Big Kid|7 Big Kid|Toddler 6|Toddler 8|Toddler 10|Infant 1|Infant 2|Infant 3|Infant 4",
};

/** Every kind of product there is, by name (filled in by `kind`). */
export const KINDS = new Map();

/** Define a kind of product: its flavours, grades, sizes — and optionally its packs and [min, max] price. */
export const kind = (name, flavours, grades, sizes, packs = PACKS, price = [1.99, 24.99], ...extra) => {
  if (extra.length) throw new Error(`Kind "${name}": one list too many (colours belong in the flavours)`);
  if (KINDS.has(name)) throw new Error(`Kind "${name}" is defined twice`);
  // the lists are easy to shift by one; each must be what it says it is
  for (const [what, list] of [["flavours", flavours], ["grades", grades], ["sizes", sizes]]) {
    if (typeof list !== "string") throw new Error(`Kind "${name}": its ${what} must be written as a "|"-separated list`);
  }
  if (!Array.isArray(packs) || !packs.length || packs.some((x) => typeof x !== "string")) throw new Error(`Kind "${name}": its packs must be a list`);
  if (!Array.isArray(price) || price.length !== 2 || !price.every(Number.isFinite) || price[0] < 0 || price[0] >= price[1]) {
    throw new Error(`Kind "${name}": its price range must be [min, max]`);
  }
  for (const [what, list] of [["flavours", flavours], ["grades", grades], ["sizes", sizes]]) {
    if (!list.trim()) continue;
    if (/[~]/.test(list)) throw new Error(`Kind "${name}": its ${what} contain "~"`);
  }
  KINDS.set(name, { flavours: words(flavours), grades: words(grades), sizes: words(sizes), packs, price });
  return name;
};

/**
 * A department from its product rows:  product ~ brands ~ kind [~ min|max ].
 * Each row becomes one line of the department — its brands, that product,
 * and everything the kind says about it.
 */
export const D = (table) =>
  table
    .split("\n")
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => {
      const cells = row.split("~").map((cell) => cell.trim());
      if (cells.length < 3 || cells.length > 4) throw new Error(`A product row needs product ~ brands ~ kind: "${row}"`);
      const [name, brands, kindName, price] = cells;
      const base = name === "-" ? "" : name;
      const k = KINDS.get(kindName);
      if (!k) throw new Error(`"${name}": there is no kind "${kindName}"`);
      if (!words(brands).length) throw new Error(`"${name}": no brands`);
      if (price && !/^\d+(\.\d+)?\|\d+(\.\d+)?$/.test(price)) throw new Error(`"${name}": a price range is min|max: "${price}"`);
      return {
        brands: words(brands),
        kind: kindName,
        products: [{ base, flavours: k.flavours, grades: k.grades, sizes: k.sizes }],
        packs: k.packs,
        price: price ? price.split("|").map(Number) : k.price,
      };
    });
