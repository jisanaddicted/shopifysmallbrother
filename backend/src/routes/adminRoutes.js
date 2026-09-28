import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { ROLES } from '../utils/constants.js';

const router = Router();

// The whole admin area is admin-only.
router.use(requireAuth, requireRole(ROLES.ADMIN));

// There is no manual rider assignment anymore: riders claim orders from their own
// pool after being bound to a store. Rider management lives in the store
// area (search by username + invite) - see storeRoutes.js.

export default router;
