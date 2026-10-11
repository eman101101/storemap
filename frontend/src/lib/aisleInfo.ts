/**
 * Aisle affordances shared by the 2D and 3D views: where an aisle's label /
 * symbol sits, and what "is in the aisle" — the products pinned to shelves
 * within arm's reach of its path. Pure functions, trivially testable.
 */
import type { MapElement } from '../types';
import { distToPolyline, polyMidpoint, polyPoints, type WorldPt } from './geometry';

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
  if (aisle.shape !== 'polyline') return { categories: [], count: 0, examples: [] };
  const pts = polyPoints(aisle);
  const byCat = new Map<string, { color: string; count: number }>();
  const examples: string[] = [];
  let count = 0;
  for (const pin of pins) {
    if (distToPolyline({ x: pin.location.x, y: pin.location.y }, pts) > reach) continue;
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

/** Screen-space tooltip model both views render. */
export function aisleTooltipLabel(aisle: MapElement, contents: AisleContents): string {
  return aisle.label?.trim() || 'Aisle';
}
