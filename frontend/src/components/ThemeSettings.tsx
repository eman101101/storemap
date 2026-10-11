/**
 * Appearance & map-style popover: light/dark/system UI mode and the optional
 * retro 2010s map theme. Shown in the top nav (app pages) and the shopper
 * viewer's floating top bar; the choice is saved on this device.
 */
import { useEffect, useRef, useState } from 'react';
import { useTheme, type MapThemeName, type ModePref } from '../theme';

function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { v: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="theme-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          role="radio"
          aria-checked={value === o.v}
          className={value === o.v ? 'active' : ''}
          onClick={() => onChange(o.v)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function ThemeSettings() {
  const { mode, setMode, mapTheme, setMapTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="theme-settings" ref={ref}>
      <button
        type="button"
        className="theme-gear"
        aria-label="Appearance and map style"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden>◐</span>
      </button>
      {open && (
        <div className="theme-pop" role="dialog" aria-label="Appearance and map style">
          <div className="theme-row">
            <span className="theme-row-label">Appearance</span>
            <Segmented<ModePref>
              label="Appearance"
              options={[
                { v: 'light', label: 'Light' },
                { v: 'system', label: 'System' },
                { v: 'dark', label: 'Dark' },
              ]}
              value={mode}
              onChange={setMode}
            />
          </div>
          <div className="theme-row">
            <span className="theme-row-label">Map style</span>
            <Segmented<MapThemeName>
              label="Map style"
              options={[
                { v: 'modern', label: 'Modern' },
                { v: 'retro', label: 'Retro 2010s' },
              ]}
              value={mapTheme}
              onChange={setMapTheme}
            />
          </div>
          <p className="theme-note">Map style applies to the 3D view. Saved on this device.</p>
        </div>
      )}
    </div>
  );
}
