import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { buildCategoryTree, pathToNode } from '../../utils/categoryTree';

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
 * Theme 1 shows the merchant's own menu, built server-side (menuController's
 * `buildTree`) — a phone shopper gets the real navigation, not a reduced menu.
 *
 * Theme 2 leads with the CATEGORY TREE instead, and that is a change of what
 * this panel is FOR, not a swap of one list for another. On Theme 2 the
 * categories ARE the navigation - the drill-down on the page is the store - and
 * the merchant's menu was generated from the Theme 1 category list (see
 * menuController's auto-seed), which is a different, older set of the same idea.
 * Showing both as equals would put two competing sets of categories in one
 * drawer, and the shopper would have no way to tell which the page follows.
 */
export default function StoreMenuDrawer({
  menu,
  tree = [],
  isTreeTheme = false,
  treeLoading = false,
  open,
  onClose,
}) {
  // A Set rather than one id: closing a branch the moment another opens makes
  // a deep menu feel like it is fighting the shopper.
  const [openIds, setOpenIds] = useState(() => new Set());

  // The Theme 2 branch the shopper is inside, read from the same URL the page
  // uses. The drawer navigates by writing `?c=`, so tapping a category here
  // moves the page underneath it rather than opening a separate view of the same
  // place - the two can never end up showing different nodes.
  const [searchParams, setSearchParams] = useSearchParams();
  const activeId = searchParams.get('c') || null;

  const builtTree = useMemo(() => buildCategoryTree(tree), [tree]);

  /* Branches to leave open no matter what the shopper has clicked: the path to
   * wherever they currently are.
   *
   * Without this, opening the drawer from three levels deep would show a
   * collapsed top level with no sign of where they are - the panel would look
   * like the store's root while the page behind it showed a subcategory. */
  const onPath = useMemo(() => {
    const path = pathToNode(builtTree, activeId);
    return new Set(path.map((node) => node.id));
  }, [builtTree, activeId]);

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

  /* A Theme 2 category row.
   *
   * Tapping the NAME drills in; the chevron only opens and closes the branch.
   * Kept apart on purpose - a row that both navigates and expands makes one of
   * the two wrong whenever the shopper aims for the other, and on a phone they
   * are aiming at the name, which is far bigger than the chevron. */
  function TreeRow({ node }) {
    const children = node.children || [];
    const hasChildren = children.length > 0;
    const isOpen = openIds.has(node.id) || onPath.has(node.id);
    const isHere = node.id === activeId;

    // How much is behind this category, so a shopper can tell an empty branch
    // from a stocked one before tapping. The same number the card on the page
    // shows, for the same reason - one rule rather than two that can disagree.
    const behind = (node.childCount || children.length) + (node.productCount || 0);

    return (
      <li className={`smenu__item${hasChildren ? ' has-children' : ''}${isOpen ? ' is-open' : ''}`}>
        <div className="smenu__row">
          <button
            type="button"
            className={`smenu__link smenu__link--tree${isHere ? ' is-current' : ''}`}
            aria-current={isHere ? 'page' : undefined}
            onClick={() => {
              // Pushing rather than replacing, for the same reason the page's own
              // cards do: drilling in is a navigation, so Back has to mean "up one
              // level" rather than leaving the store entirely.
              setSearchParams({ c: node.id });
              onClose();
            }}
          >
            <span className="smenu__label">{node.name}</span>
            {behind > 0 ? <span className="smenu__count">{behind}</span> : null}
          </button>

          {hasChildren ? (
            <button
              type="button"
              className="smenu__toggle"
              aria-expanded={isOpen}
              aria-label={`${isOpen ? 'Hide' : 'Show'} categories inside ${node.name}`}
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
            {children.map((child) => (
              <TreeRow key={child.id} node={child} />
            ))}
          </ul>
        ) : null}
      </li>
    );
  }

  /* The merchant's own menu, minus the entries that are just Theme 1 categories.
   *
   * On Theme 2 those are a second copy of the tree above, built from a different
   * category list - showing them would be showing the shopper two answers to
   * "what are my categories". Product links and external URLs are a different
   * thing entirely and are kept, so hand-built navigation still works on both
   * themes and nothing the merchant made silently disappears. */
  const extraLinks = useMemo(() => {
    const all = Array.isArray(menu) ? menu : [];
    if (!isTreeTheme) return all;
    return all.filter((item) => item?.targetType && item.targetType !== 'category');
  }, [menu, isTreeTheme]);

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
          <h2>{isTreeTheme ? 'Categories' : 'Menu'}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close menu">
            ✕
          </button>
        </header>

        <div className="drawer__body">
          {isTreeTheme ? (
            <>
              {/* A way back to the top, offered even while already at the top so the
                  control does not appear and vanish as the shopper moves around. */}
              {builtTree.length > 0 && activeId ? (
                <button
                  type="button"
                  className="smenu__top"
                  onClick={() => {
                    // Drop the parameter rather than blanking it, so the top of the
                    // tree is the same clean URL it was before anybody tapped.
                    setSearchParams({});
                    onClose();
                  }}
                >
                  ← All categories
                </button>
              ) : null}

              {treeLoading ? <p className="muted small">Loading categories…</p> : null}

              {!treeLoading && builtTree.length > 0 ? (
                <ul className="smenu">
                  {builtTree.map((node) => (
                    <TreeRow key={node.id} node={node} />
                  ))}
                </ul>
              ) : null}

              {!treeLoading && builtTree.length === 0 ? (
                <p className="muted">This store has not set up its categories yet.</p>
              ) : null}
            </>
          ) : null}

          {/* The merchant's own links: the whole menu on Theme 1, and on Theme 2
              only the things the tree cannot express. */}
          {extraLinks.length > 0 ? (
            <>
              {isTreeTheme && builtTree.length > 0 ? (
                <p className="smenu__heading">More from this store</p>
              ) : null}
              <ul className="smenu">
                {extraLinks.map((item) => (
                  <Row key={item.id} node={item} />
                ))}
              </ul>
            </>
          ) : null}

          {/* Last, so it only shows when there is genuinely nothing at all - a
              Theme 2 store mid-load must not claim to have no categories while
              they are still on their way. */}
          {!isTreeTheme && extraLinks.length === 0 ? (
            <p className="muted">This store has not set up a menu yet.</p>
          ) : null}
        </div>
      </aside>
    </div>
  );
}