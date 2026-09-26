import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Navbar from './components/common/Navbar';
import DashboardLayout from './components/common/DashboardLayout';
import ProtectedRoute from './components/common/ProtectedRoute';
import CustomerLogin from './pages/auth/CustomerLogin';
import CustomerRegister from './pages/auth/CustomerRegister';
import CartDrawer from './components/store/CartDrawer';
import { useAuth } from './context/AuthContext';
import AdminDashboard from './pages/admin/AdminDashboard';
import AdminStores from './pages/admin/AdminStores';
import ProductManager from './pages/admin/ProductManager';

import Login from './pages/auth/Login';
import Register from './pages/auth/Register';
import ProfilePage from './pages/profile/ProfilePage';
import Checkout from './pages/customer/Checkout';
import OrderTracker from './pages/customer/OrderTracker';
import ShopPage from './pages/customer/ShopPage';
import Storefront from './pages/customer/Storefront';
import MerchantDashboard from './pages/store/MerchantDashboard';
import RiderTracker from './pages/store/RiderTracker';
import ThemeBuilder from './pages/store/ThemeBuilder';
import RiderConsole from './pages/rider/RiderConsole';
import { ROLES, ROUTES } from './utils/constants';
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
 * The store dashboard (/merchant*) and the admin panel (/admin*) render
 * inside <DashboardLayout> - a side navbar - so the top <Navbar/> is hidden
 * on those routes. Everywhere else (customer, rider, auth, public shop) the
 * top navbar stays as-is.
 */
export default function App() {
  const location = useLocation();
  const pathname = location.pathname || '';
  // Portal entry (/login + /register) has NO navbar: split-screen brand panel
  // + form IS the chrome. Dashboards and storefronts keep hiding it too.
  const hideTopNavbar =
    pathname === ROUTES.LOGIN ||
    pathname === ROUTES.REGISTER ||
    pathname.startsWith('/merchant') ||
    pathname.startsWith('/admin') ||
    pathname.startsWith('/s/');

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
          <Route
            path={ROUTES.PROFILE}
            element={
              <ProtectedRoute>
                <ProfilePage />
              </ProtectedRoute>
            }
          />

          {/* Customer */}
          <Route path={ROUTES.STORE} element={<Storefront />} />
          {/* Checkout + tracker are public: guests order with name+phone and
              watch their order with the token from checkout. The pages
              themselves handle signed-in vs guest. Checkout lives inside the
              store it belongs to (/s/<slug>/checkout); the bare /checkout
              stays for old links and redirects to the scoped URL. */}
          <Route path={ROUTES.STORE_CHECKOUT} element={<Checkout />} />
          <Route path={ROUTES.CHECKOUT} element={<Checkout />} />
          <Route path={ROUTES.ORDER_TRACKER} element={<OrderTracker />} />

          {/* Rider */}
          <Route
            path={ROUTES.RIDER_CONSOLE}
            element={
              <ProtectedRoute allowedRoles={[ROLES.RIDER]}>
                <RiderConsole />
              </ProtectedRoute>
            }
          />

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
            <Route path={ROUTES.MERCHANT_PRODUCTS} element={<ProductManager />} />
            <Route path={ROUTES.MERCHANT_RIDERS} element={<RiderTracker />} />
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
            <Route path={ROUTES.ADMIN_PRODUCTS} element={<ProductManager />} />
            <Route path={ROUTES.ADMIN_STORES} element={<AdminStores />} />
            <Route path={ROUTES.ADMIN_THEME} element={<ThemeBuilder />} />
          </Route>

          {/* A store's public page - anyone with the link, even logged out. */}
          <Route path={ROUTES.SHOP} element={<ShopPage />} />

          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>

      {/* Lives outside <Routes> so any page can slide the cart open. */}
      <CartDrawer />
    </>
  );
}
