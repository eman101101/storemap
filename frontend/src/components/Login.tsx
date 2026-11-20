import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../App';
import { APPLE_LOGO, FACEBOOK_F, GOOGLE_G, Modal } from './ui';

/**
 * Sign-in popup. OAuth buttons (Google/Apple/Facebook — each appears once its
 * credentials are configured server-side) plus the passwordless email-code
 * form, which always works: with a mail provider configured the 6-digit code
 * is emailed; otherwise the instance returns it (local mode) and it's shown
 * right here. The unrestricted dev form stays available on instances that
 * enabled it (private/self-host).
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
  const [code, setCode] = useState('');
  const [sent, setSent] = useState<{ devCode?: string } | null>(null);
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

  const requestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setLocalError('');
    try {
      const res = await api.emailRequest(email);
      setSent({ devCode: res.devCode });
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Could not send the code');
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setLocalError('');
    try {
      await api.emailVerify(email, code);
      await refresh();
      setSent(null);
      onClose();
      navigate(next || '/dashboard');
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
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

  return (
    <Modal title="Sign in" onClose={onClose}>
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
        <a
          className="btn oauth"
          href="/api/auth/facebook"
          onClick={rememberOauthNext}
          style={providers.facebook ? undefined : { opacity: 0.55, pointerEvents: 'none' }}
        >
          {FACEBOOK_F}
          Continue with Facebook
        </a>
      </div>

      {providers.email && (
        <form onSubmit={sent ? verifyCode : requestCode}>
          <div className="divider">or sign in with an email code</div>
          {!sent ? (
            <>
              <label className="field">
                <span>Email</span>
                <input
                  className="input"
                  type="email"
                  placeholder="owner@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </label>
              <button className="btn primary block" disabled={busy}>
                {busy ? 'Sending…' : 'Email me a code'}
              </button>
            </>
          ) : (
            <>
              <p className="muted" style={{ fontSize: 12.5, margin: '4px 0 8px' }}>
                Enter the 6-digit code sent to <b>{email}</b>.
                {sent.devCode && (
                  <> Local mode (no mail server configured) — your code:{' '}
                    <b style={{ letterSpacing: 2 }}>{sent.devCode}</b>
                  </>
                )}
              </p>
              <label className="field">
                <span>Code</span>
                <input
                  className="input"
                  inputMode="numeric"
                  placeholder="123456"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  autoFocus
                />
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn ghost" onClick={() => { setSent(null); setCode(''); }}>
                  ← Back
                </button>
                <button className="btn primary" style={{ flex: 1 }} disabled={busy || code.length !== 6}>
                  {busy ? 'Signing in…' : 'Sign in'}
                </button>
              </div>
            </>
          )}
        </form>
      )}

      {providers.dev && (
        <form onSubmit={devLogin}>
          <div className="divider">or one-click local login</div>
          <button className="btn block" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in without a code (local instance)'}
          </button>
        </form>
      )}
    </Modal>
  );
}
