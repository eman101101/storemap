import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../App';
import { APPLE_LOGO, GOOGLE_G } from './ui';

export default function Login() {
  const { providers, refresh } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState('');

  const error = params.get('error');

  const devLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setLocalError('');
    try {
      await api.devLogin(email || 'owner@example.com');
      await refresh();
      navigate(params.get('next') || '/dashboard');
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  const demoLogin = async () => {
    setBusy(true);
    setLocalError('');
    try {
      await api.demoLogin();
      await refresh();
      navigate(params.get('next') || '/dashboard');
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-wrap">
      <div className="card auth-card">
        <h1>Store owner sign in</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          Create and publish store maps. Shoppers never need an account.
        </p>
        {(error || localError) && <div className="error-note">{error || localError}</div>}

        {providers.dev && (
          <>
            <button className="btn primary block" onClick={demoLogin} disabled={busy}>
              🗺️ Open the demo maps — no sign-in
            </button>
            <p className="muted" style={{ fontSize: 12.5, margin: '8px 0 0' }}>
              One click straight into the demo/test maps (Annex Market, and any map drawn under
              the demo account) — handy for trying the editor.
            </p>
            <div className="divider">or</div>
          </>
        )}

        <div className="stack">
          <a
            className="btn oauth"
            href="/api/auth/google"
            style={providers.google ? undefined : { opacity: 0.55, pointerEvents: 'none' }}
          >
            {GOOGLE_G}
            Continue with Google
          </a>
          <a
            className="btn oauth"
            href="/api/auth/apple"
            style={providers.apple ? undefined : { opacity: 0.55, pointerEvents: 'none' }}
          >
            {APPLE_LOGO}
            Continue with Apple
          </a>
        </div>

        {!providers.google && !providers.apple && (
          <p className="muted" style={{ fontSize: 12.5 }}>
            Google &amp; Apple sign-in activate automatically once OAuth credentials are configured
            on the server (see README.md).
          </p>
        )}

        {providers.dev && (
          <>
            <div className="divider">or local demo sign-in</div>
            <form onSubmit={devLogin}>
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
                {busy ? 'Signing in…' : 'Sign in for testing'}
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
