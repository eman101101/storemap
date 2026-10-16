/**
 * StockPage — per-store stock tracking:
 *  · stock levels with adjust/count actions and a movement log
 *  · CSV import/export for whatever stock software you use
 *  · API keys so independent systems can use the StockTrack v1 API
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { Modal, Field } from './ui';
import type { ApiKeyRow, StockMovement, StockRow } from '../types';

export default function StockPage() {
  const { storeId } = useParams<{ storeId: string }>();
  const [stock, setStock] = useState<StockRow[] | null>(null);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [error, setError] = useState('');
  const [newKey, setNewKey] = useState<{ row: ApiKeyRow; key: string } | null>(null);
  const [csvOpen, setCsvOpen] = useState(false);

  const load = () => {
    if (!storeId) return;
    api.stock(storeId).then((r) => { setStock(r.stock); setMovements(r.movements); }).catch((e) => setError(e.message));
    api.apiKeys(storeId).then((r) => setKeys(r.keys.filter((k) => !k.revoked))).catch(() => {});
  };
  useEffect(load, [storeId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) {
    return (
      <main className="container">
        <div className="empty-state card"><h3>Couldn't load stock</h3><p>{error}</p>
          <Link className="btn" to="/dashboard">Back to stores</Link></div>
      </main>
    );
  }
  if (!stock) return <main className="container"><p className="muted">Loading…</p></main>;

  const lowCount = stock.filter((s) => s.reorder_point != null && (s.quantity ?? 0) <= s.reorder_point).length;

  return (
    <main className="container">
      <div className="page-head">
        <div>
          <h1>Stock</h1>
          <p className="muted" style={{ margin: 0 }}>
            Track inventory, move data in and out via CSV, and give other systems API access.
          </p>
        </div>
        <Link className="btn ghost sm" to="/dashboard">← Stores</Link>
      </div>

      <div className="grid-stores" style={{ gridTemplateColumns: '1fr' }}>
        {/* ------- Stock levels ------- */}
        <div className="card">
          <div className="row-between">
            <h3 style={{ margin: 0 }}>Stock levels</h3>
            {lowCount > 0 && <span className="badge">{lowCount} at or below reorder point</span>}
          </div>
          {stock.length === 0 ? (
            <p className="muted">Add products in the editor first.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="stock-table">
                <thead>
                  <tr><th>Product</th><th>SKU</th><th>In stock</th><th>Set count</th><th>±</th></tr>
                </thead>
                <tbody>
                  {stock.map((s) => (
                    <StockRowEl
                      key={s.product_id}
                      row={s}
                      onChanged={(level) => {
                        setStock((prev) => prev!.map((x) => (x.product_id === s.product_id ? { ...x, quantity: level.quantity } : x)));
                        load();
                      }}
                      onError={setError}
                      storeId={storeId!}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ------- CSV interchange ------- */}
        <div className="card">
          <div className="row-between">
            <h3 style={{ margin: 0 }}>Spreadsheet interchange</h3>
            <button className="btn sm" onClick={() => setCsvOpen(true)}>Import CSV</button>
          </div>
          <p className="muted" style={{ fontSize: 13 }}>
            Import products (and stock counts) by pasting CSV from any spreadsheet or system.
            Export any time with{' '}
            <code style={{ cursor: 'pointer' }} onClick={() => window.open(`/api/stores/${storeId}/catalog.csv`, '_blank')}>catalog.csv</code>.
          </p>
        </div>

        {/* ------- API keys ------- */}
        <div className="card">
          <ApiKeysSection storeId={storeId!} keys={keys} onNewKey={setNewKey} onChanged={load} />
        </div>

        {/* ------- Movements ------- */}
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Recent movements</h3>
          {movements.length === 0 ? (
            <p className="muted">No stock movements yet.</p>
          ) : (
            <table className="stock-table">
              <thead><tr><th>When</th><th>Product</th><th>Change</th><th>Now</th><th>Source</th></tr></thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id}>
                    <td>{new Date(m.created_at + 'Z').toLocaleString()}</td>
                    <td>{m.product_name}</td>
                    <td style={{ color: m.delta >= 0 ? '#2f6f3e' : '#c2453a' }}>{m.delta > 0 ? '+' : ''}{m.delta}</td>
                    <td>{m.resulting_quantity}</td>
                    <td><code>{m.source}</code>{m.reason ? ` · ${m.reason}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {newKey && (
        <Modal title="API key created" onClose={() => { setNewKey(null); load(); }}>
          <p className="muted">Copy it now — it is shown <b>only once</b>.</p>
          <code style={{ display: 'block', wordBreak: 'break-all', background: 'var(--bg, #f5f5f0)', padding: 10, borderRadius: 8 }}>
            {newKey.key}
          </code>
          <p className="muted" style={{ fontSize: 13 }}>
            Endpoints: <code>GET /api/v1/stock</code>, <code>POST /api/v1/stock/adjust</code>,{' '}
            <code>POST /api/v1/stock/set</code>, <code>GET /api/v1/map</code>. Auth header:{' '}
            <code>Authorization: Bearer …</code> or <code>X-API-Key: …</code>
          </p>
          <div className="modal-actions">
            <button className="btn primary" onClick={() => { setNewKey(null); load(); }}>Done</button>
          </div>
        </Modal>
      )}
      {csvOpen && (
        <CsvModal storeId={storeId!} onClose={() => setCsvOpen(false)} onDone={() => { setCsvOpen(false); load(); }} />
      )}
    </main>
  );
}

function StockRowEl({ row, storeId, onChanged, onError }: {
  row: StockRow; storeId: string; onChanged: (l: { quantity: number }) => void; onError: (m: string) => void;
}) {
  const [delta, setDelta] = useState('');
  const [count, setCount] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<{ level: { quantity: number } }>) => {
    setBusy(true);
    try { onChanged((await fn()).level); } catch (e) { onError(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  };

  return (
    <tr>
      <td>{row.name}{row.category_name ? <span className="muted"> · {row.category_name}</span> : ''}</td>
      <td><code>{row.sku || row.barcode || '—'}</code></td>
      <td><b>{row.quantity ?? 0}</b></td>
      <td>
        <span style={{ display: 'flex', gap: 4 }}>
          <input className="input" style={{ width: 70 }} type="number" min={0} placeholder={String(row.quantity ?? 0)} value={count} onChange={(e) => setCount(e.target.value)} />
          <button className="btn sm" disabled={busy || count === ''} onClick={async () => { await run(() => api.setStock(storeId, { product_id: row.product_id, quantity: Number(count) })); setCount(''); }}>Set</button>
        </span>
      </td>
      <td>
        <span style={{ display: 'flex', gap: 4 }}>
          <input className="input" style={{ width: 70 }} type="number" placeholder="±" value={delta} onChange={(e) => setDelta(e.target.value)} />
          <button className="btn sm" disabled={busy || delta === ''} onClick={async () => { await run(() => api.adjustStock(storeId, { product_id: row.product_id, delta: Number(delta) })); setDelta(''); }}>Apply</button>
        </span>
      </td>
    </tr>
  );
}

function CsvModal({ storeId, onClose, onDone }: { storeId: string; onClose: () => void; onDone: () => void }) {
  const [csv, setCsv] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api.importCsv(storeId, csv);
      setResult(`Imported ${r.imported} of ${r.total} rows`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Import products from CSV" onClose={onClose}>
      <p className="muted" style={{ fontSize: 13 }}>
        Columns: <code>name</code>, <code>sku</code>, <code>barcode</code>, <code>brand</code>, <code>price</code>,{' '}
        <code>quantity</code> (aliases like <code>Product Name</code>, <code>Stock</code>, <code>RRP</code> also work).
        Rows with a matching SKU update the existing product.
      </p>
      {result ? (
        <>
          <p>{result}</p>
          <div className="modal-actions"><button className="btn primary" onClick={onDone}>Done</button></div>
        </>
      ) : (
        <form onSubmit={submit}>
          <Field label="Paste CSV contents">
            <textarea className="input" rows={8} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={'sku,name,quantity,price\nMILK-2,Oat Milk 1L,12,2.50'} />
          </Field>
          {error && <div className="error-note">{error}</div>}
          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary" disabled={busy || !csv.trim()}>{busy ? 'Importing…' : 'Import'}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function ApiKeysSection({ storeId, keys, onNewKey, onChanged }: {
  storeId: string; keys: ApiKeyRow[]; onNewKey: (k: { row: ApiKeyRow; key: string }) => void; onChanged: () => void;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.createApiKey(storeId, name || 'API key');
      onNewKey({ row: r.key, key: r.api_key });
      setName('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h3 style={{ marginTop: 0 }}>Independent tracking API (StockTrack)</h3>
      <p className="muted" style={{ fontSize: 13 }}>
        Create a key and point any other system — another POS, a spreadsheet plugin, a robot,
        another StoreMap store — at <code>/api/v1</code> to read and update this store's stock.
      </p>
      <form onSubmit={create} style={{ display: 'flex', gap: 6, maxWidth: 420 }}>
        <input className="input" placeholder="Key name, e.g. “Front POS”" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn primary" disabled={busy}>Create key</button>
      </form>
      {keys.length > 0 && (
        <table className="stock-table" style={{ marginTop: 10 }}>
          <thead><tr><th>Name</th><th>Key</th><th>Created</th><th>Last used</th><th></th></tr></thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id}>
                <td>{k.name}</td>
                <td><code>{k.key_prefix}…</code></td>
                <td>{new Date(k.created_at + 'Z').toLocaleDateString()}</td>
                <td>{k.last_used_at ? new Date(k.last_used_at + 'Z').toLocaleString() : 'never'}</td>
                <td><button className="btn sm danger" onClick={async () => { await api.revokeApiKey(k.id); onChanged(); }}>Revoke</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
