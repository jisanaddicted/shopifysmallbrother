import StoreRider from '../models/StoreRider.js';
import { STORE_RIDER_STATUS } from './constants.js';

/** Ids of the stores this rider has an accepted (active) binding with. */
export async function activeStoreIds(riderId) {
  const links = await StoreRider.find({
    rider: riderId,
    status: STORE_RIDER_STATUS.ACTIVE,
  }).select('store');

  return links.map((link) => link.store);
}

/**
 * Is this rider an accepted rider for that store? This is the check that
 * decides whether a store's orders show up in the rider's pool.
 */
export async function isBoundToStore(riderId, storeId) {
  if (!storeId) return false;

  const link = await StoreRider.findOne({
    rider: riderId,
    store: storeId,
    status: STORE_RIDER_STATUS.ACTIVE,
  });

  return Boolean(link);
}

export default { activeStoreIds, isBoundToStore };
