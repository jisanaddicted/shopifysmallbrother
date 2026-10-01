import mongoose from 'mongoose';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import Store from '../models/Store.js';
import StoreRider from '../models/StoreRider.js';
import User from '../models/User.js';
import { HttpError } from '../middleware/errorHandler.js';
import { buildPublicTree } from './categoryTreeController.js';
import { CANCELLED_STATUSES, LOGO_SIZE_MAX, LOGO_SIZE_MIN, isLogoSize, ROLES, STORE_RIDER_STATUS, THEME2, THEME_VALUES } from '../utils/constants.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { hostImage, publicIdFor, removeImage, storeFolder } from '../services/cloudinary.js';
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
  getAnyBySlug,
  getCached,
  invalidateStore,
  refreshInBackground,
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
/**
 * The store document as the PUBLIC storefront gets it, for a Theme 2 store.
 *
 * A Theme 2 shop never renders the Theme 1 category rail, so `categories` and
 * `categoryImages` are dead weight - and `categoryImages` is not small. Measured
 * on the seeded store: those two fields alone are 1,073,664 bytes of base64,
 * sent on every single page load to a storefront that cannot use them. That is
 * the majority of a 2MB response.
 *
 * The logo and the cover image stay, because the header and drawer really do
 * render them whatever the theme.
 *
 * DELIBERATELY the only place the public store is trimmed. A Theme 1 store gets
 * its document untouched, since those fields are exactly what it needs.
 */
function publicStoreFor(store) {
  const plain = store.toObject();
  delete plain.categories;
  delete plain.categoryImages;
  return plain;
}

/**
 * Build the public storefront payload for a store that is already loaded.
 *
 * Extracted out of the route handler so there is ONE definition of "what a
 * storefront response is". Three callers need it now - the blocking cold path,
 * the background revalidation behind an expired entry, and the boot warm-up - and
 * three copies would be three chances for them to disagree about a shape the
 * whole shop renders from. The `.lean()` note below is exactly the kind of trap a
 * second copy would eventually miss.
 */
async function buildPublicStorePayload(store) {
  /* A Theme 2 storefront needs the tree as much as it needs the products, and
   * the client cannot ask for both at once - it does not know the theme until
   * this response lands. So the tree comes back INSIDE this one.
   *
   * That turns what was three round trips (products, then a second request for
   * the tree) into one, and it removes the second loading state a shopper would
   * otherwise watch: the page used to render its header, then visibly fill in
   * the categories a moment later.
   *
   * The `theme` check is what keeps Theme 1 fast. A Theme 1 store never shows
   * this tree, and making it wait on two extra queries to a database a network
   * round trip away would slow down every store that does not use the feature. */
  const wantsTree = store.theme === THEME2;

  /* NO `.lean()` HERE, and that is not an oversight.
   *
   * `Product` sets `toJSON: { virtuals: true }`, so a hydrated document
   * serialises with far more than its stored fields: `id` (the `_id` as a
   * string), `hasVariants`, `effectivePrice`, `inventoryValue`, `channelCount`,
   * and the rest. `.lean()` returns raw POJOs and skips `toJSON` entirely, so
   * it would quietly drop every one of them from the PUBLIC storefront payload.
   *
   * This was caught by `testSections.mjs` ("no product is duplicated across
   * sections"), which failed only because `p.id` became `undefined` for every
   * product - the other missing virtuals broke the page in ways that test does
   * not assert on. A fast endpoint serving a subtly different shape is a worse
   * outcome than a slow one serving the right shape. */
  const products = await Product.find({ store: store._id }).sort({
    createdAt: -1,
  });

  /* The tree is built AFTER the products, and from them.
   *
   * Sequential on purpose, which reads like a step backwards but is the whole
   * point: the tree needs a per-category product count, and the alternative
   * was a `$group` aggregation over the products collection. Given the
   * products we are already holding, that count is a loop over an array -
   * no query, no round trip, no collection scan. Measured on a cold load over
   * the same link: 7.5s before, because of that scan. */
  const tree = wantsTree ? await buildPublicTree(store, products) : null;

  // `tree` is null - not [] - for a Theme 1 store, so the client can tell
  // "this store has no tree" from "this store is not a tree store" and never
  // renders a category panel for a theme that has none.
  const built = wantsTree
    ? { store: publicStoreFor(store), products, tree: tree.tree }
    : { store, products };

  setCached(store._id, SLOTS.STORE, built, store.slug);

  return built;
}

/**
 * Rebuild a storefront knowing only its slug, for the background refresh.
 *
 * Returns null when the store has since been closed or deleted - and in that
 * case DROPS the cached copy, which is the part that matters. The warm path
 * trusts the cached entry and does not re-check `isActive` on every request, so
 * without this a store closed while nobody was looking would keep being served
 * from an entry that every rebuild then politely refused to overwrite: a closed
 * shop staying open forever, which is worse than the 30s window the old code
 * had. Clearing it sends the next request down the cold path, which answers 404.
 */
async function rebuildPublicStore(slug) {
  const store = await Store.findOne({ slug });

  if (!store || !store.isActive) {
    invalidateStore(slug);
    return null;
  }

  return buildPublicStorePayload(store);
}

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

     Two things come back from that lookup and BOTH are needed: the payload, and
     whether it is still inside its TTL. An expired entry is still ANSWERED FROM
     - see `getAnyBySlug` for why, and for the measurement that made this the most
     valuable change in the whole load path (a 7.5s white screen became 15ms) -
     and the rebuild is started behind the shopper instead of in front of them.
     The only request that waits for the database is one that arrives when this
     process has never seen the slug at all.

     The tradeoff is a closed store: this trusts the cached copy and so does not
     re-check `isActive` on every request. That is bounded by the 30s TTL - and
     now also by the revalidation, which clears the entry outright the moment a
     rebuild finds the store closed (see `rebuildPublicStore`) - so the window is
     "until the next expiry", not "forever". */
  const cached = getAnyBySlug(slug, SLOTS.STORE);
  if (cached) {
    res.json(cached.payload);

    if (!cached.fresh) {
      refreshInBackground(SLOTS.STORE, cached.storeId, () =>
        rebuildPublicStore(slug),
      );
    }
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

  const alreadyBuilt = getCached(store._id, SLOTS.STORE);
  if (alreadyBuilt) {
    res.json(alreadyBuilt);
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

    return buildPublicStorePayload(store);
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

  /* A WRITABLE DOCUMENT, not `entry.store`.

     This is the whole reason this endpoint 500'd on every save ("store.save is
     not a function"). `storesForUser` runs its results through withVirtuals()
     to attach `publicPath`, and that returns `{ ...store.toObject(), publicPath }`
     - a PLAIN OBJECT. It carries the right fields and serialises correctly, so
     every read path is happy, but it has no .save(), no .markModified() and no
     validators. Anything that WRITES the storefront has to start from a real
     Mongoose document.

     Re-fetched rather than reusing the projected one for two reasons: the
     projection (SESSION_STORE_FIELDS) omits fields this handler writes - theme,
     logoSize, categories - so a write to any of them would silently vanish; and
     writing to the projected document is impossible anyway. Authorization was
     already decided against `entry` above, so this is only re-reading a store
     the caller has been cleared for. */
  const store = await Store.findById(entry.store._id);
  if (!store) throw new HttpError(404, 'You do not have a store yet.');

  const { name, description, phone, address, image, logo, isActive, slug } =
    req.body || {};

  if (name !== undefined) {
    const clean = String(name).trim();
    if (!clean) throw new HttpError(400, 'A store needs a name.');
    store.name = clean;
  }

  if (description !== undefined) store.description = String(description).trim();
  if (phone !== undefined) store.phone = String(phone).trim();

  /* Images are HOSTED, not embedded (see services/cloudinary.js): a data URL
     the client downscaled and sent goes to Cloudinary, and only the resulting
     URL is stored. That is what turns a ~90KB logo field into a ~120-byte one,
     and what lets the browser cache the picture as an image. Replacing or
     clearing one deletes the old asset, so the account does not grow a copy of
     every logo the merchant ever uploaded. */
  if (image !== undefined) {
    const hosted = await hostImage(String(image || '').trim(), {
      folder: storeFolder(store._id, 'cover'),
      publicId: publicIdFor(store._id, 'cover'),
    });
    if (hosted !== store.image) await removeImage(store.image);
    store.image = hosted;
  }
  if (logo !== undefined) {
    const hosted = await hostImage(String(logo || '').trim(), {
      folder: storeFolder(store._id, 'logo'),
      publicId: publicIdFor(store._id, 'logo'),
    });
    if (hosted !== store.logo) await removeImage(store.logo);
    store.logo = hosted;
  }
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

  /* How large the storefront header draws the logo, in pixels. See Store.logoSize.

     Validated rather than cast, for the same reason `theme` above is: an
     out-of-range size would otherwise save and then render a header that has
     pushed its own buttons off the screen, with nothing to undo it from. The
     model's min/max is the backstop; this is the one that explains itself.

     `Number('') `is 0 and `Number('big')` is NaN, so a blank or a word is
     refused by the same check rather than sneaking through as a real number. */
  if (req.body?.logoSize !== undefined) {
    const size = Number(req.body.logoSize);
    if (!isLogoSize(size)) {
      throw new HttpError(
        400,
        `A logo size must be a number between ${LOGO_SIZE_MIN} and ${LOGO_SIZE_MAX}.`,
      );
    }
    store.logoSize = Math.round(size);
  }

  if (address !== undefined) {
    store.address = {
      line1: String(address?.line1 || '').trim(),
      city: String(address?.city || '').trim(),
    };
  }

  /* The public URL segment, /s/<slug>.

     A rename has to move the URL with it, or a merchant who fixes a typo in
     "Joes Pizza" is left with a storefront whose address still carries it -
     and worse, a rename that silently keeps the old URL means the link they
     already shared with customers quietly stops matching the shop's name.

     But auto-updating unconditionally would be worse: a merchant who chose
     "joes-pizza-downtown" by hand and later renames the store would lose that
     address, and any link already printed on a menu would 404. So the slug
     follows the name only while it has not been claimed - see
     Store.slugIsCustom, which is the ONLY thing that decides that.

     `slugLocked` is the client saying which of the two it is, and it travels
     with the slug so the server never has to guess: false = "derived, keep
     deriving" (this is also how a merchant hands a claimed link back to the
     name), true = "mine, leave it alone". A request that sends a slug but no
     flag is treated as deliberate - posting a slug is an explicit act.

     An earlier version decided all of this by comparing the slug against the
     previous name, and it was wrong in the direction that matters: a store
     renamed once ("Joe's Pizza" -> "Ronex mart") carries a slug matching
     neither name, so the comparison read it as hand-chosen and its link could
     never move again - the merchant renames, saves, and nothing happens. A
     comparison cannot tell a deliberate choice from a stale one; the flag can,
     because only the dashboard ever sets it. */
  const explicitSlug = String(slug ?? '').trim();
  const unclaimed = !store.slugIsCustom || req.body?.slugLocked === false;

  if (explicitSlug) {
    if (slugify(explicitSlug, '') !== store.slug) {
      store.slug = await uniqueSlug(explicitSlug, {
        exists: (candidate, excludeId) =>
          Store.exists({ slug: candidate, _id: { $ne: excludeId } }),
        excludeId: store._id,
      });
    }
    // `!== false` rather than `=== true`: absent means deliberate, because the
    // only caller that can say "derived" is the dashboard, and it always does.
    store.slugIsCustom = req.body?.slugLocked !== false;
  } else if (name !== undefined && unclaimed) {
    store.slug = await uniqueSlug(store.name, {
      exists: (candidate, excludeId) =>
        Store.exists({ slug: candidate, _id: { $ne: excludeId } }),
      excludeId: store._id,
    });
    store.slugIsCustom = false;
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

/**
 * Warm the storefront cache for the stores most likely to be opened next.
 *
 * The cache is process-local, so EVERY restart of the API starts it empty - and
 * in development the API restarts on every file save (`node --watch`), which made
 * "the first visit is always the slow one" the normal experience rather than an
 * occasional one. Measured on this project's own data: the first
 * `/stores/:slug` after a restart took 7.5s, the next one 15ms.
 *
 * The set to warm is "the stores a merchant most recently changed", which is the
 * cheapest useful guess available without a request log: `updatedAt` is already
 * on every store, and a shop somebody has just been working on is a shop about to
 * be opened. It is only a GUESS, so it is capped, and it is never allowed to
 * matter: the caller does not await it, each store is built independently, and a
 * failure in any one of them is counted and dropped rather than retried or
 * thrown. Nothing here can delay the server accepting traffic, and a store that
 * is not in this list is not broken - it just pays the cold path once, exactly as
 * it did before.
 */
export async function warmStorefronts(limit = 4) {
  const stores = await Store.find({ isActive: true })
    .sort({ updatedAt: -1 })
    .limit(limit);

  const results = await Promise.allSettled(
    stores.map((store) => buildPublicStorePayload(store)),
  );

  const warmed = results.filter((result) => result.status === 'fulfilled');
  const failed = results.length - warmed.length;

  return { warmed: warmed.length, failed, slugs: stores.map((store) => store.slug) };
}

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