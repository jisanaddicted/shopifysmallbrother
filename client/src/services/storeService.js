import api from './api';

// ---------------------------------------------------------------------------
// Public storefront
// ---------------------------------------------------------------------------

/** GET /stores/:slug - what the public /s/<slug> page loads. { store, products } */
export const getPublicStore = (slug) =>
  api.get(`/stores/${slug}`).then((res) => res.data);

/** GET /menu/:slug - the storefront navigation tree (public). */
export const getPublicStoreMenu = (slug) =>
  api.get(`/menu/${slug}`).then((res) => res.data.menu || []);

// ---------------------------------------------------------------------------
// Merchant (store owner)
// ---------------------------------------------------------------------------

/** GET /stores/mine -> { store, riders } (primary store only). */
export const getMyStore = () => api.get('/stores/mine').then((res) => res.data);

/**
 * GET /stores/mine/all -> { stores: [{ store, role, isOwner }] }
 * Every store this account runs (owner + appointed admin). Powers the
 * merchant dashboard "My storefronts" card with each landing-page link.
 */
export const listMyMerchantStores = () =>
  api.get('/stores/mine/all').then((res) => res.data.stores || []);

/** PATCH /stores/mine (?storeId= to target one of several stores) */
export const updateMyStore = (payload, storeId) =>
  api
    .patch('/stores/mine', payload, {
      params: storeId ? { storeId } : {},
    })
    .then((res) => res.data.store);

// ---------------------------------------------------------------------------
// Rider roster
// ---------------------------------------------------------------------------

/** GET /riders/lookup?username= - the admin/store rider search by username. */
export const searchRiders = (username) =>
  api
    .get('/riders/lookup', { params: { username } })
    .then((res) => res.data.riders || []);

/**
 * GET /users/lookup?username= - the global people search behind both
 * invitation types. Returns profile cards: name, @username, platform role
 * and "quality" stats (deliveries completed/active for riders, stores
 * managed for store admins).
 */
export const lookupUser = (username) =>
  api
    .get('/users/lookup', { params: { username } })
    .then((res) => res.data.user || null);

/** GET /stores/:id/riders -> links with { status, rider } */
export const listStoreRiders = (storeId) =>
  api.get(`/stores/${storeId}/riders`).then((res) => res.data.riders || []);

/** POST /stores/:id/riders { username, role } - invites a rider or store admin. */
export const inviteRider = (storeId, username, role = 'rider') =>
  api
    .post(`/stores/${storeId}/riders`, { username, role })
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

/** GET /orders/store/mine - orders placed with this merchant's store.
 * Pass ?storeId= to pick one of several stores; without it the primary
 * store is used. */
export const listStoreOrders = (storeId) =>
  api
    .get('/orders/store/mine', { params: storeId ? { storeId } : {} })
    .then((res) => res.data.orders || []);

export default {
  getPublicStore,
  getMyStore,
  listMyMerchantStores,
  updateMyStore,
  listStoreOrders,
  searchRiders,
  lookupUser,
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
