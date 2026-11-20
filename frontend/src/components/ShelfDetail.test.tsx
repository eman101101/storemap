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
  description: '', price: 1.5, image_url: '', image_crop_url: '',
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
    const { container } = render(<ShelfDetail shelf={shelf} pins={pins} onClose={() => {}} />);
    expect(screen.getByRole('dialog')).toHaveTextContent('Aisle 1 — planogram');
    expect(screen.getByRole('dialog')).toHaveTextContent('2 bays × 2 rows');
    expect(screen.getByRole('dialog')).toHaveTextContent('Bay 1: Oat Milk');
    expect(screen.getByRole('dialog')).toHaveTextContent('Bay 2: Rye Bread');
    // fixtures have no photos → schematic view with no view toggle
    expect(screen.queryByRole('button', { name: 'Photos' })).toBeNull();
    expect(container!.querySelectorAll('image')).toHaveLength(0);
  });

  it('closing via Escape works', () => {
    const shelf = parseElement(row);
    let closed = false;
    render(<ShelfDetail shelf={shelf} pins={[]} onClose={() => (closed = true)} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(closed).toBe(true);
  });

  it('clicking a facing selects it and the bottom panel shows its details; onPickProduct fires from "Show on map"', () => {
    const shelf = parseElement(row);
    let picked: string | null = null;
    let listed: string | null = null;
    const { container } = render(
      <ShelfDetail
        shelf={shelf}
        pins={[{ location: pin('l1', 'p1', 1, 0.5), product: product('p1', 'Choc Bar') }]}
        onClose={() => {}}
        onPickProduct={(p) => (picked = p.id)}
        onAddToList={(p) => (listed = p.id)}
      />
    );
    // the click selects — it no longer jumps straight out to the map
    fireEvent.click(container.querySelector('g[style*="cursor"]')!);
    expect(picked).toBeNull();
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('Choc Bar');
    expect(dialog.textContent).toContain('$1.50');
    expect(dialog.textContent).toContain('Bay 1 · Row 1');
    // panel actions keep their old semantics
    fireEvent.click(screen.getByRole('button', { name: /Add to list/ }));
    expect(listed).toBe('p1');
    fireEvent.click(screen.getByRole('button', { name: /Show on map/ }));
    expect(picked).toBe('p1');
  });

  it('persists the image view: full-bleed cover images, no label strip', () => {
    const imageShelf = parseElement({ ...row, meta: JSON.stringify({ bays: 2, levels: 2, planogramView: 'images' }) });
    const withPhoto = { ...product('p1', 'Oat Milk'), image_url: 'data:image/png;base64,abc' };
    const { container } = render(
      <ShelfDetail
        shelf={imageShelf}
        pins={[{ location: pin('l1', 'p1', 1, 0.5), product: withPhoto }]}
        onClose={() => {}}
      />
    );
    const images = container.querySelectorAll('image');
    expect(images).toHaveLength(1);
    expect(images[0]!.getAttribute('preserveAspectRatio')).toBe('xMidYMid slice');
    // image tiles carry no <text> — details moved to the bottom panel
    expect(container.querySelectorAll('text')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Image' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('degrades a stored image/photos default to the diagram when nothing has a photo', () => {
    const imageShelf = parseElement({ ...row, meta: JSON.stringify({ bays: 2, levels: 2, planogramView: 'images' }) });
    const { container } = render(
      <ShelfDetail
        shelf={imageShelf}
        pins={[{ location: pin('l1', 'p1', 1, 0.5), product: product('p1', 'Choc Bar') }]}
        onClose={() => {}}
      />
    );
    expect(container.querySelectorAll('image')).toHaveLength(0);
    expect(container.querySelector('rect[fill-opacity="0.16"]')).toBeTruthy();
    // no photos → the view toggle isn't offered at all on this shelf
    expect(screen.queryByRole('button', { name: 'Image' })).toBeNull();
  });

  it('draws the pulsing highlight border around the searched facing', () => {
    const shelf = parseElement(row);
    const withPhoto = { ...product('p1', 'Oat Milk'), image_url: 'data:image/png;base64,abc' };
    const { container } = render(
      <ShelfDetail
        shelf={shelf}
        pins={[{ location: pin('l1', 'p1', 1, 0.5), product: withPhoto }]}
        onClose={() => {}}
        highlightLocationId="l1"
      />
    );
    expect(container.querySelector('.facing-highlight')).toBeTruthy();
    // and nothing is highlighted when the focused pin is on another shelf
    const { container: plain } = render(
      <ShelfDetail
        shelf={shelf}
        pins={[{ location: pin('l1', 'p1', 1, 0.5), product: withPhoto }]}
        onClose={() => {}}
      />
    );
    expect(plain.querySelector('.facing-highlight')).toBeNull();
  });

  it('editor: switching the view toggle persists the choice via onViewModeChange', () => {
    const shelf = parseElement(row);
    let stored: string | null = null;
    render(
      <ShelfDetail
        shelf={shelf}
        pins={[]}
        onClose={() => {}}
        editing
        onViewModeChange={(m) => (stored = m)}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Image' }));
    expect(stored).toBe('images');
    fireEvent.click(screen.getByRole('button', { name: 'Diagram' }));
    expect(stored).toBe('diagram');
  });

  it('defaults to the photo planogram when products carry images', () => {
    const shelf = parseElement(row);
    const withPhoto = { ...product('p1', 'Oat Milk'), image_url: 'data:image/png;base64,abc' };
    const pins = [
      { location: pin('l1', 'p1', 0.5, 0.5), product: withPhoto },
      { location: pin('l2', 'p2', 4, 0.5), product: product('p2', 'Rye Bread') },
    ];
    const { container } = render(<ShelfDetail shelf={shelf} pins={pins} onClose={() => {}} />);
    // one photo facing (the product with an image), one diagram fallback
    const images = container.querySelectorAll('image');
    expect(images).toHaveLength(1);
    expect(images[0]!.getAttribute('href')).toBe('data:image/png;base64,abc');
    expect(images[0]!.getAttribute('preserveAspectRatio')).toBe('xMidYMax meet');
    expect(container.textContent).toContain('Rye Bread');
    // Photos is the active view of the toggle pair
    expect(screen.getByRole('button', { name: 'Photos' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Diagram' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('toggles back to the diagram view', () => {
    const shelf = parseElement(row);
    const withPhoto = { ...product('p1', 'Oat Milk'), image_url: 'data:image/png;base64,abc' };
    const pins = [{ location: pin('l1', 'p1', 0.5, 0.5), product: withPhoto }];
    const { container } = render(<ShelfDetail shelf={shelf} pins={pins} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Diagram' }));
    expect(container.querySelectorAll('image')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Diagram' }).getAttribute('aria-pressed')).toBe('true');
    // the schematic facing (colored box + name text) is drawn again
    expect(container.querySelector('rect[fill-opacity="0.16"]')).toBeTruthy();
    expect(container.textContent).toContain('Oat Milk');
  });

  it('shows one shelf face — every pin renders, no side selector', () => {
    // planograms no longer split front/back: both items are on the one face
    const shelf = parseElement(row);
    const pins = [
      { location: pin('l1', 'p1', 1, 0.2), product: product('p1', 'Front Item') },
      { location: pin('l2', 'p2', 3, 0.8), product: product('p2', 'Back Item') },
    ];
    const { container } = render(<ShelfDetail shelf={shelf} pins={pins} onClose={() => {}} />);
    expect(screen.queryByLabelText('Shelf side')).toBeNull();
    expect(container.textContent).toContain('Front Item');
    expect(container.textContent).toContain('Back Item');
  });

  it('diagram and image modes render the SAME-size planogram', () => {
    const shelf = parseElement(row);
    const withPhoto = { ...product('p1', 'Oat Milk'), image_url: 'data:image/png;base64,abc' };
    const pins = [{ location: pin('l1', 'p1', 1, 0.5), product: withPhoto }];
    const { container } = render(<ShelfDetail shelf={shelf} pins={pins} onClose={() => {}} />);
    const heightAt = () => container.querySelector('svg')!.getAttribute('height');
    const photosH = heightAt();
    fireEvent.click(screen.getByRole('button', { name: 'Diagram' }));
    expect(heightAt()).toBe(photosH);
    fireEvent.click(screen.getByRole('button', { name: 'Image' }));
    expect(heightAt()).toBe(photosH);
  });

  it('planogram tiles default to the CROPPED photo when one exists', () => {
    const shelf = parseElement(row);
    const cropped = {
      ...product('p1', 'Oat Milk'),
      image_url: 'data:image/png;base64,full',
      image_crop_url: 'data:image/png;base64,crop',
    };
    const { container } = render(
      <ShelfDetail shelf={shelf} pins={[{ location: pin('l1', 'p1', 1, 0.5), product: cropped }]} onClose={() => {}} />
    );
    expect(container.querySelector('image')!.getAttribute('href')).toBe('data:image/png;base64,crop');
  });

  it('editor: the Row height slider persists via onRowHeightChange', () => {
    const shelf = parseElement(row);
    let rowH: number | null = null;
    const { container } = render(
      <ShelfDetail shelf={shelf} pins={[]} onClose={() => {}} editing onRowHeightChange={(v) => (rowH = v)} />
    );
    const slider = container.querySelector('input[type="range"][min="64"]') as HTMLInputElement;
    expect(slider).toBeTruthy();
    fireEvent.change(slider, { target: { value: '160' } });
    expect(rowH).toBe(160);
  });

  it('editor: the toolbar offers ＋ Add item and the facing panel has no add-another button', () => {
    const shelf = parseElement(row);
    let picked = false;
    const { container } = render(
      <ShelfDetail
        shelf={shelf}
        pins={[{ location: pin('l1', 'p1', 1, 0.5), product: product('p1', 'Choc Bar') }]}
        onClose={() => {}}
        editing
        onAddItem={() => (picked = true)}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '＋ Add item' }));
    expect(picked).toBe(true);
    // open the facing editor — the per-facing "＋ Add another item" is gone
    fireEvent.click(container.querySelector('g[style*="cursor"]')!);
    expect(screen.queryByRole('button', { name: '＋ Add another item' })).toBeNull();
    expect(screen.getByRole('button', { name: '＋ Add copy' })).toBeTruthy();
  });
});
