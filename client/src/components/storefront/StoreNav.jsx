import { Link } from 'react-router-dom';

/**
 * A Shopify-style horizontal navbar rendered on the public storefront
 * (`/s/<slug>`). The menu tree is built server-side (see menuController's
 * `buildTree`) — each item carries an `href` and `targetLabel` so the nav
 * never needs a second API call to resolve links.
 *
 * Items with `children` render as hover dropdowns (Shopify-style). On touch
 * devices the dropdown is toggled with a small caret button next to the label.
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

function NavItem({ item }) {
  const hasChildren = item.children && item.children.length > 0;
  const external = isExternal(item.href);

  if (hasChildren) {
    return (
      <li className="store-nav__item has-dropdown">
        <NavLink
          to={item.href || '#'}
          label={item.label}
          isExternal={external}
        />
        <span
          className="store-nav__caret"
          aria-label={`Toggle ${item.label} submenu`}
          role="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const parentLi = e.currentTarget.closest('li');
            parentLi.classList.toggle('open');
          }}
        >
          ▾
        </span>
        <ul className="store-nav__submenu">
          {item.children.map((child) => (
            <NavItem key={child.id} item={child} />
          ))}
        </ul>
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
  if (!menu || !menu.length) return null;

  return (
    <nav className="store-nav" aria-label="Main navigation">
      <ul className="store-nav__list">
        {menu.map((item) => (
          <NavItem key={item.id} item={item} />
        ))}
      </ul>
    </nav>
  );
}
