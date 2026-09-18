import StoreRider from '../models/StoreRider.js';
import { HttpError } from '../middleware/errorHandler.js';
import { STORE_RIDER_STATUS } from '../utils/constants.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// Store details a rider needs in order to decide.
const STORE_FIELDS = 'name slug image description phone address';

/**
 * GET /api/riders/requests (rider)
 *
 * Invitations a store (or an admin) has sent to this rider that are still
 * waiting for an answer.
 */
export const listMyRequests = asyncHandler(async (req, res) => {
  const requests = await StoreRider.find({
    rider: req.user._id,
    status: STORE_RIDER_STATUS.PENDING,
  })
    .populate('store', STORE_FIELDS)
    .populate('invitedBy', 'name username role')
    .sort({ createdAt: -1 });

  res.json({ requests: requests.filter((request) => request.store) });
});

/**
 * PATCH /api/riders/requests/:id  { action: 'accept' | 'decline' }  (rider)
 *
 * Accepting flips the binding to `active`, which is what makes that store's
 * orders appear in this rider's available-deliveries pool.
 */
export const respondToRequest = asyncHandler(async (req, res) => {
  const action = String(req.body?.action || '').toLowerCase();

  if (!['accept', 'decline'].includes(action)) {
    throw new HttpError(400, 'Action must be either "accept" or "decline".');
  }

  const link = await StoreRider.findOne({
    _id: req.params.id,
    rider: req.user._id,
  });

  if (!link) throw new HttpError(404, 'That invitation does not exist.');

  if (link.status === STORE_RIDER_STATUS.ACTIVE) {
    throw new HttpError(409, 'You have already accepted this invitation.');
  }
  if (link.status !== STORE_RIDER_STATUS.PENDING) {
    throw new HttpError(
      409,
      `That invitation is no longer open (it was ${link.status}).`,
    );
  }

  link.status =
    action === 'accept'
      ? STORE_RIDER_STATUS.ACTIVE
      : STORE_RIDER_STATUS.DECLINED;
  link.respondedAt = new Date();
  await link.save();
  await link.populate('store', STORE_FIELDS);

  res.json({ invitation: link });
});

/** GET /api/riders/stores (rider) - the stores this rider delivers for. */
export const listMyStores = asyncHandler(async (req, res) => {
  const links = await StoreRider.find({
    rider: req.user._id,
    status: STORE_RIDER_STATUS.ACTIVE,
  })
    .populate('store', STORE_FIELDS)
    .sort({ createdAt: -1 });

  res.json({
    stores: links.filter((link) => link.store).map((link) => link.store),
  });
});

export default { listMyRequests, respondToRequest, listMyStores };
