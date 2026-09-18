import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import DeliveryMap from '../../components/maps/DeliveryMap';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import { useSocket } from '../../context/SocketContext';
import orderService from '../../services/orderService';
import {
  ORDER_STATUS,
  ORDER_STATUS_FLOW,
  ORDER_STATUS_TONE,
  ROUTES,
} from '../../utils/constants';
import {
  formatCurrency,
  formatDateTime,
  formatStatus,
} from '../../utils/formatters';

export default function OrderTracker() {
  const { orderId } = useParams();
  const { joinOrder, leaveOrder, getRiderLocation, statusUpdates, connected } =
    useSocket();

  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadOrder = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const data = await orderService.getOrderById(orderId);
      setOrder(data);
    } catch (err) {
      setError(err.message || 'Could not load this order.');
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    loadOrder();
  }, [loadOrder]);

  // Subscribe to live updates for exactly this order, then clean up.
  useEffect(() => {
    if (!orderId) return undefined;

    joinOrder(orderId);
    return () => leaveOrder(orderId);
  }, [orderId, joinOrder, leaveOrder]);

  // A socket status beats the value we fetched over REST.
  const status = statusUpdates[orderId]?.status || order?.status;

  const customerLocation = order?.location || order?.address?.location || null;
  const riderLocation =
    getRiderLocation(orderId) ||
    order?.riderLocation ||
    order?.rider?.location ||
    null;

  const timeline = useMemo(() => {
    const currentIndex = ORDER_STATUS_FLOW.indexOf(status);

    return ORDER_STATUS_FLOW.map((step, index) => ({
      step,
      done: currentIndex >= index && currentIndex !== -1,
      current: index === currentIndex,
    }));
  }, [status]);

  if (loading) return <LoadingSpinner fullPage label="Loading your order…" />;

  if (error) {
    return (
      <div className="page">
        <p className="alert alert--danger">{error}</p>
        <div className="button-row">
          <button type="button" className="btn btn-outline" onClick={loadOrder}>
            Try again
          </button>
          <Link className="btn btn-ghost" to={ROUTES.STORE}>
            Back to store
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1>Order #{String(orderId).slice(-6).toUpperCase()}</h1>
          <p className="muted">
            Placed {formatDateTime(order?.createdAt)} ·{' '}
            <span
              className={`badge badge--${ORDER_STATUS_TONE[status] || 'info'}`}
            >
              {formatStatus(status)}
            </span>
          </p>
        </div>

        <div className="button-row">
          <span className={`live-dot ${connected ? 'live-dot--on' : ''}`}>
            {connected ? 'Live' : 'Offline'}
          </span>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={loadOrder}
          >
            Refresh
          </button>
        </div>
      </header>

      <DeliveryMap
        customerLocation={customerLocation}
        riderLocation={riderLocation}
        riderLabel={order?.rider?.name || 'Your rider'}
      />

      <div className="tracker-grid">
        <section className="panel">
          <h2 className="panel__title">Progress</h2>

          {status === ORDER_STATUS.CANCELLED ? (
            <p className="alert alert--danger">This order was cancelled.</p>
          ) : (
            <ol className="timeline">
              {timeline.map((entry) => (
                <li
                  key={entry.step}
                  className={`timeline__item ${entry.done ? 'is-done' : ''} ${
                    entry.current ? 'is-current' : ''
                  }`}
                >
                  <span className="timeline__dot" aria-hidden="true" />
                  {formatStatus(entry.step)}
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="panel">
          <h2 className="panel__title">Items</h2>

          <ul className="summary__lines">
            {(order?.items || []).map((item, index) => (
              <li key={`${item.name}-${index}`}>
                <span className="summary__line-name">
                  {item.name}
                  <em>× {item.quantity}</em>
                </span>
                <span>{formatCurrency(item.price * item.quantity)}</span>
              </li>
            ))}
          </ul>

          <dl className="summary__totals">
            <div>
              <dt>Subtotal</dt>
              <dd>{formatCurrency(order?.subtotal)}</dd>
            </div>
            <div>
              <dt>Delivery</dt>
              <dd>
                {order?.deliveryFee ? formatCurrency(order.deliveryFee) : 'Free'}
              </dd>
            </div>
            <div className="summary__grand">
              <dt>Total</dt>
              <dd>{formatCurrency(order?.total)}</dd>
            </div>
          </dl>
        </section>

        <section className="panel">
          <h2 className="panel__title">Rider</h2>

          {order?.rider ? (
            <>
              <p>
                <strong>{order.rider.name}</strong>
              </p>
              {order.rider.phone ? (
                <p className="muted">☎ {order.rider.phone}</p>
              ) : null}
              {riderLocation ? (
                <p className="muted small">
                  Last ping: {riderLocation.lat?.toFixed?.(5)},{' '}
                  {riderLocation.lng?.toFixed?.(5)}
                </p>
              ) : (
                <p className="muted">Waiting for a GPS ping…</p>
              )}
            </>
          ) : (
            <p className="muted">
              No rider assigned yet. They will appear here as soon as dispatch
              confirms.
            </p>
          )}

          <h3 className="panel__subtitle">Delivery address</h3>
          <p>{order?.address?.line1}</p>
          {order?.address?.city ? <p>{order.address.city}</p> : null}
          {order?.address?.phone ? (
            <p className="muted">☎ {order.address.phone}</p>
          ) : null}
        </section>
      </div>
    </div>
  );
}
