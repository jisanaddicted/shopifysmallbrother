import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

/**
 * The store's menu as a slide-in drawer, for phones.
 *
 * Modelled on CartDrawer (same scrim, same Escape-to-close, same page lock) so
 * the two side panels in this app behave identically — a shopper who has just
 * closed the cart already knows how to close this one. The cart slides in from
 * the right because it is reached from the header's right-hand buttons; this
 * one slides in from the LEFT because the button that opens it sits on the left,
 * so the panel grows out from under the thumb that summoned it.
 *
 * The menu tree is the merchant's own, built server-side (menuController's
 * `buildTree`) — a phone shopper gets the real navigation, not a reduced menu.
 */
export default function StoreMenuDrawer({ menu, open, onClose }) {
  // A Set rather than one id: closing a branch the moment another opens makes
  // a deep menu feel like it is fighting the shopper.
  const [openIds, setOpenIds] = useState(() => new Set());

  // Reopening starts from a clean tree, otherwise the panel reappears showing
  // whatever branch happened to be open when they navigated away.
  useEffect(() => {
    if (!open) setOpenIds(new Set());
  }, [open]);

  // Lock the page behind the panel and close on Escape, exactly as CartDrawer.
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

  const toggle = useCallback((id) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const isExternal = (href) => /^https?:\/\//i.test(href || '');

  function Row({ node, depth = 0 }) {
    const hasChildren = node.children && node.children.length > 0;
    const isOpen = openIds.has(node.id);
    // Mirrors the desktop nav: a top-level item shows the label the merchant
    // typed, while nested items show what they point at (a product/category
    // name) and fall back to their own label.
    const text = depth === 0 ? node.label : node.targetLabel || node.label;

    return (
      <li className={`smenu__item${hasChildren ? ' has-children' : ''}${isOpen ? ' is-open' : ''}`}>
        <div className="smenu__row">
          {isExternal(node.href) ? (
            <a
              className="smenu__link"
              href={node.href || '#'}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onClose}
            >
              {text}
            </a>
          ) : (
            <Link className="smenu__link" to={node.href || '#'} onClick={onClose}>
              {text}
            </Link>
          )}

          {hasChildren ? (
            <button
              type="button"
              className="smenu__toggle"
              aria-expanded={isOpen}
              aria-label={`${isOpen ? 'Hide' : 'Show'} submenu for ${node.label}`}
              onClick={() => toggle(node.id)}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
          ) : null}
        </div>

        {hasChildren && isOpen ? (
          <ul className="smenu__sub">
            {node.children.map((child) => (
              <Row key={child.id} node={child} depth={depth + 1} />
            ))}
          </ul>
        ) : null}
      </li>
    );
  }

  return (
    <div className={`drawer drawer--left ${open ? 'drawer--open' : ''}`} aria-hidden={!open}>
      <button
        type="button"
        className="drawer__overlay"
        aria-label="Close menu"
        tabIndex={open ? 0 : -1}
        onClick={onClose}
      />

      <aside className="drawer__panel" role="dialog" aria-label="Store menu">
        <header className="drawer__header">
          <h2>Menu</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close menu">
            ✕
          </button>
        </header>

        <div className="drawer__body">
          {menu && menu.length ? (
            <ul className="smenu">
              {menu.map((item) => (
                <Row key={item.id} node={item} />
              ))}
            </ul>
          ) : (
            <p className="muted">This store has not set up a menu yet.</p>
          )}
        </div>
      </aside>
    </div>
  );
}