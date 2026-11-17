import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import Map3D from './Map3D';
import GridHero, { BlockText } from './GridHero';
import { useAuth } from '../App';
import type { MapElement, Product, ProductLocation, PublicStorePayload, RectGeom } from '../types';
import { parseElement } from '../types';
import type { WorldPt } from '../lib/geometry';
import type { Camera3D } from '../lib/render3d';
import { fitCamera, MODERN_THEME, DARK_THEME } from '../lib/render3d';
import { computeRoute } from '../lib/navgrid';
import { useTheme } from '../theme';

/** The rotating hero examples — each opens as a no-account sandbox copy. */
const EXAMPLES = [
  { slug: 'freshmart-downtown', name: 'Freshmart Downtown', kind: 'Supermarket' },
  { slug: 'harbor-warehouse', name: 'Harbor Warehouse', kind: 'Warehouse' },
  { slug: 'megamart-central', name: 'Megamart Central', kind: 'Big-box store' },
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
  const [demo, setDemo] = useState<{
    name: string;
    where: string;
    dist: number;
    points: WorldPt[] | null;
    loc: ProductLocation;
    product: Product;
  } | null>(null);

  // the preview is a live map: any visitor gesture takes over the camera and
  // cancels the intro swing
  const onCamera = useCallback((c: Camera3D) => {
    userDrove.current = true;
    setCam(c);
  }, []);

  const floor = data.floors[0] ?? null;
  const { resolved } = useTheme();
  const sceneTheme = resolved === 'dark' ? DARK_THEME : MODERN_THEME;
  const elements = useMemo(() => data.elements.map(parseElement), [data]);

  // every few seconds: route a shopper from the entrance to a random item
  useEffect(() => {
    if (!floor) return;
    let live = true;
    const floorEls = elements.filter((e) => e.floor_id === floor.id);
    const locs = data.locations.filter((l) => l.floor_id === floor.id);
    const pick = () => {
      const loc = locs[Math.floor(Math.random() * locs.length)];
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

/** The hero visual cycles the live examples; each carries edit + view actions. */
function HeroCarousel() {
  const [payloads, setPayloads] = useState<Record<string, PublicStorePayload | null>>({});
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);

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
              ⧉ Edit a copy — free
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

  return (
    <main className="container">
      <GridHero />

      <section className="hero">
        <HeroCarousel />
        <div className="hero-cta">
          <Link to={user ? '/dashboard' : '/try/blank'} className="btn primary" aria-label="Create a Map">
            <BlockText text="Create a Map" cell={4} />
          </Link>
        </div>
      </section>

      <footer className="footer">item.place - <a href="https://github.com/eman101101/storemaplocal" target="_blank" rel="noreferrer">Host your own maps</a></footer>
    </main>
  );
}
