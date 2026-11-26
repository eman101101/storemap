/** Shared types mirroring the backend API rows. */

export interface User {
  id: string;
  email: string;
  name: string;
  avatar_url: string;
  provider: string;
  /** Pay-as-you-go photo storage: bytes used vs quota (charged by the MBs
   *  of images stored). The free plan includes ≈ 1000 photos (~200 MB). */
  photo_bytes_used?: number;
  photo_bytes_quota?: number;
}

export interface AuthInfo {
  user: User | null;
  providers: { google: boolean; apple: boolean; facebook: boolean; email: boolean; dev: boolean };
}

export interface Store {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  address: string;
  description: string;
  phone: string;
  website: string;
  hours: string;
  logo_url: string;
  is_public: boolean;
  /** 'free' | 'pro' — pro unlocks paid-tier features on hosted instances. */
  plan: string;
  /** Canonical public link (server-built from PUBLIC_BASE_URL) — QR codes encode this. */
  shareUrl?: string;
  entitlements?: { productImages: boolean };
  created_at: string;
  updated_at: string;
}

export interface StoreSummary extends Store {
  floor_count?: number;
  product_count?: number;
  views?: number;
}

export interface Floor {
  id: string;
  store_id: string;
  name: string;
  level: number;
  width_m: number;
  height_m: number;
  background_url: string;
}

export type ElementType = 'wall' | 'shelf' | 'aisle' | 'zone' | 'entrance' | 'exit' | 'poi';
export type ElementShape = 'rect' | 'polygon' | 'polyline' | 'point';

export interface RectGeom { x: number; y: number; w: number; h: number; rot: number }
export interface PointGeom { x: number; y: number }
export type PolyGeom = [number, number][];

export interface MapElementRow {
  id: string;
  floor_id: string;
  type: ElementType;
  shape: ElementShape;
  geometry: string; // JSON
  label: string;
  color: string;
  meta: string;
  z_index: number;
}

/** Element with geometry parsed into a typed shape. */
export interface MapElement extends Omit<MapElementRow, 'geometry'> {
  geom: RectGeom | PointGeom | PolyGeom;
}

export function rectGeom(el: MapElement): RectGeom | null {
  return isRect(el.geom) ? el.geom : null;
}
export function isRect(g: unknown): g is RectGeom {
  return typeof g === 'object' && g !== null && 'w' in g && 'h' in g && 'rot' in g;
}
export function isPoint(g: unknown): g is PointGeom {
  return typeof g === 'object' && g !== null && 'x' in g && 'y' in g && !('w' in g) && !Array.isArray(g);
}
export function isPoly(g: unknown): g is PolyGeom {
  return Array.isArray(g);
}

export function parseElement(row: MapElementRow): MapElement {
  let geom: unknown;
  try {
    geom = JSON.parse(row.geometry);
  } catch {
    geom = { x: 0, y: 0 };
  }
  return { ...row, geom: geom as RectGeom | PointGeom | PolyGeom };
}

export function elementToRow(el: MapElement): MapElementRow {
  return { ...el, geometry: JSON.stringify(el.geom) };
}

export interface Category {
  id: string;
  store_id: string;
  name: string;
  color: string;
  icon: string;
}

export interface Product {
  id: string;
  store_id: string;
  category_id: string | null;
  name: string;
  brand: string;
  sku: string;
  barcode: string;
  description: string;
  price: number | null;
  image_url: string;
  /** owner-cropped variant — the planogram tiles show this by default */
  image_crop_url: string;
  category_name?: string;
  category_color?: string;
}

export interface ProductLocation {
  id: string;
  product_id: string;
  floor_id: string;
  x: number;
  y: number;
  rot: number;
  meta: string;
  /** Persisted pin→shelf association (mirrored in meta.shelfId). */
  shelfId?: string | null;
}

/** Group-model flags on a location's meta — one `groupPin` per shelf group
 *  (the titled map pin, sized to the group) and `groupOnly` on planogram-only
 *  facings that never draw as pins. The whole app keys off these two flags. */
export function locationFlags(l: { meta?: string | null }): { groupPin: boolean; groupOnly: boolean } {
  try {
    const m = JSON.parse(l.meta || '{}');
    return { groupPin: !!m.groupPin, groupOnly: !!m.groupOnly };
  } catch {
    return { groupPin: false, groupOnly: false };
  }
}

/** A group's display name: the owner shelf can carry a dedicated group name
 *  (meta.groupName) defined independently of the shelf's own label — renaming
 *  one never renames the other. Falls back to the shelf label. */
export function groupDisplayName(shelf: { label: string; meta?: string } | null | undefined): string | null {
  if (!shelf) return null;
  try {
    const m = JSON.parse(shelf.meta || '{}');
    if (typeof m.groupName === 'string' && m.groupName.trim()) return m.groupName;
  } catch { /* fall through to the label */ }
  return shelf.label || null;
}

export type MemberRole = 'owner' | 'manager' | 'stock' | 'viewer';

export interface StoreMember {
  user_id: string;
  email: string;
  name: string;
  role: MemberRole;
  joined_at?: string;
}

export interface StoreFull {
  store: Store;
  role?: MemberRole;
  floors: Floor[];
  elements: MapElementRow[];
  categories: Category[];
  products: Product[];
  locations: ProductLocation[];
}

/**
 * A store's generated catalogue once one is loaded (the example stores carry
 * 120,000 / 40,000 / 8,000 SKUs). Far too big to ship with the map, so the
 * payload holds the store's own demo items only and this record instead: the
 * viewer searches through the API and asks each shelf for a window.
 */
export interface CatalogInfo {
  /** SKUs in the whole store, the demo items included */
  products: number;
  /** the first SKU of the generated part (the demo items' SKUs sort before it) */
  fromSku: string;
  locations: number;
  version: number;
}

export interface PublicStorePayload {
  store: Omit<Store, 'owner_id' | 'is_public'>;
  floors: Floor[];
  elements: MapElementRow[];
  categories: Category[];
  products: Product[];
  locations: ProductLocation[];
  /** set when a generated catalogue is loaded behind this store */
  catalog?: CatalogInfo | null;
}

/** A facing with its product, as the shelf-window and product routes return them. */
export interface ShelfWindowSlot {
  location: ProductLocation;
  product: Product;
}

/**
 * The stretch of one shelf around a place: a few facings either side on
 * every level — not the whole shelf, which may hold thousands.
 */
export interface ShelfWindow {
  shelfId: string;
  /** the place asked for, 0..1 from the left end */
  u: number;
  /** the stretch actually covered, 0..1 from the left end */
  from: number;
  to: number;
  /** how many facings each level of the shelf carries */
  levels: { level: number; count: number }[];
  slots: ShelfWindowSlot[];
}

/** A product with everywhere it faces in the store. */
export interface ProductFacings {
  product: Product;
  facings: ShelfWindowSlot[];
}

/** Where a search hit faces — the shelf it is on and, for a generated item,
 *  its level and place along the shelf. */
export interface HitFacing {
  shelfId: string | null;
  shelfLabel: string | null;
  level: number | null;
  u: number | null;
}

export interface SearchResult {
  id: string;
  name: string;
  brand: string;
  sku: string;
  price: number | null;
  image_url: string;
  category_name: string;
  category_color: string;
  floor_id: string | null;
  x: number | null;
  y: number | null;
  floor_name: string | null;
  /** the facing's meta and its shelf's title (stores with a loaded catalogue) */
  location_meta?: string | null;
  shelf_label?: string | null;
}

/* ---------------- stock tracking ---------------- */

export interface StockRow {
  product_id: string;
  name: string;
  sku: string;
  barcode: string | null;
  category_name: string | null;
  quantity: number | null;
  reorder_point: number | null;
  updated_at: string | null;
}

export interface StockMovement {
  id: string;
  product_id: string;
  product_name: string;
  delta: number;
  resulting_quantity: number;
  reason: string;
  source: string;
  created_at: string;
}

export interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked?: number;
}

export interface ProviderField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'select';
  required?: boolean;
  options?: string[];
  default?: string;
}

