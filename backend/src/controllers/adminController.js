import User from '../models/User.js';
import Order from '../models/Order.js';
import { ROLES, ORDER_STATUS } from '../utils/constants.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/**
 * GET /api/admin/riders?available=true
 *
 * The dispatch board dropdown. Returns { riders } with each rider plus how many
 * orders they currently have open, so a dispatcher can spread the load.
 */
export const listRiders = asyncHandler(async (req, res) => {
  const filter = { role: ROLES.RIDER };

  // `isAvailable=false` riders have taken themselves off the dispatch list.
  if (String(req.query.available ?? 'false') === 'true') {
    filter.isAvailable = true;
  }

  const riders = await User.find(filter)
    .select('name email phone location isAvailable')
    .sort({ name: 1 });

  // One grouped count instead of a query per rider.
  const activeCounts = await Order.aggregate([
    {
      $match: {
        rider: { $in: riders.map((rider) => rider._id) },
        status: { $nin: [ORDER_STATUS.DELIVERED, ORDER_STATUS.CANCELLED] },
      },
    },
    { $group: { _id: '$rider', count: { $sum: 1 } } },
  ]);

  const countByRider = new Map(
    activeCounts.map((entry) => [String(entry._id), entry.count]),
  );

  res.json({
    riders: riders.map((rider) => ({
      ...rider.toJSON(),
      activeOrders: countByRider.get(String(rider._id)) || 0,
    })),
  });
});

export default { listRiders };
