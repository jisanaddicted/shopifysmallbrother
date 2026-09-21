import StoreRider from '../models/StoreRider.js';
import { STORE_MEMBER_ROLES, STORE_RIDER_STATUS } from './constants.js';

/** Ids of the stores this user delivers for (accepted rider bindings only). */
export async function activeStoreIds(userId) {
  const links = await StoreRider.find({
    rider: userId,
    role: STORE_MEMBER_ROLES.RIDER,
    status: STORE_RIDER_STATUS.ACTIVE,
  }).select('store');

  return links.map((link) => link.store);
}

/** Ids of the stores this user helps run (accepted store-admin bindings). */
export async function adminStoreIds(userId) {
  const links = await StoreRider.find({
    rider: userId,
    role: STORE_MEMBER_ROLES.ADMIN,
    status: STORE_RIDER_STATUS.ACTIVE,
  }).select('store');

  return links.map((link) => link.store);
}

/**
 * Is this user an accepted delivery rider for that store? This is the check
 * that decides whether a store's orders show up in their delivery pool.
 */
export async function isBoundToStore(userId, storeId) {
  if (!storeId) return false;

  const link = await StoreRider.findOne({
    rider: userId,
    store: storeId,
    role: STORE_MEMBER_ROLES.RIDER,
    status: STORE_RIDER_STATUS.ACTIVE,
  });

  return Boolean(link);
}

/** Any accepted membership (rider or store admin) with that store? */
export async function isStoreMember(userId, storeId) {
  if (!storeId) return false;

  const link = await StoreRider.findOne({
    rider: userId,
    store: storeId,
    status: STORE_RIDER_STATUS.ACTIVE,
  });

  return Boolean(link);
}

export default { activeStoreIds, adminStoreIds, isBoundToStore, isStoreMember };
