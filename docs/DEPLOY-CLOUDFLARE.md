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
- **D1 database** `storemap` — schema migrations + the three example stores
  (walmart-example, home-depot-example, convenience-store-example) apply on
  the first request; their big-box catalogues are loaded in step 2a below
- **R2 bucket** `storemap-media` — all uploaded images

Finish → you get `https://storemap.<your-subdomain>.workers.dev`.
Open it: the homepage hero cycles the demo maps — **View live** opens one
in the shopper viewer (`/s/:slug`), and **Edit a copy — free** drops it
into the no-account sandbox editor (`/try/:slug`; changes persist on the
device only). To publish your own maps, sign in via the modal (Google/Apple
once configured per step 4, or the passwordless email form — which only
appears when `ENABLE_DEV_LOGIN` is switched on; it ships **off**, see
step 3).

CLI alternative (same result, no button):

```bash
npx wrangler deploy        # from the repo root; builds + deploys
```

## 2a · Load the example stores' catalogues

The example stores carry big-box assortments — **Walmart 120,000 · Home Depot
40,000 · Corner Store 8,000 SKUs** — made by `backend/scripts/demo-catalog.mjs`:
real brands, no photos, every SKU stocked on the shelf of its department that
holds its sort of product, with the board it stands on and its place along
the shelf. Far too many rows for a Worker to write on a request, so the
Worker seeds only each store's floor plan and its own demo items (the ones
with photos), and the catalogue is loaded from your machine **after every
deploy that changed the layout or the catalogue**:

```bash
curl -s https://storemap.<you>.workers.dev/api/health   # first hit: migrates + lays out the example stores
node worker/scripts/load-demo-catalog.mjs --remote      # needs `wrangler login`
```

- A store reports `as sent` when its catalogue is complete. The script is
  idempotent — an up-to-date catalogue is skipped, a changed one replaced
  whole — so run it again whenever in doubt: it writes only what is missing.
- A run that stops part-way (a lost connection, the day's write allowance)
  leaves the store working and light: from its first file on, the store is
  served without its catalogue inline. The next run looks up what the earlier
  one wrote and sends only the rest.
- A shopper's map is cached at the edge for 5 minutes. For up to that long
  after a load, the map may still be the one from before it (search already
  answers from the new catalogue).
- What a load writes: the three catalogues are 360,000 rows, which D1 counts
  as about **1.8 million rows written** (every index and the search index
  adds to it — roughly 5 per catalogue row: Walmart ≈ 1.3 million, Home Depot
  ≈ 440,000, the Corner Store ≈ 90,000). **Workers Paid** has no daily cap, so
  one run loads everything in a few minutes. **Workers Free** allows 100,000
  rows written a day and nothing can write once past that until 00:00 UTC —
  on it, load with a budget once a day per store
  (`--store walmart-example --max-rows 20000`) until it reports `as sent`,
  which is about two months for Walmart; Workers Paid is the practical option
  for catalogues this size.
- To change what the stores stock: edit the catalogue tables, bump
  `CATALOG_VERSION` in `demo-catalog.mjs`, deploy, run the loader. A changed
  floor plan (`LAYOUT_VERSION`) makes the Worker rebuild the stores on its
  next start — load the catalogue after that first hit.

## 3 · Lock it down (before sharing the URL publicly)

In the Cloudflare dashboard → Workers & Pages → **storemap** →
Settings → **Variables and Secrets**:

1. `ENABLE_DEV_LOGIN` — leave at its default **`false`**. The passwordless
   email login accepts ANY email, so it only ever runs when you deliberately
   set it to `true` (dashboard → Variables, or edit `wrangler.jsonc`), and
   only on a private/obscure URL.
2. `PUBLIC_BASE_URL` → `https://storemap.<you>.workers.dev` — canonical
   origin for share links and printed QR codes (update it again if you add a
   custom domain in step 5).

(Both have working defaults; dev login is disabled until you enable it, and
`PUBLIC_BASE_URL` falls back to the request origin.)

## 4 · Real sign-in (pick any combination)

**Google** (~10 min): [console.cloud.google.com](https://console.cloud.google.com) →
APIs & Services → Credentials → **Create OAuth client ID** (Web application) →

- Authorized redirect URI: `https://<your-host>/api/auth/google/callback`

Then set two secrets (dashboard → Variables → **Add variable**, type Secret,
or `npx wrangler secret put NAME`): `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`. The button appears on `/login` immediately.

**Email codes** (zero setup): the email form on `/login` sends a 6-digit
sign-in code — always available. With no mail provider configured the code is
shown right in the login form (fine for private/self-host instances). To send
real email, create a free [Resend](https://resend.com) account (100
emails/day), verify a sender domain, then set secrets: `RESEND_API_KEY` and
optionally `EMAIL_FROM` (e.g. `StoreMap <no-reply@yourshop.com>`).

**Facebook**: [developers.facebook.com](https://developers.facebook.com) →
Create App (type Business) → Facebook Login product → Settings →

- Valid OAuth redirect URI: `https://<your-host>/api/auth/facebook/callback`

Then set secrets `FACEBOOK_APP_ID` + `FACEBOOK_APP_SECRET`. The button
appears on `/login` when both are set. (Public access to the email permission
requires App Review — fine for testing with your own account in Dev mode.)

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

The example maps' product photos are stored in the database, and a Worker can't
bundle them — load them once (per database):

```bash
cd worker && npm run photos -- --remote      # needs `wrangler login`
```

Every photo on the site answering **404** means this step was skipped on that
database — the Worker logs `[media] no stored photos …` once per isolate to
say so. The command is idempotent: re-run it after the photo set changes, it
rewrites only what differs.

```bash
curl https://<your-host>/api/health           # {"ok":true,...}
curl -sI https://<your-host>/api/public/stores/home-depot-example | grep -i x-cache
# 1st request: x-cache: MISS · repeat: x-cache: HIT (edge cache working)
curl -sI https://<your-host>/media/osb-sheet-11mm.jpg | head -1   # HTTP/2 200
```

In the browser: **View live** on a hero example → search "milk" → the route
appears; **Edit a copy — free** opens the sandbox editor (`/try/:slug`, no
account) — draw a shelf, watch autosave. Once signed in (step 4): upload a
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

## 8 · Prod vs testing — one site is enough

**No, you don't need a second site.** One Worker (`storemap`), one D1
(`storemap`), one R2 (`storemap-media`) — test locally, preview on the same
Worker, roll back if a deploy misbehaves:

1. **Test locally (the default).** `cd worker && npm run dev` boots the whole
   engine on a throwaway D1 + R2 under `.wrangler/state`, hot-reloading
   `worker/src`. Nothing touches production. (`backend/`'s Express server is
   the *self-host* engine — it never exercises `worker/` code.)
2. **Preview a change before it goes live.** `npx wrangler versions upload`
   builds + uploads the new code as a non-production version and prints a
   one-off preview URL on the *same* Worker. Poke around, then promote with
   `npx wrangler versions deploy` or discard it in the dashboard — live
   traffic stays on the current deployment throughout. One caveat: a preview
   shares the production D1, so schema-changing migrations deserve a
   rehearsal (last bullet below).
3. **Roll back when needed.** Dashboard → storemap → Deployments →
   **Rollback** restores the previous code instantly. Data rolls back
   separately with D1 Time Travel:
   `npx wrangler d1 time-travel restore storemap --timestamp "<ISO>"`.

**Optional: a fully separate hosted test copy.** Only worth it for
rehearsing schema migrations against real data shapes, or demoing a private
build. It's still not a second *site* — a second Worker name plus its own
D1/R2 on the same account. Add an `env.test` block to `wrangler.jsonc`
(named environments do NOT inherit the top-level `vars`/bindings —
redeclare them, keeping the `DB`/`MEDIA` binding names so no code changes):

```jsonc
"env": {
  "test": {
    "name": "storemap-test",
    "d1_databases": [{ "binding": "DB", "database_name": "storemap-test", "database_id": "<paste id>" }],
    "r2_buckets":   [{ "binding": "MEDIA", "bucket_name": "storemap-media-test" }],
    "vars": {
      "SELF_HOSTED": "true",
      "ENABLE_DEV_LOGIN": "true",   // passwordless login ON here (OFF in prod)
      "R2_DAILY_BUDGET": "5000"     // small: a test copy should never cost anything
    }
  }
}
```

```bash
npx wrangler d1 create storemap-test                # paste the id into the block above
npx wrangler r2 bucket create storemap-media-test
npx wrangler deploy --env test
curl https://storemap-test.<you>.workers.dev/api/health   # first hit migrates + seeds the demos
```

Secrets are per environment (`npx wrangler secret put … --env test`). The
one rule: **never let the test Worker bind to the live database** — the
separate `d1_databases` entry above is what prevents that. To rehearse a
migration on realistic shapes, copy production data in (scrub
`users.email` first — real addresses):

```bash
npx wrangler d1 export storemap --remote --output prod.sql
npx wrangler d1 execute storemap-test --remote --file prod.sql
```

Copied rows reference `/uploads/…` keys that live in the *production* R2
bucket, so photos 404 on the test copy unless you also copy the objects;
maps, routes and search are unaffected.

## 9 · What's intentionally not wired yet

- **Payments** (Step 2 of the scale plan): `stores.plan` + entitlements exist;
  Stripe Checkout/webhooks are the next build.
- **Invite emails**: invitation links are copy/paste (shown once in the Team
  modal) until Cloudflare Queues + an email provider land.
- **Sharding**: one D1 is fine to ~8–10K stores; shard by store when
  approaching it (INFRASTRUCTURE.md §5 Phase C).
