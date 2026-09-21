import { Router } from 'express';
import { lookupUser } from '../controllers/userController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// Any signed-in user may search people by username - store owners use it to
// invite riders/store admins, platform admins use it for the same cards.
router.get('/lookup', requireAuth, lookupUser);

export default router;
