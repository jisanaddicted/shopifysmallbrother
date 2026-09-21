import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { HOME_ROUTE_BY_ROLE, ROLES, ROUTES } from '../../utils/constants';
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
  const { isAuthenticated, loading, user, runsStore } = useAuth();
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

  // A store admin keeps their platform role (`customer` or `storeadmin`);
  // what opens the store pages is the accepted membership in their session,
  // not the role. Both kinds count as store staff here.
  const effectiveRole =
    (runsStore || role === ROLES.STORE_ADMIN) && role !== ROLES.ADMIN
      ? ROLES.STORE
      : role;

  if (allowedRoles?.length && !allowedRoles.includes(effectiveRole)) {
    return <Navigate to={HOME_ROUTE_BY_ROLE[role] || ROUTES.HOME} replace />;
  }

  return children;
}
