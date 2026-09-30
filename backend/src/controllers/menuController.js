import mongoose from 'mongoose';
import NavMenu from '../models/NavMenu.js';
import Product from '../models/Product.js';
import Store from '../models/Store.js';
import { HttpError } from '../middleware/errorHandler.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { slugify } from '../utils/slug.js';
import { loadManageableStore } from '../utils/storeAccess.js';
import {
  dedupe,
  getCached,
  getCachedBySlug,
  invalidateStore,
  rememberSlug,
  setCached,
  SLOTS,
} from '../utils/storefrontCache.js';

/** Public nav targets a merchant can wire a menu item to. */
const VALID_TARGETS = ['product', 'category', 'url'];

/**
 * Turns the flat list of menu rows into a nested tree keyed by `parent`.
 *
 * `productMap` (built in the public endpoint) lets us attach a ready-to-use
 * `href` + `targetLabel` to every node so the storefront `<nav>` never needs a
 * second round-trip to resolve product names / categories.
 */
function buildTree(items, productMap) {
  const byId = new Map();
  const root = [];

  for (const raw of items) {
    const node = { ...raw };
    node.id = String(node._id || node.id);
    node.children = [];

    if (productMap) {
      if (node.targetType === 'product' && node.target) {
        const p = productMap.get(String(node.target));
        node.targetLabel = p ? p.name : node.target;
        if (p && p.category && p.category.trim()) {
          node.href = `?category=${encodeURIComponent(p.category)}`;
        } else {
          node.href = `?search=${encodeURIComponent(p ? p.name : '')}`;
        }
      } else if (node.targetType === 'category' && node.target) {
        node.targetLabel = node.target;
        node.href = `?category=${encodeURIComponent(node.target)}`;
      } else if (node.targetType === 'url' && node.target) {
        node.targetLabel = node.target;
        node.href = node.target;
      } else {
        node.href = '';
        node.targetLabel = '';
      }
    }

    byId.set(node.id, node);
  }

  for (const raw of items) {
    const nodeId = String(raw._id || raw.id);
    const node = byId.get(nodeId);
    if (!node) continue;
    const parentId = raw.parent ? String(raw.parent) : null;
    if (!parentId) {
      root.push(node);
    } else {
      const parent = byId.get(parentId);
      if (parent) parent.children.push(node);
    }
  }

  /* Sort siblings by position at every level so dropdown / mega-menu column
     order matches the order set in the theme builder. */
  const byPosition = (a, b) => (a.position || 0) - (b.position || 0);
  for (const node of byId.values()) {
    if (node.children.length > 1) node.children.sort(byPosition);
  }

  return root.sort(byPosition);
}

/** Ceiling on a store's curated category list, so the picker cannot grow
 *  without bound. A real shop is nowhere near this. */
const MAX_CATEGORIES = 60;

/** Longest a single category name may be. */
const MAX_CATEGORY_NAME = 60;

/**
 * Escape a string for literal use inside a RegExp.
 *
 * A category name is typed by a human, so it can legally contain characters
 * that mean something to a pattern. Deleting "Drinks" must never turn into
 * deleting every product whose category merely *starts* the same way, and a
 * name containing a `(` must not throw a SyntaxError.
 */
function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Every category a store trades in, as `[{ name, count }]`, sorted by name.
 *
 * TWO sources, unioned, and both are needed:
 *
 *   1. The store's own curated `categories` list. A merchant can create a
 *      section in the theme builder BEFORE the first product exists, which is
 *      the point of being able to create one at all.
 *   2. The distinct `category` strings already sitting on the store's
 *      products, so every product ever filed still gets a section even if
 *      nobody ever curated anything.
 *
 * Matching is CASE-INSENSITIVE: "Drinks" and "drinks" are one category, not
 * two that each show half the stock under a heading that looks identical. When
 * the two sources disagree on spelling, the CURATED one wins, because that is
 * the name the merchant typed and therefore the one they expect to read as
 * their section heading. So curated names are seeded into the map first.
 *
 * `count` is how many products are actually filed under the name, which is 0
 * for a section created ahead of its first product. The theme builder shows
 * it so a merchant can see which of their sections are still empty.
 *
 * `image` is the store's picture for the category, or '' when none was
 * uploaded - it is what the storefront section card is built from. Looked up
 * through the same lowercased key the rest of this function matches on, so a
 * category filed as "DRINKS" still shows the picture uploaded for "Drinks".
 *
 * `productRows` lets a caller pass a projection it has already loaded, so the
 * theme editor - which needs product names anyway - does not read the same
 * collection twice.
 */
async function listCategories(
  storeId,
  storeCategories = [],
  productRows = null,
  categoryImages = {},
) {
  const rows =
    productRows ??
    (await Product.find({ store: storeId }).select('category').lean());

  // The image map is keyed by lowercased name. Read defensively: an older
  // store document has no such field at all, and `undefined[key]` would throw.
  const images =
    categoryImages && typeof categoryImages === 'object' ? categoryImages : {};

  // What is genuinely on the shelf. Counted first, and separately, because a
  // curated name is a heading and does not make a product exist.
  const counts = new Map();
  for (const row of rows) {
    const name = String(row?.category || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const byKey = new Map();
  const put = (rawName) => {
    const name = String(rawName || '').trim();
    if (!name) return;
    const key = name.toLowerCase();
    // First spelling wins, and curated names are offered first.
    if (byKey.has(key)) return;
    byKey.set(key, {
      name,
      count: counts.get(key) || 0,
      image: String(images?.[key] || '').trim(),
    });
  };

  for (const name of Array.isArray(storeCategories) ? storeCategories : []) {
    put(name);
  }
  for (const row of rows) put(row.category);

  return [...byKey.values()].sort((a, b) =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
  );
}

/**
 * GET /api/menu/:slug  (public)
 *
 * What the customer storefront calls to render its navbar. Returns a nested
 * tree of the store's visible nav items. When the store has never configured a
 * menu we auto-build one from its product categories so the navbar is never
 * empty out of the gate.
 */
export const getStoreMenu = asyncHandler(async (req, res) => {
  const slug = slugify(req.params.slug, '');
  if (!slug) throw new HttpError(404, 'That store does not exist.');

  /* Warm-first, like the two public store routes and for the same measured
     reason: this route used to cost ~3.2s on every storefront load, and
     ShopPage fires it IN PARALLEL with the store request - so however fast the
     store endpoint became, the page still waited on this one. Caching it is what
     actually makes opening a shop quick, not just making half of it quick. */
  const warm = getCachedBySlug(slug, SLOTS.MENU);
  if (warm) {
    res.json(warm);
    return;
  }

  const store = await Store.findOne({ slug, isActive: true });
  if (!store) throw new HttpError(404, 'That store does not exist or is closed.');

  rememberSlug(store.slug, store._id);

  const cached = getCached(store._id, SLOTS.MENU);
  if (cached) {
    res.json(cached);
    return;
  }

  /* The Navbar and the ShopPage both ask for the menu on one page load, so the
     same collapse as the store route: concurrent callers share one execution
     rather than each paying its own multi-second build. */
  const payload = await dedupe(SLOTS.MENU, store._id, async () => {
    const fresh = getCached(store._id, SLOTS.MENU);
    if (fresh) return fresh;

    let items = await NavMenu.find({ store: store._id, isVisible: true })
      .sort({ position: 1 })
      .lean();

    /* Auto-seed from the store's categories when the menu has never been built.
       Reads the curated list too, not just the product-derived names, so a
       section the merchant created in the theme builder is nav-able from the
       moment it exists. */
    if (!items.length) {
      const categories = await listCategories(
        store._id,
        store.categories,
        null,
        store.categoryImages,
      );
      if (categories.length) {
        const seed = categories.map((cat, i) => ({
          store: store._id,
          label: cat.name,
          targetType: 'category',
          target: cat.name,
          position: i,
          isVisible: true,
        }));
        await NavMenu.insertMany(seed);
        items = await NavMenu.find({ store: store._id, isVisible: true })
          .sort({ position: 1 })
          .lean();
      }
    }

    /* Resolve product names/categories so the public nav needs no extra calls. */
    const productMap = new Map();
    const productTargets = items
      .filter(
        (i) =>
          i.targetType === 'product' && i.target &&
          mongoose.isValidObjectId(i.target),
      )
      .map((i) => i.target);

    if (productTargets.length) {
      const products = await Product.find({ _id: { $in: productTargets } })
        .select('name category')
        .lean();
      for (const p of products) productMap.set(String(p._id), p);
    }

    const built = { menu: buildTree(items, productMap), store };
    setCached(store._id, SLOTS.MENU, built, store.slug);
    return built;
  });

  res.json(payload);
});

/**
 * GET /api/menu/edit/:storeId  (store owner / store admin / platform admin)
 *
 * The theme editor loads the flat list (each item with its `parentId` so the
 * UI can rebuild the tree), plus the store's categories and products so the
 * dropdowns are pre-populated and the category panel can show what each
 * section currently holds.
 *
 * The product projection is loaded unconditionally rather than only when some
 * menu item points at a product. It is two fields, and the category counts it
 * feeds are shown on the page whether or not the nav uses any - a conditional
 * load would mean the editor's own category panel silently shows "0 products"
 * for a store that has never wired a product into its nav.
 */
export const listStoreMenu = asyncHandler(async (req, res) => {
  const { store } = await loadManageableStore(req.params.storeId, req.user);

  const [items, products, categories] = await Promise.all([
    NavMenu.find({ store: store._id }).sort({ position: 1 }).lean(),
    Product.find({ store: store._id }).select('name category').lean(),
    listCategories(store._id, store.categories, null, store.categoryImages),
  ]);

  res.json({
    store,
    items: items.map((i) => ({
      id: String(i._id),
      label: i.label,
      targetType: i.targetType,
      target: i.target,
      parentId: i.parent ? String(i.parent) : null,
      position: i.position,
      isVisible: i.isVisible,
    })),
    categories,
    products: products.map((p) => ({
      id: String(p._id),
      name: p.name,
      category: p.category,
    })),
  });
});

/**
 * PUT /api/menu/edit/:storeId  (store owner / platform admin)
 *
 * Replaces the entire menu for a store in a single transaction. The client
 * sends the full flat array (with temp ids for brand-new rows); the server
 * clears the old rows, re-creates everything, and maps temp ids to the real
 * MongoDB _ids so parent links survive.
 */
export const saveStoreMenu = asyncHandler(async (req, res) => {
  const { store } = await loadManageableStore(req.params.storeId, req.user);
  const items = Array.isArray(req.body?.items) ? req.body.items : [];

  /* --- Validate every incoming row ----------------------------------- */
  for (const item of items) {
    if (!item.label || !String(item.label).trim()) {
      throw new HttpError(400, 'Every menu item needs a label.');
    }
    if (!VALID_TARGETS.includes(item.targetType)) {
      throw new HttpError(
        400,
        `targetType must be one of ${VALID_TARGETS.join(', ')}.`
      );
    }
    if (!item.target || !String(item.target).trim()) {
      throw new HttpError(400, 'Every menu item needs a target.');
    }

    if (item.targetType === 'product') {
      if (!mongoose.isValidObjectId(item.target)) {
        throw new HttpError(400, 'Product targets must reference a product id.');
      }
      const exists = await Product.exists({
        _id: item.target,
        store: store._id,
      });
      if (!exists) {
        throw new HttpError(404, 'That product does not exist in this store.');
      }
    }

    if (item.targetType === 'url') {
      const t = String(item.target);
      if (!/^(https?:)?\/\//i.test(t) && !t.startsWith('/')) {
        throw new HttpError(400, 'URLs must start with http://, https://, or /.');
      }
    }
  }

  /* --- Parent refs must point at another row in the same batch ------- */
  const batchIds = new Set(items.map((i) => String(i.id)));
  for (const item of items) {
    if (item.parentId && !batchIds.has(String(item.parentId))) {
      throw new HttpError(400, 'Parent must reference another item in this batch.');
    }
    if (item.parentId && String(item.parentId) === String(item.id)) {
      throw new HttpError(400, 'An item cannot be its own parent.');
    }
  }

  /* --- Persist: wipe old rows, recreate new ones, fix parent links -- */
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    await NavMenu.deleteMany({ store: store._id }, { session });

    /* Parents before children so we can resolve the new _ids. */
    const sorted = [...items].sort((a, b) => {
      const aParent = a.parentId ? 1 : 0;
      const bParent = b.parentId ? 1 : 0;
      return aParent - bParent || (a.position || 0) - (b.position || 0);
    });

    const tempIdMap = new Map();

    for (const item of sorted) {
      const parentId = item.parentId
        ? tempIdMap.get(String(item.parentId))
        : null;

      if (item.parentId && !parentId) {
        throw new HttpError(400, 'Parent item was not found earlier in the batch.');
      }

      const [created] = await NavMenu.create(
        [
          {
            store: store._id,
            label: String(item.label || '').trim(),
            targetType: item.targetType,
            target: String(item.target || '').trim(),
            parent: parentId,
            position: Number(item.position || 0),
            isVisible: item.isVisible !== false,
          },
        ],
        { session }
      );

      tempIdMap.set(String(item.id), String(created._id));
    }

    await session.commitTransaction();
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }

  const updated = await NavMenu.find({ store: store._id })
    .sort({ position: 1 })
    .lean();

  // The storefront nav is one of the cached public reads, and this rewrote all
  // of it. Invalidated after the transaction commits, never inside it: dropping
  // the cache is not part of the write, and a rollback must not leave the cache
  // cleared for a menu that was never saved.
  invalidateStore(store._id);

  res.json({
    items: updated.map((i) => ({
      id: String(i._id),
      label: i.label,
      targetType: i.targetType,
      target: i.target,
      parentId: i.parent ? String(i.parent) : null,
      position: i.position,
      isVisible: i.isVisible,
    })),
  });
});

/**
 * POST /api/menu/edit/:storeId/categories  (store owner / store admin / admin)
 *
 * Create a category. Body: `{ name }`.
 *
 * This is the "add a section" action in the theme builder, and the name it
 * takes is the storefront section heading - "Drinks" here is the "Drinks" a
 * shopper scrolls past on their phone.
 *
 * Creating one does NOT need a product to exist yet. The whole reason to
 * curate a list separately from the products is that a merchant lays out their
 * shop before they stock it, and every product filed under this name later
 * drops into the section automatically - nothing has to be re-linked by hand.
 *
 * Duplicates are rejected rather than merged. Same name in a different case
 * ("drinks" when "Drinks" exists) is the same category, and silently creating a
 * second one would split the section in two, each showing half the stock under
 * a heading that looks the same.
 */
export const createCategory = asyncHandler(async (req, res) => {
  const { store } = await loadManageableStore(req.params.storeId, req.user);

  const name = String(req.body?.name || '').trim();
  if (!name) throw new HttpError(400, 'A category needs a name.');
  if (name.length > MAX_CATEGORY_NAME) {
    throw new HttpError(
      400,
      `A category name can be at most ${MAX_CATEGORY_NAME} characters.`,
    );
  }

  const current = Array.isArray(store.categories) ? store.categories : [];
  if (current.some((entry) => String(entry).trim().toLowerCase() === name.toLowerCase())) {
    throw new HttpError(409, `"${name}" is already a category.`);
  }
  if (current.length >= MAX_CATEGORIES) {
    throw new HttpError(
      400,
      `A store can have at most ${MAX_CATEGORIES} categories.`,
    );
  }

  // The model's setter trims and de-dupes, so this append is all it takes.
  store.categories = [...current, name];
  await store.save();

  // Theme 1 sections are read from the cached store document on every
  // storefront load, so a new one has to push it out.
  invalidateStore(store._id);

  res.status(201).json({
    categories: await listCategories(
      store._id,
      store.categories,
      null,
      store.categoryImages,
    ),
  });
});

/**
 * GET /api/menu/edit/:storeId/categories  (store owner / store admin / admin)
 *
 * The store's categories and nothing else, for a picker - the product form's
 * "Category" dropdown.
 *
 * A separate read rather than reusing `listStoreMenu` on purpose. That endpoint
 * is built for the theme builder and returns the whole nav tree, every product
 * in the store, and the store document itself - which carries `categoryImages`,
 * a map of base64 data URLs of up to 1MB EACH. The picker needs a list of words,
 * so pulling megabytes of photographs down to render a dropdown would be absurd.
 * The images are dropped here for the same reason; a `<select>` cannot show one.
 *
 * The NAMES, and the live product count, are identical to what the theme panel
 * shows because both come from the same `listCategories`. That is not a
 * convenience - it is the contract the picker depends on. A product filed under
 * a name the merchant never curated still appears in this list, so offering the
 * picker cannot lose a category that is already on a product; restricting it to
 * the curated list would blank that product's category the moment it was opened
 * for editing.
 */
export const listStoreCategories = asyncHandler(async (req, res) => {
  const { store } = await loadManageableStore(req.params.storeId, req.user);

  // No categoryImages argument: nothing here renders a picture, so the base64
  // is never read, let alone sent.
  const categories = await listCategories(store._id, store.categories);

  res.json({
    /* The store's active theme, so the product form can decide which category
       picker to show from THIS response rather than needing a second call just
       to find out.

       It matters which endpoint carries it. This one is what every catalogue
       editor calls, and on Theme 1 - which is every store that has not
       deliberately switched - it is the ONLY call they make. Putting the theme on
       the tree endpoint instead would mean asking every Theme 1 merchant to
       fetch a tree they will never use, purely to be told which theme they are
       already on. */
    theme: store.theme || 'theme1',
    categories: categories.map(({ name, count }) => ({ name, count })),
  });
});

/**
 * DELETE /api/menu/edit/:storeId/categories/:name
 *
 * Delete a category, and unfile the products that were in it.
 *
 * The two halves HAVE to move together, which is worth spelling out because it
 * is the one destructive decision in this feature. A storefront section is
 * built from BOTH the curated list and the names on the products, so
 * un-curating on its own would leave "Drinks" visible in this panel while its
 * products silently slid into an "Other items" section - the heading would
 * still be there, holding nothing. Deleting a category means "we stopped
 * selling this", so the products have to move too.
 *
 * They are UNFILED, never destroyed. `category` is cleared to '' and the
 * products stay exactly as they are - still listed, still buyable, still with
 * their full history. A re-created "Drinks" picks them straight back up. The
 * alternative, refusing to delete a non-empty category, would mean a merchant
 * could never get rid of a section without first editing every product in it.
 *
 * A category exists in EITHER of two places, and the delete button appears for
 * both, so this handler has to accept both:
 *
 *   - the store's curated `categories` list (created in the theme builder)
 *   - the distinct names on the store's products (a product was filed under
 *     "Bakery" and the name was never curated)
 *
 * The second is the common case, and it is why the "does this exist?" test
 * below looks at the products too. Checking only the curated list made delete
 * return 404 for almost every category the panel displayed - the row was there,
 * the button was there, and pressing it silently did nothing.
 *
 * The name is matched case-insensitively against the whole field, not as a
 * prefix: "Drinks" must not take "Drinks &Juices" with it.
 */
export const deleteCategory = asyncHandler(async (req, res) => {
  const { store } = await loadManageableStore(req.params.storeId, req.user);

  // Express has already percent-decoded the path segment, so this must NOT be
  // decoded again - a category literally named "100% juice" would come back as
  // a malformed URI.
  const name = String(req.params.name || '').trim();
  if (!name) throw new HttpError(400, 'A category needs a name.');

  const key = name.toLowerCase();
  const current = Array.isArray(store.categories) ? store.categories : [];
  const next = current.filter((entry) => String(entry).trim().toLowerCase() !== key);
  const wasCurated = next.length !== current.length;

  /* The same whole-field, case-insensitive match the product update below uses.
     Both have to agree, or a category could be reported as deleted while its
     products quietly kept the old name. */
  const categoryFilter = {
    store: store._id,
    category: { $regex: `^${escapeRegExp(key)}$`, $options: 'i' },
  };

  /* Only a 404 if the name is in NEITHER place. Counting the products first
     also means a category that exists solely as a product name still clears
     those products instead of being rejected as unknown. */
  const inUse = await Product.countDocuments(categoryFilter);
  if (!wasCurated && inUse === 0) {
    throw new HttpError(404, `"${name}" is not one of this store's categories.`);
  }

  /* Only write when the curated list actually changes. A delete of a
     product-only category leaves `store.categories` alone, which avoids a
     pointless write and, more importantly, avoids running the model's setter
     over a list we did not mean to touch. */
  if (wasCurated) {
    store.categories = next;
    await store.save();
  }

  const cleared = await Product.updateMany(categoryFilter, {
    $set: { category: '' },
  });

  /* The products that were in this category have just lost it, so the cached
     product list is wrong as well as the cached section list. */
  invalidateStore(store._id);

  /* Drop the picture too.

     The image lives in a SEPARATE map keyed by name, so removing the category
     from the curated list does not touch it - the entry is simply orphaned, and
     orphaned is not cheap here: each value is a base64 data URL of up to 1MB
     sitting inside the store document forever, on a document the storefront
     reads on every single page load. Deleting a category has to take its
     picture with it, or a merchant who reworks their sections grows the
     document steadily while never seeing any of it on screen.

     Written separately, and only when there was a picture, so the ordinary
     delete stays a single save. */
  const images = { ...(store.categoryImages || {}) };
  if (Object.prototype.hasOwnProperty.call(images, key)) {
    delete images[key];
    store.categoryImages = images;
    await store.save();
  }

  res.json({
    categories: await listCategories(
      store._id,
      store.categories,
      null,
      store.categoryImages,
    ),
    // So the panel can say what happened rather than the list simply changing.
    clearedProducts: cleared.modifiedCount || 0,
  });
});

/**
 * Is `value` a base64 data URL for an image type we are willing to store?
 *
 * A category picture is rendered inside an <img> on a public storefront, so the
 * value is attacker-controlled markup-adjacent data. Checking the prefix is
 * what keeps an `http(s)://` URL (a tracker beacon that follows the shopper
 * around, stored on someone else's host) or a `javascript:` URL out of the
 * database. Only real inline image payloads are accepted.
 *
 * The length cap matters too: this is a resized PNG in a document, and an
 * unbounded base64 string on a field the storefront reads on every page load
 * is a denial-of-service lever aimed at the shopper's phone.
 */
const ALLOWED_IMAGE = /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/]+=*$/;
const MAX_IMAGE_BYTES = 1024 * 1024;

function isAllowedImageDataUrl(value) {
  if (typeof value !== 'string') return false;
  if (!ALLOWED_IMAGE.test(value)) return false;

  // The base64 payload is ~4 chars per 3 bytes; compare on the payload only,
  // not the whole data URL, so the cap means what it says.
  const base64 = value.slice(value.indexOf(',') + 1);
  return Math.floor((base64.length * 3) / 4) <= MAX_IMAGE_BYTES;
}

/**
 * PUT /api/menu/edit/:storeId/categories/:name/image
 *
 * Set or clear a category's picture. Body: `{ image }` - a base64 data URL, or
 * '' to remove the picture.
 *
 * A data URL rather than a multipart upload, matching how the store logo is
 * already handled (see services/storeService.js): the client downscales the
 * file to a card-sized image on a canvas before sending, so what arrives is a
 * small PNG with no file on disk, no upload directory, and no static route
 * needed to serve it. A category picture is decorative and small, so a resized
 * data URL is the whole story here.
 *
 * The name must already exist as a category - curated or product-derived - for
 * the same reason delete insists on it: the picture decorates a section, and
 * storing one for a name with no section would leave an image nothing could
 * ever display.
 */
export const setCategoryImage = asyncHandler(async (req, res) => {
  const { store } = await loadManageableStore(req.params.storeId, req.user);

  // Express has already percent-decoded this segment - see deleteCategory.
  const name = String(req.params.name || '').trim();
  if (!name) throw new HttpError(400, 'A category needs a name.');

  const key = name.toLowerCase();

  /* The category has to exist. Reusing `listCategories` rather than repeating
     its matching rule means this existence test and the list the client renders
     can never disagree about what counts as a category. */
  const existing = await listCategories(
    store._id,
    store.categories,
    null,
    store.categoryImages,
  );
  if (!existing.some((c) => c.name.toLowerCase() === key)) {
    throw new HttpError(404, `"${name}" is not one of this store's categories.`);
  }

  const image = String(req.body?.image ?? '').trim();
  const images = { ...(store.categoryImages || {}) };

  if (!image) {
    /* Clearing drops the key entirely rather than storing '', so a removed
       picture leaves nothing behind for a later re-created category to
       inherit. */
    delete images[key];
  } else {
    if (!isAllowedImageDataUrl(image)) {
      throw new HttpError(
        400,
        'That image could not be used. Pick a PNG, JPG, WEBP or GIF under 1 MB.',
      );
    }
    images[key] = image;
  }

  store.categoryImages = images;
  await store.save();

  // A picture is storefront content, and this is the write that changes it.
  invalidateStore(store._id);

  res.json({
    categories: await listCategories(
      store._id,
      store.categories,
      null,
      store.categoryImages,
    ),
  });
});


export default {
  getStoreMenu,
  listStoreMenu,
  listStoreCategories,
  saveStoreMenu,
  createCategory,
  deleteCategory,
  setCategoryImage,
};