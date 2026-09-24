import Store from '../models/Store.js';
import StoreCustomer from '../models/StoreCustomer.js';
import { ROLES, STORE_CUSTOMER_SOURCE, STORE_CUSTOMER_STATUS } from './constants.js';
import { slugify } from './slug.js';

/**
 * Store-scoped customer accounts.
 *
 * A customer signs up (or signs in) from a store's public page, and this is
 * what remembers which store that was. The rules are deliberately narrow:
 *   - only accounts with the `customer` role are linked
 *   - a link belongs to exactly one (store, customer) pair
 *   - a store can BLOCK a customer; blocking is never undone by a login
 */

/** Resolves a public `/s/<slug>` slug to a live store, or null. */
export async function storeBySlug(slug) {
  const clean = slugify(slug, '');
  if (!clean) return null;

  return Store.findOne({ slug: clean, isActive: true });
}

/**
 * Records that this account is a customer of this store.
 *
 * Idempotent: signing up, logging in and ordering all funnel through here, and
 * the first call wins for `source`. Returns the link, or null when the account
 * is not a customer (staff accounts are never linked) or when a store has
 * blocked them.
 */
export async function ensureStoreCustomer(store, user, source) {
  // Accept a document or a bare id, so callers can pass either.
  const storeId = store?._id || store;

  if (!storeId || !user?._id) return null;
  if (user.role !== ROLES.CUSTOMER) return null;

  const existing = await StoreCustomer.findOne({
    store: storeId,
    customer: user._id,
  });

  if (existing) {
    // A blocked customer stays blocked - signing in again must not lift it.
    if (existing.status === STORE_CUSTOMER_STATUS.BLOCKED) return existing;

    existing.lastSeenAt = new Date();
    await existing.save();
    return existing;
  }

  return StoreCustomer.create({
    store: storeId,
    customer: user._id,
    status: STORE_CUSTOMER_STATUS.ACTIVE,
    source: source || STORE_CUSTOMER_SOURCE.SIGNUP,
    lastSeenAt: new Date(),
  });
}

/** The active link between one store and one account, or null. */
export function storeCustomerLink(storeId, userId) {
  if (!storeId || !userId) return Promise.resolve(null);

  return StoreCustomer.findOne({
    store: storeId,
    customer: userId,
    status: STORE_CUSTOMER_STATUS.ACTIVE,
  });
}

/** May this account order from / sign in at this store? */
export async function isCustomerOfStore(storeId, userId) {
  return Boolean(await storeCustomerLink(storeId, userId));
}

/**
 * Every store this account shops at, newest relationship first, as
 * `[{ store, status, source, joinedAt, lastSeenAt }]`. `customerStoresFor`
 * keeps the full entries (what the session ships); `storesForCustomer` below
 * unwraps just the store documents for older client code paths. Callers must
 * say which shape they need - both stay exported on purpose.
 */
export async function customerStoresFor(user) {
  if (!user?._id) return [];

  const links = await StoreCustomer.find({ customer: user._id })
    .populate('store')
    .sort({ lastSeenAt: -1, createdAt: -1 });

  return links
    // A deleted store would otherwise show up as an empty card.
    .filter((link) => link.store)
    .map((link) => ({
      store: link.store,
      status: link.status,
      source: link.source,
      joinedAt: link.createdAt,
      lastSeenAt: link.lastSeenAt,
    }));
}

/** Just the stores (not the links) - the shape the client mostly wants. */
export async function storesForCustomer(user) {
  const entries = await customerStoresFor(user);
  return entries.map((entry) => entry.store);
}

// What a merchant needs to see about a customer - never the password hash.
const CUSTOMER_FIELDS = 'name email phone username createdAt';

/**
 * A store's customer list, newest first, as
 * `[{ customer, status, source, joinedAt, lastSeenAt }]`.
 * This is the merchant-side view of the same relationship.
 */
export async function customersForStore(storeId) {
  if (!storeId) return [];

  const links = await StoreCustomer.find({ store: storeId })
    .populate('customer', CUSTOMER_FIELDS)
    .sort({ lastSeenAt: -1, createdAt: -1 });

  // A deleted account would otherwise render as a blank row.
  return links
    .filter((link) => link.customer)
    .map((link) => ({
      customer: link.customer,
      status: link.status,
      source: link.source,
      joinedAt: link.createdAt,
      lastSeenAt: link.lastSeenAt,
    }));
}

export default {
  storeBySlug,
  ensureStoreCustomer,
  storeCustomerLink,
  isCustomerOfStore,
  customerStoresFor,
  storesForCustomer,
  customersForStore,
};
