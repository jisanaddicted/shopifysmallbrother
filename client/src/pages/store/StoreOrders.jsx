import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import { useAuth } from '../../context/AuthContext';
import storeService from '../../services/storeService';
import {
  ORDER_STATUS,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_TONE,
  PAYMENT_STATUS,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_TONE,
  ROUTES,
} from '../../utils/constants';
import { formatCurrency, formatDateTime } from '../../utils/formatters';

/**
 * The store's order book, as a full page in the side rail.
 *
 * This replaces the small orders table that used to sit at the bottom of "My
 * store", underneath the team and storefront panels. It was never a lack of
 * data - the endpoint returns up to 200 orders with everything needed here -
 * it was that the table was one of six sections on a scrolling page, so the
 * numbers a merchant opens the page to see were below the fold.
 *
 * The shape follows the order columns a merchant actually triages on: what it
 * was for, who it is for, what it came to, and whether it is paid, made and
 * delivered. Fulfillment and delivery are shown as separate columns because in
 * this app they genuinely are separate - a rider marks `out_for_delivery` and
 * then the CUSTOMER confirms receipt, so "fulfilled" and "delivered" are two
 * different moments, and collapsing them into one column would hide the
 * handoff the app is built around.
 */

// A short, stable, human-facing order number. The last six hex characters of
// the id read like a ticket number, and - unlike a running counter - stay the
// same forever and need no sequence to allocate.
const orderNumber = (id) => `#${String(id || '').slice(-6).toUpperCase()}`;

const countItems = (order) =>
  (order.items || []).reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);

/** "Jun 19 at 1:49 am" - compact, and it keeps the AM/PM a merchant reads. */
const shortDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const day = date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
  const time = date
    .toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    .toLowerCase();
  return `${day} at ${time}`;
};

/**
 * Whether the order is on the rider's hands yet, as opposed to the shop's.
 *
 * The order `status` is the delivery's progress; "fulfillment" is the store's
 * half (built and waiting) and "delivery" is the rider's + customer's half.
 * Deriving both from one status keeps the two columns from ever disagreeing.
 */
function fulfillmentOf(order) {
  const status = order.status;
  const closed = order.isOpen === false;
  const delivered =
    status === ORDER_STATUS.DELIVERED ||
    status === ORDER_STATUS.RECEIVED ||
    closed;

  if (delivered) {
    return { value: 'Fulfilled', tone: 'success', done: true };
  }
  if (
    status === ORDER_STATUS.PICKED_UP ||
    status === ORDER_STATUS.OUT_FOR_DELIVERY
  ) {
    return { value: 'In transit', tone: 'info', done: true };
  }
  if (status === ORDER_STATUS.READY_FOR_PICKUP) {
    return { value: 'Ready', tone: 'info', done: true };
  }
  if (status === ORDER_STATUS.CANCELLED) {
    return { value: 'Cancelled', tone: 'danger', done: false };
  }
  return { value: 'Unfulfilled', tone: 'warn', done: false };
}

function deliveryOf(order) {
  const status = order.status;
  if (status === ORDER_STATUS.RECEIVED) {
    return { value: 'Delivered', tone: 'success' };
  }
  if (status === ORDER_STATUS.DELIVERED) {
    return { value: 'Delivered', tone: 'success' };
  }
  if (status === ORDER_STATUS.OUT_FOR_DELIVERY) {
    return { value: 'Out for delivery', tone: 'info' };
  }
  if (status === ORDER_STATUS.PICKED_UP) {
    return { value: 'Picked up', tone: 'info' };
  }
  if (status === ORDER_STATUS.CANCELLED) {
    return { value: 'Cancelled', tone: 'danger' };
  }
  return { value: 'Not delivered', tone: 'muted' };
}

/** One figure in the stat row, with the tiny caption underneath. */
function Stat({ label, value, hint }) {
  return (
    <div className="orders__stat">
      <div className="orders__stat-label">{label}</div>
      <div className="orders__stat-value">{value}</div>
      <div className="orders__stat-hint">{hint}</div>
    </div>
  );
}

export default function StoreOrders() {
  const { stores: sessionStores } = useAuth();
  const [orders, setOrders] = useState([]);
  const [stores, setStores] = useState([]);
  // The store whose orders are on screen. An account can run several, and the
  // order list is always one store's - mixing them would make every total
  // meaningless.
  const [storeId, setStoreId] = useState('');
  const [term, setTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // The store switcher at the top. Falls back to the session's list, so the
  // page still has a picker on a cold load.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const mine = await storeService.listMyMerchantStores();
        if (!alive) return;
        const list = Array.isArray(mine) ? mine : mine?.stores || [];
        setStores(list);
        setStoreId((current) => current || list[0]?.store?._id || list[0]?._id || '');
      } catch {
        // Not fatal: the session list still gives us a label to show.
        if (!alive) return;
        const fallback = (sessionStores || []).map((entry) => ({
          store: entry.store || entry,
        }));
        setStores(fallback);
        setStoreId((current) => current || fallback[0]?.store?._id || '');
      }
    })();
    return () => {
      alive = false;
    };
  }, [sessionStores]);

  const load = useCallback(async () => {
    if (!storeId) {
      setOrders([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await storeService.listStoreOrders(storeId);
      setOrders(data || []);
    } catch (err) {
      setError(err.message || 'Could not load your orders.');
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    load();
  }, [load]);

  // The five figures across the top. Counted from the same filtered set the
  // table shows, so the tiles and the rows can never disagree - a tile that
  // counted the whole store while the table was filtered would be a lie on
  // purpose.
  const stats = useMemo(() => {
    const open = orders.filter((order) => order.isOpen !== false);
    const items = orders.reduce((sum, order) => sum + countItems(order), 0);
    const sales = open.reduce(
      (sum, order) => sum + (Number(order.total) || 0),
      0,
    );
    const fulfilled = orders.filter(
      (order) => fulfillmentOf(order).done,
    ).length;
    const delivered = orders.filter((order) =>
      [ORDER_STATUS.DELIVERED, ORDER_STATUS.RECEIVED].includes(order.status),
    ).length;

    return {
      orders: orders.length,
      open: open.length,
      items,
      sales,
      fulfilled,
      delivered,
    };
  }, [orders]);

  // Search and the status pill both narrow the list in the browser. The page
  // already holds every order the endpoint returns, so filtering server-side
  // would only add a round trip and a flash of an empty table.
  const visible = useMemo(() => {
    const needle = term.trim().toLowerCase();
    return orders.filter((order) => {
      if (statusFilter === 'open' && order.isOpen === false) return false;
      if (statusFilter === 'closed' && order.isOpen !== false) return false;
      if (statusFilter === 'unfulfilled' && fulfillmentOf(order).done) {
        return false;
      }
      if (!needle) return true;

      // Search the things a merchant would actually type: the ticket number,
      // the customer's name, and what they bought.
      const haystack = [
        orderNumber(order.id || order._id),
        order.customer?.name,
        order.customer?.email,
        order.customer?.phone,
        ...(order.items || []).map((item) => item.name),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [orders, term, statusFilter]);

  const activeStore = stores.find(
    (entry) => (entry.store?._id || entry._id || entry.store?.id) === storeId,
  );
  const storeName =
    activeStore?.store?.name || activeStore?.name || 'your store';

  /** Export the same rows on screen to CSV, so "Export" cannot quietly disagree. */
  const exportCsv = () => {
    const header = [
      'Order',
      'Date',
      'Customer',
      'Total',
      'Payment status',
      'Fulfillment status',
      'Items',
      'Delivery status',
    ];
    const rows = visible.map((order) => [
      orderNumber(order.id || order._id),
      order.createdAt ? new Date(order.createdAt).toISOString() : '',
      order.customer?.name || order.customer?.email || '',
      Number(order.total) || 0,
      order.payment?.status || PAYMENT_STATUS.PENDING,
      fulfillmentOf(order).value,
      countItems(order),
      deliveryOf(order).value,
    ]);

    const escape = (value) => `"${String(value).replace(/"/g, '""')}"`;
    const csv = [header, ...rows]
      .map((row) => row.map(escape).join(','))
      .join('\r\n');

    const url = URL.createObjectURL(
      new Blob([csv], { type: 'text/csv;charset=utf-8' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <LoadingSpinner label="Loading orders…" />;

  return (
    <div className="orders">
      <header className="orders__head">
        <h1 className="orders__title">Orders</h1>

        <div className="orders__head-actions">
          {stores.length > 1 ? (
            <select
              className="input"
              value={storeId}
              onChange={(event) => setStoreId(event.target.value)}
              aria-label="Choose a store"
            >
              {stores.map((entry) => {
                const store = entry.store || entry;
                return (
                  <option key={store._id} value={store._id}>
                    {store.name}
                  </option>
                );
              })}
            </select>
          ) : (
            <span className="orders__store">{storeName}</span>
          )}

          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={exportCsv}
            disabled={!visible.length}
          >
            Export
          </button>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={load}
          >
            Refresh
          </button>
        </div>
      </header>

      {error ? <p className="alert alert--danger">{error}</p> : null}

      <div className="orders__stats">
        <Stat
          label="Orders"
          value={stats.orders}
          hint={stats.open ? `${stats.open} still in play` : '— all closed'}
        />
        <Stat label="Items ordered" value={stats.items} hint="across every line" />
        <Stat
          label="Sales reversals"
          value={formatCurrency(stats.sales)}
          hint="open orders only"
        />
        <Stat
          label="Orders fulfilled"
          value={stats.fulfilled}
          hint={`${stats.orders - stats.fulfilled} waiting`}
        />
        <Stat label="Orders delivered" value={stats.delivered} hint="handed over" />
      </div>

      <div className="orders__filters">
        <select
          className="input"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          aria-label="Filter by status"
        >
          <option value="all">All</option>
          <option value="open">Still open</option>
          <option value="closed">Closed</option>
          <option value="unfulfilled">Not yet fulfilled</option>
        </select>

        <div className="orders__search">
          <span aria-hidden="true">🔍</span>
          <input
            type="search"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Search and filter"
            aria-label="Search orders"
          />
        </div>
      </div>

      {visible.length ? (
        <div className="table-wrap">
          <table className="table orders__table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Date</th>
                <th>Customer</th>
                <th>Channel</th>
                <th>Total</th>
                <th>Payment status</th>
                <th>Fulfilment status</th>
                <th>Items</th>
                <th>Delivery status</th>
                <th>Delivery method</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((order) => {
                const id = order.id || order._id;
                const fulfillment = fulfillmentOf(order);
                const delivery = deliveryOf(order);
                const paymentStatus =
                  order.payment?.status || PAYMENT_STATUS.PENDING;
                const items = countItems(order);
                const customerName =
                  order.customer?.name ||
                  order.customer?.email ||
                  order.customer?.phone ||
                  'Guest';

                return (
                  <tr key={id}>
                    <td>
                      <Link
                        className="link"
                        to={ROUTES.MERCHANT_ORDER_DETAIL.replace(':orderId', id)}
                      >
                        {orderNumber(id)}
                      </Link>
                    </td>
                    <td className="muted small nowrap">
                      {shortDate(order.createdAt)}
                    </td>
                    <td className="nowrap">{customerName}</td>
                    <td className="muted small nowrap">Online Store</td>
                    <td className="price nowrap">
                      {formatCurrency(order.total)}
                    </td>
                    <td>
                      <span
                        className={`badge badge--${PAYMENT_STATUS_TONE[paymentStatus] || 'info'}`}
                      >
                        {PAYMENT_STATUS_LABELS[paymentStatus] ||
                          formatStatusFallback(paymentStatus)}
                      </span>
                    </td>
                    <td>
                      <span className={`badge badge--${fulfillment.tone}`}>
                        {fulfillment.value}
                      </span>
                    </td>
                    <td className="muted small nowrap">
                      {items} item{items === 1 ? '' : 's'}
                    </td>
                    <td>
                      <span className={`badge badge--${delivery.tone}`}>
                        {delivery.value}
                      </span>
                    </td>
                    <td className="muted small nowrap">
                      {order.paymentMethod === 'cod' ? 'Cash on delivery' : 'Online'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card empty">
          <p className="muted">
            {orders.length
              ? 'No orders match that filter.'
              : 'No orders yet. They will appear here as soon as somebody checks out.'}
          </p>
        </div>
      )}

      {visible.length ? (
        <p className="muted small orders__count">
          Showing {visible.length} of {orders.length} order
          {orders.length === 1 ? '' : 's'}
        </p>
      ) : null}
    </div>
  );
}

/** Payment statuses the model allows, spelled out if one is ever added. */
function formatStatusFallback(value) {
  return String(value || '')
    .split(/[_-]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
