import mongoose from 'mongoose';

/**
 * A customer's rating of one delivery, with an optional note.
 *
 * Only a signed-in customer may write one, and only for an order they placed
 * themselves AND have confirmed receipt of (`status: 'received'`) - the point of
 * the receipt step is that the review is written after the parcel actually
 * arrived, not while it is still on the road.
 *
 * One review per order (unique index below), and re-submitting the same order
 * UPDATES the existing review rather than stacking a second opinion on the same
 * delivery, so a customer can fix a typo or add a thought they left out.
 *
 * Deliberately NOT public yet: reviews are shown to the customer on their own
 * order and to the store owner in the store dashboard. Nothing here is served
 * on the public storefront, so there is no moderation surface to get wrong
 * before one is needed.
 */
const reviewSchema = new mongoose.Schema(
  {
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
      index: true,
    },
    // Copied from the order so the store dashboard can list "my reviews"
    // without joining back through the order for every row.
    store: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Store',
      required: true,
      index: true,
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    // Snapshot of the author's name at the time of writing, so a later rename
    // or account deletion does not rewrite history on the store's dashboard.
    customerName: { type: String, trim: true, default: '' },
    // Whole stars only - 1 (worst) to 5 (best).
    rating: {
      type: Number,
      required: [true, 'Pick a star rating.'],
      min: [1, 'A rating is between 1 and 5 stars.'],
      max: [5, 'A rating is between 1 and 5 stars.'],
      // Reject 4.5 rather than rounding it: a half star would not mean the
      // same thing to two different people reading the dashboard.
      validate: {
        validator: Number.isInteger,
        message: 'A rating has to be a whole number of stars.',
      },
    },
    comment: {
      type: String,
      trim: true,
      maxlength: [500, 'A review can be 500 characters at most.'],
      default: '',
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, versionKey: false },
    toObject: { virtuals: true, versionKey: false },
  },
);

reviewSchema.virtual('id').get(function getId() {
  return this._id?.toString();
});

/** The one review per order that a second submission overwrites. */
reviewSchema.index({ order: 1 }, { unique: true });

export const Review = mongoose.model('Review', reviewSchema);
export default Review;
