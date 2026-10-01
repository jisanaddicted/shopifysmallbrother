import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import ProductCard from '../store/ProductCard';
import { initials } from '../../utils/formatters';
import {
  buildCategoryTree,
  nodeOpens,
  pathToNode,
  productsOn,
  topLevelNodes,
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
 *
 * THE TREE IS PASSED IN, not fetched here.
 *
 * It used to load its own, which was fine when this was the only thing that
 * wanted it. The side menu needs the same tree now, and two components each
 * fetching it means two requests for one answer and - worse - two moments at
 * which they can hold different versions, so a shopper could open the drawer,
 * see a branch that is not on the page, and tap it. `ShopPage` fetches once and
 * hands the same array to both.
 *
 * THE SIDEBAR, AND WHY IT IS ONE LEVEL
 *
 * This used to be the drill-down and nothing else: one column, where the cards
 * at the top level WERE the list of things to drill into, so choosing one
 * replaced the list you chose from. A store with three levels meant a shopper
 * who wanted to compare two branches had to go in, come all the way back out,
 * and try the other one - and there was no stable list on screen to step
 * sideways from.
 *
 * It is now a sidebar plus a content pane. The sidebar lists the TOP-LEVEL
 * categories and nothing else, permanently; choosing one shows what is inside it
 * beside the list, which is what makes comparing two branches one tap instead of
 * a round trip out and back. Below the sidebar's breakpoint it becomes a
 * horizontal scroller, so the same list is one flick away on a phone.
 *
 * LATENCY
 *
 * Neither the sidebar nor the pane causes a request. The whole tree arrives
 * inside the store response (see `ShopPage`), switching category is a `?c=`
 * query-param change that React Router settles without a network round trip, and
 * the sidebar adds no images - the only pictures on screen are the same
 * `loading="lazy"` card images as before. The per-node product counts the
 * sidebar shows are counted once per products change (`productsPerNode`), not
 * per row per keystroke, so typing in the search box does not walk the catalogue
 * for every row.
 */
export default function CategoryTreeView({
  nodes,
  loading,
  error,
  products,
  searchTerm,
  /* Lets the pane offer a way out of a search that matched nothing HERE.
     See the empty state below. */
  onClearSearch,
}) {
  const [searchParams, setSearchParams] = useSearchParams();

  // The node being viewed, or null for the top level. Read from the URL, so it
  // is the single source of truth: no second copy in state to fall out of step
  // with the address bar.
  const activeId = searchParams.get('c') || null;

  const tree = useMemo(() => buildCategoryTree(nodes), [nodes]);

  /* The sidebar's list: the top level, once.

     `buildCategoryTree` returns exactly the roots, so this is the array itself
     rather than a filtered copy - no second list to keep in step, and no walk on
     every render. Memoised so typing in the search box (which re-renders this
     component on every keystroke) does not re-derive it. */
  const roots = useMemo(() => topLevelNodes(tree), [tree]);

  /* How many products are filed directly on each node, counted ONCE per products
     change instead of filtering the whole catalogue per sidebar row.

     The naive version - `products.filter(...)` for every row - is O(rows x
     products) on EVERY render, and this component re-renders on every keystroke
     in the search box. With 20 categories and 400 products that is 8,000
     comparisons per character typed, on the main thread, purely to draw a
     number. One pass builds the count for every node at the same cost as a
     single filter. */
  const productsPerNode = useMemo(() => {
    const counts = new Map();
    for (const product of products || []) {
      const id = String(product?.categoryId || '');
      if (!id) continue;
      counts.set(id, (counts.get(id) || 0) + 1);
    }
    return counts;
  }, [products]);

  /* What is behind a top-level category: the subcategories directly under it,
     plus the products filed on it.

     `childCount` is the server's own number, so this is correct on first paint
     with no extra request - which is the point: the sidebar is useful before
     anything has finished loading. */
  const topCount = (node) => {
    if (!node) return 0;
    const direct = productsPerNode.get(String(node.id)) || 0;
    const below = node.children?.length || node.childCount || 0;
    return direct + below;
  };

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
      {/* Sidebar + content in ONE layout, so a shopper switching categories never
          loses their place: the list they chose from is still on screen and the
          content swaps beside it. Below the breakpoint the grid collapses to a
          single column and the sidebar becomes a horizontal scroller above the
          content - the one shape that works on a phone. */}
      <div className="treeview__layout">
        <aside className="treeview__side">
          {/* TOP-LEVEL CATEGORIES ONLY.

              The sidebar deliberately lists one level and no more. It used to be
              the drill-down itself - the card grid below doubled as the list of
              what to drill into - which meant the list a shopper picked from was
              REPLACED by the thing they picked, at every level. There was nowhere
              to step sideways and no stable list to come back to.

              Now it is a fixed list: tap a category and the content pane shows
              what is inside it. The tree still arrives in one payload (see the
              note at the top of this file), so this costs no extra request. */}
          <nav className="catside" aria-label="Categories">
            <p className="catside__title">Categories</p>
            <ul className="catside__list">
              {roots.map((node) => {
                const behind = topCount(node);
                const isActive = activeId === node.id;

                return (
                  <li key={node.id}>
                    <button
                      type="button"
                      className={`catside__item${isActive ? ' is-active' : ''}`}
                      /* "page", not true: the sidebar persists across navigation,
                         so the item is not the current PAGE - the content pane
                         is. The active item is styled and marked, so the state is
                         conveyed visually and by `aria-current` rather than by
                         announcing it as a link to itself. */
                      aria-current={isActive ? 'page' : undefined}
                      onClick={() => open(node.id)}
                    >
                      <span className="catside__name">{node.name}</span>
                      {behind > 0 ? (
                        <span className="catside__count">{behind}</span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        </aside>

        <div className="treeview__main">
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
          that reads as a failed load.

          And when a SEARCH is what emptied it, the message names the search and
          hands back a way out. Without that, tapping a category suggestion on
          this theme left the shopper staring at "nothing matches" inside one
          node while the products they wanted sat somewhere else in the tree -
          the impression that search does not work here at all. */}
      {children.length === 0 && visibleProducts.length === 0 ? (
        <div className="treeview__empty">
          <p>
            {term
              ? `Nothing in ${current?.name || 'this store'} matches “${searchTerm.trim()}”.`
              : `There is nothing in ${current?.name || 'this store'} yet.`}
          </p>

          {/* The way back. A search box that can empty the page with no way to
              undo it is a dead end, and on this theme the shopper may not know
              the box above is what did it. */}
          {term && onClearSearch ? (
            <p className="treeview__empty-actions">
              <button type="button" className="link-btn" onClick={onClearSearch}>
                Clear search
              </button>
            </p>
          ) : null}
        </div>
      ) : null}
        </div>
      </div>
    </div>
  );
}
