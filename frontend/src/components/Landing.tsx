import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import Map3D from './Map3D';
import GridHero, { BlockText } from './GridHero';
import { PlanogramSvg } from './ShelfDetail';
import { compactFilledLayout, computeShelfLayout, type ShelfLayout, type ShelfSlot } from '../lib/shelfLayout';
import { buildGroupPins } from '../lib/itemGroups';
import { useAuth } from '../App';
import type { MapElement, Product, ProductLocation, PublicStorePayload, RectGeom } from '../types';
import { parseElement, groupDisplayName, locationFlags } from '../types';
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
const DEMO_EVERY_MS = 5000;

/** What the hero is showing: an item, the group its pin stands for, and the
 *  route from the entrance. */
interface Demo {
  name: string;
  where: string;
  dist: number;
  points: WorldPt[] | null;
  loc: ProductLocation;
  product: Product;
}

/** One example store in 3D with a live "directions to a random item" demo —
 *  the product IS the demo. (Searching belongs to the store view itself, one
 *  tap away on ▶ View live.) The camera eases through one slight swing and
 *  settles into a closer-than-fit framing. */
function HeroMap({ data, kind }: { data: PublicStorePayload; kind: string }) {
  const [cam, setCam] = useState<Camera3D | null>(null);
  const userDrove = useRef(false);
  // the preview is a live map: any visitor gesture takes over the camera and
  // cancels the intro swing
  const onCamera = useCallback((c: Camera3D) => {
    userDrove.current = true;
    setCam(c);
  }, []);
  const [demo, setDemo] = useState<Demo | null>(null);
  const demoRef = useRef<Demo | null>(null);
  demoRef.current = demo;

  const floor = data.floors[0] ?? null;
  const { resolved } = useTheme();
  const sceneTheme = resolved === 'dark' ? DARK_THEME : MODERN_THEME;
  const elements = useMemo(() => data.elements.map(parseElement), [data]);
  const shelves = useMemo(() => elements.filter((e) => e.type === 'shelf' && e.shape === 'rect'), [elements]);
  // every shelf group shows ONE pin; an item is planogram-only, so the demo
  // routes to the pin of the group it sits in
  const groupPins = useMemo(() => buildGroupPins(data.locations, shelves), [data, shelves]);

  /** Route from the entrance to an item's GROUP pin and show it. Returns the
   *  pin, or null when the item has no pin to show. */
  const routeTo = useCallback(
    (facing: ProductLocation, product: Product): ProductLocation | null => {
      const pin = groupPins.of(facing);
      if (!floor || locationFlags(pin).groupOnly) return null;
      const r = computeRoute(floor, elements.filter((e) => e.floor_id === floor.id), { x: pin.x, y: pin.y });
      setDemo({
        name: product.name,
        where: groupPins.nameOf(facing) ?? floor.name,
        dist: r ? Math.round(r.distanceM) : 0,
        points: r?.points ?? null,
        loc: pin,
        product,
      });
      return pin;
    },
    [elements, floor, groupPins]
  );

  // every few seconds: route a shopper from the entrance to a random item
  useEffect(() => {
    if (!floor) return;
    const locs = data.locations.filter((l) => l.floor_id === floor.id);
    if (!locs.length) return; // map has no pins yet — nothing to route the demo to
    const pick = () => {
      // a different group each time — the same pin twice reads as a stall
      for (let tries = 0; tries < 8; tries++) {
        const facing = locs[Math.floor(Math.random() * locs.length)];
        const product = data.products.find((p) => p.id === facing.product_id);
        if (!product) continue;
        if (tries < 7 && groupPins.of(facing).id === demoRef.current?.loc.id) continue;
        if (routeTo(facing, product)) return;
      }
    };
    pick();
    const t = window.setInterval(pick, DEMO_EVERY_MS);
    return () => window.clearInterval(t);
  }, [data, floor, groupPins, routeTo]);

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
      </div>
      <div className="hero-top">
        <div className="hero-store-pill">
          <b>{data.store.name}</b>
          <span className="badge">{kind}</span>
          <span className="muted">{data.products.length} products</span>
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
      </div>
    </>
  );
}

/** One shelf the homepage could show as a planogram. */
interface PlanogramPick {
  layout: ShelfLayout;
  /** the compact board the card draws (same re-grid as the store view) */
  board: ShelfLayout;
  label: string;
  store: string;
  slug: string;
  total: number;
  /** share of facings that carry a real product photo */
  coverage: number;
  cols: number;
  score: number;
}

const photoOf = (s: ShelfSlot) => s.product.image_crop_url || s.product.image_url || '';
/** A real product photo — not the generated packshot an item falls back to. */
const hasPhoto = (s: ShelfSlot) => !!photoOf(s) && !photoOf(s).includes('/gen/');

/** The homepage Planograms band: the best demo shelves, filled with photos.
 *  Every eligible shelf of every example store is scored — photo coverage
 *  first, then how well its size shows on a card (a dozen or so items in up
 *  to six columns reads biggest; a densely stocked shelf shrinks to slivers). */
function usePlanogramPicks(payloads: Record<string, PublicStorePayload | null>): PlanogramPick[] {
  return useMemo(() => {
    const all: PlanogramPick[] = [];
    for (const { slug } of EXAMPLES) {
      const data = payloads[slug];
      const floor = data?.floors[0];
      if (!data || !floor) continue;
      const elements = data.elements.map(parseElement);
      const pins = data.locations
        .filter((l) => l.floor_id === floor.id)
        .map((l) => ({ location: l, product: data.products.find((p) => p.id === l.product_id) }))
        .filter((x): x is { location: ProductLocation; product: Product } => !!x.product);
      for (const el of elements) {
        if (el.floor_id !== floor.id || el.type !== 'shelf' || el.shape !== 'rect') continue;
        const g = el.geom as RectGeom;
        if (g.w < g.h) continue; // landscape shelves planogram sensibly
        const layout = computeShelfLayout(el, pins);
        if (!layout) continue;
        const slots = layout.bays.flatMap((b) => b.slots);
        if (slots.length < 4) continue; // a couple of lost items is not a shelf
        const board = compactFilledLayout(layout, slots);
        const cols = board.bays.length;
        const coverage = slots.filter(hasPhoto).length / slots.length;
        // photo coverage first, then how well the shelf's size shows on a card
        const score = coverage * 100 - Math.abs(slots.length - 12) * 1.5 - Math.max(0, cols - 6) * 6;
        all.push({
          layout, board, cols, coverage, score, slug,
          label: groupDisplayName(el) ?? el.label,
          store: data.store.name.replace(/ Example$/, ''),
          total: slots.length,
        });
      }
    }
    all.sort((a, b) => b.score - a.score);
    const picks: PlanogramPick[] = [];
    const best = all[0];
    if (best) picks.push(best);
    // the second card comes from another example store when that store has a
    // shelf that is at least half real photos — otherwise the next best shelf
    const other = all.find((c) => c.slug !== best?.slug && c.coverage >= 0.5);
    const next = other ?? all.find((c) => c !== best && c.layout.shelfId !== best?.layout.shelfId);
    if (next) picks.push(next);
    return picks;
  }, [payloads]);
}

function ShelfCard({ pick }: { pick: PlanogramPick }) {
  const { label, store, board, coverage, total } = pick;
  // the homepage planogram is a live sandbox: Edit-planogram keeps the layout
  // exactly as shown and unlocks free dragging, row add/remove, length and
  // per-item resize — purely local, nothing is saved.
  const [layout, setLayout] = useState<ShelfLayout>(() => board);
  const [editing, setEditing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const shownCount = layout.bays.reduce((n, b) => n + b.slots.length, 0);
  const withPhotos = layout.bays.reduce((n, b) => n + b.slots.filter(hasPhoto).length, 0);

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
        <b>
          {label} <span className="muted">· {store}</span> — shelf planogram
        </b>
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
          mode={withPhotos ? 'images' : 'diagram'}
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
          {total} products · {layout.levels} rows · {layout.width.toFixed(1)} m
          {coverage < 1 ? ` · ${Math.round(coverage * 100)}% with photos` : ''}
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
      {data && <HeroMap key={current.slug} data={data} kind={current.kind} />}
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

  const picks = usePlanogramPicks(payloads);

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

      {picks.length > 0 && (
        <section className="planogram-band">
          <h2>Planograms</h2>
          <p className="muted">Every shelf of every example map has a planogram — tap a shelf in the store view to open its own.</p>
          <div className="planogram-grid">
            {picks.map((p) => (
              <ShelfCard key={p.layout.shelfId} pick={p} />
            ))}
          </div>
        </section>
      )}

      {pricingOpen && <PricingModal onClose={() => setPricingOpen(false)} />}
      <footer className="footer">
        item.place - <a href="https://github.com/eman101101/storemaplocal" target="_blank" rel="noreferrer">Host your own maps</a>
        {' · '}
        Typeface: <a href="https://allo.joshpuckett.me/" target="_blank" rel="noreferrer" title="Allo — a free open-source variable typeface by Josh Puckett (SIL OFL)">Allo by Josh Puckett</a>
      </footer>
    </main>
  );
}
