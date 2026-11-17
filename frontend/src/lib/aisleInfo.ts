/**
 * Aisle & shelf affordances shared by the 2D and 3D views: where an aisle's
 * label / symbol sits, and what "is in the aisle / on the shelf" — the
 * products pinned within arm's reach. Pure functions, trivially testable.
 */
import type { MapElement, RectGeom } from '../types';
import { distToPolyline, polyMidpoint, polyPoints, type WorldPt } from './geometry';
import { worldToShelfLocal } from './shelfLayout';

/** Aisle marker position: the arc-length midpoint of its path. */
export function aisleMidpoint(aisle: MapElement): WorldPt | null {
  if (aisle.shape !== 'polyline') return null;
  return polyMidpoint(polyPoints(aisle));
}

export interface AislePin {
  location: { x: number; y: number };
  product: { name: string; category_name?: string | null; category_color?: string | null };
}

export interface AisleContents {
  /** categories touching the aisle, biggest first */
  categories: { name: string; color: string; count: number }[];
  /** total pinned products within reach of the aisle */
  count: number;
  /** a few example product names (biggest categories first) */
  examples: string[];
}

/** How far from the aisle path a pin still counts as "in" it — a 1.5 m aisle
 *  plus the shopper's reach on either side. */
export const AISLE_REACH_M = 2.0;

/**
 * Products pinned within AISLE_REACH_M of the aisle's path, grouped by
 * category. `pins` should be every pin on the floor, not the search filter.
 */
export function aisleContents(aisle: MapElement, pins: AislePin[], reach = AISLE_REACH_M): AisleContents {
  if (aisle.shape === 'polyline') {
    const pts = polyPoints(aisle);
    return collectContents(pins, (pin) => distToPolyline({ x: pin.location.x, y: pin.location.y }, pts) <= reach);
  }
  if (aisle.shape === 'rect') {
    const r = aisle.geom as RectGeom;
    return collectContents(pins, (pin) => distToRect({ x: pin.location.x, y: pin.location.y }, r) <= reach);
  }
  return { categories: [], count: 0, examples: [] };
}

/** Distance from a point to a rect (0 inside), in the rect's rotated frame. */
function distToRect(p: WorldPt, r: RectGeom): number {
  const local = worldToShelfLocal(r, p);
  const dx = Math.max(0, Math.max(-local.x, local.x - r.w));
  const dy = Math.max(0, Math.max(-local.y, local.y - r.h));
  return Math.hypot(dx, dy);
}

/** Pins sitting on a rect shelf count from its edge by this much — the same
 *  tolerance the planogram (ShelfDetail) uses for "on this shelf". */
export const SHELF_TOL_M = 0.35;

/** Products pinned on a shelf (within SHELF_TOL_M of its footprint, rotation
 *  aware), grouped by category — the shelf-hover hover card's data. */
export function shelfContents(shelf: MapElement, pins: AislePin[], tol = SHELF_TOL_M): AisleContents {
  if (shelf.shape !== 'rect') return { categories: [], count: 0, examples: [] };
  const r = shelf.geom as RectGeom;
  return collectContents(pins, (pin) => {
    const local = worldToShelfLocal(r, pin.location);
    return local.x >= -tol && local.x <= r.w + tol && local.y >= -tol && local.y <= r.h + tol;
  });
}

/** Shared accumulator: filter pins, group by category (biggest first). */
function collectContents(pins: AislePin[], include: (pin: AislePin) => boolean): AisleContents {
  const byCat = new Map<string, { color: string; count: number }>();
  const examples: string[] = [];
  let count = 0;
  for (const pin of pins) {
    if (!include(pin)) continue;
    count++;
    const name = pin.product.category_name?.trim() || 'Other';
    const color = pin.product.category_color || '#5b6b5f';
    const entry = byCat.get(name) ?? { color, count: 0 };
    entry.count++;
    byCat.set(name, entry);
    if (examples.length < 6) examples.push(pin.product.name);
  }
  return {
    categories: [...byCat.entries()]
      .map(([name, { color, count: c }]) => ({ name, color, count: c }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    count,
    examples,
  };
}

export interface DirectoryRow {
  label: string;
  /** shelf element ids carrying this label, in draw order */
  shelfIds: string[];
  /** categories across the whole labelled aisle, biggest first */
  categories: { name: string; color: string; count: number }[];
  count: number;
}

/**
 * The pre-search "What's where" directory: rect shelves grouped by label
 * ("Aisle 1", "North wall", …) with the categories pinned on them. Unlabelled
 * shelves are skipped — they have nothing a shopper can navigate by.
 */
export function shelfDirectory(shelves: MapElement[], pins: AislePin[]): DirectoryRow[] {
  const byLabel = new Map<string, { ids: string[]; pins: Set<AislePin> }>();
  for (const shelf of shelves) {
    if (shelf.type !== 'shelf' || shelf.shape !== 'rect') continue;
    const label = shelf.label?.trim();
    if (!label) continue;
    const r = shelf.geom as RectGeom;
    const entry = byLabel.get(label) ?? { ids: [], pins: new Set<AislePin>() };
    entry.ids.push(shelf.id);
    for (const pin of pins) {
      const local = worldToShelfLocal(r, pin.location);
      if (
        local.x >= -SHELF_TOL_M && local.x <= r.w + SHELF_TOL_M &&
        local.y >= -SHELF_TOL_M && local.y <= r.h + SHELF_TOL_M
      ) {
        entry.pins.add(pin); // identity-set: shelves sharing an edge don't double-count
      }
    }
    byLabel.set(label, entry);
  }
  return [...byLabel.entries()]
    .map(([label, { ids, pins: groupPins }]) => {
      const contents = collectContents([...groupPins], () => true);
      return { label, shelfIds: ids, categories: contents.categories, count: contents.count };
    })
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}
