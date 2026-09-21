import mongoose from 'mongoose';
import Product from '../models/Product.js';
import Store from '../models/Store.js';
import StoreRider from '../models/StoreRider.js';
import User from '../models/User.js';
import { HttpError } from '../middleware/errorHandler.js';
import { ROLES, STORE_RIDER_STATUS } from '../utils/constants.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { normaliseUsername, slugify, uniqueSlug } from '../utils/slug.js';
import {
  loadManageableStore,
  primaryStoreFor,
  storesForUser,
  STORE_ROLES,
} from '../utils/storeAccess.js';

// The public shape of a rider, shared by the roster and the search results.
const RIDER_FIELDS = 'name username email phone isAvailable location';

const escapeRegExp = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The roster is the owner's business: a store admin may work with the orders
 * and the catalogue, but only the account that signed the store up may add or
 * remove team members.
 */
async function loadOwnedStore(storeId, user) {
  const { store, role } = await loadManageableStore(storeId, user);

  if (role === STORE_ROLES.ADMIN) {
    throw new HttpError(403, 'Only the store owner can manage the team.');
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

/**
 * GET /api/stores/mine - the store the signed-in account runs, plus its team.
 *
 * Works for the owner who signed the store up and for every store admin that
 * owner appointed. `role` says which of the two the caller is, so the client
 * can hide the owner-only controls instead of failing on them.
 */
export const getMyStore = asyncHandler(async (req, res) => {
  const entry = await primaryStoreFor(req.user);
  if (!entry) throw new HttpError(404, 'You do not have a store yet.');

  const { store, role } = entry;

  const links = await StoreRider.find({
    store: store._id,
    status: { $ne: STORE_RIDER_STATUS.REVOKED },
  })
    .populate('rider', RIDER_FIELDS)
    .sort({ createdAt: -1 });

  const members = links.filter((link) => link.rider);

  res.json({
    store,
    role,
    // True only for the account that signed the store up: it may edit the
    // storefront and manage the team.
    isOwner: role === STORE_ROLES.OWNER,
    // `members` holds every rider AND store admin; `riders`/`admins` are the
    // two subsets the dashboard renders separately.
    members,
    riders: members.filter((link) => link.role !== 'admin'),
    admins: members.filter((link) => link.role === 'admin'),
  });
});

/**
 * GET /api/stores/mine/all - every store this account runs (owner + admin).
 *
 * The merchant dashboard shows only the primary store today; this powers the
 * new "My storefronts" card with each store's landing-page link (/s/<slug>)
 * and lets the dashboard switch between stores. Uses storesForUser so an
 * appointed store admin sees their stores too. Ordered owners-first to match
 * the session ordering.
 */
export const listMyMerchantStores = asyncHandler(async (req, res) => {
  const entries = await storesForUser(req.user);

  res.json({
    stores: entries.map((entry) => ({
      store: entry.store,
      role: entry.role,
      isOwner: entry.role === STORE_ROLES.OWNER,
    })),
  });
});

/** PATCH /api/stores/mine - edit the storefront details (owner only).
 * Accepts `?storeId=` (or body.storeId) to edit one of several stores;
 * without it the primary store is used. */
export const updateMyStore = asyncHandler(async (req, res) => {
  const requested = req.query.storeId || req.body?.storeId || null;
  const entry = requested
    ? await loadManageableStore(requested, req.user)
    : await primaryStoreFor(req.user);
  if (!entry) throw new HttpError(404, 'You do not have a store yet.');

  if (entry.role !== STORE_ROLES.OWNER) {
    throw new HttpError(
      403,
      'Only the store owner can change the storefront. Ask the owner to do it.',
    );
  }

  const store = entry.store;
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

/** GET /api/stores/:id/riders - the store's team (pending + active bindings). */
export const listStoreRiders = asyncHandler(async (req, res) => {
  const store = await loadOwnedStore(req.params.id, req.user);

  const links = await StoreRider.find({
    store: store._id,
    status: { $ne: STORE_RIDER_STATUS.REVOKED },
  })
    .populate('rider', RIDER_FIELDS)
    .sort({ createdAt: -1 });

  const members = links.filter((link) => link.rider);

  res.json({
    store: { _id: store._id, name: store.name, slug: store.slug },
    // Every member, whatever the role on the row: 'rider' delivers, 'admin'
    // helps run the store. `admins` is the store-admin subset.
    members,
    riders: members,
    admins: members.filter((link) => link.role === 'admin'),
  });
});

/**
 * POST /api/stores/:id/riders  { username, role }  (store owner only)
 *
 * Invites a member by username. `role: 'admin'` asks the person to help run
 * the store - once they accept they can manage that store's products and see
 * its orders; the default `role: 'rider'` is a delivery invitation and
 * requires a rider account. The invitee must accept before the binding goes
 * active, so a new row starts as `pending`.
 */
export const inviteRider = asyncHandler(async (req, res) => {
  const store = await loadOwnedStore(req.params.id, req.user);
  const handle = normaliseUsername(req.body?.username);
  const memberRole = req.body?.role === 'admin' ? 'admin' : 'rider';

  if (!handle) {
    throw new HttpError(400, 'Enter a username or email address to invite.');
  }

  // A handle first, then an email address, so an owner can appoint somebody
  // who never picked a username.
  const invitee = await User.findOne({
    $or: [{ username: handle }, { email: handle }],
  });
  if (!invitee) {
    throw new HttpError(
      404,
      `No account found for “${handle}”. Check the username or email address.`,
    );
  }
  if (memberRole === 'rider' && invitee.role !== ROLES.RIDER) {
    throw new HttpError(400, 'That account is not a rider.');
  }
  if (String(invitee._id) === String(store.owner)) {
    throw new HttpError(400, 'The store owner already runs this store.');
  }

  // How the roster refers to this person: their handle when they have one.
  const label = invitee.username ? `@${invitee.username}` : invitee.email;

  const existing = await StoreRider.findOne({
    store: store._id,
    rider: invitee._id,
  });

  if (existing) {
    if (
      existing.status === STORE_RIDER_STATUS.ACTIVE &&
      existing.role === memberRole
    ) {
      throw new HttpError(
        409,
        memberRole === 'rider'
          ? `${label} already delivers for this store.`
          : `${label} already helps run this store.`,
      );
    }
    if (
      existing.status === STORE_RIDER_STATUS.PENDING &&
      existing.role === memberRole
    ) {
      throw new HttpError(409, `${label} already has a pending invitation.`);
    }

    // Previously declined/revoked, or switching role - re-open the same row.
    existing.status = STORE_RIDER_STATUS.PENDING;
    existing.role = memberRole;
    existing.invitedBy = req.user._id;
    existing.respondedAt = null;
    await existing.save();
    await existing.populate('rider', RIDER_FIELDS);

    return res.json({ invitation: existing, reinvited: true });
  }

  const invitation = await StoreRider.create({
    store: store._id,
    rider: invitee._id,
    role: memberRole,
    invitedBy: req.user._id,
    status: STORE_RIDER_STATUS.PENDING,
  });

  await invitation.populate('rider', RIDER_FIELDS);

  res.status(201).json({ invitation });
});

/**
 * DELETE /api/stores/:id/riders/:riderId  (store owner only)
 *
 * Marked `revoked` rather than deleted, so the same rider (or store admin)
 * can be invited again later without hitting the unique index. Revoking a
 * store admin's membership takes their product and order access away with it.
 */
export const removeStoreRider = asyncHandler(async (req, res) => {
  const store = await loadOwnedStore(req.params.id, req.user);

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
  listMyMerchantStores,
  updateMyStore,
  listStores,
  searchRiders,
  listStoreRiders,
  inviteRider,
  removeStoreRider,
};