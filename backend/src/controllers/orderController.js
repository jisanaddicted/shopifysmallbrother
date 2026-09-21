import mongoose from 'mongoose';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import Store from '../models/Store.js';
import User from '../models/User.js';
import { HttpError } from '../middleware/errorHandler.js';
import {
  CANCELLABLE_STATUSES,
  ORDER_STATUS,
  ORDER_STATUS_VALUES,
  ROLES,
} from '../utils/constants.js';
import { priceOrder, riderAllowedStatuses } from '../utils/pricing.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { canAccessOrder } from '../utils/orderAccess.js';
import { activeStoreIds, isBoundToStore } from '../utils/storeRider.js';
import {
  loadManageableStore,
  managedStoreIds,
  primaryStoreFor,
  STORE_ROLES,
} from '../utils/storeAccess.js';
import { emitOrderStatusUpdated, notifyStoreMembers } from '../sockets/index.js';

// The tracker needs the rider's name/phone and the customer's details, and
// the store so the page can show which merchant the order is from.
const ORDER_POPULATE = [
  { path: 'rider', select: 'name phone email location' },
  { path: 'customer', select: 'name email phone' },
  { path: 'store', select: 'name slug image' },
];

const toFiniteNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Loads an order by id, or throws the right 400/404/403. */
async function loadOrderFor(orderId, user) {
  if (!mongoose.isValidObjectId(orderId)) {
    throw new HttpError(400, 'That order id is not valid.');
  }

  const order = await Order.findById(orderId).populate(ORDER_POPULATE);
  if (!order) throw new HttpError(404, 'That order does not exist.');

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

/** Appends to the audit trail, saves, and tells the tracker over the socket. */
async function applyStatus(order, status, { note = '', by = null } = {}) {
  order.status = status;
  order.statusHistory.push({ status, note, by, at: new Date() });
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
 *   paymentMethod: 'cod'
 * }
 *
 * Prices are recalculated from the catalogue so a tampered cart can't set its
 * own total. The numbers sent by the client are only a fallback for products
 * that were deleted after the basket was filled.
 */
export const createOrder = asyncHandler(async (req, res) => {
  const { items, address, location, paymentMethod } = req.body || {};

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

  const lines = items.map((line) => {
    const product = byId.get(String(line?.productId));
    const quantity = Math.max(1, Number.parseInt(line?.quantity, 10) || 1);

    return {
      product: product?._id ?? null,
      name: product?.name || String(line?.name || 'Item').trim(),
      price: product ? product.price : Number(line?.price) || 0,
      quantity,
    };
  });

  // Refuse to sell what we don't have in stock.
  const short = lines.find((line) => {
    if (!line.product) return false;
    const product = byId.get(String(line.product));
    return product && product.stock < line.quantity;
  });

  if (short) {
    const product = byId.get(String(short.product));
    throw new HttpError(
      400,
      `Only ${product.stock} left of “${product.name}”. Please update your cart.`,
    );
  }

  const order = await Order.create({
    customer: req.user._id,
    store: storeId,
    items: lines,
    ...priceOrder(lines),
    address: cleanAddress,
    location: { lat, lng },
    paymentMethod: paymentMethod === 'card' ? 'card' : 'cod',
    status: ORDER_STATUS.PENDING,
    statusHistory: [
      { status: ORDER_STATUS.PENDING, note: 'Order placed', by: req.user._id },
    ],
  });

  // Take the sold units out of stock.
  await Promise.all(
    lines
      .filter((line) => line.product)
      .map((line) =>
        Product.updateOne(
          { _id: line.product },
          { $inc: { stock: -line.quantity } },
        ),
      ),
  );

  await order.populate(ORDER_POPULATE);

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

  res.status(201).json({ order });
});

/** GET /api/orders/mine -> { orders } */
export const listMyOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({ customer: req.user._id })
    .sort({ createdAt: -1 })
    .populate(ORDER_POPULATE);

  res.json({ orders });
});

/** GET /api/orders/:id -> { order } */
export const getOrder = asyncHandler(async (req, res) => {
  const order = await loadOrderFor(req.params.id, req.user);
  res.json({ order });
});

/** PATCH /api/orders/:id/cancel -> { order } */
export const cancelOrder = asyncHandler(async (req, res) => {
  const order = await loadOrderFor(req.params.id, req.user);

  // A rider may not cancel, and an admin cancels through the status endpoint.
  if (
    req.user.role !== ROLES.ADMIN &&
    String(order.customer?._id) !== String(req.user._id)
  ) {
    throw new HttpError(403, 'Only the customer can cancel this order.');
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
    by: req.user._id,
  });

  res.json({ order: updated });
});

// ---------------------------------------------------------------------------
// Rider
// ---------------------------------------------------------------------------

/** GET /api/orders/rider/assigned -> { orders } */
export const listRiderOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({ rider: req.user._id })
    .sort({ createdAt: -1 })
    .populate(ORDER_POPULATE);

  res.json({ orders });
});

/**
 * PATCH /api/orders/:id/status
 * body: { status, note }
 *
 * A rider may only move an order along the happy path - or jump straight to
 * delivered, which is what the console's "Mark delivered" button does.
 * Admins may set any status.
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
  } else if (req.user.role !== ROLES.ADMIN) {
    throw new HttpError(403, 'Only a rider or an admin can change the status.');
  }

  const updated = await applyStatus(order, status, {
    note: String(note || '').trim(),
    by: req.user._id,
  });

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
    status: { $nin: [ORDER_STATUS.DELIVERED, ORDER_STATUS.CANCELLED] },
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
      status: { $nin: [ORDER_STATUS.DELIVERED, ORDER_STATUS.CANCELLED] },
    },
    {
      $set: { rider: req.user._id },
      $push: {
        statusHistory: {
          status: existing.status || ORDER_STATUS.PENDING,
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

  const orders = await Order.find({ store: entry.store._id })
    .sort({ createdAt: -1 })
    .limit(200)
    .populate(ORDER_POPULATE);

  res.json({
    orders,
    store: entry.store,
    role: entry.role,
    isOwner: entry.role === STORE_ROLES.OWNER,
  });
});

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

/** GET /api/orders?status=&page=&limit= -> { orders } */
export const listAllOrders = asyncHandler(async (req, res) => {
  const { status } = req.query;
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(
    200,
    Math.max(1, Number.parseInt(req.query.limit, 10) || 100),
  );

  const filter = {};
  if (status && status !== 'all' && ORDER_STATUS_VALUES.includes(status)) {
    filter.status = status;
  }

  const [orders, total] = await Promise.all([
    Order.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate(ORDER_POPULATE),
    Order.countDocuments(filter),
  ]);

  res.json({
    orders,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
    total,
  });
});

/**
 * (removed) PATCH /api/orders/:id/assign
 *
 * Manual dispatch is gone on purpose: riders are bound to a store by the
 * admin/merchant, get pinged in real time when an order arrives, and claim
 * it themselves (POST /:id/claim). There is no admin "choose a rider" step.
 */

export default {
  createOrder,
  listMyOrders,
  getOrder,
  cancelOrder,
  listRiderOrders,
  updateOrderStatus,
  updateRiderLocation,
  listOrderPool,
  claimOrder,
  listStoreOrders,
  listAllOrders,
};