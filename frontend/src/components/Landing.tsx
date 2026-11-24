import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import Map3D from './Map3D';
import GridHero, { BlockText } from './GridHero';
import { PlanogramSvg } from './ShelfDetail';
import { compactFilledLayout, computeShelfLayout, type ShelfLayout, type ShelfSlot } from '../lib/shelfLayout';
import { useAuth } from '../App';
import type { MapElement, Product, ProductLocation, PublicStorePayload, RectGeom } from '../types';
import { parseElement } from '../types';
import type { WorldPt } from '../lib/geometry';
import type { Camera3D } from '../lib/render3d';
import { fitCamera, MODERN_THEME, DARK_THEME } from '../lib/render3d';
import { computeRoute } from '../lib/navgrid';
import PricingModal from './PricingModal';
import { useTheme } from '../theme';

/** The homepage examples — the seeded demo stores, opened as no-account
 *  sandbox copies from the hero. */
const EXAMPLES = [
  { slug: 'walmart-example', name: 'Walmart Example', kind: 'Supercenter' },
  { slug: 'home-depot-example', name: 'Home Depot Example', kind: 'Hardware Store' },
  { slug: 'convenience-store-example', name: 'Corner Store Example', kind: 'Convenience Store' },
];

/** The hero's settle-in motion: a slow, decelerating swing (~29°) that glides
 *  to a stop — a hint of life, not the endless orbit it replaced. */
const HERO_SPIN_RAD = 0.5;
const HERO_SPIN_MS = 2600;

/** One example store in 3D, with a live "directions to a random item" demo —
 *  the product IS the demo. The camera eases through one slight swing and
 *  settles into a closer-than-fit framing. */
function HeroMap({ data }: { data: PublicStorePayload }) {
  const [cam, setCam] = useState<Camera3D | null>(null);
  const userDrove = useRef(false);
  // the preview is a live map: any visitor gesture takes over the camera and
  // cancels the intro swing
  const onCamera = useCallback((c: Camera3D) => {
    userDrove.current = true;
    setCam(c);
  }, []);
  const [demo, setDemo] = useState<{
    name: string;
    where: string;
    dist: number;
    points: WorldPt[] | null;
    loc: ProductLocation;
    product: Product;
  } | null>(null);
  // hero search: a visitor can look up a real item instead of waiting for the
  // rotating demo — the found item holds the map until the query is cleared
  const [query, setQuery] = useState('');
  const [miss, setMiss] = useState(false);
  const [missMsg, setMissMsg] = useState('');
  const searchHold = useRef(false);

  const floor = data.floors[0] ?? null;
  const { resolved } = useTheme();
  const sceneTheme = resolved === 'dark' ? DARK_THEME : MODERN_THEME;
  const elements = useMemo(() => data.elements.map(parseElement), [data]);

  // every few seconds: route a shopper from the entrance to a random item —
  // paused while a searched item holds the map
  useEffect(() => {
    if (!floor) return;
    let live = true;
    const floorEls = elements.filter((e) => e.floor_id === floor.id);
    const locs = data.locations.filter((l) => l.floor_id === floor.id);
    const pick = () => {
      if (searchHold.current) return;
      const loc = locs[Math.floor(Math.random() * locs.length)];
      if (!loc) return; // map has no pins yet — nothing to route the demo to
      const product = data.products.find((p) => p.id === loc.product_id);
      if (!product) return;
      const r = computeRoute(floor, floorEls, { x: loc.x, y: loc.y });
      // the nearest labelled fixture names where the item lives
      let where = '';
      let best = 8;
      for (const el of floorEls) {
        if (el.type !== 'shelf' || !el.label) continue;
        const g = el.geom as RectGeom;
        const d = Math.hypot(g.x + g.w / 2 - loc.x, g.y + g.h / 2 - loc.y);
        if (d < best) {
          best = d;
          where = el.label.split('·')[0].trim();
        }
      }
      if (live) {
        setDemo({
          name: product.name,
          where: where || floor.name,
          dist: r ? Math.round(r.distanceM) : 0,
          points: r?.points ?? null,
          loc,
          product,
        });
      }
    };
    pick();
    const t = window.setInterval(pick, 5000);
    return () => {
      live = false;
      window.clearInterval(t);
    };
  }, [data, floor, elements]);

  const findItem = () => {
    const needle = query.trim().toLowerCase();
    if (!floor || !needle) {
      searchHold.current = false;
      setMiss(false);
      return;
    }
    // a stocked match wins — the demo routes to where the item actually sits
    const matches = data.products.filter((p) =>
      `${p.name} ${p.brand} ${p.sku} ${p.category_name ?? ''}`.toLowerCase().includes(needle)
    );
    if (!matches.length) {
      searchHold.current = true;
      setMiss(true);
      setMissMsg(`Nothing matches “${query.trim()}” — try “milk” or “crisps”.`);
      setDemo(null);
      return;
    }
    const product =
      matches.find((p) => data.locations.some((l) => l.product_id === p.id)) ?? matches[0];
    // prefer the item's group pin; a planogram-only facing still routes fine
    const loc =
      data.locations.find((l) => {
        if (l.product_id !== product.id) return false;
        try { return !JSON.parse(l.meta || '{}').groupOnly; } catch { return true; }
      }) ?? data.locations.find((l) => l.product_id === product.id);
    if (!loc) {
      searchHold.current = true;
      setMiss(true);
      setMissMsg(`${product.name} matches, but it isn't stocked on this map.`);
      setDemo(null);
      return;
    }
    searchHold.current = true;
    setMiss(false);
    const floorEls = elements.filter((e) => e.floor_id === floor.id);
    const r = computeRoute(floor, floorEls, { x: loc.x, y: loc.y });
    let where = '';
    let best = 8;
    for (const el of floorEls) {
      if (el.type !== 'shelf' || !el.label) continue;
      const g = el.geom as RectGeom;
      const d = Math.hypot(g.x + g.w / 2 - loc.x, g.y + g.h / 2 - loc.y);
      if (d < best) {
        best = d;
        where = el.label.split('·')[0].trim();
      }
    }
    setDemo({
      name: product.name,
      where: where || floor.name,
      dist: r ? Math.round(r.distanceM) : 0,
      points: r?.points ?? null,
      loc,
      product,
    });
    // lean the camera toward the found aisle
    setCam((c) => (c ? { ...c, tx: loc.x, ty: loc.y, dist: Math.max(8, Math.min(c.dist, 20)) } : c));
  };

  // start a bit closer than a full-floor fit, then swing slowly to a stop —
  // still for visitors who prefer reduced motion; a user gesture ends it early
  useEffect(() => {
    if (!floor) return;
    const fit = fitCamera(floor);
    const start = { ...fit, dist: Math.max(10, fit.dist * 0.7) };
    if (cam === null) setCam(start);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      if (userDrove.current) return; // the visitor has the camera now
      const t = Math.min(1, (now - t0) / HERO_SPIN_MS);
      const e = 1 - Math.pow(1 - t, 3); // ease-out cubic — glides to a halt
      setCam((c) => (c ? { ...c, yaw: start.yaw + HERO_SPIN_RAD * e } : c));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cam === null, floor]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!floor || !cam) return null;
  const demoPins = demo ? [{ location: demo.loc, product: demo.product }] : [];
  return (
    <>
      <div className="hero-map">
        {/* live and interactive: drag orbits, ctrl/⌘+wheel zooms, vertical
            swipes still scroll the page (touch-action: pan-y) */}
        <Map3D
          floor={floor}
          elements={elements.filter((e: MapElement) => e.floor_id === floor.id)}
          pins={demoPins}
          stockPins={demoPins}
          focusPinId={demo?.loc.id ?? null}
          route={demo?.points ?? undefined}
          camera={cam}
          onCamera={onCamera}
          theme={sceneTheme}
          wheelZoom="ctrl"
          touchAction="pan-y"
        />
        {/* hero search: find a real item on the demo map — the route and the
            chip follow the search until it is cleared */}
        <div className="hero-search">
          <input
            className="input"
            placeholder={`Find an item in ${data.store.name}…`}
            aria-label={`Find an item in ${data.store.name}`}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (!e.target.value.trim()) {
                searchHold.current = false;
                setMiss(false);
                setMissMsg('');
              }
            }}
            onKeyDown={(e) => { if (e.key === 'Enter') findItem(); }}
          />
          <button type="button" className="btn primary sm" onClick={findItem}>Find</button>
          {query.trim() && (
            <button
              type="button"
              className="route-badge-x"
              aria-label="Clear search"
              onClick={() => { setQuery(''); searchHold.current = false; setMiss(false); }}
            >
              ✕
            </button>
          )}
          {miss && <span className="hero-search-miss">{missMsg || 'Not found on this map.'}</span>}
        </div>
      </div>
      {demo && (
        <div className="hero-demo-chip">
          <span aria-hidden>🧭</span> <b>{demo.name}</b>
          <span>
            → {demo.where}
            {demo.dist ? ` · ${demo.dist} m` : ''}
          </span>
        </div>
      )}
    </>
  );
}

/** The homepage Planograms band. Auto-picks the two best demo shelves, and
 *  lets the visitor customize it: choose a store, then any eligible shelf of
 *  that store, and the band renders that planogram instead. Hidden when the
 *  payloads have no usable shelf. */
function HeroPlanogram({ payloads }: { payloads: Record<string, PublicStorePayload | null> }) {
  // every eligible shelf of every example store, scored by photo count + fill
  const byStore = useMemo(() => {
    const map: Record<string, { layout: ShelfLayout; label: string; score: number }[]> = {};
    for (const { slug, name } of EXAMPLES) {
      const data = payloads[slug];
      if (!data || !data.floors[0]) continue;
      const elements = data.elements.map(parseElement);
      const floor = data.floors[0];
      const pins = data.locations
        .filter((l) => l.floor_id === floor.id)
        .map((l) => ({ location: l, product: data.products.find((p) => p.id === l.product_id) }))
        .filter((x): x is { location: ProductLocation; product: Product } => !!x.product);
      const list: { layout: ShelfLayout; label: string; score: number }[] = [];
      for (const el of elements) {
        if (el.floor_id !== floor.id || el.type !== 'shelf' || el.shape !== 'rect') continue;
        const g = el.geom as RectGeom;
        if (g.w < g.h) continue; // landscape shelves planogram sensibly
        const layout = computeShelfLayout(el, pins);
        if (!layout) continue;
        const total = layout.bays.reduce((n, b) => n + b.slots.length, 0);
        const withImgs = layout.bays.reduce(
          (n, b) => n + b.slots.filter((s) => s.product.image_crop_url || s.product.image_url).length,
          0
        );
        if (withImgs === 0 || total < 3) continue;
        list.push({ layout, label: el.label, score: withImgs * 3 + total });
      }
      if (list.length) {
        list.sort((x, y) => y.score - x.score);
        map[slug] = list;
      }
    }
    return map;
  }, [payloads]);

  // the auto picks: the two best shelves of different sizes (previous behavior)
  const picks = useMemo(() => {
    const all = Object.values(byStore).flat();
    const out: typeof all = [];
    const seenW = new Set<number>();
    for (const cand of all) {
      const w = Math.round(cand.layout.width);
      if (seenW.has(w)) continue;
      seenW.add(w);
      out.push(cand);
      if (out.length >= 2) break;
    }
    return out;
  }, [byStore]);

  if (picks.length === 0) return null;
  return (
    <div className="planogram-grid">
      {picks.map((p) => (
        <ShelfCard key={p.layout.shelfId} layout={p.layout} label={p.label} />
      ))}
    </div>
  );
}


function ShelfCard({ layout: initial, label }: { layout: ShelfLayout; label: string }) {
  // the homepage planogram is a live sandbox: Edit-planogram keeps the layout
  // exactly as shown and unlocks free dragging, row add/remove, length and
  // per-item resize — purely local, nothing is saved.
  const [layout, setLayout] = useState(() =>
    compactFilledLayout(initial, initial.bays.flatMap((b) => b.slots))
  );
  const [editing, setEditing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const hasImages = layout.bays.some((b) => b.slots.some((s) => s.product.image_crop_url || s.product.image_url));
  const shownCount = layout.bays.reduce((n, b) => n + b.slots.length, 0);

  const patchSlots = (fn: (s: ShelfSlot) => ShelfSlot) =>
    setLayout((prev) => {
      const bays = prev.bays.map((b) => ({ ...b, slots: b.slots.map(fn) }));
      for (const b of bays) b.slots.sort((x, y) => x.u - y.u);
      return { ...prev, bays };
    });
  const moveFacing = (locationId: string, u: number, level: number) =>
    patchSlots((s) =>
      s.locationId === locationId
        ? { ...s, u: Math.min(1, Math.max(0, u)), level: Math.min(layout.levels, Math.max(1, level)) }
        : s
    );
  const resizeFacing = (locationId: string, w: number) =>
    patchSlots((s) =>
      s.locationId === locationId ? { ...s, facingWidth: Math.min(3, Math.max(0.05, w)) } : s
    );
  const setRows = (levels: number) => {
    const next = Math.min(8, Math.max(1, levels));
    setLayout((prev) => ({
      ...prev,
      levels: next,
      bays: prev.bays.map((b) => ({
        ...b,
        slots: b.slots.map((s) => ({ ...s, level: Math.min(s.level, next) })),
      })),
    }));
  };
  const setLength = (w: number) =>
    setLayout((prev) => ({ ...prev, width: w, meta: { ...prev.meta, planWidth: w } }));

  const allSlots = layout.bays.flatMap((b) => b.slots);
  const selected = selectedId ? allSlots.find((s) => s.locationId === selectedId) ?? null : null;

  return (
    <div className="planogram-card">
      <div className="planogram-card-head">
        <b>{label} — shelf planogram</b>
        <button
          type="button"
          className={`btn sm ${editing ? 'primary' : ''}`}
          onClick={() => { setEditing((v) => !v); setSelectedId(null); }}
          title="Rearrange, resize, add/remove rows and change length — a local test, nothing is saved"
        >
          {editing ? '✓ Done' : '✎ Edit planogram'}
        </button>
      </div>
      <div className="planogram-scroll">
        <PlanogramSvg
          layout={layout}
          mode={hasImages ? 'images' : 'diagram'}
          editing={editing}
          selectedId={selectedId}
          onSelectFacing={editing ? setSelectedId : undefined}
          onMoveFacing={editing ? moveFacing : undefined}
        />
      </div>
      {editing && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', fontSize: 12.5, margin: '8px 4px 0' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <b>Rows</b>
            <button type="button" className="btn sm" aria-label="Remove a row" disabled={layout.levels <= 1} onClick={() => setRows(layout.levels - 1)}>−</button>
            <span style={{ minWidth: 16, textAlign: 'center' }}>{layout.levels}</span>
            <button type="button" className="btn sm" aria-label="Add a row" disabled={layout.levels >= 8} onClick={() => setRows(layout.levels + 1)}>＋</button>
          </span>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            Length
            <input type="range" min={0.5} max={12} step={0.1} value={layout.width} style={{ width: 110 }}
              onChange={(e) => setLength(Number(e.target.value))} />
            <b style={{ minWidth: 44 }}>{layout.width.toFixed(1)} m</b>
          </label>
          {selected && (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              Photo W
              <input type="range" min={0.05} max={3} step={0.05} value={selected.facingWidth} style={{ width: 90 }}
                onChange={(e) => resizeFacing(selected.locationId, Number(e.target.value))} />
              <b style={{ minWidth: 44 }}>{selected.facingWidth.toFixed(2)} m</b>
            </label>
          )}
          <span className="muted">drag items · tap a photo to resize — nothing is saved</span>
        </div>
      )}
      {!editing && (
        <p className="muted" style={{ fontSize: 12.5, margin: '8px 4px 0' }}>
          {shownCount} products · {layout.levels} rows · {layout.width.toFixed(1)} m
        </p>
      )}
    </div>
  );
}

/** The hero visual cycles the live examples; each carries edit + view actions. */
function HeroCarousel({ payloads }: { payloads: Record<string, PublicStorePayload | null> }) {
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);

  // rotate through the examples until the visitor takes over
  const reduced =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  useEffect(() => {
    if (paused || reduced) return;
    const t = window.setInterval(() => setIdx((i) => (i + 1) % EXAMPLES.length), 8000);
    return () => window.clearInterval(t);
  }, [paused, reduced]);

  const current = EXAMPLES[idx];
  const data = payloads[current.slug];
  const go = (dir: number) => setIdx((i) => (i + dir + EXAMPLES.length) % EXAMPLES.length);

  return (
    <div
      className="hero-visual"
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
    >
      {data && <HeroMap key={current.slug} data={data} />}
      {data && (
        <div className="hero-store-pill">
          <b>{data.store.name}</b>
          <span className="badge">{current.kind}</span>
          <span className="muted">{data.products.length} products</span>
        </div>
      )}
      <div className="hero-carousel">
        <div className="hero-carousel-nav">
          <button aria-label="Previous example" onClick={() => go(-1)}>‹</button>
          <div className="hero-dots" role="tablist" aria-label="Example stores">
            {EXAMPLES.map((ex, i) => (
              <button
                key={ex.slug}
                role="tab"
                aria-selected={i === idx}
                className={i === idx ? 'active' : ''}
                title={ex.name}
                onClick={() => setIdx(i)}
              >
                {ex.name}
              </button>
            ))}
          </div>
          <button aria-label="Next example" onClick={() => go(1)}>›</button>
        </div>
        {data && (
          <div className="hero-carousel-actions">
            <Link className="btn primary sm" to={`/try/${current.slug}`} title="Opens this store as a sandbox copy in the editor">
              ⧉ Edit a copy
            </Link>
            <Link className="btn sm" to={`/s/${current.slug}`}>▶ View live</Link>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Landing() {
  const { user } = useAuth();
  const [pricingOpen, setPricingOpen] = useState(false);
  const [payloads, setPayloads] = useState<Record<string, PublicStorePayload | null>>({});

  // the example stores, fetched once for the carousel and the planogram band
  useEffect(() => {
    let live = true;
    for (const { slug } of EXAMPLES) {
      api.publicStore(slug)
        .then((p) => live && setPayloads((prev) => ({ ...prev, [slug]: p })))
        .catch(() => live && setPayloads((prev) => ({ ...prev, [slug]: null })));
    }
    return () => {
      live = false;
    };
  }, []);

  return (
    <main className="container">
      <GridHero />
      <p className="hero-tagline">Customer facing maps and planograms.</p>

      <section className="hero">
        <HeroCarousel payloads={payloads} />
        <div className="hero-cta">
          <Link to={user ? '/dashboard' : '/try/blank'} className="btn primary" aria-label="Create a Map">
            <BlockText text="Create a Map" cell={4} />
          </Link>
          <button
            className="btn"
            title="Free plan: maps with up to 1000 product photos per account · photo storage beyond that charged by MB used"
            onClick={() => setPricingOpen(true)}
          >
            Free w/ 1000 Photos
          </button>
        </div>
      </section>

      <section className="planogram-band">
        <h2>Planograms</h2>
        <HeroPlanogram payloads={payloads} />
      </section>

      {pricingOpen && <PricingModal onClose={() => setPricingOpen(false)} />}
      <footer className="footer">
        item.place - <a href="https://github.com/eman101101/storemaplocal" target="_blank" rel="noreferrer">Host your own maps</a>
        {' · '}
        Typeface: <a href="https://allo.joshpuckett.me/" target="_blank" rel="noreferrer" title="Allo — a free open-source variable typeface by Josh Puckett (SIL OFL)">Allo by Josh Puckett</a>
      </footer>
    </main>
  );
}
