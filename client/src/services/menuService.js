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

/**
 * PUT /api/menu/edit/:storeId/categories/:name/image — set or clear a picture.
 *
 * `image` is a base64 data URL, or '' to remove the picture. The name goes in
 * the path, so it is percent-encoded for the same reason as deleteCategory.
 *
 * A data URL rather than multipart, matching uploadStoreLogo: the caller
 * downscales to a card-sized PNG first, so nothing large, remote or
 * file-backed ever enters the database. `maxSize` is the edge the caller
 * downscales TO, and the server caps what it will accept at 1MB — the two are
 * deliberately different numbers, because a client-side limit is a courtesy to
 * the shopper's upload and the server-side one is the actual guarantee.
 */
export const setCategoryImage = (storeId, name, image, maxSize = 480) =>
  imageToDataUrl(image, maxSize)
    .then((dataUrl) =>
      api
        .put(
          `/menu/edit/${storeId}/categories/${encodeURIComponent(name)}/image`,
          { image: dataUrl },
        )
        .then((res) => res.data.categories || []),
    );

/**
 * Turn a picked File into a downscaled data URL, or pass a data URL through.
 *
 * Downscaling is what makes this safe to store: a phone photo is 3-5MB, and
 * a category card renders at about 150px. Shipping the original would put
 * megabytes of base64 into a document the storefront reads on every visit.
 * 480px is roughly 3x the rendered size, so it stays sharp on a high-density
 * screen without being wasteful.
 *
 * Accepts a data URL unchanged so a caller that already has one (a re-upload of
 * the stored value, say) does not round-trip it through a canvas.
 */
function imageToDataUrl(image, maxSize) {
  if (typeof image === 'string' && image.startsWith('data:image/')) {
    return Promise.resolve(image);
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that image.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not a valid image.'));
      img.onload = () => {
        // `Math.min(1, ...)` so a small image is not scaled UP - upscaling
        // cannot add detail, it only inflates the file.
        const scale = Math.min(
          1,
          maxSize / Math.max(img.width, img.height, 1),
        );
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Your browser could not process that image.'));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(image);
  });
}

export default {
  getPublicStoreMenu,
  loadStoreMenu,
  saveStoreMenu,
  createCategory,
  deleteCategory,
  setCategoryImage,
};
