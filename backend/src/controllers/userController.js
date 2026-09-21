import Store from '../models/Store.js';
import StoreRider from '../models/StoreRider.js';
import Order from '../models/Order.js';
import User from '../models/User.js';
import { HttpError } from '../middleware/errorHandler.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ROLES, ORDER_STATUS, STORE_RIDER_STATUS } from '../utils/constants.js';

/**
 * GET /api/users/lookup?username=
 *
 * The global people search behind every invitation (store riders and store
 * admins). Finds any account by username OR email address - an owner who
 * wants to appoint somebody can type whichever they know. Returns a profile
 * card: name, @username, platform role and "quality" stats - for riders how
 * many deliveries they completed / are active on and how many stores they work
 * for, for everyone else whether they own or help manage stores. No email or
 * password material is ever returned.
 */
export const lookupUser = asyncHandler(async (req, res) => {
  // Let users type @handle naturally (the UI shows @username); strip it.
  const raw = String(req.query.username || '').trim().replace(/^@+/, '');
  if (!raw) throw new HttpError(400, 'Type a username or email to search.');

  // Handles are stored lowercase; match case-insensitively anyway so a
  // partially migrated account is still found.
  const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const user = await User.findOne({
    $or: [
      { username: new RegExp(`^${escaped}$`, 'i') },
      { email: new RegExp(`^${escaped}$`, 'i') },
    ],
  }).select('name username email role isAvailable createdAt');

  if (!user) return res.json({ user: null });

  const card = user.toJSON();
  const stats = {};

  if (user.role === ROLES.RIDER) {
    const [completed, active, storeCount] = await Promise.all([
      Order.countDocuments({ rider: user._id, status: ORDER_STATUS.DELIVERED }),
      Order.countDocuments({
        rider: user._id,
        status: { $nin: [ORDER_STATUS.DELIVERED, ORDER_STATUS.CANCELLED] },
      }),
      StoreRider.countDocuments({
        rider: user._id,
        status: STORE_RIDER_STATUS.ACTIVE,
      }),
    ]);
    stats.deliveriesCompleted = completed;
    stats.deliveriesActive = active;
    stats.stores = storeCount;
    stats.isAvailable = Boolean(user.isAvailable);
  } else {
    const [storesOwned, storesManaged] = await Promise.all([
      Store.countDocuments({ owner: user._id }),
      StoreRider.countDocuments({
        rider: user._id,
        status: STORE_RIDER_STATUS.ACTIVE,
        role: 'admin',
      }),
    ]);
    stats.storesOwned = storesOwned;
    stats.storesManaged = storesManaged;
  }

  res.json({ user: { ...card, stats } });
});

export default { lookupUser };

