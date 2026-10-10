/** Tests for the shelf planogram computation (tap-a-shelf → real layout). */
import { describe, it, expect } from 'vitest';
import { computeShelfLayout, pinInShelf, worldToShelfLocal } from './shelfLayout';
import type { MapElement, Product, ProductLocation, RectGeom } from '../types';

const shelf: MapElement = {
  id: 'shelf-1', floor_id: 'f1', type: 'shelf', shape: 'rect', label: 'Aisle 1 · Dairy',
  color: '', meta: '{}', z_index: 0,
  geom: { x: 0, y: 0, w: 5, h: 1, rot: 0 },
};

function product(id: string, name: string): Product {
  return {
    id, store_id: 's', category_id: null, name, brand: '', sku: '', barcode: '',
    description: '', price: null, image_url: '',
  };
}

function pin(x: number, y: number, productId: string, meta = '{}'): { location: ProductLocation; product: Product } {
  return { location: { id: `loc-${productId}`, product_id: productId, floor_id: 'f1', x, y, rot: 0, meta }, product: product(productId, `Product ${productId}`) };
}

describe('computeShelfLayout', () => {
  it('assigns pins to bays by their position along the shelf', () => {
    const layout = computeShelfLayout(shelf, [pin(0.5, 0.5, 'a'), pin(4.5, 0.5, 'b'), pin(2.5, 0.5, 'c')])!;
    expect(layout).not.toBeNull();
    expect(layout.bays.length).toBe(4); // 5m shelf defaults to 1.25m bays
    expect(layout.bays[0].slots.map((s) => s.product.id)).toEqual(['a']);
    expect(layout.bays[2].slots.map((s) => s.product.id)).toEqual(['c']);
    expect(layout.bays[3].slots.map((s) => s.product.id)).toEqual(['b']);
  });

  it('sorts slots left-to-right inside a bay', () => {
    const layout = computeShelfLayout(shelf, [pin(2.4, 0.5, 'late'), pin(2.1, 0.5, 'early')])!;
    expect(layout.bays[1].slots.map((s) => s.product.id)).toEqual(['early', 'late']);
  });

  it('respects meta bays/levels and explicit shelf_level on the pin', () => {
    const s: MapElement = { ...shelf, meta: JSON.stringify({ bays: 2, levels: 3 }) };
    const layout = computeShelfLayout(s, [
      pin(1, 0.5, 'top', '{"shelf_level":3}'),
      pin(3.5, 0.5, 'bottom'),
    ])!;
    expect(layout.meta).toEqual({ bays: 2, levels: 3 });
    expect(layout.bays[0].slots[0].level).toBe(3);
    expect(layout.bays[1].slots[0].level).toBe(1);
  });

  it('maps pins on deep shelves to levels by depth', () => {
    const deep: MapElement = { ...shelf, meta: JSON.stringify({ levels: 2 }), geom: { x: 0, y: 0, w: 5, h: 2, rot: 0 } };
    const layout = computeShelfLayout(deep, [pin(1, 0.2, 'front'), pin(3, 1.8, 'back')])!;
    const levels = layout.bays.flatMap((b) => b.slots.map((s) => [s.product.id, s.level]));
    expect(levels).toContainEqual(['front', 2]);
    expect(levels).toContainEqual(['back', 1]);
  });

  it('classifies pins outside the shelf footprint', () => {
    const layout = computeShelfLayout(shelf, [pin(10, 10, 'far')])!;
    expect(layout.bays.every((b) => b.slots.length === 0)).toBe(true);
    expect(layout.outside.map((p) => p.product.id)).toEqual(['far']);
  });

  it('handles rotated shelves using their local frame', () => {
    const rotated: MapElement = { ...shelf, geom: { x: 0, y: 0, w: 5, h: 1, rot: 90 } };
    // rotating 90° around centre (2.5, 0.5): local left end is at world (2.5, -2)
    expect(worldToShelfLocal(rotated.geom as RectGeom, { x: 2.5, y: -2 }).x).toBeCloseTo(0);
    const layout = computeShelfLayout(rotated, [pin(2.5, -2, 'left-end'), pin(2.5, 3, 'right-end')])!;
    expect(layout.bays[0].slots.map((s) => s.product.id)).toEqual(['left-end']);
    expect(layout.bays[3].slots.map((s) => s.product.id)).toEqual(['right-end']);
  });

  it('returns null for non-rect shelves', () => {
    expect(computeShelfLayout({ ...shelf, shape: 'polygon', geom: [[0, 0], [1, 0], [1, 1]] }, [])).toBeNull();
  });

  it('pinInShelf honours tolerance', () => {
    expect(pinInShelf(shelf, pin(5.2, 0.5, 'x'))).toBe(true);
    expect(pinInShelf(shelf, pin(50, 0.5, 'x'))).toBe(false);
  });

  it('clamps absurd meta values', () => {
    const s: MapElement = { ...shelf, meta: JSON.stringify({ bays: 9999, levels: -4, facing: 50 }) };
    const layout = computeShelfLayout(s, [])!;
    expect(layout.meta.bays).toBeLessThanOrEqual(40);
    expect(layout.meta.levels).toBeGreaterThanOrEqual(1);
  });
});
