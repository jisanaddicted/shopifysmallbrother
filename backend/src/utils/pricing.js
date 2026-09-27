import {
  ADMIN_STATUS_STEPS,
  DELIVERY_FEE,
  FREE_DELIVERY_OVER,
  ORDER_STATUS,
  ORDER_STATUS_FLOW,
} from './constants.js';

/** Money is stored in whole cents-ish precision - never trust float sums. */
const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

/**
 * Prices a set of order lines exactly the way the browser cart does:
 * subtotal -> delivery fee (free once the basket is big enough) -> total.
 *
 * @param {{ price: number, quantity: number }[]} lines
 */
export function priceOrder(lines = []) {
  const subtotal = lines.reduce(
    (sum, line) => sum + Number(line.price || 0) * Number(line.quantity || 0),
    0,
  );

  const deliveryFee =
    subtotal === 0 || subtotal >= FREE_DELIVERY_OVER ? 0 : DELIVERY_FEE;

  return {
    subtotal: round2(subtotal),
    deliveryFee: round2(deliveryFee),
    total: round2(subtotal + deliveryFee),
  };
}

/** The next step on the happy path, or null when there is none. */
export function nextStatusInFlow(status) {
  const index = ORDER_STATUS_FLOW.indexOf(status);
  if (index === -1 || index >= ORDER_STATUS_FLOW.length - 1) return null;
  return ORDER_STATUS_FLOW[index + 1];
}

/**
 * Which statuses a rider is allowed to move an order to. The rider console
 * offers "next step" plus a direct "Mark delivered", so both are legal.
 */
export function riderAllowedStatuses(currentStatus) {
  const next = nextStatusInFlow(currentStatus);
  const allowed = [ORDER_STATUS.DELIVERED];
  if (next) allowed.push(next);
  return [...new Set(allowed)];
}

/**
 * The one status an admin may move this order to, or null when the admin has no
 * say over where it currently is. Confirmed -> preparing, preparing -> ready
 * for pickup, and nothing else - see ADMIN_STATUS_STEPS.
 */
export function adminNextStatus(status) {
  return ADMIN_STATUS_STEPS[status] || null;
}

export { round2 };

export default {
  priceOrder,
  nextStatusInFlow,
  riderAllowedStatuses,
  adminNextStatus,
};
