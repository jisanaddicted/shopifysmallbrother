import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useCart } from '../../context/CartContext';
import { HOME_ROUTE_BY_ROLE, ROUTES } from '../../utils/constants';
import { initials } from '../../utils/formatters';

export default function Navbar() {
  const { user, isAuthenticated, isCustomer, isRider, isStore, isAdmin, logout } =
    useAuth();
  const { itemCount, toggleCart } = useCart();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate(ROUTES.LOGIN, { replace: true });
  };

  const brandTarget = HOME_ROUTE_BY_ROLE[user?.role] || ROUTES.HOME;

  return (
    <header className="navbar">
      <div className="navbar__inner">
        <Link to={brandTarget} className="navbar__brand">
          <span className="navbar__logo" aria-hidden="true">
            →
          </span>
          DeliveryApp
        </Link>

        <nav className="navbar__links">
          {!isAuthenticated && (
            <>
              <NavLink to={ROUTES.STORE}>Store</NavLink>
              <NavLink to={ROUTES.CHECKOUT}>Checkout</NavLink>
            </>
          )}
          {isCustomer && (
            <>
              <NavLink to={ROUTES.STORE}>Store</NavLink>
              <NavLink to={ROUTES.CHECKOUT}>Checkout</NavLink>
            </>
          )}
          {isRider && <NavLink to={ROUTES.RIDER_CONSOLE}>My deliveries</NavLink>}
          {isStore && (
            <>
              <NavLink to={ROUTES.MERCHANT_DASHBOARD}>My store</NavLink>
              <NavLink to={ROUTES.MERCHANT_PRODUCTS}>Products</NavLink>
            </>
          )}
          {isAdmin && (
            <>
              <NavLink to={ROUTES.ADMIN_DASHBOARD}>Dispatch</NavLink>
              <NavLink to={ROUTES.ADMIN_PRODUCTS}>Products</NavLink>
            </>
          )}
        </nav>

        <div className="navbar__actions">
          {isAuthenticated || itemCount > 0 ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={toggleCart}
            >
              Cart
              {itemCount > 0 && <span className="badge">{itemCount}</span>}
            </button>
          ) : null}

          {isAuthenticated ? (
            <>
              <Link
                className="navbar__user"
                to={ROUTES.PROFILE}
                title={
                  user?.username
                    ? `@${user.username} — view profile`
                    : 'View profile'
                }
              >
                <span className="avatar" aria-hidden="true">
                  {initials(user?.name || user?.email)}
                </span>
                <span className="navbar__user-name">
                  {user?.username ? `@${user.username}` : user?.name || user?.email}
                </span>
              </Link>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={handleLogout}
              >
                Log out
              </button>
            </>
          ) : (
            <>
              <Link className="btn btn-ghost btn-sm" to={ROUTES.LOGIN}>
                Log in
              </Link>
              <Link className="btn btn-primary btn-sm" to={ROUTES.REGISTER}>
                Sign up
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
