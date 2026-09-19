import { Router } from 'express';
import {
  cancelOrder,
  claimOrder,
  createOrder,
  getOrder,
  listAllOrders,
  listMyOrders,
  listOrderPool,
  listRiderOrders,
  listStoreOrders,
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
// Unclaimed orders from the stores this rider is bound to.
router.get('/pool', requireRole(ROLES.RIDER), listOrderPool);
// Orders placed with the signed-in merchant's store.
router.get('/store/mine', requireRole(ROLES.STORE), listStoreOrders);
router.get('/', requireRole(ROLES.ADMIN), listAllOrders);

// --- One order ------------------------------------------------------------
router.get('/:id', getOrder);
router.post('/:id/claim', requireRole(ROLES.RIDER), claimOrder);
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

export default router;
