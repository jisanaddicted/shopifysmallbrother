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

// Admins manage every product; a merchant manages their own store's products
// (the controller refuses anything that belongs to another store).
const manageProducts = requireRole(ROLES.ADMIN, ROLES.STORE);
router.post('/', requireAuth, manageProducts, createProduct);
router.put('/:id', requireAuth, manageProducts, updateProduct);
router.delete('/:id', requireAuth, manageProducts, deleteProduct);

export default router;
