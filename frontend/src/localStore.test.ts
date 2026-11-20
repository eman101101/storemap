import { describe, expect, it, vi } from 'vitest';
import { LocalSession } from './localStore';
import type { PublicStorePayload } from './types';

const payload: PublicStorePayload = {
  store: {
    id: 'pub', name: 'Demo Mart', slug: 'demo-mart', address: '1 St', description: '', phone: '', website: '',
    hours: '', logo_url: '', plan: 'free', created_at: '', updated_at: '',
  },
  floors: [{ id: 'f1', store_id: 'pub', name: 'Ground', level: 0, width_m: 20, height_m: 10, background_url: '' }],
  categories: [{ id: 'c1', store_id: 'pub', name: 'Dairy', color: '#3b6fd4', icon: '' }],
  products: [
    { id: 'p1', store_id: 'pub', category_id: 'c1', name: 'Milk', brand: '', sku: '', barcode: '', description: '', price: 1.5, image_url: '', image_crop_url: '' },
    { id: 'p2', store_id: 'pub', category_id: null, name: 'Bread', brand: '', sku: '', barcode: '', description: '', price: null, image_url: '', image_crop_url: '' },
  ],
  locations: [{ id: 'l1', product_id: 'p1', floor_id: 'f1', x: 2, y: 3, rot: 0, meta: '{}' }],
  elements: [
    { id: 'e1', floor_id: 'f1', type: 'shelf', shape: 'rect', geometry: JSON.stringify({ x: 1, y: 1, w: 4, h: 1, rot: 0 }), label: 'Aisle 1', color: '', meta: '{}', z_index: 1 },
  ],
};

describe('LocalSession (no-account sandbox)', () => {
  it('blank() is an empty one-floor store the editor can open', async () => {
    const s = LocalSession.blank();
    const full = await s.storeFull();
    expect(full.floors).toHaveLength(1);
    expect(full.elements).toEqual([]);
    expect(full.store.is_public).toBe(false);
    expect(full.store.entitlements?.productImages).toBe(true); // photos work as data URLs
  });

  it('fromPublic() copies a live store and detaches it from the original', async () => {
    const s = LocalSession.fromPublic(payload);
    const full = await s.storeFull();
    expect(full.store.name).toBe('Demo Mart');
    expect(full.store.slug).toBe(''); // a copy, not the published store
    expect(full.elements.map((e) => e.label)).toEqual(['Aisle 1']);
    expect(full.products).toHaveLength(2);
    expect(full.locations).toHaveLength(1);
  });

  it('edits stay in memory: elements, pins, products, floors', async () => {
    const s = LocalSession.fromPublic(payload);
    await s.saveElements('f1', []);
    expect((await s.storeFull()).elements).toEqual([]);

    const { location } = await s.setProductLocation('p2', { floor_id: 'f1', x: 5, y: 5 });
    expect(location.product_id).toBe('p2');
    expect((await s.storeFull()).locations).toHaveLength(2);
    // a plain re-pin (no locationId) inserts a NEW facing — products can hold
    // several pins per floor; moving an existing pin passes its locationId
    await s.setProductLocation('p2', { floor_id: 'f1', x: 6, y: 6 });
    expect((await s.storeFull()).locations).toHaveLength(3);
    await s.setProductLocation('p2', { floor_id: 'f1', x: 7, y: 7, locationId: location.id });
    expect((await s.storeFull()).locations).toHaveLength(3);
    expect((await s.storeFull()).locations.find((l) => l.id === location.id)).toMatchObject({ x: 7, y: 7 });

    const { product } = await s.addProduct('x', { name: 'Eggs', category_id: 'c1' });
    expect((await s.storeFull()).products.map((p) => p.name)).toContain('Eggs');
    await s.deleteProduct(product.id);
    expect((await s.storeFull()).products.map((p) => p.name)).not.toContain('Eggs');

    const { floor } = await s.addFloor('x', { name: 'Upstairs' });
    expect(floor.level).toBe(1);
    await s.deleteFloor(floor.id);
    expect((await s.storeFull()).floors).toHaveLength(1);
  });

  it('server-only features refuse with a helpful message', async () => {
    const s = LocalSession.blank();
    await expect(s.deleteStore()).rejects.toThrow(/sign in/i);
    await expect(s.importCsv()).rejects.toThrow(/account/i);
    expect(await s.floorSnapshots()).toEqual({ snapshots: [] });
  });

  it('exports the server transfer-bundle shape with index-remapped references', async () => {
    const s = LocalSession.fromPublic(payload);
    const bundle = s.exportBundle();
    expect(bundle.format).toBe('storemap.export/1');
    expect(bundle.floors).toEqual([{ name: 'Ground', level: 0, width_m: 20, height_m: 10, background_url: '' }]);
    expect(bundle.categories).toEqual([{ name: 'Dairy', color: '#3b6fd4', icon: '' }]);
    expect(bundle.products[0]).toMatchObject({ name: 'Milk', category: 0 });
    expect(bundle.products[1]).toMatchObject({ name: 'Bread', category: null });
    expect(bundle.elements[0]).toMatchObject({ floor: 0, type: 'shelf', label: 'Aisle 1' });
    expect(bundle.locations).toEqual([{ product: 0, floor: 0, x: 2, y: 3, rot: 0 }]);
    expect(bundle.media).toEqual([]);
  });
});

describe('LocalSession device persistence', () => {
  it('flags persistFailed (and stops trying) when the device rejects the save', async () => {
    // this jsdom build ignores direct setItem stubbing — swap the whole storage
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('quota exceeded', 'QuotaExceededError');
      },
      removeItem: () => {},
    });
    try {
      const s = LocalSession.blank('quota-test');
      await s.addProduct('x', { name: 'Eggs' }); // commits trigger persist()
      expect(s.persistFailed).toBe(true);
      expect(s.canPersist).toBe(false);
      // later mutations are no-op persists that don't throw, and editing keeps working
      await s.updateStore('x', { name: 'Still editing' });
      expect((await s.storeFull()).store.name).toBe('Still editing');
      expect(s.persistFailed).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('loadSaved refuses snapshots from newer versions, accepts v1 and versionless', () => {
    const snap = LocalSession.fromPublic(payload).snapshot();
    expect(snap.v).toBe(1);
    localStorage.setItem('storemap.try.ver-newer', JSON.stringify({ ...snap, v: 2 }));
    expect(LocalSession.loadSaved('ver-newer')).toBeNull();
    localStorage.setItem('storemap.try.ver-v1', JSON.stringify(snap));
    expect(LocalSession.loadSaved('ver-v1')).not.toBeNull();
    const versionless = { ...snap, v: undefined }; // the original format had no version field
    localStorage.setItem('storemap.try.ver-none', JSON.stringify(versionless));
    expect(LocalSession.loadSaved('ver-none')).not.toBeNull();
  });

  it('loadSaved ignores snapshots whose payload is not made of arrays', () => {
    const snap = LocalSession.fromPublic(payload).snapshot();
    localStorage.setItem('storemap.try.shape-bad', JSON.stringify({ ...snap, products: 'nope' }));
    expect(LocalSession.loadSaved('shape-bad')).toBeNull();
  });

  it('Add copy: a second setProductLocation (no locationId) yields a DISTINCT pin, not the original', async () => {
    const s = LocalSession.fromPublic(payload);
    const seedCount = (await s.storeFull()).locations.filter((l) => l.product_id === 'p1').length;
    const first = await s.setProductLocation('p1', { floor_id: 'f1', x: 2, y: 3, shelfId: 'e1', shelfLevel: 1, facingW: 0.32 });
    const second = await s.setProductLocation('p1', { floor_id: 'f1', x: 2.5, y: 3, shelfId: 'e1', shelfLevel: 1, facingW: 0.32 });
    expect(second.location.id).not.toBe(first.location.id);
    const locs = (await s.storeFull()).locations.filter((l) => l.product_id === 'p1');
    expect(locs).toHaveLength(seedCount + 2); // seed pin + copy 1 + copy 2, all real rows
    expect(new Set(locs.map((l) => l.id)).size).toBe(locs.length); // unique ids — no duplicate React keys
    // the seeded original is untouched at its own spot
    expect(locs.find((l) => l.id === 'l1')).toMatchObject({ x: 2, y: 3 });
    expect(locs.find((l) => l.id === first.location.id)).toMatchObject({ x: 2, y: 3 });
  });

  it('productImageCrop stores a variant and leaves the original photo alone', async () => {
    const s = LocalSession.fromPublic(payload);
    const file = new File(['crop-bytes'], 'crop.webp', { type: 'image/webp' });
    const { product } = await s.productImageCrop('p1', file);
    expect(product.image_crop_url).toContain('data:');
    expect(product.image_url).toBe(''); // original untouched
    await s.removeProductImageCrop('p1');
    const after = (await s.storeFull()).products.find((p) => p.id === 'p1');
    expect(after?.image_crop_url).toBe('');
  });
});
