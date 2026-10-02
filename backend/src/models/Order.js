import mongoose from 'mongoose';
import {
  CLOSED_STATUSES,
  DELIVERY_FAILED_REASONS_VALUES,
  ORDER_STATUS,
  ORDER_STATUS_VALUES,
  PAYMENT_METHODS,
  PAYMENT_PROVIDER,
  PAYMENT_STATUS,
  PAYMENT_STATUS_VALUES,
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
    // Which variant sold, when the product has any. Null for a product bought
    // as a single version - the case for everything ordered before variants
    // existed. It is NOT a ref to a separate collection (variants are embedded
    // in their product), so this is an id the server resolves against the
    // product document it already loaded.
    variant: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    // The variant's label, "L / Blue", copied in for the same reason `name` is:
    // an order is a historical receipt. If the merchant later renames the
    // option or deletes the variant, the rider must still be able to read off
    // exactly what was collected.
    variantTitle: { type: String, trim: true, default: '' },
    // What it sold for, versus what it is struck through at. Nullable because a
    // sale with no compare-at price is the normal case.
    compareAtPrice: { type: Number, min: 0, default: null },
    sku: { type: String, trim: true, default: '' },
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

/**
 * How this order gets paid for.
 *
 * A SUB-DOCUMENT of Order rather than a separate payments collection, on
 * purpose: the spec this was built from describes its own standalone Order
 * schema, but this app already HAS an order - with items, a store, a rider, a
 * status history and a live tracker. A second, parallel "payment order" would be
 * a second source of truth for the same basket, and the two would drift. So the
 * payment hangs off the real order instead, and `order.total` is the amount the
 * gateway is asked to charge - the server prices the basket, never the client.
 *
 * Cash on delivery is a payment too: `provider: 'cod'` with no transaction id,
 * settled by the rider in person. It is a status, not the absence of one, so the
 * store dashboard can still answer "was this paid?".
 */
const paymentSchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      enum: Object.values(PAYMENT_PROVIDER),
      default: PAYMENT_PROVIDER.COD,
    },
    // Which button the buyer pressed: bkash / nagad / rocket / card. Recorded
    // separately from `paymentMethod` on the order (which says cash-vs-online)
    // because this is what the store wants to report on: not "they paid online"
    // but "they paid by bKash".
    channel: { type: String, trim: true, default: '' },
    status: {
      type: String,
      enum: PAYMENT_STATUS_VALUES,
      default: PAYMENT_STATUS.PENDING,
    },
    // Unique per payment attempt; the gateway echoes it back on every callback,
    // and it is what the shopper sees on the success page.
    transactionId: { type: String, default: null },
    // SSLCommerz's own handle for the session. Stored on success so a refund
    // or a later dispute can be traced back to the gateway.
    val_id: { type: String, default: null },
    // Snapshot of what was charged. Kept alongside the order total because the
    // two are allowed to differ (a discount applied after checkout), and the
    // receipt must show what was actually taken.
    amount: { type: Number, min: 0, default: 0 },
    currency: { type: String, default: 'BDT' },
    paidAt: { type: Date, default: null },
    // Why a payment failed, in words the shopper can be shown.
    message: { type: String, trim: true, default: '' },
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
    // How it is being paid for - see paymentSchema above. `paymentMethod` says
    // WHICH route the shopper picked (cash vs gateway); this says how far that
    // payment has actually got.
    payment: { type: paymentSchema, default: () => ({}) },

    status: {
      type: String,
      enum: ORDER_STATUS_VALUES,
      default: ORDER_STATUS.PENDING,
      index: true,
    },
    statusHistory: { type: [statusEntrySchema], default: [] },

    /* ---- Dispatch-board fields -------------------------------------------
     *
     * `deliveredAt` is DELIBERATELY denormalised rather than read back out of
     * `statusHistory`. "Completed today" is a range query, and a range query
     * over an array of sub-documents cannot use an index - so the dispatch
     * board would degrade into a collection scan exactly when a store is
     * busiest. One indexed Date is the whole fix. Stamped once, in
     * applyStatus(), it can never disagree with the history it mirrors.
     */
    deliveredAt: { type: Date, default: null, index: true },

    // A failed attempt, and why. Null on every order that has not failed.
    // `null` MUST be inside the enum: Mongoose skips enum validation for
    // `undefined` but NOT for `null`, so a default-null field whose enum
    // omitted null would refuse to save at all.
    failedReason: {
      type: String,
      enum: [...DELIVERY_FAILED_REASONS_VALUES, null],
      default: null,
    },
    failedAt: { type: Date, default: null },
    retryCount: { type: Number, min: 0, default: 0 },

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

/**
 * One transaction id per payment attempt, enforced by the database rather than
 * by application code - two checkouts must never be able to claim the same
 * transaction, or a callback could credit the wrong order.
 *
 * `partialFilterExpression` is doing real work here, and `sparse: true` is NOT
 * enough. A sparse index only skips documents where the field is MISSING; an
 * order with `payment.transactionId` explicitly set to `null` still gets
 * indexed, and the second cash-on-delivery order in the database would fail with
 * a duplicate-key 409. Every COD order carries that null, so the filter is
 * narrowed to documents where the field is actually a string - which is exactly
 * the set of orders that went through the gateway.
 */
orderSchema.index(
  { 'payment.transactionId': 1 },
  {
    unique: true,
    partialFilterExpression: { 'payment.transactionId': { $type: 'string' } },
  },
);

/** Shorthand used across the controllers: is this order still in play? */
orderSchema.virtual('isOpen').get(function isOpen() {
  // Closed means closed - `received` counts too. A customer-confirmed delivery
  // is finished, even though its `status` is not `delivered` any more, and any
  // list of live work that forgot that would show a done order forever.
  return !CLOSED_STATUSES.includes(this.status);
});

export const Order = mongoose.model('Order', orderSchema);
export default Order;
