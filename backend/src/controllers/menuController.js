import mongoose from 'mongoose';
import NavMenu from '../models/NavMenu.js';
import Product from '../models/Product.js';
import Store from '../models/Store.js';
import { HttpError } from '../middleware/errorHandler.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { slugify } from '../utils/slug.js';
import { loadManageableStore } from '../utils/storeAccess.js';

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

  return root.sort((a, b) => (a.position || 0) - (b.position || 0));
}

/** Unique, alphabetically-sorted category names used by a store's products. */
async function listCategories(storeId) {
  const rows = await Product.find({
    store: storeId,
    category: { $ne: '', $exists: true },
  })
    .select('category')
    .lean();
    return [...new Set(rows.map((r) => r.category).filter(Boolean))].sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase())
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

  const store = await Store.findOne({ slug, isActive: true });
  if (!store) throw new HttpError(404, 'That store does not exist or is closed.');

  let items = await NavMenu.find({ store: store._id, isVisible: true })
    .sort({ position: 1 })
    .lean();

  /* Auto-seed from product categories when the menu has never been built. */
  if (!items.length) {
    const categories = await listCategories(store._id);
    if (categories.length) {
      const seed = categories.map((cat, i) => ({
        store: store._id,
        label: cat,
        targetType: 'category',
        target: cat,
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
        mongoose.isValidObjectId(i.target)
    )
    .map((i) => i.target);

  if (productTargets.length) {
    const products = await Product.find({ _id: { $in: productTargets } })
      .select('name category')
      .lean();
    for (const p of products) productMap.set(String(p._id), p);
  }

    res.json({ menu: buildTree(items, productMap), store });
});

/**
 * GET /api/menu/edit/:storeId  (store owner / platform admin)
 *
 * The theme editor loads the flat list (each item with its `parentId` so the
 * UI can rebuild the tree), plus the store's existing categories and products
 * so the dropdowns are pre-populated.
 */
export const listStoreMenu = asyncHandler(async (req, res) => {
  const { store } = await loadManageableStore(req.params.storeId, req.user);

  const [items, categories] = await Promise.all([
    NavMenu.find({ store: store._id }).sort({ position: 1 }).lean(),
    listCategories(store._id),
  ]);

  let products = [];
  if (items.some((i) => i.targetType === 'product')) {
    products = await Product.find({ store: store._id })
      .select('name category')
      .lean();
  }

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

export default {
  getStoreMenu,
  listStoreMenu,
  saveStoreMenu,
};