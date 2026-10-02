/**
 * Reset a store's order book and seed it with one realistic shift's worth of
 * hyper-local delivery orders.
 *
 *   npm --prefix backend run seed:orders                     # dry run (default)
 *   npm --prefix backend run seed:orders -- --apply          # wipe + write
 *   npm --prefix backend run seed:orders -- --apply --store joes-pizza
 *   npm --prefix backend run seed:orders -- --apply --count 80 --seed 7
 *
 * WHY IT IS DRY-RUN FIRST
 *
 * This DELETES order documents. `backfillImages.mjs` set the precedent in this
 * repo: a script that writes to somebody's database is dry-run unless it is
 * explicitly told `--apply`, because "I ran the script" should never be enough
 * to lose a day of real orders. The dry run prints the full plan, including the
 * exact number of rows it would delete, and touches nothing.
 *
 * SCOPE
 *
 *   --store <slug|id>   wipe and seed only that store. Falls back to the
 *                       STORE_ID / STORE_SLUG env vars, then to the first
 *                       store in the database.
 *   (no --store)        wipe EVERY order in the database and seed one store.
 *                       The dry run shouts about this specifically.
 *
 * The wipe is always scoped by the resolved store id, so "no --store" means
 * "seed the default store, delete only its orders" unless you also pass
 * --all-stores. Deleting a shared demo database's whole order book to
 * demonstrate a dashboard is almost never what somebody wants.
 *
 * WHAT "IDEMPOTENT" MEANS HERE
 *
 * Re-running always leaves the same SHAPE: same statuses, same proportions,
 * same relative timings, same synthetic catalogue. It does not leave the same
 * documents - ids are new every run and every timestamp is measured back from
 * "now", so a seeded board is always an order book for the moment you ran it,
 * not one frozen at 3am last Tuesday. That is what makes this usable for
 * testing a live dashboard. The RNG is seeded too (--seed), so the random
 * choices are reproducible when a test needs them to be.
 *
 * RELATIONSHIP TO THE APP
 *
 * Totals come from `priceOrder()` - the same function checkout uses - so a
 * seeded basket is priced exactly as a real one would be, including the free
 * delivery threshold. Nothing here invents its own arithmetic.
 */
import bcrypt from 'bcryptjs';
import { connectDB, disconnectDB } from '../src/config/db.js';
import Order from '../src/models/Order.js';
import Product from '../src/models/Product.js';
import Store from '../src/models/Store.js';
import StoreCustomer from '../src/models/StoreCustomer.js';
import StoreRider from '../src/models/StoreRider.js';
import User from '../src/models/User.js';
import { priceOrder } from '../src/utils/pricing.js';
import {
  DELIVERY_FAILED_REASONS,
  ORDER_STATUS,
  PAYMENT_METHODS,
  PAYMENT_STATUS,
  PAYMENT_PROVIDER,
  ROLES,
  STORE_RIDER_STATUS,
} from '../src/utils/constants.js';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--')
    ? argv[i + 1]
    : fallback;
};

const APPLY = flag('apply');
const ALL_STORES = flag('all-stores');
const COUNT = Math.max(1, Number.parseInt(value('count', '50'), 10) || 50);
const RNG_SEED = Number.parseInt(value('seed', '20261002'), 10) || 20261002;
const STORE_ARG = value('store', process.env.STORE_ID || process.env.STORE_SLUG || null);

const MIN = 60_000;
const now = () => Date.now();
const ago = (ms) => new Date(Date.now() - ms);

/**
 * A seeded PRNG (mulberry32) rather than Math.random().
 *
 * The same `--seed` therefore produces the same orders every run, which is the
 * difference between a test that can assert on a number and one that can only
 * shrug. Math.random() is fine for a demo but makes a flaky test unfixable,
 * because you cannot reproduce the run that failed.
 */
function makeRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let rnd = makeRandom(RNG_SEED);
const rand = () => rnd();
const between = (min, max) => min + rand() * (max - min);
const intBetween = (min, max) => Math.floor(between(min, max + 1));
const pick = (list) => list[Math.floor(rand() * list.length)];
const round2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;


// ---------------------------------------------------------------------------
// The shape of a shift
// ---------------------------------------------------------------------------

/**
 * The five buckets the dispatch board draws, with the counts the brief asks
 * for. `min`/`max` are the per-bucket contract; `allocate()` spreads the
 * remainder so the totals always land on exactly `count`.
 */
const STAGES = [
  { key: 'new', min: 5, max: 8, label: 'New orders (pending/confirmed)' },
  { key: 'packing', min: 5, max: 8, label: 'In packing (preparing/ready)' },
  { key: 'out', min: 6, max: 10, label: 'Out for delivery' },
  { key: 'completed', min: 25, max: 30, label: 'Completed today' },
  { key: 'exceptions', min: 2, max: 3, label: 'Delivery exceptions' },
];

/**
 * Spread `count` across the buckets, staying inside every bucket's range.
 *
 * Greedy headroom fill in declaration order: each bucket starts at its minimum
 * and grows by one until the count is used up. Deterministic, never out of
 * range while a legal split exists, and the leftovers land on `completed` -
 * the only bucket with headroom enough to absorb a `--count 80`.
 */
function allocate(count) {
  const floor = STAGES.reduce((s, stage) => s + stage.min, 0);
  const ceiling = STAGES.reduce((s, stage) => s + stage.max, 0);

  if (count < floor || count > ceiling) {
    console.warn(
      `[seed] --count ${count} is outside the ${floor}-${ceiling} range these ` +
        `buckets support; the split will be clamped and may not total ${count}.`,
    );
  }

  const out = {};
  let left = Math.max(0, Math.min(ceiling, count) - floor);
  for (const stage of STAGES) out[stage.key] = stage.min;

  while (left > 0) {
    for (const stage of STAGES) {
      if (left === 0) break;
      if (out[stage.key] < stage.max) {
        out[stage.key] += 1;
        left -= 1;
      }
    }
    // Every bucket is at its ceiling but orders are still owed: bail rather
    // than spin forever.
    if (!STAGES.some((s) => out[s.key] < s.max)) break;
  }

  return out;
}

// --- Leg durations ---------------------------------------------------------

// The three legs, in minutes. Prep is the store's half, wait is a rider idling
// at a counter, ride is pickup-to-doorstep. 20-47 minutes end to end, which
// straddles the 35-minute target the dispatch board is designed around, so the
// SLA card has both on-time and late orders to show rather than a clean sweep.
const PREP_MIN = 8;
const PREP_MAX = 18;
const WAIT_MIN = 2;
const WAIT_MAX = 7;
const RIDE_MIN = 10;
const RIDE_MAX = 22;

// --- Hyper-local data pools ------------------------------------------------

// Bashundhara R/A, Dhaka. A gated residential area: blocks, a gate, and a
// house number - which is exactly why gate_access_denied is the most common
// delivery failure here and barely registers in a normal city courier.
const AREA = {
  city: 'Dhaka',
  blocks: ['Block A', 'Block B', 'Block C', 'Block D', 'Block E', 'Block F', 'Block G'],
  roads: ['Road 11', 'Road 13', 'Road 17', 'Road 19', 'Road 21', 'Road 25'],
  lat: 27.7236,
  lng: 90.428,
};

const GUEST_NAMES = [
  'Farhana Islam', 'Rakib Chowdhury', 'Nusrat Jahan', 'Tanvir Ahmed', 'Sabina Yasmin',
  'Imran Kabir', 'Sharmeen Akter', 'Rifat Hasan', 'Tahmina Begum', 'Sajid Hossain',
  'Mehedi Hasan', 'Sadia Afrin', 'Arif Hossain', 'Nabila Rahman', 'Jashim Uddin',
  'Rupa Khatun', 'Mizanur Rahman', 'Tania Sultana', 'Shafiq Alam', 'Rina Parvin',
];

const FAILURE_NOTES = {
  gate_access_denied:
    'Gate closed, nobody answered the intercom. Parcel brought back to the counter.',
  customer_unreachable:
    'Called three times, no answer. Neighbours said the customer is at the office.',
  cod_refused:
    'Customer refused the cash at the door and asked to cancel the order.',
  address_issue:
    'House number missing from the gate plaque; nobody could point the rider to it.',
};

const KITCHEN_NOTE = 'Kitchen update by an admin';

const PREPAID_METHODS = PAYMENT_METHODS.filter((m) => m !== 'cod');


// ---------------------------------------------------------------------------
// Building one order
// ---------------------------------------------------------------------------

let nextTxn = 0;

/**
 * A grocery basket.
 *
 * Prefers the store's REAL products, so a seeded order links to something that
 * actually exists and clicking through from the board lands on a real product
 * page. Falls back to a synthetic grocery catalogue only when the store has no
 * products yet, because a dashboard with nothing to click is a worse demo.
 *
 * Prices are nudged off the catalogue price rather than copied, so the basket
 * lands somewhere natural in the 150-2500 range instead of every order being an
 * exact multiple of one product's price.
 */
function buildItems(catalogue, targetSubtotal) {
  const wanted = intBetween(1, 6);
  const lines = [];
  const used = new Set();

  for (let i = 0; i < wanted; i += 1) {
    let product = null;
    for (let attempt = 0; attempt < 6 && !product; attempt += 1) {
      const candidate = pick(catalogue);
      if (candidate && !used.has(candidate.key)) product = candidate;
    }
    if (!product) break;

    used.add(product.key);
    lines.push({
      product: product.id,
      variant: null,
      variantTitle: '',
      compareAtPrice: null,
      sku: product.sku || '',
      // Copied in, exactly as checkout copies it: an order is a historical
      // receipt and must not change when the product is edited later.
      name: product.name,
      price: Math.max(10, product.price),
      quantity: intBetween(1, 3),
    });
  }

  if (!lines.length) return lines;

  /* Scale the whole basket towards the target so the store's day lands in a
   * believable range instead of depending on whatever one product happens to
   * cost. Order lines store a COPIED price, so a seeded line being a few taka
   * off the live catalogue is exactly what price drift looks like - and
   * `priceOrder()` below still derives subtotal/fee/total from these lines, so
   * the money adds up the way checkout's does. */
  const running = lines.reduce((s, l) => s + l.price * l.quantity, 0);
  if (running > 0 && targetSubtotal) {
    const factor = targetSubtotal / running;
    for (const line of lines) {
      line.price = Math.max(5, Math.round((line.price * factor) / 5) * 5);
    }
  }

  return lines;
}

/** A Bashundhara R/A address, plus a matching map pin. */
function buildAddress() {
  const block = pick(AREA.blocks);
  const house = intBetween(2, 90);
  return {
    label: 'Home',
    line1: `House ${house}, ${block}, ${pick(AREA.roads)}`,
    city: AREA.city,
    phone: `+8801${intBetween(300000000, 999999999)}`,
    notes: '',
    // ~1km scatter, which is about the real spread of one R/A block.
    location: {
      lat: round2(AREA.lat + between(-0.009, 0.009)),
      lng: round2(AREA.lng + between(-0.009, 0.009)),
    },
  };
}

/**
 * Payment, roughly 60/40 cash-on-delivery to prepaid.
 *
 * The split is not cosmetic: it is the number the store reconciles at the end
 * of the day, and a rider carrying cash is a rider who has to be trusted. The
 * seeded board therefore has a genuine COD outstanding balance rather than
 * 100% prepaid rows that make reconciliation look free.
 */
function buildPayment(cod) {
  if (cod) {
    return {
      paymentMethod: 'cod',
      payment: {
        provider: PAYMENT_PROVIDER.COD,
        status: PAYMENT_STATUS.PENDING,
        amount: 0, // the caller fills this in once the total is known
        transactionId: null,
      },
    };
  }

  return {
    paymentMethod: pick(PREPAID_METHODS),
    payment: {
      provider: PAYMENT_PROVIDER.SSLCOMMERZ,
      status: PAYMENT_STATUS.PAID,
      amount: 0,
      // MUST be unique. The Order schema carries a unique partial index on
      // `payment.transactionId` for string values, precisely so two checkouts
      // can never claim the same gateway transaction. A shared constant here
      // would fail the second insert with a duplicate-key error.
      transactionId: `txn_seed_${RNG_SEED}_${nextTxn++}`,
      val_id: null,
    },
  };
}

/** A status-history entry, matching the shape `applyStatus()` writes. */
const step = (status, at, by, note = '') => ({ status, note, at: new Date(at), by });


// ---------------------------------------------------------------------------
// The five builders
// ---------------------------------------------------------------------------

/**
 * Everything a row needs before its status-specific history is appended.
 *
 * Half the orders belong to a real signed-in shopper and half are guest
 * checkouts, which is the realistic split for a neighbourhood grocer and has a
 * side benefit: the board's Customer column exercises both the
 * `order.customer.name` path and the `guest` fallback, instead of only the one
 * branch that happens to be populated in the demo database.
 */
function buildBase({ store, catalogue, customers }) {
  const address = buildAddress();
  const cod = rand() < 0.6;
  const items = buildItems(catalogue, intBetween(150, 2500));
  const { subtotal, deliveryFee, total } = priceOrder(items);

  const pay = buildPayment(cod);
  pay.payment.amount = total;

  const asGuest = customers.length === 0 || rand() < 0.5;
  const customer = asGuest ? null : pick(customers);

  return {
    store: store._id,
    customer: customer?._id || null,
    guest: customer
      ? { name: '', email: '', phone: '' }
      : { name: pick(GUEST_NAMES), email: '', phone: address.phone },
    items,
    subtotal,
    deliveryFee,
    total,
    address: {
      label: address.label,
      line1: address.line1,
      city: address.city,
      phone: address.phone,
      notes: address.notes,
    },
    location: address.location,
    paymentMethod: pay.paymentMethod,
    payment: pay.payment,
    // Written explicitly rather than left to Mongoose: a seeded order has to
    // be "placed" at the right wall-clock time, or every elapsed-time figure on
    // the dispatch board is wrong.
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/** New: sitting in the pool, 0-10 min old, nobody has claimed it. */
function buildNew(ctx) {
  const base = buildBase(ctx);
  const placedAt = now() - between(0, 10 * MIN);
  const confirmed = rand() < 0.6;
  const history = [step(ORDER_STATUS.PENDING, placedAt, null, 'Order placed')];

  if (confirmed) {
    history.push(
      step(
        ORDER_STATUS.CONFIRMED,
        placedAt + between(0.4, 1.6) * MIN,
        ctx.ownerId,
        'Accepted by the store',
      ),
    );
  }

  return {
    ...base,
    createdAt: new Date(placedAt),
    updatedAt: new Date(history[history.length - 1].at),
    rider: null,
    status: confirmed ? ORDER_STATUS.CONFIRMED : ORDER_STATUS.PENDING,
    statusHistory: history,
    deliveredAt: null,
    failedReason: null,
    failedAt: null,
    retryCount: 0,
  };
}

/** Packing: with the store, 10-20 min old, waiting for a rider to collect. */
function buildPacking(ctx) {
  const base = buildBase(ctx);
  const placedAt = now() - between(10, 20) * MIN;
  const prepMs = between(PREP_MIN, PREP_MAX) * MIN;
  const confirmedAt = placedAt + between(0.5, 1.5) * MIN;
  const preparingAt = confirmedAt + prepMs * between(0.35, 0.7);
  const ready = rand() < 0.5;

  const history = [
    step(ORDER_STATUS.PENDING, placedAt, null, 'Order placed'),
    step(ORDER_STATUS.CONFIRMED, confirmedAt, ctx.ownerId, 'Accepted by the store'),
    step(ORDER_STATUS.PREPARING, preparingAt, ctx.ownerId, KITCHEN_NOTE),
  ];

  if (ready) {
    history.push(
      step(
        ORDER_STATUS.READY_FOR_PICKUP,
        placedAt + prepMs,
        ctx.ownerId,
        'Packed and waiting at the counter',
      ),
    );
  }

  return {
    ...base,
    createdAt: new Date(placedAt),
    updatedAt: new Date(history[history.length - 1].at),
    // Still no rider: `ready_for_pickup` means exactly "packed, not collected",
    // so claiming one here would contradict the status.
    rider: null,
    status: ready ? ORDER_STATUS.READY_FOR_PICKUP : ORDER_STATUS.PREPARING,
    statusHistory: history,
    deliveredAt: null,
    failedReason: null,
    failedAt: null,
    retryCount: 0,
  };
}

/** On the road: assigned, collected, part-way to the door. */
function buildOutForDelivery(ctx) {
  const base = buildBase(ctx);
  const rider = pick(ctx.riders);
  const prepMs = between(PREP_MIN, PREP_MAX) * MIN;
  const waitMs = between(WAIT_MIN, WAIT_MAX) * MIN;
  const rideMs = between(RIDE_MIN, RIDE_MAX) * MIN;

  // Back-date the order so that "now" falls part-way through the ride.
  const elapsedRide = between(0.2, 0.8) * rideMs;
  const placedAt = now() - (prepMs + waitMs + elapsedRide);

  const confirmedAt = placedAt + between(0.5, 1.5) * MIN;
  const readyAt = placedAt + prepMs;
  const pickedUpAt = readyAt + waitMs;
  const outAt = pickedUpAt + elapsedRide * 0.4;
  const onRoad = rand() < 0.7;

  const history = [
    step(ORDER_STATUS.PENDING, placedAt, null, 'Order placed'),
    step(ORDER_STATUS.CONFIRMED, confirmedAt, ctx.ownerId, 'Accepted by the store'),
    step(ORDER_STATUS.PREPARING, placedAt + prepMs * 0.5, ctx.ownerId, KITCHEN_NOTE),
    step(
      ORDER_STATUS.READY_FOR_PICKUP,
      readyAt,
      ctx.ownerId,
      'Packed and waiting at the counter',
    ),
    step(ORDER_STATUS.PICKED_UP, pickedUpAt, rider._id, 'Collected from the store'),
  ];
  if (onRoad) {
    history.push(
      step(ORDER_STATUS.OUT_FOR_DELIVERY, outAt, rider._id, 'On the way to the customer'),
    );
  }

  return {
    ...base,
    createdAt: new Date(placedAt),
    updatedAt: new Date(history[history.length - 1].at),
    rider: rider._id,
    status: onRoad ? ORDER_STATUS.OUT_FOR_DELIVERY : ORDER_STATUS.PICKED_UP,
    statusHistory: history,
    // A rider mid-delivery reports a position; the map marker follows this.
    riderLocation: {
      lat: round2(AREA.lat + between(-0.012, 0.012)),
      lng: round2(AREA.lng + between(-0.012, 0.012)),
    },
    deliveredAt: null,
    failedReason: null,
    failedAt: null,
    retryCount: 0,
  };
}

/** Done: a full timeline ending in delivery, most of them confirmed. */
function buildCompleted(ctx) {
  const base = buildBase(ctx);
  const rider = pick(ctx.riders);
  const prepMs = between(PREP_MIN, PREP_MAX) * MIN;
  const waitMs = between(WAIT_MIN, WAIT_MAX) * MIN;
  const rideMs = between(RIDE_MIN, RIDE_MAX) * MIN;

  // Spread completions across the shift so "completed today" is a curve, not a
  // spike: the oldest finished hours ago, the newest a couple of minutes ago.
  const deliveredAt = now() - between(2, 300) * MIN;
  const placedAt = deliveredAt - (prepMs + waitMs + rideMs);

  const confirmedAt = placedAt + between(0.5, 1.5) * MIN;
  const readyAt = placedAt + prepMs;
  const pickedUpAt = readyAt + waitMs;
  const outAt = pickedUpAt + rideMs * 0.35;
  const received = rand() < 0.8;

  const history = [
    step(ORDER_STATUS.PENDING, placedAt, null, 'Order placed'),
    step(ORDER_STATUS.CONFIRMED, confirmedAt, ctx.ownerId, 'Accepted by the store'),
    step(ORDER_STATUS.PREPARING, placedAt + prepMs * 0.5, ctx.ownerId, KITCHEN_NOTE),
    step(
      ORDER_STATUS.READY_FOR_PICKUP,
      readyAt,
      ctx.ownerId,
      'Packed and waiting at the counter',
    ),
    step(ORDER_STATUS.PICKED_UP, pickedUpAt, rider._id, 'Collected from the store'),
    step(ORDER_STATUS.OUT_FOR_DELIVERY, outAt, rider._id, 'On the way to the customer'),
    step(ORDER_STATUS.DELIVERED, deliveredAt, rider._id, 'Handed to the customer'),
  ];
  if (received) {
    /* How long before the customer taps "it arrived". Q-commerce shoppers
     * confirm within minutes, so this is kept short on purpose: a seeded
     * board whose confirm lag averaged an hour would make the new cycle
     * metric look broken next to the 45-minute delivery SLA, and the honest
     * fix for that is realistic data, not a flattering denominator. */
    history.push(
      step(
        ORDER_STATUS.RECEIVED,
        deliveredAt + between(1, 35) * MIN,
        base.customer || null,
        'Customer confirmed the delivery',
      ),
    );
  }

  // COD is settled by the rider in person, so a delivered cash order IS paid.
  // Leaving it `Pending` on completed orders is the most common way a seeded
  // dataset makes a reconciliation card look broken.
  if (base.paymentMethod === 'cod') {
    base.payment.status = PAYMENT_STATUS.PAID;
  }

  return {
    ...base,
    createdAt: new Date(placedAt),
    updatedAt: new Date(history[history.length - 1].at),
    rider: rider._id,
    status: received ? ORDER_STATUS.RECEIVED : ORDER_STATUS.DELIVERED,
    statusHistory: history,
    riderLocation: { ...base.location },
    // Stamped AND indexed: this is what "completed today" ranges over. The
    // value is the same instant as the `delivered` history entry, so the
    // denormalised field can never drift from the audit trail it mirrors.
    deliveredAt: new Date(deliveredAt),
    failedReason: null,
    failedAt: null,
    retryCount: 0,
  };
}

/** Exceptions: a full timeline that reaches the door and goes wrong. */
function buildException(ctx) {
  const base = buildBase(ctx);
  const rider = pick(ctx.riders);
  const prepMs = between(PREP_MIN, PREP_MAX) * MIN;
  const waitMs = between(WAIT_MIN, WAIT_MAX) * MIN;
  const rideMs = between(RIDE_MIN, RIDE_MAX) * MIN;

  const failedAt = now() - between(5, 120) * MIN;
  const placedAt = failedAt - (prepMs + waitMs + rideMs);

  // A gate refusal is the signature hyper-local failure, so it is weighted up
  // rather than sampled flat - a board where the rare reasons appear evenly
  // tells you nothing about which one is actually eating the evening.
  const reason =
    rand() < 0.5
      ? DELIVERY_FAILED_REASONS.GATE_ACCESS_DENIED
      : pick([
          DELIVERY_FAILED_REASONS.GATE_ACCESS_DENIED,
          DELIVERY_FAILED_REASONS.CUSTOMER_UNREACHABLE,
          DELIVERY_FAILED_REASONS.COD_REFUSED,
          DELIVERY_FAILED_REASONS.ADDRESS_ISSUE,
        ]);

  const confirmedAt = placedAt + between(0.5, 1.5) * MIN;
  const readyAt = placedAt + prepMs;
  const pickedUpAt = readyAt + waitMs;
  const outAt = pickedUpAt + rideMs * 0.35;

  const history = [
    step(ORDER_STATUS.PENDING, placedAt, null, 'Order placed'),
    step(ORDER_STATUS.CONFIRMED, confirmedAt, ctx.ownerId, 'Accepted by the store'),
    step(ORDER_STATUS.PREPARING, placedAt + prepMs * 0.5, ctx.ownerId, KITCHEN_NOTE),
    step(
      ORDER_STATUS.READY_FOR_PICKUP,
      readyAt,
      ctx.ownerId,
      'Packed and waiting at the counter',
    ),
    step(ORDER_STATUS.PICKED_UP, pickedUpAt, rider._id, 'Collected from the store'),
    step(ORDER_STATUS.OUT_FOR_DELIVERY, outAt, rider._id, 'On the way to the customer'),
    step(ORDER_STATUS.DELIVERY_FAILED, failedAt, rider._id, FAILURE_NOTES[reason]),
  ];

  // The parcel came BACK. A COD order that failed is money the rider is still
  // physically holding, so it stays `Pending` - that uncollected cash is the
  // whole reason the exceptions card earns its place on a dispatch board.
  return {
    ...base,
    createdAt: new Date(placedAt),
    updatedAt: new Date(failedAt),
    rider: rider._id,
    status: ORDER_STATUS.DELIVERY_FAILED,
    statusHistory: history,
    riderLocation: { ...base.location },
    deliveredAt: null,
    failedReason: reason,
    failedAt: new Date(failedAt),
    retryCount: intBetween(0, 2),
  };
}

const BUILDERS = {
  new: buildNew,
  packing: buildPacking,
  out: buildOutForDelivery,
  completed: buildCompleted,
  exceptions: buildException,
};


// ---------------------------------------------------------------------------
// Resolving the store's people, catalogue and customers
// ---------------------------------------------------------------------------

async function resolveStore() {
  if (STORE_ARG) {
    const byId = /^[a-f\d]{24}$/i.test(STORE_ARG)
      ? await Store.findById(STORE_ARG).lean()
      : null;
    const store = byId || (await Store.findOne({ slug: STORE_ARG }).lean());
    if (!store) throw new Error(`No store matches "${STORE_ARG}".`);
    return store;
  }

  const first = await Store.findOne({}).sort({ createdAt: 1 }).lean();
  if (!first) {
    throw new Error('There are no stores in the database. Run the seeder first.');
  }
  return first;
}

/**
 * Riders to put on the road.
 *
 * Prefers riders ACTUALLY bound to this store, because an order assigned to a
 * rider who is not on the store's roster would not appear in that rider's pool
 * - the dashboard would look right and the rider app would not agree. Falls
 * back to any rider account, and only then to creating seed riders: a dispatch
 * board with nobody on it cannot be tested at all.
 */
async function resolveRiders(store) {
  const linked = await StoreRider.find({
    store: store._id,
    status: STORE_RIDER_STATUS.ACTIVE,
    role: 'rider',
  })
    .populate('rider', 'name username email isAvailable')
    .lean();

  const bound = linked.map((l) => l.rider).filter((r) => r && r._id);
  if (bound.length) return bound;

  const anyRiders = await User.find({ role: ROLES.RIDER }).limit(6).lean();
  if (anyRiders.length) {
    console.warn(
      '[seed] no riders are bound to this store - falling back to any rider ' +
        'account in the database.',
    );
    return anyRiders;
  }

  console.warn('[seed] no rider accounts exist - creating 4 seed riders.');
  const made = [];
  for (let i = 1; i <= 4; i += 1) {
    const user = await User.create({
      name: `Seed Rider ${i}`,
      email: `seed.rider${i}@example.com`,
      username: `seed.rider${i}`,
      phone: `+880101${String(1000000 + i * 1111)}`,
      // Same demo password as the seeded accounts, so they can be logged into.
      passwordHash: await bcrypt.hash('password123', 10),
      role: ROLES.RIDER,
      isAvailable: true,
    });
    made.push(user.toObject());
  }
  return made;
}

/**
 * The catalogue the baskets are built from. Real products when the store has
 * any, so an order links somewhere; a small synthetic grocery list otherwise,
 * because a board of zero-item orders is not a testable dashboard.
 */
async function resolveCatalogue(store) {
  const products = await Product.find({ store: store._id })
    .select('name price sku')
    .limit(80)
    .lean();

  if (products.length) return products.map((p) => ({ ...p, key: String(p._id) }));

  console.warn(
    '[seed] this store has no products - using a synthetic grocery catalogue. ' +
      'Orders will not link to product pages.',
  );

  const shelf = [
    ['Rice 5kg', 420], ['Minced Beef 1kg', 780], ['Chicken Broiler 1.5kg', 340],
    ['Soybean Oil 5L', 1250], ['Onion 1kg', 65], ['Potato 1kg', 38],
    ['Eggs (dozen)', 145], ['Milk 1L', 95], ['Tea 400g', 260],
    ['Sugar 1kg', 140], ['Lentils 1kg', 135], ['Rui Fish 1kg', 480],
    ['Potato Crackers', 60], ['Cola 1.5L', 85], ['Toilet Cleaner 500ml', 175],
    ['Shampoo 400ml', 320], ['Detergent 1kg', 240], ['Biscuits (pack)', 110],
    ['Yogurt 500g', 120], ['Frozen Peas 1kg', 165],
  ];
  return shelf.map(([name, price], i) => ({
    _id: null,
    name,
    price,
    sku: `SEED-${i + 1}`,
    key: `synthetic-${i + 1}`,
  }));
}

async function resolveCustomers(store) {
  const links = await StoreCustomer.find({ store: store._id })
    .populate('customer', 'name email phone')
    .lean();
  return links.map((l) => l.customer).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const taka = (n) => `৳${Math.round(Number(n) || 0).toLocaleString('en-US')}`;
const mins = (ms) => (ms == null ? '—' : `${Math.round(ms / MIN)} min`);

function report(docs, riders) {
  const byStatus = new Map();
  for (const d of docs) byStatus.set(d.status, (byStatus.get(d.status) || 0) + 1);

  const order = [
    ORDER_STATUS.PENDING,
    ORDER_STATUS.CONFIRMED,
    ORDER_STATUS.PREPARING,
    ORDER_STATUS.READY_FOR_PICKUP,
    ORDER_STATUS.PICKED_UP,
    ORDER_STATUS.OUT_FOR_DELIVERY,
    ORDER_STATUS.DELIVERED,
    ORDER_STATUS.RECEIVED,
    ORDER_STATUS.DELIVERY_FAILED,
  ];

  console.log('\n  pipeline');
  for (const status of order) {
    const n = byStatus.get(status) || 0;
    if (n) console.log(`    ${status.padEnd(18)} ${String(n).padStart(3)}`);
  }

  const totals = docs.reduce(
    (a, d) => {
      a.value += d.total;
      if (d.paymentMethod === 'cod') {
        a.cod += d.total;
        if (d.payment.status === PAYMENT_STATUS.PAID) a.collected += d.total;
      } else {
        a.prepaid += d.total;
      }
      return a;
    },
    { value: 0, cod: 0, collected: 0, prepaid: 0 },
  );
  const codOrders = docs.filter((d) => d.paymentMethod === 'cod').length;
  const codPct = docs.length ? Math.round((codOrders / docs.length) * 100) : 0;
  const settled = totals.value
    ? Math.round((totals.collected / totals.value) * 100)
    : 0;

  console.log('\n  money');
  console.log(`    basket value      ${taka(totals.value)} across ${docs.length} orders`);
  console.log(`    COD               ${taka(totals.cod)} (${codPct}% of orders, ${codOrders})`);
  console.log(`    prepaid           ${taka(totals.prepaid)}`);
  console.log(`    COD collected     ${taka(totals.collected)}  (${settled}% reconciled)`);

  // The elapsed figures a dispatch board's SLA card will read, computed the
  // same way deliveryTiming.js does so this preview cannot disagree with it.
  const arrived = docs.filter((d) => d.deliveredAt);
  const cycles = docs.filter((d) => d.receivedAt || d.statusHistory.some((h) => h.status === 'received'));
  if (arrived.length) {
    const avg = arrived.reduce(
      (s, d) => s + (new Date(d.deliveredAt).getTime() - new Date(d.createdAt).getTime()),
      0,
    ) / arrived.length;
    console.log('\n  fulfilment');
    console.log(`    avg order-to-door ${mins(avg)} over ${arrived.length} completed`);

    if (cycles.length) {
      const avgCycle = cycles.reduce((s, d) => {
        const received = d.statusHistory.find((h) => h.status === 'received');
        return s + (new Date(received.at).getTime() - new Date(d.createdAt).getTime());
      }, 0) / cycles.length;
      const avgConfirm = cycles.reduce((s, d) => {
        const delivered = d.statusHistory.find((h) => h.status === 'delivered');
        const received = d.statusHistory.find((h) => h.status === 'received');
        return s + (new Date(received.at).getTime() - new Date(delivered.at).getTime());
      }, 0) / cycles.length;
      console.log(`    avg order-to-confirm ${mins(avgCycle)} over ${cycles.length} confirmed`);
      console.log(`    avg customer confirm lag ${mins(avgConfirm)}`);
    }
  }

  const failed = docs.filter((d) => d.status === ORDER_STATUS.DELIVERY_FAILED);
  if (failed.length) {
    const reasons = new Map();
    for (const f of failed) {
      reasons.set(f.failedReason, (reasons.get(f.failedReason) || 0) + 1);
    }
    console.log('\n  exceptions');
    for (const [reason, n] of reasons) {
      console.log(`    ${String(reason).padEnd(22)} ${n}`);
    }
  }

  const terminal = [
    ORDER_STATUS.DELIVERED,
    ORDER_STATUS.RECEIVED,
    ORDER_STATUS.DELIVERY_FAILED,
  ];
  const unassigned = docs.filter(
    (d) => d.rider == null && !terminal.includes(d.status),
  ).length;

  console.log('\n  people');
  // Filter null out BEFORE building the set: String(null) is the literal "null",
  // so counting the unassigned orders as a sixth rider is how a board with 2
  // riders ends up reporting 3.
  const carrying = new Set(docs.filter((d) => d.rider).map((d) => String(d.rider))).size;
  console.log(`    riders carrying   ${carrying} of ${riders.length} available`);
  console.log(`    unassigned orders ${unassigned}`);
  console.log(`    guest checkouts   ${docs.filter((d) => !d.customer).length}`);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  await connectDB();

  const store = await resolveStore();
  const riders = await resolveRiders(store);
  const catalogue = await resolveCatalogue(store);
  const customers = await resolveCustomers(store);

  if (!riders.length) throw new Error('No riders available; cannot seed deliveries.');

  console.log(`\n[seed] store    ${store.name} (${store.slug})`);
  console.log(`[seed] riders   ${riders.length}`);
  console.log(`[seed] items    ${catalogue.length} product(s) in the catalogue`);
  console.log(`[seed] rng      seed=${RNG_SEED}`);

  const plan = allocate(COUNT);
  console.log('\n  plan');
  for (const stage of STAGES) {
    console.log(`    ${stage.label.padEnd(34)} ${plan[stage.key]}`);
  }
  console.log(
    `    ${'TOTAL'.padEnd(34)} ${STAGES.reduce((s, k) => s + plan[k.key], 0)}`,
  );

  // Build everything in memory FIRST, so a failure here cannot leave the store
  // with half its order book deleted and nothing put back.
  const ctx = { store, catalogue, customers, riders, ownerId: store.owner || null };
  const docs = [];
  for (const stage of STAGES) {
    for (let i = 0; i < plan[stage.key]; i += 1) {
      docs.push(BUILDERS[stage.key](ctx));
    }
  }

  // Validate against the real schema BEFORE deleting anything. A typo in a
  // status or a missing required field is a five-second failure here, and a
  // half-wiped store if it is left to insertMany.
  const invalid = [];
  for (const doc of docs) {
    const err = new Order(doc).validateSync();
    if (err) invalid.push(`${err.path}: ${err.message}`);
  }
  if (invalid.length) {
    console.error(
      `\n[seed] ${invalid.length} generated order(s) failed schema validation:`,
    );
    for (const msg of invalid.slice(0, 5)) console.error(`  - ${msg}`);
    throw new Error('Refusing to wipe anything: the generated data is invalid.');
  }
  console.log(`\n[seed] ${docs.length} order(s) validated against the Order schema`);

  const scope = ALL_STORES ? {} : { store: store._id };
  const existing = await Order.countDocuments(scope);
  console.log(
    `[seed] wipe     ${existing} existing order(s) ` +
      `${ALL_STORES ? 'IN THE WHOLE DATABASE' : `for "${store.slug}"`}`,
  );

  if (!APPLY) {
    report(docs, riders);
    console.log('\n[seed] DRY RUN - nothing was written.');
    console.log('[seed] re-run with --apply to wipe and seed.');
    return 0;
  }

  const { deletedCount } = await Order.deleteMany(scope);
  console.log(`[seed] deleted  ${deletedCount} order(s)`);

  // `ordered: true` on purpose: a duplicate transactionId must stop the insert
  // rather than half-succeed, because the unique partial index exists precisely
  // to stop two orders claiming one payment.
  const inserted = await Order.insertMany(docs, { ordered: true });
  console.log(`[seed] inserted ${inserted.length} order(s)`);

  report(inserted, riders);
  console.log('\n[seed] done.');
  console.log(
    '[seed] the storefront cache is per-process, so a running API server keeps ' +
      'its own copy - restart it (or hard-refresh the board) to see this data.',
  );
  return 0;
}

main()
  .then(async (code) => {
    await disconnectDB();
    process.exit(code);
  })
  .catch(async (err) => {
    console.error(`\n[seed] failed: ${err.message}`);
    try {
      await disconnectDB();
    } catch {
      /* never opened, or already closed */
    }
    process.exit(1);
  });
