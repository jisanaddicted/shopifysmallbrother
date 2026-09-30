import { useCallback, useEffect, useRef } from 'react';
import ProductCard from '../store/ProductCard';

/* The auto-advance, as two numbers rather than sprinkled through the effect.

   The delay is long enough that a shopper who has landed on the page and started
   reading is not interrupted by a jump they did not ask for, and the count is
   deliberately small: this is a hint that the row continues, not a carousel
   someone has to sit through. Three advances and then it stops forever - a loop
   that never ends is how a rail becomes something people tap past just to make
   it stop. */
const AUTO_SLIDE_DELAY_MS = 2600;
const AUTO_SLIDE_STEPS = 3;

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
 *
 * @param showAllLabel The product count, or null to leave it out.
 */
export default function CategoryRail({ name, products, showAllLabel }) {
  const trackRef = useRef(null);

  /* Timer for the auto-advance, kept so it can be cleared the instant the
     shopper takes over - and so unmounting mid-sequence does not leave a timer
     firing into a dead component. */
  const autoTimer = useRef(null);
  const autoSteps = useRef(0);
  /* Once the shopper has touched the row themselves, auto-advance is finished for
     good. Scrolling under someone who is actively swiping is the one failure
     mode that makes a row feel broken. */
  const autoCancelled = useRef(false);

  /**
   * Page the rail by roughly one card.
   *
   * Scrolling by a fixed pixel count would be wrong on every device but one:
   * cards are 150px wide on a phone, so a "300px" step is two cards on a small
   * screen and a third of a card on a large one. Measuring the first card
   * instead means one press always moves by the same, visible amount.
   */
  const scrollByCard = useCallback((direction) => {
    const track = trackRef.current;
    if (!track) return;

    const card = track.querySelector('.product-card');
    // The gap is a fixed 0.65rem in the stylesheet; adding it keeps a card from
    // being left permanently half-visible at the end of a page.
    const step = card ? card.getBoundingClientRect().width + 10 : track.clientWidth;

    track.scrollBy({ left: direction * step, behavior: 'smooth' });
  }, []);

  /* Advance the row on its own, a few times, to show that it continues.

     Four things stop it, and each is deliberate:
       - the shopper scrolls or touches the row (see the listeners below)
       - the row runs out of things to scroll to
       - the step budget is spent (3 advances, then never again)
       - the component unmounts

     Reduced motion switches it off entirely: motion someone has asked to be
     spared is not a hint they asked for either. */
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return undefined;

    // Nothing to reveal: a category with fewer cards than the row is wide has no
    // "next" to show, and scrolling would only jitter at the end stop.
    if (track.scrollWidth <= track.clientWidth + 1) return undefined;

    const prefersReduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) return undefined;

    const giveUp = () => {
      autoCancelled.current = true;
      clearTimeout(autoTimer.current);
    };

    const tick = () => {
      if (autoCancelled.current) return;

      const atEnd = track.scrollLeft + track.clientWidth >= track.scrollWidth - 2;
      if (atEnd) {
        giveUp();
        return;
      }

      scrollByCard(1);
      autoSteps.current += 1;

      if (autoSteps.current < AUTO_SLIDE_STEPS) {
        autoTimer.current = setTimeout(tick, AUTO_SLIDE_DELAY_MS);
      }
    };

    const timer = setTimeout(tick, AUTO_SLIDE_DELAY_MS);
    autoTimer.current = timer;

    /* Any sign of the shopper taking over ends the sequence.

       `touchstart` and `pointerdown` matter more than `scroll` here: a touch
       fires first, so the row is already marked as theirs before their own
       momentum scroll begins. Listening for `scroll` as well is what catches a
       trackpad, a mouse drag and a keyboard's arrow keys. */
    track.addEventListener('touchstart', giveUp, { passive: true });
    track.addEventListener('pointerdown', giveUp, { passive: true });
    track.addEventListener('wheel', giveUp, { passive: true });
    track.addEventListener('scroll', giveUp, { passive: true });

    return () => {
      clearTimeout(timer);
      clearTimeout(autoTimer.current);
      track.removeEventListener('touchstart', giveUp);
      track.removeEventListener('pointerdown', giveUp);
      track.removeEventListener('wheel', giveUp);
      track.removeEventListener('scroll', giveUp);
    };
  }, [scrollByCard, products.length, name]);

  /* An empty section renders nothing.

     This sits BELOW every hook on purpose. Returning early above them would mean
     a rail that once had products and then lost them goes from running hooks to
     running none, and React throws on that - the effect above would also have
     been measuring a track that is not in the DOM yet. */
  if (!products || products.length === 0) return null;

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

        {/* The arrows, always. The category filter does NOT live here - it is on
            the "Categories" heading above, beside the cards that list them, which
            is where a filter belongs. Every product rail therefore scrolls the
            same way.

            Both are always rendered rather than hidden at the ends: a button that
            appears and disappears shifts the row's content under the shopper's
            finger mid-swipe. */}
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
