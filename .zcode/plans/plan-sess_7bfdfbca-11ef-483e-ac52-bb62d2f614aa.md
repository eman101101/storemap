## Context

The editor's add-item flow should model how real stores are stocked: the 📍 "Add item" tool becomes an **"Add item group"** tool — clicking a shelf opens a creator where you **name the group** and **add items within it** (each item with its own category); on confirm the items are created and their facings fill the shelf so the planogram looks stocked like a real grocery store. A toggle offers single-item placement. The hover feedback becomes a **ghost preview** of where the group/items will land (today it's a dashed green outline around the whole shelf — `MapCanvas.tsx:888-904`). The auto-create-a-shelf-on-empty-click logic is removed — items don't need a shelf. Plus **two new seeded example maps** (Corner Store + Grocers) where every item has a photo and every planogram is filled.

## A. Add-item-group flow (frontend)

**`frontend/src/components/EditorPage.tsx`**
- New state `addMode: 'group' | 'single'` (default `'group'`). While `tool === 'product'` and nothing is being placed (`!placeProductId`), render a small floating **Group | Single** toggle on the map (reuse the `.view-toggle` pill style).
- Rework `placeProduct` (752-802): **delete the create-shelf-on-empty branch (760-776)** — no new 2×0.55 m area, ever.
  - Group mode + click on a shelf → open the group creator for that shelf (`groupCreatorFor` state `{shelfId}`); click on empty space → brief hint flash "Pick a shelf — groups fill shelves" (reuse the map-hint pill), nothing created.
  - Single mode → `setNewItemAt({ x, y, shelfId: targetShelfId ?? shelfIdAtPoint(...) ?? undefined })` → existing ProductModal `autoPlace` (shelfId optional → free-standing pin when off-shelf; ProductModal/PinPanel flows unchanged).
  - `placeProductId` set (Products-tab 📍) → unchanged existing-pin flow, also no shelf creation.
- Update tool label (line 41: `'Add item group'`, icon 🧺), hint strings (line 53 + aria-labels 1399-1400).

**`frontend/src/components/GroupCreatorModal.tsx`** (new) — Modal with:
- **Group name** input (defaults to the shelf's current label — naming the group renames the shelf, matching the existing group-naming concept where the owner shelf's label is the group name).
- An **items editor**: rows of [name input | category select (store categories) | optional price] + "＋ Add item" (adds a row) + per-row remove. Starts with 3 empty rows.
- Confirm/Cancel. On confirm calls `onCreate(shelfId, name, items)`.

**`EditorPage.createGroupOnShelf(shelf, name, items)`**:
- `apix.addProduct` per item (chunked `Promise.all`, concurrency 6; price auto-generated when blank; category from the row's select).
- Facings fill the shelf: **each item gets one facing per shelf row**, spread evenly across the shelf length (`u = (k + 0.5) / n`, `meta = { shelf_level: row, w: shelfFacing, shelfId }`) via `apix.setProductLocation` — a 5-item group on a 4-row shelf = 20 facings, every row stocked edge to edge.
- `stampOwner` each, bulk `setProducts`/`setLocations`, set the shelf label to the group name via `changeElements` (rename pattern), keep the planogram modal closed.

**`frontend/src/lib/itemGroups.ts`** (new, pure + tested) — `spreadFacings(n, levels)` returning `[{u, level}]`, price/name helper (deterministic price from index), so the math is unit-testable.

**`frontend/src/components/MapCanvas.tsx`**
- New prop `placeMode?: 'group' | 'single'`; track the hovered world point alongside `placeHoverShelfId` (extend the 518-536 handler).
- **Replace the dashed whole-shelf polygon (888-904)** with a ghost preview:
  - Group mode: small translucent green facing rects (0.5×0.2 m, `rgba(47,158,66,0.4)`) spaced evenly along **both long edges** of the hovered shelf, rotated with it — "this shelf will be filled".
  - Single mode: one ghost facing rect at the hovered point (edge-aligned when on a shelf).

## B. Two new example maps (seeders)

Follow the existing spec pattern (`warehouseSpec` + `placeOnFaces` + `seedExample`, mirrored verbatim in `worker/src/seed.ts`):

**`backend/scripts/seed-demo.mjs` + `worker/src/seed.ts`**
- `cornerStoreSpec()` — "Maple Corner Store" (`maple-corner`), ~24×16 m: coolers along one wall, 2 aisle pairs, checkout, ~40 items (Dairy/Drinks/Snacks/Pantry/Household categories, hand-written realistic names).
- `grocersSpec()` — "Sunrise Grocers" (`sunrise-grocers`), ~40×28 m: 5 aisle pairs, produce wing, bakery corner, ~70 items (Produce/Bakery/Dairy/Beverages/Health foods...).
- **Filled planograms**: a new `stockFaces` helper — facings every ~0.5 m along each face, **4 levels per column** (`{shelf_level: 1..4, w: 0.3}`), catalogue cycling with 2-3 consecutive facings per SKU — dense in both the editor (real placement) and viewer (compact re-grid) planograms.
- **Photos for every item**: `seedExample`/worker equivalent pass `p.image` through to `image_url` (currently hardcoded `''` at seed-demo.mjs:910 / seed.ts:903) and honor per-location `level`/`w` when present (fallback keeps existing specs unchanged).
- **`backend/scripts/fetch-demo-photos.mjs`**: extend `WANTED` with all new product names (Open Food Facts search); for misses, generate a stylized SVG packshot (`frontend/public/demo-products/gen/<slug>.svg` — bottle/can/box/bag shape by keyword, category color, label text) so **every** item resolves to a real file. Run it once and commit the fetched JPEGs + generated SVGs.
- **Boot pickup on existing databases**: backend `index.js` (18-24) and worker `bootstrap` (migrate.ts:388-412) currently seed only when the DB is empty — change to run the (idempotent, per-store-skipping) seed whenever the store count is below the known set, so the two new maps appear on existing installs and the user's running worker.

**`frontend/src/components/Landing.tsx`**: add both slugs to `EXAMPLES` (hero carousel + planogram band auto-showcases photo-complete shelves).

## Tests

- `itemGroups.test.ts`: `spreadFacings` distribution (count, per-row spread, clamping).
- `ShelfDetail.test.tsx` unaffected; add a `MapCanvas.test.tsx` case if cheap: hover preview renders ghost rects, not the dashed shelf polygon.
- Seed: run `node scripts/seed-demo.mjs` and verify via the public API that both new stores exist, every product has `image_url`, and facing counts are dense.

## Files

`frontend/src/components/EditorPage.tsx`, `MapCanvas.tsx`, new `GroupCreatorModal.tsx`, new `lib/itemGroups.ts`, `Landing.tsx`, `backend/scripts/seed-demo.mjs`, `worker/src/seed.ts`, `backend/scripts/fetch-demo-photos.mjs`, `backend/src/index.js`, `worker/src/migrate.ts`, `frontend/public/demo-products/**` (fetched + generated), plus tests.

## Verification

1. `npm test` + `tsc --noEmit` (frontend), worker `tsc --noEmit`.
2. `node backend/scripts/seed-demo.mjs` → both new stores seeded; spot-check via `curl /api/public/stores/<slug>`: every product has an `image_url`, location counts dense.
3. Browser (sandbox): tool shows Group/Single toggle; hovering a shelf shows ghost facings (no dashed green rectangle); group creator opens on click → name it, add 3-4 items with categories → confirm → shelf label renamed, planogram filled edge-to-edge in editor and viewer; single mode on empty space creates a free-standing pin (no auto shelf); Products-tab 📍 flow unchanged.