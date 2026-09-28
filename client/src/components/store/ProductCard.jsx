import { useEffect, useMemo, useRef, useState } from 'react';
import { useCart } from '../../context/CartContext';
import { formatCurrency, truncate } from '../../utils/formatters';
import {
  availableOptionValues,
  defaultSelection,
  formatProductPrice,
  isValueAvailable,
  variantForSelection,
} from '../../utils/variants';

export default function ProductCard({ product }) {
  const { addItem } = useCart();

  const hasChoices = Boolean(product?.hasVariants);

  // The shopper's current choice, opened on the first sellable variant so the
  // card is immediately usable rather than presenting a wall of unselected
  // buttons. Keyed by option name, which is what the API and the cart both use.
  const [selection, setSelection] = useState(() => defaultSelection(product));

  // Re-seed when the card is reused for a different product (React reuses the
  // component instance across a re-render of a list), otherwise a card that
  // once showed a size picker would keep the previous product's selection.
  useEffect(() => {
    setSelection(defaultSelection(product));
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

  const outOfStock = stock !== null && Number(stock) <= 0;

  // Which image to show: the chosen row's own photo if it has one, else the
  // product's. Switching this as the shopper picks is the whole reason
  // per-variant images are worth having.
  const shownImage =
    (chosen && String(chosen.image || '').trim()) || product?.image || '';

  // "Added ✓" on the button itself.
  //
  // Adding to the cart no longer pops the drawer open (that made tapping
  // "Add" on a grid unusable - the panel covered the next product), so the
  // button is where the confirmation has to happen. It is a swap of the button's
  // own label rather than a toast, so it can never cover the thing the shopper
  // was looking at.
  const [justAdded, setJustAdded] = useState(false);
  const timer = useRef(null);

  // Clear a pending timer if the card unmounts, so a fast navigation cannot
  // leave it firing into a dead component.
  useEffect(() => () => clearTimeout(timer.current), []);

  const handleAdd = () => {
    addItem(product, 1);

    setJustAdded(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setJustAdded(false), 1400);
  };

  const pick = (optionName, value) =>
    setSelection((prev) => ({ ...prev, [optionName]: value }));

  return (
    <article className="product-card">
      <div className="product-card__media">
        {shownImage ? (
          <img src={shownImage} alt={product?.name} loading="lazy" />
        ) : (
          <span className="product-card__placeholder" aria-hidden="true">
            🛍️
          </span>
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
        {product?.category ? (
          <span className="chip">{product.category}</span>
        ) : null}

        <h3 className="product-card__title">{product?.name}</h3>
        <p className="product-card__desc">
          {truncate(product?.description || 'No description yet.', 70)}
        </p>

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
          <button
            type="button"
            className={`btn btn-primary btn-sm${justAdded ? ' is-added' : ''}`}
            disabled={outOfStock}
            onClick={handleAdd}
          >
            {outOfStock ? 'Unavailable' : justAdded ? 'Added ✓' : 'Add to cart'}
          </button>
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
