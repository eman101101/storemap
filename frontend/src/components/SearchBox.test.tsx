/** The shopper search shared by the store view and the homepage hero. */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SearchBox, { searchHits } from './SearchBox';
import { buildGroupPins } from '../lib/itemGroups';
import { parseElement } from '../types';
import type { PublicStorePayload, ProductLocation } from '../types';

/* one shelf group: a titled map pin + two planogram-only items, plus an item
   that is not on the map at all */
const shelves = [
  parseElement({
    id: 'dairy', floor_id: 'f1', type: 'shelf', shape: 'rect', label: 'Aisle 1', color: '',
    geometry: JSON.stringify({ x: 0, y: 0, w: 10, h: 1, rot: 0 }), meta: JSON.stringify({ groupName: 'Dairy & Cheese' }), z_index: 0,
  }),
];
const locations: ProductLocation[] = [
  { id: 'pin', product_id: 'milk', floor_id: 'f1', x: 5, y: 0.5, rot: 0, meta: JSON.stringify({ groupPin: 1 }) },
  { id: 'y1', product_id: 'yogurt', floor_id: 'f1', x: 2, y: 0.5, rot: 0, meta: JSON.stringify({ groupOnly: 1 }) },
  { id: 'y2', product_id: 'yogurt-family', floor_id: 'f1', x: 3, y: 0.5, rot: 0, meta: JSON.stringify({ groupOnly: 1 }) },
];
const product = (id: string, name: string, extra: Partial<PublicStorePayload['products'][number]> = {}) => ({
  id, store_id: 's', category_id: null, name, brand: 'Fresh Farm', sku: `SKU-${id}`, barcode: '',
  description: '', price: 2.5, image_url: `img/${id}.jpg`, image_crop_url: '', category_name: 'Dairy', category_color: '#3b6fd4', ...extra,
});
const data: PublicStorePayload = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  store: { id: 's', name: 'Demo', slug: 'demo', address: '', description: '', phone: '', website: '', hours: '', logo_url: '', plan: 'free', created_at: '', updated_at: '' } as any,
  floors: [{ id: 'f1', store_id: 's', name: 'Ground floor', level: 1, width_m: 40, height_m: 30, background_url: '' }],
  elements: shelves.map((s) => ({ ...s, geometry: JSON.stringify(s.geom) })),
  categories: [],
  products: [
    product('milk', 'Whole Milk 1L'),
    product('yogurt', 'Greek Yogurt 500g'),
    product('yogurt-family', 'Greek Yogurt 500g Family Pack'),
    product('yogurt-oos', 'Greek Yogurt 900g'),
  ],
  locations,
};
const groupPins = buildGroupPins(locations, shelves);

describe('searchHits', () => {
  it('matches name, brand and sku, and says nothing for an empty query', () => {
    expect(searchHits(data, '', groupPins)).toEqual([]);
    expect(searchHits(data, '   ', groupPins)).toEqual([]);
    expect(searchHits(data, 'fresh farm', groupPins).map((h) => h.product.id)).toHaveLength(4);
    expect(searchHits(data, 'sku-yogurt', groupPins).map((h) => h.product.id)).toHaveLength(3);
    expect(searchHits(data, 'yogurt', groupPins)).toHaveLength(3);
    expect(searchHits(data, 'CHEDDAR', groupPins)).toEqual([]);
  });

  it('lists the shortest names first — "Greek Yogurt 500g" before its Family Pack', () => {
    const names = searchHits(data, 'yogurt', groupPins).map((h) => h.product.name);
    expect(names.indexOf('Greek Yogurt 500g')).toBeLessThan(names.indexOf('Greek Yogurt 500g Family Pack'));
  });

  it('names the GROUP an item sits in — that is the pin the map shows for it', () => {
    const hit = searchHits(data, 'family pack', groupPins)[0];
    expect(hit.sub).toEqual(['Fresh Farm', '$2.50', 'in Dairy & Cheese']);
    // a planogram-only item is sent to its group's pin, not to its own facing
    expect(hit.focusId).toBe('pin');
    expect(hit.located).toBe(true);
  });

  it("the group's own pinned item routes to the same pin", () => {
    const hit = searchHits(data, 'whole milk', groupPins)[0];
    expect(hit.focusId).toBe('pin');
    expect(hit.sub[2]).toBe('in Dairy & Cheese');
  });

  it('an item with no location is listed as out of stock and routes nowhere', () => {
    const hit = searchHits(data, '900g', groupPins)[0];
    expect(hit.located).toBe(false);
    expect(hit.focusId).toBeNull();
  });
});

describe('SearchBox', () => {
  const setup = (over: Partial<Parameters<typeof SearchBox>[0]> = {}) => {
    const onPick = vi.fn();
    const onChange = vi.fn();
    const props = {
      value: 'yogurt',
      onChange,
      hits: searchHits(data, 'yogurt', groupPins),
      onPick,
      open: true,
      setOpen: () => {},
      placeholder: 'Search an item… e.g. milk',
      images: true,
      onToggleImages: () => {},
      ...over,
    };
    const utils = render(<SearchBox {...props} />);
    return { ...utils, onPick, onChange, props };
  };

  it('lists every hit with its photo, its group, and highlights the match', () => {
    const { container } = setup();
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(2); // the out-of-stock item is not an option
    expect(options[0]).toHaveTextContent('Greek Yogurt 500g');
    expect(options[0]).toHaveTextContent('in Dairy & Cheese');
    expect(options[0]!.querySelector('mark')!.textContent).toBe('Yogurt');
    expect(container.querySelectorAll('.rimg img')).toHaveLength(3);
    expect(screen.getByText(/out of stock/)).toBeTruthy();
  });

  it('result photos are hidden when the 🖼 toggle is off — a category dot takes their place', () => {
    const { container } = setup({ images: false });
    expect(container.querySelectorAll('.rimg img')).toHaveLength(0);
    // the two located results show a dot; the out-of-stock row shows neither
    expect(container.querySelectorAll('.result-item .dot')).toHaveLength(2);
  });

  it('arrow keys move the active row and Enter picks it', () => {
    const { onPick } = setup();
    const input = screen.getByRole('combobox');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ product: expect.objectContaining({ id: 'yogurt-family' }) }));
  });

  it('the arrow keys skip an out-of-stock row — it is not somewhere a shopper can go', () => {
    // hit order is shortest name first: 500g, 900g (out of stock), Family Pack
    const first = setup();
    const input = screen.getByRole('combobox');
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // 500g
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // skips the out-of-stock 900g
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(first.onPick).toHaveBeenCalledWith(expect.objectContaining({ product: expect.objectContaining({ id: 'yogurt-family' }) }));
    // and nothing is picked when no result is on the map
    first.unmount();
    const alone = setup({ hits: searchHits(data, '900g', groupPins) });
    fireEvent.keyDown(alone.getByRole('combobox'), { key: 'Enter' });
    expect(alone.onPick).not.toHaveBeenCalled();
  });

  it('Enter with no arrow keys picks the first result', () => {
    const { onPick } = setup();
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ product: expect.objectContaining({ id: 'yogurt' }) }));
  });

  it('clicking a result picks it; Escape and ✕ clear the query', () => {
    const { onPick, onChange } = setup();
    fireEvent.click(screen.getAllByRole('option')[0]);
    expect(onPick).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
    expect(onChange).toHaveBeenLastCalledWith('');
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  it('says so when nothing matches', () => {
    setup({ value: 'cheddar', hits: [] });
    expect(screen.getByText('Nothing found for “cheddar”.')).toBeTruthy();
  });

  it('the photo toggle is left out where photos are always on (the homepage)', () => {
    setup({ onToggleImages: undefined });
    expect(screen.queryByRole('button', { name: 'Toggle result photos' })).toBeNull();
  });
});
