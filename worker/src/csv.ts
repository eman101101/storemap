/** Minimal RFC-4180-ish CSV interchange (port of backend/src/lib/stocksoft/csv.js). */

interface CsvRow {
  [key: string]: string;
}

/** Cap on imported rows — a runaway paste must not hammer D1 for minutes. */
export const MAX_CSV_ROWS = 5000;

export function parseCsv(text: unknown): CsvRow[] {
  const s = String(text ?? '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const pushRow = () => {
    if (!row.some((f) => f !== '')) return;
    rows.push(row);
    if (rows.length > MAX_CSV_ROWS) throw new Error(`CSV import is capped at ${MAX_CSV_ROWS} rows`);
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      pushRow();
      row = [];
    } else field += c;
  }
  row.push(field);
  pushRow();

  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  return rows.slice(1).map((r) => {
    const obj: CsvRow = {};
    header.forEach((h, i) => (obj[h] = (r[i] ?? '').trim()));
    return obj;
  });
}

/** Serialise rows of objects to CSV using the union of keys (first row's order first). */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const esc = (v: unknown): string => {
    const s = v === null || v === undefined ? '' : String(v);
    // CSV formula injection: a leading =+-@ would execute as a formula in
    // Excel/Sheets — prefix it with a quote so it stays plain text.
    const guarded = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\r\n');
}

/** Map tolerant CSV headers onto the common product shape. */
export function rowsFromCsv(text: unknown): Record<string, unknown>[] {
  return parseCsv(text).map((r: Record<string, string>) => ({
    sku: r.sku || r.SKU || r.item_code || '',
    barcode: r.barcode || r.upc || r.ean || '',
    name: r.name || r.product_name || r.title || '',
    brand: r.brand || r.manufacturer || '',
    price: r.price != null && r.price !== '' ? Number(r.price) : r.rrp ? Number(r.rrp) : null,
    quantity:
      r.quantity != null && r.quantity !== '' ? Number(r.quantity) : r.stock != null ? Number(r.stock) : undefined,
  }));
}
