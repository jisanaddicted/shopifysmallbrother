import { Router } from 'express';
import {
  getMyStore,
  getPublicStore,
  inviteRider,
  listStores,
  listStoreRiders,
  removeStoreRider,
  updateMyStore,
} from '../controllers/storeController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { ROLES } from '../utils/constants.js';

const router = Router();

// --- Fixed paths first, before "/:slug" can capture them -------------------
router.get('/mine', requireAuth, requireRole(ROLES.STORE), getMyStore);
router.patch('/mine', requireAuth, requireRole(ROLES.STORE), updateMyStore);

// Every merchant on the platform (admin only).
router.get('/', requireAuth, requireRole(ROLES.ADMIN), listStores);

// --- Rider roster: a merchant manages their own, an admin may manage any ----
const manageRoster = requireRole(ROLES.STORE, ROLES.ADMIN);
router.get('/:id/riders', requireAuth, manageRoster, listStoreRiders);
router.post('/:id/riders', requireAuth, manageRoster, inviteRider);
router.delete('/:id/riders/:riderId', requireAuth, manageRoster, removeStoreRider);

// --- Public storefront: this is what /s/<slug> loads, no login required -----
router.get('/:slug', getPublicStore);

export default router;