/**
 * Store wayfinding: rasterize a floor's walkable space into a nav grid,
 * then A* a route from the entrance to a product pin and smooth it.
 * Pure geometry + typed arrays — no DOM, cheap enough to run per search.
 */
import type { Floor, MapElement, PointGeom, RectGeom } from '../types';
import {
  bboxOf, closestPointOnSegment, elementContains, elementPoints, rectCorners, type WorldPt,
} from './geometry';

/** One wall or fixture the grid was cut around, with its bounding box. */
export interface Obstacle {
  el: MapElement;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface NavGrid {
  cell: number; // meters per cell
  cols: number;
  rows: number;
  ox: number; // world x of grid origin (floor bbox padded by margin)
  oy: number;
  blocked: Uint8Array;
  /** the floor slab's size — walkable space never leaves it */
  floorW: number;
  floorH: number;
  /** every wall + fixture, for the exact clearance checks on route segments */
  obstacles: Obstacle[];
  /** shopper half-width (m) the grid was inflated by */
  clearance: number;
}

export interface Route {
  points: WorldPt[];
  distanceM: number;
  start: WorldPt;
  goal: WorldPt;
  /** where the route ends: open floor in front of the goal, never on a fixture */
  stand: WorldPt;
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

  const obstacles: Obstacle[] = [];
  for (const el of elements) {
    if (!BLOCKING.has(el.type)) continue;
    const pts = elementPoints(el);
    if (!pts.length) continue;
    const bb = bboxOf(pts);
    obstacles.push({ el, minX: bb.minX, minY: bb.minY, maxX: bb.maxX, maxY: bb.maxY });
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

  return { cell, cols, rows, ox, oy, blocked, floorW: w, floorH: h, obstacles, clearance };
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

/* ---------------- exact clearance geometry ----------------
   The grid only knows cell CENTRES, so a straight line drawn between two
   open cells can still shave a shelf corner — and a route that ends at a
   pin sitting on a shelf runs straight through it. These measure a whole
   segment against a fixture exactly (segment ↔ rectangle / polyline
   distance); the route's smoothing and both of its ends are checked with
   them. */

/** Point ↔ rect distance in the rect's own (unrotated) frame — 0 inside. */
function pointRectDistance(p: WorldPt, r: RectGeom): number {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const a = (-r.rot * Math.PI) / 180;
  const qx = cx + (p.x - cx) * Math.cos(a) - (p.y - cy) * Math.sin(a);
  const qy = cy + (p.x - cx) * Math.sin(a) + (p.y - cy) * Math.cos(a);
  return Math.hypot(Math.max(r.x - qx, 0, qx - (r.x + r.w)), Math.max(r.y - qy, 0, qy - (r.y + r.h)));
}

function pointSegmentDistance(p: WorldPt, a: WorldPt, b: WorldPt): number {
  const q = closestPointOnSegment(p, a, b);
  return Math.hypot(p.x - q.x, p.y - q.y);
}

/** Point ↔ element distance: 0 inside, else the gap to the nearest edge. */
export function pointElementDistance(el: MapElement, p: WorldPt): number {
  if (el.shape === 'point') {
    const g = el.geom as PointGeom;
    return Math.hypot(g.x - p.x, g.y - p.y);
  }
  if (el.shape === 'rect') return pointRectDistance(p, el.geom as RectGeom);
  const pts = elementPoints(el);
  if (pts.length < 2) return pts.length ? pointSegmentDistance(p, pts[0], pts[0]) : Infinity;
  const closed = el.shape === 'polygon';
  if (closed && elementContains(el, p, 0)) return 0;
  let d = Infinity;
  for (let i = 0; i < (closed ? pts.length : pts.length - 1); i++) {
    d = Math.min(d, pointSegmentDistance(p, pts[i], pts[(i + 1) % pts.length]));
  }
  return d;
}

const cross = (o: WorldPt, a: WorldPt, b: WorldPt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

const between = (a: WorldPt, b: WorldPt, p: WorldPt) =>
  Math.min(a.x, b.x) <= p.x && p.x <= Math.max(a.x, b.x) && Math.min(a.y, b.y) <= p.y && p.y <= Math.max(a.y, b.y);

/** Do segments ab and cd share a point? Touching and collinear overlap count. */
export function segmentsIntersect(a: WorldPt, b: WorldPt, c: WorldPt, d: WorldPt): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return (
    (d1 === 0 && between(c, d, a)) || (d2 === 0 && between(c, d, b)) ||
    (d3 === 0 && between(a, b, c)) || (d4 === 0 && between(a, b, d))
  );
}

function segmentDistance(a: WorldPt, b: WorldPt, c: WorldPt, d: WorldPt): number {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(
    pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d),
    pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b)
  );
}

/** Segment ↔ element distance: 0 when the segment touches or crosses it. */
export function segmentElementDistance(el: MapElement, a: WorldPt, b: WorldPt): number {
  if (el.shape === 'point') return pointSegmentDistance(el.geom as PointGeom, a, b);
  if (el.shape === 'rect') {
    const r = el.geom as RectGeom;
    let d = Math.min(pointRectDistance(a, r), pointRectDistance(b, r));
    if (d === 0) return 0;
    const corners = rectCorners(r);
    for (let i = 0; i < 4; i++) {
      if (segmentsIntersect(a, b, corners[i], corners[(i + 1) % 4])) return 0;
      d = Math.min(d, pointSegmentDistance(corners[i], a, b));
    }
    return d;
  }
  const pts = elementPoints(el);
  if (pts.length < 2) return pts.length ? pointSegmentDistance(pts[0], a, b) : Infinity;
  const closed = el.shape === 'polygon';
  let d = Infinity;
  for (let i = 0; i < (closed ? pts.length : pts.length - 1); i++) {
    d = Math.min(d, segmentDistance(a, b, pts[i], pts[(i + 1) % pts.length]));
    if (d === 0) return 0;
  }
  // a run that starts and ends inside a walled polygon never touches an edge
  if (closed && (elementContains(el, a, 0) || elementContains(el, b, 0))) return 0;
  return d;
}

/**
 * Index of the obstacle that stops segment a→b from keeping `minClear`
 * metres, or -1 when it is clear. The scan resumes at `hint`, the blocker
 * found last time: one shelf corner usually turns away a whole run of
 * candidates, so it is tested first.
 */
export function blockingObstacle(
  g: NavGrid, a: WorldPt, b: WorldPt, minClear: number = g.clearance, hint = 0
): number {
  const minX = Math.min(a.x, b.x) - minClear;
  const maxX = Math.max(a.x, b.x) + minClear;
  const minY = Math.min(a.y, b.y) - minClear;
  const maxY = Math.max(a.y, b.y) + minClear;
  const n = g.obstacles.length;
  for (let k = 0; k < n; k++) {
    const idx = (hint + k) % n;
    const o = g.obstacles[idx];
    if (o.maxX < minX || o.minX > maxX || o.maxY < minY || o.minY > maxY) continue;
    if (segmentElementDistance(o.el, a, b) < minClear - 1e-6) return idx;
  }
  return -1;
}

/** True when every point of segment a→b keeps `minClear` metres from every wall and fixture. */
export const segmentClear = (g: NavGrid, a: WorldPt, b: WorldPt, minClear: number = g.clearance): boolean =>
  blockingObstacle(g, a, b, minClear) < 0;

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

/**
 * 8-directional A*; diagonals only when both orthogonal neighbours are open.
 * Returns the walkable cell centres between the open cells nearest `start`
 * and `goal` — endpoints are joined by the route assembly, since a goal can
 * sit on a fixture and must not be walked up to.
 */
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
      return path.reverse();
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

/* ---------------- string-pulling ---------------- */

/**
 * Greedy string-pulling: keep turning points only, each consecutive pair
 * clear of every fixture. `firstHopBlocked` replaces the test for the hop
 * that leaves pts[0] — used for a door marker, which sits inside its wall's
 * buffer.
 */
export function simplifyPath(g: NavGrid, pts: WorldPt[], firstHopBlocked?: (from: WorldPt, to: WorldPt) => boolean): WorldPt[] {
  if (pts.length <= 2) return pts;
  const out: WorldPt[] = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    // neighbours are always joined — two adjacent cells are as close as the grid gets
    let j = pts.length - 1;
    let hint = 0;
    while (j > i + 1) {
      if (i === 0 && firstHopBlocked) {
        if (!firstHopBlocked(pts[0], pts[j])) break;
      } else {
        const hit = blockingObstacle(g, pts[i], pts[j], g.clearance, hint);
        if (hit < 0) break;
        hint = hit;
      }
      j--;
    }
    out.push(pts[j]);
    i = j;
  }
  return out;
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

const STAND_MARGIN = 0.05; // keep off the very edge of the floor slab
const STAND_REACH = 6; // a fixture further than this (m) from the goal is not stepped off
const STAND_SLIDE = 3; // how far out (m) a spot is looked for when the nearest one is taken
/** Clearance demanded of a door hop from the walls the door marker itself sits in. */
const DOOR_CLEAR = 0.125;

/**
 * Is the hop leaving a door marker blocked? It keeps the full clearance
 * from every fixture — only the walls the marker sits inside (`inWall`) are
 * held to never being crossed, since the route starts in their buffer.
 */
function doorHopBlocked(g: NavGrid, from: WorldPt, to: WorldPt, inWall: boolean[]): boolean {
  const c = g.clearance;
  const minX = Math.min(from.x, to.x) - c;
  const maxX = Math.max(from.x, to.x) + c;
  const minY = Math.min(from.y, to.y) - c;
  const maxY = Math.max(from.y, to.y) + c;
  for (let k = 0; k < g.obstacles.length; k++) {
    const o = g.obstacles[k];
    if (o.maxX < minX || o.minX > maxX || o.maxY < minY || o.minY > maxY) continue;
    if (segmentElementDistance(o.el, from, to) < (inWall[k] ? DOOR_CLEAR : c) - 1e-6) return true;
  }
  return false;
}

/** A spot a shopper can occupy: on the floor slab, `clearance` from every wall and fixture. */
export function canStand(g: NavGrid, p: WorldPt): boolean {
  if (!(p.x >= STAND_MARGIN && p.y >= STAND_MARGIN && p.x <= g.floorW - STAND_MARGIN && p.y <= g.floorH - STAND_MARGIN)) {
    return false;
  }
  const c = g.clearance;
  for (const o of g.obstacles) {
    if (p.x < o.minX - c || p.x > o.maxX + c || p.y < o.minY - c || p.y > o.maxY + c) continue;
    if (pointElementDistance(o.el, p) < c - 1e-6) return false;
  }
  return true;
}

export interface StandingPoint {
  point: WorldPt;
  /** outward normal of the fixture face the spot stands against — (0, 0) when the goal was already open floor */
  nx: number;
  ny: number;
}

/** Nearest cell-centre coordinate: a spot on an axis-aligned face then lines up square with a cell centre. */
const snapToCell = (g: NavGrid, v: number) => g.ox + (Math.floor((v - g.ox) / g.cell) + 0.5) * g.cell;

/**
 * Where a shopper stands to reach `goal`. A product pin sits ON its shelf —
 * a group pin in the middle of it — so a route ending at the pin would have
 * to walk through the shelf. The route ends here instead: the nearest point
 * of open floor that keeps the clearance from every wall and fixture, i.e.
 * the aisle right in front of the pin. A goal already in open floor is
 * returned unchanged. `toward` settles the two faces of a shelf (equally
 * near) in favour of the side the shopper arrives from.
 */
export function standingPoint(g: NavGrid, goal: WorldPt, toward?: WorldPt): StandingPoint {
  const home = {
    x: clamp(goal.x, STAND_MARGIN, g.floorW - STAND_MARGIN),
    y: clamp(goal.y, STAND_MARGIN, g.floorH - STAND_MARGIN),
  };
  if (canStand(g, home)) return { point: home, nx: 0, ny: 0 };

  // step off the outline of every nearby fixture: straight out from the
  // nearest point of each of its edges, sliding along the edge when that
  // spot is taken (a neighbouring shelf, a wall behind it)
  const edges: { foot: WorldPt; reach: number; tx: number; ty: number; axis: boolean }[] = [];
  for (const { el } of g.obstacles) {
    const pts = elementPoints(el);
    if (pts.length < 2) continue;
    const closed = el.shape === 'rect' || el.shape === 'polygon';
    for (let i = 0; i < (closed ? pts.length : pts.length - 1); i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (!len) continue;
      const foot = closestPointOnSegment(home, a, b);
      const reach = Math.hypot(foot.x - home.x, foot.y - home.y);
      if (reach >= STAND_REACH) continue;
      const tx = (b.x - a.x) / len;
      const ty = (b.y - a.y) / len;
      edges.push({ foot, reach, tx, ty, axis: Math.abs(tx) < 1e-9 || Math.abs(ty) < 1e-9 });
    }
  }
  // nearest edges first, so the search along the others stops early
  edges.sort((p, q) => p.reach - q.reach);

  let best: StandingPoint | null = null;
  let bestD = Infinity;
  let bestT = Infinity;
  for (const { foot, tx, ty, axis } of edges) {
    for (const side of [1, -1]) {
      const nx = -ty * side;
      const ny = tx * side;
      // sliding further along the edge than the best spot is away can't win
      const slide = Math.min(bestD, STAND_SLIDE);
      for (let s = 0; s <= slide; s += g.cell) {
        for (const dir of s === 0 ? [1] : [1, -1]) {
          // the nearest clear spot on this line: straight out, then further out when that one is taken
          for (let d = g.clearance; d <= g.clearance + STAND_SLIDE; d += g.cell) {
            const p = { x: foot.x + tx * s * dir + nx * d, y: foot.y + ty * s * dir + ny * d };
            const spot = axis ? (tx === 0 ? { x: p.x, y: snapToCell(g, p.y) } : { x: snapToCell(g, p.x), y: p.y }) : p;
            if (!canStand(g, spot)) continue;
            const dist = Math.hypot(spot.x - home.x, spot.y - home.y);
            const towardD = toward ? Math.hypot(spot.x - toward.x, spot.y - toward.y) : 0;
            if (dist < bestD - 1e-6 || (Math.abs(dist - bestD) <= 1e-6 && towardD < bestT)) {
              best = { point: spot, nx, ny };
              bestD = dist;
              bestT = towardD;
            }
            break;
          }
        }
      }
    }
  }
  if (best) return best;
  // nothing nearby clears the full clearance (a gap narrower than the shopper) — the closest walkable cell will do
  const open = nearestOpen(g, home, 8);
  return open ? { point: cellCenter(g, open.col, open.row), nx: 0, ny: 0 } : { point: home, nx: 0, ny: 0 };
}

/**
 * The shopper's polyline from `from` to a standing spot: A* across open
 * cells, string-pulled to its turning points, then joined to both ends.
 * Every hop keeps the full clearance, so the route rounds shelf corners
 * instead of clipping them. `fromDoor` marks `from` as a door marker: it is
 * kept exactly where it sits (inside its wall's buffer), and the hop leaving
 * it is only excused the clearance of the walls it sits in.
 */
function walk(g: NavGrid, from: WorldPt, to: StandingPoint, fromDoor: boolean): WorldPt[] | null {
  const cells = astar(g, from, to.point);
  if (!cells) return null;
  const inWall = fromDoor ? g.obstacles.map((o) => pointElementDistance(o.el, from) < g.clearance) : null;
  const pts = simplifyPath(g, [from, ...cells], inWall ? (a, b) => doorHopBlocked(g, a, b, inWall) : undefined);
  const last = pts[pts.length - 1];
  if (Math.hypot(last.x - to.point.x, last.y - to.point.y) < 1e-9) return pts;
  // reach the spot itself — straight over from the last cell when that line keeps the clearance
  if (segmentClear(g, last, to.point)) return [...pts, to.point];
  // the spot sits exactly on the edge of the clearance, so a fixture corner
  // can block the straight line: square up to the face a step further out
  // and come in from there
  const hasNormal = to.nx !== 0 || to.ny !== 0;
  const len = hasNormal ? Math.hypot(to.nx, to.ny) : Math.hypot(last.x - to.point.x, last.y - to.point.y) || 1;
  const nx = hasNormal ? to.nx / len : (last.x - to.point.x) / len;
  const ny = hasNormal ? to.ny / len : (last.y - to.point.y) / len;
  for (let k = 1; k <= 6; k++) {
    const a = { x: to.point.x + nx * k * g.cell, y: to.point.y + ny * k * g.cell };
    if (segmentClear(g, last, a) && segmentClear(g, a, to.point)) return [...pts, a, to.point];
  }
  // the spot itself can't be reached at full clearance — the aisle in front of it still can
  return pts;
}

/**
 * Full shopper route on one floor: entrance → the aisle in front of `goal`,
 * around shelves and walls. Returns null when the goal is unreachable (e.g.
 * inside a sealed room).
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
  const stand = standingPoint(grid, inFloor, start);
  const points = walk(grid, start, stand, true);
  if (!points) return null;
  return { points, distanceM: pathLengthM(points), start, goal: inFloor, stand: stand.point };
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
 * Each leg ends in the aisle in front of its stop and the next one starts
 * from there, so the legs join into one line that never crosses a shelf.
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
    const stand = standingPoint(grid, next.point, cursor);
    const leg = walk(grid, cursor, stand, legs.length === 0);
    if (!leg) return null; // an unreachable stop invalidates the tour
    legs.push(leg);
    totalM += pathLengthM(leg);
    order.push(next);
    cursor = stand.point;
  }
  return { legs, totalM, order };
}
