/**
 * The example maps as the Worker seeds them: every catalogue item faces on a
 * shelf (an item with no facing lists as "out of stock" in a shopper's
 * search), every photo is a stored one, and — above all — the specs describe
 * the SAME maps as the Node seeder in backend/scripts/demo-specs.mjs. The two
 * are maintained by hand; this is the check that keeps them in step.
 */
import { describe, it, expect } from 'vitest';
import { walmartSpec, homeDepotSpec, cornerStoreSpec, stockEverything } from '../src/seed';
import {
  walmartSpec as nodeWalmart,
  homeDepotSpec as nodeHomeDepot,
  cornerStoreSpec as nodeCorner,
} from '../../backend/scripts/demo-specs.mjs';

const MAPS = [
  ['walmart-example', walmartSpec, nodeWalmart],
  ['home-depot-example', homeDepotSpec, nodeHomeDepot],
  ['convenience-store-example', cornerStoreSpec, nodeCorner],
] as const;

/** In the rect's own frame, so a rotated run (a vertical shelf is a rot-90
 *  rect) is judged by its real footprint — the same inverse rotation as the
 *  app's elementContains. */
const inside = (rect: { x: number; y: number; w: number; h: number; rot?: number }, p: { x: number; y: number }) => {
  const a = (-(rect.rot ?? 0) * Math.PI) / 180;
  const dx = p.x - (rect.x + rect.w / 2);
  const dy = p.y - (rect.y + rect.h / 2);
  const lx = rect.w / 2 + dx * Math.cos(a) - dy * Math.sin(a);
  const ly = rect.h / 2 + dx * Math.sin(a) + dy * Math.cos(a);
  return lx >= 0 && lx <= rect.w && ly >= 0 && ly <= rect.h;
};

describe('example specs', () => {
  it('every example stocks its whole catalogue — one pin per group', () => {
    for (const [slug, build] of MAPS) {
      const spec = build();
      const shelves = spec.elements.filter((e) => e.type === 'shelf');
      const pins = spec.locations.filter((l) => l.groupPin);
      expect(spec.slug, 'the spec names its store').toBe(slug);
      expect(pins.length, `${slug}: one map pin per shelf group`).toBe(shelves.length);
      expect(new Set(pins.map((l) => l.product)).size, `${slug}: each pin belongs to its own item`).toBe(pins.length);
      // nothing sits in the catalogue unstocked — that is what a search lists as "out of stock"
      expect([...new Set(spec.locations.map((l) => l.product))].sort((a, b) => a - b), `${slug}: every item faces on a shelf`).toEqual(
        spec.products.map((_, i) => i)
      );
      expect(stockEverything(structuredClone(spec)), `${slug}: the sweep that stocks strays has nothing to do`).toBe(0);
      expect(spec.products.length, `${slug}: a real catalogue`).toBeGreaterThan(50);
      for (const l of spec.locations) {
        expect(Number.isInteger(l.product) && l.product >= 0 && l.product < spec.products.length, `${slug}: facing of a real item`).toBe(true);
        if (!l.groupOnly) continue;
        expect(shelves.some((s) => inside(s.geometry as never, l)), `${slug}: facing of "${spec.products[l.product].name}" lies on a shelf`).toBe(true);
      }
      const departments = new Set(shelves.map((s) => JSON.parse(s.meta ?? '{}').department));
      for (const c of spec.categories) expect(departments.has(c.name), `${slug}: category "${c.name}" is shelved`).toBe(true);
    }
  });

  it('every item references a stored photo by its database url', () => {
    // that each of these files exists in backend/demo-products is checked
    // against the Node specs (backend/test/media.test.mjs) — and the parity
    // test below shows the Worker's specs are the very same
    for (const [slug, build] of MAPS) {
      for (const p of build().products) {
        expect(p.image ?? '', `${slug}: "${p.name}" → ${p.image}`).toMatch(/^\/media\/(?:gen\/)?[a-z0-9-]+\.(?:jpg|svg)$/);
      }
    }
  });

  it('the sweep stocks an item the grouping left out — its department first, any shelf otherwise', () => {
    // a copy: the specs hand out their category list by reference
    const spec = structuredClone(cornerStoreSpec());
    const shelves = spec.elements.filter((e) => e.type === 'shelf');
    const coffee = shelves.find((s) => s.label === 'Coffee & Tea')!;
    spec.categories.push({ name: 'Magazines', color: '#777777', icon: '📖', items: [] });
    const base = spec.products.length;
    spec.products.push(
      { name: 'Auto Weekly', category: 'Magazines', brand: 'X' }, // a category with no shelf
      { name: 'Crossword Book', category: 'Coffee & Tea', brand: 'X' } // an extra item of a shelved category
    );
    const facing = (i: number) => spec.locations.find((l) => l.product === i);
    expect(facing(base)).toBeUndefined();
    expect(stockEverything(spec)).toBe(2);
    expect(stockEverything(spec), 'idempotent').toBe(0);
    for (const i of [base, base + 1]) {
      expect(facing(i)?.groupOnly, 'a planogram-only facing, never a second map pin').toBe(1);
      expect(facing(i)?.groupPin).toBeUndefined();
    }
    expect(inside(coffee.geometry as never, facing(base + 1)!), 'an item of a shelved category joins one of its shelves').toBe(true);
    expect(inside(shelves[0].geometry as never, facing(base)!), 'an item of an unshelved category takes the first shelf').toBe(true);
  });
});

describe('parity with the Node seeder (backend/scripts/demo-specs.mjs)', () => {
  for (const [slug, worker, node] of MAPS) {
    it(`${slug}: the same floor plan, catalogue and stocking on both engines`, () => {
      const a = worker();
      const b = node();
      expect(b.slug).toBe(slug);
      expect(pick(a, ['slug', 'name', 'w', 'h', 'skuPrefix', 'skuPad', 'floorName'])).toEqual(pick(b, ['slug', 'name', 'w', 'h', 'skuPrefix', 'skuPad', 'floorName']));
      expect(a.elements.length).toBe(b.elements.length);
      a.elements.forEach((e, i) => expect(strip(e), `element ${i}`).toEqual(strip(b.elements[i])));
      expect(a.categories.length).toBe(b.categories.length);
      a.categories.forEach((c, i) => expect(strip(c), `category ${i}`).toEqual(strip(b.categories[i])));
      expect(a.products.length, 'catalogue size').toBe(b.products.length);
      a.products.forEach((p, i) => expect(strip(p), `product ${i}`).toEqual(strip(b.products[i])));
      expect(a.locations.length, 'facing count').toBe(b.locations.length);
      a.locations.forEach((l, i) => expect(strip(l), `facing ${i}`).toEqual(strip(b.locations[i])));
    });
  }
});

const pick = (o: object, keys: string[]) => Object.fromEntries(keys.map((k) => [k, o[k as never]]));
/** Without undefined-valued keys, so the two engines' rows compare equal whether or not a field was spelled out. */
const strip = (o: object) => JSON.parse(JSON.stringify(o));
