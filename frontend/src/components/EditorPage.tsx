import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { api } from '../api';
import { LocalSession, type EditorApi } from '../localStore';
import MapCanvas, { TOOL_DEF, TYPE_COLOR, type EditorTool } from './MapCanvas';
import Map3D from './Map3D';
import ShelfDetail from './ShelfDetail';
import type {
  Category, Floor, MapElement, Product, ProductLocation, RectGeom, Store,
} from '../types';
import { elementToRow, parseElement } from '../types';
import { bboxOf, elementPoints, translateElement, type Viewport, type WorldPt } from '../lib/geometry';
import { fitCamera, MODERN_THEME, DARK_THEME, DIST_MIN, DIST_MAX, type Camera3D } from '../lib/render3d';
import { useTheme } from '../theme';
import { CameraPad, Field, Modal, ZoomPad } from './ui';
import { removeBackground } from '../lib/imageBg';

/**
 * The editor's data source. On the dashboard it's the real api; in the
 * no-account sandbox (/try/:slug) TryEditor provides a LocalSession, and this
 * context carries it down to every panel below without touching call sites.
 */
const EditorApiContext = createContext<EditorApi>(api);
const useEditorApi = () => useContext(EditorApiContext);

const TOOLS: { id: EditorTool; label: string; icon: string; group?: string }[] = [
  { id: 'select', label: 'Select', icon: '⬚' },
  { id: 'shelf', label: 'Shelf', icon: '▬', group: 'draw' },
  { id: 'aisle-pair', label: 'Aisle pair', icon: '☰', group: 'draw' },
  { id: 'wall', label: 'Wall', icon: '▥', group: 'draw' },
  { id: 'zone', label: 'Zone', icon: '▣', group: 'mark' },
  { id: 'zone-poly', label: 'Zone (poly)', icon: '⬟', group: 'mark' },
  { id: 'aisle', label: 'Label', icon: '🏷', group: 'mark' },
  { id: 'entrance', label: 'Entrance', icon: '⬆', group: 'point' },
  { id: 'exit', label: 'Exit', icon: '⬇', group: 'point' },
  { id: 'poi', label: 'Point', icon: '★', group: 'point' },
  { id: 'product', label: 'Product pin', icon: '📍', group: 'point' },
];

const TOOL_HINTS: Partial<Record<EditorTool, string>> = {
  select: 'Drag to move · drag handles to resize/rotate · arrow keys nudge · drag empty space to pan',
  shelf: 'Drag to draw a shelf rectangle (or click for a default size)',
  'aisle-pair': 'Drag one shelf row — a facing row appears 1.5 m across the aisle',
  wall: 'Drag to draw a wall segment',
  'wall-line': 'Click to add wall vertices · hold Shift for straight runs · Enter to finish',
  aisle: 'Click to place a labelled aisle zone · drag to size it · reshape with the handles or the panel',
  zone: 'Drag to draw a zone rectangle',
  'zone-poly': 'Click to add zone vertices · hold Shift for straight runs · Enter to finish',
  entrance: 'Click to place the entrance marker',
  exit: 'Click to place the exit marker',
  poi: 'Click to place a point of interest',
  product: 'Click a spot on the map to pin the selected product · Esc to cancel',
};

type SideTab = 'map' | 'products' | 'store' | 'history';
type SaveState = 'saved' | 'saving' | 'dirty' | 'error';
/** Undo/redo stacks are capped — an editing session can't grow them forever. */
const HISTORY_CAP = 100;

export default function EditorPage({ tryMode = false, session }: { tryMode?: boolean; session?: LocalSession } = {}) {
  const { storeId } = useParams<{ storeId: string }>();
  const navigate = useNavigate();
  const apix = session ?? useContext(EditorApiContext);

  const [store, setStore] = useState<Store | null>(null);
  const [floors, setFloors] = useState<Floor[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [locations, setLocations] = useState<ProductLocation[]>([]);
  const [elements, setElements] = useState<MapElement[]>([]);

  const [activeFloorId, setActiveFloorId] = useState<string>('');
  const [tool, setTool] = useState<EditorTool>('select');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftPts, setDraftPts] = useState<WorldPt[]>([]);
  const [viewport, setViewport] = useState<Viewport>({ scale: 20, tx: 0, ty: 0 });
  const [fitSignal, setFitSignal] = useState(0);
  const [zoomCmd, setZoomCmd] = useState({ k: 1, seq: 0 });
  const [sideTab, setSideTab] = useState<SideTab>('map');
  const [pickFilter, setPickFilter] = useState<'all' | 'products'>('all');
  // the side panel is a pull-out drawer over the map (desktop); remembered per device
  const [sideOpen, setSideOpen] = useState(() => {
    try {
      return localStorage.getItem('storemap.side') === 'open';
    } catch {
      return false;
    }
  });
  const switchSide = (open: boolean) => {
    setSideOpen(open);
    try {
      localStorage.setItem('storemap.side', open ? 'open' : 'closed');
    } catch { /* private mode */ }
  };
  /** map interactions that need details pull the drawer out automatically */
  const showTab = (t: SideTab) => {
    setSideTab(t);
    setSideOpen(true);
  };
  const [flashProductId, setFlashProductId] = useState<string | null>(null);
  const [placeProductId, setPlaceProductId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [loadError, setLoadError] = useState('');
  // 3D edit view: same elements/selection/undo pipeline, different viewport
  const [view3d, setView3d] = useState(() => {
    try {
      return localStorage.getItem('storemap.editorView') === '3d';
    } catch {
      return false;
    }
  });
  const [cam3d, setCam3d] = useState<Camera3D | null>(null);
  const [focus3d, setFocus3d] = useState<{ id: string; seq: number } | null>(null);
  const [showControls, setShowControls] = useState(false);
  const dragOrig3d = useRef<MapElement | null>(null);
  // gesture-start snapshot: containment for pin-follow is evaluated against
  // where the shelf was when the gesture BEGAN, so a shelf dragged across other
  // shelves can't Hoover up their products
  const pinGestureBase = useRef<MapElement[] | null>(null);
  const pinSaveTimer = useRef<number | null>(null);
  const pendingPinSaves = useRef<{ productId: string; x: number; y: number; floorId: string; shelfId?: string }[]>([]);
  const { resolved } = useTheme();
  const sceneTheme = resolved === 'dark' ? DARK_THEME : MODERN_THEME;
  const [shelfPreviewId, setShelfPreviewId] = useState<string | null>(null);
  // shelves mid-gesture: their owned pins hide while the shelf moves and
  // reappear (re-homed) when the gesture ends — no pins floating mid-drag
  const [movingShelfIds, setMovingShelfIds] = useState<Set<string>>(new Set());

  // Pin→shelf association: a pin belongs to the shelf the USER put it on
  // (derived once at load, re-stamped only by explicit pin placement/drag).
  // Shelf moves follow owned pins and can NEVER change membership.
  const shelfOwner = useRef<Map<string, string | null>>(new Map());
  const ownerOf = (loc: ProductLocation) => shelfOwner.current.get(loc.id) ?? null;
  const stampOwner = (locationId: string, shelfId: string | null) =>
    shelfOwner.current.set(locationId, shelfId);
  /** Which rect shelf contains this point (rotation aware, small tolerance)? */
  const shelfIdAtPoint = useCallback(
    (pt: WorldPt, els: MapElement[]): string | null => {
      let best: string | null = null;
      let bestD = Infinity;
      for (const el of els) {
        if (el.type !== 'shelf' || el.shape !== 'rect') continue;
        const r = el.geom as RectGeom;
        const cx = r.x + r.w / 2;
        const cy = r.y + r.h / 2;
        const a = (-r.rot * Math.PI) / 180;
        const lx = r.w / 2 + (pt.x - cx) * Math.cos(a) - (pt.y - cy) * Math.sin(a);
        const ly = r.h / 2 + (pt.x - cx) * Math.sin(a) + (pt.y - cy) * Math.cos(a);
        if (lx < -0.25 || lx > r.w + 0.25 || ly < -0.25 || ly > r.h + 0.25) continue;
        const d = Math.max(-Math.min(lx, r.w - lx), -Math.min(ly, r.h - ly), 0);
        if (d < bestD) {
          bestD = d;
          best = el.id;
        }
      }
      return best;
    },
    []
  );
  /** Derive owners for the given locations: the persisted association (the
   *  user's own pinning — top-level `shelfId`, falling back to `meta.shelfId`)
   *  wins; only gaps fall back to where the pin sits. */
  const deriveOwners = useCallback((locs: ProductLocation[], els: MapElement[]) => {
    const byFloor = new Map<string, MapElement[]>();
    const ids = new Set(els.map((e) => e.id));
    for (const el of els) {
      const list = byFloor.get(el.floor_id) ?? [];
      list.push(el);
      byFloor.set(el.floor_id, list);
    }
    for (const l of locs) {
      let stamped: string | null =
        typeof l.shelfId === 'string' && ids.has(l.shelfId) ? l.shelfId : null;
      if (!stamped) {
        try {
          const m = JSON.parse(l.meta || '{}');
          stamped = typeof m.shelfId === 'string' && ids.has(m.shelfId) ? m.shelfId : null;
        } catch { /* no meta */ }
      }
      shelfOwner.current.set(l.id, stamped ?? shelfIdAtPoint({ x: l.x, y: l.y }, byFloor.get(l.floor_id) ?? []));
    }
  }, [shelfIdAtPoint]);

  const history = useRef<{
    past: { els: MapElement[]; pins: ProductLocation[]; label: string }[];
    future: { els: MapElement[]; pins: ProductLocation[]; label: string }[];
  }>({
    past: [],
    future: [],
  });
  const [historyLen, setHistoryLen] = useState({ past: 0, future: 0 });
  const [undoLabel, setUndoLabel] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bgOpacity, setBgOpacity] = useState(0.95);
  const [pinQueue, setPinQueue] = useState<string[]>([]);
  const dirtyRef = useRef(false);

  // ---- load ----
  useEffect(() => {
    const load = session ? session.storeFull() : storeId ? api.storeFull(storeId) : null;
    if (!load) return;
    load
      .then((data) => {
        setStore(data.store);
        setFloors(data.floors);
        setCategories(data.categories);
        setProducts(data.products);
        setLocations(data.locations);
        setElements(data.elements.map(parseElement));
        setActiveFloorId(data.floors[0]?.id ?? '');
        deriveOwners(data.locations, data.elements.map(parseElement));
      })
      .catch((e) => setLoadError(e.message || 'Failed to load store'));
  }, [storeId, session]);

  const floor = floors.find((f) => f.id === activeFloorId) ?? floors[0] ?? null;
  const floorElements = useMemo(() => elements.filter((e) => e.floor_id === floor?.id), [elements, floor?.id]);
  const pins = useMemo(
    () =>
      locations
        .map((location) => {
          const product = products.find((p) => p.id === location.product_id);
          return product ? { location, product } : null;
        })
        .filter(Boolean) as { location: ProductLocation; product: Product }[],
    [locations, products]
  );
  // pins the map renders: owned pins of a shelf mid-gesture are hidden until
  // the move settles (they jump with the shelf at release)
  const visibleFloorPins = useMemo(
    () =>
      movingShelfIds.size
        ? pins.filter((p) => p.location.floor_id === floor?.id && !movingShelfIds.has(ownerOf(p.location) ?? ''))
        : pins.filter((p) => p.location.floor_id === floor?.id),
    [pins, floor?.id, movingShelfIds, /* ownerOf is a stable ref reader */]
  );


  /** Owner shelf id persisted on a location — top-level `shelfId` first, then
   *  `meta.shelfId` (falls back to the live map). */
  const metaOwnerOf = useCallback((l: ProductLocation): string | null => {
    if (typeof l.shelfId === 'string') return l.shelfId;
    try {
      const m = JSON.parse(l.meta || '{}');
      return typeof m.shelfId === 'string' ? m.shelfId : null;
    } catch {
      return ownerOf(l);
    }
  }, []);

  /** Queue pin-position saves (debounced, mirroring the elements autosave). */
  const schedulePinSaves = useCallback(
    (saves: { productId: string; x: number; y: number; floorId: string; shelfId?: string }[]) => {
      if (!saves.length) return;
      pendingPinSaves.current = [
        ...pendingPinSaves.current.filter((s) => !saves.some((n) => n.productId === s.productId)),
        ...saves,
      ];
      if (pinSaveTimer.current) window.clearTimeout(pinSaveTimer.current);
      pinSaveTimer.current = window.setTimeout(() => {
        for (const s of pendingPinSaves.current) {
          apix.setProductLocation(s.productId, { floor_id: s.floorId, x: s.x, y: s.y, shelfId: s.shelfId })
            .catch(() => { /* keep the optimistic position */ });
        }
        pendingPinSaves.current = [];
      }, 700);
    },
    []
  );

  // ---- element mutations + history ----
  const changeElements = useCallback(
    (nextFloorEls: MapElement[], mode: 'begin' | 'live' | 'push', label = 'edit') => {
      if (!floor) return;
      // gesture-start snapshot: while a drag streams 'live' frames the shelf
      // moves ALONE — pins are re-homed exactly once, when the gesture ends
      // ('push'), against the shelf's footprint at the gesture start. Moving
      // them per frame left pins behind: after the first frame they sat
      // outside the starting footprint and stopped following.
      if (mode === 'begin' && pinGestureBase.current === null) pinGestureBase.current = elements;
      const base = pinGestureBase.current;
      if (mode === 'push') {
        setMovingShelfIds(new Set());
      } else if (base) {
        const baseById = new Map(base.map((e) => [e.id, e]));
        const changed = new Set<string>();
        for (const el of nextFloorEls) {
          const b = baseById.get(el.id);
          if (!b || el.type !== 'shelf') continue;
          const bg = b.geom as RectGeom;
          const ng = el.geom as RectGeom;
          if (
            bg.x !== ng.x || bg.y !== ng.y || bg.w !== ng.w || bg.h !== ng.h ||
            (bg.rot ?? 0) !== (ng.rot ?? 0)
          ) {
            changed.add(el.id);
          }
        }
        setMovingShelfIds(changed);
      }
      const pinFollows: { location: ProductLocation; x: number; y: number }[] = [];
      if (mode === 'push') {
        // no gesture (delete/add/panel edit): "before" is the current state
        const baseEls = base ?? elements;
        const baseById = new Map(baseEls.map((e) => [e.id, e]));
        for (const el of nextFloorEls) {
          const start = baseById.get(el.id);
          if (!start || start.type !== 'shelf' || el.type !== 'shelf') continue;
          if (start.shape !== 'rect' || el.shape !== 'rect') continue;
          const bg = start.geom as RectGeom;
          const ng = el.geom as RectGeom;
          const dxT = ng.x - bg.x;
          const dyT = ng.y - bg.y;
          const dRot = (ng.rot ?? 0) - (bg.rot ?? 0);
          if (!dxT && !dyT && !dRot) continue;
          const bcx = bg.x + bg.w / 2;
          const bcy = bg.y + bg.h / 2;
          const ncx = ng.x + ng.w / 2;
          const ncy = ng.y + ng.h / 2;
          const a = (dRot * Math.PI) / 180;
          const cos = Math.cos(a);
          const sin = Math.sin(a);
          for (const loc of locations) {
            if (loc.floor_id !== floor.id) continue;
            // OWNED pins only — the ones the user put on this shelf. No
            // geometric containment: a shelf can never pick up (or drop)
            // items just by being moved around.
            if (ownerOf(loc) !== el.id) continue;
            const lx = loc.x - bcx;
            const ly = loc.y - bcy;
            // total gesture transform: rotate about the start center, then shift
            const nx = ncx + lx * cos - ly * sin;
            const ny = ncy + lx * sin + ly * cos;
            pinFollows.push({ location: loc, x: Math.round(nx * 100) / 100, y: Math.round(ny * 100) / 100 });
          }
        }
      }
      const before = (base ?? elements).filter((e) => e.floor_id === floor.id);
      if (mode === 'push') {
        // one history entry per gesture, captured from its start (pins included,
        // so undoing a shelf move brings its products back with it)
        history.current.past.push({ els: before, pins: locations, label });
        if (history.current.past.length > HISTORY_CAP) history.current.past.shift();
        if (tryMode) session?.logAction(label);
        history.current.future = [];
        setHistoryLen({ past: history.current.past.length, future: 0 });
        setUndoLabel(label);
        // the gesture is settled — the next push starts from a fresh baseline
        pinGestureBase.current = null;
      }
      const others = elements.filter((e) => e.floor_id !== floor.id);
      setElements([...others, ...nextFloorEls]);
      if (pinFollows.length) {
        const movedIds = new Set(pinFollows.map((f) => f.location.id));
        const posById = new Map(pinFollows.map((f) => [f.location.id, f]));
        setLocations((prev) => prev.map((l) => (movedIds.has(l.id) ? { ...l, x: posById.get(l.id)!.x, y: posById.get(l.id)!.y } : l)));
        schedulePinSaves(
          pinFollows.map((f) => ({
            productId: f.location.product_id,
            x: f.x,
            y: f.y,
            floorId: floor.id,
            shelfId: ownerOf(f.location) ?? undefined,
          }))
        );
      }
      dirtyRef.current = true;
      setSaveState('dirty');
    },
    [elements, floor, locations, schedulePinSaves]
  );

  // 3D drag: deltas are relative to the drag start, applied to the element as
  // it was when the gesture began (same contract as MapCanvas's move gesture).
  // changeElements expects ONLY the current floor's elements — mapping over the
  // full multi-floor array would duplicate every other floor once per frame.
  const dragElement3d = useCallback(
    (id: string, dx: number, dy: number, phase: 'begin' | 'live' | 'push') => {
      if (phase === 'begin') {
        dragOrig3d.current = floorElements.find((e) => e.id === id) ?? null;
      }
      const orig = dragOrig3d.current;
      if (!orig || orig.id !== id) return;
      changeElements(
        floorElements.map((e) => (e.id === id ? translateElement(orig, dx, dy) : e)),
        phase,
        'move'
      );
    },
    [floorElements, changeElements]
  );

  const switchView3d = useCallback((v: boolean) => {
    setView3d(v);
    if (v) setTool('select'); // drawing stays 2D-only
    try {
      localStorage.setItem('storemap.editorView', v ? '3d' : '2d');
    } catch {
      /* private mode */
    }
  }, []);

  // a selection made anywhere (outline, panel, 3D click) aims the 3D camera
  useEffect(() => {
    if (!selectedId) return;
    setFocus3d((f) => ({ id: selectedId, seq: (f?.seq ?? 0) + 1 }));
  }, [selectedId]);

  const addElement = useCallback(
    (el: MapElement) => {
      // aisle-pair tool: the drawn row gets a facing twin across a 1.5 m aisle
      if (tool === 'aisle-pair' && el.shape === 'rect') {
        const g = el.geom as RectGeom;
        const twin: MapElement = {
          ...el,
          id: crypto.randomUUID(),
          geom: { ...g, y: g.y + g.h + 1.5 },
          z_index: el.z_index + 1,
        };
        changeElements([...floorElements, el, twin], 'push');
        setTool('select');
        setSelectedId(el.id);
        return;
      }
      changeElements([...floorElements, el], 'push');
    },
    [changeElements, floorElements, tool]
  );

  const undo = useCallback(() => {
    const h = history.current;
    const entry = h.past.pop();
    if (!entry || !floor) return;
    const prev = entry.els;
    h.future.push({ els: floorElements, pins: locations, label: entry.label });
    if (h.future.length > HISTORY_CAP) h.future.shift();
    setUndoLabel(h.past[h.past.length - 1]?.label ?? '');
    const nextEls = [...elements.filter((e) => e.floor_id !== floor.id), ...prev];
    // pins created after the gesture snapshot were never part of it — keep
    // them (they were only dropped locally, never deleted server-side)
    const snapIds = new Set(entry.pins.map((p) => p.id));
    const restored = [...entry.pins, ...locations.filter((l) => !snapIds.has(l.id))];
    setElements(nextEls);
    setLocations(restored);
    // ownership follows the restored pins — the live map still holds the
    // post-gesture owners
    deriveOwners(restored, nextEls);
    setHistoryLen({ past: h.past.length, future: h.future.length });
    // persist the restored positions (only pins that actually changed)
    const curById = new Map(locations.map((l) => [l.id, l]));
    schedulePinSaves(
      entry.pins
        .filter((pl) => {
          const cur = curById.get(pl.id);
          return !cur || Math.abs(cur.x - pl.x) > 0.001 || Math.abs(cur.y - pl.y) > 0.001;
        })
        .map((pl) => ({ productId: pl.product_id, x: pl.x, y: pl.y, floorId: pl.floor_id, shelfId: metaOwnerOf(pl) ?? undefined }))
    );
    dirtyRef.current = true;
    setSaveState('dirty');
    setSelectedId(null);
  }, [elements, floor, floorElements, locations, schedulePinSaves, deriveOwners, metaOwnerOf]);

  const redo = useCallback(() => {
    const h = history.current;
    const entry = h.future.pop();
    if (!entry || !floor) return;
    const next = entry.els;
    h.past.push({ els: floorElements, pins: locations, label: entry.label });
    if (h.past.length > HISTORY_CAP) h.past.shift();
    setUndoLabel(entry.label);
    const nextEls = [...elements.filter((e) => e.floor_id !== floor.id), ...next];
    const snapIds = new Set(entry.pins.map((p) => p.id));
    const restored = [...entry.pins, ...locations.filter((l) => !snapIds.has(l.id))];
    setElements(nextEls);
    setLocations(restored);
    deriveOwners(restored, nextEls);
    setHistoryLen({ past: h.past.length, future: h.future.length });
    const curById = new Map(locations.map((l) => [l.id, l]));
    schedulePinSaves(
      entry.pins
        .filter((pl) => {
          const cur = curById.get(pl.id);
          return !cur || Math.abs(cur.x - pl.x) > 0.001 || Math.abs(cur.y - pl.y) > 0.001;
        })
        .map((pl) => ({ productId: pl.product_id, x: pl.x, y: pl.y, floorId: pl.floor_id, shelfId: metaOwnerOf(pl) ?? undefined }))
    );
    dirtyRef.current = true;
    setSaveState('dirty');
  }, [elements, floor, floorElements, locations, schedulePinSaves, deriveOwners, metaOwnerOf]);

  // ---- autosave ----
  const saveNow = useCallback(async () => {
    if (!floor || !dirtyRef.current) return;
    setSaveState('saving');
    try {
      await apix.saveElements(floor.id, floorElements.map(elementToRow));
      dirtyRef.current = false;
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  }, [floor, floorElements]);

  useEffect(() => {
    if (saveState !== 'dirty') return;
    const t = setTimeout(() => {
      saveNow();
    }, 700);
    return () => clearTimeout(t);
  }, [saveState, elements]); // eslint-disable-line react-hooks/exhaustive-deps

  // Warn before leaving with unsaved changes (debounce usually beats navigation).
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  // Ctrl/Cmd+Z undo, Ctrl+Shift+Z redo, Escape cancels product placement.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target instanceof HTMLInputElement) || (e.target instanceof HTMLTextAreaElement) || (e.target instanceof HTMLSelectElement)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (e.key === 'Escape' && placeProductId) {
        setPlaceProductId(null);
        setTool('select');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, placeProductId]);

  /** One camera-pad tap = one smooth glide (~0.45 s). onMove arrives per frame
   *  with an eased progress chunk (sums to 1 over the tap): a pan covers ~18%
   *  of the current view, a zoom step is ×0.78 in or out. */
  const cam3dMove = (dirX: number, dirY: number, zoom: number, dt: number) => {
    if (!floor) return;
    setCam3d((c) => {
      const base = c ?? fitCamera(floor); // adopt Map3D's default view on first move
      const next = { ...base };
      if (zoom) next.dist = Math.min(DIST_MAX, Math.max(DIST_MIN, next.dist * Math.exp(-0.25 * zoom * dt)));
      if (dirX || dirY) {
        const step = next.dist * 0.18 * dt;
        const rx = Math.cos(next.yaw);
        const ry = -Math.sin(next.yaw); // screen-right on the ground
        const ux = Math.sin(next.yaw);
        const uy = Math.cos(next.yaw); // screen-up on the ground
        // up/down follow the content (map-drag feel): the target moves TOWARD the
        // viewer for ▲ so the scene itself slides up
        next.tx = next.tx + (rx * dirX - ux * dirY) * step;
        next.ty = next.ty + (ry * dirX - uy * dirY) * step;
      }
      return next;
    });
  };

  const switchFloor = async (id: string) => {
    await saveNow();
    setActiveFloorId(id);
    setSelectedId(null);
    setDraftPts([]);
    history.current = { past: [], future: [] };
    setHistoryLen({ past: 0, future: 0 });
    setFitSignal((n) => n + 1);
  };

  // ---- drafts (polyline / polygon tools) ----
  const finishDraft = useCallback(() => {
    if (!floor || draftPts.length < 2) {
      setDraftPts([]);
      return;
    }
    const def = TOOL_DEF[tool as keyof typeof TOOL_DEF];
    if (!def) {
      setDraftPts([]);
      return;
    }
    const maxZ = floorElements.reduce((m, el) => Math.max(m, el.z_index), 0);
    addElement({
      id: crypto.randomUUID(),
      floor_id: floor.id,
      type: def.type,
      shape: def.shape as 'polyline' | 'polygon',
      geom: draftPts.map((p) => [p.x, p.y] as [number, number]),
      label: def.type === 'aisle' ? 'Aisle' : '',
      color: '',
      meta: '{}',
      z_index: maxZ + 1,
    });
    setDraftPts([]);
  }, [floor, draftPts, tool, floorElements, addElement]);

  // ---- product placement ----
  const placeProduct = async (p: WorldPt) => {
    if (!placeProductId || !floor) return;
    const shelfId = shelfIdAtPoint(p, floorElements);
    if (tryMode) session?.logAction('pin product');
    try {
      const { location } = await apix.setProductLocation(placeProductId, { floor_id: floor.id, x: p.x, y: p.y, shelfId: shelfId ?? undefined });
      stampOwner(location.id, shelfId);
      setLocations((prev) => [
        ...prev.filter((l) => !(l.product_id === placeProductId && l.floor_id === floor.id)),
        location,
      ]);
    } catch {
      /* surface via save state */
    }
    // B9: pin-queue mode keeps going until the queue is empty
    const rest = pinQueue.filter((id) => id !== placeProductId);
    setPinQueue(rest);
    if (rest.length) {
      setPlaceProductId(rest[0]);
      return; // stay in product tool for the next item
    }
    setPlaceProductId(null);
    setTool('select');
  };

  /** B3: align / distribute the multi-selection (one undo step). */
  const alignSelection = (mode: 'left' | 'cx' | 'right' | 'dist') => {
    const picked = floorElements.filter((e) => selectedIds.has(e.id));
    if (picked.length < 2) return;
    const rectOf = (el: MapElement) => {
      const bb = bboxOf(elementPoints(el));
      return { minX: bb.minX, maxX: bb.maxX, cx: (bb.minX + bb.maxX) / 2, w: bb.maxX - bb.minX };
    };
    const boxes = picked.map((el) => ({ el, ...rectOf(el) }));
    const next = new Map<string, MapElement>();
    if (mode === 'left') {
      const target = Math.min(...boxes.map((b) => b.minX));
      boxes.forEach((b) => next.set(b.el.id, translateElement(b.el, target - b.minX, 0)));
    } else if (mode === 'right') {
      const target = Math.max(...boxes.map((b) => b.maxX));
      boxes.forEach((b) => next.set(b.el.id, translateElement(b.el, target - b.maxX, 0)));
    } else if (mode === 'cx') {
      const target = boxes.reduce((a, b) => a + b.cx, 0) / boxes.length;
      boxes.forEach((b) => next.set(b.el.id, translateElement(b.el, target - b.cx, 0)));
    } else {
      // horizontal distribute: even gaps between left edges across [min,max]
      const sorted = [...boxes].sort((a, b) => a.minX - b.minX);
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const span = last.minX - first.minX;
      sorted.forEach((b, i) => {
        const want = first.minX + (span * i) / (sorted.length - 1);
        next.set(b.el.id, translateElement(b.el, want - b.minX, 0));
      });
    }
    changeElements(
      floorElements.map((el) => next.get(el.id) ?? el),
      'push',
      mode === 'dist' ? 'distribute' : `align ${mode}`
    );
  };

  /** Drag a product pin: local during the gesture, one API upsert on release. */
  const movePin = (locationId: string, productId: string, x: number, y: number, commit: boolean) => {
    setLocations((prev) => prev.map((l) => (l.id === locationId ? { ...l, x, y } : l)));
    if (commit) {
      if (!floor) return;
      const shelfId = shelfIdAtPoint({ x, y }, floorElements);
      stampOwner(locationId, shelfId);
      apix.setProductLocation(productId, { floor_id: floor.id, x, y, shelfId: shelfId ?? undefined })
        .then(({ location }) => setLocations((prev) => prev.map((l) => (l.id === locationId ? location : l))))
        .catch(() => { /* keep the optimistic position; the badge shows save state */ });
    }
  };

  if (loadError) {
    return (
      <main className="container">
        <div className="empty-state card">
          <h3>Could not open this store</h3>
          <p>{loadError}</p>
          <Link className="btn" to="/dashboard">Back to dashboard</Link>
        </div>
      </main>
    );
  }
  if (!store || !floor) {
    return <main className="container"><p className="muted">Loading editor…</p></main>;
  }

  const selected = elements.find((e) => e.id === selectedId) ?? null;
  const placing = placeProductId ? products.find((p) => p.id === placeProductId) : null;
  const shelfPreview = shelfPreviewId ? elements.find((e) => e.id === shelfPreviewId) ?? null : null;

  return (
    <EditorApiContext.Provider value={apix}>
    <div className="editor">
      <div className="editor-top">
        <Link to={tryMode ? '/' : '/dashboard'} className="btn ghost sm">{tryMode ? '← Home' : '← Stores'}</Link>
        <span className="store-name">
          {store.name}
          {tryMode && <span className="try-chip" title="No account — your map is saved on this device only">sandbox</span>}
        </span>
        <div className="floor-tabs">
          {floors.map((f) => (
            <button key={f.id} className={`floor-tab ${f.id === floor.id ? 'active' : ''}`} onClick={() => switchFloor(f.id)}>
              {f.name}
            </button>
          ))}
          <AddFloorButton storeId={store.id} onCreated={(f) => { setFloors((prev) => [...prev, f]); setActiveFloorId(f.id); }} />
        </div>
        <div className="spacer" style={{ flex: 1 }} />
        <button
          className="btn sm"
          disabled={historyLen.past === 0}
          onClick={undo}
          title={undoLabel ? `Undo: ${undoLabel}` : 'Undo'}
        >
          ↩ Undo{undoLabel && historyLen.past > 0 ? `: ${undoLabel}` : ''}
        </button>
        <button className="btn sm" disabled={historyLen.future === 0} onClick={redo}>↪ Redo</button>
        <button
          className="btn sm"
          disabled={!selected}
          title="Duplicate the selected element (offset copy)"
          onClick={() => {
            if (!selected) return;
            const copy: MapElement = {
              ...selected,
              id: crypto.randomUUID(),
              geom: shiftGeom(selected.geom),
              z_index: Math.max(...floorElements.map((e) => e.z_index), 0) + 1,
            };
            changeElements([...floorElements, copy], 'push');
            setSelectedId(copy.id);
          }}
        >
          ⧉ Duplicate
        </button>
        <button className="btn sm" onClick={() => setFitSignal((n) => n + 1)} title="Fit map to screen">⤢ Fit</button>
        {tryMode ? (
          <button className="btn sm" onClick={() => session?.exportDownload()} title="Download this store as a transfer bundle">
            ⬇ Export
          </button>
        ) : (
          <SaveBadge state={saveState} onRetry={() => { setSaveState('dirty'); dirtyRef.current = true; }} />
        )}
      </div>

      {tryMode && (
        <div className="try-banner">
          <span className="try-banner-text">
            🧪 Sandbox — everything works, and your map is saved <b>on this device only</b>. Create an account to put it online.
          </span>
          <div className="try-banner-actions">
            <button className="btn sm" onClick={() => session?.exportDownload()}>⬇ Export</button>
            {session?.canPersist && (
              <button
                className="btn sm"
                title="Discard the copy saved on this device and start fresh"
                onClick={() => {
                  if (confirm('Discard this map from your device and start over?')) {
                    session.discard();
                    window.location.reload();
                  }
                }}
              >
                Start over
              </button>
            )}
            <Link className="btn sm primary" to="/login">Save with an account</Link>
          </div>
        </div>
      )}

      <div className={`editor-body ${sideOpen ? "side-open" : "side-closed"}`}>
        <div className="map-wrap">
          {view3d ? (
            <Map3D
              floor={floor}
              elements={floorElements}
              pins={visibleFloorPins}
              stockPins={visibleFloorPins}
              camera={cam3d}
              onCamera={setCam3d}
              edit
              selectedId={selectedId}
              onSelectElement={(id) => {
                setSelectedId(id);
                if (id) showTab('map');
                if (selectedIds.size) setSelectedIds(new Set());
              }}
              onElementDrag={dragElement3d}
              onElementsChange={changeElements}
              onPinClick={(productId) => {
                setFlashProductId(productId);
                showTab('products');
              }}
              focusElement={focus3d}
              fitSignal={fitSignal}
              zoomCommand={zoomCmd}
              theme={sceneTheme}
            />
          ) : (
            <MapCanvas
              floor={floor}
              elements={floorElements}
              pins={visibleFloorPins}
              viewport={viewport}
              onViewport={setViewport}
              edit
              tool={tool}
              selectedId={selectedId}
              draftPts={draftPts}
              onSelect={(id) => {
                setSelectedId(id);
                if (id) showTab('map');
                if (selectedIds.size) setSelectedIds(new Set());
              }}
              onElementsChange={changeElements}
              onAddElement={addElement}
              onDraftAdd={(p) => setDraftPts((d) => [...d, p])}
              onDraftFinish={finishDraft}
              onDraftCancel={() => setDraftPts([])}
              onPlaceProduct={placeProduct}
              selectedIds={selectedIds}
              onMultiSelect={(ids) => {
                setSelectedIds(ids);
                if (ids.size === 1) setSelectedId([...ids][0]);
                if (ids.size === 0) setSelectedId(null);
              }}
              bgOpacity={bgOpacity}
              pickFilter={pickFilter}
              onPinMove={movePin}
              onPinSelect={(productId) => {
                setFlashProductId(productId);
                showTab('products');
              }}
              fitSignal={fitSignal}
              zoomCommand={zoomCmd}
            />
          )}
          {/* editing tools as a left icon rail: add-tools, delete, pick filter */}
          <div className="tool-rail" role="toolbar" aria-label="Map editing tools">
            {TOOLS.map((t) => (
              <button
                key={t.id}
                className={`tool-btn ${tool === t.id ? 'active' : ''}`}
                onClick={() => { setTool(t.id); setSelectedId(t.id === 'select' ? selectedId : null); }}
                disabled={t.id === 'product' && !placeProductId}
                aria-label={t.id === 'product' ? 'Product pin — pick a product in the Products tab first' : t.label}
                data-tip={t.id === 'product' ? 'Product pin (pick one in Products first)' : t.label}
              >
                <span aria-hidden>{t.icon}</span>
              </button>
            ))}
            <span className="rail-sep" aria-hidden />
            <button
              className="tool-btn danger"
              disabled={!selected}
              aria-label="Delete the selected element"
              data-tip="Delete selected"
              onClick={() => {
                if (!selected) return;
                changeElements(floorElements.filter((e) => e.id !== selected.id), 'push');
                setSelectedId(null);
              }}
            >
              <span aria-hidden>🗑</span>
            </button>
            {tool === 'select' && (
              <>
                <button
                  className={`tool-btn ${pickFilter === 'all' ? 'active' : ''}`}
                  onClick={() => setPickFilter('all')}
                  aria-label="Pick fixtures"
                  data-tip="Pick: fixtures"
                >
                  <span aria-hidden>▦</span>
                </button>
                <button
                  className={`tool-btn ${pickFilter === 'products' ? 'active' : ''}`}
                  onClick={() => setPickFilter('products')}
                  aria-label="Pick products"
                  data-tip="Pick: products only"
                >
                  <span aria-hidden>◉</span>
                </button>
              </>
            )}
            {draftPts.length > 0 && (
              <>
                <span className="rail-sep" aria-hidden />
                <button className="tool-btn active" data-tip={`Finish shape (${draftPts.length} pts)`} onClick={finishDraft}>✓</button>
                <button className="tool-btn" data-tip="Cancel draft" onClick={() => setDraftPts([])}>✕</button>
              </>
            )}
          </div>
          {!placing && <div className="tool-hint">{TOOL_HINTS[tool]}</div>}
          {/* pull-out handle for the side panel */}
          <button
            className={`side-handle ${sideOpen ? 'open' : ''}`}
            onClick={() => switchSide(!sideOpen)}
            aria-expanded={sideOpen}
            aria-label={sideOpen ? 'Hide the side panel' : 'Show the side panel'}
            title={sideOpen ? 'Hide panel' : 'Show panel'}
          >
            {sideOpen ? 'close »' : '« panel'}
          </button>
          {view3d && floor && (
            <CameraPad onMove={cam3dMove} />
          )}
          <ZoomPad onZoom={(dir) => setZoomCmd((z) => ({ k: dir > 0 ? 1.3 : 0.77, seq: z.seq + 1 }))} />
          <button
            className="btn controls-btn"
            onClick={() => setShowControls((v) => !v)}
            title="Show controls"
          >
            ⌨ Controls
          </button>
          {showControls && (
            <div className="controls-card card" role="dialog" aria-label="Editor controls">
              <div className="row-between" style={{ marginBottom: 6 }}>
                <b>{view3d ? '3D controls' : '2D controls'}</b>
                <button className="route-badge-x" onClick={() => setShowControls(false)} aria-label="Close controls">✕</button>
              </div>
              {(view3d
                ? [
                    ['Click fixture', 'select it (outline + panel)'],
                    ['Drag fixture', 'move on the floor (snapped)'],
                    ['Drag empty space', 'orbit'],
                    ['Middle mouse drag', 'pan the camera'],
                    ['Wheel / pinch', 'zoom'],
                    ['R · Del · arrows', 'rotate · delete · nudge'],
                    ['Esc', 'deselect'],
                  ]
                : [
                    ['Tool + drag', 'draw shelves, walls, zones…'],
                    ['Click element', 'select; drag to move; handles resize'],
                    ['Round handle / R / panel', 'rotate (Shift = 15° snap)'],
                    ['Click a product pin', 'select the product'],
                    ['Del · arrows', 'delete · nudge (Shift = 1 m)'],
                    ['Cmd/Ctrl+Z', 'undo · Shift+Z redo'],
                    ['Drag empty space', 'pan · wheel zooms'],
                    ['Shift-click', 'multi-select'],
                  ]
              ).map(([k, d]) => (
                <div className="controls-row" key={k}>
                  <code>{k}</code>
                  <span>{d}</span>
                </div>
              ))}
            </div>
          )}
          <div className="view-toggle" style={{ position: 'absolute', top: 10, left: 12, zIndex: 5, boxShadow: 'var(--shadow)' }}>
            <button className={!view3d ? 'active' : ''} aria-pressed={!view3d} onClick={() => switchView3d(false)} title="2D editor">
              2D
            </button>
            <button className={view3d ? 'active' : ''} aria-pressed={view3d} onClick={() => switchView3d(true)} title="3D editor — click to select, drag to move">
              3D
            </button>
          </div>
          {view3d && (
            <div className="map-hint" style={{ left: '50%', transform: 'translateX(-50%)' }}>
              Click to select · drag a fixture to move · drag empty space to orbit · middle-drag pans · R rotates · Del deletes
            </div>
          )}
          {view3d && tool !== 'select' && (
            <div className="map-hint warn-note" style={{ left: '50%', transform: 'translateX(-50%)', bottom: 48, pointerEvents: 'auto' }}>
              Drawing is 2D-only — switch to 2D to draw.
            </div>
          )}
          {placing && (
            <div className="map-hint" style={{ pointerEvents: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
              📍 Click the map to pin <b>{placing.name}</b>
              {pinQueue.length > 1 && <span className="badge gray">{pinQueue.length - 1} more queued</span>}
              <button
                className="btn sm"
                onClick={() => {
                  setPinQueue([]);
                  setPlaceProductId(null);
                  setTool('select');
                }}
              >
                Cancel
              </button>
            </div>
          )}
          {shelfPreview && (
            <ShelfDetail
              shelf={shelfPreview}
              pins={visibleFloorPins}
              onClose={() => setShelfPreviewId(null)}
            />
          )}
        </div>

        <aside className={`editor-side ${sideOpen ? "open" : ""}`}>
          {(selectedIds?.size ?? 0) > 1 && (
            <div className="panel-section" style={{ borderBottom: '1px solid var(--line)' }}>
              <b style={{ fontSize: 13 }}>{selectedIds.size} selected</b>
              <div className="multi-row">
                {(
                  [
                    ['left', '⇤ left'],
                    ['cx', '↔ center'],
                    ['right', 'right ⇥'],
                    ['dist', '⇹ spread'],
                  ] as const
                ).map(([mode, label]) => (
                  <button key={mode} className="btn sm" onClick={() => alignSelection(mode)}>
                    {label}
                  </button>
                ))}
              </div>
              <p className="muted" style={{ fontSize: 11.5, margin: '4px 0 0' }}>
                Shift-click the map to add/remove. Drag or arrow-key moves the group.
              </p>
            </div>
          )}
          <div className="side-tabs">
            <button className={`side-tab ${sideTab === 'map' ? 'active' : ''}`} onClick={() => setSideTab('map')}>Map</button>
            <button className={`side-tab ${sideTab === 'products' ? 'active' : ''}`} onClick={() => setSideTab('products')}>Products</button>
            <button className={`side-tab ${sideTab === 'store' ? 'active' : ''}`} onClick={() => setSideTab('store')}>Store</button>
            <button className={`side-tab ${sideTab === 'history' ? 'active' : ''}`} onClick={() => setSideTab('history')}>History</button>
          </div>
          <div className="side-content">
            {sideTab === 'map' && (
              selected ? (
                <ElementPanel
                  el={selected}
                  floor={floor}
                  elements={floorElements}
                  items={
                    selected.type === 'shelf'
                      ? locations
                          .filter((l) => l.floor_id === floor.id && ownerOf(l) === selected.id)
                          .map((l) => products.find((pr) => pr.id === l.product_id))
                          .filter(Boolean as unknown as (p: Product | undefined) => p is Product)
                      : undefined
                  }
                  onChange={(next) => changeElements(next, 'push')}
                  onDelete={() => { changeElements(floorElements.filter((e) => e.id !== selected.id), 'push'); setSelectedId(null); }}
                  onDuplicate={() => {
                    const copy: MapElement = {
                      ...selected,
                      id: crypto.randomUUID(),
                      geom: shiftGeom(selected.geom),
                      z_index: Math.max(...floorElements.map((e) => e.z_index), 0) + 1,
                    };
                    changeElements([...floorElements, copy], 'push');
                    setSelectedId(copy.id);
                  }}
                  onPreviewShelf={selected.type === 'shelf' && selected.shape === 'rect' ? () => setShelfPreviewId(selected.id) : undefined}
                />
              ) : (
                                <>
                <FloorPanel
                  floor={floor}
                  bgOpacity={bgOpacity}
                  onBgOpacity={setBgOpacity}
                  isDraft={draftPts.length > 0}
                  onFinishDraft={finishDraft}
                  onCancelDraft={() => setDraftPts([])}
                  onUpdated={(f) => setFloors((prev) => prev.map((x) => (x.id === f.id ? f : x)))}
                  floorCount={floors.length}
                  onDeleted={() => {
                    const rest = floors.filter((f) => f.id !== floor.id);
                    setFloors(rest);
                    setSelectedId(null);
                    if (activeFloorId === floor.id) setActiveFloorId(rest[0]?.id ?? '');
                    // the floor's history entries are gone with it — start clean
                    history.current = { past: [], future: [] };
                    setHistoryLen({ past: 0, future: 0 });
                    setFitSignal((n) => n + 1);
                  }}
                />
                <ElementOutline
                  elements={floorElements}
                  floor={floor}
                  onSelectEl={(id) => {
                    setSelectedId(id);
                    setSelectedIds(new Set());
                  }}
                  onToggleLock={(id, locked) => {
                    const el = floorElements.find((e) => e.id === id);
                    if (!el) return;
                    let meta: Record<string, unknown> = {};
                    try {
                      meta = JSON.parse(el.meta || '{}');
                    } catch { /* keep {} */ }
                    changeElements(
                      floorElements.map((e) => (e.id === id ? { ...e, meta: JSON.stringify({ ...meta, locked }) } : e)),
                      'push',
                      locked ? 'lock' : 'unlock'
                    );
                  }}
                />
                </>
              )
            )}
            {sideTab === 'products' && (
              <ProductsPanel
                storeId={store.id}
                entitlements={store.entitlements ?? { productImages: false }}
                products={products}
                categories={categories}
                locations={locations}
                onData={(d: { products?: Product[]; categories?: Category[]; locations?: ProductLocation[] }) => {
                  if (d.products) setProducts(d.products);
                  if (d.categories) setCategories(d.categories);
                  if (d.locations) {
                    setLocations(d.locations);
                    // wholesale replace: re-derive pin→shelf ownership for it
                    deriveOwners(d.locations, elements);
                  }
                }}
                placingId={placeProductId}
                flashId={flashProductId}
                onStartPlacing={(id) => { setPinQueue([id]); setPlaceProductId(id); setTool('product'); }}
                onQueueMany={(ids) => {
                  if (!ids.length) return;
                  setPinQueue(ids);
                  setPlaceProductId(ids[0]);
                  setTool('product');
                }}
              />
            )}
            {sideTab === 'history' && (tryMode && session ? (
              <SandboxHistory session={session} />
            ) : (
              <HistoryPanel
                floorId={floor.id}
                currentElements={floorElements}
                onRestore={(rows) => {
                  changeElements(rows, 'push', 'restore snapshot');
                  setSelectedId(null);
                  showTab('map');
                }}
              />
            ))}
            {sideTab === 'store' && (
              <StorePanel
                store={store}
                productCount={products.length}
                tryMode={tryMode}
                onUpdated={(s) => setStore(s)}
                onDeleted={() => navigate('/dashboard')}
              />
            )}
          </div>
        </aside>
      </div>

    </div>
    </EditorApiContext.Provider>
  );
}

function shiftGeom(g: MapElement['geom']): MapElement['geom'] {
  if (Array.isArray(g)) return g.map(([x, y]) => [x + 0.5, y + 0.5] as [number, number]);
  if ('w' in g) return { ...g, x: g.x + 0.5, y: g.y + 0.5 };
  return { x: g.x + 0.5, y: g.y + 0.5 };
}

function SaveBadge({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  if (state === 'error') {
    return <button className="btn sm danger" onClick={onRetry}>Save failed — retry</button>;
  }
  return (
    <span className={`save-state ${state === 'dirty' ? 'dirty' : ''}`}>
      {state === 'saving' ? 'Saving…' : state === 'dirty' ? 'Unsaved' : 'Saved ✓'}
    </span>
  );
}

function AddFloorButton({ storeId, onCreated }: { storeId: string; onCreated: (f: Floor) => void }) {
  const api = useEditorApi();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { floor } = await api.addFloor(storeId, { name: name || undefined });
      onCreated(floor);
      setOpen(false);
      setName('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button className="floor-tab" onClick={() => setOpen(true)} title="Add floor">＋</button>
      {open && (
        <Modal title="Add a floor" onClose={() => setOpen(false)}>
          <form onSubmit={submit}>
            <Field label="Floor name">
              <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Basement, Balcony…" />
            </Field>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn primary" disabled={busy}>{busy ? 'Adding…' : 'Add floor'}</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

/* ---------------- Map panel: element props / floor props ---------------- */

const TYPES_BY_SHAPE: Record<string, MapElement['type'][]> = {
  rect: ['shelf', 'wall', 'zone', 'aisle'],
  polyline: ['aisle', 'wall'],
  polygon: ['zone', 'shelf'],
  point: ['poi', 'entrance', 'exit'],
};

function ElementPanel({
  el, floor, elements, onChange, onDelete, onDuplicate, onPreviewShelf, items,
}: {
  el: MapElement;
  floor: Floor;
  elements: MapElement[];
  onChange: (els: MapElement[]) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onPreviewShelf?: () => void;
  /** Items the user pinned to this shelf (owned association, not geometry). */
  items?: Product[];
}) {
  const patch = (fields: Partial<MapElement>) =>
    onChange(elements.map((e) => (e.id === el.id ? { ...e, ...fields } : e)));
  const effColor = el.color || TYPE_COLOR[el.type];
  // the element's anchor for position display: rect/point use their own x/y,
  // polylines/polygons use their bounding-box corner
  const pos = (() => {
    if (el.shape === 'rect') {
      const g = el.geom as RectGeom;
      return { x: g.x, y: g.y };
    }
    if (el.shape === 'point') {
      const g = el.geom as { x: number; y: number };
      return { x: g.x, y: g.y };
    }
    const bb = bboxOf(elementPoints(el));
    return { x: bb.minX, y: bb.minY };
  })();
  const shelfItems = el.type === 'shelf' && items ? items : null;
  const shelfMeta = el.type === 'shelf' && el.shape === 'rect' ? parseMeta(el.meta) : null;
  const patchMeta = (fields: Record<string, unknown>) => {
    if (!shelfMeta) return;
    patch({ meta: JSON.stringify({ ...shelfMeta, ...fields }) });
  };
  // label text scale: stored on the element meta, read by both renderers
  const labelMeta = el.label ? parseMeta(el.meta) : null;
  const labelScale = Number(labelMeta?.labelScale) || 1;
  const setLabelScale = (v: number) =>
    patch({ meta: JSON.stringify({ ...parseMeta(el.meta), labelScale: v }) });
  return (
    <div>
      <div className="panel-section">
        <h4>Selected · {el.shape}</h4>
        {labelMeta && (
          <div style={{ marginBottom: 12 }}>
            <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--ink-soft)', marginBottom: 5 }}>Label size</span>
            <div className="theme-seg" role="radiogroup" aria-label="Label size" style={{ maxWidth: 160 }}>
              {[['S', 1], ['M', 1.4], ['L', 1.9]].map(([lbl, v]) => (
                <button
                  key={lbl as string}
                  type="button"
                  role="radio"
                  aria-checked={labelScale === v}
                  className={labelScale === v ? 'active' : ''}
                  style={{ fontSize: 11 * (v as number) }}
                  onClick={() => setLabelScale(v as number)}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>
        )}
        {shelfItems && (
          <div className="shelf-items">
            <span className="muted" style={{ fontSize: 12 }}>
              Items on this shelf ({shelfItems.length}) — moves with the shelf, never changed by it:
            </span>
            {shelfItems.length === 0 ? (
              <span className="muted" style={{ fontSize: 12 }}>nothing pinned here yet</span>
            ) : (
              <div className="chips">
                {shelfItems.map((it) => (
                  <span key={it.id} className="badge gray" title={it.name}>{it.name}</span>
                ))}
              </div>
            )}
          </div>
        )}
        <Field label="Type">
          <select className="select" value={el.type} onChange={(e) => patch({ type: e.target.value as MapElement['type'] })}>
            {TYPES_BY_SHAPE[el.shape].map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </Field>
        <Field label="Label">
          <input className="input" value={el.label} maxLength={80} onChange={(e) => patch({ label: e.target.value })} placeholder={el.type === 'shelf' ? 'Aisle 4 · Dairy' : ''} />
        </Field>
        <Field label="Colour">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="color" value={effColor} onChange={(e) => patch({ color: e.target.value })} style={{ width: 44, height: 32, border: '1px solid var(--line)', borderRadius: 8, background: '#fff' }} />
            {el.color && (
              <button className="btn sm" onClick={() => patch({ color: '' })}>Reset</button>
            )}
          </div>
        </Field>
      </div>
      <div className="panel-section">
        <h4>Position</h4>
        <div className="move-row">
          <div className="move-pad" role="group" aria-label="Nudge position">
            <span />
            <button onClick={() => patch(translateElement(el, 0, -0.25))} title="Nudge up">↑</button>
            <span />
            <button onClick={() => patch(translateElement(el, -0.25, 0))} title="Nudge left">←</button>
            <span className="move-dot" />
            <button onClick={() => patch(translateElement(el, 0.25, 0))} title="Nudge right">→</button>
            <span />
            <button onClick={() => patch(translateElement(el, 0, 0.25))} title="Nudge down">↓</button>
            <span />
          </div>
          <div style={{ flex: 1 }}>
            <div className="field-row">
              <Field label="X (m)">
                <input
                  className="input" type="number" step={0.25}
                  value={Math.round(pos.x * 100) / 100}
                  onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) patch(translateElement(el, v - pos.x, 0)); }}
                />
              </Field>
              <Field label="Y (m)">
                <input
                  className="input" type="number" step={0.25}
                  value={Math.round(pos.y * 100) / 100}
                  onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) patch(translateElement(el, 0, v - pos.y)); }}
                />
              </Field>
            </div>
            {el.shape === 'rect' && (() => {
              const g = el.geom as RectGeom;
              const setRot = (rot: number) =>
                patch({ ...el, geom: { ...g, rot: ((Math.round(rot) % 360) + 360) % 360 } });
              return (
                <div className="field-row" style={{ marginTop: 8 }}>
                  <Field label="Rotation (°)">
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input
                        className="input" type="number" step={5} min={-360} max={360}
                        value={Math.round(((g.rot % 360) + 360) % 360)}
                        onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) setRot(v); }}
                      />
                      <button className="btn sm" title="Rotate 90° counter-clockwise" onClick={() => setRot(g.rot - 90)}>↺</button>
                      <button className="btn sm" title="Rotate 90° clockwise" onClick={() => setRot(g.rot + 90)}>↻</button>
                    </div>
                  </Field>
                </div>
              );
            })()}
            <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>
              Nudges move 0.25 m · arrow keys work on the map too (Shift = 1 m).
            </p>
          </div>
        </div>
      </div>
      {shelfMeta && (
        <div className="panel-section">
          <h4>Shelf layout</h4>
          <div className="field-row">
            <Field label="Bays">
              <input
                className="input" type="number" min={1} max={40}
                value={shelfMeta.bays ?? ''}
                placeholder="auto"
                onChange={(e) => patchMeta({ bays: e.target.value === '' ? undefined : Number(e.target.value) })}
              />
            </Field>
            <Field label="Rows">
              <input
                className="input" type="number" min={1} max={8}
                value={shelfMeta.levels ?? ''}
                placeholder="4"
                onChange={(e) => patchMeta({ levels: e.target.value === '' ? undefined : Number(e.target.value) })}
              />
            </Field>
            <Field label="Height (m)">
              <input
                className="input" type="number" step={0.1} min={0.3} max={3}
                value={shelfMeta.height ?? ''}
                placeholder="1.5"
                onChange={(e) => patchMeta({ height: e.target.value === '' ? undefined : Number(e.target.value) })}
              />
            </Field>
          </div>
          <div className="field-row">
            <Field label="Item height (m)">
              <input
                className="input" type="number" step={0.01} min={0.05} max={1.2}
                value={shelfMeta.itemH ?? ''}
                placeholder="0.24"
                onChange={(e) => patchMeta({ itemH: e.target.value === '' ? undefined : Number(e.target.value) })}
              />
            </Field>
            <Field label="Item length (m)">
              <input
                className="input" type="number" step={0.01} min={0.05} max={1.2}
                value={shelfMeta.itemW ?? ''}
                placeholder="0.20"
                onChange={(e) => patchMeta({ itemW: e.target.value === '' ? undefined : Number(e.target.value) })}
              />
            </Field>
          </div>
          <div className="stack">
            <button className="btn" onClick={onPreviewShelf}>View shelf layout</button>
          </div>
          <p className="muted" style={{ fontSize: 12.5 }}>
            Shoppers can tap this shelf on the public map to see this front view. Leave bays empty to divide evenly.
            Rows and height shape the 3D fixture; item size shapes the products on it.
          </p>
        </div>
      )}
      {(() => {
        // B6: gentle, non-blocking geometry warnings
        const warns: string[] = [];
        const bb = bboxOf(elementPoints(el));
        if (bb.minX < 0 || bb.minY < 0 || bb.maxX > floor.width_m || bb.maxY > floor.height_m) {
          warns.push('Extends outside the floor bounds');
        }
        if (el.shape === 'rect') {
          const g = el.geom as RectGeom;
          if (g.w < 0.3 || g.h < 0.3) warns.push('Very small — may be hard to tap on phones');
        }
        try {
          if (JSON.parse(el.meta || '{}')?.locked) warns.push('Locked: unlock in the Outline list to drag it');
        } catch { /* ignore */ }
        return warns.length ? (
          <div className="panel-section">
            {warns.map((w) => (
              <div key={w} className="warn-note">⚠ {w}</div>
            ))}
          </div>
        ) : null;
      })()}
      <div className="panel-section">
        <h4>Actions</h4>
        <div className="stack">
          <button className="btn" onClick={onDuplicate}>Duplicate</button>
          <button className="btn danger" onClick={onDelete}>Delete element</button>
        </div>
        <p className="muted" style={{ fontSize: 12.5 }}>
          Tip: press <b>R</b> to rotate 90°, <b>Del</b> to delete, hold <b>Shift</b> while rotating to snap 15°.
        </p>
      </div>
    </div>
  );
}

function FloorPanel({
  floor, isDraft, onFinishDraft, onCancelDraft, onUpdated,
  bgOpacity, onBgOpacity, floorCount, onDeleted,
}: {
  floor: Floor;
  isDraft: boolean;
  onFinishDraft: () => void;
  onCancelDraft: () => void;
  onUpdated: (f: Floor) => void;
  bgOpacity: number;
  onBgOpacity: (v: number) => void;
  /** Floors on this store — the last one can't be deleted. */
  floorCount: number;
  onDeleted: () => void;
}) {
  const api = useEditorApi();
  const [name, setName] = useState(floor.name);
  const [w, setW] = useState(String(floor.width_m));
  const [h, setH] = useState(String(floor.height_m));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setName(floor.name);
    setW(String(floor.width_m));
    setH(String(floor.height_m));
  }, [floor.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveProps = async () => {
    setBusy(true);
    try {
      const { floor: f } = await api.updateFloor(floor.id, {
        name: name || floor.name,
        width_m: Number(w) || floor.width_m,
        height_m: Number(h) || floor.height_m,
      });
      onUpdated(f);
    } finally {
      setBusy(false);
    }
  };

  const uploadPlan = async (file: File) => {
    setBusy(true);
    try {
      const { url } = await api.uploadImage(file, floor.store_id);
      const { floor: f } = await api.updateFloor(floor.id, { background_url: url });
      onUpdated(f);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="panel-section">
        <h4>Floor · {floor.name}</h4>
        <Field label="Name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} onBlur={saveProps} />
        </Field>
        <div className="field-row">
          <Field label="Width (m)">
            <input className="input" type="number" min={1} max={500} step={0.5} value={w} onChange={(e) => setW(e.target.value)} onBlur={saveProps} />
          </Field>
          <Field label="Height (m)">
            <input className="input" type="number" min={1} max={500} step={0.5} value={h} onChange={(e) => setH(e.target.value)} onBlur={saveProps} />
          </Field>
        </div>
        <button className="btn block" disabled={busy} onClick={saveProps}>{busy ? 'Saving…' : 'Save floor settings'}</button>
      </div>

      <div className="panel-section">
        <h4>Floor plan image (optional)</h4>
        {floor.background_url ? (
          <>
            <img src={floor.background_url} alt="Floor plan" style={{ width: '100%', borderRadius: 8, border: '1px solid var(--line)', opacity: bgOpacity }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
              <span className="muted" style={{ fontSize: 12 }}>Tracing opacity</span>
              <input
                type="range" min={0.1} max={1} step={0.05} value={bgOpacity}
                onChange={(e) => onBgOpacity(Number(e.target.value))}
                style={{ flex: 1 }}
              />
            </div>
            <div className="stack" style={{ marginTop: 8 }}>
              <label className="btn sm">
                Replace image
                <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => e.target.files?.[0] && uploadPlan(e.target.files[0])} />
              </label>
              <button className="btn sm" onClick={async () => onUpdated((await api.updateFloor(floor.id, { background_url: '' })).floor)}>
                Remove image
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
              Upload an existing floor plan to trace over — then hide it when done.
            </p>
            <label className="btn block">
              {busy ? 'Uploading…' : 'Upload floor plan image'}
              <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => e.target.files?.[0] && uploadPlan(e.target.files[0])} />
            </label>
          </>
        )}
      </div>

      {floorCount > 1 && (
        <div className="panel-section">
          <h4>Danger zone</h4>
          <button
            className="btn danger"
            disabled={busy}
            onClick={async () => {
              if (!confirm(`Delete floor “${floor.name}” and everything on it?`)) return;
              setBusy(true);
              try {
                await api.deleteFloor(floor.id);
                onDeleted();
              } finally {
                setBusy(false);
              }
            }}
          >
            Delete this floor
          </button>
          <p className="muted" style={{ fontSize: 12.5, margin: '6px 0 0' }}>
            Removes the floor, its fixtures and the pins on it. The last remaining floor can’t be deleted.
          </p>
        </div>
      )}

      {isDraft ? (
        <div className="panel-section">
          <h4>Drawing in progress</h4>
          <div className="stack">
            <button className="btn primary" onClick={onFinishDraft}>Finish shape</button>
            <button className="btn" onClick={onCancelDraft}>Cancel</button>
          </div>
        </div>
      ) : null}

    </div>
  );
}

/* ---------------- Sandbox history (device save log) ---------------- */

function SandboxHistory({ session }: { session: LocalSession }) {
  const entries = [...session.log].reverse(); // newest first
  return (
    <div className="panel-section">
      <h4>Save log · this device</h4>
      <p className="muted" style={{ fontSize: 12.5, margin: '0 0 8px' }}>
        Every change saved on this device, newest first. Nothing leaves your browser.
      </p>
      {entries.length === 0 ? (
        <p className="muted" style={{ fontSize: 13 }}>No changes yet — draw something first.</p>
      ) : (
        <div className="products-scroll">
          {entries.map((e, i) => (
            <div key={`${e.ts}-${i}`} className="snapshot-item">
              <span className="snapshot-info">
                <b>{e.label}</b>
                <span>{new Date(e.ts).toLocaleTimeString()} · {e.elements} elements · {e.products} products</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- History panel (autosave changelog) ---------------- */

function relTime(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} d ago`;
}

function HistoryPanel({
  floorId, onRestore, currentElements,
}: {
  floorId: string;
  currentElements: MapElement[];
  onRestore: (els: MapElement[]) => void;
}) {
  const api = useEditorApi();
  const [snaps, setSnaps] = useState<{ id: string; element_count: number; created_at_ms: number }[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = () => {
    api.floorSnapshots(floorId)
      .then((r) => setSnaps(r.snapshots))
      .catch((e) => setError(e.message || 'Could not load history'));
  };
  useEffect(load, [floorId]); // eslint-disable-line react-hooks/exhaustive-deps

  const [diffFor, setDiffFor] = useState<{ id: string; summary: string[] } | null>(null);

  const restore = async (id: string) => {
    setBusyId(id);
    setError('');
    try {
      const { snapshot } = await api.floorSnapshot(floorId, id);
      onRestore(snapshot.elements.map(parseElement));
      setDiffFor(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Restore failed');
    } finally {
      setBusyId(null);
    }
  };

  /** B10: what restoring would change, before the user confirms. */
  const previewDiff = async (id: string, current: MapElement[]) => {
    setBusyId(id);
    try {
      const { snapshot } = await api.floorSnapshot(floorId, id);
      const cur = new Map(current.map((e) => [e.id, e]));
      const snapIds = new Set(snapshot.elements.map((e: { id: string }) => e.id));
      const added = [...snapIds].filter((k) => !cur.has(k)).length;
      const removed = [...cur.keys()].filter((k) => !snapIds.has(k)).length;
      const changed = snapshot.elements.filter((e: { id: string; geometry: unknown }) => {
        const c = cur.get(e.id);
        return c && elementToRow(c).geometry !== e.geometry;
      }).length;
      setDiffFor({ id, summary: [`${added} added`, `${removed} removed`, `${changed} moved`] });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load snapshot');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <div className="panel-section">
        <div className="row-between">
          <h4 style={{ margin: 0 }}>Autosave history</h4>
          <button className="btn sm ghost" onClick={load}>↻ Refresh</button>
        </div>
        <p className="muted" style={{ fontSize: 12.5, margin: '6px 0 0' }}>
          A snapshot is kept at most once a minute while you edit (max 20 per floor) — enough to
          recover from mistakes without slowing saves down.
        </p>
      </div>
      <div className="panel-section">
        {error && <div className="error-note">{error}</div>}
        {snaps === null ? (
          <p className="muted" style={{ fontSize: 13 }}>Loading…</p>
        ) : snaps.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>
            No autosaves yet — they appear about a minute after you start editing.
          </p>
        ) : (
          snaps.map((snap, i) => (
            <div className="snapshot-item" key={snap.id}>
              <div className="snapshot-info">
                <b>{i === 0 ? 'Latest' : relTime(snap.created_at_ms)}</b>
                <span>{snap.element_count} element{snap.element_count === 1 ? '' : 's'}</span>
                <span className="muted" style={{ fontSize: 11.5 }}>
                  {new Date(snap.created_at_ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                {diffFor?.id === snap.id && (
                  <span className="muted" style={{ fontSize: 11.5 }}>vs now: {diffFor.summary.join(' · ')}</span>
                )}
              </div>
              {diffFor?.id === snap.id ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn sm ghost" onClick={() => setDiffFor(null)}>No</button>
                  <button className="btn sm primary" disabled={busyId === snap.id} onClick={() => restore(snap.id)}>
                    {busyId === snap.id ? 'Restoring…' : 'Confirm'}
                  </button>
                </div>
              ) : (
                <button className="btn sm" disabled={busyId === snap.id} onClick={() => previewDiff(snap.id, currentElements)}>
                  {busyId === snap.id ? 'Loading…' : '↩ Restore'}
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ---------------- Element outline (B1) ---------------- */

const TYPE_ICON: Record<string, string> = {
  shelf: '▬', wall: '▥', aisle: '⇢', zone: '▣', entrance: '⬆', exit: '⬇', poi: '★',
};
/** Outline groups, in the order a store planner thinks about them. */
const TYPE_ORDER = ['shelf', 'wall', 'zone', 'aisle', 'entrance', 'exit', 'poi'];
const TYPE_LABEL: Record<string, string> = {
  shelf: 'Shelves', wall: 'Walls', zone: 'Zones', aisle: 'Aisles', entrance: 'Entrances', exit: 'Exits', poi: 'Points of interest',
};

function ElementOutline({
  elements, floor, onSelectEl, onToggleLock,
}: {
  elements: MapElement[];
  floor: Floor;
  onSelectEl: (id: string) => void;
  onToggleLock: (id: string, locked: boolean) => void;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const isLocked = (el: MapElement) => {
    try {
      return Boolean(JSON.parse(el.meta || '{}')?.locked);
    } catch {
      return false;
    }
  };
  const filtered = elements.filter((el) =>
    `${el.label} ${el.type}`.toLowerCase().includes(q.toLowerCase())
  );
  const row = (el: MapElement) => (
    <div key={el.id} className={`outline-row ${isLocked(el) ? 'locked' : ''}`}>
      <button
        className="outline-pick"
        onClick={() => onSelectEl(el.id)}
        title={isLocked(el) ? 'Locked — click to select, unlock to drag' : el.label || el.type}
      >
        <span aria-hidden>{TYPE_ICON[el.type] ?? '▪'}</span>
        <b>{el.label || el.type}</b>
        <span className="muted">{el.type}</span>
      </button>
      <button
        className="btn sm ghost"
        title={isLocked(el) ? 'Unlock' : 'Lock (protect from accidental drags)'}
        onClick={() => onToggleLock(el.id, !isLocked(el))}
      >
        {isLocked(el) ? '🔒' : '🔓'}
      </button>
    </div>
  );

  const searching = q.trim().length > 0;
  const groups = TYPE_ORDER.filter((t) => elements.some((e) => e.type === t)).map((t) => ({
    type: t,
    items: filtered.filter((e) => e.type === t),
  }));

  return (
    <div className="panel-section">
      <h4>Outline · {elements.length} elements</h4>
      <input className="input" placeholder="Find elements…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="outline-list">
        {searching ? (
          <>
            {filtered.slice(0, 100).map(row)}
            {filtered.length > 100 && (
              <p className="muted" style={{ fontSize: 12 }}>…and {filtered.length - 100} more — keep typing to narrow.</p>
            )}
          </>
        ) : (
          groups.map((g) => (
            <div key={g.type} className="outline-group">
              <button
                className="outline-group-head"
                aria-expanded={open.has(g.type)}
                onClick={() =>
                  setOpen((prev) => {
                    const next = new Set(prev);
                    if (next.has(g.type)) next.delete(g.type);
                    else next.add(g.type);
                    return next;
                  })
                }
              >
                <span className={`outline-chev ${open.has(g.type) ? 'open' : ''}`} aria-hidden>▸</span>
                {TYPE_LABEL[g.type] ?? g.type}
                <span className="muted">{g.items.length}</span>
              </button>
              {open.has(g.type) && <div className="outline-group-items">{g.items.map(row)}</div>}
            </div>
          ))
        )}
        {!searching && filtered.length === 0 && (
          <p className="muted" style={{ fontSize: 12 }}>Nothing on this floor yet.</p>
        )}
      </div>
    </div>
  );
}

/* ---------------- Products panel ---------------- */

function ProductsPanel({
  storeId, entitlements, products, categories, locations, onData, placingId, onStartPlacing, flashId, onQueueMany,
}: {
  storeId: string;
  entitlements: { productImages: boolean };
  products: Product[];
  categories: Category[];
  locations: ProductLocation[];
  onData: (d: { products?: Product[]; categories?: Category[]; locations?: ProductLocation[] }) => void;
  placingId: string | null;
  onStartPlacing: (productId: string) => void;
  flashId: string | null;
  onQueueMany: (ids: string[]) => void;
}) {
  const api = useEditorApi();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [newCat, setNewCat] = useState('');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [csvOpen, setCsvOpen] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [csvMsg, setCsvMsg] = useState('');
  const flashRef = useRef<HTMLDivElement | null>(null);

  const loadCsvRefresh = async () => {
    try {
      const r = await (await fetch(`/api/stores/${storeId}/full`, { credentials: 'same-origin' })).json();
      onData({ products: r.products, categories: r.categories, locations: r.locations });
    } catch { /* message already shown */ }
  };

  // a pin selected on the map scrolls this product into view and flashes it
  useEffect(() => {
    if (!flashId) return;
    setQ('');
    const t = setTimeout(() => flashRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
    return () => clearTimeout(t);
  }, [flashId]);

  const [catFilter, setCatFilter] = useState<'all' | 'none' | string>('all');
  const filtered = products.filter(
    (p) =>
      `${p.name} ${p.brand} ${p.sku} ${p.category_name ?? ''}`.toLowerCase().includes(q.toLowerCase()) &&
      (catFilter === 'all' || (catFilter === 'none' ? !p.category_id : p.category_id === catFilter))
  );
  const countByCat = new Map<string | null, number>();
  for (const p of products) countByCat.set(p.category_id, (countByCat.get(p.category_id) ?? 0) + 1);

  const addCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCat.trim()) return;
    const palette = ['#3b6fd4', '#c2453a', '#7a4fd4', '#b98a2f', '#2f8a7d', '#c25a8a'];
    const { category } = await api.addCategory(storeId, {
      name: newCat.trim(),
      color: palette[categories.length % palette.length],
    });
    onData({ categories: [...categories, category] });
    setNewCat('');
  };

  const removeCategory = async (id: string) => {
    await api.deleteCategory(id);
    onData({ categories: categories.filter((c) => c.id !== id) });
  };

  const removeProduct = async (id: string) => {
    await api.deleteProduct(id);
    onData({
      products: products.filter((p) => p.id !== id),
      locations: locations.filter((l) => l.product_id !== id),
    });
  };

  const unpin = async (productId: string) => {
    const loc = locations.find((l) => l.product_id === productId);
    if (!loc) return;
    await api.deleteLocation(loc.id);
    onData({ locations: locations.filter((l) => l.id !== loc.id) });
  };

  return (
    <div>
      <div className="panel-section">
        <div className="row-between">
          <h4 style={{ margin: 0 }}>Products</h4>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn sm" onClick={() => setCsvOpen((v) => !v)} title="Import products from CSV">⇪ CSV</button>
            <button className="btn primary sm" onClick={() => setEditing('new')}>+ Add</button>
          </div>
        </div>
        <input className="input" style={{ marginTop: 8 }} placeholder="Filter products…" value={q} onChange={(e) => setQ(e.target.value)} />
        {categories.length > 0 && (
          <div className="chips" style={{ marginTop: 8 }} role="group" aria-label="Filter by category">
            <button
              className={`cat-chip ${catFilter === 'all' ? 'active' : ''}`}
              onClick={() => setCatFilter('all')}
            >
              All · {products.length}
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                className={`cat-chip ${catFilter === c.id ? 'active' : ''}`}
                style={catFilter === c.id ? { color: c.color } : undefined}
                onClick={() => setCatFilter((cur) => (cur === c.id ? 'all' : c.id))}
                title={`Show only ${c.name}`}
              >
                <span className="swatch" style={{ background: c.color }} />
                {c.name} · {countByCat.get(c.id) ?? 0}
              </button>
            ))}
            {(countByCat.get(null) ?? 0) > 0 && (
              <button
                className={`cat-chip ${catFilter === 'none' ? 'active' : ''}`}
                onClick={() => setCatFilter((cur) => (cur === 'none' ? 'all' : 'none'))}
              >
                Uncategorized · {countByCat.get(null)}
              </button>
            )}
          </div>
        )}
        {checked.size > 0 && (
          <div className="multi-row" style={{ marginTop: 8 }}>
            <span className="muted" style={{ fontSize: 12.5 }}>{checked.size} selected</span>
            <button className="btn primary sm" onClick={() => { onQueueMany([...checked]); setChecked(new Set()); }}>
              📍 Pin {checked.size} on map
            </button>
            <button className="btn sm ghost" onClick={() => setChecked(new Set())}>Clear</button>
          </div>
        )}
        {csvOpen && (
          <div className="csv-box" style={{ marginTop: 8 }}>
            <textarea
              className="input"
              rows={5}
              placeholder="Paste CSV with a header row: name, sku, barcode, brand, price, quantity, category"
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
            />
            <div className="multi-row" style={{ marginTop: 6 }}>
              <button
                className="btn primary sm"
                disabled={!csvText.trim()}
                onClick={async () => {
                  setCsvMsg('Importing…');
                  try {
                    const r = await api.importCsv(storeId, csvText);
                    setCsvMsg(`Imported ${r.imported} of ${r.total} rows.`);
                    setCsvText('');
                    await loadCsvRefresh();
                  } catch (e) {
                    setCsvMsg(e instanceof Error ? e.message : 'Import failed');
                  }
                }}
              >
                Import
              </button>
              <a className="btn sm ghost" href={`/api/stores/${storeId}/catalog.csv`} download>Export</a>
            </div>
            {csvMsg && <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>{csvMsg}</p>}
          </div>
        )}
      </div>

      <div className="panel-section">
        {filtered.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>
            {products.length === 0
              ? 'No products yet. Add your top sellers first — shoppers search by these names.'
              : 'No products match this filter.'}
          </p>
        ) : (
          <div className="products-scroll">
          {filtered.map((p) => {
            const loc = locations.find((l) => l.product_id === p.id);
            return (
              <div
                className="product-item"
                key={p.id}
                ref={flashId === p.id ? flashRef : undefined}
                style={flashId === p.id
                  ? { borderColor: 'var(--green)', boxShadow: '0 0 0 3px rgba(47,111,62,0.25)' }
                  : placingId === p.id
                    ? { borderColor: 'var(--green)', boxShadow: '0 0 0 3px rgba(47,111,62,0.15)' }
                    : undefined}
              >
                <input
                  type="checkbox"
                  checked={checked.has(p.id)}
                  title="Select for bulk pinning"
                  onChange={() =>
                    setChecked((prev) => {
                      const next = new Set(prev);
                      if (next.has(p.id)) next.delete(p.id);
                      else next.add(p.id);
                      return next;
                    })
                  }
                />
                <span className="dot" style={{ background: p.category_color || '#2f6f3e' }} />
                <div className="name">
                  <b title={p.name}>{p.name}</b>
                  <span>{[p.brand, p.price != null ? `$${p.price.toFixed(2)}` : ''].filter(Boolean).join(' · ')}</span>
                </div>
                <div className="product-actions">
                  {loc ? (
                    <button className="btn sm ghost" title="Remove pin" onClick={() => unpin(p.id)}>📍 ✓</button>
                  ) : (
                    <span className="pin-flag none">unpinned</span>
                  )}
                  <button className="btn sm" title="Place / move pin on map" onClick={() => onStartPlacing(p.id)}>📍</button>
                  <button className="btn sm" title="Edit product" onClick={() => setEditing(p)}>✎</button>
                  <button className="btn sm danger" title="Delete product" onClick={() => removeProduct(p.id)}>✕</button>
                </div>
              </div>
            );
          })}
          </div>
        )}
      </div>

      <div className="panel-section">
        <h4>Categories</h4>
        <div className="chips" style={{ marginBottom: 8 }}>
          {categories.map((c) => (
            <span key={c.id} className="cat-chip">
              <span className="swatch" style={{ background: c.color }} />
              {c.name}
              <button className="btn ghost sm" style={{ padding: '0 2px' }} title="Delete category" onClick={() => removeCategory(c.id)}>✕</button>
            </span>
          ))}
          {categories.length === 0 && <span className="muted" style={{ fontSize: 13 }}>No categories yet.</span>}
        </div>
        <form onSubmit={addCategory} style={{ display: 'flex', gap: 6 }}>
          <input className="input" placeholder="New category…" value={newCat} onChange={(e) => setNewCat(e.target.value)} />
          <button className="btn sm">Add</button>
        </form>
      </div>

      {editing && (
        <ProductModal
          storeId={storeId}
          entitlements={entitlements}
          categories={categories}
          product={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(p) => {
            onData({
              products: editing === 'new' ? [...products, p] : products.map((x) => (x.id === p.id ? p : x)),
            });
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function ProductModal({
  storeId, categories, product, onClose, onSaved, entitlements,
}: {
  storeId: string;
  categories: Category[];
  product: Product | null;
  onClose: () => void;
  onSaved: (p: Product) => void;
  entitlements?: { productImages: boolean };
}) {
  const api = useEditorApi();
  const [name, setName] = useState(product?.name ?? '');
  const [brand, setBrand] = useState(product?.brand ?? '');
  const [sku, setSku] = useState(product?.sku ?? '');
  const [price, setPrice] = useState(product?.price != null ? String(product.price) : '');
  const [categoryId, setCategoryId] = useState(product?.category_id ?? '');
  const [imageUrl, setImageUrl] = useState(product?.image_url ?? '');
  const [imgBusy, setImgBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const pickImage = async (file: File | undefined) => {
    if (!file || !product) return; // images attach to saved products
    setImgBusy(true);
    setError('');
    try {
      const { product: updated } = await api.productImage(product.id, file);
      setImageUrl(updated.image_url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setImgBusy(false);
    }
  };

  /** Local background removal: flood out the studio backdrop, keep the product. */
  const removeBg = async () => {
    if (!product || !imageUrl) return;
    setImgBusy(true);
    setError('');
    try {
      const blob = await removeBackground(imageUrl);
      if (!blob) throw new Error('Could not process that image');
      const file = new File([blob], 'product.png', { type: 'image/png' });
      const { product: updated } = await api.productImage(product.id, file);
      setImageUrl(updated.image_url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Background removal failed');
    } finally {
      setImgBusy(false);
    }
  };

  const clearImage = async () => {
    if (!product) return;
    setImgBusy(true);
    setError('');
    try {
      await api.removeProductImage(product.id);
      setImageUrl('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setImgBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const body = {
      name,
      brand,
      sku,
      price: price === '' ? null : Number(price),
      category_id: categoryId || null,
    };
    try {
      const { product: saved } = product
        ? await api.updateProduct(product.id, body)
        : await api.addProduct(storeId, body);
      const cat = categories.find((c) => c.id === (categoryId || null));
      onSaved({ ...saved, category_name: cat?.name, category_color: cat?.color });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={product ? 'Edit product' : 'Add product'} onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Name">
          <input className="input" autoFocus required value={name} onChange={(e) => setName(e.target.value)} placeholder="Organic Whole Milk 1L" />
        </Field>
        <div className="field-row">
          <Field label="Brand">
            <input className="input" value={brand} onChange={(e) => setBrand(e.target.value)} />
          </Field>
          <Field label="SKU / barcode">
            <input className="input" value={sku} onChange={(e) => setSku(e.target.value)} />
          </Field>
        </div>
        <div className="field-row">
          <Field label="Price">
            <input className="input" type="number" step="0.01" min="0" value={price} onChange={(e) => setPrice(e.target.value)} />
          </Field>
          <Field label="Category">
            <select className="select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">— none —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Photo">
          {entitlements?.productImages ? (
            product ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {imageUrl ? (
                  <img src={imageUrl} alt="" width={54} height={54} style={{ borderRadius: 8, objectFit: 'cover', border: '1px solid var(--line)', background: 'var(--chip)' }} />
                ) : (
                  <div style={{ width: 54, height: 54, borderRadius: 8, border: '1px dashed var(--line)', display: 'grid', placeItems: 'center', color: 'var(--ink-soft)', fontSize: 18 }}>?</div>
                )}
                <label className="btn sm" title="Use the device camera">
                  📷 Take photo
                  <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => { pickImage(e.target.files?.[0]); e.target.value = ''; }} />
                </label>
                <label className="btn sm" title="Choose an image file">
                  🖼 Upload
                  <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { pickImage(e.target.files?.[0]); e.target.value = ''; }} />
                </label>
                {imageUrl && (
                  <button type="button" className="btn sm" disabled={imgBusy} onClick={removeBg} title="Cut the studio background out right in this browser">
                    ✂ Remove background
                  </button>
                )}
                {imageUrl && <button type="button" className="btn sm danger" disabled={imgBusy} onClick={clearImage}>Remove</button>}
                {imgBusy && <span className="muted" style={{ fontSize: 12 }}>Working…</span>}
              </div>
            ) : (
              <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>Save the product first, then add its photo.</p>
            )
          ) : (
            <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
              Product photos are part of the paid plan — or self-host StoreMap (local mode) to include them.
            </p>
          )}
        </Field>
        {error && <div className="error-note">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || !name.trim()}>{busy ? 'Saving…' : 'Save product'}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------- Store panel ---------------- */

function StorePanel({
  store, productCount, onUpdated, onDeleted, tryMode = false,
}: { store: Store; productCount: number; onUpdated: (s: Store) => void; onDeleted: () => void; tryMode?: boolean }) {
  const api = useEditorApi();
  const [form, setForm] = useState({
    name: store.name, address: store.address, description: store.description,
    phone: store.phone, website: store.website, hours: store.hours,
  });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [qrSrc, setQrSrc] = useState('');
  // QR encodes the server-canonical public url — never window.location,
  // so an embedding host can't hijack the code to its own domain.
  const publicUrl = store.shareUrl || `${window.location.origin}/s/${store.slug}`;
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.value });

  useEffect(() => {
    QRCode.toDataURL(publicUrl, { width: 300, margin: 1 }).then(setQrSrc);
  }, [publicUrl]);

  const save = async () => {
    setBusy(true);
    try {
      const { store: s } = await api.updateStore(store.id, form);
      onUpdated(s);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } finally {
      setBusy(false);
    }
  };

  const uploadLogo = async (file: File) => {
    const { url } = await api.uploadImage(file, store.id);
    const { store: s } = await api.updateStore(store.id, { logo_url: url });
    onUpdated(s);
  };

  return (
    <div>
      <div className="panel-section">
        <h4>Store details</h4>
        <Field label="Name"><input className="input" value={form.name} onChange={set('name')} /></Field>
        <Field label="Address"><input className="input" value={form.address} onChange={set('address')} /></Field>
        <Field label="Opening hours"><input className="input" value={form.hours} onChange={set('hours')} placeholder="Mon–Sat 8:00–21:00" /></Field>
        <Field label="Phone"><input className="input" value={form.phone} onChange={set('phone')} /></Field>
        <Field label="Website"><input className="input" value={form.website} onChange={set('website')} /></Field>
        <Field label="Description">
          <textarea className="textarea" rows={3} value={form.description} onChange={set('description')} />
        </Field>
        <div className="stack">
          <label className="btn">
            Upload logo
            <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])} />
          </label>
          <button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : saved ? 'Saved ✓' : 'Save store details'}</button>
        </div>
      </div>

      {tryMode ? (
        <div className="panel-section">
          <h4>Publish</h4>
          <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
            Publishing, the shopper link and the printable QR become available once you save this store
            with an account. Your map is still fully editable — export it and import it after signing up.
          </p>
        </div>
      ) : (
        <div className="panel-section">
          <h4>Publish</h4>
          <div className="row-between" style={{ marginBottom: 8 }}>
            <span>Visible to shoppers</span>
            <label className="toggle">
              <input type="checkbox" checked={store.is_public} onChange={async (e) => onUpdated((await api.updateStore(store.id, { is_public: e.target.checked })).store)} />
              <span className="track" />
            </label>
          </div>
          <div className="public-link-row" style={{ marginBottom: 8 }}>
            <code>{publicUrl}</code>
            <button className="btn sm" onClick={() => navigator.clipboard.writeText(publicUrl)}>Copy</button>
          </div>
          {qrSrc && <img src={qrSrc} alt="QR code" width={130} height={130} style={{ imageRendering: 'pixelated' }} />}
          <p className="muted" style={{ fontSize: 12.5 }}>
            {productCount} products mapped. Print the QR code for the entrance once your map is public.
          </p>
        </div>
      )}

      {!tryMode && (
        <div className="panel-section">
          <h4>Danger zone</h4>
          <button
            className="btn danger"
            onClick={async () => {
              if (confirm(`Delete “${store.name}” and all of its maps?`)) {
                await api.deleteStore(store.id);
                onDeleted();
              }
            }}
          >
            Delete store
          </button>
        </div>
      )}
    </div>
  );
}

function parseMeta(meta: string): Record<string, any> {
  try {
    const v = JSON.parse(meta || '{}');
    return typeof v === 'object' && v !== null ? v : {};
  } catch {
    return {};
  }
}
