/**
 * The Account menu — the one control in the site's top bar. "Account" opens a
 * dropdown with everything account-level in one place: the light/dark
 * toggle, sign in (or, once signed in, the owner's pages and sign out), FAQ
 * and Settings. (The shopper's store view has no site chrome and keeps its
 * own compact theme toggle — see ThemeSettings.)
 */
import { useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth, useLoginModal } from '../App';
import { useTheme } from '../theme';
import { FaqModal, SettingsModal } from './Help';
import PricingModal from './PricingModal';
import { MOON_ICON, SUN_ICON } from './ThemeSettings';

const ACCOUNT_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5" />
  </svg>
);

type Dialog = 'faq' | 'settings' | 'plan';

export default function AccountMenu() {
  const { user, refresh } = useAuth();
  const { openLogin } = useLoginModal();
  const { resolved, setMode } = useTheme();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // close the menu on any outside click / Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const close = () => setOpen(false);
  const show = (which: Dialog) => {
    setOpen(false);
    setDialog(which);
  };
  const logout = async () => {
    setOpen(false);
    await api.logout();
    await refresh(); // or the avatar stays and authed calls keep 401ing
    navigate('/');
  };
  const freeMb = (((user?.photo_bytes_quota ?? 0) - (user?.photo_bytes_used ?? 0)) / 1048576).toLocaleString(undefined, {
    maximumFractionDigits: 1,
  });

  return (
    <div className="nav-user" ref={rootRef}>
      <button
        type="button"
        className={`account-btn${open ? ' open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="account-menu"
        title={user ? user.email : 'Account'}
        onClick={() => setOpen((v) => !v)}
      >
        {user ? (
          <span className="avatar" aria-hidden>{(user.name || user.email)[0]?.toUpperCase()}</span>
        ) : (
          <span className="account-glyph" aria-hidden>{ACCOUNT_ICON}</span>
        )}
        <span>Account</span>
        <span className={`account-caret${open ? ' open' : ''}`} aria-hidden>▾</span>
      </button>
      {open && (
        <div className="account-menu" id="account-menu" role="menu" aria-label="Account">
          {user && (
            <div className="account-menu-head">
              {user.name && <b>{user.name}</b>}
              <span>{user.email}</span>
            </div>
          )}
          <div className="account-theme">
            <span className="account-theme-label">Appearance</span>
            <div className="seg" role="group" aria-label="Appearance">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={resolved === 'light'}
                className={resolved === 'light' ? 'active' : ''}
                title="Light mode"
                onClick={() => setMode('light')}
              >
                {SUN_ICON} Light
              </button>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={resolved === 'dark'}
                className={resolved === 'dark' ? 'active' : ''}
                title="Dark mode"
                onClick={() => setMode('dark')}
              >
                {MOON_ICON} Dark
              </button>
            </div>
          </div>
          <div className="account-menu-sep" />
          {user ? (
            <>
              <NavLink to="/dashboard" role="menuitem" onClick={close}>
                My maps
              </NavLink>
              <button type="button" role="menuitem" onClick={() => show('plan')}>
                Plan &amp; storage · {freeMb} MB free
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  void logout();
                }}
              >
                Sign out
              </button>
            </>
          ) : (
            <button
              type="button"
              role="menuitem"
              className="account-signin"
              onClick={() => {
                setOpen(false);
                openLogin();
              }}
            >
              Sign in
            </button>
          )}
          <div className="account-menu-sep" />
          <button type="button" role="menuitem" onClick={() => show('faq')}>
            FAQ
          </button>
          <button type="button" role="menuitem" onClick={() => show('settings')}>
            Settings
          </button>
        </div>
      )}
      {dialog === 'faq' && <FaqModal onClose={() => setDialog(null)} />}
      {dialog === 'settings' && <SettingsModal onClose={() => setDialog(null)} />}
      {dialog === 'plan' && <PricingModal onClose={() => setDialog(null)} />}
    </div>
  );
}
