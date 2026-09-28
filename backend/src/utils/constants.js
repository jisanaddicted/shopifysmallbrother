// ---------------------------------------------------------------------------
// Mirror of client/src/utils/constants.js - the API and the browser have to
// agree on these values, so keep both files in sync when you change one.
// ---------------------------------------------------------------------------

export const ROLES = {
  CUSTOMER: 'customer',
  RIDER: 'rider',
  STORE: 'store',
  // Signs up to *work at* stores: an owner appoints them and they then run
  // the store's products and orders. They keep this role even after being
  // appointed; the store list in their session is what opens the dashboard.
  STORE_ADMIN: 'storeadmin',
  ADMIN: 'admin',
};

export const ROLE_VALUES = Object.values(ROLES);

// Roles somebody can pick on the public register form. Platform admins are
// only ever created by a seeder or an existing admin.
export const SELF_SIGNUP_ROLES = [
  ROLES.CUSTOMER,
  ROLES.RIDER,
  ROLES.STORE,
  ROLES.STORE_ADMIN,
];

// Roles that must have a unique username (it is how stores/admins find them).
export const ROLES_REQUIRING_USERNAME = [
  ROLES.RIDER,
  ROLES.STORE,
  ROLES.STORE_ADMIN,
];

// ---------------------------------------------------------------------------
// Store <-> rider binding.
//
// A store (or an admin) invites a rider by username; the rider then accepts or
// declines. Only "active" bindings may see that store's orders.
// ---------------------------------------------------------------------------
export const STORE_RIDER_STATUS = {
  PENDING: 'pending',
  ACTIVE: 'active',
  DECLINED: 'declined',
  REVOKED: 'revoked',
};

export const STORE_RIDER_STATUS_VALUES = Object.values(STORE_RIDER_STATUS);

// What a store membership can be: a delivery rider, or a store admin who
// helps run the storefront (orders, roster) without owning it. The
// StoreRider model's enum must stay in sync with these values.
export const STORE_MEMBER_ROLES = {
  RIDER: 'rider',
  ADMIN: 'admin',
};

export const STORE_MEMBER_ROLE_VALUES = Object.values(STORE_MEMBER_ROLES);

// ---------------------------------------------------------------------------
// Store <-> customer binding.
//
// A shopper who signs up from a store's public page (/s/<slug>) creates their
// account *at that store*, and this is what records the relationship. It is
// also created when they sign in from a store page or order from one, so an
// account can be a customer of several stores.
//
// Mirror of client/src/utils/constants.js - keep the two in sync.
// ---------------------------------------------------------------------------
export const STORE_CUSTOMER_STATUS = {
  ACTIVE: 'active',
  // A store can stop a customer from ordering again. A later login does not
  // lift this - only the store (or an admin) can.
  BLOCKED: 'blocked',
};

export const STORE_CUSTOMER_STATUS_VALUES = Object.values(STORE_CUSTOMER_STATUS);

// How the customer first joined the store. Stored once, never overwritten.
export const STORE_CUSTOMER_SOURCE = {
  SIGNUP: 'signup',
  LOGIN: 'login',
  ORDER: 'order',
};

export const STORE_CUSTOMER_SOURCE_VALUES = Object.values(STORE_CUSTOMER_SOURCE);

export const ORDER_STATUS = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  PREPARING: 'preparing',
  READY_FOR_PICKUP: 'ready_for_pickup',
  PICKED_UP: 'picked_up',
  OUT_FOR_DELIVERY: 'out_for_delivery',
  // The rider has handed the parcel over. Not the end of the story: the order is
  // only really finished once the CUSTOMER says it turned up.
  DELIVERED: 'delivered',
  // The customer confirmed receipt. This is the step a review hangs off, so it
  // is deliberately a separate status rather than a rename of `delivered` -
  // "the rider dropped it" and "the customer got it" are two different claims.
  RECEIVED: 'received',
  CANCELLED: 'cancelled',
};

export const ORDER_STATUS_VALUES = Object.values(ORDER_STATUS);

// The happy path in order - used to validate rider status transitions.
//
// `received` is NOT in here on purpose: this table is what a RIDER may walk an
// order along, and the last thing a rider does is drop the parcel off. Closing
// the loop is the customer's move, through PATCH /orders/:id/receive. Leave it
// out and a rider can neither reach nor skip to it.
export const ORDER_STATUS_FLOW = [
  ORDER_STATUS.PENDING,
  ORDER_STATUS.CONFIRMED,
  ORDER_STATUS.PREPARING,
  ORDER_STATUS.READY_FOR_PICKUP,
  ORDER_STATUS.PICKED_UP,
  ORDER_STATUS.OUT_FOR_DELIVERY,
  ORDER_STATUS.DELIVERED,
];

// What the tracker draws, and the only place `received` appears in a sequence.
// The rider's progress bar stops at "delivered" (that is as far as they can
// take it); the customer's bar has one more stop, which only lights up once they
// have pressed the button. Mirror of TRACKER_FLOW in client/src/utils/constants.js.
export const TRACKER_FLOW = [...ORDER_STATUS_FLOW, ORDER_STATUS.RECEIVED];

// A status nothing more will happen to. Anything counting "live" orders, or
// deciding whether a rider still owns a job, must use this list rather than
// comparing against `delivered` alone - otherwise a received order looks like
// unfinished work forever.
export const CLOSED_STATUSES = [
  ORDER_STATUS.DELIVERED,
  ORDER_STATUS.RECEIVED,
  ORDER_STATUS.CANCELLED,
];

// The statuses a customer may confirm receipt FROM. Only once the rider has
// actually delivered - confirming a parcel that is still on the road (or
// cancelling one that has not left) would be a lie the review then inherits.
export const RECEIVABLE_STATUSES = [ORDER_STATUS.DELIVERED];

// A customer may cancel while the parcel is still with the store.
export const CANCELLABLE_STATUSES = [
  ORDER_STATUS.PENDING,
  ORDER_STATUS.CONFIRMED,
  ORDER_STATUS.PREPARING,
  ORDER_STATUS.READY_FOR_PICKUP,
];

// The ONLY status moves a platform admin may make: what the kitchen is doing
// with an order before a rider collects it. Each key is the status the order has
// to be sitting at for the move to be allowed, and each value is the single
// status it may become.
//
// Deliberately just these two steps. Everything else about a delivery belongs to
// somebody else - the rider drives it out and marks it delivered, the customer
// may cancel - so the admin panel can neither skip ahead, rewind the kitchen,
// nor hand an order over as finished. `PATCH /orders/:id/status` enforces this
// server-side; the button in the admin order page reads the same table.
//
// Mirror of ADMIN_STATUS_STEPS in client/src/utils/constants.js.
export const ADMIN_STATUS_STEPS = {
  [ORDER_STATUS.CONFIRMED]: ORDER_STATUS.PREPARING,
  [ORDER_STATUS.PREPARING]: ORDER_STATUS.READY_FOR_PICKUP,
};

// How the buyer intends to pay. `cod` needs no gateway; the rest are online
// channels, chosen from the custom radio list on the checkout form.
//
// NOTE: these are CHANNELS, not gateways. bKash/Nagad/Rocket are mobile
// financial services; SSLCommerz surfaces them under its mobile-banking option
// rather than as card brands. They are stored faithfully on the order either
// way, so the store can see what people actually choose.
export const PAYMENT_METHODS = [
  'cod',
  'card',
  'bkash',
  'nagad',
  'rocket',
];

/**
 * Which `multi_card_name` to send for each channel.
 *
 * `multi_card_name` is SSLCommerz's CARD-BRAND filter, and its documented
 * values are things like `visa-mastercard`, `visa`, `master`, `amex`. Verified
 * against the sandbox: sending `bkash` / `nagad` / `rocket` is ACCEPTED without
 * an error, but it is not a card brand and it does not reliably deep-link to
 * that MFS's number-entry screen - the gateway still renders its own channel
 * list.
 *
 * So the mapping is honest rather than hopeful: the card channel gets a real,
 * valid value that genuinely filters, and the mobile channels are passed
 * through as themselves (accepted, recorded, and the right thing to send if a
 * store later enables them as mobile-banking options) rather than pretending
 * `visa-mastercard` means bKash.
 */
export const PAYMENT_CHANNEL_MULTI_CARD = {
  card: 'visa-mastercard',
  bkash: 'bkash',
  nagad: 'nagad',
  rocket: 'rocket',
};

// ---------------------------------------------------------------------------
// Payments (SSLCommerz sandbox + cash on delivery)
// ---------------------------------------------------------------------------

// How a payment attempt ended. Capitalised exactly as the spec asked for, and
// deliberately a DIFFERENT axis from ORDER_STATUS: an order is "delivered" or
// not, a payment is "Paid" or not. They are tracked independently, because
// cash-on-delivery orders are only ever marked paid when the rider hands over
// the money, whereas an online payment is settled long before the parcel moves.
export const PAYMENT_STATUS = {
  PENDING: 'Pending',
  PAID: 'Paid',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
};

export const PAYMENT_STATUS_VALUES = Object.values(PAYMENT_STATUS);

// Who processed it. `cod` is not a gateway - it is the deliberate absence of one.
export const PAYMENT_PROVIDER = {
  COD: 'cod',
  SSLCOMMERZ: 'sslc',
};

// Short prefixes for the transaction id. `txn_` for anything a customer placed,
// so a demo database is readable at a glance.
export const TRANSACTION_PREFIX = {
  GUEST: 'txn_guest_',
  CUSTOMER: 'txn_',
};

// Pricing rules - must match client/src/utils/constants.js + CartContext.
export const DELIVERY_FEE = 2.5;
export const FREE_DELIVERY_OVER = 50;

// ---------------------------------------------------------------------------
// Socket.io event names. These MUST match client/src/utils/constants.js
// (SOCKET_EVENTS) - a typo here means live updates silently stop working.
// ---------------------------------------------------------------------------
export const SOCKET_EVENTS = {
  JOIN_ORDER: 'order:join',
  LEAVE_ORDER: 'order:leave',
  RIDER_LOCATION: 'rider:location',
  RIDER_LOCATION_UPDATED: 'rider:location:updated',
  ORDER_STATUS_UPDATED: 'order:status:updated',
  // Fired the moment an order lands: riders bound to that store hear it live.
  ORDER_NEW: 'order:new',
  SERVER_ERROR: 'server:error',
};

export default {
  ROLES,
  ROLE_VALUES,
  SELF_SIGNUP_ROLES,
  ORDER_STATUS,
  ORDER_STATUS_VALUES,
  ORDER_STATUS_FLOW,
  TRACKER_FLOW,
  CLOSED_STATUSES,
  RECEIVABLE_STATUSES,
  ADMIN_STATUS_STEPS,
  CANCELLABLE_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_CHANNEL_MULTI_CARD,
  PAYMENT_STATUS,
  PAYMENT_STATUS_VALUES,
  PAYMENT_PROVIDER,
  TRANSACTION_PREFIX,
  DELIVERY_FEE,
  FREE_DELIVERY_OVER,
  SOCKET_EVENTS,
};
