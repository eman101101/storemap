/**
 * Appearance toggle: one click flips light ↔ dark (saved on this device).
 * Shown in the shopper viewer's floating bar (the app pages keep the toggle
 * in their Account menu — see AccountMenu.tsx, which reuses the icons).
 * First visits follow the OS; the first click pins an explicit choice.
 * The icon shows the mode you'll switch TO (sun → light, moon → dark).
 */
import { useTheme } from '../theme';

export const SUN_ICON = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" aria-hidden>
    <circle cx="12" cy="12" r="4.4" />
    <path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.3 5.3l1.7 1.7M17 17l1.7 1.7M18.7 5.3L17 7M7 17l-1.7 1.7" />
  </svg>
);

export const MOON_ICON = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M20.6 14.2A8.6 8.6 0 0 1 9.8 3.4a8.6 8.6 0 1 0 10.8 10.8z" />
  </svg>
);

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
        <span key={resolved} aria-hidden>{dark ? SUN_ICON : MOON_ICON}</span>
      </button>
    </div>
  );
}
