import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Routes, Route, Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from './api';
import type { AuthInfo } from './types';
import { ThemeProvider } from './theme';
import { BlockText } from './components/GridHero';
import Landing from './components/Landing';
import LoginModal from './components/Login';
import SelfHost from './components/SelfHost';
import InviteAcceptPage from './components/Team';
import Dashboard from './components/Dashboard';
import EditorPage from './components/EditorPage';
import TryEditor from './components/TryEditor';
import StockPage from './components/StockPage';
import ViewerPage from './components/ViewerPage';
import AccountMenu from './components/AccountMenu';

export interface AuthCtx extends AuthInfo {
  loading: boolean;
  refresh: () => Promise<void>;
}

export const AuthContext = createContext<AuthCtx>({ user: null, providers: { google: false, apple: false, facebook: false, email: true, dev: false }, loading: true, refresh: async () => {} });
export const useAuth = () => useContext(AuthContext);

interface LoginModalCtrl {
  /** Open the sign-in popup; `next` is where to land after signing in. */
  openLogin: (next?: string, error?: string) => void;
}
export const LoginModalContext = createContext<LoginModalCtrl>({ openLogin: () => {} });
export const useLoginModal = () => useContext(LoginModalContext);

export default function App() {
  const [auth, setAuth] = useState<AuthInfo>({ user: null, providers: { google: false, apple: false, facebook: false, email: true, dev: false } });
  const [loading, setLoading] = useState(true);
  const [login, setLogin] = useState<{ open: boolean; next?: string; error?: string }>({ open: false });
  const openLogin = (next?: string, error?: string) => setLogin({ open: true, next, error });
  const location = useLocation();
  const navigate = useNavigate();
  // the shopper viewer is a full-bleed experience — no site chrome
  const isViewer = location.pathname.startsWith('/s/');
  // the map editors keep the site nav above the workspace, but the workspace
  // must fit the viewport BELOW it (the shell caps and the editor flexes — see
  // .app-shell.has-editor) or the map pokes out above the bars when scrolling
  const isEditorRoute =
    location.pathname.startsWith('/try/') ||
    /^\/dashboard\/stores\/[^/]+$/.test(location.pathname);

  const refresh = useCallback(async () => {
    try {
      setAuth(await api.me());
    } catch {
      /* offline / server restarting */
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  // OAuth sign-ins round-trip through the provider and land back here — the
  // login modal parks the `next` destination in sessionStorage on those clicks
  // (see Login.tsx); finish that navigation once the user actually appears.
  const hadUser = useRef(false);
  useEffect(() => {
    const signedIn = !!auth.user;
    if (signedIn && !hadUser.current) {
      try {
        const raw = sessionStorage.getItem('storemap:oauth-next');
        if (raw) {
          sessionStorage.removeItem('storemap:oauth-next');
          const { next, ts } = JSON.parse(raw) as { next?: string; ts?: number };
          if (typeof next === 'string' && next.startsWith('/') && Date.now() - (ts ?? 0) < 10 * 60 * 1000) {
            navigate(next);
          }
        }
      } catch {
        /* storage unavailable or a corrupt entry */
      }
    }
    hadUser.current = signedIn;
  }, [auth.user, navigate]);
  // the context value must be referentially stable, or every useAuth consumer
  // re-renders on each navigation
  const authValue = useMemo(() => ({ ...auth, loading, refresh }), [auth, loading, refresh]);

  return (
    <AuthContext.Provider value={authValue}>
      <LoginModalContext.Provider value={{ openLogin }}>
      <ThemeProvider>
        <div className={'app-shell' + (isEditorRoute ? ' has-editor' : '')}>
          {!isViewer && <TopNav />}
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<LoginEntry />} />
            <Route path="/self-host" element={<SelfHost />} />
            <Route path="/invite/:token" element={<InviteAcceptPage />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/try/:slug" element={<TryEditor />} />
            <Route path="/dashboard/stores/:storeId" element={<EditorPage />} />
            <Route path="/dashboard/stores/:storeId/stock" element={<StockPage />} />
            <Route path="/s/:slug" element={<ViewerPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </div>
        <LoginModal
          open={login.open}
          onClose={() => setLogin({ open: false })}
          next={login.next}
          error={login.error}
        />
      </ThemeProvider>
      </LoginModalContext.Provider>
    </AuthContext.Provider>
  );
}

/** The site's top bar: the brand on the left, the Account menu on the right
 *  (theme, sign-in, FAQ and Settings all live inside it — see AccountMenu). */
function TopNav() {
  return (
    <nav className="topnav">
      <Link to="/" className="brand" aria-label="item.place — home">
        <BlockText text="item.place" cell={2.4} />
      </Link>
      <div className="spacer" />
      <AccountMenu />
    </nav>
  );
}

/** /login now pops the sign-in modal over the homepage (params preserved). */
function LoginEntry() {
  const { openLogin } = useLoginModal();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  useEffect(() => {
    openLogin(params.get('next') ?? undefined, params.get('error') ?? undefined);
    navigate('/', { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function NotFound() {
  return (
    <div className="container">
      <div className="empty-state card">
        <div className="empty-art" aria-hidden>🧭</div>
        <h2 style={{ margin: '0 0 6px' }}>You're off the map</h2>
        <p style={{ margin: '0 0 16px' }}>The page you're after doesn't exist — but every store is one tap away.</p>
        <div className="hero-actions" style={{ justifyContent: 'center' }}>
          <Link to="/" className="btn primary">Browse stores</Link>
          <Link to="/s/walmart-example" className="btn">See the demo</Link>
        </div>
      </div>
    </div>
  );
}
