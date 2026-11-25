/**
 * Item-group helpers. Placing facings is deliberately one facing per item —
 * groups never mass-stock a shelf; repeats are added one by one from the
 * planogram editor. Pure functions, shared by the group creator, the
 * shopper search flows and the tests.
 */
import type { MapElement, ProductLocation } from '../types';
import { groupDisplayName, locationFlags } from '../types';
import { shelfContaining } from './departments';

/** Deterministic demo price for a group item — no Math.random, so re-renders
 *  and tests stay stable. */
export function groupPrice(name: string, index: number): number {
  const base = 0.99 + ((name.length * 7 + index * 31) % 700) / 100;
  return Math.round(base * 100) / 100;
}

/** Default facing width (m) used when a group fills a shelf. */
export const GROUP_FACING_W = 1;

/** The pin fields the group lookup needs — a full ProductLocation qualifies. */
export type Facing = Pick<ProductLocation, 'id' | 'x' | 'y' | 'floor_id' | 'meta'>;

export interface GroupPins {
  /** The map pin a shopper is sent to for a facing: the facing itself unless
   *  it is planogram-only (meta.groupOnly), in which case the pin of the
   *  group it sits in. */
  of: <F extends Facing>(facing: F) => ProductLocation | F;
  /** The shelf a facing belongs to, null when it sits on no shelf. */
  shelfIdOf: (facing: Facing) => string | null;
  /** A facing's group name as the map shows it (the shelf's group name or
   *  label) — null for a facing with no group. */
  nameOf: (facing: Facing) => string | null;
}

/**
 * Lookups that tie facings to their group's ONE map pin.
 *
 * Every shelf group carries a single titled pin (its `groupPin` facing); the
 * group's items are planogram-only facings (`groupOnly`) that never draw as
 * pins. A search hit is therefore an ITEM, but what the map can show and
 * route to is that item's GROUP pin — this resolves one to the other. Shelves
 * that pre-date group pins (plain facings only) fall back to their first
 * ordinary facing, so old maps keep working.
 *
 * `shelves` is the floor's rect shelves. The pin→shelf link is the persisted
 * `meta.shelfId` when it names a shelf, else the shelf the pin sits on
 * (seeded and legacy pins carry no shelfId).
 */
export function buildGroupPins(locations: ProductLocation[], shelves: MapElement[]): GroupPins {
  const shelfById = new Map(shelves.map((s) => [s.id, s]));
  const shelfCache = new Map<string, string | null>();
  const shelfIdOf = (facing: Facing): string | null => {
    const cached = shelfCache.get(facing.id);
    if (cached !== undefined) return cached;
    let shelfId: string | null = null;
    try {
      const sid = JSON.parse(facing.meta || '{}').shelfId;
      if (typeof sid === 'string' && shelfById.has(sid)) shelfId = sid;
    } catch { /* no meta — use the pin's position */ }
    if (!shelfId) shelfId = shelfContaining(facing.x, facing.y, shelves);
    shelfCache.set(facing.id, shelfId);
    return shelfId;
  };

  // the facing that stands for each shelf on the map
  const pinByShelf = new Map<string, ProductLocation>();
  for (const loc of locations) {
    if (locationFlags(loc).groupOnly) continue;
    const shelfId = shelfIdOf(loc);
    if (!shelfId) continue;
    const current = pinByShelf.get(shelfId);
    // the shelf's group pin wins over any plain facing
    if (!current || (locationFlags(loc).groupPin && !locationFlags(current).groupPin)) pinByShelf.set(shelfId, loc);
  }

  return {
    shelfIdOf,
    of: (facing) => (locationFlags(facing).groupOnly ? pinByShelf.get(shelfIdOf(facing) ?? '') ?? facing : facing),
    nameOf: (facing) => {
      const shelfId = shelfIdOf(facing);
      return shelfId ? groupDisplayName(shelfById.get(shelfId)) : null;
    },
  };
}
