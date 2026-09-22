import { useState } from 'react';
import { Link } from 'react-router-dom';

/**
 * A Shopify-style horizontal navbar rendered on the public storefront
 * (`/s/<slug>`). The menu tree is built server-side (see menuController's
 * `buildTree`) — each item carries an `href` and `targetLabel` so the nav
 * never needs a second API call to resolve links.
 *
 * Top-level items with `children` render as full-width mega menus on hover
 * (desktop). On touch devices the mega menu is toggled with a small caret
 * button next to the label.
 */

function isExternal(href) {
  return /^https?:\/\//i.test(href || '');
}

function NavLink({ to, label, isExternal: external, onClick }) {
  if (external) {
    return (
      <a
        href={to}
        className="store-nav__link"
        target="_blank"
        rel="noopener noreferrer"
        onClick={onClick}
      >
        {label}
      </a>
    );
  }
  return (
    <Link to={to} className="store-nav__link" onClick={onClick}>
      {label}
    </Link>
  );
}

function MegaMenuPanel({ children, parentLabel, closeMenu }) {
  return (
    <div className="store-nav__mega" role="menu" aria-label={`${parentLabel} submenu`}>
      <ul className="store-nav__mega-list">
        {children.map((child) => (
          <li key={child.id} className="store-nav__mega-item">
            <NavLink
              to={child.href || '#'}
              label={child.targetLabel || child.label}
              isExternal={isExternal(child.href)}
              onClick={closeMenu}
            />
            {child.children && child.children.length > 0 ? (
              <ul className="store-nav__mega-sub">
                {child.children.map((grand) => (
                  <li key={grand.id} className="store-nav__mega-sub-item">
                    <NavLink
                      to={grand.href || '#'}
                      label={grand.targetLabel || grand.label}
                      isExternal={isExternal(grand.href)}
                      onClick={closeMenu}
                    />
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function NavItem({ item, openId, setOpenId }) {
  const hasChildren = item.children && item.children.length > 0;
  const external = isExternal(item.href);
  const isOpen = openId === item.id;

  if (hasChildren) {
    return (
      <li
        className={`store-nav__item has-dropdown${isOpen ? ' open' : ''}`}
        onMouseEnter={() => setOpenId(item.id)}
        onMouseLeave={() => setOpenId(null)}
      >
        <div className="store-nav__row">
          <NavLink
            to={item.href || '#'}
            label={item.label}
            isExternal={external}
            onClick={() => setOpenId(null)}
          />
          <button
            type="button"
            className="store-nav__caret"
            aria-expanded={isOpen}
            aria-label={`Toggle ${item.label} submenu`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOpenId(isOpen ? null : item.id);
            }}
          >
            ▾
          </button>
        </div>
        <MegaMenuPanel
          children={item.children}
          parentLabel={item.label}
          closeMenu={() => setOpenId(null)}
        />
      </li>
    );
  }

  return (
    <li className="store-nav__item">
      <NavLink
        to={item.href || '#'}
        label={item.label}
        isExternal={external}
      />
    </li>
  );
}

export default function StoreNav({ menu }) {
  const [openId, setOpenId] = useState(null);

  if (!menu || !menu.length) return null;

  return (
    <nav
      className="store-nav"
      aria-label="Main navigation"
      onMouseLeave={() => setOpenId(null)}
    >
      <ul className="store-nav__list">
        {menu.map((item) => (
          <NavItem key={item.id} item={item} openId={openId} setOpenId={setOpenId} />
        ))}
      </ul>
    </nav>
  );
}

