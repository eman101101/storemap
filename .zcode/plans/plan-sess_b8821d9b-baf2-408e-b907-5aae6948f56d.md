# Six features: photo planogram demo, email + Facebook sign-in, UI polish, pin groups on the map, local hosting

## Context
Follow-ups to the editor work: a demo planogram with real product photos, real email + Facebook sign-in (today only Google works and the email form is the unsafe dev login), a crisper theme icon, the `p` in the block logo one cell higher, a reworked "Add item" flow where a pin can **create its own planogram area** on empty map or **join the group hovered over**, group context when an item is selected, and a locally hosted instance for testing.

Key facts from exploration: both engines serve `frontend/dist` (Express static + Workers ASSETS), so `/demo-products/*.jpg` bundled in `frontend/public/` works everywhere with no CSP changes; seeds currently set every `image_url=''`; `users.provider` CHECK allows only `google/apple/dev` (needs a table-rebuild migration for `email`/`facebook`); no email-sending code exists; the invitation-token pattern (random token, sha256 stored) is the precedent for magic-link codes; there is no pin-group entity — **shelf areas are the planogram container** in this app's model, so "a group of pins at one spot with an editable-length shape" maps exactly onto "a shelf element + its owned pins".

## 1 · Demo planogram with real photos (Open Food Facts)
- **Fetch script** `backend/scripts/fetch-demo-photos.mjs` (node, no deps): curated list of ~35 recognizable packaged goods (oat milk, chocolate bars, cereals, pasta, coffee…) → OFF search API (`world.openfoodfacts.org/cgi/search.pl?json=1`) → download `image_front_small` at 200px → save to `frontend/public/demo-products/<slug>.jpg` (~5–20KB each), and write `frontend/public/demo-products/ATTRIBUTION.md` (ODbL credit + product URLs).
- **Seeds**: in `worker/src/seed.ts` and `backend/scripts/seed-demo.mjs`, set `image_url = '/demo-products/<slug>.jpg'` for Freshmart products matching the curated names (both files stay byte-compatible in output). `ShelfDetail` photo mode + the Landing planogram band then light up automatically (`hasImages` logic already exists).
- Bundled files = committed to the repo (user chose OFF download knowing it bakes third-party open-licensed content in; attribution file included).

## 2 · Email sign-in (magic code + Resend, local fallback)
- **Migration (both engines)**: rebuild `users` with `provider IN ('google','apple','dev','email','facebook')` — SQLite can't ALTER a CHECK, so create-copy-drop-rename (`backend/src/db.js` MIGRATIONS + `worker/src/migrate.ts`), plus new table `login_tokens (id, email, code_hash, expires_at, used_at)`.
- **Routes** `POST /api/auth/email/request` `{email}` and `POST /api/auth/email/verify` `{email, code}` in `backend/src/routes/auth.js` + `worker/src/routes/auth.ts`: 6-digit code, sha256-stored, 10-min TTL, single use, rate-limited (existing `rateLimit`); blocked for emails already owned by google/apple/facebook (anti-takeover, mirrors `devLoginAllowed`). `RESEND_API_KEY` set → send via `fetch('https://api.resend.com/emails')` (from `EMAIL_FROM`, default `StoreMap <onboarding@resend.dev>`); unset → response carries `devCode` (and console log) so local/self-host works with zero config. Verify → `upsertUser(provider:'email')` + existing `issueSession`/`finishLogin`.
- **Frontend**: `Login.tsx` email form becomes the real flow when `providers.email` (always on): email → "code sent" state → 6-digit input (shows the returned devCode with a "local mode" note) → verify → refresh `/api/auth/me`. `api.ts` + `types.ts` updated.

## 3 · Facebook sign-in
Mirror the Google pattern exactly: `auth/facebook.js` (backend) + worker `routes/auth.ts` blocks — authorize → `graph.facebook.com/v21.0/dialog/oauth` (scope `email,public_profile`), callback → token exchange → `/me?fields=id,name,email,picture` (no id_token; profile call replaces OIDC verify) → `upsertUser(provider:'facebook')`. Env `FACEBOOK_APP_ID`/`FACEBOOK_APP_SECRET` in both configs + `providersConfigured`; **documented in `wrangler.jsonc` comments only** (no empty-string vars — the lesson from the secret-clobber incident) and in `docs/DEPLOY-CLOUDFLARE.md`. Hidden until configured, like Google/Apple.

## 4 · UI polish
- **Theme icon**: replace the `☀`/`☾` text glyphs in `ThemeSettings.tsx` with inline SVG sun/moon (matching `CAMERA_ICON` style, ~14px, `currentColor`).
- **Logo `p`**: shift the `p` glyph in `GRID_GLYPHS` (`GridHero.tsx:26`) up one row — affects BlockText wordmarks and the animated hero consistently; update the BlockText golden expectations in `GridHero.test.tsx`.

## 5 · Add-item flow: create an area, or join the hovered group
- **Unlock the 📍 tool** (`EditorPage.tsx:1116`): activatable with no pre-selected product; hint becomes "Click empty space to create an item area · hover a group to add to it".
- **Click empty map** → create a new shelf element (default ~1.8×0.55 m, editable length via the resize handles we just fixed) at the click, then open the existing **ProductModal** (name/brand/price/category) with an `autoPlace` option — on save it creates the product **and** pins it into the new area in one step.
- **Hover while placing** (`MapCanvas.tsx`): product tool + pointer over a shelf or pin → the shelf (or the pin's owner shelf) gets a highlight glow (edit-mode sibling of the viewer's `hoverShelf` logic); click there skips area creation and places into that **group**.
- **Selected item shows its group**: `PinPanel` gains a "Group — {shelf label} · N items" section with member chips (click to select that pin); ProductsPanel gets a matching "Showing group" banner that can filter the list to the group while the specific row stays ring-highlighted (existing `flashProductId` scroll/flash).

## 6 · Host local for testing
`cd worker && npm run dev` in the background → **http://127.0.0.1:8787** (throwaway local D1/R2 under `.wrangler/state`, demo seeds with photos on first boot). Leave it running for you; smoke-test via the browser tool before handing over.

## Verification
1. Backend tests: email request/verify (devCode path, TTL, takeover-block), provider migration keeps existing users, providers payload — `cd backend && npm test`
2. Worker tests: code-hash/token helpers + providers gating — `cd worker && npm test`
3. Frontend: `tsc --noEmit` + vitest (updated glyph goldens, Login render smoke)
4. e2e: extend journeys — email-code login (devCode shown locally), create-area flow (activate 📍 → click empty map → type name → pin + 5th element exist) — `cd e2e && npm test`
5. Browser pass on the hosted local instance: photo planogram on Freshmart, Facebook button hidden until configured, theme icon, logo `p`
6. All suites green; dev server left running