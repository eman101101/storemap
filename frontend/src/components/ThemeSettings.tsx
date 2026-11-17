/**
 * Appearance toggle: one click flips light ↔ dark (saved on this device).
 * Shown in the top nav (app pages) and the shopper viewer's floating bar.
 * First visits follow the OS; the first click pins an explicit choice.
 */
import { useTheme } from '../theme';

export default function ThemeSettings() {
  const { resolved, setMode } = useTheme();
  const dark = resolved === 'dark';
  const next = dark ? 'light' : 'dark';
  return (
    <div className="theme-settings">
      <button
        type="button"
        className="theme-gear"
        aria-label={`Switch to ${next} mode`}
        title={`Switch to ${next} mode`}
        onClick={() => setMode(next)}
      >
        <span key={resolved} aria-hidden>{dark ? '☀' : '☾'}</span>
      </button>
    </div>
  );
}
