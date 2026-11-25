/**
 * Generated packshot fallbacks for the demo photo scripts. Any seeded item
 * without a downloaded photo gets a stylized SVG (bottle/can/box/bag/jar
 * shape by keyword, deterministic category-ish hue, label text), so EVERY
 * demo item still resolves to an image file. Pure functions — shared by
 * fetch-demo-photos.mjs (Open Food Facts) and fetch-demo-photos-cc.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';

export const slug = (name) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40);

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

export function packshotSvg(name, hue = hashHue(name)) {
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

/** Write the SVG fallback for `name` (kept if present) and return its url. */
export function writePackshotSvg(dir, name) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${slug(name)}.svg`);
  if (!fs.existsSync(file)) fs.writeFileSync(file, packshotSvg(name));
  return `/media/gen/${slug(name)}.svg`;
}
