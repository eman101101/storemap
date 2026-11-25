/**
 * Types for the Node seeder's spec module, so the Worker's parity test
 * (worker/test/seed.test.ts) can import it and hold both seeders to the same
 * example maps.
 */
export interface NodeSpec {
  slug: string;
  name: string;
  w: number;
  h: number;
  skuPrefix: string;
  skuPad?: number;
  elements: { type: string; shape: string; geometry: unknown; label: string; color?: string; meta?: string }[];
  categories: { name: string; color: string; icon: string }[];
  products: { name: string; category: string; brand: string; image?: string }[];
  locations: {
    product: number;
    x: number;
    y: number;
    level?: number;
    w?: number;
    pinW?: number;
    pinH?: number;
    groupOnly?: number;
    groupPin?: number;
  }[];
}

export const PHOTOS: Record<string, string>;
export function walmartSpec(): NodeSpec;
export function homeDepotSpec(): NodeSpec;
export function cornerStoreSpec(): NodeSpec;
export function stockEverything(spec: NodeSpec): number;
