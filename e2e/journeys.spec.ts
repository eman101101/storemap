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
  await expect(page.locator('.route-badge')).toContainText('m');
  // switch to 2D and back — the map renders both engines
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await expect(page.locator('.viewer-map svg')).toBeVisible();
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.locator('.viewer-map canvas')).toBeVisible();
});

test('shopper: multi-stop trip', async ({ page }) => {
  await page.goto(`/s/${slug}`);
  const search = page.getByLabel('Search an item');
  await search.click();
  await search.fill('choc');
  await page.keyboard.press('Enter');
  await page.locator('.product-sheet button', { hasText: 'Trip' }).click();
  await search.click();
  await search.fill('popcorn');
  await page.keyboard.press('Enter');
  await page.locator('.product-sheet button', { hasText: 'Trip' }).click();
  await expect(page.locator('.trip-panel')).toContainText('2 stops');
  await expect(page.locator('.trip-steps li')).toHaveCount(2);
});

test('shopper: OG meta injected', async ({ page }) => {
  const res = await page.request.get(`/s/${slug}`);
  const html = await res.text();
  expect(html).toContain('<meta property="og:title" content="E2E Mart — find it on the map">');
});

test('editor: opens, outline lists elements, history snapshots', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('e2e@storemap.test');
  await page.getByRole('button', { name: 'Sign in for testing' }).click();
  await page.goto(`/dashboard/stores/${storeId}`);
  await expect(page.locator('.outline-row')).toHaveCount(4, { timeout: 10_000 });
  // draw one shelf with the Aisle pair tool → 2 new elements → autosave → snapshot
  await page.getByRole('button', { name: /Aisle pair/ }).click();
  const svg = page.locator('.map-wrap svg');
  const box = await svg.boundingBox();
  if (box) {
    await page.mouse.move(box.x + 300, box.y + 260);
    await page.mouse.down();
    await page.mouse.move(box.x + 430, box.y + 260, { steps: 4 });
    await page.mouse.up();
  }
  // the aisle-pair tool auto-selects its row (Map tab shows the element panel) —
  // deselect to bring the outline back
  await page.keyboard.press('Escape');
  await expect(page.locator('.outline-row')).toHaveCount(6, { timeout: 10_000 });
  await expect(page.locator('.save-state')).toContainText('Saved', { timeout: 10_000 });
  await page.getByRole('button', { name: 'History' }).click();
  await expect(page.locator('.snapshot-item').first()).toBeVisible({ timeout: 10_000 });
});
