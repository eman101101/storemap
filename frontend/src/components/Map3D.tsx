import { useEffect, useMemo, useRef, useState } from 'react';
import type { Floor, MapElement } from '../types';
import {
  buildSceneBSP, buildSceneFaces, buildContactShadows, camFromEyeLook, fitCamera, pathSampler,
  renderScene, screenToWorldFloor, pickFixture, shade, routeFaces, stockFaces, MODERN_THEME,
  type Camera3D, type Face, type MapTheme, type Pin3D, type PinHit, type AisleHit, type StockItem,
} from '../lib/render3d';
import { snap, elementPoints, shelfAnchor, translateElement, type WorldPt } from '../lib/geometry';
import { aisleContents, AISLE_REACH_M } from '../lib/aisleInfo';

export interface Pin {
  location: { id: string; x: number; y: number; product_id: string };
  product: { name: string; category_name?: string | null; category_color?: string | null };
}

interface Props {
  floor: Floor;
  elements: MapElement[];
  pins: Pin[];
  focusPinId?: string | null;
  route?: WorldPt[] | null;
  /** When set (seq changes), the camera flies the route from its start to the item. */
  flythrough?: { points: WorldPt[]; seq: number } | null;
  onPinClick?: (productId: string) => void;
  /** All pins on the floor — drives the visual product blocks on the shelf faces. */
  stockPins?: Pin[];
  /** Multi-stop trip: numbered markers at each ordered stop (A1). */
  tripStops?: { productId: string; name: string; point: WorldPt }[];
  /** Camera lives in the parent so toggling 2D↔3D doesn't reset the angle. */
  camera: Camera3D | null;
  onCamera: (c: Camera3D) => void;
  /** Visual theme for the scene — defaults to modern; RETRO_THEME is the 2010s look. */
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
}

const PITCH_MIN = 0.18;
const PITCH_MAX = 1.45;
const DIST_MIN = 3;
const DIST_MAX = 160;

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

export default function Map3D({ floor, elements, pins, focusPinId, route, flythrough, onPinClick, stockPins = [], camera, onCamera, tripStops, theme = MODERN_THEME, onElementClick, edit = false, grid = 0.25, selectedId, onSelectElement, onElementDrag, onElementsChange, focusElement, fitSignal = 0 }: Props) {
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
  const [hoverAisle, setHoverAisle] = useState<{ id: string; sx: number; sy: number } | null>(null);
  /** Hover pick preview (edit mode): what a click would select, and where. */
  const [hoverPick, setHoverPick] = useState<{ id: string; sx: number; sy: number } | null>(null);
  /** Viewer: pointer is over a tappable shelf. */
  const [hoverShelf, setHoverShelf] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number; moved: boolean } | null>(null);
  const pinch = useRef<{ dist: number; startDist: number; cx: number; cy: number; tx: number; ty: number } | null>(null);
  // 3D edit drag: which fixture, where the pointer grabbed the floor plane
  const elDrag = useRef<{ id: string; startFloor: WorldPt; began: boolean; moved: boolean; lastDx: number; lastDy: number } | null>(null);
  const camRef = useRef(cam);
  camRef.current = cam;
  const floorRef = useRef(floor);
  floorRef.current = floor;

  // visual product blocks on the shelf faces, from every pinned item on this floor
  const stocking = useMemo<StockItem[]>(
    () =>
      stockPins
        .map((p) => {
          const a = shelfAnchor({ x: p.location.x, y: p.location.y }, elements);
          if (!a) return null;
          return {
            x: a.x,
            y: a.y,
            nx: a.nx,
            ny: a.ny,
            color: shade(p.product.category_color || '#2f6f3e', 0.88 + (((p.location.x * 7 + p.location.y * 13) % 5) * 0.06)),
          };
        })
        .filter((s): s is StockItem => s !== null),
    [stockPins, elements]
  );

  // static geometry only depends on the floor + elements — build it once, not per frame
  const sceneFaces = useMemo<Face[]>(() => buildSceneFaces(floor, elements, theme), [floor, elements, theme]);

  // one BSP per draw layer over the whole scene: exact back-to-front order for
  // any camera angle. Rebuilt only when the data changes, never per frame.
  const bspInput = useMemo(() => {
    const faces = [...sceneFaces, ...stockFaces(stocking, theme)];
    if (theme.retro) faces.push(...buildContactShadows(elements, theme));
    if (route && route.length > 1) faces.push(...routeFaces(route, theme));
    return faces;
  }, [sceneFaces, stocking, route, theme, elements]);
  const bspFaceCount = bspInput.length;
  const sceneBSP = useMemo(() => buildSceneBSP(bspInput), [bspInput]); // E2 note: >3K faces would move to an idle-callback build; current scenes peak ~2K
  void bspFaceCount;

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
    const pins3d: Pin3D[] = pins.map((p) => {
      const anchor = shelfAnchor({ x: p.location.x, y: p.location.y }, elements);
      return {
        productId: p.location.product_id,
        x: p.location.x,
        y: p.location.y,
        color: p.product.category_color || '#2f6f3e',
        label: p.location.id === focusPinId ? p.product.name : undefined,
        focused: p.location.id === focusPinId,
        ax: anchor?.x,
        ay: anchor?.y,
      };
    });
    hitsRef.current = renderScene(ctx, size.w, size.h, cam, floor, elements, {
      bsp: sceneBSP,
      route,
      pins: pins3d,
      routeStart: route && route.length > 1 ? route[0] : null,
      tripStops,
      theme,
      selectedId: edit ? selectedId : null,
      hoverId: edit ? hoverPick?.id ?? null : null,
    });
  }, [cam, size, floor, elements, pins, focusPinId, route, sceneBSP, theme, edit, selectedId, hoverPick]);

  // wheel zoom (non-passive so preventDefault works)
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      stopFlySignal();
      const c = camRef.current;
      setCam({ ...c, dist: Math.min(DIST_MAX, Math.max(DIST_MIN, c.dist * Math.exp(e.deltaY * 0.0016))) });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

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
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    stopFlySignal();
    tweenSignal.current.cancelled = true;
    setHoverAisle(null);
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
    if (edit && e.button === 0) {
      // edit mode: grabbing a fixture drags it on the floor plane; empty space orbits
      const px = screenPx(e);
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
          setHoverAisle(best ? { id: best.elementId, sx: best.sx, sy: best.sy } : null);
          // hover picking: preview what a click would select (edit) / show
          // the pointer cursor over tappable shelves (viewer)
          const pick = edit || onElementClick ? fixtureAt(px, py) : null;
          setHoverPick(edit && pick ? { id: pick.elementId, sx: px, sy: py } : null);
          setHoverShelf(Boolean(pick));
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
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    // finish an element drag
    const ed = elDrag.current;
    if (ed) {
      elDrag.current = null;
      if (ed.moved) {
        // final position already sent as the last 'live'; commit history entry
        onElementDrag?.(ed.id, ed.lastDx ?? 0, ed.lastDy ?? 0, 'push');
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

  return (
    <>
      <canvas
        ref={canvasRef}
        style={{
          width: '100%', height: '100%', display: 'block', touchAction: 'none',
          cursor: drag.current || elDrag.current ? 'grabbing' : hoverPick && edit ? 'move' : hoverShelf && onElementClick ? 'pointer' : hoverAisle ? 'pointer' : 'grab',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onPointerLeave={() => {
          setHoverAisle(null);
          setHoverPick(null);
          setHoverShelf(false);
        }}
        aria-label="3D store map"
      />
      {hoverPick && edit && (() => {
        const el = elements.find((x) => x.id === hoverPick.id);
        if (!el || el.id === selectedId) return null;
        return (
          <div className="pick-tip" style={{ left: hoverPick.sx, top: hoverPick.sy }}>
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
      {flying && (
        <button className="fly-skip" onClick={() => arriveAt(flyGoal.current.x, flyGoal.current.y)}>
          Skip flight ✕
        </button>
      )}
    </>
  );
}

/** Shared aisle hover card (3D canvas + 2D SVG both render it). */
export function AisleTooltip({
  style,
  label,
  contents,
}: {
  style: React.CSSProperties;
  label: string;
  contents: { categories: { name: string; color: string; count: number }[]; count: number; examples: string[] } | null;
}) {
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
          <span className="aisle-tip-count">
            {contents.count} item{contents.count === 1 ? '' : 's'} within {AISLE_REACH_M} m
          </span>
        </>
      ) : (
        <span className="aisle-tip-count">No pinned products along this aisle yet</span>
      )}
    </div>
  );
}
