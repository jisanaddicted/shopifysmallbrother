import { Router } from 'express';
import {
  getStoreMenu,
  listStoreMenu,
  saveStoreMenu,
  createCategory,
  deleteCategory,
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
 * POST   /api/menu/edit/:storeId/categories        — create one ({ name })
 * DELETE /api/menu/edit/:storeId/categories/:name  — delete one, and unfile
 *                                                      the products in it
 *
 * Both sit under `/edit/` and are registered after the auth middleware above,
 * so they inherit the same owner / store-admin / platform-admin check as the
 * menu itself. `:name` is the category NAME rather than an id - a category is
 * a heading, and headings are words (see models/Store.js).
 */
router.post('/edit/:storeId/categories', createCategory);
router.delete('/edit/:storeId/categories/:name', deleteCategory);

export default router;
