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
import { requireAuth, optionalAuth, requireRole, requireStoreStaff } from '../middleware/auth.js';
import { ROLES } from '../utils/constants.js';

const router = Router();

// Guest checkout: creating an order and viewing/cancelling it with the
// guestToken need NO account. Everything else still needs a signed-in user
// (each protected route re-checks requireAuth itself).
router.post('/', optionalAuth, createOrder);
router.get('/:id', optionalAuth, getOrder);
router.patch('/:id/cancel', optionalAuth, cancelOrder);

router.use(requireAuth);

// --- Fixed paths first, so they are not captured by "/:id" -----------------
router.get('/mine', requireRole(ROLES.CUSTOMER, ROLES.ADMIN), listMyOrders);
router.get('/rider/assigned', requireRole(ROLES.RIDER), listRiderOrders);
// Unclaimed orders from the stores this rider is bound to.
router.get('/pool', requireRole(ROLES.RIDER), listOrderPool);
// Orders placed with a store the signed-in account runs: as owner, or as a
// store admin the owner appointed (who keeps their own platform role).
router.get('/store/mine', requireStoreStaff, listStoreOrders);
router.get('/', requireRole(ROLES.ADMIN), listAllOrders);

// --- One order ------------------------------------------------------------
router.post('/:id/claim', requireRole(ROLES.RIDER), claimOrder);
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
