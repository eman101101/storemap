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
          <h2>Sign-in on your instance</h2>
          <p>
            Every self-hosted instance includes the paid-tier features. Three ways to sign in —
            all documented on the{' '}
            <a href={BRANCH} target="_blank" rel="noreferrer">storemaplocal repo</a>:
          </p>
          <div className="tut-callout">
            <ul>
              <li><b>Demo login (default, zero setup)</b> — “Open the demo maps — no sign-in”. Best while you evaluate; turn it off before going public.</li>
              <li><b>Google / Apple sign-in (≈15 min)</b> — already implemented; create OAuth credentials and set them in your config. Works on localhost and in the cloud.</li>
              <li><b>Cloudflare Access (the built-in option)</b> — on the Cloudflare deployment, protect the dashboard with Access (free ≤ 50 users); the worker verifies the signed assertion and maps your email to the owner account. Zero code.</li>
            </ul>
          </div>
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
