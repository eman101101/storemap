/**
 * ShelfDetail — what the shopper/owner sees when they tap a shelf on the map:
 * a front elevation of the real shelf (bays + levels) with each product's
 * facing placed where its map pin puts it.
 */
import { useMemo } from 'react';
import { Modal } from './ui';
import type { MapElement, Product } from '../types';
import { computeShelfLayout, type ShelfPin, type ShelfSlot } from '../lib/shelfLayout';

const M = 46; // pixels per metre of shelf width in the drawing
const LEVEL_H = 58; // pixels per level
const FRAME = 10; // frame thickness in px

export default function ShelfDetail({
  shelf, pins, onClose, onPickProduct,
}: {
  shelf: MapElement;
  pins: ShelfPin[];
  onClose: () => void;
  onPickProduct?: (p: Product) => void;
}) {
  const layout = useMemo(() => computeShelfLayout(shelf, pins), [shelf, pins]);
  if (!layout) {
    return (
      <Modal title={shelf.label || 'Shelf'} onClose={onClose}>
        <p className="muted">This shelf has no rectangular layout to display.</p>
      </Modal>
    );
  }

  const widthPx = Math.max(240, Math.min(560, layout.width * M));
  const heightPx = layout.levels * LEVEL_H + FRAME * 2;
  const pxPerM = widthPx / layout.width;

  const bayEdges = layout.bays.map((b) => b.from);
  const slotBox = (s: ShelfSlot) => {
    const w = Math.max(18, s.facingWidth * pxPerM);
    const x = s.u * widthPx - w / 2;
    const y = FRAME + (layout.levels - s.level) * LEVEL_H + 8;
    return { x: Math.max(2, Math.min(widthPx - w - 2, x)), y, w };
  };

  const totalSlots = layout.bays.reduce((n, b) => n + b.slots.length, 0);

  return (
    <Modal title={`${layout.label} — shelf layout`} onClose={onClose} wide>
      <p className="muted" style={{ marginTop: -8, marginBottom: 10 }}>
        {layout.bays.length} bays × {layout.levels} levels · {totalSlots} product{totalSlots === 1 ? '' : 's'} on this
        shelf · {layout.width.toFixed(1)} m wide
      </p>

      <svg
        width={widthPx + FRAME * 2}
        height={heightPx}
        style={{ display: 'block', margin: '0 auto', background: '#f4f1e8', borderRadius: 10, border: '1px solid var(--line)' }}
        role="img"
        aria-label={`Front layout of ${layout.label}`}
      >
        {/* shelf boards + bay dividers */}
        {Array.from({ length: layout.levels + 1 }, (_, i) => (
          <rect
            key={`board-${i}`}
            x={FRAME}
            y={FRAME + i * LEVEL_H - 4}
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
            return (
              <g
                key={`${bay.index}-${i}`}
                style={{ cursor: onPickProduct ? 'pointer' : 'default' }}
                onClick={onPickProduct ? () => onPickProduct(s.product) : undefined}
              >
                <rect x={box.x + FRAME} y={box.y} width={box.w} height={LEVEL_H - 18} rx={4} fill={color} fillOpacity={0.16} stroke={color} strokeWidth={1.6} />
                <text
                  x={box.x + FRAME + box.w / 2}
                  y={box.y + (LEVEL_H - 18) / 2 + 4}
                  textAnchor="middle"
                  fontSize={10}
                  fill="#33402e"
                >
                  {truncate(s.product.name, Math.max(4, Math.floor(box.w / 6.2)))}
                </text>
                {s.product.price != null && (
                  <text x={box.x + FRAME + box.w / 2} y={box.y + LEVEL_H - 22} textAnchor="middle" fontSize={9} fill="#5a6b53">
                    ${s.product.price.toFixed(2)}
                  </text>
                )}
              </g>
            );
          })
        )}
      </svg>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
        {layout.bays.map((bay) => (
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
