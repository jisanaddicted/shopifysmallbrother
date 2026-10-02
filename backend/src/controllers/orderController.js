import crypto from 'node:crypto';
import mongoose from 'mongoose';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import Store from '../models/Store.js';
import User from '../models/User.js';
import { HttpError } from '../middleware/errorHandler.js';
import { hashGuestToken, issueGuestToken } from '../middleware/auth.js';
import {
  CANCELLABLE_STATUSES,
  CLOSED_STATUSES,
  ORDER_STATUS,
  ORDER_STATUS_VALUES,
  RECEIVABLE_STATUSES,
  ROLES,
  STORE_CUSTOMER_SOURCE,
} from '../utils/constants.js';
import { priceOrder, riderAllowedStatuses, adminNextStatus } from '../utils/pricing.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { canAccessOrder } from '../utils/orderAccess.js';
import { activeStoreIds, isBoundToStore } from '../utils/storeRider.js';
import { summariseTimings, summariseByRider } from '../utils/deliveryTiming.js';
import { resolveErrorMessage, resolveLineTarget } from '../utils/variants.js';
import {
  loadManageableStore,
  managedStoreIds,
  primaryStoreFor,
  STORE_ROLES,
} from '../utils/storeAccess.js';
import { emitOrderStatusUpdated, notifyStoreMembers } from '../sockets/index.js';
import { ensureStoreCustomer } from '../utils/storeCustomer.js';

/**
 * How many of a rider's most recent orders feed the analytics page. The averages
 * are computed over this window rather than every delivery ever made, so the
 * numbers describe how the rider is doing *now* and the query stays bounded.
 */
const ANALYTICS_WINDOW = 100;

/**
 * How many of a store's most recent orders feed the store analytics tab. Wider
 * than the rider's own window because a store wants its whole recent history
 * here, and the per-rider rollup gets thin fast with only 100 rows.
 */
const STORE_ANALYTICS_WINDOW = 200;

// The tracker needs the rider's name/phone and the customer's details, and
// the store so the page can show which merchant the order is from.
// NOTE: `username` MUST stay in the rider select - the merchant dashboard
// renders `@${order.rider.username}` and drops to `@undefined` without it.
//
// `items.product` is a *live* lookup of the catalogue row, unlike the frozen
// name/price copied onto the line. That is deliberate: a receipt must never
// change, but "where do I find this?" is a question about right now - if the
// merchant re-shelves a product, the picker must see the new rack, not the one
// recorded at checkout. Only the picking fields are selected.
const ORDER_POPULATE = [
  { path: 'rider', select: 'name username phone email location' },
  { path: 'customer', select: 'name email phone' },
  { path: 'store', select: 'name slug image' },
  // `variants` is selected so the pick list can show a variant's own photo, and
  // so a receipt line whose variant still exists can be matched back to its row
  // without a second query. The line's own `variantTitle` remains the source of
  // truth for what was sold.
  { path: 'items.product', select: 'name rack shelf category image variants' },
];

/**
 * ORDER_POPULATE, plus the store's `logo` - for reading ONE order at a time.
 *
 * The order tracker brands its navbar with the shop the delivery is coming
 * from, and this single-order read is the one place that has to carry the logo.
 * (The list populate cannot: see below.)
 *
 * DERIVED from ORDER_POPULATE rather than written out again, so the two cannot
 * drift. Everything except the store's select is shared by reference, so a
 * field added to (or dropped from) the order detail follows automatically and
 * only the logo has to be added here.
 *
 * WHY NOT JUST ADD `logo` TO ORDER_POPULATE
 *
 * ORDER_POPULATE is also what every order LIST uses - getMyOrders, the rider's
 * orders, the claim pool, and both analytics windows. `Store.logo` is a plain
 * String that is a Cloudinary URL for a migrated store but still a ~90KB base64
 * data URL for any store predating that migration, and a list would ship it
 * once per row. That is precisely the payload this file already refuses to send
 * anywhere else (see ORDER_LIST_POPULATE, and the same reasoning in
 * utils/storeAccess.js for the session). One logo on one order is bounded; the
 * same logo on fifty rows is the 942KB storefront problem again.
 */
const ORDER_DETAIL_POPULATE = ORDER_POPULATE.map((spec) =>
  spec.path === 'store' ? { ...spec, select: 'name slug image logo' } : spec,
);

/**
 * The same shape as ORDER_POPULATE, minus the live catalogue lookup.
 *
 * For a LIST of orders the receipt already carries everything the table shows:
 * each line has its own frozen `name` and `price` copied at checkout. Populating
 * `items.product` there re-joins the whole catalogue onto every row, and on a
 * busy store that is the single most expensive thing the orders board does - the
 * product document (with `variants` and `image`) is larger than the order line
 * it sits on, and it is repeated for every line of every order.
 *
 * The full populate is still what the ORDER DETAIL page uses, which is where the
 * merchant is picking items off shelves and genuinely needs live catalogue data.
 * A list does not.
 */
const ORDER_LIST_POPULATE = [
  { path: 'rider', select: 'name username phone' },
  { path: 'customer', select: 'name email phone' },
  { path: 'store', select: 'name slug' },
];

/**
 * The exact set of fields the orders TABLE renders, for a list query.
 *
 * Kept beside ORDER_LIST_POPULATE and for the same reason: a list is not a
 * detail page, and the detail page fetches the full document itself.
 *
 *   _id            the order number / detail link
 *   createdAt      the "when" column
 *   customer       who it is for (populated)
 *   store          which merchant (populated)
 *   total          the price column
 *   payment.status the paid badge
 *   paymentMethod  the cash-vs-online column
 *   status         fulfillment + delivery badges
 *   items.quantity the item count column
 *
 * Deliberately NOT selected: `guest`, `address`, `location`, `payment` in full,
 * `statusHistory`, `cancelReason` and the rest of each line. None of it is
 * rendered here, and all of it was being shipped on every page load.
 *
 * `isOpen` is a virtual (isOpen === false once CLOSED_STATUSES is reached) and
 * is NOT stored, so it cannot be selected. The list sends it explicitly below,
 * because the table derives "delivered" from it.
 */
const ORDER_LIST_FIELDS =
  '_id createdAt customer store total payment.status paymentMethod status items.quantity';

const toFiniteNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Loads an order by id, or throws the right 400/404/403.
 *
 * Exported because the payment routes need to answer exactly the same question
 * ("may this caller act on this order?") as the order routes - including the
 * guestToken path, since a guest can pay online just as they can cancel or
 * confirm a delivery. Re-implementing that check in the payment controller is
 * how the two would eventually disagree.
 */
export async function loadOrderFor(orderId, user, guestTokenRaw = null) {
  if (!mongoose.isValidObjectId(orderId)) {
    throw new HttpError(400, 'That order id is not valid.');
  }

  const order = await Order.findById(orderId)
    .select('+guestTokenHash')
    .populate(ORDER_DETAIL_POPULATE);
  if (!order) throw new HttpError(404, 'That order does not exist.');

  // Guest access: whoever holds the raw token from checkout may view/cancel
  // this one order — only while it is still theirs (customer === null).
  if (!user && guestTokenRaw && !order.customer && order.guestTokenHash) {
    const expected = Buffer.from(order.guestTokenHash, 'utf8');
    const actual = Buffer.from(hashGuestToken(guestTokenRaw), 'utf8');
    if (
      expected.length === actual.length &&
      crypto.timingSafeEqual(expected, actual)
    ) {
      return order;
    }
  }

  if (!user) throw new HttpError(401, 'You need to sign in to do that.');

  // A rider's bound stores unlock view access to that store's unclaimed
  // orders (the pool). For everyone else the stores they run - as owner or as
  // an appointed store admin - unlock that store's orders. Action endpoints
  // re-check their own stricter rules.
  const isRider = user.role === ROLES.RIDER;
  const boundStoreIds = isRider ? await activeStoreIds(user._id) : [];
  const memberStoreIds = await managedStoreIds(user);

  if (!canAccessOrder(order, user, boundStoreIds, memberStoreIds)) {
    throw new HttpError(403, 'This order does not belong to you.');
  }

  return order;
}

/**
 * "Is this caller the person who PLACED this order?" - throws 401/403 if not.
 *
 * Needed by every action only the buyer may take: cancelling, confirming
 * receipt, and starting a payment.
 *
 * It cannot be answered by `canAccessOrder`, and this is the important part:
 * that function deliberately admits the ASSIGNED RIDER and the store staff,
 * because they need to see the order they are working on. But seeing an order
 * is not the same as owning it, and a rider who can open a payment session for
 * somebody else's basket is a real hole - the smoke test caught exactly that.
 *
 * A guest counts as the buyer when they hold the token, which `loadOrderFor` has
 * already verified by the time this runs.
 *
 * NOTE: cancelOrder still spells its own version out longhand, because it also
 * lets a platform admin through. Left alone rather than refactored, so a
 * long-standing message other code may assert on does not change.
 */
export function assertOrderOwner(order, user) {
  const isGuestCaller = !user && !order.customer;
  if (isGuestCaller) return;

  if (!user) throw new HttpError(401, 'You need to sign in to do that.');

  if (String(order.customer?._id || order.customer) === String(user._id)) return;

  throw new HttpError(
    403,
    'Only the customer who placed this order can do that.',
  );
}

/** Appends to the audit trail, saves, and tells the tracker over the socket. */
async function applyStatus(order, status, { note = '', by = null } = {}) {
  order.status = status;
  order.statusHistory.push({ status, note, by, at: new Date() });

  /* Stamp the denormalised terminal timestamps here, and ONLY here, so they can
   * never disagree with the history entries they mirror. `deliveredAt` is what
   * the dispatch board's "completed today" card ranges over, and it has to be
   * an indexed field rather than a search through statusHistory.
   *
   * Every write goes through this function, which is what makes it safe: the one
   * place a status changes is the one place these get set. Re-delivery is
   * impossible (a rider cannot rewind), but `received` after `delivered` is
   * normal, so `deliveredAt` is only set on the first arrival and is never
   * overwritten by the customer's later confirmation. */
  const at = new Date();
  if (status === ORDER_STATUS.DELIVERED && !order.deliveredAt) {
    order.deliveredAt = at;
  }
  if (status === ORDER_STATUS.DELIVERY_FAILED) {
    order.failedAt = at;
    // Count ATTEMPTS that have failed, so DELIVERY_MAX_RETRIES can gate a
    // re-dispatch off this number directly. A repeat failure counts up, and
    // the cap is what eventually stops a rider burning an evening on a gate
    // nobody will open.
    order.retryCount = (order.retryCount || 0) + 1;
  }

  await order.save();

  emitOrderStatusUpdated(order._id, status, note);
  return order;
}

// ---------------------------------------------------------------------------
// Customer
// ---------------------------------------------------------------------------

/**
 * POST /api/orders
 * body: {
 *   items: [{ productId, name, price, quantity }],
 *   address: { label, line1, city, phone, notes },
 *   location: { lat, lng },
 *   paymentMethod: 'cod',
 *   guest: { name, email }            <- guest checkout (no account)
 * }
 *
 * Signed-in customers (role customer/admin) order as themselves. Guests order
 * with just name + phone (+ optional email) and get back a `guestToken` that
 * unlocks GET /orders/:id?guestToken=… and the live tracker — no signup.
 *
 * Prices are recalculated from the catalogue so a tampered cart can't set its
 * own total. The numbers sent by the client are only a fallback for products
 * that were deleted after the basket was filled.
 */
export const createOrder = asyncHandler(async (req, res) => {
  const { items, address, location, paymentMethod, guest } = req.body || {};

  const signedIn = Boolean(req.user);
  if (signedIn && ![ROLES.CUSTOMER, ROLES.ADMIN].includes(req.user.role)) {
    throw new HttpError(403, 'Only customers can place orders.');
  }

  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpError(400, 'Your cart is empty.');
  }

  const cleanAddress = {
    label: String(address?.label || 'Home').trim(),
    line1: String(address?.line1 || '').trim(),
    city: String(address?.city || '').trim(),
    phone: String(address?.phone || '').trim(),
    notes: String(address?.notes || '').trim(),
  };

  if (!cleanAddress.line1) {
    throw new HttpError(400, 'A street address is required.');
  }
  if (!cleanAddress.phone) {
    throw new HttpError(400, 'A contact phone number is required.');
  }

  const lat = toFiniteNumber(location?.lat);
  const lng = toFiniteNumber(location?.lng);
  if (lat === null || lng === null) {
    throw new HttpError(400, 'Please drop a pin so the rider can find you.');
  }

  // Look the products up so name/price come from the database, not the client.
  const productIds = items
    .map((line) => line?.productId)
    .filter((id) => mongoose.isValidObjectId(id));

  const products = await Product.find({ _id: { $in: productIds } });
  const byId = new Map(products.map((product) => [String(product._id), product]));

  // Which store is this order for? Derived from the products, so the client
  // cannot mislabel it. A basket mixing several stores is rejected rather than
  // guessed at, because only one store can own the order.
  const storeIds = [
    ...new Set(
      products.map((product) => product.store).filter(Boolean).map(String),
    ),
  ];

  if (storeIds.length > 1) {
    throw new HttpError(
      400,
      'Your cart mixes items from different stores. Please order them separately.',
    );
  }

  let storeId = storeIds[0] || null;

  // Fall back to an explicit storeId (useful when every product was deleted
  // since the basket was filled).
  if (!storeId && mongoose.isValidObjectId(req.body?.storeId)) {
    storeId = String(req.body.storeId);
  }

  if (storeId) {
    const storeExists = await Store.exists({ _id: storeId, isActive: true });
    if (!storeExists) {
      throw new HttpError(400, 'That store is not accepting orders right now.');
    }
  }

  // Lines whose variant could not be resolved, collected rather than thrown from
  // inside the map so every line is examined and the shopper is told about the
  // first genuine problem, not whichever happened to be last in the array.
  const unresolved = [];

  const lines = items.map((line) => {
    const product = byId.get(String(line?.productId));
    const quantity = Math.max(1, Number.parseInt(line?.quantity, 10) || 1);

    // Price and stock come from the DATABASE, never from the line the client
    // sent - that is the whole reason a tampered cart cannot set its own total.
    // `resolveLineTarget` is the single implementation of that lookup for both
    // plain products and variants, so there is no second code path that could
    // come to disagree about what a line is worth.
    const target = resolveLineTarget(product, line?.variantId);

    if (!target.ok) {
      // Recorded rather than thrown so a single stale line reports its own
      // problem, rather than the shopper being told about a different product.
      unresolved.push({
        product,
        reason: target.reason,
        line,
      });
      return null;
    }

    return {
      product: product?._id ?? null,
      variant: target.variantId || null,
      variantTitle: target.title,
      compareAtPrice: target.variant?.compareAtPrice ?? null,
      sku: target.sku,
      name: product?.name || String(line?.name || 'Item').trim(),
      price: target.price,
      quantity,
      // Kept off the persisted line (the schema has no such field) but needed
      // for the stock check and the $inc below.
      _stock: target.stock,
    };
  });

  // A line that could not be resolved is a hard stop. The three reasons are
  // all things the shopper can act on - a deleted variant, one the merchant
  // switched off, or never having chosen - and each gets the wording the shared
  // resolver defines, so the cart, the shop and the checkout never describe the
  // same problem three different ways.
  const bad = unresolved[0];
  if (bad) {
    const name = bad.product?.name || String(bad.line?.name || 'this product').trim();
    throw new HttpError(400, resolveErrorMessage(bad.reason, name));
  }

  const priced = lines.filter(Boolean);

  // Does this line's product count stock at all? A made-to-order cake, a
  // download, a service slot: there is no number that goes down, so the line
  // is never short and is never decremented below. Read from the product
  // document we already loaded rather than trusted from the request.
  const countsStock = (line) => {
    if (!line.product) return false;
    return byId.get(String(line.product))?.trackInventory !== false;
  };

  // Refuse to sell what we don't have in stock. Checked per line against the
  // variant's own stock when the product has variants, so "the red is gone" no
  // longer blocks an order for a size that is in stock.
  const short = priced.find((line) => {
    if (!countsStock(line)) return false;
    return line._stock < line.quantity;
  });

  if (short) {
    const product = byId.get(String(short.product));
    const label = short.variantTitle
      ? `${product?.name} (${short.variantTitle})`
      : product?.name;
    throw new HttpError(
      400,
      `Only ${short._stock} left of “${label}”. Please update your cart.`,
    );
  }

  const guestName = String(guest?.name || '').trim();
  const guestEmail = String(guest?.email || '').trim().toLowerCase();
  let guestTokenForResponse = null;

  /*
   * A guest is identified by their EMAIL, not their name.
   *
   * This used to require a name and treat the email as optional, which was
   * backwards: the name is only ever read by a rider looking for somebody at
   * the door ("ask for Jane"), while the email is what the order actually needs
   * — it is the receipt, the future sign-in, and the handle the guest can turn
   * this order into an account with. Requiring the optional field and waving
   * through the essential one produced orders with no way to contact the buyer.
   *
   * Name is still accepted and still stored, just not demanded.
   */
  if (!signedIn && !guestEmail) {
    throw new HttpError(
      400,
      'Please enter an email address so we can send your receipt and let you track this order.',
    );
  }
  if (!signedIn && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestEmail)) {
    throw new HttpError(400, 'That email address does not look valid.');
  }

  // What to call this guest in the audit trail when they gave no name.
  const guestLabel = guestName || guestEmail;

  const order = await Order.create({
    customer: req.user?._id || null,
    ...(signedIn
      ? {}
      : (() => {
          const { raw, hash } = issueGuestToken();
          guestTokenForResponse = raw;
          return {
            guest: { name: guestName, email: guestEmail },
            guestTokenHash: hash,
          };
        })()),
    store: storeId,
    // `priced`, not `lines`: the unresolved ones are null placeholders that must
    // never reach the database or the money.
    items: priced,
    ...priceOrder(priced),
    address: cleanAddress,
    location: { lat, lng },
    paymentMethod: paymentMethod === 'card' ? 'card' : 'cod',
    status: ORDER_STATUS.PENDING,
    statusHistory: [
      {
        status: ORDER_STATUS.PENDING,
        note: signedIn ? 'Order placed' : `Guest order placed by ${guestLabel}`,
        by: req.user?._id || null,
      },
    ],
  });

  // Take the sold units out of stock.
  //
  // A variant line decrements THAT row's stock, not the product's, or a shop
  // selling three sizes would see its headline number fall by three per order
  // and hit zero while every size is still in stock. A product with no variants
  // takes the original top-level path, unchanged.
  //
  // Lines whose product does not track inventory are skipped entirely, so a
  // made-to-order product never drifts into a negative count it does not have.
  await Promise.all(
    priced
      .filter((line) => countsStock(line))
      .map((line) =>
        line.variant
          ? Product.updateOne(
              { _id: line.product, 'variants._id': line.variant },
              { $inc: { 'variants.$.stock': -line.quantity } },
            )
          : Product.updateOne(
              { _id: line.product },
              { $inc: { stock: -line.quantity } },
            ),
      ),
  );

  await order.populate(ORDER_POPULATE);

  // Guests have no account to link — only signed-in buyers become customers.
  if (signedIn) {
    // Ordering from a store also makes this account one of its customers. This is
    // what links shoppers who signed up elsewhere (or were already signed in) to
    // the store they actually buy from.
    await ensureStoreCustomer(storeId, req.user, STORE_CUSTOMER_SOURCE.ORDER);
  }

  // Live notification: every rider with an active binding to this store is
  // pinged immediately and can accept (claim) the delivery from their console.
  if (order.store) {
    notifyStoreMembers(order.store._id || order.store, {
      orderId: String(order._id),
      orderNumber: String(order._id).slice(-6).toUpperCase(),
      storeName: order.store?.name || 'A store',
      total: order.total,
      address: order.address?.line1 || '',
    });
  }

  res.status(201).json({
    order,
    // Returned ONCE — the client stores it in localStorage; it unlocks the
    // tracker (GET /orders/:id?guestToken=…) without an account.
    ...(guestTokenForResponse ? { guestToken: guestTokenForResponse } : {}),
  });
});

/** GET /api/orders/mine -> { orders } */
export const listMyOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({ customer: req.user._id })
    .sort({ createdAt: -1 })
    .populate(ORDER_POPULATE);

  res.json({ orders });
});

/** GET /api/orders/:id -> { order } (guests: ?guestToken=… from checkout) */
export const getOrder = asyncHandler(async (req, res) => {
  const guestToken =
    req.query.guestToken || req.headers['x-guest-token'] || null;
  const order = await loadOrderFor(req.params.id, req.user, guestToken);
  res.json({ order });
});

/** PATCH /api/orders/:id/cancel -> { order } (guests: body/query guestToken) */
export const cancelOrder = asyncHandler(async (req, res) => {
  const guestToken =
    req.body?.guestToken ||
    req.query.guestToken ||
    req.headers['x-guest-token'] ||
    null;
  const order = await loadOrderFor(req.params.id, req.user, guestToken);

  const isGuestOrder = !order.customer;
  const isGuestCaller = !req.user && isGuestOrder;

  // A rider may not cancel, and an admin cancels through the status endpoint.
  // Guests cancel their own order with the token; signed-in customers cancel
  // theirs; admins cancel anything.
  if (!isGuestCaller) {
    if (!req.user) throw new HttpError(401, 'You need to sign in to do that.');
    if (
      req.user.role !== ROLES.ADMIN &&
      String(order.customer?._id || order.customer) !== String(req.user._id)
    ) {
      throw new HttpError(403, 'Only the customer can cancel this order.');
    }
  }

  if (!CANCELLABLE_STATUSES.includes(order.status)) {
    throw new HttpError(
      400,
      'This order is already on its way and can no longer be cancelled.',
    );
  }

  order.cancelReason = String(req.body?.reason || '').trim();

  const updated = await applyStatus(order, ORDER_STATUS.CANCELLED, {
    note: order.cancelReason || 'Cancelled by the customer',
    by: req.user?._id || null,
  });

  res.json({ order: updated });
});

/**
 * PATCH /api/orders/:id/receive -> { order }
 * (guests: body/query guestToken, or the x-guest-token header)
 *
 * The customer closes the loop: the rider has dropped the parcel off
 * (`delivered`), and now the person it was for says it is in their hands
 * (`received`).
 *
 * A guest may do this, exactly as they may cancel. Someone who ordered without
 * an account still received the parcel, so they still get the last word on it -
 * they simply prove it with the `guestToken` handed out at checkout instead of
 * a session. Verified in `loadOrderFor`, which only lets a token through for an
 * order that has no customer of its own.
 *
 * What a guest still CANNOT do is review it (see reviewController): a rating has
 * to be attributable to an account, and there is no account behind a guest
 * order. The confirmation is about a parcel; the review is about a person.
 *
 * Only the customer who placed the order may do this, and only from a delivered
 * order. A rider cannot mark a parcel received on the recipient's behalf, and a
 * shopper cannot press the button while the order is still on the road - the
 * review that hangs off this status is meant to describe something that turned
 * up, not something that is expected to.
 */
export const confirmReceived = asyncHandler(async (req, res) => {
  const guestToken =
    req.body?.guestToken ||
    req.query.guestToken ||
    req.headers['x-guest-token'] ||
    null;

  const order = await loadOrderFor(req.params.id, req.user, guestToken);

  // loadOrderFor has already proved a guest token; this narrows it to "you are
  // the buyer", so a signed-in rider or admin viewing the order cannot close it
  // on the customer's behalf.
  assertOrderOwner(order, req.user);

  // Already confirmed - answering 200 makes a double tap, or a retry after the
  // response was lost on the tunnel, harmless.
  if (order.status === ORDER_STATUS.RECEIVED) {
    return res.json({ order });
  }

  if (!RECEIVABLE_STATUSES.includes(order.status)) {
    throw new HttpError(
      400,
      order.status === ORDER_STATUS.CANCELLED
        ? 'This order was cancelled, so there is nothing to receive.'
        : 'This order has not been delivered yet.',
    );
  }

  const updated = await applyStatus(order, ORDER_STATUS.RECEIVED, {
    note: 'Delivery received by the customer',
    // `req.user` is null for a guest caller, so this has to be optional - a bare
    // req.user._id throws a 500 for exactly the people this route was opened up
    // for. The history entry simply has no author id on a guest order, same as
    // cancelOrder does.
    by: req.user?._id || null,
  });

  // Same reason the rider's status change pings the store: the merchant's order
  // list is not in the per-order room, so without this a confirmed delivery
  // would sit stale on the dashboard until somebody hit Refresh.
  if (updated.store) {
    notifyStoreMembers(updated.store, {
      orderId: String(updated._id),
      kind: 'status',
      status: ORDER_STATUS.RECEIVED,
    }).catch(() => {});
  }

  res.json({ order: updated });
});

/** GET /api/orders/rider/assigned -> { orders } */
export const listRiderOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({ rider: req.user._id })
    .sort({ createdAt: -1 })
    .populate(ORDER_POPULATE);

  res.json({ orders });
});

/**
 * GET /api/orders/rider/analytics
 *
 * The rider's own delivery numbers: how long each stage took, how long they
 * personally took per order, and the averages across everything they have
 * delivered. Every duration is read back out of the order's own statusHistory,
 * so an old delivery reports the same figures it did on the day.
 *
 * Scoped to the signed-in rider - a rider only ever sees their own timings.
 */
export const getRiderAnalytics = asyncHandler(async (req, res) => {
  const orders = await Order.find({ rider: req.user._id })
    .sort({ createdAt: -1 })
    .limit(ANALYTICS_WINDOW)
    .populate(ORDER_POPULATE);

  res.json(summariseTimings(orders));
});

/**
 * PATCH /api/orders/:id/status
 * body: { status, note }
 *
 * A rider may only move an order along the happy path - or jump straight to
 * delivered, which is what the console's "Mark delivered" button does.
 * An admin may only drive the kitchen side: confirmed -> preparing, then
 * preparing -> ready for pickup (ADMIN_STATUS_STEPS). They can neither rewind
 * the kitchen nor mark a delivery finished - the rider owns the rest.
 */
export const updateOrderStatus = asyncHandler(async (req, res) => {
  const { status, note } = req.body || {};

  if (!ORDER_STATUS_VALUES.includes(status)) {
    throw new HttpError(400, `“${status}” is not a valid order status.`);
  }

  const order = await loadOrderFor(req.params.id, req.user);

  // Nothing to do - treat it as success so a retry is harmless.
  if (order.status === status) {
    return res.json({ order });
  }

  if (req.user.role === ROLES.RIDER) {
    if (String(order.rider?._id) !== String(req.user._id)) {
      throw new HttpError(403, 'This order is not assigned to you.');
    }

    const allowed = riderAllowedStatuses(order.status);
    if (!allowed.includes(status)) {
      throw new HttpError(
        400,
        `A rider cannot move this order from “${order.status}” to “${status}”.`,
      );
    }
  } else if (req.user.role === ROLES.ADMIN) {
    // The admin panel drives the kitchen only, and only one step at a time:
    // confirmed -> preparing -> ready for pickup. This used to let an admin set
    // ANY status, which meant the panel could skip the kitchen entirely, rewind
    // it, or hand an order to a rider as already delivered. The rider owns
    // everything from pickup onwards, and the customer may still cancel.
    const adminAllowed = adminNextStatus(order.status);
    if (adminAllowed !== status) {
      throw new HttpError(
        403,
        adminAllowed
          ? `An admin can only move a “${order.status}” order on to “${adminAllowed}”.`
          : `An admin cannot change an order that is “${order.status}”.`,
      );
    }
  } else {
    throw new HttpError(403, 'Only a rider or an admin can change the status.');
  }

  const updated = await applyStatus(order, status, {
    note: String(note || '').trim(),
    by: req.user._id,
  });

  // Same staleness trap as claimOrder: the merchant dashboard never joins
  // the per-order room, it only refreshes on `order:new`. Ping the store so
  // the merchant's Orders table + rider column update without Refresh.
  if (updated.store) {
    notifyStoreMembers(updated.store, {
      orderId: String(updated._id),
      kind: 'status',
      status,
    }).catch(() => {});
  }

  res.json({ order: updated });
});

/**
 * PATCH /api/orders/:id/location
 * REST fallback for the rider's GPS pings when the socket is unavailable.
 */
export const updateRiderLocation = asyncHandler(async (req, res) => {
  const lat = toFiniteNumber(req.body?.lat);
  const lng = toFiniteNumber(req.body?.lng);

  if (lat === null || lng === null) {
    throw new HttpError(400, 'Both lat and lng are required.');
  }

  const order = await loadOrderFor(req.params.id, req.user);

  if (
    req.user.role === ROLES.RIDER &&
    String(order.rider?._id) !== String(req.user._id)
  ) {
    throw new HttpError(403, 'This order is not assigned to you.');
  }

  order.riderLocation = { lat, lng };
  await order.save();

  res.json({ orderId: String(order._id), lat, lng, at: Date.now() });
});

// ---------------------------------------------------------------------------
// Rider pool - orders nobody has taken yet
// ---------------------------------------------------------------------------

/**
 * GET /api/orders/pool (rider)
 *
 * The "available deliveries" list: unclaimed orders belonging to the stores
 * this rider has accepted an invitation for. Orders with no store at all (the
 * general catalogue) are open to every rider so nothing is ever orphaned.
 */
export const listOrderPool = asyncHandler(async (req, res) => {
  const storeIds = await activeStoreIds(req.user._id);

  const orders = await Order.find({
    rider: null,
    // Nothing finished may be re-claimed, and "finished" includes an order the
    // customer has already confirmed receiving.
    status: { $nin: CLOSED_STATUSES },
    $or: [{ store: { $in: storeIds } }, { store: null }],
  })
    // Oldest first: the order that has waited longest gets picked up first.
    .sort({ createdAt: 1 })
    .limit(50)
    .populate(ORDER_POPULATE);

  res.json({ orders });
});

/**
 * POST /api/orders/:id/claim (rider)
 *
 * "Take" a delivery from the pool. The update is a single atomic operation, so
 * if two riders tap at the same instant exactly one wins and the other gets a
 * clear message instead of a silent overwrite.
 */
export const claimOrder = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    throw new HttpError(400, 'That order id is not valid.');
  }

  // `status` is part of the select because it is copied into the history
  // entry below - forgetting it pushed `status: undefined` into the document
  // (updates skip schema validation), which then made every later save() of
  // the order fail validation and bricked the rider's delivery.
  const existing = await Order.findById(req.params.id).select('store rider status');
  if (!existing) throw new HttpError(404, 'That order does not exist.');

  if (existing.rider) {
    throw new HttpError(
      409,
      String(existing.rider) === String(req.user._id)
        ? 'You already have this delivery.'
        : 'Another rider already took this order.',
    );
  }

  // Only riders bound to the owning store may take it.
  if (existing.store) {
    const bound = await isBoundToStore(req.user._id, existing.store);
    if (!bound) {
      throw new HttpError(403, 'You are not a rider for that store.');
    }
  }

  const claimed = await Order.findOneAndUpdate(
    {
      _id: existing._id,
      rider: null,
      status: { $nin: CLOSED_STATUSES },
    },
    {
      // Claiming IS accepting the delivery, so the order must move forward
      // too. Previously only `rider` was set and `status` stayed `pending`,
      // which is why the merchant dashboard kept showing the old status
      // after a rider accepted. A `pending` order becomes `confirmed`;
      // anything further along keeps its status.
      $set: {
        rider: req.user._id,
        status:
          existing.status === ORDER_STATUS.PENDING
            ? ORDER_STATUS.CONFIRMED
            : existing.status,
      },
      $push: {
        statusHistory: {
          status:
            existing.status === ORDER_STATUS.PENDING
              ? ORDER_STATUS.CONFIRMED
              : existing.status || ORDER_STATUS.PENDING,
          note: `${req.user.name || 'A rider'} took this delivery`,
          by: req.user._id,
          at: new Date(),
        },
      },
    },
    { new: true },
  ).populate(ORDER_POPULATE);

  if (!claimed) {
    throw new HttpError(409, 'Sorry, another rider just took that order.');
  }

  // Anyone watching the tracker sees that a rider is now attached.
  emitOrderStatusUpdated(claimed._id, claimed.status, 'Rider assigned');

  // The merchant dashboard listens for `order:new` to refresh its lists.
  // Claim + status updates only emitted `order:status:updated` to the order
  // room, which the merchant never joins - so the merchant view stayed stale
  // ("undefined" / old status) until a manual Refresh. Ping the store's
  // members AND the owner so the dashboard live-refreshes.
  if (claimed.store) {
    notifyStoreMembers(claimed.store, {
      orderId: String(claimed._id),
      kind: 'claimed',
    }).catch(() => {});
  }

  res.json({ order: claimed });
});

/**
 * GET /api/orders/store/mine?storeId= (store owner or store admin)
 *
 * Every order placed with a store this account runs, newest first. This is
 * what a store owner - and every admin they appointed - watches to see orders
 * come in and whether a rider has taken them.
 *
 * `?storeId=` picks one of several stores; without it the primary store (the
 * one owned, otherwise the first one administered) is used.
 */
export const listStoreOrders = asyncHandler(async (req, res) => {
  const requested = req.query.storeId || req.body?.storeId || null;

  const entry = requested
    ? await loadManageableStore(requested, req.user)
    : await primaryStoreFor(req.user);

  if (!entry) throw new HttpError(404, 'You do not have a store yet.');

  // The list projects ONLY what the orders table renders: the id, when it
  // arrived, who it is for, what it came to, how it is paid, and how many items.
  //
  // It used to return whole order documents. Each one carries a guest block, a
  // full address, a geo point, the payment record, the entire status history,
  // and every line - which the table never reads and the DETAIL page fetches
  // on its own anyway. On a store with a few hundred orders that is several
  // hundred KB of JSON per page load, all of it parsed by the browser and then
  // discarded. Selecting the ten fields that are actually rendered is the
  // difference between a board that opens instantly and one that does not.
  //
  // The projection keeps the document shape the client already expects, so no
  // page had to change.
  const orders = await Order.find({ store: entry.store._id })
    .select(ORDER_LIST_FIELDS)
    .sort({ createdAt: -1 })
    .limit(200)
    .populate(ORDER_LIST_POPULATE)
    .lean();

  // `isOpen` is a virtual, so `.lean()` drops it - and the table's
  // fulfillmentOf() reads `order.isOpen === false` to mean "closed". Recomputing
  // it here is exactly the virtual's own rule, so the projected rows behave
  // identically to the full documents and no page had to change.
  const rows = orders.map((order) => ({
    ...order,
    isOpen: !CLOSED_STATUSES.includes(order.status),
  }));

  res.json({
    orders: rows,
    store: entry.store,
    role: entry.role,
    isOwner: entry.role === STORE_ROLES.OWNER,
  });
});

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

/** GET /api/orders?status=&page=&limit= -> { orders }
 *
 * The admin board only ever shows orders of stores this account runs (owned,
 * or an accepted store-admin invitation) - the same scoping as everything
 * else in the panel. An admin who runs no store simply sees an empty board.
 */
export const listAllOrders = asyncHandler(async (req, res) => {
  const { status } = req.query;
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(
    200,
    Math.max(1, Number.parseInt(req.query.limit, 10) || 100),
  );

  const storeIds = await managedStoreIds(req.user);
  const filter = { store: { $in: storeIds } };
  if (status && status !== 'all' && ORDER_STATUS_VALUES.includes(status)) {
    filter.status = status;
  }

  const [orders, total] = await Promise.all([
    // Same projection as the store board: an admin list is still a list, and
    // its table renders the same columns. The detail page fetches its own order.
    Order.find(filter)
      .select(ORDER_LIST_FIELDS)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate(ORDER_LIST_POPULATE)
      .lean(),
    Order.countDocuments(filter),
  ]);

  // See listStoreOrders: `isOpen` is a virtual that .lean() drops.
  const rows = orders.map((order) => ({
    ...order,
    isOpen: !CLOSED_STATUSES.includes(order.status),
  }));

  res.json({
    orders: rows,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
    total,
  });
});

/**
 * GET /api/orders/store/analytics?storeId=
 *
 * How long deliveries at this store take, and which rider is responsible.
 *
 * The store owner's (or an appointed store admin's) view of the same numbers
 * the rider sees about themselves: every figure is derived from the orders' own
 * statusHistory, so it is a record of what happened rather than a counter that
 * has to be maintained. `riders` is the per-rider rollup of the very same
 * orders, which is what the store dashboard's analytics tab renders.
 *
 * `?storeId=` picks one of several stores; without it the primary store (the
 * one owned, otherwise the first one administered) is used - identical to
 * /orders/store/mine.
 */
export const getStoreAnalytics = asyncHandler(async (req, res) => {
  const requested = req.query.storeId || null;

  const entry = requested
    ? await loadManageableStore(requested, req.user)
    : await primaryStoreFor(req.user);

  if (!entry) throw new HttpError(404, 'You do not have a store yet.');

  const orders = await Order.find({ store: entry.store._id })
    .sort({ createdAt: -1 })
    .limit(STORE_ANALYTICS_WINDOW)
    .populate(ORDER_POPULATE);

  res.json({
    ...summariseTimings(orders),
    riders: summariseByRider(orders),
    store: entry.store,
    role: entry.role,
    isOwner: entry.role === STORE_ROLES.OWNER,
    window: STORE_ANALYTICS_WINDOW,
  });
});

/**
 * (removed) PATCH /api/orders/:id/assign
 *
 * Manual rider assignment is gone on purpose: riders are bound to a store by the
 * admin/merchant, get pinged in real time when an order arrives, and claim
 * it themselves (POST /:id/claim). There is no admin "choose a rider" step.
 */

export default {
  createOrder,
  listMyOrders,
  getOrder,
  cancelOrder,
  listRiderOrders,
  getRiderAnalytics,
  updateOrderStatus,
  updateRiderLocation,
  listOrderPool,
  claimOrder,
  listStoreOrders,
  listAllOrders,
};