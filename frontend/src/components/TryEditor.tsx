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
import EditorPage from './EditorPage';

export default function TryEditor() {
  const { slug } = useParams<{ slug: string }>();
  const [session, setSession] = useState<LocalSession | null>(null);
  const [error, setError] = useState('');
  const [persistFailed, setPersistFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setSession(null);
    setError('');
    const key = !slug ? 'blank' : slug;
    const load = async (): Promise<LocalSession> =>
      // a map previously saved on this device wins over a fresh start
      LocalSession.loadSaved(key) ??
      (key === 'blank' ? LocalSession.blank(key) : await LocalSession.fromSlug(key));
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
