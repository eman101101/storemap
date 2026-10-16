/** Deck 06 — Wayfinding & Trips. */
import K from './kit.mjs';
const { C, F, W, M } = K;
const SYSTEM = 'Wayfinding';

const p = K.mk(SYSTEM);
K.cover(p, {
  kicker: 'StoreMap systems  ·  06',
  title: 'Wayfinding\n& Trips',
  subtitle:
    'A 0.25 m navigation grid rasterized from the floor\'s fixtures, a textbook A* with clearance, greedy multi-stop trips with turn-by-turn text, and a constant-pitch camera flight down the route.',
  stats: [
    { n: '0.25m', label: 'nav grid cell' },
    { n: '0.3m', label: 'shopper clearance' },
    { n: 'A*', label: 'octile heuristic, binary heap' },
    { n: 'N', label: 'stops ordered greedily per trip' },
  ],
  system: SYSTEM,
});

// 2 · nav grid
let s = p.addSlide();
K.header(s, { kicker: 'Navigation grid', title: 'Rasterize the floor once, route many times', system: SYSTEM, page: 2 });
K.bullets(s, [
  'buildNavGrid turns a floor into a blocked-cell bitmap: 0.25 m cells, walls and shelves block, everything else walks.',
  'Each fixture inflates by the shopper clearance (0.3 m) — cells whose center sits inside the inflated body are blocked.',
  'Cells outside the floor slab are blocked, so routes never leave the building.',
  'The grid is cached per floor (useMemo) and reused by every route and trip computation — the E3 optimization.',
], { x: M, y: 1.75, w: 7.3, h: 3.0, size: 12.5 });
K.codeCard(p, s, {
  x: 8.0, y: 1.75, w: 4.8, h: 4.7, file: 'navgrid.ts (rasterize)', size: 10,
  code: `const BLOCKING = new Set(['wall', 'shelf']);

for (const el of elements) {
  if (!BLOCKING.has(el.type)) continue;
  const bb = bboxOf(elementPoints(el));
  for (cells in bb inflated by clearance) {
    const c = cellCenter(col, row);
    if (elementContains(el, c, clearance))
      blocked[row * cols + col] = 1;
  }
}

// polyline walls block via distance
// to their segments — complex
// footprints just work`,
});

// 3 · A*
s = p.addSlide();
K.header(s, { kicker: 'A*', title: 'Textbook A*, minus the shortcuts that bite', system: SYSTEM, page: 3 });
K.table(p, s, {
  x: M, y: 1.75, w: W - 2 * M, colW: [3.4, 10.0], size: 11.5,
  rows: [
    ['Detail', 'Why it matters'],
    ['Octile heuristic (admissible)', '8-directional grid; never overestimates → optimal paths'],
    ['Binary min-heap', 'open set operations stay O(log n) on large stores'],
    ['Diagonal corner-cut prevention', 'a diagonal move is allowed only when both adjacent orthogonals are free — no squeezing through corners'],
    ['Exact-goal pinning', 'if the goal cell is blocked, the nearest reachable cell to the goal is used instead of failing'],
    ['Sealed-room behavior', 'unreachable goals return null; the UI degrades (no route badge) rather than lying'],
    ['Grid reuse', 'one buildNavGrid per floor serves every search until the fixtures change'],
  ],
});
s.addText('Property-style tests pin the guarantees: clearance sampling, sealed-room unreachability, endpoint pinning, and path-length optimality.', { x: M, y: 6.15, w: W - 2 * M, h: 0.4, fontSize: 11.5, fontFace: F.body, color: C.MUTED, margin: 0 });

// 4 · route & entrance
s = p.addSlide();
K.header(s, { kicker: 'Routing', title: 'Entrance → item, then smoothed', system: SYSTEM, page: 4 });
K.flow(p, s, {
  x: M, y: 1.75, w: W - 2 * M, bh: 1.0,
  steps: [
    { t: 'Goal', d: 'pin x/y on the floor' },
    { t: 'Grid A*', d: 'entrance cell → goal cell' },
    { t: 'Unwrap cells', d: 'cell centers → polyline' },
    { t: 'Smooth + pin ends', d: 'exact entrance and item points' },
    { t: 'distanceM', d: 'route badge: meters + walk minutes' },
  ],
});
K.bullets(s, [
  'The route starts at the store\'s entrance marker — placed by the owner, so the walk starts where shoppers actually enter.',
  'computeRoute returns the polyline plus distance; the badge shows meters and ≈ minutes at WALK_M_PER_MIN.',
  'Multi-floor stores: the item\'s floor wins — the viewer switches floors and routes there.',
  'Both engines draw the same polyline: SVG casing + orange line in 2D, a floor-hugging ribbon (gloss + dashes in retro) in 3D.',
], { x: M, y: 3.2, w: 7.4, h: 2.6, size: 12.5 });
K.codeCard(p, s, {
  x: 8.1, y: 3.2, w: 4.7, h: 3.2, file: 'ViewerPage — one search, one route', size: 10,
  code: `const r = computeRoute(
  locFloor,
  elements.filter(e => e.floor_id === loc.floor_id),
  { x: loc.x, y: loc.y },        // goal
  {},                            // options
  navGrid ?? undefined           // cached grid
);
setRoute({ floorId: loc.floor_id,
           points: r.points,
           distanceM: r.distanceM });`,
});

// 5 · trips
s = p.addSlide();
K.header(s, { kicker: 'Multi-stop trips', title: 'Order the stops, then narrate every leg', system: SYSTEM, page: 5 });
K.bullets(s, [
  'Shoppers queue items with the Trip button; computeTrip orders stops greedily (always travel to the nearest unvisited stop).',
  'Each leg is routed on the same nav grid; total distance and minutes summarize the trip.',
  'Leg narration: one of 8 compass words (from the leg\'s angle, screen y-down corrected), the leg\'s meters, and the nearest labeled shelf — "120 m south past Dairy".',
  'Numbered discs mark the stops on both engines; the trip panel lists removable steps with live distance updates.',
  'Screen readers get the whole trip as one aria-live sentence — stops, meters, minutes.',
], { x: M, y: 1.75, w: 7.3, h: 3.6, size: 12.5 });
K.codeCard(p, s, {
  x: 8.0, y: 1.75, w: 4.8, h: 4.9, file: 'turn text (ViewerPage)', size: 10,
  code: `const dirs = ['east', 'south-east', 'south',
  'south-west', 'west', 'north-west',
  'north', 'north-east'];

const ang = Math.atan2(-dy, dx);  // screen
const word = dirs[Math.round(
  (ang / Math.PI) * 4 + 8) % 8];

text = \`\${dist} m \${word}\` +
       (near ? \` past \${near}\` : '');

// nearest labeled shelf within 6 m
// of the leg's midpoint`,
});

// 6 · flight
s = p.addSlide();
K.header(s, { kicker: 'The flight', title: 'A drone that holds one angle from takeoff to arrival', system: SYSTEM, page: 6 });
K.stats(s, [
  { n: '8 m', l: 'drone altitude above the path' },
  { n: '9 m/s', l: 'walk speed (duration clamped 3–9 s)' },
  { n: '45°', l: 'constant pitch — atan2(8, 12)' },
  { n: '750ms', l: 'ease-out approach glide' },
]);
K.bullets(s, [
  'pathSampler arc-length parameterizes the route; at arc s the camera eye trails 4 m behind and looks 4 m ahead — the horizon stays stable.',
  'One seq gate: the first route drawn never auto-plays; only the ✈ Fly button (or F) starts the flight.',
  'prefers-reduced-motion skips the flight entirely — the camera eases straight to the arrival overview.',
  'Any pointer interaction cancels the flight (skip button too); arrival tweens to an overview framing of the item.',
], { x: M, y: 3.35, w: 7.4, h: 3.0, size: 12.5 });
K.codeCard(p, s, {
  x: 8.1, y: 3.35, w: 4.7, h: 3.55, file: 'Map3D — camAtS', size: 10,
  code: `const camAtS = (s) => camFromEyeLook(
  { x: sampler.at(s - EYE_BACK).x,
    y: sampler.at(s - EYE_BACK).y,
    z: EYE_Z },
  { x: sampler.at(s + LOOK_AHEAD).x,
    y: sampler.at(s + LOOK_AHEAD).y,
    z: LOOK_Z }
);

// approach glide → walk s(t) →
// arrival overview tween. Every
// rAF checks a cancellation flag.`,
});

K.closing(p, {
  title: 'Wayfinding rules this system keeps',
  system: SYSTEM,
  points: [
    { t: 'Rasterize once, route everywhere', d: 'the nav grid is the single source of walkability for routes, trips and the flight.' },
    { t: 'Never lie to shoppers', d: 'unreachable goals return no route; clearance is real shopper width, not wishful thinking.' },
    { t: 'Narrate like a human', d: 'compass words plus the nearest labeled shelf beat coordinate dumps.' },
    { t: 'Respect the user\'s motion settings', d: 'prefers-reduced-motion trades spectacle for comfort without losing function.' },
  ],
});

p.writeFile({ fileName: '06-wayfinding-trips.pptx' }).then(() => console.log('ok 06'));
