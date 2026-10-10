/** Tests for store wayfinding — nav grid, A*, and route assembly. */
import { describe, it, expect } from 'vitest';
import type { Floor, MapElement } from '../types';
import {
  buildNavGrid, isBlocked, cellCenter, nearestOpen, lineOfSight, astar,
  simplifyPath, pathLengthM, computeRoute, pickStartPoint,
} from './navgrid';

const floor: Floor = {
  id: 'f1', store_id: 's1', name: 'Main', level: 0, width_m: 20, height_m: 14, background_url: '',
};

let seq = 0;
const el = (type: MapElement['type'], shape: MapElement['shape'], geom: unknown): MapElement => ({
  id: `e${++seq}`,
  floor_id: 'f1',
  type,
  shape,
  geom: geom as MapElement['geom'],
  label: '',
  color: '',
  meta: '',
  z_index: 1,
});

const rect = (x: number, y: number, w: number, h: number) => ({ x, y, w, h, rot: 0 });
const pt = (x: number, y: number) => ({ x, y });

/** Sample a polyline and assert every sample keeps `pad` euclidean clearance of the rect. */
function expectClearOf(points: { x: number; y: number }[], r: { x: number; y: number; w: number; h: number }, pad: number) {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.1);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      const dx = Math.max(r.x - x, 0, x - (r.x + r.w));
      const dy = Math.max(r.y - y, 0, y - (r.y + r.h));
      const clear = Math.hypot(dx, dy) >= pad;
      expect(clear, `route point (${x.toFixed(2)}, ${y.toFixed(2)}) enters shelf clearance`).toBe(true);
    }
  }
}

describe('nav grid', () => {
  it('blocks shelf cells but keeps walkable floor open', () => {
    const g = buildNavGrid(floor, [el('shelf', 'rect', rect(5, 5, 2, 1))]);
    expect(isBlocked(g, ...cellToColRow(g, 6, 5.5))).toBe(true); // inside the shelf
    expect(isBlocked(g, ...cellToColRow(g, 6, 7))).toBe(false); // aisle below it
  });

  it('marks everything beyond the floor slab as blocked', () => {
    const g = buildNavGrid(floor, []);
    expect(isBlocked(g, ...cellToColRow(g, -0.8, 7))).toBe(true);
    expect(isBlocked(g, ...cellToColRow(g, 20.8, 7))).toBe(true);
    expect(isBlocked(g, ...cellToColRow(g, 10, 7))).toBe(false);
  });

  it('keeps a clearance buffer around obstacles', () => {
    const g = buildNavGrid(floor, [el('shelf', 'rect', rect(5, 5, 2, 1))], { clearance: 0.3 });
    // 0.2 m from the shelf edge is inside the 0.3 m buffer → blocked
    expect(isBlocked(g, ...cellToColRow(g, 5, 6.2))).toBe(true);
    // 0.6 m from the edge is walkable
    expect(isBlocked(g, ...cellToColRow(g, 5, 6.6))).toBe(false);
  });
});

function cellToColRow(g: ReturnType<typeof buildNavGrid>, x: number, y: number): [number, number] {
  const c = Math.floor((x - g.ox) / g.cell);
  const r = Math.floor((y - g.oy) / g.cell);
  return [c, r];
}

describe('A* + smoothing', () => {
  it('routes around a long shelf between entrance and goal', () => {
    const els = [
      el('entrance', 'point', pt(10, 13)),
      el('shelf', 'rect', rect(4, 4, 12, 3)), // spans x 4..16, y 4..7
    ];
    const route = computeRoute(floor, els, pt(10, 2));
    expect(route).not.toBeNull();
    expect(route!.points[0]).toEqual(pt(10, 13));
    // straight line is 11 m; a detour around the 12 m shelf must be longer
    expect(route!.distanceM).toBeGreaterThan(12.5);
    expectClearOf(route!.points, { x: 4, y: 4, w: 12, h: 3 }, 0.29);
  });

  it('goes straight when the floor is empty', () => {
    const route = computeRoute(floor, [el('entrance', 'point', pt(10, 13))], pt(10, 3));
    expect(route).not.toBeNull();
    expect(route!.distanceM).toBeLessThan(11);
    expect(route!.points.length).toBeLessThanOrEqual(3);
  });

  it('returns null for an unreachable goal (sealed room)', () => {
    const els = [
      el('entrance', 'point', pt(2, 13)),
      el('wall', 'rect', rect(7, 4, 6, 0.4)),
      el('wall', 'rect', rect(7, 9.6, 6, 0.4)),
      el('wall', 'rect', rect(7, 4, 0.4, 6)),
      el('wall', 'rect', rect(12.6, 4, 0.4, 6)),
    ];
    expect(computeRoute(floor, els, pt(10, 7))).toBeNull();
  });

  it('simplification keeps endpoints, cuts points, and stays in open space', () => {
    const els = [el('shelf', 'rect', rect(4, 4, 12, 3))];
    const g = buildNavGrid(floor, els);
    const raw = astar(g, pt(10, 13), pt(10, 2))!;
    const simple = simplifyPath(g, raw);
    expect(simple.length).toBeLessThan(raw.length);
    expect(simple[0]).toEqual(raw[0]);
    for (let i = 1; i < simple.length; i++) expect(lineOfSight(g, simple[i - 1], simple[i])).toBe(true);
    expect(pathLengthM(simple)).toBeLessThanOrEqual(pathLengthM(raw) + 1e-9);
  });

  it('lands the route on the requested goal, not a snapped cell', () => {
    const route = computeRoute(floor, [], pt(7.31, 3.27));
    expect(route!.points[route!.points.length - 1]).toEqual(pt(7.31, 3.27));
  });
});

describe('nearest open cell', () => {
  it('rescues goals that fall inside a shelf', () => {
    const g = buildNavGrid(floor, [el('shelf', 'rect', rect(5, 5, 2, 1))]);
    const open = nearestOpen(g, pt(6, 5.5), 4);
    expect(open).not.toBeNull();
    const c = cellCenter(g, open!.col, open!.row);
    // just outside the inflated shelf, within ~1 m of the requested point
    const d = Math.hypot(c.x - 6, c.y - 5.5);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(1.2);
    expect(isBlocked(g, open!.col, open!.row)).toBe(false);
  });
});

describe('start point selection', () => {
  it('prefers the entrance nearest the goal', () => {
    const els = [el('entrance', 'point', pt(2, 13)), el('entrance', 'point', pt(18, 13))];
    expect(pickStartPoint(els, floor, pt(17, 3))).toEqual(pt(18, 13));
    expect(pickStartPoint(els, floor, pt(3, 3))).toEqual(pt(2, 13));
  });

  it('falls back to exit, then the front edge midpoint', () => {
    expect(pickStartPoint([el('exit', 'point', pt(19, 7))], floor, pt(5, 5))).toEqual(pt(19, 7));
    expect(pickStartPoint([], floor, pt(5, 5))).toEqual(pt(10, 13));
  });
});
