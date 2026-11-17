/** Aisle affordances: midpoint on the line, distance to the path, contents. */
import { describe, expect, it } from 'vitest';
import type { MapElement } from '../types';
import { polyMidpoint, distToPolyline } from './geometry';
import { aisleContents, aisleMidpoint, shelfContents, shelfDirectory, AISLE_REACH_M, SHELF_TOL_M } from './aisleInfo';

const el = (type: string, shape: string, geom: unknown): MapElement =>
  ({ id: `x-${Math.random().toString(36).slice(2, 7)}`, floor_id: 'f', type, shape, geom, label: '', color: '', meta: '', z_index: 1 }) as MapElement;

describe('polyMidpoint', () => {
  it('returns the point at half the arc length — on the line, not the vertex average', () => {
    // L-shaped path: 10 m east then 10 m south. Midpoint is the corner.
    const mid = polyMidpoint([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])!;
    expect(mid).toEqual({ x: 10, y: 0 });
    // 4 m east then 4 m west-ish: midpoint 2 m along the first segment
    const mid2 = polyMidpoint([{ x: 0, y: 0 }, { x: 4, y: 0 }])!;
    expect(mid2).toEqual({ x: 2, y: 0 });
  });

  it('handles single points and empty input', () => {
    expect(polyMidpoint([{ x: 3, y: 4 }])).toEqual({ x: 3, y: 4 });
    expect(polyMidpoint([])).toBeNull();
  });
});

describe('distToPolyline', () => {
  it('measures perpendicular distance to the nearest segment', () => {
    const line = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
    expect(distToPolyline({ x: 5, y: 2 }, line)).toBeCloseTo(2, 5);
    // beyond the ends it falls back to the endpoint distance
    expect(distToPolyline({ x: 13, y: 4 }, line)).toBeCloseTo(5, 5);
  });
});

describe('aisleContents', () => {
  const aisle = el('aisle', 'polyline', [[0, 10], [20, 10]]);

  it('groups nearby pins by category, biggest first, and counts them', () => {
    const pins = [
      { location: { x: 2, y: 10 }, product: { name: 'Milk', category_name: 'Dairy', category_color: '#3b6fd4' } },
      { location: { x: 4, y: 10.5 }, product: { name: 'Cheese', category_name: 'Dairy', category_color: '#3b6fd4' } },
      { location: { x: 8, y: 11.4 }, product: { name: 'Chips', category_name: 'Snacks', category_color: '#d4a017' } },
      // far away — belongs to another aisle
      { location: { x: 8, y: 20 }, product: { name: 'Bleach', category_name: 'Household', category_color: '#3a7ca5' } },
    ];
    const c = aisleContents(aisle, pins);
    expect(c.count).toBe(3);
    expect(c.categories[0]).toMatchObject({ name: 'Dairy', count: 2 });
    expect(c.categories.map((x) => x.name)).toEqual(['Dairy', 'Snacks']);
    expect(c.examples).toContain('Milk');
  });

  it('empty aisles report zero without crashing', () => {
    const c = aisleContents(aisle, []);
    expect(c).toEqual({ categories: [], count: 0, examples: [] });
  });

  it('the reach radius is applied from the aisle path', () => {
    const pin = (d: number) => [{ location: { x: 5, y: 10 + d }, product: { name: 'X', category_name: 'C', category_color: '#111111' } }];
    expect(aisleContents(aisle, pin(AISLE_REACH_M - 0.01)).count).toBe(1);
    expect(aisleContents(aisle, pin(AISLE_REACH_M + 0.01)).count).toBe(0);
  });

  it('midpoint of an aisle element lies on its path', () => {
    const m = aisleMidpoint(aisle)!;
    expect(m.y).toBeCloseTo(10, 5);
    expect(m.x).toBeCloseTo(10, 5);
    expect(aisleMidpoint(el('shelf', 'rect', { x: 0, y: 0, w: 2, h: 1, rot: 0 }))).toBeNull();
  });

  it('rect aisle zones count pins inside and within reach of their edges', () => {
    const zone = el('aisle', 'rect', { x: 10, y: 0, w: 6, h: 2, rot: 0 });
    const pins = [
      pin(12, 1, 'Milk', 'Dairy'),           // inside → 0
      pin(16 + AISLE_REACH_M - 0.01, 1, 'Bleach', 'Household', '#3a7ca5'), // just past the east edge
      pin(16 + AISLE_REACH_M + 0.01, 1, 'Far', 'Other'),                   // out of reach
    ];
    const c = aisleContents(zone, pins);
    expect(c.count).toBe(2);
    expect(c.categories.map((x) => x.name)).toEqual(['Dairy', 'Household']);
  });
});

const pin = (x: number, y: number, name: string, cat: string, color = '#3b6fd4') => ({
  location: { x, y },
  product: { name, category_name: cat, category_color: color },
});

describe('shelfContents', () => {
  const shelf = el('shelf', 'rect', { x: 0, y: 0, w: 4, h: 1, rot: 0 });

  it('counts the pins on the shelf footprint, grouped by category', () => {
    const c = shelfContents(shelf, [
      pin(0.5, 0.5, 'Milk', 'Dairy'),
      pin(3.5, 0.4, 'Cheese', 'Dairy'),
      pin(2, 0.9, 'Chips', 'Snacks', '#d4a017'),
      pin(2, 5, 'Bleach', 'Household'), // another shelf entirely
    ]);
    expect(c.count).toBe(3);
    expect(c.categories.map((x) => [x.name, x.count])).toEqual([['Dairy', 2], ['Snacks', 1]]);
    expect(c.examples).toEqual(['Milk', 'Cheese', 'Chips']);
  });

  it('applies the planogram tolerance from the shelf edge, rotation aware', () => {
    expect(shelfContents(shelf, [pin(4 + SHELF_TOL_M - 0.01, 0.5, 'A', 'C')]).count).toBe(1);
    expect(shelfContents(shelf, [pin(4 + SHELF_TOL_M + 0.01, 0.5, 'A', 'C')]).count).toBe(0);
    // same shelf turned 90°: it now runs vertically through its centre (2, 0.5)
    const turned = el('shelf', 'rect', { x: 0, y: 0, w: 4, h: 1, rot: 90 });
    expect(shelfContents(turned, [pin(2, 2.3, 'A', 'C')]).count).toBe(1);
    expect(shelfContents(turned, [pin(3.8, 0.5, 'A', 'C')]).count).toBe(0);
  });

  it('non-rect elements report empty', () => {
    expect(shelfContents(el('aisle', 'polyline', [[0, 0], [1, 1]]), [pin(0, 0, 'A', 'C')])).toEqual({ categories: [], count: 0, examples: [] });
  });
});

describe('shelfDirectory', () => {
  const labelled = (label: string, x: number, y: number) => ({ ...el('shelf', 'rect', { x, y, w: 4, h: 1, rot: 0 }), label });

  it('groups labelled shelves by label with merged contents, sorted numerically', () => {
    const shelves = [
      labelled('Aisle 10', 0, 20),
      labelled('Aisle 2', 0, 0),
      labelled('Aisle 2', 0, 2), // the facing row of the same aisle
      { ...el('shelf', 'rect', { x: 0, y: 40, w: 4, h: 1, rot: 0 }), label: '' }, // unlabelled: skipped
      { ...el('wall', 'rect', { x: 0, y: 50, w: 4, h: 1, rot: 0 }), label: 'North wall' }, // not a shelf
    ];
    const rows = shelfDirectory(shelves, [
      pin(1, 0.5, 'Milk', 'Dairy'),
      pin(1, 2.5, 'Yogurt', 'Dairy'),
      pin(3, 2.5, 'Chips', 'Snacks', '#d4a017'),
      pin(1, 20.5, 'Bleach', 'Household', '#3a7ca5'),
    ]);
    expect(rows.map((r) => r.label)).toEqual(['Aisle 2', 'Aisle 10']);
    expect(rows[0].shelfIds).toHaveLength(2);
    expect(rows[0].count).toBe(3);
    expect(rows[0].categories[0]).toMatchObject({ name: 'Dairy', count: 2 });
    expect(rows[1]).toMatchObject({ count: 1, categories: [{ name: 'Household', color: '#3a7ca5', count: 1 }] });
  });

  it('a pin touching two shelves of one aisle is counted once', () => {
    // two rows 0.3 m apart; a pin in the gap is within tolerance of both
    const shelves = [labelled('Aisle 1', 0, 0), labelled('Aisle 1', 0, 1.3)];
    const rows = shelfDirectory(shelves, [pin(2, 1.15, 'Milk', 'Dairy')]);
    expect(rows[0].count).toBe(1);
  });
});
