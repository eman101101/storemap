import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import MapCanvas from './MapCanvas';
import Map3D from './Map3D';
import ShelfDetail from './ShelfDetail';
import { BlockText } from './GridHero';
import { CameraPad, CameraToggle, ZoomPad } from './ui';
import type {
  Floor, MapElement, Product, ProductLocation, PublicStorePayload,
} from '../types';
import { parseElement } from '../types';
import type { Viewport, WorldPt } from '../lib/geometry';
import { buildNavGrid, computeRoute, computeTrip, WALK_M_PER_MIN, type NavGrid, type TourStop } from '../lib/navgrid';
import { shelfDirectory } from '../lib/aisleInfo';
import { pinInShelf } from '../lib/shelfLayout';
import { formatStoreHours } from '../lib/storeHours';
import { fitCamera, MODERN_THEME, DARK_THEME, DIST_MIN, DIST_MAX, type Camera3D } from '../lib/render3d';
import { useAuth } from '../App';
import { useTheme } from '../theme';
import ThemeSettings from './ThemeSettings';

interface Pin {
  location: ProductLocation;
  product: Product;
}

interface FloorRoute {
  floorId: string;
  points: WorldPt[];
  distanceM: number;
}

export default function ViewerPage() {
  const { slug } = useParams<{ slug: string }>();
  const [params] = useSearchParams();
  const [data, setData] = useState<PublicStorePayload | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const searchRef = useRef<HTMLDivElement>(null);
  const [activeFloorId, setActiveFloorId] = useState('');
  const [focusPinLocationId, setFocusPinLocationId] = useState<string | null>(null);
  const [focusCmd, setFocusCmd] = useState<{ x: number; y: number; seq: number } | null>(null);
  /** the deferred 2D zoom-to-pin from focusResult — cleared on unmount */
  const focusTimer = useRef<number>(0);
  const [viewport, setViewport] = useState<Viewport>({ scale: 15, tx: 0, ty: 0 });
  const [elements, setElements] = useState<MapElement[]>([]);
  const [shelfPopupId, setShelfPopupId] = useState<string | null>(null);
  // search-result photos: off by default — the 🖼 chip turns them on
  const [showResultImages, setShowResultImages] = useState(false);
  // the 3D camera pad starts hidden behind the struck-through camera toggle
  const [camPadOpen, setCamPadOpen] = useState(false);
  const [view3d, setView3d] = useState(() => {
    try {
      return localStorage.getItem('storemap.view') !== '2d'; // default 3D
    } catch {
      return true;
    }
  }); // the store opens in 3D
  const [route, setRoute] = useState<FloorRoute | null>(null);
  const [flySeq, setFlySeq] = useState(0);
  // multi-stop trip (IMPROVEMENTS A1): ordered stops + routed legs
  const [trip, setTrip] = useState<{ product: Product; loc: ProductLocation }[]>([]);
  // pre-search browsing: the "What's where" aisle directory + category filter
  const [dirOpen, setDirOpen] = useState(false);
  const [browseCat, setBrowseCat] = useState<{ name: string; color: string } | null>(null);
  const [sheetProduct, setSheetProduct] = useState<Product | null>(null);
  const [offline, setOffline] = useState(!navigator.onLine);
  // owned here so toggling 2D↔3D keeps the 3D angle
  const [cam3d, setCam3d] = useState<Camera3D | null>(null);
  // 2D programmatic zoom (the ＋/− pad) — MapCanvas animates the glide
  const [zoomCmd, setZoomCmd] = useState<{ k: number; seq: number } | null>(null);
  const { user } = useAuth();
  const navigate = useNavigate();
  const { resolved } = useTheme();
  const sceneTheme = resolved === 'dark' ? DARK_THEME : MODERN_THEME;

  /** Route fly-through is hidden for now (kept wired for when it returns). */
  const FLY_ENABLED = false;

  /** One tap from the shopper view into the owner's editor (login first if needed). */
  const goEdit = () => {
    if (!data) return;
    const target = `/dashboard/stores/${data.store.id}`;
    navigate(user ? target : `/login?next=${encodeURIComponent(target)}`);
  };

  const switchView = (v: boolean) => {
    setView3d(v);
    try {
      localStorage.setItem('storemap.view', v ? '3d' : '2d');
    } catch { /* private mode */ }
  };

  useEffect(() => {
    if (data?.store.name) document.title = `${data.store.name} · StoreMap`;
    return () => {
      document.title = 'StoreMap — Find products in-store';
    };
  }, [data?.store.name]);

  // A6: /s/:slug?p=<productId> deep-links straight to an item's route
  const deepLinked = useRef(false);
  // navigating between stores must re-arm the deep link (/s/a?p=x → /s/b?p=y)
  const lastSlug = useRef(slug);
  if (lastSlug.current !== slug) {
    lastSlug.current = slug;
    deepLinked.current = false;
  }
  useEffect(() => {
    if (!data || deepLinked.current) return;
    const p = params.get('p');
    if (!p) {
      deepLinked.current = true;
      return;
    }
    const product = data.products.find((x) => x.id === p || x.name === p);
    if (product) {
      deepLinked.current = true;
      focusResult(product);
    }
  }, [data, params]); // eslint-disable-line react-hooks/exhaustive-deps

  // A8: viewer keyboard shortcuts (when not typing) — the handler is kept in
  // a ref so subscription happens once, not on every render
  const onKeyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  onKeyRef.current = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.key === '/') {
      e.preventDefault();
      document.querySelector<HTMLInputElement>('.search-float input')?.focus();
    } else if (e.key === '2') {
      switchView(false);
    } else if (e.key === '3') {
      switchView(true);
    } else if ((e.key === 'f' || e.key === 'F') && FLY_ENABLED) {
      if (route) setFlySeq((n) => n + 1);
    } else if (e.key === 'Escape') {
      setTrip([]);
      setBrowseCat(null);
      clearRoute();
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => onKeyRef.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  useEffect(() => () => window.clearTimeout(focusTimer.current), []);

  useEffect(() => {
    if (!slug) return;
    api.publicStore(slug)
      .then((d) => {
        setData(d);
        setElements(d.elements.map(parseElement));
        setActiveFloorId(d.floors[0]?.id ?? '');
      })
      .catch((e) => setError(e.message || 'Store not found'));
  }, [slug]);

  // close the results dropdown when clicking anywhere else
  useEffect(() => {
    if (!searchOpen) return;
    const onDown = (e: PointerEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [searchOpen]);

  const floor: Floor | null = useMemo(
    () => data?.floors.find((f) => f.id === activeFloorId) ?? data?.floors[0] ?? null,
    [data, activeFloorId]
  );

  const search = q.trim().toLowerCase();
  const hasSearch = search.length > 0;
  const matching = useMemo(() => {
    if (!data) return [];
    return data.products.filter((p) =>
      `${p.name} ${p.brand} ${p.sku} ${p.category_name ?? ''}`.toLowerCase().includes(search)
    );
  }, [data, search]);

  const productIds = useMemo(() => new Set(matching.map((p) => p.id)), [matching]);
  // pre-search browsing: every product in the category picked from the directory
  const catProductIds = useMemo(() => {
    if (!data || !browseCat) return null;
    const name = browseCat.name.toLowerCase();
    return new Set(data.products.filter((p) => (p.category_name ?? '').trim().toLowerCase() === name).map((p) => p.id));
  }, [data, browseCat]);
  const focusedProductId = useMemo(
    () => data?.locations.find((l) => l.id === focusPinLocationId)?.product_id ?? null,
    [data, focusPinLocationId]
  );
  // the map preview stays clean — items appear only while searching or browsing a
  // category, and the selected item's pin remains afterwards
  const pins: Pin[] = useMemo(() => {
    if (!data || !floor) return [];
    const tripIds = trip.map((t) => t.product.id);
    const wanted = hasSearch
      ? productIds
      : catProductIds
        ? new Set([...catProductIds, ...tripIds])
        : focusedProductId
          ? new Set([focusedProductId, ...tripIds])
          : trip.length
            ? new Set(tripIds)
            : null;
    if (!wanted) return [];
    return data.locations
      .filter((l) => l.floor_id === floor.id && wanted.has(l.product_id))
      .map((location) => {
        const product = data.products.find((p) => p.id === location.product_id)!;
        return { location, product };
      });
  }, [data, floor?.id, productIds, catProductIds, hasSearch, focusedProductId, trip]);

  // All pins on the current floor (unfiltered) — used to draw the shelf layout.
  const floorPins: Pin[] = useMemo(() => {
    if (!data || !floor) return [];
    return data.locations
      .filter((l) => l.floor_id === floor.id)
      .map((location) => ({ location, product: data.products.find((p) => p.id === location.product_id)! }))
      .filter((p) => p.product);
  }, [data, floor?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // pre-search directory: this floor's labelled aisles + what's on them
  const directory = useMemo(
    () =>
      floor
        ? shelfDirectory(
            elements.filter((e) => e.floor_id === floor.id),
            floorPins.map((p) => ({ location: p.location, product: p.product }))
          )
        : [],
    [floor, elements, floorPins]
  );

  const selectedShelf = useMemo(
    () => (shelfPopupId ? elements.find((e) => e.id === shelfPopupId && e.type === 'shelf') ?? null : null),
    [shelfPopupId, elements]
  );

  // the shelf a viewed item sits on — powers the sheet's "View shelf" button
  const shelfOfSheet = useMemo(() => {
    if (!sheetProduct || !data) return null;
    const loc = data.locations.find((l) => l.product_id === sheetProduct.id);
    if (!loc) return null;
    const pin = { location: loc, product: sheetProduct };
    return (
      elements.find((el) => el.type === 'shelf' && el.shape === 'rect' && pinInShelf(el, pin)) ??
      null
    );
  }, [sheetProduct, data, elements]);

  const activeRoute = route && floor && route.floorId === floor.id ? route : null;
  const walkMin = activeRoute ? Math.max(1, Math.round(activeRoute.distanceM / WALK_M_PER_MIN)) : 0;
  const flythrough = activeRoute ? { points: activeRoute.points, seq: flySeq } : null;

  // E3: the nav grid only changes with the fixtures — build it once, reuse for
  // every route/trip computation on this floor.
  const navGrid = useMemo<NavGrid | null>(
    () => (floor ? buildNavGrid(floor, elements.filter((e) => e.floor_id === floor.id)) : null),
    [floor, elements]
  );

  // ---- multi-stop trip: route every leg, order stops greedily, describe turns ----
  const tripResult = useMemo(() => {
    if (!data || !floor || trip.length < 1) return null;
    const stops: TourStop[] = trip
      .filter((t) => t.loc.floor_id === floor.id)
      .map((t) => ({ productId: t.product.id, name: t.product.name, point: { x: t.loc.x, y: t.loc.y } }));
    if (!stops.length) return null;
    const tour = computeTrip(floor, elements.filter((e) => e.floor_id === floor.id), stops, {}, navGrid ?? undefined);
    if (!tour) return null;
    // wayfinding text per leg: compass word + distance + nearest shelf label
    const legs = tour.legs.map((leg, i) => {
      const a = leg[0];
      const b = leg[leg.length - 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.round(Math.hypot(dx, dy));
      const dirs = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
      const ang = Math.atan2(-dy, dx); // screen y-down → compass
      const word = dirs[Math.round(((ang / Math.PI) * 4 + 8)) % 8];
      const mid = leg[Math.floor(leg.length / 2)];
      let near = '';
      let nd = 6;
      for (const el of elements) {
        if (el.type !== 'shelf' || !el.label) continue;
        const r = el.geom as { x: number; y: number; w?: number; h?: number };
        const cx = r.x + (r.w ?? 0) / 2;
        const cy = r.y + (r.h ?? 0) / 2;
        const d = Math.hypot(cx - mid.x, cy - mid.y);
        if (d < nd) {
          nd = d;
          near = el.label.split('·')[0].trim();
        }
      }
      return {
        to: i === 0 ? tour.order[0].name : tour.order[i].name,
        text: `${dist > 0 ? dist + ' m ' : ''}${word}${near ? ` past ${near}` : ''}`,
      };
    });
    return { tour, legs };
  }, [data, floor, trip, elements]);
  const tripLegsFlat = useMemo(
    () => (tripResult ? tripResult.tour.legs.flat() : null),
    [tripResult]
  );

  // live announcement for screen readers (A3/G1): route/trip state as text
  const liveMessage = tripResult
    ? `Trip with ${tripResult.tour.order.length} stops, ${Math.round(tripResult.tour.totalM)} meters total, about ${Math.max(1, Math.round(tripResult.tour.totalM / WALK_M_PER_MIN))} minutes.`
    : activeRoute
      ? `Route to ${data?.products.find((p) => p.id === data.locations.find((l) => l.id === focusPinLocationId)?.product_id)?.name ?? 'item'}: ${Math.round(activeRoute.distanceM)} meters, about ${walkMin} minute${walkMin === 1 ? '' : 's'}.`
      : '';

  // NOTE: kept above the loading/error early returns — the deep-link effect
  // can call it on a render that returned early (e.g. a floor-less store)
  const focusResult = (product: Product) => {
    if (!data) return;
    const loc = data.locations.find((l) => l.product_id === product.id);
    setQ('');
    setSearchOpen(false);
    setSheetProduct(product);
    setBrowseCat(null); // searching takes over from category browsing
    if (!loc) return;
    const locFloor = data.floors.find((f) => f.id === loc.floor_id) ?? floor;
    if (!locFloor) return;
    const switching = floor ? loc.floor_id !== floor.id : true;
    if (switching) setActiveFloorId(loc.floor_id);
    setFocusPinLocationId(loc.id);
    // 2D keeps its zoom-to-pin behaviour
    focusTimer.current = window.setTimeout(
      () => setFocusCmd({ x: loc.x, y: loc.y, seq: (focusCmd?.seq ?? 0) + 1 }),
      switching ? 80 : 0
    );
    // a new item search starts from the store's original 3D angle
    setCam3d(fitCamera(locFloor));

    // walking route from the entrance to this product, on the product's floor
    const r = computeRoute(locFloor, elements.filter((e) => e.floor_id === loc.floor_id), { x: loc.x, y: loc.y }, {}, navGrid ?? undefined);
    setRoute(r ? { floorId: loc.floor_id, points: r.points, distanceM: r.distanceM } : null);
  };

    if (error) {
    return (
      <main className="viewer-error">
        <div className="empty-state card">
          <h3>Store not found</h3>
          <p>This store doesn't exist or isn't published yet.</p>
          <Link className="btn" to="/">StoreMap home</Link>
        </div>
      </main>
    );
  }
  if (!data || !floor) {
    return <main className="viewer-loading"><p className="muted">Loading map…</p></main>;
  }

  /** The fly-through is played on demand from the top bar's button. */
  const startFlight = () => {
    switchView(true);
    setFlySeq((s) => s + 1);
  };

  const clearRoute = () => {
    setRoute(null);
    setFocusPinLocationId(null);
    setSheetProduct(null);
  };

  /** Add the selected item as the next trip stop (A1). */
  const addToTrip = (product: Product) => {
    const loc = data?.locations.find((l) => l.product_id === product.id);
    if (!loc) return;
    setTrip((t) => (t.some((x) => x.product.id === product.id) ? t : [...t, { product, loc }]));
    setSheetProduct(null);
  };

  /** One camera-pad tap = one smooth glide (~0.45 s); per-frame eased chunks
   *  sum to 1, so a pan covers ~18% of the view and a zoom step is ×0.78. */
  const cam3dMove = (dirX: number, dirY: number, zoom: number, dt: number) => {
    setCam3d((c) => {
      const base = c ?? fitCamera(floor);
      const next = { ...base };
      if (zoom) next.dist = Math.min(DIST_MAX, Math.max(DIST_MIN, next.dist * Math.exp(-0.25 * zoom * dt)));
      if (dirX || dirY) {
        const step = next.dist * 0.18 * dt;
        const rx = Math.cos(next.yaw);
        const ry = -Math.sin(next.yaw);
        const ux = Math.sin(next.yaw);
        const uy = Math.cos(next.yaw);
        next.tx = next.tx + (rx * dirX - ux * dirY) * step;
        next.ty = next.ty + (ry * dirX - uy * dirY) * step;
      }
      return next;
    });
  };

  // a search with several hits, or a browsed category, is a GROUP — light up
  // every matching item on the 3D map, not just the individually selected one
  const groupPinIds = pins.length > 1 ? pins.map((p) => p.location.id) : null;



  const results = matching.slice(0, 40);

  return (
    <div className="viewer-full">
      <div className="viewer-map">
        {view3d ? (
            <Map3D
              floor={floor}
              elements={elements.filter((e) => e.floor_id === floor.id)}
              pins={pins}
              focusPinId={focusPinLocationId}
              focusPinIds={groupPinIds}
              route={tripLegsFlat ?? activeRoute?.points ?? null}
              tripStops={tripResult ? tripResult.tour.order : undefined}
              flythrough={flythrough}
              stockPins={floorPins}
              camera={cam3d}
              onCamera={setCam3d}
              theme={sceneTheme}
              zoomCommand={zoomCmd ?? undefined}
              onElementClick={(el) => el.type === 'shelf' && setShelfPopupId(el.id)}
              onPinClick={(productId) => {
                const p = data.products.find((pr) => pr.id === productId);
                if (p) focusResult(p);
              }}
            />
        ) : (
          <MapCanvas
            floor={floor}
            elements={elements.filter((e) => e.floor_id === floor.id)}
            pins={pins}
            stockPins={floorPins}
            showDepartments={!hasSearch}
            viewport={viewport}
            onViewport={setViewport}
            focusPinId={focusPinLocationId}
            focus={focusCmd ?? undefined}
            route={tripLegsFlat ?? activeRoute?.points ?? null}
            tripStops={tripResult ? tripResult.tour.order : undefined}
            onElementClick={(el) => el.type === 'shelf' && setShelfPopupId(el.id)}
            zoomCommand={zoomCmd ?? undefined}
          />
        )}
        {view3d && (camPadOpen ? (
          <CameraPad onMove={cam3dMove} onClose={() => setCamPadOpen(false)} />
        ) : (
          <CameraToggle onOpen={() => setCamPadOpen(true)} />
        ))}
        <ZoomPad onZoom={(dir) => setZoomCmd({ k: dir > 0 ? 1.3 : 0.77, seq: (zoomCmd?.seq ?? 0) + 1 })} />

        <div className="viewer-ui-top">
          <div className="store-pill" title={data.store.hours || undefined}>
            {data.store.logo_url && <img src={data.store.logo_url} alt="" width={26} height={26} />}
            <span className="store-pill-name">
              {data.store.name}
              {formatStoreHours(data.store.hours) && (
                <span className="store-pill-hours">{formatStoreHours(data.store.hours)}</span>
              )}
            </span>
          </div>
          {FLY_ENABLED && activeRoute && (
            <button className="fly-btn" onClick={startFlight}>
              ✈ Fly the route
            </button>
          )}
          <button className="edit-btn" onClick={goEdit} title="Open this map in the editor">
            ✎ Edit map
          </button>
          <div className="search-float" ref={searchRef}>
            <span className="icon">🔎</span>
            <input
              className="input"
              placeholder="Search an item… e.g. milk"
              value={q}
              onChange={(e) => { setQ(e.target.value); setSearchOpen(true); setActiveIdx(-1); setBrowseCat(null); }}
              onFocus={() => setSearchOpen(true)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setQ('');
                  setSearchOpen(false);
                  setActiveIdx(-1);
                } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  if (!results.length) return;
                  e.preventDefault();
                  const dir = e.key === 'ArrowDown' ? 1 : -1;
                  setActiveIdx((i) => (i + dir + results.length) % results.length);
                } else if (e.key === 'Enter') {
                  const pick = results[activeIdx] ?? results[0];
                  if (pick) focusResult(pick);
                }
              }}
              aria-label="Search an item"
            />
            <button
              className={`search-img-toggle ${showResultImages ? 'active' : ''}`}
              aria-pressed={showResultImages}
              title={showResultImages ? 'Hide result photos' : 'Show result photos'}
              aria-label="Toggle result photos"
              onClick={() => setShowResultImages((v) => !v)}
            >
              🖼
            </button>
            {q && (
              <button className="search-clear" onClick={() => { setQ(''); setSearchOpen(false); }} aria-label="Clear search">
                ✕
              </button>
            )}
            {searchOpen && (
              <div className="results-drop" role="listbox">
                {results.length === 0 ? (
                  <div className="no-results">{search ? `Nothing found for “${q.trim()}”.` : 'Start typing to find an item.'}</div>
                ) : (
                  results.map((p, idx) => {
                    const loc = data.locations.find((l) => l.product_id === p.id);
                    const active = idx === activeIdx;
                    const rowClass = `result-item ${active ? 'kbd-active' : ''} ${loc && loc.id === focusPinLocationId ? 'selected' : ''}`;
                    const name = highlight(p.name, search);
                    return loc ? (
                      <button
                        key={p.id}
                        role="option"
                        aria-selected={active}
                        className={rowClass}
                        ref={active ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
                        onPointerEnter={() => setActiveIdx(idx)}
                        onClick={() => focusResult(p)}
                      >
                        {p.image_url && showResultImages ? (
                          <span className="rimg"><img src={p.image_url} alt="" loading="lazy" /></span>
                        ) : (
                          <span className="dot" style={{ background: p.category_color || '#2f6f3e' }} />
                        )}
                        <span className="rname">
                          <b>{name}</b>
                          <span>
                            {[p.brand, p.price != null ? `$${p.price.toFixed(2)}` : '', floorName(data.floors, loc.floor_id)]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </span>
                        <span className="rgo" aria-hidden>🧭</span>
                      </button>
                    ) : (
                      <div key={p.id} className={`result-item noloc ${active ? 'kbd-active' : ''}`}>
                        {p.image_url && showResultImages && (
                          <span className="rimg"><img src={p.image_url} alt="" loading="lazy" /></span>
                        )}
                        <span className="rname">
                          <b>{name}</b>
                          <span>{[p.brand, 'no map pin yet'].filter(Boolean).join(' · ')}</span>
                        </span>
                        {!p.image_url && <span className="dot" style={{ background: p.category_color || '#2f6f3e' }} />}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
          <div className="view-toggle" aria-label="Map view mode">
            <button className={!view3d ? 'active' : ''} aria-pressed={!view3d} onClick={() => switchView(false)}>
              2D
            </button>
            <button className={view3d ? 'active' : ''} aria-pressed={view3d} onClick={() => switchView(true)}>
              3D
            </button>
          </div>
          <ThemeSettings />
        </div>

        {activeRoute && (
          <div className="route-badge">
            <span className="route-badge-dot" aria-hidden />
            <button className="route-badge-x" onClick={clearRoute} aria-label="Clear route">
              ✕
            </button>
          </div>
        )}

        {browseCat && !hasSearch && (
          <div className="browse-badge">
            <span className="dot" style={{ background: browseCat.color }} aria-hidden />
            <b>{browseCat.name}</b>
            <span>· {pins.length} on the map</span>
            <button className="route-badge-x" onClick={() => setBrowseCat(null)} aria-label="Stop browsing this category">
              ✕
            </button>
          </div>
        )}

        {data.floors.length > 1 && (
          <div className="floor-float">
            <div className="floor-tabs">
              {data.floors.map((f) => (
                <button
                  key={f.id}
                  className={`floor-tab ${f.id === floor.id ? 'active' : ''}`}
                  onClick={() => { setActiveFloorId(f.id); setFocusPinLocationId(null); }}
                >
                  {f.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* pre-search browsing: the store's aisle directory (touch-friendly
            alternative to hovering a shelf) */}
        {!trip.length && (
          <button
            className="dir-btn"
            aria-expanded={dirOpen}
            onClick={() => setDirOpen((o) => !o)}
          >
            🗺 What's where
          </button>
        )}
        {dirOpen && (
          <div className="dir-panel card" role="dialog" aria-label="Aisle directory">
            <div className="row-between" style={{ marginBottom: 4 }}>
              <b>What's where</b>
              <button className="route-badge-x" onClick={() => setDirOpen(false)} aria-label="Close directory">
                ✕
              </button>
            </div>
            {directory.length === 0 ? (
              <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
                No labelled aisles on this floor yet — label shelves in the editor to build the directory.
              </p>
            ) : (
              directory.map((row) => (
                <div key={row.label} className="dir-row">
                  <button
                    className="dir-open"
                    onClick={() => { setDirOpen(false); setShelfPopupId(row.shelfIds[0]); }}
                    title="Show this aisle's shelf layout"
                  >
                    <b>{row.label}</b>
                    <span className="muted">{row.count} item{row.count === 1 ? '' : 's'} · tap</span>
                  </button>
                  <div className="dir-cats">
                    {row.categories.slice(0, 4).map((c) => (
                      <button
                        key={c.name}
                        className="dir-cat"
                        title={`Show ${c.name} on the map`}
                        onClick={() => {
                          clearRoute();
                          setBrowseCat({ name: c.name, color: c.color });
                          setDirOpen(false);
                        }}
                      >
                        <span className="dot" style={{ background: c.color }} aria-hidden />
                        {c.name}
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {offline && (
          <div className="offline-banner">⚡ Offline — showing the saved map. Search and routes still work.</div>
        )}

        {/* live text for screen readers (A3/G1) */}
        <div aria-live="polite" className="sr-only">{liveMessage}</div>

        {/* A4: selected-item sheet */}
        {sheetProduct && (
          <div className="product-sheet card">
            {sheetProduct.image_url
              ? <img src={sheetProduct.image_url} alt="" width={40} height={40} style={{ borderRadius: 8, objectFit: 'cover' }} />
              : <span className="dot" style={{ background: sheetProduct.category_color || '#2f6f3e' }} />}
            <div className="sheet-info">
              <b>{sheetProduct.name}</b>
              <span>
                {[sheetProduct.brand, sheetProduct.price != null ? `$${sheetProduct.price.toFixed(2)}` : '', sheetProduct.category_name]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </div>
            <button className="btn sm" onClick={() => addToTrip(sheetProduct)} disabled={!data?.locations.some((l) => l.product_id === sheetProduct.id)}>
              ＋ Add to list
            </button>
            {shelfOfSheet && (
              <button
                className="btn sm"
                title="See this shelf's full planogram"
                onClick={() => setShelfPopupId(shelfOfSheet.id)}
              >
                ▦ View shelf
              </button>
            )}
            {FLY_ENABLED && <button className="fly-btn" onClick={startFlight}>✈ Fly</button>}
            <button className="route-badge-x" onClick={() => setSheetProduct(null)} aria-label="Close">✕</button>
          </div>
        )}

        {/* A1/A2/A3: multi-stop trip panel */}
        {trip.length > 0 && (
          <div className="trip-panel card">
            <div className="row-between" style={{ marginBottom: 4 }}>
              <b>
                Trip · {trip.length} stop{trip.length === 1 ? '' : 's'}
                {tripResult ? ` · ${Math.round(tripResult.tour.totalM)} m · ≈${Math.max(1, Math.round(tripResult.tour.totalM / WALK_M_PER_MIN))} min` : ''}
              </b>
              <button className="route-badge-x" onClick={() => setTrip([])} aria-label="Clear trip">✕</button>
            </div>
            {tripResult ? (
              <ol className="trip-steps">
                {tripResult.legs.map((leg, i) => (
                  <li key={i}>
                    <span className="step-n">{i + 1}</span>
                    <span className="step-text">
                      <b>{leg.to}</b>
                      <span>{leg.text}</span>
                    </span>
                    <button
                      className="route-badge-x"
                      aria-label={`Remove ${leg.to}`}
                      onClick={() => setTrip((t) => t.filter((x) => x.product.name !== leg.to))}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>Routing…</p>
            )}
          </div>
        )}

        {!activeRoute && !searchOpen && (
          <div className="map-hint map-hint-center">
            {view3d
              ? 'Hover an aisle to peek inside · search an item to see the route'
              : 'Hover or tap a shelf to see what\'s on it · pinch or scroll to zoom'}
          </div>
        )}

        <Link to="/" className="powered-by" aria-label="item.place — home">
          <span className="powered-mark" aria-hidden>▦</span>
          <BlockText text="item.place" cell={1.7} />
        </Link>

        {selectedShelf && (
          <ShelfDetail
            shelf={selectedShelf}
            pins={floorPins}
            highlightLocationId={focusPinLocationId}
            onClose={() => setShelfPopupId(null)}
            onAddToList={addToTrip}
            onPickProduct={(p) => {
              setShelfPopupId(null);
              focusResult(p);
            }}
          />
        )}
      </div>
    </div>
  );
}

function floorName(floors: Floor[], id: string): string {
  return floors.find((f) => f.id === id)?.name ?? '';
}

/** Wrap the first case-insensitive match of `q` in <mark> for dropdown display. */
function highlight(text: string, q: string): ReactNode {
  if (!q) return text;
  const at = text.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + q.length)}</mark>
      {text.slice(at + q.length)}
    </>
  );
}
