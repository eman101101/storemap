/** Component tests: shelf detail modal, CSV-free unit paths of the types module. */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ShelfDetail from './ShelfDetail';
import { parseElement, elementToRow, isRect, isPoint, isPoly } from '../types';
import type { MapElementRow, Product, ProductLocation, ShelfWindow, ShelfWindowSlot } from '../types';

const row: MapElementRow = {
  id: 'shelf-1', floor_id: 'f1', type: 'shelf', shape: 'rect',
  geometry: JSON.stringify({ x: 0, y: 0, w: 5, h: 1, rot: 0 }),
  label: 'Aisle 1', color: '', meta: JSON.stringify({ bays: 2, levels: 2 }), z_index: 0,
};

const product = (id: string, name: string): Product => ({
  id, store_id: 's', category_id: null, name, brand: '', sku: '', barcode: '',
  description: '', price: 1.5, image_url: '', image_crop_url: '',
});

const pin = (id: string, productId: string, x: number, y: number, meta = '{}') =>
  ({ id, product_id: productId, floor_id: 'f1', x, y, rot: 0, meta }) as ProductLocation;

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

  it('persists the image view: the whole product stands on its shelf board, no label strip', () => {
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
    // never cropped to the tile ("slice" cut bottles down to slivers): the
    // photo keeps its own proportions and sits on the board, like stock
    expect(images[0]!.getAttribute('preserveAspectRatio')).toBe('xMidYMax meet');
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
    // the Diagram/Image toggle is always offered now (planogram starts on Image)
    expect(screen.getByRole('button', { name: 'Image' }).getAttribute('aria-pressed')).toBe('true');
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

  it('defaults to the image planogram when products carry images', () => {
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
    // Image is the active view of the toggle pair (the planogram starts on Image)
    expect(screen.getByRole('button', { name: 'Image' }).getAttribute('aria-pressed')).toBe('true');
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
    // the drawing's own size lives in its viewBox (CSS scales the whole svg)
    const heightAt = () => container.querySelector('svg')!.getAttribute('viewBox')!.split(' ')[3];
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

  /* ── drawing size: a planogram is never squashed ────────────────────────
     The drawing is laid out at its own size (one scale per metre, rows at a
     fixed height) and CSS scales the whole svg to fit. A densely stocked
     row must make the drawing LONGER, not squeeze its facings together. */
  const viewBoxOf = (container: HTMLElement) =>
    container.querySelector('svg.planogram-svg')!.getAttribute('viewBox')!.split(' ').map(Number);
  const facingRects = (container: HTMLElement) =>
    [...container.querySelectorAll('rect[fill-opacity="0.16"]')].map((r) => ({
      x: Number(r.getAttribute('x')), w: Number(r.getAttribute('width')),
    }));
  const stocked = (n: number) => {
    const shelf = parseElement({ ...row, meta: JSON.stringify({ planWidth: 2, levels: 4 }) });
    const pins = Array.from({ length: n }, (_, i) => ({
      location: pin(`l${i}`, `p${i}`, (i + 0.5) * (5 / n), 0.5, `{"w":${(2 / n).toFixed(3)}}`),
      product: { ...product(`p${i}`, `Item ${i}`), image_url: 'data:image/png;base64,abc' },
    }));
    return render(<ShelfDetail shelf={shelf} pins={pins} onClose={() => {}} />);
  };

  it('a densely stocked shelf is drawn longer, not squashed (80 items on a 2 m planogram)', () => {
    const { container } = stocked(80);
    const [x, y, w, h] = viewBoxOf(container);
    // 4 rows of 20: each facing keeps a readable width in the drawing itself
    expect(w).toBeGreaterThanOrEqual(20 * 56);
    // rows keep their fixed height — the drawing is wide, not a tall sliver
    expect(h).toBe(4 * 112 + 20);
    // and it tells CSS its own size, so scaling is the same factor both ways
    expect(container.querySelector('svg')!.style.getPropertyValue('--planogram-w')).toBe(`${w}px`);
  });

  it('facings in the fullest row never overlap', () => {
    const { container } = stocked(40);
    const row = facingRects(container).filter((r) => r.x >= 0);
    // group by row (same y) and check each row left-to-right
    const byY = new Map<number, number[]>();
    for (const r of [...container.querySelectorAll('rect[fill-opacity="0.16"]')]) {
      const y = Number(r.getAttribute('y'));
      byY.set(y, [...(byY.get(y) ?? []), Number(r.getAttribute('x')) + Number(r.getAttribute('width'))]);
    }
    for (const ends of byY.values()) {
      const starts = [...container.querySelectorAll('rect[fill-opacity="0.16"]')]
        .filter((r) => byY.has(Number(r.getAttribute('y'))))
        .map((r) => Number(r.getAttribute('x')));
      ends.forEach((end, i) => {
        for (const start of starts) if (start > ends[i] - 0.001 && start < end - 0.5) throw new Error(`facings overlap at x=${start}`);
      });
    }
    expect(row.length).toBeGreaterThan(0);
  });

  it('three facings on a short shelf still get the readable tile width', () => {
    const { container } = stocked(3);
    const [x, y, w] = viewBoxOf(container);
    // one row of three on 2 m: 46 px/m would give 30 px tiles, so the scale
    // rises to fit three 56 px tiles
    expect(w).toBe(3 * 56 + 20);
  });

  it('long tile labels wrap onto two lines instead of being cut to a stub', () => {
    const shelf = parseElement({ ...row, meta: JSON.stringify({ planWidth: 2 }) });
    const long = { ...product('p1', 'Organic Whole Milk 1L Family Pack') };
    const { container } = render(<ShelfDetail shelf={shelf} pins={[{ location: pin('l1', 'p1', 1, 0.5), product: long }]} onClose={() => {}} />);
    const lines = [...container.querySelectorAll('svg tspan')].map((t) => t.textContent ?? '');
    expect(lines.length).toBe(2);
    expect(lines.join(' ')).toContain('Organic Whole');
  });

  it('fits its dialog to the drawing: a small shelf gets a snug dialog', () => {
    const shelf = parseElement(row);
    render(<ShelfDetail shelf={shelf} pins={[]} onClose={() => {}} />);
    // 2 m planogram × 46 px/m + frame = 112 px, grown up to 1.9×, plus the dialog's padding
    expect(screen.getByRole('dialog').style.maxWidth).toBe('281px');
  });

  it('"outside" means within reach of the shelf — not the rest of the store', () => {
    const shelf = parseElement(row); // 5 m × 1 m at the origin
    const near = pin('near', 'p1', 5.8, 0.5); // just past the right-hand end
    const far = pin('far', 'p2', 30, 20); // somewhere else entirely
    const { container, unmount } = render(
      <ShelfDetail
        shelf={shelf}
        pins={[
          { location: near, product: product('p1', 'Near Item') },
          { location: far, product: product('p2', 'Far Item') },
        ]}
        onClose={() => {}}
      />
    );
    expect(container.textContent).toContain('1 pinned product just outside this shelf');
    expect(container.textContent).not.toContain('2 pinned products');
    unmount();
    const { container: alone } = render(
      <ShelfDetail shelf={shelf} pins={[{ location: far, product: product('p2', 'Far Item') }]} onClose={() => {}} />
    );
    expect(alone.textContent).not.toContain('just outside');
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

describe('ShelfDetail: a window on a long shelf (a store with a loaded catalogue)', () => {
  // three boards; the server sends a stretch of the shelf, not the whole of it
  const shelf = parseElement({ ...row, meta: JSON.stringify({ bays: 2, levels: 3 }) });
  const facing = (id: string, level: number, u: number): ShelfWindowSlot => ({
    location: {
      ...pin(id, id, 2.5, 0.5),
      meta: JSON.stringify({ shelfId: 'shelf-1', shelf_level: level, w: 1, groupOnly: 1, u }),
    },
    product: { ...product(id, `${id} Flakes`), brand: 'Kellogg\'s', category_name: 'Cereal' },
  });
  const win = (from: number, to: number, slots: ShelfWindowSlot[]): ShelfWindow => ({
    shelfId: 'shelf-1', u: (from + to) / 2, from, to,
    levels: [{ level: 1, count: 220 }, { level: 2, count: 230 }, { level: 3, count: 226 }],
    slots,
  });
  /** every facing drawn, in order: its item's name and the group that draws it */
  const drawn = (container: HTMLElement) =>
    [...container.querySelectorAll('svg g[style*="cursor"]')].map((g) => [g.querySelector('title')!.textContent, g] as const);
  const clickFacing = (container: HTMLElement) => fireEvent.click(container.querySelector('svg g[style*="cursor"]')!);

  it('draws the stretch as the whole board, each facing on its own board, and says where the item is', () => {
    const { container } = render(
      <ShelfDetail
        shelf={shelf}
        pins={[]}
        onClose={() => {}}
        shelfWindow={win(0.2, 0.26, [facing('a', 3, 0.23), facing('b', 1, 0.23)])}
        highlightLocationId="a"
        onShiftWindow={() => {}}
        elsewhere="Also in 1 other place — this is the closest."
      />
    );
    const dialog = screen.getByRole('dialog');
    // the shelf's name, the size of the whole shelf, and what part of it is on show
    expect(dialog).toHaveTextContent('Aisle 1');
    expect(dialog).not.toHaveTextContent('— planogram');
    expect(dialog).toHaveTextContent('676 products on this shelf · a stretch of it 20–26% of the way along');
    // 23% along the shelf is "toward the left end", on board 3 of 3 "the top shelf"
    expect(dialog).toHaveTextContent("a Flakes is on the top shelf, toward the left end. Also in 1 other place — this is the closest.");
    expect(dialog).not.toHaveTextContent('b Flakes is');
    // both facings are drawn, at their real boards: the bottom one sits lower than the top one
    expect(drawn(container).map(([name]) => name)).toEqual(['a Flakes', 'b Flakes']);
    const [, top] = drawn(container)[0];
    const [, bottom] = drawn(container)[1];
    const y = (g: Element) => Number(g.querySelector('rect')!.getAttribute('y'));
    expect(y(top)).toBeLessThan(y(bottom));
    // the highlighted one wears the ring
    expect(top.querySelector('.facing-highlight')).not.toBeNull();
    expect(bottom.querySelector('.facing-highlight')).toBeNull();
  });

  it('pages along the shelf, and never past its ends', () => {
    const shifts: number[] = [];
    render(
      <ShelfDetail shelf={shelf} pins={[]} onClose={() => {}} shelfWindow={win(0.8, 1, [])} onShiftWindow={(d) => shifts.push(d)} />
    );
    const left = screen.getByRole('button', { name: /Further left/ });
    const right = screen.getByRole('button', { name: /Further right/ });
    expect(right).toBeDisabled();
    expect(left).not.toBeDisabled();
    fireEvent.click(left);
    expect(shifts).toEqual([-1]);
  });

  it('says where a picked item sits in the shelf, not where the drawing puts it', () => {
    const { container } = render(
      <ShelfDetail shelf={shelf} pins={[]} onClose={() => {}} shelfWindow={win(0, 0.05, [facing('a', 2, 0.03)])} />
    );
    clickFacing(container);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Cereal · On the middle shelf, toward the left end');
    expect(dialog).not.toHaveTextContent('Bay 1 · Row');
  });

  it('hands the picked facing back with the item, for the map and the trip', () => {
    let placed: ProductLocation | undefined;
    const { container } = render(
      <ShelfDetail
        shelf={shelf}
        pins={[]}
        onClose={() => {}}
        shelfWindow={win(0, 0.05, [facing('a', 2, 0.03)])}
        onAddToList={(_p, f) => (placed = f)}
      />
    );
    clickFacing(container);
    fireEvent.click(screen.getByRole('button', { name: /Add to list/ }));
    expect(placed?.id).toBe('a');
    expect(JSON.parse(placed!.meta)).toMatchObject({ shelfId: 'shelf-1', shelf_level: 2, u: 0.03 });
  });

  it('a window that could not be loaded leaves the store\'s own items, says so, and offers no paging', () => {
    render(
      <ShelfDetail
        shelf={shelf}
        pins={[{ location: pin('l1', 'p1', 1, 0.5), product: product('p1', 'Oat Milk') }]}
        onClose={() => {}}
        shelfWindow={null}
        onShiftWindow={() => {}}
      />
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Oat Milk');
    expect(dialog).toHaveTextContent('could not be reached');
    expect(screen.queryByRole('button', { name: /Further left/ })).toBeNull();
  });
});
