import { Router } from 'express';
import {
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

// Requires a valid token
router.get('/me', requireAuth, me);
router.patch('/me', requireAuth, updateMe);

export default router;
