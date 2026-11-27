import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import MapCanvas from './MapCanvas';
import { shelfContaining } from '../lib/departments';
import Map3D from './Map3D';
import ShelfDetail from './ShelfDetail';
import SearchBox, { searchHits, type SearchHit } from './SearchBox';
import { BlockText } from './GridHero';
import { CameraPad, CameraToggle, ZoomPad } from './ui';
import type {
  Floor, MapElement, Product, ProductLocation, PublicStorePayload, SearchResult, ShelfWindow, ShelfWindowSlot,
} from '../types';
import { parseElement, locationFlags, groupDisplayName } from '../types';
import type { Viewport, WorldPt } from '../lib/geometry';
import { buildNavGrid, computeRoute, computeTrip, pickStartPoint, WALK_M_PER_MIN, type NavGrid, type TourStop } from '../lib/navgrid';
import { shelfDirectory } from '../lib/aisleInfo';
import { buildSections, searchSections, type Box, type Section } from '../lib/sections';
import { computeShelfLayout } from '../lib/shelfLayout';
import { closestFacing, facingPlace, shelfFacings, whereOnShelf } from '../lib/shelfWindow';
import { buildGroupPins } from '../lib/itemGroups';
import { formatStoreHours } from '../lib/storeHours';
import { getViewPref, setViewPref } from '../lib/prefs';
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

/**
 * Where the item in the sheet was sent to: the facing ringed in the planogram,
 * its shelf and — so the sheet and the planogram can say where to look — its
 * board and its place along the shelf. `elsewhere` is how many other places
 * stock the same item.
 */
interface SentTo {
  productId: string;
  facingId: string;
  shelfId: string | null;
  level: number | null;
  /** 0..1 from the left end of the shelf */
  u: number | null;
  /** how many OTHER shelves stock the same item (a second facing on this shelf is not another place) */
  elsewhere: number;
}

/** A row of the server's search as the results dropdown shows it. Where the
 *  item faces comes with the row: a catalogue item is not in the map payload. */
function remoteHit(row: SearchResult): SearchHit {
  const place = facingPlace({ meta: row.location_meta });
  return {
    product: {
      id: row.id, store_id: '', category_id: null, name: row.name, brand: row.brand, sku: row.sku,
      barcode: '', description: '', price: row.price, image_url: row.image_url, image_crop_url: '',
      category_name: row.category_name, category_color: row.category_color,
    },
    located: !!(place.shelfId || (row.x != null && row.y != null)),
    focusId: null,
    facing: { shelfId: place.shelfId, shelfLabel: row.shelf_label ?? null, level: place.level, u: place.u },
    sub: [
      row.brand,
      row.price != null ? `$${row.price.toFixed(2)}` : '',
      row.shelf_label ? `in ${row.shelf_label}` : row.category_name,
    ].filter(Boolean),
  };
}

/** Editor preview: the shopper view fed from the editor's live map instead
 *  of a published store — what the owner sees is exactly what shoppers get. */
export interface ViewerPreview {
  payload: PublicStorePayload;
  onExit: () => void;
}

export default function ViewerPage({ preview }: { preview?: ViewerPreview }) {
  const { slug } = useParams<{ slug: string }>();
  const [params] = useSearchParams();
  const [data, setData] = useState<PublicStorePayload | null>(preview?.payload ?? null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeFloorId, setActiveFloorId] = useState('');
  const [focusPinLocationId, setFocusPinLocationId] = useState<string | null>(null);
  // the ITEM facing to ring inside the planogram (the map focus lands on the
  // group's pin, the highlight stays on the searched item)
  const [highlightFacingId, setHighlightFacingId] = useState<string | null>(null);
  // `box` set: frame that part of the floor (a section picked in the search), not just centre on the point
  const [focusCmd, setFocusCmd] = useState<{ x: number; y: number; seq: number; box?: Box & { keepTop?: number } } | null>(null);
  /** the deferred 2D zoom-to-pin from focusResult — cleared on unmount */
  const focusTimer = useRef<number>(0);
  const [viewport, setViewport] = useState<Viewport>({ scale: 15, tx: 0, ty: 0 });
  const [elements, setElements] = useState<MapElement[]>(() => preview?.payload.elements.map(parseElement) ?? []);
  const [shelfPopupId, setShelfPopupId] = useState<string | null>(null);
  // A tap on a shelf — the fixture itself or its group's titled pin — shows
  // the GROUP: its name and one way in, "View shelf". It used to open the
  // planogram straight away (the fixture) or to route the shopper to one item
  // of it (the pin); the shopper asked for the group, not for an item.
  const [groupSheetId, setGroupSheetId] = useState<string | null>(null);
  // a store with a loaded catalogue keeps its generated SKUs on the server:
  // the search goes there, and a shelf's planogram is a window fetched per shelf
  const [shelfWin, setShelfWin] = useState<{ shelfId: string; u: number; win: ShelfWindow | null; loading: boolean } | null>(null);
  const winSeq = useRef(0);
  /** where a catalogue item faces, as the server said it (an item picked twice is not asked twice) */
  const facingsOf = useRef(new Map<string, ShelfWindowSlot[]>());
  /** the catalogue items the shopper has been sent to — each one's pin on the map */
  const [remotePins, setRemotePins] = useState<Pin[]>([]);
  /** the item the map is focused on, in the payload or in the catalogue */
  const [focusProduct, setFocusProduct] = useState<Product | null>(null);
  const [sentTo, setSentTo] = useState<SentTo | null>(null);
  const focusSeq = useRef(0);
  const deepLinkAsked = useRef('');
  // search-result photos, on by default — the 🖼 chip turns them off. Every
  // demo item carries a photo (or a generated packshot), so the results read
  // as a shelf of products rather than a list of dots
  const [showResultImages, setShowResultImages] = useState(true);
  // the 3D camera pad starts hidden behind the struck-through camera toggle
  const [camPadOpen, setCamPadOpen] = useState(false);
  // the store opens in 3D unless this device chose 2D (Account → Settings)
  const [view3d, setView3d] = useState(() => getViewPref() === '3d');
  const [route, setRoute] = useState<FloorRoute | null>(null);
  const [flySeq, setFlySeq] = useState(0);
  // multi-stop trip (IMPROVEMENTS A1): ordered stops + routed legs
  const [trip, setTrip] = useState<{ product: Product; loc: ProductLocation }[]>([]);
  // pre-search browsing: the "What's where" aisle directory + category filter
  const [dirOpen, setDirOpen] = useState(false);
  const [browseCat, setBrowseCat] = useState<{ name: string; color: string } | null>(null);
  // a section picked in the search — an aisle, a department, an area, a shelf group: its shelves light
  // up on the map, the walk is drawn to it and its shelf groups are listed in a card
  const [section, setSection] = useState<Section | null>(null);
  const [sheetProduct, setSheetProduct] = useState<Product | null>(null);
  const [offline, setOffline] = useState(!navigator.onLine);
  // owned here so toggling 2D↔3D keeps the 3D angle
  const [cam3d, setCam3d] = useState<Camera3D | null>(null);
  // 2D programmatic zoom (the ＋/− pad) — MapCanvas animates the glide
  const [zoomCmd, setZoomCmd] = useState<{ k: number; seq: number } | null>(null);
  // Phone layout: the layers under the top bar hang from the bar's REAL bottom
  // edge, measured and published as a CSS variable on the map. Its height
  // moves with wrapping, touch targets and the safe area — a hard-coded offset
  // overlapped the moment it did. The map's own size shapes the camera fit.
  const mapRef = useRef<HTMLDivElement>(null);
  const topBarRef = useRef<HTMLDivElement>(null);
  const [chrome, setChrome] = useState<{ w: number; h: number; top: number } | null>(null);
  const { user } = useAuth();
  const navigate = useNavigate();
  const { resolved } = useTheme();
  const sceneTheme = resolved === 'dark' ? DARK_THEME : MODERN_THEME;

  /** Route fly-through is hidden for now (kept wired for when it returns). */
  const FLY_ENABLED = false;

  /** One tap from the shopper view into the owner's editor (login first if needed). */
  const goEdit = () => {
    if (preview) {
      preview.onExit();
      return;
    }
    if (!data) return;
    // the example maps belong to the demo account nobody can log into — send
    // their "Edit map" to the no-account sandbox copy instead of a dashboard
    // the visitor doesn't own
    if (data.store.slug.endsWith('-example')) {
      navigate(`/try/${data.store.slug}`);
      return;
    }
    const target = `/dashboard/stores/${data.store.id}`;
    navigate(user ? target : `/login?next=${encodeURIComponent(target)}`);
  };

  const switchView = (v: boolean) => {
    setView3d(v);
    setViewPref(v ? '3d' : '2d');
  };

  useEffect(() => {
    if (preview) return; // the editor keeps its own title
    if (data?.store.name) document.title = `${data.store.name} · StoreMap`;
    return () => {
      document.title = 'StoreMap — Find products in-store';
    };
  }, [data?.store.name, preview]);

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
      return;
    }
    // a catalogue item is not in the payload: ask the server for it, once
    if (!data.catalog || deepLinkAsked.current === `${slug}:${p}`) return;
    deepLinkAsked.current = `${slug}:${p}`;
    api.publicProduct(data.store.slug, p)
      .then(({ product: found }) => {
        deepLinked.current = true;
        focusResult({ product: found, located: true, focusId: null, sub: [] });
      })
      .catch(() => {
        deepLinked.current = true;
      });
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

  const previewPayload = preview?.payload;
  useEffect(() => {
    if (previewPayload) {
      // the editor's live map; keep the floor the shopper is on when it still exists
      setData(previewPayload);
      setElements(previewPayload.elements.map(parseElement));
      setActiveFloorId((id) => (previewPayload.floors.some((f) => f.id === id) ? id : previewPayload.floors[0]?.id ?? ''));
      return;
    }
    if (!slug) return;
    api.publicStore(slug)
      .then((d) => {
        setData(d);
        setElements(d.elements.map(parseElement));
        setActiveFloorId(d.floors[0]?.id ?? '');
      })
      .catch((e) => setError(e.message || 'Store not found'));
  }, [slug, previewPayload]);

  const floor: Floor | null = useMemo(
    () => data?.floors.find((f) => f.id === activeFloorId) ?? data?.floors[0] ?? null,
    [data, activeFloorId]
  );

  // this floor's own elements: what the pins, the sections and every route work on
  const floorEls = useMemo(() => elements.filter((e) => e.floor_id === floor?.id), [elements, floor?.id]);

  // Every shelf group shows ONE map pin; its items are planogram-only
  // facings. Searches hit items, so each hit resolves to its group's pin
  // here — what the map can light up and route to.
  const groupPins = useMemo(
    () => buildGroupPins(data?.locations ?? [], elements.filter((e) => e.type === 'shelf' && e.shape === 'rect')),
    [data, elements]
  );

  // The shelf a group pin belongs to: the persisted meta.shelfId wins; seeded
  // and legacy pins carry none, so fall back to the shelf the pin sits on.
  const shelfIdOfPin = (loc: { x: number; y: number; floor_id: string; meta?: string | null }): string | null => {
    try {
      const sid = JSON.parse(loc.meta || '{}').shelfId;
      if (typeof sid === 'string' && sid) return sid;
    } catch { /* fall through to the pin's position */ }
    return shelfContaining(loc.x, loc.y, elements.filter((e) => e.floor_id === loc.floor_id));
  };

  // (measured once the map and its bar exist — they mount after the load)
  useEffect(() => {
    const map = mapRef.current;
    const bar = topBarRef.current;
    if (!map || !bar) return;
    const measure = () => {
      const m = map.getBoundingClientRect();
      if (!m.width || !m.height) return;
      const top = Math.ceil(bar.getBoundingClientRect().bottom - m.top);
      map.style.setProperty('--viewer-top', `${top}px`);
      setChrome((c) => (c && c.w === m.width && c.h === m.height && c.top === top ? c : { w: m.width, h: m.height, top }));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(map);
    ro.observe(bar);
    measure();
    return () => ro.disconnect();
  }, [!!data && !!floor]);
  /** Canvas width ÷ height — what the 3D camera is fitted to. */
  const aspect = chrome ? chrome.w / chrome.h : undefined;
  /** The 2D fit on a phone: the full width, clear of the bar and the controls. */
  const mapFit = useMemo(
    () => (chrome && chrome.w <= 760 ? { pad: 12, insets: { top: chrome.top + 8, bottom: 96 } } : undefined),
    [chrome]
  );

  // a store with a loaded catalogue (the big-box examples): its generated SKUs
  // are on the server, so the search goes there
  const isRemote = !!data?.catalog;
  const search = q.trim().toLowerCase();
  const hasSearch = search.length > 0;
  // the store's own items answer from the payload at once, and stand in when
  // the server cannot be asked (offline, a one-letter query)
  const localHits = useMemo(() => (data ? searchHits(data, search, groupPins) : []), [data, search, groupPins]);
  const [remoteHits, setRemoteHits] = useState<SearchHit[]>([]);
  const remotePinsRef = useRef(remotePins);
  remotePinsRef.current = remotePins;
  useEffect(() => {
    if (!isRemote || !data) return;
    setRemoteHits(localHits);
    if (search.length < 2) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      api.searchPublic(data.store.slug, search)
        .then((rows) => {
          if (!alive) return;
          setRemoteHits(
            rows.length
              ? rows.map((row) => {
                  const hit = remoteHit(row);
                  // the row of the item the map is on reads selected, as any hit's does
                  const pin = remotePinsRef.current.find((x) => x.product.id === row.id);
                  return pin ? { ...hit, focusId: pin.location.id } : hit;
                })
              : localHits
          );
        })
        .catch(() => {
          /* offline, or the server's search is down: the payload's own items stay */
        });
    }, 160);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [search, isRemote, data, localHits]);
  const hits = isRemote ? remoteHits : localHits;
  const matching = useMemo(() => hits.map((h) => h.product), [hits]);
  const productIds = useMemo(() => new Set(matching.map((p) => p.id)), [matching]);
  // pre-search browsing: every product in the category picked from the directory
  const catProductIds = useMemo(() => {
    if (!data || !browseCat) return null;
    const name = browseCat.name.toLowerCase();
    return new Set(data.products.filter((p) => (p.category_name ?? '').trim().toLowerCase() === name).map((p) => p.id));
  }, [data, browseCat]);
  // the map preview stays clean — items appear only while searching or browsing a
  // category, and the selected item's pin remains afterwards
  const searchedPins: Pin[] = useMemo(() => {
    if (!data || !floor) return [];
    const tripIds = trip.map((t) => t.product.id);
    const wanted = hasSearch
      ? productIds
      : catProductIds
        ? new Set([...catProductIds, ...tripIds])
        : focusProduct
          ? new Set([focusProduct.id, ...tripIds])
          : trip.length
            ? new Set(tripIds)
            : null;
    if (!wanted) return [];
    // a match shows up as its GROUP's pin — the titled pin of every group
    // stocking it, never the item's own facing (items live inside the group
    // planogram). A legacy shelf without a group pin falls back to its plain
    // facings; an item whose facing resolves to no pin at all stays hidden.
    const floorLocs = data.locations.filter((l) => l.floor_id === floor.id);
    const out: Pin[] = [];
    for (const productId of wanted) {
      // a catalogue item shows as the pin it was sent to
      const sent = remotePins.find((x) => x.product.id === productId);
      if (sent) {
        out.push(sent);
        continue;
      }
      const product = data.products.find((p) => p.id === productId);
      if (!product) continue;
      const seen = new Set<string>();
      for (const facing of floorLocs) {
        if (facing.product_id !== productId) continue;
        const pin = groupPins.of(facing);
        if (seen.has(pin.id) || locationFlags(pin).groupOnly) continue;
        seen.add(pin.id);
        out.push({ location: pin, product });
      }
    }
    return out;
  }, [data, floor?.id, productIds, catProductIds, hasSearch, focusProduct, remotePins, trip, groupPins]);

  // The store's own facings on the current floor (unfiltered) — what the
  // shelves are stocked with and what the planogram draws.
  const ownPins: Pin[] = useMemo(() => {
    if (!data || !floor) return [];
    return data.locations
      .filter((l) => l.floor_id === floor.id)
      .map((location) => ({ location, product: data.products.find((p) => p.id === location.product_id)! }))
      .filter((p) => p.product);
  }, [data, floor?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  /** The pins of some shelves — each one's own group pin (a shelf with none of
   *  its own: its first plain facing), at most one per shelf. */
  const groupPinsOf = (shelfIds: string[]): Pin[] => {
    const wanted = new Set(shelfIds);
    const byShelf = new Map<string, Pin>();
    for (const p of ownPins) {
      if (locationFlags(p.location).groupOnly) continue;
      const shelfId = groupPins.shelfIdOf(p.location);
      if (!shelfId || !wanted.has(shelfId)) continue;
      const seen = byShelf.get(shelfId);
      if (!seen || locationFlags(p.location).groupPin) byShelf.set(shelfId, p);
    }
    return [...byShelf.values()];
  };
  const sectionPins = useMemo(() => (section ? groupPinsOf(section.shelfIds) : []), [section?.key, ownPins, groupPins]); // eslint-disable-line react-hooks/exhaustive-deps
  // while a section is showing and nothing is being searched, the maps carry its shelves' pins
  const pins: Pin[] = useMemo(() => (!hasSearch && section ? sectionPins : searchedPins), [hasSearch, section, sectionPins, searchedPins]);
  // …and its shelves are outlined
  const sectionHighlight = useMemo(() => (section && !hasSearch ? new Set(section.shelfIds) : undefined), [section, hasSearch]);
  // …and, for the maps, a catalogue item's pin where it is not one of them: a
  // shelf with no group pin of its own stands the item's facing in at its centre
  const floorPins: Pin[] = useMemo(() => {
    const extra = remotePins.filter((p) => p.location.floor_id === floor?.id && !ownPins.some((x) => x.location.id === p.location.id));
    return extra.length ? [...ownPins, ...extra] : ownPins;
  }, [ownPins, remotePins, floor?.id]);

  // pre-search directory: this floor's labelled aisles + what's on them
  const directory = useMemo(
    () =>
      floor
        ? shelfDirectory(
            elements.filter((e) => e.floor_id === floor.id),
            ownPins.map((p) => ({ location: p.location, product: p.product }))
          )
        : [],
    [floor, elements, ownPins]
  );

  // the store's sections — its aisles, departments, areas and shelf groups — and those answering the search
  const sections = useMemo(() => (floor ? buildSections(floorEls, ownPins) : []), [floor, floorEls, ownPins]);
  const sectionHits = useMemo(() => searchSections(sections, search), [sections, search]);

  const shelfById = (id: string | null | undefined): MapElement | null =>
    (id ? elements.find((e) => e.id === id && e.type === 'shelf') ?? null : null);

  const selectedShelf = useMemo(() => shelfById(shelfPopupId), [shelfPopupId, elements]); // eslint-disable-line react-hooks/exhaustive-deps
  // the group whose card is showing
  const groupSheet = useMemo(() => shelfById(groupSheetId), [groupSheetId, elements]); // eslint-disable-line react-hooks/exhaustive-deps
  // the shelf the item in the sheet was sent to — powers the sheet's "View shelf" button
  const sheetShelf = useMemo(
    () => (sentTo && sentTo.productId === sheetProduct?.id ? shelfById(sentTo.shelfId) : null),
    [sentTo, sheetProduct?.id, elements] // eslint-disable-line react-hooks/exhaustive-deps
  );
  // …and the sheet says where on that shelf to look, in the words of the planogram
  const sheetPlace = useMemo(() => {
    if (!sentTo || sentTo.productId !== sheetProduct?.id || !sentTo.shelfId || sentTo.u == null) return null;
    const shelf = shelfById(sentTo.shelfId);
    if (!shelf) return null;
    const n = sentTo.elsewhere;
    return {
      u: sentTo.u,
      text: `in ${groupDisplayName(shelf) ?? 'its shelf'} · ${whereOnShelf(sentTo.u, sentTo.level ?? 1, computeShelfLayout(shelf, [])?.levels ?? 1)}`,
      more: n > 0 ? ` · also in ${n} other ${n === 1 ? 'place' : 'places'} — this is the closest` : '',
    };
  }, [sentTo, sheetProduct?.id, elements]); // eslint-disable-line react-hooks/exhaustive-deps

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
      ? `Route to ${section?.name ?? focusProduct?.name ?? 'item'}: ${Math.round(activeRoute.distanceM)} meters, about ${walkMin} minute${walkMin === 1 ? '' : 's'}.`
      : '';

  // NOTE: kept above the loading/error early returns — the deep-link effect
  // can call it on a render that returned early (e.g. a floor-less store)
  /** Where the map is looking — what an equal walk comes down to (the 3D
   *  camera target in 3D, the map centre in 2D). */
  const viewRef = (): { x: number; y: number } | null => {
    const camTarget = view3d && cam3d ? { x: cam3d.tx, y: cam3d.ty } : null;
    if (camTarget) return camTarget;
    const mrect = document.querySelector('.viewer-map')?.getBoundingClientRect();
    return mrect && viewport.scale
      ? { x: (mrect.width / 2 - viewport.tx) / viewport.scale, y: (mrect.height / 2 - viewport.ty) / viewport.scale }
      : null;
  };

  /**
   * The pin a shopper is sent to for a facing: its group's titled pin. A shelf
   * with no pin of its own gets the facing itself, standing in at the shelf's
   * centre as a plain pin — a generated item's facing is planogram-only and
   * would never draw.
   */
  const pinFor = (facing: ProductLocation): ProductLocation | null => {
    const group = groupPins.of(facing);
    if (!locationFlags(group).groupOnly) return group;
    const shelf = shelfById(groupPins.shelfIdOf(facing));
    return shelf ? { ...facing, meta: JSON.stringify({ shelfId: shelf.id }) } : null;
  };

  /**
   * Of an item's facings, the one to send the shopper to. An item stocked in
   * more than one place goes to the closest, as a shopper in the store would:
   * the one with the shortest walk from the entrance — the route the map
   * draws. Facings equally far to walk (two of one shelf, above all) go to
   * the board nearest the middle, then to the one nearest where the map looks.
   */
  const nearestFacing = <T extends { location: ProductLocation }>(facings: T[]): T | undefined => {
    if (facings.length < 2) return facings[0];
    const ref = viewRef();
    const dist = (f: T) => {
      const p = pinFor(f.location);
      return p && ref ? Math.hypot(p.x - ref.x, p.y - ref.y) : Infinity;
    };
    // only the facings on this floor are worth routing; of an item with many,
    // only the few nearest the view
    const here = facings.filter((f) => f.location.floor_id === floor?.id);
    const candidates = [...(here.length ? here : facings)].sort((a, b) => dist(a) - dist(b)).slice(0, 6);
    let shortest = Infinity;
    const walked = candidates.map((f) => {
      const pin = pinFor(f.location);
      const on = pin ? data?.floors.find((x) => x.id === pin.floor_id) : null;
      const route = pin && on
        ? computeRoute(
            on, elements.filter((e) => e.floor_id === on.id), { x: pin.x, y: pin.y }, {},
            on.id === floor?.id ? navGrid ?? undefined : undefined
          )
        : null;
      const m = route ? route.distanceM : Infinity;
      shortest = Math.min(shortest, m);
      return { f, m };
    });
    if (!Number.isFinite(shortest)) return candidates[0];
    const tied = walked.filter((w) => w.m - shortest <= 1e-6).map((w) => w.f);
    if (tied.length === 1) return tied[0];
    const shelf = shelfById(groupPins.shelfIdOf(tied[0].location));
    return closestFacing(tied, (l) => pinFor(l), ref, (shelf ? computeShelfLayout(shelf, [])?.levels : undefined) ?? 3) ?? tied[0];
  };

  /** Send the map to an item: focus its pin, zoom to it, and draw the walk from the entrance. */
  const landOn = (product: Product, loc: ProductLocation | null) => {
    setFocusProduct(product);
    setGroupSheetId(null); // an item takes over from a group's card
    if (!loc || !data) return;
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
    setCam3d(fitCamera(locFloor, aspect));

    // walking route from the entrance to this product, on the product's floor
    // (the cached grid belongs to the floor on screen — reuse it for that one only)
    const sameFloor = floor?.id === loc.floor_id;
    const r = computeRoute(
      locFloor, elements.filter((e) => e.floor_id === loc.floor_id), { x: loc.x, y: loc.y }, {}, sameFloor ? navGrid ?? undefined : undefined
    );
    setRoute(r ? { floorId: loc.floor_id, points: r.points, distanceM: r.distanceM } : null);
  };

  // (focusResult calls focusRemote, declared just below it — a function
  // expression, bound by the time any handler or effect runs)

  /** Focus a search hit or an item. `facing` is one the shopper picked on a
   *  planogram: for a catalogue item that is the one to go to, not the closest. */
  const focusResult = (target: SearchHit | Product, facing?: ProductLocation) => {
    const hit: SearchHit | null = 'product' in target ? target : null;
    const product: Product = 'product' in target ? target.product : target;
    if (!data) return;
    // a catalogue item is not in the payload — the server says where it faces
    if (isRemote && !data.products.some((p) => p.id === product.id)) {
      void focusRemote(product, facing ?? null);
      return;
    }
    // the planogram rings the item's own facing — of an item stocked more
    // than once, the closest; the map focus below lands on its GROUP pin
    const facings = data.locations.filter((l) => l.product_id === product.id).map((location) => ({ location }));
    const own = nearestFacing(facings)?.location ?? null;
    setHighlightFacingId(own?.id ?? null);
    // where that facing sits on its shelf, from the layout the planogram draws
    const shelf = own ? shelfById(groupPins.shelfIdOf(own)) : null;
    const placed = own && shelf ? computeShelfLayout(shelf, [{ location: own, product }])?.bays.flatMap((b) => b.slots)[0] : undefined;
    setSentTo(
      own
        ? {
            productId: product.id, facingId: own.id, shelfId: shelf?.id ?? null,
            level: placed?.level ?? null, u: placed?.u ?? null,
            elsewhere: facings.filter((f) => groupPins.shelfIdOf(f.location) !== shelf?.id).length,
          }
        : null
    );
    setQ('');
    setSearchOpen(false);
    setSheetProduct(product);
    setBrowseCat(null); // searching takes over from category browsing
    setSection(null); // …and from a section
    // a planogram-only facing has no map pin — head to its group's
    landOn(product, own ? pinFor(own) : null);
  };

  /** A catalogue item (not in the payload): the server says where it faces,
   *  then it lands on the map like any item. */
  const focusRemote = async (product: Product, picked: ProductLocation | null): Promise<void> => {
    if (!data) return;
    const seq = ++focusSeq.current;
    setQ('');
    setSearchOpen(false);
    setSheetProduct(product);
    setBrowseCat(null); // searching takes over from category browsing
    setSection(null); // …and from a section
    let facings: ShelfWindowSlot[] = [];
    try {
      facings = facingsOf.current.get(product.id) ?? (await api.publicProduct(data.store.slug, product.id)).facings;
      facingsOf.current.set(product.id, facings);
    } catch {
      /* the server could not say where it faces: the item is shown, not placed */
    }
    if (seq !== focusSeq.current) return; // a newer pick superseded this one
    const chosen = (picked && facings.find((f) => f.location.id === picked.id)) || nearestFacing(facings);
    const place = chosen ? facingPlace(chosen.location) : null;
    const pin = chosen ? pinFor(chosen.location) : null;
    setHighlightFacingId(chosen?.location.id ?? null);
    setSentTo(
      chosen
        ? {
            productId: product.id, facingId: chosen.location.id, shelfId: place?.shelfId ?? null,
            level: place?.level ?? null, u: place?.u ?? null,
            elsewhere: facings.filter((f) => facingPlace(f.location).shelfId !== place?.shelfId).length,
          }
        : null
    );
    if (pin) setRemotePins((list) => (list.some((x) => x.product.id === product.id) ? list : [...list, { location: pin, product }]));
    landOn(product, pin);
  };

  /**
   * Send the shopper to a section of the store — an aisle, a department, an
   * area, a shelf group. Its shelves light up and are outlined, 2D frames it
   * (3D keeps the store-wide angle, as for an item), and the walk is drawn
   * from the entrance to the shelf of it that is nearest. A place with no
   * shelves (the restrooms, the checkouts) is walked to its middle.
   */
  const focusSection = (picked: Section) => {
    if (!data || !floor) return;
    setQ('');
    setSearchOpen(false);
    setSheetProduct(null);
    setGroupSheetId(null);
    setBrowseCat(null);
    setFocusProduct(null);
    setHighlightFacingId(null);
    setSentTo(null);
    setSection(picked);
    const middle = { x: (picked.box.x0 + picked.box.x1) / 2, y: (picked.box.y0 + picked.box.y1) / 2 };
    // the shelves nearest the entrance the shopper is taken to come from — of
    // those, the one with the shortest walk is where the route ends
    const start = pickStartPoint(floorEls, floor, middle);
    const nearest = groupPinsOf(picked.shelfIds)
      .map((pin) => ({ pin, d: Math.hypot(pin.location.x - start.x, pin.location.y - start.y) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 3);
    let best: { pin: Pin | null; route: ReturnType<typeof computeRoute> } = { pin: null, route: null };
    const walk = (pin: Pin) => computeRoute(floor, floorEls, { x: pin.location.x, y: pin.location.y }, {}, navGrid ?? undefined);
    for (const { pin } of nearest) {
      const route = walk(pin);
      if (route && (!best.route || route.distanceM < best.route.distanceM)) best = { pin, route };
    }
    if (!best.route) best = { pin: null, route: computeRoute(floor, floorEls, middle, {}, navGrid ?? undefined) };
    setFocusPinLocationId(best.pin?.location.id ?? null);
    window.clearTimeout(focusTimer.current);
    // a card listing shelves is taller than one that only names a place
    setFocusCmd({
      ...middle, seq: (focusCmd?.seq ?? 0) + 1,
      box: { ...picked.box, keepTop: picked.shelfIds.length ? undefined : 96 },
    });
    setCam3d(fitCamera(floor, aspect));
    setRoute(best.route ? { floorId: floor.id, points: best.route.points, distanceM: best.route.distanceM } : null);
  };

  /** Fetch the stretch of a shelf around a place (0..1 from its left end). */
  const loadWindow = (shelfId: string, u: number | null | undefined) => {
    if (!data) return;
    const at = Math.min(1, Math.max(0, u ?? 0.5));
    if (shelfWin?.shelfId === shelfId && Math.abs(shelfWin.u - at) < 1e-4 && (shelfWin.win || shelfWin.loading)) return;
    const seq = ++winSeq.current;
    setShelfWin((s) => (s?.shelfId === shelfId ? { ...s, u: at, loading: true } : { shelfId, u: at, win: null, loading: true }));
    // a phone shows a tighter stretch: the board is narrow, and a window is
    // scrolled sideways rather than squashed
    api.shelfWindow(data.store.slug, shelfId, at, chrome && chrome.w <= 760 ? 3 : 6)
      .then((win) => {
        if (seq === winSeq.current) setShelfWin({ shelfId, u: at, win, loading: false });
      })
      .catch(() => {
        // keep what the shelf already shows; a first window that cannot be
        // loaded leaves the store's own facings, and the planogram says so
        if (seq === winSeq.current) setShelfWin((s) => (s?.shelfId === shelfId ? { ...s, loading: false } : s));
      });
  };

  /** Open a shelf's planogram — for a catalogue store the window around `u`,
   *  by default around the item the shopper is being sent to if it is on this shelf. */
  const openShelf = (shelfId: string, u?: number | null) => {
    setGroupSheetId(null);
    if (isRemote) loadWindow(shelfId, u ?? (sentTo?.shelfId === shelfId ? sentTo.u : null));
    setShelfPopupId(shelfId);
  };

  /** Look one stretch further along the shelf that is open. */
  const shiftWindow = (dir: -1 | 1) => {
    if (!shelfWin?.win) return;
    loadWindow(shelfWin.shelfId, shelfWin.u + dir * (shelfWin.win.to - shelfWin.win.from) * 0.8);
  };

  /** A tap on a shelf or on its group's pin: the group's card. The planogram
   *  is the card's one button, so a catalogue store fetches its window now. */
  const tapShelf = (shelfId: string) => {
    setSheetProduct(null);
    setGroupSheetId(shelfId);
    if (isRemote) loadWindow(shelfId, sentTo?.shelfId === shelfId ? sentTo.u : null);
  };

  const onPinTap = (productId: string) => {
    // a group's titled pin is the group — never the one item it happens to carry
    const pin = floorPins.find((x) => x.location.product_id === productId && locationFlags(x.location).groupPin);
    const shelfId = pin ? shelfIdOfPin(pin.location) : null;
    if (shelfId) {
      tapShelf(shelfId);
      return;
    }
    // a catalogue item's stand-in pin, or a plain (legacy) pin: that item
    const sent = remotePins.find((x) => x.product.id === productId);
    if (sent) {
      focusResult(sent.product, sent.location);
      return;
    }
    const p = data?.products.find((pr) => pr.id === productId);
    if (p) focusResult(p);
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
    setSection(null);
    setRoute(null);
    setFocusPinLocationId(null);
    setFocusProduct(null);
    setHighlightFacingId(null);
    setSentTo(null);
    setSheetProduct(null);
  };

  /** Add an item as the next trip stop (A1). `facing` is one the shopper
   *  picked on a planogram: for a catalogue item that was never searched for
   *  it is the only way to know where the item stands. */
  const addToTrip = (product: Product, facing?: ProductLocation) => {
    const catalogue = !!data?.catalog && !data?.products.some((p) => p.id === product.id);
    const first = data?.locations.find((l) => l.product_id === product.id);
    const loc = catalogue
      ? facing
        ? pinFor(facing)
        : (remotePins.find((x) => x.product.id === product.id)?.location ?? null)
      : // the trip stops at the item's GROUP pin — the same spot a search routes to
        first
        ? groupPins.of(first)
        : null;
    if (!loc) return;
    if (catalogue) setRemotePins((list) => (list.some((x) => x.product.id === product.id) ? list : [...list, { location: loc, product }]));
    setTrip((t) => (t.some((x) => x.product.id === product.id) ? t : [...t, { product, loc }]));
    setSheetProduct(null);
  };

  /** One camera-pad tap = one smooth glide (~0.45 s); per-frame eased chunks
   *  sum to 1, so a pan covers ~18% of the view and a zoom step is ×0.78. */
  const cam3dMove = (dirX: number, dirY: number, zoom: number, dt: number) => {
    setCam3d((c) => {
      const base = c ?? fitCamera(floor, aspect);
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



  const results = hits.slice(0, 40);

  // the section's card: its shelf groups, and the line under its name
  const sectionGroups = (section?.shelfIds ?? []).map((id) => shelfById(id)).filter((g): g is MapElement => !!g);
  const sectionNote = !section
    ? ''
    : [
        ...section.sub,
        // an aisle's line names its departments; how many shelves line it is said here
        ...(section.kind === 'aisle' ? [sectionGroups.length === 1 ? '1 shelf' : `${sectionGroups.length} shelves`] : []),
      ]
        .join(' · ') || (section.kind === 'area' ? 'Area of the store' : '');

  // what a group's card says under its name: how much the shelf holds. A
  // catalogue store's total arrives with the window the card has fetched.
  const ownCount = groupSheet ? computeShelfLayout(groupSheet, ownPins)?.bays.reduce((n, b) => n + b.slots.length, 0) ?? 0 : 0;
  const groupNote = !groupSheet
    ? ''
    : isRemote
      ? shelfWin?.shelfId === groupSheet.id && shelfWin.win
        ? `≈${shelfFacings(shelfWin.win).toLocaleString('en-US')} products`
        : ''
      : `${ownCount} product${ownCount === 1 ? '' : 's'}`;
  // the planogram's direction line, for an item that faces elsewhere too
  const elsewhereNote =
    sentTo && sentTo.facingId === highlightFacingId && sentTo.elsewhere > 0
      ? `Also in ${sentTo.elsewhere} other ${sentTo.elsewhere === 1 ? 'place' : 'places'} — this is the closest.`
      : null;
  // the sheet's "＋ Add to list" needs to know where the item stands
  const canList =
    !!sheetProduct && (sentTo?.productId === sheetProduct.id || !!data?.locations.some((l) => l.product_id === sheetProduct.id));

  return (
    <div className="viewer-full">
      <div className={'viewer-map' + (view3d && camPadOpen ? ' pad-open' : '')} ref={mapRef}>
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
              onElementClick={(el) => el.type === 'shelf' && tapShelf(el.id)}
              onPinClick={onPinTap}
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
            highlightElementIds={sectionHighlight}
            focus={focusCmd ?? undefined}
            route={tripLegsFlat ?? activeRoute?.points ?? null}
            tripStops={tripResult ? tripResult.tour.order : undefined}
            onElementClick={(el) => el.type === 'shelf' && tapShelf(el.id)}
            onPinClick={onPinTap}
            zoomCommand={zoomCmd ?? undefined}
            fit={mapFit}
          />
        )}
        {/* the control column: on a phone the pan pad (3D) stacks above the zoom
            buttons along the right edge — display: contents elsewhere */}
        <div className="viewer-side">
          {view3d && (camPadOpen ? (
            <CameraPad onMove={cam3dMove} onClose={() => setCamPadOpen(false)} />
          ) : (
            <CameraToggle onOpen={() => setCamPadOpen(true)} />
          ))}
          <ZoomPad onZoom={(dir) => setZoomCmd({ k: dir > 0 ? 1.3 : 0.77, seq: (zoomCmd?.seq ?? 0) + 1 })} />
        </div>

        <div className="viewer-ui-top" ref={topBarRef}>
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
          <button className="edit-btn" onClick={goEdit} title={preview ? 'Leave the shopper preview' : 'Open this map in the editor'}>
            {preview ? '◀ Back to editor' : '✎ Edit map'}
          </button>
          <SearchBox
            value={q}
            onChange={(v) => { setQ(v); setBrowseCat(null); }}
            hits={results}
            onPick={(hit) => focusResult(hit)}
            sections={sectionHits}
            onPickSection={focusSection}
            activeSectionKey={section?.key ?? null}
            open={searchOpen}
            setOpen={setSearchOpen}
            placeholder="Search an item… e.g. milk"
            images={showResultImages}
            onToggleImages={() => setShowResultImages((v) => !v)}
            focusedId={focusPinLocationId}
          />
          <div className="view-toggle" aria-label="Map view mode">
            <button className={!view3d ? 'active' : ''} aria-pressed={!view3d} onClick={() => switchView(false)}>
              2D
            </button>
            <button className={view3d ? 'active' : ''} aria-pressed={view3d} onClick={() => switchView(true)}>
              3D
            </button>
          </div>
          <ThemeSettings />
          {/* phones: the bar wraps right here — identity and view on one row, search below */}
          <span className="viewer-top-break" aria-hidden />
        </div>

        {/* the stack: on a phone these share the bottom-left, one above the other — display: contents elsewhere */}
        <div className="viewer-stack">
          {activeRoute && !hasSearch && (
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
                    onClick={() => { setActiveFloorId(f.id); setFocusPinLocationId(null); setFocusProduct(null); setHighlightFacingId(null); }}
                  >
                    {f.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* the aisle directory button was removed — dirOpen stays false and
              the panel below is kept for the data it renders */}
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
                      onClick={() => { setDirOpen(false); openShelf(row.shelfIds[0]); }}
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

          {offline && !preview && (
            <div className="offline-banner">⚡ Offline — showing the saved map. Search and routes still work.</div>
          )}

          {/* live text for screen readers (A3/G1) */}
          <div aria-live="polite" className="sr-only">{liveMessage}</div>

          {/* a tapped shelf or group: its name, and the one way in */}
          {groupSheet && (
            <div className="product-sheet group-sheet card" role="dialog" aria-label={groupDisplayName(groupSheet) ?? 'Shelf'}>
              <span className="dot" style={{ background: groupSheet.color || '#2f6f3e' }} />
              <div className="sheet-info">
                <b>{groupDisplayName(groupSheet) ?? 'Shelf'}</b>
                {groupNote && <span>{groupNote}</span>}
              </div>
              <button className="route-badge-x" onClick={() => setGroupSheetId(null)} aria-label="Close">✕</button>
              <div className="sheet-actions">
                <button className="btn sm primary" onClick={() => openShelf(groupSheet.id)}>
                  ▦ View shelf
                </button>
              </div>
            </div>
          )}

          {/* a section picked in the search: its name, and the shelf groups inside it (a group's card
              takes its place while that is open, and gives it back when closed) */}
          {section && !groupSheet && !sheetProduct && (
            <div className="product-sheet group-sheet section-sheet card" role="dialog" aria-label={section.name}>
              <span className="dot" style={{ background: section.color }} />
              <div className="sheet-info">
                <b>{section.name}</b>
                {sectionNote && <span>{sectionNote}</span>}
              </div>
              <button className="route-badge-x" onClick={clearRoute} aria-label="Close">✕</button>
              {sectionGroups.length > 0 && (
                <div className="sheet-groups" aria-label="Shelves in this section">
                  {sectionGroups.map((g) => (
                    <button key={g.id} className="dir-cat" onClick={() => tapShelf(g.id)} title="Show this shelf">
                      <span className="dot" style={{ background: g.color || section.color }} aria-hidden />
                      {groupDisplayName(g) ?? 'Shelf'}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* A4: selected-item sheet — photo · name · where to look · close, then the actions */}
          {sheetProduct && (
            <div className="product-sheet card">
              {sheetProduct.image_url || sheetProduct.image_crop_url
                ? <img src={sheetProduct.image_crop_url || sheetProduct.image_url} alt="" width={40} height={40} style={{ borderRadius: 8, objectFit: 'contain', background: 'var(--chip)' }} />
                : <span className="dot" style={{ background: sheetProduct.category_color || '#2f6f3e' }} />}
              <div className="sheet-info">
                <b>{sheetProduct.name}</b>
                <span>
                  {[sheetProduct.brand, sheetProduct.price != null ? `$${sheetProduct.price.toFixed(2)}` : '', sheetProduct.category_name]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                  {sheetPlace && (
                    <span className="sheet-where">
                      {sheetPlace.text}
                      {sheetPlace.more}
                    </span>
                  )}
              </div>
              <button className="route-badge-x" onClick={() => setSheetProduct(null)} aria-label="Close">✕</button>
              <div className="sheet-actions">
                <button className="btn sm" onClick={() => addToTrip(sheetProduct)} disabled={!canList}>
                  ＋ Add to list
                </button>
                {sheetShelf && (
                  <button
                    className="btn sm"
                    title="See this shelf's planogram around the item"
                    onClick={() => openShelf(sheetShelf.id, sheetPlace?.u)}
                  >
                    ▦ View shelf
                  </button>
                )}
                {FLY_ENABLED && <button className="fly-btn" onClick={startFlight}>✈ Fly</button>}
              </div>
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
              <span className="hint-fine">
                {view3d
                  ? 'Hover an aisle to peek inside · search an item to see the route'
                  : 'Hover or tap a shelf to see what\'s on it · pinch or scroll to zoom'}
              </span>
              <span className="hint-coarse">
                {view3d
                  ? "Tap a shelf or group to see what's on it · search an item to see the route"
                  : 'Tap a shelf to see what\'s on it · pinch to zoom'}
              </span>
            </div>
          )}
        </div>

        {!preview && (
          <Link to="/" className="powered-by" aria-label="item.place — home">
            <span className="powered-mark" aria-hidden>▦</span>
            <BlockText text="item.place" cell={1.7} />
          </Link>
        )}

        {selectedShelf && (
          <ShelfDetail
            shelf={selectedShelf}
            pins={ownPins}
            // a catalogue store's planogram is the window fetched for this shelf
            shelfWindow={isRemote ? (shelfWin?.shelfId === selectedShelf.id ? shelfWin.win : null) : undefined}
            windowLoading={isRemote && shelfWin?.shelfId === selectedShelf.id && shelfWin.loading}
            elsewhere={elsewhereNote}
            onShiftWindow={isRemote ? shiftWindow : undefined}
            // the window rings the item sent to, and only that (the focused
            // group's pin is no item of the planogram)
            highlightLocationId={isRemote ? highlightFacingId : highlightFacingId ?? focusPinLocationId}
            onClose={() => setShelfPopupId(null)}
            onAddToList={addToTrip}
            onPickProduct={(p, facing) => {
              setShelfPopupId(null);
              focusResult(p, facing);
            }}
          />
        )}
      </div>
    </div>
  );
}
