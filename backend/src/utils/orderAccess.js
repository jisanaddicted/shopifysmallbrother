import Order from '../models/Order.js';
import { ROLES } from './constants.js';

/**
 * Who may see / act on an order:
 *   - the customer who placed it
 *   - the rider it is assigned to
 *   - a member of the order's store: its owner or an accepted store admin -
 *     including a platform admin, who qualifies only through the stores they
 *     actually run (owned, or an accepted invitation) and never platform-wide.
 *   - a rider bound (active invitation) to the order's store, while the order
 *     is still unclaimed - that is the "available deliveries" pool. Once
 *     another rider takes it, this rule stops applying (order.rider is set).
 *
 * `boundStoreIds` is only consulted for riders; other roles ignore it.
 */
export function canAccessOrder(order, user, boundStoreIds = [], memberStoreIds = []) {
  if (!order) return false;

  const userId = user ? String(user._id) : null;

  if (userId && String(order.customer?._id || order.customer) === userId) return true;
  if (userId && order.rider && String(order.rider?._id || order.rider) === userId) {
    return true;
  }

  // Unclaimed pool order: visible to riders of the owning store (or to any
  // rider when the order has no store at all - the general catalogue).
  if (user?.role === ROLES.RIDER && !order.rider) {
    const storeId = order.store?._id || order.store;
    if (!storeId) return true;
    if (boundStoreIds.map(String).includes(String(storeId))) return true;
  }

  // Store members may watch orders of a store they help run (store admins;
  // a claimed rider already qualifies as order.rider above).
  const memberStoreId = order.store?._id || order.store;
  if (
    memberStoreId &&
    memberStoreIds.map(String).includes(String(memberStoreId))
  ) {
    return true;
  }

  return false;
}

/** Same check but loads the order first. Resolves to the order, or null. */
export async function findAccessibleOrder(
  orderId,
  user,
  populate = [],
  boundStoreIds = [],
  memberStoreIds = [],
) {
  const query = Order.findById(orderId);
  if (populate.length) query.populate(populate);

  const order = await query;
  if (!order) return null;

  return canAccessOrder(order, user, boundStoreIds, memberStoreIds) ? order : null;
}

export default { canAccessOrder, findAccessibleOrder };
