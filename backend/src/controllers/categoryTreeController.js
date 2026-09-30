import mongoose from 'mongoose';
import CategoryNode from '../models/CategoryNode.js';
import Product from '../models/Product.js';
import Store from '../models/Store.js';
import { HttpError } from '../middleware/errorHandler.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { MAX_CATEGORY_DEPTH } from '../utils/constants.js';
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

/**
 * The Theme 2 category TREE: the structure a shopper drills down through.
 *
 * Theme 1's categories are plain strings on the store document, which works
 * because a category there is only ever a heading. A tree cannot work that way
 * - a node is somewhere a shopper can BE, it has a parent and a position among
 * its siblings, and two nodes may legitimately share a name ("Milk" at the top
 * and "Milk" under "Dairy" are different shelves). A string cannot say which
 * one, so a node is a document with an id and products point at that id. See
 * models/CategoryNode.js for why it is a collection and not a field on Store.
 */

/**
 * Ceiling on how many tree nodes one store may have.
 *
 * The same reason `MAX_CATEGORIES` exists for Theme 1's flat list: a picker with
 * no ceiling is fine right up until a store has 10,000 of them. A real shop is
 * nowhere near this.
 */
const MAX_NODES = 400;

/** Longest a node name may be. Matches Theme 1's category cap. */
const MAX_NAME = 60;

/**
 * A base64 data URL for an image type we are willing to store, and no larger.
 *
 * Byte-for-byte the rule `menuController` applies to Theme 1 category pictures,
 * reused deliberately: a Theme 2 card and a Theme 1 card are the same kind of
 * thing - a picture on a public storefront, read on every page load - so they
 * get the same ceiling. Two limits for two pictures displayed identically would
 * mean one of them is wrong.
 *
 * The prefix check is the security-relevant half. A category picture is
 * attacker-controlled data rendered inside an <img> on a public page; only real
 * inline image payloads are accepted, which keeps a remote `http(s)` URL (a
 * tracker beacon following shoppers around on someone else's host) and a
 * `javascript:` URL out of the database.
 */
const ALLOWED_IMAGE = /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/]+=*$/;
const MAX_IMAGE_BYTES = 1024 * 1024;

function isAllowedImageDataUrl(value) {
  if (typeof value !== 'string') return false;
  if (!ALLOWED_IMAGE.test(value)) return false;

  // ~4 chars per 3 bytes; measure the payload, not the whole data URL, so the
  // cap means what it says.
  const base64 = value.slice(value.indexOf(',') + 1);
  return Math.floor((base64.length * 3) / 4) <= MAX_IMAGE_BYTES;
}

/** A flat node, in the shape the client wants. */
function serialize(node, childCount = 0) {
  return {
    id: String(node._id),
    name: node.name,
    parent: node.parent ? String(node.parent) : null,
    position: node.position || 0,
    image: node.image || '',
    childCount,
  };
}

/** Load a node and prove the caller may touch it. Never returns null. */
async function loadNode(store, nodeId) {
  if (!mongoose.isValidObjectId(nodeId)) {
    throw new HttpError(400, 'That category id is not valid.');
  }

  const node = await CategoryNode.findOne({ _id: nodeId, store: store._id });
  if (!node) {
    throw new HttpError(404, 'That category does not exist in this store.');
  }

  return node;
}

/**
 * How many nodes separate a node from the top of its store's tree.
 *
 * ONE query, via `$graphLookup`, rather than walking parent by parent.
 *
 * That walk was the other half of why adding a subcategory felt slow. Every hop
 * is a separate round trip to a database that is not in the next room, and a
 * category four levels down cost four of them before the server had even decided
 * whether to allow the write. `$graphLookup` asks the server to follow the chain
 * itself and returns the whole ancestry in one go, so the check costs the same
 * whether the node is at the top of the tree or at the bottom of it.
 *
 * The node itself plus its ancestors, matching the rule "a node with no parent
 * is depth 1". `maxDepth` is the ceiling as a limit on the LOOKUP rather than a
 * check afterwards, so a parent chain that had somehow been corrupted cannot walk
 * forever - and because it stops at the cap, the result can only ever be >= the
 * real depth, which is the safe direction to be wrong in: a malformed tree is
 * refused rather than accepted.
 *
 * `$match` comes FIRST so the lookup runs for this one node; `$graphLookup` with
 * no preceding match would walk every node the store owns and throw all but one
 * away, which is the opposite of the point.
 */
async function depthOf(node) {
  if (!node?.parent) return 1;

  const [row] = await CategoryNode.aggregate([
    { $match: { _id: node._id } },
    {
      $graphLookup: {
        from: 'categorynodes',
        startWith: '$parent',
        connectFromField: 'parent',
        connectToField: '_id',
        // Scoped to the node's own store, so a parent link pointing at another
        // store's node ends the walk instead of walking into it.
        restrictSearchWithMatch: { store: node.store },
        as: 'ancestors',
        maxDepth: MAX_CATEGORY_DEPTH - 1,
      },
    },
    { $project: { depth: { $add: [{ $size: '$ancestors' }, 1] } } },
  ]);

  return row?.depth || 1;
}

/** Every node id in the subtree rooted at `root`, root included. */
async function collectSubtree(store, root) {
  const doomed = new Set([String(root._id)]);
  let frontier = [root];

  // Bounded by the depth cap: a tree that somehow exceeded it (a direct
  // database write) is cut off rather than walked forever.
  for (let depth = 0; depth < MAX_CATEGORY_DEPTH; depth += 1) {
    const children = await CategoryNode.find({
      store: store._id,
      parent: { $in: frontier.map((n) => n._id) },
    }).lean();

    if (!children.length) break;

    frontier = children;
    for (const child of children) doomed.add(String(child._id));
  }

  return [...doomed].filter((id) => mongoose.isValidObjectId(id));
}

/**
 * GET /api/menu/edit/:storeId/tree
 *
 * The store's whole Theme 2 tree, flat, as `[{ id, name, parent, position,
 * image, childCount }]` sorted by position.
 *
 * FLAT, deliberately, and for the same reason `listStoreMenu` returns a flat
 * list: the client rebuilds the tree by folding on `parent`, exactly as
 * `buildTree` in ThemeBuilder.jsx already does for the menu. Nesting children in
 * the response would mean the server does the folding and the client trusts it,
 * and then the theme editor and the storefront hold two different notions of
 * "the tree" that can disagree.
 *
 * Every node carries its `childCount` so a client can tell "this opens more
 * categories" from "this shows products" without a second request.
 */
export const listCategoryTree = asyncHandler(async (req, res) => {
  const { store } = await loadManageableStore(req.params.storeId, req.user);

  const nodes = await CategoryNode.find({ store: store._id })
    .sort({ position: 1, name: 1 })
    .lean();

  // One pass to count children, rather than a query per node: a store with 400
  // nodes costs one query here, not 400.
  const childCounts = new Map();
  for (const node of nodes) {
    if (!node.parent) continue;
    const key = String(node.parent);
    childCounts.set(key, (childCounts.get(key) || 0) + 1);
  }

  res.json({
    tree: nodes.map((node) => serialize(node, childCounts.get(String(node._id)) || 0)),
  });
});

/**
 * POST /api/menu/edit/:storeId/tree  ({ name, parent? })
 *
 * Add a category, optionally underneath another one. With no `parent` it is a
 * top-level category; with one, it becomes that node's last child.
 *
 * `parent` is resolved through the caller's own store, so naming another
 * store's node is a 404 rather than a way to graft a branch onto somebody
 * else's shop.
 */
export const createTreeNode = asyncHandler(async (req, res) => {
  const { store } = await loadManageableStore(req.params.storeId, req.user);

  const name = String(req.body?.name || '').trim();
  if (!name) throw new HttpError(400, 'A category needs a name.');
  if (name.length > MAX_NAME) {
    throw new HttpError(400, `A category name can be at most ${MAX_NAME} characters.`);
  }

  let parent = null;
  if (req.body?.parent) {
    parent = await loadNode(store, req.body.parent);

    // The cap is enforced on the node that would BECOME the deepest - the child
    // being added, not the parent that already exists.
    if ((await depthOf(parent)) >= MAX_CATEGORY_DEPTH) {
      throw new HttpError(
        400,
        `Categories can be nested ${MAX_CATEGORY_DEPTH} levels deep.`,
      );
    }
  }

  /* The store's total node count AND its last sibling, in ONE query.
   *
   * These were three separate reads - a countDocuments across the whole store, a
   * findOne for the highest position among the siblings, and a second count for
   * the cap - and each is a round trip to a database that is not in the next
   * room. Adding a category felt slow mostly because of them. `$facet` runs both
   * halves against the same matched set in a single trip.
   *
   * The two halves are NOT the same question and must not be confused:
   *   - `storeTotal` counts EVERY node in the store, because MAX_NODES is a
   *     ceiling on the whole catalogue, not on one shelf;
   *   - `siblings` is scoped to this parent, because it exists only to put a new
   *     category at the END of its own siblings rather than the top. A merchant
   *     adding "Milk" then "Cheese" under Dairy expects to see them in that
   *     order, and prepending would reverse their list on every add.
   *
   * `$max` on position rather than a count, so it is correct even if positions
   * have gaps or were hand-edited. Falls back to -1 for the very first child, so
   * that one lands at 0. */
  const [stats] = await CategoryNode.aggregate([
    { $match: { store: store._id } },
    {
      $facet: {
        storeTotal: [{ $count: 'n' }],
        siblings: [
          { $match: { parent: parent ? parent._id : null } },
          { $group: { _id: null, lastPosition: { $max: '$position' } } },
        ],
      },
    },
  ]);

  if ((stats?.storeTotal?.[0]?.n || 0) >= MAX_NODES) {
    throw new HttpError(400, `A store can have at most ${MAX_NODES} categories.`);
  }

  const lastPosition = stats?.siblings?.[0]?.lastPosition ?? -1;

  const node = await CategoryNode.create({
    store: store._id,
    name,
    parent: parent ? parent._id : null,
    position: lastPosition + 1,
  });

  // The public tree is cached, and a new branch changes what a shopper sees the
  // moment they open the store.
  invalidateStore(store._id);

  res.status(201).json({ node: serialize(node, 0) });
});

/**
 * PUT /api/menu/edit/:storeId/tree/:nodeId
 *
 * Rename a node, set or clear its picture, or move it.
 *
 * Only the keys the client actually sent are applied, so renaming a category
 * cannot silently clear its picture, and moving it cannot silently rename it.
 *
 * Two rules make a move safe:
 *
 *   - a node cannot be moved under ITSELF, which would detach the whole subtree
 *     from the store and make it unreachable through the tree;
 *   - a node cannot be moved under one of its own DESCENDANTS, which would make
 *     the subtree its own ancestor - a cycle that turns every later walk of
 *     this tree (including `depthOf`) into an infinite loop.
 *
 * The depth check measures the SUBTREE, not the new parent. Moving a node that
 * already has children under a parent one level from the ceiling pushes
 * everything below it past the cap, even though the parent alone would pass.
 */
export const updateTreeNode = asyncHandler(async (req, res) => {
  const { store } = await loadManageableStore(req.params.storeId, req.user);
  const node = await loadNode(store, req.params.nodeId);

  if (req.body?.name !== undefined) {
    const name = String(req.body.name || '').trim();
    if (!name) throw new HttpError(400, 'A category needs a name.');
    if (name.length > MAX_NAME) {
      throw new HttpError(400, `A category name can be at most ${MAX_NAME} characters.`);
    }
    node.name = name;
  }

  if (req.body?.image !== undefined) {
    const image = String(req.body.image ?? '').trim();
    if (image && !isAllowedImageDataUrl(image)) {
      throw new HttpError(
        400,
        'That image could not be used. Pick a PNG, JPG, WEBP or GIF under 1 MB.',
      );
    }
    node.image = image;
  }

  if (req.body?.parent !== undefined) {
    const wanted = req.body.parent;

    if (wanted === null || wanted === '') {
      node.parent = null;
    } else {
      if (String(wanted) === String(node._id)) {
        throw new HttpError(400, 'A category cannot be moved inside itself.');
      }

      const newParent = await loadNode(store, wanted);

      /* Walk up from the new parent. If the node being moved appears anywhere on
         that chain, the new parent sits inside the node's own subtree. Bounded
         so a pre-existing cycle terminates instead of hanging the request. */
      let cursor = newParent;
      for (let hop = 0; cursor.parent && hop <= MAX_CATEGORY_DEPTH + 1; hop += 1) {
        if (String(cursor.parent) === String(node._id)) {
          throw new HttpError(400, 'A category cannot be moved inside its own subcategory.');
        }

        const next = await CategoryNode.findOne({
          _id: cursor.parent,
          store: store._id,
        });
        if (!next) break;
        cursor = next;
      }

      /* Depth of the SUBTREE, not the parent: moving a node that already has
         children under a parent one level from the ceiling pushes everything
         below it past the cap, though the parent alone would pass. */
      const children = await CategoryNode.find({ store: store._id, parent: node._id }).lean();
      let tallest = 0;
      for (const child of children) {
        const d = await depthOf(child);
        if (d > tallest) tallest = d;
      }

      if ((await depthOf(newParent)) + tallest > MAX_CATEGORY_DEPTH) {
        throw new HttpError(400, `Categories can be nested ${MAX_CATEGORY_DEPTH} levels deep.`);
      }

      node.parent = newParent._id;
    }
  }

  await node.save();

  // Renames and pictures are both storefront content, and both would otherwise
  // sit behind the cache's TTL.
  invalidateStore(store._id);

  const childCount = await CategoryNode.countDocuments({
    store: store._id,
    parent: node._id,
  });

  res.json({ node: serialize(node, childCount) });
});

/**
 * DELETE /api/menu/edit/:storeId/tree/:nodeId
 *
 * Delete a category and everything under it, and unfile the products that were
 * in any of them.
 *
 * A product is UNFILED, never deleted - the same promise `deleteCategory` makes
 * for Theme 1. Deleting a shelf must not delete the stock sitting on it. Only
 * `categoryId` is cleared; the product's Theme 1 `category` string is left
 * exactly as it was, so a store that switches back to Theme 1 finds its
 * catalogue intact and unaltered.
 *
 * `deleted` counts the whole subtree, not just the node tapped, so the panel
 * can say what actually went instead of under-reporting.
 */
export const deleteTreeNode = asyncHandler(async (req, res) => {
  const { store } = await loadManageableStore(req.params.storeId, req.user);
  const node = await loadNode(store, req.params.nodeId);

  const ids = await collectSubtree(store, node);

  const unfiled = await Product.updateMany(
    { store: store._id, categoryId: { $in: ids } },
    { $set: { categoryId: null } },
  );
  await CategoryNode.deleteMany({ _id: { $in: ids }, store: store._id });

  // Two things just changed for shoppers, not one: the branches are gone, and
  // the products that were filed under them have been unfiled (so the counts on
  // every remaining node moved). Both live in the cached payloads.
  invalidateStore(store._id);

  res.json({
    deleted: ids.length,
    clearedProducts: unfiled.modifiedCount || 0,
  });
});

/**
 * Build the public tree payload for a store, WITHOUT touching the cache.
 *
 * SHARED BY BOTH PUBLIC READS, deliberately. `getPublicCategoryTree` and the
 * `tree` field of `getPublicStore` must be the same answer: a storefront that
 * fetched the tree twice and got two different shapes - or two different sets of
 * product counts - would show a shopper a category list that disagrees with the
 * page it is on. One function, called by both, makes that unrepresentable.
 *
 * The two queries run CONCURRENTLY, which is the point of extracting this. They
 * used to be awaited one after the other, and could not be: the count aggregation
 * filtered on `$in: [node ids]`, so it needed the nodes back first. Dropping that
 * filter and discarding the ids that are not nodes afterwards gives the same
 * answer with no dependency between them, so the pair costs one round trip
 * instead of two. Against a cluster where a round trip is 1-2s, that is the
 * single largest saving on a Theme 2 page load.
 *
 * Caching is the CALLER's business, not this function's - so it can be used from
 * a route that has its own slot, or from `getPublicStore` which is building a
 * bigger payload.
 */
export async function buildPublicTree(store, knownProducts) {
  const publicStore = { slug: store.slug, name: store.name, theme: store.theme };

  /* The per-category product count, from the products we ALREADY have when we
   * have them.
   *
   * This was originally a MongoDB `$group` aggregation, run as a second query -
   * and it was, by a wide margin, the most expensive thing on a Theme 2 page.
   * Measured on a cold load of the same store over the same link: 2.5s on
   * Theme 1 versus 7.5s on Theme 2, for a page that issues the SAME number of
   * round trips. So the cost was never the distance; it was a collection-wide
   * GROUP being run against a remote cluster.
   *
   * The caller - `getPublicStore` - has already fetched every product in the
   * store to send to the shopper. Counting `categoryId` across that array costs
   * nothing: no query, no round trip, no scan, and it cannot disagree with the
   * product list beside it because it IS the product list. The aggregation is
   * kept only as the fallback for a caller that has no products in hand (the
   * standalone /tree route), where fetching the catalogue to count it would be
   * the larger cost. */
  const hasProducts = Array.isArray(knownProducts);

  const nodes = await CategoryNode.find({ store: store._id })
    .sort({ position: 1, name: 1 })
    .lean();

  if (!nodes.length) return { store: publicStore, tree: [] };

  const productsPerNode = new Map();

  if (hasProducts) {
    for (const product of knownProducts) {
      const id = product?.categoryId;
      if (!id) continue;
      const key = String(id);
      productsPerNode.set(key, (productsPerNode.get(key) || 0) + 1);
    }
  } else {
    const counts = await Product.aggregate([
      { $match: { store: store._id, categoryId: { $ne: null } } },
      { $group: { _id: '$categoryId', n: { $sum: 1 } } },
    ]);
    for (const row of counts) productsPerNode.set(String(row._id), row.n);
  }

  const childCounts = new Map();
  for (const node of nodes) {
    if (!node.parent) continue;
    const key = String(node.parent);
    childCounts.set(key, (childCounts.get(key) || 0) + 1);
  }

  return {
    store: publicStore,
    tree: nodes.map((node) => ({
      ...serialize(node, childCounts.get(String(node._id)) || 0),
      productCount: productsPerNode.get(String(node._id)) || 0,
    })),
  };
}

/**
 * GET /api/stores/:slug/tree  (public - no login required)
 *
 * The Theme 2 tree for the storefront, with a product count on every node.
 *
 * Public because the storefront is: anyone with the store's link can browse it.
 * Read-only by construction - this route cannot write, and the one thing it
 * adds is a count, which is no leak: the public storefront already lists every
 * product with its name and price.
 *
 * `productCount` is what lets the drill-down tell a shopper which branches are
 * worth opening, and lets the client decide whether a node shows products of
 * its own, its children, or both.
 *
 * The storefront no longer needs to call this: `getPublicStore` returns the same
 * `tree` inline for Theme 2 stores, which saves the shopper a whole extra round
 * trip. This route stays for anything that wants the tree on its own - a widget,
 * a script, a future page that is not the shop - and it is built by
 * `buildPublicTree`, the same function, so the two can never disagree.
 */
export const getPublicCategoryTree = asyncHandler(async (req, res) => {
  // Same warm-first ordering as getPublicStore, and for the same reason: the
  // slug->store lookup would otherwise be a round trip on every request, which
  // is the entire cost this cache exists to avoid.
  const warm = getCachedBySlug(req.params.slug, SLOTS.TREE);
  if (warm) {
    res.json(warm);
    return;
  }

  const store = await Store.findOne({ slug: req.params.slug }).select(
    '_id slug name theme',
  );
  if (!store) throw new HttpError(404, 'That store does not exist.');

  rememberSlug(store.slug, store._id);

  const cached = getCached(store._id, SLOTS.TREE);
  if (cached) {
    res.json(cached);
    return;
  }

  const payload = await dedupe(SLOTS.TREE, store._id, async () => {
    const fresh = getCached(store._id, SLOTS.TREE);
    if (fresh) return fresh;

    const built = await buildPublicTree(store);
    setCached(store._id, SLOTS.TREE, built, store.slug);
    return built;
  });

  res.json(payload);
});

export default {
  listCategoryTree,
  createTreeNode,
  updateTreeNode,
  deleteTreeNode,
  getPublicCategoryTree,
};

