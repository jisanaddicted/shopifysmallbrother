import mongoose from 'mongoose';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
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
import { emitOrderStatusUpdated } from '../sockets/index.js';

// The tracker needs the rider's name/phone and the customer's details.
const ORDER_POPULATE = [
  { path: 'rider', select: 'name phone email location' },
  { path: 'customer', select: 'name email phone' },
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

  if (!canAccessOrder(order, user)) {
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
 * PATCH /api/orders/:id/assign
 * body: { riderId } - an empty riderId unassigns the order.
 */
export const assignRider = asyncHandler(async (req, res) => {
  const { riderId } = req.body || {};

  const order = await loadOrderFor(req.params.id, req.user);

  if (!riderId) {
    order.rider = null;
    await order.save();
    await order.populate(ORDER_POPULATE);
    return res.json({ order });
  }

  if (!mongoose.isValidObjectId(riderId)) {
    throw new HttpError(400, 'That rider id is not valid.');
  }

  const rider = await User.findById(riderId);
  if (!rider || rider.role !== ROLES.RIDER) {
    throw new HttpError(400, 'That account is not a rider.');
  }

  order.rider = rider._id;
  await order.save();
  await order.populate(ORDER_POPULATE);

  // Let anyone watching the tracker know a rider is now attached.
  emitOrderStatusUpdated(order._id, order.status, 'Rider assigned');

  res.json({ order });
});

export default {
  createOrder,
  listMyOrders,
  getOrder,
  cancelOrder,
  listRiderOrders,
  updateOrderStatus,
  updateRiderLocation,
  listAllOrders,
  assignRider,
};