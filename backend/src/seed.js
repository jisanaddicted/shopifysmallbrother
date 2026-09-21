import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Product from './models/Product.js';
import Store from './models/Store.js';
import StoreRider from './models/StoreRider.js';
import User from './models/User.js';
import { ROLES, STORE_MEMBER_ROLES, STORE_RIDER_STATUS } from './utils/constants.js';

/**
 * The accounts behind the "Demo accounts" chips on the login page.
 * Keep the emails/passwords in sync with client/src/pages/auth/Login.jsx.
 */
export const DEMO_PASSWORD = 'password123';

export const DEMO_USERS = [
  {
    name: 'Demo Customer',
    email: 'customer@example.com',
    phone: '+1 555 010 0100',
    role: ROLES.CUSTOMER,
  },
  {
    name: 'Sam Rider',
    email: 'rider@example.com',
    // Riders are found by this handle when a store invites them.
    username: 'sam.rider',
    phone: '+1 555 010 0200',
    role: ROLES.RIDER,
  },
  {
    name: 'Ada Admin',
    email: 'admin@example.com',
    username: 'ada.admin',
    phone: '+1 555 010 0300',
    role: ROLES.ADMIN,
  },
  {
    name: 'Joe Merchant',
    email: 'store@example.com',
    username: 'joe.merchant',
    phone: '+1 555 010 0400',
    role: ROLES.STORE,
  },
  {
    name: 'Sara Admin',
    email: 'storeadmin@example.com',
    // A store admin: an ordinary account (note the `customer` role) that a
    // store owner appoints by username. She keeps her own role and gets the
    // store's products and orders from the membership below.
    username: 'sara.admin',
    phone: '+1 555 010 0500',
    role: ROLES.CUSTOMER,
  },
];

/**
 * Demo team memberships: who a store owner has appointed.
 *
 * This is the store-signup story in seed form - the store exists (DEMO_STORES
 * above), the owner appoints an admin by username, and `active` means the
 * invitation was already accepted, so the demo account can open the store
 * dashboard straight away. A `pending` row is deliberately not seeded: the
 * accept/decline half of the flow is exercised by inviting somebody new from
 * the dashboard (see scripts/smokeTest.mjs).
 */
export const DEMO_MEMBERSHIPS = [
  {
    storeSlug: 'joes-pizza',
    userEmail: 'storeadmin@example.com',
    role: STORE_MEMBER_ROLES.ADMIN,
    status: STORE_RIDER_STATUS.ACTIVE,
  },
];

/**
 * Demo merchants. Each one gets a public URL: /s/<slug>
 * `ownerEmail` is resolved after the users above exist.
 */
export const DEMO_STORES = [
  {
    name: "Joe's Pizza",
    slug: 'joes-pizza',
    ownerEmail: 'store@example.com',
    description: 'Wood-fired pizza and cold drinks, delivered hot.',
    phone: '+1 555 010 0400',
    address: { line1: '12 Market Street', city: 'Kathmandu' },
  },
  {
    name: 'Green Grocer',
    slug: 'green-grocer',
    ownerEmail: 'admin@example.com',
    description: 'Fresh bread, pastries and a weekly veg box.',
    phone: '+1 555 010 0300',
    address: { line1: '5 Riverside Road', city: 'Kathmandu' },
  },
];

/** A small catalogue so the storefront is not empty on a fresh database. */
export const DEMO_PRODUCTS = [
  {
    name: 'Margherita Pizza',
    price: 12.5,
    category: 'Food',
    storeSlug: 'joes-pizza',
    stock: 40,
    image: 'https://picsum.photos/seed/margherita/400/300',
    description: 'Wood-fired base, tomato, mozzarella and basil.',
  },
  {
    name: 'Chicken Biryani',
    price: 14.0,
    category: 'Food',
    storeSlug: 'joes-pizza',
    stock: 35,
    image: 'https://picsum.photos/seed/biryani/400/300',
    description: 'Fragrant basmati rice layered with spiced chicken.',
  },
  {
    name: 'Veggie Burger',
    price: 9.25,
    category: 'Food',
    storeSlug: 'joes-pizza',
    stock: 30,
    image: 'https://picsum.photos/seed/burger/400/300',
    description: 'Grilled patty, lettuce, tomato and smoky sauce.',
  },
  {
    name: 'Cold Brew Coffee',
    price: 4.5,
    category: 'Drinks',
    storeSlug: 'joes-pizza',
    stock: 60,
    image: 'https://picsum.photos/seed/coldbrew/400/300',
    description: 'Slow-steeped for 18 hours, served over ice.',
  },
  {
    name: 'Mango Smoothie',
    price: 5.75,
    category: 'Drinks',
    storeSlug: 'green-grocer',
    stock: 45,
    image: 'https://picsum.photos/seed/smoothie/400/300',
    description: 'Ripe mangoes blended with yoghurt and honey.',
  },
  {
    name: 'Sourdough Loaf',
    price: 6.0,
    category: 'Bakery',
    storeSlug: 'green-grocer',
    stock: 25,
    image: 'https://picsum.photos/seed/sourdough/400/300',
    description: 'Naturally leavened, baked fresh every morning.',
  },
  {
    name: 'Chocolate Croissant',
    price: 3.75,
    category: 'Bakery',
    storeSlug: 'green-grocer',
    stock: 50,
    image: 'https://picsum.photos/seed/croissant/400/300',
    description: 'Buttery layers with a dark chocolate centre.',
  },
  {
    name: 'Weekly Veg Box',
    price: 24.0,
    category: 'Groceries',
    storeSlug: 'green-grocer',
    stock: 20,
    image: 'https://picsum.photos/seed/vegbox/400/300',
    description: 'Seven seasonal vegetables picked by local farms.',
  },
];

/**
 * Creates the demo users, stores, team memberships and products. Safe to run
 * repeatedly:
 *  - users are matched by email (their password is reset to the demo one, so
 *    the login chips never break)
 *  - stores are matched by slug, so their public URL stays stable
 *  - products are matched by name and only attached to their demo store when
 *    they do not already belong to one, so your own edits survive
 *  - memberships are matched by (store, user) and flipped back to `active`,
 *    so the demo store admin always has a dashboard to log into
 */
export async function seedDemoData() {
  const summary = {
    users: { created: [], updated: [] },
    stores: { created: [], updated: [] },
    products: { created: 0, linked: 0 },
    memberships: { created: [], updated: [] },
  };

  // --- users first: stores reference their owners ---------------------------
  for (const spec of DEMO_USERS) {
    const existing = await User.findOne({ email: spec.email }).select(
      '+passwordHash',
    );

    if (existing) {
      existing.name = spec.name;
      existing.phone = spec.phone;
      existing.role = spec.role;
      // Accounts created before usernames existed get a handle now.
      if (spec.username) existing.username = spec.username;
      existing.passwordHash = await User.hashPassword(DEMO_PASSWORD);
      await existing.save();
      summary.users.updated.push(spec.email);
    } else {
      const user = new User({
        ...spec,
        passwordHash: await User.hashPassword(DEMO_PASSWORD),
      });
      await user.save();
      summary.users.created.push(spec.email);
    }
  }

  // --- demo stores, each with its own public /s/<slug> page -----------------
  const storesBySlug = new Map();

  for (const spec of DEMO_STORES) {
    const owner = spec.ownerEmail
      ? await User.findOne({ email: spec.ownerEmail })
      : null;

    let store = await Store.findOne({ slug: spec.slug });

    if (store) {
      store.name = spec.name;
      store.description = spec.description;
      store.phone = spec.phone;
      store.address = spec.address;
      if (owner) store.owner = owner._id;
      await store.save();
      summary.stores.updated.push(spec.slug);
    } else {
      store = await Store.create({
        name: spec.name,
        slug: spec.slug,
        description: spec.description,
        phone: spec.phone,
        address: spec.address,
        owner: owner?._id ?? null,
      });
      summary.stores.created.push(spec.slug);
    }

    storesBySlug.set(spec.slug, store);
  }

  // --- catalogue ------------------------------------------------------------
  for (const spec of DEMO_PRODUCTS) {
    const { storeSlug, ...fields } = spec;
    const store = storeSlug ? storesBySlug.get(storeSlug) : null;
    const existing = await Product.findOne({ name: spec.name });

    if (existing) {
      // Never steal a product that was deliberately assigned elsewhere.
      if (store && !existing.store) {
        existing.store = store._id;
        await existing.save();
        summary.products.linked += 1;
      }
      continue;
    }

    await Product.create({ ...fields, store: store?._id ?? null });
    summary.products.created += 1;
  }

  // --- team memberships: the admins a store owner has appointed -------------
  for (const spec of DEMO_MEMBERSHIPS) {
    const store = storesBySlug.get(spec.storeSlug);
    const member = await User.findOne({ email: spec.userEmail });

    if (!store || !member) continue;

    const label = `${spec.storeSlug} <- @${member.username || member.email}`;
    const existing = await StoreRider.findOne({
      store: store._id,
      rider: member._id,
    });

    if (existing) {
      // Back to an accepted membership even if a previous run revoked it, so
      // the demo dashboard keeps working.
      existing.role = spec.role;
      existing.status = spec.status;
      existing.respondedAt = spec.status === STORE_RIDER_STATUS.ACTIVE
        ? new Date()
        : null;
      await existing.save();
      summary.memberships.updated.push(label);
    } else {
      await StoreRider.create({
        store: store._id,
        rider: member._id,
        role: spec.role,
        status: spec.status,
        invitedBy: store.owner ?? null,
        respondedAt: spec.status === STORE_RIDER_STATUS.ACTIVE ? new Date() : null,
      });
      summary.memberships.created.push(label);
    }
  }

  return summary;
}

// --- CLI: `npm run seed` ---------------------------------------------------
const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const { connectDB, disconnectDB } = await import('./config/db.js');
  const { config } = await import('./config/env.js');

  try {
    console.log(`[seed] connecting to ${config.mongoUri}`);
    await connectDB();

    const summary = await seedDemoData();

    console.log('[seed] done');
    console.log(`[seed] users created: ${summary.users.created.join(', ') || 'none'}`);
    console.log(`[seed] users refreshed: ${summary.users.updated.join(', ') || 'none'}`);
    console.log(`[seed] stores created: ${summary.stores.created.join(', ') || 'none'}`);
    console.log(`[seed] stores refreshed: ${summary.stores.updated.join(', ') || 'none'}`);
    console.log(`[seed] products created: ${summary.products.created}`);
    console.log(`[seed] products attached to a store: ${summary.products.linked}`);
    console.log(
      `[seed] team memberships created: ${summary.memberships.created.join(', ') || 'none'}`,
    );
    console.log(
      `[seed] team memberships refreshed: ${summary.memberships.updated.join(', ') || 'none'}`,
    );
    console.log(`[seed] demo password for every account: ${DEMO_PASSWORD}`);
  } catch (err) {
    console.error('[seed] failed:', err.message);
    process.exitCode = 1;
  } finally {
    await disconnectDB();
  }
}

export default {
  seedDemoData,
  DEMO_USERS,
  DEMO_STORES,
  DEMO_MEMBERSHIPS,
  DEMO_PRODUCTS,
  DEMO_PASSWORD,
};
