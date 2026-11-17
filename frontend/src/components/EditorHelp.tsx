/**
 * EditorHelp — the optional onboarding tour and the glossary.
 *
 * EditorTour walks a list of steps; each step spotlights a real UI element
 * (CSS selector) with a dimmed spotlight + an explanatory popover, and may
 * run an action first (e.g. switch the map to 3D) so the right controls are
 * on screen. GlossaryModal is the reference for every label the editor shows.
 */
import { useEffect, useLayoutEffect, useState } from 'react';
import { Modal } from './ui';

export interface TourStep {
  /** CSS selector of the element to spotlight — missing targets centre the card */
  selector?: string;
  title: string;
  body: string;
  /** runs when the step becomes active (e.g. flip the map to 3D) */
  action?: () => void;
  /** ms to wait after `action` before looking for the target */
  settleMs?: number;
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const POPOVER_W = 300;
const POPOVER_MARGIN = 14;

export function EditorTour({ steps, onClose }: { steps: TourStep[]; onClose: () => void }) {
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [tick, bumpTick] = useState(0); // bumped on resize/scroll → re-measure

  // run the step's action, then find + spotlight its target. `tick` is bumped
  // by resize/scroll so the spotlight tracks the layout; re-running an action
  // is safe (they're idempotent).
  useLayoutEffect(() => {
    const step = steps[idx];
    if (!step) return;
    if (step.action) step.action();
    const look = () => {
      const el = step.selector ? document.querySelector(step.selector) : null;
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          setRect({ left: r.left, top: r.top, width: r.width, height: r.height });
          return;
        }
      }
      setRect(null); // no visible target → centre the card
    };
    if (step.settleMs) {
      const t = window.setTimeout(look, step.settleMs);
      return () => window.clearTimeout(t);
    }
    look();
  }, [idx, steps, tick]);

  useEffect(() => {
    const re = () => bumpTick((t) => t + 1);
    window.addEventListener('resize', re);
    window.addEventListener('scroll', re, true);
    return () => {
      window.removeEventListener('resize', re);
      window.removeEventListener('scroll', re, true);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && idx < steps.length - 1) setIdx((i) => i + 1);
      if (e.key === 'ArrowLeft' && idx > 0) setIdx((i) => i - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [idx, steps, onClose]);

  const step = steps[idx];
  if (!step) return null;

  // popover placement: under the spotlight when there's room, else above,
  // else clamped into the viewport
  const pop: React.CSSProperties = (() => {
    if (!rect) return { left: '50%', top: '38%', transform: 'translate(-50%, -50%)' };
    const below = rect.top + rect.height + POPOVER_MARGIN;
    const above = rect.top - POPOVER_MARGIN;
    const left = Math.min(
      Math.max(POPOVER_MARGIN, rect.left + rect.width / 2 - POPOVER_W / 2),
      window.innerWidth - POPOVER_W - POPOVER_MARGIN
    );
    if (below + 210 < window.innerHeight) return { left, top: below };
    if (above - 210 > 0) return { left, top: undefined, bottom: window.innerHeight - above };
    return { left, top: Math.max(POPOVER_MARGIN, Math.min(POPOVER_MARGIN, rect.top)) };
  })();

  return (
    <div className="tour-root" role="dialog" aria-label="Editor tour">
      {rect && (
        <div
          className="tour-spot"
          style={{ left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12 }}
        />
      )}
      <div className="tour-card" style={{ width: POPOVER_W, ...pop }}>
        <div className="tour-step-count">
          Step {idx + 1} of {steps.length}
        </div>
        <h3>{step.title}</h3>
        <p>{step.body}</p>
        <div className="tour-actions">
          <button className="btn sm ghost" onClick={onClose}>Skip tour</button>
          <span className="spacer" />
          {idx > 0 && (
            <button className="btn sm" onClick={() => setIdx((i) => i - 1)}>‹ Back</button>
          )}
          <button
            className="btn sm primary"
            onClick={() => (idx < steps.length - 1 ? setIdx((i) => i + 1) : onClose())}
          >
            {idx < steps.length - 1 ? 'Next ›' : 'Got it'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Every label the editor can show, grouped by the section it lives in. */
export function GlossaryModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Glossary — every label explained" onClose={onClose} wide>
      <p className="muted" style={{ marginTop: -6 }}>
        What each control and term in the editor means. Reopen this from the 📖 Glossary button in
        the top bar.
      </p>

      <h4>Placing things (2D mode)</h4>
      <dl className="glossary">
        <dt>Select ⬚</dt>
        <dd>Click to pick a shelf, wall, zone or pin · drag to move it · drag the round handles to resize or rotate · arrow keys nudge · drag empty space to pan the map.</dd>
        <dt>Shelf ▬</dt>
        <dd>Draw a shelf rectangle: press and drag on the map (or just click for a default-sized shelf). Shelves hold product pins.</dd>
        <dt>Wall ▥</dt>
        <dd>Draw a wall segment that shoppers can't walk through.</dd>
        <dt>Zone ▣</dt>
        <dd>A coloured floor area for departments or spaces (Produce, Bakery, seating…).</dd>
        <dt>Label 🏷</dt>
        <dd>A named aisle strip drawn between two shelf rows.</dd>
        <dt>Entrance ⬆</dt>
        <dd>The door shoppers come in through. Routes start here.</dd>
        <dt>Interest points ★</dt>
        <dd>Free-standing markers for anything worth a pin: restrooms, service desk, escalator.</dd>
        <dt>Product pin 📍</dt>
        <dd>Pick a product in the Products tab, then click a spot on a shelf to place its pin. The pin's spot decides where the item sits in the planogram.</dd>
      </dl>

      <h4>View & camera</h4>
      <dl className="glossary">
        <dt>2D / 3D</dt>
        <dd>2D is the drawing view where everything is placed and shaped. 3D is the walkthrough view where the same map is edited in place and checked from a shopper's eye.</dd>
        <dt>Camera pad (arrows)</dt>
        <dd>Pans the 3D camera along the view's screen axes — one tap glides a step.</dd>
        <dt>Zoom in / Zoom out</dt>
        <dd>Steps the camera closer or farther. The mouse wheel also zooms in both views.</dd>
        <dt>Re center ⤢</dt>
        <dd>Refit the camera so the whole floor is on screen.</dd>
        <dt>⌨ Controls</dt>
        <dd>Lists the keyboard and mouse shortcuts.</dd>
      </dl>

      <h4>Side panel tabs</h4>
      <dl className="glossary">
        <dt>Map</dt>
        <dd>Floors (add, rename, reorder) and the list of everything on the current floor — click one to select it.</dd>
        <dt>Products</dt>
        <dd>Categories and products: add items, set price/brand/photo, then pin them to shelves. This is also where the shelf layout preview opens.</dd>
        <dt>Store</dt>
        <dd>Store name, public link and sharing settings.</dd>
        <dt>History</dt>
        <dd>Every change you made, newest first — the undo log.</dd>
      </dl>

      <h4>Shelf layout (planogram)</h4>
      <dl className="glossary">
        <dt>Bays</dt>
        <dd>Vertical sections the shelf is divided into along its width (set in the shelf's layout settings).</dd>
        <dt>Rows (levels)</dt>
        <dd>The shelf boards stacked from the floor up. A pin's level decides which row its item sits on.</dd>
        <dt>Facings</dt>
        <dd>One product's box on a shelf row. A product's facing is placed where its map pin puts it.</dd>
        <dt>Side A / Side B</dt>
        <dd>Aisles have shelves on both faces. Each side shows its own planogram — pins on the near half are Side A, the far half Side B.</dd>
        <dt>Photos / Diagram</dt>
        <dd>Two views of the planogram: Photos shows each product's picture standing on the board; Diagram shows schematic colour boxes.</dd>
      </dl>

      <h4>Saving & exporting</h4>
      <dl className="glossary">
        <dt>Sandbox</dt>
        <dd>The no-account editor (/try/…). Everything works, but the map is saved on this device only.</dd>
        <dt>Save badge</dt>
        <dd>Signed-in editor: shows whether changes are saved, saving, unsaved (dirty) or failed.</dd>
        <dt>⬇ Export</dt>
        <dd>Download the whole map as a transfer bundle (.json) — import it anywhere to restore or move it.</dd>
        <dt>Start over</dt>
        <dd>Discard the device copy of a sandbox map and begin fresh.</dd>
      </dl>
    </Modal>
  );
}
