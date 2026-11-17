/**
 * Symbols for common store places: a marker's type + label ("Checkout",
 * "Washrooms", "Customer service"…) maps to a glyph that stands in for the
 * name — on a map, a picture beats a word at every zoom. Shared by the 2D
 * SVG canvas and the 3D renderer so a place reads the same in both. Null =
 * no known symbol; the marker keeps its name label.
 */
const PLACE_GLYPHS: [RegExp, string][] = [
  [/entranc|entry\b/i, '⬆'],
  [/\bexit|leaving/i, '⬇'],
  [/customer\s*service|service\s*desk|information|^info\b/i, '🛎'],
  [/washroom|restroom|toilet|^wc$|bathroom/i, '🚻'],
  [/check\s*-?out|cashier|till\b|register/i, '🛒'],
  [/pharmac/i, '💊'],
  [/first\s*aid/i, '⛑'],
  [/elevator|\blift\b/i, '🛗'],
  [/escalator/i, '⇗'],
  [/parking|car\s*park/i, '🅿'],
  [/\batm\b|cash\s*point/i, '🏧'],
  [/cart|trolley/i, '🛒'],
  [/cafe|coffee|espresso/i, '☕'],
  [/baker|bakehouse/i, '🥖'],
  [/butcher|meat/i, '🥩'],
  [/deli\b/i, '🧀'],
  [/seafood|fish\b/i, '🐟'],
  [/produce|fruit|vegetable|green\s*grocer/i, '🥬'],
  [/floral|flower/i, '💐'],
];

/** The symbol for a place marker, or null when its label has no known glyph. */
export function placeGlyph(type: string, label: string | null | undefined): string | null {
  const hay = `${type} ${label ?? ''}`;
  for (const [re, glyph] of PLACE_GLYPHS) {
    if (re.test(hay)) return glyph;
  }
  return null;
}
