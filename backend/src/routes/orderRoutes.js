import { Router } from 'express';
import {
  cancelOrder,
  claimOrder,
  createOrder,
  getOrder,
  getRiderAnalytics,
  getStoreAnalytics,
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

// --- Fixed paths BEFORE "/:id" -------------------------------------------
// "/:id" below is deliberately open to guests (order tracking with a
// guestToken), so any single-segment fixed path registered after it would be
// swallowed by it and answered with 400 "That order id is not valid." instead
// of its own response. They are registered here instead, each carrying its
// own requireAuth (the router-wide requireAuth further down only guards the
// one-order routes above it).
router.get(
  '/mine',
  requireAuth,
  requireRole(ROLES.CUSTOMER, ROLES.ADMIN),
  listMyOrders,
);

router.get(
  '/rider/assigned',
  requireAuth,
  requireRole(ROLES.RIDER),
  listRiderOrders,
);

// How long the rider's deliveries took, per stage and on average.
router.get(
  '/rider/analytics',
  requireAuth,
  requireRole(ROLES.RIDER),
  getRiderAnalytics,
);

// Unclaimed orders from the stores this rider is bound to.
router.get('/pool', requireAuth, requireRole(ROLES.RIDER), listOrderPool);

// Orders placed with a store the signed-in account runs: as owner, or as a
// store admin the owner appointed (who keeps their own platform role).
router.get('/store/mine', requireAuth, requireStoreStaff, listStoreOrders);

// How long this store's deliveries take, per rider and per order. MUST stay
// above the open `/:id` below, or "analytics" is swallowed as an order id.
router.get(
  '/store/analytics',
  requireAuth,
  requireStoreStaff,
  getStoreAnalytics,
);

router.get('/', requireAuth, requireRole(ROLES.ADMIN), listAllOrders);

// --- Guest checkout -------------------------------------------------------
// Creating an order and viewing/cancelling it with the guestToken need NO
// account.
router.post('/', optionalAuth, createOrder);
router.get('/:id', optionalAuth, getOrder);
router.patch('/:id/cancel', optionalAuth, cancelOrder);

router.use(requireAuth);

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
