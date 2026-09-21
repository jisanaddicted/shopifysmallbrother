import api from './api';

/**
 * GET /api/menu/:slug  (public) — the customer storefront navbar tree.
 * Returns an array of top-level items, each with `children` for dropdowns.
 */
export const getPublicStoreMenu = (slug) =>
  api.get(`/menu/${slug}`).then((res) => res.data.menu || []);

/**
 * GET /api/menu/edit/:storeId  (store owner / admin) — data the theme editor
 * needs to render its tree + dropdowns.
 */
export const loadStoreMenu = (storeId) =>
  api.get(`/menu/edit/${storeId}`).then((res) => ({
    store: res.data.store,
    items: res.data.items || [],
    categories: res.data.categories || [],
    products: res.data.products || [],
  }));

/**
 * PUT /api/menu/edit/:storeId  (store owner / admin) — replace the whole menu.
 * Send the full flat array (temp ids for new rows); get back the persisted list.
 */
export const saveStoreMenu = (storeId, items) =>
  api
    .put(`/menu/edit/${storeId}`, { items })
    .then((res) => res.data.items || []);

export default {
  getPublicStoreMenu,
  loadStoreMenu,
  saveStoreMenu,
};
