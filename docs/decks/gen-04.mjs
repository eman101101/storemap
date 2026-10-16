/** Deck 04 — 3D Rendering Engine. */
import K from './kit.mjs';
const { C, F, W, M } = K;
const SYSTEM = '3D Rendering Engine';

const p = K.mk(SYSTEM);
K.cover(p, {
  kicker: 'StoreMap systems  ·  04',
  title: 'The 3D Rendering\nEngine',
  subtitle:
    'A dependency-free software renderer on Canvas 2D: extruded polygons, a per-layer BSP for exact depth order, near-plane clipping, and two data-driven themes — modern and retro 2010s.',
  stats: [
    { n: '0', label: 'dependencies (no WebGL, no three.js)' },
    { n: '~1k', label: 'lines in render3d.ts' },
    { n: '~2K', label: 'faces in a typical scene' },
    { n: '2', label: 'themes: modern + retro 2010s' },
  ],
  system: SYSTEM,
});

// 2 · pipeline
let s = p.addSlide();
K.header(s, { kicker: 'Pipeline', title: 'From map elements to pixels, once per frame', system: SYSTEM, page: 2 });
K.flow(p, s, {
  x: M, y: 1.7, w: W - 2 * M, bh: 1.05,
  steps: [
    { t: 'buildSceneFaces', d: 'extrude elements to prisms' },
    { t: 'subdivideFaces', d: 'tile quads > 4 m' },
    { t: 'buildSceneBSP', d: 'per-layer depth tree (data change only)' },
    { t: 'traverse + project', d: 'back-to-front, near-clip' },
    { t: 'Canvas fills', d: 'flat-shaded polygons' },
    { t: 'overlay', d: 'markers, pins, labels' },
  ],
});
K.bullets(s, [
  'Stages 1–3 are memoized on the data (floor, elements, theme) — camera motion never rebuilds geometry.',
  'Everything is a flat polygon ("Face"): world-space points, a pre-shaded fill color, an optional stroke, and a layer number.',
  'The overlay pass draws billboards that must never be occluded: entrance/exit poles, aisle symbols, product pins, labels.',
], { x: M, y: 3.15, w: W - 2 * M, h: 1.7, size: 12.5 });
K.codeCard(p, s, {
  x: M, y: 4.95, w: W - 2 * M, h: 1.95, file: 'Map3D.tsx — memoization', size: 9.5,
  code: `const sceneFaces = useMemo(() => buildSceneFaces(floor, elements, theme), [floor, elements, theme]);
const bspInput   = useMemo(() => {
  const faces = [...sceneFaces, ...stockFaces(stocking, theme)];
  if (theme.retro) faces.push(...buildContactShadows(elements, theme));
  if (route?.length > 1) faces.push(...routeFaces(route, theme));
  return faces;
}, [sceneFaces, stocking, route, theme, elements]);
const sceneBSP   = useMemo(() => buildSceneBSP(bspInput), [bspInput]);`,
});

// 3 · camera
s = p.addSlide();
K.header(s, { kicker: 'Camera', title: 'An orbit model with hand-written projection', system: SYSTEM, page: 3 });
K.codeCard(p, s, {
  x: M, y: 1.7, w: 7.2, h: 4.5, file: 'render3d.ts — toCamera / camToScreen', size: 10,
  code: `// world → camera space (relative to the look-at target)
x1   = dx*cosY - dy*sinY;          // yaw about z
y1   = dx*sinY + dy*cosY;
up   = dz*cosP - y1*sinP;          // pitch
depth = dist - y1*cosP - dz*sinP;

// perspective divide (vertical FOV)
f  = h/2 / tan(fov/2);             // ≈ focal length
sx = w/2 + f * x1  / depth;
sy = h/2 - f * up  / depth;

// eye position (BSP traversal + picking need it)
eye = { x: tx + dist*cosP*sinY,
        y: ty + dist*cosP*cosY,
        z: tz + dist*sinP };`,
});
K.bullets(s, [
  'The camera is four numbers plus a target — {yaw, pitch, dist, tx/ty/tz} — shared with the parent so 2D↔3D toggles keep the angle.',
  'y points down (matching the 2D map), z is up; looking straight down reproduces the 2D layout exactly.',
  'pitch is clamped to 0.18–1.45 rad and distance to 3–160 m; fov defaults to 50°.',
  'camFromEyeLook inverts the model — the flight mode specifies eye + look-at and gets the orbit numbers back.',
], { x: 8.0, y: 1.75, w: 4.8, h: 4.4, size: 11.5 });

// 4 · clipping
s = p.addSlide();
K.header(s, { kicker: 'Clipping', title: 'Fly through a wall and it keeps rendering', system: SYSTEM, page: 4 });
K.bullets(s, [
  'Canvas 2D cannot skip a polygon that crosses the camera — the perspective divide explodes behind the near plane.',
  'project() returns null per point when depth < NEAR (0.25 m); a face with all points behind is skipped.',
  'A face straddling the camera is clipped in camera space, Sutherland–Hodgman style, against depth ≥ NEAR — the visible part survives.',
  'This is what makes the drone fly-through possible: the camera glides down aisles between shelf faces at 8 m altitude.',
], { x: M, y: 1.75, w: 7.3, h: 3.1, size: 12.5 });
K.codeCard(p, s, {
  x: M, y: 5.0, w: 7.3, h: 1.85, file: 'clipPolygonNear (essentials)', size: 10,
  code: `for each edge (a → b):
  if a inside (depth ≥ NEAR) → emit a
  if a,b straddle → emit lerp(a, b, t at NEAR)`,
});
K.codeCard(p, s, {
  x: 8.1, y: 1.75, w: 4.7, h: 5.1, file: 'why camera space?', size: 10.5,
  code: `Clipping happens BEFORE the
perspective divide, in camera
space, against a single plane:

  depth ≥ NEAR (0.25 m)

Interpolating x1/up/depth
linearly is exact here;
interpolating screen coords
after the divide would bend
the geometry.

NEAR = 0.25 m — tight enough
for aisles, loose enough to
avoid precision artifacts.`,
});

// 5 · occlusion + tiling
s = p.addSlide();
K.header(s, { kicker: 'Occlusion', title: 'Tiling makes centroid depth local', system: SYSTEM, page: 5 });
K.bullets(s, [
  'Painter\'s algorithms sort by face centroid. A 54 m wall\'s centroid sits mid-store — a shelf near its end could wrongly paint over the wall section in front of it.',
  'subdivideFaces splits any quad longer than 4 m into a bilinear tile grid, so every centroid describes local depth.',
  'Horizontal solid faces (shelf caps) tile finely — 0.6 m along depth — so the sliver visible over a wall doesn\'t flip per whole tile (dashes).',
  'Escape hatch: a face needing > 128 tiles passes through untiled rather than exploding memory.',
], { x: M, y: 1.75, w: 7.4, h: 3.4, size: 12.5 });
K.chip(p, s, {
  x: M, y: 5.3, w: 7.4, label: 'Rule',
  text: 'Tile count = ceil(len / 4 m) per axis, capped at 16 per axis. Caps get no outline — tiled caps would show strokes as grid lines.',
});
K.codeCard(p, s, {
  x: 8.1, y: 1.75, w: 4.7, h: 4.7, file: 'subdivideFaces (core)', size: 10,
  code: `const nu = clamp(ceil(uLen / 4));   // ≤ 16
let   vTile = 4;
if (horizontalSolid(f)) vTile = 0.6;
const nv = clamp(ceil(vLen / vTile));

for (i < nu) for (j < nv) {
  out.push({ ...face, pts: [
    bil(u0, v0), bil(u1, v0),
    bil(u1, v1), bil(u0, v1),
  ]});
}

// bilinear interpolation over the
// 4 corners — tiles span the quad
// exactly (pinned by tests)`,
});

// 6 · BSP
s = p.addSlide();
K.header(s, { kicker: 'Depth ordering', title: 'A per-layer BSP gives exact back-to-front order', system: SYSTEM, page: 6 });
K.bullets(s, [
  'Canvas 2D has no z-buffer — draw order IS the visibility. The BSP emits an order that is exact for any camera position.',
  'Splitter choice: the largest-area face; the split plane is its own plane (thinnest bounding axis). Faces straddling it are geometrically split.',
  'Faces are grouped by layer first (floor 0 → grid 0.25 → decals 0.5 → route 1 → solids 2); each layer gets its own tree.',
  'Depth cap 40: an unresolvable leaf keeps its faces and traversal sorts them by centroid depth — a painter\'s fallback that caps can never corrupt.',
  'Built once per data change (never per frame); per-frame cost is a linear traversal from the eye.',
], { x: M, y: 1.75, w: 7.4, h: 4.4, size: 12.5 });
K.codeCard(p, s, {
  x: 8.1, y: 1.75, w: 4.7, h: 4.7, file: 'traverseFaceBSP', size: 10.5,
  code: `function traverse(node, eye, out) {
  if (!node) return;
  const at = axisValue(eye, node.axis);
  if (at > node.split) {
    traverse(node.below, eye, out);
    emitLeaf(node.faces, eye, out);
    traverse(node.above, eye, out);
  } else {
    traverse(node.above, eye, out);
    emitLeaf(node.faces, eye, out);
    traverse(node.below, eye, out);
  }
}

// far side of each plane first —
// exact for any eye position`,
});

// 7 · boxes & lighting
s = p.addSlide();
K.header(s, { kicker: 'Fixtures', title: 'Boxes, caps and one directional light', system: SYSTEM, page: 7 });
K.stats(s, [
  { n: '1.18×', l: 'cap brightness — the top must out-shine every side to read as a surface' },
  { n: '0.94×', l: 'side brightness (retro splits sides into 1.05 / 0.66 gloss bands)' },
  { n: '1 mm', l: 'walls stop below the cap — strict z separation for the BSP, zero visible gap' },
]);
K.bullets(s, [
  'boxFaces extrudes any convex base: a full-size cap plus one side quad per edge (retro splits sides into sunlit band + shaded base).',
  'Shading is one dot product: brightness = ambient + diffuse · |normal · light|, against a fixed upper-left key light.',
  'The cap walls\' 1 mm setback is why cap-vs-wall ordering is provably exact (no shared plane) — the earlier inset variant showed seams at close zoom.',
  'TYPE_HEIGHT: wall 3.2 m, shelf 1.5 m; zones/aisles below 0.12 m render as flat decals instead of boxes.',
], { x: M, y: 3.3, w: 7.5, h: 3.4, size: 12.5 });
K.codeCard(p, s, {
  x: 8.2, y: 1.75, w: 4.6, h: 4.9, file: 'boxFaces (shape)', size: 10,
  code: `const WALL_SHORT = 0.001;
t = base.map(p => ({…p, z: height   }));  // cap
wt = base.map(p => ({…p, z: height-ε}));  // wall tops
b = base.map(p => ({…p, z: 0}));

faces.push({ pts: t,           // cap
  fill: lit(up, color, 1.18) });

for each edge (i → j):
  n = outwardNormal(b[i], b[j]);
  faces.push({ pts: [wt[i], wt[j], b[j], b[i]],
    fill: lit(n, color, 0.94) });`,
});

// 8 · themes
s = p.addSlide();
K.header(s, { kicker: 'Themes', title: 'Modern and Retro 2010s are pure data', system: SYSTEM, page: 8 });
K.table(p, s, {
  x: M, y: 1.75, w: W - 2 * M, colW: [2.6, 4.9, 4.9], size: 11,
  rows: [
    ['Aspect', 'MODERN_THEME', 'RETRO_THEME'],
    ['Sky', 'pale neutral gradient', 'saturated blue → horizon haze (no sun — removed by request)'],
    ['Floor / grid', 'bone white #F5F3EC', 'warm parchment #E9DCBA'],
    ['Lighting', 'ambient .55 / diffuse .45', 'ambient .42 / diffuse .58 — punchier contrast'],
    ['Sides', 'single quad per edge', 'two-tone gloss: sunlit band + shaded base'],
    ['Shadows', 'none', 'soft decal per fixture, offset away from the light'],
    ['Route', 'flat orange ribbon', 'gloss strip + dashed centerline'],
    ['Labels', 'soft white halo', 'warm halo + dark outline + cream text'],
    ['Post', 'none', 'vignette under the overlay pass'],
  ],
});
s.addText('Themes are one object (MapTheme) threaded through every builder as an optional argument — the default is modern, so existing callers and pinned tests are untouched.', { x: M, y: 6.35, w: W - 2 * M, h: 0.4, fontSize: 11.5, fontFace: F.body, color: C.MUTED, margin: 0 });

// 9 · scene composition
s = p.addSlide();
K.header(s, { kicker: 'Scene composition', title: 'What actually gets drawn', system: SYSTEM, page: 9 });
K.bullets(s, [
  { t: 'Floor slab + 1 m grid lines', bold: true },
  { t: 'Fixtures as boxes: shelves 1.5 m, walls 3.2 m (polyline walls = chained thin boxes)', bold: false },
  { t: 'Zones / aisles as translucent decals at layer 0.5', bold: false },
  { t: 'Route ribbon + gloss + start/goal discs', bold: false },
  { t: 'Stock blocks: one colored facing per pinned product, standing on its shelf face along the anchor normal (z 0.32–1.18 m)', bold: false },
  { t: 'Product pins: stocked items draw a dot ON the shelf face (z 1.05); free pins draw a pole + balloon; focused pins add a floor ring + label', bold: false },
  { t: 'Entrance / exit / POI: ground disc + 2 m pole + glyph head ⬆ ⬇ ★', bold: false },
  { t: 'Aisle symbols: floating ≡ disc at the aisle midpoint — hover shows the contents', bold: false },
  { t: 'Labels: depth-scaled (260/depth, clamped 8.5–14), deduped within 140 px', bold: false },
], { x: M, y: 1.75, w: 7.4, h: 4.8, size: 12 });
K.codeCard(p, s, {
  x: 8.1, y: 1.75, w: 4.7, h: 4.8, file: 'overlay pass (hit-testing falls out)', size: 10,
  code: `// every drawn pin returns its
// projected position — taps are
// just "nearest within 18 px":
hits.pins.push({ productId,
  sx: dot.x, sy: dot.y });

// aisle symbols too:
hits.aisles.push({ elementId,
  sx: top.x, sy: top.y });`,
});

// 10 · performance
s = p.addSlide();
K.header(s, { kicker: 'Performance', title: 'The budget that keeps 60 fps on cheap phones', system: SYSTEM, page: 10 });
K.bullets(s, [
  'Typical scenes peak around 2,000 faces — one fill each — comfortably inside Canvas 2D on a low-end device.',
  'Geometry and the BSP rebuild only when the data changes; a camera drag is traverse → project → fill, no allocations in the hot path.',
  'Forbidden on purpose: ctx.shadowBlur, ctx.filter, per-face gradients — each would multiply the fill cost or allocate per frame.',
  'Device pixel ratio is capped at 2× — retina-sharp, but bounded fill area.',
  'Two-tone gloss and contact shadows exist precisely to fake gradient looks with plain fills.',
], { x: M, y: 1.75, w: 7.4, h: 3.6, size: 12.5 });
K.chip(p, s, {
  x: M, y: 5.5, w: 7.4, label: 'Design rule',
  text: 'Add polygons, never filters. Every visual effect in this engine is more correctly-ordered flat geometry.',
});
K.codeCard(p, s, {
  x: 8.1, y: 1.75, w: 4.7, h: 4.8, file: 'render effect (Map3D)', size: 10,
  code: `useEffect(() => {
  const dpr = min(2, devicePixelRatio);
  canvas.width  = round(size.w * dpr);
  canvas.height = round(size.h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  hitsRef.current = renderScene(
    ctx, size.w, size.h, cam,
    floor, elements, {
      bsp: sceneBSP, route, pins: pins3d,
      theme, selectedId, hoverId,
    });
}, [cam, size, floor, elements, pins,
    focusPinId, route, sceneBSP, theme]);`,
});

K.closing(p, {
  title: 'Engine rules this system keeps',
  system: SYSTEM,
  points: [
    { t: 'Exact ordering, no heuristics', d: 'BSP traversal + geometric splitting beats centroid sorts; depth-capped leaves fall back to centroid order.' },
    { t: 'Strictly separated coplanars', d: 'walls 1 mm below the cap: provable draw order with zero visible gap.' },
    { t: 'Effects are geometry', d: 'gloss, shadows, gloss routes — all plain fills; no Canvas filters anywhere.' },
    { t: 'Themes are data', d: 'one MapTheme object switches the entire look without touching call sites.' },
  ],
});

p.writeFile({ fileName: '04-3d-rendering-engine.pptx' }).then(() => console.log('ok 04'));
