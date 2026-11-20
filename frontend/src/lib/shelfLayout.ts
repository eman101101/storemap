/**
 * Shelf layout computation: turns a shelf map element plus the product pins
 * inside it into a planogram model — bays along the shelf, levels front-to-top,
 * and each product's facing position. Pure functions so they are trivially
 * testable and shared by the viewer and the editor.
 */
import type { MapElement, PointGeom, PolyGeom, Product, ProductLocation, RectGeom } from '../types';
import { rectCorners, type WorldPt } from './geometry';

export interface ShelfPin {
  location: ProductLocation;
  product: Product;
}

export interface ShelfSlot {
  product: Product;
  /** the pin this facing was placed from — planogram edits write to it */
  locationId: string;
  /** facing position along the shelf, 0..1 from the left end */
  u: number;
  /** 1-based level from the bottom */
  level: number;
  /** horizontal metres the facing occupies (for drawing) */
  facingWidth: number;
}

export interface ShelfBay {
  index: number;
  /** bay start/end along the shelf width, in metres from the left end */
  from: number;
  to: number;
  slots: ShelfSlot[];
}

export interface ShelfLayout {
  shelfId: string;
  label: string;
  /** usable shelf width (m) */
  width: number;
  depth: number;
  levels: number;
  bays: ShelfBay[];
  /** pins belonging to this shelf's floor but geometrically outside the shelf */
  outside: ShelfPin[];
  /** meta the layout was built from */
  meta: { bays: number; levels: number; planWidth: number; planDepth: number; rowH: number };
}

/** How a shelf's planogram is drawn: schematic tiles, photos with a label
 *  strip, or full-bleed image tiles (details live in the selection panel). */
export type PlanogramView = 'diagram' | 'photos' | 'images';

const DEFAULT_BAY_WIDTH = 1.25; // metres of shelf per bay
export const DEFAULT_LEVELS = 4;
export const DEFAULT_ROW_H = 112; // drawn height of one planogram row band (px)
export const DEFAULT_SHELF_HEIGHT = 1.5; // m — typical grocery gondola (1.2–1.8 m range)
export const MIN_SHELF_HEIGHT = 0.3;
export const MAX_SHELF_HEIGHT = 3;
const DEFAULT_FACING = 0.32; // metres per product facing
/** Default drawn size of a product facing on a shelf face (m). */
export const DEFAULT_ITEM_H = 0.24;
export const DEFAULT_ITEM_W = 0.2;
const MIN_ITEM = 0.05;
const MAX_ITEM = 1.2;

function shelfMeta(el: MapElement): { bays?: number; levels?: number; facing?: number; height?: number; itemH?: number; itemW?: number; planWidth?: number; planDepth?: number; rowH?: number; planogramView?: unknown } {
  try {
    const m = JSON.parse(el.meta || '{}');
    return typeof m === 'object' && m !== null ? m : {};
  } catch {
    return {};
  }
}

/** Row count (levels) a shelf renders and plans with — meta override clamped to 1..8, else the default. */
export function shelfLevels(el: MapElement): number {
  return clampInt(shelfMeta(el).levels, 1, 8) ?? DEFAULT_LEVELS;
}

/** Extrusion height of a shelf (m) — meta override clamped, else the default. */
export function shelfHeight(el: MapElement): number {
  return clampNum(shelfMeta(el).height, MIN_SHELF_HEIGHT, MAX_SHELF_HEIGHT) ?? DEFAULT_SHELF_HEIGHT;
}

/** Drawn product-facing size on a shelf (m): height and length along the shelf. */
export function shelfItemSize(el: MapElement): { h: number; w: number } {
  const m = shelfMeta(el);
  return {
    h: clampNum(m.itemH, MIN_ITEM, MAX_ITEM) ?? DEFAULT_ITEM_H,
    w: clampNum(m.itemW, MIN_ITEM, MAX_ITEM) ?? DEFAULT_ITEM_W,
  };
}

/** The shelf's persisted planogram view mode — meta override, else null so
 *  callers fall back to their auto-detection. */
export function shelfPlanogramView(el: MapElement): PlanogramView | null {
  const v = shelfMeta(el).planogramView;
  return v === 'diagram' || v === 'photos' || v === 'images' ? v : null;
}

/**
 * Board geometry shared by the 3D renderer and the stocking facings, so painted
 * boards and product squares always line up: a base plinth, then `rows` board
 * lines evenly spaced up to a small top margin under the cap. `zs` are the
 * painted board lines (shadow strips); `stand` are the surface heights product
 * facings stand on — one band below each line, so the bottom band (above the
 * plinth) is used and nothing rises past the top board.
 */
export function boardGeometry(height: number, rows: number): { plinth: number; zs: number[]; stand: number[]; gapH: number } {
  const h = Math.max(height, MIN_SHELF_HEIGHT);
  const n = Math.min(8, Math.max(1, Math.round(rows)));
  const plinth = Math.min(0.14, h * 0.12);
  const spacing = (h - plinth - 0.06) / n;
  const zs = Array.from({ length: n }, (_, i) => plinth + (i + 1) * spacing);
  const stand = [plinth, ...zs.slice(0, -1)];
  const gapH = Math.min(0.14, Math.max(0.04, spacing * 0.3));
  return { plinth, zs, stand, gapH };
}

/** Surface heights (m) a shelf's product facings stand on — one per row. */
export function shelfBoardZs(el: MapElement): number[] {
  return boardGeometry(shelfHeight(el), shelfLevels(el)).stand;
}

/** Inverse-rotate a world point into the shelf's local frame, relative to its top-left rect corner. */
export function worldToShelfLocal(r: RectGeom, p: { x: number; y: number }): { x: number; y: number } {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const a = (-r.rot * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return {
    x: r.w / 2 + (p.x - cx) * cos - (p.y - cy) * sin,
    y: r.h / 2 + (p.x - cx) * sin + (p.y - cy) * cos,
  };
}

/** Rotate a local shelf point (metres from the rect's top-left corner) back to world space. */
export function shelfLocalToWorld(r: RectGeom, lx: number, ly: number): { x: number; y: number } {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const a = (r.rot * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const dx = lx - r.w / 2;
  const dy = ly - r.h / 2;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

/** Does a pin sit inside this (rotated) rect shelf, within a small tolerance? */
export function pinInShelf(shelf: MapElement, pin: ShelfPin, tol = 0.35): boolean {
  if (shelf.shape !== 'rect') return false;
  const r = shelf.geom as RectGeom;
  const local = worldToShelfLocal(r, pin.location);
  return local.x >= -tol && local.x <= r.w + tol && local.y >= -tol && local.y <= r.h + tol;
}

/**
 * Build the planogram. Products already on the shelf keep their position;
 * everything is placed by its real pin coordinates, so what you see is what
 * the shopper sees on the map.
 */
export function computeShelfLayout(shelf: MapElement, pins: ShelfPin[]): ShelfLayout | null {
  if (shelf.shape !== 'rect') return null;
  const r = shelf.geom as RectGeom;
  const meta = shelfMeta(shelf);

  // The planogram's length/depth are planogram-only options (meta.planWidth /
  // meta.planDepth) — they never touch the shelf's footprint on the map. The
  // physical rect width is what pins are positioned against; the planogram
  // drawing can be wider or narrower than it.
  const physWidth = Math.max(r.w, 0.1);
  const width = clampNum(meta.planWidth, 0.3, 60) ?? physWidth;
  const depth = clampNum(meta.planDepth, 0.1, 20) ?? Math.max(r.h, 0.1);
  const bayCount = clampInt(meta.bays, 1, 40) ?? Math.max(1, Math.round(width / DEFAULT_BAY_WIDTH));
  const levelCount = shelfLevels(shelf);
  const facing = clampNum(meta.facing, 0.05, 3) ?? DEFAULT_FACING;

  const inside: ShelfPin[] = [];
  const outside: ShelfPin[] = [];
  // a duplicated pin (same location twice) must not double-draw — it would
  // also break React reconciliation in the planogram (duplicate keys)
  const seenLocs = new Set<string>();
  for (const pin of pins) {
    if (seenLocs.has(pin.location.id)) continue;
    seenLocs.add(pin.location.id);
    (pinInShelf(shelf, pin) ? inside : outside).push(pin);
  }

  const slots: ShelfSlot[] = inside.map(({ location, product }) => {
    const local = worldToShelfLocal(r, location);
    // One shelf face: the persisted planogram row wins; unpinned rows sit on
    // the bottom board.
    const level =
      clampInt((location.meta && safeParse(location.meta).shelf_level) as number, 1, levelCount) ?? 1;
    return {
      product,
      locationId: location.id,
      u: Math.min(1, Math.max(0, local.x / physWidth)),
      level,
      // per-item width (meta.w, set in the planogram editor) wins over the
      // shelf-wide default
      facingWidth: clampNum((location.meta && safeParse(location.meta).w) as number, 0.05, 3) ?? facing,
    };
  });

  const bays: ShelfBay[] = Array.from({ length: bayCount }, (_, i) => ({
    index: i,
    from: (i * width) / bayCount,
    to: ((i + 1) * width) / bayCount,
    slots: [],
  }));
  for (const slot of slots) {
    const idx = Math.min(bayCount - 1, Math.floor(slot.u * bayCount));
    bays[idx].slots.push(slot);
  }
  for (const bay of bays) bay.slots.sort((a, b) => a.u - b.u);

  return {
    shelfId: shelf.id,
    label: shelf.label || 'Shelf',
    width,
    depth,
    levels: levelCount,
    bays,
    outside,
    meta: { bays: bayCount, levels: levelCount, planWidth: width, planDepth: depth, rowH: clampNum(meta.rowH, 64, 200) ?? DEFAULT_ROW_H },
  };
}

/** The shelf's run length (longest side of a rect shelf, rotation aware). */
export function shelfRunLength(shelf: MapElement): number {
  if (shelf.shape !== 'rect') return 1;
  const r = shelf.geom as RectGeom;
  return Math.max(r.w, r.h);
}

/** Which face of a rect shelf a world point sits on (front = near half in the
 *  shelf's local frame). Null when the shelf isn't a rect. */
export function shelfSideOf(shelf: MapElement, worldPt: WorldPt): 'front' | 'back' | null {
  if (shelf.shape !== 'rect') return null;
  const r = shelf.geom as RectGeom;
  const local = worldToShelfLocal(r, worldPt);
  return local.y * 2 <= r.h ? 'front' : 'back';
}

/**
 * Re-grid a shelf's facings into a compact board that fits them — no rows of
 * empty bays. Levels stay within the shelf's real row count; the remaining
 * facings flow left-to-right, bottom-up. Used by the planogram views so the
 * shelf area always fits the items.
 */
export function compactFilledLayout(src: ShelfLayout, slots: ShelfSlot[]): ShelfLayout {
  const levels = Math.max(1, Math.min(src.levels, Math.ceil(slots.length / 4)));
  const bays = Math.max(1, Math.ceil(slots.length / levels));
  const ordered = [...slots].sort((a, b) => a.u - b.u);
  const placed = ordered.map((s, i) => {
    const bay = i % bays;
    const level = Math.floor(i / bays) + 1;
    return {
      ...s,
      level,
      u: (bay + 0.5) / bays,
      facingWidth: (src.width / bays) * 0.85,
    };
  });
  const out: ShelfLayout = {
    ...src,
    levels,
    bays: Array.from({ length: bays }, (_, i) => ({
      index: i,
      from: (i * src.width) / bays,
      to: ((i + 1) * src.width) / bays,
      slots: [],
    })),
  };
  for (const s of placed) {
    const idx = Math.min(bays - 1, Math.floor(s.u * bays));
    out.bays[idx].slots.push(s);
  }
  for (const b of out.bays) b.slots.sort((a, b) => a.u - b.u);
  return out;
}

/**
 * Find a free along-shelf position (0..1) for a facing of `facingWidth` (in
 * u-fraction units) near `nearU`, avoiding the occupied [u - w/2, u + w/2]
 * intervals of already-placed facings. Scans outward from `nearU`; always
 * returns a clamped position, even when everything overlaps.
 */
export function findFreeFacingU(
  placed: { u: number; w: number }[],
  nearU: number,
  facingWidth: number,
): number {
  const fw = Math.min(0.5, Math.max(0.02, facingWidth));
  const overlaps = (u: number) => placed.some((p) => Math.abs(p.u - u) < (p.w + fw) / 2 - 1e-6);
  if (!overlaps(nearU)) return Math.min(1 - fw / 2, Math.max(fw / 2, nearU));
  for (let d = fw; d <= 1; d += fw) {
    const right = nearU + d;
    if (right <= 1 - fw / 2 && !overlaps(right)) return right;
    const left = nearU - d;
    if (left >= fw / 2 && !overlaps(left)) return left;
  }
  // everything overlaps — hug the nearest edge
  return nearU >= 0.5 ? 1 - fw / 2 : fw / 2;
}

/** Bounding box of any element, for click-targets and layout fallbacks. */
export function shelfBounds(el: MapElement) {
  if (el.shape === 'rect') {
    const corners = rectCorners(el.geom as RectGeom);
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  }
  if (el.shape === 'point') {
    const p = el.geom as PointGeom;
    return { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y };
  }
  const pts = el.geom as PolyGeom;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

function clampInt(v: unknown, min: number, max: number): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function clampNum(v: unknown, min: number, max: number): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

function safeParse(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return typeof v === 'object' && v !== null ? v : {};
  } catch {
    return {};
  }
}
