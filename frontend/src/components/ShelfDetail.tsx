/**
 * ShelfDetail — what the shopper/owner sees when they tap a shelf on the map:
 * a front elevation of the real shelf (bays + levels) with each product's
 * facing placed where its map pin puts it. Aisles stock both faces — the
 * Side A / Side B selector shows one side's planogram at a time, sized by
 * the shelf's own bays/levels/width. Facings with a product photo render a
 * photo planogram (image standing on the board, name + price below); the
 * schematic diagram stays available via the view toggle.
 *
 * PlanogramSvg is the drawing itself, exported so other surfaces (the
 * homepage planogram example) can render a side's planogram inline.
 */
import { useEffect, useMemo, useState } from 'react';
import { Modal } from './ui';
import type { MapElement, Product } from '../types';
import { computeShelfLayout, type ShelfLayout, type ShelfPin, type ShelfSlot } from '../lib/shelfLayout';

const M = 46; // pixels per metre of shelf width in the drawing
const LEVEL_H = 58; // pixels per level in the diagram view
const PHOTO_LEVEL_H = 112; // taller bands in the photo view so images read
const FRAME = 10; // frame thickness in px

type ViewMode = 'diagram' | 'photos';
export type ShelfSide = 'front' | 'back';

/** The planogram drawing for one side's layout (bays already filtered). */
export function PlanogramSvg({
  layout, mode, onPickProduct,
}: {
  layout: ShelfLayout;
  mode: ViewMode;
  onPickProduct?: (p: Product) => void;
}) {
  const levelH = mode === 'photos' ? PHOTO_LEVEL_H : LEVEL_H;
  const widthPx = Math.max(240, Math.min(560, layout.width * M));
  const heightPx = layout.levels * levelH + FRAME * 2;
  const pxPerM = widthPx / layout.width;

  const bayEdges = layout.bays.map((b) => b.from);
  const slotBox = (s: ShelfSlot) => {
    // photos render wider than their literal facing when the facing is tiny,
    // so an image is never a sliver — dense shelves just overlap slightly
    const w = Math.max(mode === 'photos' ? 44 : 18, s.facingWidth * pxPerM);
    const x = s.u * widthPx - w / 2;
    const y = FRAME + (layout.levels - s.level) * levelH + 8;
    return { x: Math.max(2, Math.min(widthPx - w - 2, x)), y, w, h: levelH - 18 };
  };

  const facingProps = (product: Product) => ({
    style: { cursor: onPickProduct ? 'pointer' : 'default' },
    onClick: onPickProduct ? () => onPickProduct(product) : undefined,
  });

  return (
    <svg
      width={widthPx + FRAME * 2}
      height={heightPx}
      style={{ display: 'block', margin: '0 auto', background: '#f4f1e8', borderRadius: 10, border: '1px solid var(--line)' }}
      role="img"
      aria-label={`Planogram of ${layout.label}`}
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
      {layout.bays.flatMap((bay) =>
        bay.slots.map((s, i) => {
          const box = slotBox(s);
          const color = s.product.category_color || '#4f7d3f';
          const g = facingProps(s.product);
          if (mode === 'photos' && s.product.image_url) {
            return (
              <g key={`${bay.index}-${i}`} {...g}>
                <title>{s.product.name}</title>
                <rect x={box.x + FRAME} y={box.y} width={box.w} height={box.h} rx={4} fill={color} fillOpacity={0.1} stroke={color} strokeWidth={1.6} />
                {/* photo stands on the board: fitted, anchored to the band's bottom */}
                <image
                  href={s.product.image_url}
                  x={box.x + FRAME + 2}
                  y={box.y + 2}
                  width={box.w - 4}
                  height={box.h - 26}
                  preserveAspectRatio="xMidYMax meet"
                />
                <text x={box.x + FRAME + box.w / 2} y={box.y + box.h - 13} textAnchor="middle" fontSize={10} fill="#33402e">
                  {truncate(s.product.name, Math.max(4, Math.floor(box.w / 6.2)))}
                </text>
                {s.product.price != null && (
                  <text x={box.x + FRAME + box.w / 2} y={box.y + box.h - 3} textAnchor="middle" fontSize={9} fill="#5a6b53">
                    ${s.product.price.toFixed(2)}
                  </text>
                )}
              </g>
            );
          }
          return (
            <g key={`${bay.index}-${i}`} {...g}>
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
        })
      )}
    </svg>
  );
}

function countSlots(layout: ShelfLayout | null, side: ShelfSide) {
  return layout?.bays.reduce((n, b) => n + b.slots.filter((s) => s.side === side).length, 0) ?? 0;
}

export default function ShelfDetail({
  shelf, pins, onClose, onPickProduct,
}: {
  shelf: MapElement;
  pins: ShelfPin[];
  onClose: () => void;
  onPickProduct?: (p: Product) => void;
}) {
  const layout = useMemo(() => computeShelfLayout(shelf, pins), [shelf, pins]);
  const [viewOverride, setViewOverride] = useState<ViewMode | null>(null);
  const [sideOverride, setSideOverride] = useState<ShelfSide | null>(null);

  // switching shelves resets manual view choices
  useEffect(() => {
    setViewOverride(null);
    setSideOverride(null);
  }, [shelf.id]);

  // which face: default to the side carrying more pins
  const bothSides = !!layout?.bays.some((b) => b.slots.some((s) => s.side === 'front')) &&
    !!layout?.bays.some((b) => b.slots.some((s) => s.side === 'back'));
  const side: ShelfSide = sideOverride ??
    (countSlots(layout, 'front') >= countSlots(layout, 'back') ? 'front' : 'back');

  // a shelf-size planogram of just the selected side
  const sideLayout = useMemo(() => {
    if (!layout || (!bothSides && !sideOverride)) return layout;
    return {
      ...layout,
      bays: layout.bays.map((b) => ({ ...b, slots: b.slots.filter((s) => s.side === side) })),
    };
  }, [layout, bothSides, sideOverride, side]);

  const hasImages = !!sideLayout?.bays.some((b) => b.slots.some((s) => s.product.image_url));
  const mode: ViewMode = viewOverride ?? (hasImages ? 'photos' : 'diagram');

  if (!layout || !sideLayout) {
    return (
      <Modal title={shelf.label || 'Shelf'} onClose={onClose}>
        <p className="muted">This shelf has no rectangular layout to display.</p>
      </Modal>
    );
  }

  const totalSlots = sideLayout.bays.reduce((n, b) => n + b.slots.length, 0);

  return (
    <Modal title={`${layout.label} — planogram`} onClose={onClose} wide>
      <p className="muted" style={{ marginTop: -8, marginBottom: 10 }}>
        {layout.bays.length} bays × {layout.levels} rows · {totalSlots} product{totalSlots === 1 ? '' : 's'} on this
        shelf{bothSides ? ` · ${side === 'front' ? 'Side A' : 'Side B'}` : ''} · {layout.width.toFixed(1)} m wide
      </p>

      {(hasImages || bothSides) && (
        <div style={{ display: 'flex', gap: 6, marginTop: -6, marginBottom: 8 }} role="group" aria-label="Planogram view">
          {bothSides && (
            <div style={{ display: 'flex', gap: 6, marginRight: 'auto' }} role="group" aria-label="Shelf side">
              {(['front', 'back'] as const).map((sd) => (
                <button
                  key={sd}
                  type="button"
                  className="btn sm"
                  aria-pressed={side === sd}
                  style={side === sd ? { background: 'var(--green-soft)', borderColor: 'var(--green)' } : undefined}
                  onClick={() => setSideOverride(sd)}
                >
                  {sd === 'front' ? 'Side A' : 'Side B'}
                </button>
              ))}
            </div>
          )}
          {hasImages && (
            <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }} role="group" aria-label="Planogram view">
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
        </div>
      )}

      <PlanogramSvg layout={sideLayout} mode={mode} onPickProduct={onPickProduct} />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
        {sideLayout.bays.map((bay) => (
          <div key={bay.index} className="badge" style={{ fontSize: 12 }}>
            Bay {bay.index + 1}: {bay.slots.length ? bay.slots.map((s) => s.product.name).join(', ') : 'empty'}
          </div>
        ))}
      </div>

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
