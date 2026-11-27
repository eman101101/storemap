/** How the 2D map writes names on shelves and departments under them — the
 *  rules a floor of vertical gondolas needs to stay readable. */
import { describe, it, expect, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import MapCanvas, { readingAngle, shelfTitle } from './MapCanvas';
import { inkOn } from '../lib/mapColors';
import { parseElement } from '../types';
import type { Floor, MapElement, Product, ProductLocation } from '../types';
import type { RectGeom } from '../types';

// jsdom has no ResizeObserver — MapCanvas sizes itself with one
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const floor: Floor = {
  id: 'f1', store_id: 's1', name: 'Main', level: 0, width_m: 20, height_m: 14, background_url: '',
};

/** A shelf as the seeders write one: a long rect (a vertical run is rot 90), in its department's colour. */
const shelf = (id: string, r: RectGeom, label: string, department: string, color = '#e2663a'): MapElement =>
  parseElement({
    id, floor_id: 'f1', type: 'shelf', shape: 'rect', geometry: JSON.stringify(r),
    label, color, meta: JSON.stringify({ department }), z_index: 1,
  });
/** A vertical run through (cx, cy), `len` long and `depth` deep. */
const run = (cx: number, cy: number, len: number, depth = 0.65): RectGeom =>
  ({ x: cx - len / 2, y: cy - depth / 2, w: len, h: depth, rot: 90 });

const texts = (container: HTMLElement, content: string) =>
  [...container.querySelectorAll('text')].filter((t) => t.textContent === content);

const draw = (elements: MapElement[], scale: number, extra: { pins?: { location: ProductLocation; product: Product }[]; showLabels?: boolean } = {}) =>
  render(
    <MapCanvas
      floor={floor}
      elements={elements}
      pins={extra.pins ?? []}
      viewport={{ scale, tx: 0, ty: 0 }}
      onViewport={() => {}}
      showDepartments
      showLabels={extra.showLabels}
    />
  ).container;

describe('shelfTitle — a long shelf carries its name along it', () => {
  it('is hidden while the shelf is too thin on screen to hold it, and shrinks with the shelf', () => {
    const vertical = run(10, 5, 8.5);
    expect(shelfTitle(vertical, 'Chips & Pretzels', 12.5 / 10, 10)).toBe('hidden'); // 6.5 px deep
    const near = shelfTitle(vertical, 'Chips & Pretzels', 12.5 / 20, 20);
    expect(near).not.toBe('hidden');
    expect((near as { size: number }).size * 20).toBeCloseTo(0.65 * 20 * 0.72, 5); // the depth decides, not the 12.5 px default
    // and never larger than the default
    expect(shelfTitle({ x: 0, y: 0, w: 12, h: 2, rot: 0 }, 'Meat', 12.5 / 20, 20)).toEqual({ size: 12.5 / 20, rotate: 0 });
  });

  it('is hidden when the name cannot fit the run, even at the smallest size', () => {
    expect(shelfTitle(run(10, 5, 2), 'x'.repeat(40), 12.5 / 20, 20)).toBe('hidden');
    const long = { x: 0, y: 0, w: 40, h: 1.3, rot: 0 };
    expect(shelfTitle(long, 'x'.repeat(40), 12.5 / 20, 20)).toEqual({ size: 12.5 / 20, rotate: 0 }); // it fits at full size
  });

  it('reads bottom to top on a vertical run and never upside down', () => {
    const turn = (rot: number) => {
      const t = shelfTitle({ x: 0, y: 0, w: 8, h: 1.3, rot }, 'Chips & Pretzels', 12.5 / 30, 30);
      expect(t).not.toBe('hidden');
      return (t as { rotate: number }).rotate; // in the rect's own frame
    };
    expect(turn(90)).toBe(180); // a rot-90 rect's text turned to read upward
    expect(turn(100)).toBe(180); // just past upright: turned back to read upward
    expect(turn(0)).toBe(0);
    expect(turn(45)).toBe(0); // down-right reads fine
    expect(turn(315)).toBe(0); // up-right reads fine
    expect(turn(180)).toBe(180);
    // steep is steep, whichever side of upright: 75° reads upward like 100° does
    expect(turn(75)).toBe(180);
    expect(turn(80)).toBe(180);
    expect(turn(60)).toBe(0); // and 60° is still a shallow enough slope to read down
    // already reading upward, just short of upright: left alone
    expect(turn(260)).toBe(0);
    expect(turn(300)).toBe(0);
    // a tall unrotated rect (a vertical shelf drawn as one) reads upward too
    expect(shelfTitle({ x: 0, y: 0, w: 1.3, h: 8, rot: 0 }, 'Chips & Pretzels', 12.5 / 30, 30)).toEqual({ size: 12.5 / 30, rotate: -90 });
  });

  it('writes a display table’s name across its middle — only once the name fits its width on screen', () => {
    expect(shelfTitle({ x: 0, y: 0, w: 2.9, h: 2.6, rot: 0 }, 'Melons & Citrus', 12.5 / 20, 20)).toBe('hidden'); // 105 px of name, 58 px of table
    expect(shelfTitle({ x: 0, y: 0, w: 6, h: 2.6, rot: 0 }, 'Melons & Citrus', 12.5 / 20, 20)).toEqual({ size: 12.5 / 20, rotate: 0 });
    expect(shelfTitle({ x: 0, y: 0, w: 2.6, h: 2.9, rot: 0 }, 'Melons & Citrus', 12.5 / 60, 60)).toEqual({ size: 12.5 / 60, rotate: 0 }); // a little deeper than wide: still across
    expect(shelfTitle({ x: 0, y: 0, w: 6, h: 2.6, rot: 180 }, 'Melons & Citrus', 12.5 / 20, 20)).toEqual({ size: 12.5 / 20, rotate: 180 }); // never upside down
  });
});

describe('inkOn — the ink is chosen from the fill it has to read on', () => {
  it('is dark on light fills and white on dark ones', () => {
    expect(inkOn('#efc24a')).toBe('#1b1f27'); // dairy yellow
    expect(inkOn('#5db1ec')).toBe('#1b1f27'); // frozen light blue
    expect(inkOn('#e7d5a8')).toBe('#1b1f27'); // the default shelf beige
    expect(inkOn('#3e4a52')).toBe('#ffffff'); // auto-care charcoal
    expect(inkOn('#7b5aa6')).toBe('#ffffff'); // wine purple
  });
});

describe('MapCanvas names', () => {
  it('writes a vertical shelf’s name along it, in the ink its fill reads with', () => {
    const container = draw([shelf('a', run(10, 5, 8.5), 'Chips & Pretzels', 'Snacks & Candy', '#e2663a')], 20);
    const [label] = texts(container, 'Chips & Pretzels');
    expect(label).toBeTruthy();
    expect(label!.getAttribute('transform')).toBe('rotate(180 10 5)'); // turned about the rect's centre to read upward
    expect(label!.getAttribute('fill')).toBe('#ffffff'); // white on the snacks orange-red
    expect(label!.classList.contains('el-label')).toBe(false); // the theme's label colour would not read on a coloured shelf
  });

  it('writes a dark shelf’s name in white', () => {
    const container = draw([shelf('a', { x: 2, y: 3, w: 10, h: 1.5, rot: 0 }, 'Motor Oil & Car Care', 'Auto Care', '#3e4a52')], 20);
    expect(texts(container, 'Motor Oil & Car Care')[0]!.getAttribute('fill')).toBe('#ffffff');
  });

  it('writes no name, and a department badge instead, while the shelf is too thin on screen', () => {
    const elements = [
      shelf('w', run(10, 5, 8.5), 'Chips & Pretzels', 'Snacks & Candy'),
      shelf('e', run(10.65, 5, 8.5), 'Candy & Chocolate', 'Snacks & Candy'),
    ];
    const far = draw(elements, 10);
    expect(texts(far, 'Chips & Pretzels')).toHaveLength(0);
    // the two faces of the gondola are named once, along the pair — where their own titles
    // will be, turned the same way — so zooming never turns the text over
    const badges = texts(far, 'Snacks & Candy');
    expect(badges).toHaveLength(1);
    expect(badges[0]!.getAttribute('x')).toBe('10.325'); // the pair spans 9.675..10.975
    expect(badges[0]!.getAttribute('y')).toBe('5'); // over the middle of the run
    expect(badges[0]!.getAttribute('transform')).toBe('rotate(-90 10.325 5)'); // reading upward
    expect(Number(badges[0]!.getAttribute('font-size')) * 10).toBeCloseTo(11 * 10 / 13.2, 5); // a little smaller at this zoom

    const near = draw(elements, 20);
    expect(texts(near, 'Chips & Pretzels')).toHaveLength(1);
    expect(texts(near, 'Candy & Chocolate')).toHaveLength(1);
    expect(texts(near, 'Snacks & Candy')).toHaveLength(0); // the titles say more than the department does
  });

  it('gives a display table its title or its department’s badge, never both', () => {
    // about as deep as it is long: the title sits across its middle once it fits, until then the badge names the department
    const table = (scale: number) => draw([shelf('t', { x: 2, y: 2, w: 4.5, h: 4.1, rot: 0 }, 'Root Vegetables', 'Fresh Produce', '#55a64f')], scale);
    expect(texts(table(12), 'Root Vegetables')).toHaveLength(0);
    expect(texts(table(12), 'Fresh Produce')).toHaveLength(1);
    expect(texts(table(30), 'Root Vegetables')).toHaveLength(1);
    expect(texts(table(30), 'Fresh Produce')).toHaveLength(0);
  });

  it('does not repeat a department under shelves inside an area that already names it', () => {
    // "Produce" holds Fresh Produce: the area records that in its meta, and the tables inside need no badge of their own
    const area = (department: string | null) =>
      parseElement({
        id: 'z', floor_id: 'f1', type: 'zone', shape: 'rect', geometry: JSON.stringify({ x: 0, y: 0, w: 20, h: 14, rot: 0 }),
        label: 'Produce', color: '#55a64f', meta: JSON.stringify({ department: department ?? 'Produce' }), z_index: 0,
      });
    const table = shelf('t', { x: 2, y: 2, w: 2.9, h: 2.6, rot: 0 }, 'Melons & Citrus', 'Fresh Produce', '#55a64f');
    expect(texts(draw([area('Fresh Produce'), table], 12), 'Fresh Produce')).toHaveLength(0);
    expect(texts(draw([area(null), table], 12), 'Fresh Produce')).toHaveLength(1); // an area of another name leaves the badge
    // an area is often a tint and a named piece: the tint alone speaks for the shelves it covers
    const tint = area('Fresh Produce');
    expect(texts(draw([{ ...tint, label: '' }, table], 12), 'Fresh Produce')).toHaveLength(0);
    expect(texts(draw([shelf('f', { x: 2, y: 6, w: 8, h: 1.3, rot: 0 }, 'Frozen Pizza', 'Frozen', '#5db1ec'), table], 12), 'Fresh Produce')).toHaveLength(1);
  });

  it('names each face of a gondola beside that face, and slides clear of the aisle’s own name', () => {
    // a 24 m gondola: two faces of different departments
    const gondola = [
      shelf('w', run(10, 12, 24), 'Chips & Pretzels', 'Snacks & Candy'),
      shelf('e', run(10.65, 12, 24), 'Cereal', 'Breakfast & Coffee', '#9a6b45'),
    ];
    const badge = (container: HTMLElement, name: string) => texts(container, name)[0]!;
    const plain = draw(gondola, 10);
    // one department per face: each is written just outside its own face, so the aisle on either
    // side of the gondola reads the department it leads past — never a pile of text under the run
    const west = badge(plain, 'Snacks & Candy');
    const east = badge(plain, 'Breakfast & Coffee');
    expect(Number(west.getAttribute('x'))).toBeLessThan(9.675); // outside the west face
    expect(Number(east.getAttribute('x'))).toBeGreaterThan(10.975); // outside the east face
    expect(west.getAttribute('transform')).toMatch(/^rotate\(-90 /);
    expect(east.getAttribute('transform')).toMatch(/^rotate\(-90 /);
    expect(west.getAttribute('y')).toBe('12');
    expect(east.getAttribute('y')).toBe('12');

    // an aisle's name stands in the aisle the east badge reaches into: the badge slides along its
    // run, away from it; the west badge, clear of the aisle, stays over the middle
    const aisle = parseElement({
      id: 'a2', floor_id: 'f1', type: 'aisle', shape: 'polyline', geometry: JSON.stringify([[12, 0], [12, 24]]), label: 'Aisle 2', color: '', meta: '', z_index: 0,
    });
    const beside = draw([...gondola, aisle], 10);
    expect(badge(beside, 'Snacks & Candy').getAttribute('y')).toBe('12');
    // the aisle's name reaches 2.8 m either side of the aisle's middle; the badge 4.5 m either side of its centre
    expect(Number(badge(beside, 'Breakfast & Coffee').getAttribute('y'))).toBeCloseTo(12 + 4.5 + 2.8 + 0.2, 5);

    // zoomed out further the badges grow no pile: they shrink a little and stay on their runs
    const out = draw(gondola, 8);
    expect(Number(badge(out, 'Breakfast & Coffee').getAttribute('font-size')) * 8).toBeCloseTo(7.5, 5);
    expect(Number(badge(out, 'Snacks & Candy').getAttribute('font-size')) * 8).toBeCloseTo(7.5, 5);
  });

  it('turns an aisle’s name the same way as the titles beside it — reading upward', () => {
    const aisle = (pts: number[][]) =>
      parseElement({ id: 'a', floor_id: 'f1', type: 'aisle', shape: 'polyline', geometry: JSON.stringify(pts), label: 'Aisle 2', color: '', meta: '', z_index: 0 });
    expect(texts(draw([aisle([[12, 0.75], [12, 9.25]])], 10), 'AISLE 2')[0]!.getAttribute('transform')).toBe('rotate(-90 12 5)');
    expect(texts(draw([aisle([[12, 9.25], [12, 0.75]])], 10), 'AISLE 2')[0]!.getAttribute('transform')).toBe('rotate(-90 12 5)');
    expect(texts(draw([aisle([[2, 5], [14, 5]])], 10), 'AISLE 2')[0]!.getAttribute('transform')).toBeNull(); // across the floor: as drawn
    // the rule itself
    expect(readingAngle(90)).toBe(-90);
    expect(readingAngle(75)).toBe(-105);
    expect(readingAngle(45)).toBe(45);
    expect(readingAngle(180)).toBe(0);
    expect(readingAngle(270)).toBe(-90);
    expect(readingAngle(-90)).toBe(-90);
    expect(readingAngle(261)).toBe(-99); // upright but leaning left: still left to read upward
  });

  it('badges a department laid out in rows one behind another once — in the gap between the rows', () => {
    const rows = (front: number) =>
      draw(
        [
          shelf('back', { x: 2, y: 4, w: 6, h: 1.3, rot: 0 }, 'Sheet Sets', 'Home & Bedding', '#7c8fcb'),
          shelf('front', { x: 2, y: front, w: 6, h: 1.3, rot: 0 }, 'Pillows', 'Home & Bedding', '#7c8fcb'),
        ],
        10,
        { showLabels: false }
      );
    const badges = (container: HTMLElement) => texts(container, 'Home & Bedding');
    const wide = badges(rows(8));
    expect(wide).toHaveLength(1);
    expect(wide[0]!.getAttribute('y')).toBe('6.3'); // under the back row (it ends at 5.3 m): in the aisle between the two
    expect(badges(rows(6))[0]!.getAttribute('y')).toBe('6.3'); // a narrow aisle: the badge is not moved off the front row's thin run
  });

  it('writes a wall run’s badge under the run — below a titled shelf or an area’s name there, never over them', () => {
    // 14 px per metre: a 0.65 m run is too thin for its title, a 1 m shelf is not
    const S = 14;
    const wallRun = () => shelf('w', { x: 5.75, y: 12, w: 8.5, h: 0.65, rot: 0 }, 'Water & Sports Drinks', 'Drinks', '#3f8fd2');
    const under = 12.65 + 10 / S; // the run ends at 12.65 m; the badge sits 10 px below
    const yOf = (container: HTMLElement) => Number(texts(container, 'Drinks')[0]!.getAttribute('y'));

    // a shelf showing its title lies right under the run: the badge goes beneath it
    const titled = draw([wallRun(), shelf('floral', { x: 5.2, y: 13.0, w: 5.2, h: 1.0, rot: 0 }, 'Floral', 'Outdoor & Garden', '#7fb241')], S);
    expect(texts(titled, 'Floral')).toHaveLength(1);
    expect(yOf(titled)).toBeGreaterThanOrEqual(14.0 + 6 / S - 1e-9);

    // an area's name on the floor just under the run is cleared the same way
    const area = parseElement({
      id: 'z', floor_id: 'f1', type: 'zone', shape: 'rect', geometry: JSON.stringify({ x: 5.2, y: 12.9, w: 5.2, h: 1.2, rot: 0 }),
      label: 'Floral', color: '#7fb241', meta: '{}', z_index: 0,
    });
    expect(yOf(draw([wallRun(), area], S))).toBeGreaterThanOrEqual(13.5 + 7 / S - 1e-9); // "Floral" is written at 13.5 m

    // the area's floor alone is no obstacle, only its name: a wide area whose name sits well away
    const wide = parseElement({
      id: 'z2', floor_id: 'f1', type: 'zone', shape: 'rect', geometry: JSON.stringify({ x: 0, y: 13.4, w: 40, h: 6, rot: 0 }),
      label: 'Checkouts', color: '#9aa0a6', meta: '{}', z_index: 0,
    });
    expect(yOf(draw([wallRun(), wide], S))).toBeCloseTo(under, 5);

    // a diagonal shelf is tested by its real footprint, not by the box around it: the badge sits inside
    // that box here, well clear of the shelf's line, and stays where it is
    const diagonal = { x: 2.8, y: 7.35, w: 14.4, h: 1.3, rot: 315 }; // from (4.9, 13.1) up to (15.1, 2.9)
    expect(yOf(draw([wallRun(), shelf('angled', diagonal, 'Potatoes & Onions', 'Fresh Produce', '#55a64f')], S))).toBeCloseTo(under, 5);

    // no clear spot within a few lines (a deep table under the run): back under the run rather than far below it
    expect(yOf(draw([wallRun(), shelf('table', { x: 5.2, y: 13.0, w: 5.2, h: 5.0, rot: 0 }, 'Melons', 'Fresh Produce', '#55a64f')], S))).toBeCloseTo(under, 5);

    // a thin run under it, its own title not on the map: no obstacle — the badge stays where its run ends
    const thin = draw([wallRun(), shelf('other', { x: 5.2, y: 13.0, w: 5.2, h: 0.65, rot: 0 }, 'Paper Towels', 'Paper & Cleaning', '#9fb8c9')], S);
    expect(texts(thin, 'Paper Towels')).toHaveLength(0);
    expect(yOf(thin)).toBeCloseTo(under, 5);
  });

  it('runs a group’s title along its pin on a vertical gondola, by the shelf’s own title’s rule', () => {
    const shelfEl = shelf('a', run(10, 5, 8.5), 'Chips & Pretzels', 'Snacks & Candy');
    const pin = (id: string) => ({
      location: {
        id, product_id: id, floor_id: 'f1', x: 10.1625, y: 5, rot: 0,
        meta: JSON.stringify({ groupPin: 1, pinW: 6, pinH: 0.3 }),
      } as ProductLocation,
      product: { id, name: 'Sea Salt Crisps 150g', category_color: '#e2663a' } as Product,
    });
    // too thin on screen for a title: none on the pin either — the department's badge names it
    expect(texts(draw([shelfEl], 10, { pins: [pin('loc1')] }), 'Chips & Pretzels')).toHaveLength(0);
    expect(texts(draw([shelfEl], 10, { pins: [pin('loc1')] }), 'Snacks & Candy')).toHaveLength(1);
    // wide enough: the shelf's own title is on the map, in the same words — the pin adds no second copy
    expect(texts(draw([shelfEl], 20, { pins: [pin('loc1')] }), 'Chips & Pretzels')[0]!.getAttribute('transform')).toBe('rotate(180 10 5)');

    // a group named apart from its shelf ("Chips & Pretzels" on the shelf "Chips"): the pin carries that name,
    // along it, over the middle of the run, reading upward, as large as the shelf is deep
    const named = parseElement({
      id: 'b', floor_id: 'f1', type: 'shelf', shape: 'rect', geometry: JSON.stringify(run(10, 5, 8.5)),
      label: 'Chips', color: '#e2663a', meta: JSON.stringify({ department: 'Snacks & Candy', groupName: 'Chips & Pretzels' }), z_index: 1,
    });
    const both = draw([named], 20, { pins: [pin('loc2')] });
    expect(texts(both, 'Chips')).toHaveLength(1); // along the shelf
    const [group] = texts(both, 'Chips & Pretzels');
    expect(group!.getAttribute('transform')).toBe('rotate(-90 10 5)');
    expect(Number(group!.getAttribute('font-size')) * 20).toBeCloseTo(0.65 * 20 * 0.72, 5);
  });

  it('keeps only one of two group titles that would lie over each other, until zoomed in far enough to part them', () => {
    // two display tables, 0.5 m apart: a table's name is set at full size above its pin whatever the zoom, so
    // here it falls to the titles to keep off each other — the lower one gives way until the zoom parts them
    const table = (id: string, y: number, label: string) => shelf(id, { x: 5, y, w: 2, h: 2, rot: 0 }, label, 'Fresh Produce', '#55a64f');
    const back = table('melons', 4, 'Melons & Citrus');
    const front = table('berries', 6.5, 'Berries & Grapes');
    const group = (id: string, y: number) => ({
      location: {
        id, product_id: id, floor_id: 'f1', x: 6, y, rot: 0,
        meta: JSON.stringify({ groupPin: 1, pinW: 2, pinH: 0.3 }),
      } as ProductLocation,
      product: { id, name: 'Cantaloupe', category_color: '#55a64f' } as Product,
    });
    const pins = [group('loc1', 5.9), group('loc2', 6.6)];
    const close = draw([back, front], 10, { pins }); // the two names 5 px apart
    expect(texts(close, 'Melons & Citrus')).toHaveLength(1); // the upper keeps its name
    expect(texts(close, 'Berries & Grapes')).toHaveLength(0); // the lower lies over it at this zoom

    const apart = draw([back, front], 22, { pins }); // 11 px: clear of each other
    expect(texts(apart, 'Melons & Citrus')).toHaveLength(1);
    expect(texts(apart, 'Berries & Grapes')).toHaveLength(1);
  });

});
