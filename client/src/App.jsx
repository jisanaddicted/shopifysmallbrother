import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Navbar from './components/common/Navbar';
import DashboardLayout from './components/common/DashboardLayout';
import ProtectedRoute from './components/common/ProtectedRoute';
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
import ThemeBuilder from './pages/store/ThemeBuilder';
import RiderConsole from './pages/rider/RiderConsole';
import { ROLES, ROUTES } from './utils/constants';
/** "/" sends everyone to the right home page for their role. */
function HomeRedirect() {
  const { isAuthenticated, user, runsStore, homeRoute } = useAuth();

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
  const hideTopNavbar =
    pathname.startsWith('/merchant') || pathname.startsWith('/admin');

  return (
    <>
      {hideTopNavbar ? null : <Navbar />}

      <main className={hideTopNavbar ? 'app-main app-main--dash' : 'app-main'}>
        <Routes>
          <Route path={ROUTES.HOME} element={<HomeRedirect />} />
          <Route path={ROUTES.LOGIN} element={<Login />} />
          <Route path={ROUTES.REGISTER} element={<Register />} />

          {/* Any signed-in user: their own profile (riders see their username). */}
          <Route
            path={ROUTES.PROFILE}
            element={
              <ProtectedRoute>
                <ProfilePage />
              </ProtectedRoute>
            }
          />

          {/* Customer */}
          <Route
            path={ROUTES.STORE}
            element={
              <ProtectedRoute allowedRoles={[ROLES.CUSTOMER]}>
                <Storefront />
              </ProtectedRoute>
            }
          />
          <Route
            path={ROUTES.CHECKOUT}
            element={
              <ProtectedRoute allowedRoles={[ROLES.CUSTOMER]}>
                <Checkout />
              </ProtectedRoute>
            }
          />
          {/* Both the customer and the assigned rider may open the tracker. */}
          <Route
            path={ROUTES.ORDER_TRACKER}
            element={
              <ProtectedRoute>
                <OrderTracker />
              </ProtectedRoute>
            }
          />

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
              Side-navbar shell instead of the top navbar. */}
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
            <Route path={ROUTES.MERCHANT_THEME} element={<ThemeBuilder />} />
          </Route>

              Side-navbar shell instead of the top navbar. */}
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