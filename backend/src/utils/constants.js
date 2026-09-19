// ---------------------------------------------------------------------------
// Mirror of client/src/utils/constants.js - the API and the browser have to
// agree on these values, so keep both files in sync when you change one.
// ---------------------------------------------------------------------------

export const ROLES = {
  CUSTOMER: 'customer',
  RIDER: 'rider',
  STORE: 'store',
  ADMIN: 'admin',
};

export const ROLE_VALUES = Object.values(ROLES);

// Roles somebody can pick on the public register form. Admins are only ever
// created by a seeder or an existing admin.
export const SELF_SIGNUP_ROLES = [ROLES.CUSTOMER, ROLES.RIDER, ROLES.STORE];

// Roles that must have a unique username (it is how stores/admins find them).
export const ROLES_REQUIRING_USERNAME = [ROLES.RIDER, ROLES.STORE];

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
