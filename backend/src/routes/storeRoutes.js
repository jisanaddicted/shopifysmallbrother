import { Router } from 'express';
import {
  getMyStore,
  getPublicStore,
  inviteRider,
  listMyMerchantStores,
  listStoreCustomers,
  listStores,
  listStoreRiders,
  removeStoreRider,
  updateMyStore,
} from '../controllers/storeController.js';
import { requireAuth, requireRole, requireStoreStaff } from '../middleware/auth.js';
import { ROLES } from '../utils/constants.js';

const router = Router();

// --- Fixed paths first, before "/:slug" can capture them -------------------

/**
 * The store this account runs.
 *
 * READ is open to the owner AND to every store admin the owner appointed (they
 * keep their own platform role - usually `customer` - so this cannot be a role
 * check). WRITE is owner-only, which the controller enforces.
 */
router.get('/mine', requireAuth, requireStoreStaff, getMyStore);
// Every store this account runs (owner + appointed admin). Must sit before
// "/:slug" so "all" is not treated as a store slug.
router.get('/mine/all', requireAuth, requireStoreStaff, listMyMerchantStores);
router.patch('/mine', requireAuth, requireStoreStaff, updateMyStore);

// Every merchant on the platform (admin only).
router.get('/', requireAuth, requireRole(ROLES.ADMIN), listStores);

// --- Rider roster: only the store owner manages their own team. A store admin
// the owner appointed can work with products and orders, but not with the
// team itself; platform admins no longer assign people to stores. ------------
const manageRoster = requireRole(ROLES.STORE);
router.get('/:id/riders', requireAuth, manageRoster, listStoreRiders);
router.post('/:id/riders', requireAuth, manageRoster, inviteRider);
router.delete('/:id/riders/:riderId', requireAuth, manageRoster, removeStoreRider);

// --- Customers who signed up at this store's public page. Anybody who can
// work the store's orders may see them, so this is NOT owner-only. -----------
router.get('/:id/customers', requireAuth, requireStoreStaff, listStoreCustomers);

// --- Public storefront: this is what /s/<slug> loads, no login required -----
router.get('/:slug', getPublicStore);

export default router;