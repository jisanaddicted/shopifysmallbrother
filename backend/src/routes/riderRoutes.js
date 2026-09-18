import { Router } from 'express';
import {
  listMyRequests,
  listMyStores,
  respondToRequest,
} from '../controllers/riderController.js';
import { searchRiders } from '../controllers/storeController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { ROLES } from '../utils/constants.js';

const router = Router();

router.use(requireAuth);

/**
 * GET /api/riders/lookup?username=...
 * How a store or an admin finds a rider to invite.
 */
router.get('/lookup', requireRole(ROLES.STORE, ROLES.ADMIN), searchRiders);

// --- The rider's own view ---------------------------------------------------
router.get('/requests', requireRole(ROLES.RIDER), listMyRequests);
router.patch('/requests/:id', requireRole(ROLES.RIDER), respondToRequest);
router.get('/stores', requireRole(ROLES.RIDER), listMyStores);

export default router;