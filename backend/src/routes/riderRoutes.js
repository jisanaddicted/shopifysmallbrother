import { Router } from 'express';
import {
  leaveStore,
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

// --- Invitations (visible to the invited user, whatever their role) ---------
// A rider invitation goes to a rider account; a store-admin invitation can go
// to any user. Both are accepted from the same endpoints.
router.get('/requests', listMyRequests);
router.patch('/requests/:id', respondToRequest);
router.get('/stores', requireRole(ROLES.RIDER), listMyStores);
// The admin panel's "Remove store" button - drop this account's own
// store-admin membership. No role gate: an appointed store admin usually
// keeps their own platform role (often `customer`). Owners get a 403 from
// the controller - you cannot leave a store you signed up.
router.delete('/stores/:storeId', leaveStore);

export default router;