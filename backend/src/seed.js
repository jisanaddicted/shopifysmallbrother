import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Product from './models/Product.js';
import User from './models/User.js';
import { ROLES } from './utils/constants.js';

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
    phone: '+1 555 010 0200',
    role: ROLES.RIDER,
  },
  {
    name: 'Ada Admin',
    email: 'admin@example.com',
    phone: '+1 555 010 0300',
    role: ROLES.ADMIN,
  },
];

/** A small catalogue so the storefront is not empty on a fresh database. */
export const DEMO_PRODUCTS = [
  {
    name: 'Margherita Pizza',
    price: 12.5,
    category: 'Food',
    stock: 40,
    image: 'https://picsum.photos/seed/margherita/400/300',
    description: 'Wood-fired base, tomato, mozzarella and basil.',
  },
  {
    name: 'Chicken Biryani',
    price: 14.0,
    category: 'Food',
    stock: 35,
    image: 'https://picsum.photos/seed/biryani/400/300',
    description: 'Fragrant basmati rice layered with spiced chicken.',
  },
  {
    name: 'Veggie Burger',
    price: 9.25,
    category: 'Food',
    stock: 30,
    image: 'https://picsum.photos/seed/burger/400/300',
    description: 'Grilled patty, lettuce, tomato and smoky sauce.',
  },
  {
    name: 'Cold Brew Coffee',
    price: 4.5,
    category: 'Drinks',
    stock: 60,
    image: 'https://picsum.photos/seed/coldbrew/400/300',
    description: 'Slow-steeped for 18 hours, served over ice.',
  },
  {
    name: 'Mango Smoothie',
    price: 5.75,
    category: 'Drinks',
    stock: 45,
    image: 'https://picsum.photos/seed/smoothie/400/300',
    description: 'Ripe mangoes blended with yoghurt and honey.',
  },
  {
    name: 'Sourdough Loaf',
    price: 6.0,
    category: 'Bakery',
    stock: 25,
    image: 'https://picsum.photos/seed/sourdough/400/300',
    description: 'Naturally leavened, baked fresh every morning.',
  },
  {
    name: 'Chocolate Croissant',
    price: 3.75,
    category: 'Bakery',
    stock: 50,
    image: 'https://picsum.photos/seed/croissant/400/300',
    description: 'Buttery layers with a dark chocolate centre.',
  },
  {
    name: 'Weekly Veg Box',
    price: 24.0,
    category: 'Groceries',
    stock: 20,
    image: 'https://picsum.photos/seed/vegbox/400/300',
    description: 'Seven seasonal vegetables picked by local farms.',
  },
];

/**
 * Creates the demo users and products. Safe to run repeatedly:
 *  - users are matched by email (their password is reset to the demo one, so
 *    the login chips never break)
 *  - products are matched by name, so your own edits are never overwritten
 */
export async function seedDemoData() {
  const summary = { users: { created: [], updated: [] }, products: { created: 0 } };

  for (const spec of DEMO_USERS) {
    const existing = await User.findOne({ email: spec.email }).select(
      '+passwordHash',
    );

    if (existing) {
      existing.name = spec.name;
      existing.phone = spec.phone;
      existing.role = spec.role;
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

  for (const spec of DEMO_PRODUCTS) {
    const exists = await Product.exists({ name: spec.name });
    if (!exists) {
      await Product.create(spec);
      summary.products.created += 1;
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
    console.log(`[seed] products created: ${summary.products.created}`);
    console.log(`[seed] demo password for every account: ${DEMO_PASSWORD}`);
  } catch (err) {
    console.error('[seed] failed:', err.message);
    process.exitCode = 1;
  } finally {
    await disconnectDB();
  }
}

export default { seedDemoData, DEMO_USERS, DEMO_PRODUCTS, DEMO_PASSWORD };
