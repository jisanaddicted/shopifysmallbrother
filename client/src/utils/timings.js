// ---------------------------------------------------------------------------
// Order timing, read straight off an order's statusHistory.
//
// This mirrors backend/src/utils/deliveryTiming.js - the same reasoning as the
// duplicated constants: the tracker only ever has ONE order in hand (already
// delivered with its timings attached by /orders/rider/analytics), so there is
// nothing to ask the server for, while the analytics tabs do their summing
// server-side. Keep the two in step if either changes.
// ---------------------------------------------------------------------------

const asDate = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
};

/** Milliseconds between two stamps, or null when either end is missing. */
const span = (from, to) => {
  if (!from || !to) return null;
  return Math.max(0, to.getTime() - from.getTime());
};

/** When an order first reached a status. Later repeats do not overwrite it. */
const reachedAt = (history, status) =>
  asDate((history || []).find((item) => item?.status === status)?.at);

/**
 * Every status update on one order, in the order it happened, with the time the
 * order spent in the step *before* it.
 *
 * `sinceMs` is null on the very first stamp - nothing came before it - and on
 * any entry with a missing timestamp, rather than a misleading 0.
 */
export function statusSteps(order) {
  const history = Array.isArray(order?.statusHistory) ? order.statusHistory : [];

  return history
    .map((entry, index) => {
      const at = asDate(entry?.at);
      const previous = index > 0 ? asDate(history[index - 1]?.at) : null;

      return {
        status: entry?.status || null,
        note: entry?.note || '',
        at,
        by: entry?.by || null,
        sinceMs:
          at && previous ? Math.max(0, at.getTime() - previous.getTime()) : null,
      };
    })
    .filter((step) => step.status && step.at);
}

/**
 * The legs of one delivery, in the order they happen:
 *
 *   placed --- ready_for_pickup == picked_up --- delivered --- received
 *   |  prep (store)  |  wait (rider)  | ride (rider)  | confirm (customer) |
 *
 * TWO TOTALS, on purpose. `totalMs` is the rider's job (placed -> delivered)
 * and is what the SLA is measured against; `cycleMs` is the whole order
 * (placed -> received), ending when the customer confirms. The gap between them
 * is `confirmMs`, the customer's own lag - which is NOT the rider's to answer
 * for, so it is reported separately instead of being folded into a performance
 * number. Both are null until the relevant tap happens.
 */
export function deliveryLegs(order) {
  const history = order?.statusHistory || [];
  const placedAt = reachedAt(history, 'pending') || asDate(order?.createdAt);
  const pickedUpAt = reachedAt(history, 'picked_up');
  const readyAt =
    reachedAt(history, 'ready_for_pickup') || reachedAt(history, 'picked_up');
  const outAt = reachedAt(history, 'out_for_delivery');
  const deliveredAt = reachedAt(history, 'delivered');
  const receivedAt = reachedAt(history, 'received');
  const cancelledAt = reachedAt(history, 'cancelled');

  return {
    placedAt,
    readyAt,
    pickedUpAt,
    outAt,
    deliveredAt,
    receivedAt,
    cancelledAt,
    prepMs: span(placedAt, readyAt),
    waitMs: span(readyAt, pickedUpAt),
    rideMs: span(pickedUpAt, deliveredAt),
    totalMs: span(placedAt, deliveredAt),
    // Null, not 0, until the customer actually confirms.
    confirmMs: span(deliveredAt, receivedAt),
    cycleMs: span(placedAt, receivedAt),
    isDelivered: Boolean(deliveredAt),
    isReceived: Boolean(receivedAt),
    isCancelled: Boolean(cancelledAt),
    isOpen: !deliveredAt && !cancelledAt,
  };
}

/**
 * How long ago the order was placed, for one still in progress. Null once it is
 * finished - the finished number is the total, and showing both is noise.
 */
export function elapsedMs(order) {
  const legs = deliveryLegs(order);
  if (legs.isDelivered || legs.isCancelled) return null;

  return legs.placedAt ? Math.max(0, Date.now() - legs.placedAt.getTime()) : null;
}

export default { statusSteps, deliveryLegs, elapsedMs };
