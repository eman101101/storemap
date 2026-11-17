/**
 * The sandbox ("try it out") store: a full in-memory store that backs the map
 * editor without an account. It implements the subset of `api` the editor
 * uses, so EditorPage runs unmodified against local state — editing, undo,
 * products, floors and image "uploads" (data URLs) all work; nothing persists.
 * The transfer-bundle export (`storemap.export/1`, same shape as the server's
 * /export) lets visitors take their work with them and import it later.
 */
import type {
  Category, Floor, MapElementRow, Product, ProductLocation, PublicStorePayload, Store, StoreFull,
} from './types';
import { compressImage } from './lib/image';

type ApiShape = typeof import('./api').api;

/** The slice of `api` the editor (and its panels) call. */
export type EditorApi = Pick<
  ApiShape,
  | 'storeFull'
  | 'saveElements'
  | 'setProductLocation'
  | 'deleteLocation'
  | 'addFloor'
  | 'updateFloor'
  | 'deleteFloor'
  | 'addCategory'
  | 'deleteCategory'
  | 'addProduct'
  | 'updateProduct'
  | 'deleteProduct'
  | 'productImage'
  | 'removeProductImage'
  | 'uploadImage'
  | 'floorSnapshots'
  | 'floorSnapshot'
  | 'updateStore'
  | 'deleteStore'
  | 'importCsv'
>;

const uid = () => crypto.randomUUID();

export interface SandboxLogEntry {
  ts: number;
  label: string;
  elements: number;
  products: number;
}

export class LocalSession implements EditorApi {
  readonly sandboxId: string;
  /** localStorage key this sandbox persists to, if it persists at all. */
  storageKey: string | null;
  /** What happened and when — the sandbox's save log (newest last). */
  log: SandboxLogEntry[] = [];
  private _persistFailed = false;
  private store: Store;
  private floors: Floor[];
  private categories: Category[];
  private products: Product[];
  private locations: ProductLocation[];
  /** element rows by floor id (what saveElements replaces wholesale) */
  private rows = new Map<string, MapElementRow[]>();

  private constructor(
    init: {
      store: Omit<Store, 'owner_id' | 'is_public' | 'id'> & { id?: string };
      floors: Floor[];
      categories: Category[];
      products: Product[];
      locations: ProductLocation[];
      elements: MapElementRow[];
    },
    storageKey: string | null = null
  ) {
    this.sandboxId = init.store.id ?? uid();
    this.storageKey = storageKey;
    this.store = {
      ...init.store,
      id: this.sandboxId,
      owner_id: 'sandbox',
      is_public: false,
      // the sandbox unlocks product photos — "uploads" become data URLs
      entitlements: { productImages: true },
    } as Store;
    this.floors = init.floors;
    this.categories = init.categories;
    this.products = init.products;
    this.locations = init.locations;
    for (const f of init.floors) {
      this.rows.set(f.id, init.elements.filter((e) => e.floor_id === f.id));
    }
  }

  /** An empty one-floor store for "create my map". */
  static blank(storageKey: string | null = null): LocalSession {
    const floorId = uid();
    return new LocalSession(
      {
        store: {
          name: 'Untitled store',
          slug: '',
          address: '', description: '', phone: '', website: '', hours: '',
          logo_url: '', plan: 'free', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        },
        floors: [{ id: floorId, store_id: 'sandbox', name: 'Ground floor', level: 0, width_m: 24, height_m: 16, background_url: '' }],
        categories: [], products: [], locations: [], elements: [],
      },
      storageKey
    );
  }

  /** A scratch copy of a published example store. */
  static async fromSlug(slug: string): Promise<LocalSession> {
    const { api } = await import('./api');
    return LocalSession.fromPublic(await api.publicStore(slug), slug);
  }

  static fromPublic(p: PublicStorePayload, storageKey: string | null = null): LocalSession {
    // the public payload strips product.category_id (only category_name ships),
    // so re-link products to their categories by name for the editor
    const catIdByName = new Map(p.categories.map((c) => [c.name, c.id]));
    const shelfRects = p.elements
      .filter((e) => e.type === 'shelf' && e.shape === 'rect')
      .map((e) => ({ id: e.id, geom: JSON.parse(e.geometry) }));
    return new LocalSession(
      {
        store: { ...p.store, slug: '' },
        floors: p.floors.map((f) => ({ ...f, store_id: 'sandbox' })),
        categories: p.categories.map((c) => ({ ...c, store_id: 'sandbox' })),
        products: p.products.map((pr) => ({
          ...pr,
          store_id: 'sandbox',
          category_id: pr.category_id ?? catIdByName.get(pr.category_name ?? '') ?? null,
        })),
        locations: p.locations.map((l) => {
        // stamp the owning shelf from where the live map has the pin
        const owner = shelfOwnerOf(l, shelfRects);
        return { ...l, meta: JSON.stringify(owner ? { shelfId: owner } : {}) };
      }),
        elements: p.elements.map((e) => ({ ...e, id: e.id })),
      },
      storageKey
    );
  }

  /**
   * Device-only persistence: signed-out visitors keep their map between
   * visits in localStorage — nothing ever reaches a server. Null when the
   * browser blocks storage (private mode) or nothing was saved.
   */
  static loadSaved(storageKey: string): LocalSession | null {
    try {
      const raw = localStorage.getItem(`storemap.try.${storageKey}`);
      if (!raw) return null;
      const s = JSON.parse(raw) as ReturnType<LocalSession['snapshot']> & { slug: string };
      // a snapshot written by a newer version may have fields we can't
      // interpret — refuse it rather than build a broken session
      // (versionless snapshots are the original v1 format)
      if (s.v != null && s.v !== 1) return null;
      if (!Array.isArray(s.floors) || !s.floors.length) return null;
      if (!Array.isArray(s.categories) || !Array.isArray(s.products) || !Array.isArray(s.locations) || !Array.isArray(s.elements)) {
        return null;
      }
      const sess = new LocalSession(
        { store: s.store, floors: s.floors, categories: s.categories, products: s.products, locations: s.locations, elements: s.elements },
        storageKey
      );
      if (Array.isArray(s.log)) sess.log = s.log;
      return sess;
    } catch {
      return null; // corrupt or unavailable storage — start fresh
    }
  }

  /** True when this session mirrors itself to the device. */
  get canPersist() {
    return this.storageKey !== null;
  }

  /**
   * True once saving to this device has failed (storage quota, private mode).
   * The session keeps working in memory, but "saved on this device" no longer
   * holds — the editor surface warns the visitor.
   */
  get persistFailed(): boolean {
    return this._persistFailed;
  }

  discard() {
    if (!this.storageKey) return;
    try {
      localStorage.removeItem(`storemap.try.${this.storageKey}`);
    } catch { /* storage unavailable */ }
  }

  private persist() {
    if (!this.storageKey) return;
    try {
      localStorage.setItem(`storemap.try.${this.storageKey}`, JSON.stringify(this.snapshot()));
    } catch {
      // quota (large images) or private mode — the session stays in memory,
      // but surface the failure instead of silently dropping every future save
      this.storageKey = null;
      this._persistFailed = true;
    }
  }

  snapshot() {
    return {
      v: 1 as const,
      store: this.store,
      floors: this.floors,
      elements: this.floors.flatMap((f) => this.rows.get(f.id) ?? []),
      categories: this.categories,
      products: this.products,
      locations: this.locations,
      log: this.log,
    };
  }

  /** Append to the save log (called on every committed change). */
  logAction(label: string) {
    this.log = [...this.log.slice(-99), { ts: Date.now(), label, elements: this.rows.size ? this.elementCount() : 0, products: this.products.length }];
    this.persist();
  }

  private elementCount(): number {
    let n = 0;
    for (const list of this.rows.values()) n += list.length;
    return n;
  }

  async storeFull(): Promise<StoreFull> {
    return this.snapshot();
  }

  async saveElements(floorId: string, elements: MapElementRow[]) {
    this.rows.set(floorId, elements.map((e) => ({ ...e })));
    this.persist();
    return { elements };
  }

  async setProductLocation(productId: string, body: { floor_id: string; x: number; y: number; shelfId?: string }) {
    const id = `loc-${productId}`;
    const location: ProductLocation = {
      id,
      product_id: productId,
      floor_id: body.floor_id,
      x: body.x,
      y: body.y,
      rot: 0,
      // the shelf the user pinned this product to — sandboxes keep the
      // association across sessions
      meta: JSON.stringify(body.shelfId ? { shelfId: body.shelfId } : {}),
    };
    this.locations = [...this.locations.filter((l) => l.product_id !== productId), location];
    this.persist();
    return { location };
  }

  async deleteLocation(id: string) {
    this.locations = this.locations.filter((l) => l.id !== id);
    this.persist();
    return { ok: true as const };
  }

  async addFloor(_storeId: string, body: Partial<Floor>) {
    const prev = this.floors[this.floors.length - 1];
    const floor: Floor = {
      id: uid(),
      store_id: this.sandboxId,
      name: body.name || `Floor ${this.floors.length + 1}`,
      level: (prev?.level ?? -1) + 1,
      width_m: body.width_m ?? prev?.width_m ?? 24,
      height_m: body.height_m ?? prev?.height_m ?? 16,
      background_url: '',
    };
    this.floors = [...this.floors, floor];
    this.rows.set(floor.id, []);
    this.persist();
    return { floor };
  }

  async updateFloor(floorId: string, body: Partial<Floor>) {
    const floor = this.floors.find((f) => f.id === floorId);
    if (!floor) throw new Error('Floor not found');
    this.floors = this.floors.map((f) => (f.id === floorId ? { ...f, ...body } : f));
    this.persist();
    return { floor: { ...floor, ...body } };
  }

  async deleteFloor(floorId: string) {
    this.floors = this.floors.filter((f) => f.id !== floorId);
    this.rows.delete(floorId);
    this.locations = this.locations.filter((l) => l.floor_id !== floorId);
    this.persist();
    return { ok: true as const };
  }

  async addCategory(_storeId: string, body: Partial<Category>) {
    const category: Category = {
      id: uid(), store_id: this.sandboxId,
      name: body.name || 'Untitled', color: body.color || '#5b6b5f', icon: body.icon || '',
    };
    this.categories = [...this.categories, category];
    this.persist();
    return { category };
  }

  async deleteCategory(id: string) {
    this.categories = this.categories.filter((c) => c.id !== id);
    this.products = this.products.map((p) => (p.category_id === id ? { ...p, category_id: null } : p));
    this.persist();
    return { ok: true as const };
  }

  async addProduct(_storeId: string, body: Partial<Product>) {
    const product: Product = {
      id: uid(), store_id: this.sandboxId,
      category_id: body.category_id ?? null,
      name: body.name || 'Untitled product',
      brand: body.brand ?? '', sku: body.sku ?? '', barcode: body.barcode ?? '',
      description: body.description ?? '', price: body.price ?? null, image_url: body.image_url ?? '',
    };
    this.products = [...this.products, product];
    this.persist();
    return { product };
  }

  async updateProduct(id: string, body: Partial<Product>) {
    const product = this.products.find((p) => p.id === id);
    if (!product) throw new Error('Product not found');
    this.products = this.products.map((p) => (p.id === id ? { ...p, ...body } : p));
    this.persist();
    return { product: { ...product, ...body } };
  }

  async deleteProduct(id: string) {
    this.products = this.products.filter((p) => p.id !== id);
    this.locations = this.locations.filter((l) => l.product_id !== id);
    this.persist();
    return { ok: true as const };
  }

  /** The sandbox has no upload bucket: images become data URLs in memory.
   *  Phone photos are shrunk first — localStorage caps out around 5MB. */
  async uploadImage(file: File) {
    const url = await fileToDataUrl((await compressImage(file)) ?? file);
    return { url };
  }

  async productImage(productId: string, file: File) {
    const url = await fileToDataUrl((await compressImage(file)) ?? file);
    const product = await this.updateProduct(productId, { image_url: url });
    return { url, product: product.product };
  }

  async removeProductImage(productId: string) {
    await this.updateProduct(productId, { image_url: '' });
    return { ok: true as const };
  }

  /** Autosave history is a server feature; the sandbox has undo/redo instead. */
  async floorSnapshots() {
    return { snapshots: [] };
  }

  async floorSnapshot(_floorId: string, _snapId: string): Promise<never> {
    throw new Error('Autosave history needs a saved account — use Export in the sandbox.');
  }

  async updateStore(_id: string, body: Partial<Store>) {
    this.store = { ...this.store, ...body } as Store;
    this.persist();
    return { store: this.store };
  }

  async deleteStore(): Promise<never> {
    throw new Error('This store only exists in your browser tab — nothing to delete. Export it or sign in to save it.');
  }

  async importCsv(): Promise<never> {
    throw new Error('CSV import needs a saved store — create a free account first.');
  }

  /**
   * Transfer bundle in the server's `storemap.export/1` shape (index-remapped,
   * media left as paths/data-urls) — importable via Dashboard → Import.
   */
  exportBundle() {
    const floors = this.floors;
    const floorIndex = new Map(floors.map((f, i) => [String(f.id), i]));
    const catIndex = new Map(this.categories.map((c, i) => [String(c.id), i]));
    const prodIndex = new Map(this.products.map((p, i) => [String(p.id), i]));
    return {
      format: 'storemap.export/1',
      version: 1,
      exportedAt: new Date().toISOString(),
      store: {
        name: this.store.name, address: this.store.address, description: this.store.description,
        phone: this.store.phone, website: this.store.website, hours: this.store.hours,
        logo_url: this.store.logo_url,
      },
      floors: floors.map((f) => ({
        name: f.name, level: f.level, width_m: f.width_m, height_m: f.height_m, background_url: f.background_url,
      })),
      categories: this.categories.map((c) => ({ name: c.name, color: c.color, icon: c.icon })),
      products: this.products.map((p) => ({
        name: p.name, brand: p.brand, sku: p.sku, barcode: p.barcode,
        description: p.description, price: p.price, image_url: p.image_url,
        category: p.category_id != null ? catIndex.get(String(p.category_id)) ?? null : null,
      })),
      elements: floors.flatMap((f) =>
        (this.rows.get(f.id) ?? []).map((e) => ({
          floor: floorIndex.get(String(f.id)), type: e.type, shape: e.shape, geometry: e.geometry,
          label: e.label, color: e.color, meta: e.meta, z_index: e.z_index,
        }))
      ),
      locations: this.locations.map((l) => ({
        product: prodIndex.get(String(l.product_id)), floor: floorIndex.get(String(l.floor_id)),
        x: l.x, y: l.y, rot: l.rot,
      })),
      stock: [] as unknown[],
      media: [] as unknown[],
    };
  }

  /** Download the bundle, mirroring api.exportStore's filename scheme. */
  exportDownload() {
    const blob = new Blob([JSON.stringify(this.exportBundle())], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const name = (this.store.name || 'sandbox').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    a.download = `${name}-storemap.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
}

/** Which shelf rect contains this published pin? Used once when copying a
 *  live store, so example sandboxes open with their items already owned. */
function shelfOwnerOf(loc: { x: number; y: number }, shelves: { id: string; geom: unknown }[]): string | null {
  for (const sh of shelves) {
    const r = sh.geom as { x: number; y: number; w: number; h: number; rot?: number };
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const a = (-(r.rot ?? 0) * Math.PI) / 180;
    const lx = r.w / 2 + (loc.x - cx) * Math.cos(a) - (loc.y - cy) * Math.sin(a);
    const ly = r.h / 2 + (loc.x - cx) * Math.sin(a) + (loc.y - cy) * Math.cos(a);
    if (lx >= -0.25 && lx <= r.w + 0.25 && ly >= -0.25 && ly <= r.h + 0.25) return sh.id;
  }
  return null;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Could not read that file'));
    r.readAsDataURL(file);
  });
}
