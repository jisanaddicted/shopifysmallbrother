import { useRef } from 'react';
import { Link } from 'react-router-dom';
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
 */
export default function CategorySlider({ categories, activeCategory, linkFor }) {
  const trackRef = useRef(null);

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

  return (
    <section className="catstrip" aria-label="Product categories">
      <div className="catstrip__head">
        <h2 className="catstrip__title">Categories</h2>
        {/* Only worth offering once the strip is actually overflowing. */}
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
      </div>

      <div
        className="catstrip__track"
        ref={trackRef}
        tabIndex={0}
        role="group"
        aria-label="Categories — scroll sideways for more"
      >
        {categories.map((category) => {
          const active = category.name === activeCategory;

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
    </section>
  );
}
