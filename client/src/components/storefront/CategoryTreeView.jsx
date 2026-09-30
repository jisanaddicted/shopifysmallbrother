import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import ProductCard from '../store/ProductCard';
import menuService from '../../services/menuService';
import { initials } from '../../utils/formatters';
import {
  buildCategoryTree,
  nodeOpens,
  pathToNode,
  productsOn,
} from '../../utils/categoryTree';

/**
 * Theme 2: the store as a tree a shopper walks down.
 *
 * THE SHAPE OF THE WHOLE FEATURE
 *
 * At any moment the shopper is looking at ONE node. If it has children, they
 * see the cards for what is inside it. If it has products of its own, they see
 * those below. Both is normal - a branch can hold its own stock and still have
 * sub-branches - and showing both beats picking one and hiding the other.
 *
 * AT THE TOP, children are the top-level categories and nothing else. A store's
 * products are deliberately not dumped there as well: this theme is a drill-down,
 * and a top level stuffed with every product in the catalogue is Theme 1 wearing
 * a different hat. Products not filed under any node are not reachable by
 * tapping - they are still findable through the search bar, which is the honest
 * place for "filed nowhere".
 *
 * The position is a URL query (`?c=<nodeId>`) rather than component state, for
 * the reason `CategoryPage` puts the category in the path: a shopper three
 * levels deep who copies the link has to send somebody those same three levels,
 * and Back has to walk back out of them. State gives neither, and filtering in
 * place would leave Back taking the whole store away.
 */
export default function CategoryTreeView({ slug, products, searchTerm }) {
  const [searchParams, setSearchParams] = useSearchParams();

  const [nodes, setNodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // The node being viewed, or null for the top level. Read from the URL, so it
  // is the single source of truth: no second copy in state to fall out of step
  // with the address bar.
  const activeId = searchParams.get('c') || null;

  useEffect(() => {
    let active = true;

    menuService
      .getPublicCategoryTree(slug)
      .then(({ tree }) => {
        if (active) setNodes(tree);
      })
      .catch((err) => {
        if (active) setError(err.message || 'Could not load the categories.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    // `active` because a shopper on a slow connection can change store before
    // the first response lands, and that response is for a store they have left.
    return () => {
      active = false;
    };
  }, [slug]);

  const tree = useMemo(() => buildCategoryTree(nodes), [nodes]);

  // The breadcrumb, derived from the tree rather than from where the shopper came
  // from - see `pathToNode`.
  const crumbs = useMemo(() => pathToNode(tree, activeId), [tree, activeId]);

  const current = crumbs.length ? crumbs[crumbs.length - 1] : null;
  const here = current ? current.id : null;

  // What this node shows: its children, its own products, or both.
  const children = here ? current.children || [] : tree;
  const ownProducts = useMemo(
    () => (here ? productsOn(current, products) : []),
    [here, current, products],
  );

  /* Products are still filtered by the search box above, so a shopper who types a
     word three levels deep is not shown a full shelf of things that do not
     match. An empty shelf says so rather than silently ignoring the search. */
  const term = String(searchTerm || '').trim().toLowerCase();
  const visibleProducts = useMemo(() => {
    if (!term) return ownProducts;
    return ownProducts.filter(
      (product) =>
        String(product.name || '').toLowerCase().includes(term) ||
        String(product.description || '').toLowerCase().includes(term),
    );
  }, [ownProducts, term]);

  const open = useCallback(
    (id) => {
      if (!id) {
        // Back to the top: drop the parameter entirely rather than setting it to
        // an empty string, so the top of the tree is the same clean URL it was
        // before anybody tapped anything.
        setSearchParams({}, { replace: true });
        return;
      }
      // NOT replace: drilling in is a navigation, so it belongs in history and
      // the browser's Back button has to mean "up one level".
      setSearchParams({ c: id });
    },
    [setSearchParams],
  );

  if (loading) {
    return <p className="muted small">Loading categories…</p>;
  }

  if (error) {
    return <p className="empty">{error}</p>;
  }

  /* No tree at all. This is the state of every store on Theme 2 that has not
     built one yet, and it must not be a dead end - so the products are listed
     here and the shopper is told why there are no tabs. */
  if (tree.length === 0) {
    return (
      <div className="treeview">
        <p className="treeview__empty">
          This store has not set up its categories yet.
        </p>
        {products.length > 0 ? (
          <div className="treeview__products">
            {products.map((product) => (
              <ProductCard key={product._id || product.id} product={product} />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="treeview">
      <nav className="crumbs" aria-label="Category">
        {/* Always a way back to the top, even AT the top, so the control does not
            appear and disappear as the shopper moves around. */}
        <button type="button" className="crumbs__link" onClick={() => open(null)}>
          All categories
        </button>

        {crumbs.map((node, index) => {
          const isLast = index === crumbs.length - 1;

          return (
            <span key={node.id} style={{ display: 'contents' }}>
              <span className="crumbs__sep" aria-hidden="true">
                /
              </span>
              {isLast ? (
                <span className="crumbs__here" aria-current="page">
                  {node.name}
                </span>
              ) : (
                <button
                  type="button"
                  className="crumbs__link"
                  onClick={() => open(node.id)}
                >
                  {node.name}
                </button>
              )}
            </span>
          );
        })}
      </nav>

      {/* Subcategories, when this node has any. At the top these are the
          top-level categories, which is the same list meaning something else -
          so the heading says which of the two it is. */}
      {children.length > 0 ? (
        <section className="treeview__section">
          <h2 className="treeview__heading">
            {here ? `Inside ${current.name}` : 'Categories'}
          </h2>

          <div className="treeview__grid">
            {children.map((node) => {
              // How much is behind this card, so a shopper can tell an empty
              // branch from a stocked one before tapping it.
              const behind =
                (node.childCount || node.children?.length || 0) +
                (node.productCount || 0);

              return (
                <button
                  key={node.id}
                  type="button"
                  className="tcard"
                  onClick={() => open(node.id)}
                >
                  <span className="tcard__media">
                    {node.image ? (
                      <img src={node.image} alt="" loading="lazy" />
                    ) : (
                      /* No picture: initials, the same fallback the navbar and
                         the Theme 1 cards use. A grey box reads as a broken
                         image; initials read as a choice. */
                      <span className="tcard__initials" aria-hidden="true">
                        {initials(node.name)}
                      </span>
                    )}
                  </span>
                  <span className="tcard__body">
                    <span className="tcard__name">{node.name}</span>
                    <span className="tcard__meta">
                      {nodeOpens(node) ? 'Tap to open' : 'Products'}
                      {behind > 0 ? ` · ${behind} inside` : ''}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* This node's own products, shown alongside its children rather than
          instead of them: a branch with both is normal, and hiding either half
          would put something in the store out of reach. */}
      {visibleProducts.length > 0 ? (
        <section className="treeview__section">
          <h2 className="treeview__heading">
            {here ? `In ${current.name}` : 'Products'}
          </h2>
          <div className="treeview__products">
            {visibleProducts.map((product) => (
              <ProductCard key={product._id || product.id} product={product} />
            ))}
          </div>
        </section>
      ) : null}

      {/* A branch with nothing in it says so, rather than showing a blank page
          that reads as a failed load. */}
      {children.length === 0 && visibleProducts.length === 0 ? (
        <p className="treeview__empty">
          {term
            ? `Nothing in ${current?.name || 'this store'} matches “${searchTerm.trim()}”.`
            : `There is nothing in ${current?.name || 'this store'} yet.`}
        </p>
      ) : null}
    </div>
  );
}
