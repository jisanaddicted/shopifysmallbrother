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

export default {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
};