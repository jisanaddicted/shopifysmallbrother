import { useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useCart } from '../../context/CartContext';
import {
  ROUTES,
  checkoutPath,
  lastStoreVisit,
  shopPath,
} from '../../utils/constants';
import { formatCurrency } from '../../utils/formatters';

export default function CartDrawer() {
  const {
    items,
    isOpen,
    closeCart,
    increment,
    decrement,
    removeItem,
    subtotal,
    deliveryFee,
    total,
    itemCount,
  } = useCart();
  const navigate = useNavigate();
  const location = useLocation();
  // The drawer lives outside <Routes>, so read the store slug straight from
  // the URL (/s/<slug>/...) instead of useParams; fall back to the last
  // storefront the shopper visited. Checkout then stays store-scoped:
  // /s/<slug>/checkout, so the page can brand itself with THAT store.
  const pathSlug = location.pathname.startsWith('/s/')
    ? location.pathname.split('/')[2] || ''
    : '';
  const storeSlug = pathSlug || lastStoreVisit() || '';
  // Where "add something first" sends an empty cart. Same slug the checkout
  // link would have used, so the two can never disagree about which store the
  // shopper is shopping at; with no store known at all it is the store picker.
  const shopTarget = storeSlug ? shopPath(storeSlug) : ROUTES.STORE;

  // Lock the page behind the drawer, close it with Escape.
  useEffect(() => {
    if (!isOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKey = (event) => {
      if (event.key === 'Escape') closeCart();
    };
    window.addEventListener('keydown', handleKey);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKey);
    };
  }, [isOpen, closeCart]);

  const goToCheckout = () => {
    closeCart();
    navigate(checkoutPath(storeSlug));
  };

  return (
    <div className={`drawer ${isOpen ? 'drawer--open' : ''}`} aria-hidden={!isOpen}>
      <button
        type="button"
        className="drawer__overlay"
        aria-label="Close cart"
        tabIndex={isOpen ? 0 : -1}
        onClick={closeCart}
      />

      <aside className="drawer__panel" role="dialog" aria-label="Shopping cart">
        <header className="drawer__header">
          <h2>Your cart {itemCount > 0 ? `(${itemCount})` : ''}</h2>
          <button type="button" className="icon-btn" onClick={closeCart} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="drawer__body">
          {items.length === 0 ? (
            <p className="muted">
              Nothing here yet — add a product from the store.
            </p>
          ) : (
            <ul className="cart-list">
              {items.map((line) => (
                <li key={line._id} className="cart-line">
                  <div className="cart-line__media">
                    {line.image ? (
                      <img src={line.image} alt="" />
                    ) : (
                      <span aria-hidden="true">🛍️</span>
                    )}
                  </div>

                  <div className="cart-line__info">
                    <p className="cart-line__name">{line.name}</p>

                    {/* Which option was actually chosen. Printed on its own line
                        because a shopper scanning the cart needs to tell two
                        lines of the same product apart at a glance. */}
                    {line.variantTitle ? (
                      <p className="muted small cart-line__variant">
                        {line.variantTitle}
                      </p>
                    ) : null}

                    <p className="muted">{formatCurrency(line.price)} each</p>

                    <div className="qty">
                      <button
                        type="button"
                        onClick={() => decrement(line._id)}
                        aria-label={`Remove one ${line.name}`}
                      >
                        −
                      </button>
                      <span>{line.quantity}</span>
                      <button
                        type="button"
                        onClick={() => increment(line._id)}
                        aria-label={`Add one ${line.name}`}
                      >
                        +
                      </button>
                    </div>
                  </div>

                  <div className="cart-line__side">
                    <strong>{formatCurrency(line.price * line.quantity)}</strong>
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => removeItem(line._id)}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className="drawer__footer">
          <div className="drawer__row">
            <span>Subtotal</span>
            <strong>{formatCurrency(subtotal)}</strong>
          </div>
          <div className="drawer__row">
            <span>Delivery</span>
            <strong>
              {deliveryFee === 0 ? 'Free' : formatCurrency(deliveryFee)}
            </strong>
          </div>
          <div className="drawer__row drawer__row--total">
            <span>Total</span>
            <strong>{formatCurrency(total)}</strong>
          </div>

          {/* THE FOOTER CTA IS NEVER DEAD.

              It used to be one button with `disabled={items.length === 0}`. An
              empty cart therefore rendered a full-width primary button that was
              permanently inert, and - this is the part that made it a real
              defect rather than a cosmetic one - `goToCheckout` has NO guard of
              its own, so a tap on it did literally nothing: no navigation, no
              message, no error. The only explanation anywhere in the drawer was
              a line of body text ("Nothing here yet - add a product from the
              store") sitting well above the fold of attention, several scrolls
              away from the button being tapped. On a phone, where the drawer
              body scrolls and the footer is pinned, the shopper's thumb is on
              the footer and their eyes are on the footer, and the one thing the
              footer said was a dimmed button that did not respond.

              So the empty state now carries its own instruction and a real
              destination, in the same place and the same size as the control it
              replaces. Nothing is disabled any more. */}
          {items.length > 0 ? (
            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={goToCheckout}
            >
              Go to checkout
            </button>
          ) : (
            <>
              <p className="muted small drawer__empty-cta">
                Nothing to check out yet — add a product to continue.
              </p>
              <Link
                className="btn btn-primary btn-block"
                to={shopTarget}
                onClick={closeCart}
              >
                Browse the store
              </Link>
            </>
          )}
        </footer>
      </aside>
    </div>
  );
}