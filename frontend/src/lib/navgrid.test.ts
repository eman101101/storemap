/** Tests for store wayfinding — nav grid, A*, and route assembly. */
import { describe, it, expect } from 'vitest';
import type { Floor, MapElement } from '../types';
import {
  buildNavGrid, isBlocked, cellCenter, nearestOpen, astar,
  simplifyPath, pathLengthM, computeRoute, computeTrip, pickStartPoint, standingPoint, canStand,
  segmentsIntersect, pointElementDistance, segmentElementDistance, segmentClear,
  type NavGrid,
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

/**
 * Every hop of a route keeps the full clearance of every wall and shelf,
 * measured exactly (segment against fixture) — not just at the cell centres
 * the grid knows about. One exception: the hop leaving a door marker is
 * excused the clearance of a WALL the marker itself sits inside (it starts
 * in that wall's buffer) — never of a shelf.
 */
function expectRouteClean(g: NavGrid, points: { x: number; y: number }[], doorHops = 1) {
  expect(points.length).toBeGreaterThan(1);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    for (const { el: fixture } of g.obstacles) {
      const d = segmentElementDistance(fixture, a, b);
      const hop = `hop ${i} (${a.x.toFixed(2)},${a.y.toFixed(2)})→(${b.x.toFixed(2)},${b.y.toFixed(2)})`;
      const inWall = i <= doorHops && fixture.type === 'wall' && pointElementDistance(fixture, a) < g.clearance;
      if (inWall) expect(d, `${hop} runs through the door's own wall`).toBeGreaterThan(0.12);
      else expect(d, `${hop} clips the clearance of a fixture`).toBeGreaterThanOrEqual(g.clearance - 1e-6);
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

  it('lists only the walls and shelves as obstacles', () => {
    const g = buildNavGrid(floor, [
      el('shelf', 'rect', rect(5, 5, 2, 1)),
      el('wall', 'polyline', [[0, 0], [20, 0]]),
      el('zone', 'rect', rect(0, 0, 20, 14)),
      el('entrance', 'point', pt(10, 13)),
    ]);
    expect(g.obstacles.map((o) => o.el.type)).toEqual(['shelf', 'wall']);
    expect(g.clearance).toBe(0.3);
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
    const route = computeRoute(floor, els, pt(10, 2))!;
    expect(route).not.toBeNull();
    expect(route.points[0]).toEqual(pt(10, 13));
    // straight line is 11 m; a detour around the 12 m shelf must be longer
    expect(route.distanceM).toBeGreaterThan(12.5);
    expectClearOf(route.points, { x: 4, y: 4, w: 12, h: 3 }, 0.29);
    expectRouteClean(buildNavGrid(floor, els), route.points);
  });

  it('goes straight when the floor is empty', () => {
    const route = computeRoute(floor, [el('entrance', 'point', pt(10, 13))], pt(10, 3))!;
    expect(route).not.toBeNull();
    expect(route.distanceM).toBeLessThan(11);
    expect(route.points.length).toBeLessThanOrEqual(3);
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

  it('simplification keeps endpoints, cuts points, and stays clear of fixtures', () => {
    const shelf = el('shelf', 'rect', rect(4, 4, 12, 3));
    const g = buildNavGrid(floor, [shelf]);
    const raw = astar(g, pt(10, 13), pt(10, 2))!;
    const simple = simplifyPath(g, raw);
    expect(simple.length).toBeLessThan(raw.length);
    expect(simple[0]).toEqual(raw[0]);
    for (let i = 1; i < simple.length; i++) expect(segmentClear(g, simple[i - 1], simple[i])).toBe(true);
    expect(pathLengthM(simple)).toBeLessThanOrEqual(pathLengthM(raw) + 1e-9);
  });

  it('lands the route on the requested goal, not a snapped cell', () => {
    const route = computeRoute(floor, [], pt(7.31, 3.27))!;
    expect(route.points[route.points.length - 1]).toEqual(pt(7.31, 3.27));
    expect(route.stand).toEqual(pt(7.31, 3.27));
  });
});

/* ── the route ends in the aisle, never on the shelf ──────────────────────
   A product pin — and every seeded group pin — sits ON its shelf, in the
   middle of it. Routing up to the pin walked the last leg straight through
   the shelf. */

describe('standing point', () => {
  it('a pin in the middle of a shelf is met from the aisle in front of it', () => {
    const shelf = el('shelf', 'rect', rect(5, 5, 2, 1));
    const g = buildNavGrid(floor, [shelf]);
    const stand = standingPoint(g, pt(6, 5.5), pt(10, 13));
    // one clearance off the bottom face, square with the pin
    expect(stand.point.y).toBeCloseTo(6.3, 9);
    expect(Math.abs(stand.point.x - 6)).toBeLessThanOrEqual(0.125 + 1e-9); // within half a cell
    expect(stand.ny).toBe(1);
    expect(canStand(g, stand.point)).toBe(true);
    expect(pointElementDistance(shelf, stand.point)).toBeCloseTo(0.3, 9);
  });

  it('picks the face the shopper arrives from when both are as near', () => {
    const g = buildNavGrid(floor, [el('shelf', 'rect', rect(4, 4, 12, 3))]);
    expect(standingPoint(g, pt(10, 5.5), pt(10, 13)).point.y).toBeCloseTo(7.3, 9); // from below
    expect(standingPoint(g, pt(10, 5.5), pt(10, 1)).point.y).toBeCloseTo(3.7, 9); // from above
  });

  it('a shelf with its back to the wall is met from the aisle side', () => {
    const shelf = el('shelf', 'rect', rect(4, 0.3, 12, 1.4)); // 30 cm gap to the top edge of the slab
    const g = buildNavGrid(floor, [shelf]);
    const stand = standingPoint(g, pt(10, 1));
    expect(stand.point.y).toBeCloseTo(2.0, 9);
    expect(stand.point.y).toBeGreaterThan(1.7);
  });

  it('a gap too narrow to stand in is skipped for the open side', () => {
    const shelves = [el('shelf', 'rect', rect(4, 5, 6, 1)), el('shelf', 'rect', rect(4, 6.4, 6, 1))]; // 40 cm apart
    const g = buildNavGrid(floor, shelves);
    const stand = standingPoint(g, pt(7, 6), pt(7, 13)); // on the lower face of the top shelf
    const y = stand.point.y;
    const inGap = y > 5.9 && y < 6.5;
    expect(inGap).toBe(false);
    for (const s of shelves) expect(pointElementDistance(s, stand.point)).toBeGreaterThanOrEqual(0.3 - 1e-6);
  });

  it('works on a rotated shelf', () => {
    const shelf = el('shelf', 'rect', { x: 7, y: 7.4, w: 6, h: 1.2, rot: 30 });
    const g = buildNavGrid(floor, [shelf]);
    const stand = standingPoint(g, pt(10, 8), pt(10, 13));
    expect(canStand(g, stand.point)).toBe(true);
    expect(pointElementDistance(shelf, stand.point)).toBeCloseTo(0.3, 9);
    // half the 1.2 m depth + the clearance
    expect(Math.hypot(stand.point.x - 10, stand.point.y - 8)).toBeCloseTo(0.9, 9);
  });

  it('a goal already in open floor is its own standing point', () => {
    const stand = standingPoint(buildNavGrid(floor, [el('shelf', 'rect', rect(5, 5, 2, 1))]), pt(6, 10));
    expect(stand).toEqual({ point: pt(6, 10), nx: 0, ny: 0 });
  });
});

describe('route assembly', () => {
  it('ends one clearance in front of the shelf, never inside it', () => {
    const shelf = el('shelf', 'rect', rect(5, 5, 2, 1));
    const els = [el('entrance', 'point', pt(10, 13)), shelf];
    const route = computeRoute(floor, els, pt(6, 5.5))!;
    const end = route.points[route.points.length - 1];
    expect(end).toEqual(route.stand);
    expect(end.y).toBeCloseTo(6.3, 9);
    expect(pointElementDistance(shelf, end)).toBeCloseTo(0.3, 9);
    expectRouteClean(buildNavGrid(floor, els), route.points);
  });

  it('rounds shelf corners at the full clearance instead of clipping them', () => {
    const els = [
      el('entrance', 'point', pt(18, 13)),
      el('shelf', 'rect', rect(3, 3, 6, 1.2)),
      el('shelf', 'rect', rect(11, 6, 6, 1.2)),
      el('shelf', 'rect', rect(3, 9, 6, 1.2)),
    ];
    const g = buildNavGrid(floor, els);
    const route = computeRoute(floor, els, pt(2, 13.5), {}, g)!;
    expect(route).not.toBeNull();
    expectRouteClean(g, route.points);
    // and it is still a route: longer than the straight line, far shorter than the raw cell path
    expect(route.distanceM).toBeGreaterThan(16);
    expect(route.points.length).toBeLessThan(12);
  });

  it('starts exactly at the door marker and goes around a shelf behind the door', () => {
    const els = [
      el('entrance', 'point', pt(10, 13.9)),
      el('wall', 'rect', rect(0, 13.8, 8.5, 0.2)),
      el('wall', 'rect', rect(11.5, 13.8, 8.5, 0.2)),
      el('shelf', 'rect', rect(8, 11, 4, 1)), // right in the doorway's path
    ];
    const g = buildNavGrid(floor, els);
    const route = computeRoute(floor, els, pt(10, 4), {}, g)!;
    expect(route.points[0]).toEqual(pt(10, 13.9));
    expectRouteClean(g, route.points);
    expect(route.distanceM).toBeGreaterThan(11);
  });

  it('a door marker drawn on its wall line still rounds shelves at the full clearance', () => {
    // the seeded maps draw one wall polyline across the doorways, with the
    // entrance marker just inside it — the route starts in the wall's buffer
    const els = [
      el('entrance', 'point', pt(10, 13.7)),
      el('wall', 'polyline', [[0, 13.9], [20, 13.9]]),
      el('shelf', 'rect', rect(7, 10, 6, 1.4)),
    ];
    const g = buildNavGrid(floor, els);
    const route = computeRoute(floor, els, pt(10, 4), {}, g)!;
    expect(route.points[0]).toEqual(pt(10, 13.7));
    expectRouteClean(g, route.points);
    // the shelf in front of the door is met with a whole clearance, not the wall's excuse
    const shelf = g.obstacles.find((o) => o.el.type === 'shelf')!.el;
    expect(segmentElementDistance(shelf, route.points[0], route.points[1])).toBeGreaterThanOrEqual(0.3 - 1e-6);
  });
});

describe('multi-stop trip', () => {
  const els = [
    el('entrance', 'point', pt(10, 13)),
    el('shelf', 'rect', rect(3, 4, 5, 1.2)),
    el('shelf', 'rect', rect(12, 4, 5, 1.2)),
    el('shelf', 'rect', rect(3, 9, 5, 1.2)),
  ];
  const stop = (id: string, name: string, x: number, y: number) => ({ productId: id, name, point: pt(x, y) });

  it('joins its legs end to end, each ending in the aisle in front of its pin', () => {
    const g = buildNavGrid(floor, els);
    const trip = computeTrip(floor, els, [stop('a', 'A', 5.5, 4.6), stop('b', 'B', 14.5, 4.6), stop('c', 'C', 5.5, 9.6)], {}, g)!;
    expect(trip).not.toBeNull();
    expect(trip.legs).toHaveLength(3);
    expect(trip.legs[0][0]).toEqual(pt(10, 13));
    for (let k = 0; k < trip.legs.length; k++) {
      const leg = trip.legs[k];
      if (k > 0) expect(leg[0]).toEqual(trip.legs[k - 1][trip.legs[k - 1].length - 1]);
      expectRouteClean(g, leg, k === 0 ? 1 : 0);
      const end = leg[leg.length - 1];
      for (const { el: fixture } of g.obstacles) {
        if (fixture.type === 'shelf') expect(pointElementDistance(fixture, end)).toBeGreaterThanOrEqual(0.3 - 1e-6);
      }
    }
    // the stop list keeps the pins themselves for the map markers
    // nearest first: C is the stop closest to the door
    expect(trip.order.map((s) => s.name)).toEqual(['C', 'A', 'B']);
    expect(trip.order[0].point).toEqual(pt(5.5, 9.6));
  });
});

describe('exact clearance geometry', () => {
  const shelf = el('shelf', 'rect', rect(4, 4, 4, 2));

  it('measures point to fixture, 0 inside', () => {
    expect(pointElementDistance(shelf, pt(6, 5))).toBe(0);
    expect(pointElementDistance(shelf, pt(6, 7.5))).toBeCloseTo(1.5, 9);
    expect(pointElementDistance(shelf, pt(2, 2))).toBeCloseTo(Math.SQRT2 * 2, 9); // off the corner
  });

  it('measures segment to fixture: crossing, passing and touching', () => {
    expect(segmentElementDistance(shelf, pt(2, 5), pt(10, 5))).toBe(0); // straight through
    expect(segmentElementDistance(shelf, pt(2, 3), pt(10, 3))).toBeCloseTo(1, 9); // one metre above
    expect(segmentElementDistance(shelf, pt(0, 5), pt(3, 5))).toBeCloseTo(1, 9); // stops a metre short of the face
    expect(segmentElementDistance(shelf, pt(0, 3.5), pt(3, 3.5))).toBeCloseTo(Math.hypot(1, 0.5), 9); // nearest is the corner
    expect(segmentElementDistance(shelf, pt(4, 4), pt(0, 0))).toBe(0); // starts on the corner
  });

  it('follows a rotated rectangle', () => {
    const turned = el('shelf', 'rect', { x: 8, y: 6, w: 4, h: 2, rot: 90 }); // now 2 wide, 4 tall, centred on (10, 7)
    expect(pointElementDistance(turned, pt(10, 7))).toBe(0);
    expect(pointElementDistance(turned, pt(12.5, 7))).toBeCloseTo(1.5, 9);
    expect(segmentElementDistance(turned, pt(9, 4), pt(9, 10))).toBe(0);
    expect(segmentElementDistance(turned, pt(9.2, 4), pt(9.2, 10))).toBe(0); // runs through the middle
    expect(segmentElementDistance(turned, pt(8.8, 4), pt(8.8, 10))).toBeCloseTo(0.2, 9);
  });

  it('follows polyline walls and polygon rooms', () => {
    const wall = el('wall', 'polyline', [[0, 7], [20, 7]]);
    expect(pointElementDistance(wall, pt(5, 7.4))).toBeCloseTo(0.4, 9);
    expect(segmentElementDistance(wall, pt(5, 2), pt(5, 12))).toBe(0);
    expect(segmentElementDistance(wall, pt(5, 2), pt(15, 2))).toBeCloseTo(5, 9);
    const room = el('wall', 'polygon', [[8, 2], [12, 2], [12, 6], [8, 6]]);
    // a run entirely inside the room touches no edge, yet it is inside the wall
    expect(segmentElementDistance(room, pt(9, 3), pt(11, 5))).toBe(0);
    expect(segmentElementDistance(room, pt(9, 0), pt(11, 1))).toBeCloseTo(1, 9);
  });

  it('segment intersection: crossing, touching, collinear overlap, apart', () => {
    expect(segmentsIntersect(pt(0, 0), pt(4, 4), pt(0, 4), pt(4, 0))).toBe(true);
    expect(segmentsIntersect(pt(0, 0), pt(4, 0), pt(2, -2), pt(2, 0))).toBe(true); // endpoint on the other
    expect(segmentsIntersect(pt(0, 0), pt(4, 0), pt(2, 0), pt(6, 0))).toBe(true); // overlap
    expect(segmentsIntersect(pt(0, 0), pt(4, 0), pt(2, 1), pt(2, 5))).toBe(false);
    expect(segmentsIntersect(pt(0, 0), pt(4, 0), pt(5, 0), pt(6, 0))).toBe(false); // collinear, apart
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
