/**
 * ShelfDetail — what the shopper/owner sees when they tap a shelf on the map:
 * a front elevation of the real shelf (bays + levels) with each product's
 * facing placed where its map pin puts it. Planograms are ONE shelf face —
 * no side splitting. Facings with a product photo render a photo planogram
 * (image standing on the board, sized by its facing width); the schematic
 * diagram stays available via the view toggle.
 *
 * Editor mode (editing prop): facings are selectable and draggable — click
 * one to edit its properties inline (width, row, add a copy, remove), drag
 * it to another spot on the planogram. Row count and the shelf's length /
 * depth are editable too, so the drawing always matches the map.
 *
 * PlanogramSvg is the drawing itself, exported so other surfaces (the
 * homepage planogram example) can render a planogram inline.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from './ui';
import type { MapElement, Product } from '../types';
import { compactFilledLayout, computeShelfLayout, type ShelfLayout, type ShelfPin, type ShelfSlot } from '../lib/shelfLayout';

const M = 46; // pixels per metre of shelf width in the drawing
const LEVEL_H = 58; // pixels per level in the diagram view
const PHOTO_LEVEL_H = 112; // taller bands in the photo view so images read
const FRAME = 10; // frame thickness in px

type ViewMode = 'diagram' | 'photos';

/** The planogram drawing for one shelf face (bays + levels from the layout). */
export function PlanogramSvg({
  layout, mode, onPickProduct, editing, selectedId, onSelectFacing, onMoveFacing,
}: {
  layout: ShelfLayout;
  mode: ViewMode;
  onPickProduct?: (p: Product) => void;
  /** editor mode: facings are clickable + draggable */
  editing?: boolean;
  selectedId?: string | null;
  onSelectFacing?: (locationId: string | null) => void;
  onMoveFacing?: (locationId: string, u: number, level: number) => void;
}) {
  const levelH = mode === 'photos' ? PHOTO_LEVEL_H : LEVEL_H;
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
  const slotBox = (s: { u: number; facingWidth: number; level: number }) => {
    // photos render wider than their literal facing when the facing is tiny,
    // so an image is never a sliver — dense shelves just overlap slightly
    const min = mode === 'photos' ? (editing ? 24 : 44) : 18;
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

  const facingProps = (s: ShelfSlot, product: Product) => ({
    style: {
      cursor: editing ? (drag?.locationId === s.locationId ? 'grabbing' : 'grab') : onPickProduct ? 'pointer' : 'default',
    },
    onClick: editing
      ? (e: React.MouseEvent) => { e.stopPropagation(); onSelectFacing?.(s.locationId); }
      : onPickProduct
        ? () => onPickProduct(product)
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
      onClick={editing ? (e) => {
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
        const selected = editing && selectedId === s.locationId;
        const g = facingProps(s, s.product);
        const key = s.locationId; // stable across re-sorts — a swap must not
        // unmount the dragged facing (its pointer capture dies with it)
        if (mode === 'photos' && s.product.image_url) {
          return (
            <g key={key} {...g}>
              <title>{s.product.name}</title>
              {selected && <rect x={box.x + FRAME - 3} y={box.y - 3} width={box.w + 6} height={box.h + 6} rx={6} fill="none" stroke="#2f9e44" strokeWidth={2.5} />}
              <rect x={box.x + FRAME} y={box.y} width={box.w} height={box.h} rx={4} fill={color} fillOpacity={0.1} stroke={color} strokeWidth={1.6} />
              {/* the photo fills the whole facing box — resizing the facing resizes the image */}
              <image
                href={s.product.image_url}
                x={box.x + FRAME + 2}
                y={box.y + 2}
                width={box.w - 4}
                height={box.h - 4}
                preserveAspectRatio="xMidYMax meet"
              />
              {/* name + price on a translucent strip over the photo's bottom edge */}
              <rect x={box.x + FRAME + 2} y={box.y + box.h - 18} width={box.w - 4} height={16} rx={3} fill="#f4f1e8" fillOpacity={0.85} />
              <text x={box.x + FRAME + 5} y={box.y + box.h - 6} fontSize={9.5} fill="#33402e">
                {truncate(s.product.name, Math.max(3, Math.floor((box.w - (s.product.price != null ? 30 : 8)) / 5.6)))}
              </text>
              {s.product.price != null && (
                <text x={box.x + FRAME + box.w - 5} y={box.y + box.h - 6} textAnchor="end" fontSize={9} fill="#5a6b53">
                  ${s.product.price.toFixed(2)}
                </text>
              )}
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
          </g>
        );
      })}
    </svg>
  );
}

export default function ShelfDetail({
  shelf, pins, onClose, onPickProduct, editing, onEditFacing, onMoveFacing, onAddCopy, onRemoveFacing, onShelfResize, onRowsChange, onAddAnotherItem, onAddAnotherAt,
}: {
  shelf: MapElement;
  pins: ShelfPin[];
  onClose: () => void;
  onPickProduct?: (p: Product) => void;
  /** editor mode: inline facing selection, drag, rows, shelf size */
  editing?: boolean;
  /** resize a facing (metres) or move it to another row */
  onEditFacing?: (locationId: string, patch: { shelfLevel?: number; w?: number }) => void;
  /** drag commit: new along-shelf position (0..1) + 1-based row */
  onMoveFacing?: (locationId: string, u: number, level: number) => void;
  /** duplicate a facing — another copy of the same item on this shelf */
  onAddCopy?: (locationId: string) => void;
  onRemoveFacing?: (locationId: string) => void;
  /** planogram-only length + depth (metres) — stored as planogram options,
   *  never touching the shelf's footprint on the map */
  onShelfResize?: (w: number, h: number) => void;
  onRowsChange?: (levels: number) => void;
  /** singular-item shelf: create the next product straight into this area */
  onAddAnotherItem?: () => void;
  /** per-facing: create a NEW product into this shelf, beside that facing */
  onAddAnotherAt?: (locationId: string) => void;
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

  const hasImages = !!displayLayout?.bays.some((b) => b.slots.some((s) => s.product.image_url));
  const mode: ViewMode = viewOverride ?? (hasImages ? 'photos' : 'diagram');

  if (!layout || !displayLayout) {
    return (
      <Modal title={shelf.label || 'Shelf'} onClose={onClose}>
        <p className="muted">This shelf has no rectangular layout to display.</p>
      </Modal>
    );
  }

  const allSlots = layout.bays.flatMap((b) => b.slots);
  const totalSlots = displayLayout.bays.reduce((n, b) => n + b.slots.length, 0);
  const selected = editing && selectedId ? allSlots.find((s) => s.locationId === selectedId) ?? null : null;

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
                onChange={(e) => onShelfResize?.(Number(e.target.value), layout.meta.planDepth)} />
              <b style={{ minWidth: 44 }}>{layout.meta.planWidth.toFixed(1)} m</b>
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              Depth
              <input type="range" min={0.2} max={6} step={0.05} value={layout.meta.planDepth} style={{ width: 90 }}
                onChange={(e) => onShelfResize?.(layout.meta.planWidth, Number(e.target.value))} />
              <b style={{ minWidth: 44 }}>{layout.meta.planDepth.toFixed(2)} m</b>
            </label>
          </span>
          <span className="muted" style={{ fontSize: 12, marginLeft: 'auto' }}>
            Click an item to edit · drag to move
          </span>
          {allSlots.length <= 1 && onAddAnotherItem && (
            <button type="button" className="btn primary sm" onClick={onAddAnotherItem}>
              ＋ Add another item &amp; build the planogram
            </button>
          )}
        </div>
      )}

      {(hasImages || editing) && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: -6, marginBottom: 8 }} role="group" aria-label="Planogram view">
          {(['photos', 'diagram'] as const).map((v) => (
            <button
              key={v}
              type="button"
              className="btn sm"
              aria-pressed={mode === v}
              style={mode === v ? { background: 'var(--green-soft)', borderColor: 'var(--green)' } : undefined}
              onClick={() => setViewOverride(v)}
            >
              {v === 'photos' ? 'Photos' : 'Diagram'}
            </button>
          ))}
        </div>
      )}

      <PlanogramSvg
        layout={displayLayout}
        mode={mode}
        onPickProduct={onPickProduct}
        editing={editing}
        selectedId={selectedId}
        onSelectFacing={setSelectedId}
        onMoveFacing={onMoveFacing}
      />

      {editing ? (
        selected ? (
          <div className="facing-editor" style={{ marginTop: 12 }}>
            <div className="row-between">
              <b style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span className="facing-dot" style={{ background: selected.product.category_color || '#4f7d3f' }} />
                {selected.product.name}
              </b>
              {selected.product.price != null && <span className="muted" style={{ fontSize: 12.5 }}>${selected.product.price.toFixed(2)}</span>}
            </div>
            <div className="facing-row" style={{ flexWrap: 'wrap', rowGap: 8, marginTop: 8 }}>
              <label className="facing-width">
                W
                <input
                  type="number" min={0.05} max={3} step={0.05} value={selected.facingWidth}
                  onChange={(e) => {
                    const w = Number(e.target.value);
                    if (!Number.isNaN(w) && w > 0) onEditFacing?.(selected.locationId, { w });
                  }}
                /> m
              </label>
              <label className="facing-width">
                Row
                <input
                  type="number" min={1} max={8} step={1} value={selected.level}
                  onChange={(e) => {
                    const lv = Math.min(layout.levels, Math.max(1, Math.round(Number(e.target.value) || 1)));
                    onEditFacing?.(selected.locationId, { shelfLevel: lv });
                  }}
                />
              </label>
              <span className="facing-actions">
                <button type="button" className="btn sm" onClick={() => onAddCopy?.(selected.locationId)}>
                  ＋ Add copy
                </button>
                {onAddAnotherAt && (
                  <button type="button" className="btn sm" onClick={() => onAddAnotherAt(selected.locationId)}>
                    ＋ Add another item
                  </button>
                )}
                <button type="button" className="btn sm" style={{ borderColor: '#b0413e', color: '#b0413e' }} onClick={() => { onRemoveFacing?.(selected.locationId); setSelectedId(null); }}>
                  Remove
                </button>
              </span>
            </div>
            <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
              Copies share the product but get their own spot on the shelf. Drag any facing to move it.
            </p>
          </div>
        ) : (
          <p className="muted" style={{ fontSize: 12.5, marginTop: 12 }}>
            Select an item on the planogram to edit it, add copies, or drag it to another spot.
          </p>
        )
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
