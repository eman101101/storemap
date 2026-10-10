/**
 * Store wayfinding: rasterize a floor's walkable space into a nav grid,
 * then A* a route from the entrance to a product pin and smooth it.
 * Pure geometry + typed arrays — no DOM, cheap enough to run per search.
 */
import type { Floor, MapElement } from '../types';
import { bboxOf, elementContains, elementPoints, type WorldPt } from './geometry';

export interface NavGrid {
  cell: number; // meters per cell
  cols: number;
  rows: number;
  ox: number; // world x of grid origin (floor bbox padded by margin)
  oy: number;
  blocked: Uint8Array;
}

export interface Route {
  points: WorldPt[];
  distanceM: number;
  start: WorldPt;
  goal: WorldPt;
}

export interface NavOpts {
  cell?: number; // grid resolution (m)
  clearance?: number; // shopper half-width kept from shelves/walls (m)
}

/** Elements that obstruct walking. Zones/aisles/markers are walkable. */
const BLOCKING = new Set(['wall', 'shelf']);

const GRID_MARGIN = 1; // pad grid beyond floor bounds so edge goals resolve

export function buildNavGrid(floor: Floor, elements: MapElement[], opts: NavOpts = {}): NavGrid {
  const cell = opts.cell ?? 0.25;
  const clearance = opts.clearance ?? 0.3;
  const w = Math.max(floor.width_m, 0.1);
  const h = Math.max(floor.height_m, 0.1);
  const cols = Math.max(1, Math.ceil((w + GRID_MARGIN * 2) / cell));
  const rows = Math.max(1, Math.ceil((h + GRID_MARGIN * 2) / cell));
  const ox = -GRID_MARGIN;
  const oy = -GRID_MARGIN;
  const blocked = new Uint8Array(cols * rows);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // cells that don't intersect the floor slab are not walkable
      const x0 = c * cell + ox;
      const y0 = r * cell + oy;
      if (x0 >= w || y0 >= h || x0 + cell <= 0 || y0 + cell <= 0) blocked[r * cols + c] = 1;
    }
  }

  for (const el of elements) {
    if (!BLOCKING.has(el.type)) continue;
    const pts = elementPoints(el);
    if (!pts.length) continue;
    const bb = bboxOf(pts);
    const c0 = Math.max(0, Math.floor((bb.minX - clearance - ox) / cell));
    const c1 = Math.min(cols - 1, Math.ceil((bb.maxX + clearance - ox) / cell));
    const r0 = Math.max(0, Math.floor((bb.minY - clearance - oy) / cell));
    const r1 = Math.min(rows - 1, Math.ceil((bb.maxY + clearance - oy) / cell));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const center = { x: ox + (c + 0.5) * cell, y: oy + (r + 0.5) * cell };
        if (elementContains(el, center, clearance)) blocked[r * cols + c] = 1;
      }
    }
  }

  return { cell, cols, rows, ox, oy, blocked };
}

export const isBlocked = (g: NavGrid, col: number, row: number): boolean =>
  col < 0 || row < 0 || col >= g.cols || row >= g.rows || g.blocked[row * g.cols + col] === 1;

export const cellCenter = (g: NavGrid, col: number, row: number): WorldPt => ({
  x: g.ox + (col + 0.5) * g.cell,
  y: g.oy + (row + 0.5) * g.cell,
});

export function worldToCell(g: NavGrid, p: WorldPt): { col: number; row: number } {
  return {
    col: Math.floor((p.x - g.ox) / g.cell),
    row: Math.floor((p.y - g.oy) / g.cell),
  };
}

/** Nearest walkable cell to a world point, searching outward by world distance. */
export function nearestOpen(g: NavGrid, p: WorldPt, maxMeters = 6): { col: number; row: number } | null {
  const { col, row } = worldToCell(g, p);
  if (!isBlocked(g, col, row)) return { col, row };
  const maxCells = Math.ceil(maxMeters / g.cell);
  let best: { col: number; row: number } | null = null;
  let bestD = Infinity;
  for (let dr = -maxCells; dr <= maxCells; dr++) {
    for (let dc = -maxCells; dc <= maxCells; dc++) {
      const c = col + dc;
      const r = row + dr;
      if (isBlocked(g, c, r)) continue;
      const ctr = cellCenter(g, c, r);
      const d = (ctr.x - p.x) ** 2 + (ctr.y - p.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = { col: c, row: r };
      }
    }
  }
  return best;
}

/** True if the straight segment a→b never enters a blocked cell. */
export function lineOfSight(g: NavGrid, a: WorldPt, b: WorldPt): boolean {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(1, Math.ceil(dist / (g.cell * 0.4)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const { col, row } = worldToCell(g, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    if (isBlocked(g, col, row)) return false;
  }
  return true;
}

/** Greedy string-pulling: keep turning points only, each consecutive pair in sight. */
export function simplifyPath(g: NavGrid, pts: WorldPt[]): WorldPt[] {
  if (pts.length <= 2) return pts;
  const out: WorldPt[] = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !lineOfSight(g, pts[i], pts[j])) j--;
    out.push(pts[j]);
    i = j;
  }
  return out;
}

export function pathLengthM(pts: WorldPt[]): number {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return d;
}

/* ---------------- A* ---------------- */

/** Minimal binary min-heap over packed cell indices. */
class Heap {
  private score: Float64Array;
  private items: number[] = [];
  constructor(score: Float64Array) {
    this.score = score;
  }
  get size() {
    return this.items.length;
  }
  push(item: number) {
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.score[a[p]] <= this.score[a[i]]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): number | undefined {
    const a = this.items;
    if (a.length === 0) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && this.score[a[l]] < this.score[a[m]]) m = l;
        if (r < a.length && this.score[a[r]] < this.score[a[m]]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

const DIRS: [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

/** 8-directional A*; diagonals only when both orthogonal neighbours are open. */
export function astar(g: NavGrid, start: WorldPt, goal: WorldPt): WorldPt[] | null {
  const s = nearestOpen(g, start);
  const t = nearestOpen(g, goal);
  if (!s || !t) return null;

  const n = g.cols * g.rows;
  const gScore = new Float64Array(n).fill(Infinity);
  const fScore = new Float64Array(n).fill(Infinity);
  const cameFrom = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const idx = (c: number, r: number) => r * g.cols + c;

  const sIdx = idx(s.col, s.row);
  const tIdx = idx(t.col, t.row);
  const h = (c: number, r: number) => {
    // octile distance — admissible for 8-way movement
    const dc = Math.abs(c - t.col);
    const dr = Math.abs(r - t.row);
    return (Math.max(dc, dr) + (Math.SQRT2 - 1) * Math.min(dc, dr)) * g.cell;
  };
  gScore[sIdx] = 0;
  fScore[sIdx] = h(s.col, s.row);
  const open = new Heap(fScore);
  open.push(sIdx);

  while (open.size) {
    const cur = open.pop()!;
    if (cur === tIdx) {
      const path: WorldPt[] = [];
      let at = cur;
      while (at !== -1) {
        path.push(cellCenter(g, at % g.cols, Math.floor(at / g.cols)));
        at = cameFrom[at];
      }
      path.reverse();
      // pin both ends to the exact requested points, not snapped cell centers
      path[0] = start;
      path[path.length - 1] = goal;
      return path;
    }
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cc = cur % g.cols;
    const cr = Math.floor(cur / g.cols);
    for (const [dc, dr, cost] of DIRS) {
      const nc = cc + dc;
      const nr = cr + dr;
      if (isBlocked(g, nc, nr)) continue;
      if (dc !== 0 && dr !== 0 && (isBlocked(g, cc + dc, cr) || isBlocked(g, cc, cr + dr))) continue;
      const ni = idx(nc, nr);
      if (closed[ni]) continue;
      const tentative = gScore[cur] + cost * g.cell;
      if (tentative < gScore[ni]) {
        gScore[ni] = tentative;
        fScore[ni] = tentative + h(nc, nr);
        cameFrom[ni] = cur;
        open.push(ni);
      }
    }
  }
  return null;
}

/* ---------------- route assembly ---------------- */

/** Where the shopper starts: nearest entrance (fallback exit / front edge). */
export function pickStartPoint(elements: MapElement[], floor: Floor, goal: WorldPt): WorldPt {
  const ptsOnFloor = (type: string): WorldPt[] =>
    elements
      .filter((el) => el.type === type && el.shape === 'point')
      .map((el) => el.geom as { x: number; y: number });
  const candidates: WorldPt[] =
    ptsOnFloor('entrance').length > 0
      ? ptsOnFloor('entrance')
      : ptsOnFloor('exit').length > 0
        ? ptsOnFloor('exit')
        : [{ x: floor.width_m / 2, y: floor.height_m - 1 }];
  let best = candidates[0];
  let bestD = Infinity;
  for (const c of candidates) {
    const d = (c.x - goal.x) ** 2 + (c.y - goal.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return { x: best.x, y: best.y };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Full shopper route on one floor: entrance → goal, around shelves and walls.
 * Returns null when the goal is unreachable (e.g. inside a sealed room).
 */
export function computeRoute(
  floor: Floor,
  elements: MapElement[],
  goal: WorldPt,
  opts: NavOpts = {},
  cachedGrid?: NavGrid
): Route | null {
  if (!(floor.width_m > 0) || !(floor.height_m > 0)) return null;
  const inFloor: WorldPt = {
    x: clamp(goal.x, 0.05, floor.width_m - 0.05),
    y: clamp(goal.y, 0.05, floor.height_m - 0.05),
  };
  const grid = cachedGrid ?? buildNavGrid(floor, elements, opts);
  const start = pickStartPoint(elements, floor, inFloor);
  const raw = astar(grid, start, inFloor);
  if (!raw) return null;
  const points = simplifyPath(grid, raw);
  return { points, distanceM: pathLengthM(points), start, goal: inFloor };
}

/** Brisk walking pace used for the "≈ N min" estimate. */
export const WALK_M_PER_MIN = 80;

/* ---------------- multi-stop trips ---------------- */

export interface TourStop {
  productId: string;
  name: string;
  point: WorldPt;
}

/**
 * Nearest-neighbour tour from the entrance through every stop (IMPROVEMENTS A1):
 * greedy nearest-next with full leg routing via astar — the classic shop-run
 * heuristic. Returns each leg's smoothed polyline plus a running distance.
 * Same-floor only (multi-floor hops are a future INFRASTRUCTURE §10 concern).
 */
export function computeTrip(
  floor: Floor,
  elements: MapElement[],
  stops: TourStop[],
  opts: NavOpts = {},
  cachedGrid?: NavGrid
): { legs: WorldPt[][]; totalM: number; order: TourStop[] } | null {
  if (!stops.length) return null;
  const grid = cachedGrid ?? buildNavGrid(floor, elements, opts);
  const start = pickStartPoint(elements, floor, stops[0].point);
  const remaining = [...stops];
  const order: TourStop[] = [];
  const legs: WorldPt[][] = [];
  let cursor = start;
  let totalM = 0;
  while (remaining.length) {
    // nearest remaining stop from the cursor (straight-line is a fine chooser;
    // the leg itself is routed with A* around fixtures)
    let bi = 0;
    let bd = Infinity;
    remaining.forEach((s, i) => {
      const d = (s.point.x - cursor.x) ** 2 + (s.point.y - cursor.y) ** 2;
      if (d < bd) {
        bd = d;
        bi = i;
      }
    });
    const next = remaining.splice(bi, 1)[0];
    const leg = astar(grid, cursor, next.point);
    if (!leg) return null; // an unreachable stop invalidates the tour
    const smooth = simplifyPath(grid, leg);
    legs.push(smooth);
    totalM += pathLengthM(smooth);
    order.push(next);
    cursor = next.point;
  }
  return { legs, totalM, order };
}
