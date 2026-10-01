import api from './api';
import { imageToDataUrl } from '../utils/imageFile';

/**
 * In-flight request sharing for the PUBLIC storefront reads.
 *
 * Why: `GET /stores/:slug` is ~942KB on this project's data (measured), and
 * several components ask for it - on a storefront visit the ShopPage wants it,
 * the Navbar wants the store's logo, the product and category pages want it too,
 * and a customer's sign-in page wants the store's branding. They do not all fire
 * in the same tick, so this cannot help every case, but the ones that DO overlap
 * (ShopPage + Navbar on mount; a page and its neighbour while navigating) were
 * downloading the whole catalogue twice and parsing it twice, for one screen.
 *
 * Dedupe ONLY - no cached copy, no TTL. The server already caches these payloads
 * and invalidates them the moment a merchant edits something, and a client-side
 * copy with a lifetime of its own is exactly how a merchant who saves a product
 * and refreshes their own shop gets told the product is not there. Sharing the
 * request that is ALREADY in flight has no such window: everyone waiting on it
 * gets the answer the server gave, once.
 *
 * Failures are not remembered either - the entry is cleared in `finally`, so a
 * retry after an error starts a fresh request rather than awaiting a rejection
 * that has already passed.
 */
const inFlight = new Map();

function share(key, request) {
  const running = inFlight.get(key);
  if (running) return running;

  const task = request().finally(() => {
    inFlight.delete(key);
  });

  inFlight.set(key, task);
  return task;
}

// ---------------------------------------------------------------------------
// Public storefront
// ---------------------------------------------------------------------------

/** GET /stores/:slug - what the public /s/<slug> page loads. { store, products } */
export const getPublicStore = (slug) =>
  share(`store:${slug}`, () => api.get(`/stores/${slug}`).then((res) => res.data));

/** GET /menu/:slug - the storefront navigation tree (public). */
export const getPublicStoreMenu = (slug) =>
  share(`menu:${slug}`, () =>
    api.get(`/menu/${slug}`).then((res) => res.data.menu || []),
  );

// ---------------------------------------------------------------------------
// Merchant (store owner)
// ---------------------------------------------------------------------------

/** GET /stores/mine -> { store, riders } (primary store only). */
/**
 * GET /stores/mine[?storeId=] - the store this account runs, plus its team.
 * Pass `storeId` to pick one of several stores (the admin panel's rider tracker
 * does); without it the primary store is used.
 */
export const getMyStore = (storeId) =>
  api
    .get('/stores/mine', { params: storeId ? { storeId } : {} })
    .then((res) => res.data);

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

/**
 * PATCH /stores/mine/logo (?storeId=) — upload a store logo file.
 * Sends multipart/form-data { logo } and resolves to the updated store.
 * Falls back to resizing client-side and sending a data URL when the backend
 * has no file-upload endpoint (keeps old backends working). Either way the
 * SERVER decides where the picture lives: it forwards the image to Cloudinary
 * and stores the URL it gets back (backend/src/services/cloudinary.js), so a
 * ~90KB base64 logo never reaches MongoDB.
 */
export const uploadStoreLogo = async (file, storeId) => {
  const form = new FormData();
  form.append('logo', file);
  try {
    const res = await api.post('/stores/mine/logo', form, {
      params: storeId ? { storeId } : {},
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    if (res.data?.store) return res.data.store;
  } catch (err) {
    if (err?.status !== 404) throw err;
  }
  /* The SHARED helper, not a private copy.
   *
   * This path had its own resize function, identical to `imageFile`'s bar the
   * empty-border trim - which is exactly the bug: a logo pasted from a web page
   * arrives wrapped in white space, and a resize that keeps that padding ships a
   * logo that renders at a fraction of the size the merchant picked in the Theme
   * tab. Trimming is now part of one definition, so both paths get it.
   *
   * 256px, not the shared 640: a logo is drawn at most 200px tall, and this is
   * the base64 body the API has to accept. */
  const dataUrl = await imageToDataUrl(file, 256);
  return updateMyStore({ logo: dataUrl }, storeId);
};

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

/**
 * GET /stores/:id/customers -> { customers, total, newThisWeek }
 *
 * Every account that signed up at, signed in at, or ordered from this store's
 * public page. Each entry is `{ customer, status, source, joinedAt,
 * lastSeenAt }`.
 */
export const listStoreCustomers = (storeId) =>
  api.get(`/stores/${storeId}/customers`).then((res) => res.data);

/**
 * GET /stores/:id/reviews -> { store, role, reviews, total, average, distribution }
 *
 * Every customer's rating of this store's deliveries, newest first, plus the
 * average and a 1-to-5 histogram. Scoped by the server to the store owner, an
 * appointed store admin, or a platform admin running the store.
 */
export const listStoreReviews = (storeId) =>
  api.get(`/stores/${storeId}/reviews`).then((res) => res.data || {});

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

/** GET /stores (admin) - the stores this account runs (scoped, not platform-wide). */
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

/** DELETE /riders/stores/:storeId - drop this account's store-admin membership ("Remove store"). */
export const leaveStore = (storeId) =>
  api.delete(`/riders/stores/${storeId}`).then((res) => res.data);

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
  uploadStoreLogo,
  listStoreOrders,
  searchRiders,
  lookupUser,
  listStoreRiders,
  listStoreCustomers,
  listStoreReviews,
  inviteRider,
  removeStoreRider,
  listStores,
  listMyRequests,
  respondToRequest,
  leaveStore,
  listMyStores,
  getOrderPool,
  claimOrder,
};
