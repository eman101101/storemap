import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Floor, MapElement, PointGeom, PolyGeom, Product, RectGeom, ProductLocation } from '../types';
import {
  elementContains, elementPoints, fitViewport, HANDLE_TYPES, polyPoints, rectCorners,
  resizeRect, rotateRectTo, shelfAnchor, snap, snapPt, translateElement,
  type HandleType, type Viewport, type WorldPt,
} from '../lib/geometry';
import { TYPE_COLOR, TYPE_STROKE, shade } from '../lib/mapColors';

export type EditorTool =
  | 'select' | 'shelf' | 'aisle-pair' | 'wall' | 'wall-line' | 'aisle' | 'zone' | 'zone-poly'
  | 'entrance' | 'exit' | 'poi' | 'product';

const TOOL_DEF: Record<Exclude<EditorTool, 'select' | 'product'>, { type: MapElement['type']; shape: MapElement['shape'] }> = {
  shelf: { type: 'shelf', shape: 'rect' },
  'aisle-pair': { type: 'shelf', shape: 'rect' }, // EditorPage adds the facing row on commit
  wall: { type: 'wall', shape: 'rect' },
  'wall-line': { type: 'wall', shape: 'polyline' },
  aisle: { type: 'aisle', shape: 'polyline' },
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
  onElementsChange?: (els: MapElement[], history: 'begin' | 'live' | 'push') => void;
  onAddElement?: (el: MapElement) => void;
  onDraftAdd?: (p: WorldPt) => void;
  onDraftFinish?: () => void;
  onDraftCancel?: () => void;
  onPlaceProduct?: (p: WorldPt) => void;
  onPinClick?: (productId: string) => void;
  /** Editor pick filter: 'all' selects fixtures, 'products' selects/drags pins only
   *  (clicks pass over floors and walls instead of grabbing them). */
  pickFilter?: 'all' | 'products';
  /** Drag/move a product pin. commit=false during the drag, true on release. */
  onPinMove?: (locationId: string, productId: string, x: number, y: number, commit: boolean) => void;
  onPinSelect?: (productId: string) => void;
  /** Viewer tap on a map element (e.g. open a shelf's layout). */
  onElementClick?: (el: MapElement) => void;
  focusPinId?: string | null;
  highlightElementIds?: Set<string>;
  fitSignal?: number;
  zoomCommand?: { k: number; seq: number };
  focus?: { x: number; y: number; seq: number };
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
  | { kind: 'move-pin'; locationId: string; productId: string; moved: boolean }
  | null;

const isTypingTarget = (t: EventTarget | null) =>
  t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;

export default function MapCanvas(props: Props) {
  const {
    floor, elements, pins, viewport, onViewport, edit = false, tool = 'select', grid = 0.25,
    selectedId, selectedIds, onMultiSelect, bgOpacity = 0.95, draftPts = [], onSelect, onElementsChange, onAddElement,
    onDraftAdd, onDraftFinish, onDraftCancel, onPlaceProduct, onPinClick, onElementClick,
    focusPinId, highlightElementIds, fitSignal = 0, zoomCommand, focus, route = null,
    pickFilter = 'all', onPinMove, onPinSelect, tripStops,
  } = props;
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const interaction = useRef<Interaction>(null);
  const pointers = useRef(new Map<number, WorldPt>());
  const pinch = useRef<{ dist: number; vp: Viewport; mid: WorldPt } | null>(null);
  const [draftRect, setDraftRect] = useState<RectGeom | null>(null);
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
    onViewport(fitViewport(floor.width_m, floor.height_m, size.w, size.h));
  }, [floor.width_m, floor.height_m, size.w, size.h, onViewport]);

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
  });

  const zoomAt = (p: WorldPt, k: number) => {
    const s = Math.min(60, Math.max(1.2, viewport.scale * k));
    const applied = s / viewport.scale;
    onViewport({
      scale: s,
      tx: p.x - (p.x - viewport.tx) * applied,
      ty: p.y - (p.y - viewport.ty) * applied,
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
  }, [edit, draftPts.length, selectedId, elements]); // eslint-disable-line react-hooks/exhaustive-deps

  const replaceElement = (next: MapElement, history: 'begin' | 'live' | 'push') => {
    onElementsChange?.(elements.map((el) => (el.id === next.id ? next : el)), history);
  };

  // Programmatic zoom (toolbar buttons): zoom around the current view center.
  useEffect(() => {
    if (!zoomCommand) return;
    zoomAt({ x: size.w / 2, y: size.h / 2 }, zoomCommand.k);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomCommand?.seq]);

  // Center + zoom on a world point (e.g. a tapped search result).
  useEffect(() => {
    if (!focus) return;
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
      geom: { x: a.x <= b.x ? x : b.x, y: a.y <= b.y ? y : b.y, w, h, rot: 0 },
      label: '',
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
      interaction.current = null;
      setDraftRect(null);
      return;
    }
    if (pointers.current.size > 1 || drawing.current) return;

    // Viewer: one-finger / mouse drag pans.
    if (!edit) {
      interaction.current = { kind: 'pan', start: { x: e.clientX, y: e.clientY }, vp: viewport, moved: false };
      return;
    }

    const w = toWorld(e);
    const isPanButton = e.button === 1 || e.shiftKey;

    // products pick filter: grab the nearest pin, never the fixtures under it
    if (edit && tool === 'select' && pickFilter === 'products' && e.button === 0 && !isPanButton) {
      const grabR = Math.max(0.5, 16 / viewport.scale);
      let bestPin: MapPin | null = null;
      let bestD = grabR;
      for (const p of pins) {
        const d = Math.hypot(p.location.x - w.x, p.location.y - w.y);
        if (d < bestD) {
          bestD = d;
          bestPin = p;
        }
      }
      if (bestPin) {
        onSelect?.(null);
        setSelectedPinId(bestPin.location.id);
        interaction.current = { kind: 'move-pin', locationId: bestPin.location.id, productId: bestPin.product.id, moved: false };
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
        }
      }
      if (isPanButton) {
        interaction.current = { kind: 'pan', start: { x: e.clientX, y: e.clientY }, vp: viewport, moved: false };
        return;
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
      onPlaceProduct?.(snapPt(w, grid));
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
    onDraftAdd?.(snapPt(w, grid));
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (edit) setCursorWorld(toWorld(e));

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
      const dx = snap(it.start.x + (w.x - it.start.x), grid) - it.start.x;
      const dy = snap(it.start.y + (w.y - it.start.y), grid) - it.start.y;
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
      replaceElement(
        { ...elements.find((el) => el.id === it.id)!, geom: resizeRect(it.orig, it.handle, snapPt(w, grid)) },
        it.began ? 'live' : 'begin'
      );
      it.began = true;
    } else if (it.kind === 'rotate') {
      const r = rotateRectTo(it.orig, w);
      if (e.shiftKey) r.rot = Math.round(r.rot / 15) * 15;
      replaceElement({ ...elements.find((el) => el.id === it.id)!, geom: r }, it.began ? 'live' : 'begin');
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
        onPinMove?.(it.locationId, it.productId, snapped.x, snapped.y, true);
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
    }
    interaction.current = null;
  };

  const onDoubleClick = () => {
    if (edit && draftPts.length) onDraftFinish?.();
  };

  const scale = viewport.scale;
  const floorEls = useMemo(() => elements, [elements]);
  const floorPins = useMemo(() => pins.filter((p) => p.location.floor_id === floor.id), [pins, floor.id]);

  const sel = selectedId ? floorEls.find((el) => el.id === selectedId) : null;

  return (
    <svg
      ref={svgRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onDoubleClick={onDoubleClick}
      style={{ cursor: tool === 'select' ? 'default' : 'crosshair' }}
    >
      <defs>
        {/* strokes are in world meters: pattern content ignores vectorEffect */}
        <pattern id="grid-min" width={1} height={1} patternUnits="userSpaceOnUse">
          <path d="M 1 0 L 0 0 0 1" fill="none" stroke="#e2e6dd" strokeWidth={0.02} />
        </pattern>
        <pattern id="grid-maj" width={5} height={5} patternUnits="userSpaceOnUse">
          <path d="M 5 0 L 0 0 0 5" fill="none" stroke="#cdd4c5" strokeWidth={0.035} />
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
          fill={floor.background_url ? 'none' : '#fbfaf6'}
          stroke="#b9c1b0"
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
            highlighted={highlightElementIds?.has(el.id)}
            edit={edit}
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
          </g>
        ))}

        {floorPins.map(({ location, product }) => (
          <ProductPin
            key={location.id}
            location={location}
            product={product}
            scale={scale}
            focused={location.id === focusPinId || (edit && location.id === selectedPinId)}
            clickable={!edit}
            anchor={shelfAnchor({ x: location.x, y: location.y }, elements)}
            onClick={() => onPinClick?.(product.id)}
          />
        ))}

        {sel?.shape === 'rect' && edit && (
          <SelectionOverlay r={sel.geom as RectGeom} scale={scale} label={sel.label} />
        )}
      </g>
    </svg>
  );
}

/* ---------------- rendering helpers ---------------- */

function ElementNode({
  el, scale, selected, highlighted, edit,
}: { el: MapElement; scale: number; selected: boolean; highlighted?: boolean; edit: boolean }) {
  const fill = el.color || TYPE_COLOR[el.type];
  const stroke = el.color ? shade(el.color, -0.25) : TYPE_STROKE[el.type];
  const label = el.label;
  const fs = 12.5 / scale;

  if (el.shape === 'rect') {
    const r = el.geom as RectGeom;
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const dim = r.w < (label.length * fs * 0.55) / Math.max(r.h, 0.001) || r.h < fs * 1.2;
    return (
      <g transform={r.rot ? `rotate(${r.rot} ${cx} ${cy})` : undefined} opacity={selected ? 1 : highlighted ? 1 : 0.97}>
        <rect
          x={r.x} y={r.y} width={r.w} height={r.h}
          fill={fill}
          fillOpacity={el.type === 'zone' ? (highlighted ? 0.5 : 0.3) : 1}
          stroke={stroke}
          strokeWidth={1.4}
          strokeDasharray={el.type === 'aisle' ? '7 5' : undefined}
          vectorEffect="non-scaling-stroke"
          rx={Math.min(0.15, r.w / 4)}
        />
        {label && !dim && (
          <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fontSize={fs} className="el-label">
            {label}
          </text>
        )}
      </g>
    );
  }
  if (el.shape === 'point') {
    const p = el.geom as PointGeom;
    const glyph = el.type === 'entrance' ? '⬆' : el.type === 'exit' ? '⬇' : '★';
    return (
      <g>
        <circle cx={p.x} cy={p.y} r={0.45} fill={fill} stroke="#fff" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
        <text x={p.x} y={p.y} textAnchor="middle" dominantBaseline="central" fontSize={0.52} fill="#fff" pointerEvents="none">
          {glyph}
        </text>
        {label && (
          <text x={p.x + 0.7} y={p.y} dominantBaseline="central" fontSize={fs} className="el-label">
            {label}
          </text>
        )}
      </g>
    );
  }
  const pts = polyPoints(el);
  const closed = el.shape === 'polygon';
  const centroid = pts.reduce((a, p) => ({ x: a.x + p.x / pts.length, y: a.y + p.y / pts.length }), { x: 0, y: 0 });
  return (
    <g>
      <polyline
        points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
        fill={closed ? fill : 'none'}
        fillOpacity={el.type === 'zone' ? (highlighted ? 0.5 : 0.28) : closed ? 1 : 0}
        stroke={stroke}
        strokeWidth={el.shape === 'polyline' ? Math.max(0.18, 0.1) : 1.4}
        strokeDasharray={el.shape === 'polyline' ? undefined : undefined}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {label && (
        <text x={centroid.x} y={centroid.y} textAnchor="middle" dominantBaseline="central" fontSize={fs} className="el-label">
          {label}
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

function ProductPin({
  location, product, scale, focused, clickable, anchor, onClick,
}: { location: ProductLocation; product: Product; scale: number; focused: boolean; clickable: boolean; anchor: WorldPt | null; onClick: () => void }) {
  const color = product.category_color || '#2f6f3e';
  // the dot sits on the shelf's outline — the wall the item is stocked against
  const px = anchor?.x ?? location.x;
  const py = anchor?.y ?? location.y;
  return (
    <g
      onPointerDown={clickable ? (e) => { e.stopPropagation(); onClick(); } : undefined}
      style={{ cursor: clickable ? 'pointer' : 'default' }}
    >
      {focused && <circle className="pin-pulse" cx={px} cy={py} r={0.5} fill={color} />}
      <circle
        cx={px}
        cy={py}
        r={focused ? 0.55 : 0.42}
        fill={color}
        stroke="#fff"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={px} cy={py} r={0.13} fill="#fff" pointerEvents="none" />
      {focused && product.name && (
        <text
          x={px}
          y={py - 0.85}
          textAnchor="middle"
          fontSize={13 / scale}
          className="el-label"
          stroke="#ffffff"
          strokeWidth={3.5 / scale}
          paintOrder="stroke"
          fontWeight={700}
        >
          {product.name}
        </text>
      )}
    </g>
  );
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
  const rotHandle = { x: cx - Math.sin(a) * (r.h / 2 + 26 / scale), y: cy - Math.cos(a) * (r.h / 2 + 26 / scale) };
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
      {label ? null : null}
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
          style={{ cursor: 'nwse-resize' }}
        />
      ))}
      <line x1={cx} y1={cy - r.h / 2} x2={rotHandle.x} y2={rotHandle.y} stroke="#2f6f3e" strokeWidth={1.4} vectorEffect="non-scaling-stroke" transform={r.rot ? `rotate(${r.rot} ${cx} ${cy})` : undefined} />
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
