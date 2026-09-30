import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import ProductCard from '../../components/store/ProductCard';
import StoreHeader from '../../components/storefront/StoreHeader';
import { useAuth } from '../../context/AuthContext';
import { useCart } from '../../context/CartContext';
import productService from '../../services/productService';
import storeService from '../../services/storeService';
import { rememberStoreVisit, shopPath } from '../../utils/constants';
import { formatCurrency } from '../../utils/formatters';
import {
  availableOptionValues,
  defaultSelection,
  formatProductPrice,
  isValueAvailable,
  variantForSelection,
} from '../../utils/variants';

/**
 * One product, as its own page: /s/<slug>/p/<productId>
 *
 * This is the page the stripped-down product card is a doorway to. The card
 * used to carry a truncated description and a category badge, which gave every
 * card in a grid several lines of text and left no room for the one thing a
 * shopper is actually there to do. All of that moved here, where there is space
 * for it: the full description, the category, the stock count, and a purchase
 * bar that stays reachable while you scroll.
 *
 * It reuses ProductCard for the "more in this category" strip rather than
 * inventing a second grid, so those cards behave exactly like the ones on the
 * storefront - including opening back into this same page.
 */
export default function ProductPage() {
  const { slug, productId } = useParams();
  const { user } = useAuth();
  const { addItem, itemCount, openCart } = useCart();

  const [store, setStore] = useState(null);
  const [product, setProduct] = useState(null);
  const [related, setRelated] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  /* The shopper's choice of option, opened on the first sellable variant so the
     page is immediately buyable rather than a wall of unselected buttons.
     Re-seeded when the product changes, which is what happens when React reuses
     this component for a different id. */
  const [selection, setSelection] = useState(() => defaultSelection(product));

  // How many to add. Same ceiling rule as the card: never more than the chosen
  // variant actually has, and never more than 20 in one tap.
  const MAX_ADD_PER_TAP = 20;
  const [qty, setQty] = useState(1);

  const [justAdded, setJustAdded] = useState(false);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      /* The store is needed for the header and the back link; the product is the
         page itself. A store failure must not blank the product, so it falls
         back to null and the header simply renders without a brand. */
      const [productData, storeData] = await Promise.all([
        productService.getProductById(productId),
        storeService.getPublicStore(slug).catch(() => null),
      ]);

      setProduct(productData || null);
      setStore(storeData?.store || null);
      setSelection(defaultSelection(productData));
      setQty(1);
    } catch (err) {
      setError(err.message || 'Could not load that product.');
    } finally {
      setLoading(false);
    }
  }, [productId, slug]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    rememberStoreVisit(slug);
  }, [slug]);

  const category = String(product?.category || '').trim();

  /* More from the same category, so a shopper who does not want this one is not
     bounced back to the top of the store to keep looking. Allowed to fail: a
     product page that renders nothing because a "you might also like" strip
     could not load is worse than one without the strip. */
  useEffect(() => {
    if (!category) {
      setRelated([]);
      return;
    }
    let cancelled = false;

    storeService
      .getPublicStore(slug)
      .then((data) => {
        if (cancelled) return;
        setRelated(
          (data?.products || [])
            .filter(
              (p) =>
                String(p.category || '').trim() === category &&
                String(p._id || p.id) !== String(product?._id || product?.id),
            )
            .slice(0, 6),
        );
      })
      .catch(() => {
        if (!cancelled) setRelated([]);
      });

    return () => {
      cancelled = true;
    };
  }, [category, product?._id || product?.id, slug]);

  const hasChoices = Boolean(product?.hasVariants);
  const valueSets = useMemo(() => availableOptionValues(product), [product]);
  const chosen = useMemo(
    () => variantForSelection(product, selection),
    [product, selection],
  );

  const stock = hasChoices
    ? chosen
      ? Number(chosen.stock)
      : 0
    : (product?.stock ?? product?.quantity ?? null);

  const countsStock = product?.trackInventory !== false;
  const outOfStock = countsStock && stock !== null && Number(stock) <= 0;

  const maxAddable =
    countsStock && stock !== null
      ? Math.max(1, Math.min(MAX_ADD_PER_TAP, Number(stock) || 0))
      : MAX_ADD_PER_TAP;

  /* Clamp whenever the ceiling moves, and reset when the shopper picks a
     different option - a quantity chosen for "Large" says nothing about
     "Small", and may exceed what Small has. */
  useEffect(() => {
    setQty((previous) => Math.min(Math.max(1, previous), maxAddable));
  }, [maxAddable]);

  const options = useMemo(
    () =>
      (product?.options || []).filter((option) => option?.name && option.name.trim()),
    [product],
  );

  /* Every picture this product can be shown with: the chosen variant's own
     first, then the product's, then any other variant's. A shopper picking
     "Blue" wants to see the blue one, which is the whole reason variants carry
     an image. */
  const gallery = useMemo(() => {
    const seen = new Set();
    const out = [];

    const push = (value) => {
      const url = String(value || '').trim();
      if (!url || seen.has(url)) return;
      seen.add(url);
      out.push(url);
    };

    push(chosen?.image);
    push(product?.image);
    for (const variant of product?.variants || []) push(variant?.image);

    return out;
  }, [product, chosen]);

  const [activeImage, setActiveImage] = useState(0);
  /* A new selection can reveal a picture that is not the one on screen, so the
     gallery follows the choice instead of leaving the old shot up. */
  useEffect(() => {
    setActiveImage(0);
  }, [selection, product?._id || product?.id]);

  const shownImage = gallery[activeImage] || gallery[0] || '';

  const pick = (optionName, value) =>
    setSelection((prev) => ({ ...prev, [optionName]: value }));

  /* Fold the chosen variant in, so the cart line is keyed on the VARIANT: two
     sizes of one shirt are two lines that can hold separate quantities, which
     is why a variant product keys on `variantId` (see CartContext's lineKey).
     Without it, adding a size would append to a line that may be the wrong one. */
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
    timer.current = setTimeout(() => setJustAdded(false), 1600);
  };

  if (loading) return <LoadingSpinner fullPage label="Loading the product…" />;

  if (error || !product) {
    return (
      <div className="page page--customer">
        <p className="alert alert--danger">
          {error || 'That product is no longer available.'}
        </p>
        <div className="button-row">
          <button type="button" className="btn btn-outline" onClick={load}>
            Try again
          </button>
          <Link className="btn btn-ghost" to={shopPath(slug)}>
            Back to the store
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page page--customer product-page">
      <StoreHeader
        store={store}
        itemCount={itemCount}
        user={user}
        onCartClick={openCart}
      />

      <Link className="product-page__back" to={shopPath(slug)}>
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
        {store?.name || 'Back to the store'}
      </Link>

      <div className="product-page__layout">
        <div className="product-page__gallery">
          <div className="product-page__hero">
            {shownImage ? (
              <img src={shownImage} alt={product.name} />
            ) : (
              <span className="product-page__placeholder" aria-hidden="true">
                🛍️
              </span>
            )}

            {outOfStock ? <span className="chip chip--danger">Out of stock</span> : null}
          </div>

          {/* Thumbnails, only when there is a choice to make. One picture means
              nothing to switch between, and a row of one is just clutter. */}
          {gallery.length > 1 ? (
            <div className="product-page__thumbs">
              {gallery.map((src, index) => (
                <button
                  key={src}
                  type="button"
                  className={`product-page__thumb${
                    index === activeImage ? ' is-active' : ''
                  }`}
                  onClick={() => setActiveImage(index)}
                  aria-label={`View image ${index + 1}`}
                  aria-current={index === activeImage}
                >
                  <img src={src} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="product-page__info">
          <h1 className="product-page__title">{product.name}</h1>

          {category ? (
            <Link className="product-page__category" to={shopPath(slug)}>
              {category}
            </Link>
          ) : null}

          <div className="product-page__price">
            {chosen && hasChoices
              ? Number(chosen.compareAtPrice) > Number(chosen.price) ? (
                  <>
                    <s className="price__was">{formatCurrency(chosen.compareAtPrice)}</s>{' '}
                    <span className="price__now">{formatCurrency(chosen.price)}</span>
                  </>
                ) : (
                  formatCurrency(chosen.price)
                )
              : formatProductPrice(product)}
          </div>

          {/* In stock, as a number, before the shopper commits. A card cannot
              carry this without eating the space its price and button need. */}
          {countsStock && !outOfStock ? (
            <p className="muted small product-page__stock">
              {hasChoices && chosen
                ? `${chosen.stock} left in ${chosen.title || 'this option'}`
                : `${stock} in stock`}
            </p>
          ) : null}

          {/* The option picker. A real fieldset per option with a real legend, so
              a screen reader announces "Colour: Red" rather than three coloured
              buttons with no context. */}
          {options.map((option) => {
            const name = option.name.trim();
            const values = valueSets[name] || [];

            return (
              <fieldset className="variant-picker" key={name}>
                <legend className="variant-picker__label">{name}</legend>
                <div className="variant-picker__values">
                  {values.map((value) => {
                    const active = selection[name] === value;
                    const reachable = isValueAvailable(
                      product,
                      name,
                      value,
                      selection,
                    );

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

          {/* The full description, which is the reason this page exists. The card
              used to carry a 70-character slice: enough to take three lines of a
              150px card, too little to decide on. */}
          {product.description ? (
            <div className="product-page__desc">
              <h2 className="product-page__section">Description</h2>
              <p>{product.description}</p>
            </div>
          ) : null}
        </div>
      </div>

      {/* The purchase bar. Sticky to the bottom, so a long description cannot
          scroll the only "add to cart" on the page out of reach - on a phone
          that is the difference between a sale and a lost one. It sits BELOW
          the layout rather than inside it so it can stick across the full width
          instead of being pinned to one column.

          On a phone the button takes the full width on its own row, under the
          stepper. Sharing a ~300px row with a ~100px stepper left the label
          truncating to "Add 3 to...", which is the squeeze this avoids. */}
      <div className="product-page__buy">
        <div className="qty qty--card">
          <button
            type="button"
            onClick={() => setQty((n) => Math.max(1, n - 1))}
            disabled={qty <= 1}
            aria-label="One fewer"
          >
            −
          </button>
          <span aria-live="polite" aria-label={`Quantity ${qty}`}>
            {qty}
          </span>
          <button
            type="button"
            onClick={() => setQty((n) => Math.min(maxAddable, n + 1))}
            disabled={qty >= maxAddable}
            aria-label="One more"
          >
            +
          </button>
        </div>

        <button
          type="button"
          className={`btn btn-primary product-page__add${justAdded ? ' is-added' : ''}`}
          disabled={outOfStock}
          onClick={handleAdd}
        >
          {outOfStock
            ? 'Out of stock'
            : justAdded
              ? `Added ${qty} ✓`
              : qty > 1
                ? `Add ${qty} to cart`
                : 'Add to cart'}
        </button>
      </div>

      {related.length ? (
        <section className="product-page__related">
          <h2 className="product-page__section">More in {category}</h2>
          <div className="grid">
            {related.map((item) => (
              <ProductCard key={item._id || item.id} product={item} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

