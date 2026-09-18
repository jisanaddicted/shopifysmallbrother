import api from './api';

// ---------------------------------------------------------------------------
// Customer endpoints
// ---------------------------------------------------------------------------

/**
 * POST /orders
 * payload = {
 *   items: [{ productId, quantity }],
 *   address: { label, line1, city, phone, notes },
 *   location: { lat, lng },
 *   paymentMethod: 'cod'
 * }
 */
export const createOrder = (payload) =>
  api.post('/orders', payload).then((res) => res.data.order || res.data);

/** GET /orders/mine - the logged-in customer's order history. */
export const getMyOrders = () =>
  api.get('/orders/mine').then((res) => res.data.orders || res.data || []);

/** GET /orders/:id - used by the tracker (customer) and the rider console. */
export const getOrderById = (orderId) =>
  api.get(`/orders/${orderId}`).then((res) => res.data.order || res.data);

/** PATCH /orders/:id/cancel - customer cancels before pickup. */
export const cancelOrder = (orderId, reason = '') =>
  api
    .patch(`/orders/${orderId}/cancel`, { reason })
    .then((res) => res.data.order || res.data);

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

/** GET /orders?status=&page= - the dispatch board. */
export const getAllOrders = (params = {}) =>
  api
    .get('/orders', { params })
    .then((res) => res.data.orders || res.data || []);

/** PATCH /orders/:id/assign - give an order to a rider. */
export const assignRider = (orderId, riderId) =>
  api
    .patch(`/orders/${orderId}/assign`, { riderId })
    .then((res) => res.data.order || res.data);

/** GET /admin/riders - riders available for dispatch. */
export const getAvailableRiders = () =>
  api.get('/admin/riders').then((res) => res.data.riders || res.data || []);

export default {
  createOrder,
  getMyOrders,
  getOrderById,
  cancelOrder,
  getRiderOrders,
  updateOrderStatus,
  pushRiderLocation,
  getAllOrders,
  assignRider,
  getAvailableRiders,
};
