import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { HOME_ROUTE_BY_ROLE, ROUTES } from '../../utils/constants';
import { initials } from '../../utils/formatters';

/**
 * Side-navbar shell for the back-office areas (store dashboard + admin
 * panel). Replaces the top <Navbar/> on those routes so the merchant and the
 * admin get a persistent left rail instead of top links.
 *
 * variant="merchant" -> My store, Products, Profile
 * variant="admin"    -> Dispatch, Products, Stores, Profile
 *
 * On small screens the rail collapses behind a hamburger in a slim top bar.
 */
export default function DashboardLayout({ variant = 'merchant' }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

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
        { to: ROUTES.PROFILE, label: 'Profile', icon: '👤', end: false },
      ]
    : [
        { to: ROUTES.ADMIN_DASHBOARD, label: 'Dispatch', icon: '🧭', end: true },
        { to: ROUTES.ADMIN_PRODUCTS, label: 'Products', icon: '📦', end: false },
        { to: ROUTES.ADMIN_STORES, label: 'Stores', icon: '🏬', end: false },
        { to: ROUTES.PROFILE, label: 'Profile', icon: '👤', end: false },
      ];

  const title = isMerchant ? 'Store dashboard' : 'Admin panel';
  const subtitle = isMerchant
    ? user?.username
      ? `@${user.username}`
      : user?.name || user?.email || ''
    : 'Platform controls';

  return (
    <div className="dash">
      {/* Slim top bar - only visible on narrow screens, toggles the rail. */}
      <div className="dash__mobilebar">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? 'Close menu' : 'Open menu'}
        >
          {open ? '✕' : '☰'}
        </button>
        <Link to={brandTarget} className="dash__mobilebrand">
          DeliveryApp · {title}
        </Link>
      </div>

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

      <div className="dash__content">
        <Outlet />
      </div>
    </div>
  );
}
