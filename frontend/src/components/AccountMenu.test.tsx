/** The Account menu — the site top bar's one control: the light/dark toggle,
 *  sign-in, FAQ and Settings all live in its dropdown. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AccountMenu from './AccountMenu';
import ThemeSettings from './ThemeSettings';
import { AuthContext, LoginModalContext, type AuthCtx } from '../App';
import { ThemeProvider } from '../theme';
import { api } from '../api';
import type { User } from '../types';

// jsdom has no matchMedia — the theme provider listens to the OS setting
beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })),
  });
  localStorage.clear();
  document.documentElement.dataset.mode = 'light';
});
afterEach(() => cleanup());

const PROVIDERS = { google: false, apple: false, facebook: false, email: true, dev: false };

function renderMenu({ user = null, openLogin = vi.fn(), refresh = vi.fn(async () => {}) }: { user?: User | null; openLogin?: () => void; refresh?: AuthCtx['refresh'] } = {}) {
  const auth: AuthCtx = { user, providers: PROVIDERS, loading: false, refresh };
  render(
    <AuthContext.Provider value={auth}>
      <LoginModalContext.Provider value={{ openLogin }}>
        <ThemeProvider>
          <MemoryRouter>
            <AccountMenu />
          </MemoryRouter>
        </ThemeProvider>
      </LoginModalContext.Provider>
    </AuthContext.Provider>
  );
  return { openLogin, refresh };
}

const accountButton = () => screen.getByRole('button', { name: 'Account' });
const openMenu = () => fireEvent.click(accountButton());
const menuItem = (name: string | RegExp) => screen.getByRole('menuitem', { name });

describe('Account menu', () => {
  it('is one control saying "Account", closed until clicked', () => {
    renderMenu();
    expect(accountButton()).toHaveAttribute('aria-expanded', 'false');
    expect(accountButton()).toHaveAttribute('aria-haspopup', 'menu');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Sign in' })).toBeNull();
  });

  it('holds the light/dark toggle, sign in, FAQ and Settings', () => {
    renderMenu();
    openMenu();
    expect(accountButton()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu', { name: 'Account' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: 'Light' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemradio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'false');
    expect(menuItem('Sign in')).toBeInTheDocument();
    expect(menuItem('FAQ')).toBeInTheDocument();
    expect(menuItem('Settings')).toBeInTheDocument();
  });

  it('the toggle flips the whole page between light and dark, and remembers it on the device', () => {
    renderMenu();
    openMenu();
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Dark' }));
    expect(document.documentElement.dataset.mode).toBe('dark');
    expect(localStorage.getItem('storemap.mode')).toBe('dark');
    expect(screen.getByRole('menuitemradio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemradio', { name: 'Light' })).toHaveAttribute('aria-checked', 'false');
    // the menu stays open — the change is visible behind it
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Light' }));
    expect(document.documentElement.dataset.mode).toBe('light');
    expect(localStorage.getItem('storemap.mode')).toBe('light');
  });

  it('FAQ opens the FAQ dialog', () => {
    renderMenu();
    openMenu();
    fireEvent.click(menuItem('FAQ'));
    const faq = screen.getByRole('dialog', { name: 'FAQ' });
    expect(faq).toHaveTextContent('How do I find a product?');
    expect(faq).toHaveTextContent("What does 'out of stock' mean in the results?");
    // the menu gave way to the dialog
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('Settings opens the settings dialog: appearance and the view a store opens in', () => {
    renderMenu();
    openMenu();
    fireEvent.click(menuItem('Settings'));
    const settings = screen.getByRole('dialog', { name: 'Settings' });
    // queries scoped to each switch
    const appearance = within(within(settings).getByRole('radiogroup', { name: 'Appearance' }));
    expect(appearance.getByRole('radio', { name: 'System' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(appearance.getByRole('radio', { name: 'Dark' }));
    expect(localStorage.getItem('storemap.mode')).toBe('dark');
    expect(document.documentElement.dataset.mode).toBe('dark');
    const view = within(within(settings).getByRole('radiogroup', { name: 'Map view' }));
    expect(view.getByRole('radio', { name: '3D' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(view.getByRole('radio', { name: '2D' }));
    expect(localStorage.getItem('storemap.view')).toBe('2d');
    expect(view.getByRole('radio', { name: '2D' })).toHaveAttribute('aria-checked', 'true');
  });

  it('closes on Escape and on a click outside', () => {
    renderMenu();
    openMenu();
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(accountButton()).toHaveAttribute('aria-expanded', 'false');

    openMenu();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();

    // a click inside the menu is not an outside click
    openMenu();
    fireEvent.mouseDown(menuItem('FAQ'));
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('Sign in opens the sign-in modal and closes the menu', () => {
    const { openLogin } = renderMenu();
    openMenu();
    fireEvent.click(menuItem('Sign in'));
    expect(openLogin).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('signed in: the owner account instead of Sign in', () => {
    renderMenu({
      user: {
        id: 'u1', email: 'ana@shop.com', name: 'Ana', avatar_url: '', provider: 'email',
        photo_bytes_used: 1048576, photo_bytes_quota: 209715200,
      },
    });
    expect(accountButton()).toHaveAttribute('title', 'ana@shop.com');
    openMenu();
    expect(screen.getByRole('menu')).toHaveTextContent('Ana');
    expect(screen.getByRole('menu')).toHaveTextContent('ana@shop.com');
    expect(menuItem('My maps')).toHaveAttribute('href', '/dashboard'); // a link to the dashboard
    expect(menuItem(/Plan & storage/)).toHaveTextContent('199 MB free');
    expect(menuItem('Sign out')).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Sign in' })).toBeNull();
    // FAQ and Settings are there whichever state the account is in
    expect(menuItem('FAQ')).toBeInTheDocument();
    expect(menuItem('Settings')).toBeInTheDocument();
  });

  it('Sign out ends the session and refreshes the account', async () => {
    const logout = vi.spyOn(api, 'logout').mockResolvedValue({ ok: true });
    const { refresh } = renderMenu({
      user: { id: 'u1', email: 'ana@shop.com', name: 'Ana', avatar_url: '', provider: 'email' },
    });
    openMenu();
    fireEvent.click(menuItem('Sign out'));
    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    logout.mockRestore();
  });

  it('leaves the store view its own theme toggle', () => {
    // the shopper's store view has no site chrome; it keeps the compact gear
    const { container } = render(<ThemeProvider><ThemeSettings /></ThemeProvider>);
    expect(screen.getByRole('button', { name: 'Switch to dark mode' })).toBeInTheDocument();
    expect(container.querySelector('.account-menu')).toBeNull();
  });
});
