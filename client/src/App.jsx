import { Link, Navigate, Route, Routes } from 'react-router-dom';
import Navbar from './components/common/Navbar';
import ProtectedRoute from './components/common/ProtectedRoute';
import CartDrawer from './components/store/CartDrawer';
import { useAuth } from './context/AuthContext';
import AdminDashboard from './pages/admin/AdminDashboard';
import ProductManager from './pages/admin/ProductManager';
import AdminStores from './pages/admin/AdminStores';
import Login from './pages/auth/Login';
import Register from './pages/auth/Register';
import Checkout from './pages/customer/Checkout';
import OrderTracker from './pages/customer/OrderTracker';
import ShopPage from './pages/customer/ShopPage';
import Storefront from './pages/customer/Storefront';
import MerchantDashboard from './pages/store/MerchantDashboard';
import RiderConsole from './pages/rider/RiderConsole';
import { HOME_ROUTE_BY_ROLE, ROLES, ROUTES } from './utils/constants';

/** "/" sends everyone to the right home page for their role. */
function HomeRedirect() {
  const { isAuthenticated, user } = useAuth();

  const target = isAuthenticated
    ? HOME_ROUTE_BY_ROLE[user?.role] || ROUTES.STORE
    : ROUTES.LOGIN;

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
 */
export default function App() {
  return (
    <>
      <Navbar />

      <main className="app-main">
        <Routes>
          <Route path={ROUTES.HOME} element={<HomeRedirect />} />
          <Route path={ROUTES.LOGIN} element={<Login />} />
          <Route path={ROUTES.REGISTER} element={<Register />} />

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

          {/* Store owner */}
          <Route
            path={ROUTES.MERCHANT_DASHBOARD}
            element={
              <ProtectedRoute allowedRoles={[ROLES.STORE]}>
                <MerchantDashboard />
              </ProtectedRoute>
            }
          />

          {/* Admin */}
          <Route
            path={ROUTES.ADMIN_DASHBOARD}
            element={
              <ProtectedRoute allowedRoles={[ROLES.ADMIN]}>
                <AdminDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path={ROUTES.ADMIN_PRODUCTS}
            element={
              <ProtectedRoute allowedRoles={[ROLES.ADMIN]}>
                <ProductManager />
              </ProtectedRoute>
            }
          />
          <Route
            path={ROUTES.ADMIN_STORES}
            element={
              <ProtectedRoute allowedRoles={[ROLES.ADMIN]}>
                <AdminStores />
              </ProtectedRoute>
            }
          />

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