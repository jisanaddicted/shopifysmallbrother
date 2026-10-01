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
 * GET /api/menu/edit/:storeId/categories  (store owner / admin)
 *
 * Just the store's category names, for a picker - the product form's Category
 * dropdown - so it resolves to `{ theme, categories }`, where `categories` is
 * `[{ name, count }]` matching the panel's shape and `theme` is the store's
 * active layout.
 *
 * The theme rides along deliberately. The product form has to render one picker
 * or the other, and asking for that in a second request would be a second round
 * trip to a database that is measurably slow from this machine - on Theme 1,
 * which is every store that has not deliberately switched, this stays the form's
 * ONLY call.
 *
 * Separate from `loadStoreMenu` rather than a field of it, because that call is
 * the theme editor's whole payload: the nav tree, every product in the store,
 * and the store document carrying `categoryImages` (a base64 data URL per
 * category, up to 1MB each). The product form has no use for any of it, and
 * the pictures are the expensive part.
 *
 * It resolves to the SAME list the theme panel shows, because the server builds
 * both from one function. That matters: a category can exist only because a
 * product was filed under it and never been curated, and offering the picker
 * cannot lose such a category - a select limited to curated names would blank
 * it out of the product the moment the merchant opened it to edit.
 */
export const getStoreCategories = (storeId) =>
  api
    .get(`/menu/edit/${storeId}/categories`)
    .then((res) => ({
      /* The store's active theme, from the same call. See the controller: the
         product form needs to know which picker to render, and a second request
         just to read one field is a second round trip to a database that is slow
         from here. */
      theme: res.data.theme || 'theme1',
      categories: res.data.categories || [],
    }));

/**
 * GET /api/menu/edit/:storeId/tree  (store owner / admin)
 *
 * The store's Theme 2 category tree, FLAT: `[{ id, name, parent, position,
 * image, childCount }]`, siblings in position order.
 *
 * Flat on purpose - the client folds it into a tree itself, the same way
 * `buildTree` in ThemeBuilder.jsx already folds the menu. The server and the
 * browser therefore hold one shared definition of the tree rather than two that
 * can drift.
 *
 * `childCount` on each node is what tells the editor whether a row can be
 * opened, and what tells the storefront whether tapping a card reveals more
 * categories or the products on it.
 */
export const loadCategoryTree = (storeId) =>
  api
    .get(`/menu/edit/${storeId}/tree`)
    .then((res) => res.data.tree || []);

/**
 * POST /api/menu/edit/:storeId/tree  — add a category.
 *
 * `parent` omitted (or null) makes a top-level category; passing a node id
 * makes this one its child. The server refuses a parent that would push the
 * tree past its depth cap, so a client never has to count levels itself to
 * avoid offering an action that would be rejected.
 */
export const createTreeNode = (storeId, name, parent = null) =>
  api
    .post(`/menu/edit/${storeId}/tree`, { name, parent })
    .then((res) => res.data.node);

/**
 * PUT /api/menu/edit/:storeId/tree/:nodeId
 *
 * Rename, repicture or MOVE a node. A partial update: only the keys passed are
 * applied, so renaming a category leaves its picture and its place in the tree
 * alone - the same contract `updateProduct` and `saveStoreMenu` already have.
 */
export const updateTreeNode = (storeId, nodeId, changes) =>
  api
    .put(`/menu/edit/${storeId}/tree/${nodeId}`, changes)
    .then((res) => res.data.node);

/**
 * PUT /api/menu/edit/:storeId/tree/:nodeId  — set or clear a node's picture.
 *
 * `image` is a File to be downscaled, or `''` to remove the picture. An empty
 * string is the "no picture" value across this project's schemas - `Store.image`
 * and `Product.image` default to it - so clearing sends the same thing an unset
 * picture is, and the row goes back to its empty placeholder.
 *
 * The client-side downscale and the 1MB server cap are the same pair Theme 1
 * category pictures use, deliberately. A Theme 2 card and a Theme 1 card are the
 * same kind of thing - a picture on a public storefront, read on every page
 * load - so two different limits would mean one of them is wrong. `maxSize` is
 * the edge the client downscales TO, roughly 3x the rendered size, so a phone
 * photo never reaches the database whole.
 */
export const setTreeNodeImage = (storeId, nodeId, image, maxSize = 480) =>
  imageToDataUrl(image, maxSize).then((dataUrl) =>
    api
      .put(`/menu/edit/${storeId}/tree/${nodeId}`, { image: dataUrl })
      .then((res) => res.data.node),
  );

/**
 * DELETE /api/menu/edit/:storeId/tree/:nodeId
 *
 * Delete a category AND everything under it. Products filed in any of them are
 * unfiled rather than deleted, and the Theme 1 `category` string on each one is
 * left exactly as it was - so a store can switch back to Theme 1 afterwards and
 * find its catalogue untouched.
 *
 * Resolves to `{ deleted, clearedProducts }`, where `deleted` is the size of the
 * whole subtree, so the panel can say what actually went instead of letting the
 * list quietly shrink by an unknown amount.
 */
export const deleteTreeNode = (storeId, nodeId) =>
  api
    .delete(`/menu/edit/${storeId}/tree/${nodeId}`)
    .then((res) => ({
      deleted: res.data.deleted || 0,
      clearedProducts: res.data.clearedProducts || 0,
    }));

/**
 * GET /api/stores/:slug/tree  (public - no login required)
 *
 * The tree the storefront browses, with a `productCount` on every node. The
 * same public data the storefront already exposes, arranged as a hierarchy, so
 * it needs no more protection than the catalogue itself.
 */
export const getPublicCategoryTree = (slug) =>
  api.get(`/stores/${slug}/tree`).then((res) => ({
    store: res.data.store || null,
    tree: res.data.tree || [],
  }));

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
 * Turn a picked File into a downscaled data URL, or pass an existing value
 * through untouched.
 *
 * Downscaling is what makes this cheap to send: a phone photo is 3-5MB, and a
 * category card renders at about 150px. Shipping the original would put
 * megabytes through the API on every mobile connection.
 *
 * Passed through, without a canvas round-trip:
 *  - '' — CLEARING a picture. `handleCategoryImageRemove` sends this. It used
 *    to fall through to FileReader, which rejects a string, so removing a
 *    category picture could only ever fail.
 *  - a data URL — a caller that already has one.
 *  - an http(s) URL — what the server stores once Cloudinary has hosted the
 *    upload (see backend/src/services/cloudinary.js). Re-uploading the stored
 *    value unchanged must not try to read a URL as a file.
 */
function imageToDataUrl(image, maxSize) {
  const alreadyAString =
    typeof image === 'string' &&
    (image.startsWith('data:image/') ||
      image.startsWith('https://') ||
      image.startsWith('http://'));

  if (alreadyAString) return Promise.resolve(image);

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
  getStoreCategories,
  loadCategoryTree,
  createTreeNode,
  updateTreeNode,
  setTreeNodeImage,
  deleteTreeNode,
  getPublicCategoryTree,
  saveStoreMenu,
  createCategory,
  deleteCategory,
  setCategoryImage,
};
