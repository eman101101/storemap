/**
 * GroupCreatorModal — the "Add item group" dialog. You name the group (the
 * name becomes the shelf's label — groups are named by their owner shelf) and
 * add the items inside it: type brand-new ones or pick straight from the
 * store's catalogue. On confirm each item is placed on the shelf with ONE
 * facing — more facings are stocked one by one from the shelf's planogram
 * editor (＋ Add item / ＋ Add copy), never auto-multiplied.
 */
import { useMemo, useState } from 'react';
import { Field, Modal } from './ui';
import type { Category, Product } from '../types';

export interface GroupItemDraft {
  name: string;
  category_id: string | null;
  price: string; // '' = auto
  /** set when the item is an existing store product — it is reused, never re-created */
  productId?: string;
}

export default function GroupCreatorModal({
  shelfLabel, categories, products, shelfProductIds, onCreate, onClose,
}: {
  shelfLabel: string;
  categories: Category[];
  products: Product[];
  /** products already pinned on this shelf — they are in the group already */
  shelfProductIds: Set<string>;
  onCreate: (name: string, items: GroupItemDraft[]) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(shelfLabel);
  const [items, setItems] = useState<GroupItemDraft[]>([]);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');

  const draftIds = useMemo(() => new Set(items.map((it) => it.productId).filter(Boolean)), [items]);
  // the store catalogue, minus what the draft already holds and minus what is
  // already on this shelf — an item is listed at most once per group
  const storeItems = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle
      ? products.filter((p) => `${p.name} ${p.brand} ${p.sku} ${p.category_name ?? ''}`.toLowerCase().includes(needle))
      : products;
    return list
      .filter((p) => !draftIds.has(p.id) && !shelfProductIds.has(p.id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 400);
  }, [products, q, draftIds, shelfProductIds]);

  const setItem = (i: number, patch: Partial<GroupItemDraft>) =>
    setItems((prev) => prev.map((it, k) => (k === i ? { ...it, ...patch } : it)));
  const addNewRow = () =>
    setItems((prev) => [...prev, { name: '', category_id: categories[0]?.id ?? null, price: '' }]);
  const addStoreItem = (p: Product) =>
    setItems((prev) =>
      prev.some((it) => it.productId === p.id)
        ? prev
        : [...prev, { name: p.name, category_id: p.category_id ?? null, price: p.price != null ? String(p.price) : '', productId: p.id }]
    );
  const removeItem = (i: number) => setItems((prev) => prev.filter((_, k) => k !== i));

  const filled = items.filter((it) => it.name.trim());
  const canCreate = !!name.trim() && filled.length > 0;

  const submit = () => {
    if (!name.trim()) { setError('Give the group a name'); return; }
    if (!filled.length) { setError('Add at least one item'); return; }
    if (filled.some((it) => !it.productId && it.price !== '' && !(Number(it.price) >= 0))) {
      setError('Prices must be numbers');
      return;
    }
    onCreate(name.trim(), filled.map((it) => ({
      name: it.name.trim(),
      category_id: it.category_id || null,
      price: it.productId ? '' : it.price,
      ...(it.productId ? { productId: it.productId } : {}),
    })));
  };

  return (
    <Modal title="Add item group" onClose={onClose} wide>
      <p className="muted" style={{ fontSize: 12.5, margin: '0 0 10px' }}>
        The group's name becomes the shelf's label. Each item is placed with one facing —
        stock more facings one by one from the shelf's planogram (＋ Add item · ＋ Add copy).
      </p>
      <Field label="Group name">
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Breakfast cereals"
          autoFocus
        />
      </Field>
      <Field label={`Items (${filled.length})`}>
        <div className="group-items-list">
          {items.map((it, i) => (
            <div key={i} className="group-item-row" title={it.productId ? 'Existing store item — reused, not re-created' : undefined}>
              <input
                className="input"
                placeholder={`Item ${i + 1} name`}
                value={it.name}
                disabled={!!it.productId}
                onChange={(e) => setItem(i, { name: e.target.value })}
                aria-label={`Item ${i + 1} name`}
              />
              <select
                className="select"
                value={it.category_id ?? ''}
                disabled={!!it.productId}
                onChange={(e) => setItem(i, { category_id: e.target.value || null })}
                aria-label={`Item ${i + 1} category`}
              >
                <option value="">— no category —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <input
                className="input group-item-price"
                type="number"
                min="0"
                step="0.01"
                placeholder={it.productId ? 'stored $' : 'auto $'}
                value={it.price}
                disabled={!!it.productId}
                onChange={(e) => setItem(i, { price: e.target.value })}
                aria-label={`Item ${i + 1} price`}
              />
              <button
                type="button"
                className="route-badge-x"
                aria-label={`Remove item ${i + 1}`}
                onClick={() => removeItem(i)}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <button type="button" className="btn sm" onClick={addNewRow}>＋ New item</button>
        {shelfProductIds.size > 0 && (
          <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
            {shelfProductIds.size} item{shelfProductIds.size === 1 ? ' is' : 's are'} already on this shelf —
            they are in the group and are not listed again below.
          </p>
        )}
        <p className="muted" style={{ fontSize: 12, margin: '10px 0 4px' }}>Store items</p>
        <input
          className="input"
          placeholder="Find a store item… name, brand, SKU"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Find a store item"
        />
        <div className="shelf-picker-list" role="listbox" aria-label="Store items">
          {storeItems.length === 0 ? (
            <p className="muted" style={{ fontSize: 13, margin: '8px 0' }}>
              {q.trim() ? `Nothing matches “${q.trim()}”. Use ＋ New item to create it.` : 'No store items left to add — everything is in the group or on this shelf.'}
            </p>
          ) : (
            storeItems.map((p) => (
              <button key={p.id} type="button" role="option" aria-selected={false} className="shelf-picker-row" onClick={() => addStoreItem(p)}>
                {p.image_crop_url || p.image_url ? (
                  <img className="shelf-picker-thumb" src={p.image_crop_url || p.image_url} alt="" loading="lazy" />
                ) : (
                  <span className="dot" style={{ background: p.category_color || '#2f6f3e' }} />
                )}
                <span className="shelf-picker-name">
                  <b>{p.name}</b>
                  <span className="muted">
                    {[p.brand, p.price != null ? `$${p.price.toFixed(2)}` : '', p.category_name].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="shelf-picker-go" aria-hidden>＋</span>
              </button>
            ))
          )}
        </div>
      </Field>
      {error && <div className="error-note">{error}</div>}
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn primary" onClick={submit} disabled={!canCreate}>
          Add group to shelf
        </button>
      </div>
    </Modal>
  );
}
