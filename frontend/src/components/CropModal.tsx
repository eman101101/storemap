/**
 * CropModal — drag a rectangle over a product photo and save the cropped
 * region as the product's planogram-facing image (image_crop_url). The
 * original photo is never modified, so search thumbs and the product sheet
 * keep the full shot while planogram tiles lose the whitespace around them.
 */
import { useRef, useState } from 'react';
import { Modal } from './ui';

interface CropRect { x: number; y: number; w: number; h: number }

const MIN_SIZE = 24; // px of selection below which the crop is ignored

export default function CropModal({
  src, busy, onApply, onError, onClose,
}: {
  src: string;
  busy?: boolean;
  onApply: (file: File) => void;
  onError: (message: string) => void;
  onClose: () => void;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [rect, setRect] = useState<CropRect | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  /** Pointer position clamped to the displayed image box. */
  const rel = (e: React.PointerEvent) => {
    const box = imgRef.current?.getBoundingClientRect();
    if (!box) return { x: 0, y: 0 };
    return {
      x: Math.max(0, Math.min(box.width, e.clientX - box.left)),
      y: Math.max(0, Math.min(box.height, e.clientY - box.top)),
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (busy) return;
    e.preventDefault();
    // capture keeps the drag alive if the img re-renders mid-gesture; a dead
    // pointer id (synthetic events, stale touches) just skips the capture
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* keep dragging */ }
    const p = rel(e);
    dragStart.current = p;
    setRect({ x: p.x, y: p.y, w: 0, h: 0 });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const start = dragStart.current;
    if (!start || busy) return;
    const p = rel(e);
    setRect({
      x: Math.min(start.x, p.x),
      y: Math.min(start.y, p.y),
      w: Math.abs(p.x - start.x),
      h: Math.abs(p.y - start.y),
    });
  };
  const onPointerUp = () => { dragStart.current = null; };

  const apply = () => {
    const img = imgRef.current;
    const box = imgRef.current?.getBoundingClientRect();
    if (!img || !box || !rect || !nat || rect.w < MIN_SIZE || rect.h < MIN_SIZE) return;
    try {
      // display px → natural px, then crop onto a canvas (WebP, q0.85)
      const sx = nat.w / box.width;
      const sy = nat.h / box.height;
      const cx = Math.round(rect.x * sx);
      const cy = Math.round(rect.y * sy);
      const cw = Math.max(1, Math.round(rect.w * sx));
      const ch = Math.max(1, Math.round(rect.h * sy));
      const canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      // remote photos without CORS taint the canvas — surface that clearly
      ctx.drawImage(img, cx, cy, cw, ch, 0, 0, cw, ch);
      canvas.toBlob(
        (blob) => {
          if (!blob) { onError('Could not encode the cropped image'); return; }
          onApply(new File([blob], 'crop.webp', { type: 'image/webp' }));
        },
        'image/webp',
        0.85
      );
    } catch {
      onError('That photo cannot be cropped in the browser (cross-origin image)');
    }
  };

  const valid = rect != null && rect.w >= MIN_SIZE && rect.h >= MIN_SIZE;

  return (
    <Modal title="Crop photo" onClose={onClose} wide>
      <p className="muted" style={{ fontSize: 12.5, margin: '0 0 10px' }}>
        Drag a rectangle around the product — planogram tiles show the cropped image, the original photo is kept.
      </p>
      <div
        className="crop-stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{ position: 'relative', overflow: 'hidden', userSelect: 'none', touchAction: 'none', cursor: 'crosshair', lineHeight: 0 }}
      >
        <img
          ref={imgRef}
          src={src}
          alt=""
          onLoad={() => {
            const i = imgRef.current;
            if (i?.naturalWidth) setNat({ w: i.naturalWidth, h: i.naturalHeight });
            setRect(null);
          }}
          // element box must equal the rendered image box (no letterboxing) so
          // the selection maps 1:1 onto natural pixels
          style={{ display: 'block', maxWidth: '100%', maxHeight: 380, width: 'auto', height: 'auto', pointerEvents: 'none' }}
          draggable={false}
        />
        {rect && (
          <div
            style={{
              position: 'absolute',
              left: rect.x, top: rect.y, width: rect.w, height: rect.h,
              border: '2px solid var(--green, #2f9e44)',
              boxShadow: '0 0 0 9999px rgba(20, 28, 22, 0.45)',
              pointerEvents: 'none',
            }}
          />
        )}
      </div>
      <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
        <button type="button" className="btn ghost" onClick={() => setRect(null)} disabled={!rect || busy}>
          Clear selection
        </button>
        <button type="button" className="btn primary" onClick={apply} disabled={!valid || busy}>
          {busy ? 'Working…' : 'Apply crop'}
        </button>
      </div>
    </Modal>
  );
}
