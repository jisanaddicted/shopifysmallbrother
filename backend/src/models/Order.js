import mongoose from 'mongoose';
import {
  ORDER_STATUS,
  ORDER_STATUS_VALUES,
  PAYMENT_METHODS,
} from '../utils/constants.js';

// ---------------------------------------------------------------------------
// Sub-documents
// ---------------------------------------------------------------------------

/**
 * One line of the basket. `name`/`price` are copied in on purpose: an order is
 * a historical receipt and must not change when the product is edited later.
 */
const orderItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      default: null,
    },
    name: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0, default: 0 },
    quantity: { type: Number, required: true, min: 1, default: 1 },
  },
  { _id: false },
);

const addressSchema = new mongoose.Schema(
  {
    label: { type: String, trim: true, default: 'Home' },
    line1: { type: String, trim: true, default: '' },
    city: { type: String, trim: true, default: '' },
    phone: { type: String, trim: true, default: '' },
    notes: { type: String, trim: true, default: '' },
  },
  { _id: false },
);

const pointSchema = new mongoose.Schema(
  {
    lat: { type: Number },
    lng: { type: Number },
  },
  { _id: false },
);

/** Audit trail so the tracker can explain how the order got where it is. */
const statusEntrySchema = new mongoose.Schema(
  {
    status: { type: String, enum: ORDER_STATUS_VALUES, required: true },
    note: { type: String, trim: true, default: '' },
    at: { type: Date, default: Date.now },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { _id: false },
);

// ---------------------------------------------------------------------------
// Order
// ---------------------------------------------------------------------------

const orderSchema = new mongoose.Schema(
  {
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    // Guest checkout: no account, so the order carries the contact itself.
    // A null customer + a guestTokenHash means "whoever holds the raw token".
    guest: {
      name: { type: String, trim: true, default: '' },
      email: { type: String, trim: true, lowercase: true, default: '' },
    },
    guestTokenHash: { type: String, default: null, index: true, select: false },
    rider: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },

    // The merchant this order was placed with, derived from its products.
    // Riders bound to this store see the order and may claim it.
    store: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Store',
      default: null,
      index: true,
    },

    items: {
      type: [orderItemSchema],
      validate: {
        validator: (items) => Array.isArray(items) && items.length > 0,
        message: 'An order needs at least one item.',
      },
    },

    subtotal: { type: Number, required: true, min: 0, default: 0 },
    deliveryFee: { type: Number, required: true, min: 0, default: 0 },
    total: { type: Number, required: true, min: 0, default: 0 },

    address: { type: addressSchema, default: () => ({}) },
    // Where the customer dropped the pin - the map's destination marker.
    location: { type: pointSchema, default: undefined },

    paymentMethod: { type: String, enum: PAYMENT_METHODS, default: 'cod' },

    status: {
      type: String,
      enum: ORDER_STATUS_VALUES,
      default: ORDER_STATUS.PENDING,
      index: true,
    },
    statusHistory: { type: [statusEntrySchema], default: [] },

    // Last GPS ping from the assigned rider.
    riderLocation: { type: pointSchema, default: undefined },

    cancelReason: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, versionKey: false },
    toObject: { virtuals: true, versionKey: false },
  },
);

orderSchema.virtual('id').get(function getId() {
  return this._id?.toString();
});

/** Shorthand used across the controllers: is this order still in play? */
orderSchema.virtual('isOpen').get(function isOpen() {
  return (
    this.status !== ORDER_STATUS.DELIVERED &&
    this.status !== ORDER_STATUS.CANCELLED
  );
});

export const Order = mongoose.model('Order', orderSchema);
export default Order;
