import { Router } from 'express';
import {
  assignRider,
  cancelOrder,
  createOrder,
  getOrder,
  listAllOrders,
  listMyOrders,
  listRiderOrders,
  updateOrderStatus,
  updateRiderLocation,
} from '../controllers/orderController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { ROLES } from '../utils/constants.js';

const router = Router();

// Everything under /orders needs a signed-in user.
router.use(requireAuth);

// --- Fixed paths first, so they are not captured by "/:id" -----------------
router.post('/', requireRole(ROLES.CUSTOMER, ROLES.ADMIN), createOrder);
router.get('/mine', requireRole(ROLES.CUSTOMER, ROLES.ADMIN), listMyOrders);
router.get('/rider/assigned', requireRole(ROLES.RIDER), listRiderOrders);
router.get('/', requireRole(ROLES.ADMIN), listAllOrders);

// --- One order ------------------------------------------------------------
router.get('/:id', getOrder);
router.patch('/:id/cancel', cancelOrder);
router.patch(
  '/:id/status',
  requireRole(ROLES.RIDER, ROLES.ADMIN),
  updateOrderStatus,
);
router.patch(
  '/:id/location',
  requireRole(ROLES.RIDER, ROLES.ADMIN),
  updateRiderLocation,
);
router.patch('/:id/assign', requireRole(ROLES.ADMIN), assignRider);

export default router;
