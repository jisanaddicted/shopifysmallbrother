import { Router } from 'express';
import {
  getStoreMenu,
  listStoreMenu,
  listStoreCategories,
  saveStoreMenu,
  createCategory,
  deleteCategory,
  setCategoryImage,
} from '../controllers/menuController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

/**
 * GET /api/menu/:slug  (public — no login required)
 *
 * Returns the store's navigation tree as the customer storefront renders it.
 * The store is resolved by its public slug, same as /api/stores/:slug.
 */
router.get('/:slug', getStoreMenu);

/**
 * Everything below this line is store-staff only: the owner who signed the
 * store up, an accepted store admin, or a platform admin.
 */
router.use(requireAuth);

/**
 * GET  /api/menu/edit/:storeId  — flat list + categories + products for the editor
 * PUT    /api/menu/edit/:storeId  — bulk-replace the whole menu
 */
router.get('/edit/:storeId', listStoreMenu);
router.put('/edit/:storeId', saveStoreMenu);

/**
 * The theme builder's category panel.
 *
 * GET    /api/menu/edit/:storeId/categories        — the names, for a picker
 * POST   /api/menu/edit/:storeId/categories        — create one ({ name })
 * PUT    /api/menu/edit/:storeId/categories/:name/image — set/clear its picture
 * DELETE /api/menu/edit/:storeId/categories/:name  — delete one, and unfile
 *                                                      the products in it
 *
 * All sit under `/edit/` and are registered after the auth middleware above,
 * so they inherit the same owner / store-admin / platform-admin check as the
 * menu itself. `:name` is the category NAME rather than an id - a category is
 * a heading, and headings are words (see models/Store.js).
 *
 * The GET is the product form's category dropdown reading the very same list
 * the panel edits. It is registered here, rather than left to the generic
 * `/edit/:storeId` above, because that endpoint is the theme editor's payload -
 * the whole nav tree, every product, and the store document with its category
 * pictures - and a dropdown needs none of that. The two also cannot collide:
 * `/edit/:storeId` is two segments and this is three, and the public
 * `/:slug` route above matches a single segment only.
 *
 * The image route is declared BEFORE the delete route on purpose. They share
 * the `/categories/:name` prefix and differ only by method, so order does not
 * actually decide it - but listing the more specific one first keeps the
 * intent obvious to whoever reads this next.
 */
router.get('/edit/:storeId/categories', listStoreCategories);
router.post('/edit/:storeId/categories', createCategory);
router.put('/edit/:storeId/categories/:name/image', setCategoryImage);
router.delete('/edit/:storeId/categories/:name', deleteCategory);

export default router;
