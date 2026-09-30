import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useCart } from '../../context/CartContext';
import { productPath } from '../../utils/constants';
import { formatCurrency } from '../../utils/formatters';
import {
  availableOptionValues,
  defaultSelection,
  formatProductPrice,
  isValueAvailable,
  variantForSelection,
} from '../../utils/variants';

export default function ProductCard({ product }) {
  const { addItem } = useCart();

  /* The store slug, straight off the route.

     Every card lives under /s/:slug/…, so React Router already has it and there
     is no reason for the four different pages that render grids to each pass it
     down. Without a slug the card simply is not a link - it stays fully usable
     for adding to the cart, it just has no "open" target. */
  const { slug } = useParams();
  const productId = product?._id || product?.id;
  const detailPath = slug && productId ? productPath(slug, productId) : null;

  const hasChoices = Boolean(product?.hasVariants);

  /* How many of this product the shopper is about to add.
     Starts at 1, because one is what the button added before this stepper
     existed and it must keep working exactly the same for anyone who never
     touches it. It lives here rather than in the cart because it is a choice
     about the NEXT tap, not about what is already in the basket - the drawer
     owns the quantity of things already added. */
  const [qty, setQty] = useState(1);

  // The shopper's current choice, opened on the first sellable variant so the
  // card is immediately usable rather than presenting a wall of unselected
  // buttons. Keyed by option name, which is what the API and the cart both use.
  const [selection, setSelection] = useState(() => defaultSelection(product));

  // Re-seed when the card is reused for a different product (React reuses the
  // component instance across a re-render of a list), otherwise a card that
  // once showed a size picker would keep the previous product's selection.
  // The quantity resets with it: 3 of the previous product says nothing about
  // how many of THIS one are wanted, and 3 may be more than this one has.
  useEffect(() => {
    setSelection(defaultSelection(product));
    setQty(1);
  }, [product?._id || product?.id]);

  const options = useMemo(
    () => (product?.options || []).filter((option) => option?.name && option?.name.trim()),
    [product],
  );

  // Which values exist at all, so the picker never offers one the merchant has
  // since deleted.
  const valueSets = useMemo(() => availableOptionValues(product), [product]);

  const chosen = useMemo(
    () => variantForSelection(product, selection),
    [product, selection],
  );

  // Displayed stock follows the chosen row when there is one. For a plain
  // product this is just its own stock, unchanged.
  const stock = hasChoices
    ? chosen
      ? Number(chosen.stock)
      : 0
    : (product?.stock ?? product?.quantity ?? null);

  // A product that does not count stock is never "out of it" - the
  // number on it is not a count, so greying the card out would be inventing a
  // problem. Same rule the server applies when it refuses to oversell.
  const countsStock = product?.trackInventory !== false;
  const outOfStock = countsStock && stock !== null && Number(stock) <= 0;

  // Which image to show: the chosen row's own photo if it has one, else the
  // product's. Switching this as the shopper picks is the whole reason
  // per-variant images are worth having.
  const shownImage =
    (chosen && String(chosen.image || '').trim()) || product?.image || '';

  // The most a single tap may add, whatever the stock.
  //
  // An unbounded "+" on a product that does not track inventory would let a
  // shopper ask for 400 of something in a few hundred taps, and the server
  // would then be the one to refuse it. Twenty is far past anything one person
  // actually orders of a single item, and a shopper who genuinely wants more
  // can still tap Add twice.
  const MAX_ADD_PER_TAP = 20;

  // How many this card will currently let the shopper add.
  //
  // Follows the CHOSEN variant's stock, not the product's, which is the whole
  // point of a per-variant quantity: tapping "+" on a size with three left must
  // not build a request the server will reject at checkout. A product that does
  // not count stock is not capped by a number, because the number is not a count.
  const maxAddable =
    countsStock && stock !== null
      ? Math.max(1, Math.min(MAX_ADD_PER_TAP, Number(stock) || 0))
      : MAX_ADD_PER_TAP;

  /* Clamp the chosen quantity whenever the ceiling moves underneath it.

     Without this, switching a variant picker from a 20-in-stock size to a
     3-in-stock one would leave "+3" on the button, offering more than exists.
     The stepper's buttons are disabled at the bounds, so the only way to get
     here is the ceiling itself changing — which is what this catches. */
  useEffect(() => {
    setQty((previous) => Math.min(Math.max(1, previous), maxAddable));
  }, [maxAddable]);

  /* "Added ✓" on the button itself.
   *
   * Adding to the cart no longer pops the drawer open (that made tapping
   * "Add" on a grid unusable - the panel covered the next product), so the
   * button is where the confirmation has to happen. It is a swap of the button's
   * own label rather than a toast, so it can never cover the thing the shopper
   * was looking at. */
  const [justAdded, setJustAdded] = useState(false);
  const timer = useRef(null);

  // Clear a pending timer if the card unmounts, so a fast navigation cannot
  // leave it firing into a dead component.
  useEffect(() => () => clearTimeout(timer.current), []);

  /* Add `qty` of this product.

     The chosen variant is folded in here rather than left to the cart, so the
     line the cart builds is keyed on the VARIANT: two sizes of the same shirt
     are two lines that can hold separate quantities, which is the whole reason
     a variant product keys on `variantId` (see lineKey in CartContext). Without
     this, adding a size would append to a line that may be the wrong one.

     addItem ADDS to an existing line rather than replacing it, so tapping
     "Add 2" three times leaves six — which is what a shopper who keeps
     tapping means, and why the stepper is not reset after a successful add. */
  const handleAdd = () => {
    addItem(
      chosen
        ? {
            ...product,
            variantId: chosen._id || chosen.id,
            variantTitle: chosen.title || '',
            price: chosen.price,
            image: shownImage,
          }
        : product,
      qty,
    );

    setJustAdded(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setJustAdded(false), 1400);
  };

  const pick = (optionName, value) =>
    setSelection((prev) => ({ ...prev, [optionName]: value }));

  return (
    <article className="product-card">
      {/* The photo and the name are one link to the product's own page.

          Not the whole card: the option chips and the add-to-cart button live
          inside it, and nesting buttons or a link inside another link is invalid
          and breaks keyboard navigation in ways that are hard to see. So the
          card is a card, with one clearly-signposted way into the detail page -
          exactly how a category card works.

          The stretch target sits behind both, which means tapping anywhere on
          the photo or the name goes to the product, while the quantity stepper
          and add button below stay tappable in their own right. */}
      <div className="product-card__media">
        {/* aria-hidden and out of the tab order on purpose: the title link just
            below is the same destination and is the one a keyboard or screen
            reader should meet. This one only widens the tap target. */}
        {detailPath ? (
          <Link
            className="product-card__open"
            to={detailPath}
            tabIndex={-1}
            aria-hidden="true"
          >
            {shownImage ? (
              <img src={shownImage} alt="" loading="lazy" />
            ) : (
              <span className="product-card__placeholder">🛍️</span>
            )}
          </Link>
        ) : (
          <div className="product-card__open">
            {shownImage ? (
              <img src={shownImage} alt="" loading="lazy" />
            ) : (
              <span className="product-card__placeholder">🛍️</span>
            )}
          </div>
        )}

        {outOfStock && <span className="chip chip--danger">Out of stock</span>}

        {/* A product whose rows cost different amounts says so, rather than
            letting the cheapest figure imply it is the only price. */}
        {hasChoices && !outOfStock && Number(product?.priceRange?.min) < Number(product?.priceRange?.max) ? (
          <span className="chip">
            {(product?.variants?.length || 0)} option
            {(product?.variants?.length || 0) === 1 ? '' : 's'}
          </span>
        ) : null}
      </div>

      <div className="product-card__body">
        {/* No description and no category badge here any more. Both moved to the
            product page: a 70-character slice of copy and a chip were taking three
            of a card's five lines, and neither told a shopper anything they could
            act on from a grid - the grid's job is "what is this and what does it
            cost", and the name and price already answer that. */}
        {detailPath ? (
          <h3 className="product-card__title">
            <Link to={detailPath}>{product?.name}</Link>
          </h3>
        ) : (
          <h3 className="product-card__title">{product?.name}</h3>
        )}

        {/* The option picker. A real fieldset per option with a real legend,
            because "Colour: Red" announced by a screen reader is strictly better
            than three coloured buttons with no context. */}
        {options.map((option) => {
          const name = option.name.trim();
          const values = valueSets[name] || [];

          return (
            <fieldset className="variant-picker" key={name}>
              <legend className="variant-picker__label">{name}</legend>

              <div className="variant-picker__values">
                {values.map((value) => {
                  const active = selection[name] === value;
                  // "Could I still get this?" rather than "is this the exact
                  // combination?", so a value that exists in another size stays
                  // tappable instead of greying out permanently.
                  const reachable = isValueAvailable(product, name, value, selection);

                  return (
                    <button
                      key={value}
                      type="button"
                      className={`variant-chip${active ? ' is-active' : ''}${
                        reachable ? '' : ' is-unavailable'
                      }`}
                      aria-pressed={active}
                      disabled={!reachable}
                      onClick={() => pick(name, value)}
                    >
                      {value}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          );
        })}

        <div className="product-card__footer">
          <strong className="price">
            {chosen && hasChoices
              ? // The chosen row's own price, with the struck-through original
                // beside it when there genuinely is one.
                Number(chosen.compareAtPrice) > Number(chosen.price) ? (
                  <>
                    <s className="price__was">{formatCurrency(chosen.compareAtPrice)}</s>{' '}
                    <span className="price__now">{formatCurrency(chosen.price)}</span>
                  </>
                ) : (
                  formatCurrency(chosen.price)
                )
              : formatProductPrice(product)}
          </strong>

          {/* The stepper and the button share a row so they read as one control:
              "how many" and "add them" are a single action, and splitting them
              across two rows makes a shopper hunt for which one they meant. */}
          <div className="product-card__buy">
            <div className="qty qty--card">
              <button
                type="button"
                onClick={() => setQty((n) => Math.max(1, n - 1))}
                /* At 1 the stepper has nothing left to remove, so the button is
                   disabled rather than silently doing nothing. Without it a
                   shopper gets no feedback at all and assumes the card is
                   broken. */
                disabled={qty <= 1}
                aria-label={`One fewer ${product?.name || 'item'}`}
              >
                −
              </button>

              {/* aria-live so a screen reader hears the new quantity after each
                  press. The visual number changing is silent otherwise, and
                  this is the only place the shopper is told what they set. */}
              <span aria-live="polite" aria-label={`Quantity ${qty}`}>
                {qty}
              </span>

              <button
                type="button"
                onClick={() => setQty((n) => Math.min(maxAddable, n + 1))}
                disabled={qty >= maxAddable}
                aria-label={`One more ${product?.name || 'item'}`}
              >
                +
              </button>
            </div>

            <button
              type="button"
              className={`btn btn-primary btn-sm${justAdded ? ' is-added' : ''}`}
              disabled={outOfStock}
              onClick={handleAdd}
            >
              {outOfStock
                ? 'Unavailable'
                : justAdded
                  ? `Added ${qty} ✓`
                  : qty > 1
                    ? `Add ${qty} to cart`
                    : 'Add to cart'}
            </button>
          </div>
        </div>

        {/* Say what is left, so a shopper picking a size learns it is nearly
            gone before the checkout tells them - not after. */}
        {hasChoices && chosen && !outOfStock ? (
          <p className="muted small variant-picker__stock">
            {chosen.stock} left in this option
          </p>
        ) : null}
      </div>
    </article>
  );
}
