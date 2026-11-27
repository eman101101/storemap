/** The store's sections as the search offers them: how the floor is indexed
 *  (aisles, departments, areas, shelf groups) and how a query ranks them. */
import { describe, it, expect } from 'vitest';
import { buildSections, searchSections, type Box, type Section } from './sections';
import { parseElement } from '../types';
import type { MapElement, MapElementRow } from '../types';
import type { MapPin } from '../components/MapCanvas';
import type { RectGeom } from '../types';

const row = (o: Partial<MapElementRow>) => parseElement({ floor_id: 'f1', color: '', meta: '', z_index: 1, ...o } as MapElementRow);
const shelf = (id: string, r: RectGeom, label: string, department: string, color: string): MapElement =>
  row({ id, type: 'shelf', shape: 'rect', geometry: JSON.stringify(r), label, color, meta: JSON.stringify({ department }) });
const zone = (id: string, r: RectGeom, label: string, color: string, department = label): MapElement =>
  row({ id, type: 'zone', shape: 'rect', geometry: JSON.stringify(r), label, color, meta: JSON.stringify({ department }), z_index: 0 });
/** A vertical run through (cx, cy), `len` long and `depth` deep — as the seeders write one. */
const run = (cx: number, cy: number, len: number, depth = 0.65): RectGeom => ({ x: cx - len / 2, y: cy - depth / 2, w: len, h: depth, rot: 90 });

// a floor in miniature: a dairy wall in its own area, two gondolas with aisle 2
// between them, produce as a named area plus a tint holding the tables, restrooms
const elements: MapElement[] = [
  shelf('milk', { x: 2, y: 1, w: 8, h: 1.3, rot: 0 }, 'Milk & Cream', 'Dairy & Cheese', '#efc24a'),
  zone('dairy', { x: 0.5, y: 0.5, w: 10, h: 3, rot: 0 }, 'Dairy', '#efc24a', 'Dairy & Cheese'),
  shelf('chips', run(10, 5, 8.5), 'Chips & Pretzels', 'Snacks & Candy', '#e2663a'),
  shelf('candy', run(10.65, 5, 8.5), 'Candy & Chocolate', 'Snacks & Candy', '#e2663a'),
  shelf('water', run(14.6, 5, 8.5), 'Water & Sports Drinks', 'Drinks', '#3f8fd2'),
  shelf('paper', run(15.25, 5, 8.5), 'Paper Towels', 'Paper & Cleaning', '#9fb8c9'),
  // down the middle of the 3.3 m between the two gondolas: each lines it with one face
  row({ id: 'a2', type: 'aisle', shape: 'polyline', geometry: JSON.stringify([[12.625, 1], [12.625, 9.3]]), label: 'Aisle 2', z_index: 0 }),
  row({ id: 'a15', type: 'aisle', shape: 'polyline', geometry: JSON.stringify([[1, 9.8], [9, 9.8]]), label: 'Aisle 15', z_index: 0 }),
  shelf('melons', { x: 2, y: 10.2, w: 2.9, h: 2.6, rot: 0 }, 'Melons & Citrus', 'Fresh Produce', '#55a64f'),
  zone('produce', { x: 0.5, y: 9.3, w: 9, h: 1, rot: 0 }, 'Produce', '#55a64f', 'Fresh Produce'),
  zone('produceTint', { x: 0.5, y: 10.3, w: 9, h: 3.2, rot: 0 }, '', '#55a64f', 'Fresh Produce'),
  zone('restrooms', { x: 14, y: 11, w: 4, h: 2, rot: 0 }, 'Restrooms', '#2d809d'),
];
const sections = buildSections(elements, []);
const byKey = (key: string) => sections.find((s) => s.key === key) as Section;

describe('buildSections', () => {
  it('lists the aisles first, in number order, with the departments on either side and the shelves that line them', () => {
    expect(sections.filter((s) => s.kind === 'aisle').map((s) => s.name)).toEqual(['Aisle 2', 'Aisle 15']);
    const a2 = byKey('aisle:a2');
    expect(a2.also).toEqual([]); // searched by its own name only
    expect(a2.sub).toEqual(['Snacks & Candy', 'Drinks']); // said under the name: the departments its two faces carry
    expect(a2.shelfIds).toEqual(['candy', 'water']); // the east face of one gondola, the west face of the other
    expect(a2.box).toEqual({ x0: 10.325, x1: 14.925, y0: 0.75, y1: 9.3 }); // both faces' runs, and the aisle's own line
    expect(byKey('aisle:a15').shelfIds).toEqual(['melons']); // a strip across the produce tables
  });

  it('makes one section per department, over all its shelves, named after its area too', () => {
    const snacks = byKey('dept:Snacks & Candy');
    expect(snacks.kind).toBe('department');
    expect(snacks.shelfIds).toEqual(['chips', 'candy']);
    expect(snacks.sub).toEqual(['Aisle 2', '2 shelves']);
    for (const [k, v] of Object.entries({ x0: 9.675, x1: 10.975, y0: 0.75, y1: 9.25 })) expect(snacks.box[k as keyof Box]).toBeCloseTo(v);

    // "Dairy" is the Dairy & Cheese department's floor: its other name, not a place of its own
    const dairy = byKey('dept:Dairy & Cheese');
    expect(dairy.also).toEqual(['Dairy']);
    expect(dairy.sub).toEqual(['Dairy', '1 shelf']);
    expect(sections.some((s) => s.name === 'Dairy')).toBe(false);

    // "Produce" records Fresh Produce in its meta: it names the department though its tables sit in the tint beside it
    const produce = byKey('dept:Fresh Produce');
    expect(produce.also).toEqual(['Produce']);
    expect(produce.shelfIds).toEqual(['melons']);
    expect(sections.some((s) => s.name === 'Produce')).toBe(false);
    expect(sections.some((s) => s.name === '')).toBe(false); // the tint is no section
  });

  it('keeps the named places that are no department’s floor as areas of their own', () => {
    const restrooms = byKey('area:restrooms');
    expect(restrooms.kind).toBe('area');
    expect(restrooms.sub).toEqual([]);
    expect(restrooms.shelfIds).toEqual([]);
    expect(restrooms.box).toMatchObject({ x0: 14, y0: 11, x1: 18, y1: 13 });
  });

  it('offers every titled shelf as a shelf group, under its department and its area', () => {
    const milk = byKey('group:milk');
    expect(milk.kind).toBe('group');
    expect(milk.name).toBe('Milk & Cream');
    expect(milk.sub).toEqual(['Dairy & Cheese', 'Dairy']);
    expect(milk.box).toMatchObject({ x0: 2, y0: 1, x1: 10, y1: 2.3 });
    expect(sections.filter((s) => s.kind === 'group').map((s) => s.name)).toEqual([
      'Milk & Cream', 'Chips & Pretzels', 'Candy & Chocolate', 'Water & Sports Drinks', 'Paper Towels', 'Melons & Citrus',
    ]);
  });

  it('offers a shelf once when it is named like the department it is the whole of', () => {
    const pharmacy = [
      shelf('rx', { x: 1, y: 1, w: 5, h: 1.3, rot: 0 }, 'Pharmacy', 'Pharmacy', '#2d809d'),
      zone('rxArea', { x: 0.5, y: 0.5, w: 7, h: 3, rot: 0 }, 'Pharmacy', '#2d809d', 'Pharmacy'),
    ];
    const built = buildSections(pharmacy, []);
    expect(built.filter((s) => s.name === 'Pharmacy').map((s) => s.kind)).toEqual(['department']); // the shelf's own row would repeat it
    expect(built.find((s) => s.kind === 'department')?.shelfIds).toEqual(['rx']);
  });

  it('names shelves by what is pinned to them where no department was seeded', () => {
    const legacy = [
      shelf('s1', { x: 1, y: 1, w: 6, h: 1.3, rot: 0 }, 'Paint', '', ''),
      { location: { id: 'l1', product_id: 'p1', floor_id: 'f1', x: 2, y: 1.65, rot: 0, meta: '' }, product: { id: 'p1', name: 'Blue Paint', category_name: 'Paint & Décor', category_color: '#3b6fd4' } },
      { location: { id: 'l2', product_id: 'p2', floor_id: 'f1', x: 3, y: 1.65, rot: 0, meta: '' }, product: { id: 'p2', name: 'Rollers', category_name: 'Paint & Décor', category_color: '#3b6fd4' } },
    ];
    // (the pins are sketched, not built: only their place and category are read)
    const pins: MapPin[] = [legacy[1], legacy[2]] as unknown as MapPin[];
    const built = buildSections([legacy[0]] as unknown as MapElement[], pins);
    expect(built.find((s) => s.kind === 'department')?.name).toBe('Paint & Décor');
    expect(built.find((s) => s.kind === 'group')?.sub).toEqual(['Paint & Décor']);
  });
});

describe('searchSections', () => {
  const names = (q: string) => searchSections(sections, q).map((s) => s.name);

  it('answers by name first, then by what else a section is called', () => {
    expect(names('dairy')).toEqual(['Dairy & Cheese', 'Milk & Cream']); // the department's own name, then the shelf called after it
    // only its area's name answers "produce": the department, then its shelf
    expect(names('produce')).toEqual(['Fresh Produce', 'Melons & Citrus']);
    expect(names('rest')).toEqual(['Restrooms']);
    expect(names('milk')).toEqual(['Milk & Cream']);
    expect(names('paper')).toEqual(['Paper & Cleaning', 'Paper Towels']); // equally good names: the department before the shelf
  });

  it('asks nothing of the sections for one letter, and finds a word’s start in the middle of a name', () => {
    expect(names('a')).toEqual([]);
    // the department and the shelf named after it, then the department's other shelf (found through its department)
    expect(names('cand')).toEqual(['Snacks & Candy', 'Candy & Chocolate', 'Chips & Pretzels']);
  });

  it('ranks a word’s start above the middle of a word', () => {
    const carFloor = buildSections(
      [
        shelf('c1', { x: 1, y: 1, w: 6, h: 1.3, rot: 0 }, 'Scarf Sets', 'Apparel', '#7b5aa6'),
        shelf('c2', { x: 1, y: 3, w: 6, h: 1.3, rot: 0 }, 'Racing Cars', 'Toys & Games', '#b04ac2'),
        shelf('c3', { x: 1, y: 5, w: 6, h: 1.3, rot: 0 }, 'Carrots', 'Fresh Produce', '#55a64f'),
      ],
      []
    );
    // the two shelves whose names start with it come first, in name order; the one that merely holds it last
    expect(searchSections(carFloor, 'car').filter((s) => s.kind === 'group').map((s) => s.name)).toEqual(['Carrots', 'Racing Cars', 'Scarf Sets']);
  });

  it('takes a number as an aisle’s — exactly that aisle', () => {
    expect(names('2')).toEqual(['Aisle 2']);
    expect(names('aisle 2')).toEqual(['Aisle 2']);
    expect(names('15')).toEqual(['Aisle 15']);
    expect(names('AISLE 15')).toEqual(['Aisle 15']);
    expect(names('5')).toEqual([]);
  });

  it('returns nothing for no query or no answer, and never more than its limit', () => {
    expect(names('')).toEqual([]);
    expect(names('   ')).toEqual([]);
    expect(names('zzz')).toEqual([]);
    expect(searchSections(sections, 'cand', 1).map((s) => s.name)).toEqual(['Snacks & Candy']);
  });
});
