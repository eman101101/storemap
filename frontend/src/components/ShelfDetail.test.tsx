/** Component tests: shelf detail modal, CSV-free unit paths of the types module. */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ShelfDetail from './ShelfDetail';
import { parseElement, elementToRow, isRect, isPoint, isPoly } from '../types';
import type { MapElementRow, Product, ProductLocation } from '../types';

const row: MapElementRow = {
  id: 'shelf-1', floor_id: 'f1', type: 'shelf', shape: 'rect',
  geometry: JSON.stringify({ x: 0, y: 0, w: 5, h: 1, rot: 0 }),
  label: 'Aisle 1', color: '', meta: JSON.stringify({ bays: 2, levels: 2 }), z_index: 0,
};

const product = (id: string, name: string): Product => ({
  id, store_id: 's', category_id: null, name, brand: '', sku: '', barcode: '',
  description: '', price: 1.5, image_url: '',
});

const pin = (id: string, productId: string, x: number, y: number) =>
  ({ id, product_id: productId, floor_id: 'f1', x, y, rot: 0, meta: '{}' }) as ProductLocation;

describe('types helpers', () => {
  it('parses and serialises element geometry losslessly', () => {
    const el = parseElement(row);
    expect(isRect(el.geom)).toBe(true);
    expect(elementToRow(el).geometry).toBe(row.geometry);
    const pt = parseElement({ ...row, shape: 'point', geometry: '{"x":1,"y":2}' });
    expect(isPoint(pt.geom)).toBe(true);
    expect(isRect(pt.geom)).toBe(false);
    const poly = parseElement({ ...row, shape: 'polygon', geometry: '[[0,0],[1,1]]' });
    expect(isPoly(poly.geom)).toBe(true);
  });

  it('survives corrupt geometry', () => {
    const el = parseElement({ ...row, geometry: 'not json' });
    expect(el.geom).toEqual({ x: 0, y: 0 });
  });
});

describe('ShelfDetail', () => {
  it('renders the shelf with bays, levels and product facings', () => {
    const shelf = parseElement(row);
    const pins = [
      { location: pin('l1', 'p1', 0.5, 0.5), product: product('p1', 'Oat Milk') },
      { location: pin('l2', 'p2', 4, 0.5), product: product('p2', 'Rye Bread') },
    ];
    render(<ShelfDetail shelf={shelf} pins={pins} onClose={() => {}} />);
    expect(screen.getByRole('dialog')).toHaveTextContent('Aisle 1 — shelf layout');
    expect(screen.getByRole('dialog')).toHaveTextContent('2 bays × 2 levels');
    expect(screen.getByRole('dialog')).toHaveTextContent('Bay 1: Oat Milk');
    expect(screen.getByRole('dialog')).toHaveTextContent('Bay 2: Rye Bread');
  });

  it('closing via Escape works', () => {
    const shelf = parseElement(row);
    let closed = false;
    render(<ShelfDetail shelf={shelf} pins={[]} onClose={() => (closed = true)} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(closed).toBe(true);
  });

  it('clicking a facing invokes onPickProduct', () => {
    const shelf = parseElement(row);
    let picked: string | null = null;
    const { container } = render(
      <ShelfDetail
        shelf={shelf}
        pins={[{ location: pin('l1', 'p1', 1, 0.5), product: product('p1', 'Choc Bar') }]}
        onClose={() => {}}
        onPickProduct={(p) => (picked = p.id)}
      />
    );
    fireEvent.click(container.querySelector('g[style*="cursor"]')!);
    expect(picked).toBe('p1');
  });
});
