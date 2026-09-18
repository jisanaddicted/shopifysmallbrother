import { useCart } from '../../context/CartContext';
import { formatCurrency } from '../../utils/formatters';

/**
 * The money box. Defaults to the cart context, but every value can be
 * overridden with props so it also works on a read-only order page.
 */
export default function OrderSummary({
  items,
  subtotal,
  deliveryFee,
  total,
  address,
  onPlaceOrder,
  placing = false,
  disabled = false,
  ctaLabel = 'Place order',
  children,
}) {
  const cart = useCart();

  const lines = items ?? cart.items;
  const amounts = {
    subtotal: subtotal ?? cart.subtotal,
    deliveryFee: deliveryFee ?? cart.deliveryFee,
    total: total ?? cart.total,
  };

  return (
    <section className="panel summary">
      <h3 className="panel__title">Order summary</h3>

      {lines?.length ? (
        <ul className="summary__lines">
          {lines.map((line) => (
            <li key={line._id || line.name}>
              <span className="summary__line-name">
                {line.name}
                <em>× {line.quantity}</em>
              </span>
              <span>{formatCurrency(line.price * line.quantity)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Your cart is empty.</p>
      )}

      <dl className="summary__totals">
        <div>
          <dt>Subtotal</dt>
          <dd>{formatCurrency(amounts.subtotal)}</dd>
        </div>
        <div>
          <dt>Delivery</dt>
          <dd>
            {amounts.deliveryFee === 0
              ? 'Free'
              : formatCurrency(amounts.deliveryFee)}
          </dd>
        </div>
        <div className="summary__grand">
          <dt>Total</dt>
          <dd>{formatCurrency(amounts.total)}</dd>
        </div>
      </dl>

      {address ? (
        <div className="summary__address">
          <h4>Deliver to</h4>
          <p>{address.label || address.line1}</p>
          {address.line1 && address.label ? <p>{address.line1}</p> : null}
          {address.city ? <p>{address.city}</p> : null}
          {address.phone ? <p>☎ {address.phone}</p> : null}
        </div>
      ) : null}

      {children}

      {onPlaceOrder ? (
        <button
          type="button"
          className="btn btn-primary btn-block"
          onClick={onPlaceOrder}
          disabled={disabled || placing}
        >
          {placing ? 'Placing order…' : ctaLabel}
        </button>
      ) : null}
    </section>
  );
}
