# Design doc — "2010s 3D map" visual restyle (3D viewer)

Status: **v1 SHIPPED as an optional theme** — the retro look from §1 A-E, G
(sky/sun, warm lighting, two-tone gloss, contact shadows, floor, route gloss,
labels, vignette) is implemented behind the in-app ◐ settings toggle
("Map style → Retro 2010s"), alongside light/dark app mode. Not yet done:
F1/F2 pin redesign, H1/H2 camera bob/orbit, I skeuomorphic CSS chrome —
all default-modern, zero behavior change when the theme is off.
Update: the sun disc (A2) was later removed by request — the retro sky is
now the clean blue gradient only. This doc remains the full spec; the
breakage review below is still accurate.

Reference aesthetic: Google Earth 5 / Maps 2010, Bing Maps 3D, early iOS
skeuomorphism — saturated sky, warm directional sun, glossy extrusions,
contact shadows, chunky outlined labels, glossy route ribbon, beveled UI.
Friendly and toy-like, not photoreal.

---

## 1. The look, change by change

Each item: **what you see → where it goes in code → how it fits the engine.**

The engine constraint that shapes everything below: `render3d.ts` is a
flat-polygon pipeline (Face → BSP order → Canvas2D fill). There is no
material system. So every effect is achieved the era-correct way — **by
adding more polygons**, not by canvas filters. That keeps the exact-BSP
occlusion guarantee intact and keeps per-frame cost flat.

### A. Sky & horizon (backdrop)

| # | Change | Touchpoint |
|---|--------|-----------|
| A1 | Saturated blue→white vertical gradient sky (currently pale neutral `#e3e9ef→#eef0e8`) | `renderScene` backdrop block, `render3d.ts:751-755` |
| A2 | Sun disc + radial glow drawn at a fixed screen-corner derived from the light direction `LIGHT` (`render3d.ts:204`) | same block, drawn **before** the face loop |
| A3 | Soft horizon haze band where the floor slab meets the sky | same block, a screen-space gradient sized from the projected floor edge |

Risk-free: the backdrop is repainted per frame before any face and touches
nothing else. No API change.

### B. Warm sun lighting (shading model)

| # | Change | Touchpoint |
|---|--------|-----------|
| B1 | Warmer key light and higher contrast: brightness curve `0.55+0.45·|n·L|` → e.g. `0.45+0.55·|n·L|` with warm-tinted `LIGHT` | `lit()`, `render3d.ts:203-209` |
| B2 | Two-tone "glossy" vertical faces: split each side quad horizontally (~65/35) into a lighter upper strip and darker lower strip — the classic 2010s plastic-bevel read | new helper next to `boxFaces` (`render3d.ts:212`), used by the scene builder for `shelf`/`wall` rects |
| B3 | Slightly raised fixture heights for chunkier silhouettes (shelf 1.5→1.8, wall 3.2→3.6) — *optional, see breakage §3.4* | `TYPE_HEIGHT`, `render3d.ts:32-37` |

`shade()` (`render3d.ts:194`) stays pure hex-multiply — it is unit-tested and
used for pins/labels; all palette warmth enters through `lit()` and the base
colors.

### C. Contact shadows

Soft dark quads on the floor under every fixture, offset opposite the sun
(NE light → SW shadow), alpha ~0.18, at layer 0.5 (decal) with its own z
(0.05 — see z-fighting note §3.6).

| # | Change | Touchpoint |
|---|--------|-----------|
| C1 | Shadow quads = shelf footprint offset by height-scaled vector, built per rect/polygon element | **new** `buildContactShadows(elements)`, composed in `Map3D.tsx:122-126` (`bspInput` memo) — deliberately NOT inside `buildSceneFaces` (§3.2) |

### D. Floor

| # | Change | Touchpoint |
|---|--------|-----------|
| D1 | Warmer parchment floor color (`FLOOR_FILL`, `render3d.ts:229`) + slightly deeper grid | constants only |
| D2 | Vignette: radial darkening at screen edges, painted after the face pass, before the overlay pass | new optional `SceneInput.post?: (ctx, w, h) => void` hook in `renderScene` — additive (§3.5) |

### E. Route ribbon

| # | Change | Touchpoint |
|---|--------|-----------|
| E1 | Glossy two-layer ribbon: darker base at z 0.07 (existing `routeFaces`) + narrower brighter highlight strip at z 0.08 | extend `routeFaces` (`render3d.ts:236`) to emit both quads, both layer 1 |
| E2 | Dashed center line (2010s GPS feel): short thin quads along the path at z 0.09, layer 1 | same function |
| E3 | Arrival "target" reticle replacing the plain disc: two concentric rings | `drawFloorDisc` callers in `renderScene` overlay, `render3d.ts:828-831` |

### F. Markers & pins

| # | Change | Touchpoint |
|---|--------|-----------|
| F1 | Pseudo-3D teardrop pin (Google-maps style): projected ellipse shadow at the base + filled circle head + white outline — replaces the flat dot for free-standing pins | pin drawing block, `render3d.ts:859-884` |
| F2 | Stocked-on-shelf pin dots get a small drop shadow quad behind them (layer 2, offset a few px) | same block |
| F3 | Stock blocks (`stockFaces`, `render3d.ts:656`) get the B2 two-tone gloss treatment | new helper from B2 applied here |

Constraint (§3.3): `PinHit` positions must keep matching what is drawn — the
hit must be pushed at the same projected point as the visible marker head.

### G. Labels

| # | Change | Touchpoint |
|---|--------|-----------|
| G1 | Chunky white label with a strong dark outline + slight yellow glow (halo) instead of the current soft white halo; keep the depth-based size clamp and 140 px dedupe exactly as-is | `drawLabel`, `render3d.ts:952-961` |

### H. Camera motion (flight)

| # | Change | Touchpoint |
|---|--------|-----------|
| H1 | Subtle altitude "bob" during the route walk (±0.15 m, 1.2 Hz) — era drone feel | `camAtS()` in `Map3D.tsx:212-216`, applied to the eye z only |
| H2 | Slow auto-orbit (yaw drift ~0.02 rad/s) while idle on the arrival overview — the classic 2010s attract mode | after the arrival tween in the flythrough effect, `Map3D.tsx:238-244` |

Both must sit behind the existing `prefers-reduced-motion` gate
(`Map3D.tsx:200`) and use the existing cancellation signals (§3.7).

### I. UI chrome (skeuomorphic 2010s)

Glossy gradient buttons, rounded-3px beveled cards, slight inner-shine on
panels — **CSS-only** in `styles.css` (`:root` palette + `.btn`, `.card`,
`.search-float`, `.route-badge`, `.view-toggle`, `.trip-panel` classes,
`styles.css:1-126`+). No markup or class-name changes (§3.1).

---

## 2. What stays untouched

- **The 2D SVG view** (`MapCanvas.tsx`) and the editor keep their current
  look. One shared-constant caveat in §3.8.
- `navgrid.ts`, `shelfLayout.ts`, `ShelfDetail`, all backend routes — zero
  overlap with any change above.
- The projection math (`toCamera`, `project`, `clipPolygonNear`), the BSP
  build/traverse, `subdivideFaces`, `pathSampler`, `camFromEyeLook` — no
  signature or semantic changes proposed. The restyle is *content* (faces,
  colors, overlay drawing), not *machinery*.

---

## 3. Breakage review — checked against the actual code and tests

This is the "will anything break" audit. Verdict per item, worst first.

### 3.1 e2e journeys — **safe, with one rule**

`e2e/journeys.spec.ts` selects only by class name and accessible name:
`.store-pill`, `.route-badge` containing "m", buttons named exactly `2D` /
`3D` (line 68-71), `getByLabel('Search an item')`, `.product-sheet button`
"Trip", `.trip-panel`, `.outline-row`, `.save-state`, `.snapshot-item`,
"History", "Aisle pair". Canvas content is opaque to Playwright — none of
the renderer changes are visible to it.

**Rule:** the UI restyle (item I) must be CSS-only — no renamed classes, no
changed aria-labels/button text, no removed DOM nodes. Any redesign that
renames `.route-badge` or the `2D`/`3D` button labels breaks journeys 1, 2
and 4 immediately.

### 3.2 `render3d.test.ts` pins exact face counts — **the main landmine**

These tests will fail if we add faces inside the *tested* functions:

- `buildSceneFaces` must emit exactly **32 grid lines**, a slab tiled to
  **20** floor tiles (lines 117, 187), and exactly **20** non-line faces for
  a floor with only a point marker (line 129).
- `boxFaces` must return exactly **5** faces with **≥3 distinct fills**
  (lines 79-85) — the B2 gloss split would break the count *if done inside
  `boxFaces`*.
- The **contact-shadow test** (lines 280-286) literally asserts *"contact
  shadows … are no longer generated"*: no face at z = 0.02, no extra alpha
  faces. Shadows were deliberately removed at some point; item C1
  intentionally reverses that decision, so **this test must be rewritten**
  (it becomes the C1 regression test instead).
- `subdivideFaces` count tests (2 / 17 / 30 tiles, lines 190-220) break if
  tiling thresholds or the layer-number semantics change.

**Mitigation baked into this design:** all additive geometry goes through the
composition seam that already exists — `Map3D.tsx:122-126` builds
`bspInput` by concatenating `sceneFaces + stockFaces + routeFaces` before
`buildSceneBSP`. Shadows (C1) and route gloss (E1/E2) are new functions
composed in that memo; `buildSceneFaces`, `boxFaces`, `subdivideFaces` keep
their exact output. The only test that must change is the shadow test, plus
new tests for the new builders. B2's gloss split is applied by a *wrapper*
the scene builder uses (or by emitting the split inside the new code paths),
never by mutating `boxFaces` itself.

### 3.3 Pin hit-testing — **must stay in lockstep**

`renderScene` returns `PinHit[]` from the same projected points it draws
(`render3d.ts:844, 861`), and `Map3D` taps against those (`Map3D.tsx:346-359`).
F1/F2 redraw the markers; if the visible head moves (teardrop is taller than
the current dot), the pushed hit must move with it. Rule: compute the hit
from the head's projected position, and keep the 18 px tap radius working —
enlarging the visual without moving the hit makes taps feel off-center.

### 3.4 Height changes couple four hard-coded z values — **defer B3**

If `TYPE_HEIGHT.shelf` (1.5) changes, these break silently:
`stockFaces` block z-range 0.32–1.18 (`render3d.ts:660-661`), shelf pin dot
z = 1.05 (`render3d.ts:842`), free-pin pole heights 2.1/2.6 vs wall 3.2
(`render3d.ts:863`), and `ShelfDetail`'s planogram expectations of a
1.5 m shelf. Recommendation: **keep heights as-is in v1** of the restyle;
taller fixtures buy little visually and cost a coordinated change across
four files. If wanted later, derive all z constants from `TYPE_HEIGHT`.

### 3.5 Post effects need a new hook — **additive, safe**

`renderScene` has no way to paint between the face pass and the overlay
pass; the vignette (D2) needs one. Adding an optional `SceneInput.post`
callback is additive — every existing call site (and there are only two:
`Map3D.tsx:281`, `Landing.tsx`'s hero canvas) keeps working without it.
Do **not** paint the vignette after the overlay pass: it would tint pins
and labels, and G1's readability is the point of the chunky style.

### 3.6 Z-fighting between new decals — **give every layer its own z**

Painter's order within a layer is exact, but coplanar faces at identical z
can flicker when the BSP splits them at the same plane. The existing code
already staggers z (floor 0 → decals 0.04-0.06 → route 0.07). New decals
must continue the ladder: shadows 0.05, route base 0.07 (unchanged),
highlight 0.08, dashes 0.09. Never reuse an existing z value.

### 3.7 Camera motion — **respect the existing gates**

The flythrough is seq-gated (`flownSeq`, `Map3D.tsx:183-188`) so the first
route never auto-plays, and every rAF loop checks a cancellation flag. H1's
bob must be a pure function of time applied inside `camAtS` (it rides the
same loop, same flag). H2's idle orbit must start its own flag-checked loop
and be killed by the same `stopFlySignal()` path, and **both** must sit
behind the `prefers-reduced-motion` branch (`Map3D.tsx:200`). An orbit that
outlives unmount or fights the seq gate = the exact stale-callback bug
class the current design carefully avoids.

### 3.8 `mapColors.ts` is shared 2D/3D — **don't repalette it**

`TYPE_COLOR`/`TYPE_STROKE` feed both the 3D scene (`render3d.ts:11`) and the
2D SVG editor/viewer. Changing them to 2010s hues would silently restyle the
editor too (against the scope rule in §2). The warm palette belongs in
`render3d.ts` constants (`FLOOR_FILL` etc.) or a new `retroColors.ts`; also
keep every color a `#rrggbb` hex — `shade()` does `parseInt(hex.slice(1))`
with no validation, and named/`rgb()` colors yield `#NaN`.

### 3.9 Performance budget — **count faces before/after**

Scenes peak around ~2K faces (per the note at `Map3D.tsx:128`); the BSP is
rebuilt only on data change, so the per-frame cost is projection + fills of
everything on screen. The additions are bounded: shadows ≈ +1 face per
fixture; route gloss ≈ +3 faces per route segment (short — tens); label/pin
changes are constant cost; B2 gloss doubles side quads of fixtures only
(shelves + walls ≈ +100-300 faces on the demo store). Well within budget.
Explicitly **avoid** `ctx.shadowBlur`, `ctx.filter`, and per-face
`createLinearGradient` — the first two are notoriously slow in Canvas2D and
the third allocates thousands of objects per frame; the two-tone split (B2)
exists precisely to get the gradient look with plain fills.

### 3.10 Things that will NOT break (checked)

- `sw.js`/PWA: assets are content-hashed, restyle re-deploys cleanly.
- `Landing.tsx` hero uses `renderScene` too — it inherits the new look for
  free (desirable), just verify the smaller canvas still reads well.
- `fitCamera`, 2D↔3D camera handoff, floor switching: untouched.
- Backend, `validate.js` geometry rules: no new element types or fields
  proposed — everything above is render-layer only. (Shadow geometry is
  derived at render time, never stored.)

---

## 4. Rollout order (when we do code it)

1. **Palette + sky + labels** (A1-A3, B1, D1, G1) — constants and one
   function each; zero test impact.
2. **Contact shadows** (C1) + rewrite the shadow test — the one deliberate
   test reversal.
3. **Route gloss** (E1-E3) + `routeFaces` count test update (it currently
   expects exactly 1 quad per segment, `render3d.test.ts:95-105`).
4. **Pins** (F1-F3) with hit-lockstep check.
5. **Post hook + vignette** (D2), **camera motion** (H1-H2).
6. **CSS chrome** (I) last — broadest visual blast radius, zero logic risk.
7. Full `npm test` (frontend), `npm test` (e2e, needs the CI `backend npm
   ci` fix noted in the review) and a manual low-end-device pass.

Estimated diff surface: `render3d.ts` (+~150 lines), `Map3D.tsx` (+~40),
`styles.css` (restyle of existing classes), `render3d.test.ts` (2 tests
updated, ~4 added). Nothing else.
