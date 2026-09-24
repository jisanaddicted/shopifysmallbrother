/**
 * Backfills the store <-> customer links for accounts that predate the
 * feature.
 *
 *   npm --prefix backend run backfill:customers          (writes changes)
 *   npm --prefix backend run backfill:customers -- --dry   (report only)
 *
 * Shoppers who signed up before store-scoped accounts existed have no
 * StoreCustomer row. Their order history already proves which store(s) they
 * bought from, so every (store, customer) pair found in `orders` becomes a
 * link with source `order`. Nothing is ever deleted or overwritten: an existing
 * link keeps its original source and a blocked customer stays blocked.
 */
import { connectDB, disconnectDB } from '../src/config/db.js';
import Order from '../src/models/Order.js';
import Store from '../src/models/Store.js';
import User from '../src/models/User.js';
import StoreCustomer from '../src/models/StoreCustomer.js';
import { ROLES, STORE_CUSTOMER_SOURCE, STORE_CUSTOMER_STATUS } from '../src/utils/constants.js';

const DRY_RUN = process.argv.includes('--dry');

async function main() {
  await connectDB();

  // One row per (store, customer) pair that has at least one order.
  const pairs = await Order.aggregate([
    { $match: { customer: { $ne: null }, store: { $ne: null } } },
    {
      $group: {
        _id: { store: '$store', customer: '$customer' },
        lastOrderAt: { $max: '$createdAt' },
      },
    },
  ]);

  console.log(`[backfill] ${pairs.length} store/customer pair(s) found in orders`);

  let linked = 0;
  let skipped = 0;
  let notCustomer = 0;

  for (const pair of pairs) {
    const { store: storeId, customer: customerId } = pair._id;

    // Both sides must still exist, and only shopper accounts get a link.
    // eslint-disable-next-line no-await-in-loop
    const [store, user] = await Promise.all([
      Store.findById(storeId).select('name slug'),
      User.findById(customerId).select('name email role'),
    ]);

    if (!store || !user) {
      skipped += 1;
      continue;
    }

    if (user.role !== ROLES.CUSTOMER) {
      // A merchant or rider who placed an order is not a customer of it.
      notCustomer += 1;
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const existing = await StoreCustomer.findOne({
      store: store._id,
      customer: user._id,
    });

    if (existing) {
      skipped += 1;
      continue;
    }

    if (DRY_RUN) {
      console.log(
        `[backfill] would link ${user.email} -> ${store.slug} (${store.name})`,
      );
      linked += 1;
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    await StoreCustomer.create({
      store: store._id,
      customer: user._id,
      status: STORE_CUSTOMER_STATUS.ACTIVE,
      source: STORE_CUSTOMER_SOURCE.ORDER,
      lastSeenAt: pair.lastOrderAt || new Date(),
    });

    console.log(`[backfill] linked ${user.email} -> ${store.slug}`);
    linked += 1;
  }

  console.log(
    `[backfill] ${DRY_RUN ? 'would link' : 'linked'} ${linked}, ` +
      `already linked ${skipped}, staff accounts ignored ${notCustomer}`,
  );

  const total = await StoreCustomer.countDocuments();
  console.log(`[backfill] StoreCustomer rows now: ${total}`);

  await disconnectDB();
}

main().catch(async (error) => {
  console.error('[backfill] failed:', error.message);
  await disconnectDB().catch(() => {});
  process.exit(1);
});
