/**
 * GridHero — the homepage wordmark played as the product itself.
 * "item.place" is spelled out in a 5×7 grid font on a board of faint cells,
 * then a wayfinding route (same white casing + orange line as the store
 * maps) walks the grid from an entrance flag and arrives at a pin dropped
 * on one of five spots on the name — chosen at random each pass.
 *
 * Static SVG + one rAF loop; renders the finished route (no animation)
 * under prefers-reduced-motion or where rAF is missing. Click replays.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

export const WORD = 'item.place';

/* 5×7 grid font ('#' = cell on). Lowercase sits on rows 2–6 like a real
   bitmap font; the l is a plain straight stem and the c is a clean open
   curve. Covers the wordmark plus the block-text labels ("Create a Map"),
   which also need r, M and C. */
export const GRID_GLYPHS: Record<string, string[]> = {
  i: ['..#..', '.....', '..#..', '..#..', '..#..', '..#..', '..#..'],
  t: ['.#...', '.#...', '###..', '.#...', '.#...', '.#...', '..##.'],
  e: ['.....', '.....', '.###.', '#...#', '#####', '#....', '.###.'],
  m: ['.....', '.....', '##.#.', '#.#.#', '#.#.#', '#.#.#', '#.#.#'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.....', '..#..'],
  p: ['.....', '.....', '#####', '#...#', '#####', '#....', '#....'],
  l: ['..#..', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  a: ['.....', '.....', '.###.', '....#', '.####', '#...#', '.####'],
  c: ['.....', '.....', '.###.', '#....', '#....', '#....', '.###.'],
  r: ['.....', '.....', '#.##.', '##...', '#....', '#....', '#....'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#', '#...#', '#...#'],
};

/** Extra tracking after a letter — negative values tighten the pair
 *  (i→t, and the "pla" cluster in the wordmark). */
const KERN_AFTER: Record<string, number> = { i: -1, p: -1, l: -1 };

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
  /** the five spots ON the name the route can arrive at */
  targets: Pt[];
  /** the default arrival spot (targets[0]) — static/reduced-motion rendering */
  target: Pt;
}

export function buildBoard(text: string): Board {
  const letters = [...text];
  // per-letter x origins so kerning can tighten specific pairs (i→t)
  const ox: number[] = [];
  let cursor = MARGIN;
  letters.forEach((ch, i) => {
    ox[i] = cursor;
    cursor += GLYPH_W + LETTER_GAP + (KERN_AFTER[ch] ?? 0);
  });
  const cols = cursor - LETTER_GAP + MARGIN;
  const rows = GLYPH_H + MARGIN * 2;
  const cells: Pt[] = [];
  const blocked = new Uint8Array(cols * rows);
  letters.forEach((ch, i) => {
    const glyph = GRID_GLYPHS[ch];
    if (!glyph) throw new Error(`no grid glyph for "${ch}"`);
    glyph.forEach((row, gr) =>
      [...row].forEach((px, gc) => {
        if (px !== '#') return;
        const p = { c: ox[i] + gc, r: MARGIN + gr };
        cells.push(p);
        blocked[p.r * cols + p.c] = 1;
      })
    );
  });
  // five pin-drop spots on the name, as [letter index, glyph col, glyph row];
  // candidates that aren't letter cells in the current word are dropped
  const spots: [number, number, number][] = [
    [0, 2, 0], // the dot of the "i"
    [3, 2, 3], // the middle stem of the "m"
    [4, 2, 6], // the dot of ".place"
    [6, 2, 0], // the top of the "l"
    [9, 2, 4], // the middle bar of the last "e"
  ];
  const targets = spots
    .filter(([li]) => li < letters.length)
    .map(([li, c, r]) => ({ c: ox[li] + c, r: MARGIN + r }))
    .filter((p) => blocked[p.r * cols + p.c] === 1);
  return {
    cols,
    rows,
    cells,
    blocked,
    entrance: { c: MARGIN - 1, r: rows - 2 },
    targets,
    target: targets[0] ?? cells[0],
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
  const targets = board.targets;
  // the current pass's destination — one of the five spots, at random
  const [ti, setTi] = useState(() => Math.floor(Math.random() * targets.length));
  const path = useMemo(
    () => findGridPath(board, board.entrance, targets[ti] ?? board.target),
    [board, ti]
  );
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
  // a replay picks a fresh destination
  useEffect(() => {
    setTi(Math.floor(Math.random() * targets.length));
  }, [waveKey, targets]);
  const fadeRef = useRef<SVGGElement>(null);
  const casingRef = useRef<SVGPathElement>(null);
  const lineRef = useRef<SVGPathElement>(null);
  const walkerRef = useRef<SVGGElement>(null);
  const pinRef = useRef<SVGGElement>(null);
  // the live route of the current pass — swapped imperatively at each loop
  // wrap so the pin lands somewhere new without breaking the loop clock
  const routeRef = useRef({ pts, len: routeLen });
  const lastSpot = useRef(ti);

  const reduced =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canAnimate = !reduced && typeof requestAnimationFrame === 'function' && (path?.length ?? 0) > 1;

  useEffect(() => {
    routeRef.current = { pts, len: routeLen };
    lastSpot.current = ti;
    const setPinAt = (scale: number, drop: number) => {
      const target = routeRef.current.pts[routeRef.current.pts.length - 1];
      pinRef.current?.setAttribute(
        'transform',
        `translate(${target.x} ${target.y - drop}) scale(${scale})`
      );
    };

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
      const { pts: rpts, len: rlen } = routeRef.current;
      let rem = Math.max(0, Math.min(rlen, d));
      for (let i = 1; i < rpts.length; i++) {
        const a = rpts[i - 1];
        const b = rpts[i];
        const seg = Math.hypot(b.x - a.x, b.y - a.y);
        if (rem <= seg || i === rpts.length - 1) {
          const u = seg ? rem / seg : 0;
          return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
        }
        rem -= seg;
      }
      return rpts[rpts.length - 1];
    };

    /** Next pass lands on a different random spot: re-path imperatively
     *  while the route is hidden so the loop clock runs unbroken. */
    const swapRoute = () => {
      if (targets.length < 2) return;
      let i = lastSpot.current;
      while (i === lastSpot.current) i = Math.floor(Math.random() * targets.length);
      lastSpot.current = i;
      const p = findGridPath(board, board.entrance, targets[i]);
      if (!p || p.length < 2) return;
      const npts = p.map((q) => ({ x: (q.c + 0.5) * CS, y: (q.r + 0.5) * CS }));
      const nlen = npts
        .slice(1)
        .reduce((s, q, k) => s + Math.hypot(q.x - npts[k].x, q.y - npts[k].y), 0);
      const d = npts.map((q, k) => `${k ? 'L' : 'M'}${q.x} ${q.y}`).join(' ');
      casingRef.current?.setAttribute('d', d);
      lineRef.current?.setAttribute('d', d);
      routeRef.current = { pts: npts, len: nlen };
    };

    let raf = 0;
    let clock = -WAVE_MS;
    let last: number | null = null;
    let prevT = 0;
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
          if (t < prevT) swapRoute(); // wrapped into a new pass
          prevT = t;
          if (t < WALK_MS) {
            const p = easeInOut(t / WALK_MS);
            casingRef.current.style.strokeDashoffset = String(1 - p);
            lineRef.current.style.strokeDashoffset = String(1 - p);
            fade.style.opacity = '1';
            walker.style.opacity = '1';
            const w = pointAt(p * routeRef.current.len);
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
  }, [canAnimate, waveKey, pts, routeLen, ti, board, targets]);

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
      aria-label={`item.place wordmark: an animated route walks a grid and arrives at a pin on the name "${text}"`}
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

/** Static block-letter wordmark (the hero's grid font) for labels — the
 *  header brand and the Create-a-Map CTA. Colored via currentColor; spaces
 *  advance a half letter, unknown characters are skipped so callers control
 *  their own text. Decorative: give the wrapping link its own aria-label. */
export function BlockText({ text, cell = 3 }: { text: string; cell?: number }) {
  const rects: { x: number; y: number }[] = [];
  let cursor = 0;
  for (const ch of [...text]) {
    if (ch === ' ') {
      cursor += 3;
      continue;
    }
    const glyph = GRID_GLYPHS[ch];
    if (!glyph) continue;
    glyph.forEach((row, gr) =>
      [...row].forEach((px, gc) => {
        if (px === '#') rects.push({ x: cursor + gc, y: gr });
      })
    );
    cursor += GLYPH_W + LETTER_GAP + (KERN_AFTER[ch] ?? 0);
  }
  const units = Math.max(1, cursor - LETTER_GAP);
  return (
    <svg
      className="block-text"
      width={units * cell}
      height={GLYPH_H * cell}
      viewBox={`0 0 ${units} ${GLYPH_H}`}
      aria-hidden
    >
      {rects.map((r, i) => (
        <rect key={i} x={r.x + 0.08} y={r.y + 0.08} width={0.84} height={0.84} rx={0.18} />
      ))}
    </svg>
  );
}
