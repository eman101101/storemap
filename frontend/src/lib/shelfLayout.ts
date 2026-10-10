/**
 * Shelf layout computation: turns a shelf map element plus the product pins
 * inside it into a planogram model — bays along the shelf, levels front-to-top,
 * and each product's facing position. Pure functions so they are trivially
 * testable and shared by the viewer and the editor.
 */
import type { MapElement, PointGeom, PolyGeom, Product, ProductLocation, RectGeom } from '../types';
import { rectCorners } from './geometry';

export interface ShelfPin {
  location: ProductLocation;
  product: Product;
}

export interface ShelfSlot {
  product: Product;
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
  meta: { bays: number; levels: number };
}

const DEFAULT_BAY_WIDTH = 1.25; // metres of shelf per bay
const DEFAULT_LEVELS = 3;
const DEFAULT_FACING = 0.32; // metres per product facing

function shelfMeta(el: MapElement): { bays?: number; levels?: number; facing?: number } {
  try {
    const m = JSON.parse(el.meta || '{}');
    return typeof m === 'object' && m !== null ? m : {};
  } catch {
    return {};
  }
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

  const width = Math.max(r.w, 0.1);
  const depth = Math.max(r.h, 0.1);
  const bayCount = clampInt(meta.bays, 1, 40) ?? Math.max(1, Math.round(width / DEFAULT_BAY_WIDTH));
  const levelCount = clampInt(meta.levels, 1, 12) ?? DEFAULT_LEVELS;
  const facing = clampNum(meta.facing, 0.05, 3) ?? DEFAULT_FACING;

  const inside: ShelfPin[] = [];
  const outside: ShelfPin[] = [];
  for (const pin of pins) (pinInShelf(shelf, pin) ? inside : outside).push(pin);

  const slots: ShelfSlot[] = inside.map(({ location, product }) => {
    const local = worldToShelfLocal(r, location);
    // Deep shelves: a pin's local y maps to a level; shallow shelves: one level.
    const level =
      clampInt((location.meta && safeParse(location.meta).shelf_level) as number, 1, levelCount) ??
      (depth > levelCount * 0.35
        ? Math.min(levelCount, Math.max(1, levelCount - Math.floor((local.y / depth) * levelCount)))
        : 1);
    return {
      product,
      u: Math.min(1, Math.max(0, local.x / width)),
      level,
      facingWidth: facing,
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
    meta: { bays: bayCount, levels: levelCount },
  };
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
