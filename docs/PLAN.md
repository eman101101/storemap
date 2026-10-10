# StoreMap — In-Store Product Mapping Web App

> **Deep dive:** for implementation-level detail (camera math, clipping, painter's
> algorithm, wayfinder internals, API shapes, seed layout), read
> [ARCHITECTURE.md](ARCHITECTURE.md). For hosting at scale (100K maps, backups,
> employee roles, warehouses, offline maps), read [INFRASTRUCTURE.md](INFRASTRUCTURE.md).
> This file records the original design plan.

A web application where **shoppers find products inside a store** on an interactive,
top-down 2D map, and **store owners create and edit those maps** with a built-in,
easy-to-use mapping editor. Works on any device (desktop, tablet, phone).

---

## 1. Product requirements → design mapping

| Requirement | How it is satisfied |
|---|---|
| Shoppers find products from a top-down 2D perspective | Public, no-login viewer page per store (`/s/:slug`). SVG-based map viewport with pan/zoom, drawn to scale in store coordinate units (meters). Product search & category browse place a highlighted marker on the exact shelf location, plus entrance/exit markers. |
| Stores create & edit maps with ease | Built-in browser map editor: draw walls, shelves, aisles, zones, POIs as rectangles/polygons/lines/points on a grid with snapping; drag, resize, rotate; undo/redo; optional uploaded floor-plan image as a tracing underlay; autosave. |
| Available to view on any device | Responsive single-page app; viewer is touch-friendly (pinch-zoom, one-finger pan), served from one origin, no app install. |
| Built-in mapping system | The editor + shared SVG map renderer (view model → screen transform, selection, snapping) are first-party code, no third-party mapping service needed. |
| Google & Apple auth for store owners | OAuth 2.0 / OpenID Connect authorization-code flows implemented first-party in the backend: Google (`accounts.google.com`) and Apple (`appleid.apple.com`, `response_mode=form_post`, ES256 client-secret JWT). Session = signed, httpOnly cookie. |
| Ready to be put online | Single deployable service (API + static frontend), health endpoint, Dockerfile + docker-compose, `.env.example`, setup guide for OAuth credentials, DB migrations, rate limiting and security headers. |

## 2. Architecture

```
┌────────────────────────────┐        ┌────────────────────────────────┐
│  Browser (any device)      │        │  Node.js service               │
│  React SPA (Vite build)    │──API──▶│  Express                        │
│  - Landing / Login         │ static │  ├─ Auth: Google + Apple OIDC  │
│  - Dashboard / Editor      │        │  ├─ REST API (JSON)            │
│  - Shopper viewer /s/:slug │        │  ├─ Static file server (SPA)   │
└────────────────────────────┘        │  └─ node:sqlite (SQLite file)  │
                                      │      data/storemap.db          │
                                      │      data/uploads/ (images)    │
                                      └────────────────────────────────┘
```

- **One process, one origin** — the backend serves the built SPA, so cookies are first-party
  and deployment is a single container.
- **SQLite** via Node's built-in `node:sqlite` (zero native deps). WAL mode, foreign keys on.
- **Frontend**: React 19 + TypeScript + Vite + React Router. Map rendering in pure SVG
  (crisp at any zoom, trivially touch-friendly, no canvas/DPI headaches).

## 3. Data model

```
users(id PK, email UNIQUE, name, avatar_url, provider 'google'|'apple', provider_sub, created_at)

stores(id PK, owner_id → users, name, slug UNIQUE, address, description,
       phone, website, hours, logo_url, is_public 0|1, created_at, updated_at)

floors(id PK, store_id → stores ON DELETE CASCADE, name, level INT,
       width_m REAL, height_m REAL, background_url, created_at)

map_elements(id PK, floor_id → floors ON DELETE CASCADE,
       type 'wall'|'shelf'|'aisle'|'zone'|'entrance'|'exit'|'poi',
       shape 'rect'|'polygon'|'polyline'|'point',
       geometry TEXT(JSON),  -- rect {x,y,w,h,rot} | polygon/line [[x,y]..] | point [x,y]
       label, color, meta TEXT(JSON), z_index INT)

categories(id PK, store_id → stores ON DELETE CASCADE, name, color, icon)

products(id PK, store_id → stores ON DELETE CASCADE, category_id → categories SET NULL,
       name, brand, sku, barcode, description, price, image_url, created_at, updated_at)

product_locations(id PK, product_id → products ON DELETE CASCADE,
       floor_id → floors ON DELETE CASCADE,
       x REAL, y REAL, rot REAL, meta TEXT(JSON))  -- position in floor meters

migrations(id INTEGER PRIMARY KEY, name UNIQUE, applied_at)  -- applied-script ledger
```

Geometry is stored in **meters** (1 unit = 1 m) so a store maps cleanly to the real world;
the renderer scales to fit any screen. Points: `{x, y}` with origin at top-left, y-down
(screen convention, top-down view).

## 4. REST API

All JSON under `/api`. Auth = `sid` httpOnly SameSite=Lax signed cookie (HMAC JWT, 30 days).

### Auth
| Method & path | Description |
|---|---|
| `GET /api/auth/google` | 302 → Google consent screen (state cookie) |
| `GET /api/auth/google/callback` | Code exchange, id_token verify, upsert user, session cookie, 302 → app |
| `GET /api/auth/apple` | 302 → Apple sign-in (`response_mode=form_post`) |
| `POST /api/auth/apple/callback` | Apple form_post; verifies id_token against Apple JWKS, session cookie |
| `POST /api/auth/dev-login` | **Only when `ENABLE_DEV_LOGIN=true`** — issues a session for local/demo use without external credentials |
| `GET /api/auth/me` | Current user or `{user:null}` |
| `POST /api/auth/logout` | Clears session |

### Stores (owner-scoped, `requireAuth`)
- `GET /api/stores/mine` · `POST /api/stores` · `PATCH /api/stores/:id` · `DELETE /api/stores/:id`
- `GET /api/stores/:id/full` — everything the editor needs (floors + elements + categories + products + locations)

### Public (no auth)
- `GET /api/public/stores?q=` — store directory search (public stores only)
- `GET /api/public/stores/:slug` — public store detail incl. floors, elements, categories, products, locations
- `GET /api/public/stores/:slug/search?q=` — product search with floor + x/y positions

### Building blocks (owner-scoped, ownership-checked)
- `POST /api/stores/:id/floors` · `PATCH /api/floors/:id` · `DELETE /api/floors/:id`
- `PUT /api/floors/:id/elements` — **bulk replace** of a floor's elements (one autosave = one transaction)
- `POST /api/stores/:id/categories` · `PATCH /api/categories/:id` · `DELETE /api/categories/:id`
- `POST /api/stores/:id/products` · `PATCH /api/products/:id` · `DELETE /api/products/:id`
- `POST /api/products/:id/locations` · `DELETE /api/locations/:id`
- `POST /api/uploads` — floor-plan / logo image upload (png/jpg/webp ≤ 10 MB), stored under `data/uploads/`, served at `/uploads/*`
- `GET /api/health`

**Security:** ownership checks on every nested resource; parameterized SQL everywhere;
JWT-verified OAuth id_tokens (issuer/audience/nonce/expiry); `state` cookie anti-CSRF for
OAuth; session cookie httpOnly + SameSite=Lax + Secure in production; Helmet-style headers
set manually (no dep): CSP, X-Content-Type-Options, Referrer-Policy, frame-ancestors;
body size limits; upload MIME + size validation; login route rate-limited.

## 5. OAuth details

**Google** — standard authorization-code flow:
`https://accounts.google.com/o/oauth2/v2/auth?client_id&redirect_uri&response_type=code&scope=openid email profile&state&nonce`
→ exchange at `https://oauth2.googleapis.com/token` → verify `id_token` (iss, aud, exp, nonce)
→ `GET https://www.googleapis.com/oauth2/v3/userinfo` for name/avatar.

**Apple** — authorization-code flow with `response_mode=form_post` (Apple POSTs the code):
- Start: `https://appleid.apple.com/auth/authorize?response_type=code&response_mode=form_post&scope=name email&...`
- Apple requires a **client_secret JWT** signed **ES256** with the owner's *Sign in with Apple* key:
  built at request time from `APPLE_KEY_ID` + `APPLE_PRIVATE_KEY` (PEM, env var) and `APPLE_TEAM_ID`.
- Callback: verify `id_token` against Apple's **JWKS** (`https://appleid.apple.com/auth/keys`),
  checking iss/aud/exp/nonce. Name is only sent on first authorization (in `user` form field).

All secrets come from env vars — none are hard-coded. Providers without configured
credentials return a clear error page. `ENABLE_DEV_LOGIN=true` provides a local/demo
login that mirrors the real session issuance, so the app is fully testable before
OAuth apps are registered.

## 6. Map editor (the built-in mapping system)

Layered interaction model on one SVG:
1. **Viewport**: wheel = zoom to cursor, drag empty space = pan, pinch on touch.
   Fit-to-screen on load; meters↔screen transform isolated in `lib/geometry.ts`.
2. **Tools**: select · rect · polygon · line (aisle) · point (POI/entrance) · place product.
   Grid (0.5 m) + snap-to-shelf; R key rotates selected rect 90°; Delete removes.
3. **Selection**: click selects; drag moves; 8 handles resize rects; rotation handle rotates.
4. **Element panel**: type, label, color; shelf elements are valid pin targets.
5. **Product placement**: pick a product → click its spot on a shelf → location pin saved.
6. **History**: undo/redo stack of element-array snapshots; debounced autosave
   (`PUT /floors/:id/elements`) with save-state indicator.
7. **Tracing underlay**: upload a floor-plan image, set its real-world size, draw over it, hide it when done.

## 7. Shopper viewer

- **Full-bleed experience**: the viewer route drops the site chrome; the map fills the
  viewport (`100dvh`) with floating overlays only — store pill (top-left), search box
  (top-center, results in a dropdown), 2D/3D toggle (top-right), route badge, floor
  tabs (multi-floor stores), and a powered-by link. The store opens in 3D by default.
- **Search**: typing filters products (name/brand/SKU, case-insensitive, server-side LIKE);
  picking a result (or tapping a pin on the map) selects the item everywhere. The map
  preview shows no item markers until the shopper searches — matches appear while
  searching, and only the selected item's marker remains afterwards. Selecting a new
  item also resets the 3D camera to the store's original angle.
- **Item markers on the fixture**: a pin anchors to the nearest shelf outline point
  (`shelfAnchor` in `lib/geometry.ts`) — the wall the product is stocked against. 2D
  draws the dot on that outline line; 3D draws it on the shelf's wall face (z ≈ 1 m).
  Pins farther than 1.4 m from any shelf fall back to a free-standing pole marker.
- **Wayfinding**: selection computes the walking route from the entrance
  (fallback: exit, then front-edge midpoint) to the product. `lib/navgrid.ts` rasterizes
  the floor into a 0.25 m walkability grid — shelves and walls (inflated by a 0.3 m
  shopper-clearance buffer) block cells; zones/aisles/markers stay walkable — then runs
  8-directional A* (no corner cutting, octile heuristic) and string-pulling smoothing.
  Goals inside a fixture snap to the nearest open cell, so pins on shelves still route.
  The route is drawn as an orange ribbon in 2D and 3D with a distance + walk-time badge.
- **3D fly-through (on demand)**: selecting an item shows the route immediately; the
  **✈ Fly the route** button in the top bar (next to the store pill) starts the flight —
  the camera glides to the route start, then follows the path from overhead (8 m up,
  trailing 4 m behind, looking down at the path itself, ~9 m/s, 3–9 s) and stops above
  the item at the SAME angle, pulled back (dist ≈ span/2) so whole fixtures stay in
  frame — one constant pitch for the entire flight. `camFromEyeLook` converts the
  eye/look-at pair into the orbit-camera model each frame; `pathSampler` provides
  arc-length interpolation with straight extensions past the ends. A "Skip flight" pill
  jumps to the arrival framing; any drag/wheel cancels into manual orbit. Entrance/exit/POI
  markers render as billboards so they stay readable from any angle. The camera state is
  owned by ViewerPage, so toggling 2D↔3D never resets the user's angle, and item pins use
  2.1 m poles so they stand on top of the 1.5 m shelves in 3D.
- **3D engine**: `Map3D` is a hand-rolled Canvas-2D renderer (`lib/render3d.ts`):
  perspective projection, painter's algorithm over layered faces (floor/grid →
  route → extruded solids → labels/pins). Faces straddling the camera are clipped
  against the near plane (`clipPolygonNear`) so close-up geometry never disappears.
  Every pinned product draws a colored stocking block on its shelf face
  (`stockFaces`, backface-culled against the camera) so fixtures look stocked.
  Shelves extrude to 1.5 m, walls to 3.2 m (tall enough that border shelving stays behind the wall silhouette from every camera angle).
  No WebGL or third-party 3D library — a few KB, re-renders on demand (no continuous
  frame loop), smooth on low-end and older browsers.
- Touch: one-finger pan, pinch zoom, tap to select. Fully responsive (phone → desktop).
- Public link `/s/:slug` + QR code on the owner dashboard (front-of-door signage ready).

## 8. Testing & acceptance

- `backend/test/api.test.mjs` (Node built-in test runner, in-memory DB):
  auth/session, ownership enforcement, store/floor/element/product CRUD, bulk element save,
  public endpoints not leaking non-public stores, search correctness.
- `npm run build` must produce a clean frontend bundle; `npm run smoke` boots the real
  server and exercises landing → API → public store page over HTTP.
- Editor/viewer exercised end-to-end in a real browser session before delivery.

## 9. Deployment

- `Dockerfile` (multi-stage: build SPA → run Node service) + `docker-compose.yml`
  (volume for SQLite DB + uploads, env passthrough).
- `.env.example` documents every variable. `README.md` has step-by-step Google/Apple
  OAuth setup (console links, redirect URIs, Apple key creation) and deploy instructions
  for any Node host / container platform. TLS terminates at the platform; secure-cookie
  mode flips automatically via `NODE_ENV=production` / `TRUST_PROXY`.
