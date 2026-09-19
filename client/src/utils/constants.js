// ---------------------------------------------------------------------------
// Single source of truth for values that the client, the REST API and the
// socket server all have to agree on. Change them here, not inline.
// ---------------------------------------------------------------------------

// --- Environment (see client/.env.example) ---------------------------------
export const API_BASE_URL =
  import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

export const SOCKET_URL =
  import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';

export const DEFAULT_CURRENCY = import.meta.env.VITE_DEFAULT_CURRENCY || 'USD';
export const DEFAULT_LOCALE = import.meta.env.VITE_DEFAULT_LOCALE || 'en-US';

// --- localStorage keys -----------------------------------------------------
export const STORAGE_KEYS = {
  TOKEN: 'da.token',
  USER: 'da.user',
  CART: 'da.cart',
  ADDRESS: 'da.lastAddress',
};

// --- User roles ------------------------------------------------------------
export const ROLES = {
  CUSTOMER: 'customer',
  RIDER: 'rider',
  STORE: 'store',
  ADMIN: 'admin',
};

// Roles that sign up with a username (it is how a store finds a rider).
export const ROLES_REQUIRING_USERNAME = [ROLES.RIDER, ROLES.STORE];

// --- Store <-> rider binding ----------------------------------------------
export const STORE_RIDER_STATUS = {
  PENDING: 'pending',
  ACTIVE: 'active',
  DECLINED: 'declined',
  REVOKED: 'revoked',
};

export const STORE_RIDER_STATUS_LABELS = {
  [STORE_RIDER_STATUS.PENDING]: 'Invitation sent',
  [STORE_RIDER_STATUS.ACTIVE]: 'Delivering',
  [STORE_RIDER_STATUS.DECLINED]: 'Declined',
  [STORE_RIDER_STATUS.REVOKED]: 'Removed',
};

// --- Order lifecycle -------------------------------------------------------
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

// The happy path in order - used by the tracker timeline and rider buttons.
export const ORDER_STATUS_FLOW = [
  ORDER_STATUS.PENDING,
  ORDER_STATUS.CONFIRMED,
  ORDER_STATUS.PREPARING,
  ORDER_STATUS.READY_FOR_PICKUP,
  ORDER_STATUS.PICKED_UP,
  ORDER_STATUS.OUT_FOR_DELIVERY,
  ORDER_STATUS.DELIVERED,
];

export const ORDER_STATUS_LABELS = {
  [ORDER_STATUS.PENDING]: 'Pending',
  [ORDER_STATUS.CONFIRMED]: 'Confirmed',
  [ORDER_STATUS.PREPARING]: 'Preparing',
  [ORDER_STATUS.READY_FOR_PICKUP]: 'Ready for pickup',
  [ORDER_STATUS.PICKED_UP]: 'Picked up',
  [ORDER_STATUS.OUT_FOR_DELIVERY]: 'Out for delivery',
  [ORDER_STATUS.DELIVERED]: 'Delivered',
  [ORDER_STATUS.CANCELLED]: 'Cancelled',
};

// Maps a status to a badge colour class defined in index.css
export const ORDER_STATUS_TONE = {
  [ORDER_STATUS.PENDING]: 'warn',
  [ORDER_STATUS.CONFIRMED]: 'info',
  [ORDER_STATUS.PREPARING]: 'info',
  [ORDER_STATUS.READY_FOR_PICKUP]: 'info',
  [ORDER_STATUS.PICKED_UP]: 'active',
  [ORDER_STATUS.OUT_FOR_DELIVERY]: 'active',
  [ORDER_STATUS.DELIVERED]: 'success',
  [ORDER_STATUS.CANCELLED]: 'danger',
};

// --- Pricing ---------------------------------------------------------------
export const DELIVERY_FEE = 2.5;
export const FREE_DELIVERY_OVER = 50;

// --- Map defaults (change DEFAULT_CENTER to your own city) -----------------
export const MAP = {
  DEFAULT_CENTER: [27.7172, 85.324],
  DEFAULT_ZOOM: 13,
  TILE_URL: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  ATTRIBUTION:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
};

// --- Socket.io event names (must match the server exactly) -----------------
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

// --- Client routes ---------------------------------------------------------
export const ROUTES = {
  HOME: '/',
  LOGIN: '/login',
  REGISTER: '/register',
  STORE: '/store',
  CHECKOUT: '/checkout',
  ORDER_TRACKER: '/track/:orderId',
  RIDER_CONSOLE: '/rider',
  MERCHANT_DASHBOARD: '/merchant',
  ADMIN_DASHBOARD: '/admin',
  ADMIN_PRODUCTS: '/admin/products',
  ADMIN_STORES: '/admin/stores',
  PROFILE: '/profile',
  // A store's public storefront: /s/<slug> (see shopPath below).
  SHOP: '/s/:slug',
};

// Build a real tracker URL from an order id: orderTrackerPath('abc') -> /track/abc
export const orderTrackerPath = (orderId) => `/track/${orderId}`;

// Build a store's public URL: shopPath('joes-pizza') -> /s/joes-pizza
export const shopPath = (slug) => `/s/${slug}`;

// Where each role lands after a successful login.
export const HOME_ROUTE_BY_ROLE = {
  [ROLES.CUSTOMER]: ROUTES.STORE,
  [ROLES.RIDER]: ROUTES.RIDER_CONSOLE,
  [ROLES.STORE]: ROUTES.MERCHANT_DASHBOARD,
  [ROLES.ADMIN]: ROUTES.ADMIN_DASHBOARD,
};
