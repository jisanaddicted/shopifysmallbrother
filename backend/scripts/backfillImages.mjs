/**
 * One-time migration: move images already stored as base64 into Cloudinary.
 *
 *   npm --prefix backend run backfill:images            # dry run: reports only
 *   npm --prefix backend run backfill:images -- --apply  # actually upload
 *
 * WHY THIS EXISTS
 *
 * Images used to be saved as base64 data URLs inside the store/product
 * documents. `GET /api/stores/joes-pizza` was 942,386 bytes, almost all of it
 * photographs inlined as text: uncacheable, undecodable off the main thread, and
 * re-downloaded on every page load. New uploads are hosted now (see
 * src/services/cloudinary.js) - but rows written before that still hold their
 * megabytes, and no amount of new code shrinks an old document.
 *
 * This walks every image field, uploads what is still inline, and replaces it
 * with the URL. What it touches:
 *
 *   Store.logo, Store.image           - header logo and cover
 *   Store.categoryImages[name]        - Theme 1 category cards (a map)
 *   CategoryNode.image                - Theme 2 tree cards
 *   Product.image, Product.variants[] - product and variant photos
 *
 * SAFETY
 *
 * - A DRY RUN by default: it prints what it would do and changes nothing, and
 *   `--apply` is required to write. Uploading media is not something to do to
 *   somebody's database as a side effect of running a script.
 * - A document is saved only after its uploads succeeded, so a failure halfway
 *   leaves a partially migrated database rather than a lost image. A value that
 *   is already a URL is skipped.
 * - The storefront cache is invalidated at the end so the change is visible on
 *   the next visit rather than after the TTL.
 */
import { connectDB, disconnectDB } from '../src/config/db.js';
import { config } from '../src/config/env.js';
import CategoryNode from '../src/models/CategoryNode.js';
import Product from '../src/models/Product.js';
import Store from '../src/models/Store.js';
import {
  hostImage,
  imageHostingReady,
  isImageDataUrl,
  publicIdFor,
  storeFolder,
} from '../src/services/cloudinary.js';
import { invalidateStore } from '../src/utils/storefrontCache.js';

const APPLY = process.argv.includes('--apply');

const inlineBytes = (value) =>
  isImageDataUrl(value) ? Math.floor((value.length * 3) / 4) : 0;

const kb = (bytes) => `${Math.round(bytes / 1024)}KB`;

/** Counters shared by every field below, so one summary covers the lot. */
const tally = { migrated: 0, skipped: 0, failures: 0, savedBytes: 0 };
const touchedStores = new Set();

/**
 * Upload one inline value and hand back what should be stored.
 *
 * Returns the ORIGINAL value on failure, on purpose: a document is only saved
 * once this has succeeded for every one of its images, so a Cloudinary hiccup
 * leaves the old picture intact instead of blanking the field.
 */
async function migrate(value, folder, publicId) {
  if (!isImageDataUrl(value)) {
    if (value) tally.skipped += 1;
    return value;
  }

  try {
    const url = await hostImage(value, { folder, publicId });
    if (!url || url.startsWith('data:')) throw new Error('upload returned no URL');
    tally.migrated += 1;
    tally.savedBytes += inlineBytes(value);
    return url;
  } catch (err) {
    tally.failures += 1;
    console.error(`[backfill]   could not upload: ${err.message}`);
    return value;
  }
}

async function main() {
  if (!(await imageHostingReady())) {
    console.error(
      'Image hosting is not available, so there is nowhere to migrate to.\n' +
        'Check CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET in backend/.env',
    );
    process.exit(1);
  }

  await connectDB();
  console.log(
    `[backfill] cloud "${config.cloudinary.cloudName}", folder "${config.cloudinary.folder}"`,
  );
  console.log(`[backfill] mode: ${APPLY ? 'APPLY (writes)' : 'DRY RUN (no writes)'}`);
// --- Stores: logo, cover, and the Theme 1 category map -------------------
  /* The category map is keyed by NAME, and that name is what makes the picture's
     public id stable - the same id the live endpoint uses, so a picture migrated
     now and one uploaded now land on the same asset instead of two files. */
  for (const store of await Store.find({})) {
    let changed = false;

    if (isImageDataUrl(store.logo)) {
      store.logo = await migrate(
        store.logo,
        storeFolder(store._id, 'logo'),
        publicIdFor(store._id, 'logo'),
      );
      changed = true;
    } else if (store.logo) {
      tally.skipped += 1;
    }

    if (isImageDataUrl(store.image)) {
      store.image = await migrate(
        store.image,
        storeFolder(store._id, 'cover'),
        publicIdFor(store._id, 'cover'),
      );
      changed = true;
    } else if (store.image) {
      tally.skipped += 1;
    }

    const images = { ...(store.categoryImages || {}) };
    for (const [key, value] of Object.entries(images)) {
      if (!isImageDataUrl(value)) continue;
      images[key] = await migrate(
        value,
        storeFolder(store._id, 'categories'),
        publicIdFor(store._id, 'category', key),
      );
      changed = true;
    }

    if (!changed) continue;
    store.categoryImages = images;
    touchedStores.add(String(store._id));
    console.log(`[backfill] store "${store.name}" (${store.slug})`);
    if (APPLY) await store.save();
  }

  // --- Theme 2 category tree ----------------------------------------------
  for (const node of await CategoryNode.find({})) {
    if (!isImageDataUrl(node.image)) continue;
    node.image = await migrate(
      node.image,
      storeFolder(node.store, 'tree'),
      publicIdFor(node.store, 'node', node._id),
    );
    touchedStores.add(String(node.store));
    console.log(`[backfill] tree node "${node.name}"`);
    if (APPLY) await node.save();
  }

  // --- Products, and their per-variant photos ------------------------------
  /* No public id for a product photo: a product is not a fixed slot, so each
     upload is its own asset (this matches productController's live behaviour). */
  for (const product of await Product.find({})) {
    let changed = false;

    if (isImageDataUrl(product.image)) {
      product.image = await migrate(product.image, storeFolder(product.store, 'products'));
      changed = true;
    } else if (product.image) {
      tally.skipped += 1;
    }

    for (const variant of product.variants || []) {
      if (!isImageDataUrl(variant.image)) continue;
      variant.image = await migrate(variant.image, storeFolder(product.store, 'products'));
      changed = true;
    }

    if (!changed) continue;
    touchedStores.add(String(product.store));
    console.log(`[backfill] product "${product.name}"`);
    if (APPLY) await product.save();
  }

  console.log(
    `\n[backfill] ${tally.migrated} image(s) ${APPLY ? 'moved' : 'would move'} to Cloudinary, ` +
      `${tally.skipped} already hosted, ${tally.failures} failed`,
  );
  console.log(`[backfill] inline payload ${APPLY ? 'removed from' : 'still in'} the database: ~${kb(tally.savedBytes)}`);

  if (!APPLY) {
    console.log('\n[backfill] dry run - nothing was written. Re-run with --apply to do it.');
  } else if (tally.migrated > 0) {
    /* The storefront serves store, tree and product payloads from a cache, so
       without this the next shopper would see the old inline images until the
       TTL expired. */
    for (const storeId of touchedStores) invalidateStore(storeId);
    console.log(`[backfill] invalidated ${touchedStores.size} storefront cache(s)`);
  }

  await disconnectDB();
  process.exit(tally.failures > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error('[backfill] failed:', err.message);
  try {
    await disconnectDB();
  } catch {
    /* never opened, or already closed */
  }
  process.exit(1);
});
