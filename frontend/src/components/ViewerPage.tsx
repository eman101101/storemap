import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import MapCanvas from './MapCanvas';
import Map3D from './Map3D';
import ShelfDetail from './ShelfDetail';
import type {
  Floor, MapElement, Product, ProductLocation, PublicStorePayload,
} from '../types';
import { parseElement } from '../types';
import type { Viewport, WorldPt } from '../lib/geometry';
import { buildNavGrid, computeRoute, computeTrip, WALK_M_PER_MIN, type NavGrid, type TourStop } from '../lib/navgrid';
import { fitCamera, MODERN_THEME, RETRO_THEME, type Camera3D } from '../lib/render3d';
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
  const [viewport, setViewport] = useState<Viewport>({ scale: 15, tx: 0, ty: 0 });
  const [elements, setElements] = useState<MapElement[]>([]);
  const [shelfPopupId, setShelfPopupId] = useState<string | null>(null);
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
  const [sheetProduct, setSheetProduct] = useState<Product | null>(null);
  const [offline, setOffline] = useState(!navigator.onLine);
  // owned here so toggling 2D↔3D keeps the 3D angle
  const [cam3d, setCam3d] = useState<Camera3D | null>(null);
  const { user } = useAuth();
  const navigate = useNavigate();
  const { mapTheme } = useTheme();
  const sceneTheme = mapTheme === 'retro' ? RETRO_THEME : MODERN_THEME;

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

  // A8: viewer keyboard shortcuts (when not typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === '/') {
        e.preventDefault();
        document.querySelector<HTMLInputElement>('.search-float input')?.focus();
      } else if (e.key === '2') {
        switchView(false);
      } else if (e.key === '3') {
        switchView(true);
      } else if (e.key === 'f' || e.key === 'F') {
        if (route) setFlySeq((n) => n + 1);
      } else if (e.key === 'Escape') {
        setTrip([]);
        clearRoute();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

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
  const focusedProductId = useMemo(
    () => data?.locations.find((l) => l.id === focusPinLocationId)?.product_id ?? null,
    [data, focusPinLocationId]
  );
  // the map preview stays clean — items appear only while searching, and the
  // selected item's pin remains afterwards
  const pins: Pin[] = useMemo(() => {
    if (!data || !floor) return [];
    const wanted = hasSearch
      ? productIds
      : focusedProductId
        ? new Set([focusedProductId, ...trip.map((t) => t.product.id)])
        : trip.length
          ? new Set(trip.map((t) => t.product.id))
          : null;
    if (!wanted) return [];
    return data.locations
      .filter((l) => l.floor_id === floor.id && wanted.has(l.product_id))
      .map((location) => {
        const product = data.products.find((p) => p.id === location.product_id)!;
        return { location, product };
      });
  }, [data, floor?.id, productIds, hasSearch, focusedProductId, trip]);

  // All pins on the current floor (unfiltered) — used to draw the shelf layout.
  const floorPins: Pin[] = useMemo(() => {
    if (!data || !floor) return [];
    return data.locations
      .filter((l) => l.floor_id === floor.id)
      .map((location) => ({ location, product: data.products.find((p) => p.id === location.product_id)! }))
      .filter((p) => p.product);
  }, [data, floor?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedShelf = useMemo(
    () => (shelfPopupId ? elements.find((e) => e.id === shelfPopupId && e.type === 'shelf') ?? null : null),
    [shelfPopupId, elements]
  );

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

  const focusResult = (product: Product) => {
    const loc = data.locations.find((l) => l.product_id === product.id);
    setQ('');
    setSearchOpen(false);
    setSheetProduct(product);
    if (!loc) return;
    const locFloor = data.floors.find((f) => f.id === loc.floor_id) ?? floor;
    const switching = loc.floor_id !== floor.id;
    if (switching) setActiveFloorId(loc.floor_id);
    setFocusPinLocationId(loc.id);
    // 2D keeps its zoom-to-pin behaviour
    setTimeout(() => setFocusCmd({ x: loc.x, y: loc.y, seq: (focusCmd?.seq ?? 0) + 1 }), switching ? 80 : 0);
    // a new item search starts from the store's original 3D angle
    setCam3d(fitCamera(locFloor));

    // walking route from the entrance to this product, on the product's floor
    if (locFloor) {
      const r = computeRoute(locFloor, elements.filter((e) => e.floor_id === loc.floor_id), { x: loc.x, y: loc.y }, {}, navGrid ?? undefined);
      setRoute(r ? { floorId: loc.floor_id, points: r.points, distanceM: r.distanceM } : null);
    } else {
      setRoute(null);
    }
  };

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
              route={tripLegsFlat ?? activeRoute?.points ?? null}
              tripStops={tripResult ? tripResult.tour.order : undefined}
              flythrough={flythrough}
              stockPins={floorPins}
              camera={cam3d}
              onCamera={setCam3d}
              theme={sceneTheme}
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
            viewport={viewport}
            onViewport={setViewport}
            focusPinId={focusPinLocationId}
            focus={focusCmd ?? undefined}
            route={tripLegsFlat ?? activeRoute?.points ?? null}
            tripStops={tripResult ? tripResult.tour.order : undefined}
            onElementClick={(el) => el.type === 'shelf' && setShelfPopupId(el.id)}
          />
        )}

        <div className="viewer-ui-top">
          <div className="store-pill" title={data.store.hours || undefined}>
            {data.store.logo_url && <img src={data.store.logo_url} alt="" width={26} height={26} />}
            <span className="store-pill-name">{data.store.name}</span>
          </div>
          {activeRoute && (
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
              onChange={(e) => { setQ(e.target.value); setSearchOpen(true); setActiveIdx(-1); }}
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
                        <span className="dot" style={{ background: p.category_color || '#2f6f3e' }} />
                        <span className="rname">
                          <b>{name}</b>
                          <span>
                            {[p.brand, p.price != null ? `$${p.price.toFixed(2)}` : '', floorName(data.floors, loc.floor_id)]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </span>
                        <span aria-hidden>🧭</span>
                      </button>
                    ) : (
                      <div key={p.id} className={`result-item noloc ${active ? 'kbd-active' : ''}`}>
                        <span className="dot" style={{ background: p.category_color || '#2f6f3e' }} />
                        <span className="rname">
                          <b>{name}</b>
                          <span>{[p.brand, 'no map pin yet'].filter(Boolean).join(' · ')}</span>
                        </span>
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
            <b>{Math.round(activeRoute.distanceM)} m</b>
            <span>· ≈{walkMin} min from the entrance</span>
            <button className="route-badge-x" onClick={clearRoute} aria-label="Clear route">
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

        {offline && (
          <div className="offline-banner">⚡ Offline — showing the saved map. Search and routes still work.</div>
        )}

        {/* live text for screen readers (A3/G1) */}
        <div aria-live="polite" className="sr-only">{liveMessage}</div>

        {/* A4: selected-item sheet */}
        {sheetProduct && (
          <div className="product-sheet card">
            <span className="dot" style={{ background: sheetProduct.category_color || '#2f6f3e' }} />
            <div className="sheet-info">
              <b>{sheetProduct.name}</b>
              <span>
                {[sheetProduct.brand, sheetProduct.price != null ? `$${sheetProduct.price.toFixed(2)}` : '', sheetProduct.category_name]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </div>
            <button className="btn sm" onClick={() => addToTrip(sheetProduct)} disabled={!data?.locations.some((l) => l.product_id === sheetProduct.id)}>
              ＋ Trip
            </button>
            <button className="fly-btn" onClick={startFlight}>✈ Fly</button>
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
            {view3d ? 'Drag to look around · search an item to see the route' : 'Tap a shelf to see what’s on it · pinch or scroll to zoom'}
          </div>
        )}

        <Link to="/" className="powered-by">Powered by StoreMap</Link>

        {selectedShelf && (
          <ShelfDetail
            shelf={selectedShelf}
            pins={floorPins}
            onClose={() => setShelfPopupId(null)}
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
