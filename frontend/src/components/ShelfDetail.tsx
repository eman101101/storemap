/**
 * ShelfDetail — what the shopper/owner sees when they tap a shelf on the map:
 * a front elevation of the real shelf (bays + levels) with each product's
 * facing placed where its map pin puts it. Planograms are ONE shelf face —
 * no side splitting. Three view modes via the toggle: the schematic diagram,
 * photos (image + name strip), and image tiles — the photo IS the facing,
 * edge to edge, with details shown in the bottom panel on selection. The
 * owner's choice is persisted per shelf (meta.planogramView) and shoppers
 * can still override it for their session.
 *
 * Selecting a facing (either mode) shows its details in the bottom panel —
 * product name/price/brand/category/description plus its bay + row, and in
 * the editor the facing controls (width, row, add copy, remove). A searched
 * product's facing gets a pulsing orange border (highlightLocationId) so the
 * shopper can spot it on the shelf.
 *
 * Editor mode (editing prop): facings are also draggable — drag to another
 * spot on the planogram. Row count and the shelf's length / depth are
 * editable too, so the drawing always matches the map.
 *
 * PlanogramSvg is the drawing itself, exported so other surfaces (the
 * homepage planogram example) can render a planogram inline.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from './ui';
import type { MapElement, Product } from '../types';
import { compactFilledLayout, computeShelfLayout, shelfPlanogramView, type PlanogramView, type ShelfLayout, type ShelfPin, type ShelfSlot } from '../lib/shelfLayout';

const M = 46; // pixels per metre of shelf width in the drawing
const FRAME = 10; // frame thickness in px

type ViewMode = PlanogramView;

/** The photo a planogram tile shows: the owner's cropped variant by default,
 *  falling back to the full product photo. */
const productPhoto = (p: Product) => p.image_crop_url || p.image_url;

/** The planogram drawing for one shelf face (bays + levels from the layout). */
export function PlanogramSvg({
  layout, mode, editing, selectedId, onSelectFacing, onMoveFacing, highlightLocationId,
}: {
  layout: ShelfLayout;
  mode: ViewMode;
  /** editor mode: facings are clickable + draggable */
  editing?: boolean;
  selectedId?: string | null;
  onSelectFacing?: (locationId: string | null) => void;
  onMoveFacing?: (locationId: string, u: number, level: number) => void;
  /** the searched/focused facing — drawn with a pulsing orange border */
  highlightLocationId?: string | null;
}) {
  // one row height for EVERY view mode, so the drawing never resizes when the
  // owner toggles between diagram / photos / image tiles (meta.rowH, px)
  const levelH = layout.meta.rowH;
  const widthPx = Math.max(240, Math.min(560, layout.width * M));
  const heightPx = layout.levels * levelH + FRAME * 2;
  const pxPerM = widthPx / layout.width;
  const svgRef = useRef<SVGSVGElement>(null);
  // live drag preview: the dragged facing renders at these values until commit
  const [drag, setDrag] = useState<{ locationId: string; u: number; level: number; moved: boolean } | null>(null);
  const dragBase = useRef<{ u: number; level: number; px: number; py: number } | null>(null);
  // a just-finished drag suppresses the svg's click-deselect, so the moved
  // facing STAYS selected after you let go
  const lastDragAt = useRef(0);

  const bayEdges = layout.bays.map((b) => b.from);
  // clip-path ids are document-global — namespace per shelf so multiple
  // rendered planograms (the Landing demo pair) can't cross-clip each other
  const clipBase = `pf-${(layout.shelfId || 'x').replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const slotBox = (s: { u: number; facingWidth: number; level: number }) => {
    // photos/images render wider than their literal facing when the facing is
    // tiny, so an image is never a sliver — dense shelves just overlap slightly
    const min = editing ? 24 : 44;
    const w = Math.max(min, s.facingWidth * pxPerM);
    const x = s.u * widthPx - w / 2;
    const y = FRAME + (layout.levels - s.level) * levelH + 8;
    return { x: Math.max(2, Math.min(widthPx - w - 2, x)), y, w, h: levelH - 18 };
  };

  const flatSlots: { slot: ShelfSlot; box: ReturnType<typeof slotBox> }[] = useMemo(
    () =>
      layout.bays.flatMap((bay) =>
        bay.slots.map((slot) => ({
          slot,
          box: slotBox(drag && drag.locationId === slot.locationId ? { ...slot, u: drag.u, level: drag.level } : slot),
        }))
      ),
    // eslint-disable-line react-hooks/exhaustive-deps
    [layout, mode, editing, drag]
  );

  /** Drag a facing: horizontal → along-shelf position, vertical → row. */
  const onPointerDown = (e: React.PointerEvent, s: ShelfSlot) => {
    if (!editing) return;
    e.preventDefault();
    // capture on the SVG root: it survives the re-renders a drag triggers
    // (capturing on the facing itself loses the pointer when facings re-sort
    // mid-drag — items stopped moving to the left across a neighbour)
    svgRef.current?.setPointerCapture?.(e.pointerId);
    dragBase.current = { u: s.u, level: s.level, px: e.clientX, py: e.clientY };
    setDrag({ locationId: s.locationId, u: s.u, level: s.level, moved: false });
    onSelectFacing?.(s.locationId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const base = dragBase.current;
    if (!base || !drag) return;
    const du = (e.clientX - base.px) / widthPx;
    // screen-up = a higher row on the planogram (level 1 is the bottom board)
    const dLevel = Math.round((base.py - e.clientY) / levelH);
    const u = Math.min(1, Math.max(0, base.u + du));
    const level = Math.min(layout.levels, Math.max(1, base.level + dLevel));
    // moved in EITHER direction — a leftward drag makes du negative
    setDrag({ locationId: drag.locationId, u, level, moved: Math.abs(du) * widthPx > 4 || dLevel !== 0 });
  };

  const onPointerUp = () => {
    // any gesture that started on a facing (click or drag) suppresses the
    // svg click-deselect — the facing keeps its selection once you let go
    if (drag) {
      if (drag.moved) onMoveFacing?.(drag.locationId, drag.u, drag.level);
      lastDragAt.current = Date.now();
    }
    setDrag(null);
    dragBase.current = null;
  };

  // clicking a facing selects it in BOTH modes — the viewer's details live in
  // the bottom panel now, and the editor's facing controls use the same state
  const facingProps = (s: ShelfSlot) => ({
    style: {
      cursor: editing ? (drag?.locationId === s.locationId ? 'grabbing' : 'grab') : onSelectFacing ? 'pointer' : 'default',
    },
    onClick: onSelectFacing
      ? (e: React.MouseEvent) => { e.stopPropagation(); onSelectFacing(s.locationId); }
      : undefined,
    onPointerDown: editing ? (e: React.PointerEvent) => onPointerDown(e, s) : undefined,
  });

  return (
    <svg
      ref={svgRef}
      width={widthPx + FRAME * 2}
      height={heightPx}
      style={{ display: 'block', margin: '0 auto', background: '#f4f1e8', borderRadius: 10, border: '1px solid var(--line)', touchAction: editing ? 'none' : undefined }}
      role="img"
      aria-label={`Planogram of ${layout.label}`}
      onPointerMove={editing ? onPointerMove : undefined}
      onPointerUp={editing ? onPointerUp : undefined}
      // deselect only for clicks on the empty drawing — not after a drag
      // (the moved facing keeps its selection once you let go), and not on a
      // facing itself (its own handler just selected it)
      onClick={editing || onSelectFacing ? (e) => {
        if (Date.now() - lastDragAt.current < 400) return;
        if ((e.target as Element).closest('g[title]')) return;
        onSelectFacing?.(null);
      } : undefined}
    >
      {/* shelf boards + bay dividers */}
      {Array.from({ length: layout.levels + 1 }, (_, i) => (
        <rect
          key={`board-${i}`}
          x={FRAME}
          y={FRAME + i * levelH - 4}
          width={widthPx}
          height={5}
          fill="#8a7448"
          rx={2}
        />
      ))}
      {bayEdges.slice(1).map((from, i) => (
        <line
          key={`bay-${i}`}
          x1={FRAME + from * pxPerM}
          y1={FRAME}
          x2={FRAME + from * pxPerM}
          y2={heightPx - FRAME}
          stroke="#bfa068"
          strokeWidth={3}
        />
      ))}
      <rect x={0} y={0} width={widthPx + FRAME * 2} height={heightPx} fill="none" stroke="#8a7448" strokeWidth={FRAME} rx={6} />

      {/* facings */}
      {flatSlots.map(({ slot: s, box }, i) => {
        const color = s.product.category_color || '#4f7d3f';
        const selected = selectedId === s.locationId;
        const highlighted = highlightLocationId === s.locationId;
        const g = facingProps(s);
        const key = s.locationId; // stable across re-sorts — a swap must not
        // unmount the dragged facing (its pointer capture dies with it)
        // the shopper's search hit: pulsing halo + solid orange border, drawn
        // on top so it reads over a full-bleed image too
        const halo = highlighted && (
          <>
            <rect className="facing-highlight" x={box.x + FRAME - 5} y={box.y - 5} width={box.w + 10} height={box.h + 10} rx={7} fill="none" stroke="#e4572e" strokeWidth={5} />
            <rect x={box.x + FRAME - 2} y={box.y - 2} width={box.w + 4} height={box.h + 4} rx={6} fill="none" stroke="#e4572e" strokeWidth={3} />
          </>
        );
        if (mode === 'images' && productPhoto(s.product)) {
          // the photo IS the facing — full-bleed cover; the name/details live
          // in the bottom panel once the tile is selected
          return (
            <g key={key} {...g}>
              <title>{s.product.name}</title>
              {selected && <rect x={box.x + FRAME - 3} y={box.y - 3} width={box.w + 6} height={box.h + 6} rx={6} fill="none" stroke="#2f9e44" strokeWidth={2.5} />}
              <clipPath id={`${clipBase}-${i}`}><rect x={box.x + FRAME} y={box.y} width={box.w} height={box.h} rx={4} /></clipPath>
              <rect x={box.x + FRAME} y={box.y} width={box.w} height={box.h} rx={4} fill={color} fillOpacity={0.16} stroke={color} strokeWidth={1.6} />
              <image
                href={productPhoto(s.product)}
                x={box.x + FRAME}
                y={box.y}
                width={box.w}
                height={box.h}
                preserveAspectRatio="xMidYMid slice"
                clipPath={`url(#${clipBase}-${i})`}
              />
              {halo}
            </g>
          );
        }
        return (
          <g key={key} {...g}>
            <title>{s.product.name}</title>
            {selected && <rect x={box.x + FRAME - 3} y={box.y - 3} width={box.w + 6} height={box.h + 6} rx={6} fill="none" stroke="#2f9e44" strokeWidth={2.5} />}
            <rect x={box.x + FRAME} y={box.y} width={box.w} height={box.h} rx={4} fill={color} fillOpacity={0.16} stroke={color} strokeWidth={1.6} />
            <text
              x={box.x + FRAME + box.w / 2}
              y={box.y + box.h / 2 + 4}
              textAnchor="middle"
              fontSize={10}
              fill="#33402e"
            >
              {truncate(s.product.name, Math.max(4, Math.floor(box.w / 6.2)))}
            </text>
            {s.product.price != null && (
              <text x={box.x + FRAME + box.w / 2} y={box.y + box.h - 4} textAnchor="middle" fontSize={9} fill="#5a6b53">
                ${s.product.price.toFixed(2)}
              </text>
            )}
            {halo}
          </g>
        );
      })}
    </svg>
  );
}

export default function ShelfDetail({
  shelf, pins, onClose, onPickProduct, editing, onEditFacing, onMoveFacing, onAddCopy, onRemoveFacing, onShelfResize, onRowHeightChange, onRowsChange, onAddAnotherItem, onAddItem, highlightLocationId, onViewModeChange, onAddToList,
}: {
  shelf: MapElement;
  pins: ShelfPin[];
  onClose: () => void;
  /** viewer: "Show on map" in the details panel — close + focus the product */
  onPickProduct?: (p: Product) => void;
  /** viewer: "＋ Add to list" in the details panel */
  onAddToList?: (p: Product) => void;
  /** a facing to spotlight (e.g. the shopper's search hit) — orange border */
  highlightLocationId?: string | null;
  /** editor: persist the shelf's default planogram view (meta.planogramView) */
  onViewModeChange?: (mode: PlanogramView) => void;
  /** editor mode: inline facing selection, drag, rows, shelf size */
  editing?: boolean;
  /** resize a facing (metres) or move it to another row */
  onEditFacing?: (locationId: string, patch: { shelfLevel?: number; w?: number }) => void;
  /** drag commit: new along-shelf position (0..1) + 1-based row */
  onMoveFacing?: (locationId: string, u: number, level: number) => void;
  /** duplicate a facing — another copy of the same item on this shelf */
  onAddCopy?: (locationId: string) => void;
  onRemoveFacing?: (locationId: string) => void;
  /** planogram-only length (metres) — stored as a planogram option, never
   *  touching the shelf's footprint on the map */
  onShelfResize?: (w: number) => void;
  /** drawn height of each planogram row band (px) — same in every view mode */
  onRowHeightChange?: (rowH: number) => void;
  onRowsChange?: (levels: number) => void;
  /** open a picker of store products to place onto this shelf */
  onAddItem?: () => void;
  /** create a brand-new product straight into this area */
  onAddAnotherItem?: () => void;
}) {
  const layout = useMemo(() => computeShelfLayout(shelf, pins), [shelf, pins]);
  const [viewOverride, setViewOverride] = useState<ViewMode | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // switching shelves resets manual view + selection
  useEffect(() => {
    setViewOverride(null);
    setSelectedId(null);
  }, [shelf.id]);

  // editor sees the REAL placement (drags write true positions); the viewer
  // gets the compact re-grid that always fits the items
  const displayLayout = useMemo(() => {
    if (!layout) return null;
    if (editing) return layout;
    const slots = layout.bays.flatMap((b) => b.slots);
    return slots.length ? compactFilledLayout(layout, slots) : layout;
  }, [layout, editing]);

  // the persisted per-shelf default (the owner's choice) wins; otherwise the
  // planogram starts on Image — tiles without a photo degrade to diagram
  const storedView = shelfPlanogramView(shelf);
  const mode: ViewMode = viewOverride ?? storedView ?? 'images';

  if (!layout || !displayLayout) {
    return (
      <Modal title={shelf.label || 'Shelf'} onClose={onClose}>
        <p className="muted">This shelf has no rectangular layout to display.</p>
      </Modal>
    );
  }

  const allSlots = layout.bays.flatMap((b) => b.slots);
  const totalSlots = displayLayout.bays.reduce((n, b) => n + b.slots.length, 0);
  // selected facing as DISPLAYED — the viewer's compact re-grid may place it
  // in a different bay/row than the raw layout — powers the bottom panel
  const selectedSlot = selectedId
    ? displayLayout.bays
        .flatMap((b) => b.slots.map((s) => ({ s, bay: b.index })))
        .find((x) => x.s.locationId === selectedId) ?? null
    : null;

  return (
    <Modal title={`${layout.label} — planogram`} onClose={onClose} wide>
      <p className="muted" style={{ marginTop: -8, marginBottom: 10 }}>
        {layout.bays.length} bays × {layout.levels} rows · {totalSlots} product{totalSlots === 1 ? '' : 's'} on this
        shelf · {layout.width.toFixed(1)} m wide
      </p>

      {editing && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 10 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12.5 }}>
            <b>Rows</b>
            <button type="button" className="btn sm" aria-label="Remove a row" disabled={layout.levels <= 1}
              onClick={() => onRowsChange?.(layout.levels - 1)}>−</button>
            <span style={{ minWidth: 16, textAlign: 'center' }}>{layout.levels}</span>
            <button type="button" className="btn sm" aria-label="Add a row" disabled={layout.levels >= 8}
              onClick={() => onRowsChange?.(layout.levels + 1)}>＋</button>
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12, fontSize: 12.5 }}>
            <b>Planogram</b>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              Length
              <input type="range" min={0.5} max={40} step={0.1} value={layout.meta.planWidth} style={{ width: 130 }}
                onChange={(e) => onShelfResize?.(Number(e.target.value))} />
              <b style={{ minWidth: 44 }}>{layout.meta.planWidth.toFixed(1)} m</b>
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              Row height
              <input type="range" min={64} max={200} step={2} value={layout.meta.rowH} style={{ width: 90 }}
                onChange={(e) => onRowHeightChange?.(Number(e.target.value))} />
              <b style={{ minWidth: 44 }}>{layout.meta.rowH} px</b>
            </label>
          </span>
          <span className="muted" style={{ fontSize: 12, marginLeft: 'auto' }}>
            Click an item to edit · drag to move
          </span>
          {onAddItem && (
            <button type="button" className="btn primary sm" onClick={onAddItem}>
              ＋ Add item
            </button>
          )}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: -6, marginBottom: 8 }} role="group" aria-label="Planogram view">
        {(['diagram', 'images'] as const).map((v) => (
          <button
            key={v}
            type="button"
            className="btn sm"
            aria-pressed={mode === v}
            style={mode === v ? { background: 'var(--green-soft)', borderColor: 'var(--green)' } : undefined}
            onClick={() => { setViewOverride(v); onViewModeChange?.(v); }}
          >
            {v === 'diagram' ? 'Diagram' : 'Image'}
          </button>
        ))}
      </div>

      <PlanogramSvg
        layout={displayLayout}
        mode={mode}
        editing={editing}
        selectedId={selectedId}
        onSelectFacing={setSelectedId}
        onMoveFacing={onMoveFacing}
        highlightLocationId={highlightLocationId}
      />

      {selectedSlot ? (
        /* bottom details panel — selection in BOTH modes: product details for
           the shopper, the facing controls for the editor */
        <div className="planogram-detail-panel">
          <div className="planogram-detail-head">
            {productPhoto(selectedSlot.s.product) ? (
              <img className="planogram-detail-thumb" src={productPhoto(selectedSlot.s.product)} alt="" />
            ) : (
              <span className="facing-dot" style={{ background: selectedSlot.s.product.category_color || '#4f7d3f' }} />
            )}
            <div className="planogram-detail-info">
              <b>{selectedSlot.s.product.name}</b>
              <span className="muted">
                {[
                  selectedSlot.s.product.brand,
                  selectedSlot.s.product.price != null ? `$${selectedSlot.s.product.price.toFixed(2)}` : '',
                  selectedSlot.s.product.category_name,
                  `Bay ${selectedSlot.bay + 1} · Row ${selectedSlot.s.level}`,
                ].filter(Boolean).join(' · ')}
              </span>
            </div>
            {!editing && onPickProduct && (
              <button type="button" className="btn sm" onClick={() => onPickProduct(selectedSlot.s.product)}>
                🧭 Show on map
              </button>
            )}
            {!editing && onAddToList && (
              <button type="button" className="btn sm" onClick={() => onAddToList(selectedSlot.s.product)}>
                ＋ Add to list
              </button>
            )}
            <button type="button" className="route-badge-x" aria-label="Close details" onClick={() => setSelectedId(null)}>✕</button>
          </div>
          {selectedSlot.s.product.description && (
            <p className="muted" style={{ fontSize: 12.5, margin: '8px 0 0' }}>
              {selectedSlot.s.product.description}
            </p>
          )}
          {editing && (
            <div className="facing-row" style={{ flexWrap: 'wrap', rowGap: 8, marginTop: 10 }}>
              <label className="facing-width">
                W
                <input
                  type="number" min={0.05} max={3} step={0.05} value={selectedSlot.s.facingWidth}
                  onChange={(e) => {
                    const w = Number(e.target.value);
                    if (!Number.isNaN(w) && w > 0) onEditFacing?.(selectedSlot.s.locationId, { w });
                  }}
                /> m
              </label>
              <label className="facing-width">
                Row
                <input
                  type="number" min={1} max={8} step={1} value={selectedSlot.s.level}
                  onChange={(e) => {
                    const lv = Math.min(layout.levels, Math.max(1, Math.round(Number(e.target.value) || 1)));
                    onEditFacing?.(selectedSlot.s.locationId, { shelfLevel: lv });
                  }}
                />
              </label>
              <span className="facing-actions">
                <button type="button" className="btn sm" onClick={() => onAddCopy?.(selectedSlot.s.locationId)}>
                  ＋ Add copy
                </button>
                <button type="button" className="btn sm" style={{ borderColor: '#b0413e', color: '#b0413e' }} onClick={() => { onRemoveFacing?.(selectedSlot.s.locationId); setSelectedId(null); }}>
                  Remove
                </button>
              </span>
            </div>
          )}
          {editing && (
            <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
              Copies share the product but get their own spot on the shelf. Drag any facing to move it.
            </p>
          )}
        </div>
      ) : editing ? (
        <p className="muted" style={{ fontSize: 12.5, marginTop: 12 }}>
          Select an item on the planogram to edit it, add copies, or drag it to another spot.
        </p>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
          {displayLayout.bays.map((bay) => (
            <div key={bay.index} className="badge" style={{ fontSize: 12 }}>
              Bay {bay.index + 1}: {bay.slots.length ? bay.slots.map((s) => s.product.name).join(', ') : 'empty'}
            </div>
          ))}
        </div>
      )}

      {layout.outside.length > 0 && (
        <p className="muted" style={{ marginTop: 10, fontSize: 12.5 }}>
          {layout.outside.length} pinned product{layout.outside.length === 1 ? '' : 's'} near this shelf sit outside its
          footprint on the map and are not shown here.
        </p>
      )}
    </Modal>
  );
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s;
}
