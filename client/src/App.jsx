import { lazy, Suspense } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Navbar from './components/common/Navbar';
import DashboardLayout from './components/common/DashboardLayout';
import ProtectedRoute from './components/common/ProtectedRoute';
import CustomerLogin from './pages/auth/CustomerLogin';
import CustomerRegister from './pages/auth/CustomerRegister';
import CartDrawer from './components/store/CartDrawer';
import { useAuth } from './context/AuthContext';
import LoadingSpinner from './components/common/LoadingSpinner';
import { ROLES, ROUTES } from './utils/constants';

/**
 * Pages are code-split, not eagerly imported.
 *
 * Every page used to be a top-level import, so the browser downloaded and parsed
 * all of them - including the rider/admin screens nobody had opened - before it
 * could paint anything. Two concrete costs that came out of that:
 *
 *   - Leaflet (151KB of map code) was pulled in on EVERY page, but only the
 *     rider map pages use it.
 *   - A shopper landing on a storefront paid for the entire staff portal.
 *
 * `lazy` defers each page to its own chunk, fetched the first time that route
 * is actually visited. The two auth pages stay eager on purpose: they are the
 * entry point for a signed-out visitor and the destination of the very first
 * navigation, so deferring them would only add a round trip before anything
 * could be shown.
 */
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'));
const AdminInvitations = lazy(() => import('./pages/admin/AdminInvitations'));
const ProductManager = lazy(() => import('./pages/admin/ProductManager'));
const ProductEditor = lazy(() => import('./pages/admin/ProductEditor'));

const Login = lazy(() => import('./pages/auth/Login'));
const Register = lazy(() => import('./pages/auth/Register'));
const ProfilePage = lazy(() => import('./pages/profile/ProfilePage'));
const Checkout = lazy(() => import('./pages/customer/Checkout'));
const OrderSuccess = lazy(() => import('./pages/customer/OrderSuccess'));
const OrderTracker = lazy(() => import('./pages/customer/OrderTracker'));
const PaymentFailed = lazy(() => import('./pages/customer/PaymentFailed'));
const PaymentSuccess = lazy(() => import('./pages/customer/PaymentSuccess'));
const ShopPage = lazy(() => import('./pages/customer/ShopPage'));
const Storefront = lazy(() => import('./pages/customer/Storefront'));
const MerchantDashboard = lazy(() => import('./pages/store/MerchantDashboard'));
const StoreRiderAnalytics = lazy(() =>
  import('./pages/store/StoreRiderAnalytics')
);
const StoreOrders = lazy(() => import('./pages/store/StoreOrders'));
const StoreCustomers = lazy(() => import('./pages/store/StoreCustomers'));
const RiderTracker = lazy(() => import('./pages/store/RiderTracker'));
const ThemeBuilder = lazy(() => import('./pages/store/ThemeBuilder'));
const RiderConsole = lazy(() => import('./pages/rider/RiderConsole'));
const RiderAnalytics = lazy(() => import('./pages/rider/RiderAnalytics'));

/**
 * Shown while a page chunk is in flight.
 *
 * Sized to roughly a page of content so the layout does not jump when the real
 * page replaces it, and centred so it reads as "loading" rather than as a
 * broken empty screen.
 */
function PageFallback() {
  return (
    <div className="page">
      <LoadingSpinner label="Loading…" />
    </div>
  );
}

/** "/" sends everyone to the right home page for their role. */
function HomeRedirect() {
  const { isAuthenticated, user, runsStore, homeRoute } = useAuth();

  // Signed out -> the staff portal login (the app entry point: Ronex Mart
  // login/signup with no navbar). Signed in -> their role home.
  const target = isAuthenticated ? homeRoute : ROUTES.LOGIN;

  // Keeps `user`/`runsStore` referenced so the redirect re-runs when the
  // session (and thus the home route) changes after /auth/me answers.
  void user;
  void runsStore;

  return <Navigate to={target} replace />;
}

function NotFound() {
  return (
    <div className="page">
      <div className="card empty">
        <h1>404</h1>
        <p className="muted">That page does not exist.</p>
        <Link className="btn btn-primary" to={ROUTES.HOME}>
          Go home
        </Link>
      </div>
    </div>
  );
}

/**
 * Route table. Every protected page is wrapped in <ProtectedRoute> so the
 * role check happens before the page (and its API calls) ever mount.
 *
 * The store dashboard (/merchant*), the admin panel (/admin*) and the rider
 * console (/rider*) all render inside <DashboardLayout> - a side navbar - so the
 * top <Navbar/> is hidden on those routes. /profile does the same for store
 * staff, whose profile is mounted in the merchant shell. Everywhere else
 * (customer, auth, public shop) the top navbar stays as-is.
 */
export default function App() {
  const location = useLocation();
  const pathname = location.pathname || '';
  // Store staff (owner, store admin, or a customer an owner appointed) - the
  // group that lives in the side-rail merchant dashboard. Drives both the
  // profile route below and the navbar rule further down.
  const { isStore } = useAuth();
  // Portal entry (/login + /register) has NO navbar: split-screen brand panel
  // + form IS the chrome. Dashboards and storefronts keep hiding it too.
  // /rider counts as a dashboard now - it renders in <DashboardLayout>, so
  // leaving the top navbar up would stack two navigation bars on one page.
  // /profile counts for store staff for the same reason: their profile is
  // mounted in the merchant shell (see the route below), and without this the
  // public navbar would render ON TOP of the side rail - two navbars at once.
  const hideTopNavbar =
    pathname === ROUTES.LOGIN ||
    pathname === ROUTES.REGISTER ||
    pathname.startsWith('/merchant') ||
    pathname.startsWith('/admin') ||
    pathname.startsWith('/rider') ||
    pathname.startsWith('/s/') ||
    (isStore && pathname === ROUTES.PROFILE);

  // The portal is full-bleed (its own background), so drop the centered
  // .app-main container there just like the dashboards do.
  const isPortal = pathname === ROUTES.LOGIN || pathname === ROUTES.REGISTER;

  return (
    <>
      {hideTopNavbar ? null : <Navbar />}

      <main
        className={
          isPortal
            ? 'app-main app-main--portal'
            : hideTopNavbar
              ? 'app-main app-main--dash'
              : 'app-main'
        }
      >
        {/* One Suspense boundary for the whole route table: the first page a
            visitor lands on pays for its own chunk, and after that the chunks
            are in the HTTP cache (see the immutable cache headers in app.js).
            A boundary per route would work too, but a single one means the
            chrome - navbar, cart drawer, dashboard rail - stays mounted and
            only the page area swaps. */}
        <Suspense fallback={<PageFallback />}>
          <Routes>
          <Route path={ROUTES.HOME} element={<HomeRedirect />} />
          <Route path={ROUTES.LOGIN} element={<Login />} />
          <Route path={ROUTES.REGISTER} element={<Register />} />

          {/* Store-branded customer auth: the slug IS the store context, so
              signup/login at a store can only happen from its own URL. */}
          <Route path="/s/:slug/login" element={<CustomerLogin />} />
          <Route path="/s/:slug/register" element={<CustomerRegister />} />

          {/* Any signed-in user: their own profile (riders see their username).
              Customers get a store-scoped page (/s/:slug/profile) so the
              slug stays in the URL after login; the bare /profile stays for
              staff and bounces customers forward. */}
          <Route
            path={ROUTES.STORE_PROFILE}
            element={
              <ProtectedRoute>
                <ProfilePage />
              </ProtectedRoute>
            }
          />
          {/* A store owner reaches their profile from the avatar in the DASHBOARD
              shell - DashboardLayout's profile link points here. Rendering that
              on the public chrome put a top navbar on a back-office page, so the
              entire navigation swapped out the moment they clicked their own
              picture, and "back" went to a storefront instead of their dashboard.

              So store staff (owner, or anybody an owner appointed) get the
              merchant shell: no top navbar, the same side rail as /merchant*,
              and the avatar stays in the same corner they clicked it from.
              `isStore` covers role `store`, role `storeadmin`, and a plain
              `customer` who was appointed - all of whom live in that dashboard.

              Everyone else keeps the existing public-chrome profile. */}
          {isStore ? (
            <Route
              element={
                <ProtectedRoute>
                  <DashboardLayout variant="merchant" />
                </ProtectedRoute>
              }
            >
              <Route path={ROUTES.PROFILE} element={<ProfilePage />} />
            </Route>
          ) : (
            <Route
              path={ROUTES.PROFILE}
              element={
                <ProtectedRoute>
                  <ProfilePage />
                </ProtectedRoute>
              }
            />
          )}

          {/* Customer */}
          <Route path={ROUTES.STORE} element={<Storefront />} />
          {/* Checkout + tracker are public: guests order with name+phone and
              watch their order with the token from checkout. The pages
              themselves handle signed-in vs guest. Checkout lives inside the
              store it belongs to (/s/<slug>/checkout); the bare /checkout
              stays for old links and redirects to the scoped URL. */}
          <Route path={ROUTES.STORE_CHECKOUT} element={<Checkout />} />
          <Route path={ROUTES.CHECKOUT} element={<Checkout />} />
          {/* The screen right after an order is placed. Public for the same
              reason as the tracker: a guest has no session yet, and this is
              where they are OFFERED one (with the order attached). The offer is
              gated on the order's guestToken, which only the browser that
              placed the order holds. */}
          <Route path={ROUTES.ORDER_SUCCESS} element={<OrderSuccess />} />
          <Route path={ROUTES.ORDER_TRACKER} element={<OrderTracker />} />

          {/* Payment result pages. The BACKEND redirects here after the
              gateway sends the shopper back, so these paths are generated on the
              server (CLIENT_URL + /payment-success) and must stay exactly as
              they are - they are not store-scoped, because the gateway knows
              nothing about which store the basket came from. Both read
              ?tran_id=… and verify it against the API. */}
          <Route path={ROUTES.PAYMENT_SUCCESS} element={<PaymentSuccess />} />
          <Route path={ROUTES.PAYMENT_FAILED} element={<PaymentFailed />} />

          {/* Rider - the whole rider area is a side-navbar shell, so the console,
              their analytics and a single delivery opened from either of them all
              keep the same rail. The order view used to link out to the public
              /track/:orderId, which dropped the rider onto the top navbar. */}
          <Route
            element={
              <ProtectedRoute allowedRoles={[ROLES.RIDER]}>
                <DashboardLayout variant="rider" />
              </ProtectedRoute>
            }
          >
            <Route path={ROUTES.RIDER_CONSOLE} element={<RiderConsole />} />

            {/* Rider analytics: how long each stage of their deliveries took,
                read out of the orders' own status history. */}
            <Route
              path={ROUTES.RIDER_ANALYTICS}
              element={<RiderAnalytics />}
            />

            {/* Same order view the customer sees, mounted in the rider shell so
                the side rail survives - the same trick the admin view uses. */}
            <Route
              path={ROUTES.RIDER_ORDER}
              element={<OrderTracker variant="rider" />}
            />
          </Route>

          {/* Store owner and store admins the owner appointed.
              {/* Admin panel - side-navbar shell instead of the top navbar. */}
          <Route
            element={
              <ProtectedRoute allowedRoles={[ROLES.STORE]}>
                <DashboardLayout variant="merchant" />
              </ProtectedRoute>
            }
          >
            <Route
              path={ROUTES.MERCHANT_DASHBOARD}
              element={<MerchantDashboard />}
            />
            <Route path={ROUTES.MERCHANT_PRODUCTS} element={<ProductManager basePath={ROUTES.MERCHANT_PRODUCTS} />} />
            {/* The product form. `new` is declared before the `:productId`
                route so it is never read as a product whose id is the word
                "new" - both stay inside this shell so the side rail survives. */}
            <Route
              path={ROUTES.MERCHANT_PRODUCT_NEW}
              element={<ProductEditor basePath={ROUTES.MERCHANT_PRODUCTS} />}
            />
            <Route
              path={ROUTES.MERCHANT_PRODUCT_EDIT}
              element={<ProductEditor basePath={ROUTES.MERCHANT_PRODUCTS} />}
            />
            <Route
              path={ROUTES.MERCHANT_ANALYTICS}
              element={<StoreRiderAnalytics />}
            />
            {/* The store's order book and customer list - two full pages of
                their own, mounted in the same shell so the side rail survives
                when a merchant hops between them. */}
            <Route path={ROUTES.MERCHANT_ORDERS} element={<StoreOrders />} />
            <Route
              path={ROUTES.MERCHANT_ORDER_DETAIL}
              element={
                <OrderTracker
                  variant="merchant"
                  backTo={ROUTES.MERCHANT_ORDERS}
                  backLabel="Back to orders"
                />
              }
            />
            <Route
              path={ROUTES.MERCHANT_CUSTOMERS}
              element={<StoreCustomers />}
            />
            <Route path={ROUTES.MERCHANT_THEME} element={<ThemeBuilder />} />
          </Route>

              {/* Admin panel - side-navbar shell instead of the top navbar. */}
          <Route
            element={
              <ProtectedRoute allowedRoles={[ROLES.ADMIN]}>
                <DashboardLayout variant="admin" />
              </ProtectedRoute>
            }
          >
            <Route
              path={ROUTES.ADMIN_DASHBOARD}
              element={<AdminDashboard />}
            />
            <Route path={ROUTES.ADMIN_PRODUCTS} element={<ProductManager basePath={ROUTES.ADMIN_PRODUCTS} />} />
            {/* The same product form the store dashboard uses, reached from
                the admin panel - same pages, different origin. */}
            <Route
              path={ROUTES.ADMIN_PRODUCT_NEW}
              element={<ProductEditor basePath={ROUTES.ADMIN_PRODUCTS} />}
            />
            <Route
              path={ROUTES.ADMIN_PRODUCT_EDIT}
              element={<ProductEditor basePath={ROUTES.ADMIN_PRODUCTS} />}
            />
            <Route path={ROUTES.ADMIN_INVITATIONS} element={<AdminInvitations />} />
            {/* Live delivery map. Moved out of the store dashboard: it is scoped
                by ?storeId= and defaults to the admin's primary store, and it
                explains itself when the admin runs no store at all. */}
            <Route path={ROUTES.ADMIN_RIDERS} element={<RiderTracker />} />
            {/* Opened from the rider tracker: same view, same side rail, but
                "back" returns to the tracker instead of the orders board. */}
            <Route
              path={ROUTES.ADMIN_RIDER_ORDER}
              element={
                <OrderTracker
                  variant="admin"
                  backTo={ROUTES.ADMIN_RIDERS}
                  backLabel="Back to rider tracker"
                />
              }
            />
            <Route path={ROUTES.ADMIN_THEME} element={<ThemeBuilder />} />
            {/* Same order view the customer sees, but mounted in the shell so
                the side rail survives. variant="admin" only swaps the wording
                and the "back" target. */}
            <Route
              path={ROUTES.ADMIN_ORDER}
              element={<OrderTracker variant="admin" />}
            />
          </Route>

          {/* A store's public page - anyone with the link, even logged out. */}
          <Route path={ROUTES.SHOP} element={<ShopPage />} />

          <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </main>

      {/* Lives outside <Routes> so any page can slide the cart open. */}
      <CartDrawer />
    </>
  );
}
