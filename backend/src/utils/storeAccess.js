import mongoose from 'mongoose';
import Store from '../models/Store.js';
import StoreRider from '../models/StoreRider.js';
import { HttpError } from '../middleware/errorHandler.js';
import {
  STORE_MEMBER_ROLES,
  STORE_RIDER_STATUS,
} from './constants.js';

/**
 * Store-scoped authorization. Every controller asks the same question the same
 * way: "may this account act for this store?"
 *
 * Three kinds of people can:
 *   - the OWNER (Store.owner - the account that signed the store up)
 *   - a STORE ADMIN: somebody the owner invited by username and who accepted.
 *     They keep their own platform role (usually `customer`) and get access
 *     through their StoreRider row, never through their role.
 *   - a PLATFORM ADMIN (role `admin`), but ONLY for a store they own or were
 *     themselves invited to run - there is no platform-wide pass anymore. The
 *     invitation flow (store invites the admin by username, the admin accepts
 *     in the panel) is what puts stores in front of an admin account.
 *
 * Roles are compared as strings throughout, so a store admin who happens to be
 * a `customer` or a `rider` is handled without a special case anywhere else.
 */
export const STORE_ROLES = {
  OWNER: 'owner',
  ADMIN: 'admin',
  PLATFORM: 'platform',
};

/** The active store-admin membership row for this user + store, or null. */
export function storeAdminLink(userId, storeId) {
  if (!userId || !storeId) return Promise.resolve(null);

  return StoreRider.findOne({
    rider: userId,
    store: storeId,
    role: STORE_MEMBER_ROLES.ADMIN,
    status: STORE_RIDER_STATUS.ACTIVE,
  });
}

/** Is this user an accepted store admin for that store? */
export async function isStoreAdmin(userId, storeId) {
  return Boolean(await storeAdminLink(userId, storeId));
}

/** Did this account sign the store up? */
export function isStoreOwner(user, store) {
  if (!user || !store || !store.owner) return false;
  return String(store.owner) === String(user._id);
}

/**
 * Every store this account runs, owner-owned stores first, as
 * `[{ store, role }]`. This is what the client receives with the session so a
 * store admin can be sent to the dashboard just like an owner.
 */
export async function storesForUser(user) {
  if (!user?._id) return [];

  const [owned, links] = await Promise.all([
    Store.find({ owner: user._id }).sort({ createdAt: 1 }),
    // Newest accepted membership first: "the store you joined most recently"
    // is what the dashboard opens when an admin runs several stores.
    StoreRider.find({
      rider: user._id,
      role: STORE_MEMBER_ROLES.ADMIN,
      status: STORE_RIDER_STATUS.ACTIVE,
    })
      .populate('store')
      .sort({ respondedAt: -1, createdAt: -1 }),
  ]);

  const entries = owned.map((store) => ({
    store,
    role: STORE_ROLES.OWNER,
  }));
  const seen = new Set(entries.map((entry) => String(entry.store._id)));

  for (const link of links) {
    // A deleted store, or one the account owns anyway - the owner row wins,
    // otherwise the dashboard would list the same store twice.
    if (!link.store || seen.has(String(link.store._id))) continue;

    seen.add(String(link.store._id));
    entries.push({ store: link.store, role: STORE_ROLES.ADMIN });
  }

  return entries;
}

/** Ids of every store this account owns or administers. */
export async function managedStoreIds(user) {
  const entries = await storesForUser(user);
  return entries.map((entry) => entry.store._id);
}

/**
 * Loads a store the caller is allowed to manage, or throws the right
 * 400/403/404. Returns `{ store, role }` - `role` tells the caller whether
 * they own it (full control) or only help run it.
 *
 * A platform admin resolves through the same two tests as everybody else
 * (owner, then accepted membership) - no platform-wide pass.
 */
export async function loadManageableStore(storeId, user) {
  if (!mongoose.isValidObjectId(storeId)) {
    throw new HttpError(400, 'That store id is not valid.');
  }

  const store = await Store.findById(storeId);
  if (!store) throw new HttpError(404, 'That store does not exist.');

  if (isStoreOwner(user, store)) {
    return { store, role: STORE_ROLES.OWNER };
  }

  if (await isStoreAdmin(user._id, store._id)) {
    return { store, role: STORE_ROLES.ADMIN };
  }

  throw new HttpError(403, 'That store does not belong to you.');
}

/**
 * The store a dashboard should open: the one this account owns, otherwise the
 * first store it was appointed to run. Resolves `null` when the account runs
 * no store at all.
 */
export async function primaryStoreFor(user) {
  const entries = await storesForUser(user);
  return entries.length ? entries[0] : null;
}

export default {
  STORE_ROLES,
  storeAdminLink,
  isStoreAdmin,
  isStoreOwner,
  storesForUser,
  managedStoreIds,
  loadManageableStore,
  primaryStoreFor,
};
