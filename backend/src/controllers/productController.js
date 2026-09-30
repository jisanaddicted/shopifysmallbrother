import mongoose from 'mongoose';
import CategoryNode from '../models/CategoryNode.js';
import Product from '../models/Product.js';
import Store from '../models/Store.js';
import { HttpError } from '../middleware/errorHandler.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { PRODUCT_STATUS, PRODUCT_STATUS_VALUES } from '../utils/constants.js';
import { slugify } from '../utils/slug.js';
import { managedStoreIds, storesForUser } from '../utils/storeAccess.js';
import { invalidateStore } from '../utils/storefrontCache.js';
import { hasVariants, variantTitle } from '../utils/variants.js';

// Guardrails on the variant matrix, matching the 100-variant ceiling every
// mainstream shop uses. They exist to turn an enormous generated matrix into a
// clear 400 rather than a request that times out halfway through being saved.
const MAX_OPTIONS = 3;
const MAX_VALUES_PER_OPTION = 50;
const MAX_VARIANTS = 100;

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The stores this account may keep products in: the one it signed up (owner)
 * plus every store it was appointed to run (accepted store-admin membership).
 *
 * `requireProductManager` already resolved them onto `req.stores`, so reuse
 * that instead of asking the database the same question twice.
 */
async function storesFor(req) {
  if (Array.isArray(req.stores) && req.stores.length) return req.stores;
  return storesForUser(req.user);
}

/**
 * Which store a new product belongs to.
 *
 * Somebody who runs exactly one store does not have to say - it is pinned for
 * them. Somebody who runs several has to name one, and it must be a store they
 * actually run; that is what stops a member from planting a product in
 * another merchant's catalogue. A platform admin resolves the same way now -
 * naming a store they run, or letting the single-store default pin it.
 */
async function pickTargetStore({ requestedId, stores }) {
  const allowed = stores.map((entry) => String(entry.store._id));

  if (requestedId) {
    if (!allowed.includes(String(requestedId))) {
      throw new HttpError(403, 'That store does not belong to you.');
    }
    return requestedId;
  }

  if (allowed.length === 1) return allowed[0];

  if (allowed.length === 0) {
    throw new HttpError(
      400,
      'No store is linked to your account. Accept a store invitation before adding products.',
    );
  }

  throw new HttpError(
    400,
    'You run several stores. Say which store this product belongs to.',
  );
}

/**
 * Loads a product the caller may edit. Everybody must run the store it belongs
 * to - as its owner, or as an accepted store admin for it. A platform admin
 * qualifies exactly the same way: through the stores they actually run, never
 * platform-wide.
 */
async function loadEditableProduct(productId, user) {
  if (!mongoose.isValidObjectId(productId)) {
    throw new HttpError(400, 'That product id is not valid.');
  }

  const product = await Product.findById(productId);
  if (!product) throw new HttpError(404, 'That product does not exist.');

  const allowed = await managedStoreIds(user);
  if (!product.store || !allowed.map(String).includes(String(product.store))) {
    throw new HttpError(403, 'That product does not belong to your store.');
  }

  return product;
}

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * A request body that speaks about a boolean three different ways.
 *
 * A JSON body sends `true`; a form-encoded one sends "true"; and a checkbox
 * that was never ticked sends nothing at all. All three have to mean the same
 * thing here, because getting it wrong on `trackInventory` is not cosmetic -
 * it decides whether a product can be bought at all.
 */
const toBoolean = (value, fallback = true) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['true', '1', 'yes', 'on'].includes(String(value).trim().toLowerCase());
};

/** Pulls the editable fields out of a request body, ignoring anything else. */
function readProductPayload(body = {}) {
  return {
    name: String(body.name || '').trim(),
    price: toNumber(body.price, 0),
    category: String(body.category || '').trim(),
    /* The Theme 2 tree node, when the client sends one.

       Absent means "leave it alone", which is NOT the same as sending null: this
       is how the storefront's unfile-on-delete works, and how a Theme 1 edit
       leaves a product's place in the tree alone. An old client that has never
       heard of `categoryId` therefore cannot unfile a product by omitting the
       key, exactly as it cannot unpublish one. */
    categoryId:
      body.categoryId === null || body.categoryId === ''
        ? null
        : body.categoryId || undefined,
    rack: String(body.rack || '').trim(),
    shelf: String(body.shelf || '').trim(),
    stock: body.stock === '' || body.stock === undefined ? 0 : toNumber(body.stock, 0),
    image: String(body.image || '').trim(),
    description: String(body.description || '').trim(),
  };
}

/**
 * The publishing + organisation block, which follows the same "only if the
 * client sent it" rule the variant block uses.
 *
 * The distinction that matters: the eight fields above are ALWAYS written, so
 * an old client that PUTs a name and a price blanks the rest exactly as it
 * always did. These five are only written when the key is present, because a
 * client that has never heard of `status` must not be able to un-publish a
 * product or switch its stock tracking off by omission. `undefined` therefore
 * means "leave this alone" and is different from an explicit `null`.
 *
 * An unrecognised status is a 400 rather than a silent fallback: quietly
 * saving it as `active` would put a product on the shelf that the merchant
 * believed was a draft.
 */
function readOrganisationBlock(body = {}) {
  const block = {};

  if (body.status !== undefined) {
    const status = String(body.status || '').trim();
    if (!PRODUCT_STATUS_VALUES.includes(status)) {
      throw new HttpError(
        400,
        `“${status || '(blank)'}” is not a product status. Use ${PRODUCT_STATUS_VALUES.join(', ')}.`,
      );
    }
    block.status = status;
  }

  if (body.trackInventory !== undefined) {
    block.trackInventory = toBoolean(body.trackInventory, true);
  }

  if (body.productType !== undefined) {
    block.productType = String(body.productType || '').trim().slice(0, 60);
  }

  if (body.vendor !== undefined) {
    block.vendor = String(body.vendor || '').trim().slice(0, 80);
  }

  if (body.collections !== undefined) {
    if (!Array.isArray(body.collections)) {
      throw new HttpError(400, 'Collections must be a list of names.');
    }

    // Trimmed, de-duplicated and capped, so a pasted list cannot bloat the
    // document or produce two chips that read identically.
    const seen = new Set();
    const collections = [];

    for (const entry of body.collections.slice(0, 25)) {
      const name = String(entry ?? '').trim().slice(0, 40);
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      collections.push(name);
    }

    block.collections = collections;
  }

  return block;
}

/**
 * The variation axes, cleaned up.
 *
 * Two rounds of filtering, and both matter: a blank-named option is dropped
 * outright, and a blank VALUE is dropped from an option that is otherwise fine.
 * A merchant halfway through typing "Size: S, M, , L" gets three values, not
 * four - otherwise the generated matrix fills with a blank row they then have to
 * notice and delete.
 *
 * Duplicate option names are collapsed, keeping the first, because the variants
 * key their values by option name: two options both called "Size" would make
 * every variant's Size value ambiguous.
 */
function readOptions(raw) {
  if (!Array.isArray(raw)) return [];

  const seen = new Set();
  const options = [];

  for (const entry of raw) {
    const name = String(entry?.name || '').trim().slice(0, 40);
    if (!name || seen.has(name)) continue;
    seen.add(name);

    const values = [];
    const taken = new Set();
    for (const value of Array.isArray(entry?.values) ? entry.values : []) {
      const clean = String(value ?? '').trim().slice(0, 60);
      if (!clean || taken.has(clean)) continue;
      taken.add(clean);
      values.push(clean);
    }

    if (!values.length) continue;
    if (values.length > MAX_VALUES_PER_OPTION) {
      throw new HttpError(
        400,
        `“${name}” has more than ${MAX_VALUES_PER_OPTION} values. Split it into two options.`,
      );
    }

    options.push({ name, values });
    if (options.length > MAX_OPTIONS) {
      throw new HttpError(
        400,
        `A product can have at most ${MAX_OPTIONS} options (e.g. Size, Colour, Material).`,
      );
    }
  }

  return options;
}

/**
 * The variant rows, cleaned up and checked against the options.
 *
 * `existingIds` are the `_id`s already on the product being edited. An incoming
 * row whose id is in that set is an EDIT and keeps its id; anything else is a
 * new row and gets a fresh one. That distinction is the whole reason this takes
 * the previous state: without it, every save would mint new ids for every row,
 * and every cart, order and receipt already pointing at the old ones would be
 * left referring to variants that no longer exist.
 *
 * A row whose `optionValues` name an option the product does not declare is
 * dropped, and so is one that is now a duplicate of a row already seen - a
 * matrix that has been hand-edited can easily contain both.
 */
function readVariants(raw, options, existingIds) {
  if (!Array.isArray(raw)) return [];
  if (!options.length) return [];

  const optionNames = new Set(options.map((option) => option.name));
  const variants = [];
  const seenCombos = new Set();
  const known = new Set(existingIds.map(String));

  for (const entry of raw) {
    const values = entry?.optionValues || {};
    if (typeof values !== 'object') continue;

    // Only declared options count; anything else is noise from a stale form.
    const optionValues = {};
    let complete = true;
    for (const name of optionNames) {
      const value = String(values[name] ?? '').trim();
      if (!value) {
        complete = false;
        break;
      }
      optionValues[name] = value;
    }
    if (!complete) continue;

    const comboKey = optionNames.size
      ? [...optionNames].map((name) => optionValues[name]).join(' ')
      : '';
    if (seenCombos.has(comboKey)) continue;
    seenCombos.add(comboKey);

    const incomingId = String(entry?._id || entry?.id || '').trim();
    const keepId = known.has(incomingId);

    const compareAt = entry?.compareAtPrice;
    variants.push({
      ...(keepId ? { _id: incomingId } : {}),
      title: variantTitle({ optionValues, title: entry?.title }),
      sku: String(entry?.sku || '').trim().slice(0, 60),
      price: Math.max(0, toNumber(entry?.price, 0)),
      // A compare-at of 0 is not "free was 0", it is "no compare-at". Stored as
      // null so the storefront does not strike through a real price with a zero.
      compareAtPrice:
        compareAt === '' || compareAt === undefined || compareAt === null
          ? null
          : Math.max(0, toNumber(compareAt, 0)),
      stock: Math.max(0, toNumber(entry?.stock, 0)),
      image: String(entry?.image || '').trim(),
      optionValues,
      enabled: entry?.enabled === false ? false : true,
    });

    if (variants.length > MAX_VARIANTS) {
      throw new HttpError(
        400,
        `That is more than ${MAX_VARIANTS} variants. Reduce the options or remove a value.`,
      );
    }
  }

  return variants;
}

/**
 * Reads the whole variation block off a request body.
 *
 * A body with no `options`/`variants` keys at all means "the client is not
 * managing variants" and returns null, so the caller can leave the product's
 * existing variants alone. That is what makes this safe to add to the existing
 * update path: an older client that only knows the eight original fields simply
 * never sends them, and cannot accidentally wipe a merchant's matrix.
 */
function readVariantBlock(body, existingIds = []) {
  if (!body || (!Array.isArray(body.options) && !Array.isArray(body.variants))) {
    return null;
  }

  const options = readOptions(body.options);
  const variants = readVariants(body.variants, options, existingIds);

  // Options with no rows behind them are kept: the merchant is mid-edit, and the
  // product still behaves like a plain product until the matrix exists.
  return { options, variants };
}

/**
 * GET /api/products?search=&category=&status=&page=&limit=
 * Responds { products, page, pages, total }.
 *
 * `status` defaults to `active`, and that default is the safety property that
 * matters here: a draft is a work in progress and an archived item is finished
 * with, so neither belongs on a public shelf. Any caller that has not heard of
 * statuses - the storefront, the shop page, an old client - therefore keeps
 * seeing exactly the products it saw before this field existed, and the
 * back office has to ask for the others on purpose with `status=all`.
 */
export const listProducts = asyncHandler(async (req, res) => {
  const { search, category, store: storeParam } = req.query;
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 100));

  // `all` is the only value that widens the result set; every other value is a
  // narrowing filter. An unrecognised value is treated as `all` rather than
  // 400-ing, so a bad query string shows the merchant their whole catalogue
  // instead of an error page.
  const statusParam = String(req.query.status ?? '').trim().toLowerCase();
  const status = !statusParam
    ? PRODUCT_STATUS.ACTIVE
    : statusParam === 'all' || !PRODUCT_STATUS_VALUES.includes(statusParam)
      ? 'all'
      : statusParam;

  const filter = {};

  if (status !== 'all') {
    // A product saved before this field existed has NO `status` in Mongo, and a
    // Mongoose default is applied when a document is HYDRATED, not when a query
    // runs - so `{ status: 'active' }` alone would match none of the existing
    // catalogue and silently empty every storefront. The `$exists: false` arm
    // is what makes "no status" mean active, which is exactly what it meant
    // before the field existed.
    filter.$or = status === PRODUCT_STATUS.ACTIVE
      ? [{ status }, { status: { $exists: false } }]
      : [{ status }];
  }

  // `store` may be an id or a public slug, so the store page can pass either.
  if (storeParam) {
    const store = mongoose.isValidObjectId(storeParam)
      ? await Store.findById(storeParam)
      : await Store.findOne({ slug: slugify(storeParam, '') });

    if (!store) throw new HttpError(404, 'That store does not exist.');
    filter.store = store._id;
  }

  if (category && category !== 'all') {
    filter.category = category;
  }

  if (search && String(search).trim()) {
    // Case-insensitive partial match across the fields the storefront searches
    // - plus rack and shelf, so typing "A3" finds what sits in rack A3 without
    // anybody having to remember the product name.
    const term = new RegExp(escapeRegExp(String(search).trim()), 'i');

    // Matches the new organisation fields too: a merchant who has just filed
    // something under a product type or a vendor expects to find it there, the
    // same way they expect a rack number to work.
    //
    // `$and` rather than a second `$or` on the same object: a filter can only
    // have one `$or` key, so combining the two this way is what lets a search
    // and a status filter both apply at once instead of one silently winning.
    filter.$and = [
      {
        $or: [
          { name: term },
          { description: term },
          { category: term },
          { rack: term },
          { shelf: term },
          { productType: term },
          { vendor: term },
          { collections: term },
          { 'variants.sku': term },
        ],
      },
    ];
  }

  const [products, total] = await Promise.all([
    Product.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Product.countDocuments(filter),
  ]);

  res.json({
    products,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
    total,
  });
});

/**
 * GET /api/products/:id -> { product }
 *
 * A draft or an archived product is a 404 here, not a 403. Nobody browsing a
 * shop has any business knowing an unpublished product exists - the id is
 * guessable and a 403 would confirm it - and the back office does not use this
 * endpoint to edit (it saves through PUT, which has its own store check), so
 * nothing legitimate is lost by hiding them.
 */
export const getProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) throw new HttpError(404, 'That product does not exist.');
  if (!product.isPublished) throw new HttpError(404, 'That product does not exist.');

  res.json({ product });
});

/**
 * Refuse two variants in the same catalogue sharing a SKU.
 *
 * Scoped to the store, not the platform: a national chain and a corner shop are
 * both free to call their own item "SKU-001" without colliding, and that is the
 * same rule products themselves already follow. SKUs are only compared when
 * non-empty, because most merchants never fill them in and blanks must not all
 * be treated as one clashing value.
 */
async function assertSkusAvailable(storeId, variants, excludeProductId = null) {
  const skus = variants
    .map((variant) => String(variant.sku || '').trim())
    .filter(Boolean);
  if (!skus.length) return;

  const filter = { store: storeId, 'variants.sku': { $in: skus } };

  // On an edit, the product's OWN rows are in that array, so without this every
  // save of an unchanged SKU would report a clash with itself and no merchant
  // could ever edit a product twice.
  if (excludeProductId) filter._id = { $ne: excludeProductId };

  const clash = await Product.findOne(filter).lean();

  if (clash) {
    const existing = (clash.variants || []).find((variant) =>
      skus.includes(String(variant.sku || '').trim()),
    );
    throw new HttpError(
      400,
      `That SKU is already used by “${clash.name}”${
        existing?.title ? ` (${existing.title})` : ''
      }. SKUs must be unique within a store.`,
    );
  }
}

/**
/**
 * File a product on a Theme 2 tree node, or unfile it with `null`.
 *
 * `undefined` means "the client did not mention it" and this refuses to act -
 * which is the whole point. See `readProductPayload`: an absent key must leave
 * the product where it is, or every ordinary Theme 1 edit (a price change, a
 * stock count) would silently unfile the product from the merchant Theme 2
 * branch. Changing the THEME 1 `category` string never disturbs this.
 *
 * Validated against the store the product will END UP in, for the same reason a
 * store move is: a crafted request must not be able to file a product into
 * another merchant tree, where it would appear on their public storefront. It
 * cannot be left to the schema - a perfectly valid ObjectId belonging to the
 * wrong store is still the wrong store, and Mongo will happily store it.
 *
 * Shared by create and update so the two cannot drift. Validating only the
 * update path would leave create as a way straight around it.
 */
async function fileProductOnNode(product, categoryId, storeId) {
  if (categoryId === undefined) return;

  if (categoryId !== null) {
    if (!mongoose.isValidObjectId(categoryId)) {
      throw new HttpError(400, 'That category id is not valid.');
    }

    const exists = await CategoryNode.exists({ _id: categoryId, store: storeId });
    if (!exists) {
      throw new HttpError(404, 'That category does not exist in this store.');
    }
  }

  product.categoryId = categoryId;
}

/**
 * POST /api/products (store owner, or the store admins that owner appointed;
 * a platform admin through the stores they run) -> { product }
 *
 * A member's product is always pinned to a store they run, so a crafted
 * request cannot drop inventory into somebody else's catalogue - the platform
 * admin included.
 */
export const createProduct = asyncHandler(async (req, res) => {
  const payload = readProductPayload(req.body);

  if (!payload.name) throw new HttpError(400, 'A product needs a name.');

  payload.store = await pickTargetStore({
    requestedId: req.body?.storeId,
    stores: await storesFor(req),
  });

  const variantBlock = readVariantBlock(req.body);
  if (variantBlock) {
    await assertSkusAvailable(payload.store, variantBlock.variants);
    payload.options = variantBlock.options;
    payload.variants = variantBlock.variants;
  }
  // The Theme 2 tree link, checked against the store the product is going to
  // (just resolved above). Without this a crafted POST could file a product
  // into another merchant tree - the update path validates, and leaving
  // create unchecked would be a way straight around that check.
  await fileProductOnNode(payload, payload.categoryId, payload.store);

  // Publishing + organisation, applied only for the keys the client sent. A
  // create with none of them gets the schema defaults - `active`, stock
  // tracked, no vendor - which is exactly the product it used to create.
  Object.assign(payload, readOrganisationBlock(req.body));

  const product = await Product.create(payload);

  // The storefront serves this product from cache (see utils/storefrontCache),
  // so a new one has to push it out or a shopper would be told the shop has
  // nothing new until the TTL expired.
  invalidateStore(product.store);

  res.status(201).json({ product });
});

/** PUT /api/products/:id (a member of its store, platform admin included) */
export const updateProduct = asyncHandler(async (req, res) => {
  const product = await loadEditableProduct(req.params.id, req.user);
  const payload = readProductPayload(req.body);

  if (!payload.name) throw new HttpError(400, 'A product needs a name.');

  // Moving a product between stores only works for stores the caller runs, so
  // this can never plant a product in somebody else's catalogue - the platform
  // admin included. A null/missing storeId is ignored: unhooking a product
  // from every store is no longer a power anybody has.
  if (req.body?.storeId) {
    if (!mongoose.isValidObjectId(req.body.storeId)) {
      throw new HttpError(400, 'That store id is not valid.');
    }

    const allowed = await managedStoreIds(req.user);
    if (!allowed.map(String).includes(String(req.body.storeId))) {
      throw new HttpError(403, 'That store does not belong to you.');
    }

    product.store = req.body.storeId;
  }

  /* `categoryId` is PULLED OUT of the payload rather than assigned with the
     rest.

     This is the whole reason the tree link is handled separately, and getting it
     wrong is silent: `Object.assign(product, { categoryId: undefined })` copies
     the `undefined` onto the document, which MARKS the path as modified, and the
     save then writes the node away. A merchant editing a price on a Theme 2
     store would quietly strip every product off their tree, one save at a time,
     with a 200 and no message. Stripping the key out is what makes "absent means
     leave it alone" true rather than merely intended - the bug it fixes was
     caught by `testProductFiling.mjs`, not by looking at this code. */
  const { categoryId: requestedNode, ...assigned } = payload;
  Object.assign(product, assigned);

  /* Now it is applied, and only if the client actually sent the key: null
     unfiles, an id files, absent does nothing. Validated against the store the
     product will END UP in, so a crafted request cannot file a product into
     another merchant's tree. See `fileProductOnNode`. */
  await fileProductOnNode(product, requestedNode, product.store);

  // Same rule as the variant block below: only the keys actually sent are
  // written, so a client that does not manage publishing cannot un-publish a
  // product by leaving the field out of its save.
  Object.assign(product, readOrganisationBlock(req.body));

  // The variant block is applied separately, and only when the client actually
  // sent one. `existingIds` is what lets a save be an EDIT rather than a
  // delete-and-recreate - see readVariants for why that matters to every cart
  // and receipt already pointing at these rows.
  const variantBlock = readVariantBlock(
    req.body,
    (product.variants || []).map((variant) => variant._id),
  );

  if (variantBlock) {
    // Checked against the store the product will END UP in, which is not
    // necessarily the one it is in now, and excluding this product so its own
    // unchanged SKUs are not reported as a clash with itself.
    await assertSkusAvailable(product.store, variantBlock.variants, product._id);

    product.set({
      options: variantBlock.options,
      variants: variantBlock.variants,
    });
  }

  await product.save();

  // Same reason as create: the edit is not on the storefront until this drops
  // the cached copy, and "I saved it but the shop still shows the old price" is
  // the failure this prevents.
  invalidateStore(product.store);

  res.json({ product });
});

/** DELETE /api/products/:id (admin, or the owning merchant) -> { deleted } */
export const deleteProduct = asyncHandler(async (req, res) => {
  const product = await loadEditableProduct(req.params.id, req.user);
  await product.deleteOne();

  // A deleted product that lingers on the storefront is worse than a slow one:
  // it is a product a shopper can still try to buy.
  invalidateStore(product.store);

  res.json({ deleted: true, id: String(product._id) });
});

// ---------------------------------------------------------------------------
// Bulk editing
// ---------------------------------------------------------------------------

// Enough to be useful, small enough that one request cannot stall the server.
// A merchant ticking "select all" on a large catalogue is asking for the
// obvious thing, and a merchant who somehow submits 5000 ids has a bug.
const MAX_BULK_IDS = 200;

/** How a bulk price edit should be applied to each product. */
const PRICE_MODES = ['set', 'increase_percent', 'decrease_percent'];
/** How a bulk stock edit should be applied to each product. */
const STOCK_MODES = ['set', 'increase', 'decrease'];

/**
 * The partial update a bulk edit describes.
 *
 * A PATCH, not a PUT: every field here is OPTIONAL and an absent one means
 * "leave this product's value alone". That is the whole reason this endpoint
 * exists rather than the client looping over PUT /products/:id - a full
 * replace would have to echo every field of every product back, so a stale
 * list in the browser would silently wipe a description or a whole variant
 * matrix that had been edited somewhere else in the meantime.
 *
 * Returns `null` when nothing was actually asked for, so "apply" with an empty
 * form is a no-op the caller can detect rather than an error.
 */
function readBulkChanges(body = {}) {
  const changes = {};
  const present = (key) => body[key] !== undefined && body[key] !== null;

  // --- Publishing / organisation ------------------------------------------
  if (present('status')) {
    const status = String(body.status).trim();
    if (!PRODUCT_STATUS_VALUES.includes(status)) {
      throw new HttpError(
        400,
        `“${status || '(blank)'}” is not a product status. Use ${PRODUCT_STATUS_VALUES.join(', ')}.`,
      );
    }
    changes.status = status;
  }

  if (present('trackInventory')) {
    changes.trackInventory = toBoolean(body.trackInventory, true);
  }

  if (present('productType')) changes.productType = String(body.productType).trim().slice(0, 60);
  if (present('vendor')) changes.vendor = String(body.vendor).trim().slice(0, 80);
  if (present('category')) changes.category = String(body.category).trim();
  if (present('rack')) changes.rack = String(body.rack).trim().slice(0, 20);
  if (present('shelf')) changes.shelf = String(body.shelf).trim().slice(0, 20);

  // Collections are ADDED to rather than replaced. A bulk edit that set them
  // would silently drop "Best Sellers" off every product that had it, which is
  // the opposite of what somebody tidying up a category wants.
  if (Array.isArray(body.addCollections)) {
    const added = body.addCollections
      .map((entry) => String(entry ?? '').trim().slice(0, 40))
      .filter(Boolean);
    if (added.length) changes.addCollections = added;
  }

  // --- Price ---------------------------------------------------------------
  if (present('price') && body.price !== '') {
    const mode = String(body.priceMode || 'set').trim();
    if (!PRICE_MODES.includes(mode)) {
      throw new HttpError(400, `“${mode}” is not a way to change the price.`);
    }

    const value = toNumber(body.price, 0);
    // A percentage of 0 is a no-op that reads as a mistake, and a negative one
    // would take money off in the wrong direction for a "decrease".
    if (mode !== 'set' && value <= 0) {
      throw new HttpError(400, 'Enter how much to change the price by.');
    }

    changes.price = { mode, value };
  }

  // --- Stock ---------------------------------------------------------------
  if (present('stock') && body.stock !== '') {
    const mode = String(body.stockMode || 'set').trim();
    if (!STOCK_MODES.includes(mode)) {
      throw new HttpError(400, `“${mode}” is not a way to change the stock.`);
    }

    const value = toNumber(body.stock, 0);
    if (value < 0) throw new HttpError(400, 'Stock cannot be negative.');

    changes.stock = { mode, value };
  }

  return Object.keys(changes).length ? changes : null;
}

/**
 * One product's new price under a bulk price edit.
 *
 * Percentages are applied to EACH VARIANT, not only to the product's seed
 * price. That seed is just the default a brand-new matrix row starts from - a
 * shopper pays the row's own price - so a "mark everything up 10%" that moved
 * only the seed would leave the shelf exactly as expensive as it was before,
 * while reporting success.
 *
 * Rounded to 2dp because a percentage of an odd price produces values like
 * 12.345000000000001, which would then print as a price with six decimals.
 */
function bulkPrice(product, { mode, value }) {
  const apply = (current) => {
    const from = toNumber(current, 0);
    const next =
      mode === 'set'
        ? value
        : mode === 'increase_percent'
          ? from * (1 + value / 100)
          : from * (1 - value / 100);

    return Math.max(0, Math.round(next * 100) / 100);
  };

  // A product with no matrix is priced by its own top-level number.
  if (!Array.isArray(product.variants) || !product.variants.length) {
    return { price: apply(product.price) };
  }

  const variants = product.variants.map((variant) => ({
    ...(variant.toObject ? variant.toObject() : variant),
    price: apply(variant.price),
  }));

  return { variants, price: apply(product.price) };
}

/** One product's new stock under a bulk stock edit, clamped at zero. */
function bulkStock(product, { mode, value }, trackInventory) {
  const apply = (current) => {
    const from = toNumber(current, 0);
    const next = mode === 'set' ? value : mode === 'increase' ? from + value : from - value;
    // Never negative: the schema forbids it, and "reduce by 100" on something
    // with 3 left means zero, not a validation error for the whole batch.
    return Math.max(0, next);
  };

  // Nothing to count means nothing to change. A made-to-order product is not
  // quietly given a stock level by a bulk edit.
  if (!trackInventory) return {};

  if (!Array.isArray(product.variants) || !product.variants.length) {
    return { stock: apply(product.stock) };
  }

  const variants = product.variants.map((variant) => ({
    ...(variant.toObject ? variant.toObject() : variant),
    stock: apply(variant.stock),
  }));

  return { variants, stock: apply(product.stock) };
}

/**
 * PATCH /api/products/bulk
 * body: { ids: [...], ...changes } -> { updated, skipped, failed, total }
 *
 * Applies one set of changes to many products in a single request.
 *
 * Two things it deliberately does NOT do:
 *
 * 1. It cannot move a product between stores. `store` is not in the change
 *    set, so a bulk edit can never plant another merchant's catalogue here -
 *    the same guarantee loadEditableProduct gives one product at a time.
 * 2. It does not stop at the first failure. Each product is checked and
 *    applied independently, so one product the caller does not own - or one
 *    deleted a second ago - cannot block the other ninety-nine. The response
 *    reports exactly what happened to each, so the UI can say "97 updated,
 *    3 could not be" rather than a bare success.
 */
export const bulkUpdateProducts = asyncHandler(async (req, res) => {
  const ids = Array.isArray(req.body?.ids)
    ? [...new Set(req.body.ids.map((id) => String(id)).filter(Boolean))]
    : [];

  if (!ids.length) throw new HttpError(400, 'Choose at least one product to edit.');
  if (ids.length > MAX_BULK_IDS) {
    throw new HttpError(400, `That is more than ${MAX_BULK_IDS} products at once.`);
  }

  // Throws a 400 when the form asks for nothing, so a merchant who opened the
  // panel and pressed Apply is told rather than watching a spinner.
  const changes = readBulkChanges(req.body);
  if (!changes) throw new HttpError(400, 'Nothing to change — pick at least one field.');

  // One query for the whole selection, filtered by the stores this account
  // actually runs. Same rule as loadEditableProduct, applied in bulk.
  const allowed = (await managedStoreIds(req.user)).map(String);
  const found = await Product.find({ _id: { $in: ids } });
  const byId = new Map(found.map((product) => [String(product._id), product]));

  const updated = [];
  const skipped = [];
  const failed = [];
  // Store ids touched by this edit, for one cache invalidation each afterwards.
  const touched = new Set();

  for (const id of ids) {
    const product = byId.get(id);

    if (!product) {
      skipped.push({ id, reason: 'That product no longer exists.' });
      continue;
    }

    if (!product.store || !allowed.includes(String(product.store))) {
      // Reported, not thrown: the caller learns the product was left alone
      // without this becoming a way to probe for other stores' product ids.
      skipped.push({ id, reason: 'That product does not belong to your store.' });
      continue;
    }

    try {
      if (changes.status !== undefined) product.status = changes.status;
      if (changes.trackInventory !== undefined) {
        product.trackInventory = changes.trackInventory;
      }
      if (changes.productType !== undefined) product.productType = changes.productType;
      if (changes.vendor !== undefined) product.vendor = changes.vendor;
      if (changes.category !== undefined) product.category = changes.category;
      if (changes.rack !== undefined) product.rack = changes.rack;
      if (changes.shelf !== undefined) product.shelf = changes.shelf;

      if (Array.isArray(changes.addCollections)) {
        const merged = [...(product.collections || [])];
        for (const name of changes.addCollections) {
          if (!merged.some((entry) => entry.toLowerCase() === name.toLowerCase())) {
            merged.push(name);
          }
        }
        product.collections = merged;
      }

      // `trackInventory` is read AFTER the assignment above, so "stop tracking
      // inventory" and "set stock to 50" in the same request is a no-op - which
      // is right, because there is nothing left to count.
      const tracks = product.trackInventory !== false;

      if (changes.price) Object.assign(product, bulkPrice(product, changes.price));
      if (changes.stock) Object.assign(product, bulkStock(product, changes.stock, tracks));

      // eslint-disable-next-line no-await-in-loop
      await product.save();
      updated.push({ id, name: product.name });
      // Collected in a side set rather than added to `updated`, so the response
      // shape stays exactly what the client already parses.
      touched.add(String(product.store));
    } catch (err) {
      // One product failing (a validation error, say) must not abandon the
      // rest, so it is recorded and the loop carries on.
      failed.push({ id, reason: err.message || 'Could not save that product.' });
    }
  }

  /* One invalidation per store touched, not one per product.
   *
   * A bulk edit can span several stores (an admin running more than one), so the
   * ids are de-duplicated first - invalidating once per product would be fifty
   * identical no-ops for a fifty-row selection. */
  for (const storeId of touched) invalidateStore(storeId);

  res.json({ updated, skipped, failed, total: ids.length });
});

/** POST /api/products/bulk/delete -> { deleted, skipped, names } */
export const bulkDeleteProducts = asyncHandler(async (req, res) => {
  const ids = Array.isArray(req.body?.ids)
    ? [...new Set(req.body.ids.map((id) => String(id)).filter(Boolean))]
    : [];

  if (!ids.length) throw new HttpError(400, 'Choose at least one product to delete.');
  if (ids.length > MAX_BULK_IDS) {
    throw new HttpError(400, `That is more than ${MAX_BULK_IDS} products at once.`);
  }

  const allowed = (await managedStoreIds(req.user)).map(String);
  const found = await Product.find({ _id: { $in: ids } });
  const byId = new Map(found.map((product) => [String(product._id), product]));

  const deletable = [];
  const skipped = [];

  for (const id of ids) {
    const product = byId.get(id);

    if (!product) {
      skipped.push({ id, reason: 'That product no longer exists.' });
      continue;
    }

    if (!product.store || !allowed.includes(String(product.store))) {
      skipped.push({ id, reason: 'That product does not belong to your store.' });
      continue;
    }

    deletable.push(product);
  }

  // Deleted in one operation rather than N round trips - the per-product store
  // check has already happened above, so there is nothing left to verify.
  const result = await Product.deleteMany({ _id: { $in: deletable.map((p) => p._id) } });

  // Same rule as the bulk edit above: one invalidation per store, not per
  // product. Bulk-deleting is the case where this matters most - a deleted
  // product still listed on the storefront is one a shopper can try to buy.
  for (const storeId of new Set(deletable.map((p) => String(p.store)))) {
    invalidateStore(storeId);
  }

  res.json({
    deleted: result.deletedCount || 0,
    skipped,
    names: deletable.map((product) => product.name),
  });
});

export default {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  bulkUpdateProducts,
  bulkDeleteProducts,
};
