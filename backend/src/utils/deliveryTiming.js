import { ORDER_STATUS } from './constants.js';

/**
 * Delivery timing, derived entirely from an order's `statusHistory` audit trail.
 *
 * Every status change is already stamped with `at`, so the durations below are
 * read back out of history rather than counted as work happens: an order's
 * numbers can never drift, and a delivery finished last week still reports the
 * same figures it did on the day.
 *
 * The happy path is split into three legs so it is obvious *who* was slow:
 *
 *   placed -------- ready_for_pickup == picked_up -------- delivered
 *   |     prep (store)     |   wait (rider)   |  ride (rider)  |
 *
 * `total` is what the customer actually waits for: the moment they pressed
 * order to the moment the parcel arrived.
 */

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
const reachedAt = (history, status) => {
  const entry = (history || []).find((item) => item?.status === status);
  return asDate(entry?.at);
};

/**
 * Splits one order's history into its legs. Every field is nullable: an order
 * that is still in progress (or that skipped a step) reports only what it can
 * actually prove, and the caller decides what to show.
 */
export function orderTimings(order) {
  const history = order?.statusHistory || [];
  const placedAt = reachedAt(history, ORDER_STATUS.PENDING) || asDate(order?.createdAt);
  const readyAt =
    reachedAt(history, ORDER_STATUS.READY_FOR_PICKUP) ||
    reachedAt(history, ORDER_STATUS.PICKED_UP);
  const pickedUpAt = reachedAt(history, ORDER_STATUS.PICKED_UP);
  const outForDeliveryAt = reachedAt(history, ORDER_STATUS.OUT_FOR_DELIVERY);
  const deliveredAt = reachedAt(history, ORDER_STATUS.DELIVERED);
  const cancelledAt = reachedAt(history, ORDER_STATUS.CANCELLED);

  return {
    placedAt,
    readyAt,
    pickedUpAt,
    outForDeliveryAt,
    deliveredAt,
    cancelledAt,
    // The store's side: how long the basket sat being prepared.
    prepMs: span(placedAt, readyAt),
    // The rider waiting at the counter for a parcel that was not ready.
    waitMs: span(readyAt, pickedUpAt),
    // The delivery itself, pickup to doorstep.
    rideMs: span(pickedUpAt, deliveredAt),
    // What the customer waited for, end to end.
    totalMs: span(placedAt, deliveredAt),
    isDelivered: Boolean(deliveredAt),
    isCancelled: Boolean(cancelledAt),
    isOpen: !deliveredAt && !cancelledAt,
  };
}

/**
 * How long an order in progress has been running so far, plus which leg it is
 * sitting in. Lets the console show a live "12 min so far" on a job that is
 * still out, instead of only ever reporting finished deliveries.
 */
export function inFlightTiming(order) {
  const t = orderTimings(order);
  const now = new Date();

  let leg = 'pending';
  if (t.deliveredAt) leg = 'delivered';
  else if (t.cancelledAt) leg = 'cancelled';
  else if (t.pickedUpAt) leg = 'riding';
  else if (t.readyAt) leg = 'waiting for pickup';
  else if (t.placedAt) leg = 'being prepared';

  return {
    leg,
    placedAt: t.placedAt,
    elapsedMs: t.placedAt ? Math.max(0, now.getTime() - t.placedAt.getTime()) : null,
  };
}

/** Mean of the numbers that are actually present. */
const average = (values) => {
  const usable = values.filter((value) => Number.isFinite(value));
  if (!usable.length) return null;
  return Math.round(usable.reduce((sum, value) => sum + value, 0) / usable.length);
};

/** A delivery counts as on time when it beat this target. */
export const DELIVERY_TARGET_MS = 45 * 60 * 1000;

/**
 * Rolls a rider's orders up into the numbers an analytics page shows: the
 * headline averages, the best/worst run, and one row per delivery.
 */
export function summariseTimings(orders) {
  const rows = (orders || []).map((order) => {
    const t = orderTimings(order);
    return {
      id: String(order?._id || order?.id || ''),
      store: order?.store?.name || order?.store?.slug || 'Unknown store',
      status: order?.status || null,
      total: order?.total ?? null,
      ...t,
    };
  });

  const delivered = rows.filter((row) => row.isDelivered);
  const inFlight = rows.filter((row) => row.isOpen);

  const totals = delivered.map((row) => row.totalMs);
  const best = delivered.reduce(
    (min, row) => (row.totalMs !== null && (min === null || row.totalMs < min) ? row.totalMs : min),
    null,
  );
  const worst = delivered.reduce(
    (max, row) => (row.totalMs !== null && (max === null || row.totalMs > max) ? row.totalMs : max),
    null,
  );

  const onTime = delivered.filter((row) => row.totalMs !== null && row.totalMs <= DELIVERY_TARGET_MS);

  return {
    delivered: delivered.length,
    open: inFlight.length,
    cancelled: rows.filter((row) => row.isCancelled).length,
    summary: {
      avgPrepMs: average(delivered.map((row) => row.prepMs)),
      avgWaitMs: average(delivered.map((row) => row.waitMs)),
      avgRideMs: average(delivered.map((row) => row.rideMs)),
      avgTotalMs: average(totals),
      bestMs: best,
      worstMs: worst,
      onTime: onTime.length,
      // A percentage rather than a ratio, rounded for the card readout.
      onTimePct: delivered.length ? Math.round((onTime.length / delivered.length) * 100) : null,
    },
    // Newest first, finished deliveries before still-open ones.
    orders: [...delivered, ...inFlight].sort(
      (a, b) => new Date(b.placedAt || 0) - new Date(a.placedAt || 0),
    ),
  };
}

export default { orderTimings, inFlightTiming, summariseTimings, DELIVERY_TARGET_MS };
