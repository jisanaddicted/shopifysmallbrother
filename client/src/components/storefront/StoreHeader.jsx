import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { logoSizeStyle } from '../../utils/constants';

/**
 * Store header for the public storefront (`/s/<slug>`).
 * Left: the three-line menu button (phones only) + the store logo, shown on its
 * own. The logo carries the whole identity - no name is printed beside it - and
 * the image itself is borderless, sized in CSS from the merchant's Theme-tab
 * choice (`Store.logoSize`) because it is now the only thing naming the shop. A
 * store that has not uploaded a logo falls back to its initials, which is what
 * `store-header__mark` draws.
 * On a phone the logo is CENTRED between the menu button and the icons; on a
 * desktop it sits at the left edge. Same markup both ways - see the grid in
 * `.store-header`.
 * Right: cart icon button (opens the cart drawer) + account icon link.
 *
 * The account link carries the store's identity in its state, so a guest who
 * taps it lands on /login (and from there /register) *as a customer of this
 * store* - the API links the account the moment they sign up or sign in.
 *
 * The menu button is passed in rather than rendered here unconditionally: it
 * only makes sense on a storefront that actually has a menu, and the CSS keeps
 * it hidden on desktop where the horizontal nav bar is the navigation.
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

/* Three bars, drawn as SVG so they stay an even thickness and crisp at any
   size, rather than borrowing the ☰ glyph (which varies by font). */
function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

export default function StoreHeader({
  store,
  itemCount,
  user,
  onCartClick,
  onMenuClick,
}) {
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
      {/* Cell 1: the phone-only menu button. Empty on a desktop, where the nav
          bar below the header is the navigation - and the CSS leans on that
          emptiness to keep the logo hard against the left edge. */}
      <div className="store-header__brand">
        {/* Phones only (CSS). Opens the store menu as a drawer from the left,
            matching the cart drawer on the right side of the header. */}
        {onMenuClick ? (
          <button
            type="button"
            className="store-header__menu-btn"
            onClick={onMenuClick}
            aria-label="Open store menu"
          >
            <MenuIcon />
          </button>
        ) : null}
      </div>

      {/* Cell 2: the logo, on its own. It is a cell of its own rather than
          sitting inside the brand row so that a phone can centre it between
          the menu button and the icons. `--store-logo-scale` is the size the
          merchant picked in the Theme tab (see logoSizeStyle). */}
      <div
        className="store-header__identity"
        style={logoSizeStyle(store?.logoSize)}
      >
        {logo ? (
          <img
            src={logo}
            alt={`${name} logo`}
            /* No name is printed beside the logo, so the name is still one
               hover (or one screen-reader stop) away. */
            title={name}
            className="store-header__logo"
            onError={() => setLogoBroken(true)}
          />
        ) : (
          /* Nothing uploaded yet: the initials block stands in for the logo, and
             the store's name rides along off-screen so it is not lost from the
             page entirely. */
          <>
            <span className="store-header__mark" aria-hidden="true">
              {initialsOf(name)}
            </span>
            <span className="sr-only">{name}</span>
          </>
        )}
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

        {/* The account button is the storefront's way in: signed-in customers
            stay inside their store (/s/<slug>/profile), guests go to THIS
            store's own sign-up/sign-in pages (/s/<slug>/...), never the
            generic staff ones. */}
        <Link
          to={
            user
              ? store?.slug
                ? `/s/${store.slug}/profile`
                : '/profile'
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
