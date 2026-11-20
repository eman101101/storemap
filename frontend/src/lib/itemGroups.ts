/**
 * Item-group helpers for the editor's "Add item group" tool. Placing facings
 * is deliberately one facing per item — groups never mass-stock a shelf;
 * repeats are added one by one from the planogram editor. Pure functions,
 * shared by the group creator and its tests.
 */

/** Deterministic demo price for a group item — no Math.random, so re-renders
 *  and tests stay stable. */
export function groupPrice(name: string, index: number): number {
  const base = 0.99 + ((name.length * 7 + index * 31) % 700) / 100;
  return Math.round(base * 100) / 100;
}

/** Default facing width (m) used when a group fills a shelf. */
export const GROUP_FACING_W = 0.32;
