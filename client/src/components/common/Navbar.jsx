import { useEffect, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useCart } from '../../context/CartContext';
import { HOME_ROUTE_BY_ROLE, ROLES, ROUTES, checkoutPath, lastStoreVisit, shopPath } from '../../utils/constants';
import { initials } from '../../utils/formatters';
import { getPublicStore } from '../../services/storeService';

export default function Navbar() {
  const {
    user,
    isAuthenticated,
    isCustomer,
    isRider,
    isStore,
    isAdmin,
    logout,
    customerHomeRoute,
    shoppingStores,
  } = useAuth();
  const { itemCount, toggleCart } = useCart();
  const navigate = useNavigate();

  // The store this customer signed up at (from the DB via the session:
  // customerStores[].store carries logo + image + slug + name). Newest
  // relationship first, so [0] is "their" store.
  const homeStore = isCustomer && shoppingStores?.length ? shoppingStores[0] : null;

  // Fallback for older sessions with no customerStores yet: fetch the last
  // visited storefront's logo from the database by its slug.
  const [visitedStore, setVisitedStore] = useState(null);
  useEffect(() => {
    if (homeStore || !isCustomer) {
      setVisitedStore(null);
      return undefined;
    }
    const slug = lastStoreVisit();
    if (!slug) return undefined;
    let cancelled = false;
    getPublicStore(slug)
      .then((data) => {
        if (!cancelled) setVisitedStore(data?.store || null);
      })
      .catch(() => {
        if (!cancelled) setVisitedStore(null);
      });
    return () => {
      cancelled = true;
    };
  }, [homeStore, isCustomer, user?.email]);

  // The store whose logo + URL the brand shows for a customer.
  const brandStore = homeStore || visitedStore || null;

  const handleLogout = () => {
    // Auth-door rule: customers NEVER land on the staff portal (/login).
    // Ending a customer session takes them to the login page OF THE STORE
    // they logged out from: /s/<slug>/login — last visited storefront
    // first, else the store on their account. Only when no store slug is
    // known at all do we fall back to the catalogue. Staff
    // (rider/store/admin) keep the portal /login.
    // The role + target are captured BEFORE logout() clears the session.
    const loggingOutAsCustomer =
      isCustomer || user?.role === ROLES.CUSTOMER;
    const logoutSlug = lastStoreVisit() || shoppingStores?.[0]?.slug || '';
    const target = loggingOutAsCustomer
      ? logoutSlug
        ? `/s/${logoutSlug}/login`
        : customerHomeRoute || ROUTES.STORE
      : ROUTES.LOGIN;

    logout();
    navigate(target, { replace: true });
  };

  const brandTarget = HOME_ROUTE_BY_ROLE[user?.role] || ROUTES.HOME;

  // A signed-in customer sees THEIR store in the brand slot: the store's
  // logo image (logo, else image) from the database, linking to that
  // store's own URL (/s/<slug>). Everyone else keeps the default brand.
  const brandLogo = brandStore?.logo || brandStore?.image || '';
  const brandStorePath = brandStore?.slug ? shopPath(brandStore.slug) : '';
  // Checkout belongs to a store too: /s/<slug>/checkout when we know which
  // one (the brand store, else the last storefront visited), bare /checkout
  // only when no slug is known at all.
  const checkoutTarget = checkoutPath(brandStore?.slug || lastStoreVisit() || '');

  return (
    <header className="navbar">
      <div className="navbar__inner">
        {isCustomer && brandStore ? (
          <Link
            to={brandStorePath || brandTarget}
            className="navbar__brand navbar__brand--store"
            title={`${brandStore.name || 'Store'} — open storefront`}
          >
            {brandLogo ? (
              <img
                className="navbar__store-logo"
                src={brandLogo}
                alt={`${brandStore.name || 'Store'} logo`}
              />
            ) : (
              <span className="navbar__logo" aria-hidden="true">
                {initials(brandStore.name || 'S')}
              </span>
            )}
            <span className="navbar__brand-name">
              {brandStore.name || 'Store'}
            </span>
          </Link>
        ) : (
          <Link to={brandTarget} className="navbar__brand">
            <span className="navbar__logo" aria-hidden="true">
              →
            </span>
            DeliveryApp
          </Link>
        )}

        <nav className="navbar__links">
          {!isAuthenticated && (
            <>
              <NavLink to={ROUTES.STORE}>Store</NavLink>
              <NavLink to={checkoutTarget}>Checkout</NavLink>
            </>
          )}
          {isCustomer && (
            <>
              <NavLink to={ROUTES.STORE}>Store</NavLink>
              <NavLink to={checkoutTarget}>Checkout</NavLink>
            </>
          )}
          {isRider && (
            <>
              <NavLink to={ROUTES.RIDER_CONSOLE}>My deliveries</NavLink>
              <NavLink to={ROUTES.RIDER_ANALYTICS}>Analytics</NavLink>
            </>
          )}
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
                to={
                  isCustomer && brandStore?.slug
                    ? `/s/${brandStore.slug}/profile`
                    : ROUTES.PROFILE
                }
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
