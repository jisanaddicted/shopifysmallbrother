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
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled',
};

export const ORDER_STATUS_VALUES = Object.values(ORDER_STATUS);

// The happy path in order - used to validate rider status transitions.
export const ORDER_STATUS_FLOW = [
  ORDER_STATUS.PENDING,
  ORDER_STATUS.CONFIRMED,
  ORDER_STATUS.PREPARING,
  ORDER_STATUS.READY_FOR_PICKUP,
  ORDER_STATUS.PICKED_UP,
  ORDER_STATUS.OUT_FOR_DELIVERY,
  ORDER_STATUS.DELIVERED,
];

// A customer may cancel while the parcel is still with the store.
export const CANCELLABLE_STATUSES = [
  ORDER_STATUS.PENDING,
  ORDER_STATUS.CONFIRMED,
  ORDER_STATUS.PREPARING,
  ORDER_STATUS.READY_FOR_PICKUP,
];

export const PAYMENT_METHODS = ['cod', 'card'];

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
  CANCELLABLE_STATUSES,
  PAYMENT_METHODS,
  DELIVERY_FEE,
  FREE_DELIVERY_OVER,
  SOCKET_EVENTS,
};
