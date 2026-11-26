/**
 * SearchBox — the shopper search used by the store view and the homepage
 * hero: the field, the result-photos toggle, and the results dropdown
 * (highlighted match, where the item sits, keyboard navigation). Pure
 * presentation — the owner of the search owns the text, the open state and
 * what happens when a result is picked.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { HitFacing, ProductLocation, PublicStorePayload } from '../types';
import type { GroupPins } from '../lib/itemGroups';

/** One search result. `sub` is the grey line under the name. */
export interface SearchHit {
  product: PublicStorePayload['products'][number];
  /** the item is on the map (false = listed as out of stock) */
  located: boolean;
  /** the map pin a pick routes to (the item's group pin), null if none */
  focusId: string | null;
  /** where the item faces when the payload did not carry it (a catalogue item
   *  found by the server): its shelf and, for a generated item, its level and
   *  place along the shelf */
  facing?: HitFacing | null;
  sub: string[];
}

/** Products matching a query, best first (shortest names first — "Milk"
 *  before "Organic Whole Milk 1L Family Pack"), each with where it sits:
 *  its GROUP, since that is the pin the map shows for it. */
export function searchHits(data: PublicStorePayload, q: string, groupPins: GroupPins): SearchHit[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const floorName = (id: string) => data.floors.find((f) => f.id === id)?.name ?? '';
  const out: SearchHit[] = [];
  for (const product of data.products) {
    if (!`${product.name} ${product.brand} ${product.sku} ${product.category_name ?? ''}`.toLowerCase().includes(needle)) continue;
    const facings = data.locations.filter((l) => l.product_id === product.id);
    const first = facings[0];
    // a planogram-only item sits in its group — that is where a shopper goes
    const group = first ? groupPins.nameOf(first) : null;
    out.push({
      product,
      located: !!first,
      focusId: first ? groupPins.of(first).id : null,
      sub: [
        product.brand,
        product.price != null ? `$${product.price.toFixed(2)}` : '',
        group ? `in ${group}` : first ? floorName(first.floor_id) : '',
      ].filter(Boolean),
    });
  }
  return out.sort((a, b) => a.product.name.length - b.product.name.length);
}

/** Wrap the first case-insensitive match of `q` in <mark>. */
function highlight(text: string, q: string): ReactNode {
  if (!q) return text;
  const at = text.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + q.length)}</mark>
      {text.slice(at + q.length)}
    </>
  );
}

export default function SearchBox({
  value, onChange, hits, onPick, open, setOpen, placeholder, images, onToggleImages, label = 'Search an item',
  /** location id of the result the map is focused on — its row reads selected */
  focusedId,
}: {
  value: string;
  onChange: (v: string) => void;
  hits: SearchHit[];
  onPick: (hit: SearchHit) => void;
  /** whether the results dropdown is showing (the owner closes it on pick) */
  open: boolean;
  setOpen: (open: boolean) => void;
  placeholder: string;
  /** show each result's photo (the 🖼 toggle) */
  images: boolean;
  /** the 🖼 toggle; leave it out where photos are always on (the homepage) */
  onToggleImages?: () => void;
  label?: string;
  focusedId?: string | null;
}) {
  const [activeIdx, setActiveIdx] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);

  // close the results when clicking anywhere else
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open, setOpen]);

  // a fresh query restarts keyboard navigation at the top
  useEffect(() => setActiveIdx(-1), [value]);

  const photo = (p: SearchHit['product']) => p.image_crop_url || p.image_url;

  return (
    <div className="search-float" ref={rootRef}>
      <span className="icon">🔎</span>
      <input
        className="input"
        placeholder={placeholder}
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            onChange('');
            setOpen(false);
          } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            if (!hits.some((h) => h.located)) return;
            e.preventDefault();
            const dir = e.key === 'ArrowDown' ? 1 : -1;
            setOpen(true);
            // step to the next result a shopper can actually go to — an
            // out-of-stock row is not pickable, so the keys skip over it
            setActiveIdx((i) => {
              const from = i < 0 ? (dir > 0 ? -1 : 0) : i;
              for (let n = 1; n <= hits.length; n++) {
                const j = (from + dir * n + hits.length) % hits.length;
                if (hits[j].located) return j;
              }
              return i;
            });
          } else if (e.key === 'Enter') {
            const pick = hits[activeIdx] ?? hits.find((h) => h.located);
            if (pick?.located) onPick(pick);
          }
        }}
        aria-label={label}
        role="combobox"
        aria-expanded={open}
        aria-controls="search-results"
        aria-autocomplete="list"
      />
      {onToggleImages && (
        <button
          className={`search-img-toggle ${images ? 'active' : ''}`}
          aria-pressed={images}
          title={images ? 'Hide result photos' : 'Show result photos'}
          aria-label="Toggle result photos"
          onClick={onToggleImages}
        >
          🖼
        </button>
      )}
      {value && (
        <button className="search-clear" onClick={() => { onChange(''); setOpen(false); }} aria-label="Clear search">
          ✕
        </button>
      )}
      {open && (
        <div className="results-drop" id="search-results" role="listbox">
          {hits.length === 0 ? (
            <div className="no-results">{value.trim() ? `Nothing found for “${value.trim()}”.` : 'Start typing to find an item.'}</div>
          ) : (
            hits.map((h, idx) => {
              const active = idx === activeIdx;
              const rowClass = `result-item ${active ? 'kbd-active' : ''} ${h.focusId && h.focusId === focusedId ? 'selected' : ''}`;
              const name = highlight(h.product.name, value.trim());
              return h.located ? (
                <button
                  key={h.product.id}
                  role="option"
                  aria-selected={active}
                  className={rowClass}
                  ref={active ? (el) => el?.scrollIntoView?.({ block: 'nearest' }) : undefined}
                  onPointerEnter={() => setActiveIdx(idx)}
                  onClick={() => onPick(h)}
                >
                  {photo(h.product) && images ? (
                    <span className="rimg"><img src={photo(h.product)} alt="" loading="lazy" /></span>
                  ) : (
                    <span className="dot" style={{ background: h.product.category_color || '#2f6f3e' }} />
                  )}
                  <span className="rname">
                    <b>{name}</b>
                    <span>{h.sub.join(' · ')}</span>
                  </span>
                  <span className="rgo" aria-hidden>🧭</span>
                </button>
              ) : (
                <div key={h.product.id} className={`result-item noloc ${active ? 'kbd-active' : ''}`}>
                  {photo(h.product) && images && (
                    <span className="rimg"><img src={photo(h.product)} alt="" loading="lazy" /></span>
                  )}
                  <span className="rname">
                    <b>{name}</b>
                    <span>{[h.product.brand, 'out of stock'].filter(Boolean).join(' · ')}</span>
                  </span>
                  {!photo(h.product) && <span className="dot" style={{ background: h.product.category_color || '#2f6f3e' }} />}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
