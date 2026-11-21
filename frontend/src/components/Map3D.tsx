import { useEffect, useMemo, useRef, useState } from 'react';
import type { Floor, MapElement } from '../types';
import { groupDisplayName, locationFlags } from '../types';
import {
  buildSceneBSP, buildSceneFaces, camFromEyeLook, fitCamera, pathSampler,
  renderScene, screenToWorldFloor, pickFixture, scaleColor, routeFaces, stockFaces as buildStockFaces, MODERN_THEME,
  DIST_MIN, DIST_MAX, shelfDetailForDist,
  type Camera3D, type Face, type MapTheme, type Pin3D, type PinHit, type AisleHit, type StockItem, type ShelfDetail,
} from '../lib/render3d';
import { snap, elementPoints, shelfAnchor, translateElement, type WorldPt } from '../lib/geometry';
import { aisleContents, shelfContents, AISLE_REACH_M, SHELF_TOL_M } from '../lib/aisleInfo';
import { shelfBoardZs, shelfItemSize, shelfSideOf, shelfRunLength } from '../lib/shelfLayout';

export interface Pin {
  location: { id: string; x: number; y: number; product_id: string; meta?: string };
  product: { name: string; category_name?: string | null; category_color?: string | null };
}

interface Props {
  floor: Floor;
  elements: MapElement[];
  pins: Pin[];
  focusPinId?: string | null;
  /** A whole group to highlight at once (search results / browsed category) — location ids. */
  focusPinIds?: string[] | null;
  route?: WorldPt[] | null;
  /** When set (seq changes), the camera flies the route from its start to the item. */
  flythrough?: { points: WorldPt[]; seq: number } | null;
  onPinClick?: (productId: string) => void;
  /** editor pick filter — Select: Items suppresses fixture grabs (pins only),
   *  Select: Structures suppresses pin taps (fixtures only) */
  pickFilter?: 'all' | 'products';
  /** All pins on the floor — drives the visual product blocks on the shelf faces. */
  stockPins?: Pin[];
  /** Items visibility (groups view): false hides the shelf stocking and the
   *  per-pin hit targets except the focused pins — the floor reads as clean
   *  fixtures + area labels instead of thousands of product blocks. */
  showItems?: boolean;
  /** Draw the per-product blocks on shelf faces (off for clean, pin-free maps). */
  stockFaces?: boolean;
  /** Multi-stop trip: numbered markers at each ordered stop (A1). */
  tripStops?: { productId: string; name: string; point: WorldPt }[];
  /** Camera lives in the parent so toggling 2D↔3D doesn't reset the angle. */
  camera: Camera3D | null;
  onCamera: (c: Camera3D) => void;
  /** Visual theme for the scene — light (default) or dark, following app appearance. */
  theme?: MapTheme;
  /** Viewer tap on a fixture (e.g. open a shelf's layout) — parity with the 2D map. */
  onElementClick?: (el: MapElement) => void;
  // ---- edit mode (EditorPage) ----
  /** Enable click-select + floor-plane dragging of fixtures. */
  edit?: boolean;
  /** Snap increment for drags/nudges (meters). */
  grid?: number | null;
  selectedId?: string | null;
  onSelectElement?: (id: string | null) => void;
  /** Drag delta relative to drag start, in world meters (already snapped). */
  onElementDrag?: (id: string, dx: number, dy: number, phase: 'begin' | 'live' | 'push') => void;
  /** Element-level edits from keyboard shortcuts (rotate/delete/nudge). */
  onElementsChange?: (els: MapElement[], history: 'begin' | 'live' | 'push') => void;
  /** When seq changes, aim the camera target at this element (outline selection). */
  focusElement?: { id: string; seq: number } | null;
  /** When seq changes, refit the camera to the whole floor (the Fit button). */
  fitSignal?: number;
  /** 2D-parity zoom buttons: a new seq glides the camera distance by k. */
  zoomCommand?: { k: number; seq: number } | null;
  /** Wheel behaviour: 'always' zooms the camera (page scroll is captured);
   *  'ctrl' zooms only with ctrl/⌘ held so embedded maps don't trap scroll. */
  wheelZoom?: 'always' | 'ctrl';
  /** Canvas touch-action: 'pan-y' lets vertical swipes scroll the page while
   *  horizontal drags orbit the camera (for embedded/hero maps on mobile). */
  touchAction?: 'none' | 'pan-y';
  /** lock edit interactions: fixtures can't be selected or dragged */
  locked?: boolean;
}

const PITCH_MIN = 0.18;
const PITCH_MAX = 1.45;

/** Radius (m) of the "local area" stocking on very full floors: on a search,
 *  item squares draw only within this distance of a focused pin (~its gondola
 *  pair plus the neighbouring shelves). */
const FOCUS_AREA_M = 10;

const EYE_Z = 8; // drone-style: well above the shelves
const EYE_BACK = 4; // camera trails the walker by this many meters along the path
const LOOK_AHEAD = 4;
const LOOK_Z = 0; // look down at the path itself
/** The one angle the whole flight holds — approach, walk and arrival alike. */
const FLIGHT_PITCH = Math.atan2(EYE_Z, EYE_BACK + LOOK_AHEAD);
const FLY_SPEED = 9; // m/s along the path
const FLY_MIN_S = 3;
const FLY_MAX_S = 9;
const APPROACH_MS = 750;
const ARRIVE_MS = 950;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpAngle = (a: number, b: number, t: number) => {
  const d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  return a + d * t;
};
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/** Smoothly move the camera (ease-out) — a single rAF loop that stops when done. */
function tweenCamera(from: Camera3D, to: Partial<Camera3D>, apply: (c: Camera3D) => void, signal: { cancelled: boolean }) {
  const keys = ['yaw', 'pitch', 'dist', 'tx', 'ty', 'tz'] as const;
  const start = performance.now();
  const dur = 420;
  const step = (now: number) => {
    if (signal.cancelled) return;
    const t = Math.min(1, (now - start) / dur);
    const e = easeOut(t);
    const next: Camera3D = { ...from };
    for (const k of keys) {
      if (to[k] !== undefined) {
        next[k] = k === 'yaw' ? lerpAngle(from[k], to[k] as number, e) : lerp(from[k], to[k] as number, e);
      }
    }
    apply(next);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export default function Map3D({ floor, elements, pins, focusPinId, focusPinIds, route, flythrough, onPinClick, stockPins = [], showItems = true, stockFaces = true, camera, onCamera, tripStops, theme = MODERN_THEME, onElementClick, edit = false, grid = 0.25, selectedId, onSelectElement, onElementDrag, onElementsChange, focusElement, fitSignal = 0, zoomCommand = null, wheelZoom = 'always', touchAction = 'none', locked = false, pickFilter = 'all' }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const cam = camera ?? fitCamera(floor); // parent owns the camera across 2D↔3D toggles
  const setCam = onCamera;
  const [flying, setFlying] = useState(false);
  const tweenSignal = useRef({ cancelled: false });
  const flySignal = useRef<{ cancelled: boolean } | null>(null);
  const flyGoal = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  // the seq that already flew — the very first route shown must NOT auto-play
  const flownSeq = useRef<number | null>(null);
  const hitsRef = useRef<{ pins: PinHit[]; aisles: AisleHit[] }>({ pins: [], aisles: [] });
  /** edit mode: the pin a press began on — its tap-select wins over the
   *  fixture behind it (2D's pendingPin pattern) */
  const pendingPin = useRef<string | null>(null);
  const [hoverAisle, setHoverAisle] = useState<{ id: string; sx: number; sy: number } | null>(null);
  /** Hover pick preview (edit mode): the element id a click would select. Only
   *  the ID lives here — it feeds the draw effect, so it must change exactly
   *  when the pick changes, not on every mousemove. */
  const [hoverPick, setHoverPick] = useState<string | null>(null);
  /** Where the pick tip floats (cursor px) — cheap state, no draw on change. */
  const [pickTipAt, setPickTipAt] = useState<{ sx: number; sy: number } | null>(null);
  /** Viewer: the tappable shelf under the pointer, and where to pin its card. */
  const [hoverShelf, setHoverShelf] = useState<{ id: string; sx: number; sy: number; side: 'front' | 'back' } | null>(null);
  /** Viewer: the product facing under the pointer (location id) — lifts its stack. */
  const [hoverPinLocId, setHoverPinLocId] = useState<string | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number; moved: boolean } | null>(null);
  const pinch = useRef<{ dist: number; startDist: number; cx: number; cy: number; tx: number; ty: number } | null>(null);
  // 3D edit drag: which fixture, where the pointer grabbed the floor plane
  const elDrag = useRef<{ id: string; startFloor: WorldPt; began: boolean; moved: boolean; lastDx: number; lastDy: number } | null>(null);
  // middle-mouse ground pan (same math as the two-finger pan)
  const midPan = useRef<{ sx: number; sy: number; tx: number; ty: number; yaw: number } | null>(null);
  const camRef = useRef(cam);
  camRef.current = cam;
  const floorRef = useRef(floor);
  floorRef.current = floor;

  // visual product blocks on the shelf faces, from every pinned item on this
  // floor — off (stockFaces=false) for clean, pin-free maps. On very full
  // floors (big-box demo) the squares dominate the render budget: thousands of
  // faces and BSP nodes. There they draw ONLY in the searched item's local
  // area, and not at all until something is searched — the floor reads clean
  // and the "found it" moment keeps its glowing neighbourhood. Hover
  // highlighting stays off on those floors too: it changes the stocking
  // faces, which would rebuild the whole scene BSP on every hover crossing.
  const heavy = !showItems || stockPins.length > 500;
  const hoverLoc = heavy ? null : hoverPinLocId;
  const stocking = useMemo<StockItem[]>(
    () => {
      if (!stockFaces) return [];
      const focusSet = focusPinIds?.length ? new Set(focusPinIds) : null;
      const isFocus = (id: string) => id === focusPinId || (focusSet?.has(id) ?? false);
      // heavy floors: keep only pins inside the focused pin's local area
      let inArea = (_x: number, _y: number): boolean => true;
      if (heavy) {
        const focusPts = stockPins.filter((p) => isFocus(p.location.id));
        if (!focusPts.length) return [];
        inArea = (x, y) =>
          focusPts.some((p) => Math.hypot(p.location.x - x, p.location.y - y) <= FOCUS_AREA_M);
      }
      // one facing per pin keeps the big-box scene light (full stacks below 500)
      return stockPins
        .filter((p) => inArea(p.location.x, p.location.y))
        .map((p): StockItem | null => {
          const a = shelfAnchor({ x: p.location.x, y: p.location.y }, elements);
          if (!a) return null;
          const size = shelfItemSize(a.el);
          // per-pin marker size from the editor's "Size on map" (meta.pinW/pinH)
          // wins over the shelf-wide drawn size — visible in 3D like in 2D
          let pinSize: { w: number; h: number } | null = null;
          try {
            const pm = JSON.parse(p.location.meta || '{}');
            if (typeof pm.pinW === 'number' && typeof pm.pinH === 'number') pinSize = { w: pm.pinW, h: pm.pinH };
          } catch { /* unparseable meta → shelf default */ }
          // facing runs scale with the shelf: a 19 m gondola carries wider
          // items than a 2 m checkout counter (clamped to stay sensible)
          const run = shelfRunLength(a.el);
          const scaleW = Math.max(0.9, Math.min(2.4, run / 12));
          const zs = shelfBoardZs(a.el);
          return {
            x: a.x,
            y: a.y,
            nx: a.nx,
            ny: a.ny,
            color: scaleColor(p.product.category_color || '#2f6f3e', 0.88 + (((p.location.x * 7 + p.location.y * 13) % 5) * 0.06)),
            focused: isFocus(p.location.id),
            hovered: p.location.id === hoverLoc,
            zs: heavy ? [zs[Math.floor(zs.length / 2)] ?? zs[0]!] : zs,
            h: pinSize?.h ?? size.h,
            w: pinSize ? pinSize.w : size.w * scaleW,
          };
        })
        .filter((s): s is StockItem => s !== null);
    },
    [stockPins, elements, stockFaces, focusPinId, focusPinIds, hoverLoc, heavy]
  );

  // zoom LOD for the shelf detailing (hysteresis): past solidBeyond the painted
  // board strips are sub-pixel noise, so shelves draw as plain boxes; they earn
  // the strips back only below fullBelow — the band is wider than wheel/pinch
  // jitter, so a zoom resting on the boundary can't flap the geometry (each
  // flip rebuilds the scene faces + the BSP).
  const shelfDetailRef = useRef<ShelfDetail>('full');
  const shelfDetail = shelfDetailForDist(cam.dist, shelfDetailRef.current);
  shelfDetailRef.current = shelfDetail;

  // static geometry only depends on the floor + elements — build it once, not per frame
  const sceneFaces = useMemo<Face[]>(
    () => buildSceneFaces(floor, elements, theme, { shelfDetail }),
    [floor, elements, theme, shelfDetail]
  );

  // one BSP per draw layer over the whole scene: exact back-to-front order for
  // any camera angle. Rebuilt only when the data changes, never per frame.
  const bspInput = useMemo(
    () => [...sceneFaces, ...buildStockFaces(stocking, theme)],
    [sceneFaces, stocking, theme]
  );
  // the route is NOT in the BSP — shelves would occlude the very line the
  // shopper is following. It renders as a translucent overlay pass on top.
  const routeFacesMemo = useMemo(
    () => (route && route.length > 1 ? routeFaces(route, theme) : []),
    [route, theme]
  );
  const sceneBSP = useMemo(() => buildSceneBSP(bspInput), [bspInput]);

  // observe container size
  useEffect(() => {
    const el = canvasRef.current;
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

  // A5: floor changes keep the shopper's angle and zoom — only re-aim the
  // center (a whole-floor refit would jar mid-trip). First mount still fits.
  const lastFloorId = useRef<string | null>(null);
  useEffect(() => {
    if (lastFloorId.current === null) {
      lastFloorId.current = floor.id;
      return;
    }
    if (floor.id !== lastFloorId.current) {
      lastFloorId.current = floor.id;
      setCam({ ...camRef.current, tx: floor.width_m / 2, ty: floor.height_m / 2, tz: 0 });
    }
  }, [floor.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fit button: refit the whole floor when the editor raises fitSignal
  const lastFit = useRef(fitSignal);
  useEffect(() => {
    if (fitSignal === lastFit.current) return;
    lastFit.current = fitSignal;
    setCam(fitCamera(floor));
  }, [fitSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  // zoom buttons (the vertical ＋/− pad, shared with the 2D map): a new
  // command glides `dist` by k with the same ease as every other camera move
  const lastZoomSeq = useRef(0);
  useEffect(() => {
    if (!zoomCommand || zoomCommand.seq === lastZoomSeq.current) return;
    lastZoomSeq.current = zoomCommand.seq;
    tweenSignal.current.cancelled = true;
    const signal = { cancelled: false };
    tweenSignal.current = signal;
    const c = camRef.current;
    // zoomCommand.k follows the 2D convention: k > 1 = zoom IN — in 3D that
    // means a SHORTER camera distance, so divide (multiplying reversed +/−)
    tweenCamera(c, { dist: Math.min(DIST_MAX, Math.max(DIST_MIN, c.dist / zoomCommand.k)) }, setCam, signal);
  }, [zoomCommand?.seq]); // eslint-disable-line react-hooks/exhaustive-deps

  // selection made elsewhere (outline/panel) → aim the camera target at it
  const lastFocusSeq = useRef<number | null>(null);
  useEffect(() => {
    if (!focusElement || focusElement.seq === lastFocusSeq.current) return;
    lastFocusSeq.current = focusElement.seq;
    const el = elements.find((x) => x.id === focusElement.id);
    if (!el) return;
    const pts = elementPoints(el);
    const cx = pts.reduce((a, p) => a + p.x / pts.length, 0);
    const cy = pts.reduce((a, p) => a + p.y / pts.length, 0);
    tweenSignal.current.cancelled = true;
    const signal = { cancelled: false };
    tweenSignal.current = signal;
    tweenCamera(camRef.current, { tx: cx, ty: cy, tz: 0 }, setCam, signal);
  }, [focusElement?.seq]); // eslint-disable-line react-hooks/exhaustive-deps

  // edit-mode keyboard: rotate (R), delete, nudge (arrows) — parity with 2D
  useEffect(() => {
    if (!edit) return;
    const isTyping = (t: EventTarget | null) =>
      t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
    const replace = (next: MapElement[], history: 'begin' | 'live' | 'push') => onElementsChange?.(next, history);
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (e.key === 'Escape') {
        if (selectedId) onSelectElement?.(null);
        return;
      }
      if (!selectedId) return;
      const el = elements.find((x) => x.id === selectedId);
      if (!el) return;
      if ((e.key === 'r' || e.key === 'R') && el.shape === 'rect') {
        e.preventDefault();
        const g = el.geom as { x: number; y: number; w: number; h: number; rot: number };
        replace(
          elements.map((x) =>
            x.id === selectedId ? { ...x, geom: { ...g, rot: (((g.rot + 90) % 360) + 360) % 360 } } : x
          ),
          'push'
        );
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        replace(elements.filter((x) => x.id !== selectedId), 'push');
        onSelectElement?.(null);
      } else if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const step = e.shiftKey ? 1 : grid ?? 0.25;
        const dx = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0;
        const dy = e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0;
        replace(
          elements.map((x) => (x.id === selectedId ? translateElement(x, dx, dy) : x)),
          'push'
        );
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [edit, selectedId, elements, grid, onElementsChange, onSelectElement]);

  /** Overview framing above a point — same angle as the flight, pulled back. */
  const overviewOf = (x: number, y: number): Partial<Camera3D> => {
    const span = Math.max(floorRef.current.width_m, floorRef.current.height_m);
    return { tx: x, ty: y, tz: 0, dist: Math.min(42, Math.max(14, span / 2)), pitch: FLIGHT_PITCH };
  };

  const stopFlySignal = () => {
    if (flySignal.current) flySignal.current.cancelled = true;
    flySignal.current = null;
    setFlying(false);
  };

  const arriveAt = (x: number, y: number) => {
    stopFlySignal();
    tweenSignal.current.cancelled = true;
    const signal = { cancelled: false };
    tweenSignal.current = signal;
    tweenCamera(camRef.current, overviewOf(x, y), setCam, signal);
  };

  // the fly-through: glide in → walk the route → rise to an overview of the item.
  // Only plays when the seq moves past the one already flown (the "Fly" button).
  useEffect(() => {
    if (!flythrough || flythrough.points.length < 2) return;
    if (flownSeq.current === null) {
      flownSeq.current = flythrough.seq; // first observation never auto-plays
      return;
    }
    if (flownSeq.current === flythrough.seq) return;
    flownSeq.current = flythrough.seq;
    tweenSignal.current.cancelled = true;
    stopFlySignal();
    const signal = { cancelled: false };
    flySignal.current = signal;
    setFlying(true);

    const sampler = pathSampler(flythrough.points);
    const goal = flythrough.points[flythrough.points.length - 1];
    flyGoal.current = { x: goal.x, y: goal.y };
    // G3: honor prefers-reduced-motion — glide gently to the arrival framing
    // instead of flying the path
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      signal.cancelled = true;
      const s2 = { cancelled: false };
      tweenSignal.current = s2;
      tweenCamera(camRef.current, overviewOf(goal.x, goal.y), setCam, s2);
      return () => {
        signal.cancelled = true;
        s2.cancelled = true;
      };
    }
    const flightS = sampler.total;
    const flightMs = Math.min(FLY_MAX_S, Math.max(FLY_MIN_S, flightS / FLY_SPEED)) * 1000;
    const camAtS = (s: number) =>
      camFromEyeLook(
        { x: sampler.at(s - EYE_BACK).x, y: sampler.at(s - EYE_BACK).y, z: EYE_Z },
        { x: sampler.at(s + LOOK_AHEAD).x, y: sampler.at(s + LOOK_AHEAD).y, z: LOOK_Z }
      );
    const startCam = camAtS(0);
    const from = camRef.current;
    const t0 = performance.now();

    const step = (now: number) => {
      if (signal.cancelled) return;
      const t = now - t0;
      if (t < APPROACH_MS) {
        // glide from wherever the camera is to the path's start position
        const e = easeOut(t / APPROACH_MS);
        setCam({
          yaw: lerpAngle(from.yaw, startCam.yaw, e),
          pitch: lerp(from.pitch, startCam.pitch, e),
          dist: lerp(from.dist, startCam.dist, e),
          tx: lerp(from.tx, startCam.tx, e),
          ty: lerp(from.ty, startCam.ty, e),
          tz: lerp(from.tz, startCam.tz, e),
        });
      } else if (t < APPROACH_MS + flightMs) {
        const s = ((t - APPROACH_MS) / flightMs) * flightS;
        setCam(camAtS(s));
      } else {
        setFlying(false);
        flySignal.current = null;
        const signal2 = { cancelled: false };
        tweenSignal.current = signal2;
        tweenCamera(camRef.current, overviewOf(goal.x, goal.y), setCam, signal2);
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);

    return () => {
      signal.cancelled = true;
      setFlying(false);
    };
  }, [flythrough?.seq]); // eslint-disable-line react-hooks/exhaustive-deps

  // draw on every relevant change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(size.w * dpr) || canvas.height !== Math.round(size.h * dpr)) {
      canvas.width = Math.round(size.w * dpr);
      canvas.height = Math.round(size.h * dpr);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // every stocked product is tappable in 3D, not just the focused subset —
    // one hit target per facing level so the whole stack is clickable, not a
    // single point at its top. groupOnly facings stock the shelves but are
    // never tappable; groups view keeps targets for the groups' ONE pin each
    // (groupPin) plus the focused pins.
    const focusSet = focusPinIds?.length ? new Set(focusPinIds) : null;
    const isFocusPin = (id: string) => id === focusPinId || (focusSet?.has(id) ?? false);
    const allPins = stockPins.length ? stockPins : pins;
    const hitPins = allPins.filter((p) => {
      if (isFocusPin(p.location.id)) return true;
      const flags = locationFlags(p.location);
      if (flags.groupOnly) return false;
      return showItems || flags.groupPin;
    });
    // a focused group pin floats its GROUP's title (the shelf label) — the
    // shopper lands on the group, not on one item's name
    const groupTitleOf = (loc: { meta?: string }): string | undefined => {
      try {
        const m = JSON.parse(loc.meta || '{}');
        if (typeof m.shelfId === 'string') {
          const el = elements.find((e) => e.id === m.shelfId);
          if (!el) return undefined;
          // the shelf's labelHidden hides the group's map label in 3D too
          let sm: Record<string, unknown> = {};
          try { sm = JSON.parse(el.meta || '{}'); } catch { /* no meta */ }
          if (sm.labelHidden === true) return undefined;
          return groupDisplayName(el) ?? undefined;
        }
      } catch { /* no meta */ }
      return undefined;
    };
    const pins3d: Pin3D[] = [];
    for (const p of hitPins) {
      const anchor = shelfAnchor({ x: p.location.x, y: p.location.y }, elements);
      const focused = p.location.id === focusPinId || (focusSet?.has(p.location.id) ?? false);
      const pinFlags = locationFlags(p.location);
      const base = {
        productId: p.location.product_id,
        locId: p.location.id,
        x: p.location.x,
        y: p.location.y,
        color: p.product.category_color || '#2f6f3e',
        focused,
      };
      if (!anchor) {
        pins3d.push({ ...base, label: p.location.id === focusPinId ? (pinFlags.groupPin ? groupTitleOf(p.location) ?? p.product.name : p.product.name) : undefined });
        continue;
      }
      const stand = shelfBoardZs(anchor.el);
      const itemH = shelfItemSize(anchor.el).h;
      // heavy floors: one hit target per pin (keeps hover loops + per-frame
      // projection proportionate); otherwise the whole stack is tappable
      const hitZs = heavy ? [stand[Math.floor(stand.length / 2)] ?? stand[0]!] : stand;
      hitZs.forEach((z, i) => {
        const last = i === hitZs.length - 1;
        pins3d.push({
          ...base,
          // label floats at the top of the stack only
          label: last && p.location.id === focusPinId
            ? (pinFlags.groupPin ? groupTitleOf(p.location) ?? p.product.name : p.product.name)
            : undefined,
          ax: anchor.x,
          ay: anchor.y,
          az: z + itemH / 2,
        });
      });
    }
    hitsRef.current = renderScene(ctx, size.w, size.h, cam, floor, elements, {
      bsp: sceneBSP,
      overlayFaces: routeFacesMemo,
      pins: pins3d,
      routeStart: route && route.length > 1 ? route[0] : null,
      tripStops,
      theme,
      selectedId: edit ? selectedId : null,
      hoverId: edit ? hoverPick : null,
    });
  }, [cam, size, floor, elements, pins, stockPins, showItems, focusPinId, focusPinIds, route, routeFacesMemo, sceneBSP, theme, edit, selectedId, hoverPick]);

  // middle-click autoscroll guard — pointerdown preventDefault can't stop it
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const guard = (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault();
    };
    el.addEventListener('mousedown', guard);
    return () => el.removeEventListener('mousedown', guard);
  }, []);

  // wheel zoom (non-passive so preventDefault works)
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (wheelZoom === 'ctrl' && !e.ctrlKey && !e.metaKey) return; // let the page scroll
      e.preventDefault();
      stopFlySignal();
      const c = camRef.current;
      setCam({ ...c, dist: Math.min(DIST_MAX, Math.max(DIST_MIN, c.dist * Math.exp(e.deltaY * 0.0016))) });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [wheelZoom]);

  /** Ray-pick the fixture under a screen pixel (nearest hit wins). */
  const fixtureAt = (px: number, py: number) => pickFixture(camRef.current, size.w, size.h, px, py, elements);

  const screenPx = (e: { clientX: number; clientY: number }) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    try {
      canvasRef.current?.setPointerCapture(e.pointerId);
    } catch {
      // synthetic/untracked pointer — capture is best-effort
    }
    // middle mouse: pan the camera target (preventDefault stops autoscroll via the matching mousedown guard)
    if (e.button === 1) {
      e.preventDefault();
      midPan.current = { sx: e.clientX, sy: e.clientY, tx: cam.tx, ty: cam.ty, yaw: cam.yaw };
      stopFlySignal();
      tweenSignal.current.cancelled = true;
      return;
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    stopFlySignal();
    tweenSignal.current.cancelled = true;
    setHoverAisle(null);
    setHoverShelf(null);
    if (pointers.current.size === 2) {
      const pts = [...pointers.current.values()];
      const c = camRef.current;
      pinch.current = {
        dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
        startDist: c.dist,
        cx: (pts[0].x + pts[1].x) / 2,
        cy: (pts[0].y + pts[1].y) / 2,
        tx: c.tx,
        ty: c.ty,
      };
      drag.current = null;
      elDrag.current = null;
      return;
    }
    if (edit && !locked && e.button === 0) {
      // edit mode: grabbing a fixture drags it on the floor plane; empty space
      // orbits. Select: Items hands clicks to the pins instead — fixtures
      // stop being grabbable/selectable.
      if (pickFilter === 'products') {
        drag.current = { x: e.clientX, y: e.clientY, yaw: cam.yaw, pitch: cam.pitch, moved: false };
        return;
      }
      const px = screenPx(e);
      // a tap near a product pin selects its group — even though the shelf
      // fixture behind the pin would win the raycast (the pin taps resolve on
      // release, before the fixture's click-select)
      let pinTap: string | null = null;
      let pinTapD = 14;
      for (const hit of hitsRef.current.pins) {
        const dist = Math.hypot(hit.sx - px.x, hit.sy - px.y);
        if (dist < pinTapD) {
          pinTapD = dist;
          pinTap = hit.productId;
        }
      }
      pendingPin.current = pinTap;
      const hit = fixtureAt(px.x, px.y);
        if (hit) {
        const startFloor = screenToWorldFloor(camRef.current, size.w, size.h, px.x, px.y);
        if (startFloor) {
          elDrag.current = { id: hit.elementId, startFloor, began: false, moved: false, lastDx: 0, lastDy: 0 };
          if (onSelectElement && selectedId !== hit.elementId) {
            onSelectElement(hit.elementId);
          }
          return;
        }
      }
      if (onSelectElement && selectedId) onSelectElement(null);
      drag.current = { x: e.clientX, y: e.clientY, yaw: cam.yaw, pitch: cam.pitch, moved: false };
      return;
    }
    drag.current = { x: e.clientX, y: e.clientY, yaw: cam.yaw, pitch: cam.pitch, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // middle-mouse pan runs regardless of pointer bookkeeping
    const mp = midPan.current;
    if (mp) {
      const dxs = e.clientX - mp.sx;
      const dys = e.clientY - mp.sy;
      const k = camRef.current.dist * 0.0016;
      const rx = Math.cos(mp.yaw);
      const ry = -Math.sin(mp.yaw);
      const ux = Math.sin(mp.yaw);
      const uy = Math.cos(mp.yaw);
      setCam({ ...camRef.current, tx: mp.tx - (rx * dxs + ux * dys) * k, ty: mp.ty - (ry * dxs + uy * dys) * k });
      return;
    }
    if (!pointers.current.has(e.pointerId)) {
      // hover (no buttons): aisle symbol tooltip in viewer, move-cursor in edit
      if (pointers.current.size === 0 && !drag.current && !elDrag.current && !flying) {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (rect) {
          const px = e.clientX - rect.left;
          const py = e.clientY - rect.top;
          let best: AisleHit | null = null;
          let bestD = 16;
          for (const hit of hitsRef.current.aisles) {
            const d = Math.hypot(hit.sx - px, hit.sy - py);
            if (d < bestD) {
              bestD = d;
              best = hit;
            }
          }
          // hover picking: preview what a click would select (edit) / show the
          // shelf's contents card (viewer). Hover state only moves when the
          // picked id CHANGES — fresh objects per mousemove would re-run the
          // draw effect (hoverPick) or re-render for nothing. The pick tip's
          // position tracks the cursor via a separate cheap state the draw
          // effect doesn't depend on.
          // product facings are hoverable in the viewer — the hovered stack
          // lifts (see stockFaces) and a click selects it
          let pinHit: PinHit | null = null;
          let pinD = 14;
          for (const hit of hitsRef.current.pins) {
            const d = Math.hypot(hit.sx - px, hit.sy - py);
            if (d < pinD) {
              pinD = d;
              pinHit = hit;
            }
          }
          setHoverPinLocId((prev) => {
            const id = !edit && pinHit ? pinHit.locId ?? null : null;
            return prev === id ? prev : id;
          });
          const pick = edit || (onElementClick && !pinHit) ? fixtureAt(px, py) : null;
          setHoverAisle((prev) => {
            const id = best && !pick && !pinHit ? best.elementId : null;
            return prev?.id === id ? prev : id ? { id, sx: best!.sx, sy: best!.sy } : null;
          });
          const pickedId = edit && pick ? pick.elementId : null;
          setHoverPick((prev) => (prev === pickedId ? prev : pickedId));
          setPickTipAt(pickedId ? { sx: px, sy: py } : null);
          setHoverShelf((prev) => {
            const id = !edit && pick ? pick.elementId : null;
            if (!id) return prev?.id === id ? prev : null;
            // the hover card reflects the hovered FACE, not the whole shelf:
            // project the cursor onto the floor and ask the shelf which side
            const el = elements.find((x) => x.id === id);
            const wpt = el && el.type === 'shelf'
              ? screenToWorldFloor(camRef.current, size.w, size.h, px, py)
              : null;
            const side = el && el.type === 'shelf' && wpt
              ? shelfSideOf(el, wpt) ?? 'front'
              : 'front';
            return prev?.id === id && prev?.side === side ? prev : { id, sx: px, sy: py, side };
          });
        }
      }
      return;
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size === 2) {
      // two fingers: pinch zooms, and the fingers' centroid pans the camera
      // target sideways/forwards (screen right → world right per yaw)
      const pts = [...pointers.current.values()];
      const p = pinch.current;
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const cx = (pts[0].x + pts[1].x) / 2;
      const cy = (pts[0].y + pts[1].y) / 2;
      let next = { ...camRef.current };
      if (p.dist > 0) {
        next.dist = Math.min(DIST_MAX, Math.max(DIST_MIN, (p.startDist * d) / p.dist));
      }
      const dx = cx - p.cx;
      const dy = cy - p.cy;
      const k = next.dist * 0.0016; // metres per screen pixel, scales with zoom
      const rx = Math.cos(next.yaw);
      const ry = -Math.sin(next.yaw); // screen-right on the ground
      const ux = Math.sin(next.yaw);
      const uy = Math.cos(next.yaw); // screen-up on the ground
      next = {
        ...next,
        tx: p.tx - (rx * dx + ux * dy) * k,
        ty: p.ty - (ry * dx + uy * dy) * k,
      };
      setCam(next);
      return;
    }
    const d = drag.current;
    if (!d) {
      // live element drag: project the pointer to the floor plane and report
      // the snapped world delta from the grab point
      const ed = elDrag.current;
      if (ed && onElementDrag) {
        const px = screenPx(e);
        const floorNow = screenToWorldFloor(camRef.current, size.w, size.h, px.x, px.y);
        if (!floorNow) return;
        const rawDx = floorNow.x - ed.startFloor.x;
        const rawDy = floorNow.y - ed.startFloor.y;
        const g = grid ?? 0.25;
        const dx = snap(ed.startFloor.x + rawDx, g) - ed.startFloor.x;
        const dy = snap(ed.startFloor.y + rawDy, g) - ed.startFloor.y;
        if (dx === ed.lastDx && dy === ed.lastDy) return;
        if (Math.abs(dx) + Math.abs(dy) > 0) ed.moved = true;
        onElementDrag(ed.id, dx, dy, ed.began ? 'live' : 'begin');
        ed.began = true;
        ed.lastDx = dx;
        ed.lastDy = dy;
      }
      return;
    }
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
    setCam({
      ...camRef.current,
      yaw: d.yaw + dx * 0.005,
      pitch: Math.min(PITCH_MAX, Math.max(PITCH_MIN, d.pitch + dy * 0.005)),
    });
  };

  const endPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button === 1) midPan.current = null;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    // finish an element drag
    const ed = elDrag.current;
    if (ed) {
      elDrag.current = null;
      if (ed.moved) {
        pendingPin.current = null; // a real drag — not a pin tap
        // final position already sent as the last 'live'; commit history entry
        onElementDrag?.(ed.id, ed.lastDx ?? 0, ed.lastDy ?? 0, 'push');
      } else if (pendingPin.current) {
        // the gesture began on a pin over this fixture and never moved — the
        // group panel wins over the fixture's click-select
        onPinClick?.(pendingPin.current);
        pendingPin.current = null;
        return;
      } else if (onSelectElement) {
        onSelectElement(ed.id); // a click selects (already selected above — keep for safety)
      }
      return;
    }
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved) return;
    // tap → nearest pin within 18 px, else a fixture (viewer: shelf layout)
    const rect = canvasRef.current!.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    let best: PinHit | null = null;
    let bestD = 18;
    for (const hit of hitsRef.current.pins) {
      const dist = Math.hypot(hit.sx - px, hit.sy - py);
      if (dist < bestD) {
        bestD = dist;
        best = hit;
      }
    }
    if (best) {
      onPinClick?.(best.productId);
      return;
    }
    if (onElementClick) {
      const hit = fixtureAt(px, py);
      if (hit) {
        const el = elements.find((x) => x.id === hit.elementId);
        if (el) onElementClick(el);
      }
    }
  };

  const hoverAisleEl = hoverAisle ? elements.find((el) => el.id === hoverAisle.id) ?? null : null;
  const hoverContents = useMemo(
    () => (hoverAisleEl ? aisleContents(hoverAisleEl, stockPins) : null),
    [hoverAisleEl, stockPins]
  );
  const hoverShelfEl = hoverShelf ? elements.find((el) => el.id === hoverShelf.id) ?? null : null;
  const hoverShelfContents = useMemo(
    () =>
      hoverShelfEl?.type === 'shelf'
        ? shelfContents(hoverShelfEl, stockPins, SHELF_TOL_M, hoverShelf?.side)
        : hoverShelfEl?.type === 'aisle'
          ? aisleContents(hoverShelfEl, stockPins)
          : null,
    [hoverShelfEl, stockPins, hoverShelf?.side]
  );

  return (
    <>
      <canvas
        ref={canvasRef}
        onContextMenu={(e) => e.preventDefault()}
        style={{
          width: '100%', height: '100%', display: 'block', touchAction,
          cursor: drag.current || elDrag.current || midPan.current ? 'grabbing' : hoverPick && edit ? 'move' : (!edit && hoverPinLocId) || (hoverShelf && onElementClick) || hoverAisle ? 'pointer' : 'grab',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onPointerLeave={() => {
          setHoverAisle(null);
          setHoverPinLocId(null);
          setHoverPick(null);
          setPickTipAt(null);
          setHoverShelf(null);
        }}
        aria-label="3D store map"
      />
      {hoverPick && edit && (() => {
        const el = elements.find((x) => x.id === hoverPick);
        if (!el || el.id === selectedId) return null;
        return (
          <div className="pick-tip" style={{ left: pickTipAt?.sx, top: pickTipAt?.sy }}>
            {el.label || el.type}
          </div>
        );
      })()}
      {hoverAisle && hoverAisleEl && (
        <AisleTooltip
          style={{ left: hoverAisle.sx, top: hoverAisle.sy }}
          label={hoverAisleEl.label || 'Aisle'}
          contents={hoverContents}
        />
      )}
      {hoverShelf && (hoverShelfEl?.type === 'shelf' || hoverShelfEl?.type === 'aisle') && (
        <AisleTooltip
          style={{ left: hoverShelf.sx, top: hoverShelf.sy }}
          label={`${hoverShelfEl.label || 'Shelf'}${hoverShelfEl.type === 'shelf' ? ` · ${hoverShelf?.side === 'back' ? 'Side B' : 'Side A'}` : ''}`}
          contents={hoverShelfContents}
          kind={hoverShelfEl.type === 'aisle' ? 'aisle' : 'shelf'}
        />
      )}
      {flying && (
        <button className="fly-skip" onClick={() => arriveAt(flyGoal.current.x, flyGoal.current.y)}>
          Skip flight ✕
        </button>
      )}
    </>
  );
}

/** Shared hover card (3D canvas + 2D SVG both render it): what's in an aisle
 *  or on a shelf — categories, a taste of the actual products, and a hint. */
export function AisleTooltip({
  style,
  label,
  contents,
  kind = 'aisle',
}: {
  style: React.CSSProperties;
  label: string;
  contents: { categories: { name: string; color: string; count: number }[]; count: number; examples: string[] } | null;
  kind?: 'aisle' | 'shelf';
}) {
  const empty = kind === 'shelf' ? 'No pinned products on this shelf yet' : 'No pinned products along this aisle yet';
  return (
    <div className="aisle-tip" style={style} role="tooltip">
      <b>{label}</b>
      {contents && contents.count > 0 ? (
        <>
          <div className="aisle-tip-cats">
            {contents.categories.slice(0, 4).map((c) => (
              <span key={c.name} className="aisle-tip-cat">
                <span className="dot" style={{ background: c.color }} />
                {c.name} · {c.count}
              </span>
            ))}
          </div>
          {contents.examples.length > 0 && (
            <span className="aisle-tip-ex">{contents.examples.slice(0, 3).join(' · ')}</span>
          )}
          <span className="aisle-tip-count">
            {kind === 'shelf'
              ? `Tap for all ${contents.count} item${contents.count === 1 ? '' : 's'}`
              : `${contents.count} item${contents.count === 1 ? '' : 's'} within ${AISLE_REACH_M} m`}
          </span>
        </>
      ) : (
        <span className="aisle-tip-count">{empty}</span>
      )}
    </div>
  );
}
