# StoreMap — Global Hosting & Scale Plan (100K maps)

**Status: PLAN — no code changes yet.** This document specifies how StoreMap scales
from today's single-process deployment to ~100,000 store maps with worldwide
delivery, online backups, employee logins/permissions, warehouse support, and
offline map transfer — at the lowest realistic monthly cost.

Companion docs: [README](../README.md) (product) · [ARCHITECTURE.md](ARCHITECTURE.md)
(current implementation) · [PLAN.md](PLAN.md) (original design).

---

## 1. Executive summary

**Recommended stack (Phase 1 → 2):**

| Layer | Choice | Why cheapest |
|---|---|---|
| Global edge / CDN / DNS / DDoS | **Cloudflare Free** | unlimited CDN bandwidth at $0; shopper traffic is ~99% cacheable public JSON |
| App hosting | **Fly.io** (2 machines) | per-second billing, persistent volumes (keeps `node:sqlite` unchanged), true multi-region for later; Hobby→Launch $0–5/mo base |
| Database (Phase A) | **SQLite on Fly volume + Litestream** | zero app rewrite; continuous replication to object storage for ~$0 |
| Database (Phase B) | **Neon Postgres** (Launch ~$19/mo) | when >10K stores / reporting needs arrive |
| Media (floor plans, logos) | **Cloudflare R2** | $0.015/GB-mo, **$0 egress** — images are served straight through Cloudflare |
| Backups | Litestream (RPO ≤ 60 s) + daily snapshots (30 d) + R2 versioning | all to R2, pennies |

**Cost curve (see §13 for the math):**

| Stage | Stores | Est. monthly |
|---|---|---|
| Launch | ≤ 1 K | **~$7–10** |
| Growth | ≤ 10 K | **~$15–25** |
| Scale | ≤ 100 K | **~$60–130** |

The architecture principle that makes this cheap: **reads are public and
immutable-ish, writes are rare.** Shopper map views (the 99% traffic) are served
from Cloudflare's edge cache worldwide for free; only owner edits and cache misses
reach the origin. A single small origin can therefore serve 100 K stores.

---

## 2. Requirements → design mapping

| Requirement | Answer |
|---|---|
| Up to 100 K maps | §3 traffic model, §5 data layer phases, §13 scale stage |
| Online backup | §7 Litestream + snapshots + R2 versioning (RPO ≤ 60 s) |
| Worldwide hosting | §6 Cloudflare edge cache + single origin, later regional read replicas |
| Cheapest price | §13 cost model per stage |
| Not Vercel; alternative that scales | §4 platform decision — Fly.io (+ compared alternatives) |
| Employee logins & edit permissions | §9 roles, schema, permission matrix, invite flow |
| Warehouse support | §10 sites, bins, transfers, pick routes |
| Offline transfer of maps | §11 PWA offline, export/import bundle, offline edit queue |

---

## 3. Traffic & size model (the numbers that drive everything)

Assumptions per average store: 2 floors, 40 map elements, 50 products, 50 pins,
2 MB uploaded media (floor plan + logo). Shoppers: 500 views/store/month (QR-code
driven, bursty on weekends).

- **Rows**: 100 K stores × ~140 rows ≈ 14 M rows ≈ **5–7 GB** of database. Both
  SQLite and Postgres handle this comfortably.
- **Media**: 100 K × 2 MB ≈ 200 GB → R2 ≈ **$3/mo**, served with $0 egress.
- **Shopper reads**: 50 M views/mo ≈ 19 req/s average, ~10× weekend peaks
  (~200 req/s). All cacheable (§6).
- **Editor writes**: autosave is throttled to ≤ 1/min/floor (already built).
  If 3% of stores are actively editing at peak: 3 K editors × ~0.2 saves/min ≈
  **10 writes/s** — trivial for one SQLite writer or a small Postgres.

Conclusion: the workload is *read-heavy, edge-cacheable, write-light*. One origin
region + global CDN is the correct shape until well past 100 K stores.

---

## 4. Hosting platform decision

**Constraints:** long-lived Node process (not serverless — `node:sqlite`, local
volume, future WebSockets), persistent disk for SQLite/uploads, cheap fixed cost,
multi-region path. Vercel is excluded by requirement (and is a poor fit for a
stateful process anyway).

| Option | Fit | Verdict |
|---|---|---|
| **Fly.io** ✅ | Docker-native, persistent volumes, per-second billing, machines in 30+ regions, anycast IP, autoscale groups later | **Primary pick.** Smallest machine ≈ $2/mo; volumes $0.15/GB; scale path is "add a machine" |
| Hetzner + Coolify (self-hosted PaaS) | Best raw €/vCPU — but 2026 price hikes made US/Asia locations 2–3× EU pricing; global latency story collapses to EU; you own ops | Budget alternative if EU-only is acceptable (§13 box) |
| Railway / Render | Simple, but ~$5–7/mo per service, single-region by default, volumes pricier; no better than Fly for this shape | Runner-up |
| DigitalOcean App Platform | $5/mo base + managed add-ons; fine but less flexible multi-region | Runner-up |
| AWS ECS/Fargate or Lightsail | Powerful but cost + complexity overkill until >>100 K stores; egress fees poison media serving | Later option |
| Cloudflare Workers + D1 | Would require an app rewrite (no `node:sqlite`, no long-lived process) | Rejected for now |

**Fly.io topology (Phase 1):**

```
                Cloudflare (free): DNS · CDN cache · WAF · rate limit
                     │  (public map JSON + SPA + R2 media cached at edge)
                     ▼
        Fly.io anycast  ┌─────────────────────────────┐
                     │  │ app-primary  (fra or iad)   │── volume: sqlite + wal
                     │  │ shared-cpu-2x · 512MB       │   Litestream ──▶ R2 bucket
                     │  └─────────────────────────────┘
                     │  ┌─────────────────────────────┐
                     │  │ app-standby (2nd region)    │── volume: replica target
                     │  └─────────────────────────────┘   (promoted on failover)
                     ▼
        R2: uploads bucket (object versioning ON) + backups bucket
```

---

## 5. Data layer strategy (phased, smallest change first)

**Phase A — SQLite + Litestream (0 → ~10 K stores), zero app rewrite.**
The app already runs on `node:sqlite` with WAL. Litestream streams the WAL to R2
continuously (sub-minute RPO). The uploads dir moves to R2 (§5.1). One writer
machine; a second machine stands by for failover. This is the cheapest possible
correct architecture and it ships with **no changes to schema or queries**.

**Phase B — Neon Postgres (~10 K → 100 K).** Triggers: concurrent-editor growth,
analytics/reporting, per-store stats, or SQLite file > ~20 GB. Migration is a
one-time `better-sqlite3`/`node:sqlite` → `postgres` driver swap; the SQL is
already standard (no stored procedures). Neon Launch (~$19/mo) gives 24 h PITR;
Scale (~$69/mo) for 30-day PITR + read replicas. App machines become stateless —
scale horizontally on Fly behind Fly's load balancer.

**Phase C — shard by store (escape hatch > 100 K or write-heavy).**
Store rows never join across stores, so the natural shard key is `store_id`:
`shards = hash(store_id) % N` → N Fly machine+DB pairs (or N Neon projects);
a Cloudflare Worker at the edge routes `/api/stores/:id*` and
`/s/:slug` (after one slug→shard lookup cached at the edge). Public reads stay
cached regardless of shard count. No code change on this path until needed.

**5.1 Media off the volume (do in Phase A).** Uploads are the biggest disk item
(200 GB at scale). Change: on upload, server streams the validated bytes to R2
(key `stores/:storeId/:uuid.webp`) and stores the R2 key in `background_url` /
`logo_url` / `image_url`; serve via Cloudflare (same domain, cache-forever,
immutable keys). Rollback for deleted media = R2 versioning.

---

## 6. Worldwide delivery (the free part)

- **DNS/CDN**: Cloudflare proxied. Cache rules:
  - `/assets/*` (SPA bundle, content-hashed): `Cache-Everything`, 1 year.
  - `/api/public/stores/:slug` and `.../search?q=`: `s-maxage=300,
    stale-while-revalidate=86400` — shoppers get ≤ 5-min-old maps from the nearest
    of 300+ PoPs, origin sees ~0.2% of shopper traffic.
  - `/uploads/*` (R2 media): immutable keys, 1 year.
  - Everything else (`/api/*`): `no-store` (already set).
- **Invalidation on publish/edit**: after a successful elements autosave or
  publish toggle, the origin purges that store's public URLs via the Cloudflare
  API (`PURGE /zones/:zone/cache/purge` by tag `store:<id>`). Tag responses on
  origin (`Cache-Tag: store:<id>`) so purges are per-store, never global.
- **Edit latency worldwide**: edits go to one origin (pick `fra` or `iad`; the
  other is the standby). Worst case ~250–300 ms RTT from the far side of the
  world — invisible for a debounced autosave. If it ever matters: add regional
  **read-only** app machines fed by Litestream replicas for editor GETs
  (`/stores/:id/full`), writes still pinned to primary via Fly region routing.

---

## 7. Backup & disaster recovery

| Layer | Mechanism | RPO / retention |
|---|---|---|
| SQLite WAL | Litestream → R2 `backups` bucket, 10 s sync interval | **RPO ≤ 60 s**, 72 h of WAL generations |
| Daily snapshot | `fly vol snapshot` + Litestream full-copy retention | 30 daily, 12 monthly |
| Postgres (Phase B) | Neon PITR (24 h Launch / 30 d Scale) + weekly `pg_dump` to R2 | as noted |
| Media | R2 **object versioning** on the uploads bucket +Lifecycle (90 d noncurrent) | any overwrite/delete reversible |
| Cross-region | R2 bucket is global by nature; Litestream replica volume on 2nd Fly machine | region loss ≠ data loss |

**RTO targets**: app machine dies → Fly auto-restart/vm restart ≤ 2 min; volume
loss → restore latest snapshot + replay WAL ≤ **15 min**; whole region → promote
standby machine ≤ **30 min** (documented runbook + quarterly drill — a script that
restores to a scratch machine and diffs row counts; add to CI as a scheduled job).

---

## 8. Ops, security, monitoring (cheap-tier)

- Secrets: `fly secrets` (never in repo); SESSION_SECRET rotated quarterly.
- Cloudflare free WAF managed rules + existing per-route rate limits; login
  endpoints already rate-limited.
- Monitoring: Fly logs → Better Stack free tier (errors + `save failed` alerts),
  UptimeRobot on `/api/health` from 3 continents, a nightly cron that asserts
  "latest Litestream replica timestamp < 5 min old" and pages if not.
- Deploys: `fly deploy` from CI on tag; `fly releases rollback` for instant undo.
- Multi-tenant hygiene at 100 K: slugs are `UNIQUE` already; add per-store API
  key quotas when StockTrack v1 usage grows (simple counters table).

---

## 9. Employee logins & editing permissions (spec)

Today a store has one `owner_id`. Spec below adds teams without breaking anything.

### 9.1 Schema (additive migration)

```
store_members(id, store_id→stores, user_id→users, role TEXT CHECK IN
              ('owner','manager','editor','stock','viewer'),
              invited_by→users, created_at)  UNIQUE(store_id, user_id)

invitations(id, store_id, email, role, token_hash, expires_at 48h,
            accepted_at)   -- magic-link invites, single-use

audit_log(id, store_id, user_id, action, entity, entity_id, detail JSON,
          created_at)     -- every elements PUT, product CRUD, transfer, restore
floor_snapshots.edited_by → users   -- changelog entries name their author
```

### 9.2 Permission matrix (enforced server-side in `ownership.js` → `memberFloor`)

| Capability | owner | manager | editor | stock | viewer |
|---|---|---|---|---|---|
| Edit map (elements PUT, restore) | ✅ | ✅ | ✅ | — | — |
| Products & categories CRUD | ✅ | ✅ | ✅ | — | — |
| Place/move pins | ✅ | ✅ | ✅ | — | — |
| Adjust stock, receive transfers | ✅ | ✅ | — | ✅ | — |
| View map + stock dashboard | ✅ | ✅ | ✅ | ✅ | ✅ |
| Integrations & API keys | ✅ | ✅ | — | — | — |
| Invite members (≤ own role) | ✅ | ✅ | — | — | — |
| Publish toggle, store profile | ✅ | ✅ | — | — | — |
| Delete store / transfer ownership / billing | ✅ | — | — | — | — |

Rules: a manager can never create an owner; editors can't touch stock numbers
(map team ≠ inventory team); everything defaults closed (`viewer` sees nothing
public-only unless granted).

### 9.3 Sign-in & session spec

- Identity: keep Google/Apple OIDC; **add email magic-link** for employees
  without them (same `users` table, `provider='email'`): POST email → rate-limited
  (5/h/ip) → single-use 15-min link → session identical to today's HMAC cookie.
- Invites: owner pastes emails → invitation links → user signs in with any method
  matching that email → membership row created.
- Sessions: viewer/stock 30 d (as today); editor/manager 12 h inactivity timeout
  (config per store later). Cookie flags unchanged.
- Client: editor toolbar shows "Signed in as X · role" + member management panel
  under the Store tab (list, invite, change role, remove).

### 9.4 What changes where (no code now — checklist for implementation)

1. Migration 004: tables above (+ backfill `store_members(owner)` from
   `stores.owner_id` so nothing breaks on deploy).
2. `ownership.js`: `ownedFloor(req,res,id,minRole)` replaces owner check; every
   route declares its minimum role per the matrix.
3. Autosave writes `floor_snapshots.edited_by`; History tab shows "by ⟨name⟩".
4. Audit-log inserts piggyback on the same transactions.

---

## 10. Warehouse support for stores (spec)

Model: a grocery "store account" can have multiple **sites** — front-of-house
floors it already has, plus one or more backroom/warehouse sites. Editors draw
warehouse racks with the same tools; products live in both places with separate
quantities; the existing A* engine becomes a picking route engine.

### 10.1 Schema

```
sites(id, store_id→stores, name, kind 'store'|'warehouse', address)
floors.site_id → sites          -- nullable, defaults to the store's first site
product_locations.meta.bin_code -- rack/bin label for warehouse picks
stock_levels.site_id            -- quantity per site (today it is per product only)

transfer_orders(id, store_id, product_id, qty,
                from_site_id, to_site_id,
                status 'draft'|'in_transit'|'received'|'cancelled',
                created_by→users, created_at, received_at)
```

`stock_movements` gains `transfer_id` so a received transfer writes two linked
movements (−from site, +to site) atomically.

### 10.2 Behavior

- **Warehouse maps**: same editor, same shapes; warehouse sites get rack-style
  labels and are excluded from the shopper viewer by default (`is_public` per
  site, default off for warehouses).
- **Restock flow**: in the store view, a product below reorder point shows
  "Send from warehouse" if `stock_levels(warehouse) > 0` → creates a draft
  transfer → stock role marks it in transit → receiving at the shelf confirms
  quantity and posts both movements.
- **Pick routes**: a warehouse pick list (all items for a transfer order) is
  ordered by the existing `navgrid` A*: nearest-neighbor tour across bin
  anchors on the warehouse floor, drawn on the 2D/3D map exactly like shopper
  routes. This is a pure reuse of the wayfinder — zero new geometry code.
- **Permissions**: warehouse staff get `stock` (§9) — they see maps read-only,
  manage transfers, never edit fixtures.
- **Integrations**: POS sync targets the *store* site; a WMS/ERP adapter
  (extends `lib/stocksoft/`) targets warehouse stock.

---

## 11. Offline transfer of maps (spec)

Three distinct meanings, all specified:

### 11.1 Offline viewing on shopper phones (PWA)

In-store Wi-Fi is often bad — the QR flow must work offline after first view.

- Add a service worker: **precache** the hashed SPA bundle; **runtime-cache**
  `GET /api/public/stores/:slug` with stale-while-revalidate (network TTL 5 min,
  cache 30 d) into Cache Storage; store the last 5 viewed stores' payloads in
  IndexedDB (payloads are a few KB gzipped).
- UI: offline banner ("Offline — showing saved map"), taps on search are hidden
  or served from the cached product list (search runs client-side against the
  cached payload — the whole catalog is already in that JSON).
- Route+fly features work offline (all client-side math) — a shopper can pull up
  the route to an item with airplane mode on, after having opened the map once.

### 11.2 Export / import bundle (transfer between accounts or instances)

```
GET  /api/stores/:id/export   →  storemap-bundle v1
{
  "format": "storemap-bundle", "version": 1, "exported_at": "...",
  "store": {...}, "categories": [...], "products": [...],
  "sites": [...],                       // v1.1 when §10 lands
  "floors": [...], "elements": [...], "locations": [...],
  "media": [{ "key": "stores/<id>/<uuid>.webp", "sha256": "..." }]
}
POST /api/stores/import       ←  same shape (multipart incl. media files)
```

- Export streams media from R2 or emits signed URLs; import re-uploads and
  re-keys under the new store id. Element geometry passes through the existing
  `validateElement` — the server never trusts imported JSON.
- Roles: export = owner/manager; import = any owner (creates a new store,
  preserving or regenerating ids; collisions impossible because ids are
  namespaced on write).
- Same endpoint doubles as **manual backup** and as "chain copies a template
  store into store #57".

### 11.3 Offline *editing* queue (deliberately minimal)

Full CRDT/offline-collab editing is rejected as over-engineering for v1. Instead:

- The editor already autosaves to an outbox in IndexedDB when offline; on
  reconnect each queued elements-PUT is replayed tagged with the
  `floor_snapshots` id it was based on.
- Server compare: if the floor's head snapshot moved on (someone else edited),
  the replay is rejected 409 with both versions; the UI offers **Keep mine /
  Load theirs**. Last-writer-wins otherwise. This is ~150 lines of client code,
  no new server concepts, and covers the real case (owner edits in a dead-Zone
  stockroom).

---

## 12. Rollout plan (stages, triggers, actions)

| Stage | Trigger | Actions |
|---|---|---|
| **0 — Launch** (≤1 K stores) | now | ✅ **wired in this repo** — `fly.toml`, Litestream in the Docker image, R2 uploads + CDN cache/purge (all env-gated, local dev unchanged). Runbook: [DEPLOY.md](DEPLOY.md) |
| **1 — Growth** (≤10 K) | editors or editors' orgs ask for teams | migration 004 + roles (§9); PWA offline (§11.1); export/import (§11.2); standby machine promoted to hot replica |
| **2 — Scale** (≤100 K) | >10 K stores or SQLite >20 GB | Postgres migration (Phase B §5); stateless app ×2–4 on Fly; Cloudflare tag-purges verified at volume; warehouse sites (§10) if enterprise accounts demand |
| **3 — Beyond** | >100 K or write spikes | store-sharding (Phase C §5); regional read replicas for editor GETs |

---

## 13. Cost model (monthly, USD, 2026 list prices)

**Phase 0 — Launch (~1 K stores, ~2 GB DB, 20 GB media)**

| Item | Cost |
|---|---|
| Fly shared-cpu-2x·512 MB (1 machine) + 10 GB volume | ~$4.39 + $1.50 |
| R2: 20 GB + ops (free tier covers ops) | ~$0.30 |
| Litestream bandwidth (WAL deltas) | ~$0 (R2 free tier) |
| Cloudflare Free | $0 |
| **Total** | **~$6–8 /mo** |

**Phase 1 — Growth (~10 K stores, ~1 GB DB→10 GB, 40 GB media)**

| Item | Cost |
|---|---|
| Fly 2× shared-cpu-2x·512 MB + 2×20 GB volumes | ~$8.78 + $6.00 |
| R2 40 GB + versioning | ~$0.75 |
| Cloudflare Free (+$5 Launch if purge-API volume grows) | $0–5 |
| **Total** | **~$16–21 /mo** |

**Phase 2 — Scale (100 K stores, ~6 GB data, 200 GB media, Neon)**

| Item | Cost |
|---|---|
| Neon Postgres Launch (PITR 24 h) | $19 |
| Fly 3× shared-cpu-2x·512 MB stateless app | ~$13 |
| R2 200 GB (+ versioned noncurrent ~60 d) | ~$4 |
| Cloudflare Pro (only if needed for WAF/rules scale) | $0–20 |
| Better Stack free / UptimeRobot free | $0 |
| **Total** | **~$36–56 /mo** (worst case with Pro + fatter app tier ~$130) |

> **Budget alternative (EU-only): Hetzner CX22 (2 vCPU/4 GB, ~€5.49 post-2026-hike
> in EU) running Coolify**, Cloudflare + R2 in front: ~**$12/mo flat** through
> Phase 1. Rejected as primary because 2026 pricing made Hetzner US/Asia 2–3× EU
> (poor worldwide story) and it adds self-managed ops (snapshots, kernel updates).

---

## 14. Risks & open questions

1. **Single-writer SQLite** is the Phase-A ceiling — fine at 10 writes/s, but the
   Phase-B trigger should be codified (p95 autosave latency > 500 ms).
2. **Cloudflare cache rules** must never cache `/api/stores/:id/full` (owner
   data) — enforced by the existing `no-store` on non-public `/api/*`; add a CI
   check hitting endpoints with a fresh cache and asserting `MISS`.
3. **Offline edit conflicts** (§11.3) choose LWW by default — acceptable while
   editing is per-store and rare; revisit if chains have many simultaneous
   editors per store.
4. **Import trust**: bundle imports are validated element-by-element; keep media
   magic-byte checks on import too (same code path as uploads).
5. **GDPR/data residency** (EU grocers may ask): Phase B answer is Neon EU
   region + Cloudflare EU-only routing if a customer requires it — priced as a
   dedicated stack per chain, not the platform.

---

*Prices researched Oct 2026 — see [Fly.io pricing](https://fly.io/pricing),
[Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing),
[Neon pricing](https://neon.com/pricing),
[Hetzner price adjustment](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment).
Re-verify quarterly; the architecture is deliberately price-provider-portable
(any Docker host + any S3-compatible store works).*
