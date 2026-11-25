/** Tests for the core mapping math — the part that must never break. */
import { describe, it, expect } from 'vitest';
import {
  fitViewport, screenToWorld, worldToScreen, rectCorners, elementContains,
  translateElement, resizeRect, handleCursor, snap, bboxOf, shelfAnchor,
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

  it('keeps a fitted map clear of reserved edges and centres it in what remains', () => {
    // a portrait phone: the top bar over the map, controls along the bottom
    const v = fitViewport(96, 62, 390, 844, 12, { top: 118, bottom: 90 });
    const c1 = worldToScreen({ x: 0, y: 0 }, v);
    const c2 = worldToScreen({ x: 96, y: 62 }, v);
    expect(c1.x).toBeGreaterThanOrEqual(12 - 1e-9);
    expect(c2.x).toBeLessThanOrEqual(390 - 12 + 1e-9);
    expect(c1.y).toBeGreaterThanOrEqual(118 + 1e-9);
    expect(c2.y).toBeLessThanOrEqual(844 - 90 + 1e-9);
    expect(c1.y - 118).toBeCloseTo(844 - 90 - c2.y); // top air = bottom air
  });

  it('fits exactly as before when no edge is reserved', () => {
    expect(fitViewport(40, 30, 800, 600, 40, {})).toEqual(fitViewport(40, 30, 800, 600));
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

  it('resizeRect at rot=90 changes one dimension and keeps the far edge world-fixed', () => {
    // 4×2 shelf rotated 90°: local west edge faces world-up, local east edge world-down
    const r = { x: 0, y: 0, w: 4, h: 2, rot: 90 };
    const before = rectCorners(r);
    const out = resizeRect(r, 'w', { x: 2, y: -2 });
    expect(out.w).toBeCloseTo(5); // only the dragged dimension grew
    expect(out.h).toBeCloseTo(2);
    const after = rectCorners(out);
    // the dragged (west→world top) edge now sits under the cursor at y=-2
    expect(Math.min(...after.map((p) => p.y))).toBeCloseTo(-2);
    // the opposite (east→world bottom) edge did not move
    const bottomBefore = Math.max(...before.map((p) => p.y));
    const bottomAfter = Math.max(...after.map((p) => p.y));
    expect(bottomAfter).toBeCloseTo(bottomBefore);
    expect(out.rot).toBe(90);
  });

  it('resizeRect at rot=45 pins the opposite corner under the cursor', () => {
    const r = { x: 2, y: 2, w: 4, h: 2, rot: 45 };
    const before = rectCorners(r);
    // dragging 'nw' — the SE corner must stay exactly put
    const out = resizeRect(r, 'nw', { x: 0, y: 1 });
    const after = rectCorners(out);
    const seBefore = before[2]; // rectCorners: CW from local top-left → [TL, TR, BR, BL]
    const seAfter = after[2];
    expect(seAfter.x).toBeCloseTo(seBefore.x);
    expect(seAfter.y).toBeCloseTo(seBefore.y);
    // and every corner still respects min size (up to float epsilon in the clamp)
    expect(out.w).toBeGreaterThanOrEqual(0.29);
    expect(out.h).toBeGreaterThanOrEqual(0.29);
  });

  it('resizeRect at rot=0 keeps prior behavior (se drag grows both dims)', () => {
    const r = { x: 1, y: 1, w: 2, h: 2, rot: 0 };
    const out = resizeRect(r, 'se', { x: 5, y: 4 });
    expect(out.x).toBeCloseTo(1);
    expect(out.y).toBeCloseTo(1);
    expect(out.w).toBeCloseTo(4);
    expect(out.h).toBeCloseTo(3);
  });
});

describe('handleCursor', () => {
  it('unrotated handles use the classic directions', () => {
    expect(handleCursor('w', 0)).toBe('ew-resize');
    expect(handleCursor('n', 0)).toBe('ns-resize');
    expect(handleCursor('nw', 0)).toBe('nwse-resize');
    expect(handleCursor('ne', 0)).toBe('nesw-resize');
  });

  it('rotated handles swap to match the on-screen drag axis', () => {
    expect(handleCursor('w', 90)).toBe('ns-resize'); // top edge of a 90° shelf
    expect(handleCursor('n', 90)).toBe('ew-resize');
    expect(handleCursor('nw', 90)).toBe('nesw-resize');
    expect(handleCursor('w', 45)).toBe('nwse-resize');
    expect(handleCursor('w', 180)).toBe('ew-resize');
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
