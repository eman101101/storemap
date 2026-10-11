import type { ElementShape, MapElement, PolyGeom, RectGeom, PointGeom } from '../types';

export interface Viewport {
  scale: number; // screen px per meter
  tx: number; // screen x offset
  ty: number;
}

export interface WorldPt {
  x: number;
  y: number;
}

export const screenToWorld = (px: number, py: number, vp: Viewport): WorldPt => ({
  x: (px - vp.tx) / vp.scale,
  y: (py - vp.ty) / vp.scale,
});

export const worldToScreen = (p: WorldPt, vp: Viewport): WorldPt => ({
  x: p.x * vp.scale + vp.tx,
  y: p.y * vp.scale + vp.ty,
});

/** Compute a viewport that fits `worldW × worldH` inside a `cw × ch` container with padding. */
export function fitViewport(worldW: number, worldH: number, cw: number, ch: number, pad = 40): Viewport {
  const scale = Math.min((cw - pad * 2) / worldW, (ch - pad * 2) / worldH);
  const s = Math.max(scale, 0.02);
  return {
    scale: s,
    tx: (cw - worldW * s) / 2,
    ty: (ch - worldH * s) / 2,
  };
}

export function snap(v: number, grid: number | null): number {
  return grid ? Math.round(v / grid) * grid : v;
}

export function snapPt(p: WorldPt, grid: number | null): WorldPt {
  return { x: snap(p.x, grid), y: snap(p.y, grid) };
}

/** Rotated rectangle corners in world coordinates, clockwise from top-left. */
export function rectCorners(r: RectGeom): WorldPt[] {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const a = (r.rot * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const local: WorldPt[] = [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ];
  return local.map((p) => ({
    x: cx + (p.x - cx) * cos - (p.y - cy) * sin,
    y: cy + (p.x - cx) * sin + (p.y - cy) * cos,
  }));
}

export function polyPoints(el: MapElement): WorldPt[] {
  const g = el.geom as PolyGeom;
  return g.map(([x, y]) => ({ x, y }));
}

/** Point at 50% of a polyline's arc length — always lies ON the line, unlike
 *  the vertex average (which leaves the line wherever it bends). */
export function polyMidpoint(pts: WorldPt[]): WorldPt | null {
  if (!pts.length) return null;
  if (pts.length === 1) return pts[0];
  let total = 0;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    cum.push(total);
  }
  const half = total / 2;
  for (let i = 1; i < cum.length; i++) {
    if (cum[i] >= half) {
      const segLen = cum[i] - cum[i - 1] || 1;
      const t = (half - cum[i - 1]) / segLen;
      return {
        x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t,
        y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t,
      };
    }
  }
  return pts[pts.length - 1];
}

/** Shortest distance from a point to a polyline's segments. */
export function distToPolyline(p: WorldPt, pts: WorldPt[]): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    best = Math.min(best, Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)));
  }
  return best;
}

/** Points for any element shape (rect corners, polygon/line vertices, or single point). */
export function elementPoints(el: MapElement): WorldPt[] {
  if (el.shape === 'rect') return rectCorners(el.geom as RectGeom);
  if (el.shape === 'point') {
    const p = el.geom as PointGeom;
    return [p];
  }
  return polyPoints(el);
}

export function bboxOf(points: WorldPt[]) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { minX, minY, maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

/** Distance from point p to segment a→b. */
function distToSegment(p: WorldPt, a: WorldPt, b: WorldPt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Closest point on segment a→b to p. */
export function closestPointOnSegment(p: WorldPt, a: WorldPt, b: WorldPt): WorldPt {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return { x: a.x, y: a.y };
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

export interface ShelfAnchor {
  x: number;
  y: number;
  nx: number; // outward normal of the shelf face at the anchor point
  ny: number;
}

/**
 * Anchor an item pin to the shelf fixture it belongs to: the nearest point on a
 * shelf's outline (the "wall" the product sits against), plus the outward face
 * normal there. Returns null when the pin is farther than maxDist from any
 * shelf — it then stays where it is.
 */
export function shelfAnchor(p: WorldPt, elements: MapElement[], maxDist = 1.4): ShelfAnchor | null {
  let best: WorldPt | null = null;
  let bestN: WorldPt | null = null;
  let bestD = Infinity;
  for (const el of elements) {
    if (el.type !== 'shelf' || el.shape !== 'rect') continue;
    const corners = rectCorners(el.geom as RectGeom);
    const cx = corners.reduce((a, c) => a + c.x / 4, 0);
    const cy = corners.reduce((a, c) => a + c.y / 4, 0);
    for (let i = 0; i < 4; i++) {
      const a = corners[i];
      const b = corners[(i + 1) % 4];
      const q = closestPointOnSegment(p, a, b);
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = q;
        // edge normal, oriented away from the shelf center
        const el2 = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const n1 = { x: (b.y - a.y) / el2, y: -(b.x - a.x) / el2 };
        const mid = { x: (a.x + b.x) / 2 - cx, y: (a.y + b.y) / 2 - cy };
        bestN = n1.x * mid.x + n1.y * mid.y >= 0 ? n1 : { x: -n1.x, y: -n1.y };
      }
    }
  }
  if (best === null || bestN === null || bestD > maxDist) return null;
  return { x: best.x, y: best.y, nx: bestN.x, ny: bestN.y };
}

/** Point-in-shape or near-boundary hit test, with tolerance in world meters. */
export function elementContains(el: MapElement, p: WorldPt, tol = 0.4): boolean {
  if (el.shape === 'point') {
    const g = el.geom as PointGeom;
    return Math.hypot(g.x - p.x, g.y - p.y) <= tol + 0.6;
  }
  if (el.shape === 'rect') {
    const r = el.geom as RectGeom;
    const corners = rectCorners(r);
    // inverse-rotate p around center, then AABB test
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const a = (-r.rot * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const q = {
      x: cx + (p.x - cx) * cos - (p.y - cy) * sin,
      y: cy + (p.x - cx) * sin + (p.y - cy) * cos,
    };
    return q.x >= r.x - tol && q.x <= r.x + r.w + tol && q.y >= r.y - tol && q.y <= r.y + r.h + tol
      ? true
      : edgeHit(corners, p, tol, false);
  }
  const pts = polyPoints(el);
  if (el.shape === 'polyline') return edgeHit(pts, p, tol, true);
  // polygon: ray casting + edge tolerance
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x;
    const yi = pts[i].y;
    const xj = pts[j].x;
    const yj = pts[j].y;
    const intersect = yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside || edgeHit(pts, p, tol, false);
}

function edgeHit(pts: WorldPt[], p: WorldPt, tol: number, open: boolean): boolean {
  const n = pts.length;
  for (let i = 0; i < n - 1; i++) {
    if (distToSegment(p, pts[i], pts[i + 1]) <= tol) return true;
  }
  if (!open && n > 2 && distToSegment(p, pts[n - 1], pts[0]) <= tol) return true;
  return false;
}

/** Move an element by (dx, dy) world meters. */
export function translateElement(el: MapElement, dx: number, dy: number): MapElement {
  if (el.shape === 'rect') {
    const g = { ...(el.geom as RectGeom) };
    g.x += dx;
    g.y += dy;
    return { ...el, geom: g };
  }
  if (el.shape === 'point') {
    const g = el.geom as PointGeom;
    return { ...el, geom: { x: g.x + dx, y: g.y + dy } };
  }
  const g = (el.geom as PolyGeom).map(([x, y]) => [x + dx, y + dy] as [number, number]);
  return { ...el, geom: g };
}

export const HANDLE_TYPES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
export type HandleType = (typeof HANDLE_TYPES)[number];

/**
 * Resize a rect by dragging one of 8 handles. The rect is rotated around its
 * center, so we work in the rect's local frame: convert the pointer to local
 * coordinates, adjust the local AABB, then rebuild the world rect.
 */
export function resizeRect(
  r: RectGeom,
  handle: HandleType,
  worldPt: WorldPt,
  minSize = 0.3
): RectGeom {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const a = (-r.rot * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const local = {
    x: cx + (worldPt.x - cx) * cos - (worldPt.y - cy) * sin,
    y: cy + (worldPt.x - cx) * sin + (worldPt.y - cy) * cos,
  };
  let x0 = r.x;
  let y0 = r.y;
  let x1 = r.x + r.w;
  let y1 = r.y + r.h;
  if (handle.includes('w')) x0 = Math.min(local.x, x1 - minSize);
  if (handle.includes('e')) x1 = Math.max(local.x, x0 + minSize);
  if (handle.includes('n')) y0 = Math.min(local.y, y1 - minSize);
  if (handle.includes('s')) y1 = Math.max(local.y, y0 + minSize);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, rot: r.rot };
}

/** Set rect rotation so the rect "points" from its center toward worldPt. */
export function rotateRectTo(r: RectGeom, worldPt: WorldPt): RectGeom {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const deg = (Math.atan2(worldPt.y - cy, worldPt.x - cx) * 180) / Math.PI + 90;
  return { ...r, rot: ((deg % 360) + 360) % 360 };
}

export const SHAPES_FOR_TOOL: Record<string, { shape: ElementShape; defaultSize?: [number, number] }> = {
  rect: { shape: 'rect' },
};
