/** Tests for windows on long shelves (a 120,000-SKU store sends a stretch of shelf, not the whole). */
import { describe, it, expect } from 'vitest';
import { closestFacing, facingPlace, shelfBand, shelfFacings, shelfSide, whereOnShelf, windowLayout } from './shelfWindow';
import { computeShelfLayout, type ShelfLayout } from './shelfLayout';
import type { MapElement, Product, ProductLocation, ShelfWindow, ShelfWindowSlot } from '../types';

const shelf: MapElement = {
  id: 'shelf-1', floor_id: 'f1', type: 'shelf', shape: 'rect', label: 'Chips & Savoury Snacks',
  color: '', meta: JSON.stringify({ levels: 3, planWidth: 2 }), z_index: 0,
  geom: { x: 10, y: 4, w: 6, h: 1, rot: 0 },
};

function product(id: string): Product {
  return {
    id, store_id: 's', category_id: null, name: `Product ${id}`, brand: 'Lay\'s', sku: '', barcode: '',
    description: '', price: 3.49, image_url: '', image_crop_url: '',
  };
}

/** A generated facing: placed by its meta (shelf, level, place along the shelf). */
function slot(id: string, productId: string, level: number, u: number): ShelfWindowSlot {
  const location: ProductLocation = {
    id, product_id: productId, floor_id: 'f1', x: 13, y: 4.5, rot: 0,
    meta: JSON.stringify({ shelfId: 'shelf-1', shelf_level: level, w: 1, groupOnly: 1, u }),
  };
  return { location, product: product(productId) };
}

const win = (from: number, to: number, slots: ShelfWindowSlot[], u = (from + to) / 2): ShelfWindow => ({
  shelfId: 'shelf-1', u, from, to, levels: [{ level: 1, count: 2200 }, { level: 2, count: 2300 }, { level: 3, count: 2260 }], slots,
});

describe('where on the shelf, in words', () => {
  it('reads the level and place a facing records', () => {
    expect(facingPlace(slot('a', 'p', 2, 0.25).location)).toEqual({ shelfId: 'shelf-1', level: 2, u: 0.25 });
    expect(facingPlace({ meta: '{}' })).toEqual({ shelfId: null, level: null, u: null });
    expect(facingPlace({ meta: 'not json' })).toEqual({ shelfId: null, level: null, u: null });
    expect(facingPlace({})).toEqual({ shelfId: null, level: null, u: null });
  });

  it('names the three stretches of a shelf', () => {
    expect(shelfSide(0.05)).toBe('left end');
    expect(shelfSide(0.5)).toBe('middle');
    expect(shelfSide(0.95)).toBe('right end');
  });

  it('names the boards from the bottom up', () => {
    expect(shelfBand(1, 3)).toBe('bottom shelf');
    expect(shelfBand(2, 3)).toBe('middle shelf');
    expect(shelfBand(3, 3)).toBe('top shelf');
    expect(shelfBand(1, 4)).toBe('bottom shelf');
    expect(shelfBand(2, 4)).toBe('middle shelf');
    expect(shelfBand(4, 4)).toBe('top shelf');
    expect(shelfBand(1, 1)).toBe('top shelf'); // one board is both bottom and top — "top shelf" reads right
  });

  it('puts the two together the way a shopper would look for it', () => {
    expect(whereOnShelf(0.1, 3, 3)).toBe('on the top shelf, toward the left end');
    expect(whereOnShelf(0.5, 1, 3)).toBe('on the bottom shelf, in the middle');
    expect(whereOnShelf(0.9, 2, 3)).toBe('on the middle shelf, toward the right end');
    expect(whereOnShelf(0.1, 1, 1)).toBe('on the shelf, toward the left end');
  });
});

describe('closestFacing', () => {
  const centre = (l: ProductLocation) => (JSON.parse(l.meta).shelfId === 'near' ? { x: 0, y: 0 } : { x: 50, y: 0 });
  const on = (id: string, shelfId: string, level: number) => ({ location: { ...slot(id, 'p', level, 0.4).location, meta: JSON.stringify({ shelfId, shelf_level: level, u: 0.4 }) } });

  it('picks the shelf nearest where the shopper stands', () => {
    const far = on('far', 'far', 2);
    const near = on('near', 'near', 1);
    expect(closestFacing([far, near], centre, { x: 1, y: 0 })?.location.id).toBe('near');
    expect(closestFacing([far, near], centre, { x: 49, y: 0 })?.location.id).toBe('far');
  });

  it('between two facings of one shelf, takes the one on the easier-to-reach board', () => {
    const top = on('top', 'near', 3);
    const middle = on('middle', 'near', 2);
    expect(closestFacing([top, middle], centre, { x: 0, y: 0 })?.location.id).toBe('middle');
  });

  it('keeps the first facing when nothing is known', () => {
    const a = on('a', 'near', 1);
    const b = on('b', 'far', 1);
    expect(closestFacing([a, b], centre, null)?.location.id).toBe('a');
    expect(closestFacing([], centre, { x: 0, y: 0 })).toBeNull();
  });
});

describe('windowLayout', () => {
  let layout0: ShelfLayout;
  it('draws the stretch as the whole board, each facing at its level and in its order', () => {
    const slots = [slot('l1', 'a', 1, 0.31), slot('l2', 'b', 1, 0.33), slot('l3', 'c', 1, 0.35), slot('u1', 'd', 3, 0.31)];
    const layout = windowLayout(shelf, win(0.3, 0.4, slots))!;
    const all = layout.bays.flatMap((b) => b.slots);
    expect(all.map((s) => s.locationId).sort()).toEqual(['l1', 'l2', 'l3', 'u1']);
    // three columns, spread over the whole board — and the top facing shares the first one
    const bottom = all.filter((s) => s.level === 1).map((s) => s.u);
    expect(bottom[0]).toBeCloseTo(1 / 6, 5);
    expect(bottom[1]).toBeCloseTo(0.5, 5);
    expect(bottom[2]).toBeCloseTo(5 / 6, 5);
    const top = all.find((s) => s.locationId === 'u1')!;
    expect(top.level).toBe(3);
    expect(top.u).toBeCloseTo(bottom[0], 6);
    expect(layout.levels).toBe(3);
    expect(layout.label).toBe('Chips & Savoury Snacks');
  });

  it('clamps a window that runs off an end of the shelf', () => {
    const layout = windowLayout(shelf, win(0, 0.02, [slot('a', 'a', 1, 0.002), slot('b', 'b', 1, 0.018)]))!;
    // both stay on the board, in its two columns
    const us = layout.bays.flatMap((b) => b.slots).map((s) => s.u);
    expect(us[0]).toBeCloseTo(0.25, 5);
    expect(us[1]).toBeCloseTo(0.75, 5);
  });

  it('gives every facing an even share of the board so neighbours never overlap', () => {
    const slots = ['a', 'b', 'c', 'd', 'e'].map((id, i) => slot(id, id, 2, 0.5 + i * 0.001));
    const layout = windowLayout(shelf, win(0.4, 0.6, slots))!;
    for (const s of layout.bays.flatMap((b) => b.slots)) expect(s.facingWidth).toBeCloseTo(layout.width / 5, 6);
    layout0 = layout;
  });

  it('draws the store\'s own facings that stand in the stretch, and only those', () => {
    const own = (x: number, id: string) => ({ location: { id, product_id: id, floor_id: 'f1', x, y: 4.5, rot: 0, meta: JSON.stringify({ shelf_level: 2 }) }, product: product(id) });
    const inline = computeShelfLayout(shelf, [own(12.1, 'in'), own(10.4, 'out')])!.bays.flatMap((b) => b.slots);
    const layout = windowLayout(shelf, win(0.3, 0.4, [slot('a', 'a', 1, 0.35)], 0.35), inline)!;
    const ids = layout.bays.flatMap((b) => b.slots).map((s) => s.locationId).sort();
    expect(ids).toEqual(['a', 'in']);
  });

  it("gives the store's own facing a column of its own where it stands — the catalogue's facings step around it", () => {
    const own = (x: number, id: string) => ({ location: { id, product_id: id, floor_id: 'f1', x, y: 4.5, rot: 0, meta: JSON.stringify({ shelf_level: 1 }) }, product: product(id) });
    // the catalogue: three facings along the bottom at 32%, 34%, 36% of the shelf, one above the first
    const slots = [slot('a', 'a', 1, 0.32), slot('b', 'b', 1, 0.34), slot('c', 'c', 1, 0.36), slot('d', 'd', 2, 0.32)];
    // the store's own facing stands at 33% — between the first two
    const inline = computeShelfLayout(shelf, [own(11.98, 'in')])!.bays.flatMap((b) => b.slots);
    const all = windowLayout(shelf, win(0.3, 0.4, slots), inline)!.bays.flatMap((b) => b.slots);
    const bottom = all.filter((s) => s.level === 1).sort((x, y) => x.u - y.u).map((s) => [s.locationId, s.u]);
    expect(bottom.map(([id]) => id)).toEqual(['a', 'in', 'b', 'c']);
    expect(bottom.map(([, u]) => u)).toEqual([0.125, 0.375, 0.625, 0.875]);
    // four columns now, so each facing is a quarter of the board — the top one keeps its column beside the first
    for (const s of all) expect(s.facingWidth).toBeCloseTo(layout0.width / 4, 6);
    expect(all.find((s) => s.locationId === 'd')!.u).toBeCloseTo(0.125, 6);
  });

  it("lets the store's own facings at one place share a column — one to a board, the next one over", () => {
    const at = (id: string, level: number) => ({ location: { ...slot(id, id, level, 0.5).location, x: 13, meta: JSON.stringify({ shelf_level: level }) }, product: product(id) });
    // four of the store's own facings at the shelf's centre: boards 1, 2, 2 and 3
    const inline = computeShelfLayout(shelf, [at('a', 1), at('b', 2), at('c', 2), at('d', 3)])!.bays.flatMap((b) => b.slots);
    const slots = [slot('x', 'x', 1, 0.35), slot('y', 'y', 1, 0.58)];
    const layout = windowLayout(shelf, win(0.3, 0.6, slots), inline)!;
    const all = layout.bays.flatMap((b) => b.slots);
    const u = (id: string) => all.find((s) => s.locationId === id)!.u;
    // four columns: x, the two own ones, y
    expect(u('x')).toBeCloseTo(0.125, 6);
    expect(u('y')).toBeCloseTo(0.875, 6);
    // a, b and d take one each of the three boards in the first own column; c, on b's board, the second
    expect(u('a')).toBeCloseTo(0.375, 6);
    expect(u('b')).toBeCloseTo(0.375, 6);
    expect(u('d')).toBeCloseTo(0.375, 6);
    expect(u('c')).toBeCloseTo(0.625, 6);
    for (const s of all) expect(s.facingWidth).toBeCloseTo(layout.width / 4, 6);
  });

  it('is empty for an empty window, and null for a shelf with no rect to draw', () => {
    const empty = windowLayout(shelf, win(0.3, 0.4, []))!;
    expect(empty.bays.flatMap((b) => b.slots)).toEqual([]);
    const line: MapElement = { ...shelf, shape: 'polyline', geom: [[0, 0], [1, 1]] as never };
    expect(windowLayout(line, win(0.3, 0.4, []))).toBeNull();
  });

  it('counts a shelf\'s facings from what the window reports', () => {
    expect(shelfFacings(win(0, 1, []))).toBe(6760);
    expect(shelfFacings(null)).toBe(0);
  });
});
