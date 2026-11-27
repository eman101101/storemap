/**
 * SearchBox — the shopper search used by the store view and the homepage
 * hero: the field, the result-photos toggle, and the results dropdown
 * (highlighted match, where the item sits, keyboard navigation). Where the
 * owner passes `sections`, the store's own places — its aisles, departments,
 * areas and shelf groups — answer above the items. Pure presentation — the
 * owner of the search owns the text, the open state and what happens when a
 * result is picked.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { HitFacing, ProductLocation, PublicStorePayload } from '../types';
import type { GroupPins } from '../lib/itemGroups';
import { SECTION_KIND, type Section } from '../lib/sections';

/** One row of the results dropdown: a place in the store, or an item. */
type Row = { kind: 'section'; section: Section } | { kind: 'hit'; hit: SearchHit };
const pickable = (row: Row) => row.kind === 'section' || row.hit.located;

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
  /** the store's sections answering the query, best first — listed above the items */
  sections = [],
  onPickSection,
  /** key of the section the map is on — its row reads selected */
  activeSectionKey = null,
}: {
  value: string;
  onChange: (v: string) => void;
  hits: SearchHit[];
  onPick: (hit: SearchHit) => void;
  sections?: Section[];
  onPickSection?: (section: Section) => void;
  activeSectionKey?: string | null;
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

  // the list the arrow keys step down: the store's places, then the items
  const rows: Row[] = [...sections.map((section) => ({ kind: 'section' as const, section })), ...hits.map((hit) => ({ kind: 'hit' as const, hit }))];
  const step = (dir: 1 | -1) =>
    setActiveIdx((i) => {
      const from = i < 0 ? (dir > 0 ? -1 : 0) : i;
      for (let n = 1; n <= rows.length; n++) {
        const j = (from + dir * n + rows.length) % rows.length;
        if (pickable(rows[j])) return j;
      }
      return i;
    });
  const pick = (row: Row | undefined) => {
    if (!row || !pickable(row)) return;
    if (row.kind === 'section') onPickSection?.(row.section);
    else onPick(row.hit);
  };

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
            if (!rows.some(pickable)) return;
            e.preventDefault();
            setOpen(true);
            // step to the next row a shopper can actually go to — an
            // out-of-stock item is not pickable, so the keys skip over it
            step(e.key === 'ArrowDown' ? 1 : -1);
          } else if (e.key === 'Enter') {
            // the row the keys are on, else the first a shopper can go to
            pick(rows[activeIdx] ?? rows.find(pickable));
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
          {rows.length === 0 ? (
            <div className="no-results">{value.trim() ? `Nothing found for “${value.trim()}”.` : 'Start typing to find an item or a place.'}</div>
          ) : (
            rows.map((row, idx) => {
              const active = idx === activeIdx;
              const rowClass = `result-item ${active ? 'kbd-active' : ''}`;
              const scroll = active ? (el: HTMLButtonElement | null) => el?.scrollIntoView?.({ block: 'nearest' }) : undefined;
              if (row.kind === 'section') {
                const s = row.section;
                // a place in the store: a square swatch in its colour (items have a round dot), what it is on the right
                return (
                  <button
                    key={s.key}
                    role="option"
                    aria-selected={active}
                    className={`${rowClass} section-item ${s.key === activeSectionKey ? 'selected' : ''}`}
                    ref={scroll}
                    onPointerEnter={() => setActiveIdx(idx)}
                    onClick={() => pick(row)}
                  >
                    <span className="swatch" style={{ background: s.color }} aria-hidden />
                    <span className="rname">
                      <b>{highlight(s.name, value.trim())}</b>
                      {s.sub.length > 0 && <span>{s.sub.join(' · ')}</span>}
                    </span>
                    <span className="rkind">{SECTION_KIND[s.kind]}</span>
                    <span className="rgo" aria-hidden>🧭</span>
                  </button>
                );
              }
              const h = row.hit;
              const selected = h.focusId && h.focusId === focusedId;
              const name = highlight(h.product.name, value.trim());
              return h.located ? (
                <button
                  key={h.product.id}
                  role="option"
                  aria-selected={active}
                  className={`${rowClass} ${selected ? 'selected' : ''}`}
                  ref={scroll}
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
