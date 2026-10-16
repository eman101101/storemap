/** Deck 05 — 3D Editing & Picking. */
import K from './kit.mjs';
const { C, F, W, M } = K;
const SYSTEM = '3D Editing & Picking';

const p = K.mk(SYSTEM);
K.cover(p, {
  kicker: 'StoreMap systems  ·  05',
  title: '3D Editing\n& Picking',
  subtitle:
    'The editor\'s 2D|3D toggle shares one element pipeline: ray-cast picking against extruded bodies, floor-plane dragging with grid snap, hover previews, and keyboard parity — all feeding the same undo and autosave.',
  stats: [
    { n: '1', label: 'ray cast per hover / click' },
    { n: '0.25m', label: 'drag grid snap' },
    { n: '420ms', label: 'camera focus tweens' },
    { n: '94', label: 'frontend tests guarding it' },
  ],
  system: SYSTEM,
});

// 2 · architecture
let s = p.addSlide();
K.header(s, { kicker: 'Architecture', title: 'Two viewports, one pipeline', system: SYSTEM, page: 2 });
K.flow(p, s, {
  x: M, y: 1.75, w: W - 2 * M, bh: 1.1,
  steps: [
    { t: 'EditorPage state', d: 'elements · selectedId · history · autosave' },
    { t: 'MapCanvas (2D SVG)', d: 'tools, handles, drafts' },
    { t: 'Map3D (Canvas)', d: 'edit mode: select / drag / hover' },
    { t: 'changeElements', d: 'begin · live · push' },
    { t: 'PUT + undo', d: 'identical for both views' },
  ],
});
K.bullets(s, [
  'The 2D|3D toggle swaps only the viewport — selection, the side panel, undo and autosave are view-agnostic.',
  'Map3D takes the same shape of callbacks as MapCanvas: onSelectElement, onElementsChange, plus onElementDrag for gesture deltas.',
  'Drawing stays 2D-only by design: switching to 3D forces the select tool, and a hint chip explains why.',
], { x: M, y: 3.3, w: W - 2 * M, h: 1.6, size: 12.5 });
K.codeCard(p, s, {
  x: M, y: 5.05, w: W - 2 * M, h: 1.85, file: 'EditorPage — the drag contract', size: 10,
  code: `const dragElement3d = (id, dx, dy, phase) => {
  if (phase === 'begin') dragOrig3d.current = elements.find((e) => e.id === id) ?? null;
  const orig = dragOrig3d.current;
  if (!orig || orig.id !== id) return;
  changeElements(elements.map((e) => (e.id === id ? translateElement(orig, dx, dy) : e)), phase, 'move');
};`,
});

// 3 · picking
s = p.addSlide();
K.header(s, { kicker: 'Picking', title: 'Ray vs prism — nearest hit wins', system: SYSTEM, page: 3 });
K.bullets(s, [
  'screenRay builds the world ray through a pixel; pickFixture intersects it with every element\'s extruded body and keeps the nearest entry distance.',
  'Bodies are convex prisms: rect footprints as-is, polygon footprints as-is, polyline walls per segment at their true 0.22 m thickness.',
  'Clipping is Cyrus–Beck: the ray is cut by each face plane (normals oriented outward via the centroid) plus the z ∈ [0, h] slab.',
  'Point markers pick within a 12 px radius of their projected head.',
  { t: 'Why not hulls: the previous picker used screen convex hulls + mean corner depth — the building-spanning outer wall swallowed every click.', bold: true },
], { x: M, y: 1.75, w: 7.3, h: 4.4, size: 12.5 });
K.codeCard(p, s, {
  x: 8.0, y: 1.75, w: 4.8, h: 4.9, file: 'rayPrismT (core loop)', size: 10,
  code: `let t0 = 1e-4, t1 = Infinity;
for each edge (a → b):
  n = outwardNormal(edge, centroid);
  on = n · (o - a);              // signed dist
  dn = n · d;
  if (|dn| < ε) { if (on < 0) miss; }
  else {
    t = -on / dn;
    dn > 0 ? t1 = min(t1, t)   // exiting
           : t0 = max(t0, t);  // entering
  }
// + z-slab clip [0, h]
if (t0 ≤ t1) return t0;          // entry`,
});

// 4 · drag math
s = p.addSlide();
K.header(s, { kicker: 'Dragging', title: 'Un-project the pointer onto the floor plane', system: SYSTEM, page: 4 });
K.codeCard(p, s, {
  x: M, y: 1.7, w: 7.2, h: 4.3, file: 'screenToWorldFloor', size: 10,
  code: `// camera-space point on the ray at depth f:
x1 = sx - w/2;  up = h/2 - sy;  q = f - dist;

// pitch inverse (toCamera's linear part is its own inverse):
dz =  cosP*up - sinP*q;
y1 = -sinP*up - cosP*q;

// yaw inverse:
dx =  x1*cosY + y1*sinY;
dy = -x1*sinY + y1*cosY;

// world point at depth f, then ray → plane z = 0:
P1 = target + (dx, dy, dz);
dir = P1 - eye;
t = -eye.z / dir.z;
return eye + t * dir;`,
});
K.bullets(s, [
  'Round-trip tested: project(world) → screenToWorldFloor reproduces the world point at five cameras to 3 decimals.',
  'The drag stores the grab point once; each move reports the snapped delta from it — so the element never drifts with floating-point noise.',
  'Deltas apply to the gesture-start snapshot (orig), not the live element, so consecutive live events compose exactly.',
], { x: 8.0, y: 1.75, w: 4.8, h: 3.4, size: 11.5 });
K.chip(p, s, {
  x: 8.0, y: 5.2, w: 4.8, label: 'Detail',
  text: 'Pixels above the horizon return null — the ray never meets the floor (guarded, unit-tested).',
});

// 5 · selection & hover
s = p.addSlide();
K.header(s, { kicker: 'Selection & hover', title: 'Show what is — and what would be — selected', system: SYSTEM, page: 5 });
K.bullets(s, [
  { t: 'Selection', bold: true },
  'Thick dashed orange outline around the element\'s cap plus a 10% tint — visible from any angle, drawn in the overlay pass so it never fights the BSP.',
  'Point elements (entrance/exit/POI) get a dashed circle around their marker instead.',
  { t: 'Hover preview', bold: true },
  'Each pointermove ray-picks; the candidate element gets a thin solid outline, the cursor becomes "move", and a label chip shows the element\'s label or type.',
  'Hovering the currently-selected element shows no extra chrome — the selection outline is already there.',
  { t: 'Viewer shares the picker', bold: true },
  'Tapping a shelf in the public 3D view opens its planogram popup; hovering shows the pointer cursor over tappable shelves.',
], { x: M, y: 1.75, w: 7.3, h: 5.0, size: 12.5 });
K.codeCard(p, s, {
  x: 8.0, y: 1.75, w: 4.8, h: 5.0, file: 'Map3D — the hover path', size: 10,
  code: `// pointermove with no buttons:
const pick = fixtureAt(px, py);   // ray pick
setHoverPick(edit && pick
  ? { id: pick.elementId, sx: px, sy: py }
  : null);

// renderScene draws it:
renderScene(…, {
  selectedId: edit ? selectedId : null,
  hoverId:     edit ? hoverPick?.id : null,
});

// tooltip chip next to the cursor:
<div class="pick-tip">
  {element.label || element.type}
</div>`,
});

// 6 · disambiguation & keyboard
s = p.addSlide();
K.header(s, { kicker: 'Gestures', title: 'Drag the fixture, orbit the world', system: SYSTEM, page: 6 });
K.table(p, s, {
  x: M, y: 1.75, w: W - 2 * M, colW: [3.4, 10.0], size: 11.5,
  rows: [
    ['Gesture', 'Behavior in 3D edit mode'],
    ['Pointer-down on a fixture', 'selects it (panel + outline update) and arms a floor-plane drag'],
    ['Dragging on a fixture', 'snapped translate, live; release commits the undo entry'],
    ['Pointer-down on empty space', 'orbit (yaw/pitch) — same as the viewer'],
    ['Two fingers / wheel', 'pinch-zoom + sideways pan / exponential zoom'],
    ['R · Delete · arrows · Esc', 'rotate 90° · delete · nudge (grid, Shift = 1 m) · deselect — identical to 2D'],
    ['Outline / panel selection', 'camera tweens its target to the element (420 ms, ease-out); Fit refits the floor'],
  ],
});
s.addText('Pointer capture is best-effort (wrapped) so synthetic and automated pointers degrade gracefully instead of crashing handlers.', { x: M, y: 6.3, w: W - 2 * M, h: 0.4, fontSize: 11.5, fontFace: F.body, color: C.MUTED, margin: 0 });

// 7 · tests
s = p.addSlide();
K.header(s, { kicker: 'Verification', title: 'The picking and unprojection tests', system: SYSTEM, page: 7 });
K.bullets(s, [
  'Unprojection round-trips at five cameras (default, yaw 0, from west, low pitch, close-in) — project → un-project reproduces the world point.',
  'Rays above the horizon return null; ground pixels still resolve at the same pitch.',
  'Picking: the shelf through its front face beats the wall behind it; the wall is picked when clicked away from fixtures.',
  'Occlusion: at a low camera, a near shelf blocks a far shelf\'s face — the near one wins where it covers, the far one wins where it doesn\'t.',
  'Point markers pick within their head radius; sky rays return null.',
], { x: M, y: 1.75, w: 7.3, h: 4.0, size: 12.5 });
K.codeCard(p, s, {
  x: 8.0, y: 1.75, w: 4.8, h: 4.9, file: 'render3d.test.ts (extract)', size: 10,
  code: `it('occlusion: nearer shelf wins', () => {
  elements = [
    { shelf, x: 4,  y: 20, w: 18 },  // far
    { shelf, x: 11, y: 25, w: 3 },   // near
  ];
  const cam = { yaw: -0.62, pitch: 0.18,
                dist: 8, tx: 16, ty: 20 };
  // ray through the far row where the
  // near row blocks it:
  expect(pick(13, 20.7)).toBe(near.id);
  // …and where it doesn't:
  expect(pick(5, 20.7)).toBe(far.id);
});`,
});

K.closing(p, {
  title: '3D editing rules this system keeps',
  system: SYSTEM,
  points: [
    { t: 'One pipeline, two viewports', d: 'selection, history and autosave are view-agnostic — 3D is a lens on the same document.' },
    { t: 'Pick against real geometry', d: 'ray-vs-prism with exact occlusion; heuristics that "mostly work" are bugs in waiting.' },
    { t: 'Deltas from gesture start', d: 'snapped, snapshot-applied deltas make drags deterministic and undo exact.' },
    { t: 'Preview before commit', d: 'hover outlines and label chips mean the click is never a surprise.' },
  ],
});

p.writeFile({ fileName: '05-3d-editing-picking.pptx' }).then(() => console.log('ok 05'));
