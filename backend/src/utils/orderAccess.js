import Order from '../models/Order.js';
import { ROLES } from './constants.js';

/**
 * Who may see / act on an order:
 *   - the customer who placed it
 *   - the rider it is assigned to
 *   - any admin
 */
export function canAccessOrder(order, user) {
  if (!order || !user) return false;
  if (user.role === ROLES.ADMIN) return true;

  const userId = String(user._id);

  if (String(order.customer?._id || order.customer) === userId) return true;
  if (order.rider && String(order.rider?._id || order.rider) === userId) {
    return true;
  }

  return false;
}

/** Same check but loads the order first. Resolves to the order, or null. */
export async function findAccessibleOrder(orderId, user, populate = []) {
  const query = Order.findById(orderId);
  if (populate.length) query.populate(populate);

  const order = await query;
  if (!order) return null;

  return canAccessOrder(order, user) ? order : null;
}

export default { canAccessOrder, findAccessibleOrder };
