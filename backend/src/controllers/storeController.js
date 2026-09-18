import mongoose from 'mongoose';
import Product from '../models/Product.js';
import Store from '../models/Store.js';
import StoreRider from '../models/StoreRider.js';
import User from '../models/User.js';
import { HttpError } from '../middleware/errorHandler.js';
import { ROLES, STORE_RIDER_STATUS } from '../utils/constants.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { normaliseUsername, slugify, uniqueSlug } from '../utils/slug.js';

// The public shape of a rider, shared by the roster and the search results.
const RIDER_FIELDS = 'name username email phone isAvailable location';

const escapeRegExp = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The store a merchant owns. */
async function myStore(user) {
  const store = await Store.findOne({ owner: user._id });
  if (!store) throw new HttpError(404, 'You do not have a store yet.');
  return store;
}

/**
 * Loads a store the caller is allowed to manage: an admin may manage any
 * store, a merchant only their own.
 */
async function loadManageableStore(storeId, user) {
  if (!mongoose.isValidObjectId(storeId)) {
    throw new HttpError(400, 'That store id is not valid.');
  }

  const store = await Store.findById(storeId);
  if (!store) throw new HttpError(404, 'That store does not exist.');

  if (user.role !== ROLES.ADMIN && String(store.owner) !== String(user._id)) {
    throw new HttpError(403, 'That store does not belong to you.');
  }

  return store;
}

/**
 * GET /api/stores/:slug  (public, no login needed)
 *
 * This is what a visitor sees at /s/<slug> - the store's own products only.
 */
export const getPublicStore = asyncHandler(async (req, res) => {
  const slug = slugify(req.params.slug, '');
  if (!slug) throw new HttpError(404, 'That store does not exist.');

  const store = await Store.findOne({ slug });
  if (!store || !store.isActive) {
    throw new HttpError(404, 'That store does not exist or is closed.');
  }

  const products = await Product.find({ store: store._id }).sort({
    createdAt: -1,
  });

  res.json({ store, products });
});

/** GET /api/stores/mine - the merchant's own store plus its rider roster. */
export const getMyStore = asyncHandler(async (req, res) => {
  const store = await myStore(req.user);

  const links = await StoreRider.find({
    store: store._id,
    status: { $ne: STORE_RIDER_STATUS.REVOKED },
  })
    .populate('rider', RIDER_FIELDS)
    .sort({ createdAt: -1 });

  res.json({
    store,
    riders: links.filter((link) => link.rider),
  });
});

/** PATCH /api/stores/mine - edit the storefront details (and its slug). */
export const updateMyStore = asyncHandler(async (req, res) => {
  const store = await myStore(req.user);
  const { name, description, phone, address, image, isActive, slug } =
    req.body || {};

  if (name !== undefined) {
    const clean = String(name).trim();
    if (!clean) throw new HttpError(400, 'A store needs a name.');
    store.name = clean;
  }

  if (description !== undefined) store.description = String(description).trim();
  if (phone !== undefined) store.phone = String(phone).trim();
  if (image !== undefined) store.image = String(image).trim();
  if (isActive !== undefined) store.isActive = Boolean(isActive);

  if (address !== undefined) {
    store.address = {
      line1: String(address?.line1 || '').trim(),
      city: String(address?.city || '').trim(),
    };
  }

  // Changing the slug changes the public URL, so it has to stay unique.
  if (slug !== undefined && slugify(slug, '') !== store.slug) {
    store.slug = await uniqueSlug(slug, {
      exists: (candidate, excludeId) =>
        Store.exists({ slug: candidate, _id: { $ne: excludeId } }),
      excludeId: store._id,
    });
  }

  await store.save();
  res.json({ store });
});

/** GET /api/stores (admin) - every merchant on the platform. */
export const listStores = asyncHandler(async (req, res) => {
  const stores = await Store.find()
    .sort({ createdAt: -1 })
    .populate('owner', 'name email username');

  res.json({ stores });
});

/**
 * GET /api/riders/lookup?username=sam.rider  (store owner or admin)
 *
 * How a store finds a rider to invite. An exact username match is returned
 * first, then username/name prefix matches so partial search works too.
 */
export const searchRiders = asyncHandler(async (req, res) => {
  const term = normaliseUsername(req.query.username || req.query.q || '');
  if (!term) return res.json({ riders: [] });

  const pattern = new RegExp(escapeRegExp(term), 'i');

  const riders = await User.find({
    role: ROLES.RIDER,
    $or: [{ username: term }, { username: pattern }, { name: pattern }],
  })
    .select(RIDER_FIELDS)
    .limit(10);

  // An exact handle match is what the searcher almost always means.
  riders.sort((a, b) => {
    if (a.username === term) return -1;
    if (b.username === term) return 1;
    return String(a.username || '').localeCompare(String(b.username || ''));
  });

  return res.json({ riders });
});

/** GET /api/stores/:id/riders - the roster (pending + active bindings). */
export const listStoreRiders = asyncHandler(async (req, res) => {
  const store = await loadManageableStore(req.params.id, req.user);

  const links = await StoreRider.find({
    store: store._id,
    status: { $ne: STORE_RIDER_STATUS.REVOKED },
  })
    .populate('rider', RIDER_FIELDS)
    .sort({ createdAt: -1 });

  res.json({
    store: { _id: store._id, name: store.name, slug: store.slug },
    riders: links.filter((link) => link.rider),
  });
});

/**
 * POST /api/stores/:id/riders  { username }  (store owner or admin)
 *
 * Invites a rider by username. The rider must accept before they can see this
 * store's orders, so a new row starts as `pending`.
 */
export const inviteRider = asyncHandler(async (req, res) => {
  const store = await loadManageableStore(req.params.id, req.user);
  const username = normaliseUsername(req.body?.username);

  if (!username) {
    throw new HttpError(400, 'Enter the rider’s username.');
  }

  const rider = await User.findOne({ username });
  if (!rider) {
    throw new HttpError(404, `No rider found with the username “${username}”.`);
  }
  if (rider.role !== ROLES.RIDER) {
    throw new HttpError(400, 'That account is not a rider.');
  }

  const existing = await StoreRider.findOne({
    store: store._id,
    rider: rider._id,
  });

  if (existing) {
    if (existing.status === STORE_RIDER_STATUS.ACTIVE) {
      throw new HttpError(409, `@${username} already delivers for this store.`);
    }
    if (existing.status === STORE_RIDER_STATUS.PENDING) {
      throw new HttpError(409, `@${username} already has a pending invitation.`);
    }

    // Previously declined or revoked - re-open the same row.
    existing.status = STORE_RIDER_STATUS.PENDING;
    existing.invitedBy = req.user._id;
    existing.respondedAt = null;
    await existing.save();
    await existing.populate('rider', RIDER_FIELDS);

    return res.json({ invitation: existing, reinvited: true });
  }

  const invitation = await StoreRider.create({
    store: store._id,
    rider: rider._id,
    invitedBy: req.user._id,
    status: STORE_RIDER_STATUS.PENDING,
  });

  await invitation.populate('rider', RIDER_FIELDS);

  res.status(201).json({ invitation });
});

/**
 * DELETE /api/stores/:id/riders/:riderId  (store owner or admin)
 *
 * Marked `revoked` rather than deleted, so the same rider can be invited
 * again later without hitting the unique index.
 */
export const removeStoreRider = asyncHandler(async (req, res) => {
  const store = await loadManageableStore(req.params.id, req.user);

  if (!mongoose.isValidObjectId(req.params.riderId)) {
    throw new HttpError(400, 'That rider id is not valid.');
  }

  const link = await StoreRider.findOne({
    store: store._id,
    rider: req.params.riderId,
  });

  if (!link) {
    throw new HttpError(404, 'That rider is not linked to this store.');
  }

  link.status = STORE_RIDER_STATUS.REVOKED;
  link.respondedAt = new Date();
  await link.save();

  res.json({ removed: true, riderId: String(link.rider) });
});

export default {
  getPublicStore,
  getMyStore,
  updateMyStore,
  listStores,
  searchRiders,
  listStoreRiders,
  inviteRider,
  removeStoreRider,
};