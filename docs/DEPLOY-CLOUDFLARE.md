# Deploy the online StoreMap on Cloudflare — ordered runbook

Every step in order, from zero to a production instance on the Workers free
tier (D1 database + R2 media + edge assets + edge caching). ~20 minutes,
half of it OAuth console clicking.

The app deploys from this repo's `main`: `worker/` (the online engine) +
`wrangler.jsonc` at the root. The Express backend is not deployed.

---

## 1 · Push this repo to GitHub

The deploy button (and Workers Builds) deploys from a GitHub repo. Fork or
push `main` if you haven't:

```bash
git remote add origin https://github.com/<you>/storemap.git
git push -u origin main
```

## 2 · One-click deploy

Open:

> **https://deploy.workers.cloudflare.com/?url=https://github.com/<you>/storemap**

Sign in with a Cloudflare account (free). The button reads `wrangler.jsonc`
and provisions automatically:

- **Worker** `storemap` + the built SPA served from the edge
  (`frontend/dist` is built for you by the configured build command)
- **D1 database** `storemap` — schema migrations + the two demo stores apply
  on the first request
- **R2 bucket** `storemap-media` — all uploaded images

Finish → you get `https://storemap.<your-subdomain>.workers.dev`.
Open it: the landing page lists the demo maps; **Open the demo maps** signs
you in (demo login is ON by default while you evaluate).

CLI alternative (same result, no button):

```bash
npx wrangler deploy        # from the repo root; builds + deploys
```

## 3 · Lock it down (before sharing the URL publicly)

In the Cloudflare dashboard → Workers & Pages → **storemap** →
Settings → **Variables and Secrets**:

1. `ENABLE_DEV_LOGIN` → `false` — turns off the passwordless demo login.
2. `PUBLIC_BASE_URL` → `https://storemap.<you>.workers.dev` — canonical
   origin for share links and printed QR codes (update it again if you add a
   custom domain in step 5).

(These have working defaults for evaluation; flip them when you go live.)

## 4 · Real sign-in (pick one or both)

**Google** (~10 min): [console.cloud.google.com](https://console.cloud.google.com) →
APIs & Services → Credentials → **Create OAuth client ID** (Web application) →

- Authorized redirect URI: `https://<your-host>/api/auth/google/callback`

Then set two secrets (dashboard → Variables → **Add variable**, type Secret,
or `npx wrangler secret put NAME`): `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`. The button appears on `/login` immediately.

**Cloudflare Access** (zero OAuth console, free ≤ 50 users): in Zero Trust →
Access → Applications, add a self-hosted app for your domain covering
`/dashboard*` and the owner API paths (`/api/stores*`, `/api/floors*`,
`/api/products*`, `/api/uploads*`, `/api/keys*`, `/api/locations*`,
`/api/categories*`) — leave `/s/*` and `/api/public*` outside so shoppers
need no login. Set vars `ACCESS_TEAM_DOMAIN` = `yourteam.cloudflareaccess.com`
and `ACCESS_AUD` = the app's AUD tag. Full walkthrough in
[worker/README.md](../worker/README.md).

## 5 · Custom domain + free rate limiting (recommended at launch)

1. Add the domain's DNS zone to Cloudflare (free plan is fine).
2. Worker → Settings → **Domains & Routes** → Add → Custom domain, e.g.
   `map.yourshop.com`. TLS is automatic.
3. Update `PUBLIC_BASE_URL` to `https://map.yourshop.com`.
4. Security → **WAF Rate limiting rules** → Create: match `/api/*`, count by
   IP, e.g. block > 30 requests / 10 s. This runs *before* the worker, so
   blocked bots never touch your daily quotas.

## 6 · Verify the deployment

```bash
curl https://<your-host>/api/health           # {"ok":true,...}
curl -sI https://<your-host>/api/public/stores/freshmart-downtown | grep -i x-cache
# 1st request: x-cache: MISS · repeat: x-cache: HIT (edge cache working)
```

In the browser: search "milk" on the demo map → route appears; upload a
product photo (auto-compressed client-side); invite an employee from the
dashboard **👥 Team** button; export a QR from a store card.

## 7 · Operations

- **Backups**: D1 has built-in point-in-time recovery (Time Travel); for file
  copies run `npx wrangler d1 export storemap --remote --output backup.sql`
  on a schedule.
- **Runaway protection**: `R2_DAILY_BUDGET` (default 25,000 ops/day) hard-stops
  image serving past the budget — no surprise R2 charges, map keeps working.
- **Usage**: dashboard → Workers & Pages → storemap → Metrics; D1 and R2
  have their own usage tabs. Set a billing notification as an alarm bell.
- **Updates**: pushes to `main` redeploy automatically if the button set up
  Workers Builds; otherwise `npx wrangler deploy`.

## 8 · What's intentionally not wired yet

- **Payments** (Step 2 of the scale plan): `stores.plan` + entitlements exist;
  Stripe Checkout/webhooks are the next build.
- **Invite emails**: invitation links are copy/paste (shown once in the Team
  modal) until Cloudflare Queues + an email provider land.
- **Sharding**: one D1 is fine to ~8–10K stores; shard by store when
  approaching it (INFRASTRUCTURE.md §5 Phase C).
