# Plan: titled group pins (items pinless) + Walmart Example map

## Context
The app is mid-transition to a "groups" model: a group = a shelf element (label = group title), and product locations are facings. The demo seed already writes the target shape — one `groupPin` location per group (`meta.groupPin:1`, `pinW` = group length) plus `groupOnly:1` item facings (`worker/src/seed.ts:985-1001`) — but the editor/API can't produce it and renderers only partially honor it. You asked to: (1) make "Add item group" create a **titled group that is one pin on the map**, with items living only inside it (**no item pins**), (2) delete all other example maps while **keeping the photos**, and (3) build a new example map from the Walmart-style screenshot where every department's shelves are titled groups. Decisions: name **Walmart Example** (slug `walmart-example`); shelves with groups in **all departments** (non-food items render as diagram tiles — no photos).

## 1. Model change — one titled pin per group, items pinless

**API/meta layer** (single choke point per engine):
- `worker/src/routes/catalog.ts` — extend `pinMetaJson` (~:355) with `groupOnly` / `groupPin` flags; the location POST/PUT handler reads them from the body (both its INSERT and relocate UPDATE write meta via this one function).
- `backend/src/routes/catalog.js` — mirror the same fields (its docstring requires engine parity).
- `frontend/src/api.ts:173` + `frontend/src/localStore.ts:250` — extend the `setProductLocation` body type; localStore merges flags into existing meta (keeping planogram meta intact).

**Editor** (`frontend/src/components/EditorPage.tsx`):
- `createGroupOnShelf` (~:916-1021): stamp each item facing `groupOnly:1`; then create exactly one group pin for the shelf — first item's product at the shelf anchor, `groupPin:1`, `pinW` = plan width (3 m), `pinH` 0.3, `shelf_level` 2 (same shape as the seed). Keep the existing `planWidth:3` + shelf-label rename writes.
- New `ensureGroupPin(shelf)` helper; call it from `addExistingToShelf` (~:1105), `addFacingCopy` (~:1193), single-item `placeProduct` (~:884) and ProductModal autoplace — all of which also stamp new facings `groupOnly:1`.
- Product-delete path: if the deleted product owns a group pin, promote another facing on that shelf to `groupPin` first (keeps 1 pin per group).
- Retire the "Show items" escape hatch (toggle ~:1619-1622, `showItems` default ~:345): groups view is the only view — items never have pins. Focused/selected pins still overlay during search/selection.

**Renderers**:
- `MapCanvas.tsx`: groups view renders **all groupPin locations** (∪ focused/selected) instead of only focused (`groupsPins` ~:741); `strips` (~:747) skips `groupPin` ids so nothing double-draws; `ProductPin` (~:1308) draws the owning shelf's `label` as a permanent title above group pins (not only when focused). Viewer pin click opens the owning shelf's planogram popup.
- `Map3D.tsx`: hit targets/labels only for groupPin ∪ focused pins (~:477); stocking squares keep using ALL facings (shelves stay stocked-looking).
- `ViewerPage.tsx`: search results resolve each matched product to its shelf's group pin (`pins` memo ~:214, dedupe per shelf); `focusResult` redirect (~:356) targets the shelf's groupPin instead of "closest non-groupOnly"; the facing id stays as `focusPinLocationId` for the ShelfDetail highlight; "N on the map" counts pins not facings.

## 2. Delete all other example maps — photos kept

- `worker/src/seed.ts` `seedDemoMaps` (~:1016): add `deleteDemoStore(env, slug)` for `freshmart-downtown`, `annex-market`, `harbor-warehouse`, `megamart-central`, `maple-corner`, `grand-mart`, remove their builder calls, seed only the new Walmart Example spec. Wrangler dev auto-reloads on save; the boot seeder (`migrate.ts:416`) then cascades the deletions out of the live local D1 — no manual SQL.
- **Photos are already decoupled from the DB and will not be touched** (locations reported to you at the end):
  - `frontend/public/demo-products/` — the 99 demo product photos (real JPGs + `gen/*.svg` packshots), served as static assets at `/demo-products/…`, mapped by `backend/scripts/demo-photos.json`. The new map reuses this pool.
  - `backend/data/uploads/` — 14 user-uploaded PNGs (Express engine).
- `backend/scripts/seed-demo.mjs` — mirror: retire the same six slugs, seed only Walmart Example (repo keeps both engine seeds in lockstep, as the uncommitted diff already does). Optionally run `node scripts/seed-demo.mjs --reset` to rebuild the backend SQLite to match.

## 3. New example map: Walmart Example (slug `walmart-example`)

- New spec in `worker/src/seed.ts` built on the existing generic `seedExample(env, spec, …)` seeder (spec.elements/categories/products/locations; locations carry `groupPin`/`groupOnly`/`pinW`/`pinH`; model on `warehouseSpec()` ~:624-733 at larger scale).
- Layout ≈ 96×62 m per the screenshot: outer walls; two bottom entrances; Garden Center (right edge); Restrooms (top-right + services strip).
  - **Right grocery wing** (green block): wall shelving/counter groups — Fresh Produce, Bakery, Frozen, Meat, Dairy, Deli & Cheese, Adult Beverages, Snacks, Candy, Grocery — items reuse the demo photo pool (photos on group-pin products so planograms look good).
  - **Center**: double-sided gondola pairs on a pitch (grand-mart pattern) with themed groups (Cereal & Breakfast, Pasta & Sauce, Baking, Coffee & Tea, Canned & Jarred, Chips, Cookies, Drinks, …).
  - **All other departments**: labeled zones with a few shelves each, one titled group per shelf, items as photo-less diagram tiles — Sports & Outdoors, Toys & Games, Electronics, Home Office, Paper & Cleaning, Pet Care, Auto Care Center, Auto Accessories, Books, Arts & Crafts, Celebrate, Seasonal, Home & Furniture, Kitchen & Dining, Boys, Girls, Baby, Shoes, Ladies', Mens, Tools & Hardware, Outdoor, Personal Care & Beauty, Pharmacy, Clearance.
  - **Front strip**: Checkout zone + Vision Center / Customer Center / Hair Salon / Tenant POIs.
  - Every shelf: `label` = group title, `meta.department` = area name (drives department badges via the `shelfDepartments` fast path).
- Homepage wiring: `frontend/src/components/Landing.tsx` `EXAMPLES` → single entry `walmart-example` (drives hero carousel + planogram band); `frontend/src/App.tsx` NotFound demo link → `/s/walmart-example`.

## Verification
1. `cd frontend && npm test` — update tests that assumed item pins render (MapCanvas/ShelfDetail/EditorPage suites).
2. `cd backend && npm test` (+ worker test script if present) — cover the new meta fields.
3. Live: wrangler reloads → boot log `seeded Walmart Example`; browser: homepage hero/planogram band show it; `/s/walmart-example` search routes to a titled group pin with the item highlighted inside the planogram; tap the pin/shelf → planogram; `/try/walmart-example` → "Add item group" yields ONE titled pin, zero item pins.
4. `cd e2e && npm test` (creates its own store — should stay green).

Key reused utilities: `seedExample` spec seeder, `deleteDemoStore`, `demo-photos.json` pool, `shelfContaining`/`shelfAnchor`, `ensureGroupPin` (new, tiny), `pinMetaJson` (extended).
