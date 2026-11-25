/**
 * FAQ and Settings — the two dialogs behind the Account menu (AccountMenu.tsx).
 * Both are plain modals over whatever page is open. Settings only exposes the
 * preferences the app already keeps per device (nothing here needs an
 * account): appearance, and the view a store opens in.
 */
import { Link } from 'react-router-dom';
import { useState, type ReactNode } from 'react';
import { Modal } from './ui';
import { useTheme, type ModePref } from '../theme';
import { getViewPref, setViewPref, type MapView } from '../lib/prefs';
import { MOON_ICON, SUN_ICON } from './ThemeSettings';

const K = ({ children }: { children: string }) => <kbd>{children}</kbd>;

const QUESTIONS: { q: string; a: ReactNode }[] = [
  {
    q: 'Do I need an account to look around a store?',
    a: (
      <p>
        No. Every published store has a public page at <code>/s/the-store</code> — open the link or scan the
        QR code the store displays. An account is only for creating and editing maps.
      </p>
    ),
  },
  {
    q: 'How do I find a product?',
    a: (
      <p>
        Type in the search box: a name, brand, SKU or category all match. Pick a result and the map draws the
        walking route to it. <K>/</K> jumps to the search, <K>↑</K> <K>↓</K> and <K>Enter</K> pick a result,
        <K>Esc</K> clears it.
      </p>
    ),
  },
  {
    q: 'Where does the route start and end?',
    a: (
      <p>
        It starts at the entrance nearest your item and ends in the aisle directly in front of the shelf — the
        line never runs through the shelving itself. The time shown assumes a brisk walk (about 80 m a minute).
      </p>
    ),
  },
  {
    q: "What does 'out of stock' mean in the results?",
    a: (
      <p>
        The store's map doesn't place that item on any shelf right now. It comes from the map rather than a
        live stock feed, so it's still worth asking a staff member.
      </p>
    ),
  },
  {
    q: 'Can I plan a trip with several items?',
    a: (
      <p>
        Yes — <b>＋ Add to list</b> on any item. The map numbers the stops and routes them nearest-first, and
        the list shows the total distance and walking time.
      </p>
    ),
  },
  {
    q: 'What do I see when I tap a shelf?',
    a: <p>That shelf's planogram: its bays and rows, and where each product faces on them.</p>,
  },
  {
    q: '2D or 3D?',
    a: (
      <p>
        Both show the same route. 2D is the classic top-down floor plan; 3D can be orbited by dragging and
        zoomed by scrolling or pinching. <K>2</K> and <K>3</K> switch between them; which one a store opens
        in is under <b>Account → Settings</b>.
      </p>
    ),
  },
  {
    q: 'Does it work without a signal?',
    a: <p>After you've opened a store once, its map is saved on your device — search and routes keep working offline.</p>,
  },
  {
    q: 'How do I make a map for my own store?',
    a: (
      <p>
        <b>Create a Map</b> opens the editor straight away, and you can try it without an account (nothing is
        saved until you sign in). Draw the shelves — or start from the shelf template — add item groups, then
        publish to get a public link and a printable QR code.
      </p>
    ),
  },
  {
    q: 'Can my colleagues edit the map too?',
    a: (
      <p>
        Yes. Invite them by email from the dashboard with a role: <b>manager</b> edits maps, the catalogue and
        settings; <b>stock</b> adjusts stock and edits products; <b>viewer</b> is read-only.
      </p>
    ),
  },
  {
    q: 'Can I host it myself?',
    a: (
      <p>
        Yes, for free — see the <Link to="/self-host">self-hosting page</Link>. Self-hosted instances include
        product photos, which are a paid-plan feature of the hosted service.
      </p>
    ),
  },
];

export function FaqModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="FAQ" onClose={onClose} wide>
      <div className="faq">
        {QUESTIONS.map(({ q, a }) => (
          <details key={q} className="faq-item">
            <summary>{q}</summary>
            <div>{a}</div>
          </details>
        ))}
      </div>
    </Modal>
  );
}

/** A two/three-way switch. */
function Segmented<T extends string>({
  label, options, value, onPick,
}: {
  label: string;
  options: { value: T; label: string; icon?: ReactNode }[];
  value: T;
  onPick: (v: T) => void;
}) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'active' : ''}
          onClick={() => onPick(o.value)}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { mode, setMode } = useTheme();
  const [view, setView] = useState<MapView>(getViewPref);
  return (
    <Modal title="Settings" onClose={onClose}>
      <section className="settings-group">
        <h4>Appearance</h4>
        <Segmented
          label="Appearance"
          value={mode}
          onPick={setMode}
          options={[
            { value: 'light', label: 'Light', icon: SUN_ICON },
            { value: 'dark', label: 'Dark', icon: MOON_ICON },
            { value: 'system', label: 'System' },
          ]}
        />
        <p className="muted">System follows your device's light or dark setting.</p>
      </section>
      <section className="settings-group">
        <h4>Map view</h4>
        <Segmented
          label="Map view"
          value={view}
          onPick={(v) => { setView(v); setViewPref(v); }}
          options={[
            { value: '3d', label: '3D' },
            { value: '2d', label: '2D' },
          ]}
        />
        <p className="muted">The view a store opens in. You can still switch with the 2D / 3D buttons.</p>
      </section>
      <p className="muted settings-note">Settings are saved on this device — no account needed.</p>
    </Modal>
  );
}
