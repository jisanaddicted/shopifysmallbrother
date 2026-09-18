import { Router } from 'express';
import { listRiders } from '../controllers/adminController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { ROLES } from '../utils/constants.js';

const router = Router();

// The whole admin area is admin-only.
router.use(requireAuth, requireRole(ROLES.ADMIN));

router.get('/riders', listRiders);

export default router;
