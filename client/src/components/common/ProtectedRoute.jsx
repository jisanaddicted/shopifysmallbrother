import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { HOME_ROUTE_BY_ROLE, ROUTES } from '../../utils/constants';
import LoadingSpinner from './LoadingSpinner';

/**
 * Wraps a route and only renders it for the right people.
 *
 * <ProtectedRoute>                        any logged-in user
 * <ProtectedRoute allowedRoles={[ROLES.RIDER]}>   riders only
 *
 * Not logged in  -> /login (remembering where they wanted to go)
 * Wrong role     -> their own home page
 */
export default function ProtectedRoute({ children, allowedRoles }) {
  const { isAuthenticated, loading, user } = useAuth();
  const location = useLocation();

  // Still verifying a stored token - don't bounce the user out yet.
  if (loading) {
    return <LoadingSpinner fullPage label="Checking your session…" />;
  }

  if (!isAuthenticated) {
    return (
      <Navigate to={ROUTES.LOGIN} state={{ from: location }} replace />
    );
  }

  const role = user?.role;

  if (allowedRoles?.length && !allowedRoles.includes(role)) {
    return <Navigate to={HOME_ROUTE_BY_ROLE[role] || ROUTES.HOME} replace />;
  }

  return children;
}
