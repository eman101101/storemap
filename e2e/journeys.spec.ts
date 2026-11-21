/**
 * End-to-end journeys over the real server (built SPA + throwaway SQLite).
 * Covers the flows this project has manually verified all session: shopper
 * search → route → flight, editor draw → autosave → history, trip building.
 */
import { test, expect, type Page } from '@playwright/test';
import { startServer } from './playwright.config.js';

let server: Awaited<ReturnType<typeof startServer>> | null = null;
let storeId = '';
let slug = '';

test.beforeAll(async () => {
  server = await startServer();
  // dev-login + create a store with an entrance and two shelves via the API
  const login = await fetch(`${server!.base}/api/auth/dev-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'e2e@storemap.test' }),
  });
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const H = { 'content-type': 'application/json', cookie };
  const store = await (await fetch(`${server!.base}/api/stores`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'E2E Mart' }) })).json();
  storeId = store.store.id;
  slug = store.store.slug;
  const full = await (await fetch(`${server!.base}/api/stores/${storeId}/full`, { headers: H })).json();
  const floorId = full.floors[0].id;
  const el = (type: string, geom: unknown, label = '') =>
    ({ id: crypto.randomUUID(), type, shape: geom && !Array.isArray(geom) && 'w' in (geom as object) ? 'rect' : Array.isArray(geom) ? 'polyline' : 'point', geometry: geom, label });
  const putRes = await fetch(`${server!.base}/api/floors/${floorId}/elements`, {
    method: 'PUT',
    headers: H,
    body: JSON.stringify({
      elements: [
        el('wall', { x: 0, y: 0, w: 40, h: 0.4, rot: 0 }),
        el('shelf', { x: 5, y: 6, w: 20, h: 1, rot: 0 }, 'Aisle 1'),
        el('shelf', { x: 5, y: 14, w: 20, h: 1, rot: 0 }, 'Aisle 2'),
        el('entrance', { x: 20, y: 19 }),
      ],
    }),
  });
  if (putRes.status !== 200) throw new Error(`seed PUT failed: ${putRes.status} ${await putRes.text()}`);
  const cat = await (await fetch(`${server!.base}/api/stores/${storeId}/categories`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'Snacks', color: '#d4a017' }) })).json();
  for (const [name, x, y] of [['Choc Bar', 8, 6], ['Popcorn', 16, 14]] as const) {
    const p = await (await fetch(`${server!.base}/api/stores/${storeId}/products`, {
      method: 'POST', headers: H, body: JSON.stringify({ name, category_id: cat.category.id, price: 2.5 }),
    })).json();
    await fetch(`${server!.base}/api/products/${p.product.id}/locations`, {
      method: 'POST', headers: H, body: JSON.stringify({ floor_id: floorId, x, y }),
    });
  }
  await fetch(`${server!.base}/api/stores/${storeId}`, { method: 'PATCH', headers: H, body: JSON.stringify({ is_public: true }) });
});

test.afterAll(() => server?.proc.kill());

test('shopper: search → route badge → 2D → 3D', async ({ page }) => {
  await page.goto(`/s/${slug}`);
  await expect(page.locator('.store-pill')).toContainText('E2E Mart', { timeout: 10_000 });
  // search and pick the item (keyboard path)
  const search = page.getByLabel('Search an item');
  await search.click();
  await search.fill('choc');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('.route-badge')).toBeVisible();
  // the visible badge no longer carries the distance — the route summary is
  // announced in the aria-live region (screen-reader text, line 330 of ViewerPage)
  await expect(page.locator('div[aria-live="polite"]')).toContainText('Route to Choc Bar');
  // switch to 2D and back — the map renders both engines
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await expect(page.locator('.viewer-map > svg')).toBeVisible();
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.locator('.viewer-map canvas')).toBeVisible();
  // camera controls start hidden behind the struck-through camera toggle
  await expect(page.locator('.viewer-map .cam-toggle')).toBeVisible();
  await expect(page.locator('.viewer-map .pan-pad')).toHaveCount(0);
  await page.locator('.viewer-map .cam-toggle').click();
  await expect(page.locator('.viewer-map .pan-pad')).toBeVisible();
  // the pad's centre camera glyph hides it again
  await page.locator('.viewer-map .pan-pad button[aria-label="Hide camera controls"]').click();
  await expect(page.locator('.viewer-map .pan-pad')).toHaveCount(0);
});

test('shopper: multi-stop trip', async ({ page }) => {
  await page.goto(`/s/${slug}`);
  const search = page.getByLabel('Search an item');
  await search.click();
  await search.fill('choc');
  await page.keyboard.press('Enter');
  await page.locator('.product-sheet button', { hasText: 'Add to list' }).click();
  await search.click();
  await search.fill('popcorn');
  await page.keyboard.press('Enter');
  await page.locator('.product-sheet button', { hasText: 'Add to list' }).click();
  await expect(page.locator('.trip-panel')).toContainText('2 stops');
  await expect(page.locator('.trip-steps li')).toHaveCount(2);
});

test('shopper: OG meta injected', async ({ page }) => {
  const res = await page.request.get(`/s/${slug}`);
  const html = await res.text();
  expect(html).toContain('<meta property="og:title" content="E2E Mart — find it on the map">');
});

test('editor: opens, outline lists elements, history snapshots', async ({ page }) => {
  // /login pops the sign-in modal over the homepage now — sign in with an
  // email code (local mode: no mail provider, the code is shown in the form)
  await page.goto('/login');
  await page.getByLabel('Email').fill('e2e@storemap.test');
  await page.getByRole('button', { name: 'Email me a code' }).click();
  const code = (await page.getByText(/your code:/).textContent()).match(/(\d{6})/)![1];
  await page.getByLabel('Code').fill(code);
  // scope to the modal — the navbar also has a "Sign in" button
  await page.getByRole('dialog', { name: 'Sign in' }).getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.goto(`/dashboard/stores/${storeId}`);
  // first visit per device auto-opens the editor tour — get it out of the way
  const skipTour = page.getByRole('button', { name: 'Skip tour' });
  if (await skipTour.isVisible().catch(() => false)) await skipTour.click();
  // the side panel is a pull-out drawer (closed on a fresh device) and the
  // outline groups collapse by default — rows render only under open groups.
  // Re-expand after every remount: selecting an element swaps the outline
  // for the element panel, and deselecting remounts it collapsed again.
  const expandOutline = async () => {
    const groupHeads = page.locator('.outline-group-head');
    await expect(groupHeads.first()).toBeVisible({ timeout: 10_000 });
    // heads toggle — the outline keeps its open state across selection
    // changes, so only click groups that are actually collapsed
    for (let i = 0; i < await groupHeads.count(); i++) {
      const head = groupHeads.nth(i);
      if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click();
    }
  };
  await page.getByRole('button', { name: 'Show the side panel' }).click();
  await expandOutline();
  await expect(page.locator('.outline-row')).toHaveCount(4, { timeout: 10_000 });
  // draw one shelf with the Shelf tool → 1 new element → autosave → snapshot
  await page.getByRole('button', { name: /Shelf/ }).click();
  const svg = page.locator('.map-wrap > svg');
  const box = await svg.boundingBox();
  if (box) {
    await page.mouse.move(box.x + 300, box.y + 260);
    await page.mouse.down();
    await page.mouse.move(box.x + 430, box.y + 260, { steps: 4 });
    await page.mouse.up();
  }
  // the shelf tool auto-selects its row (Map tab shows the element panel) —
  // click empty canvas to deselect and bring the outline back (Escape only
  // cancels product placement). Aim between the shelves, right of everything.
  await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.33);
  await expandOutline();
  await expect(page.locator('.outline-row')).toHaveCount(5, { timeout: 10_000 });
  await expect(page.locator('.save-state')).toContainText('Saved', { timeout: 10_000 });
  await page.getByRole('button', { name: 'History' }).click();
  await expect(page.locator('.snapshot-item').first()).toBeVisible({ timeout: 10_000 });
  // restore round-trip through the confirm modal (regression: restored rows
  // used to lose floor_id — the map went blank and the autosave wiped the
  // floor server-side). The snapshot predates the drawn shelf → 4 rows back.
  await page.getByRole('button', { name: '↩ Restore' }).first().click();
  await expect(page.getByRole('dialog', { name: 'Restore this snapshot?' })).toBeVisible();
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await expandOutline();
  await expect(page.locator('.outline-row')).toHaveCount(4, { timeout: 10_000 });

  // Add-item from the map: the product tool now opens in Group mode by
  // default — switch to 📍 Single, then clicking empty space opens the
  // product form anchored at that spot (a free pin, no auto-created area)
  await page.getByRole('button', { name: /Add item group/ }).click();
  await page.getByRole('button', { name: '📍 Single' }).click();
  // mid-map empty space: clear of the shelves, the left tool rail and the
  // open side-panel drawer that overlays the right edge
  await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.28);
  const form = page.getByRole('dialog', { name: 'Add product' });
  await expect(form).toBeVisible();
  await form.getByLabel('Name').fill('Map Made Cola');
  await form.getByRole('button', { name: 'Save product' }).click();
  // the pin panel opens on the new item (a free pin — the outline keeps its
  // four elements, single placement never auto-creates an area)
  await expect(page.locator('.panel-section', { hasText: '📍 Map Made Cola' })).toBeVisible({ timeout: 10_000 });
  // close the pin card to bring the outline back
  await page.getByRole('button', { name: 'Close pin panel' }).click();
  await expandOutline();
  await expect(page.locator('.outline-row')).toHaveCount(4, { timeout: 10_000 });
});
