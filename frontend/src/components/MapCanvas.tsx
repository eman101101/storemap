import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Floor, MapElement, PointGeom, PolyGeom, Product, RectGeom, ProductLocation } from '../types';
import { groupDisplayName, locationFlags } from '../types';
import {
  elementContains, elementPoints, fitViewport, HANDLE_TYPES, handleCursor, polyPoints, polyMidpoint, rectCorners,
  resizeRect, rotateRectTo, shelfAnchor, snap, snapPt, translateElement,
  type FitInsets, type HandleType, type Viewport, type WorldPt,
} from '../lib/geometry';
import { TYPE_COLOR, TYPE_STROKE, shade, inkOn } from '../lib/mapColors';
import { placeGlyph } from '../lib/placeSymbols';
import { aisleContents, shelfContents } from '../lib/aisleInfo';
import { shelfDepartments } from '../lib/departments';
import { AisleTooltip } from './Map3D';

export type EditorTool =
  | 'select' | 'shelf' | 'aisle-pair' | 'wall' | 'wall-line' | 'aisle' | 'zone' | 'zone-poly'
  | 'entrance' | 'exit' | 'poi' | 'product';

const TOOL_DEF: Record<Exclude<EditorTool, 'select' | 'product'>, { type: MapElement['type']; shape: MapElement['shape'] }> = {
  shelf: { type: 'shelf', shape: 'rect' },
  'aisle-pair': { type: 'shelf', shape: 'rect' }, // EditorPage adds the facing row on commit
  wall: { type: 'wall', shape: 'rect' },
  'wall-line': { type: 'wall', shape: 'polyline' },
  aisle: { type: 'aisle', shape: 'rect' }, // placed as a reshaping labelled zone
  zone: { type: 'zone', shape: 'rect' },
  'zone-poly': { type: 'zone', shape: 'polygon' },
  entrance: { type: 'entrance', shape: 'point' },
  exit: { type: 'exit', shape: 'point' },
  poi: { type: 'poi', shape: 'point' },
};
export { TOOL_DEF };

export interface MapPin {
  location: ProductLocation;
  product: Product;
}

interface Props {
  floor: Floor;
  elements: MapElement[];
  pins: MapPin[];
  viewport: Viewport;
  onViewport: (v: Viewport) => void;
  edit?: boolean;
  tool?: EditorTool;
  grid?: number | null;
  selectedId?: string | null;
  /** B2: multi-select set (shift-click). Drag/arrows/Delete act on the group. */
  selectedIds?: Set<string>;
  onMultiSelect?: (ids: Set<string>) => void;
  /** B7: floor-plan tracing image opacity (0..1). */
  bgOpacity?: number;
  draftPts?: WorldPt[];
  onSelect?: (id: string | null) => void;
  /** 'begin' snapshots undo history at gesture start, 'live' applies silently, 'push' snapshots + applies. */
  onElementsChange?: (els: MapElement[], history: 'begin' | 'live' | 'push', label?: string) => void;
  onAddElement?: (el: MapElement) => void;
  /** hide every text label (2D) — the editor's labels toggle */
  showLabels?: boolean;
  /** lock edit interactions: items can't be selected/moved, drag pans */
  locked?: boolean;
  /** right-click on the map (editor) — client px + world pt */
  onMapContextMenu?: (pt: { x: number; y: number }, world: WorldPt) => void;
  onDraftAdd?: (p: WorldPt) => void;
  onDraftFinish?: () => void;
  onDraftCancel?: () => void;
  onPlaceProduct?: (p: WorldPt, targetShelfId?: string | null) => void;
  /** Editor add-item mode: 'group' fills a shelf with a new item group,
   *  'single' places one item — picks the ghost-preview shape. */
  placeMode?: 'group' | 'single';
  /** Resolve a pin's owning shelf (editor-only) so hovering a pin during
   *  product placement targets the group it belongs to. */
  ownerOfPin?: (locationId: string) => string | null;
  onPinClick?: (productId: string) => void;
  /** Editor pick filter: 'all' selects fixtures, 'products' selects/drags pins only
   *  (clicks pass over floors and walls instead of grabbing them). */
  pickFilter?: 'all' | 'products';
  /** Drag/move a product pin. commit=false during the drag, true on release. */
  onPinMove?: (locationId: string, productId: string, x: number, y: number, commit: boolean, orig?: { x: number; y: number }) => void;
  onPinSelect?: (productId: string) => void;
  /** Viewer tap on a map element (e.g. open a shelf's layout). */
  onElementClick?: (el: MapElement) => void;
  /** Every pin on the floor (unfiltered) — drives the aisle hover contents. */
  stockPins?: MapPin[];
  /** Items visibility: false = groups view — pins hide (focused/selected
   *  stay) and department area labels can show instead. Heavy floors also
   *  viewport-cull pins while items are shown. */
  showItems?: boolean;
  /** Department area labels on shelves (groups view) — general area names
   *  from meta.department or the dominant pinned category. */
  showDepartments?: boolean;
  focusPinId?: string | null;
  highlightElementIds?: Set<string>;
  fitSignal?: number;
  /** How the fit frames the floor: `pad` is the air around it (default 40px),
   *  `insets` the screen edges kept clear for controls laid over the map. */
  fit?: { pad?: number; insets?: FitInsets };
  zoomCommand?: { k: number; seq: number };
  /** centre + zoom on a world point; with `box`, frame that part of the floor instead (a section).
   *  `keepTop` is how much of the canvas under the top edge that framing keeps clear, for the card
   *  naming the section (default 220 px: a card with a list of shelves in it). */
  focus?: { x: number; y: number; seq: number; box?: { x0: number; y0: number; x1: number; y1: number; keepTop?: number } };
  /** Walking route polyline (world meters) drawn under the pins. */
  route?: WorldPt[] | null;
  /** Multi-stop trip: numbered markers at each ordered stop (A1). */
  tripStops?: { productId: string; name: string; point: WorldPt }[];
}

type Interaction =
  | { kind: 'pan'; start: WorldPt; vp: Viewport; moved: boolean }
  | { kind: 'move'; id: string; start: WorldPt; orig: MapElement; moved: boolean; began: boolean }
  | { kind: 'move-many'; ids: string[]; start: WorldPt; origs: MapElement[]; began: boolean }
  | { kind: 'resize'; id: string; handle: HandleType; orig: RectGeom; began: boolean }
  | { kind: 'rotate'; id: string; orig: RectGeom; began: boolean }
  | { kind: 'draw-rect'; anchor: WorldPt }
  | { kind: 'move-pin'; locationId: string; productId: string; moved: boolean; origX: number; origY: number }
  // split-wall segment handles: drag an endpoint to reshape, drag the
  // mid-handle to rotate the segment around its centre
  | { kind: 'move-vertex'; id: string; index: number; moved: boolean; began: boolean }
  | { kind: 'rotate-poly'; id: string; orig: PolyGeom; center: WorldPt; startAngle: number; moved: boolean; began: boolean }
  | null;

const isTypingTarget = (t: EventTarget | null) =>
  t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;

/** Constrain `to` to the dominant axis from `from` — straight lanes for drafts. */
function straightSnap(from: WorldPt, to: WorldPt): WorldPt {
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  return dx >= dy ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
}

export default function MapCanvas(props: Props) {
  const {
    floor, elements, pins, viewport, onViewport, edit = false, tool = 'select', grid = 0.25,
    selectedId, selectedIds, onMultiSelect, bgOpacity = 0.95, draftPts = [], onSelect, onElementsChange, onAddElement, showLabels = true, locked = false, onMapContextMenu,
    onDraftAdd, onDraftFinish, onDraftCancel, onPlaceProduct, placeMode = 'group', ownerOfPin, onPinClick, onElementClick,
    focusPinId, highlightElementIds, fitSignal = 0, zoomCommand, focus, route = null, fit: fitProps,
    pickFilter = 'all', onPinMove, onPinSelect, tripStops, stockPins = [],
    showItems = true, showDepartments = false,
  } = props;
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  const [hoverAisle, setHoverAisle] = useState<{ id: string; sx: number; sy: number } | null>(null);
  /** Viewer: the shelf under the pointer, and where to pin its card. */
  const [hoverShelf, setHoverShelf] = useState<{ id: string; sx: number; sy: number } | null>(null);
  /** Editor, product tool: the group (shelf) a click would join — hovering a
   *  shelf or one of its pins targets that shelf instead of creating an area. */
  const [placeHoverShelfId, setPlaceHoverShelfId] = useState<string | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  // latest viewport for the always-attached wheel listener (ref pattern, Map3D-style)
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const interaction = useRef<Interaction>(null);
  const pointers = useRef(new Map<number, WorldPt>());
  const pinch = useRef<{ dist: number; vp: Viewport; mid: WorldPt } | null>(null);
  const [draftRect, setDraftRect] = useState<RectGeom | null>(null);
  const pendingPin = useRef<string | null>(null);
  const [cursorWorld, setCursorWorld] = useState<WorldPt | null>(null);
  const drawing = useRef(false); // suppress click-commit right after a pinch

  // Observe container size for fit-to-screen math.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (r.width && r.height) setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    const r = el.getBoundingClientRect();
    if (r.width && r.height) setSize({ w: r.width, h: r.height });
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    onViewport(fitViewport(floor.width_m, floor.height_m, size.w, size.h, fitProps?.pad, fitProps?.insets));
  }, [floor.width_m, floor.height_m, size.w, size.h, onViewport, fitProps?.pad, fitProps?.insets]);

  useEffect(() => {
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floor.id, size.w, size.h, fitSignal]);

  // Wheel zoom (non-passive so preventDefault works).
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const p = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const k = Math.exp(-e.deltaY * 0.0016);
      zoomAt(p, k);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // zoomAt reads the viewport through viewportRef — nothing here goes stale
  }, []);

  const zoomAt = (p: WorldPt, k: number) => {
    const vp = viewportRef.current;
    const s = Math.min(60, Math.max(1.2, vp.scale * k));
    const applied = s / vp.scale;
    onViewport({
      scale: s,
      tx: p.x - (p.x - vp.tx) * applied,
      ty: p.y - (p.y - vp.ty) * applied,
    });
  };

  // Keyboard: finish/cancel drafts, delete/rotate selection.
  useEffect(() => {
    if (!edit) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.key === 'Escape') {
        if (draftPts.length) onDraftCancel?.();
        else onSelect?.(null);
      } else if (e.key === 'Enter' && draftPts.length) {
        onDraftFinish?.();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && (selectedIds?.size ?? 0) > 1) {
        e.preventDefault();
        onElementsChange?.(elements.filter((el) => !selectedIds!.has(el.id)), 'push');
        onMultiSelect?.(new Set());
        onSelect?.(null);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault();
        onElementsChange?.(elements.filter((el) => el.id !== selectedId), 'push');
        onSelect?.(null);
      } else if (e.key.startsWith('Arrow') && (selectedIds?.size ?? 0) > 1) {
        e.preventDefault();
        const step = e.shiftKey ? 1 : grid ?? 0.25;
        const dx = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0;
        const dy = e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0;
        onElementsChange?.(
          elements.map((el) => (selectedIds!.has(el.id) ? translateElement(el, dx, dy) : el)),
          'push'
        );
      } else if ((e.key === 'r' || e.key === 'R') && selectedId) {
        const el = elements.find((x) => x.id === selectedId);
        const g = el?.geom as RectGeom;
        if (el?.shape === 'rect' && g) {
          replaceElement({ ...el, geom: { ...g, rot: (((g.rot + 90) % 360) + 360) % 360 } }, 'push');
        }
      } else if (e.key.startsWith('Arrow') && selectedId) {
        // nudge the selected element along the grid (Shift = a full meter)
        e.preventDefault();
        const el = elements.find((x) => x.id === selectedId);
        if (!el) return;
        const step = e.shiftKey ? 1 : grid ?? 0.25;
        const dx = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0;
        const dy = e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0;
        replaceElement(translateElement(el, dx, dy), 'push');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [edit, draftPts.length, selectedId, selectedIds, elements, grid]); // eslint-disable-line react-hooks/exhaustive-deps

  const replaceElement = (next: MapElement, history: 'begin' | 'live' | 'push') => {
    onElementsChange?.(elements.map((el) => (el.id === next.id ? next : el)), history);
  };

  // Programmatic zoom (pad buttons): one tap glides the zoom over ~0.25 s,
  // eased, centered on the current view — no jump.
  useEffect(() => {
    if (!zoomCommand || zoomCommand.k === 1) return;
    const start = performance.now();
    const DUR = 250;
    const total = Math.log(zoomCommand.k);
    let done = 0;
    let raf = 0;
    const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / DUR);
      const e = easeInOut(t);
      const chunk = e - done;
      done = e;
      if (chunk > 0) zoomAt({ x: size.w / 2, y: size.h / 2 }, Math.exp(total * chunk));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomCommand?.seq]);

  // Center + zoom on a world point (e.g. a tapped search result).
  useEffect(() => {
    if (!focus) return;
    if (focus.box) {
      // a section of the floor: frame it whole, in the room the controls and
      // the cards laid over the map leave (never closer in than 14 × 10 m)
      const b = focus.box;
      const base = fitProps?.insets ?? { top: 0, bottom: 60, left: 16, right: 84 };
      // the section's own card sits under the top bar (or across the width, on a phone, where the
      // badges also stack at the foot)
      const insets = fitProps
        ? { ...base, top: (base.top ?? 0) + (b.keepTop ?? 220) + 4, bottom: (base.bottom ?? 0) + 56 }
        : { ...base, top: b.keepTop ?? 220 };
      const fit = fitViewport(Math.max(b.x1 - b.x0, 14), Math.max(b.y1 - b.y0, 10), size.w, size.h, fitProps?.pad ?? 24, insets);
      const s = Math.min(30, fit.scale);
      const cx = (insets.left ?? 0) + (size.w - (insets.left ?? 0) - (insets.right ?? 0)) / 2;
      const cy = (insets.top ?? 0) + (size.h - (insets.top ?? 0) - (insets.bottom ?? 0)) / 2;
      onViewport({ scale: s, tx: cx - ((b.x0 + b.x1) / 2) * s, ty: cy - ((b.y0 + b.y1) / 2) * s });
      return;
    }
    const s = Math.min(30, Math.max(8, size.w / 22));
    onViewport({ scale: s, tx: size.w / 2 - focus.x * s, ty: size.h / 2 - focus.y * s });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.seq]);

  const toWorld = (e: { clientX: number; clientY: number }): WorldPt => {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left - viewport.tx) / viewport.scale,
      y: (e.clientY - rect.top - viewport.ty) / viewport.scale,
    };
  };
  const toScreenPt = (p: WorldPt) => ({ x: p.x * viewport.scale + viewport.tx, y: p.y * viewport.scale + viewport.ty });

  const isLocked = (el: MapElement) => {
    try {
      return Boolean(JSON.parse(el.meta || '{}')?.locked);
    } catch {
      return false;
    }
  };

  const hitElement = (w: WorldPt): MapElement | null => {
    const tol = Math.max(0.25, 7 / viewport.scale);
    // points (entrances, exits, POIs) are tiny — they win over any large area
    // drawn above them, or they could never be selected at all
    for (let i = elements.length - 1; i >= 0; i--) {
      const el = elements[i];
      if (isLocked(el) || el.shape !== 'point') continue;
      if (elementContains(el, w, tol * 2)) return el;
    }
    for (let i = elements.length - 1; i >= 0; i--) {
      if (isLocked(elements[i])) continue; // B4: locked fixtures aren't selectable on the map
      if (elementContains(elements[i], w, tol)) return elements[i];
    }
    return null;
  };

  const commitRect = (a: WorldPt, b: WorldPt) => {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    let w = Math.abs(a.x - b.x);
    let h = Math.abs(a.y - b.y);
    if (w < 0.15 && h < 0.15) { w = 2; h = 1; } // quick click → default shelf size
    else {
      if (w < 0.15) w = 0.5;
      if (h < 0.15) h = 0.5;
    }
    const def = TOOL_DEF[tool as keyof typeof TOOL_DEF];
    const maxZ = elements.reduce((m, el) => Math.max(m, el.z_index), 0);
    onAddElement?.({
      id: crypto.randomUUID(),
      floor_id: floor.id,
      type: def.type,
      shape: 'rect',
      geom: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w, h, rot: 0 },
      label: def.type === 'aisle' ? 'Aisle' : '',
      color: '',
      meta: '{}',
      z_index: maxZ + 1,
    });
  };

  const addPointElement = (w: WorldPt) => {
    const def = TOOL_DEF[tool as keyof typeof TOOL_DEF];
    const maxZ = elements.reduce((m, el) => Math.max(m, el.z_index), 0);
    onAddElement?.({
      id: crypto.randomUUID(),
      floor_id: floor.id,
      type: def.type,
      shape: 'point',
      geom: { x: w.x, y: w.y },
      label: def.type === 'poi' ? '' : def.type === 'entrance' ? 'Entrance' : 'Exit',
      color: '',
      meta: '{}',
      z_index: maxZ + 1,
    });
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current!;
    try {
      svg.setPointerCapture(e.pointerId);
    } catch {
      // synthetic/untracked pointer (e.g. automated events) — capture is best-effort
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // a press starts a gesture — hide hover cards until the pointer settles again
    setHoverShelf(null);
    setHoverGroupShelfId(null);
    setHoverAisle(null);

    // Two pointers → pinch zoom takes over (viewer and editor).
    if (pointers.current.size === 2) {
      const pts = [...pointers.current.values()];
      const rect = svg.getBoundingClientRect();
      const mid = { x: (pts[0].x + pts[1].x) / 2 - rect.left, y: (pts[0].y + pts[1].y) / 2 - rect.top };
      pinch.current = {
        dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
        vp: viewport,
        mid,
      };
      // the pinch takes over — settle any in-progress fixture gesture exactly
      // as a normal release would (final 'push': history entry, autosave, pin
      // re-homing), or the editor stays stuck mid-gesture
      const cur = interaction.current;
      if (
        cur &&
        (cur.kind === 'move' || cur.kind === 'move-many' || cur.kind === 'resize' || cur.kind === 'rotate' ||
          cur.kind === 'move-vertex' || cur.kind === 'rotate-poly') &&
        cur.began
      ) {
        onElementsChange?.(elements, 'push', cur.kind === 'move-many' ? 'move' : cur.kind);
      }
      interaction.current = null;
      setDraftRect(null);
      return;
    }
    if (pointers.current.size > 1 || drawing.current) return;

    // Viewer: one-finger / mouse drag pans. Locked edit: same — items are
    // unselectable and unmovable while the lock is on.
    if (!edit || locked) {
      onSelect?.(null);
      interaction.current = { kind: 'pan', start: { x: e.clientX, y: e.clientY }, vp: viewport, moved: false };
      return;
    }

    const w = toWorld(e);
    const isPanButton = e.button === 1 || e.shiftKey;

    // products pick filter: grab the nearest VISIBLE pin, never the fixtures
    // under it — and never a hidden groupOnly facing (items have no pins).
    // Hit against the rendered pin (anchor bar), not the raw location.
    if (edit && tool === 'select' && pickFilter === 'products' && e.button === 0 && !isPanButton) {
      const grabR = Math.max(0.5, 16 / viewport.scale);
      let bestPin: MapPin | null = null;
      let bestD = grabR;
      for (const p of pins) {
        if (!isPickablePin(p, showItems)) continue;
        const d = pinHitDistance(p.location, w, pinAnchors.get(p.location.id));
        if (d < bestD) {
          bestD = d;
          bestPin = p;
        }
      }
      if (bestPin) {
        onSelect?.(null);
        setSelectedPinId(bestPin.location.id);
        interaction.current = { kind: 'move-pin', locationId: bestPin.location.id, productId: bestPin.product.id, moved: false, origX: bestPin.location.x, origY: bestPin.location.y };
        return;
      }
      interaction.current = { kind: 'pan', start: { x: e.clientX, y: e.clientY }, vp: viewport, moved: false };
      return;
    }

    if (tool === 'select') {
      // handles take priority (they render above the selected element)
      if (selectedId && e.button === 0) {
        const target = e.target as Element;
        const handleEl = target.closest('[data-handle]') as HTMLElement | null;
        if (handleEl) {
          const sel = elements.find((el) => el.id === selectedId);
          if (sel?.shape === 'rect') {
            const handle = handleEl.dataset.handle as HandleType | 'rot';
            interaction.current =
              handle === 'rot'
                ? { kind: 'rotate', id: sel.id, orig: sel.geom as RectGeom, began: false }
                : { kind: 'resize', id: sel.id, handle, orig: sel.geom as RectGeom, began: false };
            return;
          }
          // split-wall segments: endpoint handles reshape, the mid-handle rotates
          if (sel?.type === 'wall' && sel.shape === 'polyline') {
            const pts = (sel.geom as PolyGeom).slice();
            const handle = handleEl.dataset.handle;
            if (handle === 'rot') {
              const center: WorldPt = {
                x: (pts[0][0] + pts[pts.length - 1][0]) / 2,
                y: (pts[0][1] + pts[pts.length - 1][1]) / 2,
              };
              interaction.current = {
                kind: 'rotate-poly', id: sel.id, orig: (sel.geom as PolyGeom).slice(), center,
                startAngle: Math.atan2(w.y - center.y, w.x - center.x), moved: false, began: false,
              };
              return;
            }
            if (handle === 'p0' || handle === 'p1') {
              interaction.current = {
                kind: 'move-vertex', id: sel.id, index: handle === 'p0' ? 0 : pts.length - 1,
                moved: false, began: false,
              };
              return;
            }
          }
        }
      }
      if (isPanButton) {
        interaction.current = { kind: 'pan', start: { x: e.clientX, y: e.clientY }, vp: viewport, moved: false };
        return;
      }
      // a click (no drag) straight on a product pin selects the product — even
      // in the default Fixtures filter. Recorded as PENDING: if the pointer
      // turns into a real element drag, the shelf wins and the pin selection
      // is dropped.
      pendingPin.current = null;
      if (e.button === 0 && !isPanButton) {
        const grabR = Math.max(0.5, 12 / viewport.scale);
        let bestPin: MapPin | null = null;
        let bestD = grabR;
        for (const p of pins) {
          // only pins that actually render — a hidden groupOnly facing must
          // never swallow the click that was meant for the group pin.
          // Measured against the rendered bar: a group pin is metres long and
          // anchored to the shelf edge, so the raw location point misses it.
          if (!isPickablePin(p, showItems)) continue;
          const d = pinHitDistance(p.location, w, pinAnchors.get(p.location.id));
          if (d < bestD) { bestD = d; bestPin = p; }
        }
        if (bestPin) pendingPin.current = bestPin.product.id;
      }
      const hit = hitElement(w);
      if (hit && e.button === 0 && e.shiftKey && onMultiSelect) {
        // B2: shift-click toggles membership in the multi-selection
        const next = new Set(selectedIds ?? []);
        if (next.has(hit.id)) next.delete(hit.id);
        else next.add(hit.id);
        onMultiSelect(next);
        return;
      }
      if (hit && e.button === 0) {
        onSelect?.(hit.id);
        const group = (selectedIds?.size ?? 0) > 1 && selectedIds!.has(hit.id) ? selectedIds! : null;
        if (group) {
          interaction.current = {
            kind: 'move-many',
            ids: [...group],
            start: w,
            origs: elements.filter((el) => group.has(el.id)),
            began: false,
          };
        } else {
          interaction.current = { kind: 'move', id: hit.id, start: w, orig: hit, moved: false, began: false };
        }
      } else if (e.button === 0) {
        interaction.current = { kind: 'pan', start: { x: e.clientX, y: e.clientY }, vp: viewport, moved: false };
      }
      return;
    }

    if (tool === 'product') {
      onPlaceProduct?.(snapPt(w, grid), placeHoverShelfId);
      setPlaceHoverShelfId(null);
      return;
    }

    const def = TOOL_DEF[tool as keyof typeof TOOL_DEF];
    if (!def) return;

    if (def.shape === 'point') {
      addPointElement(snapPt(w, grid));
      return;
    }
    if (def.shape === 'rect') {
      const a = snapPt(w, grid);
      interaction.current = { kind: 'draw-rect', anchor: a };
      setDraftRect({ x: a.x, y: a.y, w: 0.01, h: 0.01, rot: 0 });
      return;
    }
    // polyline / polygon: click adds a vertex
    if (draftPts.length && def.shape === 'polygon') {
      const first = draftPts[0];
      const closeR = Math.max(0.5, 12 / viewport.scale);
      if (Math.hypot(w.x - first.x, w.y - first.y) < closeR && draftPts.length >= 3) {
        onDraftFinish?.();
        return;
      }
    }
    onDraftAdd?.(e.shiftKey && draftPts.length ? straightSnap(draftPts[draftPts.length - 1], snapPt(w, grid)) : snapPt(w, grid));
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    // Shift while drafting keeps the lane straight: the live vertex is pinned
    // to the dominant axis from the last placed point (the cursor position is
    // only consumed while a draft is in progress)
    if (edit && draftPts.length > 0) {
      const w = toWorld(e);
      setCursorWorld(e.shiftKey ? straightSnap(draftPts[draftPts.length - 1], w) : w);
    }

    // Product placement hover: target the shelf under the pointer, or the
    // group owning the nearest pin — the glow shows where a click will add.
    // Pin proximity measures the rendered bar (see pinHitDistance).
    if (edit && tool === 'product' && !interaction.current) {
      const w = toWorld(e);
      const shelf = elements.find((el) => el.type === 'shelf' && elementContains(el, w, 0.15));
      if (shelf) {
        setPlaceHoverShelfId(shelf.id);
      } else {
        let best: { id: string; d: number } | null = null;
        for (const pin of pins) {
          if (!isPickablePin(pin, showItems)) continue;
          const d = pinHitDistance(pin.location, w, pinAnchors.get(pin.location.id));
          if (d < Math.max(0.5, 16 / viewport.scale) && (!best || d < best.d)) best = { id: pin.location.id, d };
        }
        const owner = best ? ownerOfPin?.(best.id) ?? null : null;
        setPlaceHoverShelfId(owner);
      }
    } else if (placeHoverShelfId && tool !== 'product') {
      setPlaceHoverShelfId(null);
    }

    // group-pin hover preview: outline the shelf the click would select —
    // hit against the rendered bar so the whole visible pin previews, and
    // resolve the owner shelf even when meta.shelfId is missing (seeded pins)
    if (edit && tool === 'select' && !interaction.current) {
      const hov = toWorld(e);
      const grabR = Math.max(0.5, 12 / viewport.scale);
      let hitPin: MapPin | null = null;
      let hitD = grabR;
      for (const p of pins) {
        if (!isPickablePin(p, showItems)) continue;
        const d = pinHitDistance(p.location, hov, pinAnchors.get(p.location.id));
        if (d < hitD) { hitD = d; hitPin = p; }
      }
      let nextHover: string | null = null;
      if (hitPin && locationFlags(hitPin.location).groupPin) {
        nextHover = groupOwnerShelf(hitPin.location)?.id ?? null;
      }
      if (nextHover !== hoverGroupShelfId) setHoverGroupShelfId(nextHover);
    } else if (hoverGroupShelfId && (interaction.current || tool !== 'select')) {
      setHoverGroupShelfId(null);
    }

    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size === 2) {
      const pts = [...pointers.current.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const start = pinch.current;
      if (start.dist > 0) {
        const s = Math.min(60, Math.max(1.2, (start.vp.scale * dist) / start.dist));
        const applied = s / start.vp.scale;
        onViewport({
          scale: s,
          tx: start.mid.x - (start.mid.x - start.vp.tx) * applied,
          ty: start.mid.y - (start.mid.y - start.vp.ty) * applied,
        });
      }
      return;
    }

    const it = interaction.current;
    if (!it) return;
    if (it.kind === 'pan') {
      const dx = e.clientX - it.start.x;
      const dy = e.clientY - it.start.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) it.moved = true;
      onViewport({ ...it.vp, tx: it.vp.tx + dx, ty: it.vp.ty + dy });
      return;
    }
    if (!edit) return;
    const w = toWorld(e);
    if (it.kind === 'move') {
      it.moved = true;
      let dx = snap(it.start.x + (w.x - it.start.x), grid) - it.start.x;
      let dy = snap(it.start.y + (w.y - it.start.y), grid) - it.start.y;
      // shelf-to-shelf snapping: edges/centers align with nearby shelves so
      // rows butt together with no gap in the middle and facing rows line up
      const el = it.orig;
      if (el.type === 'shelf' && el.shape === 'rect') {
        const g = el.geom as RectGeom;
        if (!g.rot) {
          const SNAP = 0.3;
          const mLeft = g.x + dx, mRight = g.x + g.w + dx, mCx = g.x + g.w / 2 + dx;
          const mTop = g.y + dy, mBottom = g.y + g.h + dy, mCy = g.y + g.h / 2 + dy;
          let bx: number | null = null, by: number | null = null;
          for (const o of elements) {
            if (o.id === el.id || o.type !== 'shelf' || o.shape !== 'rect') continue;
            const og = o.geom as RectGeom;
            if (og.rot) continue;
            for (const t of [og.x, og.x + og.w, og.x + og.w / 2]) {
              for (const m of [mLeft, mRight, mCx]) {
                const d = t - m;
                if (Math.abs(d) <= SNAP && (bx === null || Math.abs(d) < Math.abs(bx))) bx = d;
              }
            }
            for (const t of [og.y, og.y + og.h, og.y + og.h / 2]) {
              for (const m of [mTop, mBottom, mCy]) {
                const d = t - m;
                if (Math.abs(d) <= SNAP && (by === null || Math.abs(d) < Math.abs(by))) by = d;
              }
            }
          }
          if (bx != null) dx += bx;
          if (by != null) dy += by;
        }
      }
      replaceElement(translateElement(it.orig, dx, dy), it.began ? 'live' : 'begin');
      it.began = true;
    } else if (it.kind === 'move-pin') {
      it.moved = true;
      const snapped = snapPt(w, grid);
      onPinMove?.(it.locationId, it.productId, snapped.x, snapped.y, false);
    } else if (it.kind === 'move-many') {
      const dx = snap(it.start.x + (w.x - it.start.x), grid) - it.start.x;
      const dy = snap(it.start.y + (w.y - it.start.y), grid) - it.start.y;
      const origById = new Map(it.origs.map((o) => [o.id, o]));
      const next = elements.map((el) => (origById.has(el.id) ? translateElement(origById.get(el.id)!, dx, dy) : el));
      onElementsChange?.(next, it.began ? 'live' : 'begin');
      it.began = true;
    } else if (it.kind === 'resize') {
      // grid-snap the pointer only at axis-aligned rotations — at odd angles
      // world snapping lands the local dimensions off-grid
      const pt = it.orig.rot % 90 === 0 ? snapPt(w, grid) : w;
      replaceElement(
        { ...elements.find((el) => el.id === it.id)!, geom: resizeRect(it.orig, it.handle, pt) },
        it.began ? 'live' : 'begin'
      );
      it.began = true;
    } else if (it.kind === 'rotate') {
      const r = rotateRectTo(it.orig, w);
      if (e.shiftKey) r.rot = Math.round(r.rot / 15) * 15;
      replaceElement({ ...elements.find((el) => el.id === it.id)!, geom: r }, it.began ? 'live' : 'begin');
      it.began = true;
    } else if (it.kind === 'move-vertex') {
      it.moved = true;
      const snapped = snapPt(w, grid);
      const next = elements.map((el) => {
        if (el.id !== it.id) return el;
        const pts = (el.geom as PolyGeom).slice();
        pts[it.index] = [snapped.x, snapped.y];
        return { ...el, geom: pts };
      });
      onElementsChange?.(next, it.began ? 'live' : 'begin');
      it.began = true;
    } else if (it.kind === 'rotate-poly') {
      it.moved = true;
      const ang = Math.atan2(w.y - it.center.y, w.x - it.center.x) - it.startAngle;
      const cos = Math.cos(ang);
      const sin = Math.sin(ang);
      const next = elements.map((el) => {
        if (el.id !== it.id) return el;
        const pts = (it.orig as PolyGeom).map(([x, y]) => {
          const dx = x - it.center.x;
          const dy = y - it.center.y;
          return [it.center.x + dx * cos - dy * sin, it.center.y + dx * sin + dy * cos] as [number, number];
        });
        return { ...el, geom: pts };
      });
      onElementsChange?.(next, it.began ? 'live' : 'begin');
      it.began = true;
    } else if (it.kind === 'draw-rect') {
      const a = it.anchor;
      const b = snapPt(w, grid);
      setDraftRect({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y), rot: 0 });
    }
  };

  const endPointer = (e: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) {
      if (pinch.current) {
        pinch.current = null;
        drawing.current = true;
        setTimeout(() => (drawing.current = false), 250);
      }
    }
    const it = interaction.current;
    if (!it) return;
    if (it.kind === 'draw-rect' && draftRect) {
      commitRect(it.anchor, snapPt(toWorld(e), grid));
      setDraftRect(null);
    } else if (it.kind === 'move-pin') {
      if (it.moved) {
        const snapped = snapPt(toWorld(e), grid);
        onPinMove?.(it.locationId, it.productId, snapped.x, snapped.y, true, { x: it.origX, y: it.origY });
      } else {
        onPinSelect?.(it.productId);
      }
    } else if (it.kind === 'pan' && !it.moved) {
      if (edit) {
        // a click on empty canvas deselects
        onSelect?.(null);
        if (pickFilter === 'products') setSelectedPinId(null);
      } else {
        // viewer tap: open the tapped element (e.g. a shelf's layout)
        const hit = hitElement(toWorld(e));
        if (hit) onElementClick?.(hit);
      }
    } else if (
      (it.kind === 'move' || it.kind === 'move-many' || it.kind === 'resize' || it.kind === 'rotate' ||
        it.kind === 'move-vertex' || it.kind === 'rotate-poly') &&
      it.began
    ) {
      // fixture gestures end with a 'push' of the final state: history entry,
      // autosave and pin re-homing all settle once, at release
      onElementsChange?.(elements, 'push', it.kind === 'move-many' ? 'move' : it.kind);
    }
    // a still pointer that started on a pin = product select (works in any filter)
    if (pendingPin.current) {
      const startedGesture = it && it.kind !== 'pan';
      const dragged = startedGesture && (it as { moved?: boolean }).moved;
      if (!dragged) onPinSelect?.(pendingPin.current);
      pendingPin.current = null;
    }
    interaction.current = null;
  };

  const onDoubleClick = () => {
    if (edit && draftPts.length) onDraftFinish?.();
  };

  const scale = viewport.scale;
  const floorEls = elements;
  const floorPins = useMemo(() => pins.filter((p) => p.location.floor_id === floor.id), [pins, floor.id]);

  // pins actually drawn: groups view keeps only the focused/selected pins;
  // heavy floors viewport-cull the rest to the visible world rect (+2 m
  // margin) so panning a 3000-pin floor doesn't drag 12k SVG nodes around
  const alwaysPinIds = useMemo(() => {
    const s = new Set<string>();
    if (focusPinId) s.add(focusPinId);
    if (edit && selectedPinId) s.add(selectedPinId);
    return s;
  }, [focusPinId, edit, selectedPinId]);
  // planogram-only facings (meta.groupOnly) never render as map pins — the
  // map shows only the group pins (sized to the group's full length)
  const groupOnlyIds = useMemo(() => {
    const s = new Set<string>();
    for (const p of floorPins) {
      try {
        const m = JSON.parse(p.location.meta || '{}');
        if (m.groupOnly) s.add(p.location.id);
      } catch { /* no meta */ }
    }
    return s;
  }, [floorPins]);
  const shownPins = useMemo(() => {
    const base = floorPins.filter((p) => !groupOnlyIds.has(p.location.id) || alwaysPinIds.has(p.location.id));
    if (base.length <= 600) return base;
    const m = 2;
    const x0 = -viewport.tx / viewport.scale - m;
    const y0 = -viewport.ty / viewport.scale - m;
    const x1 = (size.w - viewport.tx) / viewport.scale + m;
    const y1 = (size.h - viewport.ty) / viewport.scale + m;
    const out: typeof base = [];
    for (const p of base) {
      const { x, y } = p.location;
      if ((x >= x0 && x <= x1 && y >= y0 && y <= y1) || alwaysPinIds.has(p.location.id)) out.push(p);
    }
    return out;
  }, [floorPins, groupOnlyIds, viewport.tx, viewport.ty, viewport.scale, size.w, size.h, alwaysPinIds]);
  // groups view: the groups' ONE pin each (groupPin facings — the titled map
  // pins) plus whatever is focused/selected; item facings stay inside the
  // planograms
  const groupPinIds = useMemo(() => {
    const s = new Set<string>();
    for (const p of floorPins) {
      if (locationFlags(p.location).groupPin) s.add(p.location.id);
    }
    return s;
  }, [floorPins]);
  const groupsPins = useMemo(
    () => floorPins.filter((p) => groupPinIds.has(p.location.id) || alwaysPinIds.has(p.location.id)),
    [floorPins, groupPinIds, alwaysPinIds]
  );
  const renderedPins = showItems ? shownPins : groupsPins;

  // groups view keeps the shelf's stocked facings visible in 2D — as bare
  // non-interactive rects (the planogram groups), far cheaper than full pins
  // (no hit targets, no pulses). Anchors are cached once per pins/elements
  // change; the viewport filter then runs per pan on plain numbers.
  const pinAnchors = useMemo(
    () => new Map(floorPins.map((p) => [p.location.id, shelfAnchor({ x: p.location.x, y: p.location.y }, floorEls)])),
    [floorPins, floorEls]
  );
  const strips = useMemo(() => {
    if (showItems) return null;
    const m = 2;
    const x0 = -viewport.tx / viewport.scale - m;
    const y0 = -viewport.ty / viewport.scale - m;
    const x1 = (size.w - viewport.tx) / viewport.scale + m;
    const y1 = (size.h - viewport.ty) / viewport.scale + m;
    const out: { key: string; x: number; y: number; w: number; h: number; rot: number; color: string }[] = [];
    for (const p of floorPins) {
      const { x, y } = p.location;
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      // facings only: groupOnly never draws, and each group's groupPin draws
      // right below as a real (titled) pin — no double image
      if (groupOnlyIds.has(p.location.id) || groupPinIds.has(p.location.id)) continue;
      const a = pinAnchors.get(p.location.id);
      let w = 0.5;
      let h = 0.2;
      try {
        const pm = JSON.parse(p.location.meta || '{}');
        if (typeof pm.pinW === 'number' && typeof pm.pinH === 'number') { w = pm.pinW; h = pm.pinH; }
      } catch { /* unparseable meta → default strip size */ }
      out.push({
        key: p.location.id,
        x: a?.x ?? x,
        y: a?.y ?? y,
        w,
        h,
        rot: a ? (Math.atan2(a.ny, a.nx) * 180) / Math.PI + 90 : 0,
        color: p.product.category_color || '#2f6f3e',
      });
    }
    return out;
  }, [showItems, floorPins, groupOnlyIds, groupPinIds, pinAnchors, viewport.tx, viewport.ty, viewport.scale, size.w, size.h]);

  // department area labels: shelfId → department name. Callers decide when
  // they show — the editor in groups view, the viewer whenever it isn't mid-
  // search (its pins prop is already search-filtered). Double-sided pairs
  // (same department, directly behind one another) label once — the badge
  // sits in the gap between the pair and repeats would just double the text.
  const departments = useMemo(
    () => (showDepartments ? shelfDepartments(floorEls, stockPins.length ? stockPins : floorPins, ownerOfPin) : null),
    [showDepartments, floorEls, stockPins, floorPins, ownerOfPin]
  );
  const shelfById = useMemo(() => new Map(floorEls.map((el) => [el.id, el])), [floorEls]);
  // The shelf a group pin belongs to: the persisted meta.shelfId wins; seeded
  // and legacy pins carry none, so fall back to the editor's derived owner
  // and then to the shelf the pin renders against.
  const groupOwnerShelf = (loc: ProductLocation): MapElement | null => {
    let shelfId: string | null = null;
    try { shelfId = JSON.parse(loc.meta || '{}').shelfId ?? null; } catch { /* no meta */ }
    if (typeof shelfId !== 'string' || !shelfId) shelfId = ownerOfPin?.(loc.id) ?? null;
    if (typeof shelfId !== 'string' || !shelfId) shelfId = pinAnchors.get(loc.id)?.el.id ?? null;
    return (typeof shelfId === 'string' && shelfById.get(shelfId)) || null;
  };
  // a group pin's title is its GROUP's name — the owning shelf's group name
  // (or label). meta.groupLabelHidden on the shelf hides JUST this pin title:
  // it is independent of the shelf's own labelHidden (the element panel's
  // "Hide label"), so hiding one never hides the other.
  // is the shelf's own title on the map at this zoom?
  const titleOnShelf = (el: MapElement): boolean => {
    if (el.shape !== 'rect' || !el.label || !showLabels) return false;
    const o = labelOptions(el);
    if (o.hidden) return false;
    return shelfTitle(el.geom as RectGeom, el.label, o.px / scale, scale) !== 'hidden';
  };
  const groupPinName = (loc: ProductLocation): string | undefined => {
    const el = groupOwnerShelf(loc);
    if (!el) return undefined;
    try {
      if (JSON.parse(el.meta || '{}').groupLabelHidden === true) return undefined;
    } catch { /* visible */ }
    const title = groupDisplayName(el) || undefined;
    // the shelf's own title is written along it and says the same: no second copy
    if (title && title === el.label && titleOnShelf(el)) return undefined;
    return title;
  };
  // two group titles closer than a text height — the two faces of a gondola,
  // zoomed out — would lie over each other: the one further right or down
  // gives way, as a shelf's own title does when the shelf is too thin for it
  // …set as the shelf's own title is: along a long shelf it shrinks with the
  // shelf's depth on screen and is not written once too small to read — so a
  // floor zoomed out shows departments, in the editor as in the viewer, and
  // zooming in brings the groups' names
  const groupPinSpec = (loc: ProductLocation): { title: string; px: number } | undefined => {
    const title = groupPinName(loc);
    if (!title) return undefined;
    const r = groupOwnerShelf(loc)?.geom as RectGeom | undefined;
    if (!r || groupOwnerShelf(loc)?.shape !== 'rect') return { title, px: 13 };
    const across = Math.min(r.w, r.h);
    const run = Math.max(r.w, r.h);
    if (run < across * 1.3) return { title, px: 13 }; // a display table: its name above it, as any pin's
    const px = Math.min(13, across * scale * 0.72, (run * scale - 6) / (title.length * 0.56));
    return px < TITLE_MIN_PX ? undefined : { title, px };
  };
  const crowded = useMemo(() => {
    const kept: TitleBox[] = [];
    const out = new Set<string>();
    const shown = (strips ? groupsPins : renderedPins)
      .filter((p) => groupPinIds.has(p.location.id))
      .map((p) => {
        const loc = p.location;
        const spec = groupPinSpec(loc);
        return spec && pinTitleBox(loc.id, pinAnchors.get(loc.id) ?? shelfAnchor({ x: loc.x, y: loc.y }, elements), spec, scale);
      })
      .filter((b): b is TitleBox => !!b)
      .sort((a, b) => a.cx - b.cx || a.cy - b.cy);
    for (const b of shown) {
      if (kept.some((k) => b.x0 < k.x1 && b.x1 > k.x0 && b.y0 < k.y1 && b.y1 > k.y0)) out.add(b.id);
      else kept.push(b);
    }
    return out;
  }, [strips, groupsPins, renderedPins, groupPinIds, pinAnchors, elements, floorEls, showLabels, scale]);
  const groupPinTitle = (loc: ProductLocation) => (crowded.has(loc.id) ? undefined : groupPinSpec(loc));
  // …and its colour follows the owning shelf's colour when the owner set one
  const groupPinColor = (loc: ProductLocation): string | undefined => groupOwnerShelf(loc)?.color || undefined;
  // hovering a group pin outlines its shelf — the click target preview
  const [hoverGroupShelfId, setHoverGroupShelfId] = useState<string | null>(null);
  // department badges name the area each shelf belongs to — what a floor shows
  // in place of group titles while it is zoomed out. A shelf gets none when
  // its own title is on the map (that says more than its department), when a
  // zone that names its department covers it, or when it stands directly
  // beside or behind another of its department: a gondola's two faces of one
  // department are named once.
  // Where it is written depends on the shelf. An upright run (a gondola face)
  // carries it ALONG the face — where that face's own title will be once the
  // floor is zoomed in enough for it, turned the same way — set just beside
  // the face when another stands back to back with it, so each side of an
  // aisle reads its own department. (Under the run's end instead, a floor of
  // gondolas gets lines of text wider than its aisles: legible at the full
  // view, piled over each other and over the aisles' names a step further
  // out.) Any other shelf — a wall run, a table — has it under its run.
  const deptBadges = useMemo(() => {
    if (!departments) return null;
    // every area: one that names a department — by its label or by the department
    // it records — speaks for the shelves inside it. (An area is often two
    // rects, a tint and a named piece on open floor; the tint covers the shelves.)
    const zones = floorEls.filter((e) => e.type === 'zone' && e.shape === 'rect');
    type Box = { x0: number; x1: number; y0: number; y1: number };
    interface Run extends Box { id: string; dept: string; gone: boolean; shiftX: number; upright: boolean }
    const runs: Run[] = [];
    for (const [id, dept] of departments) {
      const el = shelfById.get(id);
      if (!el || el.shape !== 'rect') continue;
      const r = el.geom as RectGeom;
      const center = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
      if (dept === el.label || titleOnShelf(el)) continue;
      if (zones.some((z) => (z.label === dept || zoneDepartment(z) === dept) && elementContains(z, center, 0))) continue;
      const xs = rectCorners(r).map((p) => p.x);
      const ys = rectCorners(r).map((p) => p.y);
      // a long shelf runs along its width (a tall one, upward): upright when that is within 30° of vertical
      const along = ((r.h > r.w ? r.rot + 90 : r.rot) * Math.PI) / 180;
      runs.push({ id, dept, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), gone: false, shiftX: 0, upright: Math.abs(Math.sin(along)) > 0.87 });
    }
    // two runs of one department side by side (a gondola's two faces): the left
    // one drops its badge and the right one centres over the pair
    for (const a of runs) {
      for (const b of runs) {
        if (a === b || a.gone || b.gone || a.dept !== b.dept) continue;
        if (b.x0 - a.x1 < -0.05 || b.x0 - a.x1 > 0.6) continue;
        const sideBySide = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
        if (sideBySide < 0.5 * Math.min(a.y1 - a.y0, b.y1 - b.y0)) continue;
        a.gone = true;
        b.shiftX = (a.x0 + a.x1 - b.x0 - b.x1) / 4;
      }
    }
    // one department in rows set one behind another (within 4.5 m): the lower
    // row drops its badge, so the upper one's sits in the gap between the pair
    for (const a of runs) {
      if (a.upright) continue; // an upright run's badge is on the run, not in the gap
      for (const b of runs) {
        if (a === b || a.gone || b.gone || a.dept !== b.dept) continue;
        const shared = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
        if (shared < 0.5 * Math.min(a.x1 - a.x0, b.x1 - b.x0)) continue;
        if (a.y0 + a.y1 - (b.y0 + b.y1) > 0 && Math.hypot(a.x0 + a.x1 - b.x0 - b.x1, a.y0 + a.y1 - b.y0 - b.y1) < 9) { a.gone = true; break; }
      }
    }
    const kept = runs.filter((x) => !x.gone);
    const out: { id: string; dept: string; x: number; y: number; rotate: number; size: number }[] = [];

    // ── upright runs: along the face ──
    if (kept.some((k) => k.upright)) {
      const boxOf = (el: MapElement): Box => {
        const xs = rectCorners(el.geom as RectGeom).map((p) => p.x);
        const ys = rectCorners(el.geom as RectGeom).map((p) => p.y);
        return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
      };
      const uprightShelves = floorEls.filter((el) => el.type === 'shelf' && el.shape === 'rect').map(boxOf);
      // the aisles' own names, standing upright in the aisles between the runs
      const aisleNames = floorEls.flatMap((el) => {
        if (el.type !== 'aisle' || el.shape !== 'polyline' || !el.label || !showLabels) return [];
        const pts = polyPoints(el);
        const mid = pts.length >= 2 ? polyMidpoint(pts) : null;
        if (!mid) return [];
        const deg = (Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x) * 180) / Math.PI;
        return Math.abs(Math.sin((deg * Math.PI) / 180)) > 0.87
          ? [{ x: mid.x, y: mid.y, half: (el.label.length * 12.5 * 0.64) / 2 / scale }]
          : [];
      });
      // a little smaller as the floor is zoomed out: a badge, the aisle's name
      // and the next face's badge share the aisle's width
      const widest = Math.min(11, Math.max(7.5, (11 * scale) / 13.2));
      for (const run of kept) {
        if (!run.upright) continue;
        const runPx = (run.y1 - run.y0) * scale;
        const size = Math.max(7.5, Math.min(widest, (runPx - 8) / (run.dept.length * 0.6)));
        const half = ((run.dept.length * size * 0.6) / 2) / scale; // its length along the run
        const axisX = (run.x0 + run.x1) / 2 + run.shiftX;
        // beside its own face when another shelf stands back to back with it
        let side = 0;
        if (!run.shiftX) {
          const backs = (b: Box, east: boolean) => {
            const gap = east ? b.x0 - run.x1 : run.x0 - b.x1;
            return gap >= -0.05 && gap <= 0.6 && Math.min(run.y1, b.y1) - Math.max(run.y0, b.y0) >= 0.5 * (run.y1 - run.y0);
          };
          const east = uprightShelves.some((b) => b !== run && backs(b, true));
          const west = uprightShelves.some((b) => b !== run && backs(b, false));
          side = east && !west ? -1 : west && !east ? 1 : 0;
        }
        const x = axisX + side * (((run.x1 - run.x0) / 2) + (size / 2 + 0.5) / scale);
        // over the middle of the run, slid along it where an aisle's name stands there
        const cy = (run.y0 + run.y1) / 2;
        let y = cy;
        for (const a of aisleNames) {
          // the two columns of text: does this one reach the aisle's?
          if (Math.abs(a.x - x) > ((size + 12.5) / 2 + 0.5) / scale) continue;
          const need = half + a.half + 2 / scale;
          if (Math.abs(y - a.y) >= need) continue;
          const room = Math.max(0, (run.y1 - run.y0) / 2 - half) + 1.5; // may run a little past its own ends
          y = Math.min(cy + room, Math.max(cy - room, a.y + (y >= a.y ? need : -need)));
        }
        out.push({ id: run.id, dept: run.dept, x, y, rotate: -90, size });
      }
    }

    // ── every other shelf: under its run ──
    // each badge sits under its run, clear of the ones already placed, of a
    // shelf below it that is showing its own title (a table, a wall run) and of
    // an area's name on the floor: over either it would blot that name out.
    // Thin runs whose titles are not on the map at this zoom are not avoided:
    // a badge is wider than its run, and the gondolas step along diagonally
    // beside it, so avoiding them would push every badge below its whole row.
    // does a line of text, `x0`..`x1` wide and centred on y, lie over this?
    type Blocker = (x0: number, x1: number, y: number) => boolean;
    const hits = (b: Box, x0: number, x1: number, y: number) => x1 > b.x0 && x0 < b.x1 && y + 6 / scale > b.y0 && y - 6 / scale < b.y1;
    const named: Blocker[] = [];
    for (const el of floorEls) {
      if (el.type === 'shelf' && el.shape === 'rect' && titleOnShelf(el)) {
        named.push(overRect(el.geom as RectGeom, 6 / scale));
        continue;
      }
      // an area's name alone — not its whole floor — where ElementNode writes it:
      // the centre of a rect, the centre of a polygon's vertices
      if (el.type !== 'zone' || !showLabels || !el.label) continue;
      let c: { x: number; y: number };
      if (el.shape === 'rect') {
        const r = el.geom as RectGeom;
        c = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
      } else if (el.shape === 'polygon') {
        const pts = polyPoints(el);
        c = pts.reduce((a, q) => ({ x: a.x + q.x / pts.length, y: a.y + q.y / pts.length }), { x: 0, y: 0 });
      } else continue;
      const half = (el.label.length * 3.2 + 3) / scale;
      named.push((x0, x1, y) => hits({ x0: c.x - half, x1: c.x + half, y0: c.y - 7 / scale, y1: c.y + 7 / scale }, x0, x1, y));
    }
    const placed: Box[] = [];
    for (const run of kept.filter((k) => !k.upright).sort((a, b) => a.y1 - b.y1 || a.x0 - b.x0)) {
      const halfW = (run.dept.length * 3.2 + 3) / scale;
      const x = (run.x0 + run.x1) / 2 + run.shiftX;
      const start = run.y1 + 10 / scale;
      const free = (y: number, aside: boolean) =>
        !placed.some((p) => hits(p, x - halfW, x + halfW, y)) && (aside || !named.some((under) => under(x - halfW, x + halfW, y)));
      // a clear spot within a few lines below; failing that, back under the run,
      // clear of the other badges at least — a long shelf in the way must not
      // carry the badge far from its own
      let y = start;
      while (y - start < (13 * 4) / scale && !free(y, false)) y += 13 / scale;
      if (y - start >= (13 * 4) / scale) for (y = start; y - start < (13 * 10) / scale && !free(y, true); y += 13 / scale);
      placed.push({ x0: x - halfW, x1: x + halfW, y0: y - 6 / scale, y1: y + 6 / scale });
      out.push({ id: run.id, dept: run.dept, x, y, rotate: 0, size: 11 });
    }
    return out;
  }, [departments, shelfById, floorEls, scale, showLabels]);

  const sel = selectedId ? floorEls.find((el) => el.id === selectedId) : null;

  // viewer-only: wide invisible hit paths over aisle ribbons → hover tooltip
  const aisleEls = useMemo(() => floorEls.filter((el) => el.type === 'aisle'), [floorEls]);
  const hoverAisleEl = hoverAisle ? floorEls.find((el) => el.id === hoverAisle.id) ?? null : null;
  const hoverContents = useMemo(
    () => (hoverAisleEl ? aisleContents(hoverAisleEl, stockPins) : null),
    [hoverAisleEl, stockPins]
  );
  // viewer-only: invisible hit areas over shelves → "what's on this shelf" hover
  const shelfEls = useMemo(() => floorEls.filter((el) => el.type === 'shelf' && el.shape === 'rect'), [floorEls]);
  const hoverShelfEl = hoverShelf ? floorEls.find((el) => el.id === hoverShelf.id) ?? null : null;
  const hoverShelfContents = useMemo(
    () => (hoverShelfEl?.type === 'shelf' ? shelfContents(hoverShelfEl, stockPins) : null),
    [hoverShelfEl, stockPins]
  );
  const svgPoint = (e: React.PointerEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  return (
    <>
      <svg
        ref={svgRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => {
          e.preventDefault(); // the browser menu breaks gesture state here
          onMapContextMenu?.(
            { x: e.clientX, y: e.clientY },
            toWorld(e as unknown as React.PointerEvent<SVGSVGElement>)
          );
        }}
        style={{ cursor: tool === 'select' ? 'default' : 'crosshair' }}
      >
      <defs>
        {/* strokes are in world meters: pattern content ignores vectorEffect */}
        <pattern id="grid-min" width={1} height={1} patternUnits="userSpaceOnUse">
          <path d="M 1 0 L 0 0 0 1" fill="none" stroke="var(--map-grid-min)" strokeWidth={0.02} />
        </pattern>
        <pattern id="grid-maj" width={5} height={5} patternUnits="userSpaceOnUse">
          <path d="M 5 0 L 0 0 0 5" fill="none" stroke="var(--map-grid-maj)" strokeWidth={0.035} />
        </pattern>
      </defs>

      <g transform={`translate(${viewport.tx} ${viewport.ty}) scale(${viewport.scale})`}>
        {floor.background_url && (
          <image
            href={floor.background_url}
            x={0}
            y={0}
            width={floor.width_m}
            height={floor.height_m}
            preserveAspectRatio="none"
            opacity={bgOpacity}
          />
        )}
        <rect
          x={0}
          y={0}
          width={floor.width_m}
          height={floor.height_m}
          fill={floor.background_url ? 'none' : 'var(--map-floor)'}
          stroke="var(--map-floor-line)"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
        <rect x={0} y={0} width={floor.width_m} height={floor.height_m} fill="url(#grid-min)" pointerEvents="none" />
        <rect x={0} y={0} width={floor.width_m} height={floor.height_m} fill="url(#grid-maj)" pointerEvents="none" />

        {floorEls.map((el) => (
          <ElementNode
            key={el.id}
            el={el}
            scale={scale}
            selected={el.id === selectedId}
            highlighted={highlightElementIds?.has(el.id) || el.id === hoverGroupShelfId}
            edit={edit}
            showLabels={showLabels}
          />
        ))}

        {(selectedIds?.size ?? 0) > 1 &&
          floorEls
            .filter((el) => selectedIds!.has(el.id))
            .map((el) => {
              const pts = elementPoints(el);
              if (pts.length < 3) return null;
              return (
                <polygon
                  key={`ms-${el.id}`}
                  points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="transparent"
                  stroke="#e4572e"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="none"
                />
              );
            })}

        {!edit &&
          shelfEls.map((el) => {
            const r = el.geom as RectGeom;
            return (
              <rect
                key={`shelf-hit-${el.id}`}
                x={r.x}
                y={r.y}
                width={r.w}
                height={r.h}
                transform={r.rot ? `rotate(${r.rot} ${r.x + r.w / 2} ${r.y + r.h / 2})` : undefined}
                fill="transparent"
                style={{ cursor: 'pointer' }}
                onPointerEnter={(e) => { if (!interaction.current) { const p = svgPoint(e); setHoverShelf({ id: el.id, sx: p.x, sy: p.y }); } }}
                onPointerMove={(e) => { if (!interaction.current && hoverShelf?.id !== el.id) { const p = svgPoint(e); setHoverShelf({ id: el.id, sx: p.x, sy: p.y }); } }}
                onPointerLeave={() => setHoverShelf(null)}
              />
            );
          })}

        {draftRect && <RectPreview r={draftRect} type={TOOL_DEF[tool as keyof typeof TOOL_DEF]?.type ?? 'shelf'} />}

        {draftPts.length > 0 && (
          <g pointerEvents="none">
            <polyline
              points={[...draftPts, cursorWorld ?? draftPts[draftPts.length - 1]].map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke="#2f6f3e"
              strokeWidth={2}
              strokeDasharray="6 4"
              vectorEffect="non-scaling-stroke"
            />
            {draftPts.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={Math.max(0.12, 4 / scale)} fill="#2f6f3e" />
            ))}
          </g>
        )}

        {route && route.length > 1 && (
          <g pointerEvents="none">
            <polyline
              className="route-casing"
              points={route.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none"
              vectorEffect="non-scaling-stroke"
            />
            <polyline
              className="route-line"
              points={route.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none"
              vectorEffect="non-scaling-stroke"
            />
            <circle cx={route[0].x} cy={route[0].y} r={0.4} fill="#2f6f3e" stroke="#fff" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          </g>
        )}

        {tripStops?.map((stop, i) => (
          <g key={stop.productId} pointerEvents="none">
            <circle cx={stop.point.x} cy={stop.point.y} r={0.62} fill="#e4572e" stroke="#fff" strokeWidth={2} vectorEffect="non-scaling-stroke" />
            <text x={stop.point.x} y={stop.point.y} textAnchor="middle" dominantBaseline="central" fontSize={0.5} fill="#fff" fontWeight={700}>
              {i + 1}
            </text>
            {/* every stop carries its item's name — a trip reads from the map alone */}
            <text
              x={stop.point.x + 0.95} y={stop.point.y} dominantBaseline="central" fontSize={0.55} fontWeight={600}
              fill="#333a33" stroke="rgba(255,255,255,0.9)"
              strokeWidth={0.16} paintOrder="stroke" strokeLinejoin="round"
            >
              {stop.name.length > 26 ? `${stop.name.slice(0, 25)}…` : stop.name}
            </text>
          </g>
        ))}

        {/* department badges — while a floor is zoomed out they are its
            directory, in place of the group titles (which need more room) */}
        {deptBadges && (
          <g pointerEvents="none">
            {deptBadges.map((b) => (
              <text
                key={`dept-${b.id}`}
                x={b.x}
                y={b.y}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={b.size / scale}
                fontWeight={600}
                className="el-label"
                stroke="var(--map-floor)"
                strokeWidth={3 / scale}
                paintOrder="stroke"
                strokeLinejoin="round"
                transform={b.rotate ? `rotate(${b.rotate} ${b.x} ${b.y})` : undefined}
              >
                {b.dept}
              </text>
            ))}
          </g>
        )}

        {/* groups view: stocked facings as bare strips (the planogram groups
            stay visible on the shelf without full pin machinery) */}
        {strips && (
          <g pointerEvents="none">
            {strips.map((st) => (
              <rect
                key={st.key}
                x={st.x - st.w / 2}
                y={st.y - st.h / 2}
                width={st.w}
                height={st.h}
                rx={0.05}
                fill={st.color}
                stroke="#fff"
                strokeWidth={1.2}
                vectorEffect="non-scaling-stroke"
                transform={st.rot ? `rotate(${st.rot} ${st.x} ${st.y})` : undefined}
              />
            ))}
          </g>
        )}

        {(strips ? groupsPins : renderedPins).map(({ location, product }) => (
          <ProductPin
            key={location.id}
            location={location}
            product={product}
            scale={scale}
            focused={location.id === focusPinId || (edit && location.id === selectedPinId)}
            clickable={!edit}
            anchor={pinAnchors.get(location.id) ?? shelfAnchor({ x: location.x, y: location.y }, elements)}
            groupTitle={groupPinIds.has(location.id) ? groupPinTitle(location)?.title : undefined}
            groupTitlePx={groupPinIds.has(location.id) ? groupPinTitle(location)?.px : undefined}
            colorOverride={groupPinIds.has(location.id) ? groupPinColor(location) : undefined}
            isGroupPin={groupPinIds.has(location.id)}
            onClick={() => onPinClick?.(product.id)}
          />
        ))}

        {sel?.shape === 'rect' && edit && (
          <SelectionOverlay r={sel.geom as RectGeom} scale={scale} label={sel.label} />
        )}
        {sel?.type === 'wall' && sel.shape === 'polyline' && edit && (
          <PolyOverlay pts={sel.geom as PolyGeom} scale={scale} />
        )}

        {/* product-placement preview: ghost facings where the group or item
            will land — NOT the whole shelf (that outline read as noise) */}
        {edit && tool === 'product' && placeMode === 'group' && placeHoverShelfId &&
          (() => {
            const target = elements.find((el) => el.id === placeHoverShelfId && el.shape === 'rect');
            if (!target) return null;
            const r = target.geom as RectGeom;
            const cx = r.x + r.w / 2;
            const cy = r.y + r.h / 2;
            const cos = Math.cos((r.rot * Math.PI) / 180);
            const sin = Math.sin((r.rot * Math.PI) / 180);
            // local (lx, ly) metres from the rect's top-left → world
            const toWorld = (lx: number, ly: number) => ({
              x: cx + (lx - r.w / 2) * cos - (ly - r.h / 2) * sin,
              y: cy + (lx - r.w / 2) * sin + (ly - r.h / 2) * cos,
            });
            const horizontal = r.w >= r.h;
            const runLen = horizontal ? r.w : r.h;
            const n = Math.max(3, Math.min(10, Math.round(runLen / 0.9)));
            const ghosts = [];
            for (const off of [0.1, (horizontal ? r.h : r.w) - 0.1]) {
              for (let i = 0; i < n; i++) {
                const at = 0.35 + ((i + 0.5) * (runLen - 0.7)) / n;
                const c = horizontal ? toWorld(at, off) : toWorld(off, at);
                ghosts.push(
                  <rect
                    key={`${off}-${i}`}
                    x={c.x - (horizontal ? 0.25 : 0.1)}
                    y={c.y - (horizontal ? 0.1 : 0.25)}
                    width={horizontal ? 0.5 : 0.2}
                    height={horizontal ? 0.2 : 0.5}
                    transform={r.rot ? `rotate(${r.rot} ${c.x} ${c.y})` : undefined}
                    fill="rgba(47, 158, 66, 0.4)"
                    stroke="#2f9e44"
                    strokeWidth={1 / scale}
                    pointerEvents="none"
                  />
                );
              }
            }
            return <g>{ghosts}</g>;
          })()}
        {edit && tool === 'product' && placeMode === 'single' && cursorWorld &&
          (() => {
            // the hovered shelf tilts the ghost to its long axis
            const target = placeHoverShelfId
              ? elements.find((el) => el.id === placeHoverShelfId && el.shape === 'rect')
              : null;
            const r = target?.geom as RectGeom | undefined;
            const horizontal = !r || r.w >= r.h;
            return (
              <rect
                x={cursorWorld.x - (horizontal ? 0.25 : 0.1)}
                y={cursorWorld.y - (horizontal ? 0.1 : 0.25)}
                width={horizontal ? 0.5 : 0.2}
                height={horizontal ? 0.2 : 0.5}
                transform={r?.rot ? `rotate(${r.rot} ${cursorWorld.x} ${cursorWorld.y})` : undefined}
                fill="rgba(47, 158, 66, 0.4)"
                stroke="#2f9e44"
                strokeWidth={1 / scale}
                pointerEvents="none"
              />
            );
          })()}

        {!edit &&
          aisleEls.map((el) => {
            const pts =
              el.shape === 'polyline'
                ? polyPoints(el)
                : rectCorners(el.geom as RectGeom);
            return (
              <polygon
                key={`aisle-hit-${el.id}`}
                points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
                fill="transparent"
                stroke="transparent"
                strokeWidth={2.2}
                strokeLinecap="round"
                style={{ cursor: 'pointer' }}
                onPointerEnter={(e) => { const p = svgPoint(e); setHoverAisle({ id: el.id, sx: p.x, sy: p.y }); }}
                onPointerMove={(e) => { const p = svgPoint(e); setHoverAisle({ id: el.id, sx: p.x, sy: p.y }); }}
                onPointerLeave={() => setHoverAisle(null)}
              />
            );
          })}
      </g>
      </svg>
      {hoverAisle && hoverAisleEl && (
        <AisleTooltip
          style={{ left: hoverAisle.sx, top: hoverAisle.sy }}
          label={hoverAisleEl.label || 'Aisle'}
          contents={hoverContents}
        />
      )}
      {hoverShelf && hoverShelfEl?.type === 'shelf' && (
        <AisleTooltip
          style={{ left: hoverShelf.sx, top: hoverShelf.sy }}
          label={hoverShelfEl.label || 'Shelf'}
          contents={hoverShelfContents}
          kind="shelf"
        />
      )}
    </>
  );
}

/* ---------------- rendering helpers ---------------- */

/** Can the pointer grab this pin? Only pins that actually RENDER: planogram-
 *  only facings (groupOnly) never act as pins, so clicks pass through them to
 *  the group pin or fixture underneath. */
function isPickablePin(p: { location: { meta?: string } }, showItems: boolean): boolean {
  const flags = locationFlags(p.location);
  if (flags.groupOnly) return false;
  return showItems || flags.groupPin;
}

/** Distance from a world point to the pin AS RENDERED. Anchored pins draw as
 *  a bar (meta.pinW × pinH) centred on their shelf-edge anchor — group pins
 *  are metres long and sit up to 1.4 m away from the raw location point — so
 *  clicks and hovers must measure against that bar, not the location, or most
 *  of the visible pin grabs the shelf underneath instead. */
function pinHitDistance(
  loc: { x: number; y: number; meta?: string | null },
  w: WorldPt,
  anchor: (WorldPt & { nx?: number; ny?: number }) | null | undefined
): number {
  let pinW: number | null = null;
  let pinH: number | null = null;
  try {
    const m = JSON.parse(loc.meta || '{}');
    if (typeof m.pinW === 'number') pinW = m.pinW;
    if (typeof m.pinH === 'number') pinH = m.pinH;
  } catch { /* defaults below */ }
  if (anchor && typeof anchor.nx === 'number' && typeof anchor.ny === 'number') {
    const bw = (pinW ?? 0.5) / 2; // along the shelf edge
    const bh = (pinH ?? 0.2) / 2; // depth off the face
    const dx = w.x - anchor.x;
    const dy = w.y - anchor.y;
    const u = dx * -anchor.ny + dy * anchor.nx; // position along the bar
    const v = dx * anchor.nx + dy * anchor.ny;  // depth off the edge
    return Math.hypot(Math.max(0, Math.abs(u) - bw), Math.max(0, Math.abs(v) - bh));
  }
  // free-standing pin: a small square at the location
  const half = (pinW ?? 0.42) / 2;
  return Math.max(0, Math.hypot(w.x - (anchor?.x ?? loc.x), w.y - (anchor?.y ?? loc.y)) - half);
}

/** Does a rect's name fit across its middle? — a box-like fixture's rule (a
 *  zone, a display table): the name has to be narrower than the rect is deep
 *  relative to its width, and the rect at least a text-height tall. */
function acrossMiddle(r: RectGeom, label: string, fs: number): boolean {
  return !(r.w < (label.length * fs * 0.55) / Math.max(r.h, 0.001) || r.h < fs * 1.2);
}

/** Smallest on-screen size (px) a shelf's title is still written at. */
const TITLE_MIN_PX = 8;

/**
 * How a shelf's title is written. A long shelf's runs along it, inside it — so
 * a vertical gondola carries its name the way a floor plan does, instead of a
 * line of horizontal text across its neighbours. It shrinks with the shelf's
 * on-screen depth and is not written ('hidden') once it would be too small to
 * read: zoomed out a floor shows departments, zoomed in, groups. A shelf about
 * as deep as it is long (a display table) has its name across its middle, when
 * the name fits the shelf's width on screen. `rotate` is in the rect's own frame.
 */
export function shelfTitle(
  r: RectGeom, label: string, fs: number, scale: number
): { size: number; rotate: number } | 'hidden' | null {
  const across = Math.min(r.w, r.h);
  const run = Math.max(r.w, r.h);
  if (run < across * 1.3) {
    const fits = label.length * fs * scale * 0.56 <= run * scale * 1.08 && across * scale >= fs * scale * 1.15;
    const reading = ((r.rot % 360) + 360) % 360;
    return fits ? { size: fs, rotate: reading > 90 && reading < 270 ? 180 : 0 } : 'hidden';
  }
  const px = Math.min(fs * scale, across * scale * 0.72, (run * scale - 6) / (label.length * 0.56));
  if (px < TITLE_MIN_PX) return 'hidden';
  // turned, on the map, the way every line of text here reads (see readingAngle);
  // `rotate` is in the rect's own frame, so take the rect's own turn back off
  const base = r.h > r.w ? 90 : 0; // a tall rect runs upward from its width
  let rotate = readingAngle(r.rot + base) - r.rot;
  if (rotate > 180) rotate -= 360;
  if (rotate <= -180) rotate += 360;
  return { size: px / scale, rotate };
}

/** The angle a line of text is turned to when it runs along a line drawn at
 *  `deg` (clockwise on screen). It reads left to right or bottom to top —
 *  never upside down, and never top to bottom once it is steeper than 60°:
 *  a near-vertical line always reads upward, so an aisle's name, a shelf's
 *  title and its department's badge beside it all turn the same way. */
export function readingAngle(deg: number): number {
  const a = ((deg % 360) + 360) % 360;
  const turned = a > 60 && a < 240 ? a - 180 : a;
  return turned > 180 ? turned - 360 : turned; // written as a turn of at most half a circle
}

function ElementNode({
  el, scale, selected, highlighted, edit, showLabels = true,
}: { el: MapElement; scale: number; selected: boolean; highlighted?: boolean; edit: boolean; showLabels?: boolean }) {
  const fill =
    el.color || (el.type === 'wall' ? 'var(--el-wall-fill)' : TYPE_COLOR[el.type]);
  const stroke =
    el.color ? shade(el.color, -0.25) : el.type === 'wall' ? 'var(--el-wall-stroke)' : TYPE_STROKE[el.type];
  // walls never carry an on-map label — the "Outer walls" text just piled up
  // over the department names
  const label = el.type === 'wall' ? '' : el.label;
  let fs = 12.5 / scale;
  let labelHidden = false;
  try {
    const m = JSON.parse(el.meta || '{}');
    if (typeof m.labelScale === 'number') fs *= m.labelScale;
    labelHidden = m.labelHidden === true;
  } catch { /* default size */ }

  if (el.shape === 'rect') {
    const r = el.geom as RectGeom;
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    // a shelf's name runs along it (or across a display table); anything else keeps its name across the middle
    const along = el.type === 'shelf' && label ? shelfTitle(r, label, fs, scale) : null;
    const across = acrossMiddle(r, label, fs);
    const shelf = el.type === 'shelf';
    return (
      <g transform={r.rot ? `rotate(${r.rot} ${cx} ${cy})` : undefined} opacity={selected ? 1 : highlighted ? 1 : 0.97}>
        <rect
          x={r.x} y={r.y} width={r.w} height={r.h}
          fill={fill}
          fillOpacity={el.type === 'zone' ? (highlighted ? 0.45 : 0.3) : 1}
          stroke={highlighted ? '#e4572e' : stroke}
          strokeWidth={el.type === 'wall' ? 2.4 : highlighted ? 3 : 1.4}
          strokeDasharray={el.type === 'aisle' ? '7 5' : undefined}
          vectorEffect="non-scaling-stroke"
          rx={shelf ? 0 : Math.min(0.15, r.w / 4)}
        />
        {label && showLabels && !labelHidden && (along ? along !== 'hidden' : across) && (() => {
          // written along the shelf (a long one) or across its middle (anything else)
          const written = along && along !== 'hidden' ? along : null;
          return (
            <text
              x={cx} y={cy} textAnchor="middle" dominantBaseline="central"
              fontSize={written ? written.size : fs}
              // a shelf's fill is its department's colour: it picks the ink that reads on it
              className={shelf ? undefined : 'el-label'}
              fill={shelf ? inkOn(fill) : undefined}
              transform={written ? `rotate(${written.rotate} ${cx} ${cy})` : undefined}
            >
              {label}
            </text>
          );
        })()}
      </g>
    );
  }
  if (el.shape === 'point') {
    const p = el.geom as PointGeom;
    // common places read as symbols, not words — a matched glyph replaces the
    // name label entirely (see placeSymbols)
    const sym = placeGlyph(el.type, el.label);
    const glyph = sym ?? (el.type === 'entrance' ? '⬆' : el.type === 'exit' ? '⬇' : '★');
    // the entrance is the "you are here" marker — draw it bigger than the rest
    const entrance = el.type === 'entrance';
    return (
      <g>
        <circle cx={p.x} cy={p.y} r={entrance ? 0.75 : 0.45} fill={fill} stroke="#fff" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
        <text x={p.x} y={p.y} textAnchor="middle" dominantBaseline="central" fontSize={entrance ? 0.9 : 0.52} fill="#fff" pointerEvents="none">
          {glyph}
        </text>
        {label && !sym && showLabels && !labelHidden && (
          <text x={p.x + (entrance ? 1.05 : 0.7)} y={p.y} dominantBaseline="central" fontSize={fs} className="el-label">
            {label}
          </text>
        )}
      </g>
    );
  }
  const pts = polyPoints(el);
  const closed = el.shape === 'polygon';
  const centroid = pts.reduce((a, p) => ({ x: a.x + p.x / pts.length, y: a.y + p.y / pts.length }), { x: 0, y: 0 });
  // aisle labels sit ON the line (arc-length midpoint), between the shelf rows,
  // rotated to run along the strip's first segment
  const mid = el.type === 'aisle' ? polyMidpoint(pts) : null;
  const labelAt = mid ?? centroid;
  let labelRot = 0;
  if (mid && pts.length >= 2) {
    const a = pts[0];
    const b = pts[1];
    // along the strip, reading the way every turned line on the map does
    labelRot = readingAngle((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI);
  }
  return (
    <g>
      <polyline
        points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
        fill={closed ? fill : 'none'}
        fillOpacity={el.type === 'zone' ? (highlighted ? 0.5 : 0.28) : closed ? 1 : 0}
        stroke={stroke}
        strokeWidth={el.shape === 'polyline' ? 0.18 : 1.4}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {label && showLabels && !labelHidden && (
        <text
          x={labelAt.x}
          y={labelAt.y}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={mid ? Math.max(fs, 11 / scale) : fs}
          className={mid ? 'el-label isle' : 'el-label'}
          strokeWidth={mid ? 0.14 / scale : undefined}
          paintOrder={mid ? 'stroke' : undefined}
          fontWeight={mid ? 700 : undefined}
          transform={labelRot ? `rotate(${labelRot} ${labelAt.x} ${labelAt.y})` : undefined}
        >
          {mid ? label.toUpperCase() : label}
        </text>
      )}
    </g>
  );
}

function RectPreview({ r, type }: { r: RectGeom; type: MapElement['type'] }) {
  return (
    <rect
      x={r.x}
      y={r.y}
      width={Math.max(r.w, 0.01)}
      height={Math.max(r.h, 0.01)}
      fill={TYPE_COLOR[type]}
      fillOpacity={0.55}
      stroke={TYPE_STROKE[type]}
      strokeWidth={1.6}
      strokeDasharray="6 4"
      vectorEffect="non-scaling-stroke"
      pointerEvents="none"
    />
  );
}

/** Selection overlay for a (split) wall segment: endpoint handles reshape the
 *  segment, the mid-handle rotates it around its centre — the polyline
 *  equivalent of the rect resize/rotate handles. */
function PolyOverlay({ pts, scale }: { pts: PolyGeom; scale: number }) {
  const hs = 4.5 / scale;
  const [x0, y0] = pts[0];
  const [x1, y1] = pts[pts.length - 1];
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const nx = -(y1 - y0) / len;
  const ny = (x1 - x0) / len;
  const D = 26 / scale;
  const rx = mx + nx * D;
  const ry = my + ny * D;
  return (
    <g>
      <line x1={x0} y1={y0} x2={x1} y2={y1} stroke="#2f6fd4" strokeWidth={1.5} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
      <rect data-handle="p0" x={x0 - hs} y={y0 - hs} width={hs * 2} height={hs * 2} rx={2 / scale} fill="#fff" stroke="#2f6fd4" strokeWidth={1.5} vectorEffect="non-scaling-stroke" style={{ cursor: 'move' }} />
      <rect data-handle="p1" x={x1 - hs} y={y1 - hs} width={hs * 2} height={hs * 2} rx={2 / scale} fill="#fff" stroke="#2f6fd4" strokeWidth={1.5} vectorEffect="non-scaling-stroke" style={{ cursor: 'move' }} />
      <line x1={mx} y1={my} x2={rx} y2={ry} stroke="#2f6fd4" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <circle data-handle="rot" cx={rx} cy={ry} r={hs * 1.1} fill="#fff" stroke="#2f6fd4" strokeWidth={1.5} vectorEffect="non-scaling-stroke" style={{ cursor: 'grab' }} />
    </g>
  );
}

function ProductPin({
  location, product, scale, focused, clickable, anchor, groupTitle, groupTitlePx, colorOverride, isGroupPin, onClick,
}: { location: ProductLocation; product: Product; scale: number; focused: boolean; clickable: boolean; anchor: (WorldPt & { nx?: number; ny?: number; el?: MapElement }) | null; groupTitle?: string; groupTitlePx?: number; colorOverride?: string; isGroupPin?: boolean; onClick: () => void }) {
  const color = colorOverride || product.category_color || '#2f6f3e';
  // the marker sits on the shelf's outline — the wall the item is stocked against
  const px = anchor?.x ?? location.x;
  const py = anchor?.y ?? location.y;
  // per-pin marker size set from the editor's pin panel (meta.pinW/pinH, metres)
  let pinSize: { w: number; h: number } | null = null;
  try {
    const m = JSON.parse(location.meta || '{}');
    if (typeof m.pinW === 'number' && typeof m.pinH === 'number') pinSize = { w: m.pinW, h: m.pinH };
  } catch { /* unparseable meta → default size */ }
  // flat facing: a slim bar ALONG the shelf edge (anchored, like stock on a
  // shelf); free-standing pins keep a small square
  const anchored = anchor && typeof anchor.nx === 'number' && typeof anchor.ny === 'number';
  const along = Math.atan2(anchor?.ny ?? 0, anchor?.nx ?? 0) * (180 / Math.PI) + 90;
  const w = pinSize?.w ?? (focused ? 0.62 : 0.5); // facing width along the shelf edge
  const h = pinSize?.h ?? (focused ? 0.26 : 0.2); // depth off the face
  return (
    <g
      onPointerDown={clickable ? (e) => { e.stopPropagation(); onClick(); } : undefined}
      style={{ cursor: clickable ? 'pointer' : 'default' }}
    >
      {focused && <circle className="pin-pulse" cx={px} cy={py} r={0.5} fill={color} />}
      {anchored ? (
        <rect
          x={px - w / 2}
          y={py - h / 2}
          width={w}
          height={h}
          transform={along ? `rotate(${along} ${px} ${py})` : undefined}
          rx={0.05}
          fill={color}
          stroke="#fff"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      ) : (
        <rect
          x={px - (pinSize?.w ?? 0.42) / 2}
          y={py - (pinSize?.h ?? 0.42) / 2}
          width={pinSize?.w ?? 0.42}
          height={pinSize?.h ?? 0.42}
          rx={0.08}
          fill={color}
          stroke="#fff"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {/* invisible fat hit target so the slim bar is still easy to click */}
      <circle cx={px} cy={py} r={0.45} fill="transparent" pointerEvents={clickable ? 'all' : 'none'} />
      {/* a group pin carries its GROUP's title at all times — it IS the
          group's map pin, never an item's name (even when focused). Other
          pins label only while focused. On a vertical gondola a group's title
          runs along the pin, over the shelf it names: horizontal text there
          would lie across the neighbouring runs. */}
      {(groupTitle || (!isGroupPin && focused && product.name)) && (() => {
        const upright = anchored && groupTitle && Math.abs(Math.sin((along * Math.PI) / 180)) > 0.85;
        if (!upright) {
          return (
            <text x={px} y={py - 0.85} textAnchor="middle" fontSize={(groupTitlePx ?? 13) / scale} className="el-label" stroke="var(--map-floor)" strokeWidth={3.5 / scale} paintOrder="stroke" fontWeight={700}>
              {groupTitle ?? product.name}
            </text>
          );
        }
        const rg = anchor?.el?.shape === 'rect' ? (anchor.el.geom as RectGeom) : null;
        const depth = rg ? Math.min(rg.w, rg.h) : 0;
        const tx = px - anchor!.nx! * depth / 2;
        const ty = py - anchor!.ny! * depth / 2;
        // parallel to the bar, reading upward
        let tilt = ((((along + 90) % 180) + 180) % 180) - 90;
        if (Math.sin((tilt * Math.PI) / 180) > 0.2) tilt -= 180;
        return (
          <text x={tx} y={ty} textAnchor="middle" dominantBaseline="central" fontSize={(groupTitlePx ?? 13) / scale} className="el-label" stroke="var(--map-floor)" strokeWidth={3.5 / scale} paintOrder="stroke" strokeLinejoin="round" fontWeight={700} transform={`rotate(${tilt} ${tx} ${ty})`}>
            {groupTitle}
          </text>
        );
      })()}
    </g>
  );
}

/** Does a line of text — `x0` to `x1`, centred on `y`, `pad` half its height —
 *  lie over a rect's actual footprint? The box around a diagonal shelf is far
 *  larger than the shelf, so the line is walked along and each step tested in
 *  the rect's own frame. */
function overRect(r: RectGeom, pad: number): (x0: number, x1: number, y: number) => boolean {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const a = (-r.rot * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return (x0, x1, y) => {
    const steps = Math.max(1, Math.ceil((x1 - x0) / Math.min(0.4, 2 * pad)));
    for (let i = 0; i <= steps; i++) {
      const px = x0 + ((x1 - x0) * i) / steps;
      const lx = cx + (px - cx) * cos - (y - cy) * sin;
      const ly = cy + (px - cx) * sin + (y - cy) * cos;
      if (lx >= r.x - pad && lx <= r.x + r.w + pad && ly >= r.y - pad && ly <= r.y + r.h + pad) return true;
    }
    return false;
  };
}

/** The department a zone records in its meta — the one its shelves belong to
 *  — where that is not the zone's own name ("Produce" holding Fresh Produce). */
interface TitleBox { id: string; cx: number; cy: number; x0: number; x1: number; y0: number; y1: number }

/** The patch of map a group pin's title covers, in metres — where ProductPin
 *  writes it: along an upright run, otherwise set above the pin. Type set
 *  tight against its neighbour still reads, so the patch is a little smaller
 *  than the glyphs. */
function pinTitleBox(
  id: string, anchor: (WorldPt & { nx?: number; ny?: number; el?: MapElement }) | null, spec: { title: string; px: number }, scale: number
): TitleBox | null {
  if (!anchor) return null;
  const title = spec.title;
  const len = (title.length * spec.px * 0.56) / scale;
  const half = spec.px * 0.38 / scale;
  const anchored = typeof anchor.nx === 'number' && typeof anchor.ny === 'number';
  const along = Math.atan2(anchor.ny ?? 0, anchor.nx ?? 0) * (180 / Math.PI) + 90;
  if (anchored && Math.abs(Math.sin((along * Math.PI) / 180)) > 0.85) {
    const rg = anchor.el?.shape === 'rect' ? (anchor.el.geom as RectGeom) : null;
    const depth = rg ? Math.min(rg.w, rg.h) : 0;
    const cx = anchor.x - anchor.nx! * depth / 2;
    const cy = anchor.y - anchor.ny! * depth / 2;
    return { id, cx, cy, x0: cx - half, x1: cx + half, y0: cy - len / 2, y1: cy + len / 2 };
  }
  const cy = anchor.y - 0.85 - 4.2 * spec.px / 13 / scale; // on a baseline 0.85 m above the pin
  return { id, cx: anchor.x, cy, x0: anchor.x - len / 2, x1: anchor.x + len / 2, y0: cy - half, y1: cy + half };
}

/** The department a zone records in its meta — the one its shelves belong to
 *  — where that is not the zone's own name ("Produce" holding Fresh Produce). */
function zoneDepartment(z: MapElement): string {
  try {
    const d = JSON.parse(z.meta || '{}').department;
    return typeof d === 'string' ? d : '';
  } catch {
    return '';
  }
}

/** An element's label options from its meta: its size in px (12.5 unless
 *  scaled) and whether the owner hid it — what ElementNode draws by. */
function labelOptions(el: MapElement): { px: number; hidden: boolean } {
  try {
    const m = JSON.parse(el.meta || '{}');
    return { px: 12.5 * (typeof m.labelScale === 'number' ? m.labelScale : 1), hidden: m.labelHidden === true };
  } catch {
    return { px: 12.5, hidden: false };
  }
}

/** Selection outline + 8 resize handles + rotation handle (screen-constant sizes). */

function SelectionOverlay({ r, scale, label }: { r: RectGeom; scale: number; label: string }) {
  const corners = rectCorners(r);
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const hs = 4.5 / scale; // handle half-size
  const edgeMids = corners.map((p, i) => {
    const q = corners[(i + 1) % 4];
    return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
  });
  const handles: { t: HandleType; p: WorldPt }[] = [
    { t: 'nw', p: corners[0] }, { t: 'n', p: edgeMids[0] }, { t: 'ne', p: corners[1] },
    { t: 'e', p: edgeMids[1] }, { t: 'se', p: corners[2] }, { t: 's', p: edgeMids[2] },
    { t: 'sw', p: corners[3] }, { t: 'w', p: edgeMids[3] },
  ];
  const a = (r.rot * Math.PI) / 180;
  // handle orbits the center CLOCKWISE with the rect (SVG rotate() is CW in
  // y-down coords) — the old -sin() put it on the mirrored side, drifting out
  // of place as soon as rot !== 0
  const D = r.h / 2 + 26 / scale;
  const rotHandle = { x: cx + Math.sin(a) * D, y: cy - Math.cos(a) * D };
  const rotStem = { x: cx + (r.h / 2) * Math.sin(a), y: cy - (r.h / 2) * Math.cos(a) };
  return (
    <g pointerEvents="none">
      <polygon
        points={handles.map((h) => `${h.p.x},${h.p.y}`).join(' ')}
        fill="transparent"
        stroke="#2f6f3e"
        strokeWidth={1.8}
        strokeDasharray="5 3"
        vectorEffect="non-scaling-stroke"
      />
      {handles.map((h) => (
        <rect
          key={h.t}
          data-handle={h.t}
          x={h.p.x - hs}
          y={h.p.y - hs}
          width={hs * 2}
          height={hs * 2}
          fill="#fff"
          stroke="#2f6f3e"
          strokeWidth={1.6}
          vectorEffect="non-scaling-stroke"
          pointerEvents="all"
          style={{ cursor: handleCursor(h.t, r.rot) }}
        />
      ))}
      <line x1={rotStem.x} y1={rotStem.y} x2={rotHandle.x} y2={rotHandle.y} stroke="#2f6f3e" strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
      <circle
        data-handle="rot"
        cx={rotHandle.x}
        cy={rotHandle.y}
        r={6 / scale}
        fill="#2f6f3e"
        stroke="#fff"
        strokeWidth={1.6}
        vectorEffect="non-scaling-stroke"
        pointerEvents="all"
        style={{ cursor: 'grab' }}
      />
    </g>
  );
}

export { TYPE_COLOR, TYPE_STROKE, shade, elementPoints };
