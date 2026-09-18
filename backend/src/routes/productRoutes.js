import { Router } from 'express';
import {
  createProduct,
  deleteProduct,
  getProduct,
  listProducts,
  updateProduct,
} from '../controllers/productController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { ROLES } from '../utils/constants.js';

const router = Router();

// Anyone can browse the catalogue (the storefront itself is login-gated).
router.get('/', listProducts);
router.get('/:id', getProduct);

// Only an admin may change it.
router.post('/', requireAuth, requireRole(ROLES.ADMIN), createProduct);
router.put('/:id', requireAuth, requireRole(ROLES.ADMIN), updateProduct);
router.delete('/:id', requireAuth, requireRole(ROLES.ADMIN), deleteProduct);

export default router;
