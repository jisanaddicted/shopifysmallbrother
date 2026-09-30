import mongoose from 'mongoose';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import Store from '../models/Store.js';
import StoreRider from '../models/StoreRider.js';
import User from '../models/User.js';
import { HttpError } from '../middleware/errorHandler.js';
import { CANCELLED_STATUSES, ROLES, STORE_RIDER_STATUS, THEME_VALUES } from '../utils/constants.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { normaliseUsername, slugify, uniqueSlug } from '../utils/slug.js';
import {
  loadManageableStore,
  primaryStoreFor,
  storesForUser,
  STORE_ROLES,
} from '../utils/storeAccess.js';
import { customersForStore } from '../utils/storeCustomer.js';
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
 * GET /api/stores/:id/customers -> { customers, total, newThisWeek }
 *
 * Every account that signed up at, signed in at, or ordered from this store.
 * Open to the owner, every store admin they appointed, and platform admins -
 * exactly the same people who can already see the store's orders.
 *
 * Each entry also carries `orders`, `spent` and `location`, which is what the
 * customers table ranks people by. They are rolled up from the store's own
 * orders in ONE aggregation rather than a query per customer: the list page
 * shows every customer, so the N+1 version was a query per row, and it was the
 * count on screen, not a limit.
 *
 * Cancelled orders are left out of the count and the spend on purpose - money
 * that was never taken is not revenue, and counting it would tell a merchant
 * their best customer is somebody who cancelled twice.
 */
export const listStoreCustomers = asyncHandler(async (req, res) => {
  const { store } = await loadManageableStore(req.params.id, req.user);

  // The customer list and the order rollup read different collections and never
  // depend on each other, so they run together. This page is one of the
  // merchant's most-opened screens and it was paying two sequential round trips
  // to a remote cluster for every load.
  const [customers, spendByCustomer] = await Promise.all([
    customersForStore(store._id),
    // One pass over this store's orders, grouped by who placed them.
    Order.aggregate([
      { $match: { store: store._id, customer: { $ne: null } } },
      {
        $group: {
          _id: '$customer',
          orders: { $sum: 1 },
          spent: {
            $sum: {
              $cond: [{ $in: ['$status', CANCELLED_STATUSES] }, 0, '$total'],
            },
          },
          // The most recent delivery address on file, for the Location column.
          location: { $first: '$address.city' },
        },
      },
    ]),
  ]);

  const rollup = new Map(
    spendByCustomer.map((row) => [String(row._id), row]),
  );

  const enriched = customers.map((entry) => {
    const row = rollup.get(String(entry.customer?._id));
    return {
      ...entry,
      orders: row?.orders || 0,
      spent: row?.spent || 0,
      location: row?.location || '',
    };
  });

  res.json({
    customers: enriched,
    total: enriched.length,
    // Handy for a "N new this week" badge on the dashboard.
    newThisWeek: customers.filter(
      (entry) =>
        entry.joinedAt &&
        Date.now() - new Date(entry.joinedAt).getTime() < 7 * 24 * 60 * 60 * 1000,
    ).length,
  });
});

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

  /* Answer from memory with NO database contact, if this process has seen the
     slug before.

     Checked BEFORE resolving the store, and that ordering is the whole trick.
     The route is addressed by slug but the cache is keyed by store id, so
     resolving the id first would mean a `Store.findOne` on every single request
     - and against a remote cluster that one round trip was measured at ~4s,
     which meant the "cached" path was no faster than the uncached one. Looking
     the slug up in memory first is what makes a repeat visit instant instead of
     merely cheaper.

     The tradeoff is a closed store: this trusts the cached copy and so does not
     re-check `isActive` on every request. That is bounded by the 30s TTL, and
     closing a store goes through `updateMyStore`, which invalidates it - so the
     window is "until the next expiry", not "forever". */
  const warm = getCachedBySlug(slug, SLOTS.STORE);
  if (warm) {
    res.json(warm);
    return;
  }

  /* Cold: resolve the slug, then read the products.
   *
   * These are sequential because the products query is keyed on the store's id
   * and cannot start until the first returns. That is unavoidable - but it is
   * now paid once per TTL instead of once per page view. */
  const store = await Store.findOne({ slug });
  if (!store || !store.isActive) {
    throw new HttpError(404, 'That store does not exist or is closed.');
  }

  // A slug is stable for the life of a store, and the warm path above depends on
  // this mapping existing, so record it as soon as it is known.
  rememberSlug(store.slug, store._id);

  const cached = getCached(store._id, SLOTS.STORE);
  if (cached) {
    res.json(cached);
    return;
  }

  /* Two shoppers opening the same shop at the same moment - or the ShopPage and
     the Navbar on ONE page, which both ask for this - would otherwise run this
     query twice and both wait for it. `dedupe` lets the second caller await the
     first one's result, so the duplication costs one slow request rather than
     two. This is the single largest saving on a first visit, because it halves
     a multi-second wait rather than shaving a millisecond off it. */
  const payload = await dedupe(SLOTS.STORE, store._id, async () => {
    // Re-check inside: a request that queued behind this one may have just
    // populated the cache, and re-querying would defeat the point of waiting.
    const fresh = getCached(store._id, SLOTS.STORE);
    if (fresh) return fresh;

    /* NO `.lean()` HERE, and that is not an oversight.
     *
     * `Product` sets `toJSON: { virtuals: true }`, so a hydrated document
     * serialises with far more than its stored fields: `id` (the `_id` as a
     * string), `hasVariants`, `effectivePrice`, `inventoryValue`,
     * `channelCount`, and the rest. `.lean()` returns raw POJOs and skips
     * `toJSON` entirely, so it would quietly drop every one of them from the
     * PUBLIC storefront payload.
     *
     * This was caught by `testSections.mjs` ("no product is duplicated across
     * sections"), which failed only because `p.id` became `undefined` for every
     * product - the other missing virtuals broke the page in ways that test does
     * not assert on. A fast endpoint serving a subtly different shape is a worse
     * outcome than a slow one serving the right shape, and against a 1-4s network
     * round trip the hydration cost is not what makes this page slow anyway. */
    const products = await Product.find({ store: store._id }).sort({
      createdAt: -1,
    });

    const built = { store, products };
    setCached(store._id, SLOTS.STORE, built, store.slug);
    return built;
  });

  res.json(payload);
});

/**
 * GET /api/stores/mine[?storeId=] - the store the signed-in account runs, plus
 * its team.
 *
 * Works for the owner who signed the store up, for every store admin that owner
 * appointed, and for a platform admin who was appointed to run the store.
 * `role` says which of the three the caller is, so the client can hide the
 * owner-only controls instead of failing on them.
 *
 * `?storeId=` picks one of several stores - the same convention as
 * /orders/store/mine and /orders/store/analytics, and what lets the admin
 * panel's rider tracker switch between the stores an admin runs. Without it the
 * primary store (the one owned, otherwise the first one administered) is used.
 *
 * The team roster is READABLE by any of those three, but only the owner may
 * change it: that stays guarded by the /stores/:id/riders routes.
 */
export const getMyStore = asyncHandler(async (req, res) => {
  const requested = req.query.storeId || null;

  const entry = requested
    ? await loadManageableStore(requested, req.user)
    : await primaryStoreFor(req.user);

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
  const { name, description, phone, address, image, logo, isActive, slug } =
    req.body || {};

  if (name !== undefined) {
    const clean = String(name).trim();
    if (!clean) throw new HttpError(400, 'A store needs a name.');
    store.name = clean;
  }

  if (description !== undefined) store.description = String(description).trim();
  if (phone !== undefined) store.phone = String(phone).trim();
  if (image !== undefined) store.image = String(image).trim();
  if (logo !== undefined) store.logo = String(logo || '').trim();
  if (isActive !== undefined) store.isActive = Boolean(isActive);

  /* Which storefront layout this store shows. See Store.theme.

     Validated rather than cast, because this is a closed set of two and a typo
     would otherwise be stored and then fail to match either - leaving the
     storefront with no theme at all and the merchant with no way to say why.
     The model enum would also reject it at save time, but by then the merchant
     has already lost the setting they were trying to change, with a 500 rather
     than a message that names the problem. */
  if (req.body?.theme !== undefined) {
    const theme = String(req.body.theme || '').trim();
    if (!THEME_VALUES.includes(theme)) {
      throw new HttpError(
        400,
        `“${theme || '(blank)'}” is not a theme. Use ${THEME_VALUES.join(' or ')}.`,
      );
    }
    store.theme = theme;
  }

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

  // The public store endpoint is cached, and this is the write that most often
  // changes what it returns - switching theme changes the whole storefront's
  // shape. Without this, a merchant who switches to Theme 2 and refreshes sees
  // Theme 1 still, and reasonably concludes the switch did not save.
  invalidateStore(store._id);

  res.json({ store });
});

/**
 * GET /api/stores (admin) - every store this account runs.
 *
 * The panel is scoped to owned stores plus accepted invitations (see
 * storesForUser), so this feeds the Theme editor's store picker with exactly
 * the stores the admin may work on - nothing platform-wide anymore.
 */
export const listStores = asyncHandler(async (req, res) => {
  const entries = await storesForUser(req.user);

  res.json({ stores: entries.map((entry) => entry.store) });
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