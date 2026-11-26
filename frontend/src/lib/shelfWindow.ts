/**
 * Windows on long shelves. The example stores' shelves hold thousands of
 * facings (a 120,000-SKU Walmart), far too many to draw or to ship with the
 * map, so the server sends the stretch of shelf around a place — a window —
 * and it is laid out as a planogram here. Pure functions, shared by the
 * viewer and the tests.
 */
import type { MapElement, ProductLocation, ShelfWindow } from '../types';
import { computeShelfLayout, type ShelfLayout, type ShelfSlot } from './shelfLayout';

/** The shelf, level and place along it that a facing's meta records (a
 *  generated item carries all three). */
export function facingPlace(location: { meta?: string | null }): { shelfId: string | null; level: number | null; u: number | null } {
  try {
    const m = JSON.parse(location.meta || '{}');
    return {
      shelfId: typeof m.shelfId === 'string' ? m.shelfId : null,
      level: Number.isFinite(Number(m.shelf_level)) ? Number(m.shelf_level) : null,
      u: typeof m.u === 'number' ? m.u : null,
    };
  } catch {
    return { shelfId: null, level: null, u: null };
  }
}

/** Where a place along a shelf is, 0..1 from the left end. */
export function shelfSide(u: number): 'left end' | 'middle' | 'right end' {
  return u < 0.3 ? 'left end' : u < 0.7 ? 'middle' : 'right end';
}

/** Which board of a shelf a level is (1 = the bottom board), in words. */
export function shelfBand(level: number, levels: number): 'bottom shelf' | 'middle shelf' | 'top shelf' {
  const n = Math.max(1, Math.round(levels));
  if (n === 1) return 'top shelf'; // one board: "the shelf" says it — whereOnShelf drops the word
  const up = (Math.min(n, Math.max(1, level)) - 0.5) / n;
  return up < 0.34 ? 'bottom shelf' : up < 0.67 ? 'middle shelf' : 'top shelf';
}

/**
 * Where an item sits on its shelf, in words a shopper can walk up to:
 * "on the top shelf, toward the left end", "on the bottom shelf, in the middle".
 */
export function whereOnShelf(u: number, level: number, levels: number): string {
  const side = shelfSide(u);
  const where = side === 'middle' ? 'in the middle' : `toward the ${side}`;
  return Math.round(levels) <= 1 ? `on the shelf, ${where}` : `on the ${shelfBand(level, levels)}, ${where}`;
}

/**
 * The facing to send a shopper to when an item faces more than once: the one
 * on the shelf nearest `ref` (the 3D camera target, the map centre — null
 * keeps the first). Two facings of one shelf tie, and the one on the board
 * nearest the middle wins — the easiest to reach.
 */
export function closestFacing<T extends { location: ProductLocation }>(
  facings: T[],
  shelfCentre: (location: ProductLocation) => { x: number; y: number } | null,
  ref: { x: number; y: number } | null,
  levels = 3
): T | null {
  if (!facings.length || !ref) return facings[0] ?? null;
  const rank = (f: T) => {
    const c = shelfCentre(f.location);
    return {
      far: c ? Math.hypot(c.x - ref.x, c.y - ref.y) : Infinity,
      off: Math.abs((facingPlace(f.location).level ?? 1) - (levels + 1) / 2),
    };
  };
  return facings.reduce((best, f) => {
    const a = rank(best);
    const b = rank(f);
    return b.far < a.far - 1e-9 || (Math.abs(b.far - a.far) <= 1e-9 && b.off < a.off) ? f : best;
  }, facings[0]);
}

/** One column of a window: where it is, and — for one of the store's own facings — which of its boards are taken. */
interface Column {
  u: number;
  boards: Set<number>;
  own: boolean;
}

/**
 * The planogram of a window: the stretch [from, to] of the shelf drawn as the
 * whole board, each facing at its real level and in its real order left to
 * right. The catalogue's facings stand in columns — one to a board, and the
 * same columns on every board. `inline` are the store's own facings already
 * laid out on the shelf (`computeShelfLayout`); each one standing in the
 * stretch is drawn where it stands, in a column of its own, so nothing
 * overlaps and nothing is hidden.
 */
export function windowLayout(shelf: MapElement, win: ShelfWindow, inline: ShelfSlot[] = []): ShelfLayout | null {
  const base = computeShelfLayout(shelf, []);
  if (!base) return null;
  const from = Math.max(0, win.from);
  const span = Math.max(1e-6, Math.min(1, win.to) - from);
  const at = (u: number) => Math.min(1, Math.max(0, (u - from) / span));

  const catalogue: ShelfSlot[] = [];
  for (const { location, product } of win.slots) {
    const place = facingPlace(location);
    const level = Math.min(8, Math.max(1, Math.round(place.level ?? 1)));
    catalogue.push({ product, locationId: location.id, u: at(place.u ?? win.u), level, facingWidth: 1 });
  }
  const own = inline.filter((s) => s.u >= from && s.u <= win.to).map((s) => ({ ...s, u: at(s.u) }));

  // The columns of the stretch, in order: the catalogue's — the same on every
  // board — and one more wherever a facing of the store's own stands (the
  // other boards have an empty slot there). Own facings at one place share a
  // column, one to a board; a second on a board already taken takes the next.
  const columnOf = new Map<ShelfSlot, Column>();
  const columns: Column[] = [...new Set(catalogue.map((s) => s.u))]
    .sort((a, b) => a - b)
    .map((u) => ({ u, boards: new Set<number>(), own: false }));
  const catalogueColumn = new Map(columns.map((c, i) => [c.u, columns[i]]));
  for (const s of catalogue) columnOf.set(s, catalogueColumn.get(s.u)!);
  for (const s of [...own].sort((a, b) => a.u - b.u || a.level - b.level)) {
    let column = columns.find((c) => c.own && c.u === s.u && !c.boards.has(s.level));
    if (!column) {
      column = { u: s.u, boards: new Set<number>(), own: true };
      const before = columns.findIndex((c) => c.u > s.u);
      columns.splice(before < 0 ? columns.length : before, 0, column);
    }
    column.boards.add(s.level);
    columnOf.set(s, column);
  }
  // every facing gets its even share of the board: neighbours never overlap
  const facingWidth = base.width / columns.length;
  const slots = [...catalogue, ...own].map((s) => ({ ...s, u: (columns.indexOf(columnOf.get(s)!) + 0.5) / columns.length, facingWidth }));
  const levels = Math.max(base.levels, ...slots.map((s) => s.level));
  const bays = Math.max(1, Math.ceil(columns.length / 4));
  const out: ShelfLayout = {
    ...base,
    levels,
    meta: { ...base.meta, levels },
    bays: Array.from({ length: bays }, (_, i) => ({ index: i, from: (i * base.width) / bays, to: ((i + 1) * base.width) / bays, slots: [] })),
  };
  for (const s of slots) out.bays[Math.min(bays - 1, Math.floor(s.u * bays))].slots.push(s);
  for (const b of out.bays) b.slots.sort((a, b) => a.u - b.u);
  return out;
}

/** How many facings the shelf carries, all told (what the window reports per level). */
export function shelfFacings(win: ShelfWindow | null | undefined): number {
  return (win?.levels ?? []).reduce((n, l) => n + l.count, 0);
}
