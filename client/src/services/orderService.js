import api from './api';
import { getGuestToken } from '../utils/constants';
// The rider's delivery pool + claim live in storeService (they are bound to
// store membership). Re-exported here so `orderService.claimOrder(...)` works
// for callers that only import this service.
import { getOrderPool, claimOrder } from './storeService';

export { getOrderPool, claimOrder };

// ---------------------------------------------------------------------------
// Customer endpoints
// ---------------------------------------------------------------------------

/**
 * POST /orders — works with AND without an account.
 * payload = {
 *   items: [{ productId, quantity }],
 *   address: { label, line1, city, phone, notes },
 *   location: { lat, lng },
 *   paymentMethod: 'cod',
 *   guest: { name, email }            <- only for guests (no token stored)
 * }
 * Resolves to { order, guestToken? } — guests get a secret token that unlocks
 * their tracker; callers should persist it via saveGuestToken().
 */
export const createOrder = (payload) =>
  api.post('/orders', payload).then((res) => ({
    order: res.data.order || res.data,
    guestToken: res.data.guestToken || null,
  }));

/** GET /orders/mine - the logged-in customer's order history. */
export const getMyOrders = () =>
  api.get('/orders/mine').then((res) => res.data.orders || res.data || []);

/**
 * GET /orders/:id - used by the tracker (customer) and the rider console.
 * Guests pass no JWT; the stored guestToken is attached as ?guestToken=.
 */
export const getOrderById = (orderId, { guestToken } = {}) => {
  const token = guestToken || getGuestToken(orderId) || null;
  return api
    .get(`/orders/${orderId}`, { params: token ? { guestToken: token } : {} })
    .then((res) => res.data.order || res.data);
};

/** PATCH /orders/:id/cancel - customer (or guest with token) cancels before pickup. */
export const cancelOrder = (orderId, reason = '', { guestToken } = {}) => {
  const token = guestToken || getGuestToken(orderId) || null;
  return api
    .patch(`/orders/${orderId}/cancel`, {
      reason,
      ...(token ? { guestToken: token } : {}),
    })
    .then((res) => res.data.order || res.data);
};

/**
 * PATCH /orders/:id/receive - "Confirm delivery received".
 *
 * The buyer's half of the handoff: the rider has dropped the parcel off, and
 * this is the shopper saying it is in their hands. Deliberately its own endpoint
 * rather than updateOrderStatus(), which the server restricts to riders and
 * admins - a rider must not be able to mark somebody else's parcel received.
 *
 * Works for a guest exactly as cancelOrder() does: the guestToken stored at
 * checkout is attached automatically, so somebody who ordered without an account
 * still gets the button and the same right to press it. They just cannot leave a
 * review afterwards (the server needs an identity to attribute a rating to).
 *
 * This is what unlocks the review below, so it is the only status in which one
 * can be written. Safe to call twice: the server answers 200 if already
 * confirmed.
 */
export const confirmOrderReceived = (orderId) => {
  const token = getGuestToken(orderId) || null;
  return api
    .patch(`/orders/${orderId}/receive`, token ? { guestToken: token } : {})
    .then((res) => res.data.order || res.data);
};

// ---------------------------------------------------------------------------
// Reviews
//
// One review per order, and only after the customer has confirmed receipt. The
// form (components/store/OrderReview.jsx) is both "write a review" and "edit my
// review" - re-submitting overwrites rather than stacking a second opinion.
// ---------------------------------------------------------------------------

/** GET /orders/:id/review - the review on this order, or null when there is none. */
export const getOrderReview = (orderId) =>
  api.get(`/orders/${orderId}/review`).then((res) => res.data.review || null);

/** POST /orders/:id/review { rating, comment } - write or update the review. */
export const submitOrderReview = (orderId, { rating, comment = '' }) =>
  api
    .post(`/orders/${orderId}/review`, { rating, comment })
    .then((res) => res.data.review || res.data);

/** DELETE /orders/:id/review - withdraw your own review. */
export const deleteOrderReview = (orderId) =>
  api.delete(`/orders/${orderId}/review`).then((res) => res.data);

// ---------------------------------------------------------------------------
// Rider endpoints
// ---------------------------------------------------------------------------

/** GET /orders/rider/assigned - orders assigned to the logged-in rider. */
export const getRiderOrders = () =>
  api
    .get('/orders/rider/assigned')
    .then((res) => res.data.orders || res.data || []);

/** PATCH /orders/:id/status - advance the delivery status. */
export const updateOrderStatus = (orderId, status, note = '') =>
  api
    .patch(`/orders/${orderId}/status`, { status, note })
    .then((res) => res.data.order || res.data);

/**
 * GET /orders/rider/analytics - how long the rider's deliveries took.
 * Resolves to { summary, orders, delivered, open, cancelled }.
 */
export const getRiderAnalytics = () =>
  api.get('/orders/rider/analytics').then((res) => res.data || {});

/**
 * PATCH /orders/:id/location
 * REST fallback for pushing the rider GPS position when the socket is down.
 */
export const pushRiderLocation = (orderId, { lat, lng }) =>
  api.patch(`/orders/${orderId}/location`, { lat, lng }).then((res) => res.data);

// ---------------------------------------------------------------------------
// Admin endpoints
// ---------------------------------------------------------------------------

/** GET /orders?status=&page= - the admin overview board (read-only). */
export const getAllOrders = (params = {}) =>
  api
    .get('/orders', { params })
    .then((res) => res.data.orders || res.data || []);

/**
 * GET /orders/store/analytics?storeId= - how long this store's deliveries take,
 * rolled up overall AND per rider. Store owner or an appointed store admin.
 * Resolves to { summary, orders, delivered, open, cancelled, riders, store }.
 */
export const getStoreAnalytics = (storeId) =>
  api
    .get('/orders/store/analytics', { params: storeId ? { storeId } : {} })
    .then((res) => res.data || {});

// Note: there is no assignRider() anymore. Riders claim deliveries
// themselves from their pool (see claimOrder below).

export default {
  createOrder,
  getMyOrders,
  getOrderById,
  cancelOrder,
  confirmOrderReceived,
  getOrderReview,
  submitOrderReview,
  deleteOrderReview,
  getRiderOrders,
  getRiderAnalytics,
  updateOrderStatus,
  pushRiderLocation,
  getAllOrders,
  getStoreAnalytics,
  getOrderPool,
  claimOrder,
};
