# StoreMap — iOS & Android App Plan

**Status: PLAN — no app code yet.** How StoreMap ships to the App Store and Google
Play while the website remains the single source of truth. Companion docs:
[INFRASTRUCTURE.md](INFRASTRUCTURE.md) (hosting — its §11 offline spec is the
foundation), [ARCHITECTURE.md](ARCHITECTURE.md) (current codebase).

---

## 1. Decision: one codebase, native shells

The entire shopper experience is a React SPA whose engines (SVG 2D map, Canvas2D
3D renderer, A* wayfinder) are plain TypeScript with zero DOM-framework lock-in
(`lib/geometry.ts`, `lib/navgrid.ts`, `lib/render3d.ts`). Rewriting them per
platform would double every bug and halve every fix. Therefore:

| Option | Verdict |
|---|---|
| **PWA only** (install from browser) | ✅ Phase 1 — already planned (INFRA §11.1); no store fees, instant updates |
| **Capacitor** (this repo's SPA + native shell) | ✅ **Phase 2 — recommended**: same React/TS code, real App Store/Play presence, native camera/push/share; Canvas2D + SVG run natively in WKWebView/WebView |
| React Native / Expo | ❌ rewrites both map engines; the 3D renderer is Canvas2D, awkward in RN |
| Flutter | ❌ full rewrite in Dart, no shared code at all |

**Stack (Phase 2):** Capacitor 6 + this repo's `frontend/` + three native plugins
(camera barcode scan, push, share) + a thin `apps/mobile` config (API base URL,
deep-link host). One team, one codebase, three delivery vehicles (web, TestFlight,
Play internal testing).

---

## 2. What the apps add over the website

| Feature | Web (PWA) | Native app | How |
|---|---|---|---|
| Map search + route + fly-through | ✅ | ✅ | identical code |
| Offline maps after first view | ✅ (SW cache) | ✅ stronger | SPA bundled **inside the app** → instant cold start, zero network for shell; map payloads in IndexedDB |
| **Barcode → route** | ❌ | ✅ | camera scan → `GET /api/public/stores/:slug/search?q=<barcode>` (barcode already indexed) → route |
| Store switcher / nearby stores | link | ✅ | geolocation → `/api/public/stores` (add `?lat=&lng=` sort later) |
| Home-screen presence | install prompt | ✅ real icon | store presence is also marketing for the platform |
| Push (owner stock alerts) | ❌ | ✅ | FCM/APNs; shopper pushes later (deals) |
| **Employee mode**: stock counts, transfers | ✅ | ✅ | same SPA; native camera for bin-code scans |

## 3. Architecture

```
┌─────────────── apps/mobile (Capacitor) ───────────────┐
│  WKWebView (iOS) / WebView (Android)                  │
│   └─ this repo's SPA built as static files,           │
│      loaded from the device (offline-first shell)     │
│  Native plugins:                                      │
│   · camera + ML Kit / VisionKit barcode scanning      │
│   · push (FCM ↔ APNs)                                 │
│   · share sheet, haptics, geolocation                 │
│  Deep links: https://<host>/s/:slug (universal links  │
│  + App Links) and storemap:// for OAuth returns       │
└───────────────────────┬───────────────────────────────┘
                        │ same public REST API
                        ▼
        StoreMap origin (Fly.io, INFRASTRUCTURE.md) — unchanged
```

**Key integrations**

1. **Auth in a web shell**: WKWebView blocks third-party cookies, so Google/Apple
   sign-in opens in the *system* browser (Capacitor Browser /
   ASWebAuthenticationSession) and returns via `storemap://callback` or an
   https universal link; the session cookie is set on the shared host and the
   WebView picks it up (same-origin loads). Magic-link email sign-in (INFRA §9.3)
   makes this flow identical on both platforms.
2. **API base URL** is a build-time env (`VITE_API_BASE`) — app builds point at
   the production origin; CORS already allows the app scheme origins.
3. **Offline**: the app bundles the built SPA; map payloads sync per viewed store
   (pull-to-refresh); edits queue in the existing IndexedDB outbox (INFRA §11.3).
4. **Push**: one new endpoint, `POST /api/v1/devices` (owner-scoped API key:
   `{platform, token}`) + a server-side FCM/APNs sender triggered by
   stock-below-reorder events (reuses `stock.js`). No shopper data leaves the
   device beyond existing API calls.

## 4. Project layout (when implementation starts)

```
apps/mobile/            Capacitor project (config, native icons, plugins)
  capacitor.config.ts   appId app.storemap, server.hostname <prod host>
frontend/               unchanged — `npm run build` output is the app shell
backend/                + /api/v1/devices (push registration) only
docs/MOBILE-RELEASE.md  store listings, screenshots, review notes (then)
```

## 4.5 Screen specifications (wireframes)

Six screens carry the whole app; each maps 1:1 onto existing routes so the web
and app never diverge.

**S1 · Home / store finder** (`/`)
```
┌───────────────────────────────┐
│ StoreMap        [_scan_⚙️]    │  scan = global barcode entry point
│ ┌───────────────────────────┐ │
│ │ 🔎 Search stores…         │ │
│ └───────────────────────────┘ │
│ Near you                      │  opt-in location, sorted by distance
│ ┌──────┐ ┌──────┐ ┌──────┐    │
│ │Fresh-│ │Harbor│ │ …    │    │  store cards = dashboard pattern
│ │mart ●│ │ ●    │ │      │    │
│ └──────┘ └──────┘ └──────┘    │
│  Tab bar: [Stores] [Saved] [Settings] │
└───────────────────────────────┘
```

**S2 · Store map** (`/s/:slug`) — identical to the site: full-bleed 3D, floating
search, route badge, ✈ fly. Adds a bottom tab bar and an "add to list" on every
search result. Offline: shell + last-fetched payload from IndexedDB.

**S3 · Scanner** (native overlay from any screen)
```
┌───────────────────────────────┐
│        [camera preview]       │
│     ┌─────────────────┐       │
│     │  ▉▉ barcode ▉▉  │       │  ML Kit / VisionKit
│     └─────────────────┘       │
│ Scanning in Freshmart Downtown│  current store context
│         [Cancel] [Torch]      │
└───────────────────────────────┘
→ hit: product sheet (name, price, aisle) → [Route me] → S2 with route+flight
→ miss: "Not in this store's catalog" + [Search anyway]
```

**S4 · Shopping list** (app-only, local-first; sync optional via account)
```
┌───────────────────────────────┐
│ Shopping list        [share]  │
│ ☐ Milk 2L          Dairy      │  tap → route to it in the chosen store
│ ☑ Sourdough        Bakery     │
│ ☐ Dishwasher tabs  Household  │
│ ┌───────────────────────────┐ │
│ │ + Add item / + Scan       │ │
│ └───────────────────────────┘ │
│ [Route through this list ▸]   │  nearest-neighbor tour across the whole
└───────────────────────────────┘  list — navgrid A*, the planogram of §10.2
```
List items store `{product_id, store_slug}`; the "route through list" feature is
a guided shopping trip stop-by-stop. Data lives in IndexedDB (device-local),
exportable via the share sheet — no account needed.

**S5 · Sign in** (`/login`) — same OAuth/magic-link page in the system browser,
returning to the app via deep link; the WebView shows the employee/owner surface.

**S6 · Employee mode** (`/dashboard/…`) — owner/manager/editor surfaces as-is,
with: big-target stock counting (stepper ±1/±6 per tap), bin-code scanning for
warehouse transfers (§10 of INFRASTRUCTURE), and push-triggered low-stock list.

### Release checklist (per store)

1. Bump `apps/mobile` version; build web bundle (`npm run build`).
2. `npx cap sync` → Xcode/Android Studio archive → upload.
3. TestFlight / Play internal → external after a day of dogfooding.
4. Release notes generated from the changelog snapshot names (§INFRASTRUCTURE 9).
5. Post-release: verify universal links + push tokens on both platforms.

## 5. Store accounts & compliance checklist

| Item | Cost / note |
|---|---|
| Apple Developer Program | **$99/yr** — TestFlight (100 internal / 10 K external testers) |
| Google Play Console | **$25 once** — internal testing track, staged rollout |
| Apple review posture | wrap must add native value (camera scan, push, offline shell) — it does; avoid "minimum functionality" rejection by leading with scanning in the first-run UX |
| Privacy manifests / data-safety forms | camera (scan only, no upload), location (coarse, opt-in store finder), no tracking; links to a public privacy policy page |
| Account sign-in via Google/Apple | must also offer the magic-link email path (Apple 4.8 offers a non-third-party option — magic link satisfies it) |
| Age rating | 4+ / Everyone (shopping utility) |
| Deep-link hosting files | `/.well-known/apple-app-site-association` + `/assetlinks.json` served by the origin (one Express route each) |

## 6. Phases & effort

| Phase | Scope | Est. |
|---|---|---|
| **M1 — PWA** | service worker + install prompt + offline payloads (INFRA §11.1) | ~2 days |
| **M2 — Capacitor shells** | project setup, bundled shell, deep links, store screenshots → TestFlight + Play internal | ~3–4 days |
| **M3 — Scanner** | camera barcode → search → route flow, permission UX | ~2 days |
| **M4 — Push (owner)** | `/api/v1/devices` + FCM sender + stock-alert trigger | ~2–3 days |
| **M5 — Employee mode polish** | big-target stock counting UI, bin-code scanning for transfers (INFRA §10) | ~3 days |

Ongoing: release trains monthly (web ships continuously; store builds are the
same commit plus version bump).

## 7. Risks

1. **WKWebView perf** — the 3D renderer draws ~2 K Canvas2D polys/frame; smooth
   on 2019+ devices (already tested on mobile Safari via the responsive site).
   Fallback: the 2D view ships in the same binary; a worst-case WebGL path is a
   Phase-C option from INFRA §8.6.1, not needed now.
2. **Auth cookie friction** — mitigated by the system-browser flow above; test
   on iOS first (stricter).
3. **Review delays** — ship M2 (no camera/push) early to establish the app
   record while M3/M4 wait in review.
4. **App/play discovery is irrelevant for shoppers** — stores link their own QR
   codes and URLs; the app's job is retention + scanning, not acquisition.

## 8. Cost summary

| Item | Cost |
|---|---|
| Apple Developer | $99 / year |
| Google Play | $25 once |
| Capacitor + plugins (MIT/Apache) | $0 |
| FCM / APNs | $0 |
| CI builds (GitHub Actions macOS runner minutes) | ~$0–8 /mo |
| **Total** | **≈ $9 /mo amortized** on top of hosting (INFRA §13) |
