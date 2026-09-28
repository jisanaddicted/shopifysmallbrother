import { Link, useSearchParams } from 'react-router-dom';
import {
  ROUTES,
  lastStoreVisit,
  rememberStoreVisit,
  shopPath,
} from '../../utils/constants';

/**
 * Where the shopper lands when the payment did NOT go through - a declined
 * card, an abandoned gateway session, or a back-button.
 *
 * Deliberately does not call the API. The only thing this page needs is the
 * reason the backend put in the URL, and the retry target: the basket is still
 * in the cart, because checkout does not clear it until a payment actually
 * starts. So "Try again" is just a link back to checkout - no rebuild, no
 * re-entering the address, no second charge.
 */
export default function PaymentFailed() {
  const [params] = useSearchParams();
  const reason = params.get('reason') || '';
  const tranId = params.get('tran_id') || '';

  // Prefer the storefront this payment came from; fall back to the last one this
  // device visited, and finally to the store picker.
  const storeSlug = lastStoreVisit() || '';
  const retryTarget = storeSlug ? `${shopPath(storeSlug)}/checkout` : ROUTES.CHECKOUT;
  const shopTarget = storeSlug ? shopPath(storeSlug) : ROUTES.STORE;

  // Leaving a failed payment page should not re-brand the navbar on a store the
  // shopper did not come from - only remember a store we actually know.
  if (storeSlug) rememberStoreVisit(storeSlug);

  return (
    <div className="page page--customer">
      <div className="card empty">
        <div className="receipt__mark receipt__mark--bad" aria-hidden="true">
          ✕
        </div>

        <h1>Payment not completed</h1>
        <p className="muted">
          {reason === 'cancelled'
            ? 'You cancelled the payment, so nothing has been charged.'
            : reason
              ? reason
              : 'The payment did not go through. Nothing has been charged.'}
        </p>

        {tranId ? (
          <p className="muted small">
            Reference: <code>{tranId}</code>
          </p>
        ) : null}

        <div className="button-row">
          <Link className="btn btn-primary" to={retryTarget}>
            Try again
          </Link>
          <Link className="btn btn-outline" to={shopTarget}>
            Back to the store
          </Link>
        </div>

        <p className="muted small">
          Prefer not to pay online? You can choose{' '}
          <strong>cash on delivery</strong> at checkout and settle with the rider
          when your order arrives.
        </p>
      </div>
    </div>
  );
}