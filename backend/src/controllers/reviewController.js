import mongoose from 'mongoose';
import Order from '../models/Order.js';
import Review from '../models/Review.js';
import User from '../models/User.js';
import { HttpError } from '../middleware/errorHandler.js';
import { ORDER_STATUS } from '../utils/constants.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { loadManageableStore } from '../utils/storeAccess.js';

// How many reviews a store's dashboard asks for at once.
const STORE_REVIEW_WINDOW = 100;

/**
 * Loads the order a review is about, and checks the reviewer may touch it.
 *
 * A review needs a signed-in customer: the guest token handed out at checkout
 * unlocks the tracker, and it also lets a guest confirm they received the
 * parcel (PATCH /orders/:id/receive) - but it cannot let them RATE it. A rating
 * is a public judgement on a merchant, so it has to be attributable to an
 * account somebody can be held to; a guest order has no account behind it, and a
 * rating nobody owns is worth nothing to a store. So guests can close their own
 * order but cannot review it.
 */
async function loadReviewableOrder(orderId, user) {
  if (!mongoose.isValidObjectId(orderId)) {
    throw new HttpError(400, 'That order id is not valid.');
  }

  const order = await Order.findById(orderId);
  if (!order) throw new HttpError(404, 'That order does not exist.');

  if (String(order.customer?._id || order.customer) !== String(user._id)) {
    throw new HttpError(403, 'Only the customer who placed this order can review it.');
  }

  return order;
}

/**
 * POST /api/orders/:id/review   body: { rating, comment }
 * PUT  /api/orders/:id/review   body: { rating, comment }
 *
 * Write or overwrite the review for one delivery.
 *
 * Gated on the CUSTOMER having confirmed receipt (`received`) rather than merely
 * `delivered`: the whole point of the receipt step is that the review describes a
 * parcel that actually turned up, so a review cannot be written while the order
 * is still on the road. Re-submitting the same order updates the one review that
 * already exists (unique index on `order`) rather than creating a second one.
 */
export const writeReview = asyncHandler(async (req, res) => {
  const order = await loadReviewableOrder(req.params.id, req.user);

  if (order.status !== ORDER_STATUS.RECEIVED) {
    throw new HttpError(
      400,
      'Confirm you received this order before reviewing it.',
    );
  }

  const { rating, comment } = req.body || {};

  // Whole stars only. The model rejects 4.5 as well as 0 and 6, but catching it
  // here returns a clear sentence instead of a raw validator message.
  const stars = Number(rating);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    throw new HttpError(400, 'Pick a rating from 1 to 5 stars.');
  }

  const text = String(comment || '').trim();
  if (text.length > 500) {
    throw new HttpError(400, 'A review can be 500 characters at most.');
  }

  // A guest order has no store to credit, so there is nothing to attach a review
  // to. Unreachable today (guests cannot sign in), but a loud 400 beats a
  // confusing validator error if that ever changes.
  if (!order.store) {
    throw new HttpError(400, 'This order is not linked to a store yet.');
  }

  const review = await Review.findOneAndUpdate(
    { order: order._id },
    {
      $set: {
        store: order.store,
        customer: req.user._id,
        customerName: String(req.user.name || '').trim(),
        rating: stars,
        comment: text,
      },
    },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
  );

  res.json({ review });
});

/**
 * GET /api/orders/:id/review
 *
 * The review on one order - the customer reads back what they wrote, and the
 * form opens pre-filled when they come to change it. `review: null` is a normal
 * answer, not a 404: no review yet is the common case.
 */
export const getOrderReview = asyncHandler(async (req, res) => {
  const order = await loadReviewableOrder(req.params.id, req.user);
  const review = await Review.findOne({ order: order._id });

  res.json({ review: review || null });
});

/**
 * GET /api/stores/:id/reviews
 *
 * Everything customers have said about this store's deliveries, newest first,
 * with the average. Scoped through `loadManageableStore`, so it answers for the
 * store owner AND for a store admin the owner appointed (and for a platform
 * admin who runs the store) - the same three roles the dashboard is built for.
 *
 * The order id comes along in each row so the store can link a review to the
 * delivery it describes.
 */
export const listStoreReviews = asyncHandler(async (req, res) => {
  const { store, role } = await loadManageableStore(req.params.id, req.user);

  const reviews = await Review.find({ store: store._id })
    .sort({ createdAt: -1 })
    .limit(STORE_REVIEW_WINDOW);

  const rated = reviews
    .map((review) => Number(review.rating))
    .filter((value) => Number.isFinite(value));
  const average = rated.length
    ? Math.round((rated.reduce((sum, value) => sum + value, 0) / rated.length) * 10) /
      10
    : null;

  // The histogram the dashboard draws: how many 1-star, 2-star ... 5-star.
  const distribution = [1, 2, 3, 4, 5].map((star) => ({
    rating: star,
    count: reviews.filter((review) => review.rating === star).length,
  }));

  res.json({
    store,
    role,
    reviews,
    total: reviews.length,
    average,
    distribution,
  });
});

/**
 * DELETE /api/orders/:id/review
 *
 * Withdraw your own review. A store cannot delete one, and a customer cannot
 * delete anybody else's.
 */
export const deleteOrderReview = asyncHandler(async (req, res) => {
  const order = await loadReviewableOrder(req.params.id, req.user);

  const removed = await Review.findOneAndDelete({ order: order._id });
  if (!removed) throw new HttpError(404, 'There is no review to remove.');

  res.json({ removed: true });
});

export default {
  getOrderReview,
  listStoreReviews,
  deleteOrderReview,
  writeReview,
};
