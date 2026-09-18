import Product from '../models/Product.js';
import { HttpError } from '../middleware/errorHandler.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
  const { search, category } = req.query;
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 100));

  const filter = {};

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

/** POST /api/products (admin) -> { product } */
export const createProduct = asyncHandler(async (req, res) => {
  const payload = readProductPayload(req.body);

  if (!payload.name) throw new HttpError(400, 'A product needs a name.');

  const product = await Product.create(payload);
  res.status(201).json({ product });
});

/** PUT /api/products/:id (admin) -> { product } */
export const updateProduct = asyncHandler(async (req, res) => {
  const payload = readProductPayload(req.body);

  if (!payload.name) throw new HttpError(400, 'A product needs a name.');

  const product = await Product.findByIdAndUpdate(req.params.id, payload, {
    new: true,
    runValidators: true,
  });

  if (!product) throw new HttpError(404, 'That product does not exist.');

  res.json({ product });
});

/** DELETE /api/products/:id (admin) -> { deleted: true, id } */
export const deleteProduct = asyncHandler(async (req, res) => {
  const product = await Product.findByIdAndDelete(req.params.id);
  if (!product) throw new HttpError(404, 'That product does not exist.');

  res.json({ deleted: true, id: String(product._id) });
});

export default {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
};
