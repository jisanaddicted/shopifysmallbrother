import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

/**
 * Store header for the public storefront (`/s/<slug>`).
 * Left: store logo (image when the store has one, otherwise initial + name).
 * Right: cart icon button (opens the cart drawer) + account icon link.
 *
 * The account link carries the store's identity in its state, so a guest who
 * taps it lands on /login (and from there /register) *as a customer of this
 * store* - the API links the account the moment they sign up or sign in.
 */

function initialsOf(name) {
  return (
    String(name || '?')
      .trim()
      .split(/\s+/)
      .map((w) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || '?'
  );
}

export default function StoreHeader({ store, itemCount, user, onCartClick }) {
  const [logoBroken, setLogoBroken] = useState(false);
  const location = useLocation();
  const name = store?.name || 'Store';
  const logo = !logoBroken ? store?.logo || store?.logoUrl || store?.image : null;

  // The store context /login and /register need to link the account here.
  const authState = {
    from: location,
    ...(store?.slug
      ? {
          storeSlug: store.slug,
          storeName: store.name || '',
          storePath: store.publicPath || `/s/${store.slug}`,
        }
      : {}),
  };

  return (
    <header className="store-header">
      <div className="store-header__brand">
        {logo ? (
          <img
            src={logo}
            alt={`${name} logo`}
            className="store-header__logo"
            onError={() => setLogoBroken(true)}
          />
        ) : (
          <span className="store-header__mark" aria-hidden="true">
            {initialsOf(name)}
          </span>
        )}
        <span className="store-header__name">{name}</span>
      </div>

      <div className="store-header__actions">
        <button
          type="button"
          className="store-header__icon-btn"
          onClick={onCartClick}
          aria-label={`Open cart${itemCount > 0 ? `, ${itemCount} items` : ''}`}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="9" cy="20" r="1.6" />
            <circle cx="17" cy="20" r="1.6" />
            <path d="M2.5 3.5h2l2.6 12.2a1.5 1.5 0 0 0 1.5 1.2h7.9a1.5 1.5 0 0 0 1.5-1.2L20.5 7H6" />
          </svg>
          {itemCount > 0 ? (
            <span className="store-header__badge">{itemCount > 99 ? '99+' : itemCount}</span>
          ) : null}
        </button>

        {/* The account button is the storefront's way in: signed-in users get
            their profile, guests go to THIS store's own sign-up/sign-in pages
            (/s/<slug>/...), never the generic staff ones. */}
        <Link
          to={
            user
              ? '/profile'
              : store?.slug
                ? `/s/${store.slug}/login`
                : '/login'
          }
          state={authState}
          className="store-header__icon-btn"
          aria-label={user ? 'My account' : 'Log in or create an account'}
          title={user?.name || user?.email || 'Account'}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 21a8 8 0 0 0-16 0" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </Link>
      </div>
    </header>
  );
}
