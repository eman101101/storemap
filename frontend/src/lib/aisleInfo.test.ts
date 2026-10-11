/** Aisle affordances: midpoint on the line, distance to the path, contents. */
import { describe, expect, it } from 'vitest';
import type { MapElement } from '../types';
import { polyMidpoint, distToPolyline } from './geometry';
import { aisleContents, aisleMidpoint, AISLE_REACH_M } from './aisleInfo';

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
});
