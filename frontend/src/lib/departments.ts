/**
 * Department labels for general-area mapping: heavy floors hide their item
 * pins (groups view) and label each shelf with the department it carries
 * instead. A shelf's department is its seeded meta.department when present,
 * otherwise the dominant category among the items pinned to it — so every
 * store gets area labels without any seeding contract.
 */
import type { MapPin } from '../components/MapCanvas';
import type { MapElement, RectGeom } from '../types';

/** Which shelf a pin belongs to: the pin's stamped owner when available,
 *  else point-in-rect containment (rotation aware, same tolerance as the
 *  shelf editor's 0.35 m). */
export function shelfDepartments(elements: MapElement[], pins: MapPin[], ownerOfPin?: (locationId: string) => string | null): Map<string, string> {
  // fast path: every shelf already carries a seeded department — no need to
  // walk pins at all (Grand Mart scale: 3000 pins × 400 shelves of point-in-
  // rect tests would be pure waste)
  const allStamped = elements.every((el) => {
    if (el.type !== 'shelf' || el.shape !== 'rect') return true;
    try {
      const m = JSON.parse(el.meta || '{}');
      return typeof m.department === 'string' && !!m.department.trim();
    } catch {
      return false;
    }
  });
  const out = new Map<string, string>();
  if (allStamped) {
    for (const el of elements) {
      if (el.type !== 'shelf' || el.shape !== 'rect') continue;
      try {
        const m = JSON.parse(el.meta || '{}');
        const dept = typeof m.department === 'string' ? m.department.trim() : '';
        if (dept) out.set(el.id, dept);
      } catch { /* no meta */ }
    }
    return out;
  }
  const byShelf = new Map<string, Map<string, number>>(); // shelfId → category → count
  const push = (shelfId: string, cat: string) => {
    const m = byShelf.get(shelfId) ?? new Map<string, number>();
    m.set(cat, (m.get(cat) ?? 0) + 1);
    byShelf.set(shelfId, m);
  };
  for (const { location, product } of pins) {
    const owner = ownerOfPin?.(location.id) ?? shelfAtPoint(location.x, location.y, elements);
    if (!owner) continue;
    const cat = (product.category_name ?? '').trim();
    if (cat) push(owner, cat);
  }
  for (const el of elements) {
    if (el.type !== 'shelf' || el.shape !== 'rect') continue;
    // a seeded department wins outright; derived dominant category otherwise
    let meta: Record<string, unknown> = {};
    try { meta = JSON.parse(el.meta || '{}'); } catch { /* no meta */ }
    const seeded = typeof meta.department === 'string' ? meta.department.trim() : '';
    if (seeded) { out.set(el.id, seeded); continue; }
    const counts = byShelf.get(el.id);
    if (!counts?.size) continue;
    let best = '';
    let bestN = 0;
    for (const [cat, n] of counts) {
      if (n > bestN) { best = cat; bestN = n; }
    }
    if (best) out.set(el.id, best);
  }
  return out;
}

function shelfAtPoint(x: number, y: number, elements: MapElement[]): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const el of elements) {
    if (el.type !== 'shelf' || el.shape !== 'rect') continue;
    const r = el.geom as RectGeom;
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const a = (-(r.rot ?? 0) * Math.PI) / 180;
    const lx = r.w / 2 + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a);
    const ly = r.h / 2 + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a);
    if (lx < -0.35 || lx > r.w + 0.35 || ly < -0.35 || ly > r.h + 0.35) continue;
    const d = Math.max(-Math.min(lx, r.w - lx), -Math.min(ly, r.h - ly), 0);
    if (d < bestD) { bestD = d; best = el.id; }
  }
  return best;
}
