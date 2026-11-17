import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../App';
import { APPLE_LOGO, GOOGLE_G, Modal } from './ui';

/**
 * Sign-in popup (replaces the old /login page). OAuth-first: Google/Apple
 * buttons, plus the dev email form only on instances with no OAuth provider
 * configured (pure-local self-hosts) so they stay usable.
 */
export default function LoginModal({
  open, onClose, next, error,
}: {
  open: boolean;
  onClose: () => void;
  next?: string;
  error?: string;
}) {
  const { user, providers, refresh } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState('');

  if (!open) return null;

  // OAuth redirects away and back, dropping any ?next= — park it so App can
  // finish the navigation once the signed-in user appears (see App.tsx)
  const rememberOauthNext = () => {
    if (user || !next || !next.startsWith('/')) return;
    try {
      sessionStorage.setItem('storemap:oauth-next', JSON.stringify({ next, ts: Date.now() }));
    } catch { /* storage unavailable */ }
  };

  const devLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setLocalError('');
    try {
      await api.devLogin(email || 'owner@example.com');
      await refresh();
      onClose();
      navigate(next || '/dashboard');
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  const oauthOnly = providers.google || providers.apple;

  return (
    <Modal title="Store owner sign in" onClose={onClose}>
      <p className="muted" style={{ marginTop: -4 }}>
        Create and publish store maps. Shoppers never need an account.
      </p>
      {(error || localError) && <div className="error-note">{error || localError}</div>}

      <div className="stack">
        <a
          className="btn oauth"
          href="/api/auth/google"
          onClick={rememberOauthNext}
          style={providers.google ? undefined : { opacity: 0.55, pointerEvents: 'none' }}
        >
          {GOOGLE_G}
          Continue with Google
        </a>
        <a
          className="btn oauth"
          href="/api/auth/apple"
          onClick={rememberOauthNext}
          style={providers.apple ? undefined : { opacity: 0.55, pointerEvents: 'none' }}
        >
          {APPLE_LOGO}
          Continue with Apple
        </a>
      </div>

      {!oauthOnly && (
        <>
          <p className="muted" style={{ fontSize: 12.5 }}>
            Google &amp; Apple sign-in activate automatically once OAuth credentials are configured on
            the server. Self-hosting? The{' '}
            <a href="https://github.com/eman101101/storemaplocal" target="_blank" rel="noreferrer">self-host guide</a> has the recipes.
          </p>
          {providers.dev && (
            <form onSubmit={devLogin}>
              <div className="divider">or sign in by email (local instance)</div>
              <label className="field">
                <span>Email</span>
                <input
                  className="input"
                  type="email"
                  placeholder="owner@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <button className="btn primary block" disabled={busy}>
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          )}
        </>
      )}
    </Modal>
  );
}
