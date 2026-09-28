// ---------------------------------------------------------------------------
// Single source of truth for values that the client, the REST API and the
// socket server all have to agree on. Change them here, not inline.
// ---------------------------------------------------------------------------

// --- Environment (see client/.env.example, client/.env.production) ---------
// Same-origin friendly: when the built site is served by the backend itself
// (one Cloudflare URL for app + API), VITE_API_URL=/api and VITE_SOCKET_URL=/
// resolve against window.location.origin so the phone uses the tunnel host
// instead of localhost. `.env.production` sets both automatically for builds.
//
// Values are trimmed first: a stray space is not harmless here. Building with
// `set VITE_API_URL=/api && ...` in cmd.exe stores "/api " (the space before
// `&&` becomes part of the value), and every request then became
// `/api%20/auth/login` -> "Route not found". Trim makes that impossible.
const readEnv = (value) => (typeof value === 'string' ? value.trim() : '');

// "/api/" + "/auth/login" would otherwise double the slash.
const dropTrailingSlash = (value) =>
  value.length > 1 ? value.replace(/\/+$/, '') : value;

const sameOrigin = typeof window !== 'undefined' ? window.location.origin : '';

const resolveApiUrl = (raw) => {
  const value = readEnv(raw);
  if (!value) return 'http://localhost:5000/api';
  if (value.startsWith('/')) return `${sameOrigin}${dropTrailingSlash(value)}`;
  return dropTrailingSlash(value);
};
const resolveSocketUrl = (raw) => {
  const value = readEnv(raw);
  // "/" means "the host serving this page"; socket.io only needs the origin.
  if (!value || value === '/') return sameOrigin || 'http://localhost:5000';
  if (value.startsWith('/')) return `${sameOrigin}${dropTrailingSlash(value)}`;
  return dropTrailingSlash(value);
};

export const API_BASE_URL = resolveApiUrl(import.meta.env.VITE_API_URL);

export const SOCKET_URL = resolveSocketUrl(import.meta.env.VITE_SOCKET_URL);

export const DEFAULT_CURRENCY = import.meta.env.VITE_DEFAULT_CURRENCY || 'USD';
export const DEFAULT_LOCALE = import.meta.env.VITE_DEFAULT_LOCALE || 'en-US';

// --- Guest orders ------------------------------------------------------------
// A shopper without an account gets a secret token per order at checkout
// (backend returns `guestToken` once). It unlocks ONLY that order's tracker
// (GET /orders/:id?guestToken=…) — no account, no order history.
const guestTokenKey = (orderId) => `da.guestToken.${orderId}`;

export function saveGuestToken(orderId, token) {
  if (!orderId || !token) return;
  try {
    localStorage.setItem(guestTokenKey(orderId), token);
  } catch {
    // private mode — the tracker link still works without the stored token
  }
}

export function getGuestToken(orderId) {
  if (!orderId) return null;
  try {
    return localStorage.getItem(guestTokenKey(orderId)) || null;
  } catch {
    return null;
  }
}

export function clearGuestToken(orderId) {
  if (!orderId) return;
  try {
    localStorage.removeItem(guestTokenKey(orderId));
  } catch {
    // ignore
  }
}

// --- Guest tokens across a payment redirect ---------------------------------
// The payment round trip loses the order id: the gateway sends the shopper back
// to /payment-success?tran_id=… and nothing else. But the guest token is stored
// per ORDER, so without a second link the success page could not prove the
// guest is the one who placed the order - and their own receipt would 403.
//
// So the token is ALSO written under the transaction id, which the checkout page
// knows and the success page receives. Kept in its own key space so clearing an
// order's token does not silently strand a transaction in flight.
const guestTokenTranKey = (tranId) => `da.guestTokenForTran.${tranId}`;

/** Called right after /payment/init returns, before the redirect away. */
export function linkGuestTokenToTran(tranId, orderId) {
  const token = getGuestToken(orderId);
  if (!tranId || !token) return;
  try {
    localStorage.setItem(guestTokenTranKey(tranId), token);
  } catch {
    // private mode - the receipt page just falls back to asking the customer
    // to sign in, which is a worse experience but not a broken one
  }
}

export function getGuestTokenForTran(tranId) {
  if (!tranId) return null;
  try {
    return localStorage.getItem(guestTokenTranKey(tranId)) || null;
  } catch {
    return null;
  }
}

export function clearGuestTokenForTran(tranId) {
  if (!tranId) return;
  try {
    localStorage.removeItem(guestTokenTranKey(tranId));
  } catch {
    // ignore
  }
}

// --- localStorage keys -----------------------------------------------------
export const STORAGE_KEYS = {
  TOKEN: 'da.token',
  USER: 'da.user',
  STORES: 'da.stores',
  // The stores this account *shops at* - not the ones it runs. See
  // STORE_CUSTOMER_STATUS below.
  CUSTOMER_STORES: 'da.customerStores',
  // The last storefront (/s/<slug>) visited on this device - logout reads it
  // back so a shopper lands on THE store they were visiting, not /login.
  LAST_STORE: 'da.lastStore',
  CART: 'da.cart',
  ADDRESS: 'da.lastAddress',
};

// --- User roles ------------------------------------------------------------
export const ROLES = {
  CUSTOMER: 'customer',
  RIDER: 'rider',
  STORE: 'store',
  // Signs up to *work at* stores: a store owner appoints them and they then
  // run that store's products and orders. Mirrors the backend constant.
  STORE_ADMIN: 'storeadmin',
  ADMIN: 'admin',
};

// Roles that sign up with a username (it is how a store finds a rider,
// and how an owner finds a store admin to appoint).
export const ROLES_REQUIRING_USERNAME = [
  ROLES.RIDER,
  ROLES.STORE,
  ROLES.STORE_ADMIN,
];

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

// --- Store <-> customer binding -------------------------------------------
// A shopper signs up (or signs in) on a store's public page, and that store
// becomes "their" store. Signing up at /s/<slug> is what puts the account on
// the store's customer list. Mirrors the backend constant.
export const STORE_CUSTOMER_STATUS = {
  ACTIVE: 'active',
  BLOCKED: 'blocked',
};

// How the customer first arrived at the store. Set once, never overwritten.
export const STORE_CUSTOMER_SOURCE = {
  SIGNUP: 'signup',
  LOGIN: 'login',
  ORDER: 'order',
};

export const STORE_CUSTOMER_SOURCE_LABELS = {
  [STORE_CUSTOMER_SOURCE.SIGNUP]: 'Signed up here',
  [STORE_CUSTOMER_SOURCE.LOGIN]: 'Signed in here',
  [STORE_CUSTOMER_SOURCE.ORDER]: 'Ordered here',
};

// --- Payments --------------------------------------------------------------
// Mirrors PAYMENT_METHODS in backend/src/utils/constants.js.
//
// The five ways to pay, in the order they are offered. `cod` is first and is the
// default because it is the one that always works - no gateway credentials, no
// card, no redirect.
//
// The four online channels are CHANNELS, not gateways: bKash/Nagad/Rocket are
// mobile financial services. They are recorded faithfully on the order so a
// store can report what people actually choose; see the README on what the
// gateway does with them.
export const PAYMENT_METHODS = {
  COD: 'cod',
  CARD: 'card',
  BKASH: 'bkash',
  NAGAD: 'nagad',
  ROCKET: 'rocket',
};

// Everything except cash, in one list - the online channels, which is what the
// gateway step is actually for.
export const ONLINE_PAYMENT_CHANNELS = [
  PAYMENT_METHODS.BKASH,
  PAYMENT_METHODS.NAGAD,
  PAYMENT_METHODS.ROCKET,
  PAYMENT_METHODS.CARD,
];

export const PAYMENT_METHOD_LABELS = {
  [PAYMENT_METHODS.COD]: 'Cash on delivery',
  [PAYMENT_METHODS.CARD]: 'Card',
  [PAYMENT_METHODS.BKASH]: 'bKash',
  [PAYMENT_METHODS.NAGAD]: 'Nagad',
  [PAYMENT_METHODS.ROCKET]: 'Rocket',
};

export const PAYMENT_METHOD_HINTS = {
  [PAYMENT_METHODS.COD]: 'Pay the rider in cash when they hand the order over.',
  [PAYMENT_METHODS.CARD]: 'Visa, Mastercard or Amex.',
  [PAYMENT_METHODS.BKASH]: 'Pay from your bKash wallet.',
  [PAYMENT_METHODS.NAGAD]: 'Pay from your Nagad wallet.',
  [PAYMENT_METHODS.ROCKET]: 'Pay from your Rocket wallet.',
};

// Brand colours, used for the channel's chip. Kept here rather than in the
// component so the same swatch is used wherever a channel is named.
export const PAYMENT_METHOD_COLORS = {
  [PAYMENT_METHODS.BKASH]: '#e2136e',
  [PAYMENT_METHODS.NAGAD]: '#ee7623',
  [PAYMENT_METHODS.ROCKET]: '#8c3494',
  [PAYMENT_METHODS.CARD]: '#1a1f71',
  [PAYMENT_METHODS.COD]: '#64748b',
};

export const isOnlinePayment = (method) =>
  ONLINE_PAYMENT_CHANNELS.includes(method);

export const PAYMENT_STATUS = {
  PENDING: 'Pending',
  PAID: 'Paid',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
};

export const PAYMENT_STATUS_TONE = {
  [PAYMENT_STATUS.PENDING]: 'warn',
  [PAYMENT_STATUS.PAID]: 'success',
  [PAYMENT_STATUS.FAILED]: 'danger',
  [PAYMENT_STATUS.CANCELLED]: 'danger',
};

// --- Order lifecycle -------------------------------------------------------
export const ORDER_STATUS = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  PREPARING: 'preparing',
  READY_FOR_PICKUP: 'ready_for_pickup',
  PICKED_UP: 'picked_up',
  OUT_FOR_DELIVERY: 'out_for_delivery',
  // The rider has handed it over. The order is not over yet though - see
  // RECEIVED below.
  DELIVERED: 'delivered',
  // The customer pressed "Confirm delivery received". This is the only state in
  // which a review may be written, so it is a real status rather than a
  // cosmetic rename of `delivered`.
  RECEIVED: 'received',
  CANCELLED: 'cancelled',
};

// The happy path in order - used by the rider console's "next step" button and
// by the server to validate rider transitions.
//
// `received` is deliberately absent: a rider's job ends at the doorstep. Only the
// customer can close the loop (PATCH /orders/:id/receive), which is what stops a
// rider from marking a parcel received on the customer's behalf. Mirror of
// ORDER_STATUS_FLOW in backend/src/utils/constants.js - keep both in sync.
export const ORDER_STATUS_FLOW = [
  ORDER_STATUS.PENDING,
  ORDER_STATUS.CONFIRMED,
  ORDER_STATUS.PREPARING,
  ORDER_STATUS.READY_FOR_PICKUP,
  ORDER_STATUS.PICKED_UP,
  ORDER_STATUS.OUT_FOR_DELIVERY,
  ORDER_STATUS.DELIVERED,
];

// What the Progress timeline draws. Same as the rider's flow plus the one stop
// only the customer can reach, so a shopper watching the tracker sees the final
// step light up when they confirm. Mirror of TRACKER_FLOW in the backend.
export const TRACKER_FLOW = [...ORDER_STATUS_FLOW, ORDER_STATUS.RECEIVED];

// A status nothing more will happen to. Used wherever a "live"/"in progress"
// list is built (rider console, merchant dashboard, orders boards) so a
// received order stops being counted as unfinished work.
export const CLOSED_STATUSES = [
  ORDER_STATUS.DELIVERED,
  ORDER_STATUS.RECEIVED,
  ORDER_STATUS.CANCELLED,
];

// The ONLY status moves the admin panel may make from an order page: a confirmed
// order starts being prepared, and a preparing one becomes ready for pickup.
// Nothing else is offered, so the panel can never skip, rewind, or mark a
// delivery finished - the rider owns it from pickup on, and the customer may
// still cancel. The server enforces the identical table
// (ADMIN_STATUS_STEPS in backend/src/utils/constants.js) - keep both in sync.
export const ADMIN_STATUS_STEPS = {
  [ORDER_STATUS.CONFIRMED]: ORDER_STATUS.PREPARING,
  [ORDER_STATUS.PREPARING]: ORDER_STATUS.READY_FOR_PICKUP,
};

export const ORDER_STATUS_LABELS = {
  [ORDER_STATUS.PENDING]: 'Pending',
  [ORDER_STATUS.CONFIRMED]: 'Confirmed',
  [ORDER_STATUS.PREPARING]: 'Preparing',
  [ORDER_STATUS.READY_FOR_PICKUP]: 'Ready for pickup',
  [ORDER_STATUS.PICKED_UP]: 'Picked up',
  [ORDER_STATUS.OUT_FOR_DELIVERY]: 'Out for delivery',
  [ORDER_STATUS.DELIVERED]: 'Delivered',
  // "Delivery received" rather than another "delivered": the rider's `delivered`
  // means they dropped it off, and this means it is in the customer's hands. The
  // two words are kept distinct on purpose so the timeline reads as two
  // different facts instead of the same one stated twice.
  [ORDER_STATUS.RECEIVED]: 'Delivery received',
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
  [ORDER_STATUS.RECEIVED]: 'success',
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
// --- Customer routes, scoped to the store they belong to -------------------
// Keeps the store slug in the URL after login: /s/<slug> -> /s/<slug>/profile
// instead of dropping to a global /profile. Public catalogue URLs keep their
// old shapes so shared links never break.
export const customerPath = (slug, suffix = '') =>
  slug ? `/s/${slug}${suffix ? `/${suffix}` : ''}` : `/${suffix || ''}`;

export const ROUTES = {
  HOME: '/',
  LOGIN: '/login',
  REGISTER: '/register',
  STORE: '/store',
  CHECKOUT: '/checkout',
  // Checkout inside a storefront: /s/<slug>/checkout (see checkoutPath below).
  // The bare /checkout stays for old links and bounces to the scoped URL
  // when a store slug is known.
  STORE_CHECKOUT: '/s/:slug/checkout',
  ORDER_TRACKER: '/track/:orderId',
  RIDER_CONSOLE: '/rider',
  // One delivery opened from the rider's own pages, mounted INSIDE the rider
  // shell so the side rail stays put - the same trick the admin order view uses.
  // Without it the link would leave the dashboard for /track/:orderId and the
  // rider would land on the public navbar.
  RIDER_ORDER: '/rider/orders/:orderId',  MERCHANT_DASHBOARD: '/merchant',
  // How long the rider's own deliveries took, stage by stage.
  RIDER_ANALYTICS: '/rider/analytics',
  MERCHANT_PRODUCTS: '/merchant/products',
  // How long this store's deliveries take, per rider. Same numbers the rider
  // sees about themselves, read off the orders' own status history.
  MERCHANT_ANALYTICS: '/merchant/analytics',
  // Live map of every delivery in progress. Reached from the ADMIN panel now
  // (/admin/riders) - it is an operations view across the stores an admin runs,
  // so it sits beside the orders board rather than in the store dashboard.
  ADMIN_RIDERS: '/admin/riders',
  MERCHANT_THEME: '/merchant/theme',  ADMIN_DASHBOARD: '/admin',
  ADMIN_PRODUCTS: '/admin/products',
  // Store->admin invitations: the admin accepts/declines stores that asked
  // them to help run them (replaces the old admin-only Stores tab).
  ADMIN_INVITATIONS: '/admin/invitations',
  // One order opened from the orders board. It lives INSIDE the admin
  // DashboardLayout group so the side rail stays visible (the customer's
  // /track/:orderId sits outside it and shows the top navbar instead).
  ADMIN_ORDER: '/admin/orders/:orderId',
  // The same order view reached from the admin's Rider tracker, so "back" goes
  // to the tracker rather than to the orders board. Same page, different origin.
  ADMIN_RIDER_ORDER: '/admin/riders/:orderId',
  ADMIN_THEME: '/admin/theme',
  PROFILE: '/profile',
  // A customer's own profile INSIDE their store: /s/<slug>/profile (see
  // customerPath). The bare /profile stays for staff + deep links and
  // redirects customers to their scoped page.
  STORE_PROFILE: '/s/:slug/profile',
  // A store's public storefront: /s/<slug> (see shopPath below).
  SHOP: '/s/:slug',
  // Where the backend sends the shopper after the payment gateway sends them
  // back. NOT store-scoped: these URLs are generated by the server on the way
  // out of SSLCommerz, which knows nothing about which store the basket came
  // from. Both read ?tran_id=… and ask the API what actually happened.
  PAYMENT_SUCCESS: '/payment-success',
  PAYMENT_FAILED: '/payment-failed',
};

// Build a real tracker URL from an order id: orderTrackerPath('abc') -> /track/abc
export const orderTrackerPath = (orderId) => `/track/${orderId}`;

// The same order opened from the admin orders board. Same page component, but
// rendered inside the side-navbar shell: adminOrderPath('abc') -> /admin/orders/abc
export const adminOrderPath = (orderId) => `/admin/orders/${orderId}`;

// Build a store's public URL: shopPath('joes-pizza') -> /s/joes-pizza
export const shopPath = (slug) => `/s/${slug}`;

// Build a store's checkout URL: checkoutPath('joes-pizza') -> /s/joes-pizza/checkout.
// No store known (old bookmark, guest who never opened a storefront) keeps the
// bare /checkout.
export const checkoutPath = (slug) => customerPath(slug, 'checkout');

// Every /s/<slug> page records its slug here, so the app always knows which
// storefront the shopper is (or was last) looking at. Navbar logout reads it
// back to send customers to that store instead of the staff login page.
export function rememberStoreVisit(slug) {
  if (!slug) return;
  try {
    localStorage.setItem(STORAGE_KEYS.LAST_STORE, slug);
  } catch {
    // private mode - logout then falls back to the account's home store
  }
}

export function lastStoreVisit() {
  try {
    return localStorage.getItem(STORAGE_KEYS.LAST_STORE) || null;
  } catch {
    return null;
  }
}

// Where each role lands after a successful login.
export const HOME_ROUTE_BY_ROLE = {
  [ROLES.CUSTOMER]: ROUTES.STORE,
  [ROLES.RIDER]: ROUTES.RIDER_CONSOLE,
  [ROLES.STORE]: ROUTES.MERCHANT_DASHBOARD,
  // A store admin lands on the store dashboard too; until an owner appoints
  // them it explains how to get appointed.
  [ROLES.STORE_ADMIN]: ROUTES.MERCHANT_DASHBOARD,
  [ROLES.ADMIN]: ROUTES.ADMIN_DASHBOARD,
};
