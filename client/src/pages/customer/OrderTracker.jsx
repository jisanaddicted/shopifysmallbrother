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

/**
 * The read-only view of a single order: live map, progress timeline, items,
 * rider and drop-off address.
 *
 * variant="customer" (default) - what a buyer or a guest watches, reached at
 *   /track/:orderId. Wide padding, and a way back to the shop.
 * variant="admin" - the very same details opened from the admin panel's order
 *   board at /admin/orders/:orderId. It renders *inside* <DashboardLayout>, so
 *   the side rail stays put; only the padding, the wording and the "back"
 *   target differ. Nothing is duplicated for the back office.
 */
export default function OrderTracker({ variant = 'customer' }) {
  const isAdmin = variant === 'admin';
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

  // Picker's list for the back office: what to collect, in the order to walk
  // the shop. The rack/shelf comes from the *live* product that the API
  // populates onto each line (`items.product`), so a product re-shelved after
  // checkout still points at its new home. Lines whose product has since been
  // deleted come back without it - they sort last and are called out, because
  // a shelf that does not exist is worse than no shelf at all.
  const pickList = useMemo(() => {
    const rows = (order?.items || []).map((item) => ({
      name: item.name,
      quantity: Number(item.quantity) || 0,
      category: item.product?.category || '',
      // The thumbnail also comes from the live product, so it is dropped along
      // with the location if the product is deleted - the receipt line stands.
      image: item.product?.image || '',
      rack: String(item.product?.rack ?? '').trim(),
      shelf: String(item.product?.shelf ?? '').trim(),
      known: Boolean(item.product),
    }));

    return rows.sort((a, b) => {
      if (!a.rack && b.rack) return 1;
      if (a.rack && !b.rack) return -1;
      if (!a.rack) return a.name.localeCompare(b.name);

      // A1 before A2 before A10 - plain string compare would put A10 second.
      const rackOrder = a.rack.localeCompare(b.rack, undefined, { numeric: true });
      if (rackOrder !== 0) return rackOrder;

      const shelfOrder = a.shelf.localeCompare(b.shelf, undefined, {
        numeric: true,
      });
      if (shelfOrder !== 0) return shelfOrder;

      return a.name.localeCompare(b.name);
    });
  }, [order]);

  // Anything a picker cannot walk to: no rack, or a product that is gone.
  const unlocated = pickList.filter((row) => !row.rack && !row.shelf);

  // Units across every line, so the header answers "how much am I picking?"
  // without the reader having to add the column up themselves.
  const totalUnits = pickList.reduce((sum, row) => sum + row.quantity, 0);

  if (loading) {
    return (
      <LoadingSpinner
        fullPage
        label={isAdmin ? 'Loading the order…' : 'Loading your order…'}
      />
    );
  }

  // Where "back" goes: the admin goes back to the dispatch board, a customer
  // back to the shop they ordered from.
  const backTo = isAdmin ? ROUTES.ADMIN_DASHBOARD : ROUTES.STORE;
  const backLabel = isAdmin ? 'Back to orders' : 'Back to store';
  const pageClass = isAdmin ? 'page' : 'page page--customer';

  if (error) {
    return (
      <div className={pageClass}>
        <p className="alert alert--danger">{error}</p>
        <div className="button-row">
          <button type="button" className="btn btn-outline" onClick={loadOrder}>
            Try again
          </button>
          <Link className="btn btn-ghost" to={backTo}>
            {backLabel}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={pageClass}>
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
          {/* The admin reads this inside the side rail, so it needs a way back
              to the board; a customer already has the navbar above them. */}
          {isAdmin ? (
            <Link className="btn btn-outline btn-sm" to={backTo}>
              ← {backLabel}
            </Link>
          ) : null}

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
        riderLabel={order?.rider?.name || (isAdmin ? 'Rider' : 'Your rider')}
      />

      {isAdmin ? (
        <section className="panel picklist">
          <div className="panel__header">
            <h2 className="panel__title">Pick list</h2>
            <span className="muted small">
              {pickList.length} line{pickList.length === 1 ? '' : 's'} ·{' '}
              {totalUnits} item{totalUnits === 1 ? '' : 's'} to collect · walk
              the racks in this order
            </span>
          </div>

          {pickList.length === 0 ? (
            <p className="muted">This order has no items to collect.</p>
          ) : (
            <ol className="picklist__rows">
              {pickList.map((row) => {
                const located = Boolean(row.rack || row.shelf);

                return (
                  <li
                    key={`${row.name}-${row.rack}-${row.shelf}`}
                    className={`picklist__row ${located ? '' : 'picklist__row--unlocated'}`}
                  >
                    {/* The photo, so the picker recognises the item and not just
                        its name. Falls back to the same bag glyph the catalogue
                        card uses when a product has no image. */}
                    {row.image ? (
                      <img
                        className="picklist__img"
                        src={row.image}
                        alt=""
                        loading="lazy"
                      />
                    ) : (
                      <span
                        className="picklist__img picklist__img--empty"
                        aria-hidden="true"
                      >
                        🛍️
                      </span>
                    )}

                    <span className="picklist__name">
                      <strong>{row.name}</strong>
                      {row.category ? (
                        <em className="muted small"> {row.category}</em>
                      ) : null}
                      {!row.known ? (
                        <em className="muted small"> — removed from the catalogue</em>
                      ) : null}
                    </span>

                    {/* How many to put in the bag. Stated in words as well as a
                        number so a glance is never ambiguous. */}
                    <span
                      className="picklist__qty"
                      title={`${row.quantity} ordered`}
                    >
                      <strong>{row.quantity}</strong>
                      <em>ordered</em>
                    </span>

                    {located ? (
                      <span className="picklist__where">
                        {row.rack ? <span className="chip">Rack {row.rack}</span> : null}
                        {row.shelf ? (
                          <span className="chip">Shelf {row.shelf}</span>
                        ) : null}
                      </span>
                    ) : (
                      <span className="chip chip--danger">No location</span>
                    )}
                  </li>
                );
              })}
            </ol>
          )}

          {unlocated.length > 0 ? (
            <p className="alert alert--warn">
              {unlocated.length} line{unlocated.length === 1 ? '' : 's'} without a
              rack — set one in the product catalogue to speed up picking.
            </p>
          ) : null}
        </section>
      ) : null}

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
