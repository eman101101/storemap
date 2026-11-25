/**
 * Per-device preferences kept in localStorage — no account, no server
 * round-trip. (Appearance lives in theme.tsx; this is the rest.)
 */

const VIEW_KEY = 'storemap.view';

export type MapView = '2d' | '3d';

/** The view a store opens in: 3D unless this device switched it to 2D. */
export function getViewPref(): MapView {
  try {
    return localStorage.getItem(VIEW_KEY) === '2d' ? '2d' : '3d';
  } catch {
    return '3d'; // private mode
  }
}

export function setViewPref(view: MapView): void {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    /* private mode */
  }
}
