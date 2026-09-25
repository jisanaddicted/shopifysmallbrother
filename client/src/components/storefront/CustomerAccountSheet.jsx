import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import orderService from '../../services/orderService';
import {
  ORDER_STATUS_TONE,
  ROLES,
  ROUTES,
  lastStoreVisit,
  orderTrackerPath,
  shopPath,
} from '../../utils/constants';
import {
  formatCurrency,
  formatDateTime,
  formatStatus,
  initials,
} from '../../utils/formatters';

/**
 * Bottom sheet behind the storefront's mobile ACCOUNT tab (/s/<slug>).
 *
 * Two faces, decided by who is looking:
 *   - Guest (no account yet): "Create account" / "Log in". Both carry this
 *     store with them, so signing up here creates a customer account *for this
 *     store* and signing in ties the account to it.
 *   - Signed in: that account's own name, email and phone, the stores it shops
 *     at, its orders, a link to the full profile and a way out (log out).
 *
 * Only customers/admin may read GET /orders/mine (the same allow-list the API
 * enforces), so staff accounts get a pointer to their own workspace instead.
 * Rendered mobile-only via CSS, paired with MobileTabs.
 */

// Human label for the account badge. A customer the owner appointed to run a
// store keeps role `customer`, so store membership wins over the raw role.
function accountLabel(role, runsStore, storeRole) {
  if (role === ROLES.ADMIN) return 'Admin account';
  if (runsStore) {
    return storeRole === 'owner' ? 'Store owner account' : 'Store admin account';
  }
  if (role === ROLES.STORE) return 'Store owner account';
  if (role === ROLES.STORE_ADMIN) return 'Store admin account';
  if (role === ROLES.RIDER) return 'Rider account';
  if (role === ROLES.CUSTOMER) return 'Customer account';
  return 'Account';
}

/** "#A1B2C3" - a short, readable handle for an order id. */
function shortOrderId(id) {
  return `#${String(id).slice(-6).toUpperCase()}`;
}

/** No account yet: the two ways in, both carrying the store they came from. */
function GuestBody({ from, storeSlug, storeName, storePath }) {
  // Handed to the auth pages so the new account belongs to this store and
  // lands back here afterwards.
  const storeState = storeSlug
    ? { storeSlug, storeName: storeName || '', storePath, from }
    : { from };

  return (
    <div className="account-sheet__guest">
      <h2>You are browsing as a guest</h2>
      <p className="muted small">
        {storeName
          ? `Create a ${storeName} account to order and track delivery, or log in if you already have one.`
          : 'Ordering and live delivery tracking need a customer account. Creating one takes a few seconds.'}
      </p>

      <div className="account-sheet__cta-row">
        <Link
          className="btn btn-primary btn-block"
          to={store?.slug ? `/s/${store.slug}/register` : ROUTES.REGISTER}
          state={storeState}
        >
          Create account
        </Link>
        <Link
          className="btn btn-outline btn-block"
          to={store?.slug ? `/s/${store.slug}/login` : ROUTES.LOGIN}
          state={storeState}
        >
          Log in
        </Link>
      </div>

      {storeName ? (
        <p className="muted small account-sheet__notice">
          Your account is saved under {storeName}, so you will always find your
          orders here.
        </p>
      ) : null}
    </div>
  );
}

/** Signed in: this account's own details, its stores and its orders. */
function SignedInBody({
  user,
  label,
  homeRoute,
  canSeeOrders,
  orders,
  loading,
  error,
  onRetry,
  onClose,
  onLogout,
  shoppingStores = [],
  currentStoreSlug = '',
}) {
  return (
    <>
      <div className="account-sheet__identity">
        <span className="avatar avatar--lg" aria-hidden="true">
          {initials(user.name || user.username || user.email)}
        </span>
        <div className="account-sheet__who">
          <span className="badge badge--info">{label}</span>
          <p className="account-sheet__name">{user.name || 'Your account'}</p>
          {user.username ? (
            <p className="muted small account-sheet__line">@{user.username}</p>
          ) : null}
          {user.email ? (
            <p className="muted small account-sheet__line">{user.email}</p>
          ) : null}
          {user.phone ? (
            <p className="muted small account-sheet__line">{user.phone}</p>
          ) : null}
        </div>
      </div>

      {canSeeOrders ? (
        <>
          {shoppingStores.length > 0 ? (
            <>
              <div className="account-sheet__section-head">
                <h3>My stores</h3>
                <span className="muted small">
                  {shoppingStores.length === 1
                    ? '1 store'
                    : `${shoppingStores.length} stores`}
                </span>
              </div>

              <ul className="account-sheet__stores">
                {shoppingStores.map((shop) => (
                  <li key={shop._id || shop.id || shop.slug}>
                    <Link
                      to={shopPath(shop.slug)}
                      className={`account-sheet__store${
                        shop.slug === currentStoreSlug ? ' is-current' : ''
                      }`}
                      onClick={onClose}
                    >
                      <span className="account-sheet__store-name">
                        {shop.name}
                      </span>
                      <span className="muted small">
                        {shop.slug === currentStoreSlug
                          ? 'You are here'
                          : 'Open store'}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="muted small account-sheet__notice">
              You have not joined a store yet. Order from a store page and it
              will be saved here.
            </p>
          )}

          <div className="account-sheet__section-head">
            <h3>My orders</h3>
            {loading ? <span className="muted small">Loading…</span> : null}
          </div>

          {error ? (
            <div className="alert alert--danger">
              <p>{error}</p>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={onRetry}
              >
                Try again
              </button>
            </div>
          ) : null}

          {!loading && !error && orders.length === 0 ? (
            <p className="empty">No orders yet.</p>
          ) : null}

          {orders.length > 0 ? (
            <ul className="account-sheet__orders">
              {orders.slice(0, 5).map((order) => {
                const id = order._id || order.id;
                const tone = ORDER_STATUS_TONE[order.status] || 'info';

                return (
                  <li key={id}>
                    <Link
                      to={orderTrackerPath(id)}
                      className="account-sheet__order"
                      onClick={onClose}
                    >
                      <span className="account-sheet__order-main">
                        <strong>{shortOrderId(id)}</strong>
                        <span className="muted small">
                          {formatDateTime(order.createdAt)}
                        </span>
                      </span>
                      <span className="account-sheet__order-side">
                        <span className={`badge badge--${tone}`}>
                          {formatStatus(order.status)}
                        </span>
                        <strong>{formatCurrency(order.total)}</strong>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </>
      ) : (
        <p className="muted small account-sheet__notice">
          This account is not a customer account, so order history is not kept
          here. Your work lives in your own workspace.
        </p>
      )}

      <div className="account-sheet__cta-row">
        {canSeeOrders ? null : (
          <Link
            className="btn btn-primary btn-block"
            to={homeRoute}
            onClick={onClose}
          >
            Go to my workspace
          </Link>
        )}
        <Link
          className="btn btn-outline btn-block"
          to={
            role === ROLES.CUSTOMER && currentStoreSlug
              ? `/s/${currentStoreSlug}/profile`
              : ROUTES.PROFILE
          }
          onClick={onClose}
        >
          View full profile
        </Link>
        <button
          type="button"
          className="btn btn-ghost btn-block"
          onClick={onLogout}
        >
          Log out
        </button>
      </div>
    </>
  );
}


export default function CustomerAccountSheet({ open, onClose, store }) {
  const {
    user,
    isAuthenticated,
    role,
    runsStore,
    storeRole,
    homeRoute,
    customerHomeRoute,
    logout,
    // The stores this account shops at - a shopper who signed up here has this
    // one in the list.
    shoppingStores,
  } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  // The store being browsed, handed to the auth pages so a signup/sign-in here
  // is recorded against it. `store` is the document ShopPage already loaded.
  const storeSlug = store?.slug || '';
  const storeName = store?.name || '';
  const storePath = storeSlug ? shopPath(storeSlug) : '';

  // GET /orders/mine is customer/admin only - mirror that here instead of
  // firing a request the API will reject for riders and store staff.
  const canSeeOrders = role === ROLES.CUSTOMER || role === ROLES.ADMIN;

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadOrders = useCallback(async () => {
    if (!canSeeOrders) return;
    setLoading(true);
    setError('');

    try {
      const list = await orderService.getMyOrders();
      setOrders(Array.isArray(list) ? list : []);
    } catch (err) {
      setError(err.message || 'Could not load your orders.');
    } finally {
      setLoading(false);
    }
  }, [canSeeOrders]);

  // Refresh whenever the sheet opens, and again right after signing in.
  useEffect(() => {
    if (!open) return undefined;

    if (!canSeeOrders) {
      setOrders([]);
      setError('');
      return undefined;
    }

    loadOrders();
    return undefined;
  }, [open, canSeeOrders, loadOrders]);

  // Lock the page behind the sheet, close it with Escape (same as CartDrawer).
  useEffect(() => {
    if (!open) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const handleLogout = () => {
    // Auth-door rule shared with the navbar: customers NEVER land on the
    // staff portal (/login). They go to the login page OF THE STORE they
    // logged out from (/s/<slug>/login): this storefront first, else the
    // last visited store, else the catalogue fallback. Everyone else keeps
    // the portal login.
    const loggingOutAsCustomer = role === ROLES.CUSTOMER && !runsStore;
    const logoutSlug = storeSlug || lastStoreVisit() || '';
    const target = loggingOutAsCustomer
      ? logoutSlug
        ? `/s/${logoutSlug}/login`
        : customerHomeRoute || ROUTES.STORE
      : ROUTES.LOGIN;

    logout();
    setOrders([]);
    onClose();
    navigate(target, { replace: true });
  };

  return (
    <div
      className="account-sheet"
      role="dialog"
      aria-modal="true"
      aria-label="Your account"
    >
      <button
        type="button"
        className="account-sheet__scrim"
        aria-label="Close account"
        onClick={onClose}
      />

      <div className="account-sheet__panel">
        <div className="account-sheet__head">
          <strong>My account</strong>
          <button
            type="button"
            className="account-sheet__close"
            onClick={onClose}
            aria-label="Close account"
          >
            ✕
          </button>
        </div>

        {store?.name ? (
          <p className="muted small account-sheet__context">
            Shopping at {store.name}
          </p>
        ) : null}

        {isAuthenticated && user ? (
          <SignedInBody
            user={user}
            label={accountLabel(role, runsStore, storeRole)}
            homeRoute={homeRoute}
            canSeeOrders={canSeeOrders}
            orders={orders}
            loading={loading}
            error={error}
            onRetry={loadOrders}
            onClose={onClose}
            onLogout={handleLogout}
            shoppingStores={shoppingStores}
            currentStoreSlug={storeSlug}
          />
        ) : (
          <GuestBody
            from={location}
            storeSlug={storeSlug}
            storeName={storeName}
            storePath={storePath}
          />
        )}
      </div>
    </div>
  );
}

