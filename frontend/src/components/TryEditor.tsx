/**
 * TryEditor — the no-account sandbox at /try/:slug. `blank` opens an empty
 * store; any example slug (e.g. from the homepage carousel) opens a scratch
 * copy of that store's live map. Everything runs against a LocalSession:
 * full editing works, maps persist only to this device (localStorage), and
 * the sandbox banner offers Export, Start over and sign-in-to-save.
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { LocalSession } from '../localStore';
import { elementToRow } from '../types';
import EditorPage, { blankShelfTemplate } from './EditorPage';

export default function TryEditor() {
  const { slug } = useParams<{ slug: string }>();
  const [session, setSession] = useState<LocalSession | null>(null);
  const [error, setError] = useState('');
  const [persistFailed, setPersistFailed] = useState(false);
  // a brand-new blank map offers the starter-skeleton choice once
  const [startDone, setStartDone] = useState(false);
  const [startOffer, setStartOffer] = useState(false);

  useEffect(() => {
    let live = true;
    setSession(null);
    setError('');
    setStartDone(false);
    const key = !slug ? 'blank' : slug;
    // a map previously saved on this device wins over a fresh start — the
    // starter-skeleton choice only appears on a genuinely new blank map
    const saved = LocalSession.loadSaved(key);
    setStartOffer(key === 'blank' && !saved);
    const load = async (): Promise<LocalSession> =>
      saved ?? (key === 'blank' ? LocalSession.blank(key) : await LocalSession.fromSlug(key));
    load()
      .then((s) => {
        if (live) setSession(s);
      })
      .catch((e) => {
        if (live) setError(e.message || 'Could not load that example');
      });
    return () => {
      live = false;
    };
  }, [slug]);

  // localStorage can start failing mid-session (quota hit, private mode) —
  // once it does, the "saved on this device" promise is broken: say so
  useEffect(() => {
    if (!session || persistFailed) return;
    const t = window.setInterval(() => {
      if (session.persistFailed) setPersistFailed(true);
    }, 2000);
    return () => window.clearInterval(t);
  }, [session, persistFailed]);

  if (error) {
    return (
      <div className="container">
        <div className="empty-state card">
          <div className="empty-art" aria-hidden>🧪</div>
          <h2 style={{ margin: '0 0 6px' }}>Could not open the sandbox</h2>
          <p style={{ margin: '0 0 16px' }}>{error}</p>
          <Link className="btn primary" to="/">Back to the homepage</Link>
        </div>
      </div>
    );
  }
  if (!session) {
    return <main className="viewer-loading"><p className="muted">Preparing your sandbox…</p></main>;
  }
  // starting a brand-new map: offer a starter skeleton (walls + blank shelf
  // rows with aisle labels) or a fully blank floor — only on a fresh start
  const showStart = slug === 'blank' && startOffer && !startDone;
  if (showStart) {
    return (
      <div className="container">
        <div className="empty-state card">
          <div className="empty-art" aria-hidden>🧭</div>
          <h2 style={{ margin: '0 0 6px' }}>Start your map</h2>
          <p style={{ margin: '0 0 16px' }}>
            Begin with a blank floor, or drop in a starter skeleton — outer walls, an entrance and
            blank shelf rows with aisle labels you can reshape and rename.
          </p>
          <div className="hero-actions" style={{ justifyContent: 'center' }}>
            <button className="btn" onClick={() => setStartDone(true)}>Blank map</button>
            <button
              className="btn primary"
              onClick={async () => {
                const full = await session.storeFull();
                const floor = full.floors[0];
                const zBase = full.elements
                  .filter((e) => e.floor_id === floor.id)
                  .reduce((m, e) => Math.max(m, e.z_index), 0) + 1;
                await session.saveElements(
                  floor.id,
                  blankShelfTemplate(floor.id, floor.width_m, floor.height_m, zBase).map(elementToRow)
                );
                setStartDone(true);
              }}
            >
              ▦ Blank shelves template
            </button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <>
      {persistFailed && (
        <div className="offline-banner" style={{ position: 'fixed', top: 60 }} role="alert">
          ⚠ This browser can't save your map (storage is full or blocked) — keep editing, then use Export to keep your work.
        </div>
      )}
      <EditorPage tryMode session={session} />
    </>
  );
}
