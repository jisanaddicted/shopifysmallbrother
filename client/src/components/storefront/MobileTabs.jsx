import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ROUTES, shopPath } from '../../utils/constants';

/**
 * Mobile-only bottom tab bar for the customer storefront (`/s/<slug>`).
 * Green bar with 5 tabs: Home · Menu · Cart · Search · Account.
 * Rendered only on small screens via CSS (.mobile-tabs).
 */

function Icon({ d, filled }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

const ICONS = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1Z',
  menu: 'M4 6h16M4 12h16M4 18h16',
  search: 'M11 4a7 7 0 1 0 4.9 12L21 21l-1.4 1.4-5.1-5.1A7 7 0 0 0 11 4Zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z',
};

function HomeIcon() {
  return <Icon d={ICONS.home} />;
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </svg>
  );
}

function CartIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5.5 8h13l-1.2 8.2a1.8 1.8 0 0 1-1.8 1.6H8.3a1.8 1.8 0 0 1-1.8-1.6Z" />
      <path d="M8.5 10V6.5a3.5 3.5 0 0 1 7 0V10" />
    </svg>
  );
}

function SearchIcon() {
  return <Icon d={ICONS.search} />;
}

function AccountIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 21a8 8 0 0 0-16 0" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

export default function MobileTabs({ store, itemCount, user, onCartClick, onSearchClick, onMenuClick, menuOpen }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [accountPulse, setAccountPulse] = useState(false);

  const slug = store?.slug || '';
  const homePath = slug ? shopPath(slug) : ROUTES.STORE;
  const isHome = slug
    ? location.pathname === homePath && !location.search
    : location.pathname === ROUTES.STORE;
  const accountPath = user ? ROUTES.PROFILE : ROUTES.LOGIN;

  const handleAccount = () => {
    setAccountPulse(true);
    setTimeout(() => setAccountPulse(false), 350);
    navigate(accountPath);
  };

  return (
    <nav className="mobile-tabs" aria-label="Store shortcuts">
      <Link to={homePath} className={`mobile-tabs__tab${isHome ? ' is-active' : ''}`} aria-label="Home">
        <span className="mobile-tabs__icon"><HomeIcon /></span>
        <span className="mobile-tabs__label">HOME</span>
      </Link>

      <button
        type="button"
        className={`mobile-tabs__tab${menuOpen ? ' is-active' : ''}`}
        onClick={onMenuClick}
        aria-expanded={Boolean(menuOpen)}
        aria-label="Open menu categories"
      >
        <span className="mobile-tabs__icon"><MenuIcon /></span>
        <span className="mobile-tabs__label">MENU</span>
      </button>

      <button
        type="button"
        className="mobile-tabs__tab mobile-tabs__tab--cart"
        onClick={onCartClick}
        aria-label={itemCount > 0 ? `Open cart, ${itemCount} items` : 'Open cart'}
      >
        <span className="mobile-tabs__icon">
          <CartIcon />
          <span className="mobile-tabs__badge">{itemCount > 99 ? '99+' : itemCount}</span>
        </span>
        <span className="mobile-tabs__label">CART</span>
      </button>

      <button
        type="button"
        className="mobile-tabs__tab"
        onClick={onSearchClick}
        aria-label="Search this store"
      >
        <span className="mobile-tabs__icon"><SearchIcon /></span>
        <span className="mobile-tabs__label">SEARCH</span>
      </button>

      <button
        type="button"
        className={`mobile-tabs__tab${accountPulse ? ' is-pulse' : ''}`}
        onClick={handleAccount}
        aria-label={user ? 'My account' : 'Log in'}
      >
        <span className="mobile-tabs__icon"><AccountIcon /></span>
        <span className="mobile-tabs__label">ACCOUNT</span>
      </button>
    </nav>
  );
}
