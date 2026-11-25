import { describe, it, expect } from 'vitest';
import { groupPrice, buildGroupPins } from './itemGroups';
import { parseElement } from '../types';
import type { MapElementRow, ProductLocation } from '../types';

describe('groupPrice', () => {
  it('is deterministic and price-like', () => {
    expect(groupPrice('Oat Drink 1L', 0)).toBe(groupPrice('Oat Drink 1L', 0));
    const p = groupPrice('Oat Drink 1L', 3);
    expect(p).toBeGreaterThan(0.5);
    expect(p).toBeLessThan(8);
    expect(Number.isInteger(Math.round(p * 100))).toBe(true);
  });
});

/* ── the demo map's group model ────────────────────────────────────────────
   Two shelf groups. Each carries ONE titled map pin (its groupPin facing);
   the group's items are planogram-only facings (groupOnly) that never draw. */
const shelfRow = (id: string, label: string, x: number): MapElementRow => ({
  id, floor_id: 'f1', type: 'shelf', shape: 'rect', label, color: '',
  geometry: JSON.stringify({ x, y: 0, w: 10, h: 1, rot: 0 }), meta: '{}', z_index: 0,
});
// parsed, exactly as the viewer passes them (geometry as an object)
const shelves = [shelfRow('dairy', 'Dairy & Cheese', 0), shelfRow('drinks', 'Soft Drinks', 20)].map(parseElement);

const loc = (id: string, productId: string, x: number, meta: Record<string, unknown> = {}): ProductLocation =>
  ({ id, product_id: productId, floor_id: 'f1', x, y: 0.5, rot: 0, meta: JSON.stringify(meta) });

const locations: ProductLocation[] = [
  loc('dairy-pin', 'milk', 5, { groupPin: 1, pinW: 6, pinH: 0.3 }),
  loc('yogurt-facing', 'yogurt', 2, { groupOnly: 1 }),
  loc('butter-facing', 'butter', 8, { groupOnly: 1 }),
  loc('drinks-pin', 'cola', 25, { groupPin: 1 }),
  loc('lemonade-facing', 'lemonade', 22, { groupOnly: 1 }),
  // a lone item standing on no shelf
  loc('freestanding', 'gumball-machine', 40, {}),
];

describe('buildGroupPins', () => {
  it("a planogram-only facing resolves to its group's pin", () => {
    const gp = buildGroupPins(locations, shelves);
    expect(gp.of(locations[1]).id).toBe('dairy-pin');
    expect(gp.of(locations[2]).id).toBe('dairy-pin');
    expect(gp.of(locations[4]).id).toBe('drinks-pin');
  });

  it('a group pin (or any ordinary facing) is its own destination', () => {
    const gp = buildGroupPins(locations, shelves);
    expect(gp.of(locations[0])).toBe(locations[0]);
    expect(gp.of(locations[5])).toBe(locations[5]);
  });

  it('different groups resolve to different pins — items never merge into one', () => {
    const gp = buildGroupPins(locations, shelves);
    expect(gp.of(locations[1]).id).not.toBe(gp.of(locations[4]).id);
  });

  it("names a facing's group as the map shows it", () => {
    const gp = buildGroupPins(locations, shelves);
    expect(gp.nameOf(locations[1])).toBe('Dairy & Cheese');
    expect(gp.nameOf(locations[4])).toBe('Soft Drinks');
    expect(gp.nameOf(locations[5])).toBeNull();
  });

  it("prefers the shelf's group name (meta.groupName) over its label", () => {
    const named = [parseElement({ ...shelfRow('dairy', 'Aisle 1', 0), meta: JSON.stringify({ groupName: 'Dairy & Cheese' }) }), shelves[1]];
    const gp = buildGroupPins(locations, named);
    expect(gp.nameOf(locations[1])).toBe('Dairy & Cheese');
  });

  it("uses the persisted meta.shelfId even when the pin sits on another shelf", () => {
    // a facing dragged to the edge of the neighbouring shelf keeps its owner
    const moved = { ...locations[1], x: 19.8, meta: JSON.stringify({ groupOnly: 1, shelfId: 'dairy' }) };
    const gp = buildGroupPins([...locations.slice(0, 1), moved, ...locations.slice(3)], shelves);
    expect(gp.shelfIdOf(moved)).toBe('dairy');
    expect(gp.of(moved).id).toBe('dairy-pin');
  });

  it('a shelf that predates group pins falls back to its first ordinary facing', () => {
    const legacy: ProductLocation[] = [loc('l1', 'a', 1), loc('l2', 'b', 3), loc('l3', 'c', 5, { groupOnly: 1 })];
    const gp = buildGroupPins(legacy, shelves);
    expect(gp.of(legacy[2]).id).toBe('l1');
    expect(gp.of(legacy[1]).id).toBe('l2');
  });

  it('a groupOnly facing whose group has no pin at all stays itself (never invents one)', () => {
    const orphan: ProductLocation[] = [loc('x', 'a', 2, { groupOnly: 1 })];
    const gp = buildGroupPins(orphan, shelves);
    expect(gp.of(orphan[0])).toBe(orphan[0]);
  });

  it('survives a corrupt meta string', () => {
    // unreadable meta carries no flags, so the facing reads as an ordinary
    // pin — its own destination — and the group lookups still work
    const bad: ProductLocation[] = [{ ...locations[1], meta: '{not json' }, locations[0]];
    const gp = buildGroupPins(bad, shelves);
    expect(gp.of(bad[0])).toBe(bad[0]);
    expect(gp.nameOf(bad[0])).toBe('Dairy & Cheese');
  });
});
