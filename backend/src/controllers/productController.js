import mongoose from 'mongoose';
import Product from '../models/Product.js';
import Store from '../models/Store.js';
import { HttpError } from '../middleware/errorHandler.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { slugify } from '../utils/slug.js';
import { managedStoreIds, storesForUser } from '../utils/storeAccess.js';

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

/** Pulls the editable fields out of a request body, ignoring anything else. */
function readProductPayload(body = {}) {
  return {
    name: String(body.name || '').trim(),
    price: toNumber(body.price, 0),
    category: String(body.category || '').trim(),
    rack: String(body.rack || '').trim(),
    shelf: String(body.shelf || '').trim(),
    stock: body.stock === '' || body.stock === undefined ? 0 : toNumber(body.stock, 0),
    image: String(body.image || '').trim(),
    description: String(body.description || '').trim(),
  };
}

/**
 * GET /api/products?search=&category=&page=&limit=
 * Responds { products, page, pages, total }.
 */
export const listProducts = asyncHandler(async (req, res) => {
  const { search, category, store: storeParam } = req.query;
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 100));

  const filter = {};

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
    filter.$or = [
      { name: term },
      { description: term },
      { category: term },
      { rack: term },
      { shelf: term },
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

/** GET /api/products/:id -> { product } */
export const getProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) throw new HttpError(404, 'That product does not exist.');

  res.json({ product });
});

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

  const product = await Product.create(payload);
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

  Object.assign(product, payload);
  await product.save();

  res.json({ product });
});

/** DELETE /api/products/:id (admin, or the owning merchant) -> { deleted } */
export const deleteProduct = asyncHandler(async (req, res) => {
  const product = await loadEditableProduct(req.params.id, req.user);
  await product.deleteOne();

  res.json({ deleted: true, id: String(product._id) });
});

export default {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
};
