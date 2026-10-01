import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
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
  const location = useLocation();

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

  /* Where "My profile" goes: a customer's profile lives under their store,
     everyone else's is the portal one. */
  const profileTarget =
    isCustomer && brandStore?.slug
      ? `/s/${brandStore.slug}/profile`
      : ROUTES.PROFILE;

  /* Where the account menu's "Log in" / "Sign up" doors lead.
     A customer account belongs to a store (see AuthContext), so for anyone
     browsing as a customer these are that store's own pages; staff keep the
     portal ones. Same rule handleLogout follows in the other direction. */
  const storeSlug = brandStore?.slug || lastStoreVisit() || '';
  const useStoreDoors = isCustomer || user?.role === ROLES.CUSTOMER;
  const loginTarget = useStoreDoors
    ? storeSlug
      ? `/s/${storeSlug}/login`
      : ROUTES.LOGIN
    : ROUTES.LOGIN;
  const registerTarget = useStoreDoors
    ? storeSlug
      ? `/s/${storeSlug}/register`
      : ROUTES.REGISTER
    : ROUTES.REGISTER;

  /* Carried on the links so the door knows which store the visitor was on and
     can send them back to it afterwards. */
  const accountState = {
    ...(storeSlug
      ? {
          storeSlug,
          storeName: brandStore?.name || '',
          storePath: storeSlug ? shopPath(storeSlug) : undefined,
        }
      : {}),
  };

  /* The account menu is a disclosure, so it closes on Escape, on a click
     outside, and whenever the route changes. */
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return undefined;

    const onPointerDown = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    };
    const onKey = (event) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

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
            /* Orders only. There is deliberately no Products link here, matching
               the admin rail in DashboardLayout (see adminLinks): an admin runs
               stores they were invited to, and does not edit their catalogues.
               This branch is reachable - /admin* hides the top navbar, but
               /profile does not - so leaving the link in would have kept the
               tab alive for exactly the one page where it still shows. */
            <>
              <NavLink to={ROUTES.ADMIN_DASHBOARD}>Orders</NavLink>
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

          {/*
            Account access lives behind ONE control now.

            It used to be a pair of text buttons ("Log in" / "Sign up") sitting
            next to a separate profile link and a separate "Log out" button -
            up to three things in the corner, two of which only existed to say
            the same thing in the opposite direction. Now there is a single
            account icon: it opens a small menu with the right options for
            whoever is browsing, and it is the same affordance on the storefront
            header. A signed-out visitor gets Log in / Sign up; a signed-in one
            gets their profile and Log out.
          */}
          <div className="navbar__account" ref={menuRef}>
            <button
              type="button"
              className="navbar__user-btn"
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              aria-label={
                isAuthenticated
                  ? `Account menu for ${user?.name || user?.email}`
                  : 'Log in or create an account'
              }
              onClick={() => setMenuOpen((open) => !open)}
            >
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 21a8 8 0 0 0-16 0" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </button>

            {menuOpen ? (
              <div className="navbar__account-menu" role="menu">
                {isAuthenticated ? (
                  <>
                    <div className="navbar__account-head">
                      <span className="avatar" aria-hidden="true">
                        {initials(user?.name || user?.email)}
                      </span>
                      <span>
                        <strong>{user?.name || user?.email}</strong>
                        {user?.username ? (
                          <span className="muted small block">
                            @{user.username}
                          </span>
                        ) : null}
                      </span>
                    </div>

                    <Link
                      className="navbar__account-item"
                      role="menuitem"
                      to={profileTarget}
                      onClick={() => setMenuOpen(false)}
                    >
                      My profile
                    </Link>

                    <button
                      type="button"
                      className="navbar__account-item"
                      role="menuitem"
                      onClick={handleLogout}
                    >
                      Log out
                    </button>
                  </>
                ) : (
                  <>
                    {/*
                      Customers have no generic /login to be sent to - an
                      account belongs to the store they signed up at, so both
                      doors are that store's own pages (see handleLogout).
                    */}
                    <Link
                      className="navbar__account-item"
                      role="menuitem"
                      to={loginTarget}
                      state={accountState}
                      onClick={() => setMenuOpen(false)}
                    >
                      Log in
                    </Link>
                    <Link
                      className="navbar__account-item navbar__account-item--primary"
                      role="menuitem"
                      to={registerTarget}
                      state={accountState}
                      onClick={() => setMenuOpen(false)}
                    >
                      Sign up
                    </Link>
                  </>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}
