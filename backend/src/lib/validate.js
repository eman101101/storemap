/** Input validation for API payloads. */
import { badRequest } from './http.js';

export function str(v, { max = 500, allowEmpty = true } = {}) {
  if (v === undefined || v === null) return allowEmpty ? '' : null;
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  if (!allowEmpty && !s) return undefined;
  return s.slice(0, max);
}

export function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export const ELEMENT_TYPES = new Set(['wall', 'shelf', 'aisle', 'zone', 'entrance', 'exit', 'poi']);
const TYPE_TO_SHAPE = {
  wall: ['rect', 'polyline', 'polygon'],
  shelf: ['rect', 'polygon'],
  aisle: ['polyline', 'rect'],
  zone: ['rect', 'polygon'],
  entrance: ['point'],
  exit: ['point'],
  poi: ['point'],
};
const HEX = /^#[0-9a-fA-F]{6}$/;

/** Validate one map element payload; returns a normalised row or null. */
export function validateElement(input) {
  if (!input || typeof input !== 'object') return null;
  const { type, shape, geometry } = input;
  if (!ELEMENT_TYPES.has(type)) return null;
  if (!TYPE_TO_SHAPE[type].includes(shape)) return null;
  let geo = geometry;
  if (typeof geo === 'string') {
    try {
      geo = JSON.parse(geo);
    } catch {
      return null;
    }
  }
  if (shape === 'rect') {
    const { x, y, w, h, rot } = geo ?? {};
    if (![x, y, w, h].every((n) => Number.isFinite(n)) || w <= 0 || h <= 0) return null;
    geo = { x, y, w, h, rot: Number.isFinite(rot) ? ((rot % 360) + 360) % 360 : 0 };
  } else if (shape === 'point') {
    const { x, y } = geo ?? {};
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    geo = { x, y };
  } else {
    if (!Array.isArray(geo) || geo.length < 2) return null;
    if (geo.length > 200) return null;
    if (!geo.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))) return null;
    geo = geo.map((p) => [+p[0].toFixed(3), +p[1].toFixed(3)]);
  }
  const color = typeof input.color === 'string' && HEX.test(input.color) ? input.color : '';
  return {
    id: typeof input.id === 'string' && input.id.length <= 64 ? input.id : undefined,
    type,
    shape,
    geometry: JSON.stringify(geo),
    label: str(input.label, { max: 80 }) ?? '',
    color,
    meta: input.meta && typeof input.meta === 'object' ? JSON.stringify(input.meta).slice(0, 2000) : '{}',
    z_index: Number.isFinite(input.z_index) ? Math.trunc(input.z_index) : 0,
  };
}

export function requireFields(res, body, fields) {
  for (const f of fields) {
    if (body?.[f] === undefined || body?.[f] === null || body?.[f] === '') {
      badRequest(res, `Missing field: ${f}`);
      return false;
    }
  }
  return true;
}
