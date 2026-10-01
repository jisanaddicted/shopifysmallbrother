import { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import storeService from '../../services/storeService';
import { HOME_ROUTE_BY_ROLE, ROUTES } from '../../utils/constants';
import { initials } from '../../utils/formatters';
import ronexLogo from '../../assets/images/ronex-mart-logo.png';

/**
 * Side-navbar shell for the back-office areas (store dashboard + admin
 * panel). Replaces the top <Navbar/> on those routes so the merchant and the
 * admin get a persistent left rail instead of top links.
 *
 * variant="merchant" -> My store, Orders, Customers, Products, Rider tracker,
 *                      Rider analytics, Theme
 * variant="rider"    -> My deliveries, Analytics
 * variant="admin"    -> Orders, Products, Invitations, Theme
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
  const isRiderShell = variant === 'rider';

  /*
   * Three back-office shells, one per variant. The rider's rail is short: the
   * console and their own numbers, which is the same pair the rider navbar used
   * to carry across the top.
   *
   * No icons. The rail is a text list, and the emoji that used to lead each row
   * (a shop, a receipt, a box, a chart, a palette) were decorative duplicates of
   * the word beside them - they added a second, noisier labelling of the same
   * six things, they rendered differently on every OS, and they were the widest
   * thing in the row, so the labels did not line up. The active row is already
   * marked by the brand-tinted background.
   */
  const merchantLinks = [
    { to: ROUTES.MERCHANT_DASHBOARD, label: 'My store', end: true },
    // The order book and the customer list used to be two tables at the bottom
    // of "My store". They are pages of their own now: both are things a
    // merchant comes back to and searches, and neither is something you scroll
    // past once on the way to the team panel.
    { to: ROUTES.MERCHANT_ORDERS, label: 'Orders', end: false },
    { to: ROUTES.MERCHANT_CUSTOMERS, label: 'Customers', end: false },
    { to: ROUTES.MERCHANT_PRODUCTS, label: 'Products', end: false },
    // How long deliveries take here, split by who owned each wait.
    { to: ROUTES.MERCHANT_ANALYTICS, label: 'Rider analytics', end: false },
    { to: ROUTES.MERCHANT_THEME, label: 'Theme', end: false },
  ];

  const riderLinks = [
    { to: ROUTES.RIDER_CONSOLE, label: 'My deliveries', end: true },
    { to: ROUTES.RIDER_ANALYTICS, label: 'Analytics', end: false },
  ];

  const adminLinks = [
    { to: ROUTES.ADMIN_DASHBOARD, label: 'Orders', end: true },
    // Live delivery map across the stores this admin runs. Moved here from the
    // store dashboard: watching every rider at once is an operations view, and
    // an admin with several stores picks which one from this page.
    { to: ROUTES.ADMIN_RIDERS, label: 'Rider tracker', end: false },
    // Stores invite this admin by username; the answer happens here.
    {
      to: ROUTES.ADMIN_INVITATIONS,
      label: 'Invitations',
      end: false,
      badge: pendingInvites,
    },
    // No Products tab either. A product belongs to ONE store, and the catalogue
    // an admin runs across several stores is not theirs to edit - the store's
    // own dashboard carries that tab (see merchantLinks above). The
    // /admin/products ROUTE stays mounted for the same reason as Theme below.
    //
    // No Theme tab here. The builder edits ONE store's storefront, and that
    // store's own dashboard carries the tab for it (see merchantLinks above);
    // an admin running several stores has no single store to point it at. The
    // ROUTE is deliberately left mounted so an old bookmark or a shared link to
    // /admin/theme still lands on the page instead of a not-found.
  ];

  const links = isRiderShell
    ? riderLinks
    : isMerchant
      ? merchantLinks
      : adminLinks;

  const title = isRiderShell
    ? 'Rider console'
    : isMerchant
      ? 'Store dashboard'
      : 'Admin panel';

  return (
    <div className="dash">
      <aside className={`dash__sidebar ${open ? 'is-open' : ''}`}>
        {/*
          Brand lockup: the Ronex Mart logo, not the words "DeliveryApp" over a
          panel name. The arrow glyph and the two text lines were saying the same
          thing twice - the product name belongs in the logo, and the panel name
          is already in the topbar directly opposite, so printing it here as well
          just made the rail heavier at the top of every page.

          The logo is the link's accessible name now, so the panel name is folded
          into the alt text rather than dropped - it still tells a screen reader
          which panel they are in, and the <nav> below carries it as its
          aria-label too.
        */}
        <Link
          to={brandTarget}
          className="dash__brand"
          onClick={() => setOpen(false)}
        >
          <img
            className="dash__brand-logo"
            src={ronexLogo}
            alt={`Ronex Mart — ${title}`}
          />
        </Link>

        {/*
          The signed-in card that used to sit here is gone.

          It repeated what the topbar already says directly opposite: the same
          avatar, the same name, the same @handle. With the logo above it, the
          rail opened with three stacked identity blocks before a merchant
          reached a single navigation link - and the username is the one thing
          in there a merchant never needs to re-read on every page. The topbar
          profile link still carries it, so nothing is lost.
        */}

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
