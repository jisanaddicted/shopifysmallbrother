import { Router } from 'express';
import {
  cancelOrder,
  claimOrder,
  confirmReceived,
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
import {
  deleteOrderReview,
  getOrderReview,
  writeReview,
} from '../controllers/reviewController.js';
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
// Creating an order, and following/cancelling/confirming it with the
// guestToken, need NO account. A guest who ordered without signing up still
// receives the parcel, so they still get the last word on it - only the REVIEW
// below needs an identity to attribute the rating to.
router.post('/', optionalAuth, createOrder);
router.get('/:id', optionalAuth, getOrder);
router.patch('/:id/cancel', optionalAuth, cancelOrder);
// The customer closing the loop. Deliberately its own route rather than
// PATCH /:id/status, which stays rider/admin-only: a rider must not be able to
// mark somebody else's parcel received. Registered up here (not below
// requireAuth) so a guest can reach it with their token, exactly like /cancel.
router.patch('/:id/receive', optionalAuth, confirmReceived);

router.use(requireAuth);

// --- One order ------------------------------------------------------------
// --- Reviews --------------------------------------------------------------
// requireAuth (not a role check) because the controller does the real test: it
// loads the order and insists the signed-in account is the customer who placed
// it. Guests are excluded on purpose - see the note above. One review per order,
// so a second submit overwrites the first.
router.get('/:id/review', getOrderReview);
router.post('/:id/review', writeReview);
router.put('/:id/review', writeReview);
router.delete('/:id/review', deleteOrderReview);

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
