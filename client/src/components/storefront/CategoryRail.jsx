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
      <header className="rail__head">
        <h2 className="rail__title" id={`rail-${slugifyName(name)}`}>
          {name}
        </h2>
        {showAllLabel ? <span className="rail__count">{showAllLabel}</span> : null}
      </header>

      <div className="rail__viewport">
        <button
          type="button"
          className="rail__arrow rail__arrow--prev"
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

        {/* The scroll container. `tabIndex` makes it focusable so the arrows
            below are reachable by keyboard, and the group role announces what
            it is rather than leaving a bare scrollable div unlabelled. */}
        <div
          className="rail__track"
          ref={trackRef}
          tabIndex={0}
          role="group"
          aria-label={`${name} products`}
        >
          {products.map((product) => (
            <ProductCard key={product._id || product.id} product={product} />
          ))}
        </div>

        <button
          type="button"
          className="rail__arrow rail__arrow--next"
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
