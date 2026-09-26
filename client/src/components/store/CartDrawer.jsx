import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useCart } from '../../context/CartContext';
import { checkoutPath, lastStoreVisit } from '../../utils/constants';
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

          <button
            type="button"
            className="btn btn-primary btn-block"
            onClick={goToCheckout}
            disabled={items.length === 0}
          >
            Go to checkout
          </button>
        </footer>
      </aside>
    </div>
  );
}