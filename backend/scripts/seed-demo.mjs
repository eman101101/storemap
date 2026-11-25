#!/usr/bin/env node
/**
 * Seeds the three homepage example stores — Walmart (the big-box reference
 * floor plan), Home Depot (hardware) and the Corner Store (convenience). In
 * each, every area is a department (zone) and every shelf one titled item
 * group. Each group carries ONE map pin (meta.groupPin, sized to the group's
 * plan length) plus its items as planogram-only facings (meta.groupOnly) —
 * items never draw as pins; they live inside the group's planogram. Every
 * item carries a photo from demo-photos.json (grocery from Open Food Facts,
 * the rest from openly-licensed sources — see scripts/fetch-demo-photos*.mjs);
 * an item the photo scripts couldn't source falls back to a diagram tile.
 *
 * The photos are stored IN the database: demo-products/ (next to this
 * backend, not shipped with the frontend) is copied into the `media` table
 * and served at /media/<file>. A present store is never rebuilt just
 * because a photo changed — its product urls are updated in place, so
 * product ids (and deep links to them) stay stable.
 *
 * Every catalogue item faces on a shelf: a shopper's search lists an item
 * with no facing as "out of stock", so nothing may be left unstocked.
 * Former examples (Freshmart Downtown, Annex Market, Harbor Warehouse,
 * Megamart Central, Maple Corner Store, Grand Mart) are retired.
 *
 *   node scripts/seed-demo.mjs              # idempotent — skips if present
 *   node scripts/seed-demo.mjs --reset      # wipe the example store and rebuild
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isMediaUrl, putMedia, pruneMedia } from '../src/lib/media.js';
import { walmartSpec, homeDepotSpec, cornerStoreSpec, stockEverything, PHOTOS } from './demo-specs.mjs';
// db.js resolves DATA_DIR exactly like the server (via config) and migrate()
// creates the schema — so the script is safe on a first boot with a brand-new
// database file.
import { db, migrate } from '../src/db.js';

/** Where the photo files themselves live; a manifest url `/media/<file>` is
 *  the image `<file>` under this directory. */
const PHOTO_DIR = new URL('../demo-products/', import.meta.url);
const MEDIA_URL = /^\/media\/((?:gen\/)?[a-z0-9-]+\.(?:jpe?g|png|webp|svg))$/;

migrate();

/** Copy the demo photo set into the database's media table. A file whose
 *  bytes did not change is left alone; a photo retired from the set is
 *  dropped. Returns how many images the table holds. */
function loadDemoMedia() {
  const files = [...new Set(Object.values(PHOTOS))].map((url) => {
    const m = MEDIA_URL.exec(url);
    if (!m) throw new Error(`Not a stored demo photo url: ${url}`);
    putMedia(m[1], readFileSync(new URL(m[1], PHOTO_DIR)));
    return m[1];
  });
  pruneMedia(files);
  return db.prepare('SELECT COUNT(*) n FROM media').get().n;
}

const mediaCount = loadDemoMedia();
console.log(`Demo photos in the database: ${mediaCount} images.`);

const reset = process.argv.includes('--reset');

/* ══════════════════════════════════════════════════════════════════════════
   Retire replaced examples (mirrors the worker seeder's slug list).
   ══════════════════════════════════════════════════════════════════════════ */
function deleteDemoStore(slug) {
  const st = db.prepare('SELECT id FROM stores WHERE slug = ?').get(slug);
  if (!st) return;
  const floorIds = db.prepare('SELECT id FROM floors WHERE store_id = ?').all(st.id).map((r) => r.id);
  db.exec('BEGIN');
  try {
    for (const fid of floorIds) {
      db.prepare('DELETE FROM product_locations WHERE floor_id = ?').run(fid);
      db.prepare('DELETE FROM floor_snapshots WHERE floor_id = ?').run(fid);
      db.prepare('DELETE FROM map_elements WHERE floor_id = ?').run(fid);
    }
    db.prepare('DELETE FROM products WHERE store_id = ?').run(st.id);
    db.prepare('DELETE FROM categories WHERE store_id = ?').run(st.id);
    db.prepare('DELETE FROM floors WHERE store_id = ?').run(st.id);
    db.prepare('DELETE FROM store_members WHERE store_id = ?').run(st.id);
    db.prepare('DELETE FROM stores WHERE id = ?').run(st.id);
    db.exec('COMMIT');
    console.log(`Retired demo store ${slug}.`);
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

const skuOf = (spec, i) => `${spec.skuPrefix}-${String(i + 1).padStart(spec.skuPad ?? 3, '0')}`;

/** A cheap change signal for a present store's photos: a fingerprint of
 *  every photo url the spec assigns, in catalogue order. A mismatch means the
 *  spec's picks — or the url scheme itself — changed since the store was last
 *  synced (parity with the Worker seeder). */
function photoFingerprint(spec) {
  return createHash('sha256').update(spec.products.map((p) => p.image ?? '').join('\n')).digest('hex');
}
const photoSyncKey = (slug) => `seed:photos:${slug}`;

/**
 * Bring a present store's product photos up to date WITHOUT rebuilding it.
 * A photo picked later — or the move of the whole set from static files into
 * the media table — only changes an url, so the rows are updated in place
 * and product ids stay put (deep links keep working). Only urls of the
 * demo's own photo set are ever replaced: a photo the owner uploaded, or
 * one they removed, is left alone. The one exception is a store's FIRST
 * sync (none recorded yet): it was seeded before photos were tracked, so
 * its empty photo fields are filled too.
 */
function repointPhotos(spec, storeId) {
  const print = photoFingerprint(spec);
  const key = photoSyncKey(spec.slug);
  const synced = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key)?.value;
  if (synced === print) return 0; // unchanged since the last sync
  const current = db.prepare('SELECT id, image_url FROM products WHERE store_id = ? AND sku = ?');
  const set = db.prepare(
    `UPDATE products SET image_url = ? WHERE id = ?
       AND (image_url LIKE '/media/%' OR image_url LIKE '/demo-products/%'${synced === undefined ? " OR image_url = ''" : ''})`
  );
  let changed = 0;
  spec.products.forEach((p, i) => {
    const cur = current.get(storeId, skuOf(spec, i));
    const image = p.image ?? '';
    if (cur && cur.image_url !== image && (isMediaUrl(cur.image_url) || (synced === undefined && !cur.image_url && image))) {
      changed += set.run(image, cur.id).changes;
    }
  });
  db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, print);
  return changed;
}

/** A catalogue item with no facing lists as "out of stock" in a shopper's
 *  search — say so rather than let one slip by. */
function reportUnstocked(slug) {
  const n = db
    .prepare(
      `SELECT COUNT(*) n FROM products p JOIN stores s ON s.id = p.store_id WHERE s.slug = ?
        AND NOT EXISTS (SELECT 1 FROM product_locations l WHERE l.product_id = p.id)`
    )
    .get(slug).n;
  if (n) console.warn(`  WARNING: ${n} items of ${slug} have no shelf location — a search lists them as "out of stock".`);
}

function seedExample(spec, ownerEmail, ownerName) {
  const resetThis = reset || process.argv.includes(`--reset-${spec.slug}`);
  const added = stockEverything(spec);
  if (added) console.log(`  ${spec.name}: ${added} catalogue items had no facing — added to a group.`);
  let st = db.prepare('SELECT id, owner_id FROM stores WHERE slug = ?').get(spec.slug);
  if (!st) {
    let owner = db.prepare('SELECT id FROM users WHERE email = ?').get(ownerEmail);
    if (!owner) {
      const uid = randomUUID();
      db.prepare("INSERT INTO users (id, email, name, provider, provider_sub) VALUES (?, ?, ?, 'dev', ?)").run(
        uid, ownerEmail, ownerName, `${spec.slug}-demo`
      );
      owner = { id: uid };
    }
    const sid = randomUUID();
    db.prepare(
      `INSERT INTO stores (id, owner_id, name, slug, address, description, hours, is_public)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
    ).run(sid, owner.id, spec.name, spec.slug, spec.address, spec.description, spec.hours);
    db.prepare('INSERT INTO floors (id, store_id, name, level, width_m, height_m) VALUES (?, ?, ?, 1, ?, ?)').run(
      randomUUID(), sid, spec.floorName, spec.w, spec.h
    );
    st = { id: sid, owner_id: owner.id };
    console.log(`Created ${spec.name} (${spec.slug}).`);
  }
  // only the demo's own store is rebuilt or touched up — a store someone
  // claimed is left exactly as its owner made it
  const demoOwner = db.prepare('SELECT id FROM users WHERE email = ?').get(ownerEmail)?.id;
  const demoOwned = st.owner_id === demoOwner;
  let fl = db.prepare('SELECT id, width_m, height_m FROM floors WHERE store_id = ? ORDER BY level LIMIT 1').get(st.id);
  // a spec whose floor grew rebuilds the demo store, so an existing database
  // picks up the new layout instead of keeping the stale one forever
  const sizeChanged = Math.abs(fl.width_m - spec.w) > 0.01 || Math.abs(fl.height_m - spec.h) > 0.01;
  let shelves = db.prepare("SELECT COUNT(*) AS n FROM map_elements WHERE floor_id = ? AND type = 'shelf'").get(fl.id).n;
  // a spec whose pin count changed (items regrouped) also rebuilds — an old
  // seed's locations otherwise stick around forever
  const locCount = db.prepare('SELECT COUNT(*) AS n FROM product_locations WHERE floor_id = ?').get(fl.id).n;
  const locDrift = shelves > 0 && locCount !== spec.locations.length;
  if (shelves > 0 && (resetThis || (demoOwned && (sizeChanged || locDrift)))) {
    db.prepare('DELETE FROM product_locations WHERE floor_id = ?').run(fl.id);
    db.prepare('DELETE FROM products WHERE store_id = ?').run(st.id);
    db.prepare('DELETE FROM categories WHERE store_id = ?').run(st.id);
    db.prepare('DELETE FROM map_elements WHERE floor_id = ?').run(fl.id);
    db.prepare('UPDATE stores SET description = ?, hours = ? WHERE id = ?').run(spec.description, spec.hours, st.id);
    shelves = 0;
    console.log(`Reset ${spec.name} — rebuilding.`);
  }
  if (shelves > 0) {
    if (demoOwned) {
      const photos = repointPhotos(spec, st.id);
      if (photos) console.log(`  ${photos} product photos updated in place.`);
    }
    console.log(`${spec.name} layout already present — skipping (use --reset-${spec.slug} to rebuild).`);
    reportUnstocked(spec.slug);
    return;
  }
  db.prepare('UPDATE floors SET width_m = ?, height_m = ? WHERE id = ?').run(spec.w, spec.h, fl.id);
  const insE = db.prepare(
    'INSERT INTO map_elements (id, floor_id, type, shape, geometry, label, color, meta, z_index) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const insC = db.prepare('INSERT INTO categories (id, store_id, name, color, icon) VALUES (?, ?, ?, ?, ?)');
  const insP = db.prepare(
    'INSERT INTO products (id, store_id, category_id, name, brand, sku, barcode, description, price, image_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const insL = db.prepare('INSERT INTO product_locations (id, product_id, floor_id, x, y, rot, meta) VALUES (?, ?, ?, ?, ?, 0, ?)');
  // single transaction: the big-box spec writes thousands of rows in one commit
  db.exec('BEGIN');
  try {
    spec.elements.forEach((e, z) => insE.run(randomUUID(), fl.id, e.type, e.shape, JSON.stringify(e.geometry), e.label, e.color ?? '', e.meta ?? '{}', z + 1));
    const catId = {};
    for (const c of spec.categories) {
      catId[c.name] = randomUUID();
      insC.run(catId[c.name], st.id, c.name, c.color, c.icon);
    }
    const pid = spec.products.map((p, i) => {
      const id = randomUUID();
      const price = p.price ?? Math.round((1.49 + ((i * 61) % 2400) / 100) * 100) / 100;
      insP.run(id, st.id, catId[p.category], p.name, p.brand, skuOf(spec, i), '', '', price, p.image ?? '');
      return id;
    });
    for (const l of spec.locations) {
      insL.run(randomUUID(), pid[l.product], fl.id, l.x, l.y, JSON.stringify({
        shelf_level: l.level ?? (l.product % 3) + 1,
        w: l.w ?? 1,
        ...(l.pinW != null ? { pinW: l.pinW } : {}),
        ...(l.pinH != null ? { pinH: l.pinH } : {}),
        ...(l.groupOnly ? { groupOnly: 1 } : {}),
        ...(l.groupPin ? { groupPin: 1 } : {}),
      }));
    }
      db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
      photoSyncKey(spec.slug), photoFingerprint(spec)
    );
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  console.log(`Seeded ${spec.name}: ${spec.w}×${spec.h} m, ${spec.elements.length} elements, ${spec.products.length} products (${spec.locations.length} pinned).`);
}

// The homepage showcases the three example stores. Retire the previous demo
// maps from databases that already seeded them, then seed the current set
// (idempotent; `--reset` or `--reset-<slug>` forces a rebuild).
for (const slug of [
  'sunrise-grocers',
  'freshmart-downtown',
  'annex-market',
  'harbor-warehouse',
  'megamart-central',
  'maple-corner',
  'grand-mart',
]) {
  deleteDemoStore(slug);
}
seedExample(walmartSpec(), 'walmart@storemap.demo', 'Walmart Demo');
seedExample(homeDepotSpec(), 'homedepot@storemap.demo', 'Home Depot Demo');
seedExample(cornerStoreSpec(), 'corner@storemap.demo', 'Corner Store Demo');
