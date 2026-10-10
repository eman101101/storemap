/** Tests for the core mapping math — the part that must never break. */
import { describe, it, expect } from 'vitest';
import {
  fitViewport, screenToWorld, worldToScreen, rectCorners, elementContains,
  translateElement, resizeRect, snap, bboxOf, shelfAnchor,
} from './geometry';
import type { MapElement } from '../types';

const vp = { scale: 10, tx: 100, ty: 50 };

describe('coordinate transforms', () => {
  it('round-trips screen ↔ world', () => {
    const screen = { x: 250, y: 180 };
    const world = screenToWorld(screen.x, screen.y, vp);
    const back = worldToScreen(world, vp);
    expect(back.x).toBeCloseTo(screen.x);
    expect(back.y).toBeCloseTo(screen.y);
    expect(world).toEqual({ x: 15, y: 13 });
  });

  it('fits a floor inside a viewport with padding', () => {
    const v = fitViewport(40, 30, 800, 600);
    expect(v.scale).toBeGreaterThan(0);
    // corners of the floor land inside the viewport
    const c1 = worldToScreen({ x: 0, y: 0 }, v);
    const c2 = worldToScreen({ x: 40, y: 30 }, v);
    expect(c1.x).toBeGreaterThanOrEqual(0);
    expect(c1.y).toBeGreaterThanOrEqual(0);
    expect(c2.x).toBeLessThanOrEqual(800);
    expect(c2.y).toBeLessThanOrEqual(600);
  });

  it('snaps to the grid', () => {
    expect(snap(2.3, 0.5)).toBeCloseTo(2.5);
    expect(snap(2.3, null)).toBe(2.3);
  });
});

describe('rect geometry', () => {
  it('corners of an axis-aligned rect', () => {
    const corners = rectCorners({ x: 0, y: 0, w: 4, h: 2, rot: 0 });
    expect(corners).toEqual([
      { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }, { x: 0, y: 2 },
    ]);
  });

  it('rotating 90° around the center swaps width and height', () => {
    const corners = rectCorners({ x: 0, y: 0, w: 4, h: 2, rot: 90 });
    const bb = bboxOf(corners);
    expect(bb.maxX - bb.minX).toBeCloseTo(2);
    expect(bb.maxY - bb.minY).toBeCloseTo(4);
  });
});

describe('elementContains (hit testing)', () => {
  const shelf: MapElement = {
    id: 's1', floor_id: 'f1', type: 'shelf', shape: 'rect', label: '',
    color: '', meta: '{}', z_index: 0,
    geom: { x: 4, y: 5, w: 4, h: 1.2, rot: 0 },
  };

  it('contains points inside, rejects outside', () => {
    expect(elementContains(shelf, { x: 5, y: 5.5 })).toBe(true);
    expect(elementContains(shelf, { x: 50, y: 50 })).toBe(false);
  });

  it('handles rotated rects', () => {
    const rotated: MapElement = { ...shelf, geom: { x: 4, y: 5, w: 4, h: 1.2, rot: 90 } };
    // rotation around the centre: the rect's long axis becomes vertical
    expect(elementContains(rotated, { x: 6, y: 7.5 })).toBe(true);
    expect(elementContains(rotated, { x: 4.5, y: 5.2 })).toBe(false);
  });

  it('tolerates edge hits for polylines and polygons', () => {
    const line: MapElement = {
      ...shelf, type: 'aisle', shape: 'polyline', geom: [[0, 0], [10, 0]],
    };
    expect(elementContains(line, { x: 5, y: 0.1 })).toBe(true);
    expect(elementContains(line, { x: 5, y: 3 })).toBe(false);
    const tri: MapElement = { ...shelf, type: 'zone', shape: 'polygon', geom: [[0, 0], [4, 0], [0, 4]] };
    expect(elementContains(tri, { x: 0.5, y: 0.5 })).toBe(true);
    expect(elementContains(tri, { x: 3.5, y: 3.5 })).toBe(false);
  });
});

describe('editing operations', () => {
  it('translates rects and points', () => {
    const shelf: MapElement = {
      id: 's', floor_id: 'f', type: 'shelf', shape: 'rect', label: '', color: '', meta: '{}', z_index: 0,
      geom: { x: 1, y: 2, w: 3, h: 1, rot: 0 },
    };
    const moved = translateElement(shelf, 0.5, -1) as typeof shelf;
    expect(moved.geom).toEqual({ x: 1.5, y: 1, w: 3, h: 1, rot: 0 });
  });

  it('resizeRect never inverts the rect', () => {
    const r = { x: 0, y: 0, w: 2, h: 2, rot: 0 };
    const small = resizeRect(r, 'se', { x: 0.1, y: 0.1 });
    expect(small.w).toBeGreaterThanOrEqual(0.3);
    expect(small.h).toBeGreaterThanOrEqual(0.3);
    const grown = resizeRect(r, 'nw', { x: -1, y: -1 });
    expect(grown.w).toBeCloseTo(3);
  });
});

describe('shelfAnchor', () => {
  const els = [
    { id: 'a', floor_id: 'f', type: 'shelf', shape: 'rect', geom: { x: 5, y: 5, w: 10, h: 1, rot: 0 }, label: '', color: '', meta: '', z_index: 1 },
  ] as never[];

  it('snaps a mid-shelf pin to the nearest edge point', () => {
    const a = shelfAnchor({ x: 8, y: 5.5 }, els)!;
    expect(a.y).toBeCloseTo(5); // north edge line
    expect(a.x).toBeCloseTo(8);
  });

  it('snaps a pin just off the shelf face onto the outline', () => {
    const a = shelfAnchor({ x: 10, y: 6.4 }, els)!;
    expect(a.y).toBeCloseTo(6);
    expect(a.x).toBeCloseTo(10);
  });

  it('returns null far from any shelf', () => {
    expect(shelfAnchor({ x: 8, y: 12 }, els)).toBeNull();
  });
});
