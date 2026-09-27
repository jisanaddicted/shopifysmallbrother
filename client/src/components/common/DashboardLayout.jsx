import { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import storeService from '../../services/storeService';
import { HOME_ROUTE_BY_ROLE, ROUTES } from '../../utils/constants';
import { initials } from '../../utils/formatters';

/**
 * Side-navbar shell for the back-office areas (store dashboard + admin
 * panel). Replaces the top <Navbar/> on those routes so the merchant and the
 * admin get a persistent left rail instead of top links.
 *
 * variant="merchant" -> My store, Products, Rider tracker, Theme
 * variant="admin"    -> Dispatch, Products, Invitations, Theme
 *
 * The admin rail shows a count badge on Invitations while a store is waiting
 * for an answer (refreshed on every navigation, so accepting from the page
 * clears it).
 *
 * The profile avatar lives in the top-right corner of the content topbar
 * (not in the sidebar). On small screens the rail collapses behind a
 * hamburger in that same topbar.
 */
export default function DashboardLayout({ variant = 'merchant' }) {
  const { user, logout, stores } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  // Pending store invitations addressed to this admin account.
  const [pendingInvites, setPendingInvites] = useState(0);

  const isAdmin = variant === 'admin';

  const loadPendingInvites = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const requests = await storeService.listMyRequests();
      setPendingInvites(
        requests.filter((request) => request.role === 'admin').length,
      );
    } catch {
      // The badge is decoration - never block the shell on it.
    }
  }, [isAdmin]);

  // Re-check on navigation AND whenever the session's store list changes -
  // accepting an invitation refreshes it, which clears the badge right away.
  useEffect(() => {
    loadPendingInvites();
  }, [loadPendingInvites, location.pathname, stores]);

  const handleLogout = () => {
    logout();
    navigate(ROUTES.LOGIN, { replace: true });
  };

  const brandTarget = HOME_ROUTE_BY_ROLE[user?.role] || ROUTES.HOME;
  const isMerchant = variant === 'merchant';

    const links = isMerchant
    ? [
        { to: ROUTES.MERCHANT_DASHBOARD, label: 'My store', icon: '🏪', end: true },
        { to: ROUTES.MERCHANT_PRODUCTS, label: 'Products', icon: '📦', end: false },
        // Live delivery map: where each rider of this store is right now.
        { to: ROUTES.MERCHANT_RIDERS, label: 'Rider tracker', icon: '🛵', end: false },
        // How long deliveries take here, split by who owned each wait.
        {
          to: ROUTES.MERCHANT_ANALYTICS,
          label: 'Rider analytics',
          icon: '📈',
          end: false,
        },
        { to: ROUTES.MERCHANT_THEME, label: 'Theme', icon: '🎨', end: false },
      ]
    : [
        { to: ROUTES.ADMIN_DASHBOARD, label: 'Dispatch', icon: '🧭', end: true },
        { to: ROUTES.ADMIN_PRODUCTS, label: 'Products', icon: '📦', end: false },
        // Stores invite this admin by username; the answer happens here.
        {
          to: ROUTES.ADMIN_INVITATIONS,
          label: 'Invitations',
          icon: '✉️',
          end: false,
          badge: pendingInvites,
        },
        { to: ROUTES.ADMIN_THEME, label: 'Theme', icon: '🎨', end: false },
      ];

  const title = isMerchant ? 'Store dashboard' : 'Admin panel';
  const subtitle = isMerchant
    ? user?.username
      ? `@${user.username}`
      : user?.name || user?.email || ''
    : 'Platform controls';

  return (
    <div className="dash">
      <aside className={`dash__sidebar ${open ? 'is-open' : ''}`}>
        <Link
          to={brandTarget}
          className="dash__brand"
          onClick={() => setOpen(false)}
        >
          <span className="navbar__logo" aria-hidden="true">
            →
          </span>
          <span>
            <span className="dash__brand-name">DeliveryApp</span>
            <span className="dash__brand-sub">{title}</span>
          </span>
        </Link>

        <p className="dash__who">
          <span className="avatar" aria-hidden="true">
            {initials(user?.name || user?.email)}
          </span>
          <span>
            <span className="dash__who-name">
              {user?.name || user?.email || 'Account'}
            </span>
            {subtitle ? (
              <span className="muted small block">{subtitle}</span>
            ) : null}
          </span>
        </p>

        <nav className="dash__nav" aria-label={title}>
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `dash__link${isActive ? ' is-active' : ''}`
              }
            >
              <span aria-hidden="true">{link.icon}</span>
              {link.label}
              {link.badge > 0 ? (
                <span
                  className="badge badge--warn"
                  style={{ marginLeft: 'auto' }}
                  title={`${link.badge} pending invitation(s)`}
                >
                  {link.badge}
                </span>
              ) : null}
            </NavLink>
          ))}
        </nav>

        <div className="dash__footer">
          <button
            type="button"
            className="btn btn-outline btn-sm btn-block"
            onClick={handleLogout}
          >
            Log out
          </button>
        </div>
      </aside>

      {open ? (
        <button
          type="button"
          className="dash__scrim"
          aria-label="Close menu"
          onClick={() => setOpen(false)}
        />
      ) : null}

      <div className="dash__main">
        <header className="dash__topbar">
          <div className="dash__topbar-left">
            <button
              type="button"
              className="btn btn-ghost btn-sm dash__menu-btn"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-label={open ? 'Close menu' : 'Open menu'}
            >
              {open ? '✕' : '☰'}
            </button>
            <span className="dash__topbar-title">{title}</span>
          </div>

          <Link
            className="dash__profile"
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
            <span className="dash__profile-name">
              {user?.username
                ? `@${user.username}`
                : user?.name || user?.email || 'Profile'}
            </span>
          </Link>
        </header>

        <div className="dash__content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
