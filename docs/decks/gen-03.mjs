/** Deck 03 — 2D Map Editor. */
import K from './kit.mjs';
const { C, F, W, M } = K;
const SYSTEM = '2D Map Editor';

const p = K.mk(SYSTEM);
K.cover(p, {
  kicker: 'StoreMap systems  ·  03',
  title: 'The 2D Map\nEditor',
  subtitle:
    'A single SVG canvas that draws, moves, rotates and autosaves every wall, shelf and aisle — with a gesture history model that makes undo exactly reversible and autosave invisible when it works.',
  stats: [
    { n: '12', label: 'tools from select to aisle-pair' },
    { n: '3', label: 'history phases: begin / live / push' },
    { n: '700ms', label: 'autosave debounce' },
    { n: '1', label: 'PUT per save (bulk elements)' },
  ],
  system: SYSTEM,
});

// 2 · canvas anatomy
let s = p.addSlide();
K.header(s, { kicker: 'Canvas anatomy', title: 'One SVG, seven stacked layers', system: SYSTEM, page: 2 });
const layers = [
  ['Floor', 'background image + slab rect + 1 m / 5 m grid patterns'],
  ['ElementNodes', 'walls, shelves, zones, aisles, markers — rect / polyline / polygon / point'],
  ['Multi-select', 'dashed outlines for the shift-click group'],
  ['Drafts', 'live rect preview, dashed polyline + vertex dots'],
  ['Route + trips', 'casing + orange line, start dot, numbered stop discs'],
  ['Product pins', 'dots snapped to shelf faces via shelfAnchor, focus pulse ring'],
  ['Selection overlay', '8 resize handles + rotation handle, screen-constant sizes'],
];
layers.forEach((l, i) => {
  const y = 1.72 + i * 0.68;
  s.addShape('rect', { x: M, y: y + 0.06, w: 0.16, h: 0.16, fill: { color: i < 2 ? C.PRIMARY : i < 5 ? C.FAINT : C.ACCENT } });
  s.addText([
    { text: l[0] + '   ', options: { bold: true, fontSize: 12.5, fontFace: F.head, color: C.INK } },
    { text: l[1], options: { fontSize: 11.5, fontFace: F.body, color: C.MUTED } },
  ], { x: M + 0.3, y, w: 7.2, h: 0.6, margin: 0, valign: 'middle' });
});
K.codeCard(p, s, {
  x: 8.1, y: 1.72, w: 4.7, h: 4.6, file: 'MapCanvas.tsx — the world transform', size: 10.5,
  code: `<g transform={translate(\${viewport.tx}
        \${viewport.ty})
        scale(\${viewport.scale})}>
  …everything draws in world meters…
</g>

// screen → world
toWorld(e) = {
  x: (e.clientX - rect.left - vp.tx) / vp.scale,
  y: (e.clientY - rect.top  - vp.ty) / vp.scale,
}`,
});
s.addText('Handles and labels counter-scale (4.5 / scale px) so they stay constant size at any zoom.', { x: M, y: 6.6, w: W - 2 * M, h: 0.35, fontSize: 11, fontFace: F.body, color: C.MUTED, margin: 0 });

// 3 · interactions
s = p.addSlide();
K.header(s, { kicker: 'Pointer model', title: 'One pointer state machine per gesture', system: SYSTEM, page: 3 });
K.table(p, s, {
  x: M, y: 1.75, w: W - 2 * M, colW: [2.2, 3.3, 7.3], size: 11,
  rows: [
    ['Interaction', 'Starts when', 'Behavior'],
    ['pan', 'empty space / middle button / shift', 'translates viewport; a click without movement deselects (or opens the tapped shelf in the viewer)'],
    ['move / move-many', 'drag on element (or group)', 'snapped translate from the gesture-start snapshot'],
    ['resize', 'drag a handle', 'resizeRect in the rect\'s local frame, min size 0.15 m'],
    ['rotate', 'drag the round handle', 'rotateRectTo pointer angle; Shift snaps to 15°'],
    ['draw-rect', 'drag with a shape tool', 'live dashed preview; commit on release (tiny drag = default 2×1 m shelf)'],
    ['move-pin', 'drag a product pin (Products filter)', 'snapped; release commits via API; click selects the product'],
    ['pinch', 'two pointers', 'zoom around the gesture midpoint; suppresses the next click'],
  ],
});
s.addText('pointerdown chooses the interaction once; pointermove and pointerup only serve it — no mode flags scattered across handlers.', { x: M, y: 6.4, w: W - 2 * M, h: 0.4, fontSize: 11.5, fontFace: F.body, color: C.MUTED, margin: 0 });

// 4 · history model
s = p.addSlide();
K.header(s, { kicker: 'Undo / redo', title: 'begin · live · push — one undo entry per gesture', system: SYSTEM, page: 4 });
K.flow(p, s, {
  x: M, y: 1.75, w: W - 2 * M, bh: 1.0,
  steps: [
    { t: 'begin', d: 'first change of a gesture — pushes pre-drag snapshot to history.past' },
    { t: 'live', d: 'every subsequent pointermove — applies silently, no history' },
    { t: 'push', d: 'commit — labels the undo entry (e.g. "move")' },
  ],
});
K.bullets(s, [
  'The pre-drag snapshot is captured at pointerdown into the interaction object — immune to stale closures during the drag.',
  'Undo pops history.past into history.future; redo is the mirror image. Per-floor history resets on floor switch.',
  'History is floors-scoped: changeElements filters the floor\'s elements before swapping, so other floors are untouched.',
  'Keyboard undo (Cmd/Ctrl+Z, Shift for redo) lives in EditorPage; MapCanvas owns the R / Delete / arrow shortcuts.',
], { x: M, y: 3.2, w: 7.4, h: 2.6, size: 12.5 });
K.codeCard(p, s, {
  x: 8.1, y: 3.2, w: 4.7, h: 3.1, file: 'MapCanvas — a gesture', size: 10,
  code: `} else if (it.kind === 'move') {
  it.moved = true;
  const dx = snap(it.start.x + (w.x - it.start.x), grid)
           - it.start.x;
  const dy = snap(it.start.y + (w.y - it.start.y), grid)
           - it.start.y;
  replaceElement(translateElement(it.orig, dx, dy),
                 it.began ? 'live' : 'begin');
  it.began = true;
}`,
});

// 5 · autosave
s = p.addSlide();
K.header(s, { kicker: 'Autosave', title: 'Draw and it\'s saved — 700 ms later', system: SYSTEM, page: 5 });
K.flow(p, s, {
  x: M, y: 1.75, w: W - 2 * M, bh: 1.0,
  steps: [
    { t: 'any edit', d: 'dirtyRef = true, state "dirty"' },
    { t: '700 ms debounce', d: 'effect timer on (state, elements)' },
    { t: 'PUT elements', d: 'full floor row set, one request' },
    { t: 'saved ✓', d: 'error state offers a retry badge' },
  ],
});
K.bullets(s, [
  'The PUT replaces the floor\'s whole element set server-side inside one transaction — the map is never half-saved.',
  'beforeunload warns while dirtyRef is set; switching floors saves first (await saveNow()).',
  'Save badge states: Saved ✓ · Saving… · dirty pulse · error (click to retry).',
], { x: M, y: 3.15, w: 7.5, h: 1.9, size: 12.5 });
K.chip(p, s, {
  x: M, y: 5.15, w: 7.5, label: 'Known limitation',
  text: 'An edit made while a PUT is in flight can be marked saved without uploading (the in-flight resolution clears the dirty flag). Tracked as a review finding.',
});
K.codeCard(p, s, {
  x: 8.1, y: 3.15, w: 4.7, h: 3.15, file: 'EditorPage — saveNow', size: 10,
  code: `const saveNow = async () => {
  if (!floor || !dirtyRef.current) return;
  setSaveState('saving');
  try {
    await api.saveElements(
      floor.id,
      floorElements.map(elementToRow)
    );
    dirtyRef.current = false;
    setSaveState('saved');
  } catch { setSaveState('error'); }
};`,
});

// 6 · tools
s = p.addSlide();
K.header(s, { kicker: 'Tools', title: 'Twelve tools, one TOOL_DEF table', system: SYSTEM, page: 6 });
K.table(p, s, {
  x: M, y: 1.75, w: W - 2 * M, colW: [2.4, 1.9, 8.2], size: 11,
  rows: [
    ['Tool', 'Produces', 'Notes'],
    ['select', '—', 'move/resize/rotate/multi-select; pick filter Fixtures vs Products'],
    ['shelf / wall / zone', 'rect', 'drag to draw; click = default 2×1 m; typed by TOOL_DEF'],
    ['aisle-pair', 'rect ×2', 'drag one row — the facing row appears 1.5 m across the aisle'],
    ['wall-line', 'polyline', 'click vertices, Enter/double-click finishes (extruded in 3D)'],
    ['zone-poly', 'polygon', 'click vertices; close by clicking the first vertex or Enter'],
    ['aisle', 'polyline', 'dashed ribbon; labeled at its arc-length midpoint; hover shows contents'],
    ['entrance / exit / poi', 'point', 'marker glyphs ⬆ ⬇ ★, prominent poles in 3D'],
    ['product', 'pin', 'click to pin the queued product; Esc cancels'],
  ],
});

// 7 · selection & rotation
s = p.addSlide();
K.header(s, { kicker: 'Selection', title: 'Handles, rotation, and the element panel', system: SYSTEM, page: 7 });
K.bullets(s, [
  'Selection draws 8 resize handles + a rotation handle; all counter-scaled so they stay 4.5 px at any zoom.',
  'Rotation: drag the handle for free angle, Shift snaps to 15°, press R for 90° steps, or type an exact value in the panel\'s Rotation (°) field with ↺/↻ buttons.',
  'Shift-click builds a multi-selection; drags and Delete act on the group via move-many.',
  'The Outline list gives keyboard access to every element (selection without the mouse) and per-element Lock against accidental drags.',
  'The panel edits type, label, colour, X/Y, rotation and shelf meta (bays/levels) — all through the same changeElements history path.',
], { x: M, y: 1.75, w: 7.4, h: 4.4, size: 12.5 });
K.chip(p, s, {
  x: 8.1, y: 1.75, w: 4.7, label: 'Known limitation',
  text: 'resizeRect is exact for unrotated rects; for rotated rects the opposite edge can drift (local-AABB vs world rotation). Tests pin rot: 0.',
});
K.codeCard(p, s, {
  x: 8.1, y: 3.35, w: 4.7, h: 3.0, file: 'geometry.ts — rotation field path', size: 10,
  code: `const setRot = (rot) => patch({
  ...el,
  geom: { ...g, rot: ((Math.round(rot) % 360) + 360) % 360 },
});

// map render honors it around the rect center:
rotate(\${r.rot} \${cx} \${cy})`,
});

// 8 · keyboard
s = p.addSlide();
K.header(s, { kicker: 'Keyboard', title: 'The editor is operable without a mouse', system: SYSTEM, page: 8 });
K.table(p, s, {
  x: M, y: 1.75, w: W - 2 * M, colW: [3.0, 10.2], size: 11.5,
  rows: [
    ['Keys', 'Action'],
    ['Cmd/Ctrl+Z · +Shift', 'undo · redo (labels shown on the button)'],
    ['R', 'rotate the selected rect 90°'],
    ['Delete / Backspace', 'delete selection (element or group)'],
    ['Arrow keys', 'nudge by grid (0.25 m); Shift = 1 m'],
    ['Escape', 'cancel draft / placement / deselect'],
    ['Enter', 'finish a polyline or polygon draft'],
    ['/', 'viewer only: focus the search box'],
  ],
});
s.addText('Typing targets are guarded — shortcuts never fire while a text field has focus. The Outline list guarantees every element is reachable by keyboard.', { x: M, y: 6.15, w: W - 2 * M, h: 0.4, fontSize: 11.5, fontFace: F.body, color: C.MUTED, margin: 0 });

K.closing(p, {
  title: 'Editor rules this system keeps',
  system: SYSTEM,
  points: [
    { t: 'One gesture, one undo entry', d: 'begin/live/push keeps history meaningful no matter how many events a drag fires.' },
    { t: 'World coordinates everywhere', d: 'viewport transform at the SVG root; every tool math stays in meters.' },
    { t: 'Autosave is a background concern', d: 'edits flip a flag; a single debounced bulk PUT persists the floor atomically.' },
    { t: 'Documented limitations', d: 'autosave in-flight race and rotated-resize drift are tracked findings, not surprises.' },
  ],
});

p.writeFile({ fileName: '03-2d-map-editor.pptx' }).then(() => console.log('ok 03'));
