/**
 * ShelfItemPicker — pick an existing store product to place onto a shelf,
 * opened from the planogram editor's "＋ Add item" toolbar button. Products
 * that already have a facing on this shelf are NOT listed — each item appears
 * once per group; more facings of an item are stocked one by one with its
 * facing's ＋ Add copy. Rendered as a Modal AFTER the ShelfDetail modal so it
 * stacks in front of the planogram popup (equal z-index, later DOM wins).
 * "＋ New item" hands off to the create-product flow, also in front of the
 * planogram.
 */
import { useMemo, useState } from 'react';
import { Modal } from './ui';
import type { Product } from '../types';

export default function ShelfItemPicker({
  products, onShelfProductIds, onPick, onCreateNew, onClose,
}: {
  products: Product[];
  /** product ids that already have a facing on this shelf — excluded */
  onShelfProductIds: Set<string>;
  onPick: (productId: string) => void;
  onCreateNew: () => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle
      ? products.filter((p) => `${p.name} ${p.brand} ${p.sku} ${p.category_name ?? ''}`.toLowerCase().includes(needle))
      : products;
    // items already on this shelf are in the group — never list repeats
    return list
      .filter((p) => !onShelfProductIds.has(p.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [products, q, onShelfProductIds]);

  return (
    <Modal title="Add item to this shelf" onClose={onClose} wide>
      <input
        className="input"
        placeholder="Find a product… name, brand, SKU"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Find a product"
        autoFocus
      />
      <div className="shelf-picker-list" role="listbox" aria-label="Store products">
        {filtered.length === 0 ? (
          <p className="muted" style={{ fontSize: 13, margin: '8px 0' }}>
            {q.trim()
              ? `Nothing matches “${q.trim()}”. Use ＋ New item to create it.`
              : 'Everything in the store is already on this shelf. Select a facing and use ＋ Add copy to stock a repeat.'}
          </p>
        ) : (
          filtered.slice(0, 400).map((p) => {
            return (
              <button key={p.id} type="button" role="option" aria-selected={false} className="shelf-picker-row" onClick={() => onPick(p.id)}>
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
            );
          })
        )}
      </div>
      <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
        Items already on this shelf are hidden — select one of their facings and use ＋ Add copy to stock a repeat.
      </p>
      <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
        <button type="button" className="btn" onClick={onCreateNew}>＋ New item</button>
        <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}
