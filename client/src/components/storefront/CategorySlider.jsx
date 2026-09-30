import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import ProductCard from '../store/ProductCard';
import { initials } from '../../utils/formatters';

/**
 * The category card slider: one horizontal row of the store's categories, at
 * the top of the storefront, each a card carrying the picture the merchant
 * uploaded in the theme builder.
 *
 * WHY THIS IS SEPARATE FROM THE PER-CATEGORY RAILS
 *
 * `CategoryRail` is one section per category, and it is deliberately phone-only
 * - on a wide screen the plain product grid shows everything at once and needs
 * no swiping. That hiding rule covers the whole `.store-sections` block, so the
 * category cards inside it disappear on desktop too.
 *
 * That is wrong for these cards, because they are not a substitute for the grid.
 * They are a NAVIGATION STRIP: a way to jump to one category without scrolling
 * past everything else. That is useful at any width - on a desktop it is the
 * quickest way into a store with a long catalogue - so it renders on every
 * screen, and the product rails keep their phone-only behaviour.
 *
 * The cards are also honest about being a filter rather than a section header:
 * each one names a category and tapping it narrows the store to it.
 */
/**
 * `linkFor` is what makes a card NAVIGATION rather than a filter toggle. Given
 * a category name it returns the URL of that category's page, and the card
 * becomes a <Link> to it.
 *
 * Both callers use it the same way, and the effect is that every tap is a real
 * navigation: the URL changes, the page is linkable and refreshable, and the
 * browser's Back button returns to where the shopper came from. Filtering in
 * place with component state would do none of that - Back would leave the store
 * altogether, because the filter was never a place in history.
 *
 * `filterControl` is the store's category <select>, rendered in this heading so
 * the section that LISTS the categories is also the section that FILTERS by them.
 *
 * Before, the <select> lived in its own full-width band above the catalogue,
 * separated from the cards by the search field and the strip itself. Two ways to
 * reach the same categories, side by side, with nothing saying they were the same
 * control. Putting the dropdown on the "Categories" heading beside the cards
 * makes the relationship obvious, and the filter can never be scrolled away from
 * the list of categories it filters.
 *
 * When it is supplied it REPLACES the scroll arrows rather than joining them: in
 * one ~300px heading there is room for the title and one cluster of controls, not
 * two, and a shopper cannot tell which row a pair of arrows scrolls when the
 * heading is no longer the row they scroll.
 */
export default function CategorySlider({
  categories,
  activeCategory,
  linkFor,
  filterControl,
  products,
  selectedLabel,
}) {
  const trackRef = useRef(null);
  const productTrackRef = useRef(null);

  /* Is this card the chosen one?

     Written ONCE and used for both the ordering below and the `is-active`
     highlight, because two copies of a category comparison is how "Drinks"
     and "drinks" became two different things elsewhere in this app. Sharing
     it means a card cannot be promoted to the front without also being the
     one marked as current - they agree by construction, not by luck.

     Case-insensitive, matching the one rule the rest of the app uses for
     categories (`sectionNameOf` in ShopPage, `listCategories` on the server).
     A category page reached by a hand-typed or shared URL says "milk" where
     the card says "Milk", and both should be the same category. */
  const activeKey = String(activeCategory || '').trim().toLowerCase();

  const isActive = useCallback(
    (entry) => String(entry?.name || '').trim().toLowerCase() === activeKey,
    [activeKey],
  );

  /* The card order: the chosen category first, every other card exactly where
     it was.

     DERIVED, never remembered. `activeCategory` IS the dropdown's value, so
     choosing "All categories" puts every card back on its own with no state to
     unwind - which is the whole behaviour, and the reason this is a fold at
     render time rather than an array this component rearranged.

     A move, not a filter. The other cards stay reachable, because this strip
     is a navigation aid and a shopper who picks the wrong category has to be
     able to see the others without going back to the dropdown first. */
  const orderedCategories = useMemo(() => {
    if (!activeKey) return categories;

    const at = categories.findIndex(isActive);
    // -1 is "no such card" (the "All categories" sentinel, or a name no card
    // carries) and 0 is "already first". Both are cases where the strip is
    // already correct, so it is returned untouched rather than rebuilt.
    if (at <= 0) return categories;

    return [
      categories[at],
      ...categories.slice(0, at),
      ...categories.slice(at + 1),
    ];
  }, [categories, activeKey, isActive]);

  /* Bring the promoted card into view.

     The strip overflows on a phone and the dropdown sits in the heading
     ABOVE it, so a shopper who has swiped the strip along and then picks a
     category would have that card jump to an index they had scrolled past -
     and the strip would look like it had not reacted at all. Resetting the
     track on a change to the selection is what makes the promotion visible.

     No ref guard needed: the effect only runs when `activeKey` actually
     changes, so an unrelated re-render cannot yank the strip out from under
     someone who is swiping through it. On first paint it is a no-op, because
     the track already starts at 0. */
  useEffect(() => {
    if (trackRef.current) trackRef.current.scrollLeft = 0;
  }, [activeKey]);

  if (!categories.length) return null;

  /* Page the strip by roughly one card, so a press always advances by the same
     visible amount regardless of how many cards fit. */
  const scrollByCard = (direction) => {
    const track = trackRef.current;
    if (!track) return;

    const card = track.querySelector('.cat-card');
    const step = card ? card.getBoundingClientRect().width + 12 : track.clientWidth * 0.8;

    track.scrollBy({ left: direction * step, behavior: 'smooth' });
  };

  /* Page the PRODUCT row underneath by roughly one product card, measured the
     same way CategoryRail does - by the first card's real width rather than a
     fixed pixel count, which would be two cards on one phone and half a card on
     another. */
  const scrollProducts = (direction) => {
    const track = productTrackRef.current;
    if (!track) return;

    const card = track.querySelector('.product-card');
    const step = card ? card.getBoundingClientRect().width + 10 : track.clientWidth;

    track.scrollBy({ left: direction * step, behavior: 'smooth' });
  };

  const showProducts = Array.isArray(products) && products.length > 0;

  return (
    <section className="catstrip" aria-label="Product categories">
      <div className="catstrip__head">
        <h2 className="catstrip__title">Categories</h2>

        {/* The store's category filter, OR the strip's scroll arrows.

            One or the other, never both: a heading has room for the title and a
            single cluster of controls. When the dropdown is there, the strip is
            still scrollable by swipe, and the track keeps tabIndex so the arrow
            keys page it - so dropping the arrows costs no way of reaching the
            cards. */}
        {filterControl ? (
          <div className="catstrip__filter">{filterControl}</div>
        ) : (
          /* Only worth offering once the strip is actually overflowing. */
          <div className="catstrip__nav">
            <button
              type="button"
              className="catstrip__arrow"
              onClick={() => scrollByCard(-1)}
              aria-label="Scroll categories left"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path
                  d="M15 5l-7 7 7 7"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <button
              type="button"
              className="catstrip__arrow"
              onClick={() => scrollByCard(1)}
              aria-label="Scroll categories right"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path
                  d="M9 5l7 7-7 7"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        )}
      </div>

      <div
        className="catstrip__track"
        ref={trackRef}
        tabIndex={0}
        role="group"
        aria-label="Categories — scroll sideways for more"
      >
        {orderedCategories.map((category) => {
          const active = isActive(category);

          return (
            <Link
              key={category.name}
              to={linkFor(category.name)}
              className={`cat-card${active ? ' is-active' : ''}`}
              /* `aria-current` rather than `aria-pressed`: the card navigates to
                 a page, it does not toggle a control in place. "Current page"
                 is what a screen reader should say. */
              aria-current={active ? 'page' : undefined}
            >
              <span className="cat-card__media">
                {category.image ? (
                  <img src={category.image} alt="" loading="lazy" />
                ) : (
                  /* No picture uploaded: initials, matching the store-logo
                     fallback used in the navbar and at checkout. A grey box
                     would read as a broken image; initials read as a choice. */
                  <span className="cat-card__initials" aria-hidden="true">
                    {initials(category.name)}
                  </span>
                )}
              </span>
              <span className="cat-card__name">{category.name}</span>
              <span className="cat-card__count">
                {category.count} {category.count === 1 ? 'item' : 'items'}
              </span>
            </Link>
          );
        })}
      </div>

      {/* The chosen category's products, in this section.

          This is what the dropdown is FOR: pick a category and its products are
          listed here, in one row to browse, and every per-category section below
          is left exactly as it was. Before, the dropdown narrowed the whole page
          instead, so choosing a category collapsed the sections underneath it
          rather than filling this one.

          Its own arrows, because this row scrolls independently of the category
          cards above it - one pair of arrows cannot drive two rows. */}
      {showProducts ? (
        <div className="catstrip__products">
          <div className="catstrip__productsHead">
            <h3 className="catstrip__subtitle">{selectedLabel}</h3>

            <div className="catstrip__nav">
              <button
                type="button"
                className="catstrip__arrow"
                onClick={() => scrollProducts(-1)}
                aria-label={`Scroll ${selectedLabel} left`}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <path
                    d="M15 5l-7 7 7 7"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              <button
                type="button"
                className="catstrip__arrow"
                onClick={() => scrollProducts(1)}
                aria-label={`Scroll ${selectedLabel} right`}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <path
                    d="M9 5l7 7-7 7"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          </div>

          <div
            className="rail__track"
            ref={productTrackRef}
            tabIndex={0}
            role="group"
            aria-label={`${selectedLabel} — scroll sideways for more`}
          >
            {products.map((product) => (
              <ProductCard key={product._id || product.id} product={product} />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
