/**
 * GridHero — the homepage wordmark played as the product itself.
 * "StoreMap" is spelled out in a 5×7 grid font on a board of faint cells,
 * then a wayfinding route (same white casing + orange line as the store
 * maps) walks the grid from an entrance flag and arrives at a pin dropped
 * on a spot on the name — the vertex of the "M".
 *
 * Static SVG + one rAF loop; renders the finished route (no animation)
 * under prefers-reduced-motion or where rAF is missing. Click replays.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

export const WORD = 'StoreMap';

/* 5×7 grid font ('#' = cell on). Lowercase sits on rows 2–6 like a real
   bitmap font; only the letters used by the wordmark are defined. */
export const GRID_GLYPHS: Record<string, string[]> = {
  S: ['.###.', '#...#', '#....', '.###.', '....#', '#...#', '.###.'],
  t: ['.#...', '.#...', '###..', '.#...', '.#...', '.#...', '..##.'],
  o: ['.....', '.....', '.###.', '#...#', '#...#', '#...#', '.###.'],
  r: ['.....', '.....', '#.##.', '##...', '#....', '#....', '#....'],
  e: ['.....', '.....', '.###.', '#...#', '#####', '#....', '.###.'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#', '#...#', '#...#'],
  a: ['.....', '.....', '.###.', '....#', '.####', '#...#', '.####'],
  p: ['.....', '.....', '#####', '#...#', '#####', '#....', '#....'],
};

export const GLYPH_W = 5;
export const GLYPH_H = 7;
const LETTER_GAP = 1;
const MARGIN = 3; // empty lanes around the word, for the route to travel in

export interface Pt {
  c: number;
  r: number;
}

export interface Board {
  cols: number;
  rows: number;
  /** letter cells in draw order */
  cells: Pt[];
  /** 1 = letter cell (not walkable, except the target itself) */
  blocked: Uint8Array;
  entrance: Pt;
  /** the spot ON the name the route arrives at (M's vertex) */
  target: Pt;
}

export function buildBoard(text: string): Board {
  const letters = [...text];
  const cols = letters.length * GLYPH_W + (letters.length - 1) * LETTER_GAP + MARGIN * 2;
  const rows = GLYPH_H + MARGIN * 2;
  const cells: Pt[] = [];
  const blocked = new Uint8Array(cols * rows);
  letters.forEach((ch, i) => {
    const glyph = GRID_GLYPHS[ch];
    if (!glyph) throw new Error(`no grid glyph for "${ch}"`);
    const ox = MARGIN + i * (GLYPH_W + LETTER_GAP);
    glyph.forEach((row, gr) =>
      [...row].forEach((px, gc) => {
        if (px !== '#') return;
        const p = { c: ox + gc, r: MARGIN + gr };
        cells.push(p);
        blocked[p.r * cols + p.c] = 1;
      })
    );
  });
  const mIdx = letters.indexOf('M');
  const mOx = MARGIN + Math.max(mIdx, 0) * (GLYPH_W + LETTER_GAP);
  return {
    cols,
    rows,
    cells,
    blocked,
    entrance: { c: MARGIN - 1, r: rows - 2 },
    target: mIdx >= 0 ? { c: mOx + 2, r: MARGIN + 2 } : cells[0],
  };
}

const DIRS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const TURN_PENALTY = 0.6;

class MinHeap {
  private a: { k: number; f: number }[] = [];
  get size() {
    return this.a.length;
  }
  push(v: { k: number; f: number }) {
    const a = this.a;
    a.push(v);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * A* over (cell, incoming-direction) states with a turn penalty, so the
 * hero route prefers long straight runs — like the real in-store nav.
 * Letter cells are walls; the goal (a spot on the name) is the one allowed
 * exception, so the path ends standing on the word.
 */
export function findGridPath(board: Board, start: Pt, goal: Pt): Pt[] | null {
  const { cols, rows, blocked } = board;
  const goalCell = goal.r * cols + goal.c;
  const startCell = start.r * cols + start.c;
  const h = (c: number, r: number) => Math.abs(c - goal.c) + Math.abs(r - goal.r);
  const dist = new Float64Array(cols * rows * 4).fill(Infinity);
  const prev = new Int32Array(cols * rows * 4).fill(-1);
  const open = new MinHeap();
  for (let d = 0; d < 4; d++) {
    const k = startCell * 4 + d;
    dist[k] = 0;
    open.push({ k, f: h(start.c, start.r) });
  }
  let endKey = -1;
  while (open.size) {
    const cur = open.pop();
    const cell = cur.k >> 2;
    const dir = cur.k & 3;
    const c = cell % cols;
    const r = (cell / cols) | 0;
    if (cur.f - h(c, r) > dist[cur.k] + 1e-9) continue; // stale heap entry
    if (cell === goalCell) {
      endKey = cur.k;
      break;
    }
    for (let nd = 0; nd < 4; nd++) {
      const nc = c + DIRS[nd][0];
      const nr = r + DIRS[nd][1];
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const nextCell = nr * cols + nc;
      if (blocked[nextCell] && nextCell !== goalCell) continue;
      const g = dist[cur.k] + 1 + (nd === dir ? 0 : TURN_PENALTY);
      const nk = nextCell * 4 + nd;
      if (g < dist[nk] - 1e-9) {
        dist[nk] = g;
        prev[nk] = cur.k;
        open.push({ k: nk, f: g + h(nc, nr) });
      }
    }
  }
  if (endKey < 0) return null;
  const path: Pt[] = [];
  for (let k = endKey; k >= 0; k = prev[k]) {
    const cell = k >> 2;
    path.push({ c: cell % cols, r: (cell / cols) | 0 });
  }
  return path.reverse();
}

const CS = 10; // svg units per grid cell
const WAVE_MS = 950; // letters + dots materialize (CSS stagger) before the walk
const WALK_MS = 2600;
const HOLD_MS = 2300;
const FADE_MS = 750;
const GAP_MS = 600;
const LOOP = WALK_MS + HOLD_MS + FADE_MS + GAP_MS;

const easeInOut = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const easeOut = (u: number) => 1 - Math.pow(1 - u, 3);

const waveDelay = (c: number, r: number) => ({ '--d': `${(c + r) * 14}ms` }) as CSSProperties;

export default function GridHero({ text = WORD }: { text?: string }) {
  const board = useMemo(() => buildBoard(text), [text]);
  const path = useMemo(() => findGridPath(board, board.entrance, board.target), [board]);
  const pts = useMemo(() => (path ?? []).map((p) => ({ x: (p.c + 0.5) * CS, y: (p.r + 0.5) * CS })), [path]);
  const routeD = useMemo(
    () => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' '),
    [pts]
  );
  const routeLen = useMemo(
    () => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - pts[i].x, p.y - pts[i].y), 0),
    [pts]
  );

  const [waveKey, setWaveKey] = useState(0);
  const fadeRef = useRef<SVGGElement>(null);
  const casingRef = useRef<SVGPathElement>(null);
  const lineRef = useRef<SVGPathElement>(null);
  const walkerRef = useRef<SVGGElement>(null);
  const pinRef = useRef<SVGGElement>(null);

  const reduced =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canAnimate = !reduced && typeof requestAnimationFrame === 'function' && (path?.length ?? 0) > 1;

  useEffect(() => {
    const target = pts[pts.length - 1];
    const setPinAt = (scale: number, drop: number) =>
      pinRef.current?.setAttribute(
        'transform',
        `translate(${target.x} ${target.y - drop}) scale(${scale})`
      );

    const showStatic = () => {
      for (const el of [casingRef.current, lineRef.current]) if (el) el.style.strokeDashoffset = '0';
      if (fadeRef.current) fadeRef.current.style.opacity = '1';
      if (walkerRef.current) walkerRef.current.style.opacity = '0';
      setPinAt(1, 0);
      if (pinRef.current) pinRef.current.style.opacity = '1';
    };
    if (!canAnimate) {
      showStatic();
      return;
    }

    const pointAt = (d: number) => {
      let rem = Math.max(0, Math.min(routeLen, d));
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const seg = Math.hypot(b.x - a.x, b.y - a.y);
        if (rem <= seg || i === pts.length - 1) {
          const u = seg ? rem / seg : 0;
          return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
        }
        rem -= seg;
      }
      return pts[pts.length - 1];
    };

    let raf = 0;
    let clock = -WAVE_MS;
    let last: number | null = null;
    const tick = (now: number) => {
      if (last !== null) clock += Math.min(now - last, 120); // hidden tabs don't fast-forward
      last = now;
      const fade = fadeRef.current;
      const walker = walkerRef.current;
      const pin = pinRef.current;
      if (fade && walker && pin && casingRef.current && lineRef.current) {
        if (clock < 0) {
          casingRef.current.style.strokeDashoffset = '1';
          lineRef.current.style.strokeDashoffset = '1';
          fade.style.opacity = '0';
        } else {
          const t = clock % LOOP;
          if (t < WALK_MS) {
            const p = easeInOut(t / WALK_MS);
            casingRef.current.style.strokeDashoffset = String(1 - p);
            lineRef.current.style.strokeDashoffset = String(1 - p);
            fade.style.opacity = '1';
            walker.style.opacity = '1';
            const w = pointAt(p * routeLen);
            walker.setAttribute('transform', `translate(${w.x} ${w.y})`);
            pin.style.opacity = '0';
          } else if (t < WALK_MS + HOLD_MS) {
            const t2 = t - WALK_MS;
            casingRef.current.style.strokeDashoffset = '0';
            lineRef.current.style.strokeDashoffset = '0';
            fade.style.opacity = '1';
            walker.style.opacity = String(1 - Math.min(1, t2 / 350));
            const e = easeOut(Math.min(1, t2 / 300));
            setPinAt(1 + (1 - e) * 0.9, (1 - e) * 9);
            pin.style.opacity = String(e);
          } else if (t < WALK_MS + HOLD_MS + FADE_MS) {
            walker.style.opacity = '0';
            setPinAt(1, 0);
            pin.style.opacity = '1';
            fade.style.opacity = String(1 - (t - WALK_MS - HOLD_MS) / FADE_MS);
          } else {
            casingRef.current.style.strokeDashoffset = '1';
            lineRef.current.style.strokeDashoffset = '1';
            fade.style.opacity = '0';
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [canAnimate, waveKey, pts, routeLen]);

  const dots: { c: number; r: number }[] = [];
  for (let r = 0; r < board.rows; r++)
    for (let c = 0; c < board.cols; c++)
      if (!board.blocked[r * board.cols + c]) dots.push({ c, r });

  const cell = (p: Pt) => ({ x: (p.c + 0.5) * CS, y: (p.r + 0.5) * CS });
  const entrance = cell(board.entrance);
  const target = cell(board.target);

  return (
    <section
      className="grid-hero"
      role="img"
      aria-label={`StoreMap wordmark: an animated route walks a grid and arrives at a pin on the name "${text}"`}
    >
      <div className="grid-hero-board" title="Replay" onClick={() => setWaveKey((k) => k + 1)}>
        <svg
          key={waveKey}
          className="grid-hero-svg"
          viewBox={`0 0 ${board.cols * CS} ${board.rows * CS}`}
          aria-hidden
        >
          {dots.map((p) => (
            <circle
              key={`d${p.c}-${p.r}`}
              className="gh-dot"
              cx={(p.c + 0.5) * CS}
              cy={(p.r + 0.5) * CS}
              r={1.4}
              style={waveDelay(p.c, p.r)}
            />
          ))}
          {board.cells.map((p) => (
            <rect
              key={`c${p.c}-${p.r}`}
              className="gh-cell"
              x={p.c * CS + 1.1}
              y={p.r * CS + 1.1}
              width={CS - 2.2}
              height={CS - 2.2}
              rx={1.9}
              style={waveDelay(p.c, p.r)}
            />
          ))}
          {/* entrance flag where the route starts */}
          <g transform={`translate(${entrance.x} ${entrance.y})`}>
            <rect className="gh-entrance-pad" x={-4.4} y={-4.4} width={8.8} height={8.8} rx={2.4} />
            <path className="gh-entrance-flag" d="M -1.3 3 V -3.1 L 3.1 -1.5 L -1.3 0.2 Z" />
          </g>
          <g ref={fadeRef} className="gh-live" style={{ opacity: canAnimate ? 0 : 1 }}>
            <path ref={casingRef} className="route-casing gh-route" d={routeD} pathLength={1} />
            <path ref={lineRef} className="route-line gh-route" d={routeD} pathLength={1} />
            <g ref={walkerRef} className="gh-walker">
              <circle r={4.4} />
            </g>
            <g
              ref={pinRef}
              className="gh-pin"
              transform={`translate(${target.x} ${target.y})`}
              style={{ opacity: 0 }}
            >
              <circle className="gh-ring" r={4.5} />
              <circle className="gh-ring r2" r={4.5} />
              <path
                className="gh-pin-body"
                d="M 0 0 C -1.9 -3.3 -7.4 -7.6 -7.4 -12.4 A 7.4 7.4 0 1 1 7.4 -12.4 C 7.4 -7.6 1.9 -3.3 0 0 Z"
              />
              <circle className="gh-pin-dot" cy={-12.4} r={2.9} />
            </g>
          </g>
        </svg>
      </div>
    </section>
  );
}
