import mongoose from 'mongoose';
import {
  STORE_CUSTOMER_SOURCE_VALUES,
  STORE_CUSTOMER_STATUS,
  STORE_CUSTOMER_STATUS_VALUES,
} from '../utils/constants.js';

/**
 * The binding between a store and a customer.
 *
 * A shopper signs up from a store's public page (/s/<slug>), so the account
 * they create belongs to *that* store - this row is what records it. Logging in
 * from a store page, or ordering from one, creates the same row, which is why
 * an account can be a customer of several stores at once.
 *
 * One document per pair, so signing up / logging in / ordering repeatedly never
 * duplicates a row. `source` records how the shopper first arrived and is never
 * overwritten; `lastSeenAt` moves with each sign-in so a store can tell an
 * active customer from a dormant one.
 */
const storeCustomerSchema = new mongoose.Schema(
  {
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
    status: {
      type: String,
      enum: {
        values: STORE_CUSTOMER_STATUS_VALUES,
        message: '{VALUE} is not a valid customer status.',
      },
      default: STORE_CUSTOMER_STATUS.ACTIVE,
      index: true,
    },
    // How this customer first joined the store: 'signup' (created their account
    // on the storefront), 'login' (signed in there) or 'order' (placed an
    // order after signing up elsewhere).
    source: {
      type: String,
      enum: {
        values: STORE_CUSTOMER_SOURCE_VALUES,
        message: '{VALUE} is not a valid customer source.',
      },
      default: STORE_CUSTOMER_SOURCE_VALUES[0],
    },
    // Set on every storefront sign-in - "shopped here recently" for the store.
    lastSeenAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, versionKey: false },
    toObject: { virtuals: true, versionKey: false },
  },
);

storeCustomerSchema.virtual('id').get(function getId() {
  return this._id?.toString();
});

// A customer can only be linked to a given store once.
storeCustomerSchema.index({ store: 1, customer: 1 }, { unique: true });

export const StoreCustomer = mongoose.model('StoreCustomer', storeCustomerSchema);
export default StoreCustomer;
