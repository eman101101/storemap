/**
 * Stock-software adapter framework.
 *
 * Each adapter normalises a third-party inventory/POS system to a common
 * product shape: { sku, barcode, name, brand, price, quantity }.
 * Adapters receive a `fetchImpl` (defaults to global fetch) so tests can
 * inject a mock transport.
 */
import { parseCsv } from './csv.js';

const J = (r) => r.json();

/** Helper: GET with headers, throw on non-2xx with a readable message. */
async function getJson(url, headers = {}, fetchImpl = fetch) {
  const res = await fetchImpl(url, { headers: { accept: 'application/json', ...headers } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText} from ${new URL(url).host}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

export const PROVIDERS = {
  square: {
    name: 'Square',
    blurb: 'Square POS catalog + inventory counts',
    fields: [
      { key: 'accessToken', label: 'Access token', type: 'password', required: true },
      { key: 'locationId', label: 'Location ID (optional)', type: 'text', required: false },
      { key: 'environment', label: 'Environment', type: 'select', options: ['production', 'sandbox'], default: 'production' },
    ],
    async fetchProducts(creds, fetchImpl = fetch) {
      const base = creds.environment === 'sandbox' ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com';
      const headers = { authorization: `Bearer ${creds.accessToken}`, 'Square-Version': '2024-10-17' };
      const locQs = creds.locationId ? `&location_ids=${encodeURIComponent(creds.locationId)}` : '';
      const out = [];
      let cursor = '';
      do {
        const data = await getJson(
          `${base}/v2/catalog/list?types=ITEM${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
          headers,
          fetchImpl
        );
        for (const obj of data.objects ?? []) {
          const variation = obj.item_data?.variations?.[0];
          out.push({
            sku: variation?.item_variation_data?.sku || variation?.id || '',
            name: obj.item_data?.name || '',
            brand: '',
            price: variation?.item_variation_data?.price_money
              ? variation.item_variation_data.price_money.amount / 100
              : null,
            quantity: undefined,
          });
        }
        cursor = data.cursor || '';
      } while (cursor);

      // Inventory counts are a separate endpoint keyed by variation id.
      const inv = await getJson(
        `${base}/v2/inventory?types=ITEM_VARIATION${locQs}`,
        headers,
        fetchImpl
      ).catch(() => ({ counts: [] }));
      const byVariation = new Map();
      for (const c of inv.counts ?? []) {
        if (c.state === 'IN_STOCK') {
          byVariation.set(c.catalog_object_id, (byVariation.get(c.catalog_object_id) || 0) + Number(c.quantity || 0));
        }
      }
      // Re-list items to map variation ids → sku rows is costly; match by variation id stored as sku fallback.
      return out; // Square sync imports the catalog; quantities via Generic/StockTrack unless mapped by id
    },
  },

  shopify: {
    name: 'Shopify',
    blurb: 'Shopify Admin API products & inventory',
    fields: [
      { key: 'shopDomain', label: 'Shop domain (myshop.myshopify.com)', type: 'text', required: true },
      { key: 'accessToken', label: 'Admin API access token', type: 'password', required: true },
    ],
    async fetchProducts(creds, fetchImpl = fetch) {
      const host = String(creds.shopDomain).replace(/^https?:\/\//, '').replace(/\/+$/, '');
      const headers = { 'X-Shopify-Access-Token': creds.accessToken };
      const out = [];
      let url = `https://${host}/admin/api/2024-10/products.json?limit=250`;
      while (url) {
        const res = await fetchImpl(url, { headers: { ...headers, accept: 'application/json' } });
        if (!res.ok) throw new Error(`Shopify ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
        const data = await res.json();
        for (const p of data.products ?? []) {
          for (const v of p.variants ?? []) {
            out.push({
              sku: v.sku || String(v.id),
              barcode: v.barcode || '',
              name: v.title === 'Default Title' ? p.title : `${p.title} — ${v.title}`,
              brand: p.vendor || '',
              price: v.price ? Number(v.price) : null,
              quantity: v.inventory_quantity ?? undefined,
            });
          }
        }
        const link = res.headers.get('link') || '';
        const next = link.match(/<([^>]+)>;\s*rel="next"/);
        url = next ? next[1] : null;
      }
      return out;
    },
  },

  lightspeed: {
    name: 'Lightspeed Retail (X-Series / Vend)',
    blurb: 'Lightspeed X-Series products & inventory',
    fields: [
      { key: 'domainPrefix', label: 'Domain prefix (from your .vendhq.com URL)', type: 'text', required: true },
      { key: 'accessToken', label: 'Personal access token', type: 'password', required: true },
    ],
    async fetchProducts(creds, fetchImpl = fetch) {
      const base = `https://${creds.domainPrefix}.vendhq.com/api`;
      const headers = { authorization: `Bearer ${creds.accessToken}` };
      const out = [];
      let page = 1;
      for (;;) {
        const data = await getJson(`${base}/2.0/products?page_size=200&page=${page}`, headers, fetchImpl);
        for (const p of data.data ?? []) {
          out.push({
            sku: p.sku || p.id,
            barcode: p.barcode || '',
            name: p.name || '',
            brand: p.brand_name || '',
            price: p.price ? Number(p.price) : null,
            quantity: p.inventory?.[0]?.count != null ? Number(p.inventory[0].count) : undefined,
          });
        }
        const links = data.links || {};
        if (!links?.next) break;
        page += 1;
        if (page > 100) break;
      }
      return out;
    },
  },

  clover: {
    name: 'Clover',
    blurb: 'Clover merchants inventory (REST)',
    fields: [
      { key: 'accessToken', label: 'API token', type: 'password', required: true },
      { key: 'merchantId', label: 'Merchant ID', type: 'text', required: true },
      { key: 'environment', label: 'Environment', type: 'select', options: ['production', 'sandbox'], default: 'production' },
    ],
    async fetchProducts(creds, fetchImpl = fetch) {
      const base = creds.environment === 'sandbox' ? 'https://apisandbox.dev.clover.com' : 'https://api.clover.com';
      const headers = { authorization: `Bearer ${creds.accessToken}` };
      const data = await getJson(
        `/v3/merchants/${encodeURIComponent(creds.merchantId)}/items?limit=250`,
        headers,
        fetchImpl
      );
      return (data.elements ?? []).map((it) => ({
        sku: it.sku || it.id,
        barcode: it.barcode || '',
        name: it.name || '',
        brand: '',
        price: it.price != null ? it.price / 100 : null,
        quantity: it.stockCount != null ? Number(it.stockCount) : undefined,
      }));
    },
  },

  katana: {
    name: 'Katana MRP',
    blurb: 'Katana cloud inventory',
    fields: [
      { key: 'apiToken', label: 'API token', type: 'password', required: true },
    ],
    async fetchProducts(creds, fetchImpl = fetch) {
      const data = await getJson(
        'https://api.katanamrp.com/v1/variants?limit=250',
        { authorization: `Bearer ${creds.apiToken}` },
        fetchImpl
      );
      return (data.data ?? []).map((v) => ({
        sku: v.sku || String(v.id),
        name: v.name || '',
        brand: '',
        price: v.sales_price != null ? Number(v.sales_price) : null,
        quantity: v.in_stock != null ? Number(v.in_stock) : undefined,
      }));
    },
  },

  zoho: {
    name: 'Zoho Inventory',
    blurb: 'Zoho Inventory items',
    fields: [
      { key: 'organizationId', label: 'Organization ID', type: 'text', required: true },
      { key: 'accessToken', label: 'OAuth access token', type: 'password', required: true },
      { key: 'region', label: 'Region', type: 'select', options: ['com', 'eu', 'in'], default: 'com' },
    ],
    async fetchProducts(creds, fetchImpl = fetch) {
      const out = [];
      let page = 1;
      for (;;) {
        const data = await getJson(
          `https://www.zohoinventory.${creds.region || 'com'}/api/v1/items?organization_id=${encodeURIComponent(creds.organizationId)}&page=${page}&per_page=200`,
          { authorization: `Zoho-oauthtoken ${creds.accessToken}` },
          fetchImpl
        );
        for (const it of data.items ?? []) {
          out.push({
            sku: it.sku || String(it.item_id),
            barcode: it.upc || it.ean || '',
            name: it.name || '',
            brand: it.brand || '',
            price: it.rate != null ? Number(it.rate) : null,
            quantity: it.stock_on_hand != null ? Number(it.stock_on_hand) : undefined,
          });
        }
        if (!data.page_context?.has_more_page || page > 100) break;
        page += 1;
      }
      return out;
    },
  },

  erpnext: {
    name: 'ERPNext',
    blurb: 'ERPNext Stock Manager items',
    fields: [
      { key: 'baseUrl', label: 'Site URL (https://erp.example.com)', type: 'text', required: true },
      { key: 'apiSecret', label: 'API secret', type: 'password', required: true },
      { key: 'apiKey', label: 'API key', type: 'text', required: true },
    ],
    async fetchProducts(creds, fetchImpl = fetch) {
      const base = String(creds.baseUrl).replace(/\/+$/, '');
      const data = await getJson(
        `${base}/api/resource/Item?limit_page_length=0&fields=["item_code","item_name","stock_uom","item_group","standard_rate","openings"]`,
        { authorization: `token ${creds.apiKey}:${creds.apiSecret}` },
        fetchImpl
      );
      return (data.data ?? []).map((it) => ({
        sku: it.item_code,
        name: it.item_name || it.item_code,
        brand: it.item_group || '',
        price: it.standard_rate != null ? Number(it.standard_rate) : null,
        quantity: undefined,
      }));
    },
  },

  csv: {
    name: 'CSV file',
    blurb: 'Paste or upload a CSV export from any system',
    fields: [],
    /** csv "fetchProducts" gets rows directly via syncFromCsv() in the route. */
    async fetchProducts() {
      throw new Error('Use CSV upload');
    },
  },

  stocktrack: {
    name: 'StockTrack (StoreMap)',
    blurb: 'Another StoreMap store’s own independent tracking API — point it at any StockTrack endpoint',
    fields: [
      { key: 'baseUrl', label: 'Base URL (https://…)', type: 'text', required: true },
      { key: 'apiKey', label: 'API key (skm_…)', type: 'password', required: true },
    ],
    async fetchProducts(creds, fetchImpl = fetch) {
      const base = String(creds.baseUrl).replace(/\/+$/, '');
      return getJson(`${base}/api/v1/stock?include_products=1`, { 'x-api-key': creds.apiKey }, fetchImpl)
        .then((d) =>
          (d.items ?? []).map((it) => ({
            sku: it.sku || '',
            barcode: it.barcode || '',
            name: it.name || '',
            brand: '',
            price: it.price ?? null,
            quantity: it.quantity ?? undefined,
          }))
        );
    },
  },
};

/** Pull raw rows out of a CSV payload using the common column names. */
export function rowsFromCsv(text) {
  return parseCsv(text).map((r) => ({
    sku: r.sku || r.SKU || r.item_code || '',
    barcode: r.barcode || r.upc || r.ean || '',
    name: r.name || r.product_name || r.title || '',
    brand: r.brand || r.manufacturer || '',
    price: r.price != null && r.price !== '' ? Number(r.price) : r.rrp ? Number(r.rrp) : null,
    quantity: r.quantity != null && r.quantity !== '' ? Number(r.quantity) : r.stock != null ? Number(r.stock) : undefined,
  }));
}

export function providerList() {
  return Object.entries(PROVIDERS).map(([id, p]) => ({
    id,
    name: p.name,
    blurb: p.blurb,
    fields: p.fields,
  }));
}
