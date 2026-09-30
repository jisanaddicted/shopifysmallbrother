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

/**
 * POST /api/menu/edit/:storeId/categories  — create a category.
 *
 * Separate from saving the menu on purpose. A category is a NAME, not a menu
 * row, so it does not belong in the bulk menu payload — and the two have very
 * different lifetimes. The menu is a wholesale replacement the merchant edits
 * as one unit; categories are created and deleted one at a time. Folding them
 * into `saveStoreMenu` would mean adding a category required opening the menu
 * editor, adding a blank row and saving.
 *
 * Returns the store's full category list, not just the new entry, because the
 * count beside each name can change and the panel shows those counts.
 */
export const createCategory = (storeId, name) =>
  api
    .post(`/menu/edit/${storeId}/categories`, { name })
    .then((res) => res.data.categories || []);

/**
 * DELETE /api/menu/edit/:storeId/categories/:name — delete a category.
 *
 * The name goes in the path, so it is percent-encoded: a category called
 * "Chips & Snacks" is a perfectly reasonable name and an unencoded `&` would
 * otherwise start a query string the server never sees.
 *
 * Deleting also unfiles the products in it, so the resolved list comes back
 * with the same shape as `createCategory`'s. `clearedProducts` says how many
 * products were moved out, which the panel surfaces rather than letting the
 * list quietly change.
 */
export const deleteCategory = (storeId, name) =>
  api
    .delete(`/menu/edit/${storeId}/categories/${encodeURIComponent(name)}`)
    .then((res) => ({
      categories: res.data.categories || [],
      clearedProducts: res.data.clearedProducts || 0,
    }));

export default {
  getPublicStoreMenu,
  loadStoreMenu,
  saveStoreMenu,
  createCategory,
  deleteCategory,
};
