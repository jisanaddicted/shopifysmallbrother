import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import paymentService from '../../services/paymentService';
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS,
  ROUTES,
  lastStoreVisit,
  shopPath,
} from '../../utils/constants';
import { formatCurrency, formatDateTime } from '../../utils/formatters';

/**
 * Where the shopper lands after the gateway says the payment went through.
 *
 * Arrives as `?tran_id=…` and NOTHING else - no session, no order, no amount.
 * So it asks the server what actually happened rather than printing "thank you"
 * on the strength of the URL it was handed: a `tran_id` in an address bar is not
 * evidence of a payment, and a page that trusted it would happily congratulate
 * someone whose card was declined.
 *
 * The server is the only thing that can answer, because it verified the
 * transaction against SSLCommerz with the val_id before redirecting here.
 */
export default function PaymentSuccess() {
  const [params] = useSearchParams();
  const tranId = params.get('tran_id') || '';

  const [payment, setPayment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!tranId) {
      setError('This page needs a transaction reference. Please check your link.');
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);

    paymentService
      .getPayment(tranId)
      .then((data) => {
        if (cancelled) return;
        setPayment(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message || 'Could not load your payment.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [tranId]);

  if (loading) {
    return (
      <div className="page page--customer">
        <LoadingSpinner label="Confirming your payment…" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="page page--customer">
        <div className="card empty">
          <h1>We could not find that payment</h1>
          <p className="muted">{error}</p>
          <Link className="btn btn-primary" to={ROUTES.STORE}>
            Back to the stores
          </Link>
        </div>
      </div>
    );
  }

  // The backend only ever sends a shopper here once the transaction validated,
  // so `Paid` is the expected reading. Anything else means the page and the
  // server disagree - say so instead of claiming a receipt that is not there.
  const settled = payment?.status === PAYMENT_STATUS.PAID;
  const orderId = payment?.order?.id || '';
  const storeSlug = payment?.order?.store?.slug || lastStoreVisit() || '';
  const trackTarget = orderId ? `/track/${orderId}` : ROUTES.STORE;

  return (
    <div className="page page--customer">
      <div className="card receipt">
        <div className="receipt__mark" aria-hidden="true">
          {settled ? '✓' : '!'}
        </div>

        <h1>
          {settled ? 'Payment received' : 'Payment not completed'}
        </h1>
        <p className="muted">
          {settled
            ? 'Thank you. Your order is confirmed and the store has been notified.'
            : 'The gateway did not report a completed payment. Your order is saved and you can try again.'}
        </p>

        {payment?.message ? (
          <p className="alert alert--warn">{payment.message}</p>
        ) : null}

        <dl className="summary__totals receipt__rows">
          <div>
            <dt>Transaction</dt>
            <dd>
              <code>{payment?.tran_id || tranId}</code>
            </dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{payment?.status || '—'}</dd>
          </div>
          {/* Which button they pressed on the checkout form. Worth showing: a
              shopper who thinks they paid by bKash and sees "card" here has
              something to query about. */}
          {payment?.channel ? (
            <div>
              <dt>Paid by</dt>
              <dd>{PAYMENT_METHOD_LABELS[payment.channel] || payment.channel}</dd>
            </div>
          ) : null}
          <div>
            <dt>Amount</dt>
            <dd>
              {formatCurrency(payment?.amount)} {payment?.currency}
            </dd>
          </div>
          {payment?.paidAt ? (
            <div>
              <dt>Paid at</dt>
              <dd>{formatDateTime(payment.paidAt)}</dd>
            </div>
          ) : null}
        </dl>

        {payment?.order?.items?.length ? (
          <>
            <h2 className="panel__subtitle">What you bought</h2>
            <ul className="summary__lines">
              {payment.order.items.map((line) => (
                <li key={line.name}>
                  <span className="summary__line-name">
                    {line.name}
                    <em>× {line.quantity}</em>
                  </span>
                  <span>{formatCurrency(line.price * line.quantity)}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        <div className="button-row">
          {orderId ? (
            <Link className="btn btn-primary" to={trackTarget}>
              Track your order
            </Link>
          ) : null}
          {storeSlug ? (
            <Link className="btn btn-outline" to={shopPath(storeSlug)}>
              Back to {payment?.order?.store?.name || 'the store'}
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}