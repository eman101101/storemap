# Stage 0 — Deploy Runbook (Fly.io + Cloudflare + R2)

This is the operational companion to [INFRASTRUCTURE.md](INFRASTRUCTURE.md) §12
Stage 0. Everything in the repo is already wired for it:

- `fly.toml` — app, machine, `/data` volume, health check
- `Dockerfile` + `backend/entrypoint.sh` — runs the app **and** Litestream
  (continuous SQLite backup) in one container when R2 is configured
- `backend/litestream.yml` — WAL replication to R2 every 10 s
- `backend/src/lib/r2.js` + `storage.js` — uploads go to R2; serving checks
  disk first (legacy files) then R2; **local dev with no env vars is unchanged**
- `backend/src/lib/cdn.js` — `Cache-Tag`/`s-maxage` on public map JSON +
  per-store purge after every edit (via `touchStore`)

---

## 1. Accounts to create (one-time, ~15 minutes)

| # | Account | Free tier | What you use it for |
|---|---|---|---|
| 1 | **Fly.io** — [fly.io](https://fly.io) | Hobby plan $0 (3 tiny machines, 3 GB volumes) | Hosting the app + persistent volume |
| 2 | **Cloudflare** — [cloudflare.com](https://www.cloudflare.com) | Free plan: CDN, DNS, WAF, unlimited bandwidth | Domain/DNS, edge cache, purge API, R2 |
| 3 | Cloudflare **R2** (same account, enabled separately) | 10 GB storage + 1 M writes + 10 M reads/mo, **$0 egress** | Media bucket + backup bucket |
| 4 | *(optional)* **UptimeRobot** or **Better Stack** | Free | Uptime checks on `/api/health` from 3+ regions |

Install the CLI once: `brew install flyctl && fly auth login`.

## 2. Cloudflare setup (do before first deploy)

1. **Zone**: add your domain (e.g. `myshopmaps.com`) to Cloudflare and follow
   the nameserver instructions at your registrar.
2. **R2 buckets** — dashboard → R2 → *Create bucket*:
   - `storemap-media` — uploaded images
   - `storemap-backups` — Litestream replica target
   Then R2 → *Manage R2 API Tokens* → create token (Object Read & Write) →
   note the **Access Key ID**, **Secret Access Key**, and your **Account ID**
   (R2 overview page, right side).
3. **DNS record**: `map` CNAME → `<your-app>.fly.dev`, **proxied (orange cloud)**.
4. **Cache Rule** (needed for the worldwide free caching): dashboard →
   Caching → Cache Rules → *Create rule*:
   - If: URI Path **starts with** `/api/public/`
   - Then: **Eligible for cache**, Edge TTL: respect origin headers
   (origin already sends `s-maxage=300, stale-while-revalidate=86400`)
   Also make sure a default rule **bypasses** cache for `/api/*` except the
   public rule above (origin sends `no-store` for those anyway).
5. **Purge token**: My Profile → API Tokens → *Create Token* →
   permission **Zone → Cache Purge** for your zone → note the token and the
   **Zone ID** (zone Overview, right side).

## 3. Fly setup

```bash
fly launch --no-deploy        # accept "use existing fly.toml"; pick a name
fly volumes create storemap_data --size 10 --region iad

fly secrets set \
  SESSION_SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")" \
  PUBLIC_BASE_URL="https://map.myshopmaps.com" \
  R2_ACCOUNT_ID=... \
  R2_ACCESS_KEY_ID=... \
  R2_SECRET_ACCESS_KEY=... \
  R2_BUCKET=storemap-media \
  AWS_ACCESS_KEY_ID=<same as R2_ACCESS_KEY_ID> \
  AWS_SECRET_ACCESS_KEY=<same as R2_SECRET_ACCESS_KEY> \
  R2_BACKUP_BUCKET=storemap-backups \
  CF_ZONE_ID=... \
  CF_API_TOKEN=...
# Optional owner sign-in (see README "Deploying online"):
#   fly secrets set GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=...

fly deploy
```

> The entrypoint also expects `litestream.yml`'s bucket — it reads `R2_BUCKET`
> and `R2_ACCOUNT_ID` env vars directly, so no extra config is needed. If you
> use a separate backups bucket, edit `backend/litestream.yml` before deploy
> (`bucket: ${R2_BACKUP_BUCKET}`) — one line.

Verify: `fly status`, then open `https://map.myshopmaps.com/api/health` and the
demo store page. `fly logs` should show `starting litestream replication`.

## 4. Verify each Stage-0 guarantee

| Guarantee | How to check |
|---|---|
| App healthy | `curl https://…/api/health` → `{"ok":true}` |
| Media on R2 | upload a floor plan in the editor; object appears under `uploads/` in the `storemap-media` bucket; image loads at its `/uploads/...` URL |
| Backup streaming | `fly logs` shows litestream sync lines; R2 `storemap-backups/storemap/` grows generation files |
| Restore works | `fly ssh console` → `litestream restore -o /tmp/restore.db s3://storemap-backups/storemap?endpoint=https://<acct>.r2.cloudflarestorage.com` → `sqlite3 /tmp/restore.db 'select count(*) from stores'` |
| Edge cache live | `curl -sI https://…/api/public/stores/<slug>` twice → second response `CF-Cache-Status: HIT`; `/api/stores/mine` always `cf-cache-status: BYPASS/DYNAMIC` |
| Purge on edit | with the above HIT confirmed, save an edit in the dashboard → next request revalidates (edited data visible within seconds) |

## 5. Monitoring (5 minutes)

- UptimeRobot/Better Stack: HTTP check on `https://…/api/health` every 5 min,
  alert email/SMS.
- Weekly manual glance: `fly volume list` (snapshot age), R2 bucket sizes.

## 6. Restore runbook (when things go wrong)

- **Machine/volume OK, app broken**: `fly releases rollback` or `fly deploy -i <previous-image>`.
- **Volume lost**: `fly machine stop … && fly volume create storemap_data --size 10` then
  `fly ssh console` → stop app → `litestream restore -o /data/storemap.db <replica-url>` →
  start app. Data as of ≤ 60 s before the incident (RPO, §7).
- **Region disaster**: redeploy in another region + restore volume snapshot or
  Litestream replica (R2 is global). Target RTO 30 min (§7).

## 7. Ongoing cost (Stage 0, INFRASTRUCTURE.md §13)

| Item | Monthly |
|---|---|
| Fly shared-cpu-2x + 10 GB volume | ~$5.90 |
| Cloudflare plan / CDN | $0 |
| R2 within free tier (10 GB + 1 M ops) | $0 (≈$0.02/GB after) |
| **Total at launch scale** | **≈ $6–8** |
