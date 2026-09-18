import mongoose from 'mongoose';
import {
  STORE_RIDER_STATUS,
  STORE_RIDER_STATUS_VALUES,
} from '../utils/constants.js';

/**
 * The binding between a store and a rider.
 *
 * Flow: a store (or an admin) invites a rider by username -> `pending`.
 * The rider accepts -> `active`, and only then do that store's orders show up
 * in the rider's "available deliveries" pool. The rider may decline, and the
 * store may revoke an active binding.
 *
 * One document per pair, so re-inviting flips the same row back to `pending`
 * instead of creating duplicates.
 */
const storeRiderSchema = new mongoose.Schema(
  {
    store: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Store',
      required: true,
      index: true,
    },
    rider: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: {
        values: STORE_RIDER_STATUS_VALUES,
        message: '{VALUE} is not a valid invitation status.',
      },
      default: STORE_RIDER_STATUS.PENDING,
      index: true,
    },
    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    respondedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, versionKey: false },
    toObject: { virtuals: true, versionKey: false },
  },
);

storeRiderSchema.virtual('id').get(function getId() {
  return this._id?.toString();
});

// A rider can only be linked to a given store once.
storeRiderSchema.index({ store: 1, rider: 1 }, { unique: true });

export const StoreRider = mongoose.model('StoreRider', storeRiderSchema);
export default StoreRider;