import { Router } from 'express';
import {
  getStoreMenu,
  listStoreMenu,
  saveStoreMenu,
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

export default router;
