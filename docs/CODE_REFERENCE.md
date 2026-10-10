# StoreMap — Code Reference

**Function-level documentation of every file in the codebase.** Companion to
[ARCHITECTURE.md](ARCHITECTURE.md) (concepts & design) — this file is the map of
what each module exports, exactly what it does, and the invariants it maintains.
Read this alongside the source; every claim here is grounded in the code.

```
backend/            Node ≥ 22.5, zero runtime deps beyond express
frontend/           React 19 + TypeScript + Vite
```

---

# Part I — Backend

## `src/index.js` (15 lines)

| export | behavior |
|---|---|
| — (entry) | `createApp().listen(config.port)`; prints the listening URL and whether dev login is enabled. This is the only place a server is started; tests import `createApp` directly instead. |

## `src/config.js`

| export | behavior |
|---|---|
| `isProd` | `NODE_ENV === 'production'` |
| `config` | frozen-ish plain object built from `process.env` (see below) |
| `providersConfigured()` | `{ google, apple, dev }` booleans — drives which login buttons render |

Config fields: `port` (default 8787), `publicBaseUrl` (trailing slashes stripped;
fallback `http://localhost:PORT` — used for OAuth redirect URIs and OG tags),
`dataDir`/`dbPath`/`uploadsDir` (all derived from `DATA_DIR`, default `backend/data`),
`frontendDist`, `sessionSecret`, `sessionDays` (30), `google.*`, `apple.*`
(`APPLE_PRIVATE_KEY` unescapes `\n`), `devLogin` (default on outside production),
`maxUploadBytes` (10 MB), `r2` (null unless all four `R2_*` set), `cdn` (`CF_ZONE_ID`/
`CF_API_TOKEN`).

Side effects at import: creates `dataDir` + `uploadsDir` (`mkdirSync recursive`);
**throws** if `NODE_ENV=production` and no `SESSION_SECRET` — fail-fast rather
than signing sessions with a guessable default.

## `src/db.js`

| export | behavior |
|---|---|
| `db` | `new DatabaseSync(config.dbPath)` — Node's built-in SQLite |
| `migrate()` | runs `MIGRATIONS` in order inside per-script transactions; ledger table `migrations(name UNIQUE)` makes it idempotent |
| `newId()` | `crypto.randomUUID()` |

Migrations (name → contents): `001-schema` (users, stores, floors, map_elements,
categories, products, product_locations, store_api_keys, integrations,
stock_levels, stock_movements), `002-…` additions, `003-floor-snapshots`
(`floor_snapshots` + index `idx_snapshots_floor(floor_id, created_at_ms DESC)`).
DB pragmas at open: `journal_mode = WAL`, `foreign_keys = ON`.

## `src/app.js` — `createApp()`

Middleware/route assembly in exact order:

1. `x-powered-by` disabled; security headers on every response
   (`nosniff`, `strict-origin-when-cross-origin` referrer, `X-Frame-Options:
   DENY`, Permissions-Policy locking camera/mic/geolocation).
2. `/api/*` → `Cache-Control: no-store` (never cache private JSON; the CDN
   exceptions for public payloads are set per-route by `edgeCache` — see
   `lib/cdn.js` below).
3. `/api` router: `express.json({limit:'2mb'})` then `attachUser` (cookie →
   `req.user`).
4. `GET /api/health` → `{ok, service, time}` (Docker + Fly health check).
5. Routers: `auth`, `stores` (+ `stock`, `integrations` mounted on the same
   prefix), `floors`, **then** `public` and `v1` **before** the catch-all
   `catalog` router (order matters: catalog requires auth for everything).
6. `/api/uploads` raw-body router (`express.raw`, 10 MB).
7. JSON 404 for unknown `/api` paths.
8. `GET /uploads/:name` → `sendImage` (disk-then-R2, `lib/storage.js`).
9. Static SPA (`express.static` 1 h) + fallback. **`/s/:slug` special case**:
   when the slug matches a public store, `index.html` is read and served with
   injected `<meta property="og:*">`/`twitter:*` tags and a per-store
   `<title>` (`store.name · StoreMap`) so QR scans and shared links preview
   correctly. Non-matching slugs and owner routes get the plain shell.
10. Error middleware: `entity.too.large` → 413; anything else logged + 500 JSON.

## `src/lib/http.js`

| export | behavior |
|---|---|
| `sendJson(res, status, body)` | the single JSON egress (`res.type('application/json')`) |
| `badRequest` / `notFound` | 400/404 helpers |
| `parseCookies(req)` | splits `Cookie` header into a `{name: value}` map |
| `setCookie(res, name, value, {maxAge, httpOnly})` | appends `Set-Cookie` with `Path=/; SameSite=Lax` (+ `Secure` via `isProd` passed by callers) |
| `clearCookie(res, name)` | `Max-Age=0` |
| `handler(fn)` | wraps async express handlers so rejections reach the error middleware |
| `rateLimit({windowMs, max})` | in-memory fixed-window limiter per `req.ip`; sweeper `setInterval(...).unref()`; 429 + `Retry-After`. Correct for the single-node Stage 0/1 deployment (documented limitation for multi-node Phase 2) |
| `slugify(text)` | NFKD → lowercase → non-letter/number runs to `-`, trimmed, ≤ 48 chars, fallback `store` |

## `src/lib/jwt.js`

| export | behavior |
|---|---|
| `decodeJwt(token)` | splits/decodes header.payload.signature; throws on malformed |
| `signHs256(payload, secret)` | sessions: HMAC-SHA256, base64url |
| `verifyHs256(token, secret)` | re-signs and `crypto.timingSafeEqual`s the whole token — constant-time |
| `signEs256(payload, keyPem, kid)` | Apple `client_secret` JWT; signs with `dsaEncoding: 'ieee-p1363'` (the JOSE signature format) |
| `verifyOidcToken(token, {jwksUrl, issuer, audience, nonce})` | the OIDC id_token gate: ES256 only, JWKS fetch with a 1 h in-memory cache, `crypto.verify`, then issuer (accepts a list), audience, `exp` (60 s clock skew), optional `nonce` |
| `randomToken(bytes=24)` | base64url CSPRNG string — OAuth `state`/`nonce` |

## `src/auth/session.js`

| export | behavior |
|---|---|
| `issueSession(res, userId)` | HS256 JWT `{sub, iat, exp}` (30 d) in cookie `st_session` |
| `clearSession` / `currentUser` / `attachUser` / `requireAuth` | the auth middleware chain; invalid/expired tokens degrade to anonymous, never error |
| `makeState` / `checkState` / `clearState` | OAuth anti-CSRF: random value in a 10-min cookie compared on callback |
| `upsertUser({provider, sub, email, name, avatarUrl})` | identity merge policy: same `(provider, provider_sub)` updates profile; **same email via a new provider links into the existing user** (one human, one account); otherwise insert |

## `src/auth/google.js` & `src/auth/apple.js`

`google.js`: builds the consent URL (`openid email profile`, `state`, `nonce`),
exchanges `code` at `oauth2.googleapis.com/token`, `verifyOidcToken` on the
returned `id_token` (Google JWKS), fetches userinfo for name/avatar, calls
`upsertUser`.

`apple.js`: `response_mode=form_post` (callback is a POST route); builds the
Apple-required **ES256 `client_secret` JWT** at request time (`signEs256` with
`APPLE_KEY_ID`/`APPLE_PRIVATE_KEY`/`APPLE_TEAM_ID`, 180 s exp); verifies the
returned `id_token` against Apple's JWKS; first-authorization name arrives in
the `user` form field (JSON). Unconfigured providers render an explanatory
error page, never a crash.

## `src/lib/ownership.js`

| export | behavior |
|---|---|
| `ownedStore(req, res, storeId)` | loads the store, compares `owner_id` to `req.user.id`; 404 (not 403 — no existence leak) + `null` on mismatch |
| `ownedFloor(req, res, floorId)` | floor → store → same check; returns the floor row |
| `touchStore(storeId)` | bumps `stores.updated_at` **and fires `purgeStoreCache(storeId)`** — the single choke-point every public-data mutation already calls, so CDN purges are automatically correct |

## `src/lib/stock.js`

| export | behavior |
|---|---|
| `adjustStock(storeId, productId, delta, {reason, source})` | transaction: lazily `INSERT OR IGNORE` a level row at 0, `quantity += delta`, read back the new level, append a `stock_movements` row (delta, resulting qty, reason ≤200, source ≤40). Returns the level row; `null` if the product isn't in that store |
| `setStock(...)` | computes `target − current` and delegates to `adjustStock` (so **every** change, absolute or relative, produces exactly one movement row) |
| `stockForStore(storeId)` | levels LEFT-JOINed with products + categories (products with no level row included at `quantity NULL`) |
| `movementsForStore(storeId, limit=50)` | newest-first movement log, clamped 1..200 |
| `upsertProduct(storeId, input, {source})` | the integration/upsert core: match by `sku` → `barcode` → name-with-empty-sku; update fills only non-empty fields (`COALESCE(NULLIF(?,''))`), insert requires a name; optional `quantity` seeds (insert) or sets (existing) via the movement-logged paths. Returns `{product, created, level}` |
| `hashKey` / `generateApiKey` | keys are `skm_<48 hex>`; **only the SHA-256 is stored** with a 6-char display prefix |
| `storeForApiKey(rawKey)` | constant lookup by hash against non-revoked keys; stamps `last_used_at`; returns the store row |
| `keyFromRequest(req)` | `Authorization: Bearer …` or `X-API-Key` |

## `src/lib/storage.js` + `src/lib/r2.js` (Stage-0 media pipeline)

`r2.js` — zero-dependency S3 client for R2:
`sigv4Headers({method, key, body, contentType, now})` implements AWS SigV4
(canonical request → string-to-sign → HMAC chain, region `auto`) with
node:crypto; `r2Put(key, body, contentType)` and `r2Get(key)` (streamable
Response, `null` on 404). Exported purely for unit tests — the stable-signature
test in `test/r2.test.mjs` pins the canonical-request construction.

`storage.js`:
- `saveImage(buf, ext)` → `{name, url}`; UUID filename; **R2 mode** (when
  `config.r2`) PUTs `uploads/<name>` with the mime type; **disk mode** writes to
  `config.uploadsDir`. Same returned URL shape in both modes.
- `sendImage(res, name)` — name is regex-gauntleted (`[A-Za-z0-9._-]+`, no path
  tricks); sets `Cache-Control: public, max-age=31536000, immutable` (names are
  unique → bytes never change); serves **disk first** (legacy files keep
  working after an R2 switch) then R2; returns `false` for a 404.

## `src/lib/cdn.js`

`edgeCache(res, storeIds)` — sets `s-maxage=300, stale-while-revalidate=86400`
plus `Cache-Tag: store:<id>, …` on public responses (no-op without CF creds).
`purgeStoreCache(storeIds)` — fire-and-forget POST to Cloudflare's tag-purge
endpoint with 4 s timeout; errors logged, never thrown. Both no-ops locally.

## `src/lib/validate.js`

`str` / `num` — trims/bounds/coerces or returns `undefined` (routes treat
`undefined` as invalid). `validateElement(input)` — the server-side geometry
gate: type ∈ 7-element set; shape legal **for that type** (`TYPE_TO_SHAPE`);
geometry accepted as object or JSON string; rect needs finite `x,y,w,h > 0`
and normalizes `rot` into `[0,360)`; point needs finite `x,y`; polys are
2..200 `[x,y]` pairs rounded to 3 decimals; `color` must be `#rrggbb` else
`''`; `meta` object serialized ≤ 2000 chars; `z_index` truncated int. Returns
the normalized DB row shape or `null` (route → 400).
`requireFields(res, body, fields)` — presence check that already sent the 400.

## Route files

**`routes/stores.js`** — `GET /mine`, `POST /` (slug from `slugify` + unique
suffix), `PATCH /:id` (name/address/hours/phone/website/description/logo/
`is_public`; **slug intentionally immutable** so public links never break),
`DELETE /:id` (cascades), `GET /:id/full` (floors + elements + categories +
products + locations — the editor's single boot payload). Every mutation calls
`touchStore` → CDN purge.

**`routes/floors.js`** — floor create/patch (name, `width_m`/`height_m` 1..500,
level, background URL)/delete (never the last floor; cascades elements +
pins). `PUT /:id/elements` — the autosave endpoint: array ≤ 2000, every entry
through `validateElement`, ids deduped (unknown ids regenerated), then a single
transaction `DELETE FROM map_elements WHERE floor_id=?` + re-INSERT
(bulk-replace semantics: the client always sends the floor's complete element
list). After commit: `touchStore` (purge) and `maybeSnapshot(floorId, rows)`
— snapshots at most one row per floor per 60 s (RPO for *user-recoverable*
history), pruned beyond 20/floor. `GET /:id/snapshots` (list) and
`GET /:id/snapshots/:snapId` (full element JSON) power the History tab;
restore is client-side (GET snapshot → PUT elements).

**`routes/catalog.js`** — the catch-all authenticated router: categories
CRUD; products CRUD (`PATCH` fills only provided fields); pins
`POST /products/:id/locations` (**upsert per (product, floor)** — moving a pin
is the same call as placing it) and `DELETE /locations/:id`. All nested paths
walk ownership through their parent row.

**`routes/public.js`** — no auth. `GET /stores?q=` directory (LIKE across
name/address/description, public only, ≤ 30). `GET /stores/:slug` →
`publicStorePayload` (store minus owner fields; floors; elements; categories;
products with category color; pin coordinates) with `edgeCache(res, store.id)`.
`GET /stores/:slug/search?q=` — case-insensitive LIKE across
name/brand/sku/barcode, returns rows with floor + x/y for immediate map focus.

**`routes/uploads.js`** — raw-body POST; content-type must be png/jpeg/webp
(whitelist map with per-type **magic-byte check** — the declared type is never
trusted); 10 MB cap; `saveImage` (R2 or disk); rate-limited 20/min.

**`routes/stock.js`** — owner stock dashboard (`GET …/stock` levels+movers,
`POST …/stock/adjust|set` → movement-logged core), API-key lifecycle
(`GET/POST …/keys` — the raw key is returned exactly once at creation —
`DELETE /stores/keys/:keyId` revoke).

**`routes/integrations.js`** — `GET …/integrations` (provider metadata +
connections), `POST` connect (credentials JSON stored per connection),
`DELETE` disconnect, `POST …/:id/sync` → adapter `fetchProducts` →
`upsertProduct` loop with error capture into `last_error`, `POST
…/integrations/csv` (same interchange shape), `GET …/catalog.csv` export —
the CSV format round-trips losslessly (tested).

**`routes/v1.js` (StockTrack v1)** — key-auth surface for third parties:
`requireApiKey` middleware (401 + `WWW-Authenticate` on bad key), 300 req/min
limiter, then `GET /store|products|stock` (`include_products=1` for joined
rows), `POST /products` upsert, `POST /stock/adjust|set`,
`GET /map` (store + floors + elements + pins for offline/navigation clients).

**`routes/auth.js`** — provider entry/callback/dev-login/logout/me wiring for
the two OIDC modules above; `dev-login` exists only when enabled and issues a
real session for any email.

## `src/lib/stocksoft/`

`index.js` — `PROVIDERS` registry: each provider declares `{name, blurb,
fields[]}` (drives the connect-form UI generically) and
`fetchProducts(creds, fetchImpl)` returning the normalized `{sku, barcode,
name, brand, price, quantity}[]`. Adapters: **Square** (catalog list w/ cursor
pagination + inventory counts endpoint), **Shopify** (Admin API products +
variants w/ `X-Shopify-Access-Token`), **Lightspeed X-Series/Vend**, **Clover**,
**Katana MRP**, **Zoho Inventory**, **ERPNext**, **StockTrack** (another
StoreMap's v1 endpoint — the API eats its own dogfood), **CSV** (parse + row
map). `fetchImpl` injection is what makes adapter tests hermetic.
`csv.js` — a small RFC-4180-ish parser (quoted fields, embedded commas/newlines)
+ header mapping to the common shape.

## `scripts/seed-demo.mjs`

Idempotent demo builder for `freshmart-downtown` (details in ARCHITECTURE §11):
54×36 m floor, 3.2 m walls, checkout zone + 4 counters, border shelving
0.15 m off walls, 4 aisle pairs (facing rows 1.5 m apart, two 19 m segments
each), ~150 products across 8 categories pinned to explicit stocking-face
lines. `--reset` wipes and rebuilds; otherwise skips if ≥6 shelves at the
right floor size.

## Tests (`test/*.mjs`, `node:test`, real app + throwaway SQLite)

`api.test.mjs` (39+) — auth/session, ownership isolation between users, store/
floor/element CRUD + bulk replace validation, public-only visibility,
**snapshot throttle + restore round-trip** (back-dates a row to cross the 60 s
window), **OG meta injection** (pre/post publish + unknown slug). `stock.test.mjs`
— adjust/set math, movement log, invalid input, foreign product rejection,
API-key create/auth/revoke. `integrations.test.mjs` — adapter normalization
against injected fake fetches, sync upserts, CSV round-trip.
`validate.test.mjs` — geometry validator units (rotation wrap, bad payloads,
JSON-string geometry). `smoke.mjs` — boots the real server: health, SPA shell,
login, store → elements → pin → public search → shopper page over HTTP.
`r2.test.mjs` — SigV4 signer determinism/shape (snapshot-pinned signature).

---

# Part II — Frontend

## `src/main.tsx` → `src/App.tsx`

`main.tsx` mounts `<App/>` in a `BrowserRouter`. `App.tsx`:
- `AuthContext` (`useAuth()`): `{user, providers, loading, refresh}` from
  `GET /api/auth/me`, refreshed after login/logout.
- Routes: `/` Landing · `/login` · `/dashboard` · `/dashboard/stores/:storeId`
  (editor) · `…/stock` · `/s/:slug` viewer. The **top nav is not rendered on
  `/s/:slug`** (full-bleed shopper mode). `NotFound` is the "off the map 🧭"
  empty state.
- `TopNav` — brand, My stores, avatar, sign out.

## `src/api.ts`

Single `request()` wrapper: fetch with `credentials: 'same-origin'`,
`Content-Type: application/json`, JSON parse, and a thrown `Error` carrying the
server's `error` message on non-2xx (so components can surface text directly).
Methods mirror the REST surface 1:1 (`publicStores`, `publicStore`,
`myStores`, `storeFull`, floor/element saves incl. `floorSnapshots`/
`floorSnapshot`, catalog, pins, stock, keys, integrations, `devLogin`…).
`uploadImage` is a separate raw-bytes fetch. Basenames mirror route paths —
finding the server code for any call is a grep away.

## `src/types.ts`

Row interfaces mirroring DB columns; geometry JSON parsed via
`parseElement(row) → MapElement` (adds typed `geom`), inverse `elementToRow`;
shape guards `isRect/isPoint/isPoly`, `rectGeom()`.

## `src/lib/geometry.ts`

2D math core (all pure, all tested):
`screenToWorld`/`worldToScreen`/`fitViewport` (fit-to-container with padding);
`snap/snapPt`; `rectCorners` (rotated corners CW from top-left);
`elementPoints`; `bboxOf`; `elementContains` — exact hit-testing: points by
radius, rects by inverse-rotation + AABB (plus edge tolerance), polygons by
ray-cast + edge distance, polylines by segment distance;
`translateElement`; `resizeRect` — 8-handle resize computed in the rect's
local frame (rotation-safe, min size 0.3 m); `rotateRectTo`; and
**`shelfAnchor(p, elements)`** → `{x, y, nx, ny}`: nearest point on the nearest
shelf outline plus the **outward edge normal** — the shared primitive that
puts item dots on shelf lines in 2D, on wall faces in 3D, and orients stocking
blocks.

## `src/lib/mapColors.ts`

`TYPE_COLOR`/`TYPE_STROKE` palettes shared by both renderers (one source of
truth) + `shade(hex, amt)` lighten/darken.

## `src/lib/navgrid.ts`

The wayfinder: `buildNavGrid(floor, elements)` — 0.25 m cells over the padded
floor; blocked = off-slab or within 0.3 m clearance of a wall/shelf (exact for
rotated rects via `elementContains`); `nearestOpen` (spiral rescue for pins
inside fixtures, ≤ 6 m); `astar` — 8-directional, octile heuristic, binary
min-heap over packed indices, **no corner cutting** (diagonal needs both
orthogonal neighbors open), endpoints pinned to the exact request points;
`simplifyPath` — greedy string-pulling through `lineOfSight`;
`computeRoute` — assembly clamping the goal into the floor, returns
`{points, distanceM, start, goal}` or null (sealed room);
`pickStartPoint` — nearest entrance ▸ exit ▸ bottom-edge midpoint;
`WALK_M_PER_MIN = 80`.

## `src/lib/render3d.ts`

The Canvas2D 3D engine (ARCHITECTURE §8 covers the concepts):
- **Camera/projection**: `toCamera` (world→camera space; eye at
  `cameraEye(cam)`), `project` (null inside `NEAR = 0.25 m`),
  `clipPolygonNear` (Sutherland–Hodgman vs the near plane — geometry straddling
  the camera renders its visible part, never disappears),
  `camFromEyeLook` (eye/look-at → orbit camera; the flight system's bridge),
  `pathSampler` (arc-length interpolation + straight extension past ends).
- **Meshes**: `boxFaces` (extrude + flat-shade by `|n·L|`), `subdivideFaces`
  (≤ 4 m tiles; horizontal solid faces get 0.6 m depth rows),
  `buildSceneFaces` (floor slab, 1 m grid lines at layer 0.25, decals at 0.5,
  solids at layer 2, walls 3.2 m / shelves 1.5 m), `stockFaces` (product
  facing blocks on shelf-wall anchors — never camera-culled),
  `routeFaces` (0.45 m ribbon at z 0.07 + corner joint patches, layer 1).
- **Ordering**: `buildFaceBSP`/`traverseFaceBSP`/`buildSceneBSP` — per-layer
  axis-aligned BSP; the splitter is each node's largest face's own plane
  (thinnest axis); straddling faces are split; traversal from the eye is an
  exact back-to-front order at any angle.
- **`renderScene`**: project+clip all faces (or walk the cached BSP), backdrop
  gradient, stroke/fill in order, then the overlay pass — marker billboards,
  product pin dots (on-wall or pole fallback), labels (depth-scaled, identical
  text within 140 px deduped) — returning `PinHit[]` for tap targeting.

## `src/lib/shelfLayout.ts`

The planogram engine (pure): `worldToShelfLocal` (inverse-rotate a pin into the
shelf rect's frame), `pinInShelf` (tolerance 0.35 m), `computeShelfLayout` —
bays = meta.bays or `width/1.25`; levels = meta.levels or 3; each inside pin's
local x → `u` (0..1) and bay index, local y → level (deep shelves map depth to
levels, shallow are single-level; `meta.shelf_level` on the pin wins);
`facingWidth` from meta (default 0.32). Output `{bays[{from,to,slots}],
outside[]}` drives ShelfDetail so the planogram is exactly the map's truth.
`shelfBounds` — bbox for click targets.

## Components

**`ViewerPage.tsx`** — the shopper surface (ARCHITECTURE §9): full-bleed map +
floating bar (store pill, ✈ Fly, ✎ Edit, search, 2D/3D). Owns the 3D camera
(`cam3d`, so toggling views never resets the angle; selecting a new item resets
to `fitCamera`), the route (`computeRoute` on selection; badge with m + minutes),
`flySeq` (flight only via the ✈ button), pin visibility (none until searched;
only the selected item after), document title, and 2D/3D persistence in
localStorage. Dropdown: keyboard nav (↑/↓/Enter/Esc), `<mark>` match
highlighting, click-outside close.

**`MapCanvas.tsx`** — the 2D SVG engine + all editor interactions
(ARCHITECTURE §6): viewport transforms, pinch/wheel zoom, the interaction state
machine (`pan | move | resize | rotate | draw-rect | move-pin`), grid snapping,
keyboard shortcuts (`R` rotate, Delete, **arrows nudge** by grid, Shift = 1 m),
draft previews for poly tools, the **pick filter** (`products` mode: clicks
grab the nearest pin — never fixtures; click selects + flashes the Products
row, drag moves and upserts on release), `ProductPin` rendering anchored to
`shelfAnchor` (dot on the shelf line), route overlay polylines.
`setPointerCapture` is guarded (synthetic-pointer safety).

**`Map3D.tsx`** — Canvas host (ARCHITECTURE §8.11): owns size/DPR, cached
`buildSceneFaces` + `buildSceneBSP` (rebuilt only on data change), the flight
system (approach 750 ms → walk `pathSampler` at EYE_Z 8 m / EYE_BACK 4 m /
look-ahead 4 m, clamped 3–9 s → arrival pull-back at the same `FLIGHT_PITCH`
≈ 45°; skip pill; any gesture cancels), pointer orbit/pinch/tap-to-pin via
`PinHit`s, camera passed in from the parent.

**`ShelfDetail.tsx`** — planogram modal from `computeShelfLayout`: bays as
columns, levels as rows, product facings positioned by `u`/`level`, "outside"
pins listed below; picking a facing routes the viewer to that product.

**`EditorPage.tsx`** — the owner workspace (ARCHITECTURE §10): top bar (floors
tabs + add, undo/redo — per-floor snapshot stacks, ⧉ Duplicate, ⤢ Fit,
SaveBadge: saved/dirty-pulse/saving/error+retry), side tabs **Map** (element
props: type/label/colour, **Position** section with nudge pad + X/Y fields,
shelf bays/levels + preview) / **Products** (filter, CRUD, categories,
📍 place-pin mode, flash-highlight from map pin selection) / **Store** (profile)
/ **History** (autosave changelog — snapshot list with element counts + relative
time, one-click restore as an undoable `push`), tool palette (grouped:
draw/mark/points) with the pick filter, autosave debounce → `PUT /elements`.

**`Dashboard.tsx`** — store cards: per-store accent header (hash-stable color
gradient + logo/initial + Live/Draft pill), publish toggle, copy/QR, action row
(✎ Edit / 📦 / ↗ / 🗑 with confirm), CreateStore modal, QrModal (print-ready).

**`StockPage.tsx`** — three sections: stock table (quantity vs reorder point,
low-stock counter, adjust/set modals, movement log), StockTrack API keys
(create-once display, revoke), integrations (provider cards from
`PROVIDERS` metadata → connect modal rendered generically from `fields`, sync
now with per-connection error surfaced, CSV import/export).

**`Landing.tsx`** — hero with the **live 3D demo** (`HeroMap`: fetches the
public demo payload, auto-orbits the real Map3D at ~7°/s, pointer-events
disabled, honors `prefers-reduced-motion`, silent fallback when unseeded) +
steps + directory search/grid.

**`Login.tsx`** — provider buttons (disabled state when unconfigured), local
demo form when enabled, honors `?next=` for post-login deep links.
**`ui.tsx`** — `Field`, `Modal`, provider logo SVGs.

## Styles (`src/styles.css`)

CSS custom properties (`--green`, `--ink`, …) as the design system; component
classes documented inline; notable systems: `.viewer-*` full-bleed layout with
mobile re-flow orders, `.tool-palette` groups, `.store-card` accent headers,
`.route-*` overlay lines (`vectorEffect` non-scaling), `.snapshot-item`
changelog, `:focus-visible` + `prefers-reduced-motion` global guards.

---

## Cross-cutting invariants (the short list)

1. **Meters everywhere** — DB, API, both renderers, wayfinder, planogram.
2. **Geometry is validated at the boundary** — `validateElement` is the only
   way a row reaches `map_elements`.
3. **Ownership walks the parent chain** — no id-guessing reaches data.
4. **`touchStore` = "public data changed"** — updated_at + CDN purge together.
5. **Media URLs are permanent** — UUID names, immutable cache, disk-then-R2.
6. **Movement-logged stock** — every quantity change writes exactly one
   `stock_movements` row.
7. **One writer, batched** — elements autosave is bulk-replace in one
   transaction; snapshots are throttled (60 s) and capped (20).
8. **Render on demand** — no frame loops; the only continuous animation
   (landing hero) stops for hidden tabs and reduced-motion users.
