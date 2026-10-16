/**
 * App theming: appearance (light / dark / system) for the UI, and the map
 * style (modern / retro 2010s) for the 3D scene. Both are per-device
 * preferences persisted in localStorage — no server round-trip.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type ModePref = 'light' | 'dark' | 'system';

interface ThemeCtx {
  mode: ModePref;
  setMode: (m: ModePref) => void;
  /** What 'system' currently resolves to — for callers that need the actual mode. */
  resolved: 'light' | 'dark';
}

const ThemeContext = createContext<ThemeCtx>({
  mode: 'system',
  setMode: () => {},
  resolved: 'light',
});
export const useTheme = () => useContext(ThemeContext);

const MODE_KEY = 'storemap.mode';

function readStored<T extends string>(key: string, valid: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && valid.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ModePref>(() => readStored(MODE_KEY, ['light', 'dark', 'system'] as const, 'system'));
  const [sysDark, setSysDark] = useState(() =>
    typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)').matches : false
  );

  // follow the OS while in 'system' mode
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSysDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const resolved: 'light' | 'dark' = mode === 'system' ? (sysDark ? 'dark' : 'light') : mode;

  useEffect(() => {
    document.documentElement.dataset.mode = resolved;
  }, [resolved]);

  const setMode = (m: ModePref) => {
    setModeState(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* private mode */
    }
  };
  return (
    <ThemeContext.Provider value={{ mode, setMode, resolved }}>
      {children}
    </ThemeContext.Provider>
  );
}
