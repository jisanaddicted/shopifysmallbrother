import { Router } from 'express';
import {
  bulkDeleteProducts,
  bulkUpdateProducts,
  createProduct,
  deleteProduct,
  getProduct,
  listProducts,
  updateProduct,
} from '../controllers/productController.js';
import { requireAuth, requireProductManager } from '../middleware/auth.js';

const router = Router();

// Anyone can browse the catalogue (the storefront itself is login-gated).
router.get('/', listProducts);
router.get('/:id', getProduct);

// The catalogue editors: store owners, the store admins those owners
// appointed, and platform admins - all resolved through the stores they run
// (the controller refuses anything that belongs to another store).
const manageProducts = requireProductManager;
router.post('/', requireAuth, manageProducts, createProduct);
router.put('/:id', requireAuth, manageProducts, updateProduct);
router.delete('/:id', requireAuth, manageProducts, deleteProduct);

// Bulk editing. Declared with literal paths that cannot be swallowed by the
// `/:id` routes above: these are `patch /bulk` and `post /bulk/delete`, and
// the only parameterised routes are PUT and DELETE, so there is no ordering
// trap here - `POST /bulk/delete` cannot match `PUT /:id`, and the only POST
// is the bare `/` above.
router.patch('/bulk', requireAuth, manageProducts, bulkUpdateProducts);
router.post('/bulk/delete', requireAuth, manageProducts, bulkDeleteProducts);

export default router;
