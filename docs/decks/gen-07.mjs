/** Deck 07 — Shelf Planogram & Aisle Info. */
import K from './kit.mjs';
const { C, F, W, M } = K;
const SYSTEM = 'Shelf Planogram';

const p = K.mk(SYSTEM);
K.cover(p, {
  kicker: 'StoreMap systems  ·  07',
  title: 'Shelf Planogram\n& Aisle Info',
  subtitle:
    'The same pin coordinates drive three views — the 2D map dot, the 3D facing block, and the front-of-shelf planogram. Aisle ribbons add midpoint labels and hover-to-see contents.',
  stats: [
    { n: '3', label: 'views driven by one pin coordinate' },
    { n: '≤40', label: 'bays per shelf (meta, clamped)' },
    { n: '2m', label: 'aisle reach for contents' },
    { n: '0.32m', label: 'default facing width' },
  ],
  system: SYSTEM,
});

// 2 · pipeline
let s = p.addSlide();
K.header(s, { kicker: 'One coordinate, three views', title: 'Map dot → 3D block → planogram facing', system: SYSTEM, page: 2 });
K.flow(p, s, {
  x: M, y: 1.75, w: W - 2 * M, bh: 1.15,
  steps: [
    { t: 'product_locations', d: 'x, y on a floor (the pin)' },
    { t: '2D map', d: 'dot on the shelf edge (shelfAnchor)' },
    { t: '3D view', d: 'block standing on that shelf face + pin dot at z 1.05' },
    { t: 'Planogram', d: 'inverse-rotate into the shelf frame → bay / level / facing' },
  ],
});
s.addText('Because all three derive from the same coordinates, a shopper\'s map dot, the retailer\'s planogram and the 3D stocking never disagree.', { x: M, y: 3.3, w: W - 2 * M, h: 0.4, fontSize: 12, fontFace: F.body, color: C.MUTED, margin: 0 });
K.bullets(s, [
  'shelfAnchor finds the nearest shelf edge to a pin and its outward normal — the dot "sticks" to the face the item is stocked against.',
  'computeShelfLayout works purely from the rect geometry + pins; meta only tunes bay/level counts.',
  'Pins that land outside the shelf (moved shelves) land in an "outside" list — the planogram says so instead of hiding them.',
], { x: M, y: 3.85, w: W - 2 * M, h: 1.8, size: 12.5 });

// 3 · local frame math
s = p.addSlide();
K.header(s, { kicker: 'The math', title: 'Inverse-rotate the pin into the shelf\'s frame', system: SYSTEM, page: 3 });
K.codeCard(p, s, {
  x: M, y: 1.7, w: 7.2, h: 3.4, file: 'shelfLayout.ts — worldToShelfLocal', size: 10.5,
  code: `export function worldToShelfLocal(r, p) {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  const a = (-r.rot * Math.PI) / 180;
  return {
    x: r.w/2 + (p.x-cx)*cos(a) - (p.y-cy)*sin(a),
    y: r.h/2 + (p.x-cx)*sin(a) + (p.y-cy)*cos(a),
  };
  // local.x ∈ [0, w] → position along the shelf (u = x / w)
  // local.y ∈ [0, h] → depth; maps to a level on deep shelves
}`,
});
K.bullets(s, [
  'Works for any rotation: a 45° aisle shelf sorts its pins exactly like an axis-aligned one.',
  'u clamps to [0, 1]; the bay index is floor(u × bayCount) — pins can\'t fall off the end.',
  'pinInShelf applies a 0.35 m tolerance so edge pins still count as stocked.',
], { x: M, y: 5.25, w: 7.2, h: 1.6, size: 12 });
K.codeCard(p, s, {
  x: 8.0, y: 1.7, w: 4.8, h: 5.15, file: 'computeShelfLayout (shape)', size: 10,
  code: `const bayCount = clampInt(meta.bays, 1, 40)
  ?? max(1, round(width / 1.25));
const levelCount = clampInt(meta.levels, 1, 12)
  ?? 3;
const facing = clampNum(meta.facing, 0.05, 3)
  ?? 0.32;

inside / outside = partition(pins, pinInShelf)

slots = inside.map(pin => ({
  u: local.x / width,
  level: meta.shelf_level ??
    (deep ? levelCount - floor(local.y/depth*levels) : 1),
}));

bays = split by floor(u * bayCount), sorted by u`,
});

// 4 · meta config
s = p.addSlide();
K.header(s, { kicker: 'Configuration', title: 'Retailer-tunable, clamped for safety', system: SYSTEM, page: 4 });
K.table(p, s, {
  x: M, y: 1.75, w: W - 2 * M, colW: [2.4, 2.6, 8.4], size: 11.5,
  rows: [
    ['Meta field', 'Default / clamp', 'Meaning'],
    ['bays', 'auto (width ÷ 1.25 m), 1–40', 'vertical dividers along the shelf width; editor field "Bays"'],
    ['levels', '3, 1–12', 'horizontal shelves; deep shelves map pin depth to a level automatically'],
    ['facing', '0.32 m, 0.05–3', 'width one product occupies on the planogram'],
    ['shelf_level', '—', 'per-pin override: pin a product to a specific level regardless of depth'],
  ],
});
K.bullets(s, [
  'meta is a JSON string on the element — the element validator passes it through, clamps happen at read time (never crashes on junk).',
  'The editor\'s Shelf layout panel edits bays/levels live; "View shelf layout" previews exactly what shoppers see.',
], { x: M, y: 4.6, w: W - 2 * M, h: 1.2, size: 12.5 });

// 5 · ShelfDetail
s = p.addSlide();
K.header(s, { kicker: 'The planogram view', title: 'ShelfDetail — the front of the shelf', system: SYSTEM, page: 5 });
K.bullets(s, [
  'Tap a shelf on the public map (2D or 3D) to open it: bays as columns, levels as rows, each product drawn as a facing at its u position.',
  'Bay chips list contents ("Bay 2: Popcorn", "empty") — clickable to focus the product on the map.',
  'Pins near but outside the footprint are counted honestly: "38 pinned products near this shelf sit outside its footprint".',
  'Width, bays and level counts come from the layout computation — the popup can\'t disagree with the map.',
  'The editor\'s "View shelf layout" button opens the same component — what you tune is what shoppers get.',
], { x: M, y: 1.75, w: 7.3, h: 3.8, size: 12.5 });
K.codeCard(p, s, {
  x: 8.0, y: 1.75, w: 4.8, h: 5.0, file: 'ShelfDetail (render shape)', size: 10,
  code: `const layout = computeShelfLayout(shelf, pins);

<planogram width={layout.width}>
  {layout.bays.map(bay =>
    <bay from={bay.from} to={bay.to}>
      {bay.slots.map(slot =>
        <facing u={slot.u}
                level={slot.level}
                w={slot.facingWidth}
                color={product.color} />
      )}
    </bay>)}
</planogram>

<chips>
  {bays.map(b => b.slots.length
    ? \`Bay \${b.index+1}: \${names}\`
    : \`Bay \${b.index+1}: empty\`)}
</chips>`,
});

// 6 · 3D stock faces
s = p.addSlide();
K.header(s, { kicker: 'In 3D', title: 'Stock blocks make fixtures look merchandised', system: SYSTEM, page: 6 });
K.bullets(s, [
  'Every pinned product contributes a block standing on its shelf face: 0.9 m wide, z 0.32–1.18 m, offset 4 cm proud of the face along the anchor normal.',
  'Color is the category color with a deterministic shade jitter from the pin coordinates — shelves look varied but stable across visits.',
  'Blocks join the scene BSP: the exact depth order hides back-side blocks behind the shelf\'s own body with no culling code.',
  'Deep shelves (2+ m) show blocks on BOTH faces — the depth sort picks the visible side per camera.',
], { x: M, y: 1.75, w: 7.3, h: 3.0, size: 12.5 });
K.chip(p, s, {
  x: M, y: 4.9, w: 7.3, label: 'Coupling note',
  text: 'Block heights assume the 1.5 m shelf. Per-shelf heights (a planned feature) must derive these z values from the element, not hardcode them.',
});
K.codeCard(p, s, {
  x: 8.0, y: 1.75, w: 4.8, h: 5.0, file: 'stockFaces + anchor', size: 10,
  code: `// geometry.ts — nearest edge + outward normal
shelfAnchor(p, elements, maxDist = 1.4):
  for each shelf, each edge:
    q = closestPointOnSegment(p, a, b)
    keep the best (min distance)
  return { x: q.x, y: q.y, nx, ny }

// render3d.ts — the block
tx = -ny; ty = nx;              // tangent
o  = anchor + normal * 0.04;    // proud
faces.push({ pts: [o ± tangent*0.45
                   at z 0.32 … 1.18],
  fill: shade(color, jitter) });`,
});

// 7 · aisle info
s = p.addSlide();
K.header(s, { kicker: 'Aisle info', title: 'Labels on the line; hover shows what\'s in it', system: SYSTEM, page: 7 });
K.bullets(s, [
  'aisleMidpoint returns the arc-length midpoint of the ribbon — always ON the line, unlike the vertex average (which leaves bent aisles).',
  'In 2D the label renders there, uppercase with a white halo; in 3D a floating ≡ symbol marks the same spot with the label above it.',
  'Hover (2D: wide invisible hit path; 3D: the symbol, 16 px) opens the contents card.',
  'aisleContents gathers pins within 2 m of the path — an aisle\'s width plus shopper reach — and groups them by category, biggest first.',
  'The card shows up to 4 category chips with counts and the total: "Produce · 5, Dairy · 2 — 7 items within 2 m".',
], { x: M, y: 1.75, w: 7.3, h: 3.8, size: 12.5 });
K.codeCard(p, s, {
  x: 8.0, y: 1.75, w: 4.8, h: 5.0, file: 'aisleInfo.ts (essentials)', size: 10,
  code: `export const AISLE_REACH_M = 2.0;

export function aisleContents(aisle, pins) {
  const pts = polyPoints(aisle);
  for (const pin of pins) {
    if (distToPolyline(pin, pts) > REACH)
      continue;
    byCat[category] ++;      // color, count
    examples.push(name);     // first 6
  }
  return { categories: sorted(byCat),
           count, examples };
}

// polyMidpoint: walk cum(arc) to
// half the total length`,
});

K.closing(p, {
  title: 'Planogram rules this system keeps',
  system: SYSTEM,
  points: [
    { t: 'One coordinate, all views', d: 'map, 3D stocking and planogram derive from the pin — they cannot disagree.' },
    { t: 'Rotation is a first-class citizen', d: 'inverse-rotated local frames make 45° shelves exactly as correct as straight ones.' },
    { t: 'Clamp at read time', d: 'meta values from the database are clamped before use; junk meta degrades, never crashes.' },
    { t: 'Say it honestly', d: 'outside pins are counted and disclosed, not hidden.' },
  ],
});

p.writeFile({ fileName: '07-shelf-planogram-aisles.pptx' }).then(() => console.log('ok 07'));
