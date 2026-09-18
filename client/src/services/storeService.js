import api from './api';

// ---------------------------------------------------------------------------
// Public storefront
// ---------------------------------------------------------------------------

/** GET /stores/:slug - what the public /s/<slug> page loads. { store, products } */
export const getPublicStore = (slug) =>
  api.get(`/stores/${slug}`).then((res) => res.data);

// ---------------------------------------------------------------------------
// Merchant (store owner)
// ---------------------------------------------------------------------------

/** GET /stores/mine -> { store, riders } */
export const getMyStore = () => api.get('/stores/mine').then((res) => res.data);

/** PATCH /stores/mine */
export const updateMyStore = (payload) =>
  api.patch('/stores/mine', payload).then((res) => res.data.store);

// ---------------------------------------------------------------------------
// Rider roster
// ---------------------------------------------------------------------------

/** GET /riders/lookup?username= - the admin/store rider search by username. */
export const searchRiders = (username) =>
  api
    .get('/riders/lookup', { params: { username } })
    .then((res) => res.data.riders || []);

/** GET /stores/:id/riders -> links with { status, rider } */
export const listStoreRiders = (storeId) =>
  api.get(`/stores/${storeId}/riders`).then((res) => res.data.riders || []);

/** POST /stores/:id/riders { username } - invites a rider by username. */
export const inviteRider = (storeId, username) =>
  api
    .post(`/stores/${storeId}/riders`, { username })
    .then((res) => res.data.invitation);

/** DELETE /stores/:id/riders/:riderId - revokes a binding. */
export const removeStoreRider = (storeId, riderId) =>
  api.delete(`/stores/${storeId}/riders/${riderId}`).then((res) => res.data);

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

/** GET /stores (admin) - every merchant on the platform. */
export const listStores = () =>
  api.get('/stores').then((res) => res.data.stores || []);

// ---------------------------------------------------------------------------
// Rider side
// ---------------------------------------------------------------------------

/** GET /riders/requests - invitations waiting for this rider's answer. */
export const listMyRequests = () =>
  api.get('/riders/requests').then((res) => res.data.requests || []);

/** PATCH /riders/requests/:id { action: 'accept' | 'decline' } */
export const respondToRequest = (requestId, action) =>
  api
    .patch(`/riders/requests/${requestId}`, { action })
    .then((res) => res.data.invitation);

/** GET /riders/stores - the stores this rider delivers for. */
export const listMyStores = () =>
  api.get('/riders/stores').then((res) => res.data.stores || []);

/** GET /orders/pool - unclaimed deliveries from this rider's stores. */
export const getOrderPool = () =>
  api.get('/orders/pool').then((res) => res.data.orders || []);

/** POST /orders/:id/claim - "take" a delivery from the pool. */
export const claimOrder = (orderId) =>
  api.post(`/orders/${orderId}/claim`).then((res) => res.data.order);

/** GET /orders/store/mine - orders placed with this merchant's store. */
export const listStoreOrders = () =>
  api.get('/orders/store/mine').then((res) => res.data.orders || []);

export default {
  getPublicStore,
  getMyStore,
  updateMyStore,
  listStoreOrders,
  searchRiders,
  listStoreRiders,
  inviteRider,
  removeStoreRider,
  listStores,
  listMyRequests,
  respondToRequest,
  listMyStores,
  getOrderPool,
  claimOrder,
};
