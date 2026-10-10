# StoreMap — Architecture & Technical Reference

This document is the deep, implementation-level companion to [README.md](../README.md)
(the what/why) and [PLAN.md](PLAN.md) (the original design plan). For
function-by-function documentation of every file see [CODE_REFERENCE.md](CODE_REFERENCE.md);
for the prioritized backlog see [IMPROVEMENTS.md](IMPROVEMENTS.md); for scale/mobile
see [INFRASTRUCTURE.md](INFRASTRUCTURE.md) and [MOBILE-APPS.md](MOBILE-APPS.md). It explains **how
every part of StoreMap actually works**: the data model, the server, the 2D SVG map
engine, the hand-rolled 3D engine (with the full camera and clipping math), the
wayfinder, the editor, the demo seeder, and the test suite.

---

## 1. System overview

```
┌───────────────────────────────┐        ┌──────────────────────────────────────┐
│ Browser (any device)          │        │ Node.js ≥ 22.5 — one process         │
│                               │        │                                      │
│  React 19 SPA (Vite build)    │──API──▶│ Express                              │
│  ┌─────────────────────────┐  │ static │  ├─ Auth: Google + Apple OIDC        │
│  │ Shopper viewer /s/:slug │  │        │  ├─ REST API (JSON)                  │
│  │  · 2D SVG map engine    │  │        │  ├─ StockTrack v1 key API            │
│  │  · 3D canvas engine     │  │        │  ├─ Static file server (SPA + imgs)  │
│  │  · A* wayfinder         │  │        │  └─ node:sqlite (WAL) data/storemap.db│
│  │ Editor /dashboard/...   │  │        │                                      │
│  └─────────────────────────┘  │        │    data/uploads/ (floor plans, logos)│
└───────────────────────────────┘        └──────────────────────────────────────┘
```

Design principles:

1. **One process, one origin.** The Express server serves both the API and the built
   SPA, so session cookies are first-party and deployment is a single container.
2. **Zero heavy dependencies.** The 3D view is ~25 KB of first-party TypeScript on
   Canvas2D — no three.js, no WebGL. The database is Node's built-in `node:sqlite`
   (WAL mode) — no native modules. The whole frontend gzips to ~117 kB.
3. **Meters are the universal unit.** Every coordinate in the database, the API, both
   renderers, and the wayfinder is in meters. Origin is the floor's top-left corner
   with **y increasing downward** (screen convention) and **z increasing upward**
   (3D only — the 2D map has no z).
4. **Renders on demand.** Neither map engine runs a continuous frame loop. Frames are
   drawn when the camera, data, or viewport changes — idle means zero work, which
   matters for phones and old laptops.

---

## 2. Repository layout

```
backend/
  src/
    index.js              bootstrap: createApp().listen, PORT
    app.js                Express factory: headers, routers, static, SPA fallback
    config.js             env parsing (PORT, PUBLIC_BASE_URL, SESSION_SECRET, OAuth…)
    db.js                 node:sqlite open (WAL, FKs) + migrate() ledger
    auth/
      session.js          HMAC-signed sid cookie, attachUser middleware, dev login
      google.js           authorization-code flow + id_token verify + userinfo
      apple.js            form_post flow, ES256 client_secret JWT, JWKS verify
    lib/
      http.js             sendJson, asyncRoute, error helpers
      jwt.js              sign/verify HMAC JWTs (sessions), JWKS fetch/verify
      ownership.js        requireStoreOwner / requireAuth guards
      stock.js            stock levels, adjust/set, movement log
      stocksoft/          integration adapters (Square, Shopify, Vend, Clover,
                          Katana, Zoho, ERPNext, StockTrack, CSV)
    routes/
      auth.js stores.js floors.js catalog.js public.js
      uploads.js stock.js integrations.js v1.js
  scripts/seed-demo.mjs   demo store builder (see §12)
  test/                   node:test suites + smoke (see §13)
frontend/
  src/
    main.tsx App.tsx      router, auth context, top-nav (hidden on /s/:slug)
    api.ts                typed fetch wrapper (JSON + raw uploads)
    types.ts              row types + geometry JSON parse/serialize
    styles.css            design tokens + all component styles
    lib/
      geometry.ts         shared 2D math: viewport transforms, rect corners,
                          hit tests, shelfAnchor (pin→shelf-face snapping)
      mapColors.ts        element palette shared by both renderers
      navgrid.ts          wayfinder: grid build + A* + smoothing (§9)
      render3d.ts         3D engine core: camera, projection, clipping, meshes (§8)
    components/
      Landing.tsx Login.tsx Dashboard.tsx StockPage.tsx
      ViewerPage.tsx      shopper experience (state owner for route + camera)
      MapCanvas.tsx       2D SVG engine + editor interactions (§7)
      Map3D.tsx           3D canvas component + flight system (§8.9)
      ShelfDetail.tsx     planogram modal (bays/levels/facings)
      EditorPage.tsx      owner editor (tools, panels, autosave)
      ui.tsx              Field/Modal primitives
docs/                     PLAN.md (design plan) · ARCHITECTURE.md (this file)
```

---

## 3. Data model

SQLite tables (see `db.js` migrations; ids are UUID strings):

| table | purpose | notable columns |
|---|---|---|
| `users` | OAuth identities | `email UNIQUE`, `provider ('google'\|'apple'\|'dev')`, `provider_sub` |
| `stores` | one row per store | `owner_id → users`, `slug UNIQUE`, `is_public 0\|1`, profile fields (address/hours/phone/website/logo_url) |
| `floors` | one per store level | `width_m`, `height_m` (the floor slab size), `level`, `background_url` (tracing image) |
| `map_elements` | every drawn fixture | `type`, `shape`, `geometry` (JSON, meters), `label`, `color` ('' = type default), `z_index` |
| `categories` | product groupings | `name`, `color` (drives marker/stocking colors), `icon` |
| `products` | catalog | `category_id → categories SET NULL`, `name`, `brand`, `sku`, `barcode`, `price`, `image_url` |
| `product_locations` | a pin: "this product is here" | `product_id`, `floor_id`, `x`, `y`, `rot`, `meta` |
| `stock_levels` / `stock_movements` | built-in stock tracking | per-product quantity + full delta log |
| `api_keys` | StockTrack v1 credentials | `key_hash` (SHA-256), `key_prefix` shown in UI |
| `integrations` | saved stock-software connections | `provider`, encrypted-ish credentials JSON, `last_sync_at`, `last_error` |
| `migrations` | applied-script ledger | `name UNIQUE` — `migrate()` runs pending scripts in a transaction |

**Element geometry JSON** (parsed by `types.parseElement` into `MapElement.geom`):

| shape | JSON | notes |
|---|---|---|
| `rect` | `{ x, y, w, h, rot }` | `rot` degrees clockwise around the rect center |
| `polygon` | `[[x,y], …]` | closed; used for zone polys |
| `polyline` | `[[x,y], …]` | open; walls and aisle markings |
| `point` | `{ x, y }` | entrance / exit / POI |

**Element types and their meaning**

| type | blocking for walking? | 2D | 3D |
|---|---|---|---|
| `wall` | yes | filled rect / thick line | box, 3.2 m tall |
| `shelf` | yes | filled rect | box, 1.5 m tall |
| `zone` | no | translucent rect/poly tint | flat tint, 0.06 m |
| `aisle` | no | dashed polyline | flat ribbon, 0.04 m |
| `entrance` / `exit` / `poi` | no | circled glyph + label | billboard pin, 1.35 m |

---

## 4. Backend deep dive

### 4.1 App bootstrap (`app.js`)

`createApp()` runs migrations, builds Express with `x-powered-by` disabled, and sets
security headers before anything else: `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`,
`Permissions-Policy` disabling camera/mic/geolocation. `/api/*` responses get
`Cache-Control: no-store`.

Router order matters: `/api/auth`, `/api/stores` (owner-scoped: stores + stock +
integrations), `/api/floors`, `/api/public` and `/api/v1` (both key/cookie-less by
design) **must** precede the catch-all `/api` catalog router, which requires auth for
everything under it. JSON bodies are limited to 2 MB; `/api/uploads` takes raw bytes
(10 MB cap) and validates PNG/JPEG/WebP magic numbers before storing under
`data/uploads/` (served at `/uploads/*` with immutable caching).

Unknown `/api` paths return a JSON 404 (never an HTML stack). Anything that isn't
`/api` or `/uploads` falls through to the SPA `index.html` so deep links like
`/s/freshmart-downtown` work on hard refresh. That fallback has one special
case: **`GET /s/:slug` for a public store injects Open Graph / Twitter meta
tags and a per-store `<title>` into the shell** — scanned QR codes and shared
links preview the store (name, logo) instead of the generic SPA tag.

### 4.2 Media & CDN pipeline (Stage 0)

Uploads flow through `lib/storage.js`: magic-byte-validated bytes are stored
under a UUID name — to **Cloudflare R2** when `R2_*` env vars are set
(`lib/r2.js` is a zero-dependency AWS-SigV4 signer over `fetch`), else to local
disk (dev). Serving is **disk-first, then R2** at the same `/uploads/<name>`
URL with immutable year-long caching, so switching a deployment to R2 never
breaks older media. `lib/cdn.js` marks public payloads edge-cacheable
(`s-maxage=300, stale-while-revalidate` + per-store `Cache-Tag`) and
`touchStore` — the choke-point every public-data mutation already calls — fires
a **tag purge** so shopper caches refresh within seconds of an edit. Both are
no-ops without Cloudflare credentials.

### 4.2 Sessions & auth

- **Session cookie**: `sid` = HMAC-Signed JWT (HS256 via `lib/jwt.js`) containing
  `{ sub: userId }`, 30-day expiry. Cookie flags: `httpOnly`, `SameSite=Lax`,
  `Secure` when `NODE_ENV=production` (or `TRUST_PROXY=true`). `attachUser` verifies
  the JWT and loads the user row; invalid/missing → anonymous (the public viewer and
  login still work).
- **Google** (`auth/google.js`): standard authorization-code flow. `state` + `nonce`
  round-trip via short-lived httpOnly cookies; the returned `id_token` is verified
  against Google's JWKS (issuer, audience, expiry, nonce), then userinfo is fetched
  for name/avatar. User upsert keyed on `(provider, provider_sub)`.
- **Apple** (`auth/apple.js`): `response_mode=form_post` — Apple POSTs the code to
  the callback. Apple requires a **client_secret JWT signed ES256** with your
  *Sign in with Apple* key; `apple.js` builds it at request time from
  `APPLE_KEY_ID` + `APPLE_PRIVATE_KEY` (PEM) + `APPLE_TEAM_ID`. The returned
  `id_token` verifies against Apple's JWKS; the user's name arrives only on first
  authorization in the form body.
- **Dev login** (`POST /api/auth/dev-login`): only registered when
  `ENABLE_DEV_LOGIN=true` (default outside production). Issues a real session for
  the given email — same session code path, so the whole app is testable before any
  OAuth app is registered. Never enable in production.

### 4.3 REST API (owner-scoped unless noted)

All shapes are JSON; errors are `{ error: string }`. Auth = `sid` cookie.

| area | endpoints | notes |
|---|---|---|
| stores | `GET /api/stores/mine` · `POST /api/stores` · `PATCH/DELETE /api/stores/:id` · `GET /api/stores/:id/full` | `full` returns floors + elements + categories + products + locations — one request boots the editor |
| floors | `POST /api/stores/:id/floors` · `PATCH/DELETE /api/floors/:id` | floor delete cascades elements + locations (FK `ON DELETE CASCADE`) |
| elements | `PUT /api/floors/:id/elements` | **bulk replace** of the floor's elements in one transaction — this is what autosave calls; the client sends the complete element list |
| catalog | `POST /api/stores/:id/{categories,products}` · `PATCH/DELETE /api/{categories,products}/:id` · `POST /api/products/:id/locations` · `DELETE /api/locations/:id` | every nested path re-checks that the parent resource belongs to the session user (`lib/ownership.js`) |
| public | `GET /api/public/stores?q=` · `GET /api/public/stores/:slug` · `GET /api/public/stores/:slug/search?q=` | no auth; only `is_public = 1` stores; search is case-insensitive LIKE across name/brand/sku/category |
| stock | `GET /api/stores/:id/stock` · `POST …/stock/{adjust,set}` · `GET …/stock/log` | quantity changes append to `stock_movements` (delta, resulting qty, reason, source) |
| integrations | `GET/POST /api/stores/:id/integrations` · `POST …/:id/sync` · `POST …/integrations/csv` · `GET /api/stores/:id/catalog.csv` | pull-based sync from external stock software |
| v1 (API key) | `GET /api/v1/{store,products,stock,map}` · `POST /api/v1/products` (upsert) · `POST /api/v1/stock/{adjust,set}` | key via `Authorization: Bearer skm_…` or `X-API-Key`; keys stored hashed; revocation is immediate |
| uploads | `POST /api/uploads` (raw bytes) | magic-byte validation, 10 MB cap |
| health | `GET /api/health` | used by the Docker HEALTHCHECK |

**Ownership model**: nothing is authorized by id-guessing luck — `lib/ownership.js`
loads the parent row and compares `owner_id` with the session user for every nested
request (floors → stores, elements → floors, locations → products). Tests in
`api.test.mjs` specifically assert cross-account access returns 404/403.

### 4.4 Stock core (`lib/stock.js`) & API keys

Every quantity change funnels through `adjustStock`, which runs a transaction:
lazily create the level row, apply the delta, and append exactly one
`stock_movements` row (delta, resulting quantity, reason, source). `setStock`
is a thin wrapper computing the delta, so absolute and relative updates are
indistinguishable in the log. `upsertProduct` is the shared upsert for
integrations and the v1 API: match by SKU → barcode → name-with-empty-SKU,
update only provided fields, optional quantity seed/set. API keys are `skm_…`
values stored **hashed** (SHA-256) with a display prefix; `storeForApiKey`
resolves the key and stamps `last_used_at`.

### 4.5 Integration adapters (`lib/stocksoft/`)

Each adapter normalizes its vendor's payload into `{ name, sku, barcode, price,
quantity }` rows. `sync` upserts products (matched by sku → barcode → name) and
writes stock levels. The CSV adapter documents a stable interchange format; the
same format is what `catalog.csv` exports, so CSV round-trips are lossless
(covered by `integrations.test.mjs`).

---

## 5. Frontend architecture

- **Routing** (`App.tsx`): `/` landing · `/login` · `/dashboard` ·
  `/dashboard/stores/:id` (editor) · `/dashboard/stores/:id/stock` · `/s/:slug`
  (shopper). The top navigation is **not rendered** on `/s/:slug` — the shopper
  viewer is a full-bleed experience with floating overlays only.
- **Auth context**: `App` fetches `GET /api/auth/me` once and exposes
  `{ user, providers, refresh }` via context; the editor/dashboard guard by
  redirecting when `me` returns no user.
- **API client** (`api.ts`): thin typed wrapper; every method throws on non-2xx with
  the server's `error` message. Binary upload is a separate raw fetch.
- **Planogram engine** (`lib/shelfLayout.ts`): pure functions turn a shelf
  element + its pins into bays/levels/facings (`computeShelfLayout`), driven by
  per-shelf `meta` (bays/levels/facing width) and pin coordinates in the
  shelf's local frame — the ShelfDetail modal shows exactly what the map shows.
- **State**: each page owns its state locally (no global store). The two stateful
  engines (2D canvas, 3D canvas) are controlled components — `ViewerPage` owns the
  3D `Camera3D` object so toggling 2D↔3D never resets the user's angle, and the
  editor owns `elements` + undo history.

---

## 6. 2D map engine — `MapCanvas.tsx` + `lib/geometry.ts`

The 2D view is pure SVG: one `<svg>` sized to the container, everything inside a
`<g transform="translate(tx ty) scale(scale)">`. World meters map to screen px via
`worldToScreen(p, vp) = { x: p.x·scale + tx, y: p.y·scale + ty }`; the inverse is
`screenToWorld`. `fitViewport(w, h, cw, ch, pad)` computes a scale/offset that fits
the floor slab with padding. Strokes that must stay constant on screen (borders,
route lines, selection handles) use `vectorEffect="non-scaling-stroke"` so they're
specified in px while the geometry stays in meters.

**Scene order** (SVG paints in document order): tracing image → floor slab → grid
patterns (`<pattern>` in world units) → elements (in `z_index` order) → route →
draft previews → product pins → selection overlay. Text labels are SVG `<text>`
with a screen-constant `fontSize` derived from `12.5 / scale`.

**Editing state machine** (edit mode): `pointerdown` picks an interaction based on
tool and hit test — `pan` (empty space / shift / middle button), `move` (element
drag with grid snap), `resize` (one of 8 handles), `rotate` (rotation handle,
shift = 15° steps), `draw-rect` (shelf/wall/zone tools), or point placement.
Two pointers switch to pinch-zoom (`pinch` ref holds start distance + viewport).
`pointerup` without movement is a click: select (edit mode) or open a shelf's
layout (viewer mode).

**Hit testing** (`elementContains`): points use a radius; rects inverse-rotate the
point into the rect's local frame then AABB-test (so rotation is exact); polygons
ray-cast; polylines test distance-to-segment. Tolerance is
`max(0.25, 7/scale)` meters — a screen-constant grab radius.

**Undo/autosave contract**: `onElementsChange(elements, 'begin' | 'live' | 'push')`.
`begin` snapshots history at gesture start without marking dirty; `live` mutates
during a drag (no new snapshot); `push` commits a finished change (snapshot + dirty
+ autosave). The editor's autosave is debounced (~600 ms) and sends `PUT
/floors/:id/elements` with the floor's complete element list — the server replaces
all rows in one transaction, so there is no merge state to corrupt.

---

## 7. Wayfinder — `lib/navgrid.ts`

Purpose: given a floor, its fixtures, and a goal point, produce a natural walking
path from the entrance that doesn't clip shelves.

1. **Grid build** (`buildNavGrid`): rasterize a padded box around the floor
   (1 m margin) into `cell = 0.25 m` cells. A cell is **blocked** if:
   - it doesn't intersect the floor slab, or
   - its center is within `clearance = 0.3 m` of any `wall`/`shelf` geometry
     (reuses `elementContains` with tolerance — exact for rotated rects, distance
     for polylines). `zone`/`aisle`/points are walkable. 0.3 m ≈ half a shopper's
     shoulder width; two parallel shelves 1.5 m apart leave a 0.9 m virtual corridor.
2. **Start** (`pickStartPoint`): the entrance `point` element nearest the goal
   (straight-line); falls back to any exit, then the floor's bottom-edge midpoint.
3. **Search** (`astar`): 8-directional A*. Octile heuristic (admissible for 8-way):
   `h = (max(dc,dr) + (√2−1)·min(dc,dr)) · cell`. Diagonal moves are allowed only
   when *both* orthogonal neighbours are open (no corner cutting). The priority
   queue is a binary min-heap over a packed cell index with a shared `fScore`
   Float64Array; stale heap entries are skipped via a closed bitmap.
4. **Goal snapping** (`nearestOpen`): pins often sit inside a shelf footprint. The
   goal (and start) snap to the nearest open cell within 6 m, spiral-searched by
   world distance. The returned path rewrites its endpoints to the *exact* start
   and goal points (not cell centers).
5. **Smoothing** (`simplifyPath`): greedy string-pulling — from the current point,
   walk the list backwards to the farthest point in `lineOfSight` (sampling every
   0.4·cell), emit it, continue. Typical store routes collapse to 3–7 waypoints.
6. **Assembly** (`computeRoute`): clamps the goal into the floor, builds the grid,
   runs A*, smooths, and returns `{ points, distanceM, start, goal }` — or `null`
   if the goal is unreachable (e.g. inside a sealed stockroom).
7. **Walk time**: `WALK_M_PER_MIN = 80` (brisk shopping pace) → the badge's
   "≈ N min".

Cost: grid build is O(cells + fixture AABB cells); for a 54×36 m floor that's
~31 k cells and runs in a few ms — cheap enough to recompute per selection.
The route is recomputed when the elements change (editing shifts shelves).

---

## 8. 3D engine — `lib/render3d.ts` + `Map3D.tsx`

A software 3D pipeline on Canvas2D. No WebGL, no scene graph, no render loop.

### 8.1 Coordinate system

World axes match the 2D map: **x/y across the floor (y down, matching screen
convention), z up, everything in meters**. A shelf at `y = 6` is at the *north* end
because y grows southward — same as the 2D view, so toggling 2D↔3D never flips the
store.

### 8.2 Camera model

```ts
interface Camera3D { yaw, pitch, dist, tx, ty, tz, fov? }
```

The camera orbits a **target** `(tx, ty, tz)`. Derivation (this is the exact math in
`toCamera`): translate the point by `−target`, rotate around **z** by `yaw`:

```
x1 = dx·cos(yaw) − dy·sin(yaw)
y1 = dx·sin(yaw) + dy·cos(yaw)
```

The eye sits at rotated-frame position `(0, +dist·cos(pitch), +dist·sin(pitch))` —
i.e. in world space:

```
eye = ( tx + dist·cos(pitch)·sin(yaw),
        ty + dist·cos(pitch)·cos(yaw),
        tz + dist·sin(pitch) )                        // cameraEye()
```

The view depth and screen-up of a point are then:

```
depth = dist − y1·cos(pitch) − dz·sin(pitch)   // distance along the view axis
up    = dz·cos(pitch) − y1·sin(pitch)          // height in the view plane
```

At `pitch = π/2` (straight down) `depth = dist − dz` and `up = −y1`, so the floor
plane maps exactly like the 2D map (x right, y down). At lower pitches the far edge
of the store rises toward the horizon. Perspective divide:

```
f  = (h/2) / tan(fov/2)          // fov = 50° vertical
sx = w/2 + f·x1/depth
sy = h/2 − f·up/depth
```

`camFromEyeLook(eye, look)` inverts all of this for the flight system: given a
desired eye and look-at, `pitch = asin(−fz/|f|)`, `yaw = atan2(fx, fy)`,
`dist = |f|`, `target = look`.

### 8.3 Frame pipeline

`renderScene(ctx, w, h, cam, floor, elements, input)` runs, in order:

1. **Assemble faces** — cached `buildSceneFaces` result (input.faces), plus per-frame
   stocking blocks and route ribbon.
2. **Project + clip** every face (§8.4).
3. **Sort** — painter's algorithm: `layer` ascending, then **centroid depth
   descending** (farthest first) within a layer.
4. **Draw** — backdrop gradient, then each face as a filled/stroked path.
5. **Overlay** (always on top): route endpoint discs, marker billboards, product
   pin dots, and element labels.

### 8.4 Near-plane clipping

`project()` returns `null` for points with `depth < NEAR` (`NEAR = 0.25 m`). A face
with *any* vertex behind that plane cannot be projected as-is. Naively skipping the
whole face makes walls vanish when the camera closes in — the classic "cut out
areas" bug. Instead, faces are taken into camera space (`toCamera`) and clipped
against the plane `depth = NEAR` with the Sutherland–Hodgman single-plane algorithm
(`clipPolygonNear`): for each edge, keep inside vertices and insert the exact
intersection point at parameter `t = (NEAR − a.depth)/(b.depth − a.depth)`. The
clipped polygon is projected with the near vertices pinned at `depth = NEAR`, so a
wall you fly into renders as a partial quad instead of disappearing. Faces fully
behind the camera clip to nothing and are skipped.

### 8.5 Layering + the BSP (the depth-order contract)

Canvas2D has no depth buffer, so "which shape is in front" must be answered by draw
order — and draw order must be **exact**, not heuristic. The engine answers it in
two parts:

**Layers** partition the scene into classes that never legitimately compete on depth
(stacked/coplanar geometry like markings on the floor). Each layer is drawn fully
before the next:

| layer | contents | why |
|---|---|---|
| 0 | floor slab tiles | everything stands on it |
| 0.25 | 1 m grid lines | markings over tiles |
| 0.5 | flat decals (zone tints, aisle ribbons) | markings over grid |
| 1 | route ribbon | under fixtures, over markings |
| 2 (default) | extruded solids (walls, shelves, stocking) | the actual store |
| overlay | billboards, pin dots, labels | always readable |

**Within a layer, order comes from an axis-aligned BSP tree** (`buildFaceBSP`,
`traverseFaceBSP`): the tree is built once per data change — each node splits space
with a *face's own plane* (its thinnest axis), partitioning the remaining faces into
below/above and splitting any face that straddles the plane. Traversing from the eye
(draw far side first, then the node's coplanar faces, then the near side) yields an
**exact back-to-front order for any camera position** — shelves never paint over
walls that occlude them, walls never cover shelves in front of them, and nothing
disappears, at any angle. This replaced an earlier centroid-depth heuristic whose
quantization showed up as dashes along walls at grazing angles.

The stocking blocks no longer backface-cull: with exact ordering, a block on a far
face is simply covered by the shelf's own near faces.

### 8.6 Face tiling (kept for BSP quality + fewer splits)

Faces are still tiled by `subdivideFaces`: every quad with an edge longer than
`MAX_TILE_M = 4 m` is split into a bilinear grid of ≤4 m tiles (the 54×36 m floor
becomes 14×9 = 126 tiles). The BSP no longer *needs* tiling for correctness — it
splits straddling faces itself — but pre-tiled faces keep the tree balanced, keep
per-face work bounded, and give the rasterizer reasonably sized polygons. Horizontal
solid faces (box tops) additionally split finely along their depth (0.6 m rows) so
the sliver of border shelving that peeks over a wall top renders as a smooth thin
band rather than per-face steps.

Two hard-won rules from the same investigation:

1. **Never mutate a cached face array.** `renderScene` once pushed per-frame
   stocking/route faces into the caller's cached array — every frame appended that
   frame's faces, and stale (later-culled) stocking blocks accumulated and kept
   rendering through walls. The renderer copies any provided array before mutation.
2. **Keep fixtures off wall faces.** The demo seeder leaves a 0.15 m gap between
   border shelving and the wall: a shelf face exactly coplanar with a wall face is
   an exact draw-order tie (a coin flip in any painter-style renderer).

### 8.6.1 Why not a z-buffer?

A per-pixel z-buffer (software rasterization into ImageData) is the other exact
approach, but it means rasterizing every covered pixel in JavaScript each frame —
an order of magnitude more per-frame work than drawing ~2000 polygon paths. The BSP
moves the cost to build time (once per data change) and keeps per-frame work at
project + clip + stroke, which is what keeps the engine viable on low-end devices.

### 8.7 Mesh building

- `boxFaces(base, height, color)` extrudes a polygon footprint: a top face plus one
  quad per edge, each shaded by `lit(normal, color) = shade(color, 0.55 + 0.45·|n·L|)`
  with key light `L = (−0.38, −0.5, 0.78)`. Tops are bright, sides split into two
  brightness bands — enough depth cueing at zero cost.
- Type heights: `wall 3.2`, `shelf 1.5`, `zone 0.06`, `aisle 0.04` meters.
- Flat decals (height ≤ 0.12) draw as translucent quads in layer 0.5.
- Wall *polylines* extrude each segment into a 0.22 m thick box.
- Everything passes through `subdivideFaces` (§8.6).

### 8.8 Stocking visuals

Every pinned product renders as a small vertical "facing" block standing on its
shelf's wall face — this is why shelves look stocked. `shelfAnchor(p, elements)`
(`lib/geometry.ts`) finds the nearest point on the nearest shelf outline and its
**outward normal** (edge normal oriented away from the shelf's center). The block is
a 0.9 × 0.86 m quad at the anchor, offset 0.04 m proud of the face, spanning
z 0.32–1.18, colored by category with a ±6 % deterministic brightness jitter keyed
on the pin position. Blocks are not camera-culled — the BSP orders them exactly, so
a block on a far face is covered by the shelf's own near faces, and the stocking
faces can live in the cached scene BSP instead of being rebuilt per frame.

### 8.9 Pins, markers, labels

- **Product pins**: `Map3D` anchors each visible pin with `shelfAnchor`; stocked
  items render as a colored dot on the wall face (z ≈ 1.05 m, bigger when focused,
  plus a floor ring and a name label). Items not near a shelf fall back to a
  free-standing pole marker (2.1 m; 2.6 m focused). Hit-testing reuses the projected
  dot/base positions returned by `renderScene` (`PinHit[]`): a tap within 18 px
  selects the product, which re-routes and re-anchors everything.
- **Entrance/exit/POI markers** are billboards (screen-space line + dot + label) —
  immune to the perspective distortion that made extruded poles look like cones when
  the camera walked past them.
- **Element labels** project each labeled element's center and draw text with a
  depth-scaled size (`clamp(8.5, 260/depth, 14)` px, skipped beyond 90 m). Labels
  with identical text that project within 140 px of each other draw once — so the
  four segments of "Aisle 1" don't stack.

### 8.10 Route ribbon

`routeFaces` turns the route polyline into a 0.45 m wide flat ribbon at z = 0.07
(one quad per segment, plus a square joint patch at each interior vertex so 90°
turns have no notches), in layer 1 — always under fixtures, over markings. The
start gets a green disc, the goal an orange one. In 2D the same polyline renders as
a white-cased orange SVG line (`vectorEffect="non-scaling-stroke"` keeps it 3.5 px
at any zoom).

### 8.11 Flight system (`Map3D.tsx`)

Triggered by the top-bar **✈ Fly the route** button (`flythrough` prop seq bump —
deliberately *not* by selection, which only shows the route and resets the camera).
Three phases in one rAF loop:

1. **Approach** (750 ms, ease-out): lerp every camera field from wherever the camera
   is to the path-start camera (yaw takes the shortest angular path).
2. **Walk** (clamp(routeLength / 9 m/s, 3–9 s)): the eye follows the path —
   `EYE_Z = 8 m` overhead, `EYE_BACK = 4 m` trailing along the path, looking at the
   path itself 4 m ahead (`LOOK_Z = 0`), so the pitch is a constant
   `FLIGHT_PITCH = atan2(8, 8) = 45°`. `pathSampler` provides arc-length
   interpolation and extends straight past the ends, so the camera starts behind
   the entrance and the look-ahead clamps at the goal.
3. **Arrive** (950 ms): pull back to `dist = clamp(span/2, 14, 42)` at the *same*
   pitch and heading — one constant angle for the whole flight, framing whole
   fixtures (the old close-up arrival made 27 m shelf rows run off-screen, leaving
   orphaned end caps that looked like floating slabs).

"Skip flight" jumps straight to phase 3; any pointerdown or wheel cancels into
manual orbit. The camera object lives in `ViewerPage` (not the canvas component), so
toggling 2D↔3D preserves the user's angle, and selecting a new item resets it to
`fitCamera`.

### 8.12 Performance engineering

- **No render loop**: frames draw only when `cam`, size, data, route, or stocking
  change (pointer-driven state updates at pointer-event rate).
- **Cached geometry**: `sceneFaces = useMemo(buildSceneFaces(floor, elements))` —
  camera changes skip mesh building and tiling entirely.
- **DPR cap 2**; face budget after tiling ≈ 800–1200 quads for a 54×36 m store,
  well inside Canvas2D's comfort zone; the demo store draws in ~2–4 ms per frame.
- **Cheap culling**: near-plane clip is O(vertices); stocking backface cull is a
  dot product.

---

## 9. Shopper viewer UX (`ViewerPage.tsx`)

State machine of a search:

```
[landing: full store, no pins]
  └─ type in search box ──▶ dropdown of matches (name · brand · price · floor)
       └─ pick one ──▶ focusResult():
            · reset 3D camera to fitCamera(floor)          (original angle)
            · computeRoute(entrance → pin)                 (orange route + badge)
            · keep only the selected item's marker visible
            · search box clears
                 └─ ✈ Fly the route ──▶ flight (§8.11)
                 └─ drag / wheel ──▶ manual orbit (route + badge persist)
                 └─ 2D toggle ──▶ SVG view: route + pin on the shelf outline line
                 └─ ✕ on badge ──▶ clear route + marker
```

The map preview shows **no item markers** until the shopper searches — matches appear
while the dropdown is open, and afterwards only the selected item's marker remains
(`pins` filter on `hasSearch` / `focusedProductId`). Tapping a pin on either map
re-runs `focusResult` for that product. The document title becomes
`"<store> · StoreMap"`, and the 2D/3D choice persists in localStorage.

---

## 10. Owner editor (`EditorPage.tsx`)

Layout: top bar (store name, floor tabs + add, Undo/Redo, **⧉ Duplicate**, Fit,
SaveBadge) · map canvas · right panel (Map / Products / Store tabs) · bottom tool
palette.

| tool | draws | notes |
|---|---|---|
| Select | — | drag to move; drag handles to resize/rotate; `R` rotates 90°; Delete removes; **arrow keys nudge** (0.25 m, Shift = 1 m); the panel's Position section offers a nudge pad plus exact X/Y fields |
| Pick filter (toolbar, Select tool) | — | **Fixtures** = normal element picking; **Products** = clicks select/drag product pins only — floor, walls and shelves are never grabbed. A click (no drag) opens the Products tab with the row flashed; a drag moves the pin locally and upserts it on release (`POST /api/products/:id/locations` — one API call per gesture) |
| Duplicate (top bar) | — | offset-copies the selected element (+0.5, +0.5 m) |
| Shelf | rect | 1.5 m box, valid pin target, blocks walking |
| **Aisle pair** | two rects | drag one row; a facing row is committed 1.5 m across the aisle (offset `y + h + 1.5`) — the one-drag way to build real grocery aisles |
| Wall / Wall line | rect / polyline | 3.2 m boxes; line walls extrude per segment |
| Aisle | polyline | non-blocking floor marking ribbon |
| Zone / Zone (poly) | rect / polygon | translucent tint decal |
| Entrance / Exit / Point | point | route start; billboards in 3D |
| Product pin | — | pick a product in the Products tab, click the shelf |

**⧉ Duplicate** (top bar) offset-copies the selected element by (+0.5, +0.5) m and
selects the copy — rows, walls, whole fixture runs clone in one click. The side
panel's Map tab shows the selected element's properties (type color, label,
exact geometry, duplicate/preview/delete) or the floor settings (name, width/height
in meters, floor-plan tracing image, delete). Products tab: filter, add/edit/delete,
category management, and 📍 place-pin mode. Store tab: profile fields + logo.

Autosave: every committed change marks the store dirty; a debounce later sends
`PUT /floors/:id/elements` with the full element list; the badge cycles
Saved → Unsaved → Saving… → Saved ✓ (with a retry button on failure). Undo/redo are
in-memory array snapshots per floor.

**Autosave history (the changelog).** Each successful `PUT /elements` calls
`maybeSnapshot`: a row in `floor_snapshots` is written **at most once per 60 s per
floor** (active drawing autosaves every few hundred ms — unthrottled snapshots would
spam the DB and slow the save path) and **at most 20 rows per floor are kept**
(oldest pruned on insert). Bounded storage: 20 × (full elements JSON) — a few KB for
typical floors, capped at a few MB for a maximal 2000-element floor. The editor's
History tab lists snapshots newest-first ("Latest · N elements · time") with a
one-click **Restore**: it fetches the snapshot's elements, loads them as a normal
`push` history step, and lets autosave persist them — so a restore is itself
undoable and re-snapshotted.

---

## 11. Demo seeder (`backend/scripts/seed-demo.mjs`)

Builds the demo supermarket into the first floor of the store with slug
`freshmart-downtown`:

- **Floor**: 54 × 36 m. Perimeter walls 0.4 m thick.
- **Entrance/exit**: points at (27, 35.1) and (31, 35.1); checkout zone
  (20, 29.6 → 34×3.2) with four labeled counters (shelf rects 2.3×1.3).
- **Border shelving**: five runs (west, north, east, two south segments flanking the
  entrance gap) — products around most of the border.
- **Central gondolas**: 4 aisle pairs at `y0 = 6 + 6p`, each split into two 19 m
  segments (`x = 6` and `x = 28`) with a 3 m mid cross-aisle; within a pair the rows
  are 0.7 m deep with a 1.5 m aisle between them, both rows stocked on both faces.
- **Stocking faces**: an explicit list of face lines (perimeter inner edges + every
  gondola face). Slot centers every 2.2 m along each face; 150 products are sampled
  evenly across all slots (`index·total/150`), so items spread over the whole store.
- **Products**: 8 categories (Dairy 20, Produce 20, Beverages 18, Snacks 18,
  Bakery 15, Frozen 15, Household 22, Meat & Seafood 22 = 150) with realistic names,
  cycling brands, deterministic prices, and category colors that drive the 3D
  stocking blocks.
- **Idempotency**: skips when ≥6 shelves exist at the same floor size;
  `--reset` wipes the store's elements/products/categories/locations and rebuilds.

---

## 12. Testing inventory

Backend (`node:test`, boots the real Express app on a throwaway SQLite file):

- `api.test.mjs` — auth/session, ownership enforcement (cross-account probes),
  store/floor/element/product CRUD, bulk element replace, public endpoints not
  leaking non-public stores, search correctness.
- `stock.test.mjs` — adjust/set accumulation, movement log, validation.
- `integrations.test.mjs` — adapter normalization, sync upserts, CSV round-trip.
- `validate.test.mjs` — element geometry validation units (rotation wrapping,
  malformed payloads).
- `smoke.mjs` — boots the real server and walks the whole user journey over HTTP.

Frontend (Vitest + jsdom, 67 tests):

- `geometry.test.ts` — transforms, fit, hit tests, shelfAnchor snapping.
- `navgrid.test.ts` — grid blocking/clearance, routing around shelves with a
  Euclidean clearance sweep, sealed-room unreachability, simplification invariants,
  start-point selection.
- `render3d.test.ts` — projection/depth properties, `camFromEyeLook` round-trip, exact BSP ordering,
  box/route/stocking meshes, scene composition, tiling, near-plane clipping,
  palette.
- `ShelfDetail.test.tsx` — planogram modal interactions.

`npm run build` runs `tsc --noEmit` + `vite build` — type errors fail the build.

---

## 13. Deployment

- **Docker**: multi-stage (build SPA → run backend). `docker-compose.yml` mounts a
  `storemap-data` volume at `/data` (SQLite + uploads) and passes env through.
- **Env** (`.env.example`): `PORT`, `PUBLIC_BASE_URL`, `SESSION_SECRET`
  (required in production), `NODE_ENV`, `TRUST_PROXY`, `ENABLE_DEV_LOGIN`,
  `GOOGLE_CLIENT_ID/SECRET`, `APPLE_CLIENT_ID/TEAM_ID/KEY_ID/PRIVATE_KEY`.
- **TLS** terminates at the platform/proxy; set `TRUST_PROXY=true` so secure cookies
  and rate limiting behave. Health check: `GET /api/health`.

---

## 14. Known limitations & rendering notes

- **Painter's algorithm**, even tiled, is a heuristic: perfectly interpenetrating
  geometry (two boxes occupying the same volume) can still sort locally wrong. Store
  maps don't have interpenetration unless the owner overlaps fixtures.
- Decals (zones/aisles) are deliberately non-blocking and draw in fixed layer order
  to avoid depth ties with the floor.
- The nav grid is 2D — no stairs/multi-floor routing yet (multi-floor stores show
  routes per floor; a future stair-hop graph would extend `computeRoute`).
- Flight and camera state are per-session (not persisted); only the 2D/3D choice is.
