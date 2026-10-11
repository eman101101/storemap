# Easy hosting guide — Vercel-style deploy on Railway

You asked for "Vercel but it runs this app." Vercel itself can't: it runs
serverless functions with an ephemeral filesystem, and StoreMap is a
long-running Express server with a **SQLite database on disk** plus uploaded
images on disk. Anything that doesn't give you a persistent volume loses
your data on every deploy.

The closest Vercel-like experience that *does* work:

| Platform | Push-to-deploy | Persistent volume | Fits? | Cost |
|---|---|---|---|---|
| **Railway** ✅ recommended | GitHub auto-deploy on every push | Yes, mount any path | Yes — builds the existing Dockerfile as-is | Hobby $5/mo (incl. usage credit) |
| Render | GitHub auto-deploy | Yes, on paid web services | Yes | ~$7–9/mo |
| Fly.io | via GitHub Actions (more CLI-ish) | Yes (`fly.toml` already written) | Already fully configured — see [DEPLOY.md](DEPLOY.md) | ~$6/mo |
| Vercel / Netlify | yes | no | **No** — serverless, no disk | — |

This guide walks **Railway** (the most Vercel-like: connect repo, it watches
`main`, every push redeploys, env vars and a database browser in the
dashboard). Render at the end for completeness. Fly.io remains the
"already-wired" option per `docs/DEPLOY.md`.

---

## 0. Prerequisite: code on GitHub

The repo must be on GitHub first (Railway deploys from there):

```bash
brew install gh                       # if not installed
gh auth login
gh repo create storemap --private --source=. --push
```

A bonus you get for free: Railway builds from the **git checkout**, not
your laptop's folder — so the missing-`.dockerignore` issue from the code
review (host `node_modules` being copied into the image) can't bite here;
the checkout contains no `node_modules`.

## 1. Create the service (~3 minutes)

1. [railway.app](https://railway.app) → **Login with GitHub** (grants access
   to the `storemap` repo).
2. **New Project → Deploy from GitHub repo** → pick `storemap`.
3. Railway detects the root `Dockerfile` and builds it — no build settings
   needed. The image already: builds the frontend SPA, installs backend
   production deps, exposes port **8787** with a `/api/health` healthcheck.
   Railway injects a `PORT` env var and the app honors it (`config.js`
   reads `PORT`, default 8787) — nothing to change.

## 2. Attach the volume (the important one)

Service → **Settings → Volumes → New Volume**:

- **Mount path: `/data`** — this is the path the app already expects
  (`DATA_DIR=/data` is baked into the Dockerfile). SQLite DB and uploaded
  images land there and survive every deploy and restart.

Two hard rules that come with SQLite:

- **Never scale past 1 replica** (single-writer DB, and the volume is
  region-pinned). Railway defaults to 1 — leave it.
- Don't remove/recreate the volume casually; that *is* your data.

## 3. Environment variables

Service → **Variables**:

```bash
NODE_ENV=production
PUBLIC_BASE_URL=https://<your-app>.up.railway.app   # set after step 4
SESSION_SECRET=<paste the output of the command below>
TRUST_PROXY=true
```

Generate the secret locally:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

`SESSION_SECRET` is mandatory — the app refuses to boot in production
without it. `TRUST_PROXY=true` is required behind Railway's TLS proxy.

## 4. Domain & first deploy

1. Service → **Settings → Networking → Generate Domain**
   (e.g. `storemap-production.up.railway.app`).
2. Put that URL back into `PUBLIC_BASE_URL` (step 3) — the app builds
   OAuth redirect URLs and share links from it.
3. Railway redeploys on variable changes. Open
   `https://<your-app>.up.railway.app/api/health` → expect
   `{"ok":true,…}`. Then open the site and the demo store.

Optional custom domain: Settings → Networking → Custom Domain, follow the
DNS instructions, then update `PUBLIC_BASE_URL` to
`https://map.yourdomain.com` and redeploy.

## 5. Enable the demo login locally-first behavior correctly

By default `ENABLE_DEV_LOGIN` is **off** in production (good). To sign in,
configure Google/Apple OAuth per the README ("Deploying online", steps 2-3)
with redirect URIs using your Railway URL:

```
https://<your-app>.up.railway.app/api/auth/google/callback
https://<your-app>.up.railway.app/api/auth/apple/callback
```

## 6. Backups — read this before relying on them

The volume has your only copy of the data. Two options:

- **Platform backups:** Railway volume backups/snapshots depend on plan —
  check what your plan includes in the volume's settings.
- **Litestream → Cloudflare R2** (10 GB free, what the repo ships for): set
  `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`
  and the container starts replicating the DB to R2 every 10 s.

  ⚠️ **Known bug from the code review, fix before relying on this path:**
  `backend/entrypoint.sh` points litestream at `/app/litestream.yml` but the
  file actually lands at `/app/backend/litestream.yml`, and it's backgrounded
  so the failure is silent; there's also no restore-on-boot step. Until that
  one-liner is fixed, treat R2 replication as non-functional on any Docker
  host (Railway, Render, Fly alike).

Cheap manual fallback that works today: periodically `railway ssh` in (or
use the service's command line) and copy `/data/storemap.db` out (sqlite3
`.backup` while the app is running is safe).

## 7. Day-2 workflow

- **Deploy:** `git push` to `main` → Railway rebuilds and swaps the
  container (volume untouched). That's the whole Vercel experience.
- **Logs/shell:** service → **Logs** / **Terminal** tabs.
- **Rollback:** Deployments → any previous deploy → **Redeploy**.
- **Env changes:** edit in Variables → auto-redeploy.

## Render instead (same idea)

1. [render.com](https://render.com) → New → **Web Service** → connect the
   GitHub repo.
2. It picks up the Dockerfile too. Region: pick one and stay.
3. Add a **Persistent Disk** at mount path `/data` (requires a paid
   instance type, Starter is enough).
4. Same env vars as §3; Render injects `PORT` the same way.
5. Auto-deploy on push is on by default.

Cost ≈ $7/mo Starter + ~$0.25/GB disk.

---

## Railway Pro capacity for this app (researched 2026-10-11, primary sources: docs.railway.com pricing/backups/volumes)

**Short version: Pro works comfortably and is effectively the *required*
tier for production — Hobby cannot host this app's volume.**

| Fact | Value |
|---|---|
| Pro price | **$20/mo per workspace** (not per seat), includes $20 usage credit, unlimited seats |
| vCPU | $0.000463/min = $20/vCPU-month — billed on **actual CPU used**, not allocation |
| RAM | $0.000231/GB-min = $10/GB-month — billed on **memory held** |
| Volume | $0.15/GB-month → 10 GB = $1.50/mo |
| **Volume backups** | **Pro-and-above only.** Daily (6-day retention) + weekly (27-day) schedules, one-click staged restore — explicitly designed for "an SQLite database on a volume" |
| Volume size cap | **Hobby 5 GB max; Pro 50 GB default (self-serve to 1 TB)** |
| Egress | $0.05/GB (map images at launch scale ≈ $0.50–2.50/mo) |
| Availability target | 99.99% (Hobby 99.9%) · 30-day logs (Hobby 7) · priority support |

**Capacity math for StoreMap:** the service (Node 22 + Express + SQLite)
fits in 0.5 vCPU / 512 MB with room to spare. Billed on actual usage, a
lightly-loaded instance draws roughly $6–12/mo of usage; even a 24/7-pegged
0.5 vCPU/512 MB is $15/mo theoretical. With the 10 GB volume (+$1.50),
incremental backups (~+$0.30) and egress (~$1–2), **Pro lands at a flat
$20/mo** — the usage fits inside the included credit with headroom. A burst
to a sustained full 1 vCPU / 1 GB would cost ~$32–33/mo total.

**Why not Hobby for production:** two hard blockers — Hobby volumes cap at
**5 GB** (our guide's 10 GB volume doesn't fit; you'd have to shrink to 5 GB),
and Hobby has **no volume backups at all**. For an app whose entire dataset
is one SQLite file on one volume, the daily+weekly backup schedules and
one-click restore are the actual product you're buying with Pro. Hobby
remains fine for a demo/preview deployment with a small 1–5 GB volume.

**Recommended Pro setup:** service limits 0.5 vCPU / 512 MB, single
instance (SQLite single-writer — never scale replicas), 10 GB volume at
`/data`, daily + weekly backup schedule, everything else per §1–§5 above.

---

### Why not just Fly.io (already in the repo)?

`fly.toml`, the Dockerfile, health checks and the whole Stage-0 backup/CDN
plan are already written for Fly — see [DEPLOY.md](DEPLOY.md). If you're
happy installing `flyctl` and running ~5 commands once, it's the
best-integrated path and ≈$6/mo. Railway/Render win only on the
point-and-click, push-and-forget dashboard experience you asked for.
