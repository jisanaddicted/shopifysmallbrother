import mongoose from 'mongoose';
import Product from '../models/Product.js';
import Store from '../models/Store.js';
import { HttpError } from '../middleware/errorHandler.js';
import { ROLES } from '../utils/constants.js';
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
 * actually run; that is what stops a store admin from planting a product in
 * another merchant's catalogue.
 *
 * A platform admin (canChooseAny) may leave it empty to create a "global"
 * product that only shows up on the general catalogue.
 */
async function pickTargetStore({ requestedId, stores, canChooseAny }) {
  if (canChooseAny) {
    if (!requestedId) return null;

    if (!mongoose.isValidObjectId(requestedId)) {
      throw new HttpError(400, 'That store id is not valid.');
    }

    const exists = await Store.exists({ _id: requestedId });
    if (!exists) throw new HttpError(404, 'That store does not exist.');

    return requestedId;
  }

  const allowed = stores.map((entry) => String(entry.store._id));

  if (requestedId) {
    if (!allowed.includes(String(requestedId))) {
      throw new HttpError(403, 'That store does not belong to you.');
    }
    return requestedId;
  }

  if (allowed.length === 1) return allowed[0];

  if (allowed.length === 0) {
    throw new HttpError(400, 'Create your store before adding products.');
  }

  throw new HttpError(
    400,
    'You run several stores. Say which store this product belongs to.',
  );
}

/**
 * Loads a product the caller may edit. A platform admin may edit any product;
 * everybody else must run the store it belongs to - as its owner, or as an
 * accepted store admin for it.
 */
async function loadEditableProduct(productId, user) {
  if (!mongoose.isValidObjectId(productId)) {
    throw new HttpError(400, 'That product id is not valid.');
  }

  const product = await Product.findById(productId);
  if (!product) throw new HttpError(404, 'That product does not exist.');

  if (user.role === ROLES.ADMIN) return product;

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
    // Case-insensitive partial match across the fields the storefront searches.
    const term = new RegExp(escapeRegExp(String(search).trim()), 'i');
    filter.$or = [{ name: term }, { description: term }, { category: term }];
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
 * POST /api/products (platform admin, store owner, or the store admins that
 * owner appointed) -> { product }
 *
 * A store member's product is always pinned to a store they run, so a crafted
 * request cannot drop inventory into somebody else's catalogue.
 */
export const createProduct = asyncHandler(async (req, res) => {
  const payload = readProductPayload(req.body);

  if (!payload.name) throw new HttpError(400, 'A product needs a name.');

  const isPlatformAdmin = req.user.role === ROLES.ADMIN;

  payload.store = await pickTargetStore({
    requestedId: req.body?.storeId,
    stores: isPlatformAdmin ? [] : await storesFor(req),
    canChooseAny: isPlatformAdmin,
  });

  const product = await Product.create(payload);
  res.status(201).json({ product });
});

/** PUT /api/products/:id (platform admin, or a store member of its store) */
export const updateProduct = asyncHandler(async (req, res) => {
  const product = await loadEditableProduct(req.params.id, req.user);
  const payload = readProductPayload(req.body);

  if (!payload.name) throw new HttpError(400, 'A product needs a name.');

  // Only an admin may move a product to a different store.
  if (req.user.role === ROLES.ADMIN && req.body?.storeId !== undefined) {
    if (req.body.storeId && !mongoose.isValidObjectId(req.body.storeId)) {
      throw new HttpError(400, 'That store id is not valid.');
    }
    product.store = req.body.storeId || null;
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
