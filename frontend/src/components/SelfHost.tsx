import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

/**
 * The main-branch version of the self-host page: an overview that links to the
 * ``storemaplocal` repo, where the up-to-date local-host steps, the
 * Cloudflare Workers port and the one-click deploy live.
 */

const REPO = 'https://github.com/eman101101/storemap';
const BRANCH = "https://github.com/eman101101/storemaplocal";

function BranchCard({ href, num, title, children }: { href: string; num: string; title: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="card tut-path">
      <span className="num">{num}</span>
      <b>{title}</b>
      <span>{children}</span>
      <span className="tut-branch-cta">Open the storemaplocal repo →</span>
    </a>
  );
}

export default function SelfHost() {
  return (
    <main className="container">
      <article className="tut">
        <header className="tut-head">
          <h1>
            Host your own grocery map <em>for free</em>
          </h1>
          <p>
            StoreMap is one small Node.js process with one SQLite file — no databases to install, no
            services to wire up. Self-host it and you get everything, including the paid-tier features:
            product photos are always included in local mode. Two ways to get there — both free.
          </p>
        </header>

        <div className="tut-callout">
          <b>Heads-up:</b> the newest self-hosting code — the current local-host steps and the
          Cloudflare Workers deployment (D1 + R2, one-click deploy button) — lives on the{' '}
          <a href={BRANCH} target="_blank" rel="noreferrer">
            <code>storemaplocal</code> repo
          </a>
          . The options below link straight to it; merge it into <code>main</code> when you're ready
          to make them official.
        </div>

        <nav className="tut-paths">
          <BranchCard href={`${BRANCH}#local`} num="1" title="Your computer, online">
            Run it on Node.js, then borrow a free public https address with a tunnel
            (Cloudflare quick tunnel or ngrok). Full-featured, real data, $0.
          </BranchCard>
          <BranchCard href={`${BRANCH}#cf`} num="2" title="Cloudflare, always on">
            One click to Workers + D1 + R2 — always online on the free tier, and the
            demo maps seed themselves on first visit.
          </BranchCard>
        </nav>

        <h3 className="tut-choose-title">Which one is for me?</h3>
        <div className="card tut-table-wrap">
          <table className="tut-table tut-choose">
            <thead>
              <tr><th>Way to host</th><th>Cost</th><th>Map survives restarts?</th><th>Best for</th></tr>
            </thead>
            <tbody>
              <tr><td>1 · Your computer</td><td>free</td><td>yes</td><td>trying it, drawing your map</td></tr>
              <tr><td>1 · Your computer + free tunnel</td><td>free</td><td>yes</td><td>real shoppers at $0 — while the computer is on</td></tr>
              <tr><td>2 · Cloudflare Workers (one click)</td><td>free tier</td><td>yes — data lives in D1</td><td>always-on at $0</td></tr>
            </tbody>
          </table>
        </div>

        <section id="signin">
          <h2>Sign-in on your instance — Google &amp; Apple OAuth setup</h2>
          <p>
            Every self-hosted instance includes the paid-tier features. Three ways to sign in —
            the email demo login works with zero setup; Google and Apple take about 15 minutes of
            console clicking. Both OAuth providers are already implemented — you only create
            credentials and set them in your config.
          </p>

          <div className="tut-callout">
            <b>Before you start:</b> know your instance's public address (the <code>PUBLIC_BASE_URL</code>,
            e.g. <code>http://localhost:8787</code> for local runs or your Workers/custom domain in the
            cloud). Every redirect URI below is that address plus the callback path.
          </div>

          <h3>Google sign-in (~10 minutes)</h3>
          <ol className="tut-steps">
            <li>
              Open <a href="https://console.cloud.google.com" target="_blank" rel="noreferrer">console.cloud.google.com</a>{' '}
              and create (or pick) a project — the name doesn't matter, e.g. <code>item-place</code>.
            </li>
            <li>
              Left menu → <b>APIs &amp; Services</b> → <b>OAuth consent screen</b> → External → fill in
              the app name and your email; add yourself as a <b>test user</b> if you keep it unpublished.
            </li>
            <li>
              <b>Credentials</b> → <b>Create credentials</b> → <b>OAuth client ID</b> → type{' '}
              <b>Web application</b>.
            </li>
            <li>
              Under <b>Authorized redirect URIs</b> add exactly:{' '}
              <code>&lt;PUBLIC_BASE_URL&gt;/api/auth/google/callback</code>{' '}
              (e.g. <code>http://localhost:8787/api/auth/google/callback</code>).
            </li>
            <li>
              Copy the <b>client ID</b> and <b>client secret</b>, then set them for your instance:{' '}
              <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> (env vars for a Node
              run; Workers → Variables → Secrets on Cloudflare; or <code>npx wrangler secret put</code>).
            </li>
            <li>
              Restart / redeploy — the <b>Continue with Google</b> button appears on the sign-in popup
              immediately.
            </li>
          </ol>

          <h3>Apple sign-in (~15 minutes)</h3>
          <ol className="tut-steps">
            <li>
              You need an <a href="https://developer.apple.com/account" target="_blank" rel="noreferrer">Apple Developer</a>{' '}
              membership ($99/yr). Open <b>Certificates, Identifiers &amp; Profiles</b> →{' '}
              <b>Identifiers</b>.
            </li>
            <li>
              Register a <b>Services ID</b> (e.g. <code>com.yourname.storemap.web</code>) and tick{' '}
              <b>Sign In with Apple</b> → Configure.
            </li>
            <li>
              Set the <b>Return URL</b> to{' '}
              <code>&lt;PUBLIC_BASE_URL&gt;/api/auth/apple/callback</code> and the domain to your
              instance's host. Save.
            </li>
            <li>
              Create a <b>Sign In with Apple key</b>: Identifiers → Keys → register a key with
              Sign In with Apple enabled (choose your primary App ID), then download the{' '}
              <code>.p8</code> key file and note the <b>Key ID</b>.
            </li>
            <li>
              Set four variables: <code>APPLE_CLIENT_ID</code> (the Services ID),{' '}
              <code>APPLE_TEAM_ID</code> (top-right in the developer account),{' '}
              <code>APPLE_KEY_ID</code>, and <code>APPLE_PRIVATE_KEY</code> (the whole{' '}
              <code>.p8</code> contents — newlines escaped as <code>\n</code> in one line).
            </li>
            <li>
              Restart / redeploy — <b>Continue with Apple</b> joins Google on the sign-in popup.
            </li>
          </ol>

          <div className="tut-callout">
            <b>Troubleshooting:</b> a <code>redirect_uri_mismatch</code> means the console URI and your
            <code> PUBLIC_BASE_URL</code> differ (trailing slash, http vs https). Sign-in error 401 on
            Apple usually means the <code>.p8</code> newlines weren't escaped. The demo email login
            keeps working until you remove <code>ENABLE_DEV_LOGIN</code> — turn it off before going
            public, since it accepts any email.
          </div>
          <p className="muted">
            Prefer zero console clicking? On the Cloudflare deployment, <b>Cloudflare Access</b>{' '}
            protects the dashboard instead (free ≤ 50 users) — see{' '}
            <a href={BRANCH} target="_blank" rel="noreferrer">the storemaplocal repo</a>.
          </p>
        </section>

        <footer className="tut-foot">
          Source: <a href={REPO} target="_blank" rel="noreferrer">github.com/eman101101/storemap</a> ·{' '}
          self-host edition: <a href={BRANCH} target="_blank" rel="noreferrer">storemaplocal</a>.
          <div className="hero-actions" style={{ marginTop: 18 }}>
            <Link to="/" className="btn primary">Browse the demo maps</Link>
            <Link to="/login" className="btn">Sign in and build your map</Link>
          </div>
        </footer>
      </article>
    </main>
  );
}
