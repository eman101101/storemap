/** Deck 10 — Theming & UI System. */
import K from './kit.mjs';
const { C, F, W, M } = K;
const SYSTEM = 'Theming & UI';

const p = K.mk(SYSTEM);
K.cover(p, {
  kicker: 'StoreMap systems  ·  10',
  title: 'Theming\n& the UI System',
  subtitle:
    'Light / dark / system appearance over a CSS token layer, plus the optional Retro 2010s map style — both persisted per device, applied before first paint, and wired through a single React context.',
  stats: [
    { n: '3', label: 'appearance modes: light · dark · system' },
    { n: '~20', label: 'CSS design tokens' },
    { n: '0', label: 'flash of wrong theme (pre-paint script)' },
    { n: '2', label: 'map styles: modern · retro' },
  ],
  system: SYSTEM,
});

// 2 · architecture
let s = p.addSlide();
K.header(s, { kicker: 'Architecture', title: 'One provider, two preferences, zero server', system: SYSTEM, page: 2 });
K.flow(p, s, {
  x: M, y: 1.75, w: W - 2 * M, bh: 1.1,
  steps: [
    { t: 'ThemeProvider', d: 'context: mode, resolved, mapTheme' },
    { t: 'localStorage', d: 'storemap.mode · storemap.mapTheme' },
    { t: 'html[data-mode]', d: 'drives every CSS token' },
    { t: 'Map3D theme prop', d: 'MODERN_THEME / RETRO_THEME' },
  ],
});
K.bullets(s, [
  'Appearance (light/dark/system) and map style (modern/retro) are independent preferences — a dark UI can run a modern map.',
  'System mode subscribes to matchMedia(prefers-color-scheme) and follows the OS live; the resolved value lands in data-mode.',
  'Everything is per-device localStorage — no server round-trip, no account coupling; private-mode try/catch falls back gracefully.',
], { x: M, y: 3.3, w: 7.4, h: 2.4, size: 12.5 });
K.codeCard(p, s, {
  x: 8.1, y: 1.75, w: 4.7, h: 4.9, file: 'theme.tsx (essentials)', size: 10,
  code: `const resolved =
  mode === 'system'
    ? (sysDark ? 'dark' : 'light')
    : mode;

useEffect(() => {
  document.documentElement.dataset.mode = resolved;
}, [resolved]);

// OS-following while in system mode:
mq.addEventListener('change',
  (e) => setSysDark(e.matches));`,
});

// 3 · no-flash
s = p.addSlide();
K.header(s, { kicker: 'First paint', title: 'The theme is applied before React exists', system: SYSTEM, page: 3 });
K.bullets(s, [
  'An inline script in index.html runs before any bundle: it reads storemap.mode (defaulting to system) and sets data-mode synchronously.',
  'Without it, a dark-mode user would see a white flash on every load — the classic FOUC.',
  'The React provider later takes over and keeps the attribute in sync when the user changes preferences.',
], { x: M, y: 1.75, w: 7.3, h: 2.4, size: 12.5 });
K.codeCard(p, s, {
  x: M, y: 4.25, w: 7.3, h: 2.35, file: 'index.html (inline, pre-bundle)', size: 10,
  code: `<script>
  var m = localStorage.getItem('storemap.mode');
  var dark = m === 'dark' ||
    ((m === null || m === 'system') &&
     matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.mode =
    dark ? 'dark' : 'light';
</script>`,
});
K.codeCard(p, s, {
  x: 8.1, y: 1.75, w: 4.7, h: 4.9, file: 'styles.css — the token layer', size: 10,
  code: `:root {
  --bg: #f4f6f1;  --surface: #fff;
  --ink: #1d2a20; --line: #e2e7de;
  --green: #2f6f3e; …
  color-scheme: light;
}
html[data-mode='dark'] {
  --bg: #10140f;  --surface: #1a201b;
  --ink: #e7ede4; --line: #2b352d;
  --green: #57a86c; …
  color-scheme: dark;
}`,
});

// 4 · dark palette
s = p.addSlide();
K.header(s, { kicker: 'Dark mode', title: 'A palette, not a filter', system: SYSTEM, page: 4 });
K.table(p, s, {
  x: M, y: 1.75, w: W - 2 * M, colW: [2.8, 3.4, 3.3, 3.9], size: 11,
  rows: [
    ['Token', 'Light', 'Dark', 'Note'],
    ['bg / surface', '#F4F6F1 / #FFF', '#10140F / #1A201B', 'deep green-black, not pure black'],
    ['ink / ink-soft', '#1D2A20 / #5B6B5F', '#E7EDE4 / #9DB0A0', 'contrast kept ≥ 7:1 on surface'],
    ['green (brand)', '#2F6F3E', '#57A86C', 'lightened for dark backgrounds'],
    ['glass surfaces', 'rgba(255,255,255,.95)', 'rgba(24,30,25,.92)', 'floating pills over the map'],
    ['map backdrop', '#E9ECE5', '#151B16', 'canvas surroundings follow'],
    ['route casing', 'white', 'near-black', 'keeps the orange line readable'],
  ],
});
s.addText('A handful of component-specific overrides (error notes, warn chips, modal backdrop) complete the dark theme — everything else flows from the tokens.', { x: M, y: 6.2, w: W - 2 * M, h: 0.4, fontSize: 11.5, fontFace: F.body, color: C.MUTED, margin: 0 });

// 5 · sweep discipline
s = p.addSlide();
K.header(s, { kicker: 'Discipline', title: 'Every color is a token — the sweep rules', system: SYSTEM, page: 5 });
K.bullets(s, [
  'Hardcoded whites and grays were swept to tokens: #fff → var(--surface-solid), rgba(255,255,255,.95) → var(--surface-glass), etc.',
  'Deliberate exceptions stay literal — e.g. the toggle knob stays light in both modes (it rides colored tracks).',
  'color-scheme switches per mode so form controls and scrollbars follow the theme natively.',
  'Dark-only refinements live in html[data-mode=dark] blocks (error/warn notes, hero gradient, shadows) instead of duplicating whole rules.',
  'Focus rings, selection, scrollbars and ::selection all read tokens — keyboard visibility survives the theme switch.',
], { x: M, y: 1.75, w: 7.4, h: 3.6, size: 12.5 });
K.chip(p, s, {
  x: M, y: 5.5, w: 7.4, label: 'Rule',
  text: 'New CSS may not introduce raw hex colors — add or reuse a token, or the dark theme silently breaks.',
});
K.codeCard(p, s, {
  x: 8.1, y: 1.75, w: 4.7, h: 4.9, file: 'tokens in use', size: 10,
  code: `.store-pill {
  background: var(--surface-glass);
  border: 1px solid var(--line);
  color: var(--ink);
}

.btn.primary {
  background: var(--green);
  color: #fff;               /* on-brand, both modes */
}

html[data-mode='dark'] .warn-note {
  background: #2c2416;
  border-color: #544424;
  color: #d9b96a;
}`,
});

// 6 · settings UI
s = p.addSlide();
K.header(s, { kicker: 'Settings UI', title: 'The ◐ popover, everywhere the user is', system: SYSTEM, page: 6 });
K.bullets(s, [
  'ThemeSettings renders in the top nav (app pages) and inside the viewer\'s floating bar — one component, two placements.',
  'Two segmented controls: Appearance (Light · System · Dark) and Map style (Modern · Retro 2010s), wired as radios with aria-checked.',
  'Closes on outside pointerdown and Escape; changes apply instantly — no save button, the provider persists on change.',
  'The map-style note explains scope: it applies to the 3D view and is saved per device.',
  'In the viewer the gear sizes to the 40 px pill grid; on mobile it wraps into the ordered top-bar rows.',
], { x: M, y: 1.75, w: 7.4, h: 3.8, size: 12.5 });
K.codeCard(p, s, {
  x: 8.1, y: 1.75, w: 4.7, h: 4.9, file: 'usage — ViewerPage / Landing', size: 10,
  code: `const { mapTheme } = useTheme();
const sceneTheme =
  mapTheme === 'retro'
    ? RETRO_THEME
    : MODERN_THEME;

<Map3D … theme={sceneTheme} />

// the retro switch rebuilds scene faces
// + BSP from the memoized theme dep —
// the change is instant and complete.`,
});

// 7 · retro map theme
s = p.addSlide();
K.header(s, { kicker: 'Map style', title: 'Retro 2010s — the optional look, by request', system: SYSTEM, page: 7 });
K.bullets(s, [
  'Implemented per the design doc (DESIGN-RETRO-3D.md): saturated blue gradient sky (no sun), warm parchment floor, punchy lighting.',
  'Two-tone gloss splits every fixture side into a sunlit band and shaded base; contact shadows offset away from the light.',
  'Route gets a gloss strip + dashed centerline; labels switch to warm halo + dark outline + cream text; a vignette sits under the overlay.',
  'Zero cost when off: the theme object defaults to MODERN, and pinned tests keep the classic face counts and colors exact.',
], { x: M, y: 1.75, w: 7.4, h: 3.4, size: 12.5 });
K.chip(p, s, {
  x: M, y: 5.3, w: 7.4, label: 'Design rule',
  text: 'All retro effects are polygon-based (two-tone fills, shadow decals, gradient backdrop) — no Canvas filters, so the engine\'s 60 fps budget holds in both themes.',
});
K.codeCard(p, s, {
  x: 8.1, y: 1.75, w: 4.7, h: 4.9, file: 'the whole switch', size: 10,
  code: `export const RETRO_THEME: MapTheme = {
  floorFill: '#e9dcba',
  gridFill:  '#d6c69a',
  skyTop:    '#7cb2e2',
  skyBottom: '#e6f0f9',
  light: { x: -0.45, y: -0.42, z: 0.78 },
  ambient: 0.42,
  diffuse: 0.58,
  retro: true,
};

// every builder takes the theme as an
// optional last arg — MODERN default.`,
});

K.closing(p, {
  title: 'Theming rules this system keeps',
  system: SYSTEM,
  points: [
    { t: 'Tokens, not colors', d: 'the stylesheet speaks in CSS variables; modes are one attribute flip.' },
    { t: 'First paint correctness', d: 'the pre-bundle script means the right theme from byte zero.' },
    { t: 'Map style is data', d: 'retro/modern is a theme object threaded through the renderer — no UI branching.' },
    { t: 'Per-device by design', d: 'appearance is a device preference, not account state; private mode degrades silently.' },
  ],
});

p.writeFile({ fileName: '10-theming-ui.pptx' }).then(() => console.log('ok 10'));
