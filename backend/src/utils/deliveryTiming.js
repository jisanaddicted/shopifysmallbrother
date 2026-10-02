import { ORDER_STATUS } from './constants.js';

/**
 * Delivery timing, derived entirely from an order's `statusHistory` audit trail.
 *
 * Every status change is already stamped with `at`, so the durations below are
 * read back out of history rather than counted as work happens: an order's
 * numbers can never drift, and a delivery finished last week still reports the
 * same figures it did on the day.
 *
 * The happy path is split into legs so it is obvious *who* was slow:
 *
 *   placed --- ready_for_pickup == picked_up --- delivered --- received
 *   |  prep (store)  |  wait (rider)  | ride (rider)  | confirm (customer) |
 *
 * TWO TOTALS, AND THE DIFFERENCE IS THE WHOLE POINT
 *
 *   totalMs  placed -> delivered   the RIDER's job, end to end. This is what
 *                                 the 45-minute SLA and the on-time rate are
 *                                 measured against, because every minute in it
 *                                 is one the rider actually controls.
 *
 *   cycleMs  placed -> received    the WHOLE order, ending when the customer
 *                                 says it arrived. This is the truest answer to
 *                                 "how long did this order take?", and it is
 *                                 the number a store should quote.
 *
 * They are NOT interchangeable, and the gap between them is `confirmMs` - the
 * customer's own delay between the parcel hitting the doorstep and them
 * tapping the button. Charging that to a rider would be wrong in a way that
 * quietly ruins a performance number: a customer who opens the parcel an hour
 * later makes an exemplary rider look 4x slower, and an order nobody ever
 * confirms has no end at all. So both are reported, the SLA stays on the leg
 * the rider owns, and the confirmation lag is shown as its own figure.
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
  // The customer's own "it arrived" tap. Only ever set on an order that was
  // already delivered - RECEIVABLE_STATUSES is [delivered] - so this can be
  // newer than deliveredAt but never earlier.
  const receivedAt = reachedAt(history, ORDER_STATUS.RECEIVED);
  const cancelledAt = reachedAt(history, ORDER_STATUS.CANCELLED);

  return {
    placedAt,
    readyAt,
    pickedUpAt,
    outForDeliveryAt,
    deliveredAt,
    receivedAt,
    cancelledAt,
    // The store's side: how long the basket sat being prepared.
    prepMs: span(placedAt, readyAt),
    // The rider waiting at the counter for a parcel that was not ready.
    waitMs: span(readyAt, pickedUpAt),
    // The delivery itself, pickup to doorstep.
    rideMs: span(pickedUpAt, deliveredAt),
    // What the customer waited for, end to end, up to the RIDER's handover.
    totalMs: span(placedAt, deliveredAt),
    /* The customer's confirmation lag, and the whole order including it.
     *
     * Null until they confirm - not zero, and not "now". An unconfirmed delivery
     * has an unknown end, and reporting it as 0 or as the elapsed time so far
     * would both invent a number. `average()` drops these, so a store where most
     * customers never tap gets a blank card rather than a flattering lie. */
    confirmMs: span(deliveredAt, receivedAt),
    cycleMs: span(placedAt, receivedAt),
    isDelivered: Boolean(deliveredAt),
    isReceived: Boolean(receivedAt),
    isCancelled: Boolean(cancelledAt),
    // `received` is in CLOSED_STATUSES, so an order nobody has confirmed is
    // still finished work - it just has no cycle time to quote.
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
      // Who carried it. The rider's own analytics page ignores these, but the
      // store-side table needs them next to the timings.
      riderId: order?.rider?._id || order?.rider?.id || order?.rider || null,
      riderName: order?.rider?.name || null,
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

  /* The confirmation cohort, and everything derived from it.
   *
   * Deliberately a DIFFERENT cohort from `delivered`. `delivered` is every
   * parcel that reached a doorstep; the cycle figures are only the ones whose
   * customer went on to confirm. Mixing them would be the classic average-of-
   * two-things trap this file already got burned by once (see the cohort note
   * below): the headline "Avg delivery" and the "Avg order" would quietly be
   * describing different sets of orders, and the difference between them would
   * look like a bug rather than the customer's confirmation lag.
   *
   * `awaitingConfirm` is published so the gap is never mysterious - it is the
   * number of delivered orders that have no cycle time yet because the customer
   * has not tapped. */
  const received = rows.filter((row) => row.isReceived);
  const cycles = received.map((row) => row.cycleMs);
  const confirms = received.map((row) => row.confirmMs);
  const awaitingConfirm = delivered.filter((row) => !row.isReceived);
  const bestCycle = received.reduce(
    (min, row) => (row.cycleMs !== null && (min === null || row.cycleMs < min) ? row.cycleMs : min),
    null,
  );
  const worstCycle = received.reduce(
    (max, row) => (row.cycleMs !== null && (max === null || row.cycleMs > max) ? row.cycleMs : max),
    null,
  );

  /*
   * The three legs and the end-to-end total are averaged over ONE cohort.
   *
   * A store's order book is not uniform. Plenty of delivered orders never
   * recorded a pickup - imported history, a hand-edited status, an order closed
   * straight from confirmed to delivered - so they carry a real `totalMs` but no
   * prep/wait/ride split. `average()` drops those non-finite legs, so the legs
   * were being averaged over the ~41 orders that have a full split while
   * `avgTotalMs` averaged over all 72. The two figures described different sets
   * of orders, and the three legs then failed to add up to the total printed
   * beside them - which reads as a broken dashboard, with no way for the reader
   * to tell it is really a cohort mismatch.
   *
   * Averaging the legs AND their total over the same rows makes the breakdown
   * reconcile with the headline by construction. Falls back to every delivered
   * order when nothing has a full split, so a store that has never recorded a
   * pickup still shows numbers instead of a page of dashes.
   */
  const measured = delivered.filter(
    (row) =>
      Number.isFinite(row.prepMs) &&
      Number.isFinite(row.waitMs) &&
      Number.isFinite(row.rideMs) &&
      Number.isFinite(row.totalMs),
  );
  const cohort = measured.length ? measured : delivered;

  return {
    delivered: delivered.length,
    open: inFlight.length,
    cancelled: rows.filter((row) => row.isCancelled).length,
    // Delivered, but the customer has not confirmed arrival. Published as a
    // top-level count (not just a summary field) because a store chasing
    // confirmations is the only thing that can move it.
    received: received.length,
    awaitingConfirm: awaitingConfirm.length,
    summary: {
      avgPrepMs: average(cohort.map((row) => row.prepMs)),
      avgWaitMs: average(cohort.map((row) => row.waitMs)),
      avgRideMs: average(cohort.map((row) => row.rideMs)),
      // The total the three legs are drawn against, so the breakdown and the
      // headline are always the same orders and always add up.
      avgLegsTotalMs: average(cohort.map((row) => row.totalMs)),
      // Every completed delivery, including those with no leg split. The honest
      // all-in average; `avgLegsTotalMs` is the comparable one.
      avgTotalMs: average(totals),
      // How many deliveries the leg breakdown covers, so the UI can say so
      // rather than implying the split describes all of them.
      measured: measured.length,
      bestMs: best,
      worstMs: worst,
      onTime: onTime.length,
      // A percentage rather than a ratio, rounded for the card readout.
      onTimePct: delivered.length ? Math.round((onTime.length / delivered.length) * 100) : null,

      /* The whole order, ending at the customer's confirmation.
       *
       * Averages over the CONFIRMED cohort only (`cycleSample` of them), which
       * is why `avgCycleMs` and `avgTotalMs` can differ by more than you would
       * expect: they are two different sets of orders, and `avgConfirmMs` is
       * exactly the gap. All three are null rather than zero when nobody has
       * confirmed - an em dash is honest, a zero is not. */
      avgCycleMs: average(cycles),
      // The customer's own lag, on the same cohort. This is the number that
      // explains every disagreement between "how fast is this rider" and "how
      // long did my order take".
      avgConfirmMs: average(confirms),
      bestCycleMs: bestCycle,
      worstCycleMs: worstCycle,
      // How many deliveries the cycle figures describe - so the UI can say so
      // instead of letting 3 confirmed orders masquerade as a store average.
      cycleSample: received.length,
    },
    // Newest first, finished deliveries before still-open ones.
    orders: [...delivered, ...inFlight].sort(
      (a, b) => new Date(b.placedAt || 0) - new Date(a.placedAt || 0),
    ),
  };
}

/**
 * Every status change on one order, in the order it happened, with how long the
 * order sat in the step *before* it.
 *
 * `orderTimings` answers "how long did the whole delivery take"; this answers
 * "walk me through it" - the tracker renders one row per update, so a customer
 * can see the order was confirmed at 14:02 and picked up at 14:19. `sinceMs` is
 * null on the first stamp (nothing came before it) and on any entry whose
 * timestamp is missing, rather than being reported as a misleading 0.
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
        // How long the PREVIOUS step lasted, i.e. the time this update ended.
        sinceMs:
          at && previous ? Math.max(0, at.getTime() - previous.getTime()) : null,
      };
    })
    .filter((step) => step.status && step.at);
}

/**
 * Rolls orders up per rider for the store-side analytics tab.
 *
 * The same `summariseTimings` maths the rider sees about themselves, so a
 * merchant and a rider reading the same delivery agree on the numbers. Orders
 * nobody has claimed are kept as their own "Awaiting a rider" row rather than
 * being dropped - a queue of unclaimed orders is something a store needs to see.
 */
export function summariseByRider(orders) {
  const groups = new Map();

  for (const order of orders || []) {
    const rider = order?.rider;
    const riderId = rider?._id || rider?.id || rider || null;
    const key = riderId ? String(riderId) : 'unassigned';

    if (!groups.has(key)) {
      groups.set(key, {
        riderId: riderId ? String(riderId) : null,
        name: rider?.name || (rider ? 'Rider' : 'Awaiting a rider'),
        username: rider?.username || '',
        orders: [],
      });
    }

    groups.get(key).orders.push(order);
  }

  return [...groups.values()]
    .map((group) => {
      const roll = summariseTimings(group.orders);

      return {
        riderId: group.riderId,
        name: group.name,
        username: group.username,
        delivered: roll.delivered,
        open: roll.open,
        cancelled: roll.cancelled,
        // Carried through so the per-rider table can say "2 of 5 never
        // confirmed" instead of showing an unexplained gap in the averages.
        received: roll.received,
        awaitingConfirm: roll.awaitingConfirm,
        summary: roll.summary,
      };
    })
    // Most deliveries first, then the quickest average among equals.
    .sort((a, b) => {
      if (b.delivered !== a.delivered) return b.delivered - a.delivered;

      const left = a.summary.avgTotalMs ?? Number.POSITIVE_INFINITY;
      const right = b.summary.avgTotalMs ?? Number.POSITIVE_INFINITY;

      return left - right;
    });
}

export default {
  orderTimings,
  inFlightTiming,
  summariseTimings,
  summariseByRider,
  statusSteps,
  DELIVERY_TARGET_MS,
};
