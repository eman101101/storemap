/** Shared element palette for the 2D and 3D map renderers. */
import type { MapElement } from '../types';

export const TYPE_COLOR: Record<MapElement['type'], string> = {
  wall: '#4b5147',
  shelf: '#e7d5a8',
  aisle: '#8d99a6',
  zone: '#7fa986',
  entrance: '#2f6f3e',
  exit: '#c2453a',
  poi: '#3b6fd4',
};

export const TYPE_STROKE: Record<MapElement['type'], string> = {
  wall: '#3b4038',
  shelf: '#bfa068',
  aisle: '#768392',
  zone: '#628a6b',
  entrance: '#1d5029',
  exit: '#96352c',
  poi: '#2d55a8',
};

/** Lighten/darken a hex color by amount in [-1, 1]. */
export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v + (amt < 0 ? v * amt : (255 - v) * amt))));
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/** Text colour that reads on a fill — dark ink on a light fill, white on a
 *  dark one — chosen from the fill itself, so it holds in both themes. */
export function inkOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lin = [n >> 16 & 255, n >> 8 & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  return luminance > 0.36 ? '#1b1f27' : '#ffffff';
}
