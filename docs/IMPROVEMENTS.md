# StoreMap — Improvement Review

A full review of the site (every page exercised, every subsystem read) turned
into concrete, prioritized improvement lists. Each item: **what's wrong today →
what to build → impact (H/M/L) → effort (S/M/L)**. Items already specced in
other docs link there instead of repeating; this file is the master backlog.

Legend: **Impact** = user-visible value × reach. **Effort** = S ≤ ½ day, M ≤ 3 d,
L > 3 d. ✱ = already planned elsewhere (INFRASTRUCTURE / MOBILE-APPS docs).

---

## A. Shopper experience (the map viewer)

| # | Improvement | Impact | Effort |
|---|---|---|---|
| A1 | **Multi-stop trips.** Today selecting an item replaces the route. Add a "+ Add stop" on the focused product sheet: keep an ordered trip list, compute a nearest-neighbor tour over stops with the existing A* (same primitive the mobile plan's shopping list uses), draw it as one ribbon with numbered dots. State: `trip: ProductLocation[]` in ViewerPage; renderer takes an array of polylines. | H | M |
| A2 | **Aisle-level wayfinding text.** The badge shows meters; add human directions ("Head north past Aisles 2–3, item is on your right") generated from the route polyline crossing shelf-label zones (labels already exist on elements). Great for screen-reader users too. | M | M |
| A3 | **Accessibility of the 3D canvas.** The canvas is a black box to assistive tech. Add an `aria-live` route summary ("Route to Chocolate Ice Cream, 21 meters, about 1 minute") and a text-mode stops list beside the map (2D SVG already exposes elements as DOM; 3D should match with hidden descriptions). | H | M |
| A4 | **Search result detail sheet.** Tapping a result jumps straight to routing; a small product sheet (price, brand, category, image when present, "on Aisle 4 · Main floor") before the flight would help confirmation. Also show stock level when the store tracks it (`stock_levels` is owner-only today — needs a public "in stock / low" flag, default off per store). | M | S |
| A5 | **Floor-change continuity.** Multi-floor stores re-fit the camera per floor; carry yaw/pitch across floor switches and draw an "escalator/stairs" hint marker between floors (data model: a `poi` subtype or `connects_floors` meta). | M | M |
| A6 | **Share/deep-link a product.** `/s/:slug?p=<productId>` (or `#p=`) auto-selects the item and shows the route — staff can message a customer "it's here". Pairs with the OG tags already in place (add product name to the injected title for `?p=` URLs). | M | S |
| A7 | **Multi-language UI.** Store names/labels are user data, but the chrome ("Search an item…", "Fly the route") is English-only. A tiny i18n dictionary (nav, viewer, badge) + `Accept-Language` default covers shopper-facing strings. | M | M |
| A8 | **Keyboard shortcuts on the map**: `/` focuses search, `Esc` clears route, `2`/`3` switch views, `F` flight. Cheap, discoverable via the hint line. | L | S |

## B. Editor experience

| # | Improvement | Impact | Effort |
|---|---|---|---|
| B1 | **Element list / outline panel.** Long stores (150+ fixtures) make clicking the map the only way to select. Add a searchable outline in the Map tab (label · type · floor) that selects + pans to the element; doubles as an accessibility path. | H | M |
| B2 | **Multi-select + group move.** Shift-click / rubber-band to select N elements, drag them together (one history step). Pairs with Duplicate for building whole departments. | H | M |
| B3 | **Alignment & distribute.** With multi-select: align edges/centers, distribute spacing (the Aisle-pair tool builds pairs; this finishes rows). Grid snap already exists. | M | S |
| B4 | **Element locking.** Once walls are drawn they're accident bait. Per-element `locked` meta: selection skips locked elements (unlock via outline list from B1). | M | S |
| B5 | **Undo granularity indicator.** Undo steps are whole-element-array snapshots; show "Undo: move Aisle 3" labels by recording a tiny op tag with each push (label only — snapshots stay as-is). | L | S |
| B6 | **Live validation hints.** `validateElement` runs server-side on save; surface the same rules client-side pre-save (overlapping walls, zero-size rects, out-of-floor geometry) with inline warnings — don't block, just mark. | M | M |
| B7 | **Floor-plan image georeferencing wizard.** Upload exists; add a 2-click "set scale" (drag a known 5 m line) + opacity slider in the Map tab instead of raw width/height math. | M | M |
| B8 | **Bulk product import UX.** CSV import lives under Stock → integrations; owners expect it under Products. Move/duplicate the dropzone there with column preview + row-error report (adapter `parseCsv` already returns rows; errors list is new). | H | S |
| B9 | **Pin many products at once.** "Place pin" is one-at-a-time. Add a pin-mode where the Products tab shows checkboxes → click shelf positions in sequence (queue of pending pins drawn on the map). Data entry for 500-SKU stores currently takes hours; this cuts it to minutes. | H | M |
| B10 | **History diff view.** The History tab restores whole snapshots; show a diff (added/removed/moved elements between selected snapshot and now) before confirming. Reuses the elements list renderer. | M | M |

## C. Discovery, landing & SEO

| # | Improvement | Impact | Effort |
|---|---|---|---|
| C1 | **Store pages for crawlers.** OG tags exist; add server-rendered `<noscript>` content (store name, hours, top categories, product count) inside the injected `/s/:slug` HTML so Google indexes real content. Same injection point, ~20 lines. | H | S |
| C2 | **Geolocation "stores near me"** on the landing directory (browser location → haversine sort; store coordinates come from address geocoding — see C3). | M | M |
| C3 | **Address → coordinates.** `stores` lack lat/lng. Add geocoding at save time (Mapbox/OSM Nominatim free tier, server-side, cached) → enables C2, mobile near-me, and future maps links. Privacy note: geocode server-side only. | H | S |
| C4 | **Category landing pages.** `/s/:slug` is the only public URL; add nothing — but let stores generate a QR per category (`?c=<id>`) that opens with that filter applied (client already supports category context). Print at the shelf. | M | S |
| C5 | **Sitemap + robots.** `sitemap.xml` generated from public stores (hourly, cached at CDN) + `robots.txt`. Pure SEO plumbing. | M | S |
| C6 | **Structured data.** JSON-LD `Organization`/`Store` (name, address, hours, geo) in the injected `/s/:slug` head — rich results for store searches. | M | S |

## D. Owner dashboard & accounts

| # | Improvement | Impact | Effort |
|---|---|---|---|
| D1 | **Team accounts** — ✱ fully specced in INFRASTRUCTURE §9 (roles, invites, magic-link, audit). The single highest-value owner feature. | H | M |
| D2 | **Store health checklist.** New owners don't know what "done" is. A per-store checklist card (map drawn ≥ 1 shelf · ≥ 10 products pinned · entrance placed · published · QR printed) with completion %. Encourages publication; uses existing counts. | H | S |
| D3 | **Chains (multi-store accounts).** One owner can create N stores today with no grouping. Add optional `organizations` for shared product catalogs and per-chain warehouse (INFRA §10 assumes it). Model first, UI second. | M | L |
| D4 | **Usage analytics for owners.** View counts per store (aggregate only, no shopper PII): a `store_views` counter incremented on `/api/public/stores/:slug` misses (origin-side, CDN-safe). Chart on the dashboard. | M | S |
| D5 | **Duplicate-store-as-template.** The export/import bundle (INFRA §11.2) gives the mechanism; expose "Duplicate store" on the card menu — chains roll out store #2 in minutes. | M | S |
| D6 | **Low-stock digest email.** Movement log exists; add a daily/weekly opt-in email (owner-set threshold summary). Needs an email provider (Postmark free tier) — only new infra dependency. | M | M |

## E. Performance & scale

| # | Improvement | Impact | Effort |
|---|---|---|---|
| E1 | **Public payload shape.** `/api/public/stores/:slug` returns every product + location (150 products ≈ 25 KB gzip — fine at 100 K stores, but growing stores will 10× it). Split: map payload (floors/elements) vs product catalog endpoint with query + paging, cached separately with different TTLs. Client change is one fetch. | M | M |
| E2 | **BSP build cost.** `buildSceneBSP` runs on data change; for 2 K faces it's a few ms, but a 10 K-face warehouse floor would jank an edit. Build in a `requestIdleCallback`/worker when face count > 3 K (renderer falls back to painter sort until ready). | L | M |
| E3 | **Route caching per selection.** `computeRoute` rebuilds the nav grid on every selection; cache `(floorVersion, elementsHash) → NavGrid` in a ref (editor session) — grids are the expensive part; A* is cheap. | M | S |
| E4 | **Image pipeline.** Uploads are stored as-is (10 MB possible). Add server-side downscale to max 2048 px + WebP at upload (sharp is native — conflicts with zero-native-deps; alternative: canvas-side client compress before POST, keeping the server pure). Client-side wins: smaller R2 bytes, no new dep. | H | S |
| E5 | **HTTP caching for `/full`.** The editor boots with one big `GET /stores/:id/full`; send `ETag` (hash of updated_at + counts) and honor `If-None-Match` → 304. Editors reopen stores constantly. | M | S |
| E6 | **Phase B trigger automation** — ✱ INFRA §5: codify "p95 autosave > 500 ms → migrate to Postgres" as a logged metric (already have save-state client-side; add a timing beacon). | M | S |

## F. Security & hardening

| # | Improvement | Impact | Effort |
|---|---|---|---|
| F1 | **Session revocation list.** Sessions are stateless 30-day JWTs; a stolen cookie can't be killed. Add a `sessions` table (jti per issue, checked in `attachUser` — one indexed lookup) + "sign out everywhere". Also enables per-role session lengths (INFRA §9.3). | H | S |
| F2 | **CSRF posture.** SameSite=Lax + JSON-only APIs cover the classics; formalize with an `X-Requested-With` check on mutating routes or a double-submit token for belt-and-braces (documented decision either way). | M | S |
| F3 | **Upload parity for imports.** Bundle import (INFRA §11.2) must run media through the same magic-byte gate as uploads — already noted; implement as a shared `validateImage()` used by both paths. | H | S |
| F4 | **Secrets hygiene in snapshots.** Integration credentials are stored in `integrations.config` JSON — encrypt at rest with a server-side key (AES-GCM, key from env), decrypt only in the adapter call. | H | S |
| F5 | **Rate-limit scope.** The in-memory limiter is per-node; Phase 2+ needs a shared store (Fly Redis by Upstash has a free tier) — swap the `hits` Map for a `STORE` interface with two implementations. | M | S |
| F6 | **Content-Security-Policy.** Headers set several but not CSP; ship a strict-but-working policy (self + inline styles hash for the Vite-injected tag) via the same header block. | M | S |
| F7 | **Dependency audit in CI** (`npm audit --audit-level=high` + license check). Two package sets, tiny graphs — trivial to keep green. | M | S |

## G. Accessibility (cross-cutting)

| # | Improvement | Impact | Effort |
|---|---|---|---|
| G1 | **Screen-reader map summaries** — folds into A3: every map interaction announces state (selected item, route steps, view mode). | H | M |
| G2 | **Contrast audit.** Several soft-muted texts (`--ink-soft` on `--surface`) sit near 4.5:1; run an automated pass (axe) and adjust tokens. | M | S |
| G3 | **Reduced-motion in flights.** The hero honors `prefers-reduced-motion`; the ✈ flight should too (jump straight to arrival framing, keep the ribbon). | M | S |
| G4 | **Touch target sizes.** Icon buttons in store cards/editor hover around 28 px; lift to ≥ 40 px on coarse pointers (`@media (pointer: coarse)`). | M | S |

## H. Mobile / offline

| # | Improvement | Impact | Effort |
|---|---|---|---|
| H1 | **PWA install + offline** — ✱ INFRA §11.1 / MOBILE M1: service worker, cached payloads, offline banner. The top requested behavior after QR scanning in a dead-signal store. | H | S |
| H2 | **App shells** — ✱ MOBILE M2–M5 (Capacitor, scanner, push, employee mode). | H | M |
| H3 | **QR code with logo.** QrModal renders a plain QR; add the store logo center + high-error-correction level — scans better on printed posters, looks owned. | L | S |
| H4 | **Offline edit queue** — ✱ INFRA §11.3 (IndexedDB outbox + snapshot-based 409s). | M | M |

## I. Data model & integrations

| # | Improvement | Impact | Effort |
|---|---|---|---|
| I1 | **Barcode everywhere.** Barcodes exist on products and search already matches them; expose them in the editor product form prominently + the client scan hook (`?q=` prefill) so a USB scanner becomes a stock-taking wand. | M | S |
| I2 | **Product variants.** One row per SKU today; size/flavor variants duplicate names. Add optional `parent_product_id` + variant label (planogram unaffected; search groups children). | M | M |
| I3 | **Price history / promotions.** `price` is a single field; add `price_history` (timestamped) so sales are visible and future deal features have data. | L | S |
| I4 | **Webhook out of StockTrack.** v1 is pull-only; add optional `POST` to a store-configured webhook on movement events (stock apps get push without polling). | M | M |
| I5 | **Adapter test fixtures library.** Adapters are tested against inline fakes; move each fake response to `test/fixtures/<provider>.json` so new adapters copy a template (docs in CODE_REFERENCE Part I already describe the contract). | L | S |
| I6 | **Full-text search.** LIKE is fine to ~100 K products; SQLite FTS5 (`products_fts` virtual table, triggers to sync) is a drop-in upgrade for typo tolerance when stores grow. | M | M |

## J. Ops, testing & DX

| # | Improvement | Impact | Effort |
|---|---|---|---|
| J1 | **Restore drills in CI** — ✱ INFRA §7: nightly job restores the latest Litestream backup to a scratch machine and asserts row counts. | H | S |
| J2 | **Error tracking.** `console.error` only; add Sentry free tier (or self-hosted GlitchTip) on both apps — source maps upload in CI. | H | S |
| J3 | **Playwright E2E suite.** The session's manual browser verifications (search → route → flight, editor draw → autosave → history restore) deserve permanence: ~10 scenarios, run on deploy builds. | H | M |
| J4 | **Visual regression on the 3D engine.** Render 4 canonical cameras of the demo store to PNGs in Vitest (canvas mocked) and hash-compare — catches sorter/BSP regressions like this session's wall/shelf bug class. | M | M |
| J5 | **CI pipeline** (GitHub Actions): typecheck + unit + build + docker build + (J3) on PRs; deploy job gated on tags. The repo has all the pieces except the workflow file. | H | S |
| J6 | **API OpenAPI spec.** The API table in README is good; generate `openapi.json` from route comments (or hand-write once) → SDK snippets for StockTrack consumers and the mobile app. | M | M |
| J7 | **Seed variations.** One demo store; add `--profile tiny|market|warehouse` to the seeder (tiny = 1-aisle for docs GIFs, warehouse = racking layout to exercise §10). | L | S |

---

## Status (Oct 2026 implementation pass)

**Done** (this repo, all tests green): A1 A2 A3 A4 A5 A6 A8 · B1 B2 B3 B4 B5 B6 B7 B8 B9 B10 ·
C1 C3 C5 C6 · D2 D4 D5 · E2 E3 E4 E5 E6 · F4 F5 F6 F7 · G1 G2 G3 G4 · H1 H3 · I1 · J3 J5 J7.
**Deferred by request (auth)**: D1, F1, F2 — specs live in INFRASTRUCTURE §9.
**Open** (needs external service or larger design): A7 (i18n), C2 (near-me UI, geocoding landed),
C4 (category QR, needs category browse UI), D3 (chains), D6 (email digests), E1 (payload split),
F3 (import validation — no import-media path yet), I2 I3 I4 I5 I6, J1 J2 J4 J6.

## Suggested order (value density)

1. **B9 + B8** (bulk pin + import UX) — the owner onboarding wall.
2. **A1** (multi-stop trips) — the shopper wow that the mobile plan assumes.
3. **D1** (teams, ✱ specced) — unlocks multi-person stores.
4. **H1** (PWA offline, ✱ specced) — QR-in-dead-zone is the #1 field failure.
5. **E4 + D2** (image pipeline + health checklist) — polish + activation.
6. **F1/F4** (session revocation + credential encryption) — before real scale.
7. **J3/J5** (E2E + CI) — lock in everything above.

Everything marked ✱ already has an implementation-ready spec in
[INFRASTRUCTURE.md](INFRASTRUCTURE.md) or [MOBILE-APPS.md](MOBILE-APPS.md);
this file adds the rest. Estimated total: ~9–11 focused weeks for the full
backlog, with the top seven items ≈ 3.
