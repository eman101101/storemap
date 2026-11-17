import { useEffect, useRef, useState } from 'react';

export function Modal({
  title, onClose, children, wide,
}: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal fade-in" style={wide ? { maxWidth: 640 } : undefined} role="dialog" aria-label={title}>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}

export function Field({
  label, children,
}: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

/**
 * Copy text, falling back to a hidden textarea + execCommand when the async
 * clipboard API is unavailable or rejected (it needs a secure context, so
 * plain-HTTP self-hosts would otherwise fail). False = could not copy.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export const GOOGLE_G = (
  <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden>
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>
);

/**
 * In-app device camera: a live preview via getUserMedia and a Capture button
 * that hands back a JPEG File. Works on desktop webcams and phone cameras
 * alike (the old `capture` file input opened a photo picker on desktops).
 */
export function CameraCaptureModal({
  onCapture, onClose,
}: {
  onCapture: (file: File) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then((stream) => {
        if (!live) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      })
      .catch(() => {
        if (live) setError('No camera available in this browser — use Upload instead.');
      });
    return () => {
      live = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')!.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        onClose();
        if (blob) onCapture(new File([blob], 'camera.jpg', { type: 'image/jpeg' }));
      },
      'image/jpeg',
      0.92
    );
  };

  return (
    <Modal title="Take a photo" onClose={onClose}>
      {error ? (
        <>
          <p className="muted">{error}</p>
          <div className="modal-actions">
            <button className="btn" onClick={onClose}>Close</button>
          </div>
        </>
      ) : (
        <>
          <video
            ref={videoRef}
            style={{ width: '100%', borderRadius: 10, background: '#000', minHeight: 200 }}
            playsInline
            muted
          />
          <div className="modal-actions">
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary" onClick={capture}>◉ Capture</button>
          </div>
        </>
      )}
    </Modal>
  );
}

export const APPLE_LOGO = (
  <svg width="16" height="16" viewBox="0 0 384 512" aria-hidden>
    <path fill="currentColor" d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
  </svg>
);

/** Compact video-camera glyph marking the camera pad. */
export const CAMERA_ICON = (
  <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M23 7l-7 5 7 5V7z" />
    <rect x="1" y="5" width="15" height="14" rx="2" />
  </svg>
);

/** Triangular pan arrow for the camera pad (points up; rotated per direction). */
function PanArrow({ dir }: { dir: 'up' | 'down' | 'left' | 'right' }) {
  const rot = { up: 0, right: 90, down: 180, left: 270 }[dir];
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden
      style={{ transform: `rotate(${rot}deg)` }}>
      <path d="M12 4.5 L20 17.5 H4 Z" />
    </svg>
  );
}

/**
 * The 3D camera pad. Each tap glides the camera a set distance over ~0.45 s
 * (eased in and out — no hold needed, no jump), arrows pan along the view's
 * screen axes. Zoom lives in the vertical ＋/− column at the bottom-right
 * (ZoomPad), shared with the 2D map. The parent
 * applies the movement: onMove receives the eased progress chunk per frame
 * (its dt values sum to 1 over a tap), so its per-unit scale defines the
 * total distance of one tap.
 */
export function CameraPad({
  onMove, className = '',
}: {
  /** dirX/dirY pan direction (-1..1), zoom +1 in / -1 out; dt is the eased progress chunk for this frame. */
  onMove: (dirX: number, dirY: number, zoom: number, dt: number) => void;
  className?: string;
}) {
  const TAP_MS = 450;
  // {x,y}: pan direction · z: zoom direction · done: eased progress already sent
  const anim = useRef<{ x: number; y: number; z: number; start: number; done: number } | null>(null);
  const raf = useRef<number | null>(null);
  const move = useRef(onMove);
  move.current = onMove;

  const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

  const loop = (now: number) => {
    const a = anim.current;
    if (!a) {
      raf.current = null;
      return;
    }
    const t = Math.min(1, (now - a.start) / TAP_MS);
    const e = easeInOut(t);
    const chunk = e - a.done;
    a.done = e;
    if (chunk > 0) move.current(a.x, a.y, a.z, chunk);
    if (t >= 1) {
      anim.current = null;
      raf.current = null;
      return;
    }
    raf.current = requestAnimationFrame(loop);
  };

  /** One tap = one smooth glide; a new tap replaces the glide in progress. */
  const tap = (x: number, y: number, z: number) => {
    if (raf.current != null) cancelAnimationFrame(raf.current);
    anim.current = { x, y, z, start: performance.now(), done: 0 };
    raf.current = requestAnimationFrame(loop);
  };
  useEffect(
    () => () => {
      if (raf.current != null) cancelAnimationFrame(raf.current);
    },
    []
  );

  const btn = (label: string, glyph: React.ReactNode, onClick: () => void, key: string) => (
    <button key={key} type="button" title={label} aria-label={label} onClick={onClick}>
      {glyph}
    </button>
  );

  return (
    <div className={`pan-pad ${className}`} role="toolbar" aria-label="Camera controls">
      {/* 3×3 D-pad: filler spans keep the arrows in their columns; the
          camera glyph sits in the centre cell */}
      <span aria-hidden />
      {btn('Pan camera up', <PanArrow dir="up" />, () => tap(0, 1, 0), 'up')}
      <span aria-hidden />
      {btn('Pan camera left', <PanArrow dir="left" />, () => tap(-1, 0, 0), 'left')}
      <span className="cam-mid" aria-hidden>
        {CAMERA_ICON}
      </span>
      {btn('Pan camera right', <PanArrow dir="right" />, () => tap(1, 0, 0), 'right')}
      <span aria-hidden />
      {btn('Pan camera down', <PanArrow dir="down" />, () => tap(0, -1, 0), 'down')}
      <span aria-hidden />
    </div>
  );
}

/**
 * The zoom pad: a ＋/− column pinned to the bottom-right in BOTH the 2D and
 * 3D views. One call per tap — the glide animation lives in the consumer
 * (2D: MapCanvas's zoom command; 3D: Map3D's zoomCommand tween).
 */
export function ZoomPad({
  onZoom, className = '',
}: {
  /** +1 zooms in, -1 zooms out */
  onZoom: (dir: 1 | -1) => void;
  className?: string;
}) {
  return (
    <div className={`zoom-column ${className}`} role="toolbar" aria-label="Zoom controls">
      <button type="button" title="Zoom in" aria-label="Zoom in" onClick={() => onZoom(1)}>+</button>
      <button type="button" title="Zoom out" aria-label="Zoom out" onClick={() => onZoom(-1)}>&minus;</button>
    </div>
  );
}
