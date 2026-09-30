import { useRef } from 'react';
import ProductCard from '../store/ProductCard';

/**
 * One storefront section, as seen on a phone: the category name as a heading,
 * then that category's products in a row you swipe sideways.
 *
 * The row of cards is the point. A phone shopper cannot scan a single column
 * of 40 products - they scroll forever and remember none of it. Sections let
 * them swipe through "Drinks", decide nothing here is what they wanted, swipe
 * through "Pizza" instead, and arrive at a choice in a few seconds.
 *
 * Scrolling is native (`overflow-x`) rather than a transform or a custom drag
 * handler, deliberately: native horizontal scrolling already has momentum
 * physics, rubber-banding at the ends, trackpad support and a working scrollbar
 * for a mouse, all of which a re-implementation has to earn. The arrows below
 * are the accessibility and precision fallback for anyone who cannot or does
 * not want to swipe - and they are how a keyboard or a mouse user reaches the
 * cards that are off the right edge.
 *
 * Reuses <ProductCard> unchanged, so a product added to a cart from a rail and
 * one added from the grid are the same component with the same behaviour. Only
 * the surrounding layout differs.
 */
export default function CategoryRail({ name, products, showAllLabel }) {
  const trackRef = useRef(null);

  if (!products.length) return null;

  /**
   * Page the rail by roughly one card.
   *
   * Scrolling by a fixed pixel count would be wrong on every device but one:
   * cards are 150px wide on a phone, so a "300px" step is two cards on a small
   * screen and a third of a card on a large one. Measuring the first card
   * instead means one press always advances by the same, visible amount.
   */
  const scrollByCard = (direction) => {
    const track = trackRef.current;
    if (!track) return;

    const card = track.querySelector('.product-card');
    // The gap is a fixed 0.65rem in the stylesheet; adding it keeps a card from
    // being left permanently half-visible at the end of a page.
    const step = card ? card.getBoundingClientRect().width + 10 : track.clientWidth;

    track.scrollBy({ left: direction * step, behavior: 'smooth' });
  };

  return (
    <section className="rail" aria-labelledby={`rail-${slugifyName(name)}`}>
      {/* The heading, and the two arrows that scroll this section, share one row.

          The arrows used to sit in a row of their own UNDER the cards. That looked
          wrong for a reason that is easy to measure: only 0.35rem separated them
          from the cards they control, but the 1.75rem gap between sections
          separated them from the NEXT section's heading. The arrows therefore read
          as belonging to the section below, and the row they occupied was 34px of
          mostly empty space per category.

          In the header they sit with the label of the thing they scroll, which is
          where a shopper looks for "there is more here", and the whole orphaned
          row disappears. Note this is NOT the old "beside the track" arrangement
          that was removed for eating a card's width - the track keeps the full
          width of the section either way, because the header is its own row. */}
      <header className="rail__head">
        <div className="rail__labels">
          <h2 className="rail__title" id={`rail-${slugifyName(name)}`}>
            {name}
          </h2>
          {showAllLabel ? <span className="rail__count">{showAllLabel}</span> : null}
        </div>

        {/* Both are always rendered rather than hidden at the ends: a button that
            appears and disappears shifts the row's content under the shopper's
            finger mid-swipe, and a disabled one is simply quieter. */}
        <div className="rail__nav">
          <button
            type="button"
            className="rail__arrow"
            onClick={() => scrollByCard(-1)}
            aria-label={`Scroll ${name} left`}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
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
            className="rail__arrow"
            onClick={() => scrollByCard(1)}
            aria-label={`Scroll ${name} right`}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
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
      </header>

      {/* The track gets the FULL width of the section, so a whole number of cards
          fits: with the arrows sharing its line, two 30px buttons plus gaps took
          ~76px of the ~304px available at 360px, leaving one card and a sliver. */}
      <div
        className="rail__track"
        ref={trackRef}
        tabIndex={0}
        role="group"
        aria-label={`${name} products`}
      >
        {/* NO category card here.

            There used to be one - the category's picture and name as the
            first item in its own rail. It moved out to <CategorySlider>,
            which sits above every section, for two reasons:

              - `.store-sections` is hidden above 640px, so a card living in
                here disappeared on desktop entirely.
              - A card that scrolls away with its own section is no use as
                navigation: to learn what the shop sells you had to swipe
                through every section to discover it.

            Repeating it here as well would show the same category twice on a
            phone, once at the top of the screen and once an inch below it. */}
        {products.map((product) => (
          <ProductCard key={product._id || product.id} product={product} />
        ))}
      </div>
    </section>
  );
}

/**
 * A DOM-id-safe version of a category name, for the `aria-labelledby` link
 * between the heading and its section.
 *
 * A category is free text - "Hot & Cold", "Drinks (large)" - and the raw name
 * is not a valid id, so a heading could not be associated with its own
 * section. Non-alphanumerics collapse to one dash rather than being dropped,
 * so "Hot & Cold" and "Hot and Cold" still produce different ids.
 */
function slugifyName(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
