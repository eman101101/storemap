import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { api } from '../api';
import { LocalSession, type EditorApi } from '../localStore';
import MapCanvas, { TOOL_DEF, TYPE_COLOR, type EditorTool } from './MapCanvas';
import Map3D from './Map3D';
import ShelfDetail from './ShelfDetail';
import ShelfItemPicker from './ShelfItemPicker';
import CropModal from './CropModal';
import GroupCreatorModal, { type GroupItemDraft } from './GroupCreatorModal';
import type {
  Category, Floor, MapElement, Product, ProductLocation, RectGeom, Store,
} from '../types';
import { elementToRow, parseElement } from '../types';
import { bboxOf, elementPoints, translateElement, type Viewport, type WorldPt } from '../lib/geometry';
import { fitCamera, MODERN_THEME, DARK_THEME, DIST_MIN, DIST_MAX, type Camera3D } from '../lib/render3d';
import { useTheme } from '../theme';
import { CameraCaptureModal, CameraPad, CameraToggle, Field, Modal, ZoomPad } from './ui';
import { removeBackground } from '../lib/imageBg';
import { defaultWeek, parseStoreHours, serializeWeek, WEEK_DAYS, type DayHours, type WeekDay, type WeekHours } from '../lib/storeHours';
import { useLoginModal } from '../App';
import { EditorTour, GlossaryModal, type TourStep } from './EditorHelp';
import { findFreeFacingU, shelfLocalToWorld, shelfLevels, worldToShelfLocal } from '../lib/shelfLayout';
import { GROUP_FACING_W, groupPrice } from '../lib/itemGroups';

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
  { id: 'wall', label: 'Wall', icon: '▥', group: 'draw' },
  { id: 'aisle', label: 'Aisle / Zone', icon: '▣', group: 'mark' },
  { id: 'entrance', label: 'Entrance', icon: '⬆', group: 'point' },
  { id: 'poi', label: 'Interest points', icon: '★', group: 'point' },
  { id: 'product', label: 'Add item group', icon: '🧺', group: 'point' },
];

const TOOL_HINTS: Partial<Record<EditorTool, string>> = {
  select: 'Drag to move · drag handles to resize/rotate · arrow keys nudge · drag empty space to pan',
  shelf: 'Drag to draw a shelf rectangle (or click for a default size)',
  wall: 'Drag to draw a wall segment',
  'wall-line': 'Click to add wall vertices · hold Shift for straight runs · Enter to finish',
  aisle: 'Drag to draw an aisle / zone rectangle (click for a default size) · label it in the panel',
  entrance: 'Click to place the entrance marker',
  poi: 'Click to place a point of interest',
  product: 'Click a shelf to add an item group to it · switch to Single for one item · Esc cancels',
};

/** A starter skeleton sized to the floor: outer walls, an entrance and blank
 *  shelf pairs with aisle label strips. Everything stays editable — reshape,
 *  rename, then pin products. */
export function blankShelfTemplate(floorId: string, W: number, H: number, zBase: number): MapElement[] {
  const els: MapElement[] = [];
  let z = zBase;
  const add = (type: MapElement['type'], shape: MapElement['shape'], geom: MapElement['geom'], label = '') =>
    els.push({ id: crypto.randomUUID(), floor_id: floorId, type, shape, geom, label, color: '', meta: '{}', z_index: z++ });

  // walls ship unlabeled — the owner names them from the panel if wanted
  add('wall', 'rect', { x: 0, y: 0, w: W, h: 0.4, rot: 0 });
  add('wall', 'rect', { x: 0, y: H - 0.4, w: W, h: 0.4, rot: 0 });
  add('wall', 'rect', { x: 0, y: 0, w: 0.4, h: H, rot: 0 });
  add('wall', 'rect', { x: W - 0.4, y: 0, w: 0.4, h: H, rot: 0 });
  add('entrance', 'point', { x: W / 2, y: H - 1 }, 'Entrance');

  // shelf pairs facing each other across a 1.5 m aisle, scaled to the floor
  const len = Math.min(W - 6, 18);
  const x0 = (W - len) / 2;
  const pairs = Math.max(1, Math.min(4, Math.floor((H - 6) / 4.9)));
  for (let i = 0; i < pairs; i++) {
    const y0 = 4 + i * 4.9;
    if (y0 + 2.9 > H - 3) break;
    add('shelf', 'rect', { x: x0, y: y0, w: len, h: 0.7, rot: 0 }, `Aisle ${i + 1}`);
    add('shelf', 'rect', { x: x0, y: y0 + 2.2, w: len, h: 0.7, rot: 0 }, `Aisle ${i + 1}`);
    add('aisle', 'polyline', [[x0, y0 + 1.45], [x0 + len, y0 + 1.45]], `Aisle ${i + 1}`);
  }
  return els;
}

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
  /** Selecting on the map auto-shows the element panel only on desktop —
   *  on phone/tablet the panel is a drawer that would cover the map. */
  const autoShowPanel = () => {
    if (window.matchMedia('(max-width: 860px)').matches) return;
    showTab('map');
  };

  const switchSide = (open: boolean) => {
    setSideOpen(open);
    try {
      localStorage.setItem('storemap.side', open ? 'open' : 'closed');
    } catch { /* private mode */ }
  };
  /** map interactions that need details pull the drawer out automatically */
  const showTab = (t: SideTab) => {
    setSideTab(t);
    // on phone/tablet the panel is a drawer over the map — map-driven opens
    // (select, pin click) don't pop it; the edge handle opens it on demand
    if (window.matchMedia('(max-width: 860px)').matches) return;
    setSideOpen(true);
  };
  const [flashProductId, setFlashProductId] = useState<string | null>(null);
  const [placeProductId, setPlaceProductId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [loadError, setLoadError] = useState('');
  // 3D edit view: same elements/selection/undo pipeline, different viewport.
  // The editor always opens in 2D — that's where objects are placed.
  const [view3d, setView3d] = useState(false);
  const [cam3d, setCam3d] = useState<Camera3D | null>(null);
  const [focus3d, setFocus3d] = useState<{ id: string; seq: number } | null>(null);
  const [showControls, setShowControls] = useState(false);
  // the 3D camera pad starts hidden behind the struck-through camera toggle
  const [camPadOpen, setCamPadOpen] = useState(false);
  // onboarding tour + glossary; the tour offers itself once per device
  const [exportOpen, setExportOpen] = useState(false);
  const [hideLabels, setHideLabels] = useState(false);
  // lock toggle: items unselectable/unmovable so the map can be panned freely
  const [locked, setLocked] = useState(false);
  // map right-click menu
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(() => {
    try {
      return localStorage.getItem('storemap.tour.seen') !== '1';
    } catch {
      return false;
    }
  });
  const dragOrig3d = useRef<MapElement | null>(null);
  // gesture-start snapshot: containment for pin-follow is evaluated against
  // where the shelf was when the gesture BEGAN, so a shelf dragged across other
  // shelves can't Hoover up their products
  const pinGestureBase = useRef<MapElement[] | null>(null);
  const pinSaveTimer = useRef<number | null>(null);
  const pendingPinSaves = useRef<{ productId: string; locationId?: string; x: number; y: number; floorId: string; shelfId?: string; shelfLevel?: number; facingW?: number; pinW?: number; pinH?: number }[]>([]);
  const { resolved } = useTheme();
  const sceneTheme = resolved === 'dark' ? DARK_THEME : MODERN_THEME;
  const [shelfPreviewId, setShelfPreviewId] = useState<string | null>(null);
  /** shelf whose "＋ Add item" picker is open (renders in front of the planogram modal) */
  const [itemPickerFor, setItemPickerFor] = useState<string | null>(null);
  /** Add-item-group tool: fill a shelf with a named group, or place one item */
  const [addMode, setAddMode] = useState<'group' | 'single'>('group');
  /** shelf whose group creator is open (Add-item-group tool) */
  const [groupCreatorFor, setGroupCreatorFor] = useState<string | null>(null);
  /** transient map hint (e.g. "Pick a shelf — the group is added to it") */
  const [hintFlash, setHintFlash] = useState<string | null>(null);
  // a product pin selected on the map — shows the pin card (size + planogram)
  // in the side panel's Map tab
  const [selectedPinProductId, setSelectedPinProductId] = useState<string | null>(null);
  // the Products tab filters to the selected pin's group until cleared —
  // selecting another pin re-arms it
  const [productsGroupOpen, setProductsGroupOpen] = useState(true);
  const selectPin = (productId: string) => {
    setFlashProductId(productId);
    setSelectedPinProductId(productId);
    setProductsGroupOpen(true);
  };
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
  // create-from-map flow: the spot (and its new/target area) the product form
  // should pin into once the item is saved
  const [newItemAt, setNewItemAt] = useState<{ x: number; y: number; shelfId?: string } | null>(null);
  // group-move confirmations: a pin dropped on another group, or a shelf
  // (with its items) dropped onto another — cancel reverses the move

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

  // ---- items / groups visibility ----
  // Groups view (items hidden) is the perf mode for heavy floors: the map
  // shows fixtures + department area labels and only the focused/selected
  // pins. null = no explicit choice yet — heavy floors default to groups.
  const [itemsPref, setItemsPref] = useState<boolean | null>(() => {
    try {
      const v = localStorage.getItem('storemap.showItems');
      return v == null ? null : v === '1';
    } catch {
      return null; // private mode — fall back to the pin-count heuristic
    }
  });
  const ITEMS_HEAVY = 800;
  const showItems = itemsPref ?? visibleFloorPins.length <= ITEMS_HEAVY;
  const toggleShowItems = () => {
    setItemsPref((cur) => {
      const next = !(cur ?? visibleFloorPins.length <= ITEMS_HEAVY);
      try { localStorage.setItem('storemap.showItems', next ? '1' : '0'); } catch { /* private mode */ }
      return next;
    });
  };


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
    (saves: { productId: string; locationId?: string; x: number; y: number; floorId: string; shelfId?: string; shelfLevel?: number; facingW?: number; pinW?: number; pinH?: number }[]) => {
      if (!saves.length) return;
      pendingPinSaves.current = [
        ...pendingPinSaves.current.filter((s) => !saves.some((n) => (n.locationId ?? n.productId) === (s.locationId ?? s.productId))),
        ...saves,
      ];
      if (pinSaveTimer.current) window.clearTimeout(pinSaveTimer.current);
      pinSaveTimer.current = window.setTimeout(() => {
        for (const s of pendingPinSaves.current) {
          apix.setProductLocation(s.productId, { floor_id: s.floorId, locationId: s.locationId, x: s.x, y: s.y, shelfId: s.shelfId, shelfLevel: s.shelfLevel, facingW: s.facingW, pinW: s.pinW, pinH: s.pinH })
            .catch(() => { /* keep the optimistic position */ });
        }
        pendingPinSaves.current = [];
      }, 700);
    },
    []
  );

  /** Build a pin save that MOVES the existing pin (locationId) and carries its
   *  planogram placement forward — the server rebuilds meta from the fields we
   *  send, so a save without them would erase shelf_level / facing width and
   *  a save without locationId would INSERT a duplicate pin. */
  const pinSaveFrom = useCallback(
    (loc: ProductLocation, x: number, y: number, shelfId?: string) => {
      let m: Record<string, unknown> = {};
      try { m = JSON.parse(loc.meta || '{}'); } catch { /* keep {} */ }
      return {
        productId: loc.product_id,
        locationId: loc.id,
        x, y,
        floorId: loc.floor_id,
        shelfId: shelfId ?? ownerOf(loc) ?? metaOwnerOf(loc) ?? undefined,
        ...(typeof m.shelf_level === 'number' ? { shelfLevel: m.shelf_level } : {}),
        ...(typeof m.w === 'number' ? { facingW: m.w } : {}),
        ...(typeof m.pinW === 'number' ? { pinW: m.pinW } : {}),
        ...(typeof m.pinH === 'number' ? { pinH: m.pinH } : {}),
      };
    },
    [ownerOf, metaOwnerOf]
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
        // a shelf dropped onto another shelf does NOT merge groups — its pins
        // keep their own group and just follow the shelf. Moving an item
        // between groups is a deliberate per-item drag onto the other shelf.
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
          pinFollows.map((f) => pinSaveFrom(f.location, f.x, f.y))
        );
      }
      dirtyRef.current = true;
      setSaveState('dirty');
    },
    [elements, floor, locations, schedulePinSaves, pinSaveFrom]
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

  const { openLogin } = useLoginModal();
  const closeTour = useCallback(() => {
    setTourOpen(false);
    try {
      localStorage.setItem('storemap.tour.seen', '1');
    } catch {
      /* private mode */
    }
  }, []);

  const tourSteps = useMemo<TourStep[]>(() => [
    {
      title: 'Building a map, step by step',
      body: 'Draw the room in 2D, stock it with products, then walk it in 3D. Arrow keys work too — Skip tour ends it anytime.',
    },
    {
      selector: '.tool-rail',
      title: 'Pick a tool — things are placed in 2D',
      body: 'Choose a tool (Shelf, Wall, Zone, Label, Entrance, Interest points, Product pin), then drag on the map to place it — or click once for a default-sized object.',
    },
    {
      selector: '.tool-hint',
      title: 'The hint line explains the active tool',
      body: 'Drag objects to move them, the round handles to resize or rotate, arrow keys to nudge. Delete removes whatever is selected.',
    },
    {
      selector: '.side-tabs',
      title: 'Products live in the Products tab',
      body: 'Add categories and products, pick one, then use the 📍 Product pin tool and click a spot on a shelf — the exact spot decides where the item sits in the shelf layout.',
    },
    {
      selector: '.view-toggle',
      title: '2D ⇄ 3D, same map',
      body: '2D is for drawing; 3D is the shopper’s-eye walkthrough of the very same objects. Next, the 3D controls.',
    },
    {
      selector: '.pan-pad',
      title: 'Editing in 3D',
      body: 'Drag to orbit, click a fixture to select it and drag to move it — the change applies everywhere. The camera pad pans the view.',
      action: () => switchView3d(true),
      settleMs: 600,
    },
    {
      selector: '.zoom-column',
      title: 'Zoom, and refit',
      body: 'Zoom in / Zoom out step the camera — the mouse wheel works too. ⤢ Re center in the top bar puts the whole floor back on screen.',
    },
    {
      title: tryMode
        ? 'The sandbox saves on this device'
        : 'Signed-in changes save automatically',
      body: tryMode
        ? 'Use ⬇ Export to download the map as a transfer bundle (.json) — import it on any device or instance to restore it.'
        : 'The badge in the top bar shows saved / saving / unsaved. ⬇ Export downloads a transfer bundle anytime.',
    },
    {
      title: 'Reopen anytime',
      body: '🎓 Tutorial restarts this walkthrough and 📖 Glossary explains every label you can see. You’re ready to build.',
    },
  ], [tryMode, switchView3d]);

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
        .map((pl) => pinSaveFrom(pl, pl.x, pl.y, metaOwnerOf(pl) ?? undefined))
    );
    dirtyRef.current = true;
    setSaveState('dirty');
    setSelectedId(null);
  }, [elements, floor, floorElements, locations, schedulePinSaves, deriveOwners, metaOwnerOf, pinSaveFrom]);

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
        .map((pl) => pinSaveFrom(pl, pl.x, pl.y, metaOwnerOf(pl) ?? undefined))
    );
    dirtyRef.current = true;
    setSaveState('dirty');
  }, [elements, floor, floorElements, locations, schedulePinSaves, deriveOwners, metaOwnerOf, pinSaveFrom]);

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
  // targetShelfId comes from hovering a group while placing (MapCanvas);
  // otherwise the click point decides via geometric containment.
  const placeProduct = async (p: WorldPt, targetShelfId?: string | null) => {
    if (!floor) return;
    // Add-item tool with nothing pre-selected: GROUP mode fills the hovered
    // shelf with a named group of items; SINGLE mode creates one item. An
    // item doesn't NEED a shelf — clicking empty space places a free pin and
    // never auto-creates a shelf area.
    if (!placeProductId) {
      const shelfId = targetShelfId ?? shelfIdAtPoint(p, floorElements) ?? undefined;
      if (addMode === 'group') {
        if (!shelfId) {
          flashHint('Pick a shelf — the group is added to it');
          return;
        }
        setGroupCreatorFor(shelfId);
        return;
      }
      setNewItemAt({ x: p.x, y: p.y, shelfId });
      setTool('select');
      return;
    }
    const shelfId = targetShelfId ?? shelfIdAtPoint(p, floorElements);
    if (tryMode) session?.logAction('pin product');
    try {
      // re-placing an item MOVES its existing pin (products can hold several
      // facings — the planogram's Add copy makes new ones)
      const existing = locations.find((l) => l.product_id === placeProductId && l.floor_id === floor.id);
      const { location } = await apix.setProductLocation(placeProductId, { floor_id: floor.id, x: p.x, y: p.y, locationId: existing?.id, shelfId: shelfId ?? undefined });
      stampOwner(location.id, shelfId);
      setLocations((prev) => [
        ...prev.filter((l) => !(l.product_id === placeProductId && l.floor_id === floor.id && l.id !== location.id)),
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

  /** Show a transient hint over the map (Add-item-group guidance). */
  const flashHint = (text: string) => {
    setHintFlash(text);
    window.setTimeout(() => setHintFlash((cur) => (cur === text ? null : cur)), 2600);
  };

  /** Create a group on a shelf: reuse store products picked from the
   *  catalogue, create brand-new ones, then place ONE facing per item on the
   *  bottom row (first free spot, flowing left to right). Facings are never
   *  mass-stocked here — more copies are added one by one from the planogram
   *  editor (＋ Add item / ＋ Add copy). The group's name becomes the shelf's
   *  label. */
  const createGroupOnShelf = async (shelf: MapElement, name: string, items: GroupItemDraft[]) => {
    if (!floor || !store || shelf.shape !== 'rect' || !items.length) return;
    const r = shelf.geom as RectGeom;
    let smeta: Record<string, unknown> = {};
    try { smeta = JSON.parse(shelf.meta || '{}'); } catch { /* keep {} */ }
    const facingW = typeof smeta.facing === 'number' ? smeta.facing : GROUP_FACING_W;
    if (tryMode) session?.logAction('add item group');
    setGroupCreatorFor(null);
    setTool('select');
    // 1) catalogue picks join as-is; brand-new drafts become products
    //    (chunked so a big group doesn't hammer the API)
    const group: Product[] = [];
    const fresh: GroupItemDraft[] = [];
    for (const it of items) {
      const existing = it.productId ? products.find((p) => p.id === it.productId) : null;
      if (existing) group.push(existing);
      else fresh.push(it);
    }
    const created: Product[] = [];
    for (let i = 0; i < fresh.length; i += 6) {
      const made = await Promise.all(fresh.slice(i, i + 6).map(async (it, k) => {
        const price = it.price !== '' && Number.isFinite(Number(it.price)) ? Number(it.price) : groupPrice(it.name, i + k);
        try {
          const { product } = await apix.addProduct(store.id, {
            name: it.name,
            category_id: it.category_id,
            price,
            image_url: '',
            image_crop_url: '',
          });
          return product;
        } catch {
          return null; // surface via save state; keep filling with the rest
        }
      }));
      for (const p of made) if (p) created.push(p);
    }
    group.push(...created);
    if (!group.length) return;
    const catById = new Map(categories.map((c) => [c.id, c]));
    const withCat: Product[] = group.map((p) => ({
      ...p,
      category_name: p.category_name ?? catById.get(p.category_id ?? '')?.name,
      category_color: p.category_color ?? catById.get(p.category_id ?? '')?.color,
    }));
    setProducts((prev) => [...prev, ...created.filter((p) => !prev.some((q) => q.id === p.id))]);
    // 2) one facing per item — bottom row, first free spot left to right
    const placed: { u: number; w: number }[] = locations
      .filter((l) => l.floor_id === floor.id && ownerOf(l) === shelf.id)
      .map((l) => {
        let m: Record<string, unknown> = {};
        try { m = JSON.parse(l.meta || '{}'); } catch { /* keep {} */ }
        return {
          u: worldToShelfLocal(r, l).x / r.w,
          w: (typeof m.w === 'number' ? m.w : facingW) / r.w,
        };
      });
    const spots: number[] = [];
    for (let k = 0; k < withCat.length; k++) {
      const nearU = k === 0 ? 0 : Math.min(1, spots[k - 1] + facingW / r.w);
      const u = findFreeFacingU(placed, nearU, facingW / r.w);
      placed.push({ u, w: facingW / r.w });
      spots.push(u);
    }
    // 3) place the facings
    const facings: ProductLocation[] = [];
    for (let i = 0; i < spots.length; i += 6) {
      const made = await Promise.all(spots.slice(i, i + 6).map(async (u, k) => {
        const product = withCat[i + k];
        const pt = shelfLocalToWorld(r, u * r.w, r.h / 2);
        try {
          const { location } = await apix.setProductLocation(product.id, {
            floor_id: floor.id, x: pt.x, y: pt.y, shelfId: shelf.id, shelfLevel: 1, facingW,
          });
          stampOwner(location.id, shelf.id);
          return location;
        } catch {
          return null;
        }
      }));
      for (const l of made) if (l) facings.push(l);
    }
    setLocations((prev) => [...prev, ...facings]);
    // the group's name is the shelf's label (groups are named by their owner shelf)
    if (name !== shelf.label) {
      changeElements(
        floorElements.map((el) => (el.id === shelf.id ? { ...el, label: name.slice(0, 80) } : el)),
        'push',
        'rename group'
      );
    }
    flashHint(`Added ${facings.length} item${facings.length === 1 ? '' : 's'} to “${name}” — one facing each; stock more from the planogram`);
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

  /** Drag a product pin: local during the gesture, one API upsert on release.
   *  Dropping it on a DIFFERENT group re-homes it silently — moving items
   *  between groups is this per-item drag, never a bulk shelf merge. */
  const movePin = (locationId: string, productId: string, x: number, y: number, commit: boolean, orig?: { x: number; y: number }) => {
    setLocations((prev) => prev.map((l) => (l.id === locationId ? { ...l, x, y } : l)));
    if (commit) {
      if (!floor) return;
      const cur = locations.find((l) => l.id === locationId);
      const toShelfId = shelfIdAtPoint({ x, y }, floorElements);
      stampOwner(locationId, toShelfId);
      // the server rebuilds meta from the fields we send — carry the pin's
      // planogram placement + size forward so a drag doesn't erase them
      let m: Record<string, unknown> = {};
      try { m = JSON.parse(cur?.meta || '{}'); } catch { /* keep {} */ }
      apix.setProductLocation(productId, {
        floor_id: floor.id, locationId, x, y, shelfId: toShelfId ?? undefined,
        ...(typeof m.shelf_level === 'number' ? { shelfLevel: m.shelf_level } : {}),
        ...(typeof m.w === 'number' ? { facingW: m.w } : {}),
        ...(typeof m.pinW === 'number' ? { pinW: m.pinW } : {}),
        ...(typeof m.pinH === 'number' ? { pinH: m.pinH } : {}),
      })
        .then(({ location }) => setLocations((prev) => prev.map((l) => (l.id === locationId ? location : l))))
        .catch(() => { /* keep the optimistic position; the badge shows save state */ });
    }
  };

  /** Rename a group (the owner shelf's label). */
  const renameGroup = (shelfId: string, label: string) => {
    changeElements(
      floorElements.map((el) => (el.id === shelfId ? { ...el, label: label.slice(0, 80) } : el)),
      'push',
      'rename group'
    );
  };

  /** Create-a-new-product flow anchored at the shelf's centre. */
  const openNewItemFor = (shelf: MapElement) => {
    if (shelf.shape !== 'rect' || !floor) return;
    const r = shelf.geom as RectGeom;
    const p = shelfLocalToWorld(r, r.w * 0.5, r.h / 2);
    setNewItemAt({ x: p.x, y: p.y, shelfId: shelf.id });
  };

  /** Place an existing store product onto this shelf: first FREE spot on the
   *  bottom row, shelf-default facing width. */
  const addExistingToShelf = (productId: string, shelf: MapElement) => {
    if (!floor || shelf.shape !== 'rect') return;
    const r = shelf.geom as RectGeom;
    let smeta: Record<string, unknown> = {};
    try { smeta = JSON.parse(shelf.meta || '{}'); } catch { /* keep {} */ }
    const facingW = typeof smeta.facing === 'number' ? smeta.facing : 1;
    const placed = locations
      .filter((l) => l.floor_id === floor.id && ownerOf(l) === shelf.id)
      .map((l) => {
        let sm: Record<string, unknown> = {};
        try { sm = JSON.parse(l.meta || '{}'); } catch { /* keep {} */ }
        return {
          u: worldToShelfLocal(r, l).x / r.w,
          w: (typeof sm.w === 'number' ? sm.w : facingW) / r.w,
          level: typeof sm.shelf_level === 'number' ? sm.shelf_level : 1,
        };
      })
      .filter((p) => p.level === 1);
    const u = findFreeFacingU(placed, 0.5, facingW / r.w);
    const p = shelfLocalToWorld(r, u * r.w, r.h / 2);
    apix.setProductLocation(productId, {
      floor_id: floor.id, x: p.x, y: p.y, shelfId: shelf.id, shelfLevel: 1, facingW,
    })
      .then(({ location }) => {
        setLocations((prev) => [...prev, location]);
        stampOwner(location.id, shelf.id);
        selectPin(productId);
        setSelectedId(null);
      })
      .catch(() => { /* surface via save state */ });
  };

  /** Resize a pin's on-map marker (metres) — optimistic + debounced save. */
  const setPinSize = (loc: ProductLocation, pinW: number, pinH: number) => {
    let m: Record<string, unknown> = {};
    try { m = JSON.parse(loc.meta || '{}'); } catch { /* keep {} */ }
    setLocations((prev) => prev.map((l) => (l.id === loc.id ? { ...l, meta: JSON.stringify({ ...m, pinW, pinH }) } : l)));
    schedulePinSaves([{
      productId: loc.product_id, locationId: loc.id, x: loc.x, y: loc.y, floorId: loc.floor_id,
      shelfId: ownerOf(loc) ?? undefined,
      ...(typeof m.shelf_level === 'number' ? { shelfLevel: m.shelf_level } : {}),
      ...(typeof m.w === 'number' ? { facingW: m.w } : {}),
      pinW, pinH,
    }]);
  };

  /** One-shot pin save: optimistic state, then the API (moves this exact pin). */
  const persistPinUpdate = (loc: ProductLocation, patch: { x?: number; y?: number; shelfLevel?: number; facingW?: number; pinW?: number; pinH?: number }) => {
    let meta: Record<string, unknown> = {};
    try { meta = JSON.parse(loc.meta || '{}'); } catch { /* fresh */ }
    const shelfLevel = patch.shelfLevel ?? (typeof meta.shelf_level === 'number' ? meta.shelf_level : undefined);
    const facingW = patch.facingW ?? (typeof meta.w === 'number' ? meta.w : undefined);
    const pinW = patch.pinW ?? (typeof meta.pinW === 'number' ? meta.pinW : undefined);
    const pinH = patch.pinH ?? (typeof meta.pinH === 'number' ? meta.pinH : undefined);
    setLocations((prev) =>
      prev.map((l) => {
        if (l.id !== loc.id) return l;
        if (patch.shelfLevel !== undefined) meta.shelf_level = patch.shelfLevel;
        if (patch.facingW !== undefined) meta.w = patch.facingW;
        if (patch.pinW !== undefined) meta.pinW = patch.pinW;
        if (patch.pinH !== undefined) meta.pinH = patch.pinH;
        return { ...l, x: patch.x ?? l.x, y: patch.y ?? l.y, meta: JSON.stringify(meta) };
      })
    );
    apix.setProductLocation(loc.product_id, {
      floor_id: loc.floor_id, locationId: loc.id, x: patch.x ?? loc.x, y: patch.y ?? loc.y,
      shelfId: ownerOf(loc) ?? undefined,
      ...(shelfLevel !== undefined ? { shelfLevel } : {}),
      ...(facingW !== undefined ? { facingW } : {}),
      ...(pinW !== undefined ? { pinW } : {}),
      ...(pinH !== undefined ? { pinH } : {}),
    }).catch(() => { /* keep the optimistic state */ });
  };

  // ---- planogram editor callbacks (ShelfDetail editing mode) ----
  /** Drag commit: place the facing at along-shelf fraction u, row `level`. */
  const moveFacing = (locationId: string, u: number, level: number) => {
    const loc = locations.find((l) => l.id === locationId);
    if (!loc || !shelfPreview || shelfPreview.shape !== 'rect') return;
    const r = shelfPreview.geom as RectGeom;
    const local = { x: Math.min(r.w, Math.max(0, u * r.w)), y: r.h / 2 };
    const p = shelfLocalToWorld(r, local.x, local.y);
    persistPinUpdate(loc, { x: p.x, y: p.y, shelfLevel: level });
  };

  /** Duplicate a facing: same product, first FREE spot beside the original on
   *  the same row — copies used to stack exactly on top of each other and
   *  look like they vanished behind the facing they overlapped. */
  const addFacingCopy = (locationId: string) => {
    const loc = locations.find((l) => l.id === locationId);
    if (!loc || !shelfPreview || !floor || shelfPreview.shape !== 'rect') return;
    const r = shelfPreview.geom as RectGeom;
    let m: Record<string, unknown> = {};
    try { m = JSON.parse(loc.meta || '{}'); } catch { /* keep {} */ }
    const facingW = typeof m.w === 'number' ? m.w : 1;
    const level = typeof m.shelf_level === 'number' ? m.shelf_level : 1;
    const shelfId = ownerOf(loc) ?? shelfPreview.id;
    const curU = worldToShelfLocal(r, loc).x / r.w;
    // occupied spots on this row: every other facing owned by this shelf
    const placed = locations
      .filter((l) => l.id !== loc.id && l.floor_id === floor.id && ownerOf(l) === shelfId)
      .map((l) => {
        let sm: Record<string, unknown> = {};
        try { sm = JSON.parse(l.meta || '{}'); } catch { /* keep {} */ }
        return {
          u: worldToShelfLocal(r, l).x / r.w,
          w: (typeof sm.w === 'number' ? sm.w : 1) / r.w,
          level: typeof sm.shelf_level === 'number' ? sm.shelf_level : 1,
        };
      })
      .filter((p) => p.level === level);
    const u = findFreeFacingU(placed, curU, facingW / r.w);
    const p = shelfLocalToWorld(r, u * r.w, r.h / 2);
    apix.setProductLocation(loc.product_id, {
      floor_id: floor.id, x: p.x, y: p.y, shelfId,
      ...(typeof m.shelf_level === 'number' ? { shelfLevel: m.shelf_level } : {}),
      ...(typeof m.w === 'number' ? { facingW: m.w } : {}),
      ...(typeof m.pinW === 'number' ? { pinW: m.pinW } : {}),
      ...(typeof m.pinH === 'number' ? { pinH: m.pinH } : {}),
    })
      .then(({ location }) => {
        setLocations((prev) => [...prev, location]);
        stampOwner(location.id, shelfId);
      })
      .catch(() => { /* surface via save state */ });
  };

  const removeFacing = (locationId: string) => {
    apix.deleteLocation(locationId).catch(() => { /* keep locally on failure */ });
    setLocations((prev) => prev.filter((l) => l.id !== locationId));
    shelfOwner.current.delete(locationId);
    if (selectedPinProductId) {
      const stillHasPin = locations.some((l) => l.product_id === selectedPinProductId && l.id !== locationId);
      if (!stillHasPin) setSelectedPinProductId(null);
    }
  };

  /** Planogram-only length (metres) — stored as a planogram option on the
   *  shelf's meta. The shelf's footprint on the map is never touched. */
  const resizeShelfArea = (w: number) => {
    if (!shelfPreview) return;
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    let meta: Record<string, unknown> = {};
    try { meta = JSON.parse(shelfPreview.meta || '{}'); } catch { /* keep {} */ }
    changeElements(
      floorElements.map((el) =>
        el.id === shelfPreview.id
          ? { ...el, meta: JSON.stringify({ ...meta, planWidth: clamp(w, 0.3, 60) }) }
          : el
      ),
      'push',
      'set planogram length'
    );
  };

  /** Drawn planogram row height (px) — one band height shared by every view
   *  mode, so toggling diagram/photos/image never resizes the drawing. */
  const setShelfRowH = (rowH: number) => {
    if (!shelfPreview) return;
    const clamped = Math.min(200, Math.max(64, Math.round(rowH)));
    let meta: Record<string, unknown> = {};
    try { meta = JSON.parse(shelfPreview.meta || '{}'); } catch { /* keep {} */ }
    changeElements(
      floorElements.map((el) => (el.id === shelfPreview.id ? { ...el, meta: JSON.stringify({ ...meta, rowH: clamped }) } : el)),
      'push',
      'set planogram row height'
    );
  };

  const changeShelfRows = (levels: number) => {
    if (!shelfPreview) return;
    const clamped = Math.min(8, Math.max(1, Math.round(levels)));
    let meta: Record<string, unknown> = {};
    try { meta = JSON.parse(shelfPreview.meta || '{}'); } catch { /* keep {} */ }
    changeElements(
      floorElements.map((el) => (el.id === shelfPreview.id ? { ...el, meta: JSON.stringify({ ...meta, levels: clamped }) } : el)),
      'push',
      'set shelf rows'
    );
  };

  /** The shelf's default planogram view (diagram / photos / image tiles) —
   *  stored in meta like the other planogram options; shoppers see it as
   *  their starting view but can still toggle for their session. */
  const setPlanogramView = (view: 'diagram' | 'photos' | 'images') => {
    if (!shelfPreview) return;
    let meta: Record<string, unknown> = {};
    try { meta = JSON.parse(shelfPreview.meta || '{}'); } catch { /* keep {} */ }
    changeElements(
      floorElements.map((el) => (el.id === shelfPreview.id ? { ...el, meta: JSON.stringify({ ...meta, planogramView: view }) } : el)),
      'push',
      'set planogram view'
    );
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
  // the pin selected on the map (this floor's pin for that product) + its shelf
  const selectedPin = selectedPinProductId && floor
    ? locations.find((l) => l.product_id === selectedPinProductId && l.floor_id === floor.id) ?? null
    : null;
  const selectedPinShelf = selectedPin && ownerOf(selectedPin)
    ? floorElements.find((e) => e.id === ownerOf(selectedPin)) ?? null
    : null;
  // the selected pin's group: everything pinned to the same shelf, deduped
  // per product (copies collapse into one chip with a ×count)
  const selectedPinGroupAll = selectedPin && selectedPinShelf && floor
    ? locations.filter((l) => l.floor_id === floor.id && ownerOf(l) === selectedPinShelf.id)
    : [];
  const groupFacings = selectedPinGroupAll.length;
  const groupChips = (() => {
    const counts = new Map<string, number>();
    for (const l of selectedPinGroupAll) counts.set(l.product_id, (counts.get(l.product_id) ?? 0) + 1);
    return [...counts.entries()]
      .map(([pid, facings]) => ({ product: products.find((p) => p.id === pid), facings }))
      .filter((c): c is { product: Product; facings: number } => !!c.product);
  })();

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
        <button className="btn sm" onClick={() => setFitSignal((n) => n + 1)} title="Re-center the map on screen">⤢ Re center</button>
        <button className="btn sm" onClick={() => setTourOpen(true)} title="Step-by-step tour of the editor">🎓 Tutorial</button>
        <button className="btn sm" onClick={() => setGlossaryOpen(true)} title="What every label means">📖 Glossary</button>
        {tryMode ? (
          <button className="btn sm" onClick={() => setExportOpen(true)} title="Download this store as a transfer bundle">
            ⬇ Export
          </button>
        ) : (
          <SaveBadge state={saveState} onRetry={() => { setSaveState('dirty'); dirtyRef.current = true; }} />
        )}
      </div>

      {tryMode && (
        <div className="try-banner">
          <span className="try-banner-text">
            Your map is saved <b>on this device only</b>. Create an account to put it online.
          </span>
          <div className="try-banner-actions">
            <button className="btn sm" onClick={() => setExportOpen(true)}>⬇ Export</button>
            <label className="btn sm" title="Import a transfer bundle (.json) into this sandbox">
              ⬆ Import
              <input
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (!f || !session) return;
                  f.text()
                    .then((t) => {
                      const b = JSON.parse(t) as Parameters<LocalSession['importBundle']>[0] & { format?: string };
                      if (b?.format !== 'storemap.export/1') {
                        throw new Error('That file is not a storemap export bundle');
                      }
                      session.importBundle(b);
                      window.location.reload(); // the editor re-reads the sandbox on boot
                    })
                    .catch((err) => alert(err instanceof Error ? err.message : 'Import failed'));
                }}
              />
            </label>
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
            {/* opens the sign-in modal in place — signing in keeps you in this editor */}
            <button className="btn sm primary" onClick={() => openLogin(window.location.pathname)}>
              Save with an account
            </button>
          </div>
        </div>
      )}

      {exportOpen && (
        <Modal title="Export this map?" onClose={() => setExportOpen(false)}>
          <p className="muted" style={{ marginTop: -6 }}>
            This downloads <b>{store.name}</b> as a transfer bundle (.json). Import it on any other
            device or instance to restore or move the map.
          </p>
          <div className="modal-actions">
            <button className="btn" onClick={() => setExportOpen(false)}>Cancel</button>
            <button
              className="btn primary"
              onClick={() => {
                setExportOpen(false);
                session?.exportDownload();
              }}
            >
              ⬇ Download export
            </button>
          </div>
        </Modal>
      )}
      {ctxMenu && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 90 }}
            onPointerDown={() => setCtxMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setCtxMenu(null); }}
          />
          <div className="map-ctx-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }} role="menu">
            <button
              role="menuitem"
              disabled={!selected}
              onClick={() => {
                if (selected) {
                  changeElements(floorElements.filter((e) => e.id !== selected.id), 'push');
                  setSelectedId(null);
                }
                setCtxMenu(null);
              }}
            >
              🗑 Delete selected
            </button>
            <button
              role="menuitem"
              disabled={!selected}
              onClick={() => {
                if (selected) {
                  const copy: MapElement = {
                    ...selected,
                    id: crypto.randomUUID(),
                    geom: shiftGeom(selected.geom),
                    z_index: Math.max(...floorElements.map((e) => e.z_index), 0) + 1,
                  };
                  changeElements([...floorElements, copy], 'push');
                  setSelectedId(copy.id);
                }
                setCtxMenu(null);
              }}
            >
              ⧉ Duplicate selected
            </button>
            <button
              role="menuitem"
              onClick={() => {
                setLocked((v) => !v);
                setCtxMenu(null);
              }}
            >
              {locked ? '🔓 Unlock items' : '🔒 Lock items'}
            </button>
            <button
              role="menuitem"
              onClick={() => {
                setFitSignal((n) => n + 1);
                setCtxMenu(null);
              }}
            >
              ⤢ Re center
            </button>
          </div>
        </>
      )}
      {tourOpen && <EditorTour steps={tourSteps} onClose={closeTour} />}
      {glossaryOpen && <GlossaryModal onClose={() => setGlossaryOpen(false)} />}

      <div className={`editor-body ${sideOpen ? "side-open" : "side-closed"}`}>
        <div className="map-wrap">
          {view3d ? (
            <Map3D
              floor={floor}
              elements={floorElements}
              pins={visibleFloorPins}
              stockPins={visibleFloorPins}
              showItems={showItems}
              pickFilter={pickFilter}
              camera={cam3d}
              onCamera={setCam3d}
              edit
              selectedId={selectedId}
              onSelectElement={(id) => {
                setSelectedId(id);
                if (id) autoShowPanel();
                if (selectedIds.size) setSelectedIds(new Set());
              }}
              onElementDrag={dragElement3d}
              onElementsChange={changeElements}
              onPinClick={(productId) => {
                selectPin(productId);
                setSelectedId(null);
                showTab('map');
              }}
              focusElement={focus3d}
              fitSignal={fitSignal}
              zoomCommand={zoomCmd}
              theme={sceneTheme}
              locked={locked}
            />
          ) : (
            <MapCanvas
              floor={floor}
              elements={floorElements}
              pins={visibleFloorPins}
              showLabels={!hideLabels}
              showItems={showItems}
              showDepartments={!hideLabels && !showItems}
              locked={locked}
              onMapContextMenu={(client) => setCtxMenu({ x: client.x, y: client.y })}
              viewport={viewport}
              onViewport={setViewport}
              edit
              tool={tool}
              selectedId={selectedId}
              draftPts={draftPts}
              onSelect={(id) => {
                setSelectedId(id);
                if (id) { setSelectedPinProductId(null); autoShowPanel(); }
                if (selectedIds.size) setSelectedIds(new Set());
              }}
              onElementsChange={changeElements}
              onAddElement={addElement}
              onDraftAdd={(p) => setDraftPts((d) => [...d, p])}
              onDraftFinish={finishDraft}
              onDraftCancel={() => setDraftPts([])}
              onPlaceProduct={placeProduct}
              placeMode={addMode}
              ownerOfPin={(locId) => {
                const loc = locations.find((l) => l.id === locId);
                return loc ? ownerOf(loc) : null;
              }}
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
                selectPin(productId);
                setSelectedId(null);
                showTab('map');
              }}
              fitSignal={fitSignal}
              zoomCommand={zoomCmd}
            />
          )}
          {/* editing tools as a left icon rail: add-tools, delete, pick filter.
              In 3D only selection works — placement tools are 2D and hide. */}
          <div className="tool-rail" role="toolbar" aria-label="Map editing tools">
            {TOOLS.filter((t) => !view3d || t.id === 'select').map((t) => (
              <button
                key={t.id}
                className={`tool-btn ${tool === t.id ? 'active' : ''}`}
                onClick={() => { setTool(t.id); setSelectedId(t.id === 'select' ? selectedId : null); }}
                aria-label={t.id === 'product' ? 'Add item group — click a shelf to add it, or switch to Single for one item' : t.label}
                data-tip={t.id === 'product' ? 'Add item group (toggle Group/Single next to 2D/3D)' : t.label}
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
            <button
              className={`tool-btn ${hideLabels ? 'active' : ''}`}
              aria-pressed={hideLabels}
              aria-label={hideLabels ? 'Show labels' : 'Hide labels'}
              data-tip={hideLabels ? 'Show labels' : 'Hide labels'}
              onClick={() => setHideLabels((v) => !v)}
            >
              <span aria-hidden>🏷</span>
            </button>
            <button
              className={`tool-btn ${locked ? 'active' : ''}`}
              aria-pressed={locked}
              aria-label={locked ? 'Unlock items' : 'Lock items'}
              data-tip={locked ? 'Unlock items' : 'Lock items — pan only'}
              onClick={() => setLocked((v) => !v)}
            >
              <span aria-hidden>{locked ? '🔒' : '🔓'}</span>
            </button>
            <button
              className={`tool-btn ${!showItems ? 'active' : ''}`}
              aria-pressed={!showItems}
              aria-label={showItems ? 'Hide item pins — show department groups' : 'Show item pins'}
              data-tip={showItems ? 'Hide items — groups + departments only' : 'Show items'}
              onClick={toggleShowItems}
            >
              <span aria-hidden>{showItems ? '🧺' : '🗂'}</span>
            </button>
            {tool === 'select' && (
              <>
                <button
                  className={`tool-btn ${pickFilter === 'all' ? 'active' : ''}`}
                  onClick={() => setPickFilter('all')}
                  aria-label="Select structures"
                  data-tip="Select: Structures"
                >
                  <span aria-hidden>▦</span>
                </button>
                <button
                  className={`tool-btn ${pickFilter === 'products' ? 'active' : ''}`}
                  onClick={() => setPickFilter('products')}
                  aria-label="Select items"
                  data-tip="Select: Items"
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
          {/* the 2D hint hides in 3D — the centered 3D hint takes over, so the
              two never overlap */}
          {!placing && !view3d && <div className="tool-hint">{TOOL_HINTS[tool]}</div>}
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
          {view3d && floor && (camPadOpen ? (
            <CameraPad onMove={cam3dMove} onClose={() => setCamPadOpen(false)} />
          ) : (
            <CameraToggle onOpen={() => setCamPadOpen(true)} />
          ))}
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
          {/* Add-item-group tool: group-fill vs single-item toggle */}
          {tool === 'product' && !placing && !view3d && (
            <div className="view-toggle" style={{ position: 'absolute', top: 10, left: 180, zIndex: 5, boxShadow: 'var(--shadow)' }} role="group" aria-label="Add item mode">
              <button
                className={addMode === 'group' ? 'active' : ''}
                aria-pressed={addMode === 'group'}
                title="Click a shelf to fill it with a named group of items"
                onClick={() => setAddMode('group')}
              >
                🧺 Group
              </button>
              <button
                className={addMode === 'single' ? 'active' : ''}
                aria-pressed={addMode === 'single'}
                title="Click to place one item (works off-shelf too)"
                onClick={() => setAddMode('single')}
              >
                📍 Single
              </button>
            </div>
          )}
          {hintFlash && tool === 'product' && !placing && (
            <div className="map-hint warn-note" style={{ left: '50%', transform: 'translateX(-50%)' }} role="status">
              {hintFlash}
            </div>
          )}
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
              editing
              highlightLocationId={
                selectedPin && ownerOf(selectedPin) === shelfPreview.id ? selectedPin.id : null
              }
              onViewModeChange={setPlanogramView}
              onClose={() => setShelfPreviewId(null)}
              onEditFacing={(locationId, patch) => {
                const loc = locations.find((l) => l.id === locationId);
                if (!loc) return;
                const patchLevel = patch.shelfLevel;
                const patchW = patch.w;
                // optimistic local update, then persist through the pin queue
                setLocations((prev) =>
                  prev.map((l) => {
                    if (l.id !== locationId) return l;
                    let meta: Record<string, unknown> = {};
                    try { meta = JSON.parse(l.meta || '{}') as Record<string, unknown>; } catch { /* fresh */ }
                    if (patchLevel !== undefined) meta.shelf_level = patchLevel;
                    if (patchW !== undefined) meta.w = patchW;
                    return { ...l, meta: JSON.stringify(meta) };
                  })
                );
                schedulePinSaves([
                  {
                    productId: loc.product_id,
                    locationId,
                    x: loc.x,
                    y: loc.y,
                    floorId: loc.floor_id,
                    shelfId: ownerOf(loc) ?? undefined,
                    ...(patchLevel !== undefined ? { shelfLevel: patchLevel } : {}),
                    ...(patchW !== undefined ? { facingW: patchW } : {}),
                  },
                ]);
                dirtyRef.current = true;
                setSaveState('dirty');
              }}
              onMoveFacing={moveFacing}
              onAddCopy={addFacingCopy}
              onRemoveFacing={removeFacing}
              onShelfResize={resizeShelfArea}
              onRowHeightChange={setShelfRowH}
              onRowsChange={changeShelfRows}
              onAddItem={() => setItemPickerFor(shelfPreview.id)}
              onAddAnotherItem={() => openNewItemFor(shelfPreview)}
            />
          )}
          {itemPickerFor && floor && (() => {
            const pickShelf = floorElements.find((e) => e.id === itemPickerFor) ?? null;
            if (!pickShelf) return null;
            return (
              <ShelfItemPicker
                products={products}
                onShelfProductIds={
                  new Set(
                    locations.filter((l) => l.floor_id === floor.id && ownerOf(l) === pickShelf.id).map((l) => l.product_id)
                  )
                }
                onPick={(productId) => {
                  addExistingToShelf(productId, pickShelf);
                  setItemPickerFor(null);
                }}
                onCreateNew={() => {
                  setItemPickerFor(null);
                  openNewItemFor(pickShelf);
                }}
                onClose={() => setItemPickerFor(null)}
              />
            );
          })()}
          {newItemAt && floor && (
            <ProductModal
              onCategoryAdded={(c) => setCategories((prev) => (prev.some((x) => x.id === c.id) ? prev : [...prev, c]))}
              storeId={store.id}
              categories={categories}
              product={null}
              autoPlace={{ floorId: floor.id, x: newItemAt.x, y: newItemAt.y, shelfId: newItemAt.shelfId }}
              onClose={() => setNewItemAt(null)}
              onSaved={(p, placed) => {
                setProducts((prev) => [...prev, p]);
                if (placed) {
                  setLocations((prev) => [...prev, placed]);
                  stampOwner(placed.id, newItemAt.shelfId ?? null);
                }
                setNewItemAt(null);
                // land on the new pin: panel shows the item + its group (the
                // created area stays selectable from the outline)
                selectPin(p.id);
                setSelectedId(null);
                setSideTab('map');
              }}
            />
          )}
          {groupCreatorFor && floor && (() => {
            const shelf = floorElements.find((e) => e.id === groupCreatorFor) ?? null;
            if (!shelf) return null;
            return (
              <GroupCreatorModal
                shelfLabel={shelf.label}
                categories={categories}
                products={products}
                shelfProductIds={
                  new Set(
                    locations.filter((l) => l.floor_id === floor.id && ownerOf(l) === shelf.id).map((l) => l.product_id)
                  )
                }
                onCreate={(name, items) => createGroupOnShelf(shelf, name, items)}
                onClose={() => setGroupCreatorFor(null)}
              />
            );
          })()}
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
            <button className={`side-tab ${sideTab === 'products' ? 'active' : ''}`} onClick={() => setSideTab('products')}>Items</button>
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
                />
              ) : selectedPin ? (
                <PinPanel
                  location={selectedPin}
                  product={products.find((p) => p.id === selectedPin.product_id) ?? null}
                  ownerShelf={selectedPinShelf}
                  groupChips={groupChips}
                  groupFacings={groupFacings}
                  onSelectMember={(productId) => selectPin(productId)}
                  onRenameGroup={selectedPinShelf ? (label) => renameGroup(selectedPinShelf.id, label) : undefined}
                  onSize={(w, h) => setPinSize(selectedPin, w, h)}
                  onEditPlanogram={selectedPinShelf ? () => setShelfPreviewId(selectedPinShelf.id) : undefined}
                  onAddAnother={selectedPinShelf ? () => {
                    // create the next product just right of the selected pin
                    if (selectedPinShelf.shape !== 'rect') return;
                    const r = selectedPinShelf.geom as RectGeom;
                    const curU = Math.min(0.95, Math.max(0.05, worldToShelfLocal(r, selectedPin).x / r.w));
                    const p = shelfLocalToWorld(r, Math.min(0.95, curU + 0.12) * r.w, r.h / 2);
                    setNewItemAt({ x: p.x, y: p.y, shelfId: selectedPinShelf.id });
                  } : undefined}
                  onClose={() => setSelectedPinProductId(null)}
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
                    setSelectedPinProductId(null);
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
                groupFilter={selectedPin && selectedPinShelf && productsGroupOpen ? {
                  shelfLabel: selectedPinShelf.label || 'shelf',
                  memberIds: groupChips.map((c) => c.product.id),
                } : null}
                onClearGroup={() => setProductsGroupOpen(false)}
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

/** Capitalized labels for the panel's Type selector. */
const TYPE_OPTIONS: Record<MapElement['type'], string> = {
  shelf: 'Shelf',
  wall: 'Wall',
  zone: 'Zone',
  aisle: 'Aisle',
  entrance: 'Entrance',
  exit: 'Exit',
  poi: 'Point of interest',
};

function ElementPanel({
  el, floor, elements, onChange, onDelete, onDuplicate, items,
}: {
  el: MapElement;
  floor: Floor;
  elements: MapElement[];
  onChange: (els: MapElement[]) => void;
  onDelete: () => void;
  onDuplicate: () => void;
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
  // label text scale + per-element hide: stored on the element meta, read by
  // both renderers
  const labelMeta = el.label ? parseMeta(el.meta) : null;
  const labelScale = Number(labelMeta?.labelScale) || 1;
  const labelHidden = labelMeta?.labelHidden === true;
  const setLabelScale = (v: number) =>
    patch({ meta: JSON.stringify({ ...parseMeta(el.meta), labelScale: v }) });
  return (
    <div>
      <div className="panel-section">
        <h4>Selected Structure</h4>
        {labelMeta && (
          <div style={{ marginBottom: 12 }}>
            <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--ink-soft)', marginBottom: 5 }}>Label size</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
              <button
                type="button"
                className={`btn sm ${labelHidden ? 'active' : ''}`}
                aria-pressed={labelHidden}
                title="Hide this element's label on the map (2D and 3D)"
                onClick={() => patch({ meta: JSON.stringify({ ...parseMeta(el.meta), labelHidden: labelHidden ? undefined : true }) })}
              >
                Hide label
              </button>
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
              <option key={t} value={t}>{TYPE_OPTIONS[t] ?? t}</option>
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
          <p className="muted" style={{ fontSize: 12.5 }}>
            Shoppers can tap this shelf on the public map to see its front view. Leave bays empty to divide evenly.
            Rows and height shape the 3D fixture; the planogram's Row height slider sizes the shelf drawing.
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

const DAY_CAPS: Record<WeekDay, string> = {
  mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun',
};

/** Day-by-day opening hours: one row per day with open/close times and a
 *  closed toggle. Serializes into the store's `hours` field as JSON. */
function DayHoursEditor({ value, onChange }: { value: WeekHours; onChange: (w: WeekHours) => void }) {
  const set = (d: WeekDay, patch: Partial<DayHours>) =>
    onChange({ ...value, [d]: { ...value[d], ...patch } });
  return (
    <div className="day-hours">
      {WEEK_DAYS.map((d) => {
        const day = value[d];
        return (
          <div key={d} className="day-hours-row">
            <label className="day-hours-day">
              <input
                type="checkbox"
                checked={!day.closed}
                onChange={(e) => set(d, { closed: !e.target.checked })}
                aria-label={`${DAY_CAPS[d]} open`}
              />
              <b>{DAY_CAPS[d]}</b>
            </label>
            {day.closed ? (
              <span className="muted" style={{ fontSize: 12.5 }}>Closed</span>
            ) : (
              <span className="day-hours-times">
                <input type="time" className="input" value={day.open} onChange={(e) => set(d, { open: e.target.value })} />
                <span aria-hidden>–</span>
                <input type="time" className="input" value={day.close} onChange={(e) => set(d, { close: e.target.value })} />
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SandboxHistory({ session }: { session: LocalSession }) {
  const entries = [...session.log].reverse(); // newest first
  return (
    <div className="panel-section">
      <h4>Save log · this device</h4>
      <p className="muted" style={{ fontSize: 12.5, margin: '0 0 8px' }}>
        Every change saved on this device, newest first.
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
      // snapshots written before the floor_id fix may carry rows without it —
      // re-stamp so the editor's per-floor filter keeps every restored element
      // (without it the restore "succeeds" but the map shows nothing and the
      // next autosave would wipe the floor)
      onRestore(snapshot.elements.map((r) => parseElement({ ...r, floor_id: floorId })));
      setDiffFor(null);
      load();
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
              </div>
              <button className="btn sm" disabled={busyId === snap.id} onClick={() => previewDiff(snap.id, currentElements)}>
                {busyId === snap.id ? 'Loading…' : '↩ Restore'}
              </button>
            </div>
          ))
        )}
      </div>
      {diffFor && (() => {
        const snap = snaps?.find((s) => s.id === diffFor.id);
        return (
          <Modal title="Restore this snapshot?" onClose={() => setDiffFor(null)}>
            <p style={{ margin: '0 0 6px' }}>
              Snapshot from{' '}
              <b>{snap ? new Date(snap.created_at_ms).toLocaleString() : 'just now'}</b>
              {snap ? ` — ${snap.element_count} element${snap.element_count === 1 ? '' : 's'}` : ''}
            </p>
            <p className="muted" style={{ margin: '0 0 6px' }}>
              vs now: {diffFor.summary.join(' · ')}
            </p>
            <p className="muted" style={{ fontSize: 12.5, margin: '0 0 4px' }}>
              Your current map will be replaced by this snapshot.
            </p>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setDiffFor(null)}>Cancel</button>
              <button className="btn primary" disabled={busyId === diffFor.id} onClick={() => restore(diffFor.id)}>
                {busyId === diffFor.id ? 'Restoring…' : 'Restore'}
              </button>
            </div>
          </Modal>
        );
      })()}
    </div>
  );
}

/* ---------------- Selected product pin (map card) ---------------- */

/** Searchable dropdown of the items on a shelf: type to filter, click to
 *  jump to that item. Native <select> can't be searched, so this is a small
 *  input + filtered list that reads like one. */
function ItemsOnShelf({
  items, onSelect,
}: {
  items: { id: string; label: string; hint: string }[];
  onSelect: (id: string) => void;
}) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? items.filter((it) => `${it.label} ${it.hint}`.toLowerCase().includes(needle))
    : items;
  return (
    <div>
      <input
        className="input"
        placeholder={`Search ${items.length} item${items.length === 1 ? '' : 's'}…`}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Search items on this shelf"
      />
      <div
        role="listbox"
        aria-label="Items on this shelf"
        style={{ maxHeight: 180, overflowY: 'auto', marginTop: 4, border: '1px solid var(--line)', borderRadius: 8 }}
      >
        {filtered.length === 0 ? (
          <p className="muted" style={{ fontSize: 12.5, margin: '6px 8px' }}>
            Nothing matches “{q.trim()}”.
          </p>
        ) : (
          filtered.map((it) => (
            <button
              key={it.id}
              type="button"
              role="option"
              aria-selected={false}
              className="shelf-picker-row"
              style={{ fontSize: 12.5, padding: '5px 8px' }}
              onClick={() => onSelect(it.id)}
              title={`Select ${it.label} on the map`}
            >
              <span className="shelf-picker-name">{it.label}</span>
              <span className="shelf-picker-go" aria-hidden>◎</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

/** Side-panel card for a pin selected on the map: marker size + planogram. */
function PinPanel({
  location, product, ownerShelf, groupChips, groupFacings, onSelectMember, onRenameGroup, onSize, onEditPlanogram, onAddAnother, onClose,
}: {
  location: ProductLocation;
  product: Product | null;
  ownerShelf: MapElement | null;
  /** Everything on this shelf, one entry per product, copies counted. */
  groupChips: { product: Product; facings: number }[];
  groupFacings: number;
  onSelectMember: (productId: string) => void;
  onSize: (w: number, h: number) => void;
  onEditPlanogram?: () => void;
  /** singular-item shelf: create the next product straight into this area */
  onAddAnother?: () => void;
  /** name the group (the owner shelf's label) */
  onRenameGroup?: (label: string) => void;
  onClose: () => void;
}) {
  let m: Record<string, unknown> = {};
  try { m = JSON.parse(location.meta || '{}'); } catch { /* keep {} */ }
  const w = typeof m.pinW === 'number' ? m.pinW : 0.5;
  const h = typeof m.pinH === 'number' ? m.pinH : 0.2;
  return (
    <div className="panel-section">
      <div className="row-between">
        <h4>📍 {product?.name ?? 'Product pin'}</h4>
        <button className="route-badge-x" onClick={onClose} aria-label="Close pin panel">✕</button>
      </div>
      {ownerShelf && (
        <p className="muted" style={{ fontSize: 12, margin: '2px 0 8px' }}>
          on {ownerShelf.label || 'shelf'}
        </p>
      )}
      {ownerShelf && groupChips.length > 0 && (
        <div style={{ margin: '0 0 8px' }}>
          <p className="muted" style={{ fontSize: 11.5, margin: '0 0 4px' }}>
            Group — {groupFacings} facing{groupFacings === 1 ? '' : 's'} · {groupChips.length} item{groupChips.length === 1 ? '' : 's'} on this shelf
          </p>
          <ItemsOnShelf
            items={groupChips.map(({ product: p, facings }) => ({
              id: p.id,
              label: `${p.name}${facings > 1 ? ` ×${facings}` : ''}`,
              hint: p.category_name ?? '',
            }))}
            onSelect={(id) => onSelectMember(id)}
          />
        </div>
      )}
      {onAddAnother && (
        <button className="btn sm" style={{ marginBottom: 8 }} onClick={onAddAnother}>
          ＋ Add another item to this shelf
        </button>
      )}
      {ownerShelf && onRenameGroup && (
        <label className="field" style={{ margin: '0 0 8px' }}>
          <span>Group name</span>
          <input
            className="input"
            value={ownerShelf.label}
            placeholder="Name this group…"
            maxLength={80}
            onChange={(e) => onRenameGroup(e.target.value)}
          />
        </label>
      )}
      {onEditPlanogram ? (
        <button className="btn" onClick={onEditPlanogram}>▦ Edit planogram</button>
      ) : (
        <p className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
          Pin the item to a shelf to edit its planogram placement.
        </p>
      )}
      <p className="muted" style={{ fontSize: 11.5, margin: '10px 0 4px' }}>Size on map (2D &amp; 3D)</p>
      <div style={{ display: 'grid', gap: 6 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
          Length
          <input type="range" min={0.05} max={3} step={0.05} value={w} style={{ flex: 1 }}
            onChange={(e) => onSize(Number(e.target.value), h)} />
          <b style={{ minWidth: 48, textAlign: 'right' }}>{w.toFixed(2)} m</b>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
          Width
          <input type="range" min={0.05} max={3} step={0.05} value={h} style={{ flex: 1 }}
            onChange={(e) => onSize(w, Number(e.target.value))} />
          <b style={{ minWidth: 48, textAlign: 'right' }}>{h.toFixed(2)} m</b>
        </label>
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
  storeId, entitlements, products, categories, locations, onData, placingId, onStartPlacing, flashId, onQueueMany, groupFilter, onClearGroup,
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
  /** The selected pin's group: label + the member product ids — filters the
   *  list to that group while the specific item stays ring-highlighted. */
  groupFilter?: { shelfLabel: string; memberIds: string[] } | null;
  onClearGroup?: () => void;
}) {
  const api = useEditorApi();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [newCat, setNewCat] = useState('');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const flashRef = useRef<HTMLDivElement | null>(null);

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
      (catFilter === 'all' || (catFilter === 'none' ? !p.category_id : p.category_id === catFilter)) &&
      (!groupFilter || groupFilter.memberIds.includes(p.id))
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
      {groupFilter && (
        <div className="panel-section" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="dot" style={{ background: 'var(--green)' }} aria-hidden />
          <span style={{ fontSize: 12.5 }}>
            Showing group <b>{groupFilter.shelfLabel}</b> — {groupFilter.memberIds.length} item
            {groupFilter.memberIds.length === 1 ? '' : 's'} (the selected one is highlighted)
          </span>
          <button className="btn sm ghost" style={{ marginLeft: 'auto' }} onClick={() => onClearGroup?.()}>
            Show all
          </button>
        </div>
      )}
      <div className="panel-section">
        <div className="row-between">
          <h4 style={{ margin: 0 }}>Products</h4>
          <div style={{ display: 'flex', gap: 6 }}>
            <a className="btn sm" href={`/api/stores/${storeId}/catalog.csv`} download title="Download products as CSV">⬇ CSV</a>
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
          onCategoryAdded={(c) => onData({ categories: categories.some((x) => x.id === c.id) ? categories : [...categories, c] })}
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
  storeId, categories, product, onClose, onSaved, entitlements, autoPlace, onCategoryAdded,
}: {
  storeId: string;
  categories: Category[];
  product: Product | null;
  onClose: () => void;
  onSaved: (p: Product, placed?: ProductLocation) => void;
  entitlements?: { productImages: boolean };
  /** Create-from-map flow: pin the new product at this spot in the same save. */
  autoPlace?: { floorId: string; x: number; y: number; shelfId?: string };
  /** a category created inside this modal — the parent adds it to its list */
  onCategoryAdded?: (c: Category) => void;
}) {
  const api = useEditorApi();
  const [name, setName] = useState(product?.name ?? '');
  const [brand, setBrand] = useState(product?.brand ?? '');
  const [sku, setSku] = useState(product?.sku ?? '');
  const [price, setPrice] = useState(product?.price != null ? String(product.price) : '');
  const [categoryId, setCategoryId] = useState(product?.category_id ?? '');
  const [newCatOpen, setNewCatOpen] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [imageUrl, setImageUrl] = useState(product?.image_url ?? '');
  const [imgBusy, setImgBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  // the owner-cropped planogram variant — shown where the planogram shows it
  const [cropOpen, setCropOpen] = useState(false);
  const [cropUrl, setCropUrl] = useState(product?.image_crop_url ?? '');

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
      setCropUrl('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setImgBusy(false);
    }
  };

  /** Save the dragged crop region as the planogram-facing image (original kept). */
  const applyCrop = async (file: File) => {
    if (!product) return;
    setImgBusy(true);
    setError('');
    try {
      const { product: updated } = await api.productImageCrop(product.id, file);
      setCropUrl(updated.image_crop_url);
      setCropOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Crop failed');
    } finally {
      setImgBusy(false);
    }
  };

  /** Drop the cropped variant — planogram tiles fall back to the full photo. */
  const clearCrop = async () => {
    if (!product) return;
    setImgBusy(true);
    setError('');
    try {
      await api.removeProductImageCrop(product.id);
      setCropUrl('');
      setCropOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setImgBusy(false);
    }
  };

  /** Create a category right from the selector — no trip to the Store tab. */
  const addCategoryInline = async () => {
    const trimmed = newCatName.trim();
    if (!trimmed) return;
    setError('');
    try {
      const { category } = await api.addCategory(storeId, { name: trimmed });
      onCategoryAdded?.(category);
      setCategoryId(category.id);
      setNewCatOpen(false);
      setNewCatName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the category');
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
      category_id: categoryId === '__new' ? null : categoryId || null,
    };
    try {
      const { product: saved } = product
        ? await api.updateProduct(product.id, body)
        : await api.addProduct(storeId, body);
      let placed: ProductLocation | undefined;
      if (autoPlace) {
        placed = (await api.setProductLocation(saved.id, {
          floor_id: autoPlace.floorId, x: autoPlace.x, y: autoPlace.y, shelfId: autoPlace.shelfId,
        })).location;
      }
      const cat = categories.find((c) => c.id === (categoryId || null));
      onSaved({ ...saved, category_name: cat?.name, category_color: cat?.color }, placed);
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
            <select
              className="select"
              value={categoryId}
              onChange={(e) => {
                if (e.target.value === '__new') {
                  setNewCatOpen(true);
                  return;
                }
                setNewCatOpen(false);
                setCategoryId(e.target.value);
              }}
            >
              <option value="">— none —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
              <option value="__new">＋ New category…</option>
            </select>
          </Field>
        </div>
        {newCatOpen && (
          <div className="panel-section" style={{ padding: '10px 12px', border: '1px dashed var(--line)', borderRadius: 10 }}>
            <Field label="New category name">
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  className="input"
                  value={newCatName}
                  autoFocus
                  placeholder="e.g. Frozen foods"
                  onChange={(e) => setNewCatName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCategoryInline(); } }}
                />
                <button type="button" className="btn primary sm" disabled={!newCatName.trim()} onClick={addCategoryInline}>
                  Add
                </button>
                <button type="button" className="btn sm" onClick={() => setNewCatOpen(false)}>Cancel</button>
              </div>
            </Field>
          </div>
        )}
        <Field label="Photo">
          {entitlements?.productImages ? (
            product ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {imageUrl ? (
                  <img src={cropUrl || imageUrl} alt="" width={54} height={54} style={{ borderRadius: 8, objectFit: 'cover', border: '1px solid var(--line)', background: 'var(--chip)' }} />
                ) : (
                  <div style={{ width: 54, height: 54, borderRadius: 8, border: '1px dashed var(--line)', display: 'grid', placeItems: 'center', color: 'var(--ink-soft)', fontSize: 18 }}>?</div>
                )}
                <button
                  type="button"
                  className="btn sm"
                  title="Open the device camera"
                  onClick={() => setCameraOpen(true)}
                >
                  📷 Take photo
                </button>
                <label className="btn sm" title="Choose an image file">
                  🖼 Upload
                  <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { pickImage(e.target.files?.[0]); e.target.value = ''; }} />
                </label>
                {imageUrl && (
                  <button type="button" className="btn sm" disabled={imgBusy} onClick={() => setCropOpen(true)} title="Drag a box around the product — planogram tiles show the cropped photo">
                    ⛶ Crop
                  </button>
                )}
                {imageUrl && (
                  <button type="button" className="btn sm" disabled={imgBusy} onClick={removeBg} title="Cut the studio background out right in this browser">
                    ✂ Remove background
                  </button>
                )}
                {cropUrl && (
                  <button type="button" className="btn sm" disabled={imgBusy} onClick={clearCrop} title="Delete the cropped variant — planogram tiles fall back to the full photo">
                    Remove crop
                  </button>
                )}
                {imageUrl && <button type="button" className="btn sm danger" disabled={imgBusy} onClick={clearImage}>Remove</button>}
                {imgBusy && <span className="muted" style={{ fontSize: 12 }}>Working…</span>}
              </div>
            ) : (
              <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>Save the product first, then add its photo.</p>
            )
          ) : (
            <div className="photo-info">
              <p style={{ fontSize: 12.5, margin: '0 0 6px' }}>
                <b>Add photos in three ways:</b> 📷 take a photo with your camera, 🖼 upload an image,
                or paste an image URL when editing a product. Photos show in shopper search, on the
                map and in the shelf planogram — ✂ Remove background makes cut-outs that stand out
                on shelves.
              </p>
              <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
                Photos are part of the paid plan — <b>$1/month</b> adds them to every map you own.
                Self-hosting? Local mode includes them free.
              </p>
            </div>
          )}
        </Field>
        {error && <div className="error-note">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || !name.trim()}>{busy ? 'Saving…' : 'Save product'}</button>
        </div>
        {cameraOpen && (
          <CameraCaptureModal
            onCapture={(file) => pickImage(file)}
            onClose={() => setCameraOpen(false)}
          />
        )}
        {cropOpen && product && imageUrl && (
          <CropModal
            src={imageUrl}
            busy={imgBusy}
            onApply={applyCrop}
            onError={(msg) => setError(msg)}
            onClose={() => setCropOpen(false)}
          />
        )}
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
        <Field label="Opening hours">
          <DayHoursEditor
            value={parseStoreHours(form.hours) ?? defaultWeek()}
            onChange={(w) => setForm((f) => ({ ...f, hours: serializeWeek(w) }))}
          />
        </Field>
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
