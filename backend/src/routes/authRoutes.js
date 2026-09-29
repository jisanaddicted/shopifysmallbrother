import { Router } from 'express';
import {
  claimGuestOrder,
  login,
  me,
  register,
  updateMe,
  usernameAvailable,
} from '../controllers/authController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// Public
router.post('/register', register);
router.post('/login', login);
router.get('/username-available', usernameAvailable);

// Turns a guest order into an account. Public on purpose: the caller is by
// definition NOT signed in yet - the whole point is that they have no account.
// It authorises itself with the order's guestToken instead of a JWT.
router.post('/claim-guest-order', claimGuestOrder);

// Requires a valid token
router.get('/me', requireAuth, me);
router.patch('/me', requireAuth, updateMe);

export default router;
