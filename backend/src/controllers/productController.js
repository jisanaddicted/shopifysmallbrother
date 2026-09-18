import mongoose from 'mongoose';
import Product from '../models/Product.js';
import Store from '../models/Store.js';
import { HttpError } from '../middleware/errorHandler.js';
import { ROLES } from '../utils/constants.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { slugify } from '../utils/slug.js';

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The store owned by this merchant, or null if they have none yet. */
async function ownedStoreId(user) {
  const store = await Store.findOne({ owner: user._id }).select('_id');
  return store?._id || null;
}

/**
 * Only a merchant's own products (or any product, for an admin) may be edited.
 * Returns the loaded product.
 */
async function loadEditableProduct(productId, user) {
  if (!mongoose.isValidObjectId(productId)) {
    throw new HttpError(400, 'That product id is not valid.');
  }

  const product = await Product.findById(productId);
  if (!product) throw new HttpError(404, 'That product does not exist.');

  if (user.role === ROLES.STORE) {
    const storeId = await ownedStoreId(user);
    if (!storeId || String(product.store) !== String(storeId)) {
      throw new HttpError(403, 'That product does not belong to your store.');
    }
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

/** POST /api/products (admin, or a merchant for their own store) -> { product } */
export const createProduct = asyncHandler(async (req, res) => {
  const payload = readProductPayload(req.body);

  if (!payload.name) throw new HttpError(400, 'A product needs a name.');

  // A merchant's products always belong to their store; an admin may pick one.
  if (req.user.role === ROLES.STORE) {
    const storeId = await ownedStoreId(req.user);
    if (!storeId) {
      throw new HttpError(400, 'Create your store before adding products.');
    }
    payload.store = storeId;
  } else if (req.body?.storeId) {
    if (!mongoose.isValidObjectId(req.body.storeId)) {
      throw new HttpError(400, 'That store id is not valid.');
    }
    const store = await Store.exists({ _id: req.body.storeId });
    if (!store) throw new HttpError(404, 'That store does not exist.');

    payload.store = req.body.storeId;
  }

  const product = await Product.create(payload);
  res.status(201).json({ product });
});

/** PUT /api/products/:id (admin, or the owning merchant) -> { product } */
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
