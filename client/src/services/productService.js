import api from './api';

// ---------------------------------------------------------------------------
// Catalog endpoints used by the Storefront, Checkout and ProductManager.
// ---------------------------------------------------------------------------

/** GET /products?search=&category=&page= */
export const getProducts = (params = {}) =>
  api
    .get('/products', { params })
    .then((res) => res.data.products || res.data || []);

/** GET /products/:id */
export const getProductById = (productId) =>
  api.get(`/products/${productId}`).then((res) => res.data.product || res.data);

/** POST /products  (admin) */
export const createProduct = (payload) =>
  api.post('/products', payload).then((res) => res.data.product || res.data);

/** PUT /products/:id  (admin) */
export const updateProduct = (productId, payload) =>
  api
    .put(`/products/${productId}`, payload)
    .then((res) => res.data.product || res.data);

/** DELETE /products/:id  (admin) */
export const deleteProduct = (productId) =>
  api.delete(`/products/${productId}`).then((res) => res.data);

/**
 * PATCH /products/bulk - apply one set of changes to many products at once.
 *
 * A partial update: any field left out of `changes` is left alone on every
 * product, which is what makes it safe to call from a form that only filled in
 * two of its boxes. Resolves to
 * { updated: [{id, name}], skipped: [{id, reason}], failed: [{id, reason}], total }
 * so the caller can report exactly what happened rather than assuming all or
 * nothing - the server deliberately keeps going past a product it cannot touch.
 */
export const bulkUpdateProducts = (ids, changes) =>
  api
    .patch('/products/bulk', { ids, ...changes })
    .then((res) => res.data || {});

/** POST /products/bulk/delete. Resolves to { deleted, skipped, names }. */
export const bulkDeleteProducts = (ids) =>
  api.post('/products/bulk/delete', { ids }).then((res) => res.data || {});

export default {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  bulkUpdateProducts,
  bulkDeleteProducts,
};