import { Router } from 'express';
import {
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

export default router;
