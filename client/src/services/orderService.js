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

// Note: there is no assignRider() anymore. Riders claim deliveries
// themselves from their pool (see claimOrder below).

export default {
  createOrder,
  getMyOrders,
  getOrderById,
  cancelOrder,
  getRiderOrders,
  updateOrderStatus,
  pushRiderLocation,
  getAllOrders,
  getOrderPool,
  claimOrder,
};
